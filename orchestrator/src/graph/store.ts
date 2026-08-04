import { chmodSync, existsSync, lstatSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type { GraphApproval } from "./authority.js";
import { canonicalJson, sha256 } from "./reducer.js";
import type {
  EvidenceReference,
  ChildRunReceipt,
  ExternalEffectRecord,
  GraphDefinition,
  GraphEvent,
  GraphRunState,
  GraphRunStatus,
  JsonValue,
  LiveCapabilityDispatch,
  LiveCapabilityDispatchState,
  OneRunLiveCapability,
  VerifierReceipt,
} from "./types.js";
import {
  GRAPH_MIGRATION_CHECKSUM,
  GRAPH_MIGRATION_ID,
  GRAPH_SCHEMA_NAME,
  GRAPH_SCHEMA_OBJECTS,
  GRAPH_SCHEMA_VERSION,
  GRAPH_SCHEMA_V2_OBJECTS,
  GRAPH_SCHEMA_V3_OBJECTS,
  type GraphMigrationFailurePoint,
} from "./migrations.js";
import { GraphPersistenceError, verifyGraphSchema, verifyGraphSchemaV1, verifyGraphSchemaV2, type GraphSchemaVerification } from "./schema-verifier.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type SqliteDatabase = InstanceType<typeof DatabaseSync>;

const SECRET_KEY = /(secret|token|password|credential|api[_-]?key|private[_-]?key)/i;

export type GraphStoreOptions = {
  migrationFailurePoint?: GraphMigrationFailurePoint;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function secureSqliteFile(path: string): void {
  if (!existsSync(path)) return;
  const before = lstatSync(path);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new GraphPersistenceError("permission_error", "graph_database_file_is_not_regular", { path });
  }
  const expectedUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (expectedUid !== null && before.uid !== expectedUid) {
    throw new GraphPersistenceError("permission_error", "graph_database_owner_mismatch", {
      path,
      expectedUid,
      observedUid: before.uid,
    });
  }
  if ((before.mode & 0o777) !== 0o600) chmodSync(path, 0o600);
  const after = statSync(path);
  if ((after.mode & 0o777) !== 0o600) {
    throw new GraphPersistenceError("permission_error", "graph_database_mode_not_owner_only", {
      path,
      observedMode: (after.mode & 0o777).toString(8),
    });
  }
}

function openSecureDatabase(path: string): SqliteDatabase {
  let previousUmask: number | null = null;
  try {
    previousUmask = process.umask(0o077);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ERR_WORKER_UNSUPPORTED_OPERATION") throw error;
  }
  try {
    return new DatabaseSync(path);
  } finally {
    if (previousUmask !== null) process.umask(previousUmask);
  }
}

function json<T>(value: string): T {
  return JSON.parse(value) as T;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
    key,
    SECRET_KEY.test(key) ? "[REDACTED]" : redact(nested),
  ]));
}

export type EventInput = {
  type: string;
  nodeId?: string | null;
  attemptNumber?: number | null;
  actor?: string;
  payload?: Record<string, JsonValue>;
  causationId?: string | null;
};

export class GraphStore {
  readonly path: string;
  private readonly database: SqliteDatabase;

  constructor(path: string, options: GraphStoreOptions = {}) {
    this.path = path;
    const existed = existsSync(path);
    if (existed && lstatSync(path).isSymbolicLink()) {
      throw new GraphPersistenceError("unsafe_path", "graph_database_symlink_target_rejected", { path });
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const database = openSecureDatabase(path);
    this.database = database;
    try {
      secureSqliteFile(path);
      this.database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
      this.secureFiles();
      this.migrate(existed, options.migrationFailurePoint);
      this.secureFiles();
    } catch (error) {
      try {
        database.close();
      } catch {
        // The primary open or migration error is authoritative.
      }
      throw error;
    }
  }

  close(): void {
    this.database.close();
    this.secureFiles();
  }

  private secureFiles(): void {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) secureSqliteFile(`${this.path}${suffix}`);
  }

  checkpointAndSecure(): void {
    this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.secureFiles();
  }

  schemaVerification(options: { requireEmptyExecutionState?: boolean } = {}): GraphSchemaVerification {
    return verifyGraphSchema(this.database, options);
  }

  private migrate(existed: boolean, failurePoint?: GraphMigrationFailurePoint): void {
    if (existed) {
      try {
        verifyGraphSchema(this.database);
        return;
      } catch (error) {
        if (!(error instanceof GraphPersistenceError) || error.code !== "incomplete_schema") throw error;
        const metadata = this.database.prepare("SELECT schema_version FROM graph_schema_meta WHERE schema_name=?").get(GRAPH_SCHEMA_NAME) as { schema_version?: number } | undefined;
        if (![1, 2].includes(Number(metadata?.schema_version))) throw error;
      }
      const observedVersion = Number((this.database.prepare("SELECT schema_version FROM graph_schema_meta WHERE schema_name=?").get(GRAPH_SCHEMA_NAME) as { schema_version?: number } | undefined)?.schema_version);
      if (observedVersion === 1) verifyGraphSchemaV1(this.database);
      else if (observedVersion === 2) verifyGraphSchemaV2(this.database);
      else throw new GraphPersistenceError("unsupported_schema_version", "graph_schema_upgrade_source_not_supported", { observedVersion });
      let transactionStarted = false;
      try {
        this.database.exec("BEGIN IMMEDIATE");
        transactionStarted = true;
        if (observedVersion === 1) {
          for (const object of GRAPH_SCHEMA_V2_OBJECTS) this.database.exec(object.sql);
          if (failurePoint === "during_v2_upgrade") throw new Error("injected_graph_migration_failure:during_v2_upgrade");
        }
        for (const object of GRAPH_SCHEMA_V3_OBJECTS) this.database.exec(object.sql);
        if (failurePoint === "during_v3_upgrade") throw new Error("injected_graph_migration_failure:during_v3_upgrade");
        this.database.prepare(`
          UPDATE graph_schema_meta
          SET schema_version=?, migration_id=?, migration_checksum=?, applied_at=?
          WHERE schema_name=? AND schema_version=?
        `).run(GRAPH_SCHEMA_VERSION, GRAPH_MIGRATION_ID, GRAPH_MIGRATION_CHECKSUM, new Date().toISOString(), GRAPH_SCHEMA_NAME, observedVersion);
        this.database.exec(`PRAGMA user_version=${GRAPH_SCHEMA_VERSION}`);
        this.database.exec("COMMIT");
        transactionStarted = false;
      } catch (primaryError) {
        if (transactionStarted) {
          try { this.database.exec("ROLLBACK"); } catch (rollbackError) {
            if (primaryError && typeof primaryError === "object") Object.defineProperty(primaryError, "rollbackError", { value: rollbackError, enumerable: false });
          }
        }
        throw new GraphPersistenceError("migration_rolled_back", `graph_migration_failed:${GRAPH_MIGRATION_ID}:${errorText(primaryError)}`, {
          migrationId: GRAPH_MIGRATION_ID,
          rollbackSucceeded: true,
        }, { cause: primaryError });
      }
      verifyGraphSchema(this.database);
      return;
    }

    let transactionStarted = false;
    try {
      this.database.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      const tables = GRAPH_SCHEMA_OBJECTS.filter((object) => object.type === "table");
      const indexes = GRAPH_SCHEMA_OBJECTS.filter((object) => object.type === "index");
      const triggers = GRAPH_SCHEMA_OBJECTS.filter((object) => object.type === "trigger");
      tables.forEach((object, index) => {
        this.database.exec(object.sql);
        if (index === 0 && failurePoint === "after_first_table") throw new Error("injected_graph_migration_failure:after_first_table");
      });
      if (failurePoint === "after_tables") throw new Error("injected_graph_migration_failure:after_tables");
      for (const object of indexes) this.database.exec(object.sql);
      if (failurePoint === "after_indexes") throw new Error("injected_graph_migration_failure:after_indexes");
      for (const object of triggers) this.database.exec(object.sql);
      if (failurePoint === "before_metadata") throw new Error("injected_graph_migration_failure:before_metadata");
      this.database.prepare(`
        INSERT INTO graph_schema_meta(schema_name, schema_version, migration_id, migration_checksum, applied_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(GRAPH_SCHEMA_NAME, GRAPH_SCHEMA_VERSION, GRAPH_MIGRATION_ID, GRAPH_MIGRATION_CHECKSUM, new Date().toISOString());
      this.database.exec(`PRAGMA user_version=${GRAPH_SCHEMA_VERSION}`);
      this.database.exec("COMMIT");
      transactionStarted = false;
    } catch (primaryError) {
      let rollbackError: unknown = null;
      if (transactionStarted) {
        try {
          this.database.exec("ROLLBACK");
        } catch (error) {
          rollbackError = error;
        }
      }
      const code = rollbackError ? "migration_failed" : "migration_rolled_back";
      throw new GraphPersistenceError(code, `graph_migration_failed:${GRAPH_MIGRATION_ID}:${errorText(primaryError)}`, {
        migrationId: GRAPH_MIGRATION_ID,
        rollbackSucceeded: rollbackError === null,
        rollbackError: rollbackError ? errorText(rollbackError) : null,
      }, { cause: primaryError });
    }
    verifyGraphSchema(this.database, { requireEmptyExecutionState: true });
  }

  transaction<T>(work: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const value = work();
      this.database.exec("COMMIT");
      return value;
    } catch (primaryError) {
      try {
        this.database.exec("ROLLBACK");
      } catch (rollbackError) {
        if (primaryError && typeof primaryError === "object") {
          Object.defineProperty(primaryError, "rollbackError", { value: rollbackError, enumerable: false });
        }
      }
      throw primaryError;
    }
  }

  registerDefinition(definition: GraphDefinition): void {
    const serialized = canonicalJson(definition);
    const hash = sha256(serialized);
    const existing = this.database.prepare(
      "SELECT definition_hash FROM graph_definitions WHERE graph_id=? AND graph_version=?",
    ).get(definition.graphId, definition.version) as { definition_hash?: string } | undefined;
    if (existing && existing.definition_hash !== hash) {
      throw new Error(`graph_definition_version_immutable:${definition.graphId}@${definition.version}`);
    }
    if (!existing) {
      this.database.prepare(`
        INSERT INTO graph_definitions(graph_id, graph_version, definition_json, definition_hash, registered_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(definition.graphId, definition.version, serialized, hash, new Date().toISOString());
    }
  }

  definitions(): GraphDefinition[] {
    return (this.database.prepare("SELECT definition_json FROM graph_definitions ORDER BY graph_id, graph_version").all() as Array<{ definition_json: string }>).map((row) => json<GraphDefinition>(row.definition_json));
  }

  definitionRecord(graphId: string, graphVersion: string): { definition: GraphDefinition; definitionHash: string; registeredAt: string } | null {
    const row = this.database.prepare(
      "SELECT definition_json, definition_hash, registered_at FROM graph_definitions WHERE graph_id=? AND graph_version=?",
    ).get(graphId, graphVersion) as { definition_json?: string; definition_hash?: string; registered_at?: string } | undefined;
    return row?.definition_json ? {
      definition: json<GraphDefinition>(row.definition_json),
      definitionHash: String(row.definition_hash),
      registeredAt: String(row.registered_at),
    } : null;
  }

  createRun(run: GraphRunState, actor = "graph-run-service"): GraphRunState {
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO graph_runs(run_id, graph_id, graph_version, parent_run_id, correlation_id, objective, status, current_node_id, state_json, revision, last_progress_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(run.runId, run.graphId, run.graphVersion, run.parentRunId, run.correlationId, run.objective, run.status, run.currentNodeId, canonicalJson(redact(run)), run.revision, run.lastProgressAt, run.createdAt, run.updatedAt);
      this.appendEventUnsafe(run, { type: "graph_run_created", actor, payload: { graphId: run.graphId, graphVersion: run.graphVersion } });
      for (const savedCheckpoint of run.checkpoints) {
        this.appendEventUnsafe(run, { type: "checkpoint_created", nodeId: savedCheckpoint.nodeId, actor, payload: { checkpointId: savedCheckpoint.checkpointId, reason: savedCheckpoint.reason, stateHash: savedCheckpoint.stateHash } });
      }
      this.appendEventUnsafe(run, { type: "state_snapshot_recorded", actor, payload: { state: redact(run) as JsonValue } });
    });
    return structuredClone(run);
  }

  getRun(runId: string): GraphRunState | null {
    const row = this.database.prepare("SELECT state_json FROM graph_runs WHERE run_id=?").get(runId) as { state_json?: string } | undefined;
    return row?.state_json ? json<GraphRunState>(row.state_json) : null;
  }

  listRuns(args: { status?: GraphRunStatus; graphId?: string; limit?: number } = {}): GraphRunState[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (args.status) { clauses.push("status=?"); values.push(args.status); }
    if (args.graphId) { clauses.push("graph_id=?"); values.push(args.graphId); }
    values.push(Math.min(Math.max(args.limit ?? 50, 1), 250));
    const sql = `SELECT state_json FROM graph_runs ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ?`;
    return (this.database.prepare(sql).all(...values) as Array<{ state_json: string }>).map((row) => json<GraphRunState>(row.state_json));
  }

  activeRunCount(graphId?: string, graphVersion?: string): number {
    const active = ["created", "running", "compensating"];
    const row = graphId && graphVersion
      ? this.database.prepare("SELECT COUNT(*) AS count FROM graph_runs WHERE status IN (?, ?, ?) AND graph_id=? AND graph_version=?").get(...active, graphId, graphVersion)
      : this.database.prepare("SELECT COUNT(*) AS count FROM graph_runs WHERE status IN (?, ?, ?)").get(...active) as { count: number };
    return Number((row as { count: number }).count);
  }

  saveRun(run: GraphRunState, expectedRevision: number, events: EventInput[]): GraphRunState {
    const saved = { ...run, revision: expectedRevision + 1 };
    this.transaction(() => {
      const result = this.database.prepare(`
        UPDATE graph_runs SET status=?, current_node_id=?, state_json=?, revision=?, last_progress_at=?, updated_at=?
        WHERE run_id=? AND revision=?
      `).run(saved.status, saved.currentNodeId, canonicalJson(redact(saved)), saved.revision, saved.lastProgressAt, saved.updatedAt, saved.runId, expectedRevision);
      if (Number(result.changes) !== 1) throw new Error(`graph_run_revision_conflict:${saved.runId}`);
      for (const event of events) this.appendEventUnsafe(saved, event);
      this.appendEventUnsafe(saved, { type: "state_snapshot_recorded", payload: { state: redact(saved) as JsonValue } });
      for (const evidence of saved.evidence) this.insertEvidenceUnsafe(saved.runId, null, evidence);
      for (const effect of saved.externalEffects) this.upsertEffectUnsafe(effect);
      for (const checkpoint of saved.checkpoints) {
        this.database.prepare(`
          INSERT OR IGNORE INTO graph_checkpoints(checkpoint_id, run_id, node_id, reason, state_hash, snapshot_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(checkpoint.checkpointId, saved.runId, checkpoint.nodeId, checkpoint.reason, checkpoint.stateHash, canonicalJson(redact(saved)), checkpoint.createdAt);
      }
    });
    return saved;
  }

  events(runId: string): GraphEvent[] {
    return (this.database.prepare("SELECT * FROM graph_events WHERE run_id=? ORDER BY sequence").all(runId) as Array<Record<string, unknown>>).map((row) => ({
      eventId: String(row.event_id), runId: String(row.run_id), sequence: Number(row.sequence), timestamp: String(row.timestamp), type: String(row.event_type),
      nodeId: row.node_id === null ? null : String(row.node_id), attemptNumber: row.attempt_number === null ? null : Number(row.attempt_number), actor: String(row.actor),
      payload: json<Record<string, JsonValue>>(String(row.payload_json)), causationId: row.causation_id === null ? null : String(row.causation_id), correlationId: String(row.correlation_id),
      previousHash: row.previous_hash === null ? null : String(row.previous_hash), eventHash: String(row.event_hash),
    }));
  }

  verifyEventChain(runId: string): boolean {
    const events = this.events(runId);
    let previousHash: string | null = null;
    for (const event of events) {
      if (event.previousHash !== previousHash) return false;
      const material = { ...event, eventHash: undefined };
      if (sha256(material) !== event.eventHash) return false;
      previousHash = event.eventHash;
    }
    return true;
  }

  replayRun(runId: string): GraphRunState | null {
    const snapshot = this.events(runId).filter((event) => event.type === "state_snapshot_recorded").at(-1);
    const state = snapshot?.payload.state;
    if (!state || typeof state !== "object" || Array.isArray(state)) return null;
    return structuredClone(state) as unknown as GraphRunState;
  }

  private appendEventUnsafe(run: GraphRunState, input: EventInput): GraphEvent {
    const previous = this.database.prepare("SELECT sequence, event_hash FROM graph_events WHERE run_id=? ORDER BY sequence DESC LIMIT 1").get(run.runId) as { sequence?: number; event_hash?: string } | undefined;
    const event: GraphEvent = {
      eventId: randomUUID(), runId: run.runId, sequence: Number(previous?.sequence ?? 0) + 1, timestamp: new Date().toISOString(), type: input.type,
      nodeId: input.nodeId ?? null, attemptNumber: input.attemptNumber ?? null, actor: input.actor ?? "graph-executor", payload: (redact(input.payload ?? {}) as Record<string, JsonValue>),
      causationId: input.causationId ?? null, correlationId: run.correlationId, previousHash: previous?.event_hash ?? null, eventHash: "",
    };
    event.eventHash = sha256({ ...event, eventHash: undefined });
    this.database.prepare(`
      INSERT INTO graph_events(event_id, run_id, sequence, timestamp, event_type, node_id, attempt_number, actor, payload_json, causation_id, correlation_id, previous_hash, event_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event.eventId, event.runId, event.sequence, event.timestamp, event.type, event.nodeId, event.attemptNumber, event.actor, canonicalJson(event.payload), event.causationId, event.correlationId, event.previousHash, event.eventHash);
    return event;
  }

  acquireLease(resourceKey: string, runId: string, owner: string, leaseMs: number, now = new Date()): boolean {
    return this.transaction(() => {
      const existing = this.database.prepare("SELECT owner, expires_at FROM graph_resource_leases WHERE resource_key=?").get(resourceKey) as { owner?: string; expires_at?: string } | undefined;
      if (existing && Date.parse(String(existing.expires_at)) > now.getTime() && existing.owner !== owner) return false;
      this.database.prepare(`
        INSERT INTO graph_resource_leases(resource_key, run_id, owner, acquired_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(resource_key) DO UPDATE SET run_id=excluded.run_id, owner=excluded.owner, acquired_at=excluded.acquired_at, expires_at=excluded.expires_at
      `).run(resourceKey, runId, owner, now.toISOString(), new Date(now.getTime() + leaseMs).toISOString());
      return true;
    });
  }

  releaseLease(resourceKey: string, owner: string): void {
    this.database.prepare("DELETE FROM graph_resource_leases WHERE resource_key=? AND owner=?").run(resourceKey, owner);
  }

  createAttempt(args: { attemptId: string; runId: string; nodeId: string; attemptNumber: number; idempotencyKey: string; owner: string; leaseExpiresAt: string; startedAt: string; run?: GraphRunState }): void {
    this.transaction(() => {
      this.database.prepare(`INSERT INTO graph_node_attempts(attempt_id, run_id, node_id, attempt_number, status, idempotency_key, owner, lease_expires_at, started_at) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)`)
        .run(args.attemptId, args.runId, args.nodeId, args.attemptNumber, args.idempotencyKey, args.owner, args.leaseExpiresAt, args.startedAt);
      if (args.run) {
        if (args.run.status === "created") this.appendEventUnsafe(args.run, { type: "graph_started", nodeId: args.nodeId, attemptNumber: args.attemptNumber, actor: args.owner, payload: {} });
        this.appendEventUnsafe(args.run, { type: "node_scheduled", nodeId: args.nodeId, attemptNumber: args.attemptNumber, actor: args.owner, payload: { attemptId: args.attemptId, idempotencyKey: args.idempotencyKey } });
        this.appendEventUnsafe(args.run, { type: "node_started", nodeId: args.nodeId, attemptNumber: args.attemptNumber, actor: args.owner, payload: { attemptId: args.attemptId, leaseExpiresAt: args.leaseExpiresAt } });
      }
    });
  }

  finishAttempt(attemptId: string, status: "succeeded" | "failed" | "timed_out" | "cancelled" | "ambiguous", outcome: string, output: unknown, error: unknown): void {
    const result = this.database.prepare(`UPDATE graph_node_attempts SET status=?, outcome=?, output_json=?, error_json=?, completed_at=? WHERE attempt_id=? AND status='running'`)
      .run(status, outcome, canonicalJson(redact(output ?? null)), canonicalJson(redact(error ?? null)), new Date().toISOString(), attemptId);
    if (Number(result.changes) !== 1) throw new Error(`graph_attempt_terminal_conflict:${attemptId}`);
  }

  attemptCount(runId: string, nodeId: string): number {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM graph_node_attempts WHERE run_id=? AND node_id=?").get(runId, nodeId) as { count: number };
    return Number(row.count);
  }

  activeAttempts(): Array<{ attemptId: string; runId: string; nodeId: string; leaseExpiresAt: string }> {
    return (this.database.prepare("SELECT attempt_id, run_id, node_id, lease_expires_at FROM graph_node_attempts WHERE status='running'").all() as Array<Record<string, unknown>>).map((row) => ({
      attemptId: String(row.attempt_id), runId: String(row.run_id), nodeId: String(row.node_id), leaseExpiresAt: String(row.lease_expires_at),
    }));
  }

  expireRunningAttempts(runId: string, now = new Date()): string[] {
    const expired = this.activeAttempts()
      .filter((attempt) => attempt.runId === runId && Date.parse(attempt.leaseExpiresAt) <= now.getTime())
      .map((attempt) => attempt.attemptId);
    if (expired.length === 0) return [];
    this.transaction(() => {
      for (const attemptId of expired) {
        this.database.prepare(`
          UPDATE graph_node_attempts
          SET status='timed_out', outcome='timed_out',
              error_json=?, completed_at=?
          WHERE attempt_id=? AND status='running'
        `).run(canonicalJson({ category: "timeout", message: "Recovered expired attempt lease" }), now.toISOString(), attemptId);
      }
    });
    return expired;
  }

  releaseExpiredLeases(now = new Date()): number {
    const result = this.database.prepare("DELETE FROM graph_resource_leases WHERE expires_at<=?").run(now.toISOString());
    return Number(result.changes);
  }

  requestApproval(approval: GraphApproval): GraphApproval {
    this.database.prepare(`INSERT OR IGNORE INTO graph_approvals(approval_id, run_id, graph_version, node_id, action, target, payload_hash, status, requested_at, decided_at, expires_at, approver, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(approval.approvalId, approval.runId, approval.graphVersion, approval.nodeId, approval.action, approval.target, approval.payloadHash, approval.status, approval.requestedAt, approval.decidedAt, approval.expiresAt, approval.approver, approval.note);
    return this.approvals(approval.runId).find((item) => item.nodeId === approval.nodeId && item.payloadHash === approval.payloadHash)!;
  }

  decideApproval(approvalId: string, decision: "granted" | "denied", approver: string, expiresAt: string, note?: string): GraphApproval {
    const result = this.database.prepare("UPDATE graph_approvals SET status=?, decided_at=?, expires_at=?, approver=?, note=? WHERE approval_id=? AND status='pending'")
      .run(decision, new Date().toISOString(), expiresAt, approver, note ?? null, approvalId);
    if (Number(result.changes) !== 1) throw new Error(`graph_approval_not_pending:${approvalId}`);
    const row = this.database.prepare("SELECT * FROM graph_approvals WHERE approval_id=?").get(approvalId) as Record<string, unknown>;
    return this.mapApproval(row);
  }

  approvals(runId: string): GraphApproval[] {
    return (this.database.prepare("SELECT * FROM graph_approvals WHERE run_id=? ORDER BY requested_at").all(runId) as Array<Record<string, unknown>>).map((row) => this.mapApproval(row));
  }

  issueOneRunLiveCapability(
    capability: OneRunLiveCapability,
    dispatches: LiveCapabilityDispatch[],
    actor: string,
  ): OneRunLiveCapability {
    const run = this.getRun(capability.graphRunId);
    if (!run) throw new Error(`graph_run_not_found:${capability.graphRunId}`);
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO graph_one_run_live_capabilities(
          capability_id, status, graph_id, graph_version, graph_definition_hash, graph_run_id,
          claim_id, approval_id, provider, account_id, operation_type, candidate_id, campaign_id,
          sequence_id, slot_id, payload_hash, media_hash, envelope_hash, idempotency_key_fingerprint,
          maximum_mutating_dispatches, maximum_successful_publications, issued_at, not_before,
          expires_at, issued_by, consumed_at, revoked_at, failure_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        capability.capabilityId, capability.status, capability.graphId, capability.graphVersion,
        capability.graphDefinitionHash, capability.graphRunId, capability.claimId, capability.approvalId,
        capability.provider, capability.accountId, capability.operationType, capability.candidateId,
        capability.campaignId, capability.sequenceId, capability.slotId, capability.payloadHash,
        capability.mediaHash ?? null, capability.envelopeHash, capability.idempotencyKeyFingerprint,
        capability.maximumMutatingDispatches, capability.maximumSuccessfulPublications,
        capability.issuedAt, capability.notBefore, capability.expiresAt, capability.issuedBy,
        capability.consumedAt ?? null, capability.revokedAt ?? null, capability.failureReason ?? null,
      );
      for (const dispatch of dispatches) {
        this.database.prepare(`
          INSERT INTO graph_live_capability_dispatches(
            dispatch_id, capability_id, step_index, step_id, expected_operation,
            predecessor_step_id, maximum_dispatch_count, dispatch_count, state,
            reserved_at, completed_at, provider_operation_id, failure_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          dispatch.dispatchId, dispatch.capabilityId, dispatch.stepIndex, dispatch.stepId,
          dispatch.expectedOperation, dispatch.predecessorStepId ?? null, dispatch.maximumDispatchCount,
          dispatch.dispatchCount, dispatch.state, dispatch.reservedAt ?? null, dispatch.completedAt ?? null,
          dispatch.providerOperationId ?? null, dispatch.failureReason ?? null,
        );
      }
      this.appendEventUnsafe(run, {
        type: "one_run_live_capability_prepared",
        nodeId: this.liveCapabilityNodeId(capability.operationType),
        actor,
        payload: {
          capabilityId: capability.capabilityId,
          approvalId: capability.approvalId,
          envelopeHash: capability.envelopeHash,
          expiresAt: capability.expiresAt,
          maximumMutatingDispatches: capability.maximumMutatingDispatches,
        },
      });
    });
    return this.oneRunLiveCapability(capability.capabilityId)!;
  }

  oneRunLiveCapability(capabilityId: string): OneRunLiveCapability | null {
    const row = this.database.prepare("SELECT * FROM graph_one_run_live_capabilities WHERE capability_id=?").get(capabilityId) as Record<string, unknown> | undefined;
    return row ? this.mapOneRunLiveCapability(row) : null;
  }

  oneRunLiveCapabilityForRun(runId: string): OneRunLiveCapability | null {
    const row = this.database.prepare("SELECT * FROM graph_one_run_live_capabilities WHERE graph_run_id=?").get(runId) as Record<string, unknown> | undefined;
    return row ? this.mapOneRunLiveCapability(row) : null;
  }

  oneRunLiveCapabilities(): OneRunLiveCapability[] {
    return (this.database.prepare("SELECT * FROM graph_one_run_live_capabilities ORDER BY issued_at").all() as Array<Record<string, unknown>>).map((row) => this.mapOneRunLiveCapability(row));
  }

  liveCapabilityDispatches(capabilityId: string): LiveCapabilityDispatch[] {
    return (this.database.prepare("SELECT * FROM graph_live_capability_dispatches WHERE capability_id=? ORDER BY step_index").all(capabilityId) as Array<Record<string, unknown>>).map((row) => ({
      dispatchId: String(row.dispatch_id), capabilityId: String(row.capability_id), stepIndex: Number(row.step_index),
      stepId: String(row.step_id), expectedOperation: String(row.expected_operation),
      predecessorStepId: row.predecessor_step_id === null ? undefined : String(row.predecessor_step_id),
      maximumDispatchCount: 1, dispatchCount: Number(row.dispatch_count), state: String(row.state) as LiveCapabilityDispatchState,
      reservedAt: row.reserved_at === null ? undefined : String(row.reserved_at),
      completedAt: row.completed_at === null ? undefined : String(row.completed_at),
      providerOperationId: row.provider_operation_id === null ? undefined : String(row.provider_operation_id),
      failureReason: row.failure_reason === null ? undefined : String(row.failure_reason),
    }));
  }

  expireOneRunLiveCapabilities(now = new Date(), actor = "graph-runtime-expiry"): OneRunLiveCapability[] {
    const expiring = (this.database.prepare(`
      SELECT capability_id, graph_run_id, operation_type
      FROM graph_one_run_live_capabilities
      WHERE status IN ('prepared','active') AND expires_at<=?
      ORDER BY expires_at
    `).all(now.toISOString()) as Array<{ capability_id: string; graph_run_id: string; operation_type: string }>);
    if (expiring.length === 0) return [];
    this.transaction(() => {
      for (const row of expiring) {
        const result = this.database.prepare(`
          UPDATE graph_one_run_live_capabilities
          SET status='expired', failure_reason='capability_expired'
          WHERE capability_id=? AND status IN ('prepared','active') AND expires_at<=?
        `).run(row.capability_id, now.toISOString());
        if (Number(result.changes) !== 1) continue;
        const run = this.getRun(row.graph_run_id);
        if (run) {
          this.appendEventUnsafe(run, {
            type: "one_run_live_capability_expired",
            nodeId: this.liveCapabilityNodeId(row.operation_type),
            actor,
            payload: { capabilityId: row.capability_id, expiredAt: now.toISOString() },
          });
        }
      }
    });
    return expiring
      .map((row) => this.oneRunLiveCapability(row.capability_id))
      .filter((capability): capability is OneRunLiveCapability => capability !== null);
  }

  reserveLiveCapabilityDispatch(args: {
    capabilityId: string;
    stepId: string;
    expectedOperation: string;
    effectId: string;
    expected: Omit<OneRunLiveCapability, "capabilityId" | "status" | "issuedAt" | "notBefore" | "expiresAt" | "issuedBy" | "consumedAt" | "revokedAt" | "failureReason">;
    globalZeroWrite: boolean;
    actor: string;
    now?: Date;
  }): LiveCapabilityDispatch {
    this.expireOneRunLiveCapabilities(args.now ?? new Date(), args.actor);
    return this.transaction(() => {
      const now = args.now ?? new Date();
      if (args.globalZeroWrite !== true) throw new Error("live_capability_requires_global_zero_write");
      const capability = this.oneRunLiveCapability(args.capabilityId);
      if (!capability) throw new Error("one_run_live_capability_not_found");
      const immutableKeys = [
        "graphId", "graphVersion", "graphDefinitionHash", "graphRunId", "claimId", "approvalId",
        "provider", "accountId", "operationType", "candidateId", "campaignId", "sequenceId", "slotId",
        "payloadHash", "mediaHash", "envelopeHash", "idempotencyKeyFingerprint",
        "maximumMutatingDispatches", "maximumSuccessfulPublications",
      ] as const;
      for (const key of immutableKeys) {
        if ((capability[key] ?? null) !== (args.expected[key] ?? null)) throw new Error(`one_run_live_capability_binding_mismatch:${key}`);
      }
      if (!["prepared", "active"].includes(capability.status)) throw new Error(`one_run_live_capability_not_usable:${capability.status}`);
      if (Date.parse(capability.notBefore) > now.getTime()) throw new Error("one_run_live_capability_not_yet_valid");
      if (Date.parse(capability.expiresAt) <= now.getTime()) throw new Error("one_run_live_capability_expired");
      const run = this.getRun(capability.graphRunId);
      const capabilityNodeId = this.liveCapabilityNodeId(capability.operationType);
      if (!run || run.graphId !== capability.graphId || run.graphVersion !== capability.graphVersion || run.currentNodeId !== capabilityNodeId) {
        throw new Error("one_run_live_capability_run_binding_invalid");
      }
      const definition = this.definitionRecord(capability.graphId, capability.graphVersion);
      if (!definition || definition.definitionHash !== capability.graphDefinitionHash) throw new Error("one_run_live_capability_definition_binding_invalid");
      const approval = this.database.prepare("SELECT * FROM graph_approvals WHERE approval_id=?").get(capability.approvalId) as Record<string, unknown> | undefined;
      if (!approval || String(approval.run_id) !== capability.graphRunId || String(approval.graph_version) !== capability.graphVersion || String(approval.status) !== "granted" || Date.parse(String(approval.expires_at)) <= now.getTime()) {
        throw new Error("one_run_live_capability_approval_invalid");
      }
      const effect = this.database.prepare("SELECT * FROM graph_external_effects WHERE effect_id=? AND run_id=?").get(args.effectId, capability.graphRunId) as Record<string, unknown> | undefined;
      if (!effect || !["request_prepared", "request_sent"].includes(String(effect.state))) throw new Error("one_run_live_capability_effect_intent_missing");
      const equivalent = this.database.prepare("SELECT COUNT(*) AS count FROM graph_external_effects WHERE effect_id<>? AND target=? AND payload_hash=? AND state='effect_verified'").get(args.effectId, String(effect.target), String(effect.payload_hash)) as { count: number };
      if (Number(equivalent.count) > 0) throw new Error("one_run_live_capability_equivalent_effect_exists");
      const ambiguous = this.database.prepare("SELECT COUNT(*) AS count FROM graph_external_effects WHERE effect_id<>? AND target=? AND state IN ('ambiguous','provider_accepted')").get(args.effectId, String(effect.target)) as { count: number };
      if (Number(ambiguous.count) > 0) throw new Error("one_run_live_capability_ambiguous_effect_exists");
      const dispatch = this.database.prepare("SELECT * FROM graph_live_capability_dispatches WHERE capability_id=? AND step_id=?").get(capability.capabilityId, args.stepId) as Record<string, unknown> | undefined;
      if (!dispatch || String(dispatch.expected_operation) !== args.expectedOperation) throw new Error("one_run_live_capability_dispatch_plan_mismatch");
      if (String(dispatch.state) !== "prepared" || Number(dispatch.dispatch_count) >= Number(dispatch.maximum_dispatch_count)) throw new Error("one_run_live_capability_dispatch_exhausted");
      if (dispatch.predecessor_step_id) {
        const predecessor = this.database.prepare("SELECT state FROM graph_live_capability_dispatches WHERE capability_id=? AND step_id=?").get(capability.capabilityId, String(dispatch.predecessor_step_id)) as { state?: string } | undefined;
        if (predecessor?.state !== "succeeded") throw new Error("one_run_live_capability_predecessor_not_satisfied");
      }
      const used = this.database.prepare("SELECT COALESCE(SUM(dispatch_count),0) AS count FROM graph_live_capability_dispatches WHERE capability_id=?").get(capability.capabilityId) as { count: number };
      if (Number(used.count) >= capability.maximumMutatingDispatches) throw new Error("one_run_live_capability_mutation_budget_exhausted");
      const reservedAt = now.toISOString();
      this.database.prepare("UPDATE graph_live_capability_dispatches SET dispatch_count=dispatch_count+1, state='reserved', reserved_at=? WHERE dispatch_id=? AND state='prepared' AND dispatch_count<maximum_dispatch_count").run(reservedAt, String(dispatch.dispatch_id));
      const consumes = args.stepId === "instagram_publish" || args.stepId === "provider_effect" || args.stepId === "notification_effect";
      this.database.prepare("UPDATE graph_one_run_live_capabilities SET status=?, consumed_at=CASE WHEN ? THEN ? ELSE consumed_at END WHERE capability_id=? AND status IN ('prepared','active')")
        .run(consumes ? "consumed" : "active", consumes ? 1 : 0, reservedAt, capability.capabilityId);
      this.database.prepare("UPDATE graph_external_effects SET state='request_sent', last_observed_at=? WHERE effect_id=?").run(reservedAt, args.effectId);
      this.appendEventUnsafe(run, { type: "live_capability_dispatch_reserved", nodeId: capabilityNodeId, actor: args.actor, payload: { capabilityId: capability.capabilityId, stepId: args.stepId, expectedOperation: args.expectedOperation, effectId: args.effectId, consumed: consumes } });
      this.appendEventUnsafe(run, { type: "external_effect_dispatched", nodeId: capabilityNodeId, actor: args.actor, payload: { capabilityId: capability.capabilityId, stepId: args.stepId, effectId: args.effectId } });
      return this.liveCapabilityDispatches(capability.capabilityId).find((item) => item.stepId === args.stepId)!;
    });
  }

  completeLiveCapabilityDispatch(args: {
    capabilityId: string;
    stepId: string;
    state: Exclude<LiveCapabilityDispatchState, "prepared" | "reserved">;
    providerOperationId?: string;
    failureReason?: string;
    actor: string;
  }): LiveCapabilityDispatch {
    return this.transaction(() => {
      const capability = this.oneRunLiveCapability(args.capabilityId);
      if (!capability) throw new Error("one_run_live_capability_not_found");
      const run = this.getRun(capability.graphRunId);
      if (!run) throw new Error(`graph_run_not_found:${capability.graphRunId}`);
      const completedAt = new Date().toISOString();
      const result = this.database.prepare("UPDATE graph_live_capability_dispatches SET state=?, completed_at=?, provider_operation_id=?, failure_reason=? WHERE capability_id=? AND step_id=? AND state='reserved'")
        .run(args.state, completedAt, args.providerOperationId ?? null, args.failureReason ?? null, args.capabilityId, args.stepId);
      if (Number(result.changes) !== 1) throw new Error("one_run_live_capability_dispatch_not_reserved");
      if (args.state === "ambiguous") {
        this.database.prepare("UPDATE graph_one_run_live_capabilities SET status='consumed', consumed_at=COALESCE(consumed_at, ?), failure_reason=? WHERE capability_id=? AND status IN ('prepared','active')")
          .run(completedAt, args.failureReason ?? "ambiguous_provider_result", args.capabilityId);
      } else if (["confirmed_absent", "failed"].includes(args.state)) {
        this.database.prepare("UPDATE graph_one_run_live_capabilities SET status='blocked', failure_reason=? WHERE capability_id=? AND status IN ('prepared','active')")
          .run(args.failureReason ?? args.state, args.capabilityId);
      }
      this.appendEventUnsafe(run, { type: "live_capability_dispatch_completed", nodeId: this.liveCapabilityNodeId(capability.operationType), actor: args.actor, payload: { capabilityId: args.capabilityId, stepId: args.stepId, state: args.state, providerOperationId: args.providerOperationId ?? null } });
      return this.liveCapabilityDispatches(args.capabilityId).find((item) => item.stepId === args.stepId)!;
    });
  }

  revokeOneRunLiveCapability(capabilityId: string, actor: string, reason: string): OneRunLiveCapability {
    const capability = this.oneRunLiveCapability(capabilityId);
    if (!capability) throw new Error("one_run_live_capability_not_found");
    const run = this.getRun(capability.graphRunId);
    if (!run) throw new Error(`graph_run_not_found:${capability.graphRunId}`);
    const revokedAt = new Date().toISOString();
    this.transaction(() => {
      const result = this.database.prepare("UPDATE graph_one_run_live_capabilities SET status='revoked', revoked_at=?, failure_reason=? WHERE capability_id=? AND status IN ('prepared','active')").run(revokedAt, reason, capabilityId);
      if (Number(result.changes) !== 1) throw new Error(`one_run_live_capability_not_revocable:${capability.status}`);
      this.appendEventUnsafe(run, { type: "one_run_live_capability_revoked", nodeId: this.liveCapabilityNodeId(capability.operationType), actor, payload: { capabilityId, reason } });
    });
    return this.oneRunLiveCapability(capabilityId)!;
  }

  private liveCapabilityNodeId(operationType: string): string {
    if (operationType === "production.instagram-publication-live.v2") return "publish_provider_object";
    if (operationType === "production.digest-delivery.v1") return "deliver_notification";
    return "perform_exact_effect";
  }

  private mapOneRunLiveCapability(row: Record<string, unknown>): OneRunLiveCapability {
    return {
      capabilityId: String(row.capability_id), status: String(row.status) as OneRunLiveCapability["status"],
      graphId: String(row.graph_id), graphVersion: String(row.graph_version), graphDefinitionHash: String(row.graph_definition_hash), graphRunId: String(row.graph_run_id),
      claimId: String(row.claim_id), approvalId: String(row.approval_id), provider: String(row.provider), accountId: String(row.account_id), operationType: String(row.operation_type),
      candidateId: String(row.candidate_id), campaignId: String(row.campaign_id), sequenceId: String(row.sequence_id), slotId: String(row.slot_id), payloadHash: String(row.payload_hash),
      mediaHash: row.media_hash === null ? undefined : String(row.media_hash), envelopeHash: String(row.envelope_hash), idempotencyKeyFingerprint: String(row.idempotency_key_fingerprint),
      maximumMutatingDispatches: Number(row.maximum_mutating_dispatches), maximumSuccessfulPublications: Number(row.maximum_successful_publications),
      issuedAt: String(row.issued_at), notBefore: String(row.not_before), expiresAt: String(row.expires_at), issuedBy: String(row.issued_by),
      consumedAt: row.consumed_at === null ? undefined : String(row.consumed_at), revokedAt: row.revoked_at === null ? undefined : String(row.revoked_at), failureReason: row.failure_reason === null ? undefined : String(row.failure_reason),
    };
  }

  private mapApproval(row: Record<string, unknown>): GraphApproval {
    return { approvalId: String(row.approval_id), runId: String(row.run_id), graphVersion: String(row.graph_version), nodeId: String(row.node_id), action: String(row.action), target: String(row.target), payloadHash: String(row.payload_hash), status: String(row.status) as GraphApproval["status"], requestedAt: String(row.requested_at), decidedAt: row.decided_at === null ? null : String(row.decided_at), expiresAt: String(row.expires_at), approver: row.approver === null ? null : String(row.approver), note: row.note === null ? null : String(row.note) };
  }

  evidence(runId: string): EvidenceReference[] {
    return (this.database.prepare("SELECT * FROM graph_evidence WHERE run_id=? ORDER BY created_at").all(runId) as Array<Record<string, unknown>>).map((row) => ({ evidenceId: String(row.evidence_id), kind: String(row.kind), uri: String(row.uri), sha256: row.sha256 === null ? undefined : String(row.sha256), summary: String(row.summary), createdAt: String(row.created_at), checker: row.checker === null ? undefined : String(row.checker) }));
  }

  private insertEvidenceUnsafe(runId: string, nodeId: string | null, evidence: EvidenceReference): void {
    this.database.prepare(`INSERT OR IGNORE INTO graph_evidence(evidence_id, run_id, node_id, kind, uri, sha256, summary, checker, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(evidence.evidenceId, runId, nodeId, evidence.kind, evidence.uri, evidence.sha256 ?? null, evidence.summary, evidence.checker ?? null, evidence.createdAt);
  }

  private upsertEffectUnsafe(effect: ExternalEffectRecord): void {
    this.database.prepare(`
      INSERT INTO graph_external_effects(effect_id, run_id, node_id, idempotency_key, operation_type, target, payload_hash, state, provider_operation_id, last_observed_at, evidence_refs_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(effect_id) DO UPDATE SET state=excluded.state, provider_operation_id=excluded.provider_operation_id, last_observed_at=excluded.last_observed_at, evidence_refs_json=excluded.evidence_refs_json
    `).run(effect.effectId, effect.runId, effect.nodeId, effect.idempotencyKey, effect.operationType, effect.target, effect.payloadHash, effect.state, effect.providerOperationId ?? null, effect.lastObservedAt ?? null, canonicalJson(effect.evidenceRefs));
  }

  reconcileEffect(runId: string, effectId: string, state: ExternalEffectRecord["state"], providerOperationId: string | undefined, evidenceRefs: string[]): ExternalEffectRecord {
    const result = this.database.prepare("UPDATE graph_external_effects SET state=?, provider_operation_id=COALESCE(?, provider_operation_id), last_observed_at=?, evidence_refs_json=? WHERE run_id=? AND effect_id=?")
      .run(state, providerOperationId ?? null, new Date().toISOString(), canonicalJson(evidenceRefs), runId, effectId);
    if (Number(result.changes) !== 1) throw new Error(`graph_external_effect_not_found:${effectId}`);
    return this.externalEffects(runId).find((effect) => effect.effectId === effectId)!;
  }

  externalEffects(runId: string): ExternalEffectRecord[] {
    return (this.database.prepare("SELECT * FROM graph_external_effects WHERE run_id=? ORDER BY rowid").all(runId) as Array<Record<string, unknown>>).map((row) => ({ effectId: String(row.effect_id), runId: String(row.run_id), nodeId: String(row.node_id), idempotencyKey: String(row.idempotency_key), operationType: String(row.operation_type), target: String(row.target), payloadHash: String(row.payload_hash), state: String(row.state) as ExternalEffectRecord["state"], providerOperationId: row.provider_operation_id === null ? undefined : String(row.provider_operation_id), lastObservedAt: row.last_observed_at === null ? undefined : String(row.last_observed_at), evidenceRefs: json<string[]>(String(row.evidence_refs_json)) }));
  }

  checkpointSnapshot(runId: string, checkpointId: string): GraphRunState | null {
    const row = this.database.prepare("SELECT snapshot_json FROM graph_checkpoints WHERE run_id=? AND checkpoint_id=?").get(runId, checkpointId) as { snapshot_json?: string } | undefined;
    return row?.snapshot_json ? json<GraphRunState>(row.snapshot_json) : null;
  }

  prepareChildRunReceipt(args: {
    parentRunId: string;
    parentNodeId: string;
    parentAttemptId: string;
    idempotencyKey: string;
    childRunId: string;
    childTaskType: string;
    childAgentId: string;
    authority: GraphRunState["authority"];
    input: Record<string, JsonValue>;
    policyHash: string;
    actor?: string;
  }): ChildRunReceipt {
    const existing = this.childRunReceiptByIdempotencyKey(args.idempotencyKey);
    if (existing) {
      const expected = sha256({ parentRunId: args.parentRunId, parentNodeId: args.parentNodeId, parentAttemptId: args.parentAttemptId, childRunId: args.childRunId, childTaskType: args.childTaskType, childAgentId: args.childAgentId, authority: args.authority, input: redact(args.input), policyHash: args.policyHash });
      const observed = sha256({ parentRunId: existing.parentRunId, parentNodeId: existing.parentNodeId, parentAttemptId: existing.parentAttemptId, childRunId: existing.childRunId, childTaskType: existing.childTaskType, childAgentId: existing.childAgentId, authority: existing.authority, input: existing.input, policyHash: existing.policyHash });
      if (expected !== observed) throw new Error("child_run_receipt_idempotency_binding_mismatch");
      return existing;
    }
    const run = this.getRun(args.parentRunId);
    if (!run) throw new Error(`graph_run_not_found:${args.parentRunId}`);
    const receiptId = `gcr_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const safeInput = redact(args.input) as Record<string, JsonValue>;
    const inputHash = sha256(safeInput);
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO graph_child_run_receipts(
          receipt_id,parent_run_id,parent_node_id,parent_attempt_id,idempotency_key,child_run_id,
          child_task_type,child_agent_id,authority_json,input_json,input_hash,policy_hash,status,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'prepared', ?)
      `).run(receiptId, args.parentRunId, args.parentNodeId, args.parentAttemptId, args.idempotencyKey, args.childRunId, args.childTaskType, args.childAgentId, canonicalJson(args.authority), canonicalJson(safeInput), inputHash, args.policyHash, createdAt);
      this.appendEventUnsafe(run, { type: "child_run_prepared", nodeId: args.parentNodeId, actor: args.actor ?? "graph-child-run-coordinator", payload: { receiptId, childRunId: args.childRunId, childTaskType: args.childTaskType, childAgentId: args.childAgentId, inputHash, policyHash: args.policyHash } });
    });
    return this.childRunReceipt(receiptId)!;
  }

  bindChildRunDispatch(receiptId: string, dispatchTaskId: string, actor = "graph-child-run-coordinator"): ChildRunReceipt {
    const receipt = this.childRunReceipt(receiptId);
    if (!receipt) throw new Error("child_run_receipt_not_found");
    if (receipt.dispatchTaskId && receipt.dispatchTaskId !== dispatchTaskId) throw new Error("child_run_dispatch_binding_mismatch");
    if (!receipt.dispatchTaskId) {
      const run = this.getRun(receipt.parentRunId)!;
      this.transaction(() => {
        const result = this.database.prepare("UPDATE graph_child_run_receipts SET dispatch_task_id=?, status='dispatched' WHERE receipt_id=? AND status='prepared' AND dispatch_task_id IS NULL").run(dispatchTaskId, receiptId);
        if (Number(result.changes) !== 1) throw new Error("child_run_receipt_not_prepared");
        this.appendEventUnsafe(run, { type: "child_run_dispatched", nodeId: receipt.parentNodeId, actor, payload: { receiptId, childRunId: receipt.childRunId, dispatchTaskId } });
      });
    }
    return this.childRunReceipt(receiptId)!;
  }

  markChildRunRunning(receiptId: string, actor = "graph-child-run-coordinator"): ChildRunReceipt {
    const receipt = this.childRunReceipt(receiptId);
    if (!receipt) throw new Error("child_run_receipt_not_found");
    if (receipt.status === "running") return receipt;
    const startedAt = new Date().toISOString();
    const run = this.getRun(receipt.parentRunId)!;
    this.transaction(() => {
      const result = this.database.prepare("UPDATE graph_child_run_receipts SET status='running', started_at=? WHERE receipt_id=? AND status='dispatched'").run(startedAt, receiptId);
      if (Number(result.changes) !== 1) throw new Error("child_run_receipt_not_dispatched");
      this.appendEventUnsafe(run, { type: "child_run_started", nodeId: receipt.parentNodeId, actor, payload: { receiptId, childRunId: receipt.childRunId } });
    });
    return this.childRunReceipt(receiptId)!;
  }

  completeChildRunReceipt(args: {
    receiptId: string;
    status: "succeeded" | "failed" | "blocked";
    outcome: string;
    output: unknown;
    evidence: unknown;
    failureReason?: string;
    actor?: string;
  }): ChildRunReceipt {
    const receipt = this.childRunReceipt(args.receiptId);
    if (!receipt) throw new Error("child_run_receipt_not_found");
    if (["succeeded", "failed", "blocked"].includes(receipt.status)) return receipt;
    const completedAt = new Date().toISOString();
    const outputHash = sha256(redact(args.output));
    const evidenceHash = sha256(redact(args.evidence));
    const previous = (this.database.prepare("SELECT receipt_hash FROM graph_child_run_receipts WHERE parent_run_id=? AND receipt_hash IS NOT NULL ORDER BY completed_at DESC, receipt_id DESC LIMIT 1").get(receipt.parentRunId) as { receipt_hash?: string } | undefined)?.receipt_hash;
    const material = { receiptId: receipt.receiptId, parentRunId: receipt.parentRunId, parentNodeId: receipt.parentNodeId, parentAttemptId: receipt.parentAttemptId, idempotencyKey: receipt.idempotencyKey, childRunId: receipt.childRunId, dispatchTaskId: receipt.dispatchTaskId ?? null, childTaskType: receipt.childTaskType, childAgentId: receipt.childAgentId, authority: receipt.authority, inputHash: receipt.inputHash, policyHash: receipt.policyHash, status: args.status, createdAt: receipt.createdAt, startedAt: receipt.startedAt ?? null, completedAt, outcome: args.outcome, outputHash, evidenceHash, previousReceiptHash: previous ?? null, failureReason: args.failureReason ?? null };
    const receiptHash = sha256(material);
    const run = this.getRun(receipt.parentRunId)!;
    this.transaction(() => {
      const result = this.database.prepare(`UPDATE graph_child_run_receipts SET status=?,completed_at=?,outcome=?,output_hash=?,evidence_hash=?,previous_receipt_hash=?,receipt_hash=?,failure_reason=? WHERE receipt_id=? AND status IN ('prepared','dispatched','running')`).run(args.status, completedAt, args.outcome, outputHash, evidenceHash, previous ?? null, receiptHash, args.failureReason ?? null, receipt.receiptId);
      if (Number(result.changes) !== 1) throw new Error("child_run_receipt_not_completable");
      this.appendEventUnsafe(run, { type: "child_run_completed", nodeId: receipt.parentNodeId, actor: args.actor ?? "graph-child-run-coordinator", payload: { receiptId: receipt.receiptId, childRunId: receipt.childRunId, status: args.status, outcome: args.outcome, outputHash, evidenceHash, receiptHash, previousReceiptHash: previous ?? null } });
    });
    return this.childRunReceipt(receipt.receiptId)!;
  }

  prepareVerifierReceipt(args: {
    parentRunId: string;
    childReceiptId: string;
    verifierRunId: string;
    verifierTaskType: string;
    verifierAgentId: string;
    authority: GraphRunState["authority"];
    input: Record<string, JsonValue>;
    policyHash: string;
    actor?: string;
  }): VerifierReceipt {
    const existing = this.verifierReceiptForChild(args.childReceiptId);
    if (existing) return existing;
    const child = this.childRunReceipt(args.childReceiptId);
    if (!child?.receiptHash || child.status !== "succeeded") throw new Error("verifier_requires_succeeded_child_receipt");
    if (child.parentRunId !== args.parentRunId) throw new Error("verifier_parent_run_mismatch");
    const childReceiptHash = child.receiptHash;
    const verifierReceiptId = `gvr_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const safeInput = redact(args.input) as Record<string, JsonValue>;
    const verifierInputHash = sha256(safeInput);
    const run = this.getRun(args.parentRunId)!;
    this.transaction(() => {
      this.database.prepare(`INSERT INTO graph_verifier_receipts(verifier_receipt_id,parent_run_id,child_receipt_id,verifier_run_id,verifier_task_type,verifier_agent_id,authority_json,input_json,verifier_input_hash,child_receipt_hash,policy_hash,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'prepared',?)`).run(verifierReceiptId, args.parentRunId, args.childReceiptId, args.verifierRunId, args.verifierTaskType, args.verifierAgentId, canonicalJson(args.authority), canonicalJson(safeInput), verifierInputHash, childReceiptHash, args.policyHash, createdAt);
      this.appendEventUnsafe(run, { type: "verifier_run_prepared", nodeId: child.parentNodeId, actor: args.actor ?? "graph-child-run-coordinator", payload: { verifierReceiptId, childReceiptId: child.receiptId, verifierRunId: args.verifierRunId, verifierInputHash, childReceiptHash, policyHash: args.policyHash } });
    });
    return this.verifierReceipt(verifierReceiptId)!;
  }

  bindVerifierDispatch(verifierReceiptId: string, dispatchTaskId: string, actor = "graph-child-run-coordinator"): VerifierReceipt {
    const receipt = this.verifierReceipt(verifierReceiptId);
    if (!receipt) throw new Error("verifier_receipt_not_found");
    if (receipt.dispatchTaskId && receipt.dispatchTaskId !== dispatchTaskId) throw new Error("verifier_dispatch_binding_mismatch");
    if (!receipt.dispatchTaskId) {
      const child = this.childRunReceipt(receipt.childReceiptId)!;
      const run = this.getRun(receipt.parentRunId)!;
      this.transaction(() => {
        const result = this.database.prepare("UPDATE graph_verifier_receipts SET dispatch_task_id=?,status='dispatched' WHERE verifier_receipt_id=? AND status='prepared' AND dispatch_task_id IS NULL").run(dispatchTaskId, verifierReceiptId);
        if (Number(result.changes) !== 1) throw new Error("verifier_receipt_not_prepared");
        this.appendEventUnsafe(run, { type: "verifier_run_dispatched", nodeId: child.parentNodeId, actor, payload: { verifierReceiptId, verifierRunId: receipt.verifierRunId, dispatchTaskId } });
      });
    }
    return this.verifierReceipt(verifierReceiptId)!;
  }

  markVerifierRunning(verifierReceiptId: string, actor = "graph-child-run-coordinator"): VerifierReceipt {
    const receipt = this.verifierReceipt(verifierReceiptId);
    if (!receipt) throw new Error("verifier_receipt_not_found");
    if (receipt.status === "running") return receipt;
    const startedAt = new Date().toISOString();
    const child = this.childRunReceipt(receipt.childReceiptId)!;
    const run = this.getRun(receipt.parentRunId)!;
    this.transaction(() => {
      const result = this.database.prepare("UPDATE graph_verifier_receipts SET status='running',started_at=? WHERE verifier_receipt_id=? AND status='dispatched'").run(startedAt, verifierReceiptId);
      if (Number(result.changes) !== 1) throw new Error("verifier_receipt_not_dispatched");
      this.appendEventUnsafe(run, { type: "verifier_run_started", nodeId: child.parentNodeId, actor, payload: { verifierReceiptId, verifierRunId: receipt.verifierRunId } });
    });
    return this.verifierReceipt(verifierReceiptId)!;
  }

  completeVerifierReceipt(args: { verifierReceiptId: string; status: "passed" | "failed" | "blocked"; outcome: string; evidence: unknown; failureReason?: string; actor?: string }): VerifierReceipt {
    const receipt = this.verifierReceipt(args.verifierReceiptId);
    if (!receipt) throw new Error("verifier_receipt_not_found");
    if (["passed", "failed", "blocked"].includes(receipt.status)) return receipt;
    const completedAt = new Date().toISOString();
    const evidenceHash = sha256(redact(args.evidence));
    const material = { verifierReceiptId: receipt.verifierReceiptId, parentRunId: receipt.parentRunId, childReceiptId: receipt.childReceiptId, verifierRunId: receipt.verifierRunId, dispatchTaskId: receipt.dispatchTaskId ?? null, verifierTaskType: receipt.verifierTaskType, verifierAgentId: receipt.verifierAgentId, authority: receipt.authority, verifierInputHash: receipt.verifierInputHash, childReceiptHash: receipt.childReceiptHash, policyHash: receipt.policyHash, status: args.status, createdAt: receipt.createdAt, startedAt: receipt.startedAt ?? null, completedAt, outcome: args.outcome, evidenceHash, failureReason: args.failureReason ?? null };
    const receiptHash = sha256(material);
    const child = this.childRunReceipt(receipt.childReceiptId)!;
    const run = this.getRun(receipt.parentRunId)!;
    this.transaction(() => {
      const result = this.database.prepare("UPDATE graph_verifier_receipts SET status=?,completed_at=?,outcome=?,evidence_hash=?,receipt_hash=?,failure_reason=? WHERE verifier_receipt_id=? AND status IN ('prepared','dispatched','running')").run(args.status, completedAt, args.outcome, evidenceHash, receiptHash, args.failureReason ?? null, receipt.verifierReceiptId);
      if (Number(result.changes) !== 1) throw new Error("verifier_receipt_not_completable");
      this.appendEventUnsafe(run, { type: "verifier_run_completed", nodeId: child.parentNodeId, actor: args.actor ?? "graph-child-run-coordinator", payload: { verifierReceiptId: receipt.verifierReceiptId, childReceiptId: receipt.childReceiptId, verifierRunId: receipt.verifierRunId, status: args.status, outcome: args.outcome, evidenceHash, receiptHash } });
    });
    return this.verifierReceipt(receipt.verifierReceiptId)!;
  }

  childRunReceipt(receiptId: string): ChildRunReceipt | null {
    const row = this.database.prepare("SELECT * FROM graph_child_run_receipts WHERE receipt_id=?").get(receiptId) as Record<string, unknown> | undefined;
    return row ? this.mapChildRunReceipt(row) : null;
  }

  childRunReceiptByIdempotencyKey(key: string): ChildRunReceipt | null {
    const row = this.database.prepare("SELECT * FROM graph_child_run_receipts WHERE idempotency_key=?").get(key) as Record<string, unknown> | undefined;
    return row ? this.mapChildRunReceipt(row) : null;
  }

  childRunReceipts(parentRunId?: string): ChildRunReceipt[] {
    const rows = parentRunId
      ? this.database.prepare("SELECT * FROM graph_child_run_receipts WHERE parent_run_id=? ORDER BY created_at,receipt_id").all(parentRunId)
      : this.database.prepare("SELECT * FROM graph_child_run_receipts ORDER BY created_at,receipt_id").all();
    return (rows as Record<string, unknown>[]).map((row) => this.mapChildRunReceipt(row));
  }

  verifierReceipt(verifierReceiptId: string): VerifierReceipt | null {
    const row = this.database.prepare("SELECT * FROM graph_verifier_receipts WHERE verifier_receipt_id=?").get(verifierReceiptId) as Record<string, unknown> | undefined;
    return row ? this.mapVerifierReceipt(row) : null;
  }

  verifierReceiptForChild(childReceiptId: string): VerifierReceipt | null {
    const row = this.database.prepare("SELECT * FROM graph_verifier_receipts WHERE child_receipt_id=?").get(childReceiptId) as Record<string, unknown> | undefined;
    return row ? this.mapVerifierReceipt(row) : null;
  }

  verifierReceipts(parentRunId?: string): VerifierReceipt[] {
    const rows = parentRunId
      ? this.database.prepare("SELECT * FROM graph_verifier_receipts WHERE parent_run_id=? ORDER BY created_at,verifier_receipt_id").all(parentRunId)
      : this.database.prepare("SELECT * FROM graph_verifier_receipts ORDER BY created_at,verifier_receipt_id").all();
    return (rows as Record<string, unknown>[]).map((row) => this.mapVerifierReceipt(row));
  }

  verifyChildRunReceiptChain(parentRunId: string): boolean {
    let previous: string | null = null;
    const receipts = this.childRunReceipts(parentRunId).filter((receipt) => receipt.receiptHash).sort((left, right) => `${left.completedAt}:${left.receiptId}`.localeCompare(`${right.completedAt}:${right.receiptId}`));
    for (const receipt of receipts) {
      if ((receipt.previousReceiptHash ?? null) !== previous) return false;
      const material = { receiptId: receipt.receiptId, parentRunId: receipt.parentRunId, parentNodeId: receipt.parentNodeId, parentAttemptId: receipt.parentAttemptId, idempotencyKey: receipt.idempotencyKey, childRunId: receipt.childRunId, dispatchTaskId: receipt.dispatchTaskId ?? null, childTaskType: receipt.childTaskType, childAgentId: receipt.childAgentId, authority: receipt.authority, inputHash: receipt.inputHash, policyHash: receipt.policyHash, status: receipt.status, createdAt: receipt.createdAt, startedAt: receipt.startedAt ?? null, completedAt: receipt.completedAt, outcome: receipt.outcome, outputHash: receipt.outputHash, evidenceHash: receipt.evidenceHash, previousReceiptHash: receipt.previousReceiptHash ?? null, failureReason: receipt.failureReason ?? null };
      if (sha256(material) !== receipt.receiptHash) return false;
      previous = receipt.receiptHash!;
    }
    for (const verifier of this.verifierReceipts(parentRunId).filter((receipt) => receipt.receiptHash)) {
      const child = this.childRunReceipt(verifier.childReceiptId);
      if (!child?.receiptHash || child.receiptHash !== verifier.childReceiptHash) return false;
      const material = { verifierReceiptId: verifier.verifierReceiptId, parentRunId: verifier.parentRunId, childReceiptId: verifier.childReceiptId, verifierRunId: verifier.verifierRunId, dispatchTaskId: verifier.dispatchTaskId ?? null, verifierTaskType: verifier.verifierTaskType, verifierAgentId: verifier.verifierAgentId, authority: verifier.authority, verifierInputHash: verifier.verifierInputHash, childReceiptHash: verifier.childReceiptHash, policyHash: verifier.policyHash, status: verifier.status, createdAt: verifier.createdAt, startedAt: verifier.startedAt ?? null, completedAt: verifier.completedAt, outcome: verifier.outcome, evidenceHash: verifier.evidenceHash, failureReason: verifier.failureReason ?? null };
      if (sha256(material) !== verifier.receiptHash) return false;
    }
    return this.verifyEventChain(parentRunId);
  }

  private mapChildRunReceipt(row: Record<string, unknown>): ChildRunReceipt {
    return { receiptId: String(row.receipt_id), parentRunId: String(row.parent_run_id), parentNodeId: String(row.parent_node_id), parentAttemptId: String(row.parent_attempt_id), idempotencyKey: String(row.idempotency_key), childRunId: String(row.child_run_id), dispatchTaskId: row.dispatch_task_id === null ? undefined : String(row.dispatch_task_id), childTaskType: String(row.child_task_type), childAgentId: String(row.child_agent_id), authority: json<GraphRunState["authority"]>(String(row.authority_json)), input: json<Record<string, JsonValue>>(String(row.input_json)), inputHash: String(row.input_hash), policyHash: String(row.policy_hash), status: String(row.status) as ChildRunReceipt["status"], createdAt: String(row.created_at), startedAt: row.started_at === null ? undefined : String(row.started_at), completedAt: row.completed_at === null ? undefined : String(row.completed_at), outcome: row.outcome === null ? undefined : String(row.outcome), outputHash: row.output_hash === null ? undefined : String(row.output_hash), evidenceHash: row.evidence_hash === null ? undefined : String(row.evidence_hash), previousReceiptHash: row.previous_receipt_hash === null ? undefined : String(row.previous_receipt_hash), receiptHash: row.receipt_hash === null ? undefined : String(row.receipt_hash), failureReason: row.failure_reason === null ? undefined : String(row.failure_reason) };
  }

  private mapVerifierReceipt(row: Record<string, unknown>): VerifierReceipt {
    return { verifierReceiptId: String(row.verifier_receipt_id), parentRunId: String(row.parent_run_id), childReceiptId: String(row.child_receipt_id), verifierRunId: String(row.verifier_run_id), dispatchTaskId: row.dispatch_task_id === null ? undefined : String(row.dispatch_task_id), verifierTaskType: String(row.verifier_task_type), verifierAgentId: String(row.verifier_agent_id), authority: json<GraphRunState["authority"]>(String(row.authority_json)), input: json<Record<string, JsonValue>>(String(row.input_json)), verifierInputHash: String(row.verifier_input_hash), childReceiptHash: String(row.child_receipt_hash), policyHash: String(row.policy_hash), status: String(row.status) as VerifierReceipt["status"], createdAt: String(row.created_at), startedAt: row.started_at === null ? undefined : String(row.started_at), completedAt: row.completed_at === null ? undefined : String(row.completed_at), outcome: row.outcome === null ? undefined : String(row.outcome), evidenceHash: row.evidence_hash === null ? undefined : String(row.evidence_hash), receiptHash: row.receipt_hash === null ? undefined : String(row.receipt_hash), failureReason: row.failure_reason === null ? undefined : String(row.failure_reason) };
  }

  schemaVersion(): number {
    const row = this.database.prepare("SELECT schema_version FROM graph_schema_meta WHERE schema_name='openclaw-graph-kernel'").get() as { schema_version: number };
    return Number(row.schema_version);
  }
}
