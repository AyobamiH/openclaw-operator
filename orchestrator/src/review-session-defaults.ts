import type { ReviewSessionCumulativeWorkload } from "./types.js";

/** Canonical initial counters for runtime and pre-runtime bootstrap. */
export function createEmptyCumulativeWorkload(): ReviewSessionCumulativeWorkload {
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
