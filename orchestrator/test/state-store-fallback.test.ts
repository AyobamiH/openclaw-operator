import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { DataPersistence } from "../src/persistence/data-persistence.ts";
import {
  createStateStore,
  getStateStoreKind,
  resolveMongoFallbackPath,
  resolveSqliteStatePath,
  rehearseJsonStateToSqlite,
} from "../src/state-store.ts";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const roots: string[] = [];
const originalFallbackDir = process.env.ORCHESTRATOR_STATE_FALLBACK_DIR;
const originalOperatorStateDir = process.env.OPENCLAW_OPERATOR_STATE_DIR;
const originalStrictPersistence = process.env.STRICT_PERSISTENCE;

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalFallbackDir === undefined) delete process.env.ORCHESTRATOR_STATE_FALLBACK_DIR;
  else process.env.ORCHESTRATOR_STATE_FALLBACK_DIR = originalFallbackDir;
  if (originalOperatorStateDir === undefined) delete process.env.OPENCLAW_OPERATOR_STATE_DIR;
  else process.env.OPENCLAW_OPERATOR_STATE_DIR = originalOperatorStateDir;
  if (originalStrictPersistence === undefined) delete process.env.STRICT_PERSISTENCE;
  else process.env.STRICT_PERSISTENCE = originalStrictPersistence;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SQLite state store", () => {
  it("round-trips versioned JSON state through a fresh WAL database", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-state-sqlite-"));
    roots.push(root);
    const path = join(root, "runtime-state.sqlite");
    const target = `sqlite:${path}`;
    const store = createStateStore<{ updatedAt: string; value: number }>(target);

    expect(getStateStoreKind(target)).toBe("sqlite");
    expect(resolveSqliteStatePath(target)).toBe(path);
    expect(await store.load()).toBeNull();

    const state = { updatedAt: "2026-07-15T20:00:00.000Z", value: 11 };
    await store.save(state);
    expect(await store.load()).toEqual(state);

    const database = new DatabaseSync(path, { readOnly: true });
    try {
      expect(database.prepare("PRAGMA journal_mode").get()).toMatchObject({ journal_mode: "wal" });
      expect(database.prepare("PRAGMA integrity_check").get()).toMatchObject({ integrity_check: "ok" });
      expect(database.prepare("SELECT version, section_count FROM orchestrator_state_meta WHERE id = 1").get())
        .toMatchObject({ version: 2, section_count: 2 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM orchestrator_state_sections").get())
        .toMatchObject({ count: 2 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM orchestrator_state_array_items").get())
        .toMatchObject({ count: 0 });
      expect(database.prepare("SELECT schema_version FROM operator_schema_meta WHERE schema_name = 'openclaw-operator-normalized'").get())
        .toMatchObject({ schema_version: 2 });
    } finally {
      database.close();
    }
  });

  it("rejects sqlite targets without a database path", () => {
    expect(() => resolveSqliteStatePath("sqlite:   ")).toThrow(
      "sqlite state target must include a non-empty path",
    );
  });

  it("rehearses a JSON import with integrity, checksum, and count evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-state-sqlite-import-"));
    roots.push(root);
    const sourcePath = join(root, "fallback.json");
    const targetPath = join(root, "fresh-runtime.sqlite");
    await writeFile(sourcePath, JSON.stringify({ tasks: [{ id: 1 }, { id: 2 }], approvals: [] }));

    const evidence = await rehearseJsonStateToSqlite(sourcePath, `sqlite:${targetPath}`);

    expect(evidence.targetPath).toBe(targetPath);
    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.sectionCount).toBe(2);
    expect(evidence.payloadBytes).toBeGreaterThan(0);
    expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.topLevelArrayCounts).toEqual({ approvals: 0, tasks: 2 });
    const database = new DatabaseSync(targetPath, { readOnly: true });
    try {
      expect(database.prepare("SELECT COUNT(*) AS count FROM orchestrator_state_array_items").get())
        .toMatchObject({ count: 2 });
    } finally {
      database.close();
    }
    await expect(rehearseJsonStateToSqlite(sourcePath, `sqlite:${targetPath}`))
      .rejects.toThrow("sqlite migration target already exists");
  });
});

describe("Mongo state-store local fallback", () => {
  it("places fallback snapshots under the declared operator state root", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-operator-state-"));
    roots.push(root);
    delete process.env.ORCHESTRATOR_STATE_FALLBACK_DIR;
    process.env.OPENCLAW_OPERATOR_STATE_DIR = root;

    expect(resolveMongoFallbackPath("test-state")).toBe(
      join(root, "orchestrator", "fallback", "test-state.fallback.json"),
    );
  });

  it("keeps state durable locally when a Mongo save fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-state-fallback-"));
    roots.push(root);
    process.env.ORCHESTRATOR_STATE_FALLBACK_DIR = root;
    delete process.env.STRICT_PERSISTENCE;
    vi.spyOn(DataPersistence, "saveSystemState").mockRejectedValue(new Error("mongo unavailable"));
    vi.spyOn(DataPersistence, "getSystemState").mockRejectedValue(new Error("mongo unavailable"));

    const store = createStateStore<{ updatedAt: string; value: number }>("mongo:test-state");
    const state = { updatedAt: "2026-07-14T20:40:00.000Z", value: 7 };
    await store.save(state);

    expect(await store.load()).toEqual(state);
    expect(JSON.parse(await readFile(resolveMongoFallbackPath("test-state"), "utf8"))).toEqual(state);
  });

  it("uses a newer local snapshot instead of stale Mongo state", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-state-newer-"));
    roots.push(root);
    process.env.ORCHESTRATOR_STATE_FALLBACK_DIR = root;
    delete process.env.STRICT_PERSISTENCE;
    const saveSpy = vi.spyOn(DataPersistence, "saveSystemState").mockResolvedValue();
    vi.spyOn(DataPersistence, "getSystemState").mockResolvedValue({
      updatedAt: "2026-07-14T20:00:00.000Z",
      value: 1,
    });

    const store = createStateStore<{ updatedAt: string; value: number }>("mongo:test-state");
    await store.save({ updatedAt: "2026-07-14T20:40:00.000Z", value: 2 });
    saveSpy.mockClear();

    expect(await store.load()).toEqual({
      updatedAt: "2026-07-14T20:40:00.000Z",
      value: 2,
    });
  });
});
