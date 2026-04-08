import { describe, expect, it } from "vitest";
import {
  extractReviewSessionCumulativeSummary,
  resolveReviewRunLinkTarget,
  resolveDispatchTimingPlan,
  summarizeExecutionStatuses,
} from "../scripts/live-rate-shaped-dispatch.ts";

describe("live rate-shaped dispatch review metadata linking", () => {
  it("prefers a real accepted task id when linking workload metadata to a review session", () => {
    expect(
      resolveReviewRunLinkTarget("live-rate-123", ["task-1", "task-2"]),
    ).toEqual({
      runId: "task-1",
      mode: "representative-task",
    });
  });

  it("falls back to the workload run id when no accepted task ids are available", () => {
    expect(resolveReviewRunLinkTarget("live-rate-123", [])).toEqual({
      runId: "live-rate-123",
      mode: "workload-run",
    });
  });

  it("summarizes retained execution statuses without pretending a rolling history sample is the whole run", () => {
    expect(
      summarizeExecutionStatuses([
        { taskId: "task-1", status: "success" },
        { taskId: "task-2", status: "failed" },
        { taskId: "task-3", status: "retrying" },
        { taskId: "task-4", status: "pending" },
        { taskId: "task-5", status: "running" },
      ]),
    ).toEqual({
      success: 1,
      failed: 1,
      retrying: 1,
      pendingOrRunning: 2,
    });
  });

  it("paces the target task count across the requested soak duration", () => {
    expect(resolveDispatchTimingPlan(5000, null, 24 * 60 * 60 * 1000)).toMatchObject({
      mode: "duration-paced",
      targetDurationMs: 24 * 60 * 60 * 1000,
    });
    expect(resolveDispatchTimingPlan(5000, null, 24 * 60 * 60 * 1000).intervalMs).toBe(17283);
  });

  it("extracts cumulative review-session totals for sponsor-facing soak reporting", () => {
    expect(
      extractReviewSessionCumulativeSummary({
        session: {
          summary: {
            workload: {
              cumulative: {
                acceptedRuns: 5000,
                completedRuns: 4980,
                successfulRuns: 4975,
                failedRuns: 5,
                retriedRuns: 12,
                pendingRuns: 20,
                totalCostUsd: 1.42,
                averageLatencyMs: 380,
                peakLatencyMs: 910,
                topTaskTypes: [{ type: "heartbeat", count: 2750 }],
                lastAcceptedAt: "2026-04-08T12:00:00.000Z",
                lastCompletedAt: "2026-04-08T12:01:00.000Z",
              },
            },
          },
        },
      }),
    ).toEqual({
      acceptedRuns: 5000,
      completedRuns: 4980,
      successfulRuns: 4975,
      failedRuns: 5,
      retriedRuns: 12,
      pendingRuns: 20,
      totalCostUsd: 1.42,
      averageLatencyMs: 380,
      peakLatencyMs: 910,
      topTaskTypes: [{ type: "heartbeat", count: 2750 }],
      lastAcceptedAt: "2026-04-08T12:00:00.000Z",
      lastCompletedAt: "2026-04-08T12:01:00.000Z",
    });
  });
});
