import { createHash } from "node:crypto";

export const GRAPH_SCHEMA_NAME = "openclaw-graph-kernel";
export const GRAPH_SCHEMA_VERSION = 2;
export const GRAPH_MIGRATION_ID = "graph-schema-v2-one-run-live-capability";
export const GRAPH_SCHEMA_V1_VERSION = 1;
export const GRAPH_SCHEMA_V1_MIGRATION_ID = "graph-schema-v1";

export type GraphSchemaObjectType = "table" | "index" | "trigger";

export type GraphSchemaObject = {
  type: GraphSchemaObjectType;
  name: string;
  sql: string;
};

export type GraphMigrationFailurePoint =
  | "after_first_table"
  | "after_tables"
  | "after_indexes"
  | "before_metadata"
  | "during_v2_upgrade";

function table(name: string, body: string): GraphSchemaObject {
  return { type: "table", name, sql: `CREATE TABLE ${name} (${body})` };
}

function index(name: string, sql: string): GraphSchemaObject {
  return { type: "index", name, sql };
}

function trigger(name: string, sql: string): GraphSchemaObject {
  return { type: "trigger", name, sql };
}

export const GRAPH_SCHEMA_V1_OBJECTS: readonly GraphSchemaObject[] = Object.freeze([
  table("graph_schema_meta", `
    schema_name TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    migration_id TEXT NOT NULL,
    migration_checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  `),
  table("graph_definitions", `
    graph_id TEXT NOT NULL,
    graph_version TEXT NOT NULL,
    definition_json TEXT NOT NULL,
    definition_hash TEXT NOT NULL,
    registered_at TEXT NOT NULL,
    PRIMARY KEY(graph_id, graph_version)
  `),
  table("graph_runs", `
    run_id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL,
    graph_version TEXT NOT NULL,
    parent_run_id TEXT,
    correlation_id TEXT NOT NULL,
    objective TEXT NOT NULL,
    status TEXT NOT NULL,
    current_node_id TEXT,
    state_json TEXT NOT NULL,
    revision INTEGER NOT NULL,
    last_progress_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(graph_id, graph_version) REFERENCES graph_definitions(graph_id, graph_version)
  `),
  table("graph_events", `
    event_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL,
    node_id TEXT,
    attempt_number INTEGER,
    actor TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    causation_id TEXT,
    correlation_id TEXT NOT NULL,
    previous_hash TEXT,
    event_hash TEXT NOT NULL,
    UNIQUE(run_id, sequence),
    FOREIGN KEY(run_id) REFERENCES graph_runs(run_id)
  `),
  table("graph_node_attempts", `
    attempt_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    owner TEXT NOT NULL,
    lease_expires_at TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    outcome TEXT,
    output_json TEXT,
    error_json TEXT,
    UNIQUE(run_id, node_id, attempt_number),
    UNIQUE(idempotency_key),
    FOREIGN KEY(run_id) REFERENCES graph_runs(run_id)
  `),
  table("graph_approvals", `
    approval_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    graph_version TEXT NOT NULL,
    node_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    decided_at TEXT,
    expires_at TEXT NOT NULL,
    approver TEXT,
    note TEXT,
    UNIQUE(run_id, node_id, action, target, payload_hash),
    FOREIGN KEY(run_id) REFERENCES graph_runs(run_id)
  `),
  table("graph_evidence", `
    evidence_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    node_id TEXT,
    kind TEXT NOT NULL,
    uri TEXT NOT NULL,
    sha256 TEXT,
    summary TEXT NOT NULL,
    checker TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(run_id) REFERENCES graph_runs(run_id)
  `),
  table("graph_external_effects", `
    effect_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    operation_type TEXT NOT NULL,
    target TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    state TEXT NOT NULL,
    provider_operation_id TEXT,
    last_observed_at TEXT,
    evidence_refs_json TEXT NOT NULL,
    FOREIGN KEY(run_id) REFERENCES graph_runs(run_id)
  `),
  table("graph_checkpoints", `
    checkpoint_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    node_id TEXT,
    reason TEXT NOT NULL,
    state_hash TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(run_id) REFERENCES graph_runs(run_id)
  `),
  table("graph_resource_leases", `
    resource_key TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    owner TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  `),
  index("graph_runs_status_idx", "CREATE INDEX graph_runs_status_idx ON graph_runs(status, updated_at)"),
  index("graph_runs_graph_idx", "CREATE INDEX graph_runs_graph_idx ON graph_runs(graph_id, graph_version, created_at)"),
  index("graph_events_run_idx", "CREATE INDEX graph_events_run_idx ON graph_events(run_id, sequence)"),
  index("graph_attempts_active_idx", "CREATE INDEX graph_attempts_active_idx ON graph_node_attempts(status, lease_expires_at)"),
  index("graph_effects_state_idx", "CREATE INDEX graph_effects_state_idx ON graph_external_effects(state, last_observed_at)"),
  trigger("graph_definitions_immutable_update", `
    CREATE TRIGGER graph_definitions_immutable_update
    BEFORE UPDATE ON graph_definitions
    BEGIN SELECT RAISE(ABORT, 'graph definitions are immutable'); END
  `),
  trigger("graph_definitions_immutable_delete", `
    CREATE TRIGGER graph_definitions_immutable_delete
    BEFORE DELETE ON graph_definitions
    BEGIN SELECT RAISE(ABORT, 'graph definitions are immutable'); END
  `),
]);

export const GRAPH_SCHEMA_V2_OBJECTS: readonly GraphSchemaObject[] = Object.freeze([
  table("graph_one_run_live_capabilities", `
    capability_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('prepared','active','consumed','revoked','expired','blocked')),
    graph_id TEXT NOT NULL,
    graph_version TEXT NOT NULL,
    graph_definition_hash TEXT NOT NULL,
    graph_run_id TEXT NOT NULL UNIQUE,
    claim_id TEXT NOT NULL UNIQUE,
    approval_id TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    account_id TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    sequence_id TEXT NOT NULL,
    slot_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    media_hash TEXT,
    envelope_hash TEXT NOT NULL UNIQUE,
    idempotency_key_fingerprint TEXT NOT NULL UNIQUE,
    maximum_mutating_dispatches INTEGER NOT NULL CHECK(maximum_mutating_dispatches > 0),
    maximum_successful_publications INTEGER NOT NULL CHECK(maximum_successful_publications = 1),
    issued_at TEXT NOT NULL,
    not_before TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    issued_by TEXT NOT NULL,
    consumed_at TEXT,
    revoked_at TEXT,
    failure_reason TEXT,
    FOREIGN KEY(graph_run_id) REFERENCES graph_runs(run_id),
    FOREIGN KEY(approval_id) REFERENCES graph_approvals(approval_id)
  `),
  table("graph_live_capability_dispatches", `
    dispatch_id TEXT PRIMARY KEY,
    capability_id TEXT NOT NULL,
    step_index INTEGER NOT NULL CHECK(step_index >= 0),
    step_id TEXT NOT NULL,
    expected_operation TEXT NOT NULL,
    predecessor_step_id TEXT,
    maximum_dispatch_count INTEGER NOT NULL CHECK(maximum_dispatch_count = 1),
    dispatch_count INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_count >= 0 AND dispatch_count <= maximum_dispatch_count),
    state TEXT NOT NULL CHECK(state IN ('prepared','reserved','succeeded','confirmed_absent','ambiguous','failed')),
    reserved_at TEXT,
    completed_at TEXT,
    provider_operation_id TEXT,
    failure_reason TEXT,
    UNIQUE(capability_id, step_index),
    UNIQUE(capability_id, step_id),
    FOREIGN KEY(capability_id) REFERENCES graph_one_run_live_capabilities(capability_id)
  `),
  index("graph_live_capabilities_status_idx", "CREATE INDEX graph_live_capabilities_status_idx ON graph_one_run_live_capabilities(status, expires_at)"),
  index("graph_live_dispatches_state_idx", "CREATE INDEX graph_live_dispatches_state_idx ON graph_live_capability_dispatches(capability_id, state, step_index)"),
  trigger("graph_live_capability_binding_immutable", `
    CREATE TRIGGER graph_live_capability_binding_immutable
    BEFORE UPDATE OF graph_id, graph_version, graph_definition_hash, graph_run_id, claim_id, approval_id,
      provider, account_id, operation_type, candidate_id, campaign_id, sequence_id, slot_id, payload_hash,
      media_hash, envelope_hash, idempotency_key_fingerprint, maximum_mutating_dispatches,
      maximum_successful_publications, issued_at, not_before, expires_at, issued_by
    ON graph_one_run_live_capabilities
    BEGIN SELECT RAISE(ABORT, 'live capability bindings are immutable'); END
  `),
  trigger("graph_live_capability_terminal_status", `
    CREATE TRIGGER graph_live_capability_terminal_status
    BEFORE UPDATE OF status ON graph_one_run_live_capabilities
    WHEN OLD.status IN ('consumed','revoked','expired','blocked') AND NEW.status <> OLD.status
    BEGIN SELECT RAISE(ABORT, 'live capability terminal status is immutable'); END
  `),
]);

export const GRAPH_SCHEMA_OBJECTS: readonly GraphSchemaObject[] = Object.freeze([
  ...GRAPH_SCHEMA_V1_OBJECTS,
  ...GRAPH_SCHEMA_V2_OBJECTS,
]);

export const GRAPH_EXECUTION_STATE_TABLES = Object.freeze([
  "graph_definitions",
  "graph_runs",
  "graph_events",
  "graph_node_attempts",
  "graph_approvals",
  "graph_evidence",
  "graph_external_effects",
  "graph_checkpoints",
  "graph_resource_leases",
  "graph_one_run_live_capabilities",
  "graph_live_capability_dispatches",
] as const);

export function normalizeGraphSql(sql: string): string {
  return sql.replace(/\s+/g, " ").replace(/;$/, "").trim();
}

function checksum(migrationId: string, version: number, objects: readonly GraphSchemaObject[]): string {
  const material = JSON.stringify({
    migrationId,
    version,
    objects: objects.map((object) => ({
      type: object.type,
      name: object.name,
      sql: normalizeGraphSql(object.sql),
    })),
  });
  return createHash("sha256").update(material).digest("hex");
}

export const GRAPH_SCHEMA_V1_MIGRATION_CHECKSUM = checksum(
  GRAPH_SCHEMA_V1_MIGRATION_ID,
  GRAPH_SCHEMA_V1_VERSION,
  GRAPH_SCHEMA_V1_OBJECTS,
);

export const GRAPH_MIGRATION_CHECKSUM = checksum(
  GRAPH_MIGRATION_ID,
  GRAPH_SCHEMA_VERSION,
  GRAPH_SCHEMA_OBJECTS,
);
