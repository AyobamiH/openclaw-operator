import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { DataPersistence } from "./persistence/data-persistence.js";
import {
  NORMALIZED_SQLITE_SCHEMA_NAME,
  NORMALIZED_SQLITE_SCHEMA_VERSION,
} from "./persistence/sqlite-data-persistence.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const MONGO_STATE_PREFIX = "mongo:";
const SQLITE_STATE_PREFIX = "sqlite:";

export type StateStoreKind = "file" | "mongo" | "sqlite";

export interface StateStore<T> {
  target: string;
  kind: StateStoreKind;
  ensureReady(): Promise<void>;
  load(): Promise<T | null>;
  save(value: T): Promise<void>;
}

export type SqliteStateMigrationEvidence = {
  sourcePath: string;
  targetPath: string;
  schemaVersion: number;
  sectionCount: number;
  payloadBytes: number;
  sha256: string;
  topLevelArrayCounts: Record<string, number>;
};

export function isMongoStateTarget(target: string) {
  return typeof target === "string" && target.startsWith(MONGO_STATE_PREFIX);
}

export function isSqliteStateTarget(target: string) {
  return typeof target === "string" && target.startsWith(SQLITE_STATE_PREFIX);
}

export function getStateStoreKind(target: string): StateStoreKind {
  if (isMongoStateTarget(target)) return "mongo";
  if (isSqliteStateTarget(target)) return "sqlite";
  return "file";
}

function resolveMongoStateKey(target: string) {
  const key = target.slice(MONGO_STATE_PREFIX.length).trim();
  if (!key) {
    throw new Error("mongo state target must include a non-empty key");
  }
  return key;
}

export function resolveSqliteStatePath(target: string) {
  const path = target.slice(SQLITE_STATE_PREFIX.length).trim();
  if (!path) {
    throw new Error("sqlite state target must include a non-empty path");
  }
  return path;
}

export function resolveMongoFallbackPath(key: string) {
  const safeKey = key.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const operatorStateRoot = process.env.OPENCLAW_OPERATOR_STATE_DIR?.trim();
  const fallbackDir =
    process.env.ORCHESTRATOR_STATE_FALLBACK_DIR?.trim() ||
    (operatorStateRoot
      ? join(operatorStateRoot, "orchestrator", "fallback")
      : join(process.cwd(), "data"));
  return join(fallbackDir, `${safeKey}.fallback.json`);
}

async function loadLocalFallback<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function saveLocalFallback<T>(path: string, value: T): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

function stateTimestamp(value: unknown): number {
  if (!value || typeof value !== "object") return Number.NaN;
  const updatedAt = (value as { updatedAt?: unknown }).updatedAt;
  return typeof updatedAt === "string" ? Date.parse(updatedAt) : Number.NaN;
}

function preferNewerState<T>(primary: T, fallback: T | null): T {
  if (!fallback) return primary;
  const primaryTime = stateTimestamp(primary);
  const fallbackTime = stateTimestamp(fallback);
  if (Number.isFinite(fallbackTime) && (!Number.isFinite(primaryTime) || fallbackTime > primaryTime)) {
    return fallback;
  }
  return primary;
}

function createFileStateStore<T>(target: string): StateStore<T> {
  return {
    target,
    kind: "file",
    async ensureReady() {
      await mkdir(dirname(target), { recursive: true });
    },
    async load() {
      if (!existsSync(target)) {
        return null;
      }
      const raw = await readFile(target, "utf-8");
      return JSON.parse(raw) as T;
    },
    async save(value) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, JSON.stringify(value, null, 2), "utf-8");
    },
  };
}

function createMongoStateStore<T>(target: string): StateStore<T> {
  const key = resolveMongoStateKey(target);
  const fallbackPath = resolveMongoFallbackPath(key);
  return {
    target,
    kind: "mongo",
    async ensureReady() {
      // Mongo-backed state does not require local directory setup.
    },
    async load() {
      const fallback = await loadLocalFallback<T>(fallbackPath);
      try {
        const persisted = await DataPersistence.getSystemState(key);
        if (!persisted || typeof persisted !== "object") {
          return fallback;
        }
        const selected = preferNewerState(persisted as T, fallback);
        await saveLocalFallback(fallbackPath, selected);
        if (selected === fallback) {
          console.warn(`[state] local fallback is newer than Mongo state for ${key}; using local snapshot`);
        }
        return selected;
      } catch (error) {
        if (!fallback || process.env.STRICT_PERSISTENCE === "true") throw error;
        console.warn(
          `[state] Mongo load failed for ${key}; using local fallback: ${(error as Error).message}`,
        );
        return fallback;
      }
    },
    async save(value) {
      await saveLocalFallback(fallbackPath, value);
      try {
        await DataPersistence.saveSystemState(key, value);
      } catch (error) {
        if (process.env.STRICT_PERSISTENCE === "true") throw error;
        console.warn(
          `[state] Mongo save failed for ${key}; state remains durable in ${fallbackPath}: ${(error as Error).message}`,
        );
      }
    },
  };
}

async function openSqliteStateDatabase(target: string): Promise<InstanceType<typeof DatabaseSync>> {
  const path = resolveSqliteStatePath(target);
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec(`
    CREATE TABLE IF NOT EXISTS operator_schema_meta (
      schema_name TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orchestrator_state_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      payload_bytes INTEGER NOT NULL,
      section_count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orchestrator_state_sections (
      section_key TEXT PRIMARY KEY,
      ordinal INTEGER NOT NULL UNIQUE,
      value_type TEXT NOT NULL,
      item_count INTEGER,
      payload_json TEXT,
      payload_bytes INTEGER NOT NULL,
      payload_sha256 TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orchestrator_state_array_items (
      section_key TEXT NOT NULL,
      item_index INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      payload_bytes INTEGER NOT NULL,
      payload_sha256 TEXT NOT NULL,
      PRIMARY KEY (section_key, item_index),
      FOREIGN KEY (section_key) REFERENCES orchestrator_state_sections(section_key) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_state_array_items_section
      ON orchestrator_state_array_items(section_key, item_index);
  `);
  const legacy = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orchestrator_state'",
  ).get();
  if (legacy) {
    const count = Number((database.prepare("SELECT COUNT(*) AS count FROM orchestrator_state").get() as { count: number }).count);
    if (count > 0) {
      database.close();
      throw new Error(
        "legacy single-row sqlite state is unsupported; create a fresh normalized-v2 target",
      );
    }
  }
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO operator_schema_meta (schema_name, schema_version, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(schema_name) DO UPDATE SET
      schema_version = excluded.schema_version,
      updated_at = excluded.updated_at
  `).run(NORMALIZED_SQLITE_SCHEMA_NAME, NORMALIZED_SQLITE_SCHEMA_VERSION, now, now);
  return database;
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function itemCount(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return null;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createSqliteStateStore<T>(target: string): StateStore<T> {
  return {
    target,
    kind: "sqlite",
    async ensureReady() {
      const database = await openSqliteStateDatabase(target);
      database.close();
    },
    async load() {
      const database = await openSqliteStateDatabase(target);
      try {
        const meta = database.prepare(
          "SELECT version, payload_sha256, payload_bytes, section_count FROM orchestrator_state_meta WHERE id = 1",
        ).get() as {
          version: number;
          payload_sha256: string;
          payload_bytes: number;
          section_count: number;
        } | undefined;
        if (!meta) return null;
        if (meta.version !== NORMALIZED_SQLITE_SCHEMA_VERSION) {
          throw new Error(
            `unsupported normalized sqlite state version=${meta.version}`,
          );
        }
        const rows = database.prepare(`
          SELECT section_key, value_type, payload_json, payload_bytes, payload_sha256
          FROM orchestrator_state_sections
          ORDER BY ordinal
        `).all() as Array<{
          section_key: string;
          value_type: string;
          payload_json: string | null;
          payload_bytes: number;
          payload_sha256: string;
        }>;
        if (rows.length !== meta.section_count) {
          throw new Error(`sqlite state section count mismatch expected=${meta.section_count} actual=${rows.length}`);
        }
        const reconstructed: Record<string, unknown> = {};
        for (const row of rows) {
          let sectionPayload: string;
          if (row.value_type === "array") {
            const itemRows = database.prepare(`
              SELECT item_index, payload_json, payload_bytes, payload_sha256
              FROM orchestrator_state_array_items
              WHERE section_key = ?
              ORDER BY item_index
            `).all(row.section_key) as Array<{
              item_index: number;
              payload_json: string;
              payload_bytes: number;
              payload_sha256: string;
            }>;
            const items = itemRows.map((item, expectedIndex) => {
              const itemBytes = Buffer.byteLength(item.payload_json, "utf8");
              if (
                item.item_index !== expectedIndex ||
                itemBytes !== item.payload_bytes ||
                digest(item.payload_json) !== item.payload_sha256
              ) {
                throw new Error(
                  `sqlite state array item checksum mismatch section=${row.section_key} index=${item.item_index}`,
                );
              }
              return JSON.parse(item.payload_json);
            });
            sectionPayload = JSON.stringify(items);
          } else {
            if (row.payload_json === null) {
              throw new Error(`sqlite state section payload missing section=${row.section_key}`);
            }
            sectionPayload = row.payload_json;
          }
          const bytes = Buffer.byteLength(sectionPayload, "utf8");
          if (bytes !== row.payload_bytes || digest(sectionPayload) !== row.payload_sha256) {
            throw new Error(`sqlite state section checksum mismatch section=${row.section_key}`);
          }
          reconstructed[row.section_key] = JSON.parse(sectionPayload);
        }
        const payload = JSON.stringify(reconstructed);
        const bytes = Buffer.byteLength(payload, "utf8");
        if (bytes !== meta.payload_bytes || digest(payload) !== meta.payload_sha256) {
          throw new Error("sqlite state aggregate checksum mismatch");
        }
        return reconstructed as T;
      } finally {
        database.close();
      }
    },
    async save(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("normalized sqlite state requires a top-level object");
      }
      const payload = JSON.stringify(value);
      const database = await openSqliteStateDatabase(target);
      try {
        const entries = Object.entries(value as Record<string, unknown>);
        database.exec("BEGIN IMMEDIATE");
        try {
          database.exec("DELETE FROM orchestrator_state_array_items");
          database.exec("DELETE FROM orchestrator_state_sections");
          const insertSection = database.prepare(`
            INSERT INTO orchestrator_state_sections
              (section_key, ordinal, value_type, item_count, payload_json, payload_bytes, payload_sha256)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
          const insertArrayItem = database.prepare(`
            INSERT INTO orchestrator_state_array_items
              (section_key, item_index, payload_json, payload_bytes, payload_sha256)
            VALUES (?, ?, ?, ?, ?)
          `);
          entries.forEach(([key, section], ordinal) => {
            const sectionPayload = JSON.stringify(section);
            insertSection.run(
              key,
              ordinal,
              valueType(section),
              itemCount(section),
              Array.isArray(section) ? null : sectionPayload,
              Buffer.byteLength(sectionPayload, "utf8"),
              digest(sectionPayload),
            );
            if (Array.isArray(section)) {
              section.forEach((item, index) => {
                const itemPayload = JSON.stringify(item);
                insertArrayItem.run(
                  key,
                  index,
                  itemPayload,
                  Buffer.byteLength(itemPayload, "utf8"),
                  digest(itemPayload),
                );
              });
            }
          });
          database.prepare(`
            INSERT INTO orchestrator_state_meta
              (id, version, updated_at, payload_sha256, payload_bytes, section_count)
            VALUES (1, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              version = excluded.version,
              updated_at = excluded.updated_at,
              payload_sha256 = excluded.payload_sha256,
              payload_bytes = excluded.payload_bytes,
              section_count = excluded.section_count
          `).run(
            NORMALIZED_SQLITE_SCHEMA_VERSION,
            new Date().toISOString(),
            digest(payload),
            Buffer.byteLength(payload, "utf8"),
            entries.length,
          );
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      } finally {
        database.close();
      }
    },
  };
}

function topLevelArrayCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
      .map(([key, items]) => [key, items.length])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}

export async function rehearseJsonStateToSqlite(
  sourcePath: string,
  target: string,
): Promise<SqliteStateMigrationEvidence> {
  const targetPath = resolveSqliteStatePath(target);
  if (existsSync(targetPath)) {
    throw new Error(`sqlite migration target already exists: ${targetPath}`);
  }
  const sourceRaw = await readFile(sourcePath, "utf8");
  const sourceState = JSON.parse(sourceRaw) as unknown;
  const store = createSqliteStateStore<unknown>(target);
  await store.save(sourceState);
  const loaded = await store.load();
  const payload = JSON.stringify(loaded);
  if (payload !== JSON.stringify(sourceState)) {
    throw new Error("sqlite migration round-trip verification failed");
  }
  const database = new DatabaseSync(targetPath, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").get() as {
      integrity_check?: string;
    };
    if (integrity.integrity_check !== "ok") {
      throw new Error(`sqlite integrity check failed: ${integrity.integrity_check ?? "unknown"}`);
    }
  } finally {
    database.close();
  }
  return {
    sourcePath,
    targetPath,
    schemaVersion: NORMALIZED_SQLITE_SCHEMA_VERSION,
    sectionCount: Object.keys((loaded ?? {}) as Record<string, unknown>).length,
    payloadBytes: Buffer.byteLength(payload, "utf8"),
    sha256: createHash("sha256").update(payload).digest("hex"),
    topLevelArrayCounts: topLevelArrayCounts(loaded),
  };
}

export function createStateStore<T>(target: string): StateStore<T> {
  if (isMongoStateTarget(target)) return createMongoStateStore<T>(target);
  if (isSqliteStateTarget(target)) return createSqliteStateStore<T>(target);
  return createFileStateStore<T>(target);
}
