import net from 'node:net';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type TaskHistoryRecord = {
  id?: string;
  type?: string;
  handledAt?: string;
  result?: 'ok' | 'error';
  message?: string;
};

type TaskExecutionRecord = {
  taskId?: string;
  idempotencyKey?: string;
  status?: 'pending' | 'running' | 'success' | 'failed' | 'retrying';
  completedAt?: string | null;
  lastHandledAt?: string | null;
};

type StateFile = {
  taskHistory?: TaskHistoryRecord[];
  taskExecutions?: TaskExecutionRecord[];
  reviewSessions?: ReviewSessionRecord[];
};

type ReviewSessionRecord = {
  id?: string;
  state?: string;
  createdAt?: string;
  startedAt?: string;
  capturePlan?: {
    targetTaskCount?: number | null;
    intendedDurationHours?: number | null;
  };
  summary?: {
    workload?: {
      cumulative?: ReviewSessionCumulativeWorkloadSummary;
    };
  };
};

type TaskTriggerRequest = {
  type: string;
  payload: Record<string, unknown>;
};

type WorkloadSpec = {
  name: string;
  type: string;
  weight: number;
  payload: Record<string, unknown>;
};

type WorkloadPlan = {
  profile: string;
  source: 'builtin' | 'history' | 'manifest';
  specs: WorkloadSpec[];
  excludedTypes: string[];
};

type ExecutionStatusSummary = {
  success: number;
  failed: number;
  retrying: number;
  pendingOrRunning: number;
};

type ReviewSessionCumulativeWorkloadSummary = {
  acceptedRuns: number;
  completedRuns: number;
  successfulRuns: number;
  failedRuns: number;
  retriedRuns: number;
  pendingRuns: number;
  totalCostUsd: number;
  averageLatencyMs: number | null;
  peakLatencyMs: number | null;
  topTaskTypes: Array<{ type: string; count: number }>;
  lastAcceptedAt: string | null;
  lastCompletedAt: string | null;
};

type DispatchTimingPlan = {
  mode: 'fixed-interval' | 'duration-paced';
  intervalMs: number;
  targetDurationMs: number | null;
  targetDispatchRatePerMin: number;
};

type FeederMode = 'paced-total' | 'queue-top-up';

type ExtendedHealthResponse = {
  queue?: {
    queued?: number;
    processing?: number;
  };
};

type QueuePressureSnapshot = {
  capturedAt: string;
  acceptedRuns: number;
  completedRuns: number;
  successfulRuns: number;
  failedRuns: number;
  retriedRuns: number;
  pendingRuns: number;
  queueQueued: number;
  queueProcessing: number;
};

type QueueTopUpConfig = {
  durationMs: number;
  topUpPollMs: number;
  topUpBatchSize: number;
  maxQueueDepth: number;
  metricsSnapshotMs: number;
};

type QueueTopUpSummary = {
  startedAt: string;
  endedAt: string;
  sampledDurationMs: number;
  feederAccepted: number;
  feederThrottled: number;
  feederUnauthorized: number;
  feederOtherErrors: number;
  cumulativeDelta: {
    acceptedRuns: number;
    completedRuns: number;
    successfulRuns: number;
    failedRuns: number;
    retriedRuns: number;
    pendingRuns: number;
  } | null;
  throughputPerHour: {
    feederAcceptedAvg: number;
    completedAvg: number | null;
    completedPeak: number | null;
    acceptedPeak: number | null;
  };
  queuePressure: {
    queuedAvg: number | null;
    queuedPeak: number | null;
    processingAvg: number | null;
    processingPeak: number | null;
  };
  sampleCount: number;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const orchestratorRoot = resolve(scriptDir, '..');

export function resolveOrchestratorConfigPath() {
  const configured = process.env.ORCHESTRATOR_CONFIG?.trim();
  if (configured) {
    return resolve(configured);
  }
  return resolve(orchestratorRoot, '..', 'orchestrator_config.json');
}

function loadLocalEnv(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(orchestratorRoot, '.env'),
  ];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    try {
      process.loadEnvFile(candidate);
      return;
    } catch {
      // Try the next candidate; direct env vars may already be sufficient.
    }
  }
}

loadLocalEnv();

function extractCompletedHeartbeatSeq(stdout: string, runId: string): Set<number> {
  const completed = new Set<number>();
  const escapedRunId = runId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\[orchestrator\\] ✅ heartbeat: heartbeat \\(${escapedRunId}-(\\d+)\\)`, 'g');

  let match: RegExpExecArray | null;
  while ((match = regex.exec(stdout)) !== null) {
    const seq = Number(match[1]);
    if (!Number.isNaN(seq)) {
      completed.add(seq);
    }
  }

  return completed;
}

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseOptionalPositiveInteger(value: string | undefined): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalPositiveNumber(value: string | undefined): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseFeederMode(value: string | undefined): FeederMode {
  return String(value ?? '').trim().toLowerCase() === 'queue-top-up'
    ? 'queue-top-up'
    : 'paced-total';
}

function resolveRequestedDurationMs(
  durationHoursRaw: string | undefined,
  durationMsRaw: string | undefined,
): number | null {
  const durationMs = parseOptionalPositiveInteger(durationMsRaw);
  if (durationMs !== null) {
    return durationMs;
  }

  const durationHours = parseOptionalPositiveNumber(durationHoursRaw);
  if (durationHours === null) {
    return null;
  }

  return Math.round(durationHours * 60 * 60 * 1000);
}

export function resolveDispatchTimingPlan(
  totalTasks: number,
  requestedIntervalMs: number | null,
  requestedDurationMs: number | null,
): DispatchTimingPlan {
  if (requestedDurationMs !== null && totalTasks > 0) {
    const intervalMs = Math.max(1, Math.round(requestedDurationMs / Math.max(1, totalTasks - 1)));
    return {
      mode: 'duration-paced',
      intervalMs,
      targetDurationMs: requestedDurationMs,
      targetDispatchRatePerMin: 60000 / intervalMs,
    };
  }

  const intervalMs = requestedIntervalMs ?? 25;
  return {
    mode: 'fixed-interval',
    intervalMs,
    targetDurationMs: null,
    targetDispatchRatePerMin: 60000 / intervalMs,
  };
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function averageNumbers(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        rejectPort(new Error('Unable to allocate a free port'));
        return;
      }
      const { port } = address;
      server.close(() => resolvePort(port));
    });
    server.on('error', rejectPort);
  });
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function resolveAuthToken(): string | null {
  if (process.env.LIVE_RATE_API_KEY && process.env.LIVE_RATE_API_KEY.trim().length > 0) {
    return process.env.LIVE_RATE_API_KEY.trim();
  }

  if (process.env.REVIEW_SESSION_API_KEY && process.env.REVIEW_SESSION_API_KEY.trim().length > 0) {
    return process.env.REVIEW_SESSION_API_KEY.trim();
  }

  const now = Date.now();
  if (process.env.API_KEY_ROTATION) {
    try {
      const parsed = JSON.parse(process.env.API_KEY_ROTATION);
      if (Array.isArray(parsed)) {
        const activeEntries = parsed
          .filter((entry) => entry && typeof entry === 'object')
          .map((entry) => ({
            key: typeof entry.key === 'string' ? entry.key.trim() : '',
            active: entry.active !== false,
            expiresAt:
              typeof entry.expiresAt === 'string' ? Date.parse(entry.expiresAt) : null,
            roles: Array.isArray(entry.roles) ? entry.roles : [],
          }))
          .filter((entry) => {
            if (!entry.key || !entry.active) return false;
            if (Number.isFinite(entry.expiresAt) && Number(entry.expiresAt) <= now) return false;
            return true;
          })
          .sort((left, right) => {
            const leftRank = left.roles.includes('admin') ? 3 : left.roles.includes('operator') ? 2 : 1;
            const rightRank = right.roles.includes('admin') ? 3 : right.roles.includes('operator') ? 2 : 1;
            return rightRank - leftRank;
          });

        if (activeEntries[0]?.key) {
          return activeEntries[0].key;
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

async function readStateFile(stateFilePath: string): Promise<StateFile> {
  const raw = await readFile(stateFilePath, 'utf-8');
  return JSON.parse(raw) as StateFile;
}

async function readManifestFile(manifestPath: string): Promise<unknown> {
  const raw = await readFile(manifestPath, 'utf-8');
  return JSON.parse(raw) as unknown;
}

function resolveConfigPathTarget(configPath: string, target: string | undefined): string | undefined {
  if (!target || target.startsWith('mongo:')) {
    return target;
  }
  return resolve(dirname(configPath), target);
}

async function resolveActiveReviewSessionId(stateFilePath: string): Promise<string | null> {
  try {
    const parsed = await readStateFile(stateFilePath);
    const activeSessions = (parsed.reviewSessions ?? [])
      .filter((session): session is ReviewSessionRecord => Boolean(session?.id))
      .filter((session) => session.state === 'active')
      .sort((left, right) => {
        const leftTs = Date.parse(left.startedAt ?? left.createdAt ?? '');
        const rightTs = Date.parse(right.startedAt ?? right.createdAt ?? '');
        return (Number.isNaN(rightTs) ? 0 : rightTs) - (Number.isNaN(leftTs) ? 0 : leftTs);
      });

    return activeSessions[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function postJson(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  if (!response.ok) {
    const retryAfterHeader = response.headers.get('Retry-After');
    let retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN;
    if (!Number.isFinite(retryAfterSeconds)) {
      try {
        const parsed = JSON.parse(responseText) as { retryAfterSeconds?: unknown };
        retryAfterSeconds =
          typeof parsed.retryAfterSeconds === 'number' ? parsed.retryAfterSeconds : NaN;
      } catch {
        retryAfterSeconds = NaN;
      }
    }

    const error = new Error(`${path} failed (${response.status}): ${responseText}`) as Error & {
      status?: number;
      retryAfterSeconds?: number | null;
    };
    error.status = response.status;
    error.retryAfterSeconds = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null;
    throw error;
  }

  if (responseText.length === 0) {
    return null;
  }

  return JSON.parse(responseText) as unknown;
}

async function getJson(
  baseUrl: string,
  apiKey: string,
  path: string,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${responseText}`);
  }

  if (responseText.length === 0) {
    return null;
  }

  return JSON.parse(responseText) as unknown;
}

async function fetchExtendedHealthQueue(
  baseUrl: string,
  apiKey: string,
): Promise<{ queued: number; processing: number }> {
  const payload = await getJson(baseUrl, apiKey, '/api/health/extended');
  const parsed = payload as ExtendedHealthResponse | null;
  return {
    queued: Number(parsed?.queue?.queued ?? 0),
    processing: Number(parsed?.queue?.processing ?? 0),
  };
}

async function postJsonWithRateLimitRetry(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
  maxAttempts = 3,
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await postJson(baseUrl, apiKey, path, body);
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : NaN;
      const retryAfterSeconds = typeof error === 'object' && error !== null && 'retryAfterSeconds' in error
        ? Number((error as { retryAfterSeconds?: unknown }).retryAfterSeconds)
        : NaN;
      const shouldRetry = status === 429 && attempt < maxAttempts;

      if (!shouldRetry) {
        throw error;
      }

      const waitSeconds = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds
        : 60;
      console.warn(
        `[review-workload] ${path} rate limited; retrying in ${waitSeconds}s ` +
        `(attempt ${attempt + 1}/${maxAttempts})`,
      );
      await sleep(waitSeconds * 1000);
    }
  }

  return null;
}

function createNormalizePayload(seed: number): Record<string, unknown> {
  const family = ['Ada Lovelace', 'Grace Hopper', 'Barbara Liskov', 'Margaret Hamilton'][seed % 4];
  const emailBase = family.toLowerCase().replace(/\s+/g, '.');
  return {
    type: 'normalize',
    input: [
      { customer: family, email: `${emailBase}@example.com`, city: 'London', spend: 42 + (seed % 5) },
      { customer: family.toUpperCase(), email: `${emailBase}+dup@example.com`, city: 'LONDON', spend: 40 + (seed % 7) },
      { customer: family.replace(' ', '  '), email: `${emailBase}@example.com`, city: 'London ', spend: 41 + (seed % 3) },
    ],
    schema: {
      customer: 'string',
      email: 'string',
      city: 'string',
      spend: 'number',
    },
  };
}

function createDataExtractionPayload(seed: number): Record<string, unknown> {
  const amount = (29 + (seed % 13)) * 3;
  return {
    source: {
      type: 'text',
      text:
        `Invoice INV-${1000 + seed}: Customer Alex Rivera ordered ${2 + (seed % 4)} repair kits ` +
        `for a total of $${amount}. Follow up via alex${seed % 11}@example.com before Friday.`,
    },
    extractionType: 'structured',
    schema: {
      invoiceId: 'string',
      customer: 'string',
      quantity: 'number',
      total: 'number',
      email: 'string',
    },
    constraints: ['extract only explicit fields from the inline source'],
  };
}

function createQaVerificationPayload(seed: number): Record<string, unknown> {
  return {
    target: 'workspace',
    suite: seed % 5 === 0 ? 'smoke' : 'spot-check',
    mode: 'dry-run',
    testCommand: 'build-verify',
    constraints: {
      dryRun: true,
      source: 'review-session-workload',
    },
    affectedSurfaces: ['workspace', 'operator', 'task-queue'],
  };
}

function createHeartbeatPayload(seed: number, runId: string): Record<string, unknown> {
  return {
    reason: `${runId}-${seed + 1}`,
    seq: seed + 1,
  };
}

function buildRepresentativeSafeSpecs(runId: string): WorkloadSpec[] {
  return [
    {
      name: 'heartbeat',
      type: 'heartbeat',
      weight: 55,
      payload: createHeartbeatPayload(0, runId),
    },
    {
      name: 'qa-verification-dry-run',
      type: 'qa-verification',
      weight: 20,
      payload: createQaVerificationPayload(0),
    },
    {
      name: 'normalize-data',
      type: 'normalize-data',
      weight: 15,
      payload: createNormalizePayload(0),
    },
    {
      name: 'data-extraction-inline',
      type: 'data-extraction',
      weight: 10,
      payload: createDataExtractionPayload(0),
    },
  ];
}

function createGeneratedTaskRequest(
  spec: WorkloadSpec,
  sequence: number,
  runId: string,
): TaskTriggerRequest {
  switch (spec.type) {
    case 'heartbeat':
      return { type: spec.type, payload: createHeartbeatPayload(sequence, runId) };
    case 'qa-verification':
      return { type: spec.type, payload: createQaVerificationPayload(sequence) };
    case 'normalize-data':
      return { type: spec.type, payload: createNormalizePayload(sequence) };
    case 'data-extraction':
      return { type: spec.type, payload: createDataExtractionPayload(sequence) };
    default:
      return { type: spec.type, payload: spec.payload };
  }
}

function createWeightedSelector(specs: WorkloadSpec[]) {
  if (specs.length === 0) {
    throw new Error('Workload plan has no task specs');
  }

  const totalWeight = specs.reduce((sum, spec) => sum + spec.weight, 0);
  const counters = new Array(specs.length).fill(0);
  let emitted = 0;

  return () => {
    let bestSpecIndex = 0;
    let bestDeficit = -Infinity;

    for (let specIndex = 0; specIndex < specs.length; specIndex += 1) {
      const target = ((emitted + 1) * specs[specIndex].weight) / totalWeight;
      const deficit = target - counters[specIndex];
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestSpecIndex = specIndex;
      }
    }

    counters[bestSpecIndex] += 1;
    emitted += 1;
    return specs[bestSpecIndex];
  };
}

export function resolveReviewRunLinkTarget(
  workloadRunId: string,
  acceptedTaskIds: string[],
): { runId: string; mode: 'representative-task' | 'workload-run' } | null {
  const representativeTaskId = acceptedTaskIds.find(
    (taskId) => typeof taskId === 'string' && taskId.trim().length > 0,
  );
  if (representativeTaskId) {
    return { runId: representativeTaskId.trim(), mode: 'representative-task' };
  }
  if (typeof workloadRunId === 'string' && workloadRunId.trim().length > 0) {
    return { runId: workloadRunId.trim(), mode: 'workload-run' };
  }
  return null;
}

function normalizeReviewSessionCumulativeSummary(
  cumulative: Partial<ReviewSessionCumulativeWorkloadSummary> | null | undefined,
): ReviewSessionCumulativeWorkloadSummary | null {
  if (!cumulative || typeof cumulative !== 'object') {
    return null;
  }

  return {
    acceptedRuns: Number(cumulative.acceptedRuns ?? 0),
    completedRuns: Number(cumulative.completedRuns ?? 0),
    successfulRuns: Number(cumulative.successfulRuns ?? 0),
    failedRuns: Number(cumulative.failedRuns ?? 0),
    retriedRuns: Number(cumulative.retriedRuns ?? 0),
    pendingRuns: Number(cumulative.pendingRuns ?? 0),
    totalCostUsd: Number(cumulative.totalCostUsd ?? 0),
    averageLatencyMs:
      cumulative.averageLatencyMs === null || cumulative.averageLatencyMs === undefined
        ? null
        : Number(cumulative.averageLatencyMs),
    peakLatencyMs:
      cumulative.peakLatencyMs === null || cumulative.peakLatencyMs === undefined
        ? null
        : Number(cumulative.peakLatencyMs),
    topTaskTypes: Array.isArray(cumulative.topTaskTypes)
      ? cumulative.topTaskTypes
          .filter((entry): entry is { type: string; count: number } =>
            Boolean(entry)
            && typeof entry === 'object'
            && typeof entry.type === 'string'
            && Number.isFinite(Number(entry.count)),
          )
          .map((entry) => ({ type: entry.type, count: Number(entry.count) }))
      : [],
    lastAcceptedAt:
      typeof cumulative.lastAcceptedAt === 'string' ? cumulative.lastAcceptedAt : null,
    lastCompletedAt:
      typeof cumulative.lastCompletedAt === 'string' ? cumulative.lastCompletedAt : null,
  };
}

function buildTaskHistorySafePlan(
  history: TaskHistoryRecord[],
  runId: string,
): WorkloadPlan {
  const supported = new Map<string, WorkloadSpec>(
    buildRepresentativeSafeSpecs(runId).map((spec) => [spec.type, spec]),
  );
  const counts = new Map<string, number>();
  const excludedTypes = new Set<string>();

  for (const entry of history) {
    if (!entry.type || entry.type === 'startup') {
      continue;
    }
    if (!supported.has(entry.type)) {
      excludedTypes.add(entry.type);
      continue;
    }
    counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return {
      profile: 'task-history-safe',
      source: 'history',
      specs: buildRepresentativeSafeSpecs(runId),
      excludedTypes: Array.from(excludedTypes).sort(),
    };
  }

  const specs = Array.from(counts.entries())
    .map(([type, count]) => {
      const base = supported.get(type)!;
      return {
        ...base,
        weight: count,
      };
    })
    .sort((left, right) => right.weight - left.weight);

  return {
    profile: 'task-history-safe',
    source: 'history',
    specs,
    excludedTypes: Array.from(excludedTypes).sort(),
  };
}

function normalizeManifestSpec(raw: unknown, index: number): WorkloadSpec {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Manifest entry ${index + 1} must be an object`);
  }

  const entry = raw as Record<string, unknown>;
  if (typeof entry.type !== 'string' || entry.type.trim().length === 0) {
    throw new Error(`Manifest entry ${index + 1} is missing a valid type`);
  }

  const payload =
    typeof entry.payload === 'object' && entry.payload !== null
      ? (entry.payload as Record<string, unknown>)
      : {};
  const weight = Number(entry.weight ?? 1);

  return {
    name:
      typeof entry.name === 'string' && entry.name.trim().length > 0
        ? entry.name.trim()
        : `${entry.type.trim()}-${index + 1}`,
    type: entry.type.trim(),
    weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
    payload,
  };
}

async function buildWorkloadPlan(
  profile: string,
  runId: string,
  stateFilePath: string,
  manifestPath: string | null,
): Promise<WorkloadPlan> {
  if (profile === 'manifest') {
    if (!manifestPath) {
      throw new Error('LIVE_RATE_MANIFEST_PATH is required when LIVE_RATE_WORKLOAD_PROFILE=manifest');
    }
    const resolvedManifestPath = resolve(manifestPath);
    const parsed = await readManifestFile(resolvedManifestPath);
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).tasks)
        ? ((parsed as Record<string, unknown>).tasks as unknown[])
        : null;
    if (!entries || entries.length === 0) {
      throw new Error(`Manifest ${resolvedManifestPath} must contain a non-empty task array`);
    }
    return {
      profile,
      source: 'manifest',
      specs: entries.map(normalizeManifestSpec),
      excludedTypes: [],
    };
  }

  if (profile === 'task-history-safe') {
    const state = await readStateFile(stateFilePath);
    return buildTaskHistorySafePlan(state.taskHistory ?? [], runId);
  }

  return {
    profile,
    source: 'builtin',
    specs: buildRepresentativeSafeSpecs(runId),
    excludedTypes: [],
  };
}

function buildWeightedSchedule(specs: WorkloadSpec[], totalTasks: number): WorkloadSpec[] {
  if (specs.length === 0) {
    throw new Error('Workload plan has no task specs');
  }

  const totalWeight = specs.reduce((sum, spec) => sum + spec.weight, 0);
  const counters = new Array(specs.length).fill(0);
  const schedule: WorkloadSpec[] = [];

  for (let index = 0; index < totalTasks; index += 1) {
    let bestSpecIndex = 0;
    let bestDeficit = -Infinity;

    for (let specIndex = 0; specIndex < specs.length; specIndex += 1) {
      const target = ((index + 1) * specs[specIndex].weight) / totalWeight;
      const deficit = target - counters[specIndex];
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestSpecIndex = specIndex;
      }
    }

    counters[bestSpecIndex] += 1;
    schedule.push(specs[bestSpecIndex]);
  }

  return schedule;
}

async function waitForHealthy(baseUrl: string, timeoutMs = 90000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        const body = (await response.json()) as { status?: string };
        if (body.status === 'healthy') {
          return;
        }
      }
    } catch {
      // keep retrying
    }
    await sleep(500);
  }
  throw new Error('Orchestrator health check timed out');
}

async function waitForTaskHistory(
  stateFilePath: string,
  taskIds: string[],
  timeoutMs = 180000,
): Promise<Map<string, TaskHistoryRecord>> {
  const deadline = Date.now() + timeoutMs;
  const ids = new Set(taskIds);

  while (Date.now() < deadline) {
    try {
      const parsed = await readStateFile(stateFilePath);
      const history = parsed.taskHistory ?? [];
      const found = new Map<string, TaskHistoryRecord>();

      for (const entry of history) {
        if (entry.id && ids.has(entry.id)) {
          found.set(entry.id, entry);
        }
      }

      if (found.size === taskIds.length) {
        return found;
      }
    } catch {
      // keep retrying
    }

    await sleep(250);
  }

  const partial = new Map<string, TaskHistoryRecord>();
  try {
    const parsed = await readStateFile(stateFilePath);
    for (const entry of parsed.taskHistory ?? []) {
      if (entry.id && ids.has(entry.id)) {
        partial.set(entry.id, entry);
      }
    }
  } catch {
    // no-op
  }

  return partial;
}

async function waitForTaskExecutions(
  stateFilePath: string,
  taskIds: string[],
  timeoutMs = 180000,
): Promise<Map<string, TaskExecutionRecord>> {
  const deadline = Date.now() + timeoutMs;
  const ids = new Set(taskIds);

  while (Date.now() < deadline) {
    try {
      const parsed = await readStateFile(stateFilePath);
      const executions = parsed.taskExecutions ?? [];
      const found = new Map<string, TaskExecutionRecord>();

      for (const execution of executions) {
        if (execution.taskId && ids.has(execution.taskId)) {
          found.set(execution.taskId, execution);
        }
      }

      if (found.size === taskIds.length) {
        return found;
      }
    } catch {
      // keep retrying
    }

    await sleep(250);
  }

  const partial = new Map<string, TaskExecutionRecord>();
  try {
    const parsed = await readStateFile(stateFilePath);
    for (const execution of parsed.taskExecutions ?? []) {
      if (execution.taskId && ids.has(execution.taskId)) {
        partial.set(execution.taskId, execution);
      }
    }
  } catch {
    // no-op
  }

  return partial;
}

export function summarizeExecutionStatuses(
  executions: Iterable<TaskExecutionRecord>,
): ExecutionStatusSummary {
  const summary: ExecutionStatusSummary = {
    success: 0,
    failed: 0,
    retrying: 0,
    pendingOrRunning: 0,
  };

  for (const execution of executions) {
    switch (execution.status) {
      case 'success':
        summary.success += 1;
        break;
      case 'failed':
        summary.failed += 1;
        break;
      case 'retrying':
        summary.retrying += 1;
        break;
      case 'pending':
      case 'running':
      default:
        summary.pendingOrRunning += 1;
        break;
    }
  }

  return summary;
}

export function extractReviewSessionCumulativeSummary(
  payload: unknown,
): ReviewSessionCumulativeWorkloadSummary | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const response = payload as {
    session?: {
      summary?: {
        workload?: {
          cumulative?: Partial<ReviewSessionCumulativeWorkloadSummary>;
        };
      };
    };
  };
  return normalizeReviewSessionCumulativeSummary(response.session?.summary?.workload?.cumulative);
}

async function waitForStdoutCompletions(
  getStdout: () => string,
  runId: string,
  expectedCompletions: number,
  timeoutMs = 180000,
): Promise<Set<number>> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const completed = extractCompletedHeartbeatSeq(getStdout(), runId);
    if (completed.size >= expectedCompletions) {
      return completed;
    }
    await sleep(500);
  }

  return extractCompletedHeartbeatSeq(getStdout(), runId);
}

async function fetchReviewSessionDetail(
  baseUrl: string,
  apiKey: string,
  reviewSessionId: string,
): Promise<ReviewSessionRecord | null> {
  const payload = await getJson(
    baseUrl,
    apiKey,
    `/api/review-sessions/${encodeURIComponent(reviewSessionId)}`,
  );
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const response = payload as { session?: ReviewSessionRecord };
  return response.session ?? null;
}

export function buildQueueTopUpSummary(
  snapshots: QueuePressureSnapshot[],
  startedAt: string,
  endedAt: string,
  feederAccepted: number,
  feederThrottled: number,
  feederUnauthorized: number,
  feederOtherErrors: number,
): QueueTopUpSummary {
  const startSnapshot = snapshots[0] ?? null;
  const endSnapshot = snapshots[snapshots.length - 1] ?? null;
  const startedMs = Date.parse(startedAt);
  const endedMs = Date.parse(endedAt);
  const sampledDurationMs =
    Number.isFinite(startedMs) && Number.isFinite(endedMs) && endedMs > startedMs
      ? endedMs - startedMs
      : 0;
  const queuedValues = snapshots.map((snapshot) => snapshot.queueQueued);
  const processingValues = snapshots.map((snapshot) => snapshot.queueProcessing);
  const cumulativeDelta =
    startSnapshot && endSnapshot
      ? {
          acceptedRuns: Math.max(0, endSnapshot.acceptedRuns - startSnapshot.acceptedRuns),
          completedRuns: Math.max(0, endSnapshot.completedRuns - startSnapshot.completedRuns),
          successfulRuns: Math.max(0, endSnapshot.successfulRuns - startSnapshot.successfulRuns),
          failedRuns: Math.max(0, endSnapshot.failedRuns - startSnapshot.failedRuns),
          retriedRuns: Math.max(0, endSnapshot.retriedRuns - startSnapshot.retriedRuns),
          pendingRuns: Math.max(0, endSnapshot.pendingRuns - startSnapshot.pendingRuns),
        }
      : null;
  const durationHours = sampledDurationMs > 0 ? sampledDurationMs / (60 * 60 * 1000) : 0;
  const feederAcceptedAvg = durationHours > 0 ? feederAccepted / durationHours : 0;
  const completedAvg =
    cumulativeDelta && durationHours > 0 ? cumulativeDelta.completedRuns / durationHours : null;

  const computePeakPerHour = (
    accessor: (snapshot: QueuePressureSnapshot) => number,
  ) => {
    if (snapshots.length < 2) {
      return null;
    }

    let best = 0;
    let startIndex = 0;

    for (let endIndex = 1; endIndex < snapshots.length; endIndex += 1) {
      const endTime = Date.parse(snapshots[endIndex].capturedAt);
      while (
        startIndex < endIndex
        && Number.isFinite(endTime)
        && Number.isFinite(Date.parse(snapshots[startIndex].capturedAt))
        && endTime - Date.parse(snapshots[startIndex].capturedAt) > 60 * 60 * 1000
      ) {
        startIndex += 1;
      }

      const startTime = Date.parse(snapshots[startIndex].capturedAt);
      const windowMs = endTime - startTime;
      if (!Number.isFinite(windowMs) || windowMs <= 0) {
        continue;
      }
      const delta = accessor(snapshots[endIndex]) - accessor(snapshots[startIndex]);
      const perHour = (Math.max(0, delta) / windowMs) * 60 * 60 * 1000;
      if (perHour > best) {
        best = perHour;
      }
    }

    return best > 0 ? Number(best.toFixed(2)) : null;
  };

  return {
    startedAt,
    endedAt,
    sampledDurationMs,
    feederAccepted,
    feederThrottled,
    feederUnauthorized,
    feederOtherErrors,
    cumulativeDelta,
    throughputPerHour: {
      feederAcceptedAvg: Number(feederAcceptedAvg.toFixed(2)),
      completedAvg: completedAvg === null ? null : Number(completedAvg.toFixed(2)),
      acceptedPeak: computePeakPerHour((snapshot) => snapshot.acceptedRuns),
      completedPeak: computePeakPerHour((snapshot) => snapshot.completedRuns),
    },
    queuePressure: {
      queuedAvg: averageNumbers(queuedValues),
      queuedPeak: queuedValues.length > 0 ? Math.max(...queuedValues) : null,
      processingAvg: averageNumbers(processingValues),
      processingPeak: processingValues.length > 0 ? Math.max(...processingValues) : null,
    },
    sampleCount: snapshots.length,
  };
}

async function dispatchTaskTrigger(
  args: {
    baseUrl: string;
    apiKey: string;
    clientIp: string;
    taskRequest: TaskTriggerRequest;
  },
) {
  const requestStart = Date.now();
  const response = await fetch(`${args.baseUrl}/api/tasks/trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.apiKey}`,
      'X-Forwarded-For': args.clientIp,
    },
    body: JSON.stringify(args.taskRequest),
  });

  const latencyMs = Date.now() - requestStart;
  let taskId: string | null = null;
  if (response.status === 202) {
    const body = (await response.json()) as { taskId?: string };
    taskId = typeof body.taskId === 'string' ? body.taskId : null;
  }

  return {
    status: response.status,
    latencyMs,
    taskId,
    type: args.taskRequest.type,
  };
}

async function main() {
  const attachMode = parseBoolean(process.env.LIVE_RATE_ATTACH, false);
  const feederMode = parseFeederMode(process.env.LIVE_RATE_FEEDER_MODE);
  const requestedTotalTasks = parseOptionalPositiveInteger(process.env.LIVE_RATE_TOTAL_TASKS);
  const requestedIntervalMs = parseOptionalPositiveInteger(process.env.LIVE_RATE_INTERVAL_MS);
  const requestedDurationMs = resolveRequestedDurationMs(
    process.env.LIVE_RATE_DURATION_HOURS,
    process.env.LIVE_RATE_DURATION_MS,
  );
  const fastStart = process.env.ORCHESTRATOR_FAST_START ?? 'true';
  const forwardedIpPool = Number(process.env.LIVE_RATE_IP_POOL ?? '300');
  const workloadProfile = (process.env.LIVE_RATE_WORKLOAD_PROFILE ?? 'heartbeat').trim().toLowerCase();
  const manifestPath = process.env.LIVE_RATE_MANIFEST_PATH?.trim() ?? null;
  const requireReviewSession = attachMode && parseBoolean(process.env.LIVE_RATE_REQUIRE_REVIEW_SESSION, true);
  const postReviewBucket = process.env.LIVE_RATE_POST_REVIEW_BUCKET?.trim();
  const reviewNoteIntervalMinutes = parseOptionalPositiveNumber(
    process.env.LIVE_RATE_REVIEW_NOTE_INTERVAL_MINUTES,
  );
  const requestedTopUpPollMs = parseOptionalPositiveInteger(process.env.LIVE_RATE_TOP_UP_POLL_MS);
  const requestedTopUpBatchSize = parseOptionalPositiveInteger(
    process.env.LIVE_RATE_TOP_UP_BATCH_SIZE ?? process.env.LIVE_RATE_TOP_UP_BATCH,
  );
  const requestedMaxQueueDepth = parseOptionalPositiveInteger(process.env.LIVE_RATE_MAX_QUEUE_DEPTH);
  const requestedMetricsSnapshotMs = parseOptionalPositiveInteger(
    process.env.LIVE_RATE_METRICS_SNAPSHOT_MS,
  );
  const requestedCycleLogEvery = parseOptionalPositiveInteger(process.env.LIVE_RATE_CYCLE_LOG_EVERY);
  const defaultPort = process.env.PORT ?? '3000';
  const port = attachMode ? Number(defaultPort) : await getFreePort();
  const baseUrl = process.env.LIVE_RATE_BASE_URL ?? `http://127.0.0.1:${port}`;
  const apiKey = attachMode ? resolveAuthToken() : 'live-rate-shaped-api-key';
  const webhookSecret = 'live-rate-shaped-webhook-secret';
  const runId = `live-rate-${Date.now()}`;

  const tsxCliPath = resolve(process.cwd(), '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const configPath = resolveOrchestratorConfigPath();
  const configRaw = await readFile(configPath, 'utf-8');
  const config = JSON.parse(configRaw) as { stateFile: string; logsDir?: string; taskHistoryLimit?: number };
  const stateFilePath = resolveConfigPathTarget(configPath, config.stateFile);
  if (!stateFilePath || stateFilePath.startsWith('mongo:')) {
    throw new Error('live-rate-shaped-dispatch requires a file-backed stateFile target');
  }
  const taskHistoryLimit = Number.isFinite(config.taskHistoryLimit)
    ? Math.max(1, Math.floor(config.taskHistoryLimit as number))
    : 50;
  const reviewSessionId = process.env.LIVE_RATE_REVIEW_SESSION_ID?.trim()
    || (attachMode ? await resolveActiveReviewSessionId(stateFilePath) : null);
  const reviewBucket = process.env.LIVE_RATE_REVIEW_BUCKET?.trim() || 'burst_workload';
  const runLogPath = process.env.LIVE_RATE_RUN_LOG
    ?? resolve(
      resolveConfigPathTarget(configPath, config.logsDir) ?? resolve(process.cwd(), '..', 'logs'),
      'live-dispatch-runs.jsonl',
    );

  let serverProcess: ChildProcessWithoutNullStreams | null = null;
  let stdoutBuffer = '';
  let stderrBuffer = '';

  let reviewSessionDetail: ReviewSessionRecord | null = null;
  let cumulativeReviewSummary: ReviewSessionCumulativeWorkloadSummary | null = null;
  let totalTasks = feederMode === 'paced-total' ? requestedTotalTasks : null;
  const latencies: number[] = [];
  const acceptedTaskIds: string[] = [];
  const queuedByType = new Map<string, number>();
  let accepted = 0;
  let throttled = 0;
  let unauthorized = 0;
  let otherErrors = 0;

  try {
    if (!apiKey) {
      throw new Error('Missing LIVE_RATE_API_KEY, REVIEW_SESSION_API_KEY, API_KEY, or active API_KEY_ROTATION entry');
    }
    if (requireReviewSession && !reviewSessionId) {
      throw new Error('No active review session found. Start review-session:start first or set LIVE_RATE_REVIEW_SESSION_ID.');
    }

    if (!attachMode) {
      serverProcess = spawn(process.execPath, [tsxCliPath, 'src/index.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PORT: String(port),
          API_KEY_ROTATION: JSON.stringify([
            {
              label: 'live-rate-shaped-dispatch',
              key: apiKey,
              roles: ['admin'],
              active: true,
            },
          ]),
          REVIEW_SESSION_API_KEY: apiKey,
          API_KEY: apiKey,
          WEBHOOK_SECRET: webhookSecret,
          MONGO_PASSWORD: process.env.MONGO_PASSWORD ?? 'test-mongo-password',
          REDIS_PASSWORD: process.env.REDIS_PASSWORD ?? 'test-redis-password',
          MONGO_USERNAME: process.env.MONGO_USERNAME ?? 'test-mongo-user',
          DATABASE_URL:
            process.env.DATABASE_URL ??
            'mongodb://127.0.0.1:1/orchestrator?serverSelectionTimeoutMS=1000&connectTimeoutMS=1000',
          DB_NAME: process.env.DB_NAME ?? 'orchestrator',
          ALERTS_ENABLED: 'false',
          ORCHESTRATOR_FAST_START: fastStart,
        },
        stdio: 'pipe',
      });

      serverProcess.stdout.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
      });
      serverProcess.stderr.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
      });

      await new Promise<void>((resolveReady, rejectReady) => {
        serverProcess?.once('spawn', () => resolveReady());
        serverProcess?.once('error', (error) => rejectReady(error));
      });
    }

    await waitForHealthy(baseUrl);
    if (attachMode && reviewSessionId) {
      try {
        reviewSessionDetail = await fetchReviewSessionDetail(baseUrl, apiKey, reviewSessionId);
      } catch (error) {
        console.warn(
          `[review-workload] Unable to load review session ${reviewSessionId} detail before dispatch: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const targetDurationMs = requestedDurationMs
      ?? (reviewSessionDetail?.capturePlan?.intendedDurationHours
        ? Math.round(reviewSessionDetail.capturePlan.intendedDurationHours * 60 * 60 * 1000)
        : null);
    const workloadPlan = await buildWorkloadPlan(workloadProfile, runId, stateFilePath, manifestPath);
    const reviewNoteIntervalMs = reviewNoteIntervalMinutes === null
      ? null
      : Math.round(reviewNoteIntervalMinutes * 60 * 1000);
    const queueTopUpConfig: QueueTopUpConfig | null =
      feederMode === 'queue-top-up'
        ? {
            durationMs:
              targetDurationMs
              ?? (() => {
                throw new Error('queue-top-up feeder requires LIVE_RATE_DURATION_HOURS or LIVE_RATE_DURATION_MS');
              })(),
            topUpPollMs: requestedTopUpPollMs ?? 5000,
            topUpBatchSize: requestedTopUpBatchSize ?? 25,
            maxQueueDepth: requestedMaxQueueDepth ?? 250,
            metricsSnapshotMs: requestedMetricsSnapshotMs ?? 60000,
          }
        : null;

    totalTasks = feederMode === 'paced-total'
      ? totalTasks
        ?? (reviewSessionDetail?.capturePlan?.targetTaskCount ?? null)
        ?? 3000
      : null;

    const timingPlan = feederMode === 'paced-total'
      ? resolveDispatchTimingPlan(totalTasks ?? 3000, requestedIntervalMs, targetDurationMs)
      : null;
    const progressEvery = feederMode === 'paced-total'
      ? parseOptionalPositiveInteger(process.env.LIVE_RATE_PROGRESS_EVERY)
        ?? (timingPlan?.mode === 'duration-paced' ? 25 : 5)
      : null;
    const schedule = feederMode === 'paced-total'
      ? buildWeightedSchedule(workloadPlan.specs, totalTasks ?? 3000)
      : null;
    const topUpSelector = feederMode === 'queue-top-up'
      ? createWeightedSelector(workloadPlan.specs)
      : null;
    const cycleLogEvery = feederMode === 'queue-top-up'
      ? requestedCycleLogEvery ?? Math.max(1, Math.round(60000 / (queueTopUpConfig?.topUpPollMs ?? 5000)))
      : null;

    if (feederMode === 'queue-top-up' && (!attachMode || !reviewSessionId)) {
      throw new Error('queue-top-up feeder requires LIVE_RATE_ATTACH=true and an active review session');
    }

    if (attachMode && reviewSessionId) {
      await postJson(
        baseUrl,
        apiKey,
        `/api/review-sessions/${encodeURIComponent(reviewSessionId)}/bucket`,
        {
          bucket: reviewBucket,
          note:
            `Starting ${workloadPlan.profile} workload run ${runId} ` +
            (feederMode === 'queue-top-up'
              ? `(capacity-max top-up for ${formatDuration(queueTopUpConfig?.durationMs ?? 0)} with depth ceiling ${queueTopUpConfig?.maxQueueDepth ?? 'n/a'} and batch ${queueTopUpConfig?.topUpBatchSize ?? 'n/a'}).`
              : timingPlan?.mode === 'duration-paced'
                ? `(${totalTasks} tasks paced across ${formatDuration(timingPlan.targetDurationMs ?? 0)}).`
                : `(${totalTasks} tasks at ${timingPlan?.intervalMs ?? requestedIntervalMs ?? 25}ms interval).`),
        },
      );
    }

    console.log('============================================================');
    console.log('LIVE RATE-SHAPED DISPATCH PASS');
    console.log('============================================================');
    console.log(`Run ID: ${runId}`);
    console.log(`Attach mode: ${attachMode}`);
    console.log(`Feeder mode: ${feederMode}`);
    console.log(`Fast-start mode: ${fastStart}`);
    console.log(`Base URL: ${baseUrl}`);
    console.log(`Workload profile: ${workloadPlan.profile} (${workloadPlan.source})`);
    console.log(`Target tasks: ${totalTasks ?? 'open-ended capacity discovery'}`);
    console.log(
      feederMode === 'queue-top-up'
        ? `Queue top-up: ${formatDuration(queueTopUpConfig?.durationMs ?? 0)} with queue ceiling ${queueTopUpConfig?.maxQueueDepth ?? 0}, batch ${queueTopUpConfig?.topUpBatchSize ?? 0}, poll ${queueTopUpConfig?.topUpPollMs ?? 0}ms`
        : timingPlan?.mode === 'duration-paced'
          ? `Dispatch pacing: ${totalTasks} tasks across ${formatDuration(timingPlan.targetDurationMs ?? 0)} ` +
            `(about ${timingPlan.targetDispatchRatePerMin.toFixed(2)} req/min, every ${(timingPlan.intervalMs / 1000).toFixed(1)}s)`
          : `Dispatch interval: ${timingPlan?.intervalMs ?? requestedIntervalMs ?? 25}ms (~${(timingPlan?.targetDispatchRatePerMin ?? 0).toFixed(2)} req/min)`,
    );
    console.log(`Forwarded IP pool: ${forwardedIpPool}`);
    console.log(`Review session: ${reviewSessionId ?? 'none detected'}`);
    console.log(`Run summary log: ${runLogPath}`);
    if (workloadPlan.excludedTypes.length > 0) {
      console.log(`Excluded history-only task types: ${workloadPlan.excludedTypes.join(', ')}`);
    }
    console.log('');

    const dispatchStart = Date.now();
    const dispatchStartedAtIso = new Date(dispatchStart).toISOString();
    let lastProgressNoteAt = reviewNoteIntervalMs === null ? Number.POSITIVE_INFINITY : dispatchStart;
    let queueTopUpSummary: QueueTopUpSummary | null = null;

    if (feederMode === 'queue-top-up') {
      const snapshots: QueuePressureSnapshot[] = [];
      const topUpDeadline = dispatchStart + (queueTopUpConfig?.durationMs ?? 0);
      let cycle = 0;
      let sequence = 0;
      let lastSnapshotAt = 0;

      const captureQueueSnapshot = async (
        queueQueued: number,
        queueProcessing: number,
        force = false,
      ) => {
        if (!attachMode || !reviewSessionId) {
          return;
        }

        if (!force && Date.now() - lastSnapshotAt < (queueTopUpConfig?.metricsSnapshotMs ?? 60000)) {
          return;
        }

        const detail = await fetchReviewSessionDetail(baseUrl, apiKey, reviewSessionId);
        const cumulative = normalizeReviewSessionCumulativeSummary(
          detail?.summary?.workload?.cumulative ?? null,
        );
        if (!cumulative) {
          return;
        }

        cumulativeReviewSummary = cumulative;
        snapshots.push({
          capturedAt: new Date().toISOString(),
          acceptedRuns: cumulative.acceptedRuns,
          completedRuns: cumulative.completedRuns,
          successfulRuns: cumulative.successfulRuns,
          failedRuns: cumulative.failedRuns,
          retriedRuns: cumulative.retriedRuns,
          pendingRuns: cumulative.pendingRuns,
          queueQueued,
          queueProcessing,
        });
        lastSnapshotAt = Date.now();
      };

      while (Date.now() < topUpDeadline) {
        cycle += 1;
        const { queued, processing } = await fetchExtendedHealthQueue(baseUrl, apiKey);
        await captureQueueSnapshot(queued, processing, false);

        const currentBacklog = Math.max(0, queued + processing);
        const dispatchCount = Math.max(
          0,
          Math.min(
            queueTopUpConfig?.topUpBatchSize ?? 0,
            (queueTopUpConfig?.maxQueueDepth ?? 0) - currentBacklog,
          ),
        );

        if (dispatchCount > 0) {
          const poolSize = Math.max(1, Math.min(65000, forwardedIpPool));
          const results = await Promise.all(
            Array.from({ length: dispatchCount }, () => {
              const currentSequence = sequence;
              sequence += 1;
              const clientIndex = currentSequence % poolSize;
              const octet3 = Math.floor(clientIndex / 250) % 250;
              const octet4 = (clientIndex % 250) + 1;
              const clientIp = `10.20.${octet3}.${octet4}`;
              const spec = topUpSelector!();
              return dispatchTaskTrigger({
                baseUrl,
                apiKey,
                clientIp,
                taskRequest: createGeneratedTaskRequest(spec, currentSequence, runId),
              });
            }),
          );

          for (const result of results) {
            latencies.push(result.latencyMs);

            if (result.status === 202) {
              accepted += 1;
              if (result.taskId && acceptedTaskIds.length < 25) {
                acceptedTaskIds.push(result.taskId);
              }
              queuedByType.set(result.type, (queuedByType.get(result.type) ?? 0) + 1);
            } else if (result.status === 429) {
              throttled += 1;
            } else if (result.status === 401) {
              unauthorized += 1;
            } else {
              otherErrors += 1;
            }
          }
        }

        if (cycle % (cycleLogEvery ?? 1) === 0 || Date.now() + (queueTopUpConfig?.topUpPollMs ?? 0) >= topUpDeadline) {
          const elapsedMs = Date.now() - dispatchStart;
          const remainingMs = Math.max(0, topUpDeadline - Date.now());
          console.log(
            `Capacity cycle ${cycle}: accepted=${accepted}, throttled=${throttled}, backlog=${currentBacklog}, queue=${queued}, processing=${processing}, elapsed=${formatDuration(elapsedMs)}, remaining=${formatDuration(remainingMs)}`,
          );
        }

        if (
          attachMode
          && reviewSessionId
          && reviewNoteIntervalMs !== null
          && Date.now() - lastProgressNoteAt >= reviewNoteIntervalMs
        ) {
          lastProgressNoteAt = Date.now();
          try {
            const detail = await fetchReviewSessionDetail(baseUrl, apiKey, reviewSessionId);
            cumulativeReviewSummary = normalizeReviewSessionCumulativeSummary(
              detail?.summary?.workload?.cumulative ?? null,
            ) ?? cumulativeReviewSummary;
            await postJsonWithRateLimitRetry(
              baseUrl,
              apiKey,
              `/api/review-sessions/${encodeURIComponent(reviewSessionId)}/note`,
              {
                bucket: reviewBucket,
                text:
                  `Capacity feeder ${runId}: accepted ${accepted}, throttled ${throttled}, ` +
                  `cumulative completed ${cumulativeReviewSummary?.completedRuns ?? 'n/a'}, ` +
                  `peak queue snapshot ${Math.max(
                    queued,
                    snapshots.at(-1)?.queueQueued ?? queued,
                  )}.`,
              },
            );
          } catch (error) {
            console.warn(
              `[review-workload] Unable to append periodic progress note to review session ${reviewSessionId}: ` +
              `${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        const waitMs = Math.min(
          queueTopUpConfig?.topUpPollMs ?? 0,
          Math.max(0, topUpDeadline - Date.now()),
        );
        if (waitMs > 0) {
          await sleep(waitMs);
        }
      }

      const finalQueue = await fetchExtendedHealthQueue(baseUrl, apiKey);
      await captureQueueSnapshot(finalQueue.queued, finalQueue.processing, true);
      queueTopUpSummary = buildQueueTopUpSummary(
        snapshots,
        dispatchStartedAtIso,
        new Date().toISOString(),
        accepted,
        throttled,
        unauthorized,
        otherErrors,
      );
    } else {
      for (let i = 0; i < (totalTasks ?? 0); i++) {
        if (i > 0) {
          if (timingPlan?.mode === 'duration-paced' && timingPlan.targetDurationMs !== null) {
            const scheduledDispatchAt =
              dispatchStart
              + Math.round((timingPlan.targetDurationMs * i) / Math.max(1, (totalTasks ?? 0) - 1));
            const waitMs = scheduledDispatchAt - Date.now();
            if (waitMs > 0) {
              await sleep(waitMs);
            }
          } else if (timingPlan) {
            await sleep(timingPlan.intervalMs);
          }
        }

        const poolSize = Math.max(1, Math.min(65000, forwardedIpPool));
        const clientIndex = i % poolSize;
        const octet3 = Math.floor(clientIndex / 250) % 250;
        const octet4 = (clientIndex % 250) + 1;
        const clientIp = `10.20.${octet3}.${octet4}`;
        const result = await dispatchTaskTrigger({
          baseUrl,
          apiKey,
          clientIp,
          taskRequest: createGeneratedTaskRequest(schedule![i], i, runId),
        });

        latencies.push(result.latencyMs);

        if (result.status === 202) {
          accepted += 1;
          if (result.taskId) {
            acceptedTaskIds.push(result.taskId);
          }
          queuedByType.set(result.type, (queuedByType.get(result.type) ?? 0) + 1);
        } else if (result.status === 429) {
          throttled += 1;
        } else if (result.status === 401) {
          unauthorized += 1;
        } else {
          otherErrors += 1;
        }

        if (((i + 1) % (progressEvery ?? 5) === 0) || i + 1 === (totalTasks ?? 0)) {
          const elapsedMs = Date.now() - dispatchStart;
          const remainingTasks = (totalTasks ?? 0) - (i + 1);
          const etaMs = remainingTasks > 0 ? remainingTasks * (timingPlan?.intervalMs ?? 0) : 0;
          console.log(
            `Dispatched ${i + 1}/${totalTasks} (accepted=${accepted}, throttled=${throttled}, elapsed=${formatDuration(elapsedMs)}, eta=${formatDuration(etaMs)})`,
          );
        }

        if (
          attachMode
          && reviewSessionId
          && reviewNoteIntervalMs !== null
          && Date.now() - lastProgressNoteAt >= reviewNoteIntervalMs
        ) {
          lastProgressNoteAt = Date.now();
          try {
            await postJsonWithRateLimitRetry(
              baseUrl,
              apiKey,
              `/api/review-sessions/${encodeURIComponent(reviewSessionId)}/note`,
              {
                bucket: reviewBucket,
                text:
                  `Feeder progress for ${runId}: dispatched ${i + 1}/${totalTasks}, accepted ${accepted}, ` +
                  `throttled ${throttled}, current mix ${Array.from(queuedByType.entries())
                    .sort((left, right) => right[1] - left[1])
                    .map(([type, count]) => `${type}=${count}`)
                    .join(', ') || 'none'}.`,
              },
            );
          } catch (error) {
            console.warn(
              `[review-workload] Unable to append periodic progress note to review session ${reviewSessionId}: ` +
              `${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    }

    const dispatchDurationMs = Date.now() - dispatchStart;
    const stdoutCompletionTimeoutMs = feederMode === 'paced-total'
      ? Math.min(
          60000,
          Math.max(10000, (totalTasks ?? 0) * Math.max(250, timingPlan?.intervalMs ?? 25)),
        )
      : 0;
    const completedByStdout = feederMode === 'queue-top-up'
      ? new Set<number>()
      : attachMode
        ? new Set<number>()
        : await waitForStdoutCompletions(
            () => stdoutBuffer,
            runId,
            accepted,
            stdoutCompletionTimeoutMs,
          );
    const completed = feederMode === 'queue-top-up'
      ? new Map<string, TaskHistoryRecord>()
      : await waitForTaskHistory(stateFilePath, acceptedTaskIds, 10000);
    const executionRecords = feederMode === 'queue-top-up'
      ? new Map<string, TaskExecutionRecord>()
      : await waitForTaskExecutions(stateFilePath, acceptedTaskIds, 10000);
    const executionStatusSummary = summarizeExecutionStatuses(executionRecords.values());

    let completedOk = 0;
    let completedError = 0;
    let latestHandledAt = 0;

    for (const record of completed.values()) {
      if (record.result === 'ok') completedOk += 1;
      if (record.result === 'error') completedError += 1;
      if (record.handledAt) {
        const handledTs = Date.parse(record.handledAt);
        if (!Number.isNaN(handledTs)) {
          latestHandledAt = Math.max(latestHandledAt, handledTs);
        }
      }
    }

    const enqueueP50 = percentile(latencies, 50);
    const enqueueP95 = percentile(latencies, 95);
    const enqueueMax = latencies.length > 0 ? Math.max(...latencies) : 0;
    const dispatchRatePerMin = dispatchDurationMs > 0
      ? (accepted / (dispatchDurationMs / 60000))
      : 0;

    const completionCoverage = accepted > 0 ? (completedByStdout.size / accepted) * 100 : 0;
    const totalDrainSeconds = latestHandledAt > 0
      ? (latestHandledAt - dispatchStart) / 1000
      : 0;
    const queuedMix = Array.from(queuedByType.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([type, count]) => `${type}=${count}`);

    if (attachMode && reviewSessionId) {
      try {
        const reviewDetailPayload = await getJson(
          baseUrl,
          apiKey,
          `/api/review-sessions/${encodeURIComponent(reviewSessionId)}`,
        );
        cumulativeReviewSummary = extractReviewSessionCumulativeSummary(reviewDetailPayload);
      } catch (error) {
        console.warn(
          `[review-workload] Unable to load cumulative review session summary for ${reviewSessionId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    console.log('');
    console.log('---------------- SUMMARY ----------------');
    console.log(
      feederMode === 'queue-top-up'
        ? `Accepted: ${accepted} (open-ended capacity feeder)`
        : `Accepted: ${accepted}/${totalTasks}`,
    );
    console.log(`Throttled (429): ${throttled}`);
    console.log(`Unauthorized (401): ${unauthorized}`);
    console.log(`Other errors: ${otherErrors}`);
    console.log(`Enqueue latency p50/p95/max: ${enqueueP50}ms / ${enqueueP95}ms / ${enqueueMax}ms`);
    console.log(`Effective dispatch rate: ${dispatchRatePerMin.toFixed(2)} req/min`);
    console.log(
      attachMode
        ? `Completions observed in stdout: n/a (attached to existing runtime)`
        : `Completions observed in stdout: ${completedByStdout.size}/${accepted} (${completionCoverage.toFixed(1)}%)`,
    );
    console.log(`Queued mix: ${queuedMix.join(', ') || 'none'}`);
    if (feederMode === 'queue-top-up') {
      console.log('Retained execution/taskHistory windows are not used as the source of truth for capacity mode.');
    } else {
      console.log(`Execution records retained in state (cap 5000): ${executionRecords.size}/${accepted}`);
      console.log(
        `Execution status split from state: success=${executionStatusSummary.success}, failed=${executionStatusSummary.failed}, retrying=${executionStatusSummary.retrying}, pending/running=${executionStatusSummary.pendingOrRunning}`,
      );
      console.log(`Recent taskHistory sample retained (cap ${taskHistoryLimit}): ${completed.size}/${accepted}`);
      console.log(`taskHistory sample result split: ok=${completedOk}, error=${completedError}`);
    }
    if (totalDrainSeconds > 0 && feederMode !== 'queue-top-up') {
      console.log(`Dispatch-to-last-completion: ${totalDrainSeconds.toFixed(1)}s`);
    }
    if (cumulativeReviewSummary) {
      console.log(
      `Review session cumulative totals: accepted=${cumulativeReviewSummary.acceptedRuns}, completed=${cumulativeReviewSummary.completedRuns}, successful=${cumulativeReviewSummary.successfulRuns}, failed=${cumulativeReviewSummary.failedRuns}, retried=${cumulativeReviewSummary.retriedRuns}, pending=${cumulativeReviewSummary.pendingRuns}`,
      );
    }
    if (queueTopUpSummary) {
      console.log(
        `Capacity delta: accepted=${queueTopUpSummary.cumulativeDelta?.acceptedRuns ?? 'n/a'}, completed=${queueTopUpSummary.cumulativeDelta?.completedRuns ?? 'n/a'}, peak completed/hr=${queueTopUpSummary.throughputPerHour.completedPeak ?? 'n/a'}, peak accepted/hr=${queueTopUpSummary.throughputPerHour.acceptedPeak ?? 'n/a'}, queue avg/peak=${queueTopUpSummary.queuePressure.queuedAvg ?? 'n/a'}/${queueTopUpSummary.queuePressure.queuedPeak ?? 'n/a'}`,
      );
    }
    console.log('-----------------------------------------');
    console.log('');

    const summaryRecord = {
      runId,
      generatedAt: new Date().toISOString(),
      feederMode,
      fastStart,
      totalTasks: totalTasks ?? null,
      accepted,
      throttled,
      unauthorized,
      otherErrors,
      enqueueLatencyMs: {
        p50: enqueueP50,
        p95: enqueueP95,
        max: enqueueMax,
      },
      effectiveDispatchRatePerMin: Number(dispatchRatePerMin.toFixed(2)),
      dispatchTiming: timingPlan
        ? {
            mode: timingPlan.mode,
            intervalMs: timingPlan.intervalMs,
            targetDurationMs: timingPlan.targetDurationMs,
            targetDispatchRatePerMin: Number(timingPlan.targetDispatchRatePerMin.toFixed(2)),
          }
        : {
            mode: 'queue-top-up',
            intervalMs: queueTopUpConfig?.topUpPollMs ?? null,
            targetDurationMs: queueTopUpConfig?.durationMs ?? null,
            targetDispatchRatePerMin: null,
          },
      completionsObservedStdout: completedByStdout.size,
      executionRecordsRetained: executionRecords.size,
      executionStatusSplitFromState: executionStatusSummary,
      completionsObservedStateRolling: completed.size,
      taskHistoryLimit,
      completionCoveragePct: Number(completionCoverage.toFixed(1)),
      completionResultSplitFromState: {
        ok: completedOk,
        error: completedError,
      },
      dispatchToLastCompletionSeconds: totalDrainSeconds > 0
        ? Number(totalDrainSeconds.toFixed(1))
        : null,
      attachMode,
      baseUrl,
      reviewSessionId,
      workloadProfile: workloadPlan.profile,
      workloadSource: workloadPlan.source,
      excludedTypes: workloadPlan.excludedTypes,
      queuedByType: Object.fromEntries(queuedByType.entries()),
      reviewSessionCumulative: cumulativeReviewSummary,
      queueTopUp: queueTopUpSummary,
    };

    await mkdir(dirname(runLogPath), { recursive: true });
    await appendFile(runLogPath, `${JSON.stringify(summaryRecord)}\n`, 'utf-8');
    console.log(`Appended run summary to ${runLogPath}`);

    if (attachMode && reviewSessionId) {
      const reviewRunLinkTarget = resolveReviewRunLinkTarget(runId, acceptedTaskIds);
      if (reviewRunLinkTarget) {
        try {
          await postJsonWithRateLimitRetry(
            baseUrl,
            apiKey,
            `/api/review-sessions/${encodeURIComponent(reviewSessionId)}/link-run`,
            { runId: reviewRunLinkTarget.runId },
          );
          console.log(
            reviewRunLinkTarget.mode === 'representative-task'
              ? `Linked representative workload task ${reviewRunLinkTarget.runId} to review session ${reviewSessionId}`
              : `Linked shaped dispatch run ${reviewRunLinkTarget.runId} to review session ${reviewSessionId}`,
          );
        } catch (error) {
          console.warn(
            `[review-workload] Unable to link workload metadata to review session ${reviewSessionId}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      try {
        await postJsonWithRateLimitRetry(
          baseUrl,
          apiKey,
          `/api/review-sessions/${encodeURIComponent(reviewSessionId)}/note`,
          {
            bucket: reviewBucket,
            text:
              feederMode === 'queue-top-up'
                ? `capacity-max workload ${runId}: feeder accepted ${accepted}, throttled ${throttled}, ` +
                  `completed delta ${queueTopUpSummary?.cumulativeDelta?.completedRuns ?? 'n/a'}, ` +
                  `peak completed/hr ${queueTopUpSummary?.throughputPerHour.completedPeak ?? 'n/a'}, ` +
                  `queue peak ${queueTopUpSummary?.queuePressure.queuedPeak ?? 'n/a'}, mix ${queuedMix.join(', ')}.`
                : `${workloadPlan.profile} workload ${runId}: accepted ${accepted}/${totalTasks}, ` +
                  `throttled ${throttled}, enqueue p95 ${enqueueP95}ms, ` +
                  `dispatch rate ${dispatchRatePerMin.toFixed(2)} req/min, mix ${queuedMix.join(', ')}.`,
          },
        );
      } catch (error) {
        console.warn(
          `[review-workload] Unable to append workload summary note to review session ${reviewSessionId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (postReviewBucket) {
        try {
          await postJsonWithRateLimitRetry(
            baseUrl,
            apiKey,
            `/api/review-sessions/${encodeURIComponent(reviewSessionId)}/bucket`,
            {
              bucket: postReviewBucket,
              note: `Completed ${workloadPlan.profile} workload run ${runId}.`,
            },
          );
          console.log(`Switched review session ${reviewSessionId} to ${postReviewBucket}`);
        } catch (error) {
          console.warn(
            `[review-workload] Unable to switch review session ${reviewSessionId} to ${postReviewBucket}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  } catch (error) {
    console.error('Live rate-shaped dispatch pass failed:', error);
    if (stdoutBuffer) {
      console.error('\n[orchestrator stdout]\n', stdoutBuffer);
    }
    if (stderrBuffer) {
      console.error('\n[orchestrator stderr]\n', stderrBuffer);
    }
    process.exitCode = 1;
  } finally {
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill('SIGTERM');
      await new Promise<void>((resolveExit) => {
        const forceTimer = setTimeout(() => {
          if (serverProcess && serverProcess.exitCode === null) {
            serverProcess.kill('SIGKILL');
          }
        }, 5000);

        serverProcess?.once('exit', () => {
          clearTimeout(forceTimer);
          resolveExit();
        });
      });
    }
  }
}

const isEntrypoint =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isEntrypoint) {
  main().catch((error) => {
    console.error('Fatal script error:', error);
    process.exit(1);
  });
}
