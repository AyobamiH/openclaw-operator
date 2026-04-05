import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

export interface RuntimeTaskExecution {
  taskId?: string;
  idempotencyKey?: string;
  type?: string;
  status?: string;
  attempt?: number;
  maxRetries?: number;
  lastHandledAt?: string | null;
  lastError?: string;
}

export interface RuntimeApprovalRecord {
  status?: string;
}

export interface RuntimeRepairRecord {
  repairId?: string;
  classification?: string;
  status?: string;
  repairTaskType?: string;
  sourceTaskType?: string;
  repairTaskId?: string;
  repairRunId?: string;
  sourceTaskId?: string;
  sourceRunId?: string;
  verifiedAt?: string | null;
  completedAt?: string | null;
  lastError?: string;
}

export interface RuntimeIncidentRemediationTask {
  remediationId?: string;
  taskType?: string;
  taskId?: string;
  runId?: string | null;
  status?: string;
  assignedTo?: string | null;
  assignedAt?: string | null;
  executionStartedAt?: string | null;
  executionCompletedAt?: string | null;
  verificationStartedAt?: string | null;
  verificationCompletedAt?: string | null;
  verifiedAt?: string | null;
  resolvedAt?: string | null;
  verificationSummary?: string | null;
  resolutionSummary?: string | null;
  blockers?: string[];
}

export interface RuntimeIncidentRemediationPlanStep {
  stepId?: string;
  title?: string;
  kind?: string;
  owner?: string;
  status?: string;
  description?: string;
  taskType?: string | null;
  dependsOn?: string[];
  startedAt?: string | null;
  completedAt?: string | null;
  evidence?: string[];
}

export interface RuntimeIncidentEscalationState {
  level?: string;
  status?: string;
  dueAt?: string | null;
  escalateAt?: string | null;
  escalatedAt?: string | null;
  breachedAt?: string | null;
  summary?: string;
}

export interface RuntimeIncidentVerificationState {
  required?: boolean;
  agentId?: string | null;
  status?: string;
  summary?: string;
  verificationTaskId?: string | null;
  verificationRunId?: string | null;
  verifiedAt?: string | null;
}

export interface RuntimeIncidentLedgerRecord {
  incidentId?: string;
  title?: string;
  classification?: string;
  severity?: string;
  status?: string;
  truthLayer?: string;
  lastSeenAt?: string | null;
  firstSeenAt?: string | null;
  owner?: string | null;
  summary?: string;
  affectedSurfaces?: string[];
  linkedServiceIds?: string[];
  recommendedSteps?: string[];
  policy?: {
    policyId?: string;
    preferredOwner?: string;
    autoAssignOwner?: boolean;
    autoRemediateOnCreate?: boolean;
    remediationTaskType?: string;
    verifierTaskType?: string | null;
    targetSlaMinutes?: number;
    escalationMinutes?: number;
  };
  escalation?: RuntimeIncidentEscalationState;
  remediation?: {
    owner?: string;
    status?: string;
    summary?: string;
    nextAction?: string;
    blockers?: string[];
  };
  remediationPlan?: RuntimeIncidentRemediationPlanStep[];
  verification?: RuntimeIncidentVerificationState;
  remediationTasks?: RuntimeIncidentRemediationTask[];
}

export interface IncidentPriorityRecord {
  incidentId: string;
  classification: string | null;
  severity: string;
  status: string;
  owner: string | null;
  recommendedOwner: string | null;
  escalationLevel: string | null;
  verificationStatus: string | null;
  priorityScore: number;
  summary: string;
  nextAction: string;
  blockers: string[];
  remediationTaskType: string | null;
  affectedSurfaces: string[];
  linkedServiceIds: string[];
}

export type RuntimeProofSurface = "milestone" | "demandSummary";

export interface RuntimeWorkflowEvent {
  eventId?: string;
  stage?: string;
  type?: string;
  state?: string;
  timestamp?: string | null;
  source?: string;
  taskId?: string | null;
  runId?: string | null;
  parentEventId?: string | null;
  relatedRunId?: string | null;
  dependencyRunIds?: string[];
  toolId?: string | null;
  proofTransport?: RuntimeProofSurface | null;
  classification?: string | null;
  stopCode?: string | null;
}

export interface RuntimeRelationshipObservation {
  observationId?: string;
  timestamp?: string | null;
  from?: string;
  to?: string;
  relationship?: string;
  status?: string;
  source?: string;
  taskId?: string | null;
  runId?: string | null;
  targetTaskId?: string | null;
  targetRunId?: string | null;
  toolId?: string | null;
  proofTransport?: RuntimeProofSurface | null;
  classification?: string | null;
  parentObservationId?: string | null;
}

export interface WorkflowBlockerSummary {
  totalStopSignals: number;
  latestStopAt: string | null;
  latestStopCode: string | null;
  byStage: Record<string, number>;
  byClassification: Record<string, number>;
  byStopCode: Record<string, number>;
  blockedRunIds: string[];
  proofStopSignals: number;
}

export interface AgentRelationshipWindow {
  agentId: string;
  total: number;
  recentSixHours: number;
  recentTwentyFourHours: number;
  lastObservedAt: string | null;
  byRelationship: Record<string, number>;
  recentEdges: Array<{
    from: string;
    to: string;
    relationship: string;
    timestamp: string | null;
    source: string | null;
  }>;
}

export type SpecialistOperatorStatus =
  | "completed"
  | "watching"
  | "blocked"
  | "escalate"
  | "refused";

export interface SpecialistOperatorContract {
  role: string;
  workflowStage: string;
  deliverable: string;
  status: SpecialistOperatorStatus;
  operatorSummary: string;
  recommendedNextActions: string[];
  refusalReason: string | null;
  escalationReason: string | null;
}

export interface RuntimeAgentServiceHeartbeat {
  checkedAt?: string | null;
  status?: "ok" | "error" | "warning" | "unknown" | string | null;
  errorSummary?: string | null;
  source?: "service-loop" | "task-runner" | "unknown" | string | null;
}

export interface RuntimeAgentTaskPathProof {
  taskType?: string | null;
  lastObservedAt?: string | null;
  lastObservedStatus?: string | null;
  lastSuccessfulAt?: string | null;
  totalRuns?: number;
  successfulRuns?: number;
  failedRuns?: number;
  activeRuns?: number;
  lastError?: string | null;
}

export interface RuntimeAgentServiceState {
  memoryVersion?: number;
  runtimeProofVersion?: number;
  agentId?: string;
  orchestratorStatePath?: string | null;
  lastRunAt?: string | null;
  lastStatus?: string | null;
  lastTaskId?: string | null;
  lastTaskType?: string | null;
  lastError?: string | null;
  successCount?: number;
  errorCount?: number;
  totalRuns?: number;
  initializedAt?: string;
  taskTimeline?: Array<{
    taskId?: string | null;
    taskType?: string | null;
    status?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    durationMs?: number | null;
    error?: string | null;
    resultSummary?: {
      success?: boolean;
      keys?: string[];
    };
  }>;
  serviceHeartbeat?: RuntimeAgentServiceHeartbeat;
  taskPath?: RuntimeAgentTaskPathProof;
  summary?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  posture?: Record<string, unknown>;
  lastVerification?: Record<string, unknown>;
}

export interface RuntimeStateSubset {
  updatedAt?: string | null;
  lastStartedAt?: string | null;
  taskExecutions?: RuntimeTaskExecution[];
  approvals?: RuntimeApprovalRecord[];
  repairRecords?: RuntimeRepairRecord[];
  taskRetryRecoveries?: Array<{ idempotencyKey?: string; retryAt?: string | null }>;
  incidentLedger?: RuntimeIncidentLedgerRecord[];
  workflowEvents?: RuntimeWorkflowEvent[];
  relationshipObservations?: RuntimeRelationshipObservation[];
}

type RuntimeStateMongoCollection = {
  findOne(query: Record<string, unknown>): Promise<{ value?: unknown } | null>;
  updateOne(
    query: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
};

type RuntimeStateMongoClient = {
  connect(): Promise<void>;
  db(name: string): {
    collection(name: string): RuntimeStateMongoCollection;
  };
  close(): Promise<void>;
};

let runtimeStateMongoClientFactory:
  | ((url: string) => RuntimeStateMongoClient | Promise<RuntimeStateMongoClient>)
  | null = null;

export async function readJsonFile<T>(targetPath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(targetPath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isMongoStateTarget(targetPath: string) {
  return targetPath.startsWith("mongo:");
}

function resolveMongoStateKey(targetPath: string) {
  const key = targetPath.slice("mongo:".length).trim();
  if (!key) {
    throw new Error("mongo runtime state target must include a key");
  }
  return key;
}

function normalizeMongoSystemStatePayload(payload: unknown) {
  if (payload instanceof Uint8Array || Buffer.isBuffer(payload)) {
    return payload;
  }
  if (payload && typeof payload === "object") {
    const binaryPayload = payload as {
      buffer?: Uint8Array;
      value?: (asRaw?: boolean) => Uint8Array | Buffer;
    };
    if (binaryPayload.buffer instanceof Uint8Array) {
      return binaryPayload.buffer;
    }
    if (typeof binaryPayload.value === "function") {
      const value = binaryPayload.value(true);
      if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
        return value;
      }
    }
  }
  return null;
}

async function readMongoSystemState<T>(targetPath: string, fallback: T): Promise<T> {
  try {
    const client = await createRuntimeStateMongoClient();
    await client.connect();
    try {
      const db = client.db(process.env.DB_NAME || "orchestrator");
      const doc = await db.collection("system_state").findOne({
        key: resolveMongoStateKey(targetPath),
      });
      if (doc?.encoding === "gzip-json") {
        const payload = normalizeMongoSystemStatePayload(doc.payload);
        if (payload) {
          return JSON.parse(gunzipSync(payload).toString("utf-8")) as T;
        }
      }
      return fallback;
    } finally {
      await client.close();
    }
  } catch {
    return fallback;
  }
}

async function writeMongoSystemState<T>(targetPath: string, value: T): Promise<void> {
  const client = await createRuntimeStateMongoClient();
  await client.connect();
  try {
    const db = client.db(process.env.DB_NAME || "orchestrator");
    const payload = gzipSync(Buffer.from(JSON.stringify(value), "utf-8"));
    const key = resolveMongoStateKey(targetPath);
    const existing = await db.collection("system_state").findOne({ key });
    const version = typeof existing?.version === "number" ? existing.version + 1 : 1;
    await db.collection("system_state").updateOne(
      { key },
      {
        $set: {
          encoding: "gzip-json",
          payload,
          payloadBytes: payload.byteLength,
          version,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  } finally {
    await client.close();
  }
}

async function createRuntimeStateMongoClient(): Promise<RuntimeStateMongoClient> {
  const databaseUrl = process.env.DATABASE_URL || "mongodb://mongo:27017/orchestrator";
  if (runtimeStateMongoClientFactory) {
    return await runtimeStateMongoClientFactory(databaseUrl);
  }

  const { MongoClient } = await import("mongodb");
  return new MongoClient(databaseUrl);
}

export function setRuntimeStateMongoClientFactoryForTest(
  factory:
    | ((url: string) => RuntimeStateMongoClient | Promise<RuntimeStateMongoClient>)
    | null,
) {
  runtimeStateMongoClientFactory = factory;
}

function isRuntimeTarget(value: string) {
  return /^[a-z][a-z0-9+.-]*:/.test(value);
}

function resolveRuntimeTargetFromBase(
  baseDir: string,
  target: string | undefined | null,
) {
  if (!target) {
    return undefined;
  }

  const trimmed = target.trim();
  if (!trimmed) {
    return undefined;
  }

  if (isAbsolute(trimmed) || isRuntimeTarget(trimmed)) {
    return trimmed;
  }

  return resolve(baseDir, trimmed);
}

function resolveOrchestratorConfigPath(agentConfigPath: string) {
  const repoRoot = resolve(dirname(agentConfigPath), "../../");
  const configuredPath = process.env.ORCHESTRATOR_CONFIG;
  if (!configuredPath) {
    return resolve(repoRoot, "orchestrator_config.json");
  }

  return isAbsolute(configuredPath)
    ? configuredPath
    : resolve(repoRoot, configuredPath);
}

function resolveConfiguredRuntimeStateTarget(agentConfigPath: string) {
  const orchestratorConfigPath = resolveOrchestratorConfigPath(agentConfigPath);
  const orchestratorConfigDir = dirname(orchestratorConfigPath);

  if (process.env.STATE_FILE) {
    return resolveRuntimeTargetFromBase(
      orchestratorConfigDir,
      process.env.STATE_FILE,
    );
  }

  try {
    const parsed = JSON.parse(
      readFileSync(orchestratorConfigPath, "utf-8"),
    ) as { stateFile?: string | null };
    return resolveRuntimeTargetFromBase(
      orchestratorConfigDir,
      parsed.stateFile,
    );
  } catch {
    return undefined;
  }
}

export function resolveRuntimeStateTarget(
  agentConfigPath: string,
  orchestratorStatePath: string | undefined | null,
) {
  const configuredTarget = resolveConfiguredRuntimeStateTarget(agentConfigPath);
  if (configuredTarget) {
    return configuredTarget;
  }

  if (!orchestratorStatePath) {
    return undefined;
  }

  return resolveRuntimeTargetFromBase(
    dirname(agentConfigPath),
    orchestratorStatePath,
  );
}

export async function loadRuntimeStateTarget<T>(
  targetPath: string | undefined | null,
  fallback: T,
): Promise<T> {
  if (!targetPath) {
    return fallback;
  }

  if (isMongoStateTarget(targetPath)) {
    return readMongoSystemState<T>(targetPath, fallback);
  }

  return readJsonFile<T>(targetPath, fallback);
}

export async function saveRuntimeStateTarget<T>(
  targetPath: string | undefined | null,
  value: T,
): Promise<void> {
  if (!targetPath) {
    return;
  }

  if (isMongoStateTarget(targetPath)) {
    await writeMongoSystemState(targetPath, value);
    return;
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify(value, null, 2), "utf-8");
}

export async function loadRuntimeState<T extends RuntimeStateSubset>(
  agentConfigPath: string,
  orchestratorStatePath: string | undefined,
): Promise<T> {
  return loadRuntimeStateTarget<T>(
    resolveRuntimeStateTarget(agentConfigPath, orchestratorStatePath),
    {} as T,
  );
}

export function sortIsoDescending(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((left, right) => Date.parse(right) - Date.parse(left));
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function countByStatus<T extends { status?: string }>(
  values: T[],
): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    const status = typeof value.status === "string" ? value.status : "unknown";
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
}

export function inferProofSurface(
  value: string | null | undefined,
): RuntimeProofSurface | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "milestone" || normalized.includes("milestone")) {
    return "milestone";
  }
  if (
    normalized === "demandsummary" ||
    normalized === "demand-summary" ||
    normalized.includes("demand")
  ) {
    return "demandSummary";
  }
  return null;
}

function normalizeProofObservationStatus(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "unknown";
  if (
    normalized === "degraded" ||
    normalized === "blocked" ||
    normalized === "failed" ||
    normalized === "dead-letter"
  ) {
    return "deadLetter";
  }
  if (normalized === "retrying") {
    return "retrying";
  }
  if (normalized === "rejected") {
    return "rejected";
  }
  if (
    normalized === "pending" ||
    normalized === "running" ||
    normalized === "active" ||
    normalized === "watching"
  ) {
    return "pending";
  }
  if (
    normalized === "success" ||
    normalized === "completed" ||
    normalized === "delivered" ||
    normalized === "duplicate" ||
    normalized === "healthy" ||
    normalized === "observed"
  ) {
    return "delivered";
  }
  return "unknown";
}

export function collectProofSurfaceObservations(args: {
  workflowEvents?: RuntimeWorkflowEvent[];
  relationshipObservations?: RuntimeRelationshipObservation[];
}) {
  const observations: Array<{
    surface: RuntimeProofSurface;
    status: string;
    timestamp: string | null;
  }> = [];

  for (const event of args.workflowEvents ?? []) {
    const surface = inferProofSurface(event.proofTransport);
    if (!surface) continue;
    observations.push({
      surface,
      status: typeof event.state === "string" ? event.state : "unknown",
      timestamp: event.timestamp ?? null,
    });
  }

  for (const observation of args.relationshipObservations ?? []) {
    const surface = inferProofSurface(
      observation.proofTransport ?? observation.to ?? observation.from,
    );
    if (!surface) continue;
    if (
      observation.relationship &&
      observation.relationship !== "publishes-proof" &&
      observation.relationship !== "transitions-proof" &&
      !observation.proofTransport
    ) {
      continue;
    }
    observations.push({
      surface,
      status: typeof observation.status === "string" ? observation.status : "unknown",
      timestamp: observation.timestamp ?? null,
    });
  }

  return observations;
}

export function summarizeProofSurface(
  args: {
    workflowEvents?: RuntimeWorkflowEvent[];
    relationshipObservations?: RuntimeRelationshipObservation[];
  },
  surface: RuntimeProofSurface,
) {
  const observations = collectProofSurfaceObservations(args).filter(
    (entry) => entry.surface === surface,
  );
  const deliveredObservations = observations.filter(
    (entry) => normalizeProofObservationStatus(entry.status) === "delivered",
  );
  const lastDeliveredAt =
    sortIsoDescending(deliveredObservations.map((entry) => entry.timestamp)).at(0) ?? null;
  const lastAttemptAt =
    sortIsoDescending(observations.map((entry) => entry.timestamp)).at(0) ?? null;

  return {
    pending: observations.filter(
      (entry) => normalizeProofObservationStatus(entry.status) === "pending",
    ).length,
    retrying: observations.filter(
      (entry) => normalizeProofObservationStatus(entry.status) === "retrying",
    ).length,
    delivered: deliveredObservations.length,
    deadLetter: observations.filter(
      (entry) => normalizeProofObservationStatus(entry.status) === "deadLetter",
    ).length,
    rejected: observations.filter(
      (entry) => normalizeProofObservationStatus(entry.status) === "rejected",
    ).length,
    lastDeliveredAt,
    latestDeliveredAt: lastDeliveredAt,
    lastAttemptAt,
    totalObservations: observations.length,
  };
}

export function summarizeTaskExecutions(
  executions: RuntimeTaskExecution[],
  taskTypes?: string[],
) {
  const filtered = taskTypes?.length
    ? executions.filter((entry) => taskTypes.includes(entry.type ?? ""))
    : executions;

  return {
    total: filtered.length,
    pending: filtered.filter((entry) => entry.status === "pending").length,
    running: filtered.filter((entry) => entry.status === "running").length,
    retrying: filtered.filter((entry) => entry.status === "retrying").length,
    failed: filtered.filter((entry) => entry.status === "failed").length,
    success: filtered.filter((entry) => entry.status === "success").length,
    lastHandledAt:
      sortIsoDescending(filtered.map((entry) => entry.lastHandledAt)).at(0) ?? null,
  };
}

export function buildTaskPathProof(
  executions: RuntimeTaskExecution[],
  taskType: string | null | undefined,
): RuntimeAgentTaskPathProof {
  const filtered = taskType
    ? executions
        .filter((entry) => entry.type === taskType)
        .slice()
        .sort((left, right) => toTimestamp(right.lastHandledAt) - toTimestamp(left.lastHandledAt))
    : executions
        .slice()
        .sort((left, right) => toTimestamp(right.lastHandledAt) - toTimestamp(left.lastHandledAt));
  const latestObserved = filtered[0] ?? null;
  const latestSuccessful =
    filtered.find((entry) => entry.status === "success") ?? null;

  return {
    taskType: taskType ?? latestObserved?.type ?? null,
    lastObservedAt: latestObserved?.lastHandledAt ?? null,
    lastObservedStatus: latestObserved?.status ?? null,
    lastSuccessfulAt: latestSuccessful?.lastHandledAt ?? null,
    totalRuns: filtered.length,
    successfulRuns: filtered.filter((entry) => entry.status === "success").length,
    failedRuns: filtered.filter((entry) => entry.status === "failed").length,
    activeRuns: filtered.filter((entry) =>
      entry.status === "pending" ||
      entry.status === "running" ||
      entry.status === "retrying",
    ).length,
    lastError:
      typeof latestObserved?.lastError === "string" && latestObserved.lastError.length > 0
        ? latestObserved.lastError
        : null,
  };
}

export function summarizeRelationshipObservations(
  observations: RuntimeRelationshipObservation[],
) {
  const byRelationship = observations.reduce<Record<string, number>>((acc, observation) => {
    const relationship =
      typeof observation.relationship === "string"
        ? observation.relationship
        : "unknown";
    acc[relationship] = (acc[relationship] ?? 0) + 1;
    return acc;
  }, {});

  return {
    total: observations.length,
    lastObservedAt:
      sortIsoDescending(observations.map((observation) => observation.timestamp)).at(0) ??
      null,
    byRelationship,
  };
}

export function normalizeAgentIdFromNode(nodeId: string | undefined | null) {
  if (typeof nodeId !== "string" || nodeId.length === 0) return null;
  return nodeId.startsWith("agent:") ? nodeId.slice("agent:".length) : null;
}

function severityRank(severity: string | undefined | null) {
  switch ((severity ?? "").toLowerCase()) {
    case "critical":
      return 40;
    case "warning":
      return 20;
    case "info":
      return 10;
    default:
      return 5;
  }
}

function escalationRank(level: string | undefined | null) {
  switch ((level ?? "").toLowerCase()) {
    case "breached":
      return 30;
    case "escalated":
      return 20;
    case "warning":
      return 10;
    default:
      return 0;
  }
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)),
  );
}

export function buildIncidentPriorityQueue(
  incidents: RuntimeIncidentLedgerRecord[],
): IncidentPriorityRecord[] {
  return incidents
    .filter((incident) => incident.status !== "resolved")
    .map((incident) => {
      const severity = typeof incident.severity === "string" ? incident.severity : "warning";
      const escalationLevel =
        typeof incident.escalation?.level === "string" ? incident.escalation.level : null;
      const owner = typeof incident.owner === "string" && incident.owner.length > 0 ? incident.owner : null;
      const recommendedOwner =
        typeof incident.policy?.preferredOwner === "string" && incident.policy.preferredOwner.length > 0
          ? incident.policy.preferredOwner
          : owner;
      const blockers = uniqueStrings([
        ...(Array.isArray(incident.remediation?.blockers) ? incident.remediation?.blockers : []),
        ...((incident.remediationTasks ?? [])
          .flatMap((task) => (Array.isArray(task.blockers) ? task.blockers : []))),
      ]);
      const summary =
        typeof incident.summary === "string" && incident.summary.length > 0
          ? incident.summary
          : `Open ${incident.classification ?? "runtime"} incident`;
      const nextAction =
        typeof incident.remediation?.nextAction === "string" && incident.remediation.nextAction.length > 0
          ? incident.remediation.nextAction
          : Array.isArray(incident.recommendedSteps) && incident.recommendedSteps.length > 0
            ? incident.recommendedSteps[0]
            : "Inspect incident evidence and drive remediation to closure.";

      let priorityScore = severityRank(severity) + escalationRank(escalationLevel);
      if (!owner) priorityScore += 8;
      if ((incident.remediationTasks ?? []).some((task) => task.status === "blocked" || task.status === "failed")) {
        priorityScore += 6;
      }
      if (blockers.length > 0) priorityScore += 4;

      return {
        incidentId: incident.incidentId ?? "unknown-incident",
        classification:
          typeof incident.classification === "string" ? incident.classification : null,
        severity,
        status: typeof incident.status === "string" ? incident.status : "active",
        owner,
        recommendedOwner,
        escalationLevel,
        verificationStatus:
          typeof incident.verification?.status === "string" ? incident.verification.status : null,
        priorityScore,
        summary,
        nextAction,
        blockers,
        remediationTaskType:
          typeof incident.policy?.remediationTaskType === "string"
            ? incident.policy.remediationTaskType
            : null,
        affectedSurfaces: uniqueStrings(
          Array.isArray(incident.affectedSurfaces) ? incident.affectedSurfaces : [],
        ),
        linkedServiceIds: uniqueStrings(
          Array.isArray(incident.linkedServiceIds) ? incident.linkedServiceIds : [],
        ),
      };
    })
    .sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      return left.incidentId.localeCompare(right.incidentId);
    });
}

export function buildWorkflowBlockerSummary(
  events: RuntimeWorkflowEvent[],
): WorkflowBlockerSummary {
  const resolveRunKey = (event: RuntimeWorkflowEvent) => {
    if (typeof event.runId === "string" && event.runId.length > 0) {
      return event.runId;
    }
    if (typeof event.relatedRunId === "string" && event.relatedRunId.length > 0) {
      return event.relatedRunId;
    }
    return null;
  };

  const rawStopEvents = events.filter(
    (event) =>
      event.state === "blocked" ||
      event.state === "failed" ||
      (typeof event.stopCode === "string" && event.stopCode.length > 0),
  );

  const stopEvents = rawStopEvents.filter((event) => {
    const runKey = resolveRunKey(event);
    const eventTimestamp = toTimestamp(event.timestamp);
    if (!runKey || eventTimestamp <= 0) {
      return true;
    }

    return !events.some((candidate) => {
      if (resolveRunKey(candidate) !== runKey) {
        return false;
      }
      if (toTimestamp(candidate.timestamp) <= eventTimestamp) {
        return false;
      }
      if (candidate.stage === "result" && candidate.state === "success") {
        return true;
      }

      return (
        candidate.stage === event.stage &&
        (candidate.state === "success" || candidate.state === "completed")
      );
    });
  });

  const byStage = stopEvents.reduce<Record<string, number>>((acc, event) => {
    const stage = typeof event.stage === "string" ? event.stage : "unknown";
    acc[stage] = (acc[stage] ?? 0) + 1;
    return acc;
  }, {});

  const byClassification = stopEvents.reduce<Record<string, number>>((acc, event) => {
    const classification =
      typeof event.classification === "string" && event.classification.length > 0
        ? event.classification
        : "unspecified";
    acc[classification] = (acc[classification] ?? 0) + 1;
    return acc;
  }, {});

  const byStopCode = stopEvents.reduce<Record<string, number>>((acc, event) => {
    const stopCode =
      typeof event.stopCode === "string" && event.stopCode.length > 0
        ? event.stopCode
        : "unspecified";
    acc[stopCode] = (acc[stopCode] ?? 0) + 1;
    return acc;
  }, {});

  const latestStopAt =
    sortIsoDescending(stopEvents.map((event) => event.timestamp)).at(0) ?? null;
  const latestStopCode =
    stopEvents
      .slice()
      .sort(
        (left, right) =>
          Date.parse(right.timestamp ?? "1970-01-01T00:00:00.000Z") -
          Date.parse(left.timestamp ?? "1970-01-01T00:00:00.000Z"),
      )
      .map((event) => event.stopCode)
      .find((value): value is string => typeof value === "string" && value.length > 0) ??
    null;

  return {
    totalStopSignals: stopEvents.length,
    latestStopAt,
    latestStopCode,
    byStage,
    byClassification,
    byStopCode,
    blockedRunIds: uniqueStrings(
      stopEvents.flatMap((event) => [event.runId, event.relatedRunId]),
    ),
    proofStopSignals: stopEvents.filter((event) => event.stage === "proof").length,
  };
}

export function buildAgentRelationshipWindow(
  observations: RuntimeRelationshipObservation[],
  agentId: string,
): AgentRelationshipWindow {
  const now = Date.now();
  const sixHoursMs = 6 * 60 * 60 * 1000;
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;
  const relevant = observations.filter((observation) => {
    const fromAgent = normalizeAgentIdFromNode(observation.from ?? null);
    const toAgent = normalizeAgentIdFromNode(observation.to ?? null);
    return fromAgent === agentId || toAgent === agentId;
  });

  const recentEdges = relevant
    .slice()
    .sort(
      (left, right) =>
        Date.parse(right.timestamp ?? "1970-01-01T00:00:00.000Z") -
        Date.parse(left.timestamp ?? "1970-01-01T00:00:00.000Z"),
    )
    .slice(0, 8)
    .map((observation) => ({
      from: observation.from ?? "unknown",
      to: observation.to ?? "unknown",
      relationship: observation.relationship ?? "unknown",
      timestamp: observation.timestamp ?? null,
      source: observation.source ?? null,
    }));

  const byRelationship = relevant.reduce<Record<string, number>>((acc, observation) => {
    const relationship =
      typeof observation.relationship === "string" ? observation.relationship : "unknown";
    acc[relationship] = (acc[relationship] ?? 0) + 1;
    return acc;
  }, {});

  return {
    agentId,
    total: relevant.length,
    recentSixHours: relevant.filter((observation) => {
      const timestamp = Date.parse(observation.timestamp ?? "");
      return Number.isFinite(timestamp) && now - timestamp <= sixHoursMs;
    }).length,
    recentTwentyFourHours: relevant.filter((observation) => {
      const timestamp = Date.parse(observation.timestamp ?? "");
      return Number.isFinite(timestamp) && now - timestamp <= twentyFourHoursMs;
    }).length,
    lastObservedAt:
      sortIsoDescending(relevant.map((observation) => observation.timestamp)).at(0) ?? null,
    byRelationship,
    recentEdges,
  };
}

function normalizeSpecialistText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function defaultNextActionForStatus(
  status: SpecialistOperatorStatus,
): string | null {
  switch (status) {
    case "completed":
      return "Review the delivered result and advance the next governed lane.";
    case "watching":
      return "Review the evidence and clear the highest-priority follow-up before treating this lane as closed.";
    case "blocked":
      return "Clear the blocking dependency and rerun the bounded task.";
    case "escalate":
      return "Escalate with the recorded evidence and assign the next owner before retrying.";
    case "refused":
      return "Refine the request so it stays inside the agent boundary, then rerun it.";
    default:
      return null;
  }
}

export function buildSpecialistOperatorFields(args: {
  role: string;
  workflowStage: string;
  deliverable: string;
  status: SpecialistOperatorStatus;
  operatorSummary: string;
  recommendedNextActions?: Array<string | null | undefined>;
  refusalReason?: string | null;
  escalationReason?: string | null;
}) {
  const refusalReason = normalizeSpecialistText(args.refusalReason);
  const escalationReason = normalizeSpecialistText(args.escalationReason);
  const recommendedNextActions = uniqueStrings([
    ...(args.recommendedNextActions ?? []),
    defaultNextActionForStatus(args.status),
  ]).slice(0, 5);
  const operatorSummary =
    normalizeSpecialistText(args.operatorSummary) ??
    "Specialist result completed without a summary.";

  return {
    operatorSummary,
    recommendedNextActions,
    specialistContract: {
      role: args.role,
      workflowStage: args.workflowStage,
      deliverable: args.deliverable,
      status: args.status,
      operatorSummary,
      recommendedNextActions,
      refusalReason,
      escalationReason,
    } satisfies SpecialistOperatorContract,
  };
}
