import { describe, expect, it } from "vitest";
import {
  buildQueueTopUpSummary,
  extractReviewSessionCumulativeSummary,
  resolveOrchestratorConfigPath,
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

  it("summarizes queue-top-up capacity windows without depending on rolling task history retention", () => {
    expect(
      buildQueueTopUpSummary(
        [
          {
            capturedAt: "2026-04-08T00:00:00.000Z",
            acceptedRuns: 100,
            completedRuns: 80,
            successfulRuns: 78,
            failedRuns: 2,
            retriedRuns: 3,
            pendingRuns: 20,
            queueQueued: 12,
            queueProcessing: 5,
          },
          {
            capturedAt: "2026-04-08T00:30:00.000Z",
            acceptedRuns: 400,
            completedRuns: 360,
            successfulRuns: 352,
            failedRuns: 8,
            retriedRuns: 10,
            pendingRuns: 40,
            queueQueued: 20,
            queueProcessing: 9,
          },
          {
            capturedAt: "2026-04-08T01:00:00.000Z",
            acceptedRuns: 700,
            completedRuns: 650,
            successfulRuns: 640,
            failedRuns: 10,
            retriedRuns: 14,
            pendingRuns: 50,
            queueQueued: 18,
            queueProcessing: 7,
          },
        ],
        "2026-04-08T00:00:00.000Z",
        "2026-04-08T01:00:00.000Z",
        600,
        2,
        0,
        1,
      ),
    ).toEqual({
      startedAt: "2026-04-08T00:00:00.000Z",
      endedAt: "2026-04-08T01:00:00.000Z",
      sampledDurationMs: 3_600_000,
      feederAccepted: 600,
      feederThrottled: 2,
      feederUnauthorized: 0,
      feederOtherErrors: 1,
      cumulativeDelta: {
        acceptedRuns: 600,
        completedRuns: 570,
        successfulRuns: 562,
        failedRuns: 8,
        retriedRuns: 11,
        pendingRuns: 30,
      },
      throughputPerHour: {
        feederAcceptedAvg: 600,
        completedAvg: 570,
        acceptedPeak: 600,
        completedPeak: 570,
      },
      queuePressure: {
        queuedAvg: 50 / 3,
        queuedPeak: 20,
        processingAvg: 7,
        processingPeak: 9,
      },
      sampleCount: 3,
    });
  });

  it("respects ORCHESTRATOR_CONFIG when resolving the active runtime state file source", () => {
    const previous = process.env.ORCHESTRATOR_CONFIG;
    process.env.ORCHESTRATOR_CONFIG = "/tmp/review-lane/orchestrator_config.json";

    try {
      expect(resolveOrchestratorConfigPath()).toBe("/tmp/review-lane/orchestrator_config.json");
    } finally {
      if (previous === undefined) {
        delete process.env.ORCHESTRATOR_CONFIG;
      } else {
        process.env.ORCHESTRATOR_CONFIG = previous;
      }
    }
  });
});
