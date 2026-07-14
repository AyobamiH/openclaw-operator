import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { OrchestratorState, Task } from "../types.js";
import type {
  BusinessValueCycle,
  BusinessValueSchedulerState,
  BusinessValueTriggerSource,
} from "./types.js";

export const DEFAULT_BUSINESS_VALUE_CADENCE_MINUTES = 6 * 60;
export const BUSINESS_VALUE_TRIGGER_COOLDOWN_MS = 30_000;
export const BUSINESS_VALUE_STALE_LOCK_MS = 30 * 60_000;

const schedulerWriteQueues = new Map<string, Promise<void>>();

export function createDefaultBusinessValueSchedulerState(): BusinessValueSchedulerState {
  return {
    mode: "disabled",
    cadenceMinutes: DEFAULT_BUSINESS_VALUE_CADENCE_MINUTES,
    lastTriggeredAt: null,
    lastTriggerSource: null,
    lastTriggerReason: null,
    nextRunAt: null,
    lastProgressAt: null,
    consecutiveFailures: 0,
    backoffUntil: null,
    activeTaskId: null,
    activeTaskEnqueuedAt: null,
    lastChangeFingerprint: null,
    lastSkippedAt: null,
    lastSkipReason: null,
  };
}

function normalizeSchedulerState(value: unknown): BusinessValueSchedulerState {
  const input = value && typeof value === "object"
    ? value as Partial<BusinessValueSchedulerState>
    : {};
  return {
    ...createDefaultBusinessValueSchedulerState(),
    ...input,
    mode: input.mode === "enabled" || input.mode === "paused" || input.mode === "disabled"
      ? input.mode
      : "disabled",
    cadenceMinutes: Number.isFinite(input.cadenceMinutes)
      ? Math.min(24 * 60, Math.max(60, Math.floor(input.cadenceMinutes as number)))
      : DEFAULT_BUSINESS_VALUE_CADENCE_MINUTES,
  };
}

export async function loadBusinessValueSchedulerState(
  path: string,
): Promise<BusinessValueSchedulerState | null> {
  try {
    return normalizeSchedulerState(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

export async function saveBusinessValueSchedulerState(
  path: string,
  scheduler: BusinessValueSchedulerState,
) {
  const serialized = JSON.stringify(normalizeSchedulerState(scheduler), null, 2);
  const previous = schedulerWriteQueues.get(path) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(async () => {
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, serialized, "utf8");
      await rename(tempPath, path);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
  });
  schedulerWriteQueues.set(path, write);
  try {
    await write;
  } finally {
    if (schedulerWriteQueues.get(path) === write) {
      schedulerWriteQueues.delete(path);
    }
  }
}

export function ensureBusinessValueSchedulerState(
  state: OrchestratorState,
): BusinessValueSchedulerState {
  if (!state.businessValue) {
    throw new Error("business-value state is unavailable");
  }
  const existing = state.businessValue.scheduler;
  const normalized = {
    ...createDefaultBusinessValueSchedulerState(),
    ...(existing ?? {}),
  };
  if (existing) {
    Object.assign(existing, normalized);
    return existing;
  }
  state.businessValue.scheduler = normalized;
  return normalized;
}

export function computeBusinessValueChangeFingerprint(state: OrchestratorState): string {
  const business = state.businessValue;
  const latestExecutions = state.taskExecutions
    .filter((item) => item.type !== "business-value-cycle")
    .slice(-25)
    .map((item) => [item.idempotencyKey, item.status, item.lastHandledAt]);
  const approvals = state.approvals
    .slice(-25)
    .map((item) => [item.taskId, item.status, item.decidedAt ?? item.requestedAt]);
  const registry = business?.registry;
  const payload = JSON.stringify({
    registryVersion: registry?.registryVersion ?? null,
    registryUpdatedAt: registry?.updatedAt ?? null,
    projects: registry?.projects.map((project) => [
      project.id,
      project.status,
      project.nextSafeAction,
      project.currentBlockers,
      project.acceptanceCriteria.map((criterion) => [criterion.id, criterion.status]),
    ]) ?? [],
    latestExecutions,
    approvals,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function hasLiveBusinessCycleExecution(state: OrchestratorState) {
  return state.taskExecutions.some(
    (item) =>
      item.type === "business-value-cycle" &&
      ["pending", "running", "retrying"].includes(item.status),
  );
}

export function reconcileBusinessValueOperations(
  state: OrchestratorState,
  now = new Date(),
  options: { clearOrphanedLocks?: boolean } = {},
): { changed: boolean; staleLockCleared: boolean } {
  const scheduler = ensureBusinessValueSchedulerState(state);
  let changed = false;
  let staleLockCleared = false;

  if (scheduler.activeTaskId && !hasLiveBusinessCycleExecution(state)) {
    const enqueuedAt = scheduler.activeTaskEnqueuedAt
      ? Date.parse(scheduler.activeTaskEnqueuedAt)
      : Number.NaN;
    const stale =
      options.clearOrphanedLocks === true ||
      !Number.isFinite(enqueuedAt) ||
      now.getTime() - enqueuedAt >= BUSINESS_VALUE_STALE_LOCK_MS;
    if (stale) {
      scheduler.activeTaskId = null;
      scheduler.activeTaskEnqueuedAt = null;
      state.businessValue!.activeCycleId = null;
      scheduler.lastProgressAt = now.toISOString();
      scheduler.lastSkippedAt = now.toISOString();
      scheduler.lastSkipReason = "Cleared stale business-cycle lock after proving no cycle execution remained active.";
      changed = true;
      staleLockCleared = true;
    }
  }

  if (scheduler.mode === "enabled" && !scheduler.nextRunAt) {
    scheduler.nextRunAt = new Date(
      now.getTime() + scheduler.cadenceMinutes * 60_000,
    ).toISOString();
    changed = true;
  }
  return { changed, staleLockCleared };
}

export interface BusinessValueTriggerDecision {
  allowed: boolean;
  code:
    | "ready"
    | "disabled"
    | "paused"
    | "active"
    | "cooldown"
    | "backoff"
    | "not-due"
    | "unchanged";
  reason: string;
  fingerprint: string;
}

export function evaluateBusinessValueTrigger(args: {
  state: OrchestratorState;
  source: BusinessValueTriggerSource;
  now?: Date;
  force?: boolean;
}): BusinessValueTriggerDecision {
  const { state, source, force = false } = args;
  const now = args.now ?? new Date();
  reconcileBusinessValueOperations(state, now);
  const scheduler = ensureBusinessValueSchedulerState(state);
  const fingerprint = computeBusinessValueChangeFingerprint(state);
  const isAutomatic = source === "scheduler" || source === "startup-recovery";

  if (isAutomatic && scheduler.mode === "disabled") {
    return { allowed: false, code: "disabled", reason: "Automatic business cycles are disabled.", fingerprint };
  }
  if (isAutomatic && scheduler.mode === "paused") {
    return { allowed: false, code: "paused", reason: "Automatic business cycles are paused.", fingerprint };
  }
  if (scheduler.activeTaskId || state.businessValue?.activeCycleId || hasLiveBusinessCycleExecution(state)) {
    return { allowed: false, code: "active", reason: "A business-value cycle is already queued or active.", fingerprint };
  }
  if (!force && scheduler.lastTriggeredAt) {
    const lastTriggered = Date.parse(scheduler.lastTriggeredAt);
    if (Number.isFinite(lastTriggered) && now.getTime() - lastTriggered < BUSINESS_VALUE_TRIGGER_COOLDOWN_MS) {
      return { allowed: false, code: "cooldown", reason: "A recent trigger is still inside the duplicate-click cooldown.", fingerprint };
    }
  }
  if (scheduler.backoffUntil && Date.parse(scheduler.backoffUntil) > now.getTime()) {
    return { allowed: false, code: "backoff", reason: `Failure backoff remains active until ${scheduler.backoffUntil}.`, fingerprint };
  }
  if (isAutomatic && scheduler.nextRunAt && Date.parse(scheduler.nextRunAt) > now.getTime()) {
    return { allowed: false, code: "not-due", reason: `Next automatic cycle is scheduled for ${scheduler.nextRunAt}.`, fingerprint };
  }
  if (isAutomatic && scheduler.lastChangeFingerprint === fingerprint) {
    return { allowed: false, code: "unchanged", reason: "Relevant business, task, and approval state has not changed.", fingerprint };
  }
  return { allowed: true, code: "ready", reason: `Governed ${source} trigger accepted.`, fingerprint };
}

export function markBusinessValueCycleEnqueued(args: {
  state: OrchestratorState;
  task: Task;
  source: BusinessValueTriggerSource;
  reason: string;
  fingerprint: string;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const scheduler = ensureBusinessValueSchedulerState(args.state);
  scheduler.activeTaskId = args.task.id;
  scheduler.activeTaskEnqueuedAt = now.toISOString();
  scheduler.lastTriggeredAt = now.toISOString();
  scheduler.lastTriggerSource = args.source;
  scheduler.lastTriggerReason = args.reason;
  scheduler.lastChangeFingerprint = args.fingerprint;
  scheduler.lastProgressAt = now.toISOString();
  scheduler.lastSkippedAt = null;
  scheduler.lastSkipReason = null;
}

export function recordBusinessValueTriggerSkipped(
  state: OrchestratorState,
  decision: BusinessValueTriggerDecision,
  now = new Date(),
) {
  const scheduler = ensureBusinessValueSchedulerState(state);
  scheduler.lastSkippedAt = now.toISOString();
  scheduler.lastSkipReason = decision.reason;
  if (scheduler.mode === "enabled" && ["unchanged", "not-due"].includes(decision.code)) {
    scheduler.nextRunAt = new Date(
      now.getTime() + scheduler.cadenceMinutes * 60_000,
    ).toISOString();
  }
}

export function recordBusinessValueCycleOutcome(
  state: OrchestratorState,
  cycle: BusinessValueCycle,
  now = new Date(),
) {
  const scheduler = ensureBusinessValueSchedulerState(state);
  scheduler.activeTaskId = null;
  scheduler.activeTaskEnqueuedAt = null;
  scheduler.lastProgressAt = now.toISOString();
  if (cycle.status === "failed") {
    scheduler.consecutiveFailures += 1;
    const backoffMinutes = Math.min(
      scheduler.cadenceMinutes,
      15 * 2 ** Math.min(scheduler.consecutiveFailures - 1, 5),
    );
    scheduler.backoffUntil = new Date(now.getTime() + backoffMinutes * 60_000).toISOString();
    scheduler.nextRunAt = scheduler.backoffUntil;
  } else {
    scheduler.consecutiveFailures = 0;
    scheduler.backoffUntil = null;
    scheduler.nextRunAt = scheduler.mode === "enabled"
      ? new Date(now.getTime() + scheduler.cadenceMinutes * 60_000).toISOString()
      : null;
  }
}

export function setBusinessValueSchedulerMode(
  state: OrchestratorState,
  mode: BusinessValueSchedulerState["mode"],
  now = new Date(),
) {
  const scheduler = ensureBusinessValueSchedulerState(state);
  scheduler.mode = mode;
  scheduler.lastProgressAt = now.toISOString();
  scheduler.nextRunAt = mode === "enabled"
    ? new Date(now.getTime() + scheduler.cadenceMinutes * 60_000).toISOString()
    : null;
  if (mode !== "enabled") {
    scheduler.backoffUntil = null;
  }
  return scheduler;
}

export function buildBusinessValueOperationalView(state: OrchestratorState) {
  const business = state.businessValue;
  const scheduler = business?.scheduler ?? createDefaultBusinessValueSchedulerState();
  const cycles = business?.cycles ?? [];
  const latestCycle = cycles.at(-1) ?? null;
  const lastSuccessfulCycle = business?.lastSuccessfulCycleId
    ? cycles.find((cycle) => cycle.cycleId === business.lastSuccessfulCycleId) ?? null
    : null;
  const lastFailedCycle = business?.lastFailedCycleId
    ? cycles.find((cycle) => cycle.cycleId === business.lastFailedCycleId) ?? null
    : null;
  const selectedTask = latestCycle?.selectedTask ?? business?.nextSelectedTask ?? null;
  const selectedExecution = selectedTask?.taskId
    ? state.taskExecutions.find((item) => item.taskId === selectedTask.taskId) ?? null
    : null;
  const selectedCandidate = selectedTask
    ? latestCycle?.candidates.find((candidate) => candidate.id === selectedTask.candidateId) ?? null
    : null;
  const activeTaskExecution = scheduler.activeTaskId
    ? state.taskExecutions.find((item) => item.taskId === scheduler.activeTaskId) ?? null
    : null;

  let loopStatus:
    | "active"
    | "idle"
    | "waiting"
    | "degraded"
    | "failed"
    | "stopped" = "idle";
  if (scheduler.mode === "disabled") loopStatus = "stopped";
  else if (scheduler.mode === "paused") loopStatus = "waiting";
  else if (scheduler.activeTaskId || business?.activeCycleId) loopStatus = "active";
  else if (latestCycle?.status === "failed") loopStatus = "failed";
  else if (scheduler.consecutiveFailures > 0 || scheduler.backoffUntil) loopStatus = "degraded";
  else if (
    (latestCycle?.approvalGatedCandidates.length ?? 0) > 0 &&
    !latestCycle?.selectedTask
  ) loopStatus = "waiting";

  return {
    loopStatus,
    scheduler,
    latestCycle,
    lastSuccessfulCycle,
    lastFailedCycle,
    selectedCandidate,
    selectedTask,
    selectedExecution,
    activeTaskExecution,
    activeWorker: selectedTask?.worker ?? null,
    activeModel: selectedTask?.model ?? selectedExecution?.accounting?.model ?? null,
    verificationStatus:
      selectedTask?.verificationStatus ?? latestCycle?.verificationStatus ?? "not-verified",
    nextSafeTask: latestCycle?.nextSafeAction ?? null,
    approvalGatedCandidates: business?.approvalGatedCandidates ?? [],
    blockers: [
      ...(business?.registry?.projects.flatMap((project) =>
        project.currentBlockers.map((blocker) => ({ projectId: project.id, blocker })),
      ) ?? []),
      ...(latestCycle?.unsupportedCandidates.map((candidate) => ({
        projectId: null,
        blocker: candidate.reason,
      })) ?? []),
    ],
  };
}
