import {
  createStateStore,
  isMongoStateTarget,
  isSqliteStateTarget,
} from "./state-store.js";
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
  ReviewSessionBaselineSummary,
  ReviewSessionBucket,
  ReviewSessionBucketTransition,
  ReviewSessionCapturePlan,
  ReviewSessionCumulativeWorkload,
  ReviewSessionDerivedSummary,
  ReviewSessionMachineProfile,
  ReviewSessionNote,
  ReviewSessionProfile,
  ReviewSessionRecord,
  ReviewSessionTelemetrySummary,
  ReviewSessionSummaryBucketStats,
  ReviewTelemetrySample,
  ReviewSessionWorkloadSummary,
  RelationshipObservationRecord,
  TaskExecutionRecord,
  TaskQueueAttemptRecord,
  TaskRetryRecoveryRecord,
  WorkflowEventRecord,
} from "./types.js";
import { createDefaultBusinessValueState } from "./business/valueLoop.js";
import { createDefaultBusinessValueSchedulerState } from "./business/operations.js";

const DEFAULT_HISTORY_LIMIT = 50;
const DRIFT_LOG_LIMIT = 25;
const REDDIT_RESPONSE_LIMIT = 100;
const AGENT_DEPLOYMENT_LIMIT = 50;
const RSS_DRAFT_LIMIT = 200;
const RSS_SEEN_LIMIT = 400;
const REDDIT_QUEUE_LIMIT = 100;
const APPROVALS_LIMIT = 1000;
const TASK_EXECUTION_LIMIT = 5000;
const TASK_QUEUE_ATTEMPT_LIMIT = 25;
const TASK_RETRY_RECOVERY_LIMIT = 1000;
const REPAIR_RECORD_LIMIT = 500;
const INCIDENT_LEDGER_LIMIT = 1000;
const WORKFLOW_EVENT_LIMIT = 20000;
const RELATIONSHIP_OBSERVATION_LIMIT = 20000;
const REVIEW_SESSION_LIMIT = 25;
const REVIEW_TELEMETRY_SAMPLE_LIMIT = 10000;
const BUSINESS_VALUE_CYCLE_LIMIT = 200;
const BUSINESS_VALUE_CANDIDATE_LIMIT = 500;
type StateRetentionOptions = {
  taskHistoryLimit?: number;
};

export { getStateStoreKind, isMongoStateTarget, isSqliteStateTarget } from "./state-store.js";

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

function normalizeReviewBucket(value: unknown): ReviewSessionBucket {
  switch (value) {
    case "baseline_idle":
    case "startup_cost":
    case "steady_state_running_cost":
    case "burst_workload":
    case "user_experience_evidence":
      return value;
    default:
      return "startup_cost";
  }
}

function normalizeReviewMachineProfile(value: unknown): ReviewSessionMachineProfile | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ReviewSessionMachineProfile>;
  if (
    typeof raw.hostname !== "string" ||
    typeof raw.platform !== "string" ||
    typeof raw.arch !== "string" ||
    typeof raw.cpuModel !== "string" ||
    typeof raw.cpuCores !== "number" ||
    typeof raw.memoryTotalMb !== "number"
  ) {
    return null;
  }
  return {
    hostname: raw.hostname,
    platform: raw.platform,
    arch: raw.arch,
    cpuModel: raw.cpuModel,
    cpuCores: raw.cpuCores,
    memoryTotalMb: raw.memoryTotalMb,
  };
}

function normalizeReviewBaselineSummary(value: unknown): ReviewSessionBaselineSummary | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ReviewSessionBaselineSummary>;
  if (
    typeof raw.cpuPercentAvg !== "number" ||
    typeof raw.cpuPercentPeak !== "number" ||
    typeof raw.loadAvg1m !== "number" ||
    typeof raw.memoryUsedMbAvg !== "number" ||
    typeof raw.memoryUsedMbPeak !== "number"
  ) {
    return null;
  }
  return {
    cpuPercentAvg: raw.cpuPercentAvg,
    cpuPercentPeak: raw.cpuPercentPeak,
    loadAvg1m: raw.loadAvg1m,
    memoryUsedMbAvg: raw.memoryUsedMbAvg,
    memoryUsedMbPeak: raw.memoryUsedMbPeak,
  };
}

function normalizeReviewNote(value: unknown): ReviewSessionNote | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ReviewSessionNote>;
  if (typeof raw.capturedAt !== "string" || typeof raw.text !== "string") {
    return null;
  }
  return {
    capturedAt: raw.capturedAt,
    bucket: normalizeReviewBucket(raw.bucket),
    text: raw.text,
  };
}

function normalizeReviewBucketStats(value: unknown): ReviewSessionSummaryBucketStats | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ReviewSessionSummaryBucketStats>;
  if (typeof raw.durationSeconds !== "number" || typeof raw.sampleCount !== "number") {
    return null;
  }
  return {
    durationSeconds: raw.durationSeconds,
    sampleCount: raw.sampleCount,
    cpuPercentAvg: typeof raw.cpuPercentAvg === "number" ? raw.cpuPercentAvg : null,
    cpuPercentPeak: typeof raw.cpuPercentPeak === "number" ? raw.cpuPercentPeak : null,
    memoryUsedMbAvg: typeof raw.memoryUsedMbAvg === "number" ? raw.memoryUsedMbAvg : null,
    memoryUsedMbPeak: typeof raw.memoryUsedMbPeak === "number" ? raw.memoryUsedMbPeak : null,
  };
}

function normalizeReviewSessionProfile(value: unknown): ReviewSessionProfile {
  return value === "soak-24h" ? "soak-24h" : "standard";
}

function normalizeReviewCapturePlan(value: unknown): ReviewSessionCapturePlan {
  if (!value || typeof value !== "object") {
    return {
      profile: "standard",
      sampleIntervalMs: 5000,
      maxSamples: REVIEW_SESSION_LIMIT * 60,
      intendedDurationHours: null,
      targetTaskCount: null,
    };
  }

  const raw = value as Partial<ReviewSessionCapturePlan>;
  const sampleIntervalMs =
    typeof raw.sampleIntervalMs === "number" && Number.isFinite(raw.sampleIntervalMs)
      ? Math.max(1000, Math.floor(raw.sampleIntervalMs))
      : 5000;
  const maxSamples =
    typeof raw.maxSamples === "number" && Number.isFinite(raw.maxSamples)
      ? Math.max(60, Math.floor(raw.maxSamples))
      : REVIEW_SESSION_LIMIT * 60;

  return {
    profile: normalizeReviewSessionProfile(raw.profile),
    sampleIntervalMs,
    maxSamples,
    intendedDurationHours:
      typeof raw.intendedDurationHours === "number" && Number.isFinite(raw.intendedDurationHours)
        ? raw.intendedDurationHours
        : null,
    targetTaskCount:
      typeof raw.targetTaskCount === "number" && Number.isFinite(raw.targetTaskCount)
        ? raw.targetTaskCount
        : null,
  };
}

function normalizeReviewTelemetrySummary(value: unknown): ReviewSessionTelemetrySummary {
  if (!value || typeof value !== "object") {
    return {
      totalSampleCount: 0,
      cpuPercentAvg: null,
      cpuPercentPeak: null,
      memoryUsedMbAvg: null,
      memoryUsedMbPeak: null,
      processRssMbAvg: null,
      processRssMbPeak: null,
      queueDepthAvg: null,
      queueDepthPeak: null,
      activeRunsAvg: null,
      activeRunsPeak: null,
      openIncidentsAvg: null,
      openIncidentsPeak: null,
    };
  }

  const raw = value as Partial<ReviewSessionTelemetrySummary>;
  return {
    totalSampleCount:
      typeof raw.totalSampleCount === "number" && Number.isFinite(raw.totalSampleCount)
        ? raw.totalSampleCount
        : 0,
    cpuPercentAvg: typeof raw.cpuPercentAvg === "number" ? raw.cpuPercentAvg : null,
    cpuPercentPeak: typeof raw.cpuPercentPeak === "number" ? raw.cpuPercentPeak : null,
    memoryUsedMbAvg: typeof raw.memoryUsedMbAvg === "number" ? raw.memoryUsedMbAvg : null,
    memoryUsedMbPeak: typeof raw.memoryUsedMbPeak === "number" ? raw.memoryUsedMbPeak : null,
    processRssMbAvg: typeof raw.processRssMbAvg === "number" ? raw.processRssMbAvg : null,
    processRssMbPeak: typeof raw.processRssMbPeak === "number" ? raw.processRssMbPeak : null,
    queueDepthAvg: typeof raw.queueDepthAvg === "number" ? raw.queueDepthAvg : null,
    queueDepthPeak: typeof raw.queueDepthPeak === "number" ? raw.queueDepthPeak : null,
    activeRunsAvg: typeof raw.activeRunsAvg === "number" ? raw.activeRunsAvg : null,
    activeRunsPeak: typeof raw.activeRunsPeak === "number" ? raw.activeRunsPeak : null,
    openIncidentsAvg: typeof raw.openIncidentsAvg === "number" ? raw.openIncidentsAvg : null,
    openIncidentsPeak: typeof raw.openIncidentsPeak === "number" ? raw.openIncidentsPeak : null,
  };
}

function normalizeReviewCumulativeWorkload(value: unknown): ReviewSessionCumulativeWorkload {
  if (!value || typeof value !== "object") {
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

  const raw = value as Partial<ReviewSessionCumulativeWorkload>;
  const taskTypeCounts =
    raw.taskTypeCounts && typeof raw.taskTypeCounts === "object"
      ? Object.fromEntries(
          Object.entries(raw.taskTypeCounts)
            .filter(([key, count]) => typeof key === "string" && typeof count === "number" && Number.isFinite(count))
            .map(([key, count]) => [key, Math.max(0, Math.floor(count))]),
        )
      : {};

  return {
    acceptedRuns: typeof raw.acceptedRuns === "number" ? raw.acceptedRuns : 0,
    completedRuns: typeof raw.completedRuns === "number" ? raw.completedRuns : 0,
    successfulRuns: typeof raw.successfulRuns === "number" ? raw.successfulRuns : 0,
    failedRuns: typeof raw.failedRuns === "number" ? raw.failedRuns : 0,
    retriedRuns: typeof raw.retriedRuns === "number" ? raw.retriedRuns : 0,
    pendingRuns: typeof raw.pendingRuns === "number" ? raw.pendingRuns : 0,
    totalCostUsd: typeof raw.totalCostUsd === "number" ? raw.totalCostUsd : 0,
    latencySampleCount: typeof raw.latencySampleCount === "number" ? raw.latencySampleCount : 0,
    latencySumMs: typeof raw.latencySumMs === "number" ? raw.latencySumMs : 0,
    peakLatencyMs: typeof raw.peakLatencyMs === "number" ? raw.peakLatencyMs : null,
    taskTypeCounts,
    lastAcceptedAt: typeof raw.lastAcceptedAt === "string" ? raw.lastAcceptedAt : null,
    lastCompletedAt: typeof raw.lastCompletedAt === "string" ? raw.lastCompletedAt : null,
  };
}

function normalizeReviewWorkloadSummary(value: unknown, startedAt: string): ReviewSessionWorkloadSummary {
  if (!value || typeof value !== "object") {
    return {
      windowStartedAt: startedAt,
      windowEndedAt: startedAt,
      consideredRuns: 0,
      completedRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      retryingRuns: 0,
      pendingRuns: 0,
      averageLatencyMs: null,
      p95LatencyMs: null,
      totalCostUsd: 0,
      topTaskTypes: [],
      cumulative: {
        acceptedRuns: 0,
        completedRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        retriedRuns: 0,
        pendingRuns: 0,
        totalCostUsd: 0,
        averageLatencyMs: null,
        peakLatencyMs: null,
        lastAcceptedAt: null,
        lastCompletedAt: null,
        topTaskTypes: [],
      },
    };
  }

  const raw = value as Partial<ReviewSessionWorkloadSummary>;
  return {
    windowStartedAt:
      typeof raw.windowStartedAt === "string" && raw.windowStartedAt.length > 0
        ? raw.windowStartedAt
        : startedAt,
    windowEndedAt:
      typeof raw.windowEndedAt === "string" && raw.windowEndedAt.length > 0
        ? raw.windowEndedAt
        : startedAt,
    consideredRuns: typeof raw.consideredRuns === "number" ? raw.consideredRuns : 0,
    completedRuns: typeof raw.completedRuns === "number" ? raw.completedRuns : 0,
    successfulRuns: typeof raw.successfulRuns === "number" ? raw.successfulRuns : 0,
    failedRuns: typeof raw.failedRuns === "number" ? raw.failedRuns : 0,
    retryingRuns: typeof raw.retryingRuns === "number" ? raw.retryingRuns : 0,
    pendingRuns: typeof raw.pendingRuns === "number" ? raw.pendingRuns : 0,
    averageLatencyMs: typeof raw.averageLatencyMs === "number" ? raw.averageLatencyMs : null,
    p95LatencyMs: typeof raw.p95LatencyMs === "number" ? raw.p95LatencyMs : null,
    totalCostUsd: typeof raw.totalCostUsd === "number" ? raw.totalCostUsd : 0,
    topTaskTypes: Array.isArray(raw.topTaskTypes)
      ? raw.topTaskTypes
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const typed = item as { type?: unknown; count?: unknown };
            if (typeof typed.type !== "string" || typeof typed.count !== "number") return null;
            return {
              type: typed.type,
              count: typed.count,
            };
          })
          .filter((item): item is { type: string; count: number } => item !== null)
      : [],
    cumulative:
      raw.cumulative && typeof raw.cumulative === "object"
        ? {
            acceptedRuns:
              typeof raw.cumulative.acceptedRuns === "number" ? raw.cumulative.acceptedRuns : 0,
            completedRuns:
              typeof raw.cumulative.completedRuns === "number" ? raw.cumulative.completedRuns : 0,
            successfulRuns:
              typeof raw.cumulative.successfulRuns === "number" ? raw.cumulative.successfulRuns : 0,
            failedRuns:
              typeof raw.cumulative.failedRuns === "number" ? raw.cumulative.failedRuns : 0,
            retriedRuns:
              typeof raw.cumulative.retriedRuns === "number" ? raw.cumulative.retriedRuns : 0,
            pendingRuns:
              typeof raw.cumulative.pendingRuns === "number" ? raw.cumulative.pendingRuns : 0,
            totalCostUsd:
              typeof raw.cumulative.totalCostUsd === "number" ? raw.cumulative.totalCostUsd : 0,
            averageLatencyMs:
              typeof raw.cumulative.averageLatencyMs === "number" ? raw.cumulative.averageLatencyMs : null,
            peakLatencyMs:
              typeof raw.cumulative.peakLatencyMs === "number" ? raw.cumulative.peakLatencyMs : null,
            lastAcceptedAt:
              typeof raw.cumulative.lastAcceptedAt === "string" ? raw.cumulative.lastAcceptedAt : null,
            lastCompletedAt:
              typeof raw.cumulative.lastCompletedAt === "string" ? raw.cumulative.lastCompletedAt : null,
            topTaskTypes: Array.isArray(raw.cumulative.topTaskTypes)
              ? raw.cumulative.topTaskTypes
                  .map((item) => {
                    if (!item || typeof item !== "object") return null;
                    const typed = item as { type?: unknown; count?: unknown };
                    if (typeof typed.type !== "string" || typeof typed.count !== "number") return null;
                    return {
                      type: typed.type,
                      count: typed.count,
                    };
                  })
                  .filter((item): item is { type: string; count: number } => item !== null)
              : [],
          }
        : {
            acceptedRuns: 0,
            completedRuns: 0,
            successfulRuns: 0,
            failedRuns: 0,
            retriedRuns: 0,
            pendingRuns: 0,
            totalCostUsd: 0,
            averageLatencyMs: null,
            peakLatencyMs: null,
            lastAcceptedAt: null,
            lastCompletedAt: null,
            topTaskTypes: [],
          },
  };
}

function normalizeReviewDerivedSummary(value: unknown): ReviewSessionDerivedSummary | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ReviewSessionDerivedSummary>;
  if (
    typeof raw.generatedAt !== "string" ||
    typeof raw.durationSeconds !== "number" ||
    typeof raw.linkedRunCount !== "number" ||
    typeof raw.linkedRunCostUsd !== "number" ||
    typeof raw.observedIncidentCount !== "number"
  ) {
    return null;
  }
  const bucketStats: Partial<Record<ReviewSessionBucket, ReviewSessionSummaryBucketStats>> = {};
  if (raw.bucketStats && typeof raw.bucketStats === "object") {
    for (const [key, item] of Object.entries(raw.bucketStats)) {
      const normalized = normalizeReviewBucketStats(item);
      if (normalized) {
        bucketStats[normalizeReviewBucket(key)] = normalized;
      }
    }
  }
  return {
    generatedAt: raw.generatedAt,
    durationSeconds: raw.durationSeconds,
    startupHandoffSeconds:
      typeof raw.startupHandoffSeconds === "number" ? raw.startupHandoffSeconds : null,
    bucketStats,
    linkedRunCount: raw.linkedRunCount,
    linkedRunCostUsd: raw.linkedRunCostUsd,
    linkedRunAverageLatencyMs:
      typeof raw.linkedRunAverageLatencyMs === "number"
        ? raw.linkedRunAverageLatencyMs
        : null,
    observedIncidentCount: raw.observedIncidentCount,
    telemetry: normalizeReviewTelemetrySummary(raw.telemetry),
    workload: normalizeReviewWorkloadSummary(raw.workload, raw.generatedAt),
  };
}

function normalizeReviewBucketTransition(value: unknown): ReviewSessionBucketTransition | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ReviewSessionBucketTransition>;
  if (typeof raw.capturedAt !== "string") {
    return null;
  }
  return {
    bucket: normalizeReviewBucket(raw.bucket),
    capturedAt: raw.capturedAt,
    note: typeof raw.note === "string" ? raw.note : null,
  };
}

function normalizeReviewSessionRecord(value: unknown): ReviewSessionRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ReviewSessionRecord>;
  const machine = normalizeReviewMachineProfile(raw.machine);
  if (
    typeof raw.id !== "string" ||
    typeof raw.state !== "string" ||
    typeof raw.title !== "string" ||
    typeof raw.createdAt !== "string" ||
    typeof raw.startedAt !== "string" ||
    typeof raw.baselineStartedAt !== "string" ||
    typeof raw.baselineEndedAt !== "string" ||
    typeof raw.startupStartedAt !== "string" ||
    !machine
  ) {
    return null;
  }
  return {
    id: raw.id,
    source: "bootstrap_handoff",
    state:
      raw.state === "pending_handoff" ||
      raw.state === "active" ||
      raw.state === "completed" ||
      raw.state === "handoff_failed"
        ? raw.state
        : "handoff_failed",
    title: raw.title,
    createdAt: raw.createdAt,
    startedAt: raw.startedAt,
    endedAt: typeof raw.endedAt === "string" ? raw.endedAt : null,
    baselineStartedAt: raw.baselineStartedAt,
    baselineEndedAt: raw.baselineEndedAt,
    startupStartedAt: raw.startupStartedAt,
    handoffReceivedAt:
      typeof raw.handoffReceivedAt === "string" ? raw.handoffReceivedAt : null,
    activeBucket: normalizeReviewBucket(raw.activeBucket),
    capturePlan: normalizeReviewCapturePlan(raw.capturePlan),
    machine,
    baselineSummary: normalizeReviewBaselineSummary(raw.baselineSummary),
    bucketTimeline: Array.isArray(raw.bucketTimeline)
      ? raw.bucketTimeline
          .map(normalizeReviewBucketTransition)
          .filter((item): item is ReviewSessionBucketTransition => item !== null)
      : [],
    scenarioNotes: Array.isArray(raw.scenarioNotes)
      ? raw.scenarioNotes
          .map(normalizeReviewNote)
          .filter((item): item is ReviewSessionNote => item !== null)
      : [],
    linkedRunIds: normalizeStringArray(raw.linkedRunIds, 100),
    cumulativeWorkload: normalizeReviewCumulativeWorkload(raw.cumulativeWorkload),
    summary: normalizeReviewDerivedSummary(raw.summary),
    failureReason: typeof raw.failureReason === "string" ? raw.failureReason : null,
  };
}

function normalizeReviewTelemetrySample(value: unknown): ReviewTelemetrySample | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ReviewTelemetrySample>;
  const host = raw.host as ReviewTelemetrySample["host"] | undefined;
  const processInfo = raw.process as ReviewTelemetrySample["process"] | undefined;
  const activity = raw.activity as ReviewTelemetrySample["activity"] | undefined;
  if (
    typeof raw.reviewSessionId !== "string" ||
    typeof raw.capturedAt !== "string" ||
    !host ||
    typeof host.cpuPercent !== "number" ||
    typeof host.load1 !== "number" ||
    typeof host.load5 !== "number" ||
    typeof host.load15 !== "number" ||
    typeof host.memoryUsedBytes !== "number" ||
    typeof host.memoryTotalBytes !== "number" ||
    !processInfo ||
    !activity ||
    typeof activity.openIncidents !== "number" ||
    typeof activity.queueDepth !== "number" ||
    typeof activity.activeRuns !== "number"
  ) {
    return null;
  }
  return {
    reviewSessionId: raw.reviewSessionId,
    capturedAt: raw.capturedAt,
    bucket: normalizeReviewBucket(raw.bucket),
    source: raw.source === "bootstrap" ? "bootstrap" : "orchestrator",
    host,
    process: {
      rssBytes: typeof processInfo.rssBytes === "number" ? processInfo.rssBytes : null,
      heapUsedBytes:
        typeof processInfo.heapUsedBytes === "number" ? processInfo.heapUsedBytes : null,
      heapTotalBytes:
        typeof processInfo.heapTotalBytes === "number" ? processInfo.heapTotalBytes : null,
      uptimeSec: typeof processInfo.uptimeSec === "number" ? processInfo.uptimeSec : null,
    },
    activity: {
      openIncidents: activity.openIncidents,
      queueDepth: activity.queueDepth,
      activeRuns: activity.activeRuns,
      recentRunIds: normalizeStringArray(activity.recentRunIds, 10),
    },
    tags: normalizeStringArray(raw.tags, 20),
  };
}


function normalizeTaskQueueAttempts(value: unknown): TaskQueueAttemptRecord[] {
  if (!Array.isArray(value)) return [];
  const allowedStatuses = new Set<TaskQueueAttemptRecord["status"]>([
    "admitted",
    "running",
    "awaiting-approval",
    "coordination-blocked",
    "success",
    "failed",
  ]);
  const normalized: TaskQueueAttemptRecord[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
      if (
        typeof record.attemptId !== "string" ||
        typeof record.taskId !== "string" ||
        typeof record.admittedAt !== "string" ||
        !allowedStatuses.has(record.status as TaskQueueAttemptRecord["status"])
      ) {
        continue;
      }
      const attempt = Number(record.attempt);
      normalized.push({
        attemptId: record.attemptId,
        taskId: record.taskId,
        attempt: Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1,
        status: record.status as TaskQueueAttemptRecord["status"],
        admittedAt: record.admittedAt,
        startedAt:
          typeof record.startedAt === "string" ? record.startedAt : null,
        completedAt:
          typeof record.completedAt === "string" ? record.completedAt : null,
        sourceTaskId:
          typeof record.sourceTaskId === "string" ? record.sourceTaskId : null,
        detail: typeof record.detail === "string" ? record.detail : null,
      });
  }
  return normalized.slice(-TASK_QUEUE_ATTEMPT_LIMIT);
}

function updateQueueAttemptForRestart(
  execution: TaskExecutionRecord,
  taskId: string,
  status: TaskQueueAttemptRecord["status"],
  timestamp: string,
  detail: string,
) {
  const attempt = execution.queueAttempts?.find(
    (candidate) => candidate.taskId === taskId,
  );
  if (!attempt) return;
  attempt.status = status;
  attempt.detail = detail;
  attempt.completedAt = timestamp;
}

function failActiveQueueAttempts(
  execution: TaskExecutionRecord,
  timestamp: string,
  detail: string,
) {
  for (const attempt of execution.queueAttempts ?? []) {
    if (attempt.status !== "admitted" && attempt.status !== "running") continue;
    attempt.status = "failed";
    attempt.completedAt = timestamp;
    attempt.detail = detail;
  }
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
  const store = createStateStore<OrchestratorState>(path);

  const normalizeParsedState = (parsed: OrchestratorState) => {
    return {
      ...createDefaultState(),
      ...parsed,
      taskHistory: parsed.taskHistory?.slice(-historyLimit) ?? [],
      taskExecutions:
        parsed.taskExecutions?.slice(-TASK_EXECUTION_LIMIT).map((execution) => ({
          ...execution,
          queueAttempts: normalizeTaskQueueAttempts(execution.queueAttempts),
        })) ?? [],
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
      reviewSessions:
        parsed.reviewSessions
          ?.slice(-REVIEW_SESSION_LIMIT)
          .map(normalizeReviewSessionRecord)
          .filter((item): item is ReviewSessionRecord => item !== null) ?? [],
      reviewTelemetrySamples:
        parsed.reviewTelemetrySamples
          ?.slice(-REVIEW_TELEMETRY_SAMPLE_LIMIT)
          .map(normalizeReviewTelemetrySample)
          .filter((item): item is ReviewTelemetrySample => item !== null) ?? [],
      businessValue: {
        ...createDefaultBusinessValueState(),
        ...(parsed.businessValue ?? {}),
        cycles: parsed.businessValue?.cycles?.slice(-BUSINESS_VALUE_CYCLE_LIMIT) ?? [],
        candidates:
          parsed.businessValue?.candidates?.slice(0, BUSINESS_VALUE_CANDIDATE_LIMIT) ?? [],
        approvalGatedCandidates: parsed.businessValue?.approvalGatedCandidates ?? [],
        unsupportedCandidates: parsed.businessValue?.unsupportedCandidates ?? [],
        scheduler: {
          ...createDefaultBusinessValueSchedulerState(),
          ...(parsed.businessValue?.scheduler ?? {}),
        },
      },
    };
  };

  try {
    const parsed = await store.load();
    if (!parsed || typeof parsed !== "object") {
      return createDefaultState();
    }
    return normalizeParsedState(parsed as OrchestratorState);
  } catch (error) {
    if (!isMongoStateTarget(path) && !isSqliteStateTarget(path)) {
      console.warn(
        `[state] Failed to parse state file, starting fresh: ${(error as Error).message}`,
      );
      return createDefaultState();
    }
    throw error;
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
  const store = createStateStore<OrchestratorState>(path);
  await store.ensureReady();
  const prepared: OrchestratorState = {
    ...state,
    taskHistory: state.taskHistory.slice(-historyLimit),
    taskExecutions: state.taskExecutions.slice(-TASK_EXECUTION_LIMIT).map((execution) => ({
      ...execution,
      queueAttempts: normalizeTaskQueueAttempts(execution.queueAttempts),
    })),
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
    reviewSessions: state.reviewSessions.slice(-REVIEW_SESSION_LIMIT),
    reviewTelemetrySamples: state.reviewTelemetrySamples.slice(
      -REVIEW_TELEMETRY_SAMPLE_LIMIT,
    ),
    businessValue: state.businessValue
      ? {
          ...state.businessValue,
          cycles: state.businessValue.cycles.slice(-BUSINESS_VALUE_CYCLE_LIMIT),
          candidates: state.businessValue.candidates.slice(0, BUSINESS_VALUE_CANDIDATE_LIMIT),
        }
      : createDefaultBusinessValueState(),
    updatedAt: new Date().toISOString(),
  };

  await store.save(prepared);
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
    reviewSessions: [],
    reviewTelemetrySamples: [],
    businessValue: createDefaultBusinessValueState(),
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
    if (retryRecoveryKeys.has(execution.idempotencyKey)) {
      failActiveQueueAttempts(
        execution,
        now,
        "admitted retry queue attempt was interrupted before dispatch and will be recovered from persisted retry state",
      );
      continue;
    }

    const baseMessage =
      execution.lastError && execution.lastError.trim().length > 0
        ? execution.lastError
        : "retry interrupted before requeue";
    const recoveryMessage = `${baseMessage} (orchestrator restarted before retry dispatch)`;

    execution.status = "failed";
    execution.lastHandledAt = now;
    execution.lastError = recoveryMessage;
    failActiveQueueAttempts(execution, now, recoveryMessage);
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
      updateQueueAttemptForRestart(
        execution,
        latestTerminalResult.taskId,
        latestTerminalResult.state === "success" ? "success" : "failed",
        execution.lastHandledAt,
        latestTerminalResult.detail,
      );
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
      const approvalEvent = [...relatedWorkflowEvents]
        .reverse()
        .find(
          (event) =>
            event.stage === "approval" && event.stopCode === "awaiting-approval",
        );
      updateQueueAttemptForRestart(
        execution,
        approvalEvent?.taskId ?? execution.taskId,
        "awaiting-approval",
        approvalEvent?.timestamp ?? now,
        approvalEvent?.detail ?? "task remains on a persisted approval hold",
      );
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
    failActiveQueueAttempts(execution, now, interruptedMessage);
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
