import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { canonicalJson, sha256 } from "./canonical.js";
import { assertPublicationTransition } from "./state-machine.js";
import type {
  ContentSpec,
  PlatformId,
  PublicationState,
  PublishingCandidate,
  PublishingRegistryBundle,
  SlotResult,
  ValidationResult,
} from "./types.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type SqliteDatabase = InstanceType<typeof DatabaseSync>;

const REGISTRY_TABLES = {
  products: "publishing_products",
  campaigns: "publishing_campaigns",
  audiences: "publishing_audiences",
  identitySignals: "publishing_identity_signals",
  problemsOutcomes: "publishing_problems_outcomes",
  contentStrategies: "publishing_content_strategies",
  claims: "publishing_claims",
  evidence: "publishing_evidence",
  assets: "publishing_assets",
  ctas: "publishing_ctas",
  platformPolicies: "publishing_platform_policies",
  schedules: "publishing_schedules",
  templates: "publishing_templates",
  prompts: "publishing_prompts",
  experiments: "publishing_experiments",
  approvals: "publishing_approvals",
  metricDefinitions: "publishing_metric_definitions",
  attributionDefinitions: "publishing_attribution_definitions",
} as const;

type RegistryKey = keyof typeof REGISTRY_TABLES;

function configure(database: SqliteDatabase): void {
  database.exec("PRAGMA journal_mode=WAL");
  database.exec("PRAGMA synchronous=FULL");
  database.exec("PRAGMA foreign_keys=ON");
  database.exec("PRAGMA busy_timeout=5000");
}

function createSchema(database: SqliteDatabase): void {
  configure(database);
  database.exec(`
    CREATE TABLE IF NOT EXISTS publishing_schema_meta (
      schema_name TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      registry_version TEXT,
      registry_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  for (const table of Object.values(REGISTRY_TABLES)) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        status TEXT NOT NULL,
        approval_id TEXT,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_${table}_status ON ${table}(status);
    `);
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS publishing_slot_runs (
      id TEXT PRIMARY KEY,
      slot_key TEXT NOT NULL UNIQUE,
      platform_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      result TEXT,
      selected_candidate_json TEXT,
      content_spec_id TEXT,
      reasons_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS publishing_content_specs (
      id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL UNIQUE,
      slot_key TEXT NOT NULL UNIQUE,
      product_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      platform_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      state TEXT NOT NULL,
      spec_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES publishing_products(id),
      FOREIGN KEY(campaign_id) REFERENCES publishing_campaigns(id)
    );
    CREATE INDEX IF NOT EXISTS idx_publishing_specs_campaign ON publishing_content_specs(campaign_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_publishing_specs_product ON publishing_content_specs(product_id, created_at DESC);

    CREATE TRIGGER IF NOT EXISTS publishing_content_specs_immutable_update
    BEFORE UPDATE ON publishing_content_specs
    BEGIN SELECT RAISE(ABORT, 'publishing content specs are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS publishing_content_specs_immutable_delete
    BEFORE DELETE ON publishing_content_specs
    BEGIN SELECT RAISE(ABORT, 'publishing content specs are immutable'); END;

    CREATE TABLE IF NOT EXISTS publishing_rendered_candidates (
      id TEXT PRIMARY KEY,
      content_spec_id TEXT NOT NULL,
      renderer_id TEXT NOT NULL,
      renderer_version TEXT NOT NULL,
      output_hash TEXT NOT NULL,
      output_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(content_spec_id) REFERENCES publishing_content_specs(id)
    );

    CREATE TABLE IF NOT EXISTS publishing_validations (
      id TEXT PRIMARY KEY,
      content_spec_id TEXT NOT NULL,
      passed INTEGER NOT NULL,
      validation_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(content_spec_id) REFERENCES publishing_content_specs(id)
    );

    CREATE TABLE IF NOT EXISTS publishing_reservations (
      id TEXT PRIMARY KEY,
      slot_run_id TEXT NOT NULL UNIQUE,
      slot_key TEXT NOT NULL UNIQUE,
      content_spec_id TEXT NOT NULL UNIQUE,
      platform_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL,
      reserved_at TEXT NOT NULL,
      expires_at TEXT,
      FOREIGN KEY(slot_run_id) REFERENCES publishing_slot_runs(id),
      FOREIGN KEY(content_spec_id) REFERENCES publishing_content_specs(id)
    );

    CREATE TABLE IF NOT EXISTS publishing_publications (
      id TEXT PRIMARY KEY,
      reservation_id TEXT NOT NULL UNIQUE,
      content_spec_id TEXT NOT NULL UNIQUE,
      platform_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      state TEXT NOT NULL,
      provider_id TEXT,
      permalink TEXT,
      publish_started_at TEXT,
      published_at TEXT,
      verified_at TEXT,
      provider_receipt_json TEXT,
      readback_json TEXT,
      failure_code TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(reservation_id) REFERENCES publishing_reservations(id),
      FOREIGN KEY(content_spec_id) REFERENCES publishing_content_specs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_publishing_publication_provider ON publishing_publications(platform_id, provider_id);
    CREATE INDEX IF NOT EXISTS idx_publishing_publication_state ON publishing_publications(state, updated_at);

    CREATE TABLE IF NOT EXISTS publishing_reconciliation_attempts (
      id TEXT PRIMARY KEY,
      publication_id TEXT NOT NULL,
      classification TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(publication_id) REFERENCES publishing_publications(id)
    );

    CREATE TABLE IF NOT EXISTS publishing_metrics (
      id TEXT PRIMARY KEY,
      publication_id TEXT NOT NULL,
      metric_definition_id TEXT NOT NULL,
      value REAL,
      availability TEXT NOT NULL CHECK(availability IN ('available','unavailable')),
      evidence_json TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      UNIQUE(publication_id, metric_definition_id, captured_at),
      FOREIGN KEY(publication_id) REFERENCES publishing_publications(id),
      FOREIGN KEY(metric_definition_id) REFERENCES publishing_metric_definitions(id)
    );

    CREATE TABLE IF NOT EXISTS publishing_conversations (
      id TEXT PRIMARY KEY,
      publication_id TEXT,
      platform_id TEXT NOT NULL,
      provider_conversation_id TEXT NOT NULL,
      state TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(platform_id, provider_conversation_id),
      FOREIGN KEY(publication_id) REFERENCES publishing_publications(id)
    );

    CREATE TABLE IF NOT EXISTS publishing_attribution_edges (
      id TEXT PRIMARY KEY,
      definition_id TEXT NOT NULL,
      from_type TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_type TEXT NOT NULL,
      to_id TEXT NOT NULL,
      confidence TEXT NOT NULL CHECK(confidence IN ('low','medium','high')),
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(definition_id) REFERENCES publishing_attribution_definitions(id)
    );

    CREATE TABLE IF NOT EXISTS publishing_feedback_publications (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      platform_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      provider_object_id TEXT NOT NULL,
      graph_run_id TEXT NOT NULL,
      graph_effect_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      permalink TEXT,
      state TEXT NOT NULL CHECK(state IN ('observed','verified','ambiguous')),
      evidence_json TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(platform_id, account_id, provider_object_id),
      UNIQUE(graph_run_id, graph_effect_id)
    );
    CREATE INDEX IF NOT EXISTS idx_publishing_feedback_publication_campaign
      ON publishing_feedback_publications(campaign_id, observed_at DESC);

    CREATE TABLE IF NOT EXISTS publishing_campaign_identity_bridge (
      historical_campaign_id TEXT PRIMARY KEY,
      canonical_campaign_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('mapped','unmapped')),
      reason TEXT NOT NULL,
      provenance_json TEXT NOT NULL,
      provenance_hash TEXT NOT NULL UNIQUE,
      reviewed_by TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK(
        (status='mapped' AND canonical_campaign_id IS NOT NULL)
        OR (status='unmapped' AND canonical_campaign_id IS NULL)
      )
    );
    CREATE TRIGGER IF NOT EXISTS publishing_campaign_identity_bridge_no_update
    BEFORE UPDATE ON publishing_campaign_identity_bridge
    BEGIN SELECT RAISE(ABORT, 'campaign identity bridge records are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS publishing_campaign_identity_bridge_no_delete
    BEFORE DELETE ON publishing_campaign_identity_bridge
    BEGIN SELECT RAISE(ABORT, 'campaign identity bridge records are immutable'); END;

    CREATE TABLE IF NOT EXISTS publishing_feedback_metric_observations (
      id TEXT PRIMARY KEY,
      publication_id TEXT NOT NULL,
      metric_definition_id TEXT NOT NULL,
      value REAL,
      availability TEXT NOT NULL CHECK(availability IN ('available','unavailable')),
      state TEXT NOT NULL CHECK(state IN ('observed','verified')),
      evidence_hash TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(publication_id, metric_definition_id, evidence_hash),
      FOREIGN KEY(publication_id) REFERENCES publishing_feedback_publications(id)
    );
    CREATE INDEX IF NOT EXISTS idx_publishing_feedback_metric_publication
      ON publishing_feedback_metric_observations(publication_id, observed_at DESC);

    CREATE TABLE IF NOT EXISTS publishing_feedback_conversations (
      id TEXT PRIMARY KEY,
      publication_id TEXT NOT NULL,
      platform_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      provider_conversation_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('observed','verified','unattributed','attributed','ambiguous','reconciled')),
      evidence_json TEXT NOT NULL,
      first_observed_at TEXT NOT NULL,
      last_observed_at TEXT NOT NULL,
      UNIQUE(platform_id, account_id, provider_conversation_id),
      FOREIGN KEY(publication_id) REFERENCES publishing_feedback_publications(id)
    );

    CREATE TABLE IF NOT EXISTS publishing_feedback_conversation_observations (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('observed','verified','unattributed','attributed','ambiguous','reconciled')),
      evidence_hash TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      UNIQUE(conversation_id, evidence_hash),
      FOREIGN KEY(conversation_id) REFERENCES publishing_feedback_conversations(id)
    );

    CREATE TABLE IF NOT EXISTS publishing_feedback_attribution_edges (
      id TEXT PRIMARY KEY,
      definition_id TEXT NOT NULL,
      publication_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('observed','verified','unattributed','attributed','ambiguous','reconciled')),
      confidence TEXT NOT NULL CHECK(confidence IN ('low','medium','high')),
      scope TEXT NOT NULL,
      business_outcome_status TEXT NOT NULL CHECK(business_outcome_status IN ('unproven','verified','ambiguous')),
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(definition_id, publication_id, conversation_id),
      FOREIGN KEY(publication_id) REFERENCES publishing_feedback_publications(id),
      FOREIGN KEY(conversation_id) REFERENCES publishing_feedback_conversations(id)
    );

    CREATE TABLE IF NOT EXISTS publishing_feedback_reconciliations (
      id TEXT PRIMARY KEY,
      publication_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('observed','verified','unattributed','attributed','ambiguous','reconciled')),
      outcome TEXT NOT NULL,
      evidence_hash TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      reconciled_at TEXT NOT NULL,
      UNIQUE(publication_id, evidence_hash),
      FOREIGN KEY(publication_id) REFERENCES publishing_feedback_publications(id)
    );

    CREATE TABLE IF NOT EXISTS publishing_feedback_poll_runs (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running','completed','failed','overlap_skipped')),
      summary_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(owner, scheduled_for)
    );

    CREATE TABLE IF NOT EXISTS publishing_feedback_poll_claims (
      owner TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS publishing_audit_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      previous_hash TEXT,
      event_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_publishing_audit_aggregate ON publishing_audit_events(aggregate_type, aggregate_id, sequence);
  `);
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO publishing_schema_meta(schema_name, schema_version, created_at, updated_at)
    VALUES('deterministic-self-identification-publishing-engine', 2, ?, ?)
    ON CONFLICT(schema_name) DO UPDATE SET
      schema_version=MAX(schema_version, excluded.schema_version),
      updated_at=excluded.updated_at
  `).run(now, now);
}

function parse<T>(value: unknown): T {
  return JSON.parse(String(value)) as T;
}

export class PublishingStore {
  readonly database: SqliteDatabase;

  constructor(path: string, options: { readOnly?: boolean } = {}) {
    this.database = new DatabaseSync(path, options.readOnly
      ? { readOnly: true, timeout: 5_000 }
      : {});
    if (options.readOnly) {
      this.database.exec("PRAGMA query_only=ON; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
    } else {
      createSchema(this.database);
    }
  }

  close(): void {
    this.database.close();
  }

  transaction<T>(work: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const value = work();
      this.database.exec("COMMIT");
      return value;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  appendAudit(
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payload: unknown,
    now = new Date(),
  ): string {
    const previous = this.database.prepare(
      "SELECT event_hash FROM publishing_audit_events ORDER BY sequence DESC LIMIT 1",
    ).get() as { event_hash?: string } | undefined;
    const id = randomUUID();
    const createdAt = now.toISOString();
    const payloadJson = canonicalJson(payload);
    const eventHash = sha256({
      id,
      aggregateType,
      aggregateId,
      eventType,
      payload: parse(payloadJson),
      previousHash: previous?.event_hash ?? null,
      createdAt,
    });
    this.database.prepare(`
      INSERT INTO publishing_audit_events(
        id, aggregate_type, aggregate_id, event_type, payload_json,
        previous_hash, event_hash, created_at
      ) VALUES(?,?,?,?,?,?,?,?)
    `).run(id, aggregateType, aggregateId, eventType, payloadJson, previous?.event_hash ?? null, eventHash, createdAt);
    return eventHash;
  }

  seedRegistry(bundle: PublishingRegistryBundle): void {
    this.transaction(() => {
      const retiredIds: Record<string, string[]> = {};
      for (const [key, table] of Object.entries(REGISTRY_TABLES) as Array<[RegistryKey, string]>) {
        const statement = this.database.prepare(`
          INSERT INTO ${table}(id, version, status, approval_id, payload_json, payload_hash, created_at, updated_at)
          VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
            version=excluded.version,
            status=excluded.status,
            approval_id=excluded.approval_id,
            payload_json=excluded.payload_json,
            payload_hash=excluded.payload_hash,
            updated_at=excluded.updated_at
        `);
        for (const record of bundle[key]) {
          const payloadJson = canonicalJson(record);
          statement.run(
            record.id,
            record.version,
            record.status,
            record.approvalId ?? null,
            payloadJson,
            sha256(payloadJson),
            record.createdAt,
            record.updatedAt,
          );
        }
        const currentIds = new Set(bundle[key].map((record) => record.id));
        const stale = (this.database.prepare(
          `SELECT id FROM ${table} WHERE status != 'retired'`,
        ).all() as Array<{ id: string }>).filter((row) => !currentIds.has(row.id));
        for (const row of stale) {
          this.database.prepare(
            `UPDATE ${table} SET status='retired', updated_at=? WHERE id=?`,
          ).run(bundle.updatedAt, row.id);
        }
        if (stale.length > 0) retiredIds[key] = stale.map((row) => row.id);
      }
      const now = new Date().toISOString();
      this.database.prepare(`
        UPDATE publishing_schema_meta
        SET registry_version=?, registry_hash=?, updated_at=?
        WHERE schema_name='deterministic-self-identification-publishing-engine'
      `).run(bundle.registryVersion, sha256(bundle), now);
      this.appendAudit("registry", bundle.registryVersion, "registry.seeded", {
        registryVersion: bundle.registryVersion,
        registryHash: sha256(bundle),
        counts: Object.fromEntries(
          (Object.keys(REGISTRY_TABLES) as RegistryKey[]).map((key) => [key, bundle[key].length]),
        ),
        retiredIds,
      });
    });
  }

  startSlot(
    slotRunId: string,
    slotKey: string,
    platformId: PlatformId,
    accountId: string,
    scheduledFor: string,
    now = new Date(),
  ): void {
    this.database.prepare(`
      INSERT INTO publishing_slot_runs(
        id, slot_key, platform_id, account_id, scheduled_for, reasons_json, started_at
      ) VALUES(?,?,?,?,?,?,?)
    `).run(slotRunId, slotKey, platformId, accountId, scheduledFor, "[]", now.toISOString());
    this.appendAudit("slot_run", slotRunId, "slot.started", { slotKey, platformId, accountId, scheduledFor }, now);
  }

  completeSlot(
    slotRunId: string,
    result: SlotResult,
    reasons: string[],
    candidate: PublishingCandidate | null,
    contentSpecId: string | null,
    now = new Date(),
  ): void {
    this.database.prepare(`
      UPDATE publishing_slot_runs
      SET result=?, selected_candidate_json=?, content_spec_id=?, reasons_json=?, completed_at=?
      WHERE id=? AND (
        completed_at IS NULL
        OR result IN ('reconciliation_required', 'published_unverified')
      )
    `).run(
      result,
      candidate ? canonicalJson(candidate) : null,
      contentSpecId,
      canonicalJson(reasons),
      now.toISOString(),
      slotRunId,
    );
    this.appendAudit("slot_run", slotRunId, "slot.completed", { result, reasons, contentSpecId }, now);
  }

  saveContentSpec(spec: ContentSpec, state: PublicationState = "generated"): void {
    this.database.prepare(`
      INSERT INTO publishing_content_specs(
        id, content_hash, slot_key, product_id, campaign_id, platform_id,
        account_id, state, spec_json, created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(
      spec.id,
      spec.contentHash,
      spec.slotKey,
      spec.productId,
      spec.campaignId,
      spec.platformId,
      spec.accountId,
      state,
      canonicalJson(spec),
      spec.createdAt,
    );
    this.appendAudit("content_spec", spec.id, "content_spec.created", { state, contentHash: spec.contentHash });
  }

  saveValidation(specId: string, validation: ValidationResult, now = new Date()): void {
    this.database.prepare(`
      INSERT INTO publishing_validations(id, content_spec_id, passed, validation_json, created_at)
      VALUES(?,?,?,?,?)
    `).run(randomUUID(), specId, validation.passed ? 1 : 0, canonicalJson(validation), now.toISOString());
    this.appendAudit("content_spec", specId, "content_spec.validated", { passed: validation.passed, findings: validation.findings }, now);
  }

  saveRenderedCandidate(
    specId: string,
    rendererId: string,
    rendererVersion: string,
    output: {
      text: string;
      mediaUrl?: string | null;
      mediaHash?: string | null;
    },
    now = new Date(),
  ): { id: string; outputHash: string } {
    const id = randomUUID();
    const outputHash = sha256(output);
    this.database.prepare(`
      INSERT INTO publishing_rendered_candidates(
        id, content_spec_id, renderer_id, renderer_version, output_hash, output_json, created_at
      ) VALUES(?,?,?,?,?,?,?)
    `).run(
      id,
      specId,
      rendererId,
      rendererVersion,
      outputHash,
      canonicalJson(output),
      now.toISOString(),
    );
    this.appendAudit("content_spec", specId, "rendered_candidate.saved", {
      renderedCandidateId: id,
      rendererId,
      rendererVersion,
      outputHash,
    }, now);
    return { id, outputHash };
  }

  reserve(
    slotRunId: string,
    spec: ContentSpec,
    now = new Date(),
  ): { reservationId: string; publicationId: string; idempotencyKey: string } {
    return this.transaction(() => {
      const reservationId = randomUUID();
      const publicationId = randomUUID();
      const idempotencyKey = sha256(`publish|${spec.platformId}|${spec.accountId}|${spec.slotKey}|${spec.contentHash}`);
      this.database.prepare(`
        INSERT INTO publishing_reservations(
          id, slot_run_id, slot_key, content_spec_id, platform_id, account_id,
          idempotency_key, state, reserved_at
        ) VALUES(?,?,?,?,?,?,?,?,?)
      `).run(
        reservationId,
        slotRunId,
        spec.slotKey,
        spec.id,
        spec.platformId,
        spec.accountId,
        idempotencyKey,
        "reserved",
        now.toISOString(),
      );
      this.database.prepare(`
        INSERT INTO publishing_publications(
          id, reservation_id, content_spec_id, platform_id, account_id, state, updated_at
        ) VALUES(?,?,?,?,?,?,?)
      `).run(
        publicationId,
        reservationId,
        spec.id,
        spec.platformId,
        spec.accountId,
        "reserved",
        now.toISOString(),
      );
      this.database.prepare(`
        UPDATE publishing_slot_runs
        SET content_spec_id=?
        WHERE id=? AND content_spec_id IS NULL
      `).run(spec.id, slotRunId);
      this.appendAudit("publication", publicationId, "publication.reserved", {
        reservationId,
        idempotencyKey,
        slotKey: spec.slotKey,
        contentHash: spec.contentHash,
      }, now);
      return { reservationId, publicationId, idempotencyKey };
    });
  }

  publication(publicationId: string): {
    id: string;
    reservationId: string;
    contentSpecId: string;
    state: PublicationState;
    providerId: string | null;
    idempotencyKey: string;
  } | null {
    const row = this.database.prepare(`
      SELECT p.id, p.reservation_id, p.content_spec_id, p.state, p.provider_id, r.idempotency_key
      FROM publishing_publications p
      JOIN publishing_reservations r ON r.id=p.reservation_id
      WHERE p.id=?
    `).get(publicationId) as Record<string, unknown> | undefined;
    return row ? {
      id: String(row.id),
      reservationId: String(row.reservation_id),
      contentSpecId: String(row.content_spec_id),
      state: String(row.state) as PublicationState,
      providerId: row.provider_id ? String(row.provider_id) : null,
      idempotencyKey: String(row.idempotency_key),
    } : null;
  }

  publicationForSlotKey(slotKey: string): ReturnType<PublishingStore["publication"]> {
    const row = this.database.prepare(`
      SELECT p.id
      FROM publishing_publications p
      JOIN publishing_reservations r ON r.id=p.reservation_id
      WHERE r.slot_key=?
    `).get(slotKey) as { id?: string } | undefined;
    return row?.id ? this.publication(row.id) : null;
  }

  contentSpec(specId: string): ContentSpec | null {
    const row = this.database.prepare(
      "SELECT spec_json FROM publishing_content_specs WHERE id=?",
    ).get(specId) as { spec_json?: string } | undefined;
    return row?.spec_json ? parse<ContentSpec>(row.spec_json) : null;
  }

  transitionPublication(
    publicationId: string,
    to: PublicationState,
    patch: {
      providerId?: string | null;
      permalink?: string | null;
      providerReceipt?: unknown;
      readback?: unknown;
      failureCode?: string | null;
      publishedAt?: string | null;
    } = {},
    now = new Date(),
  ): void {
    this.transaction(() => {
      const current = this.publication(publicationId);
      if (!current) throw new Error(`Unknown publication: ${publicationId}`);
      assertPublicationTransition(current.state, to);
      this.database.prepare(`
        UPDATE publishing_publications SET
          state=?,
          provider_id=COALESCE(?, provider_id),
          permalink=COALESCE(?, permalink),
          publish_started_at=CASE WHEN ?='publishing' THEN COALESCE(publish_started_at, ?) ELSE publish_started_at END,
          published_at=COALESCE(?, published_at),
          verified_at=CASE WHEN ?='verified' THEN ? ELSE verified_at END,
          provider_receipt_json=COALESCE(?, provider_receipt_json),
          readback_json=COALESCE(?, readback_json),
          failure_code=COALESCE(?, failure_code),
          updated_at=?
        WHERE id=?
      `).run(
        to,
        patch.providerId ?? null,
        patch.permalink ?? null,
        to,
        now.toISOString(),
        patch.publishedAt ?? null,
        to,
        now.toISOString(),
        patch.providerReceipt === undefined ? null : canonicalJson(patch.providerReceipt),
        patch.readback === undefined ? null : canonicalJson(patch.readback),
        patch.failureCode ?? null,
        now.toISOString(),
        publicationId,
      );
      this.appendAudit("publication", publicationId, "publication.transitioned", {
        from: current.state,
        to,
        providerId: patch.providerId ?? current.providerId,
        failureCode: patch.failureCode ?? null,
      }, now);
    });
  }

  recordReconciliation(
    publicationId: string,
    classification: string,
    evidence: unknown,
    now = new Date(),
  ): void {
    this.database.prepare(`
      INSERT INTO publishing_reconciliation_attempts(id, publication_id, classification, evidence_json, created_at)
      VALUES(?,?,?,?,?)
    `).run(randomUUID(), publicationId, classification, canonicalJson(evidence), now.toISOString());
    this.appendAudit("publication", publicationId, "publication.reconciled", { classification, evidence }, now);
  }

  recordMetric(
    publicationId: string,
    metricDefinitionId: string,
    value: number | null,
    availability: "available" | "unavailable",
    evidence: unknown,
    capturedAt: string,
  ): void {
    if (availability === "unavailable" && value !== null) {
      throw new Error("Unavailable metrics must have a null value");
    }
    this.database.prepare(`
      INSERT INTO publishing_metrics(
        id, publication_id, metric_definition_id, value, availability, evidence_json, captured_at
      ) VALUES(?,?,?,?,?,?,?)
    `).run(randomUUID(), publicationId, metricDefinitionId, value, availability, canonicalJson(evidence), capturedAt);
    this.appendAudit("publication", publicationId, "metric.recorded", {
      metricDefinitionId,
      value,
      availability,
      capturedAt,
    });
  }

  recordConversation(input: {
    publicationId?: string | null;
    platformId: PlatformId;
    providerConversationId: string;
    state: string;
    evidence: unknown;
    now?: Date;
  }): string {
    const now = input.now ?? new Date();
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO publishing_conversations(
        id, publication_id, platform_id, provider_conversation_id,
        state, evidence_json, created_at, updated_at
      ) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(platform_id, provider_conversation_id) DO UPDATE SET
        publication_id=COALESCE(excluded.publication_id, publication_id),
        state=excluded.state,
        evidence_json=excluded.evidence_json,
        updated_at=excluded.updated_at
    `).run(
      id,
      input.publicationId ?? null,
      input.platformId,
      input.providerConversationId,
      input.state,
      canonicalJson(input.evidence),
      now.toISOString(),
      now.toISOString(),
    );
    this.appendAudit("conversation", `${input.platformId}:${input.providerConversationId}`, "conversation.recorded", {
      publicationId: input.publicationId ?? null,
      state: input.state,
      evidence: input.evidence,
    }, now);
    const stored = this.database.prepare(`
      SELECT id FROM publishing_conversations
      WHERE platform_id=? AND provider_conversation_id=?
    `).get(input.platformId, input.providerConversationId) as { id: string };
    return stored.id;
  }

  recordAttribution(input: {
    definitionId: string;
    fromType: string;
    fromId: string;
    toType: string;
    toId: string;
    confidence: "low" | "medium" | "high";
    evidence: unknown[];
    now?: Date;
  }): string {
    if (input.evidence.length === 0) {
      throw new Error("Attribution requires durable evidence");
    }
    const now = input.now ?? new Date();
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO publishing_attribution_edges(
        id, definition_id, from_type, from_id, to_type, to_id,
        confidence, evidence_json, created_at
      ) VALUES(?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      input.definitionId,
      input.fromType,
      input.fromId,
      input.toType,
      input.toId,
      input.confidence,
      canonicalJson(input.evidence),
      now.toISOString(),
    );
    this.appendAudit("attribution", id, "attribution.recorded", {
      definitionId: input.definitionId,
      from: { type: input.fromType, id: input.fromId },
      to: { type: input.toType, id: input.toId },
      confidence: input.confidence,
      evidence: input.evidence,
    }, now);
    return id;
  }

  slotRuns(limit = 50): Array<Record<string, unknown>> {
    return this.database.prepare(`
      SELECT id, slot_key, platform_id, account_id, scheduled_for, result,
             selected_candidate_json, content_spec_id, reasons_json, started_at, completed_at
      FROM publishing_slot_runs
      ORDER BY scheduled_for DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
  }

  publications(limit = 50): Array<Record<string, unknown>> {
    return this.database.prepare(`
      SELECT id, reservation_id, content_spec_id, platform_id, account_id,
             state, provider_id, permalink, publish_started_at, published_at,
             verified_at, failure_code, updated_at
      FROM publishing_publications
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
  }

  auditEvents(limit = 100): Array<Record<string, unknown>> {
    return this.database.prepare(`
      SELECT sequence, id, aggregate_type, aggregate_id, event_type,
             payload_json, previous_hash, event_hash, created_at
      FROM publishing_audit_events
      ORDER BY sequence DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
  }

  verifiedCountForDate(platformId: PlatformId, accountId: string, datePrefix: string): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM publishing_publications
      WHERE platform_id=? AND account_id=? AND state='verified' AND verified_at LIKE ?
    `).get(platformId, accountId, `${datePrefix}%`) as { count: number };
    return Number(row.count);
  }

  productVerifiedCountForDate(productId: string, datePrefix: string): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM publishing_publications p
      JOIN publishing_content_specs s ON s.id=p.content_spec_id
      WHERE s.product_id=? AND p.state='verified' AND p.verified_at LIKE ?
    `).get(productId, `${datePrefix}%`) as { count: number };
    return Number(row.count);
  }

  campaignVerifiedCountForDate(campaignId: string, datePrefix: string): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM publishing_publications p
      JOIN publishing_content_specs s ON s.id=p.content_spec_id
      WHERE s.campaign_id=? AND p.state='verified' AND p.verified_at LIKE ?
    `).get(campaignId, `${datePrefix}%`) as { count: number };
    return Number(row.count);
  }

  campaignTypeVerifiedCountForDate(
    campaignType: string,
    datePrefix: string,
  ): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM publishing_publications p
      JOIN publishing_content_specs s ON s.id=p.content_spec_id
      WHERE json_extract(s.spec_json, '$.campaignType')=?
        AND p.state='verified'
        AND p.verified_at LIKE ?
    `).get(campaignType, `${datePrefix}%`) as { count: number };
    return Number(row.count);
  }

  hoursSinceVerified(kind: "product" | "campaign", id: string, now: Date): number | null {
    const column = kind === "product" ? "product_id" : "campaign_id";
    const row = this.database.prepare(`
      SELECT MAX(p.verified_at) AS verified_at FROM publishing_publications p
      JOIN publishing_content_specs s ON s.id=p.content_spec_id
      WHERE s.${column}=? AND p.state='verified'
    `).get(id) as { verified_at?: string | null };
    if (!row.verified_at) return null;
    return Math.max(0, (now.getTime() - Date.parse(row.verified_at)) / 3_600_000);
  }

  recentProductShare(productId: string, limit = 20): number {
    const rows = this.database.prepare(`
      SELECT s.product_id FROM publishing_publications p
      JOIN publishing_content_specs s ON s.id=p.content_spec_id
      WHERE p.state='verified' ORDER BY p.verified_at DESC LIMIT ?
    `).all(limit) as Array<{ product_id: string }>;
    if (rows.length === 0) return 0;
    return rows.filter((row) => row.product_id === productId).length / rows.length;
  }

  portfolioProductCountForDate(productId: string, datePrefix: string): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM publishing_publications p
      JOIN publishing_content_specs s ON s.id=p.content_spec_id
      WHERE s.product_id=?
        AND p.state IN ('verified','shadow_verified','superseded')
        AND COALESCE(p.verified_at, p.updated_at) LIKE ?
    `).get(productId, `${datePrefix}%`) as { count: number };
    return Number(row.count);
  }

  portfolioCampaignCountForDate(campaignId: string, datePrefix: string): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM publishing_publications p
      JOIN publishing_content_specs s ON s.id=p.content_spec_id
      WHERE s.campaign_id=?
        AND p.state IN ('verified','shadow_verified','superseded')
        AND COALESCE(p.verified_at, p.updated_at) LIKE ?
    `).get(campaignId, `${datePrefix}%`) as { count: number };
    return Number(row.count);
  }

  portfolioCampaignTypeCountForDate(campaignType: string, datePrefix: string): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM publishing_publications p
      JOIN publishing_content_specs s ON s.id=p.content_spec_id
      WHERE json_extract(s.spec_json, '$.campaignType')=?
        AND p.state IN ('verified','shadow_verified','superseded')
        AND COALESCE(p.verified_at, p.updated_at) LIKE ?
    `).get(campaignType, `${datePrefix}%`) as { count: number };
    return Number(row.count);
  }

  portfolioPlatformCountForDate(
    platformId: PlatformId,
    accountId: string,
    datePrefix: string,
  ): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM publishing_publications
      WHERE platform_id=? AND account_id=?
        AND state IN ('verified','shadow_verified','superseded')
        AND COALESCE(verified_at, updated_at) LIKE ?
    `).get(platformId, accountId, `${datePrefix}%`) as { count: number };
    return Number(row.count);
  }

  hoursSincePortfolioDecision(
    kind: "product" | "campaign",
    id: string,
    now: Date,
  ): number | null {
    const column = kind === "product" ? "product_id" : "campaign_id";
    const row = this.database.prepare(`
      SELECT MAX(COALESCE(p.verified_at, p.updated_at)) AS decided_at
      FROM publishing_publications p
      JOIN publishing_content_specs s ON s.id=p.content_spec_id
      WHERE s.${column}=?
        AND p.state IN ('verified','shadow_verified','superseded')
    `).get(id) as { decided_at?: string | null };
    if (!row.decided_at) return null;
    return Math.max(0, (now.getTime() - Date.parse(row.decided_at)) / 3_600_000);
  }

  recentPortfolioProductShare(productId: string, limit = 20): number {
    const rows = this.database.prepare(`
      SELECT s.product_id FROM publishing_publications p
      JOIN publishing_content_specs s ON s.id=p.content_spec_id
      WHERE p.state IN ('verified','shadow_verified','superseded')
      ORDER BY COALESCE(p.verified_at, p.updated_at) DESC LIMIT ?
    `).all(limit) as Array<{ product_id: string }>;
    if (rows.length === 0) return 0;
    return rows.filter((row) => row.product_id === productId).length / rows.length;
  }

  contentHashes(): Set<string> {
    const rows = this.database.prepare(
      "SELECT content_hash FROM publishing_content_specs",
    ).all() as Array<{ content_hash: string }>;
    return new Set(rows.map((row) => row.content_hash));
  }

  auditChainValid(): boolean {
    const rows = this.database.prepare(`
      SELECT id, aggregate_type, aggregate_id, event_type, payload_json,
             previous_hash, event_hash, created_at
      FROM publishing_audit_events ORDER BY sequence ASC
    `).all() as Array<Record<string, unknown>>;
    let previous: string | null = null;
    for (const row of rows) {
      if ((row.previous_hash ?? null) !== previous) return false;
      const expected = sha256({
        id: row.id,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        eventType: row.event_type,
        payload: parse(row.payload_json),
        previousHash: row.previous_hash ?? null,
        createdAt: row.created_at,
      });
      if (expected !== row.event_hash) return false;
      previous = String(row.event_hash);
    }
    return true;
  }

  counts(): Record<string, number> {
    const tables = [
      ...Object.values(REGISTRY_TABLES),
      "publishing_slot_runs",
      "publishing_content_specs",
      "publishing_rendered_candidates",
      "publishing_validations",
      "publishing_reservations",
      "publishing_publications",
      "publishing_reconciliation_attempts",
      "publishing_metrics",
      "publishing_conversations",
      "publishing_attribution_edges",
      "publishing_feedback_publications",
      "publishing_campaign_identity_bridge",
      "publishing_feedback_metric_observations",
      "publishing_feedback_conversations",
      "publishing_feedback_conversation_observations",
      "publishing_feedback_attribution_edges",
      "publishing_feedback_reconciliations",
      "publishing_feedback_poll_runs",
      "publishing_feedback_poll_claims",
      "publishing_audit_events",
    ];
    return Object.fromEntries(tables.map((table) => {
      const row = this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      return [table, Number(row.count)];
    }));
  }
}
