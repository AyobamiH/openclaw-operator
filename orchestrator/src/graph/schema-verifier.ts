import { createHash } from "node:crypto";
import {
  GRAPH_EXECUTION_STATE_TABLES,
  GRAPH_MIGRATION_CHECKSUM,
  GRAPH_MIGRATION_ID,
  GRAPH_SCHEMA_NAME,
  GRAPH_SCHEMA_OBJECTS,
  GRAPH_SCHEMA_VERSION,
  GRAPH_SCHEMA_V1_MIGRATION_CHECKSUM,
  GRAPH_SCHEMA_V1_MIGRATION_ID,
  GRAPH_SCHEMA_V1_OBJECTS,
  GRAPH_SCHEMA_V1_VERSION,
  GRAPH_SCHEMA_V2_MIGRATION_CHECKSUM,
  GRAPH_SCHEMA_V2_MIGRATION_ID,
  GRAPH_SCHEMA_V2_OBJECTS,
  GRAPH_SCHEMA_V2_VERSION,
  normalizeGraphSql,
  type GraphSchemaObjectType,
} from "./migrations.js";

export type GraphSqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...values: unknown[]): unknown[];
    get(...values: unknown[]): unknown;
    run(...values: unknown[]): unknown;
  };
};

export type GraphPersistenceErrorCode =
  | "unsafe_path"
  | "target_exists"
  | "permission_error"
  | "migration_failed"
  | "migration_rolled_back"
  | "schema_drift"
  | "incomplete_schema"
  | "unsupported_schema_version"
  | "integrity_failed"
  | "foreign_key_failed"
  | "invalid_database";

export class GraphPersistenceError extends Error {
  readonly code: GraphPersistenceErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: GraphPersistenceErrorCode, message: string, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, options);
    this.name = "GraphPersistenceError";
    this.code = code;
    this.details = details;
  }
}

type SqliteObjectRow = { type: GraphSchemaObjectType; name: string; sql: string | null };
type MetadataRow = {
  schema_name: string;
  schema_version: number;
  migration_id: string;
  migration_checksum: string;
  applied_at: string;
};

export type GraphSchemaVerification = {
  schemaVersion: number;
  userVersion: number;
  migrationId: string;
  migrationChecksum: string;
  appliedAt: string;
  integrityCheck: "ok";
  foreignKeyCheck: "ok";
  foreignKeysEnabled: boolean;
  tables: string[];
  indexes: string[];
  triggers: string[];
  rowCounts: Record<string, number>;
  schemaFingerprint: string;
};

function graphObjects(database: GraphSqliteDatabase): SqliteObjectRow[] {
  return database.prepare(`
    SELECT type, name, sql
    FROM sqlite_schema
    WHERE name LIKE 'graph_%' AND type IN ('table', 'index', 'trigger')
      AND name NOT LIKE 'sqlite_autoindex%'
    ORDER BY type, name
  `).all() as SqliteObjectRow[];
}

function graphObjectFingerprint(objects: SqliteObjectRow[]): string {
  const material = objects.map((object) => ({
    type: object.type,
    name: object.name,
    sql: normalizeGraphSql(object.sql ?? ""),
  }));
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

function metadata(database: GraphSqliteDatabase): MetadataRow {
  let rows: MetadataRow[];
  try {
    rows = database.prepare(`
      SELECT schema_name, schema_version, migration_id, migration_checksum, applied_at
      FROM graph_schema_meta
    `).all() as MetadataRow[];
  } catch (error) {
    throw new GraphPersistenceError("incomplete_schema", "graph_schema_metadata_unreadable", {}, { cause: error });
  }
  if (rows.length !== 1 || rows[0]?.schema_name !== GRAPH_SCHEMA_NAME) {
    throw new GraphPersistenceError("incomplete_schema", "graph_schema_metadata_incomplete", { rowCount: rows.length });
  }
  return rows[0];
}

function verifyGraphSchemaAgainst(
  database: GraphSqliteDatabase,
  specification: {
    version: number;
    migrationId: string;
    migrationChecksum: string;
    objects: readonly { type: GraphSchemaObjectType; name: string; sql: string }[];
    executionTables: readonly string[];
  },
  options: { requireEmptyExecutionState?: boolean } = {},
): GraphSchemaVerification {
  const objects = graphObjects(database);
  if (objects.length === 0) {
    throw new GraphPersistenceError("incomplete_schema", "graph_schema_absent");
  }

  const meta = metadata(database);
  if (meta.schema_version > specification.version) {
    throw new GraphPersistenceError("unsupported_schema_version", "graph_schema_version_is_newer_than_runtime", {
      observed: meta.schema_version,
      supported: specification.version,
    });
  }
  if (meta.schema_version < specification.version) {
    throw new GraphPersistenceError("incomplete_schema", "graph_schema_version_is_older_than_runtime", {
      observed: meta.schema_version,
      supported: specification.version,
    });
  }
  if (meta.migration_id !== specification.migrationId || meta.migration_checksum !== specification.migrationChecksum) {
    throw new GraphPersistenceError("schema_drift", "graph_schema_metadata_drift", {
      migrationId: meta.migration_id,
      migrationChecksum: meta.migration_checksum,
    });
  }

  const expected = new Map(specification.objects.map((object) => [`${object.type}:${object.name}`, normalizeGraphSql(object.sql)]));
  const observed = new Map(objects.map((object) => [`${object.type}:${object.name}`, normalizeGraphSql(object.sql ?? "")]));
  const missing = [...expected.keys()].filter((key) => !observed.has(key));
  const unexpected = [...observed.keys()].filter((key) => !expected.has(key));
  if (missing.length > 0) {
    throw new GraphPersistenceError("incomplete_schema", "graph_schema_objects_missing", { missing });
  }
  if (unexpected.length > 0) {
    throw new GraphPersistenceError("schema_drift", "graph_schema_objects_unexpected", { unexpected });
  }
  const changed = [...expected.entries()]
    .filter(([key, sql]) => observed.get(key) !== sql)
    .map(([key]) => key);
  if (changed.length > 0) {
    throw new GraphPersistenceError("schema_drift", "graph_schema_object_definition_drift", { changed });
  }

  const integrityRows = database.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
  const integrityValues = integrityRows.flatMap((row) => Object.values(row).map(String));
  if (integrityValues.length !== 1 || integrityValues[0] !== "ok") {
    throw new GraphPersistenceError("integrity_failed", "graph_database_integrity_check_failed", { integrityValues });
  }
  const foreignKeyRows = database.prepare("PRAGMA foreign_key_check").all() as Array<Record<string, unknown>>;
  if (foreignKeyRows.length > 0) {
    throw new GraphPersistenceError("foreign_key_failed", "graph_database_foreign_key_check_failed", {
      violations: foreignKeyRows.length,
    });
  }

  const rowCounts: Record<string, number> = {};
  for (const table of specification.executionTables) {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    rowCounts[table] = Number(row.count);
  }
  if (options.requireEmptyExecutionState) {
    const nonEmpty = Object.entries(rowCounts).filter(([, count]) => count !== 0);
    if (nonEmpty.length > 0) {
      throw new GraphPersistenceError("schema_drift", "graph_execution_state_not_empty", { nonEmpty });
    }
  }

  const userVersion = Number((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  if (userVersion !== specification.version) {
    throw new GraphPersistenceError("schema_drift", "graph_schema_user_version_drift", {
      observed: userVersion,
      expected: specification.version,
    });
  }
  const foreignKeysEnabled = Number((database.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys) === 1;
  if (!foreignKeysEnabled) {
    throw new GraphPersistenceError("foreign_key_failed", "graph_database_foreign_keys_disabled");
  }

  return {
    schemaVersion: meta.schema_version,
    userVersion,
    migrationId: meta.migration_id,
    migrationChecksum: meta.migration_checksum,
    appliedAt: meta.applied_at,
    integrityCheck: "ok",
    foreignKeyCheck: "ok",
    foreignKeysEnabled,
    tables: objects.filter((object) => object.type === "table").map((object) => object.name).sort(),
    indexes: objects.filter((object) => object.type === "index").map((object) => object.name).sort(),
    triggers: objects.filter((object) => object.type === "trigger").map((object) => object.name).sort(),
    rowCounts,
    schemaFingerprint: graphObjectFingerprint(objects),
  };
}

export function verifyGraphSchema(
  database: GraphSqliteDatabase,
  options: { requireEmptyExecutionState?: boolean } = {},
): GraphSchemaVerification {
  return verifyGraphSchemaAgainst(database, {
    version: GRAPH_SCHEMA_VERSION,
    migrationId: GRAPH_MIGRATION_ID,
    migrationChecksum: GRAPH_MIGRATION_CHECKSUM,
    objects: GRAPH_SCHEMA_OBJECTS,
    executionTables: GRAPH_EXECUTION_STATE_TABLES,
  }, options);
}

export function verifyGraphSchemaV1(database: GraphSqliteDatabase): GraphSchemaVerification {
  const v1Tables = GRAPH_SCHEMA_V1_OBJECTS.filter((object) => object.type === "table").map((object) => object.name);
  return verifyGraphSchemaAgainst(database, {
    version: GRAPH_SCHEMA_V1_VERSION,
    migrationId: GRAPH_SCHEMA_V1_MIGRATION_ID,
    migrationChecksum: GRAPH_SCHEMA_V1_MIGRATION_CHECKSUM,
    objects: GRAPH_SCHEMA_V1_OBJECTS,
    executionTables: v1Tables,
  });
}

export function verifyGraphSchemaV2(database: GraphSqliteDatabase): GraphSchemaVerification {
  const objects = [...GRAPH_SCHEMA_V1_OBJECTS, ...GRAPH_SCHEMA_V2_OBJECTS];
  const tables = objects.filter((object) => object.type === "table").map((object) => object.name);
  return verifyGraphSchemaAgainst(database, {
    version: GRAPH_SCHEMA_V2_VERSION,
    migrationId: GRAPH_SCHEMA_V2_MIGRATION_ID,
    migrationChecksum: GRAPH_SCHEMA_V2_MIGRATION_CHECKSUM,
    objects,
    executionTables: tables,
  });
}
