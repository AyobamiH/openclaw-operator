import { num, str, toArray, toNullableString } from "@/lib/safe-render";

export interface RunRowVM {
  runId: string;
  taskId: string | null;
  type: string;
  status: string;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  model: string | null;
  cost: number;
  latency: number | null;
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  } | null;
  budget: Record<string, unknown> | null;
  accounting: Record<string, unknown> | null;
  error: string | null;
  lastHandledAt: string | null;
  repair: Record<string, unknown> | null;
  history: Array<Record<string, unknown>>;
  attempt: number;
  maxRetries: number;
  workflow: {
    stage: string | null;
    graphStatus: string | null;
    currentStage: string | null;
    blockedStage: string | null;
    stopReason: string | null;
    stopClassification: string | null;
    awaitingApproval: boolean;
    retryScheduled: boolean;
    nextRetryAt: string | null;
    repairStatus: string | null;
    eventCount: number;
    latestEventAt: string | null;
    stageDurations: Record<string, number>;
    timingBreakdown: Record<string, {
      startedAt?: string | null;
      completedAt?: string | null;
      durationMs?: number | null;
      eventCount?: number;
    }>;
    nodeCount: number;
    edgeCount: number;
  };
  approval: {
    required: boolean;
    status: string | null;
    requestedAt: string | null;
    decidedAt: string | null;
    decidedBy: string | null;
    note: string | null;
  };
  events: Array<Record<string, unknown>>;
  workflowGraph: Record<string, unknown> | null;
  proofLinks: Array<Record<string, unknown>>;
  operatorPreview: RunOperatorPreviewVM | null;
}

export interface RunOperatorPreviewVM {
  status: string;
  workflowStage: string;
  operatorSummary: string;
  recommendedNextActions: string[];
  knowledgeFreshnessStatus: string | null;
  knowledgeWarnings: string[];
  reviewRecommended: boolean;
}

export interface RunTimelineEvent {
  key: string;
  label: string;
  detail: string;
  timestamp: string | null;
  tone: "healthy" | "warning" | "error" | "info" | "neutral";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function buildRunOperatorPreview(result: unknown): RunOperatorPreviewVM | null {
  const raw = asRecord(result);
  if (!raw) return null;

  const contract = asRecord(raw.specialistContract);
  const operatorSummary = str(contract?.operatorSummary ?? raw.operatorSummary, "").trim();
  const recommendedNextActions = toArray<string>(
    contract?.recommendedNextActions ?? raw.recommendedNextActions,
  )
    .map((entry) => str(entry, "").trim())
    .filter(Boolean)
    .slice(0, 3);
  const knowledgeFreshness = asRecord(raw.knowledgeFreshness);
  const knowledgeWarnings = toArray<string>(knowledgeFreshness?.warnings)
    .map((entry) => str(entry, "").trim())
    .filter(Boolean)
    .slice(0, 2);
  const knowledgeFreshnessStatus = knowledgeFreshness
    ? str(knowledgeFreshness.status, "unknown")
    : null;
  const reviewRecommended = knowledgeFreshness?.reviewRecommended === true;
  const status = str(contract?.status, "unknown");
  const workflowStage = str(contract?.workflowStage, "runtime");

  if (
    !operatorSummary &&
    recommendedNextActions.length === 0 &&
    knowledgeWarnings.length === 0 &&
    !knowledgeFreshnessStatus &&
    !contract
  ) {
    return null;
  }

  return {
    status,
    workflowStage,
    operatorSummary,
    recommendedNextActions,
    knowledgeFreshnessStatus,
    knowledgeWarnings,
    reviewRecommended,
  };
}

export function buildRunRows(data: any): { runs: RunRowVM[]; total: number; hasMore: boolean } {
  const runs = toArray(data?.runs).map((r: any) => ({
    runId: str(r?.runId ?? r?.id, ""),
    taskId: toNullableString(r?.taskId ?? r?.task_id),
    type: str(r?.type, "unknown"),
    status: str(r?.status, "unknown"),
    createdAt: toNullableString(r?.createdAt ?? r?.created_at),
    startedAt: toNullableString(r?.startedAt ?? r?.started_at),
    completedAt: toNullableString(r?.completedAt ?? r?.completed_at),
    model: toNullableString(r?.model),
    cost: num(r?.cost),
    latency: typeof r?.latency === "number" ? r.latency : null,
    usage:
      r?.usage && typeof r.usage === "object"
        ? {
            promptTokens:
              typeof r.usage.promptTokens === "number" ? r.usage.promptTokens : null,
            completionTokens:
              typeof r.usage.completionTokens === "number"
                ? r.usage.completionTokens
                : null,
            totalTokens:
              typeof r.usage.totalTokens === "number" ? r.usage.totalTokens : null,
          }
        : null,
    budget: r?.budget && typeof r.budget === "object" ? r.budget : null,
    accounting:
      r?.accounting && typeof r.accounting === "object"
        ? (r.accounting as Record<string, unknown>)
        : null,
    error: toNullableString(r?.error ?? r?.lastError),
    lastHandledAt: toNullableString(r?.lastHandledAt),
    repair: r?.repair && typeof r.repair === "object" ? r.repair : null,
    history: toArray<Record<string, unknown>>(r?.history),
    attempt: num(r?.attempt),
    maxRetries: num(r?.maxRetries),
    workflow: {
      stage: toNullableString(r?.workflow?.stage),
      graphStatus: toNullableString(r?.workflow?.graphStatus),
      currentStage: toNullableString(r?.workflow?.currentStage),
      blockedStage: toNullableString(r?.workflow?.blockedStage),
      stopReason: toNullableString(r?.workflow?.stopReason),
      stopClassification: toNullableString(r?.workflow?.stopClassification),
      awaitingApproval: r?.workflow?.awaitingApproval === true,
      retryScheduled: r?.workflow?.retryScheduled === true,
      nextRetryAt: toNullableString(r?.workflow?.nextRetryAt),
      repairStatus: toNullableString(r?.workflow?.repairStatus),
      eventCount: num(r?.workflow?.eventCount),
      latestEventAt: toNullableString(r?.workflow?.latestEventAt),
      stageDurations:
        r?.workflow?.stageDurations && typeof r.workflow.stageDurations === "object"
          ? (r.workflow.stageDurations as Record<string, number>)
          : {},
      timingBreakdown:
        r?.workflow?.timingBreakdown && typeof r.workflow.timingBreakdown === "object"
          ? (r.workflow.timingBreakdown as Record<string, {
              startedAt?: string | null;
              completedAt?: string | null;
              durationMs?: number | null;
              eventCount?: number;
            }>)
          : {},
      nodeCount: num(r?.workflow?.nodeCount),
      edgeCount: num(r?.workflow?.edgeCount),
    },
    approval: {
      required: r?.approval?.required === true,
      status: toNullableString(r?.approval?.status),
      requestedAt: toNullableString(r?.approval?.requestedAt),
      decidedAt: toNullableString(r?.approval?.decidedAt),
      decidedBy: toNullableString(r?.approval?.decidedBy),
      note: toNullableString(r?.approval?.note),
    },
    events: toArray<Record<string, unknown>>(r?.events),
    workflowGraph:
      r?.workflowGraph && typeof r.workflowGraph === "object"
        ? (r.workflowGraph as Record<string, unknown>)
        : null,
    proofLinks: toArray<Record<string, unknown>>(r?.proofLinks),
    operatorPreview: buildRunOperatorPreview(r?.result),
  }));

  return {
    runs,
    total: num(data?.total),
    hasMore: data?.page?.hasMore === true,
  };
}

export function buildRunDetail(data: any): RunRowVM | null {
  const r = data?.run;
  if (!r) return null;

  return {
    runId: str(r?.runId ?? r?.id, ""),
    taskId: toNullableString(r?.taskId ?? r?.task_id),
    type: str(r?.type, "unknown"),
    status: str(r?.status, "unknown"),
    createdAt: toNullableString(r?.createdAt ?? r?.created_at),
    startedAt: toNullableString(r?.startedAt ?? r?.started_at),
    completedAt: toNullableString(r?.completedAt ?? r?.completed_at),
    model: toNullableString(r?.model),
    cost: num(r?.cost),
    latency: typeof r?.latency === "number" ? r.latency : null,
    usage:
      r?.usage && typeof r.usage === "object"
        ? {
            promptTokens:
              typeof r.usage.promptTokens === "number" ? r.usage.promptTokens : null,
            completionTokens:
              typeof r.usage.completionTokens === "number"
                ? r.usage.completionTokens
                : null,
            totalTokens:
              typeof r.usage.totalTokens === "number" ? r.usage.totalTokens : null,
          }
        : null,
    budget: r?.budget && typeof r.budget === "object" ? r.budget : null,
    accounting:
      r?.accounting && typeof r.accounting === "object"
        ? (r.accounting as Record<string, unknown>)
        : null,
    error: toNullableString(r?.error ?? r?.lastError),
    lastHandledAt: toNullableString(r?.lastHandledAt),
    repair: r?.repair && typeof r.repair === "object" ? r.repair : null,
    history: toArray<Record<string, unknown>>(r?.history),
    attempt: num(r?.attempt),
    maxRetries: num(r?.maxRetries),
    workflow: {
      stage: toNullableString(r?.workflow?.stage),
      graphStatus: toNullableString(r?.workflow?.graphStatus),
      currentStage: toNullableString(r?.workflow?.currentStage),
      blockedStage: toNullableString(r?.workflow?.blockedStage),
      stopReason: toNullableString(r?.workflow?.stopReason),
      stopClassification: toNullableString(r?.workflow?.stopClassification),
      awaitingApproval: r?.workflow?.awaitingApproval === true,
      retryScheduled: r?.workflow?.retryScheduled === true,
      nextRetryAt: toNullableString(r?.workflow?.nextRetryAt),
      repairStatus: toNullableString(r?.workflow?.repairStatus),
      eventCount: num(r?.workflow?.eventCount),
      latestEventAt: toNullableString(r?.workflow?.latestEventAt),
      stageDurations:
        r?.workflow?.stageDurations && typeof r.workflow.stageDurations === "object"
          ? (r.workflow.stageDurations as Record<string, number>)
          : {},
      timingBreakdown:
        r?.workflow?.timingBreakdown && typeof r.workflow.timingBreakdown === "object"
          ? (r.workflow.timingBreakdown as Record<string, {
              startedAt?: string | null;
              completedAt?: string | null;
              durationMs?: number | null;
              eventCount?: number;
            }>)
          : {},
      nodeCount: num(r?.workflow?.nodeCount),
      edgeCount: num(r?.workflow?.edgeCount),
    },
    approval: {
      required: r?.approval?.required === true,
      status: toNullableString(r?.approval?.status),
      requestedAt: toNullableString(r?.approval?.requestedAt),
      decidedAt: toNullableString(r?.approval?.decidedAt),
      decidedBy: toNullableString(r?.approval?.decidedBy),
      note: toNullableString(r?.approval?.note),
    },
    events: toArray<Record<string, unknown>>(r?.events),
    workflowGraph:
      r?.workflowGraph && typeof r.workflowGraph === "object"
        ? (r.workflowGraph as Record<string, unknown>)
        : null,
    proofLinks: toArray<Record<string, unknown>>(r?.proofLinks),
    operatorPreview: buildRunOperatorPreview(r?.result),
  };
}

export function buildRunMetrics(runs: RunRowVM[]) {
  return {
    activeCount: runs.filter((run) => ["pending", "running", "retrying"].includes(run.status)).length,
    failedCount: runs.filter((run) => run.status === "failed").length,
    repairCount: runs.filter((run) => run.repair).length,
    retriedCount: runs.filter((run) => run.attempt > 1).length,
    totalCost: Number(runs.reduce((sum, run) => sum + (run.cost || 0), 0).toFixed(4)),
    meteredCount: runs.filter((run) => run.accounting?.metered === true).length,
  };
}

export function buildTimelineEvents(run: RunRowVM): RunTimelineEvent[] {
  if (run.events.length > 0) {
    return run.events
      .map((event, index) => {
        const state = str(event.state, "unknown");
        const tone =
          state === "success" || state === "ok" || state === "verified" || state === "approved"
            ? "healthy"
            : state === "failed" || state === "error" || state === "rejected"
              ? "error"
              : state === "retrying" || state === "scheduled" || state === "pending"
                ? "warning"
                : str(event.stage, "") === "approval"
                  ? "info"
                  : "neutral";

        return {
          key: str(event.id ?? event.eventId, `event-${index}`),
          label: `${str(event.stage, "event")}: ${state}`,
          detail: str(event.message ?? event.detail, "No detail recorded."),
          timestamp: toNullableString(event.timestamp),
          tone,
        } satisfies RunTimelineEvent;
      })
      .sort((left, right) => {
        if (!left.timestamp && !right.timestamp) return 0;
        if (!left.timestamp) return 1;
        if (!right.timestamp) return -1;
        return new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
      });
  }

  const events: RunTimelineEvent[] = [];

  if (run.createdAt) {
    events.push({
      key: "created",
      label: "Run queued",
      detail: `${run.type} entered the orchestrator queue.`,
      timestamp: run.createdAt,
      tone: "neutral",
    });
  }

  if (run.startedAt) {
    events.push({
      key: "started",
      label: "Execution started",
      detail: `Attempt ${run.attempt || 1} started against the worker path.`,
      timestamp: run.startedAt,
      tone: "info",
    });
  }

  toArray<Record<string, unknown>>(run.history).forEach((entry, index) => {
    const result = str(entry.result, "unknown");
    const message = str(entry.message, "No message recorded.");
    const timestamp = toNullableString(entry.handledAt);
    const tone =
      result === "success" || result === "completed"
        ? "healthy"
        : result === "failed" || result === "error"
          ? "error"
          : result === "retrying"
            ? "warning"
            : "neutral";

    events.push({
      key: `history-${index}`,
      label: `History: ${result}`,
      detail: message,
      timestamp,
      tone,
    });
  });

  if (run.repair) {
    events.push({
      key: "repair",
      label: `Repair: ${str(run.repair.status, "recorded")}`,
      detail: str(run.repair.summary ?? run.repair.message, "Repair metadata is attached to this run."),
      timestamp: toNullableString(run.repair.verifiedAt ?? run.repair.updatedAt ?? run.repair.detectedAt),
      tone: str(run.repair.status, "").includes("fail")
        ? "error"
        : str(run.repair.status, "").includes("verify")
          ? "healthy"
          : "warning",
    });
  }

  if (run.completedAt) {
    events.push({
      key: "completed",
      label: "Execution closed",
      detail: run.status === "failed" ? (run.error ?? "Run completed with a failure state.") : `Run finished with status ${run.status}.`,
      timestamp: run.completedAt,
      tone: run.status === "failed" ? "error" : "healthy",
    });
  }

  return events.sort((left, right) => {
    if (!left.timestamp && !right.timestamp) return 0;
    if (!left.timestamp) return 1;
    if (!right.timestamp) return -1;
    return new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
  });
}
