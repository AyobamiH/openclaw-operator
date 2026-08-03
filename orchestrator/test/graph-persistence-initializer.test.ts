import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeGraphDatabase } from "../src/graph/initializer.js";
import {
  GRAPH_EXECUTION_STATE_TABLES,
  GRAPH_MIGRATION_CHECKSUM,
  GRAPH_MIGRATION_ID,
  GRAPH_SCHEMA_OBJECTS,
  GRAPH_SCHEMA_NAME,
  GRAPH_SCHEMA_V1_MIGRATION_CHECKSUM,
  GRAPH_SCHEMA_V1_MIGRATION_ID,
  GRAPH_SCHEMA_V1_OBJECTS,
  GRAPH_SCHEMA_V2_MIGRATION_CHECKSUM,
  GRAPH_SCHEMA_V2_MIGRATION_ID,
  GRAPH_SCHEMA_V2_OBJECTS,
  GRAPH_SCHEMA_VERSION,
  type GraphMigrationFailurePoint,
} from "../src/graph/migrations.js";
import { GraphPersistenceError } from "../src/graph/schema-verifier.js";
import { GraphStore } from "../src/graph/store.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

const cleanups: string[] = [];

afterEach(async () => {
  while (cleanups.length > 0) await rm(cleanups.pop()!, { recursive: true, force: true });
});

async function fixture(): Promise<{ root: string; stateRoot: string; databasePath: string }> {
  const root = await mkdtemp(join(tmpdir(), "graph-persistence-initializer-"));
  cleanups.push(root);
  const stateRoot = join(root, "state");
  mkdirSync(stateRoot, { mode: 0o700 });
  return { root, stateRoot, databasePath: join(stateRoot, "database", "graph-runs.sqlite") };
}

function initializeFixture(value: { stateRoot: string; databasePath: string }, expectAbsent = true) {
  return initializeGraphDatabase({
    path: value.databasePath,
    stateRoot: value.stateRoot,
    expectAbsent,
    testOnlyAllowUnsafePath: true,
  });
}

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function raw(path: string): DatabaseSyncInstance {
  return new DatabaseSync(path);
}

function graphObjects(database: DatabaseSyncInstance): Array<{ type: string; name: string; sql: string | null }> {
  return database.prepare(`
    SELECT type, name, sql FROM sqlite_schema
    WHERE name LIKE 'graph_%' AND type IN ('table', 'index', 'trigger')
      AND name NOT LIKE 'sqlite_autoindex%'
    ORDER BY type, name
  `).all() as Array<{ type: string; name: string; sql: string | null }>;
}

function captureError(work: () => unknown): GraphPersistenceError {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(GraphPersistenceError);
    return error as GraphPersistenceError;
  }
  throw new Error("expected_graph_persistence_error");
}

describe("graph schema migration atomicity", () => {
  for (const failurePoint of ["after_first_table", "after_indexes", "before_metadata"] as GraphMigrationFailurePoint[]) {
    it(`rolls back every schema object when failure occurs at ${failurePoint}`, async () => {
      const value = await fixture();
      const error = captureError(() => new GraphStore(value.databasePath, { migrationFailurePoint: failurePoint }));
      expect(error.code).toBe("migration_rolled_back");
      expect(error.details.rollbackSucceeded).toBe(true);

      const database = raw(value.databasePath);
      try {
        expect(graphObjects(database)).toEqual([]);
        expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(0);
      } finally {
        database.close();
      }
    });
  }
});

describe("graph initializer successful and repeatable behavior", () => {
  it("transactionally upgrades an empty version-1 database without creating authority", async () => {
    const value = await fixture();
    mkdirSync(dirname(value.databasePath), { recursive: true, mode: 0o700 });
    const database = raw(value.databasePath);
    for (const object of GRAPH_SCHEMA_V1_OBJECTS) database.exec(object.sql);
    database.prepare("INSERT INTO graph_schema_meta(schema_name, schema_version, migration_id, migration_checksum, applied_at) VALUES (?, 1, ?, ?, ?)")
      .run(GRAPH_SCHEMA_NAME, GRAPH_SCHEMA_V1_MIGRATION_ID, GRAPH_SCHEMA_V1_MIGRATION_CHECKSUM, new Date().toISOString());
    database.exec("PRAGMA user_version=1");
    database.close();

    const store = new GraphStore(value.databasePath);
    expect(store.schemaVersion()).toBe(GRAPH_SCHEMA_VERSION);
    expect(store.oneRunLiveCapabilities()).toEqual([]);
    expect(store.schemaVerification({ requireEmptyExecutionState: true })).toMatchObject({
      schemaVersion: GRAPH_SCHEMA_VERSION,
      integrityCheck: "ok",
      foreignKeyCheck: "ok",
    });
    store.close();
  });

  it("creates the exact empty current schema with stable metadata and mode 0600", async () => {
    const value = await fixture();
    const result = initializeFixture(value);

    expect(result).toMatchObject({
      status: "initialised",
      created: true,
      alreadyInitialised: false,
      schemaVersion: GRAPH_SCHEMA_VERSION,
      userVersion: GRAPH_SCHEMA_VERSION,
      migrationId: GRAPH_MIGRATION_ID,
      migrationChecksum: GRAPH_MIGRATION_CHECKSUM,
      integrityCheck: "ok",
      foreignKeyCheck: "ok",
      mode: "0600",
      tables: 14,
      indexes: 11,
      triggers: 8,
      executionRows: 0,
    });
    expect(statSync(value.databasePath).mode & 0o777).toBe(0o600);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      const sidecar = `${value.databasePath}${suffix}`;
      try {
        expect(lstatSync(sidecar).mode & 0o777).toBe(0o600);
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    }

    const database = raw(value.databasePath);
    try {
      const metadata = database.prepare("SELECT * FROM graph_schema_meta").all();
      expect(metadata).toHaveLength(1);
      for (const table of GRAPH_EXECUTION_STATE_TABLES) {
        expect(Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)).toBe(0);
      }
    } finally {
      database.close();
    }
  });

  it("upgrades a non-empty version-2 database and reports preserved execution state", async () => {
    const value = await fixture();
    mkdirSync(dirname(value.databasePath), { recursive: true, mode: 0o700 });
    const database = raw(value.databasePath);
    for (const object of [...GRAPH_SCHEMA_V1_OBJECTS, ...GRAPH_SCHEMA_V2_OBJECTS]) {
      database.exec(object.sql);
    }
    database.prepare("INSERT INTO graph_schema_meta(schema_name, schema_version, migration_id, migration_checksum, applied_at) VALUES (?, 2, ?, ?, ?)")
      .run(GRAPH_SCHEMA_NAME, GRAPH_SCHEMA_V2_MIGRATION_ID, GRAPH_SCHEMA_V2_MIGRATION_CHECKSUM, new Date().toISOString());
    database.prepare("INSERT INTO graph_definitions(graph_id, graph_version, definition_json, definition_hash, registered_at) VALUES (?, ?, ?, ?, ?)")
      .run("preserved-definition", "1.0.0", "{}", "a".repeat(64), new Date().toISOString());
    database.exec("PRAGMA user_version=2");
    database.close();

    const result = initializeFixture(value, false);
    expect(result).toMatchObject({
      status: "already_initialised",
      schemaVersion: 3,
      userVersion: 3,
      created: false,
      alreadyInitialised: true,
    });
    expect(result.executionRows).toBe(1);

    const migrated = raw(value.databasePath);
    try {
      expect(migrated.prepare("SELECT graph_id FROM graph_definitions").get()).toEqual({
        graph_id: "preserved-definition",
      });
      expect(graphObjects(migrated).map((object) => object.name)).toContain("graph_child_run_receipts");
      expect(graphObjects(migrated).map((object) => object.name)).toContain("graph_verifier_receipts");
    } finally {
      migrated.close();
    }
  });

  it("returns already_initialised without changing migration metadata or schema", async () => {
    const value = await fixture();
    const first = initializeFixture(value);
    const databaseBefore = raw(value.databasePath);
    const metadataBefore = databaseBefore.prepare("SELECT * FROM graph_schema_meta").get();
    const objectsBefore = graphObjects(databaseBefore);
    databaseBefore.close();
    const digestBefore = digest(value.databasePath);

    const second = initializeFixture(value, false);
    const databaseAfter = raw(value.databasePath);
    const metadataAfter = databaseAfter.prepare("SELECT * FROM graph_schema_meta").get();
    const objectsAfter = graphObjects(databaseAfter);
    databaseAfter.close();

    expect(second).toMatchObject({ status: "already_initialised", created: false, alreadyInitialised: true });
    expect(second.appliedAt).toBe(first.appliedAt);
    expect(metadataAfter).toEqual(metadataBefore);
    expect(objectsAfter).toEqual(objectsBefore);
    expect(second.schemaFingerprint).toBe(first.schemaFingerprint);
    expect(digest(value.databasePath)).toBe(digestBefore);
    expect(statSync(value.databasePath).mode & 0o777).toBe(0o600);
  });

  it("rejects --expect-absent re-entry before mutation", async () => {
    const value = await fixture();
    initializeFixture(value);
    const beforeDigest = digest(value.databasePath);
    const beforeMode = statSync(value.databasePath).mode & 0o777;
    const error = captureError(() => initializeFixture(value));
    expect(error.code).toBe("target_exists");
    expect(digest(value.databasePath)).toBe(beforeDigest);
    expect(statSync(value.databasePath).mode & 0o777).toBe(beforeMode);
  });

  it("emits structured CLI output without importing the runtime", async () => {
    const value = await fixture();
    const processResult = spawnSync("/bin/sh", [
      "-c", "umask 0002; exec \"$@\"", "graph-init-test",
      process.execPath,
      "--import", "tsx",
      "scripts/initialize-graph-database.ts",
      "--expect-absent",
      "--test-only-allow-unsafe-path",
      "--state-root", value.stateRoot,
      "--path", value.databasePath,
    ], { cwd: resolve("."), encoding: "utf8" });
    expect(processResult.status).toBe(0);
    expect(processResult.stderr).toBe("");
    expect(JSON.parse(processResult.stdout)).toMatchObject({
      status: "initialised",
      schemaVersion: GRAPH_SCHEMA_VERSION,
      executionRows: 0,
      mode: "0600",
    });
    expect(statSync(value.databasePath).mode & 0o777).toBe(0o600);
    const source = readFileSync(resolve("scripts/initialize-graph-database.ts"), "utf8");
    expect(source).not.toContain("src/index");
    expect(source).not.toContain("publishing");
  });

  it("restores a permissive caller umask after secure creation", async () => {
    const value = await fixture();
    const source = `
      import { initializeGraphDatabase } from './src/graph/initializer.ts';
      const before = process.umask();
      const result = initializeGraphDatabase({
        path: process.env.TEST_GRAPH_DB,
        stateRoot: process.env.TEST_GRAPH_ROOT,
        expectAbsent: true,
        testOnlyAllowUnsafePath: true,
      });
      const after = process.umask();
      process.stdout.write(JSON.stringify({ before, after, mode: result.mode }));
    `;
    const processResult = spawnSync("/bin/sh", [
      "-c", "umask 0002; exec \"$@\"", "graph-umask-test",
      process.execPath, "--import", "tsx", "--input-type=module", "-e", source,
    ], {
      cwd: resolve("."),
      encoding: "utf8",
      env: { ...process.env, TEST_GRAPH_DB: value.databasePath, TEST_GRAPH_ROOT: value.stateRoot },
    });
    expect(processResult.status).toBe(0);
    expect(processResult.stderr).toBe("");
    expect(JSON.parse(processResult.stdout)).toEqual({ before: 2, after: 2, mode: "0600" });
    expect(statSync(value.databasePath).mode & 0o777).toBe(0o600);
  });
});

describe("graph initializer path and permission safety", () => {
  it("rejects relative, outside-root and source-tree paths", async () => {
    const value = await fixture();
    expect(captureError(() => initializeGraphDatabase({ path: "database/graph-runs.sqlite", stateRoot: value.stateRoot })).code).toBe("unsafe_path");
    expect(captureError(() => initializeGraphDatabase({
      path: join(value.root, "outside", "database", "graph-runs.sqlite"),
      stateRoot: value.stateRoot,
    })).code).toBe("unsafe_path");
    expect(captureError(() => initializeGraphDatabase({
      path: resolve("database", "graph-runs.sqlite"),
      stateRoot: value.stateRoot,
      testOnlyAllowUnsafePath: true,
    })).code).toBe("unsafe_path");
  });

  it("rejects symlink targets and symlink parents", async () => {
    const targetFixture = await fixture();
    mkdirSync(join(targetFixture.stateRoot, "database"), { mode: 0o700 });
    const realTarget = join(targetFixture.root, "real.sqlite");
    writeFileSync(realTarget, "not-a-database");
    symlinkSync(realTarget, targetFixture.databasePath);
    expect(captureError(() => initializeFixture(targetFixture)).code).toBe("unsafe_path");

    const parentFixture = await fixture();
    const outside = join(parentFixture.root, "outside-database");
    mkdirSync(outside, { mode: 0o700 });
    symlinkSync(outside, join(parentFixture.stateRoot, "database"));
    expect(captureError(() => initializeFixture(parentFixture)).code).toBe("unsafe_path");

    const sidecarFixture = await fixture();
    mkdirSync(join(sidecarFixture.stateRoot, "database"), { mode: 0o700 });
    const outsideSidecar = join(sidecarFixture.root, "outside-wal");
    writeFileSync(outsideSidecar, "unsafe");
    symlinkSync(outsideSidecar, `${sidecarFixture.databasePath}-wal`);
    expect(captureError(() => initializeFixture(sidecarFixture)).code).toBe("unsafe_path");
  });

  it("fails closed for unsafe directory permissions and ownership", async () => {
    const modeFixture = await fixture();
    chmodSync(modeFixture.stateRoot, 0o755);
    expect(captureError(() => initializeFixture(modeFixture)).code).toBe("permission_error");

    if (typeof process.getuid === "function") {
      const ownerFixture = await fixture();
      const ownerSpy = vi.spyOn(process, "getuid").mockReturnValue(process.getuid() + 1);
      try {
        expect(captureError(() => initializeFixture(ownerFixture)).code).toBe("permission_error");
      } finally {
        ownerSpy.mockRestore();
      }
    }
  });

  it("rejects an existing non-SQLite file without changing its bytes or mode", async () => {
    const value = await fixture();
    mkdirSync(join(value.stateRoot, "database"), { mode: 0o700 });
    writeFileSync(value.databasePath, "not sqlite", { mode: 0o640 });
    chmodSync(value.databasePath, 0o640);
    const beforeDigest = digest(value.databasePath);
    const error = captureError(() => initializeFixture(value, false));
    expect(error.code).toBe("invalid_database");
    expect(digest(value.databasePath)).toBe(beforeDigest);
    expect(statSync(value.databasePath).mode & 0o777).toBe(0o640);
  });
});

describe("graph schema drift detection", () => {
  it("fails closed for missing tables and indexes", async () => {
    const tableFixture = await fixture();
    initializeFixture(tableFixture);
    const tableDatabase = raw(tableFixture.databasePath);
    tableDatabase.exec("DROP TABLE graph_evidence");
    tableDatabase.close();
    expect(captureError(() => initializeFixture(tableFixture, false)).code).toBe("incomplete_schema");

    const indexFixture = await fixture();
    initializeFixture(indexFixture);
    const indexDatabase = raw(indexFixture.databasePath);
    indexDatabase.exec("DROP INDEX graph_events_run_idx");
    indexDatabase.close();
    expect(captureError(() => initializeFixture(indexFixture, false)).code).toBe("incomplete_schema");
  });

  it("fails closed for unexpected graph objects and an existing empty database file", async () => {
    const unexpectedFixture = await fixture();
    initializeFixture(unexpectedFixture);
    const unexpectedDatabase = raw(unexpectedFixture.databasePath);
    unexpectedDatabase.exec("CREATE TABLE graph_unexpected(value TEXT)");
    unexpectedDatabase.close();
    expect(captureError(() => initializeFixture(unexpectedFixture, false)).code).toBe("schema_drift");

    const emptyFixture = await fixture();
    mkdirSync(join(emptyFixture.stateRoot, "database"), { mode: 0o700 });
    raw(emptyFixture.databasePath).close();
    expect(captureError(() => initializeFixture(emptyFixture, false)).code).toBe("invalid_database");
  });

  it("fails closed for changed triggers, metadata drift and future versions", async () => {
    const triggerFixture = await fixture();
    initializeFixture(triggerFixture);
    const triggerDatabase = raw(triggerFixture.databasePath);
    triggerDatabase.exec(`
      DROP TRIGGER graph_definitions_immutable_update;
      CREATE TRIGGER graph_definitions_immutable_update
      BEFORE UPDATE ON graph_definitions BEGIN SELECT RAISE(ABORT, 'different'); END;
    `);
    triggerDatabase.close();
    expect(captureError(() => initializeFixture(triggerFixture, false)).code).toBe("schema_drift");

    const metadataFixture = await fixture();
    initializeFixture(metadataFixture);
    const metadataDatabase = raw(metadataFixture.databasePath);
    metadataDatabase.prepare("UPDATE graph_schema_meta SET migration_checksum='wrong'").run();
    metadataDatabase.close();
    expect(captureError(() => initializeFixture(metadataFixture, false)).code).toBe("schema_drift");

    const futureFixture = await fixture();
    initializeFixture(futureFixture);
    const futureDatabase = raw(futureFixture.databasePath);
    futureDatabase.prepare("UPDATE graph_schema_meta SET schema_version=99").run();
    futureDatabase.close();
    expect(captureError(() => initializeFixture(futureFixture, false)).code).toBe("unsupported_schema_version");

    const olderFixture = await fixture();
    initializeFixture(olderFixture);
    const olderDatabase = raw(olderFixture.databasePath);
    olderDatabase.prepare("UPDATE graph_schema_meta SET schema_version=0").run();
    olderDatabase.close();
    expect(captureError(() => initializeFixture(olderFixture, false)).code).toBe("incomplete_schema");
  });

  it("fails closed for partial metadata and malformed databases", async () => {
    const partialFixture = await fixture();
    mkdirSync(join(partialFixture.stateRoot, "database"), { mode: 0o700 });
    const partialDatabase = raw(partialFixture.databasePath);
    partialDatabase.exec("CREATE TABLE graph_schema_meta(schema_name TEXT PRIMARY KEY, schema_version INTEGER NOT NULL)");
    partialDatabase.close();
    expect(captureError(() => initializeFixture(partialFixture, false)).code).toBe("incomplete_schema");

    const malformedFixture = await fixture();
    mkdirSync(join(malformedFixture.stateRoot, "database"), { mode: 0o700 });
    writeFileSync(malformedFixture.databasePath, Buffer.from("malformed"));
    expect(captureError(() => initializeFixture(malformedFixture, false)).code).toBe("invalid_database");
  });

  it("fails independently when foreign-key verification finds an orphan", async () => {
    const value = await fixture();
    initializeFixture(value);
    const database = raw(value.databasePath);
    database.exec("PRAGMA foreign_keys=OFF");
    database.prepare(`
      INSERT INTO graph_runs(
        run_id, graph_id, graph_version, parent_run_id, correlation_id, objective,
        status, current_node_id, state_json, revision, last_progress_at, created_at, updated_at
      ) VALUES ('orphan', 'missing', '1.0.0', NULL, 'correlation', 'objective',
        'created', NULL, '{}', 0, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')
    `).run();
    database.close();
    expect(captureError(() => initializeFixture(value, false)).code).toBe("foreign_key_failed");
  });

  it("keeps the manifest inventory bounded to 14 tables, 11 indexes and 8 triggers", () => {
    expect(GRAPH_SCHEMA_OBJECTS.filter((object) => object.type === "table")).toHaveLength(14);
    expect(GRAPH_SCHEMA_OBJECTS.filter((object) => object.type === "index")).toHaveLength(11);
    expect(GRAPH_SCHEMA_OBJECTS.filter((object) => object.type === "trigger")).toHaveLength(8);
    expect(GRAPH_MIGRATION_CHECKSUM).toMatch(/^[a-f0-9]{64}$/);
    expect(GRAPH_SCHEMA_OBJECTS.every((object) => !/IF NOT EXISTS/i.test(object.sql))).toBe(true);
  });
});
