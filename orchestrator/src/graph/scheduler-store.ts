import { chmodSync, existsSync, lstatSync, mkdirSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type SqliteDatabase = InstanceType<typeof DatabaseSync>;

export const GRAPH_SCHEDULER_SCHEMA_VERSION = 1;
export const PHASE_G_MIGRATION_ID = "phase-g-instagram-image-v1";
export const PHASE_G_SCHEDULE_ID = "24afbb84-457c-41bb-92c9-24a19725e984";
export const PHASE_G_DECLARATION_KEY = "instagram-single-image-feed-daily-v1";
export const PHASE_G_GRAPH_ID = "deterministic-social-publication";
export const PHASE_G_GRAPH_VERSION = "2.0.0";
export const PHASE_G_GRAPH_DEFINITION_HASH = "995ff8355a57113884129b7cda9f7966d4719163f9b9b81ed77e87d12c6a3473";
export const PHASE_G_GRAPH_NAMESPACE = "production.instagram.single-image-feed";
export const PHASE_G_PROVIDER = "instagram";
export const PHASE_G_ACCOUNT_ID = "17841453638630920";

export type GraphSchedulerMigrationStatus = "prepared" | "graph_owned" | "rolled_back" | "blocked";
export type GraphSchedulerTriggerStatus = "reserved" | "preparing" | "executing" | "completed" | "failed_safe" | "ambiguous";

export type GraphSchedulerMigration = {
  migrationId: string;
  scheduleId: string;
  declarationKey: string;
  status: GraphSchedulerMigrationStatus;
  graphId: string;
  graphVersion: string;
  graphDefinitionHash: string;
  graphNamespace: string;
  provider: string;
  accountId: string;
  cronExpression: string;
  timezone: string;
  legacyJobDigest: string;
  legacyJob: Record<string, unknown>;
  graphJobDigest: string;
  graphJob: Record<string, unknown>;
  preparedAt: string;
  activatedAt?: string;
  rolledBackAt?: string;
  updatedAt: string;
  actor: string;
  failureReason?: string;
};

export type GraphSchedulerMigrationDeclaration = {
  migrationId: string;
  scheduleId: string;
  declarationKey: string;
  graphId: string;
  graphVersion: string;
  graphDefinitionHash: string;
  graphNamespace: string;
  provider: string;
  accountId: string;
  cronExpression: string;
  timezone: string;
};

export type GraphSchedulerTrigger = {
  triggerId: string;
  migrationId: string;
  slotId: string;
  scheduledFor: string;
  status: GraphSchedulerTriggerStatus;
  graphRunId?: string;
  approvalId?: string;
  capabilityId?: string;
  providerObjectId?: string;
  permalink?: string;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failureReason?: string;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function graphSchedulerDigest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function secure(path: string): void {
  if (!existsSync(path)) return;
  const before = lstatSync(path);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error("graph_scheduler_database_not_regular");
  if (typeof process.getuid === "function" && before.uid !== process.getuid()) throw new Error("graph_scheduler_database_owner_mismatch");
  if ((before.mode & 0o777) !== 0o600) chmodSync(path, 0o600);
  if ((statSync(path).mode & 0o777) !== 0o600) throw new Error("graph_scheduler_database_mode_not_owner_only");
}

function open(path: string): SqliteDatabase {
  let prior: number | null = null;
  try { prior = process.umask(0o077); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ERR_WORKER_UNSUPPORTED_OPERATION") throw error;
  }
  try { return new DatabaseSync(path); } finally { if (prior !== null) process.umask(prior); }
}

function text(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

export function resolveGraphSchedulerDatabasePath(): string {
  const configured = process.env.OPENCLAW_GRAPH_SCHEDULER_DATABASE_PATH?.trim();
  if (configured) return configured;
  const root = process.env.OPENCLAW_OPERATOR_STATE_DIR?.trim();
  return root ? join(root, "database", "graph-scheduler.sqlite") : join(process.cwd(), "data", "graph-scheduler.sqlite");
}

export class GraphSchedulerStore {
  readonly path: string;
  private readonly database: SqliteDatabase;

  constructor(path = resolveGraphSchedulerDatabasePath()) {
    this.path = path;
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("graph_scheduler_database_symlink_rejected");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = open(path);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.migrate();
    secure(path);
  }

  close(): void {
    this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.database.close();
    secure(this.path);
  }

  private migrate(): void {
    const userVersion = Number((this.database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
    if (userVersion > GRAPH_SCHEDULER_SCHEMA_VERSION) throw new Error("graph_scheduler_schema_future_version");
    if (userVersion === GRAPH_SCHEDULER_SCHEMA_VERSION) return this.verify();
    if (userVersion !== 0) throw new Error("graph_scheduler_schema_unknown_version");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.exec(`
        CREATE TABLE graph_scheduler_schema_meta(
          schema_version INTEGER NOT NULL,
          migration_id TEXT NOT NULL,
          migration_checksum TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE graph_scheduler_migrations(
          migration_id TEXT PRIMARY KEY,
          schedule_id TEXT NOT NULL UNIQUE,
          declaration_key TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK(status IN ('prepared','graph_owned','rolled_back','blocked')),
          graph_id TEXT NOT NULL,
          graph_version TEXT NOT NULL,
          graph_definition_hash TEXT NOT NULL,
          graph_namespace TEXT NOT NULL,
          provider TEXT NOT NULL,
          account_id TEXT NOT NULL,
          cron_expression TEXT NOT NULL,
          timezone TEXT NOT NULL,
          legacy_job_digest TEXT NOT NULL,
          legacy_job_json TEXT NOT NULL,
          graph_job_digest TEXT NOT NULL,
          graph_job_json TEXT NOT NULL,
          prepared_at TEXT NOT NULL,
          activated_at TEXT,
          rolled_back_at TEXT,
          updated_at TEXT NOT NULL,
          actor TEXT NOT NULL,
          failure_reason TEXT
        );
        CREATE TABLE graph_scheduler_triggers(
          trigger_id TEXT PRIMARY KEY,
          migration_id TEXT NOT NULL,
          slot_id TEXT NOT NULL UNIQUE,
          scheduled_for TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('reserved','preparing','executing','completed','failed_safe','ambiguous')),
          graph_run_id TEXT UNIQUE,
          approval_id TEXT,
          capability_id TEXT,
          provider_object_id TEXT,
          permalink TEXT,
          attempt_count INTEGER NOT NULL CHECK(attempt_count > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          failure_reason TEXT,
          FOREIGN KEY(migration_id) REFERENCES graph_scheduler_migrations(migration_id)
        );
        CREATE TABLE graph_scheduler_events(
          event_id TEXT PRIMARY KEY,
          migration_id TEXT NOT NULL,
          trigger_id TEXT,
          sequence INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          actor TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          previous_hash TEXT,
          event_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(migration_id, sequence),
          FOREIGN KEY(migration_id) REFERENCES graph_scheduler_migrations(migration_id)
        );
        CREATE INDEX graph_scheduler_triggers_status_idx ON graph_scheduler_triggers(migration_id,status,scheduled_for);
        CREATE INDEX graph_scheduler_events_migration_idx ON graph_scheduler_events(migration_id,sequence);
        CREATE TRIGGER graph_scheduler_binding_immutable
        BEFORE UPDATE OF schedule_id,declaration_key,graph_id,graph_version,graph_definition_hash,graph_namespace,provider,account_id,cron_expression,timezone,legacy_job_digest,legacy_job_json,graph_job_digest,graph_job_json,prepared_at
        ON graph_scheduler_migrations
        BEGIN SELECT RAISE(ABORT, 'graph scheduler migration bindings are immutable'); END;
      `);
      const migrationId = "graph-scheduler-schema-v1";
      const checksum = graphSchedulerDigest({ migrationId, version: GRAPH_SCHEDULER_SCHEMA_VERSION });
      this.database.prepare("INSERT INTO graph_scheduler_schema_meta VALUES(?,?,?,?)").run(GRAPH_SCHEDULER_SCHEMA_VERSION, migrationId, checksum, new Date().toISOString());
      this.database.exec(`PRAGMA user_version=${GRAPH_SCHEDULER_SCHEMA_VERSION}`);
      this.database.exec("COMMIT");
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* original error is authoritative */ }
      throw error;
    }
    this.verify();
  }

  verify(): void {
    const integrity = this.database.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") throw new Error("graph_scheduler_integrity_failed");
    const foreignKeys = this.database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.length) throw new Error("graph_scheduler_foreign_key_failed");
    const meta = this.database.prepare("SELECT * FROM graph_scheduler_schema_meta").get() as Record<string, unknown> | undefined;
    const checksum = graphSchedulerDigest({ migrationId: "graph-scheduler-schema-v1", version: GRAPH_SCHEDULER_SCHEMA_VERSION });
    if (Number(meta?.schema_version) !== GRAPH_SCHEDULER_SCHEMA_VERSION || meta?.migration_id !== "graph-scheduler-schema-v1" || meta?.migration_checksum !== checksum) throw new Error("graph_scheduler_schema_metadata_mismatch");
    const names = new Set((this.database.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index','trigger')").all() as Array<{ name: string }>).map((row) => row.name));
    for (const name of ["graph_scheduler_schema_meta","graph_scheduler_migrations","graph_scheduler_triggers","graph_scheduler_events","graph_scheduler_triggers_status_idx","graph_scheduler_events_migration_idx","graph_scheduler_binding_immutable"]) if (!names.has(name)) throw new Error(`graph_scheduler_schema_object_missing:${name}`);
  }

  prepareMigration(args: { legacyJob: Record<string, unknown>; graphJob: Record<string, unknown>; actor: string; now?: Date }): GraphSchedulerMigration {
    return this.prepareBoundedMigration({
      ...args,
      declaration: {
        migrationId: PHASE_G_MIGRATION_ID, scheduleId: PHASE_G_SCHEDULE_ID, declarationKey: PHASE_G_DECLARATION_KEY,
        graphId: PHASE_G_GRAPH_ID, graphVersion: PHASE_G_GRAPH_VERSION, graphDefinitionHash: PHASE_G_GRAPH_DEFINITION_HASH,
        graphNamespace: PHASE_G_GRAPH_NAMESPACE, provider: PHASE_G_PROVIDER, accountId: PHASE_G_ACCOUNT_ID,
        cronExpression: "0 5,7,9,11,13 * * *", timezone: "Europe/London",
      },
      triggerScriptBasename: "trigger-governed-graph-schedule.ts",
    });
  }

  prepareBoundedMigration(args: { legacyJob: Record<string, unknown>; graphJob: Record<string, unknown>; declaration: GraphSchedulerMigrationDeclaration; actor: string; now?: Date; triggerScriptBasename?: string }): GraphSchedulerMigration {
    const legacy = args.legacyJob;
    const graph = args.graphJob;
    const declaration = args.declaration;
    for (const [field, value] of Object.entries(declaration)) {
      if (typeof value !== "string" || !value.trim() || (field !== "cronExpression" && value.includes("*"))) throw new Error(`graph_scheduler_declaration_invalid:${field}`);
    }
    if (!/^[a-f0-9]{64}$/.test(declaration.graphDefinitionHash)) throw new Error("graph_scheduler_definition_hash_invalid");
    if (legacy.id !== declaration.scheduleId || legacy.declarationKey !== declaration.declarationKey) throw new Error("graph_scheduler_legacy_job_binding_mismatch");
    const legacySchedule = legacy.schedule as Record<string, unknown> | undefined;
    if (legacySchedule?.kind !== "cron" || legacySchedule?.expr !== declaration.cronExpression || legacySchedule?.tz !== declaration.timezone) throw new Error("graph_scheduler_legacy_schedule_mismatch");
    const graphPayload = graph.payload as Record<string, unknown> | undefined;
    const argv = graphPayload?.argv;
    const trigger = graph.graphTrigger as Record<string, unknown> | undefined;
    if (graph.id !== declaration.scheduleId || graph.declarationKey !== declaration.declarationKey || !Array.isArray(argv) || argv.at(-1) !== declaration.migrationId || String(argv.at(-2)) !== "--migration-id") throw new Error("graph_scheduler_graph_job_binding_mismatch");
    const triggerScriptBasename = args.triggerScriptBasename ?? "trigger-governed-graph-schedule.ts";
    if (String(argv[1]) !== "--import" || String(argv[2]) !== "tsx" || !String(argv[3]).endsWith(`/orchestrator/scripts/${triggerScriptBasename}`)) throw new Error("graph_scheduler_trigger_command_not_allowlisted");
    if (!trigger || trigger.graphId !== declaration.graphId || trigger.graphVersion !== declaration.graphVersion || trigger.definitionHash !== declaration.graphDefinitionHash || !trigger.input || typeof trigger.input !== "object" || !trigger.authority || typeof trigger.authority !== "object") throw new Error("graph_scheduler_graph_trigger_contract_mismatch");
    const now = args.now ?? new Date();
    const record: GraphSchedulerMigration = {
      ...declaration,
      status: "prepared",
      legacyJobDigest: graphSchedulerDigest(legacy), legacyJob: legacy,
      graphJobDigest: graphSchedulerDigest(graph), graphJob: graph,
      preparedAt: now.toISOString(), updatedAt: now.toISOString(), actor: args.actor,
    };
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`INSERT INTO graph_scheduler_migrations(
        migration_id,schedule_id,declaration_key,status,graph_id,graph_version,graph_definition_hash,graph_namespace,provider,account_id,cron_expression,timezone,legacy_job_digest,legacy_job_json,graph_job_digest,graph_job_json,prepared_at,updated_at,actor
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        record.migrationId,record.scheduleId,record.declarationKey,record.status,record.graphId,record.graphVersion,record.graphDefinitionHash,record.graphNamespace,record.provider,record.accountId,record.cronExpression,record.timezone,record.legacyJobDigest,canonical(record.legacyJob),record.graphJobDigest,canonical(record.graphJob),record.preparedAt,record.updatedAt,record.actor,
      );
      this.appendEventUnsafe(record.migrationId, undefined, "migration_prepared", args.actor, { legacyJobDigest: record.legacyJobDigest, graphJobDigest: record.graphJobDigest });
      this.database.exec("COMMIT");
    } catch (error) { try { this.database.exec("ROLLBACK"); } catch {} throw error; }
    return this.migration(record.migrationId)!;
  }

  activateMigration(migrationId: string, actor: string, now = new Date()): GraphSchedulerMigration {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare("UPDATE graph_scheduler_migrations SET status='graph_owned',activated_at=?,updated_at=?,actor=? WHERE migration_id=? AND status='prepared'").run(now.toISOString(), now.toISOString(), actor, migrationId);
      if (Number(result.changes) !== 1) throw new Error("graph_scheduler_migration_not_prepared");
      this.appendEventUnsafe(migrationId, undefined, "ownership_transferred_to_graph", actor, { activatedAt: now.toISOString() });
      this.database.exec("COMMIT");
    } catch (error) { try { this.database.exec("ROLLBACK"); } catch {} throw error; }
    return this.migration(migrationId)!;
  }

  rollbackMigration(migrationId: string, actor: string, reason: string, now = new Date()): GraphSchedulerMigration {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const active = this.database.prepare("SELECT COUNT(*) AS count FROM graph_scheduler_triggers WHERE migration_id=? AND status IN ('reserved','preparing','executing','ambiguous')").get(migrationId) as { count: number };
      if (Number(active.count) !== 0) throw new Error("graph_scheduler_rollback_active_trigger");
      const result = this.database.prepare("UPDATE graph_scheduler_migrations SET status='rolled_back',rolled_back_at=?,updated_at=?,actor=?,failure_reason=? WHERE migration_id=? AND status='graph_owned'").run(now.toISOString(), now.toISOString(), actor, reason, migrationId);
      if (Number(result.changes) !== 1) throw new Error("graph_scheduler_migration_not_graph_owned");
      this.appendEventUnsafe(migrationId, undefined, "ownership_rolled_back_to_legacy", actor, { reason });
      this.database.exec("COMMIT");
    } catch (error) { try { this.database.exec("ROLLBACK"); } catch {} throw error; }
    return this.migration(migrationId)!;
  }

  reserveTrigger(migrationId: string, slotId: string, scheduledFor: string, actor: string, now = new Date()): { trigger: GraphSchedulerTrigger; created: boolean } {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const migration = this.database.prepare("SELECT status FROM graph_scheduler_migrations WHERE migration_id=?").get(migrationId) as { status?: string } | undefined;
      if (migration?.status !== "graph_owned") throw new Error("graph_scheduler_migration_not_graph_owned");
      const existing = this.database.prepare("SELECT trigger_id FROM graph_scheduler_triggers WHERE slot_id=?").get(slotId) as { trigger_id?: string } | undefined;
      if (existing?.trigger_id) {
        this.database.exec("COMMIT");
        return { trigger: this.trigger(existing.trigger_id)!, created: false };
      }
      const triggerId = `gst_${graphSchedulerDigest({ migrationId, slotId, nonce: randomUUID() }).slice(0, 32)}`;
      this.database.prepare("INSERT INTO graph_scheduler_triggers(trigger_id,migration_id,slot_id,scheduled_for,status,attempt_count,created_at,updated_at) VALUES(?,?,?,?, 'reserved',1,?,?)").run(triggerId,migrationId,slotId,scheduledFor,now.toISOString(),now.toISOString());
      this.appendEventUnsafe(migrationId, triggerId, "trigger_reserved", actor, { slotId, scheduledFor });
      this.database.exec("COMMIT");
      return { trigger: this.trigger(triggerId)!, created: true };
    } catch (error) { try { this.database.exec("ROLLBACK"); } catch {} throw error; }
  }

  updateTrigger(triggerId: string, status: GraphSchedulerTriggerStatus, actor: string, fields: Partial<Pick<GraphSchedulerTrigger,"graphRunId"|"approvalId"|"capabilityId"|"providerObjectId"|"permalink"|"failureReason">> = {}, now = new Date()): GraphSchedulerTrigger {
    const current = this.trigger(triggerId);
    if (!current) throw new Error("graph_scheduler_trigger_not_found");
    const allowed: Record<GraphSchedulerTriggerStatus, GraphSchedulerTriggerStatus[]> = {
      reserved: ["reserved","preparing","failed_safe"], preparing: ["preparing","executing","failed_safe","ambiguous"], executing: ["executing","completed","failed_safe","ambiguous"], completed: ["completed"], failed_safe: ["failed_safe","preparing"], ambiguous: ["ambiguous","completed","preparing"],
    };
    if (!allowed[current.status].includes(status)) throw new Error(`graph_scheduler_trigger_transition_forbidden:${current.status}:${status}`);
    const merged = {
      ...current,
      ...fields,
      status,
      failureReason:
        status === "completed" && !Object.prototype.hasOwnProperty.call(fields, "failureReason")
          ? undefined
          : Object.prototype.hasOwnProperty.call(fields, "failureReason")
            ? fields.failureReason
            : current.failureReason,
      attemptCount: ["failed_safe","ambiguous"].includes(current.status) && status === "preparing"
        ? current.attemptCount + 1
        : current.attemptCount,
      updatedAt: now.toISOString(),
      completedAt: status === "completed" ? now.toISOString() : current.completedAt,
    };
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE graph_scheduler_triggers SET status=?,graph_run_id=?,approval_id=?,capability_id=?,provider_object_id=?,permalink=?,attempt_count=?,updated_at=?,completed_at=?,failure_reason=? WHERE trigger_id=?`).run(
        merged.status,merged.graphRunId ?? null,merged.approvalId ?? null,merged.capabilityId ?? null,merged.providerObjectId ?? null,merged.permalink ?? null,merged.attemptCount,merged.updatedAt,merged.completedAt ?? null,merged.failureReason ?? null,triggerId,
      );
      this.appendEventUnsafe(current.migrationId, triggerId, `trigger_${status}`, actor, { graphRunId: merged.graphRunId ?? null, approvalId: merged.approvalId ?? null, capabilityId: merged.capabilityId ?? null, providerObjectId: merged.providerObjectId ?? null, attemptCount: merged.attemptCount, failureReason: merged.failureReason ?? null });
      this.database.exec("COMMIT");
    } catch (error) { try { this.database.exec("ROLLBACK"); } catch {} throw error; }
    return this.trigger(triggerId)!;
  }

  migration(migrationId: string): GraphSchedulerMigration | null {
    const row = this.database.prepare("SELECT * FROM graph_scheduler_migrations WHERE migration_id=?").get(migrationId) as Record<string, unknown> | undefined;
    return row ? this.mapMigration(row) : null;
  }

  migrations(): GraphSchedulerMigration[] {
    return (this.database.prepare("SELECT * FROM graph_scheduler_migrations ORDER BY prepared_at").all() as Array<Record<string, unknown>>).map((row) => this.mapMigration(row));
  }

  trigger(triggerId: string): GraphSchedulerTrigger | null {
    const row = this.database.prepare("SELECT * FROM graph_scheduler_triggers WHERE trigger_id=?").get(triggerId) as Record<string, unknown> | undefined;
    return row ? this.mapTrigger(row) : null;
  }

  triggers(migrationId?: string): GraphSchedulerTrigger[] {
    const rows = migrationId ? this.database.prepare("SELECT * FROM graph_scheduler_triggers WHERE migration_id=? ORDER BY scheduled_for").all(migrationId) : this.database.prepare("SELECT * FROM graph_scheduler_triggers ORDER BY scheduled_for").all();
    return (rows as Array<Record<string, unknown>>).map((row) => this.mapTrigger(row));
  }

  eventChainValid(migrationId: string): boolean {
    const rows = this.database.prepare("SELECT sequence,event_type,actor,payload_json,previous_hash,event_hash,created_at,trigger_id FROM graph_scheduler_events WHERE migration_id=? ORDER BY sequence").all(migrationId) as Array<Record<string, unknown>>;
    let previous: string | null = null;
    for (const row of rows) {
      if ((row.previous_hash ?? null) !== previous) return false;
      const material = { migrationId, triggerId: row.trigger_id ?? null, sequence: Number(row.sequence), eventType: String(row.event_type), actor: String(row.actor), payload: JSON.parse(String(row.payload_json)), previousHash: previous, createdAt: String(row.created_at) };
      if (graphSchedulerDigest(material) !== row.event_hash) return false;
      previous = String(row.event_hash);
    }
    return true;
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const row of this.database.prepare("SELECT status,COUNT(*) AS count FROM graph_scheduler_triggers GROUP BY status").all() as Array<{ status: string; count: number }>) out[row.status] = Number(row.count);
    return out;
  }

  private appendEventUnsafe(migrationId: string, triggerId: string | undefined, eventType: string, actor: string, payload: Record<string, unknown>): void {
    const prior = this.database.prepare("SELECT sequence,event_hash FROM graph_scheduler_events WHERE migration_id=? ORDER BY sequence DESC LIMIT 1").get(migrationId) as { sequence?: number; event_hash?: string } | undefined;
    const sequence = Number(prior?.sequence ?? 0) + 1;
    const createdAt = new Date().toISOString();
    const previousHash = prior?.event_hash ?? null;
    const material = { migrationId, triggerId: triggerId ?? null, sequence, eventType, actor, payload, previousHash, createdAt };
    const eventHash = graphSchedulerDigest(material);
    this.database.prepare("INSERT INTO graph_scheduler_events VALUES(?,?,?,?,?,?,?,?,?,?)").run(randomUUID(),migrationId,triggerId ?? null,sequence,eventType,actor,canonical(payload),previousHash,eventHash,createdAt);
  }

  private mapMigration(row: Record<string, unknown>): GraphSchedulerMigration {
    return {
      migrationId:String(row.migration_id),scheduleId:String(row.schedule_id),declarationKey:String(row.declaration_key),status:String(row.status) as GraphSchedulerMigrationStatus,
      graphId:String(row.graph_id),graphVersion:String(row.graph_version),graphDefinitionHash:String(row.graph_definition_hash),graphNamespace:String(row.graph_namespace),provider:String(row.provider),accountId:String(row.account_id),cronExpression:String(row.cron_expression),timezone:String(row.timezone),
      legacyJobDigest:String(row.legacy_job_digest),legacyJob:JSON.parse(String(row.legacy_job_json)),graphJobDigest:String(row.graph_job_digest),graphJob:JSON.parse(String(row.graph_job_json)),preparedAt:String(row.prepared_at),activatedAt:text(row.activated_at),rolledBackAt:text(row.rolled_back_at),updatedAt:String(row.updated_at),actor:String(row.actor),failureReason:text(row.failure_reason),
    };
  }

  private mapTrigger(row: Record<string, unknown>): GraphSchedulerTrigger {
    return { triggerId:String(row.trigger_id),migrationId:String(row.migration_id),slotId:String(row.slot_id),scheduledFor:String(row.scheduled_for),status:String(row.status) as GraphSchedulerTriggerStatus,graphRunId:text(row.graph_run_id),approvalId:text(row.approval_id),capabilityId:text(row.capability_id),providerObjectId:text(row.provider_object_id),permalink:text(row.permalink),attemptCount:Number(row.attempt_count),createdAt:String(row.created_at),updatedAt:String(row.updated_at),completedAt:text(row.completed_at),failureReason:text(row.failure_reason) };
  }
}
