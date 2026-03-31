import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { DataPersistence } from "./persistence/data-persistence.js";
import {
  IncidentAcknowledgementRecord,
  IncidentEscalationState,
  IncidentHistoryEvent,
  IncidentLedgerRecord,
  IncidentOwnershipRecord,
  IncidentPolicyExecutionRecord,
  IncidentRemediationPlanStep,
  IncidentRemediationPolicy,
  IncidentRemediationTaskRecord,
  IncidentVerificationState,
  OrchestratorState,
  RepairRecord,
  RelationshipObservationRecord,
  TaskRetryRecoveryRecord,
  WorkflowEventRecord,
} from "./types.js";

const DEFAULT_HISTORY_LIMIT = 50;
const DRIFT_LOG_LIMIT = 25;
const REDDIT_RESPONSE_LIMIT = 100;
const AGENT_DEPLOYMENT_LIMIT = 50;
const RSS_DRAFT_LIMIT = 200;
const RSS_SEEN_LIMIT = 400;
const REDDIT_QUEUE_LIMIT = 100;
const APPROVALS_LIMIT = 1000;
const TASK_EXECUTION_LIMIT = 5000;
const TASK_RETRY_RECOVERY_LIMIT = 1000;
const REPAIR_RECORD_LIMIT = 500;
const INCIDENT_LEDGER_LIMIT = 1000;
const WORKFLOW_EVENT_LIMIT = 20000;
const RELATIONSHIP_OBSERVATION_LIMIT = 20000;
const MONGO_STATE_PREFIX = "mongo:";
type StateRetentionOptions = {
  taskHistoryLimit?: number;
};

export function isMongoStateTarget(target: string) {
  return typeof target === "string" && target.startsWith(MONGO_STATE_PREFIX);
}

function resolveMongoStateKey(target: string) {
  const key = target.slice(MONGO_STATE_PREFIX.length).trim();
  if (!key) {
    throw new Error("mongo state target must include a non-empty key");
  }
  return key;
}

function normalizeTaskHistoryLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_HISTORY_LIMIT;
  const clamped = Math.floor(limit as number);
  if (clamped < 1) return 1;
  if (clamped > 10000) return 10000;
  return clamped;
}

function normalizeStringArray(values: unknown, limit: number = 100) {
  if (!Array.isArray(values)) return [] as string[];
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))].slice(-limit);
}

function normalizeIncidentHistoryEvent(value: unknown): IncidentHistoryEvent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<IncidentHistoryEvent>;
  if (typeof raw.id !== "string" || typeof raw.timestamp !== "string" || typeof raw.type !== "string" || typeof raw.summary !== "string") {
    return null;
  }
  return {
    id: raw.id,
    timestamp: raw.timestamp,
    type: raw.type as IncidentHistoryEvent["type"],
    actor: typeof raw.actor === "string" ? raw.actor : null,
    summary: raw.summary,
    detail: typeof raw.detail === "string" ? raw.detail : null,
    evidence: normalizeStringArray(raw.evidence, 25),
  };
}

function normalizeIncidentAcknowledgement(
  value: unknown,
): IncidentAcknowledgementRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<IncidentAcknowledgementRecord>;
  if (
    typeof raw.acknowledgedAt !== "string" ||
    typeof raw.acknowledgedBy !== "string"
  ) {
    return null;
  }
  return {
    acknowledgedAt: raw.acknowledgedAt,
    acknowledgedBy: raw.acknowledgedBy,
    note: typeof raw.note === "string" ? raw.note : null,
  };
}

function normalizeIncidentOwnership(
  value: unknown,
): IncidentOwnershipRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<IncidentOwnershipRecord>;
  if (typeof raw.changedAt !== "string" || typeof raw.changedBy !== "string") {
    return null;
  }
  return {
    changedAt: raw.changedAt,
    changedBy: raw.changedBy,
    previousOwner:
      typeof raw.previousOwner === "string" ? raw.previousOwner : null,
    nextOwner: typeof raw.nextOwner === "string" ? raw.nextOwner : null,
    note: typeof raw.note === "string" ? raw.note : null,
  };
}

function normalizeIncidentPolicyExecution(
  value: unknown,
): IncidentPolicyExecutionRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<IncidentPolicyExecutionRecord>;
  if (
    typeof raw.executionId !== "string" ||
    typeof raw.executedAt !== "string" ||
    typeof raw.actor !== "string" ||
    typeof raw.policyId !== "string" ||
    typeof raw.trigger !== "string" ||
    typeof raw.action !== "string" ||
    typeof raw.result !== "string" ||
    typeof raw.summary !== "string"
  ) {
    return null;
  }
  return {
    executionId: raw.executionId,
    executedAt: raw.executedAt,
    actor: raw.actor,
    policyId: raw.policyId,
    trigger: raw.trigger as IncidentPolicyExecutionRecord["trigger"],
    action: raw.action as IncidentPolicyExecutionRecord["action"],
    result: raw.result as IncidentPolicyExecutionRecord["result"],
    summary: raw.summary,
    detail: typeof raw.detail === "string" ? raw.detail : null,
    remediationId:
      typeof raw.remediationId === "string" ? raw.remediationId : null,
    taskId: typeof raw.taskId === "string" ? raw.taskId : null,
    runId: typeof raw.runId === "string" ? raw.runId : null,
    evidence: normalizeStringArray(raw.evidence, 25),
  };
}
function normalizeIncidentRemediationTask(
  value: unknown,
): IncidentRemediationTaskRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<IncidentRemediationTaskRecord>;
  if (
    typeof raw.remediationId !== "string" ||
    typeof raw.createdAt !== "string" ||
    typeof raw.createdBy !== "string" ||
    typeof raw.taskType !== "string" ||
    typeof raw.taskId !== "string" ||
    typeof raw.status !== "string" ||
    typeof raw.reason !== "string"
  ) {
    return null;
  }
  return {
    remediationId: raw.remediationId,
    lane:
      raw.lane === "verification" || raw.lane === "escalation"
        ? raw.lane
        : "primary",
    createdAt: raw.createdAt,
    createdBy: raw.createdBy,
    assignedTo: typeof raw.assignedTo === "string" ? raw.assignedTo : null,
    assignedAt: typeof raw.assignedAt === "string" ? raw.assignedAt : null,
    taskType: raw.taskType,
    taskId: raw.taskId,
    runId: typeof raw.runId === "string" ? raw.runId : null,
    status: raw.status as IncidentRemediationTaskRecord["status"],
    reason: raw.reason,
    note: typeof raw.note === "string" ? raw.note : null,
    executionStartedAt:
      typeof raw.executionStartedAt === "string" ? raw.executionStartedAt : null,
    executionCompletedAt:
      typeof raw.executionCompletedAt === "string"
        ? raw.executionCompletedAt
        : null,
    verificationStartedAt:
      typeof raw.verificationStartedAt === "string"
        ? raw.verificationStartedAt
        : null,
    verificationCompletedAt:
      typeof raw.verificationCompletedAt === "string"
        ? raw.verificationCompletedAt
        : null,
    verifiedAt: typeof raw.verifiedAt === "string" ? raw.verifiedAt : null,
    resolvedAt: typeof raw.resolvedAt === "string" ? raw.resolvedAt : null,
    lastUpdatedAt:
      typeof raw.lastUpdatedAt === "string" ? raw.lastUpdatedAt : null,
    verificationSummary:
      typeof raw.verificationSummary === "string"
        ? raw.verificationSummary
        : null,
    resolutionSummary:
      typeof raw.resolutionSummary === "string" ? raw.resolutionSummary : null,
    blockers: normalizeStringArray(raw.blockers, 25),
  };
}

function normalizeIncidentRemediationPolicy(
  value: unknown,
): IncidentRemediationPolicy {
  const raw =
    value && typeof value === "object"
      ? (value as Partial<IncidentRemediationPolicy>)
      : {};
  return {
    policyId:
      typeof raw.policyId === "string" && raw.policyId.length > 0
        ? raw.policyId
        : "operator-review",
    preferredOwner:
      typeof raw.preferredOwner === "string" && raw.preferredOwner.length > 0
        ? raw.preferredOwner
        : "operator",
    autoAssignOwner: raw.autoAssignOwner === true,
    autoRemediateOnCreate: raw.autoRemediateOnCreate === true,
    autoRetryBlockedRemediation: raw.autoRetryBlockedRemediation !== false,
    maxAutoRemediationAttempts:
      typeof raw.maxAutoRemediationAttempts === "number" &&
      Number.isFinite(raw.maxAutoRemediationAttempts)
        ? Math.max(1, Math.floor(raw.maxAutoRemediationAttempts))
        : 2,
    autoEscalateOnBreach: raw.autoEscalateOnBreach !== false,
    remediationTaskType:
      raw.remediationTaskType === "drift-repair" ||
      raw.remediationTaskType === "qa-verification" ||
      raw.remediationTaskType === "system-monitor"
        ? raw.remediationTaskType
        : "system-monitor",
    verifierTaskType:
      raw.verifierTaskType === "qa-verification" ? raw.verifierTaskType : null,
    escalationTaskType:
      raw.escalationTaskType === "qa-verification" ||
      raw.escalationTaskType === "system-monitor"
        ? raw.escalationTaskType
        : null,
    targetSlaMinutes:
      typeof raw.targetSlaMinutes === "number" &&
      Number.isFinite(raw.targetSlaMinutes)
        ? raw.targetSlaMinutes
        : 120,
    escalationMinutes:
      typeof raw.escalationMinutes === "number" &&
      Number.isFinite(raw.escalationMinutes)
        ? raw.escalationMinutes
        : 240,
  };
}

function normalizeIncidentEscalationState(
  value: unknown,
): IncidentEscalationState {
  const raw =
    value && typeof value === "object"
      ? (value as Partial<IncidentEscalationState>)
      : {};
  return {
    level:
      raw.level === "warning" ||
      raw.level === "escalated" ||
      raw.level === "breached"
        ? raw.level
        : "normal",
    status:
      raw.status === "watching" ||
      raw.status === "escalated" ||
      raw.status === "breached"
        ? raw.status
        : "on-track",
    dueAt: typeof raw.dueAt === "string" ? raw.dueAt : null,
    escalateAt: typeof raw.escalateAt === "string" ? raw.escalateAt : null,
    escalatedAt: typeof raw.escalatedAt === "string" ? raw.escalatedAt : null,
    breachedAt: typeof raw.breachedAt === "string" ? raw.breachedAt : null,
    summary:
      typeof raw.summary === "string" && raw.summary.length > 0
        ? raw.summary
        : "Escalation state has not been derived yet.",
  };
}

function normalizeIncidentVerificationState(
  value: unknown,
): IncidentVerificationState {
  const raw =
    value && typeof value === "object"
      ? (value as Partial<IncidentVerificationState>)
      : {};
  return {
    required: raw.required === true,
    agentId: typeof raw.agentId === "string" ? raw.agentId : null,
    status:
      raw.status === "pending" ||
      raw.status === "running" ||
      raw.status === "passed" ||
      raw.status === "failed"
        ? raw.status
        : raw.required === true
          ? "pending"
          : "not-required",
    summary:
      typeof raw.summary === "string" && raw.summary.length > 0
        ? raw.summary
        : raw.required === true
          ? "Verification is required before closure."
          : "Verification is not required for this incident.",
    verificationTaskId:
      typeof raw.verificationTaskId === "string" ? raw.verificationTaskId : null,
    verificationRunId:
      typeof raw.verificationRunId === "string" ? raw.verificationRunId : null,
    verifiedAt: typeof raw.verifiedAt === "string" ? raw.verifiedAt : null,
  };
}

function normalizeIncidentRemediationPlanStep(
  value: unknown,
): IncidentRemediationPlanStep | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<IncidentRemediationPlanStep>;
  if (
    typeof raw.stepId !== "string" ||
    typeof raw.title !== "string" ||
    typeof raw.kind !== "string" ||
    typeof raw.owner !== "string" ||
    typeof raw.status !== "string" ||
    typeof raw.description !== "string"
  ) {
    return null;
  }
  return {
    stepId: raw.stepId,
    title: raw.title,
    kind: raw.kind as IncidentRemediationPlanStep["kind"],
    owner: raw.owner,
    status: raw.status as IncidentRemediationPlanStep["status"],
    description: raw.description,
    taskType: typeof raw.taskType === "string" ? raw.taskType : null,
    dependsOn: normalizeStringArray(raw.dependsOn, 10),
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
    completedAt: typeof raw.completedAt === "string" ? raw.completedAt : null,
    evidence: normalizeStringArray(raw.evidence, 25),
  };
}

function normalizeRelationshipObservation(
  value: unknown,
): RelationshipObservationRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<RelationshipObservationRecord>;
  if (
    typeof raw.observationId !== "string" ||
    typeof raw.timestamp !== "string" ||
    typeof raw.from !== "string" ||
    typeof raw.to !== "string" ||
    typeof raw.relationship !== "string" ||
    typeof raw.status !== "string" ||
    typeof raw.source !== "string" ||
    typeof raw.detail !== "string"
  ) {
    return null;
  }
  return {
    observationId: raw.observationId,
    timestamp: raw.timestamp,
    from: raw.from,
    to: raw.to,
    relationship: raw.relationship,
    status: raw.status,
    source: raw.source,
    detail: raw.detail,
    taskId: typeof raw.taskId === "string" ? raw.taskId : null,
    runId: typeof raw.runId === "string" ? raw.runId : null,
    targetTaskId: typeof raw.targetTaskId === "string" ? raw.targetTaskId : null,
    targetRunId: typeof raw.targetRunId === "string" ? raw.targetRunId : null,
    toolId: typeof raw.toolId === "string" ? raw.toolId : null,
    proofTransport:
      raw.proofTransport === "milestone" || raw.proofTransport === "demandSummary"
        ? raw.proofTransport
        : null,
    classification:
      typeof raw.classification === "string" ? raw.classification : null,
    parentObservationId:
      typeof raw.parentObservationId === "string" ? raw.parentObservationId : null,
    evidence: normalizeStringArray(raw.evidence, 25),
  };
}

function normalizeIncidentLedgerRecord(record: IncidentLedgerRecord) {
  return {
    ...record,
    affectedSurfaces: normalizeStringArray(record.affectedSurfaces, 25),
    linkedServiceIds: normalizeStringArray(record.linkedServiceIds, 25),
    linkedTaskIds: normalizeStringArray(record.linkedTaskIds, 50),
    linkedRunIds: normalizeStringArray(record.linkedRunIds, 50),
    linkedRepairIds: normalizeStringArray(record.linkedRepairIds, 50),
    linkedProofDeliveries: normalizeStringArray(record.linkedProofDeliveries, 25),
    evidence: normalizeStringArray(record.evidence, 25),
    recommendedSteps: normalizeStringArray(record.recommendedSteps, 25),
    policy: normalizeIncidentRemediationPolicy(record.policy),
    escalation: normalizeIncidentEscalationState(record.escalation),
    remediation: {
      ...record.remediation,
      blockers: normalizeStringArray(record.remediation?.blockers, 25),
    },
    remediationPlan: Array.isArray(record.remediationPlan)
      ? record.remediationPlan
          .map(normalizeIncidentRemediationPlanStep)
          .filter((item): item is IncidentRemediationPlanStep => item !== null)
          .slice(-25)
      : [],
    verification: normalizeIncidentVerificationState(record.verification),
    history: Array.isArray(record.history)
      ? record.history
          .map(normalizeIncidentHistoryEvent)
          .filter((item): item is IncidentHistoryEvent => item !== null)
          .slice(-100)
      : [],
    policyExecutions: Array.isArray(record.policyExecutions)
      ? record.policyExecutions
          .map(normalizeIncidentPolicyExecution)
          .filter((item): item is IncidentPolicyExecutionRecord => item !== null)
          .slice(-100)
      : [],
    acknowledgements: Array.isArray(record.acknowledgements)
      ? record.acknowledgements
          .map(normalizeIncidentAcknowledgement)
          .filter((item): item is IncidentAcknowledgementRecord => item !== null)
          .slice(-50)
      : [],
    ownershipHistory: Array.isArray(record.ownershipHistory)
      ? record.ownershipHistory
          .map(normalizeIncidentOwnership)
          .filter((item): item is IncidentOwnershipRecord => item !== null)
          .slice(-50)
      : [],
    remediationTasks: Array.isArray(record.remediationTasks)
      ? record.remediationTasks
          .map(normalizeIncidentRemediationTask)
          .filter((item): item is IncidentRemediationTaskRecord => item !== null)
          .slice(-50)
      : [],
  };
}

export async function loadState(
  path: string,
  options: StateRetentionOptions = {},
): Promise<OrchestratorState> {
  const historyLimit = normalizeTaskHistoryLimit(options.taskHistoryLimit);

  const normalizeParsedState = (parsed: OrchestratorState) => {
    const {
      reviewSessions: _legacyReviewSessions,
      reviewTelemetrySamples: _legacyReviewTelemetrySamples,
      ...rest
    } = parsed as OrchestratorState & {
      reviewSessions?: unknown;
      reviewTelemetrySamples?: unknown;
    };
    return {
      ...createDefaultState(),
      ...rest,
      taskHistory: parsed.taskHistory?.slice(-historyLimit) ?? [],
      taskExecutions: parsed.taskExecutions?.slice(-TASK_EXECUTION_LIMIT) ?? [],
      approvals: parsed.approvals?.slice(-APPROVALS_LIMIT) ?? [],
      pendingDocChanges: parsed.pendingDocChanges ?? [],
      driftRepairs: parsed.driftRepairs ?? [],
      repairRecords: parsed.repairRecords?.slice(-REPAIR_RECORD_LIMIT) ?? [],
      taskRetryRecoveries:
        parsed.taskRetryRecoveries?.slice(-TASK_RETRY_RECOVERY_LIMIT) ?? [],
      redditQueue: parsed.redditQueue?.slice(0, REDDIT_QUEUE_LIMIT) ?? [],
      redditResponses: parsed.redditResponses ?? [],
      agentDeployments: parsed.agentDeployments ?? [],
      rssDrafts: parsed.rssDrafts ?? [],
      rssSeenIds: parsed.rssSeenIds ?? [],
      governedSkillState: parsed.governedSkillState ?? [],
      incidentLedger:
        parsed.incidentLedger
          ?.slice(-INCIDENT_LEDGER_LIMIT)
          .map(normalizeIncidentLedgerRecord) ?? [],
      workflowEvents:
        parsed.workflowEvents?.slice(-WORKFLOW_EVENT_LIMIT) ?? [],
      relationshipObservations:
        parsed.relationshipObservations
          ?.slice(-RELATIONSHIP_OBSERVATION_LIMIT)
          .map(normalizeRelationshipObservation)
          .filter((item): item is RelationshipObservationRecord => item !== null) ??
        [],
    };
  };

  if (isMongoStateTarget(path)) {
    const key = resolveMongoStateKey(path);
    const persisted = await DataPersistence.getSystemState(key);
    if (!persisted || typeof persisted !== "object") {
      return createDefaultState();
    }
    return normalizeParsedState(persisted as OrchestratorState);
  }

  if (!existsSync(path)) {
    return createDefaultState();
  }

  const raw = await readFile(path, "utf-8");
  try {
    const parsed = JSON.parse(raw) as OrchestratorState;
    return normalizeParsedState(parsed);
  } catch (error) {
    console.warn(
      `[state] Failed to parse state file, starting fresh: ${(error as Error).message}`,
    );
    return createDefaultState();
  }
}

export async function saveState(path: string, state: OrchestratorState) {
  await saveStateWithOptions(path, state, {});
}

export async function saveStateWithOptions(
  path: string,
  state: OrchestratorState,
  options: StateRetentionOptions = {},
) {
  const historyLimit = normalizeTaskHistoryLimit(options.taskHistoryLimit);
  await mkdir(dirname(path), { recursive: true });
  const prepared: OrchestratorState = {
    ...state,
    taskHistory: state.taskHistory.slice(-historyLimit),
    taskExecutions: state.taskExecutions.slice(-TASK_EXECUTION_LIMIT),
    approvals: state.approvals.slice(-APPROVALS_LIMIT),
    pendingDocChanges: state.pendingDocChanges.slice(0, 200),
    driftRepairs: state.driftRepairs.slice(-DRIFT_LOG_LIMIT),
    repairRecords: state.repairRecords.slice(-REPAIR_RECORD_LIMIT),
    taskRetryRecoveries: state.taskRetryRecoveries.slice(
      -TASK_RETRY_RECOVERY_LIMIT,
    ),
    redditQueue: state.redditQueue.slice(0, REDDIT_QUEUE_LIMIT),
    redditResponses: state.redditResponses.slice(-REDDIT_RESPONSE_LIMIT),
    agentDeployments: state.agentDeployments.slice(-AGENT_DEPLOYMENT_LIMIT),
    rssDrafts: state.rssDrafts.slice(-RSS_DRAFT_LIMIT),
    rssSeenIds: state.rssSeenIds.slice(-RSS_SEEN_LIMIT),
    governedSkillState: state.governedSkillState,
    incidentLedger: state.incidentLedger.slice(-INCIDENT_LEDGER_LIMIT),
    workflowEvents: state.workflowEvents.slice(-WORKFLOW_EVENT_LIMIT),
    relationshipObservations: state.relationshipObservations.slice(
      -RELATIONSHIP_OBSERVATION_LIMIT,
    ),
    updatedAt: new Date().toISOString(),
  };

  if (isMongoStateTarget(path)) {
    await DataPersistence.saveSystemState(resolveMongoStateKey(path), prepared);
    return;
  }

  await writeFile(path, JSON.stringify(prepared, null, 2), "utf-8");
}

export function createDefaultState(): OrchestratorState {
  return {
    lastStartedAt: null,
    updatedAt: null,
    indexedDocs: 0,
    docIndexVersion: 0,
    pendingDocChanges: [],
    taskHistory: [],
    taskExecutions: [],
    approvals: [],
    driftRepairs: [],
    repairRecords: [],
    taskRetryRecoveries: [],
    redditQueue: [],
    redditResponses: [],
    agentDeployments: [],
    rssDrafts: [],
    rssSeenIds: [],
    governedSkillState: [],
    incidentLedger: [],
    workflowEvents: [],
    relationshipObservations: [],
    lastDriftRepairAt: null,
    lastRedditResponseAt: null,
    lastAgentDeployAt: null,
    lastRssSweepAt: null,
  };
}

export function appendWorkflowEventRecord(
  state: OrchestratorState,
  event: WorkflowEventRecord,
) {
  state.workflowEvents.push(event);
  if (state.workflowEvents.length > WORKFLOW_EVENT_LIMIT) {
    state.workflowEvents = state.workflowEvents.slice(-WORKFLOW_EVENT_LIMIT);
  }
}

export function appendIncidentLedgerRecord(
  state: OrchestratorState,
  record: IncidentLedgerRecord,
) {
  state.incidentLedger.push(record);
  if (state.incidentLedger.length > INCIDENT_LEDGER_LIMIT) {
    state.incidentLedger = state.incidentLedger.slice(-INCIDENT_LEDGER_LIMIT);
  }
}

export function appendRelationshipObservationRecord(
  state: OrchestratorState,
  record: RelationshipObservationRecord,
) {
  state.relationshipObservations.push(record);
  if (state.relationshipObservations.length > RELATIONSHIP_OBSERVATION_LIMIT) {
    state.relationshipObservations = state.relationshipObservations.slice(
      -RELATIONSHIP_OBSERVATION_LIMIT,
    );
  }
}

export function reconcileTaskRetryRecoveryState(
  state: OrchestratorState,
  now: string = new Date().toISOString(),
) {
  const retryRecoveryKeys = new Set(
    state.taskRetryRecoveries.map((record) => record.idempotencyKey),
  );
  let recoveredRetryCount = 0;
  for (const execution of state.taskExecutions) {
    if (execution.status !== "retrying") continue;
    if (retryRecoveryKeys.has(execution.idempotencyKey)) continue;

    const baseMessage =
      execution.lastError && execution.lastError.trim().length > 0
        ? execution.lastError
        : "retry interrupted before requeue";
    const recoveryMessage = `${baseMessage} (orchestrator restarted before retry dispatch)`;

    execution.status = "failed";
    execution.lastHandledAt = now;
    execution.lastError = recoveryMessage;
    state.taskHistory.push({
      id: execution.taskId,
      type: execution.type,
      handledAt: now,
      result: "error",
      message: recoveryMessage,
    });
    recoveredRetryCount += 1;
  }

  const executionsByKey = new Map(
    state.taskExecutions.map((execution) => [execution.idempotencyKey, execution]),
  );
  const staleRecoveryCount =
    state.taskRetryRecoveries.length -
    state.taskRetryRecoveries.filter((record) => {
      const execution = executionsByKey.get(record.idempotencyKey);
      return execution?.status === "retrying";
    }).length;

  state.taskRetryRecoveries = state.taskRetryRecoveries.filter((record) => {
    const execution = executionsByKey.get(record.idempotencyKey);
    return execution?.status === "retrying";
  });

  return { recoveredRetryCount, staleRecoveryCount };
}

export function reconcileInFlightTaskExecutionState(
  state: OrchestratorState,
  now: string = new Date().toISOString(),
) {
  let recoveredSuccessCount = 0;
  let recoveredFailureCount = 0;
  let interruptedCount = 0;
  let awaitingApprovalCount = 0;

  const appendRecoveredHistory = (
    execution: OrchestratorState["taskExecutions"][number],
    result: "ok" | "error",
    handledAt: string,
    message: string,
  ) => {
    const exists = state.taskHistory.some(
      (entry) =>
        entry.id === execution.taskId &&
        entry.type === execution.type &&
        entry.handledAt === handledAt &&
        entry.result === result,
    );
    if (exists) return;

    state.taskHistory.push({
      id: execution.taskId,
      type: execution.type,
      handledAt,
      result,
      message,
    });
  };

  for (const execution of state.taskExecutions) {
    if (execution.status !== "pending" && execution.status !== "running") {
      continue;
    }

    const relatedWorkflowEvents = state.workflowEvents
      .filter((event) => event.runId === execution.idempotencyKey)
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

    const latestTerminalResult = [...relatedWorkflowEvents]
      .reverse()
      .find(
        (event) =>
          event.stage === "result" &&
          (event.state === "success" || event.state === "failed"),
      );

    if (latestTerminalResult) {
      execution.status = latestTerminalResult.state === "success" ? "success" : "failed";
      execution.lastHandledAt = latestTerminalResult.timestamp || now;
      execution.lastError =
        latestTerminalResult.state === "failed"
          ? latestTerminalResult.detail
          : undefined;
      appendRecoveredHistory(
        execution,
        latestTerminalResult.state === "success" ? "ok" : "error",
        execution.lastHandledAt,
        latestTerminalResult.detail,
      );
      if (latestTerminalResult.state === "success") {
        recoveredSuccessCount += 1;
      } else {
        recoveredFailureCount += 1;
      }
      continue;
    }

    const approvalPending = state.approvals.some(
      (record) => record.taskId === execution.taskId && record.status === "pending",
    );
    const approvalWorkflowPending = relatedWorkflowEvents.some(
      (event) => event.stage === "approval" && event.stopCode === "awaiting-approval",
    );
    if (approvalPending || approvalWorkflowPending) {
      execution.status = "pending";
      awaitingApprovalCount += 1;
      continue;
    }

    const interruptedMessage =
      execution.status === "running"
        ? "execution interrupted before completion (orchestrator restarted while task was running)"
        : "task remained pending across orchestrator restart without an approval hold or terminal result";

    execution.status = "failed";
    execution.lastHandledAt = now;
    execution.lastError = interruptedMessage;
    appendRecoveredHistory(execution, "error", now, interruptedMessage);
    interruptedCount += 1;
  }

  return {
    recoveredSuccessCount,
    recoveredFailureCount,
    interruptedCount,
    awaitingApprovalCount,
  };
}

export function getRetryRecoveryDelayMs(
  record: TaskRetryRecoveryRecord,
  nowMs: number = Date.now(),
) {
  const retryAtMs = Date.parse(record.retryAt);
  if (!Number.isFinite(retryAtMs)) return 0;
  return Math.max(0, retryAtMs - nowMs);
}

export type GovernanceVisibilitySummary = {
  approvals: {
    pendingCount: number;
  };
  repairs: {
    totalCount: number;
    activeCount: number;
    verifiedCount: number;
    failedCount: number;
    lastDetectedAt: string | null;
    lastVerifiedAt: string | null;
    lastFailedAt: string | null;
  };
  taskRetryRecoveries: {
    count: number;
    nextRetryAt: string | null;
  };
  governedSkills: {
    totalCount: number;
    pendingReviewCount: number;
    approvedCount: number;
    restartSafeCount: number;
    restartSafeApprovedCount: number;
    metadataOnlyCount: number;
    metadataOnlyApprovedCount: number;
  };
};

export function upsertRepairRecord(
  state: OrchestratorState,
  record: RepairRecord,
) {
  const existingIndex = state.repairRecords.findIndex(
    (item) => item.repairId === record.repairId,
  );
  if (existingIndex >= 0) {
    state.repairRecords[existingIndex] = record;
  } else {
    state.repairRecords.push(record);
  }
  state.repairRecords = state.repairRecords.slice(-REPAIR_RECORD_LIMIT);
}

export function updateRepairRecord(
  state: OrchestratorState,
  repairId: string,
  updater: (record: RepairRecord) => RepairRecord,
) {
  const existing = state.repairRecords.find((item) => item.repairId === repairId);
  if (!existing) return null;
  const next = updater(existing);
  upsertRepairRecord(state, next);
  return next;
}

export function summarizeGovernanceVisibility(
  state: OrchestratorState,
): GovernanceVisibilitySummary {
  const nextRetryAt =
    state.taskRetryRecoveries
      .map((record) => record.retryAt)
      .filter((retryAt) => Number.isFinite(Date.parse(retryAt)))
      .sort()[0] ?? null;

  const governedSkills = state.governedSkillState.reduce(
    (summary, record) => {
      summary.totalCount += 1;
      if (record.trustStatus === "pending-review") summary.pendingReviewCount += 1;
      if (record.trustStatus === "review-approved") summary.approvedCount += 1;

      if (record.persistenceMode === "restart-safe") {
        summary.restartSafeCount += 1;
        if (record.trustStatus === "review-approved") {
          summary.restartSafeApprovedCount += 1;
        }
      }

      if (record.persistenceMode === "metadata-only") {
        summary.metadataOnlyCount += 1;
        if (record.trustStatus === "review-approved") {
          summary.metadataOnlyApprovedCount += 1;
        }
      }

      return summary;
    },
    {
      totalCount: 0,
      pendingReviewCount: 0,
      approvedCount: 0,
      restartSafeCount: 0,
      restartSafeApprovedCount: 0,
      metadataOnlyCount: 0,
      metadataOnlyApprovedCount: 0,
    },
  );

  const repairs = state.repairRecords.reduce(
    (summary, record) => {
      summary.totalCount += 1;
      if (record.status === "queued" || record.status === "running") {
        summary.activeCount += 1;
      }
      if (record.status === "verified") {
        summary.verifiedCount += 1;
        if (
          !summary.lastVerifiedAt ||
          Date.parse(record.verifiedAt ?? record.completedAt ?? record.detectedAt) >
            Date.parse(summary.lastVerifiedAt)
        ) {
          summary.lastVerifiedAt =
            record.verifiedAt ?? record.completedAt ?? record.detectedAt;
        }
      }
      if (record.status === "failed") {
        summary.failedCount += 1;
        if (
          !summary.lastFailedAt ||
          Date.parse(record.completedAt ?? record.detectedAt) >
            Date.parse(summary.lastFailedAt)
        ) {
          summary.lastFailedAt = record.completedAt ?? record.detectedAt;
        }
      }
      if (
        !summary.lastDetectedAt ||
        Date.parse(record.detectedAt) > Date.parse(summary.lastDetectedAt)
      ) {
        summary.lastDetectedAt = record.detectedAt;
      }
      return summary;
    },
    {
      totalCount: 0,
      activeCount: 0,
      verifiedCount: 0,
      failedCount: 0,
      lastDetectedAt: null as string | null,
      lastVerifiedAt: null as string | null,
      lastFailedAt: null as string | null,
    },
  );

  return {
    approvals: {
      pendingCount: state.approvals.filter((approval) => approval.status === "pending")
        .length,
    },
    repairs,
    taskRetryRecoveries: {
      count: state.taskRetryRecoveries.length,
      nextRetryAt,
    },
    governedSkills,
  };
}
