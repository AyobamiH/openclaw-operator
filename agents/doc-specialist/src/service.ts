import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Telemetry } from "../../shared/telemetry.js";
import {
  buildTaskPathProof,
  loadRuntimeStateTarget,
  resolveOperatorStatePath,
  resolveRuntimeStateTarget,
  type RuntimeAgentServiceState,
  type RuntimeTaskExecution,
} from "../../shared/runtime-evidence.js";

export interface AgentConfig {
  id: string;
  orchestratorTask?: string;
  orchestratorStatePath: string;
  serviceStatePath: string;
}

interface OrchestratorState {
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
    orchestratorStatePath: resolveRuntimeStateTarget(configPath, parsed.orchestratorStatePath)!,
    serviceStatePath: resolveOperatorStatePath(
      configPath,
      parsed.serviceStatePath,
      "logs/doc-specialist-service.json",
    ),
  };
}

async function loadState(path: string): Promise<OrchestratorState> {
  return loadRuntimeStateTarget<OrchestratorState>(path, {});
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

export async function observeOnce(config: AgentConfig) {
  const state = await loadState(config.orchestratorStatePath);
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
      typeof taskPath.successfulRuns === "number"
        ? taskPath.successfulRuns
        : existing.successCount,
    errorCount:
      typeof taskPath.failedRuns === "number"
        ? taskPath.failedRuns
        : existing.errorCount,
    totalRuns:
      typeof taskPath.totalRuns === "number"
        ? taskPath.totalRuns
        : existing.totalRuns,
    serviceHeartbeat: {
      checkedAt: now,
      status: "ok",
      errorSummary: null,
      source: "service-loop",
    },
    taskPath,
  });
  return state;
}

async function loop() {
  assertServiceBoundary();
  const config = await loadConfig();
  while (true) {
    try {
      await observeOnce(config);
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

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  loop().catch(async (error) => {
    await telemetry.error("service.fatal", { message: (error as Error).message });
    process.exit(1);
  });
}
