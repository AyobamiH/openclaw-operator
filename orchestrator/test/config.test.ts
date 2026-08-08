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
  it("normalizes stale OpenClaw workspace roots to the active config root", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-config-"));
    tempRoots.push(root);

    await writeFile(
      join(root, "orchestrator_config.json"),
      JSON.stringify({
        docsPath: "/home/oneclickwebsitedesignfactory/.openclaw/workspace/openclaw-docs",
        cookbookPath:
          "/home/oneclickwebsitedesignfactory/.openclaw/workspace/openai-cookbook",
        logsDir: "/home/oneclickwebsitedesignfactory/.openclaw/workspace/logs",
        stateFile: "mongo:orchestrator-runtime-state",
        deployBaseDir:
          "/home/oneclickwebsitedesignfactory/.openclaw/workspace/agents-deployed",
        rssConfigPath:
          "/home/oneclickwebsitedesignfactory/.openclaw/workspace/rss_filter_config.json",
        redditDraftsPath:
          "/home/oneclickwebsitedesignfactory/.openclaw/workspace/logs/reddit-drafts.jsonl",
        knowledgePackDir:
          "/home/oneclickwebsitedesignfactory/.openclaw/workspace/logs/knowledge-packs",
        runtimeEngagementOsPath:
          "/home/oneclickwebsitedesignfactory/.openclaw/workspace/RUNTIME_ENGAGEMENT_OS.md",
        digestDir:
          "/home/oneclickwebsitedesignfactory/.openclaw/workspace/logs/digests",
      }),
      "utf8",
    );

    const config = await loadConfig(join(root, "orchestrator_config.json"));

    expect(config.docsPath).toBe(join(root, "openclaw-docs"));
    expect(config.cookbookPath).toBe(join(root, "openai-cookbook"));
    expect(config.logsDir).toBe(join(root, "logs"));
    expect(config.stateFile).toBe("mongo:orchestrator-runtime-state");
    expect(config.deployBaseDir).toBe(join(root, "agents-deployed"));
    expect(config.rssConfigPath).toBe(join(root, "rss_filter_config.json"));
    expect(config.redditDraftsPath).toBe(join(root, "logs", "reddit-drafts.jsonl"));
    expect(config.knowledgePackDir).toBe(join(root, "logs", "knowledge-packs"));
    expect(config.runtimeEngagementOsPath).toBe(
      join(root, "RUNTIME_ENGAGEMENT_OS.md"),
    );
    expect(config.digestDir).toBe(join(root, "logs", "digests"));
  });

  it("normalizes container-shaped workspace paths from orchestrator config files", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-config-"));
    const orchestratorDir = join(root, "orchestrator");
    tempRoots.push(root);

    await mkdir(orchestratorDir, { recursive: true });
    await writeFile(
      join(orchestratorDir, "orchestrator_config.json"),
      JSON.stringify({
        docsPath: "/workspace/openclaw-docs",
        logsDir: "/workspace/logs",
        stateFile: "/workspace/orchestrator/data/orchestrator-state.json",
      }),
      "utf8",
    );

    const config = await loadConfig(join(orchestratorDir, "orchestrator_config.json"));

    expect(config.docsPath).toBe(join(root, "openclaw-docs"));
    expect(config.logsDir).toBe(join(root, "logs"));
    expect(config.stateFile).toBe(
      join(root, "orchestrator", "data", "orchestrator-state.json"),
    );
  });

  it("preserves absolute source-controlled project paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-config-"));
    tempRoots.push(root);

    const sourcePath =
      "/home/oneclickwebsitedesignfactory/.openclaw/workspace/projects/openclaw-operator/config/publishing/registry.v1.json";
    await writeFile(
      join(root, "orchestrator_config.json"),
      JSON.stringify({
        docsPath: "./docs",
        logsDir: "./logs",
        stateFile: "./state.json",
        publishingRegistryPath: sourcePath,
      }),
      "utf8",
    );

    const config = await loadConfig(join(root, "orchestrator_config.json"));

    expect(config.publishingRegistryPath).toBe(sourcePath);
  });

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
