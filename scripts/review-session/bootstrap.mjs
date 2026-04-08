import { randomUUID } from "node:crypto";
import { openSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = resolve(__dirname, "..", "..");
const openclawRoot = resolve(workspaceRoot, "..");
const orchestratorRoot = resolve(workspaceRoot, "orchestrator");
const orchestratorRequire = createRequire(resolve(orchestratorRoot, "package.json"));

function resolveOrchestratorConfigPath() {
  const configured = process.env.ORCHESTRATOR_CONFIG;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return resolve(configured.trim());
  }
  return resolve(workspaceRoot, "orchestrator_config.json");
}

function stripWrappingQuotes(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function loadDotEnvFile(filePath) {
  try {
    const raw = await readFile(filePath, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      if (!key || process.env[key]) {
        continue;
      }
      const value = stripWrappingQuotes(trimmed.slice(separatorIndex + 1).trim());
      process.env[key] = value;
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function loadBootstrapEnv() {
  const envPaths = [
    process.env.OPENCLAW_ENV_FILE,
    resolve(workspaceRoot, ".env"),
    resolve(orchestratorRoot, ".env"),
    resolve(openclawRoot, ".env"),
  ].filter((value, index, items) => typeof value === "string" && value.length > 0 && items.indexOf(value) === index);

  for (const envPath of envPaths) {
    await loadDotEnvFile(envPath);
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      continue;
    }

    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values[key] = "true";
      continue;
    }

    values[key] = next;
    index += 1;
  }
  return values;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function resolvePortFromBaseUrl(baseUrl) {
  try {
    const url = new URL(baseUrl);
    if (url.port && url.port.trim().length > 0) {
      return url.port.trim();
    }
    return url.protocol === "https:" ? "443" : "80";
  } catch {
    return null;
  }
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizePositiveInteger(value, fallback, minimum = 1) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, parsed);
}

async function readCpuSnapshot() {
  try {
    const raw = await readFile("/proc/stat", "utf-8");
    const line = raw.split("\n").find((item) => item.startsWith("cpu "));
    if (!line) {
      return null;
    }

    const values = line.trim().split(/\s+/).slice(1).map((item) => Number.parseInt(item, 10));
    if (values.some((item) => !Number.isFinite(item))) {
      return null;
    }

    const idle = (values[3] ?? 0) + (values[4] ?? 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    return { idle, total };
  } catch {
    return null;
  }
}

async function readMemoryUsageMb() {
  try {
    const raw = await readFile("/proc/meminfo", "utf-8");
    const lines = raw.split("\n");
    const totalLine = lines.find((line) => line.startsWith("MemTotal:"));
    const availableLine = lines.find((line) => line.startsWith("MemAvailable:"));
    if (!totalLine || !availableLine) {
      return null;
    }

    const totalKb = Number.parseInt(totalLine.match(/\d+/)?.[0] ?? "0", 10);
    const availableKb = Number.parseInt(availableLine.match(/\d+/)?.[0] ?? "0", 10);
    if (totalKb <= 0 || availableKb < 0) {
      return null;
    }

    return {
      usedMb: Math.round((totalKb - availableKb) / 1024),
      totalMb: Math.round(totalKb / 1024),
    };
  } catch {
    return null;
  }
}

const ROLE_RANK = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

function normalizeRoles(roles, fallback = ["admin"]) {
  if (!Array.isArray(roles)) {
    return fallback;
  }

  const normalized = roles.filter((role) => role === "viewer" || role === "operator" || role === "admin");
  return normalized.length > 0 ? Array.from(new Set(normalized)) : fallback;
}

function resolveHighestRole(roles) {
  return normalizeRoles(roles, ["viewer"]).reduce((highest, current) => {
    if ((ROLE_RANK[current] ?? 0) > (ROLE_RANK[highest] ?? 0)) {
      return current;
    }
    return highest;
  }, "viewer");
}

function resolveAuthToken() {
  if (process.env.REVIEW_SESSION_API_KEY && process.env.REVIEW_SESSION_API_KEY.trim().length > 0) {
    return process.env.REVIEW_SESSION_API_KEY.trim();
  }

  const now = Date.now();
  if (process.env.API_KEY_ROTATION) {
    try {
      const parsed = JSON.parse(process.env.API_KEY_ROTATION);
      if (Array.isArray(parsed)) {
        const eligibleKeys = parsed
          .filter((entry) => entry && typeof entry === "object")
          .map((entry) => {
            const key = typeof entry.key === "string" ? entry.key.trim() : "";
            const active = entry.active !== false;
            const roles = normalizeRoles(entry.roles, ["admin"]);
            const highestRole = resolveHighestRole(roles);
            const expiresAt = typeof entry.expiresAt === "string" ? Date.parse(entry.expiresAt) : null;
            const expired = Number.isFinite(expiresAt) ? expiresAt <= now : false;
            return {
              key,
              active,
              roles,
              highestRole,
              expired,
            };
          })
          .filter((entry) => entry.key && entry.active && !entry.expired)
          .sort((left, right) => (ROLE_RANK[right.highestRole] ?? 0) - (ROLE_RANK[left.highestRole] ?? 0));

        const rotatedKey = eligibleKeys.find(
          (entry) => entry.highestRole === "admin" || entry.highestRole === "operator",
        ) ?? eligibleKeys[0];

        if (typeof rotatedKey?.key === "string" && rotatedKey.key.trim().length > 0) {
          return rotatedKey.key.trim();
        }
      }
    } catch {
      // Fall through to API_KEY.
    }
  }

  if (process.env.API_KEY && process.env.API_KEY.trim().length > 0) {
    return process.env.API_KEY.trim();
  }

  return null;
}

async function assertStackOff(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/health`);
    if (response.ok) {
      throw new Error(`OpenClaw appears to be running already at ${baseUrl}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("appears to be running")) {
      throw error;
    }
  }
}

async function captureBaseline(windowMs, intervalMs) {
  const baselineStartedAt = new Date().toISOString();
  const samples = [];
  let previousCpu = await readCpuSnapshot();
  const count = Math.max(1, Math.floor(windowMs / intervalMs));

  for (let index = 0; index < count; index += 1) {
    await sleep(intervalMs);
    const currentCpu = await readCpuSnapshot();
    const memory = await readMemoryUsageMb();
    const [load1] = os.loadavg();

    let cpuPercent = 0;
    if (previousCpu && currentCpu) {
      const idleDelta = currentCpu.idle - previousCpu.idle;
      const totalDelta = currentCpu.total - previousCpu.total;
      if (totalDelta > 0) {
        cpuPercent = round2((1 - idleDelta / totalDelta) * 100);
      }
    }
    previousCpu = currentCpu;

    samples.push({
      capturedAt: new Date().toISOString(),
      cpuPercent,
      loadAvg1m: round2(load1 ?? 0),
      memoryUsedMb: memory?.usedMb ?? 0,
      memoryTotalMb: memory?.totalMb ?? Math.round(os.totalmem() / (1024 * 1024)),
    });
  }

  return {
    baselineStartedAt,
    baselineEndedAt: new Date().toISOString(),
    baselineSamples: samples,
    baselineSummary: {
      cpuPercentAvg: round2(average(samples.map((sample) => sample.cpuPercent))),
      cpuPercentPeak: round2(Math.max(...samples.map((sample) => sample.cpuPercent))),
      loadAvg1m: round2(average(samples.map((sample) => sample.loadAvg1m))),
      memoryUsedMbAvg: round2(average(samples.map((sample) => sample.memoryUsedMb))),
      memoryUsedMbPeak: round2(Math.max(...samples.map((sample) => sample.memoryUsedMb))),
    },
  };
}

function buildMachineProfile(memoryTotalMb) {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCores: cpus.length,
    memoryTotalMb,
  };
}

function buildCapturePlan(args) {
  const profile = String(args.profile ?? process.env.REVIEW_SESSION_PROFILE ?? "standard").toLowerCase() === "soak-24h"
    ? "soak-24h"
    : "standard";

  const defaults =
    profile === "soak-24h"
      ? {
          baselineMs: 30000,
          baselineSampleIntervalMs: 5000,
          sampleIntervalMs: 60000,
          maxSamples: 1800,
          intendedDurationHours: 24,
          targetTaskCount: 5000,
          postHandoffBucket: "steady_state_running_cost",
        }
      : {
          baselineMs: 5000,
          baselineSampleIntervalMs: 1000,
          sampleIntervalMs: 5000,
          maxSamples: 1440,
          intendedDurationHours: null,
          targetTaskCount: null,
          postHandoffBucket: "steady_state_running_cost",
        };

  const requestedPostHandoffBucket = String(args["post-handoff-bucket"] ?? "").trim();
  const postHandoffBucket = [
    "startup_cost",
    "steady_state_running_cost",
    "burst_workload",
    "user_experience_evidence",
  ].includes(requestedPostHandoffBucket)
    ? requestedPostHandoffBucket
    : defaults.postHandoffBucket;

  return {
    profile,
    baselineMs: normalizePositiveInteger(args["baseline-ms"], defaults.baselineMs, 1000),
    baselineSampleIntervalMs: normalizePositiveInteger(
      args["baseline-sample-interval-ms"],
      defaults.baselineSampleIntervalMs,
      250,
    ),
    sampleIntervalMs: normalizePositiveInteger(
      args["sample-interval-ms"],
      defaults.sampleIntervalMs,
      1000,
    ),
    maxSamples: normalizePositiveInteger(args["max-samples"], defaults.maxSamples, 60),
    intendedDurationHours:
      args["intended-duration-hours"] !== undefined
        ? normalizePositiveInteger(args["intended-duration-hours"], defaults.intendedDurationHours ?? 1, 1)
        : defaults.intendedDurationHours,
    targetTaskCount:
      args["target-task-count"] !== undefined
        ? normalizePositiveInteger(args["target-task-count"], defaults.targetTaskCount ?? 1, 1)
        : defaults.targetTaskCount,
    postHandoffBucket,
  };
}

async function resolveStateFilePath() {
  const orchestratorConfigPath = resolveOrchestratorConfigPath();
  const raw = await readFile(orchestratorConfigPath, "utf-8");
  const parsed = JSON.parse(raw);
  if (typeof parsed?.stateFile !== "string" || parsed.stateFile.length === 0) {
    throw new Error(`Missing stateFile in ${orchestratorConfigPath}`);
  }
  return parsed.stateFile;
}

function isMongoStateTarget(target) {
  return typeof target === "string" && target.startsWith("mongo:");
}

function resolveMongoStateKey(target) {
  const key = target.slice("mongo:".length).trim();
  if (!key) {
    throw new Error("mongo state target must include a key");
  }
  return key;
}

async function withMongoStateCollection(callback) {
  const { MongoClient } = orchestratorRequire("mongodb");
  const client = new MongoClient(
    process.env.DATABASE_URL || "mongodb://mongo:27017/orchestrator",
  );
  await client.connect();
  try {
    const db = client.db(process.env.DB_NAME || "orchestrator");
    return await callback(db.collection("system_state"));
  } finally {
    await client.close();
  }
}

function normalizeMongoPayload(payload) {
  if (payload instanceof Uint8Array || Buffer.isBuffer(payload)) {
    return payload;
  }
  if (payload && typeof payload === "object") {
    if (payload.buffer instanceof Uint8Array) {
      return payload.buffer;
    }
    if (typeof payload.value === "function") {
      const value = payload.value(true);
      if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
        return value;
      }
    }
  }
  return null;
}

function decodeMongoStateDoc(doc) {
  if (!doc || typeof doc !== "object") {
    return {};
  }

  if (doc.encoding === "gzip-json") {
    const payload = normalizeMongoPayload(doc.payload);
    if (payload) {
      try {
        return JSON.parse(gunzipSync(payload).toString("utf-8"));
      } catch {
        return {};
      }
    }
  }

  return doc.value && typeof doc.value === "object" ? doc.value : {};
}

function encodeMongoState(state) {
  const payload = gzipSync(Buffer.from(JSON.stringify(state), "utf-8"));
  return {
    encoding: "gzip-json",
    payload,
    payloadBytes: payload.byteLength,
  };
}

async function readStateFile(stateFilePath) {
  if (isMongoStateTarget(stateFilePath)) {
    return withMongoStateCollection(async (collection) => {
      const doc = await collection.findOne({ key: resolveMongoStateKey(stateFilePath) });
      return decodeMongoStateDoc(doc);
    });
  }

  try {
    const raw = await readFile(stateFilePath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeStateFile(stateFilePath, state) {
  if (isMongoStateTarget(stateFilePath)) {
    await withMongoStateCollection(async (collection) => {
      const key = resolveMongoStateKey(stateFilePath);
      const existing = await collection.findOne({ key });
      const encoded = encodeMongoState(state);
      if (existing) {
        await collection.updateOne(
          { key },
          {
            $set: {
              ...encoded,
              version: Number(existing.version ?? 0) + 1,
              updatedAt: new Date(),
            },
            $unset: {
              value: "",
            },
          },
        );
        return;
      }

      await collection.insertOne({
        key,
        ...encoded,
        version: 1,
        updatedAt: new Date(),
      });
    });
    return;
  }

  await writeFile(stateFilePath, JSON.stringify(state, null, 2), "utf-8");
}

function appendScenarioNote(session, bucket, capturedAt, text) {
  const scenarioNotes = Array.isArray(session.scenarioNotes) ? session.scenarioNotes : [];
  scenarioNotes.push({ capturedAt, bucket, text });
  session.scenarioNotes = scenarioNotes;
}

function createEmptyCumulativeWorkload() {
  return {
    acceptedRuns: 0,
    completedRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    retriedRuns: 0,
    pendingRuns: 0,
    totalCostUsd: 0,
    latencySampleCount: 0,
    latencySumMs: 0,
    peakLatencyMs: null,
    taskTypeCounts: {},
    lastAcceptedAt: null,
    lastCompletedAt: null,
  };
}

export function reconcileStaleReviewSessionsState(state, options = {}) {
  const reviewSessions = Array.isArray(state?.reviewSessions) ? state.reviewSessions : null;
  if (!reviewSessions) {
    return {
      updated: false,
      completedActiveCount: 0,
      failedPendingCount: 0,
    };
  }

  const now = typeof options.now === "string" ? options.now : new Date().toISOString();
  const baseUrl =
    typeof options.baseUrl === "string" && options.baseUrl.trim().length > 0
      ? options.baseUrl.trim()
      : "the requested base URL";
  let completedActiveCount = 0;
  let failedPendingCount = 0;

  for (const session of reviewSessions) {
    if (!session || typeof session !== "object") {
      continue;
    }

    if (session.state === "active") {
      session.state = "completed";
      session.endedAt = typeof session.endedAt === "string" ? session.endedAt : now;
      appendScenarioNote(
        session,
        typeof session.activeBucket === "string" ? session.activeBucket : "steady_state_running_cost",
        now,
        `Bootstrap preflight reconciled this stale active review session after no runtime responded at ${baseUrl}.`,
      );
      completedActiveCount += 1;
      continue;
    }

    if (session.state === "pending_handoff") {
      session.state = "handoff_failed";
      session.endedAt = typeof session.endedAt === "string" ? session.endedAt : now;
      session.failureReason =
        typeof session.failureReason === "string" && session.failureReason.length > 0
          ? session.failureReason
          : `Bootstrap preflight reconciled a stale pending handoff after no runtime responded at ${baseUrl}.`;
      appendScenarioNote(
        session,
        typeof session.activeBucket === "string" ? session.activeBucket : "startup_cost",
        now,
        `Bootstrap preflight marked this stale pending handoff as failed after no runtime responded at ${baseUrl}.`,
      );
      failedPendingCount += 1;
    }
  }

  return {
    updated: completedActiveCount > 0 || failedPendingCount > 0,
    completedActiveCount,
    failedPendingCount,
  };
}

export async function reconcileStaleReviewSessions(stateFilePath, baseUrl) {
  const state = await readStateFile(stateFilePath);
  const summary = reconcileStaleReviewSessionsState(state, { baseUrl });
  if (!summary.updated) {
    return summary;
  }

  await writeStateFile(stateFilePath, state);
  return summary;
}

function buildBootstrapSamples(reviewSessionId, baselineSamples, profile) {
  return baselineSamples.map((sample) => ({
    reviewSessionId,
    capturedAt: sample.capturedAt,
    bucket: "baseline_idle",
    source: "bootstrap",
    host: {
      cpuPercent: sample.cpuPercent,
      load1: sample.loadAvg1m,
      load5: sample.loadAvg1m,
      load15: sample.loadAvg1m,
      memoryUsedBytes: Math.round(sample.memoryUsedMb * 1024 * 1024),
      memoryTotalBytes: Math.round(sample.memoryTotalMb * 1024 * 1024),
    },
    process: {
      rssBytes: null,
      heapUsedBytes: null,
      heapTotalBytes: null,
      uptimeSec: null,
    },
    activity: {
      openIncidents: 0,
      queueDepth: 0,
      activeRuns: 0,
      recentRunIds: [],
    },
    tags: ["baseline_idle", "bootstrap", profile],
  }));
}

async function persistPendingHandoff(stateFilePath, payload) {
  const state = await readStateFile(stateFilePath);
  const reviewSessions = Array.isArray(state.reviewSessions) ? state.reviewSessions : [];
  const reviewTelemetrySamples = Array.isArray(state.reviewTelemetrySamples)
    ? state.reviewTelemetrySamples
    : [];

  state.reviewSessions = reviewSessions.filter((session) => session?.id !== payload.reviewSessionId);
  state.reviewSessions.push({
    id: payload.reviewSessionId,
    source: "bootstrap_handoff",
    state: "pending_handoff",
    title: payload.title,
    createdAt: payload.createdAt,
    startedAt: payload.startupStartedAt,
    endedAt: null,
    baselineStartedAt: payload.baselineStartedAt,
    baselineEndedAt: payload.baselineEndedAt,
    startupStartedAt: payload.startupStartedAt,
    handoffReceivedAt: null,
    activeBucket: payload.initialBucket,
    capturePlan: payload.capturePlan,
    machine: payload.machine,
    baselineSummary: payload.baselineSummary,
    bucketTimeline: [
      { bucket: "baseline_idle", capturedAt: payload.baselineStartedAt, note: "baseline capture started" },
      { bucket: payload.initialBucket, capturedAt: payload.startupStartedAt, note: "startup began" },
    ],
    scenarioNotes: payload.notes,
    linkedRunIds: [],
    cumulativeWorkload: createEmptyCumulativeWorkload(),
    summary: null,
    failureReason: null,
  });

  state.reviewTelemetrySamples = reviewTelemetrySamples.filter(
    (sample) => !(sample?.reviewSessionId === payload.reviewSessionId && sample?.source === "bootstrap"),
  );
  state.reviewTelemetrySamples.push(
    ...buildBootstrapSamples(payload.reviewSessionId, payload.baselineSamples, payload.capturePlan.profile),
  );

  await writeStateFile(stateFilePath, state);
}

async function persistHandoffFailure(stateFilePath, reviewSessionId, reason) {
  const state = await readStateFile(stateFilePath);
  const sessions = Array.isArray(state.reviewSessions) ? state.reviewSessions : [];
  const session = sessions.find((entry) => entry?.id === reviewSessionId);
  if (!session || session.state === "active" || session.state === "completed") {
    return;
  }
  session.state = "handoff_failed";
  session.endedAt = typeof session.endedAt === "string" ? session.endedAt : new Date().toISOString();
  session.failureReason = reason;
  await writeStateFile(stateFilePath, state);
}

function startOrchestrator(baseUrl, fastStartEnabled, runtimeLogPath) {
  const targetPort = resolvePortFromBaseUrl(baseUrl);
  const orchestratorConfigPath = resolveOrchestratorConfigPath();
  const childEnv = {
    ...process.env,
    ...(targetPort ? { PORT: targetPort } : {}),
    ORCHESTRATOR_CONFIG: orchestratorConfigPath,
  };

  if (fastStartEnabled) {
    childEnv.ORCHESTRATOR_FAST_START = "true";
  }

  const stdoutFd = openSync(runtimeLogPath, "a");
  const child = spawn(process.execPath, ["--import", "tsx", "--env-file=.env", "src/index.ts"], {
    cwd: orchestratorRoot,
    detached: true,
    stdio: ["ignore", stdoutFd, stdoutFd],
    env: childEnv,
  });
  child.unref();
  return child.pid;
}

function stopSpawnedOrchestrator(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Best-effort cleanup only.
  }
}

async function waitForHealth(baseUrl, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling
    }

    await sleep(2000);
  }

  throw new Error(`Timed out waiting for orchestrator health at ${baseUrl}`);
}

async function postHandoff(baseUrl, token, payload, retryPath) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/review-sessions/bootstrap-handoff`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`bootstrap handoff failed (${response.status}): ${await response.text()}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      await sleep(1500 * attempt);
    }
  }

  await writeFile(
    retryPath,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        payload,
        error: lastError instanceof Error ? lastError.message : String(lastError),
      },
      null,
      2,
    ),
    "utf-8",
  );

  throw new Error(
    `${lastError instanceof Error ? lastError.message : String(lastError)}. Retry payload saved to ${retryPath}`,
  );
}

async function main() {
  await loadBootstrapEnv();

  const args = parseArgs(process.argv.slice(2));
  const title = typeof args.title === "string" ? args.title : `Review Session ${new Date().toISOString()}`;
  const defaultPort = process.env.PORT || "3000";
  const defaultBaseUrl = process.env.REVIEW_SESSION_BASE_URL || `http://127.0.0.1:${defaultPort}`;
  const baseUrl = typeof args.baseUrl === "string" ? args.baseUrl : defaultBaseUrl;
  const capturePlan = buildCapturePlan(args);
  const timeoutMs = Number.parseInt(String(args["wait-timeout-ms"] ?? "240000"), 10);
  const fastStartEnabled =
    String(args["fast-start"] ?? process.env.REVIEW_SESSION_FAST_START ?? "false").toLowerCase() === "true";
  const token = resolveAuthToken();
  const stateFilePath = await resolveStateFilePath();

  if (!token) {
    throw new Error("Missing API_KEY or active API_KEY_ROTATION entry for review-session bootstrap handoff");
  }

  await assertStackOff(baseUrl);
  const staleReviewSessionSummary = await reconcileStaleReviewSessions(stateFilePath, baseUrl);
  if (staleReviewSessionSummary.updated) {
    console.log(
      `[review-session] reconciled stale review sessions in runtime state (${staleReviewSessionSummary.completedActiveCount} active -> completed, ${staleReviewSessionSummary.failedPendingCount} pending -> handoff_failed)`,
    );
  }

  const reviewSessionId = randomUUID();
  console.log(`[review-session] capturing baseline for ${reviewSessionId} (${capturePlan.profile})`);
  const baseline = await captureBaseline(capturePlan.baselineMs, capturePlan.baselineSampleIntervalMs);
  const startupStartedAt = new Date().toISOString();
  const memoryTotalMb = baseline.baselineSamples.at(-1)?.memoryTotalMb ?? Math.round(os.totalmem() / (1024 * 1024));

  const payload = {
    reviewSessionId,
    title,
    createdAt: new Date().toISOString(),
    baselineStartedAt: baseline.baselineStartedAt,
    baselineEndedAt: baseline.baselineEndedAt,
    startupStartedAt,
    machine: buildMachineProfile(memoryTotalMb),
    baselineSummary: baseline.baselineSummary,
    baselineSamples: baseline.baselineSamples,
    initialBucket: "startup_cost",
    postHandoffBucket: capturePlan.postHandoffBucket,
    capturePlan: {
      profile: capturePlan.profile,
      sampleIntervalMs: capturePlan.sampleIntervalMs,
      maxSamples: capturePlan.maxSamples,
      intendedDurationHours: capturePlan.intendedDurationHours,
      targetTaskCount: capturePlan.targetTaskCount,
    },
    notes: [
      {
        capturedAt: baseline.baselineEndedAt,
        bucket: "baseline_idle",
        text:
          capturePlan.profile === "soak-24h"
            ? "Bootstrap captured the pre-stack baseline before the 24h soak run startup."
            : "Bootstrap captured the pre-stack baseline before orchestrator startup.",
      },
    ],
  };

  const retryPath = resolve(os.tmpdir(), `openclaw-review-session-${reviewSessionId}.json`);
  const runtimeLogPath = resolve(os.tmpdir(), `openclaw-review-session-${reviewSessionId}.runtime.log`);
  await writeFile(
    retryPath,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        mode: "bootstrap-pending",
        runtimeLogPath,
        payload,
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(`[review-session] baseline capture complete for ${reviewSessionId}`);
  console.log(`[review-session] state target ${stateFilePath}`);

  const shouldPersistPendingHandoff = !isMongoStateTarget(stateFilePath);
  if (shouldPersistPendingHandoff) {
    console.log("[review-session] persisting pending handoff into runtime state");
    await persistPendingHandoff(stateFilePath, payload);
    console.log("[review-session] pending handoff persisted");
  } else {
    console.log("[review-session] skipping pre-start pending handoff persistence for mongo-backed runtime state");
  }

  let result;
  let pid = null;
  try {
    pid = startOrchestrator(baseUrl, fastStartEnabled, runtimeLogPath);
    console.log(`[review-session] started orchestrator runtime directly (pid ${pid ?? "unknown"})`);
    console.log(`[review-session] target base URL ${baseUrl}`);
    console.log(`[review-session] runtime log ${runtimeLogPath}`);
    console.log(
      `[review-session] capture plan ${capturePlan.profile} -> ${capturePlan.sampleIntervalMs}ms interval, ${capturePlan.maxSamples} samples, target ${capturePlan.targetTaskCount ?? "n/a"} tasks`,
    );
    await waitForHealth(baseUrl, timeoutMs);
    result = await postHandoff(baseUrl, token, payload, retryPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (shouldPersistPendingHandoff) {
      await persistHandoffFailure(stateFilePath, reviewSessionId, reason);
    }
    stopSpawnedOrchestrator(pid);
    throw error;
  }

  console.log(`[review-session] bootstrap handoff complete for ${reviewSessionId}`);
  console.log(JSON.stringify({ reviewSessionId, baseUrl, result }, null, 2));
}

const isEntrypoint =
  typeof process.argv[1] === "string" &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isEntrypoint) {
  main().catch((error) => {
    console.error(`[review-session] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
