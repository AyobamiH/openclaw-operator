import { describe, expect, it } from "vitest";
import {
  admitTaskExecution,
  updateTaskQueueAttempt,
} from "../src/task-admission.ts";
import {
  createDefaultState,
  reconcileInFlightTaskExecutionState,
  reconcileTaskRetryRecoveryState,
} from "../src/state.ts";
import type {
  Task,
  TaskExecutionRecord,
  TaskExecutionStatus,
} from "../src/types.ts";

const NOW = "2026-07-16T16:15:00.000Z";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-attempt-1",
    type: "drift-repair",
    payload: { idempotencyKey: "run-1" },
    createdAt: Date.parse(NOW),
    idempotencyKey: "run-1",
    attempt: 1,
    maxRetries: 2,
    ...overrides,
  };
}

function execution(status: TaskExecutionStatus): TaskExecutionRecord {
  return {
    taskId: "original-task",
    idempotencyKey: "run-1",
    type: "drift-repair",
    status,
    attempt: 1,
    maxRetries: 2,
    lastHandledAt: "2026-07-16T16:00:00.000Z",
    lastError: status === "failed" ? "original failure" : undefined,
    queueAttempts: [
      {
        attemptId: "original-task",
        taskId: "original-task",
        attempt: 1,
        status:
          status === "success"
            ? "success"
            : status === "failed"
              ? "failed"
              : status === "running"
                ? "running"
                : "admitted",
        admittedAt: "2026-07-16T15:59:00.000Z",
        startedAt: status === "running" ? "2026-07-16T16:00:00.000Z" : null,
        completedAt:
          status === "success" || status === "failed"
            ? "2026-07-16T16:01:00.000Z"
            : null,
      },
    ],
  };
}

describe("central task admission", () => {
  it("creates a durable execution and queue-attempt identity before telemetry", () => {
    const state = createDefaultState();
    const incoming = task();

    const result = admitTaskExecution(state, incoming, { now: NOW });

    expect(result).toMatchObject({
      admitted: true,
      kind: "new",
      runId: "run-1",
      attemptId: "task-attempt-1",
    });
    expect(state.taskExecutions).toEqual([
      expect.objectContaining({
        taskId: "task-attempt-1",
        idempotencyKey: "run-1",
        status: "pending",
        queueAttempts: [
          expect.objectContaining({
            attemptId: "task-attempt-1",
            taskId: "task-attempt-1",
            status: "admitted",
            admittedAt: NOW,
          }),
        ],
      }),
    ]);
    expect(state.workflowEvents).toEqual([]);
  });

  it.each(["pending", "running", "success", "failed"] as const)(
    "suppresses a duplicate %s key without changing the original execution",
    (status) => {
      const state = createDefaultState();
      const original = execution(status);
      state.taskExecutions.push(original);

      const result = admitTaskExecution(state, task(), { now: NOW });

      expect(result).toMatchObject({
        admitted: false,
        kind: "duplicate-suppressed",
        reason: `duplicate-${status}`,
        existingStatus: status,
      });
      expect(original).toMatchObject({
        taskId: "original-task",
        status,
        lastError: status === "failed" ? "original failure" : undefined,
      });
      expect(original.queueAttempts).toHaveLength(1);
      expect(state.workflowEvents).toEqual([
        expect.objectContaining({
          runId: "run-1",
          taskId: "task-attempt-1",
          stage: "queue",
          state: "duplicate-suppressed",
          stopCode: `duplicate-${status}`,
        }),
      ]);
    },
  );

  it("admits a same-key retry only when persisted recovery matches", () => {
    const state = createDefaultState();
    const original = execution("retrying");
    original.queueAttempts![0]!.status = "failed";
    state.taskExecutions.push(original);
    state.taskRetryRecoveries.push({
      sourceTaskId: "original-task",
      idempotencyKey: "run-1",
      type: "drift-repair",
      payload: {
        idempotencyKey: "run-1",
        __attempt: 2,
        maxRetries: 2,
      },
      attempt: 2,
      maxRetries: 2,
      retryAt: NOW,
      scheduledAt: "2026-07-16T16:14:00.000Z",
    });

    const result = admitTaskExecution(
      state,
      task({ id: "retry-task", attempt: 2 }),
      { now: NOW },
    );

    expect(result).toMatchObject({
      admitted: true,
      kind: "retry",
      reason: "persisted-retry-recovery",
      sourceTaskId: "original-task",
    });
    expect(original.queueAttempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attemptId: "retry-task",
          taskId: "retry-task",
          attempt: 2,
          status: "admitted",
          sourceTaskId: "original-task",
        }),
      ]),
    );
  });

  it("suppresses retrying keys without matching persisted recovery", () => {
    const state = createDefaultState();
    const original = execution("retrying");
    original.queueAttempts![0]!.status = "failed";
    state.taskExecutions.push(original);

    const result = admitTaskExecution(
      state,
      task({ id: "retry-task", attempt: 2 }),
      { now: NOW },
    );

    expect(result).toMatchObject({
      admitted: false,
      reason: "retry-recovery-missing",
    });
    expect(original.queueAttempts).toHaveLength(1);
  });

  it("prevents concurrent admission of the same persisted retry attempt", () => {
    const state = createDefaultState();
    const original = execution("retrying");
    original.queueAttempts![0]!.status = "failed";
    state.taskExecutions.push(original);
    state.taskRetryRecoveries.push({
      sourceTaskId: "original-task",
      idempotencyKey: "run-1",
      type: "drift-repair",
      payload: { idempotencyKey: "run-1", __attempt: 2, maxRetries: 2 },
      attempt: 2,
      maxRetries: 2,
      retryAt: NOW,
      scheduledAt: NOW,
    });

    const first = admitTaskExecution(
      state,
      task({ id: "retry-task-1", attempt: 2 }),
      { now: NOW },
    );
    const second = admitTaskExecution(
      state,
      task({ id: "retry-task-2", attempt: 2 }),
      { now: NOW },
    );

    expect(first.admitted).toBe(true);
    expect(second).toMatchObject({
      admitted: false,
      reason: "retry-attempt-already-admitted",
    });
  });

  it("coalesces a different drift-repair identity while the mutation owner is active", () => {
    const state = createDefaultState();
    state.taskExecutions.push(execution("running"));

    const result = admitTaskExecution(
      state,
      task({
        id: "expanded-burst-attempt",
        idempotencyKey: "run-2",
        payload: {
          idempotencyKey: "run-2",
          paths: ["docs/a.md", "docs/b.md", "docs/c.md"],
        },
      }),
      { now: NOW },
    );

    expect(result).toMatchObject({
      admitted: false,
      kind: "duplicate-suppressed",
      reason: "coalesced-active-drift-repair",
      runId: "run-1",
      existingStatus: "running",
    });
    expect(state.taskExecutions).toHaveLength(1);
    expect(state.workflowEvents.at(-1)).toMatchObject({
      runId: "run-1",
      taskId: "expanded-burst-attempt",
      stopCode: "coalesced-active-drift-repair",
    });
  });

  it("preserves independent non-document work while a drift repair is active", () => {
    const state = createDefaultState();
    state.taskExecutions.push(execution("running"));

    const result = admitTaskExecution(
      state,
      task({
        id: "independent-task",
        type: "system-monitor",
        idempotencyKey: "system-monitor:independent",
        payload: { idempotencyKey: "system-monitor:independent" },
      }),
      { now: NOW },
    );

    expect(result).toMatchObject({ admitted: true, kind: "new" });
    expect(state.taskExecutions).toHaveLength(2);
  });

  it("does not rewrite a failed repair when a later burst receives a new identity", () => {
    const state = createDefaultState();
    const failed = execution("failed");
    state.taskExecutions.push(failed);

    const result = admitTaskExecution(
      state,
      task({
        id: "recovery-burst-attempt",
        idempotencyKey: "run-2",
        payload: { idempotencyKey: "run-2", paths: ["docs/c.md"] },
      }),
      { now: NOW },
    );

    expect(result).toMatchObject({ admitted: true, kind: "new", runId: "run-2" });
    expect(failed).toMatchObject({
      idempotencyKey: "run-1",
      status: "failed",
      lastError: "original failure",
    });
  });

  it("closes admitted queue attempts deterministically during restart reconciliation", () => {
    const state = createDefaultState();
    const incoming = task();
    admitTaskExecution(state, incoming, { now: NOW });
    const admitted = state.taskExecutions[0]!;

    const result = reconcileInFlightTaskExecutionState(
      state,
      "2026-07-16T16:20:00.000Z",
    );

    expect(result.interruptedCount).toBe(1);
    expect(admitted.status).toBe("failed");
    expect(admitted.queueAttempts?.[0]).toMatchObject({
      taskId: "task-attempt-1",
      status: "failed",
      completedAt: "2026-07-16T16:20:00.000Z",
    });
  });

  it("marks a lost admitted retry attempt before dispatching persisted recovery again", () => {
    const state = createDefaultState();
    const original = execution("retrying");
    original.queueAttempts![0]!.status = "failed";
    state.taskExecutions.push(original);
    state.taskRetryRecoveries.push({
      sourceTaskId: "original-task",
      idempotencyKey: "run-1",
      type: "drift-repair",
      payload: { idempotencyKey: "run-1", __attempt: 2, maxRetries: 2 },
      attempt: 2,
      maxRetries: 2,
      retryAt: NOW,
      scheduledAt: NOW,
    });
    admitTaskExecution(
      state,
      task({ id: "lost-retry-task", attempt: 2 }),
      { now: NOW },
    );

    const result = reconcileTaskRetryRecoveryState(
      state,
      "2026-07-16T16:20:00.000Z",
    );

    expect(result.recoveredRetryCount).toBe(0);
    expect(original.status).toBe("retrying");
    expect(original.queueAttempts?.find((item) => item.taskId === "lost-retry-task"))
      .toMatchObject({
        status: "failed",
        completedAt: "2026-07-16T16:20:00.000Z",
      });
  });

  it("updates the admitted attempt lifecycle without changing run identity", () => {
    const state = createDefaultState();
    admitTaskExecution(state, task(), { now: NOW });
    const admitted = state.taskExecutions[0]!;

    updateTaskQueueAttempt(admitted, "task-attempt-1", "running", {
      timestamp: "2026-07-16T16:16:00.000Z",
    });
    updateTaskQueueAttempt(admitted, "task-attempt-1", "success", {
      timestamp: "2026-07-16T16:17:00.000Z",
      detail: "completed",
    });

    expect(admitted.idempotencyKey).toBe("run-1");
    expect(admitted.queueAttempts?.[0]).toMatchObject({
      attemptId: "task-attempt-1",
      startedAt: "2026-07-16T16:16:00.000Z",
      completedAt: "2026-07-16T16:17:00.000Z",
      status: "success",
      detail: "completed",
    });
  });
});
