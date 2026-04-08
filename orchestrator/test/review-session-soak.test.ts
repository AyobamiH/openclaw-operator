import { describe, expect, it, vi } from "vitest";
import { createDefaultState } from "../src/state.js";
import { createReviewSessionService } from "../src/reviewSessions.js";

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

describe("private review session soak mode", () => {
  it("promotes bootstrap handoff into steady-state ownership with the capture plan intact", async () => {
    const state = createDefaultState();
    state.reviewSessions.push({
      id: "review-1",
      source: "bootstrap_handoff",
      state: "pending_handoff",
      title: "Mini PC 24h soak",
      createdAt: "2026-03-31T00:00:00.000Z",
      startedAt: "2026-03-31T00:00:10.000Z",
      endedAt: null,
      baselineStartedAt: "2026-03-31T00:00:00.000Z",
      baselineEndedAt: "2026-03-31T00:00:10.000Z",
      startupStartedAt: "2026-03-31T00:00:10.000Z",
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
        cpuPercentAvg: 3,
        cpuPercentPeak: 5,
        loadAvg1m: 0.4,
        memoryUsedMbAvg: 1200,
        memoryUsedMbPeak: 1250,
      },
      bucketTimeline: [
        { bucket: "baseline_idle", capturedAt: "2026-03-31T00:00:00.000Z", note: "baseline" },
        { bucket: "startup_cost", capturedAt: "2026-03-31T00:00:10.000Z", note: "startup" },
      ],
      scenarioNotes: [],
      linkedRunIds: [],
      cumulativeWorkload: createEmptyCumulativeWorkload(),
      summary: null,
      failureReason: null,
    });

    const service = createReviewSessionService({
      state,
      flushState: vi.fn().mockResolvedValue(undefined),
      getQueueSnapshot: () => ({ queued: 0, processing: 0 }),
    });

    const session = await service.bootstrapHandoff({
      reviewSessionId: "review-1",
      title: "Mini PC 24h soak",
      createdAt: "2026-03-31T00:00:00.000Z",
      baselineStartedAt: "2026-03-31T00:00:00.000Z",
      baselineEndedAt: "2026-03-31T00:00:10.000Z",
      startupStartedAt: "2026-03-31T00:00:10.000Z",
      machine: {
        hostname: "mini-pc",
        platform: "linux",
        arch: "x64",
        cpuModel: "Intel",
        cpuCores: 8,
        memoryTotalMb: 8192,
      },
      baselineSummary: {
        cpuPercentAvg: 3,
        cpuPercentPeak: 5,
        loadAvg1m: 0.4,
        memoryUsedMbAvg: 1200,
        memoryUsedMbPeak: 1250,
      },
      baselineSamples: [],
      initialBucket: "startup_cost",
      postHandoffBucket: "steady_state_running_cost",
      capturePlan: {
        profile: "soak-24h",
        sampleIntervalMs: 60000,
        maxSamples: 1800,
        intendedDurationHours: 24,
        targetTaskCount: 5000,
      },
      notes: [],
    });

    expect(session.state).toBe("active");
    expect(session.activeBucket).toBe("steady_state_running_cost");
    expect(session.capturePlan.profile).toBe("soak-24h");
    expect(state.reviewSessions[0]?.capturePlan.sampleIntervalMs).toBe(60000);
    expect(state.reviewSessions[0]?.bucketTimeline.at(-1)?.bucket).toBe("steady_state_running_cost");
  });

  it("creates a pending bootstrap session during handoff when no pre-persisted record exists", async () => {
    const state = createDefaultState();
    const service = createReviewSessionService({
      state,
      flushState: vi.fn().mockResolvedValue(undefined),
      getQueueSnapshot: () => ({ queued: 0, processing: 0 }),
    });

    const session = await service.bootstrapHandoff({
      reviewSessionId: "review-created-at-handoff",
      title: "Mini PC 24h soak",
      createdAt: "2026-03-31T00:00:00.000Z",
      baselineStartedAt: "2026-03-31T00:00:00.000Z",
      baselineEndedAt: "2026-03-31T00:00:10.000Z",
      startupStartedAt: "2026-03-31T00:00:10.000Z",
      machine: {
        hostname: "mini-pc",
        platform: "linux",
        arch: "x64",
        cpuModel: "Intel",
        cpuCores: 8,
        memoryTotalMb: 8192,
      },
      baselineSummary: {
        cpuPercentAvg: 3,
        cpuPercentPeak: 5,
        loadAvg1m: 0.4,
        memoryUsedMbAvg: 1200,
        memoryUsedMbPeak: 1250,
      },
      baselineSamples: [],
      initialBucket: "startup_cost",
      postHandoffBucket: "steady_state_running_cost",
      capturePlan: {
        profile: "soak-24h",
        sampleIntervalMs: 60000,
        maxSamples: 1800,
        intendedDurationHours: 24,
        targetTaskCount: 5000,
      },
      notes: [],
    });

    expect(session.state).toBe("active");
    expect(state.reviewSessions).toHaveLength(1);
    expect(state.reviewSessions[0]?.id).toBe("review-created-at-handoff");
    expect(state.reviewSessions[0]?.capturePlan.profile).toBe("soak-24h");
  });

  it("treats repeated bootstrap handoff for the same session as idempotent", async () => {
    const state = createDefaultState();
    const service = createReviewSessionService({
      state,
      flushState: vi.fn().mockResolvedValue(undefined),
      getQueueSnapshot: () => ({ queued: 0, processing: 0 }),
    });

    const payload = {
      reviewSessionId: "review-idempotent",
      title: "Mini PC 24h soak",
      createdAt: "2026-03-31T00:00:00.000Z",
      baselineStartedAt: "2026-03-31T00:00:00.000Z",
      baselineEndedAt: "2026-03-31T00:00:10.000Z",
      startupStartedAt: "2026-03-31T00:00:10.000Z",
      machine: {
        hostname: "mini-pc",
        platform: "linux",
        arch: "x64",
        cpuModel: "Intel",
        cpuCores: 8,
        memoryTotalMb: 8192,
      },
      baselineSummary: {
        cpuPercentAvg: 3,
        cpuPercentPeak: 5,
        loadAvg1m: 0.4,
        memoryUsedMbAvg: 1200,
        memoryUsedMbPeak: 1250,
      },
      baselineSamples: [],
      initialBucket: "startup_cost" as const,
      postHandoffBucket: "steady_state_running_cost" as const,
      capturePlan: {
        profile: "soak-24h" as const,
        sampleIntervalMs: 60000,
        maxSamples: 1800,
        intendedDurationHours: 24,
        targetTaskCount: 5000,
      },
      notes: [],
    };

    const first = await service.bootstrapHandoff(payload);
    const second = await service.bootstrapHandoff(payload);

    expect(first.state).toBe("active");
    expect(second.state).toBe("active");
    expect(state.reviewSessions).toHaveLength(1);
    expect(state.reviewSessions[0]?.id).toBe("review-idempotent");
  });

  it("derives live soak summary metrics for an active session", () => {
    const state = createDefaultState();
    state.reviewSessions.push({
      id: "review-2",
      source: "bootstrap_handoff",
      state: "active",
      title: "Mini PC 24h soak",
      createdAt: "2026-03-31T00:00:00.000Z",
      startedAt: "2026-03-31T00:00:10.000Z",
      endedAt: null,
      baselineStartedAt: "2026-03-31T00:00:00.000Z",
      baselineEndedAt: "2026-03-31T00:00:10.000Z",
      startupStartedAt: "2026-03-31T00:00:10.000Z",
      handoffReceivedAt: "2026-03-31T00:02:00.000Z",
      activeBucket: "steady_state_running_cost",
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
        cpuPercentAvg: 3,
        cpuPercentPeak: 5,
        loadAvg1m: 0.4,
        memoryUsedMbAvg: 1200,
        memoryUsedMbPeak: 1250,
      },
      bucketTimeline: [
        { bucket: "baseline_idle", capturedAt: "2026-03-31T00:00:00.000Z", note: "baseline" },
        { bucket: "startup_cost", capturedAt: "2026-03-31T00:00:10.000Z", note: "startup" },
        { bucket: "steady_state_running_cost", capturedAt: "2026-03-31T00:02:00.000Z", note: "handoff" },
      ],
      scenarioNotes: [],
      linkedRunIds: ["run-success"],
      cumulativeWorkload: createEmptyCumulativeWorkload(),
      summary: null,
      failureReason: null,
    });

    state.reviewTelemetrySamples.push(
      {
        reviewSessionId: "review-2",
        capturedAt: "2026-03-31T00:05:00.000Z",
        bucket: "steady_state_running_cost",
        source: "orchestrator",
        host: {
          cpuPercent: 22,
          load1: 1.2,
          load5: 1.1,
          load15: 1,
          memoryUsedBytes: 2_100 * 1024 * 1024,
          memoryTotalBytes: 8_192 * 1024 * 1024,
        },
        process: {
          rssBytes: 180 * 1024 * 1024,
          heapUsedBytes: 90 * 1024 * 1024,
          heapTotalBytes: 120 * 1024 * 1024,
          uptimeSec: 300,
        },
        activity: {
          openIncidents: 4,
          queueDepth: 120,
          activeRuns: 12,
          recentRunIds: ["run-success"],
        },
        tags: ["steady_state_running_cost", "soak-24h"],
      },
      {
        reviewSessionId: "review-2",
        capturedAt: "2026-03-31T00:06:00.000Z",
        bucket: "burst_workload",
        source: "orchestrator",
        host: {
          cpuPercent: 45,
          load1: 2.2,
          load5: 1.8,
          load15: 1.4,
          memoryUsedBytes: 2_500 * 1024 * 1024,
          memoryTotalBytes: 8_192 * 1024 * 1024,
        },
        process: {
          rssBytes: 260 * 1024 * 1024,
          heapUsedBytes: 110 * 1024 * 1024,
          heapTotalBytes: 140 * 1024 * 1024,
          uptimeSec: 360,
        },
        activity: {
          openIncidents: 6,
          queueDepth: 320,
          activeRuns: 18,
          recentRunIds: ["run-success", "run-failed"],
        },
        tags: ["burst_workload", "soak-24h"],
      },
    );

    state.taskExecutions.push(
      {
        taskId: "task-1",
        idempotencyKey: "run-success",
        type: "system-monitor",
        status: "success",
        attempt: 1,
        maxRetries: 3,
        startedAt: "2026-03-31T00:03:00.000Z",
        completedAt: "2026-03-31T00:03:30.000Z",
        lastHandledAt: "2026-03-31T00:03:30.000Z",
        accounting: {
          provider: "openai",
          model: "gpt-4",
          metered: true,
          pricingSource: "catalog",
          latencyMs: 1200,
          costUsd: 0.02,
          usage: null,
          budget: null,
          note: null,
        },
      },
      {
        taskId: "task-2",
        idempotencyKey: "run-failed",
        type: "qa-verification",
        status: "failed",
        attempt: 1,
        maxRetries: 2,
        startedAt: "2026-03-31T00:04:00.000Z",
        completedAt: "2026-03-31T00:04:45.000Z",
        lastHandledAt: "2026-03-31T00:04:45.000Z",
        accounting: {
          provider: "openai",
          model: "gpt-4",
          metered: true,
          pricingSource: "catalog",
          latencyMs: 2400,
          costUsd: 0.05,
          usage: null,
          budget: null,
          note: null,
        },
      },
      {
        taskId: "task-3",
        idempotencyKey: "run-retrying",
        type: "drift-repair",
        status: "retrying",
        attempt: 2,
        maxRetries: 3,
        startedAt: "2026-03-31T00:05:10.000Z",
        completedAt: null,
        lastHandledAt: "2026-03-31T00:06:10.000Z",
        accounting: {
          provider: "openai",
          model: "gpt-4",
          metered: true,
          pricingSource: "catalog",
          latencyMs: 3600,
          costUsd: 0.07,
          usage: null,
          budget: null,
          note: null,
        },
      },
    );

    const service = createReviewSessionService({
      state,
      flushState: vi.fn().mockResolvedValue(undefined),
      getQueueSnapshot: () => ({ queued: 0, processing: 0 }),
    });

    const detail = service.detail("review-2");

    expect(detail?.session.summary?.telemetry.queueDepthPeak).toBe(320);
    expect(detail?.session.summary?.telemetry.openIncidentsPeak).toBe(6);
    expect(detail?.session.summary?.workload.consideredRuns).toBe(3);
    expect(detail?.session.summary?.workload.completedRuns).toBe(2);
    expect(detail?.session.summary?.workload.successfulRuns).toBe(1);
    expect(detail?.session.summary?.workload.failedRuns).toBe(1);
    expect(detail?.session.summary?.workload.retryingRuns).toBe(1);
    expect(detail?.session.summary?.workload.p95LatencyMs).toBe(3600);
    expect(detail?.session.summary?.workload.topTaskTypes[0]).toEqual({
      type: "drift-repair",
      count: 1,
    });
    expect(detail?.session.summary?.linkedRunCount).toBe(1);
    expect(detail?.session.summary?.linkedRunCostUsd).toBe(0.02);
  });

  it("tracks cumulative soak workload beyond the rolling execution window", async () => {
    const state = createDefaultState();
    const service = createReviewSessionService({
      state,
      flushState: vi.fn().mockResolvedValue(undefined),
      getQueueSnapshot: () => ({ queued: 0, processing: 0 }),
    });

    const session = await service.bootstrapHandoff({
      reviewSessionId: "review-cumulative",
      title: "Mini PC 24h soak",
      createdAt: "2026-03-31T00:00:00.000Z",
      baselineStartedAt: "2026-03-31T00:00:00.000Z",
      baselineEndedAt: "2026-03-31T00:00:10.000Z",
      startupStartedAt: "2026-03-31T00:00:10.000Z",
      machine: {
        hostname: "mini-pc",
        platform: "linux",
        arch: "x64",
        cpuModel: "Intel",
        cpuCores: 8,
        memoryTotalMb: 8192,
      },
      baselineSummary: {
        cpuPercentAvg: 3,
        cpuPercentPeak: 5,
        loadAvg1m: 0.4,
        memoryUsedMbAvg: 1200,
        memoryUsedMbPeak: 1250,
      },
      baselineSamples: [],
      initialBucket: "startup_cost",
      postHandoffBucket: "steady_state_running_cost",
      capturePlan: {
        profile: "soak-24h",
        sampleIntervalMs: 60000,
        maxSamples: 1800,
        intendedDurationHours: 24,
        targetTaskCount: 5000,
      },
      notes: [],
    });

    const handoffMs = Date.parse(session.handoffReceivedAt ?? new Date().toISOString());
    const acceptedAt = new Date(handoffMs + 1000).toISOString();
    const secondAcceptedAt = new Date(handoffMs + 2000).toISOString();
    const retriedAt = new Date(handoffMs + 3000).toISOString();
    const firstCompletedAt = new Date(handoffMs + 4000).toISOString();
    const secondCompletedAt = new Date(handoffMs + 5000).toISOString();

    service.recordAcceptedRun("review-cumulative", "heartbeat", acceptedAt);
    service.recordAcceptedRun("review-cumulative", "qa-verification", secondAcceptedAt);
    service.recordRetriedRun("review-cumulative", retriedAt);
    service.recordCompletedRun({
      reviewSessionId: "review-cumulative",
      taskType: "heartbeat",
      status: "success",
      completedAt: firstCompletedAt,
      latencyMs: 250,
      costUsd: 0.02,
    });
    service.recordCompletedRun({
      reviewSessionId: "review-cumulative",
      taskType: "qa-verification",
      status: "failed",
      completedAt: secondCompletedAt,
      latencyMs: 700,
      costUsd: 0.05,
    });

    const detail = service.detail("review-cumulative");

    expect(detail?.session.summary?.workload.cumulative.acceptedRuns).toBe(2);
    expect(detail?.session.summary?.workload.cumulative.completedRuns).toBe(2);
    expect(detail?.session.summary?.workload.cumulative.successfulRuns).toBe(1);
    expect(detail?.session.summary?.workload.cumulative.failedRuns).toBe(1);
    expect(detail?.session.summary?.workload.cumulative.retriedRuns).toBe(1);
    expect(detail?.session.summary?.workload.cumulative.pendingRuns).toBe(0);
    expect(detail?.session.summary?.workload.cumulative.averageLatencyMs).toBe(475);
    expect(detail?.session.summary?.workload.cumulative.peakLatencyMs).toBe(700);
    expect(detail?.session.summary?.workload.cumulative.totalCostUsd).toBe(0.07);
    expect(detail?.session.summary?.workload.cumulative.topTaskTypes).toEqual([
      { type: "heartbeat", count: 1 },
      { type: "qa-verification", count: 1 },
    ]);
  });
});
