import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Telemetry } from "../../shared/telemetry.js";
import {
  buildTaskPathProof,
  loadRuntimeStateTarget,
  resolveRuntimeStateTarget,
  type RuntimeAgentServiceState,
  type RuntimeTaskExecution,
} from "../../shared/runtime-evidence.js";

interface AgentConfig {
  id: string;
  orchestratorTask?: string;
  orchestratorStatePath: string;
  serviceStatePath: string;
  heartbeat?: {
    interval?: string | number;
  };
  permissions?: {
    skills?: Record<string, { allowed?: boolean }>;
  };
}

interface OrchestratorState {
  taskExecutions?: RuntimeTaskExecution[];
}

interface ResolvedConfig {
  id: string;
  orchestratorTask: string;
  orchestratorStatePath: string;
  serviceStatePath: string;
  heartbeatIntervalMs: number;
  documentParserAllowed: boolean;
}

const telemetry = new Telemetry({ component: "release-manager-agent-service" });
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function assertServiceBoundary() {
  if (process.env.ALLOW_DIRECT_SERVICE !== "true") {
    throw new Error(
      "Direct service execution blocked. Set ALLOW_DIRECT_SERVICE=true for system-managed runs.",
    );
  }
}

function parseIntervalMs(value: string | number | undefined, fallbackMs: number) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return fallbackMs;
  const match = value.trim().match(/^(\d+)\s*(ms|s|m|h)?$/i);
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "ms").toLowerCase();
  switch (unit) {
    case "h":
      return amount * 60 * 60 * 1000;
    case "m":
      return amount * 60 * 1000;
    case "s":
      return amount * 1000;
    default:
      return amount;
  }
}

async function loadJsonFile<T>(targetPath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(targetPath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function saveServiceState(targetPath: string, state: RuntimeAgentServiceState) {
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify(state, null, 2), "utf-8");
}

async function loadConfig(): Promise<ResolvedConfig> {
  const configPath = resolve(__dirname, "../agent.config.json");
  const raw = await readFile(configPath, "utf-8");
  const parsed = JSON.parse(raw) as AgentConfig;
  const agentRoot = dirname(configPath);
  return {
    id: parsed.id,
    orchestratorTask: parsed.orchestratorTask ?? "release-readiness",
    orchestratorStatePath: resolveRuntimeStateTarget(configPath, parsed.orchestratorStatePath)!,
    serviceStatePath: resolve(agentRoot, parsed.serviceStatePath),
    heartbeatIntervalMs: parseIntervalMs(parsed.heartbeat?.interval, 10 * 60 * 1000),
    documentParserAllowed: parsed.permissions?.skills?.documentParser?.allowed === true,
  };
}

async function runOnce(config: ResolvedConfig) {
  const state = await loadRuntimeStateTarget<OrchestratorState>(config.orchestratorStatePath, {});
  const taskPath = buildTaskPathProof(state.taskExecutions ?? [], config.orchestratorTask);
  const summary = {
    documentParserAllowed: config.documentParserAllowed,
    totalTrackedRuns: Number(taskPath.totalRuns ?? 0),
    successfulRuns: Number(taskPath.successfulRuns ?? 0),
    failedRuns: Number(taskPath.failedRuns ?? 0),
    activeRuns: Number(taskPath.activeRuns ?? 0),
    lastObservedAt: taskPath.lastObservedAt ?? null,
  };
  const lastStatus = config.documentParserAllowed ? "ok" : "error";
  const now = new Date().toISOString();
  const existing = await loadJsonFile<RuntimeAgentServiceState>(config.serviceStatePath, {});

  await saveServiceState(config.serviceStatePath, {
    ...existing,
    memoryVersion: 2,
    runtimeProofVersion: 1,
    agentId: config.id,
    orchestratorStatePath: config.orchestratorStatePath,
    lastRunAt: now,
    lastStatus,
    lastTaskType: config.orchestratorTask,
    lastError: lastStatus === "ok" ? null : "release manager readiness incomplete",
    successCount:
      typeof taskPath.successfulRuns === "number" ? taskPath.successfulRuns : existing.successCount,
    errorCount:
      typeof taskPath.failedRuns === "number" ? taskPath.failedRuns : existing.errorCount,
    totalRuns:
      typeof taskPath.totalRuns === "number" ? taskPath.totalRuns : existing.totalRuns,
    serviceHeartbeat: {
      checkedAt: now,
      status: lastStatus,
      errorSummary: lastStatus === "ok" ? null : "release manager readiness incomplete",
      source: "service-loop",
    },
    taskPath,
    summary,
  });

  await telemetry.info("heartbeat", {
    status: lastStatus,
    summary,
  });
}

function installSignalHandlers() {
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  return () => stopping;
}

async function sleep(ms: number) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function loop() {
  assertServiceBoundary();
  const config = await loadConfig();
  const isStopping = installSignalHandlers();

  while (!isStopping()) {
    try {
      await runOnce(config);
    } catch (error) {
      await telemetry.error("service.error", {
        message: error instanceof Error ? error.message : String(error),
      });
      await saveServiceState(config.serviceStatePath, {
        lastRunAt: new Date().toISOString(),
        lastStatus: "error",
        lastError: error instanceof Error ? error.message : String(error),
      });
    }

    if (isStopping()) break;
    await sleep(config.heartbeatIntervalMs);
  }
}

loop().catch(async (error) => {
  await telemetry.error("service.fatal", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
