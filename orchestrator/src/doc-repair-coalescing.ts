import { buildDocRepairRepairId } from "./coordination/runtime-coordination.js";
import type { OrchestratorState, Task } from "./types.js";

const PENDING_DOC_CHANGE_LIMIT = 200;

function normalizePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((path): path is string => typeof path === "string")
        .map((path) => path.trim())
        .filter(Boolean),
    ),
  ];
}

export function stageDriftRepairPaths(
  state: OrchestratorState,
  task: Task,
): string[] {
  if (task.type !== "drift-repair") return [];
  const idempotencyKey = task.idempotencyKey ?? task.id;
  const exactExecution = state.taskExecutions.find(
    (execution) => execution.idempotencyKey === idempotencyKey,
  );
  if (
    exactExecution?.status === "success" ||
    exactExecution?.status === "failed"
  ) {
    return [];
  }
  const incomingPaths = normalizePaths(task.payload.paths);
  if (incomingPaths.length === 0) return [];

  state.pendingDocChanges = [
    ...new Set([...incomingPaths, ...state.pendingDocChanges]),
  ].slice(0, PENDING_DOC_CHANGE_LIMIT);
  return incomingPaths;
}

export function buildCoalescedDriftRepairPayload(
  state: OrchestratorState,
  terminalTask: Task,
): Record<string, unknown> | null {
  return buildPendingDriftRepairPayload(state, {
    burstIdentity: `follow-up:${terminalTask.id}`,
    requestedBy: "coalesced-doc-drift-follow-up",
    notes: `coalesced after terminal drift repair ${terminalTask.id}`,
    targets: Array.isArray(terminalTask.payload.targets)
      ? normalizePaths(terminalTask.payload.targets)
      : ["doc-specialist"],
    coalescedFromTaskId: terminalTask.id,
  });
}

export function buildStartupDriftRepairPayload(
  state: OrchestratorState,
  startupIdentity: string,
): Record<string, unknown> | null {
  return buildPendingDriftRepairPayload(state, {
    burstIdentity: `startup:${startupIdentity}`,
    requestedBy: "startup-doc-drift-recovery",
    notes: `recovered pending document repairs at startup ${startupIdentity}`,
    targets: ["doc-specialist"],
  });
}

function buildPendingDriftRepairPayload(
  state: OrchestratorState,
  options: {
    burstIdentity: string;
    requestedBy: string;
    notes: string;
    targets: string[];
    coalescedFromTaskId?: string;
  },
): Record<string, unknown> | null {
  const paths = normalizePaths(state.pendingDocChanges);
  if (paths.length === 0) return null;

  const repairId = buildDocRepairRepairId(paths, options.burstIdentity);
  const targets = normalizePaths(options.targets);

  return {
    requestedBy: options.requestedBy,
    paths,
    targets: targets.length > 0 ? targets : ["doc-specialist"],
    notes: options.notes,
    __repairId: repairId,
    ...(options.coalescedFromTaskId
      ? { __coalescedFromTaskId: options.coalescedFromTaskId }
      : {}),
    idempotencyKey: repairId,
  };
}
