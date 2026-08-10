import { readFile } from "node:fs/promises";
import { loadavg } from "node:os";
import {
  OrchestratorState,
  ReviewSessionBootstrapHandoffPayload,
  ReviewSessionBucket,
  ReviewSessionCapturePlan,
  ReviewSessionCumulativeWorkload,
  ReviewSessionDerivedSummary,
  ReviewSessionRecord,
  ReviewTelemetrySample,
  TaskExecutionRecord,
} from "./types.js";

const DEFAULT_REVIEW_SAMPLE_INTERVAL_MS = 5000;
const DEFAULT_REVIEW_MAX_SAMPLES_PER_SESSION = 1440;

type QueueSnapshot = {
  queued: number;
  processing: number;
};

type ReviewSessionServiceOptions = {
  state: OrchestratorState;
  flushState: (tags?: string[]) => Promise<void>;
  getQueueSnapshot: () => QueueSnapshot;
};

type CpuSnapshot = {
  idle: number;
  total: number;
};

async function readCpuSnapshot(): Promise<CpuSnapshot | null> {
  try {
    const raw = await readFile("/proc/stat", "utf-8");
    const line = raw.split("\n").find((item) => item.startsWith("cpu "));
    if (!line) return null;
    const parts = line.trim().split(/\s+/).slice(1).map((value) => Number.parseInt(value, 10));
    if (parts.some((value) => !Number.isFinite(value))) return null;
    const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
    const total = parts.reduce((sum, value) => sum + value, 0);
    return { idle, total };
  } catch {
    return null;
  }
}

async function readMemoryUsageBytes() {
  try {
    const raw = await readFile("/proc/meminfo", "utf-8");
    const lines = raw.split("\n");
    const totalLine = lines.find((line) => line.startsWith("MemTotal:"));
    const availableLine = lines.find((line) => line.startsWith("MemAvailable:"));
    if (!totalLine || !availableLine) return null;
    const totalKb = Number.parseInt(totalLine.replace(/\D+/g, " ").trim().split(/\s+/)[0] ?? "0", 10);
    const availableKb = Number.parseInt(availableLine.replace(/\D+/g, " ").trim().split(/\s+/)[0] ?? "0", 10);
    if (!Number.isFinite(totalKb) || !Number.isFinite(availableKb) || totalKb <= 0) return null;
    return {
      totalBytes: totalKb * 1024,
      usedBytes: Math.max(0, (totalKb - availableKb) * 1024),
    };
  } catch {
    return null;
  }
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

function parseTimestamp(value: string | null | undefined) {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveCapturePlan(session: Pick<ReviewSessionRecord, "capturePlan">): ReviewSessionCapturePlan {
  return {
    profile: session.capturePlan?.profile ?? "standard",
    sampleIntervalMs:
      typeof session.capturePlan?.sampleIntervalMs === "number" &&
      Number.isFinite(session.capturePlan.sampleIntervalMs)
        ? Math.max(1000, Math.floor(session.capturePlan.sampleIntervalMs))
        : DEFAULT_REVIEW_SAMPLE_INTERVAL_MS,
    maxSamples:
      typeof session.capturePlan?.maxSamples === "number" &&
      Number.isFinite(session.capturePlan.maxSamples)
        ? Math.max(60, Math.floor(session.capturePlan.maxSamples))
        : DEFAULT_REVIEW_MAX_SAMPLES_PER_SESSION,
    intendedDurationHours:
      typeof session.capturePlan?.intendedDurationHours === "number" &&
      Number.isFinite(session.capturePlan.intendedDurationHours)
        ? session.capturePlan.intendedDurationHours
        : null,
    targetTaskCount:
      typeof session.capturePlan?.targetTaskCount === "number" &&
      Number.isFinite(session.capturePlan.targetTaskCount)
        ? session.capturePlan.targetTaskCount
        : null,
  };
}

function createEmptyCumulativeWorkload(): ReviewSessionCumulativeWorkload {
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

function ensureCumulativeWorkload(session: ReviewSessionRecord): ReviewSessionCumulativeWorkload {
  if (!session.cumulativeWorkload) {
    session.cumulativeWorkload = createEmptyCumulativeWorkload();
  }
  return session.cumulativeWorkload;
}

function buildTopTaskTypes(taskTypeCounts: Record<string, number>) {
  return Object.entries(taskTypeCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type))
    .slice(0, 5);
}

function preferLaterTimestamp(current: string | null, candidate: string | null) {
  const currentMs = parseTimestamp(current);
  const candidateMs = parseTimestamp(candidate);
  if (candidateMs === null) {
    return current;
  }
  if (currentMs === null || candidateMs > currentMs) {
    return candidate;
  }
  return current;
}

function buildCumulativeWorkloadSummary(session: ReviewSessionRecord, state: OrchestratorState) {
  const cumulative = ensureCumulativeWorkload(session);
  const workloadWindow = resolveWorkloadWindow(session);
  const windowStartMs = parseTimestamp(workloadWindow.startedAt) ?? Date.now();
  const windowEndMs = parseTimestamp(workloadWindow.endedAt) ?? Date.now();
  const executions = state.taskExecutions.filter((execution) =>
    executionTouchesWindow(execution, windowStartMs, windowEndMs),
  );
  const latencyValues = executions
    .map((execution) => execution.accounting?.latencyMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const fallbackCompletedRuns = executions.filter(
    (execution) => execution.status === "success" || execution.status === "failed",
  );
  const fallbackRetriedRuns = executions.filter(
    (execution) => execution.status === "retrying" || execution.attempt > 1,
  );
  const fallbackTaskTypeCounts = executions.reduce<Record<string, number>>((acc, execution) => {
    acc[execution.type] = (acc[execution.type] ?? 0) + 1;
    return acc;
  }, {});
  const fallbackLastAcceptedAt = executions.reduce<string | null>((latest, execution) => {
    return preferLaterTimestamp(
      latest,
      execution.startedAt ?? execution.lastHandledAt ?? execution.completedAt ?? null,
    );
  }, null);
  const fallbackLastCompletedAt = fallbackCompletedRuns.reduce<string | null>((latest, execution) => {
    return preferLaterTimestamp(
      latest,
      execution.completedAt ?? execution.lastHandledAt ?? execution.startedAt ?? null,
    );
  }, null);

  return {
    acceptedRuns: Math.max(cumulative.acceptedRuns, executions.length),
    completedRuns: Math.max(cumulative.completedRuns, fallbackCompletedRuns.length),
    successfulRuns: Math.max(
      cumulative.successfulRuns,
      executions.filter((execution) => execution.status === "success").length,
    ),
    failedRuns: Math.max(
      cumulative.failedRuns,
      executions.filter((execution) => execution.status === "failed").length,
    ),
    retriedRuns: Math.max(cumulative.retriedRuns, fallbackRetriedRuns.length),
    pendingRuns: Math.max(
      cumulative.pendingRuns,
      executions.filter(
        (execution) => execution.status === "pending" || execution.status === "running",
      ).length,
    ),
    totalCostUsd: round2(
      Math.max(
        cumulative.totalCostUsd,
        executions.reduce((sum, execution) => sum + (execution.accounting?.costUsd ?? 0), 0),
      ),
    ),
    averageLatencyMs:
      cumulative.latencySampleCount > 0
        ? Math.round(cumulative.latencySumMs / cumulative.latencySampleCount)
        : latencyValues.length > 0
          ? Math.round(average(latencyValues))
          : null,
    peakLatencyMs:
      cumulative.peakLatencyMs === null
        ? latencyValues.length > 0
          ? Math.max(...latencyValues)
          : null
        : latencyValues.length > 0
          ? Math.max(cumulative.peakLatencyMs, Math.max(...latencyValues))
          : cumulative.peakLatencyMs,
    lastAcceptedAt: preferLaterTimestamp(cumulative.lastAcceptedAt, fallbackLastAcceptedAt),
    lastCompletedAt: preferLaterTimestamp(cumulative.lastCompletedAt, fallbackLastCompletedAt),
    topTaskTypes:
      Object.keys(cumulative.taskTypeCounts).length > 0
        ? buildTopTaskTypes(cumulative.taskTypeCounts)
        : buildTopTaskTypes(fallbackTaskTypeCounts),
  };
}

function resolveSessionStartAt(session: ReviewSessionRecord) {
  return session.handoffReceivedAt ?? session.startupStartedAt ?? session.startedAt ?? session.createdAt;
}

function sessionTracksTimestamp(session: ReviewSessionRecord, occurredAt: string | null | undefined) {
  const occurredMs = parseTimestamp(occurredAt);
  if (occurredMs === null) {
    return true;
  }
  const startedMs = parseTimestamp(resolveSessionStartAt(session));
  const endedMs = parseTimestamp(session.endedAt);
  if (startedMs !== null && occurredMs < startedMs) {
    return false;
  }
  if (endedMs !== null && occurredMs > endedMs) {
    return false;
  }
  return true;
}

function resolveWorkloadWindow(session: ReviewSessionRecord) {
  const nowIso = new Date().toISOString();
  return {
    startedAt: session.handoffReceivedAt ?? session.startupStartedAt ?? session.startedAt ?? session.createdAt,
    endedAt: session.endedAt ?? nowIso,
  };
}

function computeBucketDurations(
  timeline: ReviewSessionRecord["bucketTimeline"],
  endAt: string,
) {
  const durations: Partial<Record<ReviewSessionBucket, number>> = {};
  const ordered = [...timeline].sort(
    (left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt),
  );
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    const start = Date.parse(current.capturedAt);
    const end = Date.parse(next?.capturedAt ?? endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    durations[current.bucket] = (durations[current.bucket] ?? 0) + Math.round((end - start) / 1000);
  }
  return durations;
}

function collectLinkedExecutions(session: ReviewSessionRecord, state: OrchestratorState) {
  return state.taskExecutions.filter(
    (execution) =>
      session.linkedRunIds.includes(execution.idempotencyKey) ||
      session.linkedRunIds.includes(execution.taskId),
  );
}

function executionTouchesWindow(
  execution: TaskExecutionRecord,
  windowStartMs: number,
  windowEndMs: number,
) {
  const startedMs =
    parseTimestamp(execution.startedAt) ??
    parseTimestamp(execution.lastHandledAt) ??
    parseTimestamp(execution.completedAt);
  const endedMs =
    parseTimestamp(execution.completedAt) ??
    parseTimestamp(execution.lastHandledAt) ??
    startedMs;

  if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs)) {
    return false;
  }

  return (startedMs as number) <= windowEndMs && (endedMs as number) >= windowStartMs;
}

function buildWorkloadSummary(session: ReviewSessionRecord, state: OrchestratorState) {
  const workloadWindow = resolveWorkloadWindow(session);
  const windowStartMs = parseTimestamp(workloadWindow.startedAt) ?? Date.now();
  const windowEndMs = parseTimestamp(workloadWindow.endedAt) ?? Date.now();
  const executions = state.taskExecutions.filter((execution) =>
    executionTouchesWindow(execution, windowStartMs, windowEndMs),
  );
  const latencyValues = executions
    .map((execution) => execution.accounting?.latencyMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const topTaskTypes = Object.entries(
    executions.reduce<Record<string, number>>((acc, execution) => {
      acc[execution.type] = (acc[execution.type] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type))
    .slice(0, 5);

  const completedRuns = executions.filter(
    (execution) => execution.status === "success" || execution.status === "failed",
  );

  return {
    windowStartedAt: workloadWindow.startedAt,
    windowEndedAt: workloadWindow.endedAt,
    consideredRuns: executions.length,
    completedRuns: completedRuns.length,
    successfulRuns: executions.filter((execution) => execution.status === "success").length,
    failedRuns: executions.filter((execution) => execution.status === "failed").length,
    retryingRuns: executions.filter((execution) => execution.status === "retrying").length,
    pendingRuns: executions.filter(
      (execution) => execution.status === "pending" || execution.status === "running",
    ).length,
    averageLatencyMs: latencyValues.length > 0 ? Math.round(average(latencyValues)) : null,
    p95LatencyMs: latencyValues.length > 0 ? percentile(latencyValues, 95) : null,
    totalCostUsd: round2(
      executions.reduce((sum, execution) => sum + (execution.accounting?.costUsd ?? 0), 0),
    ),
    topTaskTypes,
    cumulative: buildCumulativeWorkloadSummary(session, state),
  };
}

function buildTelemetrySummary(samples: ReviewTelemetrySample[]) {
  const cpuValues = samples.map((sample) => sample.host.cpuPercent);
  const memoryValues = samples.map((sample) => sample.host.memoryUsedBytes / (1024 * 1024));
  const processRssValues = samples
    .map((sample) => sample.process.rssBytes)
    .filter((value): value is number => typeof value === "number")
    .map((value) => value / (1024 * 1024));
  const queueDepthValues = samples.map((sample) => sample.activity.queueDepth);
  const activeRunsValues = samples.map((sample) => sample.activity.activeRuns);
  const incidentValues = samples.map((sample) => sample.activity.openIncidents);

  return {
    totalSampleCount: samples.length,
    cpuPercentAvg: cpuValues.length > 0 ? round2(average(cpuValues)) : null,
    cpuPercentPeak: cpuValues.length > 0 ? round2(Math.max(...cpuValues)) : null,
    memoryUsedMbAvg: memoryValues.length > 0 ? round2(average(memoryValues)) : null,
    memoryUsedMbPeak: memoryValues.length > 0 ? round2(Math.max(...memoryValues)) : null,
    processRssMbAvg: processRssValues.length > 0 ? round2(average(processRssValues)) : null,
    processRssMbPeak: processRssValues.length > 0 ? round2(Math.max(...processRssValues)) : null,
    queueDepthAvg: queueDepthValues.length > 0 ? round2(average(queueDepthValues)) : null,
    queueDepthPeak: queueDepthValues.length > 0 ? Math.max(...queueDepthValues) : null,
    activeRunsAvg: activeRunsValues.length > 0 ? round2(average(activeRunsValues)) : null,
    activeRunsPeak: activeRunsValues.length > 0 ? Math.max(...activeRunsValues) : null,
    openIncidentsAvg: incidentValues.length > 0 ? round2(average(incidentValues)) : null,
    openIncidentsPeak: incidentValues.length > 0 ? Math.max(...incidentValues) : null,
  };
}

function createSummary(
  session: ReviewSessionRecord,
  state: OrchestratorState,
): ReviewSessionDerivedSummary {
  const samples = state.reviewTelemetrySamples.filter(
    (sample) => sample.reviewSessionId === session.id,
  );
  const bucketStats: ReviewSessionDerivedSummary["bucketStats"] = {};
  const grouped = new Map<ReviewSessionBucket, ReviewTelemetrySample[]>();
  for (const sample of samples) {
    const current = grouped.get(sample.bucket) ?? [];
    current.push(sample);
    grouped.set(sample.bucket, current);
  }
  const summaryEndAt = session.endedAt ?? new Date().toISOString();
  const durations = computeBucketDurations(session.bucketTimeline, summaryEndAt);

  for (const [bucket, bucketSamples] of grouped.entries()) {
    const cpu = bucketSamples.map((sample) => sample.host.cpuPercent);
    const mem = bucketSamples.map((sample) => sample.host.memoryUsedBytes / (1024 * 1024));
    bucketStats[bucket] = {
      durationSeconds: durations[bucket] ?? 0,
      sampleCount: bucketSamples.length,
      cpuPercentAvg: bucketSamples.length > 0 ? round2(average(cpu)) : null,
      cpuPercentPeak: bucketSamples.length > 0 ? round2(Math.max(...cpu)) : null,
      memoryUsedMbAvg: bucketSamples.length > 0 ? round2(average(mem)) : null,
      memoryUsedMbPeak: bucketSamples.length > 0 ? round2(Math.max(...mem)) : null,
    };
  }

  const linkedExecutions = collectLinkedExecutions(session, state);
  const linkedLatencies = linkedExecutions
    .map((execution) => execution.accounting?.latencyMs)
    .filter((value): value is number => typeof value === "number");
  const telemetry = buildTelemetrySummary(samples);
  const workload = buildWorkloadSummary(session, state);

  const workloadStartMs = parseTimestamp(workload.windowStartedAt);
  const workloadEndMs = parseTimestamp(workload.windowEndedAt);
  const durationSeconds =
    workloadStartMs !== null && workloadEndMs !== null && workloadEndMs > workloadStartMs
      ? Math.round((workloadEndMs - workloadStartMs) / 1000)
      : 0;
  const startupStartedMs = parseTimestamp(session.startupStartedAt);
  const handoffReceivedMs = parseTimestamp(session.handoffReceivedAt);

  return {
    generatedAt: new Date().toISOString(),
    durationSeconds,
    startupHandoffSeconds:
      startupStartedMs !== null && handoffReceivedMs !== null && handoffReceivedMs > startupStartedMs
        ? Math.round((handoffReceivedMs - startupStartedMs) / 1000)
        : null,
    bucketStats,
    linkedRunCount: session.linkedRunIds.length,
    linkedRunCostUsd: round2(
      linkedExecutions.reduce(
        (sum, execution) => sum + (execution.accounting?.costUsd ?? 0),
        0,
      ),
    ),
    linkedRunAverageLatencyMs:
      linkedLatencies.length > 0 ? Math.round(average(linkedLatencies)) : null,
    observedIncidentCount:
      telemetry.openIncidentsPeak ??
      state.incidentLedger.filter((incident) => incident.status !== "resolved").length,
    telemetry,
    workload,
  };
}

function buildSessionSnapshot(session: ReviewSessionRecord, state: OrchestratorState): ReviewSessionRecord {
  if (session.state === "completed" && session.summary) {
    return session;
  }

  return {
    ...session,
    capturePlan: resolveCapturePlan(session),
    summary: createSummary(session, state),
  };
}

function buildMarkdownExport(session: ReviewSessionRecord, samples: ReviewTelemetrySample[]) {
  const summary = session.summary;
  const lines = [
    `# Review Session: ${session.title}`,
    "",
    `- Session ID: ${session.id}`,
    `- State: ${session.state}`,
    `- Capture Profile: ${session.capturePlan.profile}`,
    `- Sample Interval: ${session.capturePlan.sampleIntervalMs} ms`,
    `- Max Samples Retained: ${session.capturePlan.maxSamples}`,
    `- Intended Duration Hours: ${session.capturePlan.intendedDurationHours ?? "n/a"}`,
    `- Target Task Count: ${session.capturePlan.targetTaskCount ?? "n/a"}`,
    `- Created At: ${session.createdAt}`,
    `- Baseline Window: ${session.baselineStartedAt} -> ${session.baselineEndedAt}`,
    `- Startup Started At: ${session.startupStartedAt}`,
    `- Handoff Received At: ${session.handoffReceivedAt ?? "not handed off"}`,
    `- Machine: ${session.machine.hostname} (${session.machine.platform}/${session.machine.arch})`,
    `- CPU: ${session.machine.cpuModel} x${session.machine.cpuCores}`,
    `- Memory: ${session.machine.memoryTotalMb} MB`,
    "",
    "## Baseline Summary",
    "",
    `- CPU Avg: ${session.baselineSummary?.cpuPercentAvg ?? 0}%`,
    `- CPU Peak: ${session.baselineSummary?.cpuPercentPeak ?? 0}%`,
    `- Load Avg 1m: ${session.baselineSummary?.loadAvg1m ?? 0}`,
    `- Memory Avg: ${session.baselineSummary?.memoryUsedMbAvg ?? 0} MB`,
    `- Memory Peak: ${session.baselineSummary?.memoryUsedMbPeak ?? 0} MB`,
    "",
    "## Soak Summary",
    "",
    `- Duration Seconds: ${summary?.durationSeconds ?? 0}`,
    `- Startup To Handoff Seconds: ${summary?.startupHandoffSeconds ?? "n/a"}`,
    `- Linked Runs: ${summary?.linkedRunCount ?? session.linkedRunIds.length}`,
    `- Linked Run Cost USD: ${summary?.linkedRunCostUsd ?? 0}`,
    `- Linked Run Average Latency Ms: ${summary?.linkedRunAverageLatencyMs ?? "n/a"}`,
    `- Open Incidents Peak: ${summary?.observedIncidentCount ?? 0}`,
    `- Cumulative Accepted Runs: ${summary?.workload.cumulative.acceptedRuns ?? 0}`,
    `- Cumulative Completed Runs: ${summary?.workload.cumulative.completedRuns ?? 0}`,
    `- Cumulative Failed Runs: ${summary?.workload.cumulative.failedRuns ?? 0}`,
  ];

  if (summary?.telemetry) {
    lines.push(
      "",
      "## Telemetry Summary",
      "",
      `- Samples Retained: ${summary.telemetry.totalSampleCount}`,
      `- CPU Avg / Peak: ${summary.telemetry.cpuPercentAvg ?? "n/a"}% / ${summary.telemetry.cpuPercentPeak ?? "n/a"}%`,
      `- Memory Avg / Peak (MB): ${summary.telemetry.memoryUsedMbAvg ?? "n/a"} / ${summary.telemetry.memoryUsedMbPeak ?? "n/a"}`,
      `- Process RSS Avg / Peak (MB): ${summary.telemetry.processRssMbAvg ?? "n/a"} / ${summary.telemetry.processRssMbPeak ?? "n/a"}`,
      `- Queue Depth Avg / Peak: ${summary.telemetry.queueDepthAvg ?? "n/a"} / ${summary.telemetry.queueDepthPeak ?? "n/a"}`,
      `- Active Runs Avg / Peak: ${summary.telemetry.activeRunsAvg ?? "n/a"} / ${summary.telemetry.activeRunsPeak ?? "n/a"}`,
      `- Open Incidents Avg / Peak: ${summary.telemetry.openIncidentsAvg ?? "n/a"} / ${summary.telemetry.openIncidentsPeak ?? "n/a"}`,
    );
  }

  if (summary?.workload) {
    lines.push(
      "",
      "## Workload Summary",
      "",
      `- Window: ${summary.workload.windowStartedAt} -> ${summary.workload.windowEndedAt}`,
      `- Considered Runs: ${summary.workload.consideredRuns}`,
      `- Completed Runs: ${summary.workload.completedRuns}`,
      `- Successful Runs: ${summary.workload.successfulRuns}`,
      `- Failed Runs: ${summary.workload.failedRuns}`,
      `- Retrying Runs: ${summary.workload.retryingRuns}`,
      `- Pending / Running Runs: ${summary.workload.pendingRuns}`,
      `- Average Latency Ms: ${summary.workload.averageLatencyMs ?? "n/a"}`,
      `- P95 Latency Ms: ${summary.workload.p95LatencyMs ?? "n/a"}`,
      `- Total Cost USD: ${summary.workload.totalCostUsd}`,
    );

    lines.push(
      "",
      "### Cumulative Soak Totals",
      "",
      `- Accepted Runs: ${summary.workload.cumulative.acceptedRuns}`,
      `- Completed Runs: ${summary.workload.cumulative.completedRuns}`,
      `- Successful Runs: ${summary.workload.cumulative.successfulRuns}`,
      `- Failed Runs: ${summary.workload.cumulative.failedRuns}`,
      `- Retried Runs: ${summary.workload.cumulative.retriedRuns}`,
      `- Pending / Running Runs: ${summary.workload.cumulative.pendingRuns}`,
      `- Average Latency Ms: ${summary.workload.cumulative.averageLatencyMs ?? "n/a"}`,
      `- Peak Latency Ms: ${summary.workload.cumulative.peakLatencyMs ?? "n/a"}`,
      `- Total Cost USD: ${summary.workload.cumulative.totalCostUsd}`,
      `- Last Accepted At: ${summary.workload.cumulative.lastAcceptedAt ?? "n/a"}`,
      `- Last Completed At: ${summary.workload.cumulative.lastCompletedAt ?? "n/a"}`,
    );

    if (summary.workload.topTaskTypes.length > 0) {
      lines.push("", "### Top Task Types", "");
      for (const item of summary.workload.topTaskTypes) {
        lines.push(`- ${item.type}: ${item.count}`);
      }
    }

    if (summary.workload.cumulative.topTaskTypes.length > 0) {
      lines.push("", "### Cumulative Top Task Types", "");
      for (const item of summary.workload.cumulative.topTaskTypes) {
        lines.push(`- ${item.type}: ${item.count}`);
      }
    }
  }

  if (summary?.bucketStats) {
    lines.push("", "## Bucket Stats", "");
    for (const [bucket, stats] of Object.entries(summary.bucketStats)) {
      lines.push(
        `- ${bucket}: ${stats.durationSeconds}s, ${stats.sampleCount} samples, cpu avg ${stats.cpuPercentAvg ?? "n/a"}%, cpu peak ${stats.cpuPercentPeak ?? "n/a"}%`,
      );
    }
  }

  if (session.scenarioNotes.length > 0) {
    lines.push("", "## Notes", "");
    for (const note of session.scenarioNotes) {
      lines.push(`- [${note.bucket}] ${note.capturedAt}: ${note.text}`);
    }
  }

  if (session.linkedRunIds.length > 0) {
    lines.push("", "## Linked Runs", "");
    for (const runId of session.linkedRunIds) {
      lines.push(`- ${runId}`);
    }
  }

  lines.push("", `Samples captured: ${samples.length}`);
  return lines.join("\n");
}

function createBootstrapSession(payload: ReviewSessionBootstrapHandoffPayload): ReviewSessionRecord {
  return {
    id: payload.reviewSessionId,
    source: "bootstrap_handoff",
    state: "pending_handoff",
    title: payload.title,
    createdAt: payload.createdAt,
    startedAt: payload.startupStartedAt,
    endedAt: null,
    baselineStartedAt: payload.baselineStartedAt,
    baselineEndedAt: payload.baselineEndedAt,
    startupStartedAt: payload.startupStartedAt,
    handoffReceivedAt: null,
    activeBucket: payload.initialBucket,
    capturePlan: payload.capturePlan,
    machine: payload.machine,
    baselineSummary: payload.baselineSummary,
    bucketTimeline: [
      { bucket: "baseline_idle", capturedAt: payload.baselineStartedAt, note: "baseline capture started" },
      { bucket: payload.initialBucket, capturedAt: payload.startupStartedAt, note: "startup began" },
    ],
    scenarioNotes: payload.notes,
    linkedRunIds: [],
    cumulativeWorkload: createEmptyCumulativeWorkload(),
    summary: null,
    failureReason: null,
  };
}

export function createReviewSessionService(options: ReviewSessionServiceOptions) {
  const { state, flushState, getQueueSnapshot } = options;
  let timer: NodeJS.Timeout | null = null;
  let timerIntervalMs: number | null = null;
  let sampleInFlight = false;
  let lastCpuSnapshot: CpuSnapshot | null = null;

  function requireActiveSession(session: ReviewSessionRecord, action: string) {
    if (session.state !== "active") {
      throw new Error(`Review session must be active to ${action}: ${session.id}`);
    }
  }

  function resolveLinkedExecution(runId: string) {
    return state.taskExecutions.find(
      (execution) => execution.idempotencyKey === runId || execution.taskId === runId,
    ) ?? null;
  }

  function canonicalLinkedRunId(runId: string) {
    const execution = resolveLinkedExecution(runId);
    if (!execution) {
      throw new Error(`Review session run link target not found: ${runId}`);
    }
    if (typeof execution.idempotencyKey === "string" && execution.idempotencyKey.length > 0) {
      return execution.idempotencyKey;
    }
    return execution.taskId;
  }

  function getSession(id: string) {
    return state.reviewSessions.find((session) => session.id === id) ?? null;
  }

  function recordAcceptedRun(reviewSessionId: string | null | undefined, taskType: string, acceptedAt: string) {
    if (!reviewSessionId) return;
    const session = getSession(reviewSessionId);
    if (!session || !sessionTracksTimestamp(session, acceptedAt)) return;
    const cumulative = ensureCumulativeWorkload(session);
    cumulative.acceptedRuns += 1;
    cumulative.pendingRuns += 1;
    cumulative.lastAcceptedAt = acceptedAt;
    cumulative.taskTypeCounts[taskType] = (cumulative.taskTypeCounts[taskType] ?? 0) + 1;
  }

  function recordRetriedRun(reviewSessionId: string | null | undefined, retriedAt: string) {
    if (!reviewSessionId) return;
    const session = getSession(reviewSessionId);
    if (!session || !sessionTracksTimestamp(session, retriedAt)) return;
    const cumulative = ensureCumulativeWorkload(session);
    cumulative.retriedRuns += 1;
  }

  function recordCompletedRun(args: {
    reviewSessionId: string | null | undefined;
    taskType: string;
    status: "success" | "failed";
    completedAt: string;
    latencyMs?: number | null;
    costUsd?: number | null;
  }) {
    if (!args.reviewSessionId) return;
    const session = getSession(args.reviewSessionId);
    if (!session || !sessionTracksTimestamp(session, args.completedAt)) return;
    const cumulative = ensureCumulativeWorkload(session);
    cumulative.completedRuns += 1;
    if (cumulative.pendingRuns > 0) {
      cumulative.pendingRuns -= 1;
    }
    if (args.status === "success") {
      cumulative.successfulRuns += 1;
    } else {
      cumulative.failedRuns += 1;
    }
    cumulative.lastCompletedAt = args.completedAt;
    cumulative.totalCostUsd += typeof args.costUsd === "number" ? args.costUsd : 0;
    if (typeof args.latencyMs === "number" && Number.isFinite(args.latencyMs)) {
      cumulative.latencySampleCount += 1;
      cumulative.latencySumMs += args.latencyMs;
      cumulative.peakLatencyMs =
        cumulative.peakLatencyMs === null
          ? args.latencyMs
          : Math.max(cumulative.peakLatencyMs, args.latencyMs);
    }
  }

  function listSessions() {
    return [...state.reviewSessions]
      .map((session) => buildSessionSnapshot(session, state))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  function ensureSingleActiveSession(nextSessionId?: string) {
    const active = state.reviewSessions.find(
      (session) => session.state === "active" && session.id !== nextSessionId,
    );
    if (active) {
      throw new Error(`Review session already active: ${active.id}`);
    }
  }

  function enforceSessionSampleLimit(session: ReviewSessionRecord) {
    const maxSamples = resolveCapturePlan(session).maxSamples;
    const sessionSamples = state.reviewTelemetrySamples.filter(
      (sample) => sample.reviewSessionId === session.id,
    );
    if (sessionSamples.length <= maxSamples) return;
    const overflow = sessionSamples.length - maxSamples;
    let removed = 0;
    state.reviewTelemetrySamples = state.reviewTelemetrySamples.filter((sample) => {
      if (sample.reviewSessionId !== session.id) return true;
      if (removed < overflow) {
        removed += 1;
        return false;
      }
      return true;
    });
  }

  async function captureSampleForSession(session: ReviewSessionRecord) {
    const memory = await readMemoryUsageBytes();
    const cpuSnapshot = await readCpuSnapshot();
    const load = loadavg();
    let cpuPercent = 0;
    if (lastCpuSnapshot && cpuSnapshot) {
      const idleDelta = cpuSnapshot.idle - lastCpuSnapshot.idle;
      const totalDelta = cpuSnapshot.total - lastCpuSnapshot.total;
      if (totalDelta > 0) {
        cpuPercent = round2((1 - idleDelta / totalDelta) * 100);
      }
    }
    if (cpuSnapshot) {
      lastCpuSnapshot = cpuSnapshot;
    }

    const queue = getQueueSnapshot();
    const activeRuns = state.taskExecutions.filter((execution) =>
      execution.status === "running" ||
      execution.status === "pending" ||
      execution.status === "retrying",
    );
    const now = new Date().toISOString();
    const processMemory = process.memoryUsage();

    state.reviewTelemetrySamples.push({
      reviewSessionId: session.id,
      capturedAt: now,
      bucket: session.activeBucket,
      source: "orchestrator",
      host: {
        cpuPercent,
        load1: round2(load[0] ?? 0),
        load5: round2(load[1] ?? 0),
        load15: round2(load[2] ?? 0),
        memoryUsedBytes: memory?.usedBytes ?? 0,
        memoryTotalBytes: memory?.totalBytes ?? 0,
      },
      process: {
        rssBytes: processMemory.rss,
        heapUsedBytes: processMemory.heapUsed,
        heapTotalBytes: processMemory.heapTotal,
        uptimeSec: process.uptime(),
      },
      activity: {
        openIncidents: state.incidentLedger.filter((incident) => incident.status !== "resolved").length,
        queueDepth: queue.queued + queue.processing,
        activeRuns: activeRuns.length,
        recentRunIds: activeRuns.slice(-5).map((execution) => execution.idempotencyKey),
      },
      tags: [session.activeBucket, resolveCapturePlan(session).profile],
    });
    enforceSessionSampleLimit(session);
  }

  async function sampleActiveSessions() {
    if (sampleInFlight) return;
    sampleInFlight = true;
    try {
      const sessions = state.reviewSessions.filter((session) => session.state === "active");
      for (const session of sessions) {
        await captureSampleForSession(session);
      }
      if (sessions.length > 0) {
        await flushState(["runtime-state"]);
      }
    } finally {
      sampleInFlight = false;
    }
  }

  function ensureSampler() {
    const active = state.reviewSessions.find((session) => session.state === "active") ?? null;
    const desiredIntervalMs = active ? resolveCapturePlan(active).sampleIntervalMs : null;

    if (desiredIntervalMs === null) {
      if (timer) {
        clearInterval(timer);
        timer = null;
        timerIntervalMs = null;
      }
      return;
    }

    if (timer && timerIntervalMs === desiredIntervalMs) {
      return;
    }

    if (timer) {
      clearInterval(timer);
    }

    timer = setInterval(() => {
      void sampleActiveSessions();
    }, desiredIntervalMs);
    timerIntervalMs = desiredIntervalMs;
  }

  async function bootstrapHandoff(payload: ReviewSessionBootstrapHandoffPayload) {
    ensureSingleActiveSession(payload.reviewSessionId);
    let session = getSession(payload.reviewSessionId);
    if (!session) {
      session = createBootstrapSession(payload);
      state.reviewSessions.push(session);
    }

    const handoffReceivedAt = new Date().toISOString();
    session.state = "active";
    session.handoffReceivedAt = handoffReceivedAt;
    session.title = payload.title;
    session.createdAt = payload.createdAt;
    session.startedAt = payload.startupStartedAt;
    session.endedAt = null;
    session.baselineStartedAt = payload.baselineStartedAt;
    session.baselineEndedAt = payload.baselineEndedAt;
    session.startupStartedAt = payload.startupStartedAt;
    session.activeBucket = payload.postHandoffBucket;
    session.capturePlan = payload.capturePlan;
    session.machine = payload.machine;
    session.baselineSummary = payload.baselineSummary;
    session.cumulativeWorkload = session.cumulativeWorkload ?? createEmptyCumulativeWorkload();
    session.summary = null;
    session.failureReason = null;
    session.bucketTimeline = [
      { bucket: "baseline_idle", capturedAt: payload.baselineStartedAt, note: "baseline capture started" },
      { bucket: payload.initialBucket, capturedAt: payload.startupStartedAt, note: "startup began" },
      {
        bucket: payload.postHandoffBucket,
        capturedAt: handoffReceivedAt,
        note:
          payload.postHandoffBucket === payload.initialBucket
            ? "orchestrator accepted ownership"
            : `orchestrator accepted ownership and switched to ${payload.postHandoffBucket}`,
      },
    ];
    session.scenarioNotes = payload.notes;

    state.reviewTelemetrySamples = state.reviewTelemetrySamples.filter(
      (sample) => !(sample.reviewSessionId === payload.reviewSessionId && sample.source === "bootstrap"),
    );
    for (const sample of payload.baselineSamples) {
      state.reviewTelemetrySamples.push({
        reviewSessionId: payload.reviewSessionId,
        capturedAt: sample.capturedAt,
        bucket: "baseline_idle",
        source: "bootstrap",
        host: {
          cpuPercent: sample.cpuPercent,
          load1: sample.loadAvg1m,
          load5: sample.loadAvg1m,
          load15: sample.loadAvg1m,
          memoryUsedBytes: Math.round(sample.memoryUsedMb * 1024 * 1024),
          memoryTotalBytes: Math.round(sample.memoryTotalMb * 1024 * 1024),
        },
        process: {
          rssBytes: null,
          heapUsedBytes: null,
          heapTotalBytes: null,
          uptimeSec: null,
        },
        activity: {
          openIncidents: 0,
          queueDepth: 0,
          activeRuns: 0,
          recentRunIds: [],
        },
        tags: ["baseline_idle", "bootstrap", payload.capturePlan.profile],
      });
    }
    enforceSessionSampleLimit(session);
    ensureSampler();
    await flushState(["runtime-state"]);
    return buildSessionSnapshot(session, state);
  }

  function overview() {
    const sessions = listSessions();
    return {
      generatedAt: new Date().toISOString(),
      activeSession: sessions.find((session) => session.state === "active") ?? null,
      sessions,
    };
  }

  function detail(id: string) {
    const session = getSession(id);
    if (!session) return null;
    return {
      generatedAt: new Date().toISOString(),
      session: buildSessionSnapshot(session, state),
      samples: state.reviewTelemetrySamples.filter(
        (sample) => sample.reviewSessionId === id,
      ),
    };
  }

  async function switchBucket(id: string, bucket: ReviewSessionBucket, note?: string) {
    const session = getSession(id);
    if (!session) throw new Error(`Review session not found: ${id}`);
    requireActiveSession(session, "switch buckets");
    session.activeBucket = bucket;
    const now = new Date().toISOString();
    session.bucketTimeline.push({
      bucket,
      capturedAt: now,
      note: note ?? null,
    });
    if (note) {
      session.scenarioNotes.push({ capturedAt: now, bucket, text: note });
    }
    await flushState(["runtime-state"]);
    return buildSessionSnapshot(session, state);
  }

  async function addNote(id: string, bucket: ReviewSessionBucket, text: string) {
    const session = getSession(id);
    if (!session) throw new Error(`Review session not found: ${id}`);
    requireActiveSession(session, "add notes");
    session.scenarioNotes.push({
      capturedAt: new Date().toISOString(),
      bucket,
      text,
    });
    await flushState(["runtime-state"]);
    return buildSessionSnapshot(session, state);
  }

  async function linkRun(id: string, runId: string) {
    const session = getSession(id);
    if (!session) throw new Error(`Review session not found: ${id}`);
    requireActiveSession(session, "link runs");
    const canonicalRunId = canonicalLinkedRunId(runId);
    if (!session.linkedRunIds.includes(canonicalRunId)) {
      session.linkedRunIds.push(canonicalRunId);
      await flushState(["runtime-state"]);
    }
    return buildSessionSnapshot(session, state);
  }

  async function stop(id: string) {
    const session = getSession(id);
    if (!session) throw new Error(`Review session not found: ${id}`);
    requireActiveSession(session, "stop");
    session.endedAt = new Date().toISOString();
    session.state = "completed";
    session.summary = createSummary(session, state);
    ensureSampler();
    await flushState(["runtime-state"]);
    return session;
  }

  async function failHandoff(reviewSessionId: string, reason: string) {
    const session = getSession(reviewSessionId);
    if (!session) return null;
    if (session.state !== "pending_handoff") return session;
    session.state = "handoff_failed";
    session.endedAt = session.endedAt ?? new Date().toISOString();
    session.failureReason = reason;
    await flushState(["runtime-state"]);
    return buildSessionSnapshot(session, state);
  }

  function exportSession(id: string, format: "json" | "markdown") {
    const session = getSession(id);
    if (!session) throw new Error(`Review session not found: ${id}`);
    const snapshot = buildSessionSnapshot(session, state);
    const samples = state.reviewTelemetrySamples.filter(
      (sample) => sample.reviewSessionId === id,
    );
    if (format === "markdown") {
      return buildMarkdownExport(snapshot, samples);
    }
    return {
      generatedAt: new Date().toISOString(),
      session: snapshot,
      samples,
    };
  }

  ensureSampler();

  return {
    overview,
    detail,
    bootstrapHandoff,
    recordAcceptedRun,
    recordRetriedRun,
    recordCompletedRun,
    switchBucket,
    addNote,
    linkRun,
    stop,
    failHandoff,
    exportSession,
    ensureSampler,
  };
}
