import { homedir } from "node:os";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
  type Stats,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { GraphStore } from "./store.js";
import { GraphPersistenceError, type GraphPersistenceErrorCode } from "./schema-verifier.js";

export type GraphDatabaseInitializationResult = {
  status: "initialised" | "already_initialised";
  path: string;
  schemaVersion: number;
  userVersion: number;
  migrationId: string;
  migrationChecksum: string;
  appliedAt: string;
  created: boolean;
  alreadyInitialised: boolean;
  integrityCheck: "ok";
  foreignKeyCheck: "ok";
  mode: "0600";
  tables: number;
  indexes: number;
  triggers: number;
  executionRows: number;
  schemaFingerprint: string;
};

export type InitializeGraphDatabaseOptions = {
  path: string;
  expectAbsent?: boolean;
  stateRoot?: string;
  testOnlyAllowUnsafePath?: boolean;
};

function lstatIfPresent(path: string): Stats | null {
  try {
    return lstatSync(path) as Stats;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const nested = relative(root, candidate);
  return nested === "" || (!nested.startsWith(`..${sep}`) && nested !== ".." && !isAbsolute(nested));
}

function fail(code: GraphPersistenceErrorCode, message: string, details: Record<string, unknown> = {}): never {
  throw new GraphPersistenceError(code, message, details);
}

function assertSecureDirectory(path: string, value: Stats): void {
  const expectedUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (expectedUid !== null && value.uid !== expectedUid) {
    fail("permission_error", "graph_database_directory_owner_mismatch", {
      path,
      expectedUid,
      observedUid: value.uid,
    });
  }
  if ((value.mode & 0o077) !== 0) {
    fail("permission_error", "graph_database_directory_not_owner_only", {
      path,
      observedMode: (value.mode & 0o777).toString(8),
    });
  }
}

function assertSqliteHeader(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    const header = Buffer.alloc(16);
    const bytes = readSync(descriptor, header, 0, header.length, 0);
    if (bytes !== 16 || header.toString("utf8") !== "SQLite format 3\u0000") {
      fail("invalid_database", "graph_database_file_is_not_sqlite", { path });
    }
  } finally {
    closeSync(descriptor);
  }
}

export function resolveGraphInitializerStateRoot(configured = process.env.OPENCLAW_OPERATOR_STATE_DIR): string {
  const value = configured?.trim();
  return resolve(value || join(homedir(), ".openclaw", "state", "openclaw-operator"));
}

function assertSafePath(options: Required<Pick<InitializeGraphDatabaseOptions, "path" | "stateRoot" | "testOnlyAllowUnsafePath">>): void {
  const databasePath = options.path;
  const stateRoot = resolve(options.stateRoot);
  if (!isAbsolute(databasePath)) fail("unsafe_path", "graph_database_path_must_be_absolute", { path: databasePath });
  if (!databasePath.endsWith(`${sep}database${sep}graph-runs.sqlite`)) {
    fail("unsafe_path", "graph_database_path_must_end_in_database_graph_runs_sqlite", { path: databasePath });
  }
  const segments = resolve(databasePath).split(sep).filter(Boolean);
  if (segments.includes("orchestrator") || segments.includes("dist")) {
    fail("unsafe_path", "graph_database_source_tree_path_rejected", { path: databasePath });
  }
  if (!options.testOnlyAllowUnsafePath) {
    const expected = join(stateRoot, "database", "graph-runs.sqlite");
    if (resolve(databasePath) !== expected) {
      fail("unsafe_path", "graph_database_path_outside_verified_state_root", { path: databasePath, expected });
    }
  }

  const rootStat = lstatIfPresent(stateRoot);
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail("unsafe_path", "graph_database_state_root_missing_or_unsafe", { stateRoot });
  }
  assertSecureDirectory(stateRoot, rootStat);

  const target = lstatIfPresent(databasePath);
  if (target?.isSymbolicLink()) fail("unsafe_path", "graph_database_symlink_target_rejected", { path: databasePath });
  if (target) {
    const expectedUid = typeof process.getuid === "function" ? process.getuid() : null;
    if (expectedUid !== null && target.uid !== expectedUid) {
      fail("permission_error", "graph_database_owner_mismatch", { expectedUid, observedUid: target.uid });
    }
  }
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecarPath = `${databasePath}${suffix}`;
    const sidecar = lstatIfPresent(sidecarPath);
    if (sidecar && (sidecar.isSymbolicLink() || !sidecar.isFile())) {
      fail("unsafe_path", "graph_database_sidecar_is_unsafe", { path: sidecarPath });
    }
  }

  const parent = dirname(databasePath);
  if (!isWithin(stateRoot, parent) && !options.testOnlyAllowUnsafePath) {
    fail("unsafe_path", "graph_database_parent_outside_verified_state_root", { parent, stateRoot });
  }

  let cursor = parent;
  const pending: string[] = [];
  while (!existsSync(cursor)) {
    pending.push(cursor);
    const next = dirname(cursor);
    if (next === cursor) fail("unsafe_path", "graph_database_parent_has_no_safe_ancestor", { parent });
    cursor = next;
  }
  const ancestor = lstatSync(cursor);
  if (!ancestor.isDirectory() || ancestor.isSymbolicLink()) {
    fail("unsafe_path", "graph_database_parent_ancestor_is_unsafe", { ancestor: cursor });
  }
  if (isWithin(stateRoot, cursor)) assertSecureDirectory(cursor, ancestor);
  if (!options.testOnlyAllowUnsafePath && realpathSync(cursor) !== resolve(cursor)) {
    fail("unsafe_path", "graph_database_parent_contains_symlink", { ancestor: cursor });
  }
  for (const path of pending.reverse()) mkdirSync(path, { mode: 0o700 });

  let checked = stateRoot;
  const relativeParent = relative(stateRoot, parent);
  if (relativeParent && !relativeParent.startsWith("..")) {
    for (const segment of relativeParent.split(sep)) {
      checked = join(checked, segment);
      const checkedStat = lstatSync(checked);
      if (!checkedStat.isDirectory() || checkedStat.isSymbolicLink()) {
        fail("unsafe_path", "graph_database_parent_contains_symlink", { path: checked });
      }
      assertSecureDirectory(checked, checkedStat);
    }
  }
}

function mapOpenError(error: unknown): never {
  if (error instanceof GraphPersistenceError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (/not a database|file is encrypted/i.test(message)) {
    throw new GraphPersistenceError("invalid_database", "graph_database_file_is_not_sqlite", {}, { cause: error });
  }
  if (/permission|readonly|access/i.test(message)) {
    throw new GraphPersistenceError("permission_error", "graph_database_permission_error", {}, { cause: error });
  }
  throw error;
}

export function initializeGraphDatabase(options: InitializeGraphDatabaseOptions): GraphDatabaseInitializationResult {
  const stateRoot = resolveGraphInitializerStateRoot(options.stateRoot);
  const databasePath = options.path;
  assertSafePath({ path: databasePath, stateRoot, testOnlyAllowUnsafePath: options.testOnlyAllowUnsafePath === true });
  const targetBefore = lstatIfPresent(databasePath);
  if (options.expectAbsent && targetBefore) {
    fail("target_exists", "graph_database_target_exists", { path: databasePath });
  }
  if (targetBefore && !targetBefore.isFile()) {
    fail("unsafe_path", "graph_database_target_is_not_regular_file", { path: databasePath });
  }
  if (targetBefore) assertSqliteHeader(databasePath);

  let store: GraphStore;
  try {
    store = new GraphStore(databasePath);
  } catch (error) {
    return mapOpenError(error);
  }
  try {
    const verification = store.schemaVerification({
      requireEmptyExecutionState: targetBefore === null,
    });
    store.checkpointAndSecure();
    const file = statSync(databasePath);
    const mode = file.mode & 0o777;
    if (mode !== 0o600) {
      fail("permission_error", "graph_database_mode_not_owner_only", { observedMode: mode.toString(8) });
    }
    const expectedUid = typeof process.getuid === "function" ? process.getuid() : null;
    if (expectedUid !== null && file.uid !== expectedUid) {
      fail("permission_error", "graph_database_owner_mismatch", { expectedUid, observedUid: file.uid });
    }
    return {
      status: targetBefore ? "already_initialised" : "initialised",
      path: databasePath,
      schemaVersion: verification.schemaVersion,
      userVersion: verification.userVersion,
      migrationId: verification.migrationId,
      migrationChecksum: verification.migrationChecksum,
      appliedAt: verification.appliedAt,
      created: targetBefore === null,
      alreadyInitialised: targetBefore !== null,
      integrityCheck: verification.integrityCheck,
      foreignKeyCheck: verification.foreignKeyCheck,
      mode: "0600",
      tables: verification.tables.length,
      indexes: verification.indexes.length,
      triggers: verification.triggers.length,
      executionRows: Object.values(verification.rowCounts).reduce((sum, count) => sum + count, 0),
      schemaFingerprint: verification.schemaFingerprint,
    };
  } finally {
    store.close();
  }
}
