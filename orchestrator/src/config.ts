import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OrchestratorConfig } from "./types.js";

const DEFAULT_CONFIG_URL = new URL(
  "../../orchestrator_config.json",
  import.meta.url,
);

function parseCsvEnv(name: string): string[] | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return parsed.length > 0 ? Array.from(new Set(parsed)) : [];
}

function parseBooleanEnv(name: string): boolean | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(
    `${name} must be one of: true|false|1|0|yes|no|on|off`,
  );
}

function parseIntegerEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a valid integer`);
  }
  return parsed;
}

const CONFIG_PATH_KEYS: Array<keyof OrchestratorConfig> = [
  "docsPath",
  "cookbookPath",
  "logsDir",
  "stateFile",
  "deployBaseDir",
  "rssConfigPath",
  "redditDraftsPath",
  "knowledgePackDir",
  "runtimeEngagementOsPath",
  "digestDir",
  "businessRegistryPath",
  "businessEvidenceDir",
  "businessOperationsStateFile",
  "publishingRegistryPath",
  "publishingDatabasePath",
];

function isRuntimeTarget(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/.test(value);
}

function resolveConfigValue(configDir: string, value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed || isAbsolute(trimmed) || isRuntimeTarget(trimmed)) {
    return value;
  }

  return resolve(configDir, trimmed);
}

export async function loadConfig(
  customPath?: string,
): Promise<OrchestratorConfig> {
  const path =
    customPath ??
    process.env.ORCHESTRATOR_CONFIG ??
    fileURLToPath(DEFAULT_CONFIG_URL);

  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw);
  const configDir = dirname(path);

  // Allow env-var overrides for local dev (config bakes in Docker paths)
  if (process.env.STATE_FILE) parsed.stateFile = process.env.STATE_FILE;
  const corsAllowedOrigins = parseCsvEnv("ORCHESTRATOR_CORS_ALLOWED_ORIGINS");
  if (corsAllowedOrigins !== undefined) {
    parsed.corsAllowedOrigins = corsAllowedOrigins;
  }
  const corsAllowedMethods = parseCsvEnv("ORCHESTRATOR_CORS_ALLOWED_METHODS");
  if (corsAllowedMethods !== undefined) {
    parsed.corsAllowedMethods = corsAllowedMethods;
  }
  const corsAllowedHeaders = parseCsvEnv("ORCHESTRATOR_CORS_ALLOWED_HEADERS");
  if (corsAllowedHeaders !== undefined) {
    parsed.corsAllowedHeaders = corsAllowedHeaders;
  }
  const corsExposedHeaders = parseCsvEnv("ORCHESTRATOR_CORS_EXPOSED_HEADERS");
  if (corsExposedHeaders !== undefined) {
    parsed.corsExposedHeaders = corsExposedHeaders;
  }
  const corsAllowCredentials = parseBooleanEnv(
    "ORCHESTRATOR_CORS_ALLOW_CREDENTIALS",
  );
  if (corsAllowCredentials !== undefined) {
    parsed.corsAllowCredentials = corsAllowCredentials;
  }
  const corsMaxAgeSeconds = parseIntegerEnv("ORCHESTRATOR_CORS_MAX_AGE_SECONDS");
  if (corsMaxAgeSeconds !== undefined) {
    parsed.corsMaxAgeSeconds = corsMaxAgeSeconds;
  }
  const businessValueCadenceMinutes = parseIntegerEnv(
    "ORCHESTRATOR_BUSINESS_VALUE_CADENCE_MINUTES",
  );
  if (businessValueCadenceMinutes !== undefined) {
    parsed.businessValueCadenceMinutes = businessValueCadenceMinutes;
  }
  if (process.env.ORCHESTRATOR_BUSINESS_VALUE_SCHEDULE?.trim()) {
    parsed.businessValueSchedule = process.env.ORCHESTRATOR_BUSINESS_VALUE_SCHEDULE.trim();
  }
  if (process.env.ORCHESTRATOR_BUSINESS_DAY_PULSE_SCHEDULE?.trim()) {
    parsed.businessDayPulseSchedule = process.env.ORCHESTRATOR_BUSINESS_DAY_PULSE_SCHEDULE.trim();
  }
  if (process.env.ORCHESTRATOR_BUSINESS_DAY_PULSE_TIME_ZONE?.trim()) {
    parsed.businessDayPulseTimeZone = process.env.ORCHESTRATOR_BUSINESS_DAY_PULSE_TIME_ZONE.trim();
  }
  const operatorStateRoot = process.env.OPENCLAW_OPERATOR_STATE_DIR?.trim();
  if (operatorStateRoot) {
    parsed.logsDir = resolve(operatorStateRoot, "logs");
    parsed.stateFile = resolve(
      operatorStateRoot,
      "orchestrator",
      "orchestrator-state.json",
    );
    parsed.publishingDatabasePath = resolve(
      operatorStateRoot,
      "database",
      "deterministic-publishing.sqlite",
    );
  }

  for (const key of CONFIG_PATH_KEYS) {
    parsed[key] = resolveConfigValue(configDir, parsed[key]);
  }

  if (!parsed.docsPath) {
    throw new Error("orchestrator_config.json is missing docsPath");
  }
  if (!parsed.logsDir) {
    throw new Error("orchestrator_config.json is missing logsDir");
  }
  if (!parsed.stateFile) {
    throw new Error("orchestrator_config.json is missing stateFile");
  }

  return parsed as OrchestratorConfig;
}
