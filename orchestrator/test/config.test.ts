import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.js";

const tempRoots: string[] = [];

afterEach(async () => {
  delete process.env.OPENCLAW_OPERATOR_STATE_DIR;
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("config loader", () => {
  it("resolves relative path fields from the config file location", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-config-"));
    tempRoots.push(root);

    await mkdir(join(root, "logs", "knowledge-packs"), { recursive: true });
    await writeFile(
      join(root, "orchestrator_config.json"),
      JSON.stringify({
        docsPath: "./openclaw-docs",
        logsDir: "./logs",
        stateFile: "mongo:test-runtime-state",
        knowledgePackDir: "./logs/knowledge-packs",
        redditDraftsPath: "./logs/reddit-drafts.jsonl",
      }),
      "utf8",
    );

    const config = await loadConfig(join(root, "orchestrator_config.json"));

    expect(config.docsPath).toBe(join(root, "openclaw-docs"));
    expect(config.logsDir).toBe(join(root, "logs"));
    expect(config.knowledgePackDir).toBe(join(root, "logs", "knowledge-packs"));
    expect(config.redditDraftsPath).toBe(join(root, "logs", "reddit-drafts.jsonl"));
    expect(config.stateFile).toBe("mongo:test-runtime-state");
  });

  it("keeps mutable runtime state outside the source tree when an operator state root is declared", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-config-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "openclaw-state-"));
    tempRoots.push(root, stateRoot);
    process.env.OPENCLAW_OPERATOR_STATE_DIR = stateRoot;

    await writeFile(
      join(root, "orchestrator_config.json"),
      JSON.stringify({
        docsPath: "./openclaw-docs",
        logsDir: "./logs",
        stateFile: "./orchestrator/data/orchestrator-state.json",
        publishingDatabasePath: "./logs/deterministic-publishing.sqlite",
      }),
      "utf8",
    );

    const config = await loadConfig(join(root, "orchestrator_config.json"));

    expect(config.logsDir).toBe(join(stateRoot, "logs"));
    expect(config.stateFile).toBe(
      join(stateRoot, "orchestrator", "orchestrator-state.json"),
    );
    expect(config.publishingDatabasePath).toBe(
      join(stateRoot, "database", "deterministic-publishing.sqlite"),
    );
  });

  it("does not activate publishing solely because an operator state root is declared", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-config-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "openclaw-state-"));
    tempRoots.push(root, stateRoot);
    process.env.OPENCLAW_OPERATOR_STATE_DIR = stateRoot;

    await writeFile(
      join(root, "orchestrator_config.json"),
      JSON.stringify({
        docsPath: "./openclaw-docs",
        logsDir: "./logs",
        stateFile: "./orchestrator/data/orchestrator-state.json",
      }),
      "utf8",
    );

    const config = await loadConfig(join(root, "orchestrator_config.json"));

    expect(config.publishingRegistryPath).toBeUndefined();
    expect(config.publishingDatabasePath).toBeUndefined();
  });
});
