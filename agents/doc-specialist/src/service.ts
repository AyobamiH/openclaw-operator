import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Telemetry } from "../../shared/telemetry.js";
import {
  buildTaskPathProof,
  loadRuntimeStateTarget,
  resolveRuntimeStateTarget,
  saveRuntimeStateTarget,
  type RuntimeAgentServiceState,
  type RuntimeTaskExecution,
} from "../../shared/runtime-evidence.js";
import { enforceKnowledgePackRetention } from "./knowledge-pack-retention.js";

interface AgentConfig {
  id: string;
  orchestratorTask?: string;
  docsPath: string;
  knowledgePackDir: string;
  orchestratorStatePath: string;
  serviceStatePath: string;
}

interface OrchestratorState {
  pendingDocChanges?: string[];
  driftRepairs?: Array<Record<string, unknown>>;
  lastDriftRepairAt?: string | null;
  taskExecutions?: RuntimeTaskExecution[];
}

const telemetry = new Telemetry({ component: "doc-specialist-service" });
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function assertServiceBoundary() {
  if (process.env.ALLOW_DIRECT_SERVICE !== "true") {
    throw new Error("Direct service execution blocked. Set ALLOW_DIRECT_SERVICE=true for system-managed runs.");
  }
}

async function loadConfig(): Promise<AgentConfig> {
  const configPath = resolve(__dirname, "../agent.config.json");
  const raw = await readFile(configPath, "utf-8");
  const parsed = JSON.parse(raw) as AgentConfig;
  return {
    id: parsed.id,
    orchestratorTask: parsed.orchestratorTask,
    docsPath: resolve(dirname(configPath), parsed.docsPath),
    knowledgePackDir: resolve(dirname(configPath), parsed.knowledgePackDir),
    orchestratorStatePath: resolveRuntimeStateTarget(configPath, parsed.orchestratorStatePath)!,
    serviceStatePath: resolve(dirname(configPath), parsed.serviceStatePath),
  };
}

function summarize(content: string, maxChars = 600) {
  const collapsed = content.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars)}…`;
}

function extractHeading(content: string) {
  const match = content.match(/^#\s+(.+)$/m) ?? content.match(/^##\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}

async function readDoc(path: string) {
  const raw = await readFile(path, "utf-8");
  return {
    path,
    summary: summarize(raw),
    wordCount: raw.split(/\s+/).filter(Boolean).length,
    bytes: Buffer.byteLength(raw, "utf-8"),
    firstHeading: extractHeading(raw),
  };
}

async function loadState(path: string): Promise<OrchestratorState> {
  return loadRuntimeStateTarget<OrchestratorState>(path, {});
}

async function saveState(path: string, state: OrchestratorState) {
  await saveRuntimeStateTarget(path, state);
}

async function loadServiceState(path: string): Promise<RuntimeAgentServiceState> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as RuntimeAgentServiceState;
  } catch {
    return {};
  }
}

async function saveServiceState(path: string, state: RuntimeAgentServiceState) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), "utf-8");
}

async function runOnce(config: AgentConfig) {
  const state = await loadState(config.orchestratorStatePath);
  const pending = state.pendingDocChanges ?? [];
  if (!pending.length) {
    return state;
  }

  await telemetry.info("drift.start", { count: pending.length });

  const docs = [] as Array<Record<string, unknown>>;
  for (const docPath of pending) {
    const absolute = resolve(config.docsPath, docPath.replace(/^\.\//, ""));
    try {
      docs.push(await readDoc(absolute));
    } catch (error) {
      await telemetry.warn("doc.read_failed", { path: docPath, message: (error as Error).message });
    }
  }

  await mkdir(config.knowledgePackDir, { recursive: true });
  const packId = `knowledge-pack-${Date.now()}`;
  const packPath = resolve(config.knowledgePackDir, `${packId}.json`);
  await writeFile(
    packPath,
    JSON.stringify({ id: packId, generatedAt: new Date().toISOString(), docs }, null, 2),
    "utf-8",
  );
  const retention = await enforceKnowledgePackRetention({
    directory: config.knowledgePackDir,
  });

  state.pendingDocChanges = [];
  state.driftRepairs = [...(state.driftRepairs ?? []), {
    runId: packId,
    requestedBy: "service",
    processedPaths: pending,
    generatedPackIds: [packId],
    packPaths: [packPath],
    docsProcessed: docs.length,
    updatedAgents: ["doc-doctor"],
    durationMs: 0,
    completedAt: new Date().toISOString(),
  }];
  state.lastDriftRepairAt = new Date().toISOString();
  await saveState(config.orchestratorStatePath, state);

  await telemetry.info("drift.complete", {
    packPath,
    docsProcessed: docs.length,
    retention,
  });
  return state;
}

async function loop() {
  assertServiceBoundary();
  const config = await loadConfig();
  while (true) {
    try {
      const state = await runOnce(config);
      const now = new Date().toISOString();
      const existing = await loadServiceState(config.serviceStatePath);
      const taskPath = buildTaskPathProof(
        state.taskExecutions ?? [],
        config.orchestratorTask ?? "drift-repair",
      );
      await saveServiceState(config.serviceStatePath, {
        ...existing,
        memoryVersion: 2,
        runtimeProofVersion: 1,
        agentId: config.id,
        orchestratorStatePath: config.orchestratorStatePath,
        lastRunAt: now,
        lastStatus: "ok",
        lastTaskType: taskPath.taskType ?? config.orchestratorTask ?? "drift-repair",
        lastError: null,
        successCount:
          typeof taskPath.successfulRuns === "number" ? taskPath.successfulRuns : existing.successCount,
        errorCount:
          typeof taskPath.failedRuns === "number" ? taskPath.failedRuns : existing.errorCount,
        totalRuns:
          typeof taskPath.totalRuns === "number" ? taskPath.totalRuns : existing.totalRuns,
        serviceHeartbeat: {
          checkedAt: now,
          status: "ok",
          errorSummary: null,
          source: "service-loop",
        },
        taskPath,
      });
    } catch (error) {
      const message = (error as Error).message;
      await telemetry.error("service.error", { message });
      const existing = await loadServiceState(config.serviceStatePath);
      const now = new Date().toISOString();
      await saveServiceState(config.serviceStatePath, {
        ...existing,
        memoryVersion: 2,
        runtimeProofVersion: 1,
        agentId: config.id,
        orchestratorStatePath: config.orchestratorStatePath,
        lastRunAt: now,
        lastStatus: "error",
        lastError: message,
        serviceHeartbeat: {
          checkedAt: now,
          status: "error",
          errorSummary: message,
          source: "service-loop",
        },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

loop().catch(async (error) => {
  await telemetry.error("service.fatal", { message: (error as Error).message });
  process.exit(1);
});
