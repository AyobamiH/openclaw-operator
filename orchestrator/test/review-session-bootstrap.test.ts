import { describe, expect, it } from "vitest";
import { createDefaultState } from "../src/state.js";
import {
  normalizeTargetTaskCount,
  parseArgs,
  reconcileStaleReviewSessionsState,
} from "../../scripts/review-session/bootstrap.mjs";

function createEmptyCumulativeWorkload() {
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

describe("review-session bootstrap preflight", () => {
  it("accepts open-ended capacity aliases for the 24h max lane target", () => {
    expect(normalizeTargetTaskCount("max", 5000)).toBeNull();
    expect(normalizeTargetTaskCount("capacity-max", 5000)).toBeNull();
    expect(normalizeTargetTaskCount("unbounded", 5000)).toBeNull();
    expect(normalizeTargetTaskCount("null", 5000)).toBeNull();
    expect(normalizeTargetTaskCount("7500", 5000)).toBe(7500);
  });

  it("parses npm passthrough flags written as --key=value", () => {
    expect(
      parseArgs([
        "--profile=soak-24h",
        "--target-task-count=max",
        "--baseUrl",
        "http://127.0.0.1:4312",
      ]),
    ).toEqual({
      profile: "soak-24h",
      "target-task-count": "max",
      baseUrl: "http://127.0.0.1:4312",
    });
  });

  it("reconciles stale active and pending handoff sessions before a fresh run starts", () => {
    const state = createDefaultState();
    state.reviewSessions.push(
      {
        id: "active-stale",
        source: "bootstrap_handoff",
        state: "active",
        title: "Stale active soak",
        createdAt: "2026-04-08T09:00:00.000Z",
        startedAt: "2026-04-08T09:00:10.000Z",
        endedAt: null,
        baselineStartedAt: "2026-04-08T09:00:00.000Z",
        baselineEndedAt: "2026-04-08T09:00:10.000Z",
        startupStartedAt: "2026-04-08T09:00:10.000Z",
        handoffReceivedAt: "2026-04-08T09:01:00.000Z",
        activeBucket: "burst_workload",
        capturePlan: {
          profile: "soak-24h",
          sampleIntervalMs: 60000,
          maxSamples: 1800,
          intendedDurationHours: 24,
          targetTaskCount: 5000,
        },
        machine: {
          hostname: "mini-pc",
          platform: "linux",
          arch: "x64",
          cpuModel: "Intel",
          cpuCores: 8,
          memoryTotalMb: 8192,
        },
        baselineSummary: {
          cpuPercentAvg: 2,
          cpuPercentPeak: 4,
          loadAvg1m: 0.3,
          memoryUsedMbAvg: 1100,
          memoryUsedMbPeak: 1120,
        },
        bucketTimeline: [
          { bucket: "baseline_idle", capturedAt: "2026-04-08T09:00:00.000Z", note: "baseline" },
          { bucket: "startup_cost", capturedAt: "2026-04-08T09:00:10.000Z", note: "startup" },
          { bucket: "burst_workload", capturedAt: "2026-04-08T09:01:00.000Z", note: "handoff" },
        ],
        scenarioNotes: [],
        linkedRunIds: [],
        cumulativeWorkload: createEmptyCumulativeWorkload(),
        summary: null,
        failureReason: null,
      },
      {
        id: "pending-stale",
        source: "bootstrap_handoff",
        state: "pending_handoff",
        title: "Stale pending soak",
        createdAt: "2026-04-08T10:00:00.000Z",
        startedAt: "2026-04-08T10:00:10.000Z",
        endedAt: null,
        baselineStartedAt: "2026-04-08T10:00:00.000Z",
        baselineEndedAt: "2026-04-08T10:00:10.000Z",
        startupStartedAt: "2026-04-08T10:00:10.000Z",
        handoffReceivedAt: null,
        activeBucket: "startup_cost",
        capturePlan: {
          profile: "soak-24h",
          sampleIntervalMs: 60000,
          maxSamples: 1800,
          intendedDurationHours: 24,
          targetTaskCount: 5000,
        },
        machine: {
          hostname: "mini-pc",
          platform: "linux",
          arch: "x64",
          cpuModel: "Intel",
          cpuCores: 8,
          memoryTotalMb: 8192,
        },
        baselineSummary: {
          cpuPercentAvg: 2,
          cpuPercentPeak: 4,
          loadAvg1m: 0.3,
          memoryUsedMbAvg: 1100,
          memoryUsedMbPeak: 1120,
        },
        bucketTimeline: [
          { bucket: "baseline_idle", capturedAt: "2026-04-08T10:00:00.000Z", note: "baseline" },
          { bucket: "startup_cost", capturedAt: "2026-04-08T10:00:10.000Z", note: "startup" },
        ],
        scenarioNotes: [],
        linkedRunIds: [],
        cumulativeWorkload: createEmptyCumulativeWorkload(),
        summary: null,
        failureReason: null,
      },
    );

    const result = reconcileStaleReviewSessionsState(state, {
      now: "2026-04-08T12:00:00.000Z",
      baseUrl: "http://127.0.0.1:3312",
    });

    expect(result).toEqual({
      updated: true,
      completedActiveCount: 1,
      failedPendingCount: 1,
    });
    expect(state.reviewSessions[0]?.state).toBe("completed");
    expect(state.reviewSessions[0]?.endedAt).toBe("2026-04-08T12:00:00.000Z");
    expect(state.reviewSessions[0]?.scenarioNotes.at(-1)?.text).toMatch(/stale active review session/i);
    expect(state.reviewSessions[1]?.state).toBe("handoff_failed");
    expect(state.reviewSessions[1]?.endedAt).toBe("2026-04-08T12:00:00.000Z");
    expect(state.reviewSessions[1]?.failureReason).toMatch(/stale pending handoff/i);
    expect(state.reviewSessions[1]?.scenarioNotes.at(-1)?.text).toMatch(/marked this stale pending handoff as failed/i);
  });
});
