// Generated from orchestrator/src/review-session-defaults.ts; run npm run agents:runtime-evidence:sync.
/** Canonical initial counters for runtime and pre-runtime bootstrap. */
export function createEmptyCumulativeWorkload() {
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
