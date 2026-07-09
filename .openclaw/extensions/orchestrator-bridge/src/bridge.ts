import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const KNOWN_PUBLIC_TASK_TYPES = [
  "drift-repair",
  "deployment-ops",
  "code-index",
  "test-intelligence",
  "compliance-review",
  "control-plane-brief",
  "incident-triage",
  "release-readiness",
  "reddit-response",
  "security-audit",
  "summarize-content",
  "system-monitor",
  "build-refactor",
  "content-generate",
  "integration-workflow",
  "normalize-data",
  "market-research",
  "data-extraction",
  "qa-verification",
  "skill-audit",
  "rss-sweep",
  "nightly-batch",
  "send-digest",
  "heartbeat",
  "agent-deploy",
  "doc-sync",
] as const;

export type KnownPublicTaskType = (typeof KNOWN_PUBLIC_TASK_TYPES)[number];

export const KNOWN_COMPANION_VIEWS = [
  "status",
  "tasks",
  "incidents",
  "runs",
  "approvals",
] as const;

export type KnownCompanionView = (typeof KNOWN_COMPANION_VIEWS)[number];

export type BridgePluginConfig = {
  allowedTasks?: string[];
  allowedViews?: string[];
  baseUrl?: string;
  metricsBaseUrl?: string;
  dashboardDistPath?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  envFilePath?: string;
  timeoutMs?: number;
};

export type NormalizedBridgeConfig = {
  allowedTasks: KnownPublicTaskType[];
  allowedViews: KnownCompanionView[];
  baseUrl: string;
  metricsBaseUrl: string;
  dashboardDistPath?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  envFilePath?: string;
  timeoutMs: number;
};

export type BridgeCommand =
  | { kind: "help" }
  | { kind: "view"; view: KnownCompanionView; limit?: number }
  | { kind: "run"; taskType: KnownPublicTaskType; payload: Record<string, unknown> };

type RotationKeyEntry = {
  key?: unknown;
  version?: unknown;
  expiresAt?: unknown;
  active?: unknown;
  label?: unknown;
  roles?: unknown;
};

export const DEFAULT_BASE_URL = "http://127.0.0.1:3312";
export const DEFAULT_METRICS_BASE_URL = "http://127.0.0.1:9100";
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_ENV_FILE = path.join("orchestrator", ".env");
export const DEFAULT_DASHBOARD_DIST_PATH = path.join(
  "projects",
  "openclaw-operator",
  "operator-s-console",
  "dist",
);

export const OPERATOR_TOOL_NAMES = [
  "operator_status",
  "operator_health",
  "operator_agents",
  "operator_task_catalog",
  "operator_tasks",
  "operator_runs",
  "operator_approvals",
  "operator_incidents",
  "operator_dashboard_status",
  "operator_trigger_readonly_task",
  "operator_smoke_test",
] as const;

export type OperatorToolName = (typeof OPERATOR_TOOL_NAMES)[number];

export type TaskRiskClass =
  | "read-only/safe"
  | "safe-write"
  | "approval-gated"
  | "dangerous/mutating"
  | "unclear";

export type TaskRiskProfile = {
  risk: TaskRiskClass;
  approvalRequired: boolean;
  readonlyTriggerAllowed: boolean;
  notes: string;
};

export const TASK_RISK_CLASSIFICATION: Record<KnownPublicTaskType, TaskRiskProfile> = {
  "control-plane-brief": {
    risk: "read-only/safe",
    approvalRequired: false,
    readonlyTriggerAllowed: true,
    notes: "Summarizes control-plane state and evidence without changing project code.",
  },
  "incident-triage": {
    risk: "read-only/safe",
    approvalRequired: false,
    readonlyTriggerAllowed: true,
    notes: "Classifies current incidents and recommends next action; does not remediate.",
  },
  "release-readiness": {
    risk: "read-only/safe",
    approvalRequired: false,
    readonlyTriggerAllowed: true,
    notes: "Reviews release posture and gates; does not publish or deploy.",
  },
  "deployment-ops": {
    risk: "read-only/safe",
    approvalRequired: false,
    readonlyTriggerAllowed: true,
    notes: "Checks deployment readiness only; deployment actions remain approval-gated.",
  },
  "code-index": {
    risk: "read-only/safe",
    approvalRequired: false,
    readonlyTriggerAllowed: true,
    notes: "Indexes code for navigation/evidence without editing files.",
  },
  "test-intelligence": {
    risk: "read-only/safe",
    approvalRequired: false,
    readonlyTriggerAllowed: true,
    notes: "Analyzes test coverage and validation signals; should not run mutating tests.",
  },
  "compliance-review": {
    risk: "read-only/safe",
    approvalRequired: false,
    readonlyTriggerAllowed: true,
    notes: "Reviews compliance evidence and policy posture.",
  },
  "security-audit": {
    risk: "read-only/safe",
    approvalRequired: false,
    readonlyTriggerAllowed: true,
    notes: "Audits security posture without reading secret values or applying changes.",
  },
  "system-monitor": {
    risk: "read-only/safe",
    approvalRequired: false,
    readonlyTriggerAllowed: true,
    notes: "Observes system health and drift signals.",
  },
  "summarize-content": {
    risk: "read-only/safe",
    approvalRequired: false,
    readonlyTriggerAllowed: true,
    notes: "Summarizes provided content.",
  },
  "integration-workflow": {
    risk: "read-only/safe",
    approvalRequired: false,
    readonlyTriggerAllowed: true,
    notes: "Reviews integration state and recommends next steps.",
  },
  "normalize-data": {
    risk: "read-only/safe",
    approvalRequired: false,
    readonlyTriggerAllowed: true,
    notes: "Normalizes supplied data into run output.",
  },
  "data-extraction": {
    risk: "read-only/safe",
    approvalRequired: false,
    readonlyTriggerAllowed: true,
    notes: "Extracts structured facts from supplied content.",
  },
  "qa-verification": {
    risk: "read-only/safe",
    approvalRequired: false,
    readonlyTriggerAllowed: true,
    notes: "Performs bounded verification review; code edits remain out of scope.",
  },
  "skill-audit": {
    risk: "read-only/safe",
    approvalRequired: false,
    readonlyTriggerAllowed: true,
    notes: "Audits skills/proposals and reports findings without applying them.",
  },
  "market-research": {
    risk: "unclear",
    approvalRequired: true,
    readonlyTriggerAllowed: false,
    notes: "May use external network/research surfaces; keep out of automatic read-only routing.",
  },
  "drift-repair": {
    risk: "safe-write",
    approvalRequired: true,
    readonlyTriggerAllowed: false,
    notes: "May write repair artifacts or update state; approval required before dispatch.",
  },
  "reddit-response": {
    risk: "safe-write",
    approvalRequired: true,
    readonlyTriggerAllowed: false,
    notes: "May prepare or route outbound social responses; approval required.",
  },
  "content-generate": {
    risk: "safe-write",
    approvalRequired: true,
    readonlyTriggerAllowed: false,
    notes: "Generates content artifacts and may affect publishing workflows.",
  },
  "rss-sweep": {
    risk: "unclear",
    approvalRequired: true,
    readonlyTriggerAllowed: false,
    notes: "Likely touches feeds/network and creates state; approval required.",
  },
  "nightly-batch": {
    risk: "unclear",
    approvalRequired: true,
    readonlyTriggerAllowed: false,
    notes: "Batch scope is broad; approval required before manual dispatch.",
  },
  "send-digest": {
    risk: "approval-gated",
    approvalRequired: true,
    readonlyTriggerAllowed: false,
    notes: "Can deliver outbound messages; requires explicit approval.",
  },
  heartbeat: {
    risk: "safe-write",
    approvalRequired: true,
    readonlyTriggerAllowed: false,
    notes: "Updates heartbeat/digest state and should run only through approved scheduling.",
  },
  "agent-deploy": {
    risk: "dangerous/mutating",
    approvalRequired: true,
    readonlyTriggerAllowed: false,
    notes: "Deployment-like capability; never auto-dispatch from read-only routing.",
  },
  "doc-sync": {
    risk: "safe-write",
    approvalRequired: true,
    readonlyTriggerAllowed: false,
    notes: "May update documentation or knowledge indexes.",
  },
  "build-refactor": {
    risk: "approval-gated",
    approvalRequired: true,
    readonlyTriggerAllowed: false,
    notes: "Can edit code/worktree; explicit approval required.",
  },
};

export const READONLY_OPERATOR_TASK_TYPES = KNOWN_PUBLIC_TASK_TYPES.filter(
  (taskType) => TASK_RISK_CLASSIFICATION[taskType].readonlyTriggerAllowed,
);

const KNOWN_TASK_SET = new Set<string>(KNOWN_PUBLIC_TASK_TYPES);
const KNOWN_VIEW_SET = new Set<string>(KNOWN_COMPANION_VIEWS);
const READONLY_OPERATOR_TASK_SET = new Set<string>(READONLY_OPERATOR_TASK_TYPES);

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function splitOnce(input: string): { head: string; tail: string } {
  const trimmed = input.trim();
  if (!trimmed) return { head: "", tail: "" };
  const separatorIndex = trimmed.search(/\s/);
  if (separatorIndex === -1) return { head: trimmed, tail: "" };
  return {
    head: trimmed.slice(0, separatorIndex),
    tail: trimmed.slice(separatorIndex).trim(),
  };
}

function parseJsonObject(input: string): Record<string, unknown> {
  const parsed = JSON.parse(input) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON payload must be an object.");
  }
  return parsed as Record<string, unknown>;
}

function buildShorthandPayload(
  taskType: KnownPublicTaskType,
  rawArgs: string,
): Record<string, unknown> {
  const trimmed = rawArgs.trim();
  if (!trimmed) return {};

  if (trimmed.startsWith("{")) {
    return parseJsonObject(trimmed);
  }

  switch (taskType) {
    case "control-plane-brief":
      return { scope: trimmed };
    case "incident-triage":
      return { scope: trimmed };
    case "release-readiness":
      return { scope: trimmed };
    case "deployment-ops":
      return { scope: trimmed, mode: "readiness-review" };
    case "code-index":
      return { scope: trimmed };
    case "test-intelligence":
      return { scope: trimmed };
    case "compliance-review":
      return { scope: trimmed };
    case "market-research":
      return { query: trimmed };
    case "summarize-content":
      return { content: trimmed };
    case "data-extraction":
      return { content: trimmed };
    case "qa-verification":
      return { target: trimmed };
    case "security-audit":
      return { scope: trimmed };
    case "system-monitor":
      return { type: trimmed };
    case "build-refactor":
      return { scope: trimmed };
    case "content-generate":
      return {
        source: {
          name: "Telegram command",
          description: trimmed,
        },
      };
    case "skill-audit":
      return {
        skillIds: trimmed
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      };
    default:
      throw new Error(
        `Task "${taskType}" needs a JSON object payload. Example: /orch ${taskType} {"key":"value"}`,
      );
  }
}

export function normalizeBridgeConfig(
  rawConfig: unknown,
  workspaceDir?: string,
): NormalizedBridgeConfig {
  const config =
    rawConfig && typeof rawConfig === "object"
      ? (rawConfig as BridgePluginConfig)
      : ({ allowedTasks: [], allowedViews: [] } as BridgePluginConfig);
  const allowedTasks = Array.isArray(config.allowedTasks)
    ? config.allowedTasks.filter(
        (taskType): taskType is KnownPublicTaskType =>
          typeof taskType === "string" && KNOWN_TASK_SET.has(taskType),
      )
    : [];
  const allowedViews = Array.isArray(config.allowedViews)
    ? config.allowedViews.filter(
        (view): view is KnownCompanionView =>
          typeof view === "string" && KNOWN_VIEW_SET.has(view),
      )
    : [];

  if (allowedTasks.length === 0 && allowedViews.length === 0) {
    throw new Error(
      "orchestrator-bridge needs at least one valid allowed view or allowed task in plugins.entries.orchestrator-bridge.config.",
    );
  }

  const baseUrl = trimToUndefined(config.baseUrl) ?? DEFAULT_BASE_URL;
  const metricsBaseUrl = trimToUndefined(config.metricsBaseUrl) ?? DEFAULT_METRICS_BASE_URL;
  const dashboardDistPath =
    trimToUndefined(config.dashboardDistPath) ??
    (workspaceDir ? path.join(workspaceDir, DEFAULT_DASHBOARD_DIST_PATH) : undefined);
  const apiKey = trimToUndefined(config.apiKey);
  const apiKeyEnv = trimToUndefined(config.apiKeyEnv);
  const envFilePath =
    trimToUndefined(config.envFilePath) ??
    (workspaceDir ? path.join(workspaceDir, DEFAULT_ENV_FILE) : undefined);
  const timeoutMs =
    typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs) && config.timeoutMs >= 1000
      ? Math.floor(config.timeoutMs)
      : DEFAULT_TIMEOUT_MS;

  return {
    allowedTasks,
    allowedViews,
    baseUrl,
    metricsBaseUrl,
    dashboardDistPath,
    apiKey,
    apiKeyEnv,
    envFilePath,
    timeoutMs,
  };
}

export function parseBridgeCommand(
  rawArgs: string | undefined,
  config: Pick<NormalizedBridgeConfig, "allowedTasks" | "allowedViews">,
): BridgeCommand {
  const args = rawArgs?.trim() ?? "";
  if (!args) return { kind: "help" };

  const allowedTaskSet = new Set<string>(config.allowedTasks);
  const allowedViewSet = new Set<string>(config.allowedViews);
  const { head, tail } = splitOnce(args);
  const normalizedHead = head.toLowerCase();

  if (normalizedHead === "help") return { kind: "help" };
  if (KNOWN_VIEW_SET.has(normalizedHead)) {
    if (!allowedViewSet.has(normalizedHead)) {
      throw new Error(`View "${normalizedHead}" is not enabled in the bridge allowlist.`);
    }
    if (normalizedHead === "tasks" || normalizedHead === "status") {
      if (tail.trim().length > 0) {
        throw new Error(`Usage: /orch ${normalizedHead}`);
      }
      return { kind: "view", view: normalizedHead as KnownCompanionView };
    }
    const fallbackLimit = normalizedHead === "runs" ? 5 : 8;
    return {
      kind: "view",
      view: normalizedHead as KnownCompanionView,
      limit: Math.min(parsePositiveInt(tail, fallbackLimit), normalizedHead === "runs" ? 10 : 20),
    };
  }
  if (normalizedHead === "run") {
    const { head: taskTypeRaw, tail: payloadRaw } = splitOnce(tail);
    if (!taskTypeRaw) throw new Error("Usage: /orch run <task-type> [json payload]");
    if (!KNOWN_TASK_SET.has(taskTypeRaw)) {
      throw new Error(`Unknown task type "${taskTypeRaw}". Use /orch list to see the allowed set.`);
    }
    if (!allowedTaskSet.has(taskTypeRaw)) {
      throw new Error(`Task "${taskTypeRaw}" is not enabled in the bridge allowlist.`);
    }
    const payload = buildShorthandPayload(taskTypeRaw as KnownPublicTaskType, payloadRaw);
    const riskProfile = TASK_RISK_CLASSIFICATION[taskTypeRaw as KnownPublicTaskType];
    if (
      riskProfile.approvalRequired &&
      (payload as { requiresApproval?: unknown }).requiresApproval !== true
    ) {
      throw new Error(
        `Task "${taskTypeRaw}" is ${riskProfile.risk} and requires a JSON payload with requiresApproval=true before dispatch.`,
      );
    }
    return {
      kind: "run",
      taskType: taskTypeRaw as KnownPublicTaskType,
      payload,
    };
  }

  if (!KNOWN_TASK_SET.has(head)) {
    throw new Error(`Unknown subcommand or task "${head}". Use /orch help.`);
  }
  if (!allowedTaskSet.has(head)) {
    throw new Error(`Task "${head}" is not enabled in the bridge allowlist.`);
  }
  const payload = buildShorthandPayload(head as KnownPublicTaskType, tail);
  const riskProfile = TASK_RISK_CLASSIFICATION[head as KnownPublicTaskType];
  if (riskProfile.approvalRequired && (payload as { requiresApproval?: unknown }).requiresApproval !== true) {
    throw new Error(
      `Task "${head}" is ${riskProfile.risk} and requires a JSON payload with requiresApproval=true before dispatch.`,
    );
  }
  return {
    kind: "run",
    taskType: head as KnownPublicTaskType,
    payload,
  };
}

export function isReadOnlyOperatorTask(taskType: string): taskType is KnownPublicTaskType {
  return READONLY_OPERATOR_TASK_SET.has(taskType);
}

function parseDotEnv(contents: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

function isRoleArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function selectRotationOperatorKey(rawValue: string): string | undefined {
  const parsed = JSON.parse(rawValue) as unknown;
  if (!Array.isArray(parsed)) return undefined;
  const candidates = parsed
    .map((entry) => entry as RotationKeyEntry)
    .filter((entry) => typeof entry.key === "string" && entry.key.trim().length > 0)
    .filter((entry) => entry.active !== false)
    .filter((entry) => {
      if (typeof entry.expiresAt !== "string") return true;
      const expiresAt = new Date(entry.expiresAt);
      return Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() > Date.now();
    })
    .filter((entry) => {
      if (!isRoleArray(entry.roles)) return true;
      return entry.roles.includes("operator") || entry.roles.includes("admin");
    })
    .sort((left, right) => {
      const leftVersion = typeof left.version === "number" ? left.version : 0;
      const rightVersion = typeof right.version === "number" ? right.version : 0;
      return rightVersion - leftVersion;
    });

  const selected = candidates[0];
  return typeof selected?.key === "string" ? selected.key.trim() : undefined;
}

export async function resolveBridgeApiKey(
  config: NormalizedBridgeConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  if (config.apiKey) return config.apiKey;
  if (config.apiKeyEnv) {
    const fromEnv = trimToUndefined(env[config.apiKeyEnv]);
    if (fromEnv) return fromEnv;
  }
  if (!config.envFilePath) return undefined;

  try {
    const contents = await readFile(config.envFilePath, "utf8");
    const parsed = parseDotEnv(contents);
    const rotationValue = trimToUndefined(parsed.API_KEY_ROTATION);
    if (rotationValue) {
      const rotationKey = selectRotationOperatorKey(rotationValue);
      if (rotationKey) return rotationKey;
      return undefined;
    }
    return trimToUndefined(parsed.API_KEY);
  } catch {
    return undefined;
  }
}

type ApiRequestParams = {
  config: NormalizedBridgeConfig;
  apiKey: string;
  pathname: string;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
};

export async function orchestratorRequest({
  config,
  apiKey,
  pathname,
  method = "GET",
  body,
}: ApiRequestParams): Promise<unknown> {
  const response = await fetch(`${config.baseUrl}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  const responseText = await response.text();
  const responseData =
    responseText.trim().length > 0 ? safeJsonParse(responseText) : undefined;

  if (!response.ok) {
    const detail =
      responseData &&
      typeof responseData === "object" &&
      responseData !== null &&
      "error" in responseData &&
      typeof responseData.error === "string"
        ? responseData.error
        : responseText.trim() || response.statusText;
    throw new Error(`Orchestrator request failed (${response.status}): ${detail}`);
  }

  return responseData;
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return input;
  }
}

type EndpointProbe = {
  name: string;
  url: string;
  ok: boolean;
  status?: number;
  statusText?: string;
  data?: unknown;
  error?: string;
  authUsed: boolean;
};

type OperatorToolContext = {
  config: NormalizedBridgeConfig;
  apiKey?: string;
};

type OperatorToolParams = {
  limit?: number;
  taskType?: string;
  payload?: Record<string, unknown>;
  confirmCreateTask?: boolean;
};

const TOOL_DESCRIPTIONS: Record<OperatorToolName, string> = {
  operator_status: "Read the operator companion status through the OpenClaw bridge.",
  operator_health:
    "Probe operator API health and metrics health separately; reports API-down clearly.",
  operator_agents: "List operator agent overview data from the operator API.",
  operator_task_catalog:
    "Read the operator task catalog plus bridge allowlist and risk classification.",
  operator_tasks: "Summarize operator task lanes, launch allowlist, and recent run evidence.",
  operator_runs: "Read recent operator run records.",
  operator_approvals: "Read pending operator approval records.",
  operator_incidents: "Read current operator incident records.",
  operator_dashboard_status:
    "Check dashboard build artifact presence and dashboard/operator API surfaces.",
  operator_trigger_readonly_task:
    "Queue one approved read-only operator task; refuses mutating lanes and requires confirmation.",
  operator_smoke_test:
    "Run a no-mutation bridge smoke test against health, task, run, agent, approval, incident, and dashboard read endpoints.",
};

function normalizeLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value), max));
}

function endpointUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/$/, "")}${pathname}`;
}

async function probeEndpoint(
  config: NormalizedBridgeConfig,
  name: string,
  pathname: string,
  options: { apiKey?: string; auth?: boolean; baseUrl?: string } = {},
): Promise<EndpointProbe> {
  const baseUrl = options.baseUrl ?? config.baseUrl;
  const url = endpointUrl(baseUrl, pathname);
  const authUsed = options.auth !== false && Boolean(options.apiKey);
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (authUsed) headers.Authorization = `Bearer ${options.apiKey}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const responseText = await response.text();
    return {
      name,
      url,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      data: responseText.trim().length > 0 ? safeJsonParse(responseText) : undefined,
      authUsed,
    };
  } catch (error) {
    return {
      name,
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      authUsed,
    };
  }
}

async function checkDashboardDist(config: NormalizedBridgeConfig): Promise<{
  path?: string;
  exists: boolean;
  error?: string;
}> {
  if (!config.dashboardDistPath) return { exists: false };
  try {
    await access(config.dashboardDistPath);
    return { path: config.dashboardDistPath, exists: true };
  } catch (error) {
    return {
      path: config.dashboardDistPath,
      exists: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function requireApiKeyResult(apiKey: string | undefined, toolName: OperatorToolName) {
  if (apiKey) return undefined;
  return {
    ok: false,
    tool: toolName,
    status: "operator_api_key_missing",
    message:
      "The bridge could not resolve an operator API key. Configure apiKey/apiKeyEnv or approved env-file discovery before using protected operator endpoints.",
  };
}

async function callProtectedOperatorRead(
  context: OperatorToolContext,
  toolName: OperatorToolName,
  pathname: string,
): Promise<unknown> {
  const missingKey = await requireApiKeyResult(context.apiKey, toolName);
  if (missingKey) return missingKey;
  try {
    return {
      ok: true,
      tool: toolName,
      baseUrl: context.config.baseUrl,
      data: await orchestratorRequest({
        config: context.config,
        apiKey: context.apiKey as string,
        pathname,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      tool: toolName,
      status: "operator_api_unreachable_or_rejected",
      baseUrl: context.config.baseUrl,
      endpoint: pathname,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function executeOperatorTool(
  toolName: OperatorToolName,
  params: OperatorToolParams,
  context: OperatorToolContext,
): Promise<unknown> {
  const limit = normalizeLimit(params.limit, 8, 25);

  switch (toolName) {
    case "operator_health": {
      const probes = await Promise.all([
        probeEndpoint(context.config, "operator_public_health", "/health", {
          auth: false,
        }),
        probeEndpoint(context.config, "operator_extended_health", "/api/health/extended", {
          apiKey: context.apiKey,
        }),
        probeEndpoint(context.config, "operator_metrics_health", "/metrics", {
          auth: false,
          baseUrl: context.config.metricsBaseUrl,
        }),
      ]);
      return {
        ok: probes.some((probe) => probe.ok),
        tool: toolName,
        apiBaseUrl: context.config.baseUrl,
        metricsBaseUrl: context.config.metricsBaseUrl,
        apiHealth: probes[0],
        extendedHealth: probes[1],
        metricsHealth: probes[2],
        note: "Metrics health is reported separately and is not treated as proof that the operator API is serving task routes.",
      };
    }
    case "operator_status":
      return callProtectedOperatorRead(context, toolName, "/api/companion/overview");
    case "operator_agents":
      return callProtectedOperatorRead(context, toolName, "/api/agents/overview");
    case "operator_task_catalog": {
      const catalog = await callProtectedOperatorRead(context, toolName, "/api/tasks/catalog");
      return {
        ok: !(catalog && typeof catalog === "object" && "ok" in catalog && catalog.ok === false),
        tool: toolName,
        allowedTasks: context.config.allowedTasks,
        readOnlyTriggerTasks: READONLY_OPERATOR_TASK_TYPES,
        taskRiskClassification: TASK_RISK_CLASSIFICATION,
        catalog,
      };
    }
    case "operator_tasks": {
      const catalog = await callProtectedOperatorRead(context, toolName, "/api/companion/catalog");
      const runs = await callProtectedOperatorRead(
        context,
        toolName,
        `/api/tasks/runs?limit=${Math.min(limit, 10)}`,
      );
      return {
        ok: true,
        tool: toolName,
        allowedTasks: context.config.allowedTasks,
        readOnlyTriggerTasks: READONLY_OPERATOR_TASK_TYPES,
        taskRiskClassification: TASK_RISK_CLASSIFICATION,
        catalog,
        recentRuns: runs,
      };
    }
    case "operator_runs":
      return callProtectedOperatorRead(context, toolName, `/api/tasks/runs?limit=${limit}`);
    case "operator_approvals":
      return callProtectedOperatorRead(context, toolName, `/api/approvals/pending?limit=${limit}`);
    case "operator_incidents":
      return callProtectedOperatorRead(context, toolName, `/api/incidents?limit=${limit}`);
    case "operator_dashboard_status": {
      const [dist, shell, overview] = await Promise.all([
        checkDashboardDist(context.config),
        probeEndpoint(context.config, "operator_dashboard_shell", "/operator", {
          auth: false,
        }),
        probeEndpoint(context.config, "operator_dashboard_overview", "/api/dashboard/overview", {
          apiKey: context.apiKey,
        }),
      ]);
      return {
        ok: dist.exists && (shell.ok || overview.ok),
        tool: toolName,
        apiBaseUrl: context.config.baseUrl,
        dashboardDist: dist,
        dashboardShell: shell,
        dashboardOverview: overview,
      };
    }
    case "operator_trigger_readonly_task": {
      const taskType = typeof params.taskType === "string" ? params.taskType.trim() : "";
      if (!taskType || !KNOWN_TASK_SET.has(taskType)) {
        return {
          ok: false,
          tool: toolName,
          status: "unknown_task_type",
          allowedReadOnlyTasks: READONLY_OPERATOR_TASK_TYPES,
        };
      }
      if (!context.config.allowedTasks.includes(taskType as KnownPublicTaskType)) {
        return {
          ok: false,
          tool: toolName,
          status: "task_not_enabled_in_bridge_allowlist",
          taskType,
          allowedTasks: context.config.allowedTasks,
        };
      }
      if (!isReadOnlyOperatorTask(taskType)) {
        return {
          ok: false,
          tool: toolName,
          status: "task_not_readonly_safe",
          taskType,
          riskProfile: TASK_RISK_CLASSIFICATION[taskType as KnownPublicTaskType],
        };
      }
      if (params.confirmCreateTask !== true) {
        return {
          ok: false,
          tool: toolName,
          status: "confirmation_required",
          taskType,
          message:
            "This tool creates an operator task record. Re-run with confirmCreateTask=true only after explicit approval for this read-only task dispatch.",
        };
      }
      const missingKey = await requireApiKeyResult(context.apiKey, toolName);
      if (missingKey) return missingKey;
      try {
        const queued = await orchestratorRequest({
          config: context.config,
          apiKey: context.apiKey as string,
          pathname: "/api/tasks/trigger",
          method: "POST",
          body: {
            type: taskType,
            payload: params.payload ?? {},
          },
        });
        return {
          ok: true,
          tool: toolName,
          status: "queued_readonly_operator_task",
          taskType,
          queued,
        };
      } catch (error) {
        return {
          ok: false,
          tool: toolName,
          status: "operator_task_trigger_failed",
          taskType,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    case "operator_smoke_test": {
      const [dashboardDist, ...probes] = await Promise.all([
        checkDashboardDist(context.config),
        probeEndpoint(context.config, "operator_public_health", "/health", { auth: false }),
        probeEndpoint(context.config, "operator_extended_health", "/api/health/extended", {
          apiKey: context.apiKey,
        }),
        probeEndpoint(context.config, "operator_task_catalog", "/api/tasks/catalog", {
          apiKey: context.apiKey,
        }),
        probeEndpoint(context.config, "operator_runs", "/api/tasks/runs?limit=1", {
          apiKey: context.apiKey,
        }),
        probeEndpoint(context.config, "operator_agents", "/api/agents/overview", {
          apiKey: context.apiKey,
        }),
        probeEndpoint(context.config, "operator_approvals", "/api/approvals/pending?limit=1", {
          apiKey: context.apiKey,
        }),
        probeEndpoint(context.config, "operator_incidents", "/api/incidents?limit=1", {
          apiKey: context.apiKey,
        }),
        probeEndpoint(context.config, "operator_dashboard_overview", "/api/dashboard/overview", {
          apiKey: context.apiKey,
        }),
        probeEndpoint(context.config, "operator_metrics_health", "/metrics", {
          auth: false,
          baseUrl: context.config.metricsBaseUrl,
        }),
      ]);
      return {
        ok: probes.every((probe) => probe.ok) && dashboardDist.exists,
        tool: toolName,
        apiBaseUrl: context.config.baseUrl,
        metricsBaseUrl: context.config.metricsBaseUrl,
        dashboardDist,
        probes,
        note: "This smoke test uses GET/read probes only. It does not create tasks or run operator lanes.",
      };
    }
  }
}

function operatorToolParameters(toolName: OperatorToolName): Record<string, unknown> {
  if (toolName === "operator_trigger_readonly_task") {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        taskType: {
          type: "string",
          enum: [...READONLY_OPERATOR_TASK_TYPES],
        },
        payload: {
          type: "object",
          additionalProperties: true,
        },
        confirmCreateTask: {
          type: "boolean",
        },
      },
      required: ["taskType"],
    };
  }

  if (
    toolName === "operator_runs" ||
    toolName === "operator_approvals" ||
    toolName === "operator_incidents" ||
    toolName === "operator_tasks"
  ) {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "number",
          minimum: 1,
          maximum: 25,
        },
      },
    };
  }

  return {
    type: "object",
    additionalProperties: false,
    properties: {},
  };
}

function toolTextResult(value: unknown) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function registerOperatorBridgeTools(api: any) {
  const workspaceDir =
    typeof api.config?.agents?.defaults?.workspace === "string"
      ? api.config.agents.defaults.workspace
      : undefined;

  for (const toolName of OPERATOR_TOOL_NAMES) {
    api.registerTool(
      {
        name: toolName,
        description: TOOL_DESCRIPTIONS[toolName],
        parameters: operatorToolParameters(toolName),
        execute: async (params: OperatorToolParams = {}) => {
          const config = normalizeBridgeConfig(api.pluginConfig, workspaceDir);
          const apiKey = await resolveBridgeApiKey(config);
          const result = await executeOperatorTool(toolName, params, { config, apiKey });
          return toolTextResult(result);
        },
      },
      { optional: true },
    );
  }
}

export function formatHelp(
  allowedViews: readonly KnownCompanionView[],
  allowedTasks: readonly KnownPublicTaskType[],
): string {
  return [
    "Orchestrator bridge",
    "",
    "Usage:",
    "/orch status",
    "/orch tasks",
    "/orch incidents [limit]",
    "/orch runs [limit]",
    "/orch approvals [limit]",
    "/orch <task-type> [json payload]",
    "/orch run <task-type> [json payload]",
    "",
    "Plain-text shorthand works for:",
    "- control-plane-brief",
    "- incident-triage",
    "- release-readiness",
    "- deployment-ops",
    "- code-index",
    "- test-intelligence",
    "- compliance-review",
    "- market-research",
    "- summarize-content",
    "- data-extraction",
    "- qa-verification",
    "- security-audit",
    "- system-monitor",
    "- build-refactor",
    "- content-generate",
    "- skill-audit",
    "",
    `Allowed views: ${allowedViews.length > 0 ? allowedViews.join(", ") : "none"}`,
    `Allowed tasks: ${allowedTasks.length > 0 ? allowedTasks.join(", ") : "none"}`,
  ].join("\n");
}

type CompanionCatalogTask = {
  type?: unknown;
  label?: unknown;
  purpose?: unknown;
  operationalStatus?: unknown;
  approvalGated?: unknown;
  dependencyClass?: unknown;
  caveats?: unknown;
};

export function formatCompanionTaskList(
  allowedTasks: readonly KnownPublicTaskType[],
  catalogData: unknown,
): string {
  const tasks =
    catalogData &&
    typeof catalogData === "object" &&
    catalogData !== null &&
    "tasks" in catalogData &&
    Array.isArray((catalogData as { tasks?: unknown }).tasks)
      ? ((catalogData as { tasks: unknown[] }).tasks as CompanionCatalogTask[])
      : [];

  if (tasks.length === 0) {
    return [
      "Companion task catalog",
      "",
      allowedTasks.length > 0
        ? `No companion tasks returned. Launch-enabled tasks: ${allowedTasks.join(", ")}`
        : "No companion tasks returned and no launch-enabled tasks are configured.",
    ].join("\n");
  }

  const filtered = tasks.filter((task) =>
    typeof task.type === "string" ? allowedTasks.includes(task.type as KnownPublicTaskType) : false,
  );

  const visibleTasks = filtered.length > 0 ? filtered : tasks;

  return [
    "Companion task catalog",
    "",
    ...visibleTasks.map((task) => {
      const type = String(task.type ?? "unknown");
      const label = String(task.label ?? type);
      const purpose = String(task.purpose ?? "No purpose available.");
      const status =
        typeof task.operationalStatus === "string" ? task.operationalStatus : "unknown";
      const gated = task.approvalGated === true ? " approval-gated" : "";
      const dependencyClass =
        typeof task.dependencyClass === "string" ? ` ${task.dependencyClass}` : "";
      const caveats = Array.isArray(task.caveats)
        ? (task.caveats as unknown[])
            .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
            .slice(0, 1)
        : [];
      const launchState = allowedTasks.includes(type as KnownPublicTaskType)
        ? "launch-enabled"
        : "read-only";
      return `- ${label} (${type}; ${status}${dependencyClass}${gated}; ${launchState}): ${purpose}${caveats.length > 0 ? ` Caveat: ${caveats[0]}` : ""}`;
    }),
  ].join("\n");
}

type CompanionOverview = {
  controlPlaneMode?: { label?: unknown; detail?: unknown; route?: unknown; tone?: unknown };
  primaryOperatorMove?: {
    title?: unknown;
    detail?: unknown;
    route?: unknown;
    tone?: unknown;
    supportingSignals?: unknown;
  };
  pressureStory?: { headline?: unknown; detail?: unknown; signals?: unknown };
  queue?: { queued?: unknown; processing?: unknown };
  approvals?: { pendingCount?: unknown };
  incidents?: { openCount?: unknown; criticalCount?: unknown };
  publicProof?: { status?: unknown; stale?: unknown; deadLetterCount?: unknown };
  services?: {
    declaredCount?: unknown;
    serviceExpectedCount?: unknown;
    serviceRunningCount?: unknown;
  };
  freshnessTimestamp?: unknown;
};

export function formatCompanionOverview(data: unknown): string {
  const overview =
    data && typeof data === "object" && data !== null ? (data as CompanionOverview) : {};
  const mode = overview.controlPlaneMode ?? {};
  const move = overview.primaryOperatorMove ?? {};
  const pressure = overview.pressureStory ?? {};
  const supportingSignals = Array.isArray(move.supportingSignals)
    ? (move.supportingSignals as unknown[])
        .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
        .slice(0, 3)
    : [];

  return [
    "Companion status",
    "",
    `Mode: ${String(mode.label ?? "unknown")}`,
    `Mode detail: ${String(mode.detail ?? "No control-plane detail available.")}`,
    `Primary move: ${String(move.title ?? "No dominant operator move recorded.")}`,
    `Move detail: ${String(move.detail ?? "No move detail available.")}`,
    supportingSignals.length > 0
      ? `Signals: ${supportingSignals.join(" | ")}`
      : "Signals: none recorded",
    `Pressure story: ${String(pressure.headline ?? "No pressure headline available.")}`,
    `Pressure detail: ${String(pressure.detail ?? "No pressure detail available.")}`,
    `Queue: ${String(overview.queue?.queued ?? 0)} queued, ${String(overview.queue?.processing ?? 0)} processing`,
    `Approvals: ${String(overview.approvals?.pendingCount ?? 0)} pending`,
    `Incidents: ${String(overview.incidents?.openCount ?? 0)} open, ${String(overview.incidents?.criticalCount ?? 0)} critical`,
    `Public proof: ${String(overview.publicProof?.status ?? "unknown")} (stale=${String(overview.publicProof?.stale ?? "unknown")}, dead-letter=${String(overview.publicProof?.deadLetterCount ?? 0)})`,
    `Services: ${String(overview.services?.serviceRunningCount ?? 0)} running / ${String(overview.services?.serviceExpectedCount ?? 0)} expected / ${String(overview.services?.declaredCount ?? 0)} declared`,
    `Freshness: ${String(overview.freshnessTimestamp ?? "unknown")}`,
  ].join("\n");
}

type CompanionRunRecord = {
  runId?: unknown;
  taskId?: unknown;
  type?: unknown;
  status?: unknown;
  lastHandledAt?: unknown;
  operatorSummary?: unknown;
  recommendedNextActions?: unknown;
  freshnessStatus?: unknown;
  reviewRecommended?: unknown;
  workflowStage?: unknown;
};

export function formatCompanionRuns(data: unknown): string {
  const runs =
    data &&
    typeof data === "object" &&
    data !== null &&
    "runs" in data &&
    Array.isArray((data as { runs?: unknown }).runs)
      ? ((data as { runs: unknown[] }).runs as CompanionRunRecord[])
      : [];

  if (runs.length === 0) {
    return "No companion run briefs found.";
  }

  return [
    "Companion run briefs",
    "",
    ...runs.map((run) => {
      const id = String(run.runId ?? run.taskId ?? "unknown");
      const type = String(run.type ?? "unknown");
      const status = String(run.status ?? "unknown");
      const timestamp = String(run.lastHandledAt ?? "unknown");
      const summary =
        typeof run.operatorSummary === "string" ? run.operatorSummary : "No operator summary.";
      const nextActions = Array.isArray(run.recommendedNextActions)
        ? (run.recommendedNextActions as unknown[])
            .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
            .slice(0, 2)
        : [];
      const freshness =
        typeof run.freshnessStatus === "string" ? ` freshness=${run.freshnessStatus}` : "";
      const review = run.reviewRecommended === true ? " review-recommended" : "";
      const stage =
        typeof run.workflowStage === "string" ? ` stage=${run.workflowStage}` : "";
      return `- ${type} ${status} ${id} @ ${timestamp}${freshness}${review}${stage}: ${summary}${nextActions.length > 0 ? ` Next: ${nextActions.join(" | ")}` : ""}`;
    }),
  ].join("\n");
}

type CompanionIncidentQueueItem = {
  incidentId?: unknown;
  priorityScore?: unknown;
  severity?: unknown;
  owner?: unknown;
  recommendedOwner?: unknown;
  nextAction?: unknown;
  remediationTaskType?: unknown;
  blockers?: unknown;
};

export function formatCompanionIncidents(data: unknown): string {
  const summary =
    data && typeof data === "object" && data !== null && "summary" in data
      ? ((data as { summary?: unknown }).summary as Record<string, unknown> | undefined)
      : undefined;
  const topClassifications =
    data &&
    typeof data === "object" &&
    data !== null &&
    "topClassifications" in data &&
    Array.isArray((data as { topClassifications?: unknown }).topClassifications)
      ? ((data as { topClassifications: unknown[] }).topClassifications as Record<string, unknown>[])
      : [];
  const topQueue =
    data &&
    typeof data === "object" &&
    data !== null &&
    "topQueue" in data &&
    Array.isArray((data as { topQueue?: unknown }).topQueue)
      ? ((data as { topQueue: unknown[] }).topQueue as CompanionIncidentQueueItem[])
      : [];

  return [
    "Companion incidents",
    "",
    `Open: ${String(summary?.openCount ?? 0)} | Critical: ${String(summary?.criticalCount ?? 0)} | Unowned: ${String(summary?.unownedCount ?? 0)} | Ack pending: ${String(summary?.ackPendingCount ?? 0)}`,
    topClassifications.length > 0
      ? `Top classes: ${topClassifications
          .map((entry) => `${String(entry.label ?? "unknown")}=${String(entry.count ?? 0)}`)
          .join(" | ")}`
      : "Top classes: none",
    ...(topQueue.length > 0
      ? [
          "",
          ...topQueue.map((incident) => {
            const blockers = Array.isArray(incident.blockers)
              ? (incident.blockers as unknown[])
                  .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
                  .slice(0, 2)
              : [];
            return `- ${String(incident.incidentId ?? "unknown")} ${String(incident.severity ?? "unknown")} priority=${String(incident.priorityScore ?? "n/a")} owner=${String(incident.owner ?? incident.recommendedOwner ?? "unassigned")} next=${String(incident.nextAction ?? "none")} remediation=${String(incident.remediationTaskType ?? "none")}${blockers.length > 0 ? ` blockers=${blockers.join(", ")}` : ""}`;
          }),
        ]
      : ["", "No ranked incident queue items returned."]),
  ].join("\n");
}

type CompanionApprovalLane = {
  type?: unknown;
  label?: unknown;
  count?: unknown;
};

type CompanionApprovalItem = {
  taskId?: unknown;
  type?: unknown;
  requestedAt?: unknown;
  payloadPreview?: unknown;
};

export function formatCompanionApprovals(data: unknown): string {
  const count =
    data && typeof data === "object" && data !== null && "count" in data
      ? (data as { count?: unknown }).count
      : 0;
  const dominantLanes =
    data &&
    typeof data === "object" &&
    data !== null &&
    "dominantLanes" in data &&
    Array.isArray((data as { dominantLanes?: unknown }).dominantLanes)
      ? ((data as { dominantLanes: unknown[] }).dominantLanes as CompanionApprovalLane[])
      : [];
  const oldestWaiting =
    data && typeof data === "object" && data !== null && "oldestWaiting" in data
      ? ((data as { oldestWaiting?: unknown }).oldestWaiting as Record<string, unknown> | null | undefined)
      : undefined;
  const items =
    data &&
    typeof data === "object" &&
    data !== null &&
    "items" in data &&
    Array.isArray((data as { items?: unknown }).items)
      ? ((data as { items: unknown[] }).items as CompanionApprovalItem[])
      : [];

  return [
    "Companion approvals",
    "",
    `Pending approvals: ${String(count ?? 0)}`,
    dominantLanes.length > 0
      ? `Dominant lanes: ${dominantLanes
          .map((lane) => `${String(lane.label ?? lane.type ?? "unknown")}=${String(lane.count ?? 0)}`)
          .join(" | ")}`
      : "Dominant lanes: none",
    oldestWaiting
      ? `Oldest waiting: ${String(oldestWaiting.label ?? oldestWaiting.type ?? "unknown")} ${String(oldestWaiting.taskId ?? "unknown")} since ${String(oldestWaiting.requestedAt ?? "unknown")}`
      : "Oldest waiting: none",
    ...(items.length > 0
      ? ["", ...items.map((item) => `- ${String(item.type ?? "unknown")} ${String(item.taskId ?? "unknown")} requested ${String(item.requestedAt ?? "unknown")} preview=${String(item.payloadPreview ?? "n/a")}`)]
      : ["", "No approval items returned."]),
  ].join("\n");
}
