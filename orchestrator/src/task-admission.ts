import { appendWorkflowEventRecord } from "./state.js";
import type {
  OrchestratorState,
  Task,
  TaskAdmissionResult,
  TaskExecutionRecord,
  TaskQueueAttemptRecord,
  TaskQueueAttemptStatus,
} from "./types.js";

const QUEUE_ATTEMPT_LIMIT = 25;

function normalizePositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function resolveIdempotencyKey(task: Task) {
  return typeof task.idempotencyKey === "string" && task.idempotencyKey.trim().length > 0
    ? task.idempotencyKey.trim()
    : task.id;
}

function createQueueAttempt(
  task: Task,
  admittedAt: string,
  sourceTaskId: string | null = null,
): TaskQueueAttemptRecord {
  return {
    attemptId: task.id,
    taskId: task.id,
    attempt: normalizePositiveInteger(task.attempt, 1),
    status: "admitted",
    admittedAt,
    startedAt: null,
    completedAt: null,
    sourceTaskId,
    detail: null,
  };
}

function appendQueueAttempt(
  execution: TaskExecutionRecord,
  attempt: TaskQueueAttemptRecord,
) {
  execution.queueAttempts = [
    ...(execution.queueAttempts ?? []).filter(
      (candidate) => candidate.attemptId !== attempt.attemptId,
    ),
    attempt,
  ].slice(-QUEUE_ATTEMPT_LIMIT);
}

function buildAdmissionResult(
  task: Task,
  result: Omit<TaskAdmissionResult, "runId" | "attemptId"> & {
    runId?: string;
    attemptId?: string;
  },
): TaskAdmissionResult {
  return {
    ...result,
    runId: result.runId ?? resolveIdempotencyKey(task),
    attemptId: result.attemptId ?? task.id,
  };
}

function recordDuplicateSuppressed(
  state: OrchestratorState,
  task: Task,
  execution: TaskExecutionRecord,
  reason: string,
  timestamp: string,
) {
  appendWorkflowEventRecord(state, {
    eventId: `queue-suppressed:${task.id}`,
    runId: execution.idempotencyKey,
    taskId: task.id,
    type: task.type,
    stage: "queue",
    state: "duplicate-suppressed",
    timestamp,
    source: "admission",
    actor:
      typeof task.payload.__actor === "string" && task.payload.__actor.trim().length > 0
        ? task.payload.__actor.trim()
        : "system",
    nodeId: `admission:${execution.idempotencyKey}`,
    detail: `${task.type} was not queued because admission suppressed ${reason}.`,
    evidence: [
      task.id,
      execution.taskId,
      execution.idempotencyKey,
      `existing-status:${execution.status}`,
      `reason:${reason}`,
    ],
    attempt: normalizePositiveInteger(task.attempt, 1),
    stopCode: reason,
    relatedRunId: execution.idempotencyKey,
    classification: "duplicate-suppressed",
  });
}

export function admitTaskExecution(
  state: OrchestratorState,
  task: Task,
  options: {
    now?: string;
    defaultMaxRetries?: number;
  } = {},
): TaskAdmissionResult {
  const now = options.now ?? new Date().toISOString();
  const idempotencyKey = resolveIdempotencyKey(task);
  const attempt = normalizePositiveInteger(task.attempt, 1);
  const maxRetries = normalizeNonNegativeInteger(
    task.maxRetries,
    normalizeNonNegativeInteger(options.defaultMaxRetries, 2),
  );
  const existing = state.taskExecutions.find(
    (execution) => execution.idempotencyKey === idempotencyKey,
  );

  const activeDriftRepair =
    !existing && task.type === "drift-repair"
      ? state.taskExecutions.find(
          (execution) =>
            execution.type === "drift-repair" &&
            (execution.status === "pending" ||
              execution.status === "running" ||
              execution.status === "retrying"),
        )
      : undefined;

  if (activeDriftRepair) {
    const reason = "coalesced-active-drift-repair";
    recordDuplicateSuppressed(state, task, activeDriftRepair, reason, now);
    return buildAdmissionResult(task, {
      admitted: false,
      kind: "duplicate-suppressed",
      reason,
      runId: activeDriftRepair.idempotencyKey,
      existingStatus: activeDriftRepair.status,
      sourceTaskId: activeDriftRepair.taskId,
    });
  }

  if (!existing) {
    const created: TaskExecutionRecord = {
      taskId: task.id,
      idempotencyKey,
      type: task.type,
      status: "pending",
      attempt,
      maxRetries,
      startedAt: null,
      completedAt: null,
      lastHandledAt: now,
      lastError: undefined,
      resultSummary: undefined,
      businessTraceability:
        typeof task.payload.__businessTraceability === "object" &&
        task.payload.__businessTraceability !== null
          ? (task.payload.__businessTraceability as TaskExecutionRecord["businessTraceability"])
          : undefined,
      accounting: null,
      queueAttempts: [createQueueAttempt(task, now)],
    };
    state.taskExecutions.push(created);
    return buildAdmissionResult(task, {
      admitted: true,
      kind: "new",
      reason: "new-run",
      sourceTaskId: null,
    });
  }

  const recovery = state.taskRetryRecoveries.find(
    (record) => record.idempotencyKey === idempotencyKey,
  );
  const recoveryPayloadAttempt = normalizePositiveInteger(
    recovery?.payload.__attempt,
    recovery?.attempt ?? -1,
  );
  const retryContractMatches =
    existing.status === "retrying" &&
    recovery !== undefined &&
    recovery.type === task.type &&
    recovery.attempt === attempt &&
    recoveryPayloadAttempt === attempt &&
    recovery.maxRetries === maxRetries;
  const retryAlreadyActive =
    existing.status === "retrying" &&
    (existing.queueAttempts ?? []).some(
      (candidate) =>
        candidate.attempt === attempt &&
        (candidate.status === "admitted" || candidate.status === "running"),
    );

  if (retryContractMatches && !retryAlreadyActive) {
    appendQueueAttempt(
      existing,
      createQueueAttempt(task, now, recovery.sourceTaskId),
    );
    existing.attempt = attempt;
    existing.maxRetries = maxRetries;
    existing.lastHandledAt = now;
    return buildAdmissionResult(task, {
      admitted: true,
      kind: "retry",
      reason: "persisted-retry-recovery",
      existingStatus: existing.status,
      sourceTaskId: recovery.sourceTaskId,
    });
  }

  const reason =
    existing.type !== task.type
      ? "duplicate-type-mismatch"
      : retryAlreadyActive
        ? "retry-attempt-already-admitted"
        : existing.status === "retrying"
          ? recovery
            ? "retry-recovery-mismatch"
            : "retry-recovery-missing"
          : `duplicate-${existing.status}`;
  recordDuplicateSuppressed(state, task, existing, reason, now);
  return buildAdmissionResult(task, {
    admitted: false,
    kind: "duplicate-suppressed",
    reason,
    existingStatus: existing.status,
    sourceTaskId: recovery?.sourceTaskId ?? null,
  });
}

export function updateTaskQueueAttempt(
  execution: TaskExecutionRecord,
  taskId: string,
  status: TaskQueueAttemptStatus,
  options: {
    timestamp?: string;
    detail?: string | null;
  } = {},
) {
  const attempt = execution.queueAttempts?.find(
    (candidate) => candidate.taskId === taskId,
  );
  if (!attempt) return null;

  const timestamp = options.timestamp ?? new Date().toISOString();
  attempt.status = status;
  attempt.detail = options.detail ?? attempt.detail ?? null;
  if (status === "running") {
    attempt.startedAt = attempt.startedAt ?? timestamp;
  }
  if (
    status === "awaiting-approval" ||
    status === "coordination-blocked" ||
    status === "success" ||
    status === "failed"
  ) {
    attempt.completedAt = timestamp;
  }
  return attempt;
}
