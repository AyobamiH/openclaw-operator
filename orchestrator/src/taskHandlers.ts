import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  writeFile,
  appendFile,
  mkdtemp,
  rm,
  readdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import {
  ApprovalRecord,
  AgentDeploymentRecord,
  DriftRepairRecord,
  MaintenanceCheckId,
  MaintenanceCheckRecord,
  RepairRecord,
  RelationshipObservationRecord,
  RelationshipObservationType,
  RedditReplyRecord,
  RedditQueueItem,
  RssDraftRecord,
  Task,
  TaskHandler,
  TaskHandlerContext,
} from "./types.js";
import { sendNotification, buildNotifierConfig } from "./notifier.js";
import { getAgentRegistry } from "./agentRegistry.js";
import { getToolGate } from "./toolGate.js";
import {
  appendRelationshipObservationRecord,
  upsertRepairRecord,
  updateRepairRecord,
} from "./state.js";
import { onApprovalRequested } from "./metrics/index.js";
import { extractTaskExecutionAccounting } from "./accounting/cost-accounting.js";
import {
  buildDocRepairFingerprint,
  buildDocRepairRepairId,
  claimDocRepairLock,
  isDocRepairCooldownActive,
  markDocRepairCooldown,
  releaseDocRepairLock,
} from "./coordination/runtime-coordination.js";

// Central task allowlist (deny-by-default enforcement)
export const ALLOWED_TASK_TYPES = [
  "startup",
  "doc-change",
  "doc-sync",
  "drift-repair",
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
] as const;

export type AllowedTaskType = (typeof ALLOWED_TASK_TYPES)[number];

const MAINTENANCE_CHECK_SPECS = [
  {
    id: "system-monitor",
    label: "System Monitor",
    taskType: "system-monitor",
    intervalMinutes: 5,
  },
  {
    id: "security-posture",
    label: "Security Posture",
    taskType: "security-audit",
    intervalMinutes: 15,
  },
  {
    id: "qa-readiness",
    label: "QA Readiness",
    taskType: "qa-verification",
    intervalMinutes: 30,
  },
] as const satisfies ReadonlyArray<{
  id: MaintenanceCheckId;
  label: string;
  taskType: "system-monitor" | "security-audit" | "qa-verification";
  intervalMinutes: number;
}>;

type MaintenanceCheckSpec = (typeof MAINTENANCE_CHECK_SPECS)[number];

const SPAWNED_AGENT_PERMISSION_REQUIREMENTS: Partial<
  Record<AllowedTaskType, { agentId: string; skillId: string }>
> = {
  "security-audit": { agentId: "security-agent", skillId: "documentParser" },
  "summarize-content": {
    agentId: "summarization-agent",
    skillId: "documentParser",
  },
  "system-monitor": {
    agentId: "system-monitor-agent",
    skillId: "documentParser",
  },
  "build-refactor": {
    agentId: "build-refactor-agent",
    skillId: "workspacePatch",
  },
  "control-plane-brief": {
    agentId: "operations-analyst-agent",
    skillId: "documentParser",
  },
  "content-generate": { agentId: "content-agent", skillId: "documentParser" },
  "incident-triage": {
    agentId: "system-monitor-agent",
    skillId: "documentParser",
  },
  "integration-workflow": {
    agentId: "integration-agent",
    skillId: "documentParser",
  },
  "normalize-data": { agentId: "normalization-agent", skillId: "normalizer" },
  "market-research": {
    agentId: "market-research-agent",
    skillId: "sourceFetch",
  },
  "data-extraction": {
    agentId: "data-extraction-agent",
    skillId: "documentParser",
  },
  "qa-verification": {
    agentId: "qa-verification-agent",
    skillId: "testRunner",
  },
  "release-readiness": {
    agentId: "release-manager-agent",
    skillId: "documentParser",
  },
  "skill-audit": { agentId: "skill-audit-agent", skillId: "documentParser" },
};

/**
 * Validate task type against allowlist
 * @throws Error if task type is not allowed
 */
export function validateTaskType(
  taskType: string,
): taskType is AllowedTaskType {
  return ALLOWED_TASK_TYPES.includes(taskType as any);
}

const MAX_REDDIT_QUEUE = 100;
const RSS_SEEN_CAP = 400;
const AGENT_MEMORY_TIMELINE_LIMIT = 120;
const DOC_DRIFT_REPAIR_THRESHOLD = 25;
const DOC_DRIFT_REPAIR_COOLDOWN_MS = 15 * 60 * 1000;
const REDDIT_MANUAL_REVIEW_APPROVAL_PREFIX = "reddit-manual-review";
const REDDIT_DRAFT_REVIEW_APPROVAL_PREFIX = "reddit-draft-review";
const REDDIT_DRAFT_APPROVALS_PER_BATCH = 10;
const CHILD_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "NODE_ENV",
  "TZ",
  "LANG",
  "LC_ALL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

const RUN_RESULT_HIGHLIGHT_PRIORITY = [
  "specialistContract",
  "operatorSummary",
  "recommendedNextActions",
  "taskSpecificKnowledge",
  "evidenceRails",
  "topologyPacks",
  "contradictionLedger",
  "repairDrafts",
  "freshnessSignals",
  "entityFreshnessLedger",
  "contradictionGraph",
  "workflowProfile",
  "delegationPlan",
  "replayContract",
  "handoffPackages",
  "dependencyPlan",
  "workflowMemory",
  "operationalDiagnosis",
  "queueBudgetFusion",
  "dependencyHealth",
  "earlyWarnings",
  "operatorClosureEvidence",
  "trendSummary",
  "regressionReview",
  "trustBoundaryHistory",
  "permissionDriftTimeline",
  "routeBoundaryWatch",
  "remediationDepth",
  "exploitabilityRanking",
  "remediationClosure",
  "providerPosture",
  "verificationLoop",
  "verificationAuthority",
  "verificationTrace",
  "verificationSurface",
  "refusalProfile",
  "closureContract",
  "reproducibilityProfile",
  "trustPosture",
  "policyHandoff",
  "telemetryHandoff",
  "intakeCoverage",
  "restartSafetySummary",
  "partialCompletion",
  "acceptanceCoverage",
  "scopeContract",
  "surgeryProfile",
  "impactEnvelope",
  "routingDecision",
  "operationalCompression",
  "artifactCoverage",
  "comparisonReadiness",
  "deltaCapture",
  "handoffPackage",
  "publicationPolicy",
  "claimDiscipline",
  "verificationTrace",
  "summary",
  "metrics",
] as const;

const RUN_RESULT_EXCLUDED_KEYS = new Set([
  "content",
  "replyText",
  "relationships",
  "toolInvocations",
  "proofTransitions",
  "warnings",
  "findings",
  "steps",
  "results",
]);
const MAX_RUN_RESULT_HIGHLIGHTS = 12;

function truncateRunResultText(value: string, maxLength: number = 240) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function sanitizeRunResultValue(value: unknown, depth: number = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return truncateRunResultText(value);
  }

  if (Array.isArray(value)) {
    return {
      count: value.length,
      sample: value.slice(0, 3).map((entry) => sanitizeRunResultValue(entry, depth + 1)),
    };
  }

  if (typeof value !== "object") {
    return String(value);
  }

  const record = value as Record<string, unknown>;
  const entries = Object.entries(record);

  if (depth >= 2) {
    return { keyCount: entries.length };
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of entries.slice(0, 12)) {
    sanitized[key] = sanitizeRunResultValue(entry, depth + 1);
  }
  if (entries.length > 12) {
    sanitized.truncated = true;
  }
  return sanitized;
}

function buildTaskExecutionResultSummary(result: Record<string, unknown>) {
  const keys = Object.keys(result).slice(0, 24);
  const highlightKeys = new Set<string>();

  for (const key of RUN_RESULT_HIGHLIGHT_PRIORITY) {
    if (key in result) {
      highlightKeys.add(key);
    }
    if (highlightKeys.size >= MAX_RUN_RESULT_HIGHLIGHTS) {
      break;
    }
  }

  for (const key of Object.keys(result)) {
    if (highlightKeys.size >= MAX_RUN_RESULT_HIGHLIGHTS) {
      break;
    }
    if (RUN_RESULT_EXCLUDED_KEYS.has(key)) {
      continue;
    }
    highlightKeys.add(key);
  }

  const highlights: Record<string, unknown> = {};
  for (const key of highlightKeys) {
    highlights[key] = sanitizeRunResultValue(result[key]);
  }

  return {
    success: typeof result.success === "boolean" ? result.success : undefined,
    keys,
    highlights,
  };
}

function buildIntegrationWorkflowSummaryResult(result: Record<string, unknown>) {
  const plan =
    result.plan && typeof result.plan === "object"
      ? (result.plan as Record<string, unknown>)
      : null;
  const workflowProfile =
    result.workflowProfile ??
    (plan?.workflowProfile && typeof plan.workflowProfile === "object"
      ? plan.workflowProfile
      : undefined);

  if (workflowProfile === undefined) {
    return result;
  }

  return {
    ...result,
    workflowProfile,
  };
}

function normalizeTaskExecutionSummaryResult(args: {
  taskType?: string | null;
  agentId?: string | null;
  result: Record<string, unknown>;
}) {
  const { taskType, agentId, result } = args;

  if (taskType === "integration-workflow" || agentId === "integration-agent") {
    return buildIntegrationWorkflowSummaryResult(result);
  }

  return result;
}

function recordTaskExecutionResultSummary(
  context: TaskHandlerContext,
  task: Task,
  result: Record<string, unknown>,
) {
  const idempotencyKey =
    typeof task.idempotencyKey === "string" && task.idempotencyKey.trim().length > 0
      ? task.idempotencyKey
      : task.id;
  const execution = context.state.taskExecutions.find(
    (item) => item.taskId === task.id || item.idempotencyKey === idempotencyKey,
  );
  if (!execution) {
    return;
  }

  execution.resultSummary = buildTaskExecutionResultSummary(
    normalizeTaskExecutionSummaryResult({
      taskType: task.type,
      result,
    }),
  );
  const extractedAccounting = extractTaskExecutionAccounting(result);
  if (extractedAccounting) {
    execution.accounting = {
      provider: extractedAccounting.provider ?? execution.accounting?.provider ?? null,
      model: extractedAccounting.model ?? execution.accounting?.model ?? null,
      metered: extractedAccounting.metered === true,
      pricingSource:
        extractedAccounting.pricingSource ??
        execution.accounting?.pricingSource ??
        "not-applicable",
      latencyMs: execution.accounting?.latencyMs ?? null,
      costUsd: execution.accounting?.costUsd ?? 0,
      usage: extractedAccounting.usage ?? execution.accounting?.usage ?? null,
      budget: extractedAccounting.budget ?? execution.accounting?.budget ?? null,
      note: extractedAccounting.note ?? execution.accounting?.note ?? null,
    };
  }
}

function ensureDocChangeStored(path: string, context: TaskHandlerContext) {
  const { state } = context;
  if (state.pendingDocChanges.includes(path)) return;
  state.pendingDocChanges.unshift(path);
  if (state.pendingDocChanges.length > 200) {
    state.pendingDocChanges.pop();
  }
}

function ensureRedditQueueLimit(context: TaskHandlerContext) {
  if (context.state.redditQueue.length > MAX_REDDIT_QUEUE) {
    context.state.redditQueue.length = MAX_REDDIT_QUEUE;
  }
}

function hasActiveTaskExecution(
  taskType: AllowedTaskType,
  context: TaskHandlerContext,
) {
  return context.state.taskExecutions.some(
    (execution) =>
      execution.type === taskType &&
      (execution.status === "pending" ||
        execution.status === "running" ||
        execution.status === "retrying"),
  );
}

function addMinutes(timestamp: string, minutes: number) {
  return new Date(new Date(timestamp).getTime() + minutes * 60 * 1000).toISOString();
}

function findLatestExecutionForTaskType(
  context: TaskHandlerContext,
  taskType: MaintenanceCheckSpec["taskType"],
) {
  return [...context.state.taskExecutions]
    .filter((execution) => execution.type === taskType)
    .sort((left, right) => right.lastHandledAt.localeCompare(left.lastHandledAt))[0] ?? null;
}

function ensureMaintenanceCheckRecord(
  context: TaskHandlerContext,
  spec: MaintenanceCheckSpec,
): MaintenanceCheckRecord {
  const existing = context.state.maintenanceChecks.find((record) => record.id === spec.id);
  if (existing) {
    existing.label = spec.label;
    existing.taskType = spec.taskType;
    existing.intervalMinutes = spec.intervalMinutes;
    return existing;
  }

  const created: MaintenanceCheckRecord = {
    id: spec.id,
    label: spec.label,
    taskType: spec.taskType,
    intervalMinutes: spec.intervalMinutes,
    lastCheckedAt: null,
    lastActionQueuedAt: null,
    nextDueAt: null,
    status: "idle",
    summary: "Control-plane heartbeat has not evaluated this maintenance check yet.",
    actionQueued: false,
    lastTaskId: null,
    lastRunId: null,
    latestObservedRunAt: null,
    latestObservedRunStatus: null,
  };
  context.state.maintenanceChecks.push(created);
  return created;
}

function refreshMaintenanceCheckObservation(
  context: TaskHandlerContext,
  record: MaintenanceCheckRecord,
) {
  const latestExecution = findLatestExecutionForTaskType(context, record.taskType);
  record.latestObservedRunAt = latestExecution?.lastHandledAt ?? null;
  record.latestObservedRunStatus = latestExecution?.status ?? null;
}

function isMaintenanceCheckDue(record: MaintenanceCheckRecord, now: string) {
  if (!record.lastActionQueuedAt) {
    return true;
  }

  const lastQueuedAt = Date.parse(record.lastActionQueuedAt);
  if (!Number.isFinite(lastQueuedAt)) {
    return true;
  }

  return Date.now() - lastQueuedAt >= record.intervalMinutes * 60 * 1000;
}

function queueMaintenanceCheck(args: {
  context: TaskHandlerContext;
  spec: MaintenanceCheckSpec;
  now: string;
  summary: string;
  actor: "heartbeat" | "startup";
}) {
  const { context, spec, now, summary, actor } = args;
  const record = ensureMaintenanceCheckRecord(context, spec);
  refreshMaintenanceCheckObservation(context, record);
  record.lastCheckedAt = now;

  if (hasActiveTaskExecution(spec.taskType, context)) {
    record.status = "watching";
    record.summary = `${spec.label} already has active work in flight; no duplicate maintenance run was queued.`;
    record.actionQueued = false;
    record.nextDueAt = addMinutes(now, spec.intervalMinutes);
    return null;
  }

  const payload: Record<string, unknown> =
    spec.taskType === "system-monitor"
      ? { type: "health" }
      : spec.taskType === "security-audit"
        ? { type: "scan", scope: "workspace" }
        : {
            target: "workspace",
            suite: "smoke",
            mode: "dry-run",
            dryRun: true,
          };

  const queued = context.enqueueTask(spec.taskType, {
    ...payload,
    reason: summary,
    __actor: actor,
    __visibility: "internal",
    __maintenanceCheck: spec.id,
  });

  record.status = "queued";
  record.summary = summary;
  record.actionQueued = true;
  record.lastActionQueuedAt = now;
  record.nextDueAt = addMinutes(now, spec.intervalMinutes);
  record.lastTaskId = queued.id;
  record.lastRunId = queued.idempotencyKey ?? queued.id;
  return queued;
}

function observeRuntimeRelationship(args: {
  context: TaskHandlerContext;
  task: Task;
  from: string;
  to: string;
  relationship: RelationshipObservationType;
  detail: string;
  source: string;
  status?: RelationshipObservationRecord["status"];
  evidence?: string[];
  targetTaskId?: string | null;
  targetRunId?: string | null;
  toolId?: string | null;
  proofTransport?: RelationshipObservationRecord["proofTransport"];
  classification?: string | null;
  parentObservationId?: string | null;
}) {
  appendRelationshipObservationRecord(args.context.state, {
    observationId: randomUUID(),
    timestamp: new Date().toISOString(),
    from: args.from,
    to: args.to,
    relationship: args.relationship,
    status: args.status ?? "observed",
    source: args.source,
    detail: args.detail,
    taskId: args.task.id,
    runId: taskRunId(args.task),
    targetTaskId: args.targetTaskId ?? null,
    targetRunId: args.targetRunId ?? null,
    toolId: args.toolId ?? null,
    proofTransport: args.proofTransport ?? null,
    classification: args.classification ?? null,
    parentObservationId: args.parentObservationId ?? null,
    evidence: [...new Set((args.evidence ?? []).filter(Boolean))].slice(0, 12),
  });
}

function dedupeEvidence(values: Array<string | null | undefined>, limit: number = 12) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))]
    .slice(0, limit);
}

type QaVerificationOutcomeStatus = "passed" | "failed" | "required";

function resolveQaVerificationTaskRecord(args: {
  remediationTasks: NonNullable<TaskHandlerContext["state"]["incidentLedger"][number]["remediationTasks"]>;
  taskId: string;
  runId: string | null;
}) {
  const { remediationTasks, taskId, runId } = args;
  return remediationTasks
    .slice()
    .sort((left, right) => {
      const leftScore =
        (left.taskId === taskId ? 100 : 0) +
        (runId && left.runId === runId ? 50 : 0) +
        (left.lane === "verification" ? 20 : 0) +
        (left.taskType === "qa-verification" ? 10 : 0);
      const rightScore =
        (right.taskId === taskId ? 100 : 0) +
        (runId && right.runId === runId ? 50 : 0) +
        (right.lane === "verification" ? 20 : 0) +
        (right.taskType === "qa-verification" ? 10 : 0);
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    })[0] ?? null;
}

export function applyQaVerificationOutcome(args: {
  state: TaskHandlerContext["state"];
  incidentId: string | null;
  repairIds: string[];
  taskId: string;
  runId: string | null;
  status: QaVerificationOutcomeStatus;
  summary: string;
  generatedAt: string;
  allowClosure: boolean;
  closureDecision: string | null;
  evidence: string[];
}) {
  const {
    state,
    incidentId,
    repairIds,
    taskId,
    runId,
    status,
    summary,
    generatedAt,
    allowClosure,
    closureDecision,
    evidence,
  } = args;

  const dedupedEvidence = dedupeEvidence([
    ...evidence,
    closureDecision ? `closure-decision:${closureDecision}` : null,
    `verification-status:${status}`,
  ]);
  const incident =
    incidentId !== null
      ? state.incidentLedger.find((record) => record.incidentId === incidentId) ?? null
      : null;

  if (incident) {
    incident.verification = {
      required: true,
      agentId: "qa-verification-agent",
      status:
        status === "passed"
          ? "passed"
          : status === "failed"
            ? "failed"
            : "pending",
      summary,
      verificationTaskId: taskId,
      verificationRunId: runId,
      verifiedAt: status === "passed" ? generatedAt : null,
    };

    const verificationTask = resolveQaVerificationTaskRecord({
      remediationTasks: incident.remediationTasks ?? [],
      taskId,
      runId,
    });
    if (verificationTask) {
      verificationTask.verificationCompletedAt = generatedAt;
      verificationTask.lastUpdatedAt = generatedAt;
      verificationTask.verificationSummary = summary;
      verificationTask.blockers =
        status === "passed"
          ? []
          : dedupeEvidence([
              summary,
              ...dedupedEvidence,
            ], 8);

      if (status === "passed") {
        verificationTask.status = allowClosure ? "resolved" : "verified";
        verificationTask.verifiedAt = generatedAt;
        verificationTask.resolvedAt = allowClosure ? generatedAt : verificationTask.resolvedAt;
        verificationTask.resolutionSummary = allowClosure
          ? summary
          : verificationTask.resolutionSummary;
      } else if (status === "failed") {
        verificationTask.status = "failed";
        verificationTask.resolvedAt = null;
        verificationTask.resolutionSummary = null;
      } else {
        verificationTask.status = "blocked";
        verificationTask.resolvedAt = null;
        verificationTask.resolutionSummary = null;
      }
    }

    if (status === "passed" && allowClosure) {
      incident.status = "resolved";
      incident.resolvedAt = generatedAt;
      incident.remediation.status = "resolved";
      incident.remediation.summary = summary;
      incident.remediation.nextAction = "Keep watching runtime truth for recurrence.";
      incident.remediation.blockers = [];
    } else {
      if (incident.status === "resolved") {
        incident.status = "active";
        incident.resolvedAt = null;
      }
      incident.remediation.status = status === "failed" ? "blocked" : "watching";
      incident.remediation.summary = summary;
      incident.remediation.nextAction =
        status === "failed"
          ? "Follow the verifier evidence, remediate the failure, and rerun qa-verification."
          : "Collect stronger runtime evidence and rerun qa-verification before closure.";
      incident.remediation.blockers =
        status === "passed"
          ? []
          : dedupeEvidence([
              summary,
              ...incident.recommendedSteps,
              ...dedupedEvidence,
            ], 8);
    }

    incident.lastSeenAt = generatedAt;
    incident.linkedTaskIds = dedupeEvidence([...incident.linkedTaskIds, taskId], 24);
    incident.linkedRunIds = dedupeEvidence([...incident.linkedRunIds, runId], 24);
    incident.linkedRepairIds = dedupeEvidence([...incident.linkedRepairIds, ...repairIds], 24);
    incident.evidence = dedupeEvidence([...incident.evidence, ...dedupedEvidence], 16);
  }

  for (const repairId of repairIds) {
    updateRepairRecord(state, repairId, (record) => ({
      ...record,
      status:
        status === "passed"
          ? "verified"
          : status === "failed"
            ? "failed"
            : record.status,
      verifiedAt: status === "passed" ? generatedAt : record.verifiedAt,
      verificationSummary: summary,
      evidence: dedupeEvidence([...(record.evidence ?? []), ...dedupedEvidence], 12),
      lastError: status === "failed" ? summary : record.lastError,
    }));
  }

  return {
    incidentStatus: incident?.status ?? null,
    verificationStatus: incident?.verification.status ?? null,
    resolvedIncident: Boolean(incident && status === "passed" && allowClosure),
    reopenedIncident: Boolean(incident && incident.status === "active" && status !== "passed"),
    updatedRepairs: repairIds.length,
  };
}

function observeSpawnedAgentResult(args: {
  context: TaskHandlerContext;
  task: Task;
  sourceAgentId: string;
  result: Record<string, unknown>;
}) {
  const { context, task, sourceAgentId, result } = args;

  const relationships = Array.isArray(result.relationships)
    ? result.relationships.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(
            entry &&
              typeof entry === "object" &&
              typeof entry.from === "string" &&
              typeof entry.to === "string" &&
              typeof entry.relationship === "string",
          ),
      )
    : [];

  for (const relationship of relationships) {
    observeRuntimeRelationship({
      context,
      task,
      from: String(relationship.from),
      to: String(relationship.to),
      relationship: relationship.relationship as RelationshipObservationType,
      detail:
        typeof relationship.detail === "string"
          ? relationship.detail
          : `${relationship.from} ${relationship.relationship} ${relationship.to}`,
      source: sourceAgentId,
      evidence: Array.isArray(relationship.evidence)
        ? relationship.evidence.map(String)
        : [],
      targetTaskId:
        typeof relationship.targetTaskId === "string"
          ? relationship.targetTaskId
          : null,
      targetRunId:
        typeof relationship.targetRunId === "string"
          ? relationship.targetRunId
          : null,
      toolId:
        typeof relationship.toolId === "string" ? relationship.toolId : null,
      proofTransport:
        relationship.proofTransport === "milestone" ||
        relationship.proofTransport === "demandSummary"
          ? relationship.proofTransport
          : null,
      classification:
        typeof relationship.classification === "string"
          ? relationship.classification
          : null,
    });
  }

  const derivedRelationshipKeys = new Set<string>();
  const handoffPackages = [
    ...(Array.isArray(result.handoffPackages)
      ? result.handoffPackages.filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry && typeof entry === "object"),
        )
      : []),
    ...((result.handoffPackage && typeof result.handoffPackage === "object")
      ? [result.handoffPackage as Record<string, unknown>]
      : []),
  ];

  for (const handoff of handoffPackages) {
    const targetAgentId =
      typeof handoff.targetAgentId === "string" && handoff.targetAgentId.length > 0
        ? handoff.targetAgentId
        : null;
    if (!targetAgentId) continue;
    const payloadType =
      typeof handoff.payloadType === "string" && handoff.payloadType.length > 0
        ? handoff.payloadType
        : "handoff";
    const key = `${targetAgentId}:${payloadType}`;
    if (derivedRelationshipKeys.has(key)) continue;
    derivedRelationshipKeys.add(key);

    observeRuntimeRelationship({
      context,
      task,
      from: `agent:${sourceAgentId}`,
      to: `agent:${targetAgentId}`,
      relationship: "feeds-agent",
      detail:
        typeof handoff.reason === "string" && handoff.reason.length > 0
          ? handoff.reason
          : `${sourceAgentId} prepared ${payloadType} for ${targetAgentId}.`,
      source: sourceAgentId,
      evidence: [
        `payload:${payloadType}`,
        ...(Array.isArray(handoff.evidenceAnchors)
          ? handoff.evidenceAnchors.slice(0, 4).map((anchor) => `anchor:${String(anchor)}`)
          : []),
      ],
      classification: "handoff-package",
    });
  }

  const communityHandoffs =
    result.communitySignalRouting &&
    typeof result.communitySignalRouting === "object" &&
    Array.isArray((result.communitySignalRouting as Record<string, unknown>).handoffs)
      ? ((result.communitySignalRouting as Record<string, unknown>).handoffs as Array<Record<string, unknown>>)
      : [];
  for (const handoff of communityHandoffs) {
    const targetAgentId =
      typeof handoff.targetAgentId === "string" && handoff.targetAgentId.length > 0
        ? handoff.targetAgentId
        : null;
    if (!targetAgentId) continue;
    const surface =
      typeof handoff.surface === "string" && handoff.surface.length > 0
        ? handoff.surface
        : "unknown";
    const key = `${targetAgentId}:community:${surface}`;
    if (derivedRelationshipKeys.has(key)) continue;
    derivedRelationshipKeys.add(key);

    observeRuntimeRelationship({
      context,
      task,
      from: `agent:${sourceAgentId}`,
      to: `agent:${targetAgentId}`,
      relationship: "feeds-agent",
      detail:
        typeof handoff.reason === "string" && handoff.reason.length > 0
          ? handoff.reason
          : `${sourceAgentId} routed ${surface} follow-through to ${targetAgentId}.`,
      source: sourceAgentId,
      evidence: [`surface:${surface}`],
      classification: "community-routing",
    });
  }

  const toolInvocations = Array.isArray(result.toolInvocations)
    ? result.toolInvocations.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(
            entry &&
              typeof entry === "object" &&
              typeof entry.toolId === "string",
          ),
      )
    : [];

  for (const invocation of toolInvocations) {
    observeRuntimeRelationship({
      context,
      task,
      from: `agent:${sourceAgentId}`,
      to: `tool:${String(invocation.toolId)}`,
      relationship: "invokes-tool",
      detail:
        typeof invocation.detail === "string"
          ? invocation.detail
          : `${sourceAgentId} invoked ${String(invocation.toolId)}.`,
      source: sourceAgentId,
      evidence: Array.isArray(invocation.evidence)
        ? invocation.evidence.map(String)
        : [],
      toolId: String(invocation.toolId),
      classification:
        typeof invocation.classification === "string"
          ? invocation.classification
          : null,
    });
  }

  const proofTransitions = Array.isArray(result.proofTransitions)
    ? result.proofTransitions.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(
            entry &&
              typeof entry === "object" &&
              typeof entry.transport === "string",
          ),
      )
    : [];

  for (const transition of proofTransitions) {
    const transport =
      transition.transport === "milestone" || transition.transport === "demandSummary"
        ? transition.transport
        : null;
    if (!transport) continue;
    observeRuntimeRelationship({
      context,
      task,
      from: `agent:${sourceAgentId}`,
      to: `surface:proof:${transport}`,
      relationship: "transitions-proof",
      detail:
        typeof transition.detail === "string"
          ? transition.detail
          : `${sourceAgentId} transitioned ${transport} proof state.`,
      source: sourceAgentId,
      evidence: Array.isArray(transition.evidence)
        ? transition.evidence.map(String)
        : [],
      proofTransport: transport,
      classification:
        typeof transition.classification === "string"
          ? transition.classification
          : null,
    });
  }
}

function toResultRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function toResultRecordArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((entry) => toResultRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
}

function toResultStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function appendIntegrationWorkflowEvidence(args: {
  context: TaskHandlerContext;
  task: Task;
  result: Record<string, unknown>;
}) {
  const { context, task, result } = args;
  const appendEvent = context.appendTaskWorkflowEvent;
  if (!appendEvent) {
    return;
  }

  const delegationPlan = toResultRecordArray(result.delegationPlan);
  delegationPlan.forEach((decision, index) => {
    const step =
      typeof decision.step === "string" && decision.step.length > 0
        ? decision.step
        : `step-${index + 1}`;
    const requestedAgent =
      typeof decision.requestedAgent === "string" && decision.requestedAgent.length > 0
        ? decision.requestedAgent
        : null;
    const selectedAgent =
      typeof decision.selectedAgent === "string" && decision.selectedAgent.length > 0
        ? decision.selectedAgent
        : null;
    const mode =
      decision.mode === "reroute" || decision.mode === "blocked"
        ? decision.mode
        : "primary";
    const blockers = toResultStringArray(decision.blockers);
    const decisionEvidence = toResultStringArray(decision.evidence);

    appendEvent(
      task,
      "agent",
      mode === "blocked" ? "blocked" : mode === "reroute" ? "rerouted" : "ready",
      selectedAgent
        ? mode === "reroute" && requestedAgent && requestedAgent !== selectedAgent
          ? `${step} rerouted from ${requestedAgent} to ${selectedAgent}.`
          : `${step} assigned to ${selectedAgent}.`
        : `${step} is blocked pending agent selection.`,
      {
        source: "integration-agent",
        nodeId: `integration:${step}:${selectedAgent ?? "unassigned"}`,
        relatedNodeIds: [
          `step:${step}`,
          ...(selectedAgent ? [`agent:${selectedAgent}`] : []),
          ...(requestedAgent && requestedAgent !== selectedAgent
            ? [`agent:${requestedAgent}`]
            : []),
        ],
        evidence: [
          `step:${step}`,
          `mode:${mode}`,
          ...(requestedAgent ? [`requested-agent:${requestedAgent}`] : []),
          ...(selectedAgent ? [`selected-agent:${selectedAgent}`] : []),
          ...decisionEvidence.slice(0, 8),
          ...blockers.slice(0, 4).map((blocker) => `blocker:${blocker}`),
        ],
        stopCode: mode === "blocked" ? "agent-selection-blocked" : null,
        classification: "workflow-delegation",
      },
    );
  });

  const handoffPackages = toResultRecordArray(result.handoffPackages);
  handoffPackages.forEach((handoff, index) => {
    const targetAgentId =
      typeof handoff.targetAgentId === "string" && handoff.targetAgentId.length > 0
        ? handoff.targetAgentId
        : `unknown-target-${index + 1}`;
    const payloadType =
      typeof handoff.payloadType === "string" && handoff.payloadType.length > 0
        ? handoff.payloadType
        : "workflow-replay";
    const steps = toResultStringArray(handoff.steps);

    appendEvent(
      task,
      "result",
      "handoff-prepared",
      typeof handoff.reason === "string" && handoff.reason.length > 0
        ? handoff.reason
        : `Prepared ${payloadType} handoff for ${targetAgentId}.`,
      {
        source: "integration-agent",
        nodeId: `handoff:${targetAgentId}:${payloadType}`,
        relatedNodeIds: [`agent:${targetAgentId}`],
        evidence: [
          `target-agent:${targetAgentId}`,
          `payload:${payloadType}`,
          ...steps.slice(0, 6).map((step) => `step:${step}`),
        ],
        classification: "workflow-handoff",
      },
    );
  });

  const replayContract = toResultRecord(result.replayContract);
  if (replayContract) {
    const replayFromStep =
      typeof replayContract.replayFromStep === "string" &&
      replayContract.replayFromStep.length > 0
        ? replayContract.replayFromStep
        : null;
    const blockedDependencies = toResultStringArray(replayContract.blockedDependencies);
    appendEvent(
      task,
      "result",
      replayFromStep ? "replay-ready" : "workflow-complete",
      replayFromStep
        ? `Replay contract resumes from ${replayFromStep}.`
        : "Replay contract confirms workflow completion.",
      {
        source: "integration-agent",
        nodeId: `replay:${task.id}`,
        relatedNodeIds: replayFromStep ? [`step:${replayFromStep}`] : undefined,
        evidence: [
          ...(replayFromStep ? [`resume-step:${replayFromStep}`] : []),
          ...blockedDependencies.slice(0, 6).map((dependency) => `blocked:${dependency}`),
        ],
        classification: "workflow-replay",
      },
    );
  }

  const recoveryPlan = toResultRecord(result.recoveryPlan);
  const workflowWatch = toResultRecord(recoveryPlan?.["workflowWatch"]);
  const stopCauseRecord: Record<string, unknown> | null =
    toResultRecord(result.stopCause) ??
    toResultRecord(workflowWatch?.["currentStop"]);
  if (stopCauseRecord) {
    const stopStep =
      typeof stopCauseRecord["step"] === "string" && stopCauseRecord["step"].length > 0
        ? stopCauseRecord["step"]
        : "unknown-step";
    const classification =
      typeof stopCauseRecord["classification"] === "string" &&
      stopCauseRecord["classification"].length > 0
        ? stopCauseRecord["classification"]
        : "workflow-stop";
    const blockers = toResultStringArray(stopCauseRecord["blockers"]);

    appendEvent(
      task,
      "agent",
      "blocked",
      typeof stopCauseRecord["suggestedNextAction"] === "string" &&
      stopCauseRecord["suggestedNextAction"].length > 0
        ? `Workflow blocked at ${stopStep}. ${stopCauseRecord["suggestedNextAction"]}`
        : `Workflow blocked at ${stopStep}.`,
      {
        source: "integration-agent",
        nodeId: `stop:${stopStep}`,
        relatedNodeIds: [`step:${stopStep}`],
        evidence: blockers.slice(0, 8).map((blocker) => `blocker:${blocker}`),
        stopCode: classification,
        classification: "workflow-stop",
      },
    );
  }
}

function taskRunId(task: Task) {
  return task.idempotencyKey ?? task.id;
}

export function buildAllowlistedChildEnv(
  extraEnv: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const orchestratorNodeModules = join(process.cwd(), "node_modules");
  const env: NodeJS.ProcessEnv = {
    ALLOW_ORCHESTRATOR_TASK_RUN: "true",
    NODE_PATH: process.env.NODE_PATH
      ? `${orchestratorNodeModules}${delimiter}${process.env.NODE_PATH}`
      : orchestratorNodeModules,
  };

  for (const key of CHILD_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(extraEnv)) {
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  }

  return env;
}

let qaVerificationExecutionDepth = 0;
let qaVerificationExecutionTail: Promise<void> = Promise.resolve();

async function runSerializedQaVerification<T>(
  logger: Console,
  fn: () => Promise<T>,
): Promise<T> {
  const waitFor = qaVerificationExecutionTail.catch(() => undefined);
  const contended = qaVerificationExecutionDepth > 0;
  qaVerificationExecutionDepth += 1;

  let release!: () => void;
  qaVerificationExecutionTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  if (contended) {
    logger.log(
      "[qa-verification] waiting for the active bounded verifier lane to clear before starting another execute run.",
    );
  }

  await waitFor;

  try {
    return await fn();
  } finally {
    qaVerificationExecutionDepth = Math.max(qaVerificationExecutionDepth - 1, 0);
    release();
  }
}

function queueDepthNextAction(queueTotal: number) {
  if (queueTotal <= 0) {
    return "Queue is clear. Watch for the next high-intent lead.";
  }

  if (queueTotal === 1) {
    return "Route the next queued lead through reddit-response.";
  }

  return `Route the next ${queueTotal} queued leads through reddit-response.`;
}

function rememberRssId(context: TaskHandlerContext, id: string) {
  if (context.state.rssSeenIds.includes(id)) return;
  context.state.rssSeenIds.unshift(id);
  if (context.state.rssSeenIds.length > RSS_SEEN_CAP) {
    context.state.rssSeenIds.length = RSS_SEEN_CAP;
  }
}

async function runDocSpecialistJob(
  docPaths: string[],
  targetAgents: string[],
  requestedBy: string,
  logger: Console,
) {
  const agentRoot = join(process.cwd(), "..", "agents", "doc-specialist");
  const tmpRoot = await mkdtemp(join(tmpdir(), "docspec-"));
  const payloadPath = join(tmpRoot, "payload.json");
  const resultPath = join(tmpRoot, "result.json");
  const payload = {
    id: randomUUID(),
    type: "drift-repair",
    docPaths,
    targetAgents,
    requestedBy,
  };
  const startedAt = new Date().toISOString();
  await writeFile(payloadPath, JSON.stringify(payload, null, 2), "utf-8");

  try {
    await new Promise<void>((resolve, reject) => {
      const tsxPath = join(
        process.cwd(),
        "node_modules",
        "tsx",
        "dist",
        "cli.mjs",
      );
      const child = spawn(
        process.execPath,
        [tsxPath, "src/index.ts", payloadPath],
        {
          cwd: agentRoot,
          env: buildAllowlistedChildEnv({
            DOC_SPECIALIST_RESULT_FILE: resultPath,
          }),
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 5 * 60 * 1000, // 5 minutes
        },
      );

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.stdout.on("data", (chunk) => {
        logger.log(`[doc-specialist] ${chunk.toString().trim()}`);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              stderr.trim() || `doc-specialist exited with code ${code}`,
            ),
          );
        }
      });
    });

    const raw = await readFile(resultPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      packPath: string;
      packId: string;
      docsProcessed: number;
    };
    await persistSpawnedAgentServiceState(
      "doc-specialist",
      payload,
      "success",
      parsed,
      undefined,
      startedAt,
    );
    return parsed;
  } catch (error) {
    await persistSpawnedAgentServiceState(
      "doc-specialist",
      payload,
      "error",
      undefined,
      toErrorMessage(error),
      startedAt,
    );
    throw error;
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

async function findLatestKnowledgePack(dir?: string) {
  const targetDir = dir ?? join(process.cwd(), "..", "logs", "knowledge-packs");
  try {
    const files = await readdir(targetDir);
    const packFiles = files.filter((file) => file.endsWith(".json"));
    if (!packFiles.length) return null;
    const sorted = await Promise.all(
      packFiles.map(async (file) => {
        const fullPath = join(targetDir, file);
        const stats = await stat(fullPath);
        return { path: fullPath, mtime: stats.mtimeMs };
      }),
    );
    sorted.sort((a, b) => b.mtime - a.mtime);
    const latest = sorted[0];
    const raw = await readFile(latest.path, "utf-8");
    const parsed = JSON.parse(raw);
    return { path: latest.path, pack: parsed };
  } catch (error) {
    return null;
  }
}

async function runRedditHelperJob(
  payload: Record<string, unknown>,
  logger: Console,
) {
  const agentRoot = join(process.cwd(), "..", "agents", "reddit-helper");
  const tmpRoot = await mkdtemp(join(tmpdir(), "reddithelper-"));
  const payloadPath = join(tmpRoot, "payload.json");
  const resultPath = join(tmpRoot, "result.json");
  const enrichedPayload: Record<string, unknown> = {
    type: "reddit-response",
    ...payload,
  };
  const startedAt = new Date().toISOString();
  await writeFile(
    payloadPath,
    JSON.stringify(enrichedPayload, null, 2),
    "utf-8",
  );

  try {
    await new Promise<void>((resolve, reject) => {
      const tsxPath = join(
        process.cwd(),
        "node_modules",
        "tsx",
        "dist",
        "cli.mjs",
      );
      const child = spawn(
        process.execPath,
        [tsxPath, "src/index.ts", payloadPath],
        {
          cwd: agentRoot,
          env: buildAllowlistedChildEnv({
            REDDIT_HELPER_RESULT_FILE: resultPath,
          }),
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 5 * 60 * 1000, // 5 minutes
        },
      );

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.stdout.on("data", (chunk) => {
        logger.log(`[reddit-helper] ${chunk.toString().trim()}`);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              stderr.trim() || `reddit-helper exited with code ${code}`,
            ),
          );
        }
      });
    });

    const raw = await readFile(resultPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      replyText: string;
      confidence: number;
      ctaVariant?: string;
      devvitPayloadPath?: string;
      packId?: string;
      packPath?: string;
    };
    await persistSpawnedAgentServiceState(
      "reddit-helper",
      enrichedPayload,
      "success",
      parsed,
      undefined,
      startedAt,
    );
    return parsed;
  } catch (error) {
    await persistSpawnedAgentServiceState(
      "reddit-helper",
      enrichedPayload,
      "error",
      undefined,
      toErrorMessage(error),
      startedAt,
    );
    throw error;
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

async function runSpawnedAgentJob(
  agentId: string,
  payload: Record<string, unknown>,
  resultEnvVar: string,
  logger: Console,
) {
  const agentRoot = join(process.cwd(), "..", "agents", agentId);
  const tmpRoot = await mkdtemp(join(tmpdir(), `${agentId}-`));
  const payloadPath = join(tmpRoot, "payload.json");
  const resultPath = join(tmpRoot, "result.json");
  const startedAt = new Date().toISOString();
  await writeFile(payloadPath, JSON.stringify(payload, null, 2), "utf-8");

  try {
    await new Promise<void>((resolve, reject) => {
      const tsxPath = join(
        process.cwd(),
        "node_modules",
        "tsx",
        "dist",
        "cli.mjs",
      );
      const child = spawn(
        process.execPath,
        [tsxPath, "src/index.ts", payloadPath],
        {
          cwd: agentRoot,
          env: buildAllowlistedChildEnv({
            [resultEnvVar]: resultPath,
          }),
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 5 * 60 * 1000,
        },
      );

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.stdout.on("data", (chunk) => {
        logger.log(`[${agentId}] ${chunk.toString().trim()}`);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(stderr.trim() || `${agentId} exited with code ${code}`),
          );
        }
      });
    });

    const raw = await readFile(resultPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const parsedSuccess = parsed.success === true;
    const persistedStatus: "success" | "error" =
      parsed.success === false ? "error" : "success";
    await persistSpawnedAgentServiceState(
      agentId,
      payload,
      persistedStatus,
      parsed,
      parsedSuccess ? undefined : summarizeSpawnedAgentFailure(parsed),
      startedAt,
    );
    return parsed;
  } catch (error) {
    const reportedResult = await tryReadSpawnedAgentResult(resultPath);
    const failureMessage =
      reportedResult && reportedResult.success !== true
        ? `${agentId} reported unsuccessful result: ${summarizeSpawnedAgentFailure(reportedResult)}`
        : toErrorMessage(error);
    await persistSpawnedAgentServiceState(
      agentId,
      payload,
      "error",
      undefined,
      failureMessage,
      startedAt,
    );
    throw new Error(failureMessage);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

type SpawnedAgentMemoryConfig = {
  orchestratorStatePath?: string;
  serviceStatePath?: string;
};

async function loadSpawnedAgentMemoryConfig(
  agentId: string,
): Promise<SpawnedAgentMemoryConfig> {
  const configPath = join(
    process.cwd(),
    "..",
    "agents",
    agentId,
    "agent.config.json",
  );
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as SpawnedAgentMemoryConfig;
    return parsed;
  } catch {
    return {};
  }
}

async function persistSpawnedAgentServiceState(
  agentId: string,
  payload: Record<string, unknown>,
  status: "success" | "error",
  result?: Record<string, unknown>,
  errorMessage?: string,
  startedAt?: string,
) {
  const config = await loadSpawnedAgentMemoryConfig(agentId);
  if (!config.serviceStatePath) return;

  const serviceStatePath = join(
    process.cwd(),
    "..",
    "agents",
    agentId,
    config.serviceStatePath,
  );
  let existing: Record<string, unknown> = {};
  try {
    const current = await readFile(serviceStatePath, "utf-8");
    existing = JSON.parse(current) as Record<string, unknown>;
  } catch {
    existing = {};
  }

  const completedAt = new Date().toISOString();
  const runStartedAt = startedAt ?? completedAt;
  const durationMs = Math.max(
    0,
    new Date(completedAt).getTime() - new Date(runStartedAt).getTime(),
  );

  const timeline = Array.isArray(existing.taskTimeline)
    ? (existing.taskTimeline as Array<Record<string, unknown>>)
    : [];

  const normalizedResult =
    status === "success" && result
      ? normalizeTaskExecutionSummaryResult({
          agentId,
          taskType:
            typeof payload.type === "string" ? String(payload.type) : null,
          result,
        })
      : result;
  const extractedAccounting =
    status === "success" && normalizedResult
      ? extractTaskExecutionAccounting(normalizedResult)
      : null;

  const timelineEntry: Record<string, unknown> = {
    taskId: typeof payload.id === "string" ? payload.id : null,
    taskType: typeof payload.type === "string" ? payload.type : null,
    status,
    startedAt: runStartedAt,
    completedAt,
    durationMs,
    error: status === "error" ? (errorMessage ?? null) : null,
    resultSummary:
      status === "success"
        ? buildTaskExecutionResultSummary(normalizedResult ?? {})
        : undefined,
    accounting: extractedAccounting ?? undefined,
  };

  const nextTimeline = [timelineEntry, ...timeline].slice(
    0,
    AGENT_MEMORY_TIMELINE_LIMIT,
  );
  const successCount =
    Number(existing.successCount ?? 0) + (status === "success" ? 1 : 0);
  const errorCount =
    Number(existing.errorCount ?? 0) + (status === "error" ? 1 : 0);

  const nextState: Record<string, unknown> = {
    ...existing,
    memoryVersion: 2,
    runtimeProofVersion: 1,
    agentId,
    orchestratorStatePath: config.orchestratorStatePath,
    lastRunAt: completedAt,
    lastStatus: status,
    lastTaskId: typeof payload.id === "string" ? payload.id : null,
    lastTaskType: typeof payload.type === "string" ? payload.type : null,
    lastError: status === "error" ? (errorMessage ?? null) : null,
    successCount,
    errorCount,
    totalRuns: successCount + errorCount,
    taskTimeline: nextTimeline,
    taskPath: {
      taskType: typeof payload.type === "string" ? payload.type : null,
      lastObservedAt: completedAt,
      lastObservedStatus: status === "success" ? "success" : "failed",
      lastSuccessfulAt:
        status === "success"
          ? completedAt
          : typeof (existing.taskPath as Record<string, unknown> | undefined)?.lastSuccessfulAt === "string"
            ? ((existing.taskPath as Record<string, unknown>).lastSuccessfulAt as string)
            : null,
      totalRuns: successCount + errorCount,
      successfulRuns: successCount,
      failedRuns: errorCount,
      activeRuns: 0,
      lastError: status === "error" ? (errorMessage ?? null) : null,
    },
  };

  if (status === "success") {
    nextState.lastResultSummary = buildTaskExecutionResultSummary(
      normalizedResult ?? {},
    );
    if (extractedAccounting) {
      nextState.lastAccounting = extractedAccounting;
    }
  }

  await mkdir(dirname(serviceStatePath), { recursive: true });
  await writeFile(
    serviceStatePath,
    JSON.stringify(nextState, null, 2),
    "utf-8",
  );
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function throwTaskFailure(taskLabel: string, error: unknown): never {
  throw new Error(`${taskLabel} failed: ${toErrorMessage(error)}`);
}

function summarizeSpawnedAgentFailure(result: Record<string, unknown>) {
  if (typeof result.error === "string" && result.error.trim().length > 0) {
    return result.error.trim();
  }

  if (Array.isArray(result.warnings)) {
    const warnings = result.warnings
      .filter((warning): warning is string => typeof warning === "string")
      .map((warning) => warning.trim())
      .filter(Boolean);
    if (warnings.length > 0) {
      return warnings.join("; ");
    }
  }

  const metrics =
    typeof result.metrics === "object" && result.metrics !== null
      ? (result.metrics as Record<string, unknown>)
      : null;
  if (metrics && Array.isArray(metrics.alerts)) {
    const alerts = metrics.alerts
      .filter((alert): alert is string => typeof alert === "string")
      .map((alert) => alert.trim())
      .filter(Boolean);
    if (alerts.length > 0) {
      return alerts.join("; ");
    }
  }

  const summary =
    typeof result.summary === "object" && result.summary !== null
      ? (result.summary as Record<string, unknown>)
      : null;
  if (summary) {
    if (
      typeof summary.compliance === "string" &&
      summary.compliance.trim().length > 0
    ) {
      return `compliance ${summary.compliance.trim()}`;
    }
    if (typeof summary.total === "number") {
      return `${summary.total} findings reported`;
    }
  }

  return "agent returned unsuccessful result";
}

export function assertSpawnedAgentReportedSuccess(
  result: Record<string, unknown>,
  taskLabel: string,
) {
  if (result.success === true) return;
  throw new Error(
    `${taskLabel} agent reported unsuccessful result: ${summarizeSpawnedAgentFailure(result)}`,
  );
}

export function shouldSelectQueueItemForDraft(
  item: { tag?: string | null } | null | undefined,
) {
  return item?.tag === "priority";
}

export function consumeNextSelectedQueueItem(redditQueue: RedditQueueItem[]) {
  const queueIndex = redditQueue.findIndex(
    (item) => item.selectedForDraft === true,
  );
  if (queueIndex === -1) {
    return null;
  }

  const [selected] = redditQueue.splice(queueIndex, 1);
  return selected ?? null;
}

export function buildRedditQueueItemFromPayload(
  payloadQueue: Record<string, unknown>,
  queuedAt: string,
): RedditQueueItem {
  return {
    id: String(payloadQueue.id ?? randomUUID()),
    subreddit: String(payloadQueue.subreddit ?? "r/OpenClaw"),
    question: String(
      payloadQueue.question ?? "General OpenClaw workflow question",
    ),
    link: payloadQueue.link ? String(payloadQueue.link) : undefined,
    queuedAt,
    selectedForDraft: payloadQueue.selectedForDraft === true,
    tag: typeof payloadQueue.tag === "string" ? payloadQueue.tag : undefined,
    pillar:
      typeof payloadQueue.pillar === "string" ? payloadQueue.pillar : undefined,
    feedId:
      typeof payloadQueue.feedId === "string" ? payloadQueue.feedId : undefined,
    entryContent:
      typeof payloadQueue.entryContent === "string"
        ? payloadQueue.entryContent
        : undefined,
    author:
      typeof payloadQueue.author === "string" ? payloadQueue.author : undefined,
    ctaVariant:
      typeof payloadQueue.ctaVariant === "string"
        ? payloadQueue.ctaVariant
        : undefined,
    matchedKeywords: Array.isArray(payloadQueue.matchedKeywords)
      ? payloadQueue.matchedKeywords.map((item) => String(item))
      : undefined,
    score:
      typeof payloadQueue.score === "number" && Number.isFinite(payloadQueue.score)
        ? payloadQueue.score
        : undefined,
    draftRecordId: payloadQueue.draftRecordId
      ? String(payloadQueue.draftRecordId)
      : undefined,
    suggestedReply:
      typeof payloadQueue.suggestedReply === "string"
        ? payloadQueue.suggestedReply
        : undefined,
  };
}

export function resolveRedditResponseQueueItem(
  redditQueue: RedditQueueItem[],
  payloadQueue: unknown,
  queuedAt: string,
) {
  if (payloadQueue && typeof payloadQueue === "object") {
    return buildRedditQueueItemFromPayload(
      payloadQueue as Record<string, unknown>,
      queuedAt,
    );
  }

  return consumeNextSelectedQueueItem(redditQueue);
}

export function buildManualReviewApprovalTaskId(queueItemId: string) {
  return `${REDDIT_MANUAL_REVIEW_APPROVAL_PREFIX}:${queueItemId}`;
}

export function buildDraftReviewApprovalTaskId(queueItemId: string) {
  return `${REDDIT_DRAFT_REVIEW_APPROVAL_PREFIX}:${queueItemId}`;
}

function isManualReviewQueueItem(
  item: RedditQueueItem | null | undefined,
): item is RedditQueueItem & { tag: "manual-review" } {
  return item?.tag === "manual-review" && typeof item.id === "string";
}

function isDraftQueueItem(
  item: RedditQueueItem | null | undefined,
): item is RedditQueueItem & { tag: "draft" } {
  return item?.tag === "draft" && typeof item.id === "string";
}

function buildManualReviewReplayPayload(queueItem: RedditQueueItem) {
  return {
    queue: {
      ...queueItem,
      selectedForDraft: true,
      reviewSource: "manual-review" as const,
    },
    responder: "reddit-helper",
    reviewSource: "manual-review" as const,
  };
}

function buildDraftReviewReplayPayload(queueItem: RedditQueueItem) {
  return {
    queue: {
      ...queueItem,
      selectedForDraft: true,
      reviewSource: "draft-review" as const,
    },
    responder: "reddit-helper",
    reviewSource: "draft-review" as const,
  };
}

export function ensureManualReviewApprovalRecord(
  approvals: ApprovalRecord[],
  queueItem: RedditQueueItem,
  requestedAt: string,
) {
  if (!isManualReviewQueueItem(queueItem)) {
    return false;
  }

  const taskId = buildManualReviewApprovalTaskId(queueItem.id);
  if (approvals.some((approval) => approval.taskId === taskId)) {
    return false;
  }

  approvals.push({
    taskId,
    type: "reddit-response",
    payload: buildManualReviewReplayPayload(queueItem),
    requestedAt,
    status: "pending",
    note: "Manual-review RSS lead requires explicit operator approval before reddit-response drafting.",
  });
  return true;
}

export function ensureDraftReviewApprovalRecord(
  approvals: ApprovalRecord[],
  queueItem: RedditQueueItem,
  requestedAt: string,
) {
  if (!isDraftQueueItem(queueItem)) {
    return false;
  }

  const taskId = buildDraftReviewApprovalTaskId(queueItem.id);
  if (approvals.some((approval) => approval.taskId === taskId)) {
    return false;
  }

  approvals.push({
    taskId,
    type: "reddit-response",
    payload: buildDraftReviewReplayPayload(queueItem),
    requestedAt,
    status: "pending",
    note: "Draft-tagged RSS lead is queued for optional operator promotion before reddit-response drafting.",
  });
  return true;
}

export function consumeReviewQueueItemForApprovalDecision(
  redditQueue: RedditQueueItem[],
  approval: ApprovalRecord,
) {
  if (approval.type !== "reddit-response") {
    return null;
  }

  const payloadQueue = approval.payload?.queue;
  if (
    !payloadQueue ||
    typeof payloadQueue !== "object" ||
    !["manual-review", "draft-review"].includes(
      String((payloadQueue as { reviewSource?: unknown }).reviewSource ?? ""),
    )
  ) {
    return null;
  }

  const queueId = (payloadQueue as { id?: unknown }).id;
  if (typeof queueId !== "string" || queueId.trim().length === 0) {
    return null;
  }

  const queueIndex = redditQueue.findIndex((item) => item.id === queueId);
  if (queueIndex === -1) {
    return null;
  }

  const [removed] = redditQueue.splice(queueIndex, 1);
  return removed ?? null;
}

async function tryReadSpawnedAgentResult(resultPath: string) {
  try {
    const raw = await readFile(resultPath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function assertToolGatePermission(
  task: Task,
  context: TaskHandlerContext,
  taskType: AllowedTaskType,
) {
  const requirement = SPAWNED_AGENT_PERMISSION_REQUIREMENTS[taskType];
  if (!requirement) return;

  const gate = await getToolGate();
  const taskAuthorization = gate.canExecuteTask(requirement.agentId, taskType);
  if (!taskAuthorization.allowed) {
    throw new Error(
      `toolgate denied task ${taskType}: ${taskAuthorization.reason}`,
    );
  }

  const permissionResult = await gate.preflightSkillAccess(
    requirement.agentId,
    requirement.skillId,
    {
      mode: "preflight",
      taskType,
    },
  );

  if (!permissionResult.success) {
    throw new Error(
      `toolgate denied ${requirement.agentId} for skill ${requirement.skillId}: ${permissionResult.error}`,
    );
  }

  observeRuntimeRelationship({
    context,
    task,
    from: `agent:${requirement.agentId}`,
    to: `skill:${requirement.skillId}`,
    relationship: "uses-skill",
    detail: `${requirement.agentId} preflighted ${requirement.skillId} for ${taskType}.`,
    source: "toolgate",
    evidence: [taskType, requirement.skillId],
  });
}

function parseRssEntries(xml: string) {
  const entries: Array<{
    id: string;
    title: string;
    content: string;
    link: string;
    author?: string;
  }> = [];
  const itemRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const idMatch = block.match(/<id>([\s\S]*?)<\/id>/i);
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
    const contentMatch = block.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
    const linkMatch = block.match(/<link[^>]*href="([^"]+)"/i);
    const authorMatch = block.match(
      /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i,
    );

    const id = idMatch ? stripHtml(idMatch[1]) : randomUUID();
    const title = titleMatch ? stripHtml(titleMatch[1]) : "";
    const content = contentMatch ? stripHtml(contentMatch[1]) : "";
    const link = linkMatch ? linkMatch[1] : "";
    const author = authorMatch ? stripHtml(authorMatch[1]) : undefined;

    if (!title && !content) continue;
    entries.push({ id, title, content, link, author });
  }
  return entries;
}

function buildScore(text: string, clusterKeywords: Record<string, string[]>) {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  const breakdown: Record<string, number> = {};

  Object.entries(clusterKeywords).forEach(([cluster, keywords]) => {
    let count = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        matched.push(keyword);
        count += 1;
      }
    }
    if (count > 0) {
      breakdown[cluster] = count;
    }
  });

  return { matched, breakdown };
}

async function appendDraft(path: string, record: RssDraftRecord) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf-8");
}

const startupHandler: TaskHandler = async (task, context) => {
  const startedAt = new Date().toISOString();
  context.state.lastStartedAt = startedAt;
  queueMaintenanceCheck({
    context,
    spec: MAINTENANCE_CHECK_SPECS.find((spec) => spec.id === "qa-readiness")!,
    now: startedAt,
    summary:
      "Queued by orchestrator startup so QA readiness is proven before the next longer maintenance cadence window.",
    actor: "startup",
  });
  await context.saveState();

  return "orchestrator boot complete; queued startup QA readiness maintenance";
};

const docChangeHandler: TaskHandler = async (task, context) => {
  const path = String(task.payload.path ?? "unknown");
  ensureDocChangeStored(path, context);
  let autoRepairTaskId: string | null = null;
  const pendingPaths = [...context.state.pendingDocChanges];
  const driftRepairActive = hasActiveTaskExecution("drift-repair", context);
  const autoRepairCoolingDown =
    pendingPaths.length >= DOC_DRIFT_REPAIR_THRESHOLD &&
    !driftRepairActive &&
    (await isDocRepairCooldownActive(pendingPaths));

  if (
    pendingPaths.length >= DOC_DRIFT_REPAIR_THRESHOLD &&
    !driftRepairActive &&
    !autoRepairCoolingDown
  ) {
    const detectedAt = new Date().toISOString();
    const affectedPaths = pendingPaths;
    const repairId = buildDocRepairRepairId(affectedPaths);
    const repairFingerprint = buildDocRepairFingerprint(affectedPaths);
    const lockOwner = `doc-change:${task.id}`;
    const repairLock = await claimDocRepairLock(affectedPaths, lockOwner);

    if (repairLock.acquired) {
      try {
        const repairTask = context.enqueueTask("drift-repair", {
          requestedBy: "auto-doc-drift-detector",
          paths: affectedPaths,
          targets: ["doc-specialist"],
          notes: `auto-enqueued from doc-change ${task.id}`,
          __repairId: repairId,
          idempotencyKey: repairId,
        });

        const record: RepairRecord = {
          repairId,
          classification: "doc-drift",
          trigger: "pending-doc-threshold",
          sourceTaskId: task.id,
          sourceTaskType: task.type,
          repairTaskType: "drift-repair",
          repairTaskId: repairTask.id,
          verificationMode: "knowledge-pack",
          status: "queued",
          detectedAt,
          queuedAt: detectedAt,
          affectedPaths,
          evidence: [
            `pending-doc-changes:${affectedPaths.length}`,
            `source-path:${path}`,
            `coordination-store:${repairLock.store}`,
            `repair-fingerprint:${repairFingerprint}`,
          ],
        };
        upsertRepairRecord(context.state, record);
        await markDocRepairCooldown(
          affectedPaths,
          {
            repairId,
            sourceTaskId: task.id,
            sourceTaskType: task.type,
            detectedAt,
            store: repairLock.store,
          },
          DOC_DRIFT_REPAIR_COOLDOWN_MS,
        );
        autoRepairTaskId = repairTask.id;
      } finally {
        await releaseDocRepairLock(affectedPaths, lockOwner);
      }
    }
  }

  await context.saveState();

  if (autoRepairTaskId) {
    return `queued ${context.state.pendingDocChanges.length} doc changes and auto-enqueued drift repair ${autoRepairTaskId}`;
  }

  if (context.state.pendingDocChanges.length >= DOC_DRIFT_REPAIR_THRESHOLD) {
    if (driftRepairActive) {
      return `queued ${context.state.pendingDocChanges.length} doc changes (drift repair already active)`;
    }
    if (autoRepairCoolingDown) {
      return `queued ${context.state.pendingDocChanges.length} doc changes (auto repair cooling down)`;
    }
    return `queued ${context.state.pendingDocChanges.length} doc changes`;
  }
  return `noted change for ${path}`;
};

const docSyncHandler: TaskHandler = async (_, context) => {
  const changes = [...context.state.pendingDocChanges];
  context.state.pendingDocChanges = [];
  await context.saveState();
  return changes.length
    ? `synced ${changes.length} doc changes`
    : "no doc changes to sync";
};

const driftRepairHandler: TaskHandler = async (task, context) => {
  const startedAt = Date.now();
  const startedAtIso = new Date().toISOString();
  const requestedBy = String(task.payload.requestedBy ?? "scheduler");
  const repairId =
    typeof task.payload.__repairId === "string" &&
    task.payload.__repairId.trim().length > 0
      ? task.payload.__repairId.trim()
      : `manual-drift:${task.id}`;
  const extractedPaths = context.state.pendingDocChanges.splice(0);
  const extraPaths = Array.isArray(task.payload.paths)
    ? (task.payload.paths as string[])
    : [];
  const processedPaths = extractedPaths.length ? extractedPaths : extraPaths;

  if (processedPaths.length === 0) {
    return "no drift to repair";
  }

  const existingRepair = context.state.repairRecords.find(
    (record) => record.repairId === repairId,
  );

  if (!existingRepair) {
    upsertRepairRecord(context.state, {
      repairId,
      classification: "doc-drift",
      trigger:
        typeof task.payload.__repairId === "string"
          ? "pending-doc-threshold"
          : "manual-drift-repair",
      sourceTaskId: task.id,
      sourceTaskType: task.type,
      repairTaskType: "drift-repair",
      repairTaskId: task.id,
      repairRunId: task.idempotencyKey,
      verificationMode: "knowledge-pack",
      status: "running",
      detectedAt: startedAtIso,
      queuedAt: startedAtIso,
      startedAt: startedAtIso,
      affectedPaths: processedPaths,
      evidence: [`requestedBy:${requestedBy}`],
    });
  } else {
    updateRepairRecord(context.state, repairId, (record) => ({
      ...record,
      status: "running",
      startedAt: startedAtIso,
      repairTaskId: record.repairTaskId ?? task.id,
      repairRunId: task.idempotencyKey ?? record.repairRunId,
    }));
  }

  let targets = Array.isArray(task.payload.targets)
    ? (task.payload.targets as string[])
    : ["doc-specialist", "reddit-helper"];

  if (!Array.isArray(task.payload.targets)) {
    try {
      const registry = await getAgentRegistry();
      const discovered = registry.listAgents().map((agent) => agent.id);
      if (discovered.length > 0) {
        targets = discovered;
      }
    } catch {
      // Keep fallback defaults if registry is unavailable
    }
  }

  let docSpecResult: {
    packPath: string;
    packId: string;
    docsProcessed: number;
    relationships?: Array<Record<string, unknown>>;
    toolInvocations?: Array<Record<string, unknown>>;
  } | null = null;
  try {
    docSpecResult = await runDocSpecialistJob(
      processedPaths,
      targets,
      requestedBy,
      context.logger,
    );
  } catch (error) {
    context.logger.warn(
      `[drift-repair] doc specialist failed: ${(error as Error).message}`,
    );
  }

  let verificationSummary = "doc-specialist did not produce a knowledge pack";
  let verificationEvidence: string[] = [];
  let verified = false;

  if (docSpecResult?.packPath) {
    try {
      const packStats = await stat(docSpecResult.packPath);
      verified =
        packStats.isFile() && Number(docSpecResult.docsProcessed ?? 0) > 0;
      verificationSummary = verified
        ? `knowledge pack verified (${docSpecResult.docsProcessed} docs at ${docSpecResult.packPath})`
        : `knowledge pack verification failed (${docSpecResult.docsProcessed ?? 0} docs at ${docSpecResult.packPath})`;
      verificationEvidence = [
        `pack:${docSpecResult.packPath}`,
        `docsProcessed:${docSpecResult.docsProcessed ?? 0}`,
      ];
    } catch (error) {
      verificationSummary = `knowledge pack verification failed: ${(error as Error).message}`;
    }
  }

  const record: DriftRepairRecord = {
    runId: randomUUID(),
    requestedBy,
    processedPaths,
    generatedPackIds: docSpecResult?.packId ? [docSpecResult.packId] : [],
    packPaths: docSpecResult?.packPath ? [docSpecResult.packPath] : undefined,
    docsProcessed: docSpecResult?.docsProcessed,
    updatedAgents: targets,
    durationMs: Date.now() - startedAt,
    completedAt: new Date().toISOString(),
    notes:
      [
        docSpecResult?.packPath ? `pack:${docSpecResult.packPath}` : null,
        task.payload.notes ? String(task.payload.notes) : null,
      ]
        .filter(Boolean)
        .join(" | ") || undefined,
  };

  context.state.driftRepairs.push(record);
  context.state.lastDriftRepairAt = record.completedAt;

  if (docSpecResult) {
    recordTaskExecutionResultSummary(
      context,
      task,
      docSpecResult as Record<string, unknown>,
    );
    observeSpawnedAgentResult({
      context,
      task,
      sourceAgentId: "doc-specialist",
      result: docSpecResult as Record<string, unknown>,
    });
    if (docSpecResult.packPath) {
      for (const targetAgent of targets) {
        observeRuntimeRelationship({
          context,
          task,
          from: "agent:doc-specialist",
          to: `agent:${targetAgent}`,
          relationship: "feeds-agent",
          detail: `doc-specialist refreshed knowledge for ${targetAgent} via ${docSpecResult.packId}.`,
          source: "doc-specialist",
          evidence: [docSpecResult.packId, docSpecResult.packPath],
        });
      }
    }
  }

  updateRepairRecord(context.state, repairId, (existing) => ({
    ...existing,
    status: verified ? "verified" : "failed",
    repairTaskId: task.id,
    repairRunId: task.idempotencyKey ?? existing.repairRunId,
    completedAt: record.completedAt,
    verifiedAt: verified ? record.completedAt : existing.verifiedAt,
    verificationSummary,
    evidence: [
      ...(existing.evidence ?? []),
      ...verificationEvidence,
    ].slice(-10),
    lastError: verified ? undefined : verificationSummary,
  }));

  await context.saveState();

  if (!verified) {
    throwTaskFailure("drift-repair", verificationSummary);
  }

  if (docSpecResult) {
    return `drift repair ${record.runId.slice(0, 8)} generated and verified ${docSpecResult.packId}`;
  }
  return `drift repair ${record.runId.slice(0, 8)} verified`;
};

const redditResponseHandler: TaskHandler = async (task, context) => {
  const now = new Date().toISOString();
  const queueItem = resolveRedditResponseQueueItem(
    context.state.redditQueue,
    task.payload.queue,
    now,
  );

  if (!queueItem) {
    await context.saveState();
    return "no selected reddit queue items";
  }

  const responder = String(task.payload.responder ?? "reddit-helper");
  const matchingDraft = context.state.rssDrafts.find(
    (draft) => draft.draftId === (queueItem?.draftRecordId ?? queueItem.id),
  );
  const latestPack = await findLatestKnowledgePack(
    context.config.knowledgePackDir,
  );

  let agentResult: {
    replyText: string;
    confidence: number;
    ctaVariant?: string;
    devvitPayloadPath?: string;
    packId?: string;
    packPath?: string;
  } | null = null;

  try {
    agentResult = await runRedditHelperJob(
      {
        queue: queueItem,
        rssDraft: matchingDraft,
        knowledgePackPath: latestPack?.path,
        knowledgePack: latestPack?.pack,
      },
      context.logger,
    );
  } catch (error) {
    context.logger.warn(
      `[reddit-response] helper failed: ${(error as Error).message}`,
    );
    throwTaskFailure("reddit response", error);
  }

  const draftedResponse =
    agentResult?.replyText ?? queueItem.suggestedReply ?? queueItem.question;
  if (agentResult) {
    recordTaskExecutionResultSummary(
      context,
      task,
      agentResult as Record<string, unknown>,
    );
    observeSpawnedAgentResult({
      context,
      task,
      sourceAgentId: "reddit-helper",
      result: agentResult as Record<string, unknown>,
    });
  }
  const confidence = agentResult?.confidence ?? 0.75;
  const status: "drafted" | "posted" = "drafted";

  const record: RedditReplyRecord = {
    queueId: queueItem.id,
    subreddit: queueItem.subreddit,
    question: queueItem.question,
    draftedResponse,
    responder,
    confidence,
    status,
    respondedAt: now,
    link: queueItem.link,
    notes: matchingDraft ? `rssDraft:${matchingDraft.draftId}` : undefined,
    rssDraftId: matchingDraft?.draftId,
    devvitPayloadPath: agentResult?.devvitPayloadPath,
    packId: agentResult?.packId ?? latestPack?.pack?.id ?? undefined,
    packPath: agentResult?.packPath ?? latestPack?.path,
  };

  context.state.redditResponses.push(record);
  context.state.lastRedditResponseAt = now;
  await context.saveState();
  return `drafted reddit reply for ${queueItem.subreddit} (${queueItem.id})`;
};

const securityAuditHandler: TaskHandler = async (task, context) => {
  await assertToolGatePermission(task, context, "security-audit");
  const payload = {
    id: randomUUID(),
    type: String(task.payload.type ?? "scan"),
    scope: String(task.payload.scope ?? "workspace"),
  };

  try {
    const result = await runSpawnedAgentJob(
      "security-agent",
      payload,
      "SECURITY_AGENT_RESULT_FILE",
      context.logger,
    );
    recordTaskExecutionResultSummary(context, task, result);
    assertSpawnedAgentReportedSuccess(result, "security audit");
    observeSpawnedAgentResult({
      context,
      task,
      sourceAgentId: "security-agent",
      result,
    });
    const auditedAgents = Array.isArray(result.auditedAgents)
      ? result.auditedAgents.filter(
          (agentId): agentId is string => typeof agentId === "string" && agentId.length > 0,
        )
      : [];
    for (const agentId of auditedAgents) {
      observeRuntimeRelationship({
        context,
        task,
        from: "agent:security-agent",
        to: `agent:${agentId}`,
        relationship: "audits-agent",
        detail: `security-agent audited ${agentId} during ${payload.type}.`,
        source: "security-agent",
        evidence: [
          `scope:${payload.scope}`,
          `findings:${
            Array.isArray(result.findings) ? result.findings.length : 0
          }`,
        ],
      });
    }
    const summary =
      (result.summary as Record<string, unknown> | undefined) ?? {};
    const critical = Number(summary.critical ?? 0);
    const total = Number(summary.total ?? 0);
    return `security audit complete (${critical} critical, ${total} findings)`;
  } catch (error) {
    throwTaskFailure("security audit", error);
  }
};

const summarizeContentHandler: TaskHandler = async (task, context) => {
  await assertToolGatePermission(task, context, "summarize-content");
  const sourceType = String(task.payload.sourceType ?? "document") as
    | "document"
    | "transcript"
    | "report";
  const payload = {
    id: randomUUID(),
    source: {
      type: sourceType,
      content: String(task.payload.content ?? ""),
      metadata:
        typeof task.payload.metadata === "object" &&
        task.payload.metadata !== null
          ? (task.payload.metadata as Record<string, unknown>)
          : undefined,
    },
    constraints:
      typeof task.payload.constraints === "object" &&
      task.payload.constraints !== null
        ? (task.payload.constraints as Record<string, unknown>)
        : undefined,
    format: task.payload.format
      ? String(task.payload.format)
      : "executive_summary",
  };

  try {
    const result = await runSpawnedAgentJob(
      "summarization-agent",
      payload,
      "SUMMARIZATION_AGENT_RESULT_FILE",
      context.logger,
    );
    recordTaskExecutionResultSummary(context, task, result);
    assertSpawnedAgentReportedSuccess(result, "summarization");
    observeSpawnedAgentResult({
      context,
      task,
      sourceAgentId: "summarization-agent",
      result,
    });
    const confidence = Number(result.confidence ?? 0);
    const format = String(result.format ?? payload.format);
    return `summarization complete (${format}, confidence ${confidence.toFixed(2)})`;
  } catch (error) {
    throwTaskFailure("summarization", error);
  }
};

const controlPlaneBriefHandler: TaskHandler = async (task, context) => {
  await assertToolGatePermission(task, context, "control-plane-brief");
  const queueSnapshot = context.getQueueSnapshot?.() ?? {
    queued: [],
    processing: [],
  };
  const payload = {
    id: randomUUID(),
    type: "control-plane-brief",
    focus:
      typeof task.payload.focus === "string" ? task.payload.focus : undefined,
    queueSnapshot,
    pendingApprovalsCount: context.state.approvals.filter(
      (entry) => entry.status === "pending",
    ).length,
  };

  try {
    const result = await runSpawnedAgentJob(
      "operations-analyst-agent",
      payload,
      "OPERATIONS_ANALYST_AGENT_RESULT_FILE",
      context.logger,
    );
    recordTaskExecutionResultSummary(context, task, result);
    assertSpawnedAgentReportedSuccess(result, "control-plane brief");
    observeSpawnedAgentResult({
      context,
      task,
      sourceAgentId: "operations-analyst-agent",
      result,
    });
    const mode =
      typeof result.controlPlaneBrief === "object" &&
      result.controlPlaneBrief !== null &&
      typeof (result.controlPlaneBrief as Record<string, unknown>).mode === "object" &&
      (result.controlPlaneBrief as Record<string, unknown>).mode !== null
        ? ((result.controlPlaneBrief as Record<string, unknown>)
            .mode as Record<string, unknown>)
        : null;
    const label =
      mode && typeof mode.label === "string" ? mode.label : "control-plane";
    return `control-plane brief complete (${label})`;
  } catch (error) {
    throwTaskFailure("control-plane brief", error);
  }
};

const incidentTriageHandler: TaskHandler = async (task, context) => {
  await assertToolGatePermission(task, context, "incident-triage");
  const payload = {
    id: randomUUID(),
    type: "incident-triage",
    classification:
      typeof task.payload.classification === "string"
        ? task.payload.classification
        : undefined,
    limit:
      typeof task.payload.limit === "number"
        ? task.payload.limit
        : undefined,
    agents: Array.isArray(task.payload.agents)
      ? (task.payload.agents as string[])
      : undefined,
  };

  try {
    const result = await runSpawnedAgentJob(
      "system-monitor-agent",
      payload,
      "SYSTEM_MONITOR_AGENT_RESULT_FILE",
      context.logger,
    );
    recordTaskExecutionResultSummary(context, task, result);
    assertSpawnedAgentReportedSuccess(result, "incident triage");
    observeSpawnedAgentResult({
      context,
      task,
      sourceAgentId: "system-monitor-agent",
      result,
    });
    const triageQueue =
      typeof result.incidentTriage === "object" &&
      result.incidentTriage !== null &&
      Array.isArray((result.incidentTriage as Record<string, unknown>).triageQueue)
        ? ((result.incidentTriage as Record<string, unknown>).triageQueue as unknown[])
        : [];
    return `incident triage complete (${triageQueue.length} queued priority item${
      triageQueue.length === 1 ? "" : "s"
    })`;
  } catch (error) {
    throwTaskFailure("incident triage", error);
  }
};

const systemMonitorHandler: TaskHandler = async (task, context) => {
  await assertToolGatePermission(task, context, "system-monitor");
  const payload = {
    id: randomUUID(),
    type: String(task.payload.type ?? "health"),
    agents: Array.isArray(task.payload.agents)
      ? (task.payload.agents as string[])
      : undefined,
  };

  try {
    const result = await runSpawnedAgentJob(
      "system-monitor-agent",
      payload,
      "SYSTEM_MONITOR_AGENT_RESULT_FILE",
      context.logger,
    );
    recordTaskExecutionResultSummary(context, task, result);
    assertSpawnedAgentReportedSuccess(result, "system monitor");
    observeSpawnedAgentResult({
      context,
      task,
      sourceAgentId: "system-monitor-agent",
      result,
    });
    const metrics =
      (result.metrics as Record<string, unknown> | undefined) ?? {};
    const agentHealth =
      metrics.agentHealth && typeof metrics.agentHealth === "object"
        ? (metrics.agentHealth as Record<string, unknown>)
        : {};
    for (const agentId of Object.keys(agentHealth)) {
      observeRuntimeRelationship({
        context,
        task,
        from: "agent:system-monitor-agent",
        to: `agent:${agentId}`,
        relationship: "monitors-agent",
        detail: `system-monitor-agent evaluated ${agentId} health from runtime evidence.`,
        source: "system-monitor-agent",
        evidence: [`agent:${agentId}`],
      });
    }
    const alerts = Array.isArray(metrics.alerts) ? metrics.alerts.length : 0;
    return `system monitor complete (${alerts} alerts)`;
  } catch (error) {
    throwTaskFailure("system monitor", error);
  }
};

const releaseReadinessHandler: TaskHandler = async (task, context) => {
  await assertToolGatePermission(task, context, "release-readiness");
  const payload = {
    id: randomUUID(),
    type: "release-readiness",
    releaseTarget:
      typeof task.payload.releaseTarget === "string"
        ? task.payload.releaseTarget
        : undefined,
  };

  try {
    const result = await runSpawnedAgentJob(
      "release-manager-agent",
      payload,
      "RELEASE_MANAGER_AGENT_RESULT_FILE",
      context.logger,
    );
    recordTaskExecutionResultSummary(context, task, result);
    observeSpawnedAgentResult({
      context,
      task,
      sourceAgentId: "release-manager-agent",
      result,
    });
    const readiness =
      typeof result.releaseReadiness === "object" &&
      result.releaseReadiness !== null
        ? (result.releaseReadiness as Record<string, unknown>)
        : null;
    if (result.success !== true && readiness?.decision !== "hold") {
      throw new Error(
        typeof readiness?.summary === "string"
          ? readiness.summary
          : "release-readiness reported blocked posture",
      );
    }
    const decision =
      readiness && typeof readiness.decision === "string"
        ? readiness.decision
        : "unknown";
    return `release readiness complete (${decision})`;
  } catch (error) {
    throwTaskFailure("release readiness", error);
  }
};

const buildRefactorHandler: TaskHandler = async (task, context) => {
  await assertToolGatePermission(task, context, "build-refactor");
  const payload = {
    id: randomUUID(),
    type: String(task.payload.type ?? "refactor"),
    scope: String(task.payload.scope ?? "orchestrator/src"),
    intent:
      typeof task.payload.intent === "string"
        ? task.payload.intent
        : undefined,
    changes: Array.isArray(task.payload.changes)
      ? task.payload.changes
      : undefined,
    testCommand:
      typeof task.payload.testCommand === "string"
        ? task.payload.testCommand
        : undefined,
    constraints:
      typeof task.payload.constraints === "object" &&
      task.payload.constraints !== null
        ? (task.payload.constraints as Record<string, unknown>)
        : undefined,
    incidentClassification:
      typeof task.payload.incidentClassification === "string"
        ? task.payload.incidentClassification
        : undefined,
    affectedSurfaces: Array.isArray(task.payload.affectedSurfaces)
      ? task.payload.affectedSurfaces.map(String)
      : undefined,
  };

  try {
    const result = await runSpawnedAgentJob(
      "build-refactor-agent",
      payload,
      "BUILD_REFACTOR_AGENT_RESULT_FILE",
      context.logger,
    );
    recordTaskExecutionResultSummary(context, task, result);
    assertSpawnedAgentReportedSuccess(result, "build-refactor");
    observeSpawnedAgentResult({
      context,
      task,
      sourceAgentId: "build-refactor-agent",
      result,
    });

    const summary =
      (result.summary as Record<string, unknown> | undefined) ?? {};
    const filesChanged = Number(summary.filesChanged ?? 0);
    const confidence = Number(summary.confidence ?? 0);
    return `build-refactor complete (${filesChanged} files, confidence ${confidence.toFixed(2)})`;
  } catch (error) {
    throwTaskFailure("build-refactor", error);
  }
};

const contentGenerateHandler: TaskHandler = async (task, context) => {
  await assertToolGatePermission(task, context, "content-generate");
  const payload = {
    id: randomUUID(),
    type: String(task.payload.type ?? "readme"),
    source:
      typeof task.payload.source === "object" && task.payload.source !== null
        ? (task.payload.source as Record<string, unknown>)
        : { name: "Project", description: "Generated content" },
    style: task.payload.style ? String(task.payload.style) : undefined,
    length: task.payload.length ? String(task.payload.length) : undefined,
  };

  try {
    const result = await runSpawnedAgentJob(
      "content-agent",
      payload,
      "CONTENT_AGENT_RESULT_FILE",
      context.logger,
    );
    recordTaskExecutionResultSummary(context, task, result);
    assertSpawnedAgentReportedSuccess(result, "content generation");
    observeSpawnedAgentResult({
      context,
      task,
      sourceAgentId: "content-agent",
      result,
    });

    const metrics =
      (result.metrics as Record<string, unknown> | undefined) ?? {};
    const wordCount = Number(metrics.wordCount ?? 0);
    const generatedType = String(metrics.generatedType ?? payload.type);
    return `content generation complete (${generatedType}, ${wordCount} words)`;
  } catch (error) {
    throwTaskFailure("content generation", error);
  }
};

const integrationWorkflowHandler: TaskHandler = async (task, context) => {
  await assertToolGatePermission(task, context, "integration-workflow");
  const payload = {
    id: randomUUID(),
    type: String(task.payload.type ?? "workflow"),
    steps: Array.isArray(task.payload.steps)
      ? (task.payload.steps as Record<string, unknown>[])
      : [],
  };

  try {
    const result = await runSpawnedAgentJob(
      "integration-agent",
      payload,
      "INTEGRATION_AGENT_RESULT_FILE",
      context.logger,
    );
    recordTaskExecutionResultSummary(
      context,
      task,
      buildIntegrationWorkflowSummaryResult(result),
    );
    observeSpawnedAgentResult({
      context,
      task,
      sourceAgentId: "integration-agent",
      result,
    });
    appendIntegrationWorkflowEvidence({
      context,
      task,
      result,
    });

    const steps = Array.isArray(result.steps) ? result.steps.length : 0;
    if (result.success !== true) {
      const reason =
        typeof result.stopReason === "string"
          ? result.stopReason
          : typeof result.error === "string"
            ? result.error
          : "agent returned unsuccessful result";
      throw new Error(`integration workflow failed: ${reason}`);
    }
    return `integration workflow complete (${steps} steps)`;
  } catch (error) {
    throwTaskFailure("integration workflow", error);
  }
};

const normalizeDataHandler: TaskHandler = async (task, context) => {
  await assertToolGatePermission(task, context, "normalize-data");
  const payload = {
    id: randomUUID(),
    type: String(task.payload.type ?? "normalize"),
    input: task.payload.input !== undefined ? task.payload.input : [],
    schema:
      typeof task.payload.schema === "object" && task.payload.schema !== null
        ? (task.payload.schema as Record<string, unknown>)
        : {},
  };

  try {
    const result = await runSpawnedAgentJob(
      "normalization-agent",
      payload,
      "NORMALIZATION_AGENT_RESULT_FILE",
      context.logger,
    );
    recordTaskExecutionResultSummary(context, task, result);
    assertSpawnedAgentReportedSuccess(result, "normalize-data");
    observeSpawnedAgentResult({
      context,
      task,
      sourceAgentId: "normalization-agent",
      result,
    });

    const metrics =
      (result.metrics as Record<string, unknown> | undefined) ?? {};
    const inputRecords = Number(metrics.inputRecords ?? 0);
    const outputRecords = Number(metrics.outputRecords ?? 0);
    return `normalize-data complete (${outputRecords}/${inputRecords} records normalized)`;
  } catch (error) {
    throwTaskFailure("normalize-data", error);
  }
};

const marketResearchHandler: TaskHandler = async (task, context) => {
  await assertToolGatePermission(task, context, "market-research");
  const payload = {
    id: randomUUID(),
    query: String(task.payload.query ?? "market research"),
    scope: String(task.payload.scope ?? "general"),
    urls: Array.isArray(task.payload.urls)
      ? (task.payload.urls as unknown[]).filter((value): value is string => typeof value === "string")
      : undefined,
    sourceHints: Array.isArray(task.payload.sourceHints)
      ? (task.payload.sourceHints as unknown[]).filter((value): value is string => typeof value === "string")
      : undefined,
    autoFetch:
      typeof task.payload.autoFetch === "boolean"
        ? task.payload.autoFetch
        : undefined,
    constraints:
      typeof task.payload.constraints === "object" &&
      task.payload.constraints !== null
        ? (task.payload.constraints as Record<string, unknown>)
        : undefined,
  };

  try {
    const result = await runSpawnedAgentJob(
      "market-research-agent",
      payload,
      "MARKET_RESEARCH_AGENT_RESULT_FILE",
      context.logger,
    );
    recordTaskExecutionResultSummary(context, task, result);
    assertSpawnedAgentReportedSuccess(result, "market research");
    observeSpawnedAgentResult({
      context,
      task,
      sourceAgentId: "market-research-agent",
      result,
    });

    const findings = Array.isArray(result.findings)
      ? result.findings.length
      : 0;
    const confidence = Number(result.confidence ?? 0);
    return `market research complete (${findings} findings, confidence ${confidence.toFixed(2)})`;
  } catch (error) {
    throwTaskFailure("market research", error);
  }
};

const dataExtractionHandler: TaskHandler = async (task, context) => {
  await assertToolGatePermission(task, context, "data-extraction");
  const payload = {
    id: randomUUID(),
    input: {
      files: Array.isArray(task.payload.files)
        ? (task.payload.files as Record<string, unknown>[])
        : undefined,
      artifacts: Array.isArray(task.payload.artifacts)
        ? (task.payload.artifacts as Record<string, unknown>[])
        : undefined,
      source:
        typeof task.payload.source === "object" && task.payload.source !== null
          ? (task.payload.source as Record<string, unknown>)
          : { type: "inline", content: String(task.payload.content ?? "") },
      normalize:
        typeof task.payload.normalize === "boolean"
          ? task.payload.normalize
          : undefined,
    },
    schema:
      typeof task.payload.schema === "object" && task.payload.schema !== null
        ? (task.payload.schema as Record<string, unknown>)
        : undefined,
  };

  try {
    const result = await runSpawnedAgentJob(
      "data-extraction-agent",
      payload,
      "DATA_EXTRACTION_AGENT_RESULT_FILE",
      context.logger,
    );
    recordTaskExecutionResultSummary(context, task, result);
    assertSpawnedAgentReportedSuccess(result, "data extraction");
    observeSpawnedAgentResult({
      context,
      task,
      sourceAgentId: "data-extraction-agent",
      result,
    });

    const recordsExtracted = Number(result.recordsExtracted ?? 0);
    const entitiesFound = Number(result.entitiesFound ?? 0);
    return `data extraction complete (${recordsExtracted} records, ${entitiesFound} entities)`;
  } catch (error) {
    throwTaskFailure("data extraction", error);
  }
};

const qaVerificationHandler: TaskHandler = async (task, context) => {
  await assertToolGatePermission(task, context, "qa-verification");
  type QaVerificationAgentResult = Record<string, unknown> & {
    success?: boolean;
    dryRun?: boolean;
    outcomeSummary?: string;
    executedCommand?: string;
    outcomeKind?: string;
    totalChecks?: number;
    testsRun?: number;
    passedChecks?: number;
    testsPassed?: number;
    summary?: string;
    closureRecommendation?: {
      allowClosure?: boolean;
      summary?: string;
      decision?: string;
    } | null;
    verification?: {
      correctness?: string;
      evidenceQuality?: string;
      reproducibility?: string;
      regressionRisk?: string;
      policyFit?: string;
    } | null;
    verificationTrace?: {
      traceId?: string;
      generatedAt?: string;
      incidentId?: string | null;
      targetAgentId?: string | null;
      correctness?: string;
      evidenceQuality?: string;
      reproducibility?: string;
      regressionRisk?: string;
      policyFit?: string;
      closureDecision?: string;
      allowClosure?: boolean;
      summary?: string;
      evidence?: string[];
      workflowStopSignals?: number;
      priorityIncidentCount?: number;
      repairCount?: number;
      relationshipCount?: number;
      repairIds?: string[];
      runIds?: string[];
      serviceIds?: string[];
      affectedSurfaces?: string[];
    } | null;
  };
  const payload = {
    id: randomUUID(),
    target: String(task.payload.target ?? "workspace"),
    targetAgentId:
      typeof task.payload.targetAgentId === "string"
        ? task.payload.targetAgentId
        : typeof task.payload.target === "string" &&
            task.payload.target.endsWith("-agent")
          ? task.payload.target
          : undefined,
    suite: String(task.payload.suite ?? "smoke"),
    mode:
      task.payload.mode !== undefined ? String(task.payload.mode) : undefined,
    testCommand:
      typeof task.payload.testCommand === "string"
        ? task.payload.testCommand
        : undefined,
    dryRun:
      task.payload.dryRun === true ||
      (typeof task.payload.constraints === "object" &&
        task.payload.constraints !== null &&
        (task.payload.constraints as Record<string, unknown>).dryRun === true),
    constraints:
      typeof task.payload.constraints === "object" &&
      task.payload.constraints !== null
        ? (task.payload.constraints as Record<string, unknown>)
        : undefined,
    incidentId:
      typeof task.payload.__incidentId === "string"
        ? task.payload.__incidentId
        : typeof task.payload.incidentId === "string"
          ? task.payload.incidentId
          : undefined,
    repairIds: Array.isArray(task.payload.repairIds)
      ? task.payload.repairIds
      : undefined,
    runIds: Array.isArray(task.payload.runIds)
      ? task.payload.runIds
      : undefined,
    serviceIds: Array.isArray(task.payload.serviceIds)
      ? task.payload.serviceIds
      : undefined,
    affectedSurfaces: Array.isArray(task.payload.affectedSurfaces)
      ? task.payload.affectedSurfaces
      : undefined,
  };
  const requiresSerializedExecution =
    payload.dryRun !== true &&
    !(typeof payload.mode === "string" && payload.mode.trim().toLowerCase() === "dry-run");

  try {
    const result = (await (requiresSerializedExecution
      ? runSerializedQaVerification(context.logger, () =>
          runSpawnedAgentJob(
            "qa-verification-agent",
            payload,
            "QA_VERIFICATION_AGENT_RESULT_FILE",
            context.logger,
          ),
        )
      : runSpawnedAgentJob(
          "qa-verification-agent",
          payload,
          "QA_VERIFICATION_AGENT_RESULT_FILE",
          context.logger,
        ))) as QaVerificationAgentResult;
    recordTaskExecutionResultSummary(context, task, result);

    const appendVerificationTrace = (status: "passed" | "failed" | "required") => {
      const trace = result.verificationTrace;
      if (!trace) {
        return;
      }
      const traceEvidence = Array.isArray(trace.evidence)
        ? trace.evidence.map(String)
        : [];
      context.appendTaskWorkflowEvent?.(
        task,
        "result",
        `verification-${status}`,
        typeof trace.summary === "string" && trace.summary.length > 0
          ? trace.summary
          : `qa verification ${status}`,
        {
          source: "qa-verification-agent",
          nodeId:
            typeof trace.traceId === "string" && trace.traceId.length > 0
              ? trace.traceId
              : `verification:${task.id}`,
          timestamp:
            typeof trace.generatedAt === "string" && trace.generatedAt.length > 0
              ? trace.generatedAt
              : new Date().toISOString(),
          evidence: [
            ...(typeof trace.correctness === "string"
              ? [`correctness:${trace.correctness}`]
              : []),
            ...(typeof trace.evidenceQuality === "string"
              ? [`evidence-quality:${trace.evidenceQuality}`]
              : []),
            ...(typeof trace.reproducibility === "string"
              ? [`reproducibility:${trace.reproducibility}`]
              : []),
            ...(typeof trace.regressionRisk === "string"
              ? [`regression-risk:${trace.regressionRisk}`]
              : []),
            ...(typeof trace.policyFit === "string"
              ? [`policy-fit:${trace.policyFit}`]
              : []),
            ...traceEvidence.slice(0, 8),
          ],
          classification: "verification-trace",
        },
      );

      const incidentId =
        typeof trace.incidentId === "string" && trace.incidentId.length > 0
          ? trace.incidentId
          : typeof payload.incidentId === "string"
            ? payload.incidentId
            : null;
      if (!incidentId) {
        return;
      }

      context.appendIncidentHistoryEvent?.(incidentId, {
        timestamp:
          typeof trace.generatedAt === "string" && trace.generatedAt.length > 0
            ? trace.generatedAt
            : new Date().toISOString(),
        type:
          status === "passed"
            ? "verification-passed"
            : status === "failed"
              ? "verification-failed"
              : "verification-required",
        actor: "qa-verification-agent",
        summary:
          typeof trace.summary === "string" && trace.summary.length > 0
            ? trace.summary
            : `Verification ${status} for incident ${incidentId}.`,
        detail: [
          typeof trace.closureDecision === "string"
            ? `closureDecision=${trace.closureDecision}`
            : null,
          typeof trace.correctness === "string"
            ? `correctness=${trace.correctness}`
            : null,
          typeof trace.evidenceQuality === "string"
            ? `evidenceQuality=${trace.evidenceQuality}`
            : null,
          typeof trace.reproducibility === "string"
            ? `reproducibility=${trace.reproducibility}`
            : null,
          typeof trace.regressionRisk === "string"
            ? `regressionRisk=${trace.regressionRisk}`
            : null,
          typeof trace.policyFit === "string"
            ? `policyFit=${trace.policyFit}`
            : null,
        ]
          .filter((value): value is string => Boolean(value))
          .join("; "),
        evidence: [
          ...(typeof trace.traceId === "string" ? [trace.traceId] : []),
          ...(Array.isArray(trace.repairIds) ? trace.repairIds.slice(0, 4) : []),
          ...(Array.isArray(trace.runIds) ? trace.runIds.slice(0, 4) : []),
          ...(Array.isArray(trace.serviceIds) ? trace.serviceIds.slice(0, 4) : []),
          ...(Array.isArray(trace.affectedSurfaces)
            ? trace.affectedSurfaces.slice(0, 4)
            : []),
          ...traceEvidence.slice(0, 10),
        ],
      });

      applyQaVerificationOutcome({
        state: context.state,
        incidentId,
        repairIds: Array.isArray(trace.repairIds)
          ? trace.repairIds.filter((value): value is string => typeof value === "string")
          : Array.isArray(payload.repairIds)
            ? payload.repairIds.filter((value): value is string => typeof value === "string")
            : [],
        taskId: task.id,
        runId: task.idempotencyKey ?? null,
        status,
        summary:
          typeof trace.summary === "string" && trace.summary.length > 0
            ? trace.summary
            : `Verification ${status} for incident ${incidentId}.`,
        generatedAt:
          typeof trace.generatedAt === "string" && trace.generatedAt.length > 0
            ? trace.generatedAt
            : new Date().toISOString(),
        allowClosure: trace.allowClosure === true,
        closureDecision:
          typeof trace.closureDecision === "string" ? trace.closureDecision : null,
        evidence: [
          ...(typeof trace.correctness === "string"
            ? [`correctness:${trace.correctness}`]
            : []),
          ...(typeof trace.evidenceQuality === "string"
            ? [`evidence-quality:${trace.evidenceQuality}`]
            : []),
          ...(typeof trace.reproducibility === "string"
            ? [`reproducibility:${trace.reproducibility}`]
            : []),
          ...(typeof trace.regressionRisk === "string"
            ? [`regression-risk:${trace.regressionRisk}`]
            : []),
          ...(typeof trace.policyFit === "string"
            ? [`policy-fit:${trace.policyFit}`]
            : []),
          ...traceEvidence,
        ],
      });
    };

    observeSpawnedAgentResult({
      context,
      task,
      sourceAgentId: "qa-verification-agent",
      result,
    });
    const gate = await getToolGate();
    await gate.preflightSkillAccess("qa-verification-agent", "testRunner", {
      mode: "execute",
      taskType: "qa-verification",
      executedCommand:
        typeof result.executedCommand === "string"
          ? result.executedCommand
          : undefined,
      outcomeKind:
        typeof result.outcomeKind === "string" ? result.outcomeKind : undefined,
    });

    if (result.dryRun === true) {
      appendVerificationTrace("required");
      return `qa verification dry-run complete (${String(result.outcomeSummary ?? "no tests executed")})`;
    }

    if (result.success !== true) {
      appendVerificationTrace("failed");
      throw new Error(
        typeof result.closureRecommendation?.summary === "string"
          ? result.closureRecommendation.summary
          : typeof result.outcomeSummary === "string"
            ? result.outcomeSummary
            : "qa verification reported failure",
      );
    }

    if (
      typeof task.payload.__incidentId === "string" &&
      result.closureRecommendation &&
      result.closureRecommendation.allowClosure !== true
    ) {
      appendVerificationTrace("required");
      throw new Error(
        typeof result.closureRecommendation.summary === "string"
          ? result.closureRecommendation.summary
          : "qa verification did not permit incident closure",
      );
    }

    const totalChecks = Number(result.totalChecks ?? result.testsRun ?? 0);
    const passedChecks = Number(result.passedChecks ?? result.testsPassed ?? 0);
    if (totalChecks <= 0) {
      throw new Error(
        "qa verification returned success without any executed checks; use dry-run mode for no-op validation",
      );
    }

    const outcomeKind =
      typeof result.outcomeKind === "string" ? result.outcomeKind : "checks";
    const unitLabel = outcomeKind === "tests" ? "tests" : "checks";
    const commandNote =
      typeof result.executedCommand === "string" &&
      result.executedCommand.length > 0
        ? ` via ${result.executedCommand}`
        : "";
    const targetAgentId =
      typeof task.payload.target === "string" &&
      task.payload.target.endsWith("-agent")
        ? task.payload.target
        : typeof task.payload.targetAgentId === "string"
          ? task.payload.targetAgentId
          : null;
    if (targetAgentId) {
      observeRuntimeRelationship({
        context,
        task,
        from: "agent:qa-verification-agent",
        to: `agent:${targetAgentId}`,
        relationship: "verifies-agent",
        detail: `qa-verification-agent verified ${targetAgentId}.`,
        source: "qa-verification-agent",
        evidence: [
          typeof result.executedCommand === "string" ? result.executedCommand : "no-command",
          typeof result.outcomeSummary === "string" ? result.outcomeSummary : outcomeKind,
        ],
      });
    }
    appendVerificationTrace("passed");
    return `qa verification complete (${passedChecks}/${totalChecks} ${unitLabel} passed${commandNote})`;
  } catch (error) {
    throwTaskFailure("qa verification", error);
  }
};

const skillAuditHandler: TaskHandler = async (task, context) => {
  await assertToolGatePermission(task, context, "skill-audit");
  const payload = {
    id: randomUUID(),
    skillIds: Array.isArray(task.payload.skillIds)
      ? (task.payload.skillIds as string[])
      : undefined,
    depth: String(task.payload.depth ?? "standard"),
    checks: Array.isArray(task.payload.checks)
      ? (task.payload.checks as string[])
      : undefined,
  };

  try {
    const result = await runSpawnedAgentJob(
      "skill-audit-agent",
      payload,
      "SKILL_AUDIT_AGENT_RESULT_FILE",
      context.logger,
    );
    recordTaskExecutionResultSummary(context, task, result);
    assertSpawnedAgentReportedSuccess(result, "skill audit");
    observeSpawnedAgentResult({
      context,
      task,
      sourceAgentId: "skill-audit-agent",
      result,
    });

    const audited = Number(result.skillsAudited ?? 0);
    const issues = Number(result.issuesFound ?? 0);
    return `skill audit complete (${audited} skills, ${issues} issues)`;
  } catch (error) {
    throwTaskFailure("skill audit", error);
  }
};

const rssSweepHandler: TaskHandler = async (task, context) => {
  const configPath =
    typeof task.payload.configPath === "string"
      ? task.payload.configPath
      : (context.config.rssConfigPath ??
        join(process.cwd(), "..", "rss_filter_config.json"));
  const draftsPath =
    typeof task.payload.draftsPath === "string"
      ? task.payload.draftsPath
      : (context.config.redditDraftsPath ??
        join(process.cwd(), "..", "logs", "reddit-drafts.jsonl"));

  const rawConfig = await readFile(configPath, "utf-8");
  const rssConfig = JSON.parse(rawConfig);
  const now = new Date().toISOString();
  let drafted = 0;

  const pillars = Object.entries(rssConfig.pillars ?? {}) as Array<
    [string, any]
  >;
  for (const [pillarKey, pillar] of pillars) {
    const feeds = pillar.feeds ?? [];
    for (const feed of feeds) {
      const response = await fetch(feed.url, {
        headers: { "User-Agent": "openclaw-orchestrator" },
      });
      if (!response.ok) {
        context.logger.warn(`[rss] failed ${feed.url}: ${response.status}`);
        continue;
      }
      const xml = await response.text();
      const entries = parseRssEntries(xml);
      for (const entry of entries) {
        const seenId = `${feed.id}:${entry.id}`;
        if (context.state.rssSeenIds.includes(seenId)) continue;

        const textBlob = `${entry.title}\n${entry.content}\n${entry.author ?? ""}\n${feed.subreddit}\n${entry.link}`;
        const clusterScore = buildScore(
          textBlob,
          pillar.keyword_clusters ?? {},
        );

        const crossTriggers =
          rssConfig.cross_pillar?.high_intent_triggers ?? [];
        const crossMatches = crossTriggers.filter((trigger: string) =>
          textBlob.toLowerCase().includes(trigger.toLowerCase()),
        );

        const scoreBreakdown: Record<string, number> = {};
        let totalScore = 0;

        Object.entries(clusterScore.breakdown).forEach(([cluster, count]) => {
          let weight = 1;
          if (["emotional_identity_pain"].includes(cluster))
            weight = rssConfig.scoring.weights.emotional_pain_match;
          if (
            [
              "core_instability",
              "debug_blindness",
              "preview_vs_production",
              "export_quality_shock",
              "autonomy_collapse",
              "migration_and_rebrand_brittleness",
            ].includes(cluster)
          ) {
            weight = rssConfig.scoring.weights.execution_failure_match;
          }
          if (["security_exposure", "skills_supply_chain"].includes(cluster))
            weight = rssConfig.scoring.weights.security_exposure_match;
          if (["payments_and_backend"].includes(cluster))
            weight = rssConfig.scoring.weights.payments_backend_match;
          if (["hardening_and_runtime"].includes(cluster))
            weight = rssConfig.scoring.weights.infra_hardening_match;

          const weighted = count * weight;
          scoreBreakdown[cluster] = weighted;
          totalScore += weighted;
        });

        if (crossMatches.length > 0) {
          const bonus =
            rssConfig.scoring.weights.cross_pillar_trigger_match *
            crossMatches.length;
          scoreBreakdown.cross_pillar_trigger_match = bonus;
          totalScore += bonus;
        }

        const thresholds = rssConfig.scoring.thresholds;
        if (totalScore < thresholds.draft_if_score_gte) {
          rememberRssId(context, seenId);
          continue;
        }

        let tag: "draft" | "priority" | "manual-review" = "draft";
        if (totalScore >= thresholds.manual_review_if_score_gte)
          tag = "manual-review";
        else if (totalScore >= thresholds.priority_draft_if_score_gte)
          tag = "priority";

        const ctas = rssConfig.drafting?.cta_variants?.[pillarKey] ?? [];
        const ctaVariant =
          ctas[0] ??
          "If you want, share more context and I’ll suggest the next move.";

        const suggestedReply = `Saw your post about ${entry.title}. ${ctaVariant}`;

        const record: RssDraftRecord = {
          draftId: randomUUID(),
          pillar: pillarKey,
          feedId: feed.id,
          subreddit: feed.subreddit,
          title: entry.title,
          content: entry.content,
          link: entry.link,
          author: entry.author,
          matchedKeywords: [...clusterScore.matched, ...crossMatches],
          scoreBreakdown,
          totalScore,
          suggestedReply,
          ctaVariant,
          tag,
          queuedAt: now,
        };

        context.state.rssDrafts.push(record);
        context.state.redditQueue.push({
          id: record.draftId,
          subreddit: feed.subreddit,
          question: entry.title,
          link: entry.link,
          queuedAt: now,
          tag,
          pillar: pillarKey,
          feedId: feed.id,
          entryContent: entry.content,
          author: entry.author,
          ctaVariant,
          matchedKeywords: record.matchedKeywords,
          score: totalScore,
          draftRecordId: record.draftId,
          suggestedReply,
        });
        ensureRedditQueueLimit(context);
        await appendDraft(draftsPath, record);
        rememberRssId(context, seenId);
        drafted += 1;
      }
    }
  }

  context.state.lastRssSweepAt = now;
  await context.saveState();
  return drafted > 0
    ? `rss sweep drafted ${drafted} replies`
    : "rss sweep complete (no drafts)";
};

const heartbeatHandler: TaskHandler = async (task, context) => {
  const now = new Date().toISOString();
  const queueSnapshot = context.getQueueSnapshot?.() ?? {
    queued: [],
    processing: [],
  };
  const queuedCount = queueSnapshot.queued.length;
  const processingCount = queueSnapshot.processing.length;
  const pendingApprovalsCount = (context.state.approvals ?? []).filter(
    (entry) => entry.status === "pending",
  ).length;
  const openIncidentsCount = (context.state.incidentLedger ?? []).filter(
    (entry) => entry.status === "active",
  ).length;
  const proofIncidentCount = (context.state.incidentLedger ?? []).filter(
    (entry) =>
      entry.status === "active" && entry.classification === "proof-delivery",
  ).length;
  const serviceGapIncidentCount = (context.state.incidentLedger ?? []).filter(
    (entry) =>
      entry.status === "active" && entry.classification === "service-runtime",
  ).length;

  const queuedSummaries: string[] = [];

  for (const spec of MAINTENANCE_CHECK_SPECS) {
    const record = ensureMaintenanceCheckRecord(context, spec);
    refreshMaintenanceCheckObservation(context, record);
    record.lastCheckedAt = now;

    if (isMaintenanceCheckDue(record, now)) {
      const summary =
        spec.id === "system-monitor"
          ? queuedCount > 0 ||
            processingCount > 0 ||
            pendingApprovalsCount > 0 ||
            openIncidentsCount > 0 ||
            proofIncidentCount > 0 ||
            serviceGapIncidentCount > 0
            ? `Queued by the 5-minute control-plane heartbeat because runtime pressure is present (${queuedCount} queued, ${processingCount} processing, ${pendingApprovalsCount} approvals, ${openIncidentsCount} open incidents).`
            : "Queued by the 5-minute control-plane heartbeat on the regular maintenance cadence."
          : spec.id === "security-posture"
            ? record.latestObservedRunStatus === "failed"
              ? "Queued by the control-plane heartbeat because the previous security posture check failed."
              : "Queued by the control-plane heartbeat on the 15-minute security posture cadence."
            : record.latestObservedRunStatus === "failed"
              ? "Queued by the control-plane heartbeat because the previous QA readiness check failed."
              : "Queued by the control-plane heartbeat on the 30-minute QA readiness cadence.";

      const queuedTask = queueMaintenanceCheck({
        context,
        spec,
        now,
        summary,
        actor: "heartbeat",
      });
      if (queuedTask) {
        queuedSummaries.push(spec.id);
      }
      continue;
    }

    record.status =
      record.latestObservedRunStatus === "failed" ? "error" : "idle";
    record.summary =
      record.latestObservedRunStatus === "failed"
        ? `${spec.label} is between cadence windows, but the latest observed run failed and still needs follow-through.`
        : `${spec.label} is within cadence; next maintenance check is due at ${record.nextDueAt ?? addMinutes(now, spec.intervalMinutes)}.`;
    record.actionQueued = false;
    record.nextDueAt =
      record.lastActionQueuedAt
        ? addMinutes(record.lastActionQueuedAt, spec.intervalMinutes)
        : addMinutes(now, spec.intervalMinutes);
  }

  await context.saveState();

  return queuedSummaries.length > 0
    ? `heartbeat (${task.payload.reason ?? "interval"}) queued ${queuedSummaries.join(", ")}`
    : `heartbeat (${task.payload.reason ?? "interval"}) checked maintenance cadence`;
};

const agentDeployHandler: TaskHandler = async (task, context) => {
  const deploymentId = randomUUID();
  const agentName = String(
    task.payload.agentName ?? `agent-${deploymentId.slice(0, 6)}`,
  );
  const template = String(task.payload.template ?? "doc-specialist");
  const templatePath = String(
    task.payload.templatePath ?? join(process.cwd(), "..", "agents", template),
  );
  const deployBase =
    context.config.deployBaseDir ??
    join(process.cwd(), "..", "agents-deployed");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const repoPath = String(
    task.payload.repoPath ?? join(deployBase, `${agentName}-${timestamp}`),
  );
  const config =
    typeof task.payload.config === "object" && task.payload.config !== null
      ? (task.payload.config as Record<string, unknown>)
      : {};

  await mkdir(deployBase, { recursive: true });
  await cp(templatePath, repoPath, { recursive: true });

  const deploymentNotes = {
    deploymentId,
    agentName,
    template,
    templatePath: basename(templatePath),
    deployedAt: new Date().toISOString(),
    runHint: "npm install && npm run dev -- <payload.json>",
    payload: task.payload,
  };
  await writeFile(
    join(repoPath, "DEPLOYMENT.json"),
    JSON.stringify(deploymentNotes, null, 2),
    "utf-8",
  );

  const record: AgentDeploymentRecord = {
    deploymentId,
    agentName,
    template,
    repoPath,
    config,
    status: "deployed",
    deployedAt: new Date().toISOString(),
    notes: task.payload.notes ? String(task.payload.notes) : undefined,
  };

  context.state.agentDeployments.push(record);
  context.state.lastAgentDeployAt = record.deployedAt;
  await context.saveState();

  return `deployed ${agentName} via ${template} template to ${repoPath}`;
};

const nightlyBatchHandler: TaskHandler = async (task, context) => {
  const { state, config, logger } = context;
  const now = new Date().toISOString();
  const digestDir =
    config.digestDir ?? join(process.cwd(), "..", "logs", "digests");
  await mkdir(digestDir, { recursive: true });

  // Nightly batch orchestrates: doc-sync and derives selection from RSS routing tags.
  let docsSynced = 0;
  let itemsMarked = 0;
  let manualReviewApprovalsRequested = 0;
  let draftApprovalsRequested = 0;

  if (state.pendingDocChanges.length > 0) {
    docsSynced = state.pendingDocChanges.length;
    state.pendingDocChanges = [];
  }

  // Only priority-tagged items are auto-selected for reddit-helper drafting.
  for (let i = 0; i < state.redditQueue.length; i++) {
    const item = state.redditQueue[i];
    const selectedForDraft = shouldSelectQueueItemForDraft(item);
    item.selectedForDraft = selectedForDraft;
    if (selectedForDraft) {
      itemsMarked += 1;
    }
    if (
      item.tag === "manual-review" &&
      ensureManualReviewApprovalRecord(state.approvals, item, now)
    ) {
      manualReviewApprovalsRequested += 1;
      onApprovalRequested(
        buildManualReviewApprovalTaskId(item.id),
        "reddit-response",
      );
    }
  }

  const draftApprovalCandidates = state.redditQueue
    .filter((item) => item.tag === "draft")
    .sort((left, right) => {
      const scoreDelta = (right.score ?? 0) - (left.score ?? 0);
      if (scoreDelta !== 0) return scoreDelta;
      return left.queuedAt.localeCompare(right.queuedAt);
    })
    .slice(0, REDDIT_DRAFT_APPROVALS_PER_BATCH);

  for (const item of draftApprovalCandidates) {
    if (ensureDraftReviewApprovalRecord(state.approvals, item, now)) {
      draftApprovalsRequested += 1;
      onApprovalRequested(buildDraftReviewApprovalTaskId(item.id), "reddit-response");
    }
  }

  // Compile digest
  const digest = {
    generatedAt: now,
    batchId: randomUUID(),
    summary: {
      docsProcessed: docsSynced,
      queueTotal: state.redditQueue.length,
      markedForDraft: itemsMarked,
      manualReviewApprovalsRequested,
      draftApprovalsRequested,
    },
    redditQueue: state.redditQueue.filter((q) => q.selectedForDraft),
  };

  const dateTag = new Date(now).toISOString().split("T")[0];
  const digestPath = join(digestDir, `digest-${dateTag}.json`);
  await writeFile(digestPath, JSON.stringify(digest, null, 2), "utf-8");

  state.lastNightlyBatchAt = now;
  await context.saveState();

  return manualReviewApprovalsRequested > 0
    ? `nightly batch: synced ${docsSynced} docs, selected ${itemsMarked} priority items for draft, requested ${manualReviewApprovalsRequested} manual-review approvals, requested ${draftApprovalsRequested} draft promotion approvals`
    : draftApprovalsRequested > 0
      ? `nightly batch: synced ${docsSynced} docs, selected ${itemsMarked} priority items for draft, requested ${draftApprovalsRequested} draft promotion approvals`
      : `nightly batch: synced ${docsSynced} docs, selected ${itemsMarked} priority items for draft`;
};

const sendDigestHandler: TaskHandler = async (task, context) => {
  const { config, logger } = context;
  const digestDir =
    config.digestDir ?? join(process.cwd(), "..", "logs", "digests");

  try {
    const files = await readdir(digestDir);
    const digests = files
      .filter((f) => f.startsWith("digest-") && f.endsWith(".json"))
      .sort()
      .reverse();

    if (!digests.length) return "no digests to send";

    const latestPath = join(digestDir, digests[0]);
    const raw = await readFile(latestPath, "utf-8");
    const digest = JSON.parse(raw) as any;

    const summary = digest.summary;
    const itemCount = summary.markedForDraft ?? 0;

    // Build and send notification
    const notifierConfig = buildNotifierConfig(config);
    if (notifierConfig) {
      await sendNotification(
        notifierConfig,
        {
          title: `🚀 ${itemCount} Reddit Leads Ready for Review`,
          summary: `Your nightly RSS sweep collected ${summary.queueTotal} leads.\n${itemCount} priority-tagged items are ready for drafting.`,
          count: itemCount,
          digest: summary,
          url: `${process.env.APP_URL || "http://localhost:3000"}/digests/${digests[0]}`,
        },
        logger,
      );
    } else {
      logger.log(
        `[send-digest] ${itemCount} leads ready (no notification channel configured; use log fallback)`,
      );
    }

    context.state.lastDigestNotificationAt = new Date().toISOString();
    await context.saveState();

    return `digest notification sent (${itemCount} leads)`;
  } catch (error) {
    throwTaskFailure("send-digest", error);
  }
};

const unknownTaskHandler: TaskHandler = async (task, context) => {
  const allowed = ALLOWED_TASK_TYPES.join(", ");
  throw new Error(`Invalid task type: ${task.type}. Allowed: ${allowed}`);
};

export const taskHandlers: Record<string, TaskHandler> = {
  startup: startupHandler,
  "doc-change": docChangeHandler,
  "doc-sync": docSyncHandler,
  "drift-repair": driftRepairHandler,
  "control-plane-brief": controlPlaneBriefHandler,
  "incident-triage": incidentTriageHandler,
  "release-readiness": releaseReadinessHandler,
  "reddit-response": redditResponseHandler,
  "security-audit": securityAuditHandler,
  "summarize-content": summarizeContentHandler,
  "system-monitor": systemMonitorHandler,
  "build-refactor": buildRefactorHandler,
  "content-generate": contentGenerateHandler,
  "integration-workflow": integrationWorkflowHandler,
  "normalize-data": normalizeDataHandler,
  "market-research": marketResearchHandler,
  "data-extraction": dataExtractionHandler,
  "qa-verification": qaVerificationHandler,
  "skill-audit": skillAuditHandler,
  "rss-sweep": rssSweepHandler,
  "nightly-batch": nightlyBatchHandler,
  "send-digest": sendDigestHandler,
  heartbeat: heartbeatHandler,
  "agent-deploy": agentDeployHandler,
};

export function resolveTaskHandler(task: Task): TaskHandler {
  // Strict task type validation
  if (!validateTaskType(task.type)) {
    return unknownTaskHandler;
  }
  return taskHandlers[task.type] ?? unknownTaskHandler;
}
