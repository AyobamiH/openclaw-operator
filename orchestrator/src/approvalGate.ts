import { ApprovalRecord, OrchestratorConfig, OrchestratorState, Task } from "./types.js";

function requestedTaskTypes(config: OrchestratorConfig): Set<string> {
  const configured = config.approvalRequiredTaskTypes ?? ["agent-deploy", "build-refactor"];
  return new Set(configured.map((item) => String(item)));
}

function isReplayWithApproval(task: Task): string | null {
  const approvedFromTaskId = task.payload.approvedFromTaskId;
  if (typeof approvedFromTaskId !== "string" || approvedFromTaskId.trim().length === 0) {
    return null;
  }
  return approvedFromTaskId;
}

function findApproval(state: OrchestratorState, taskId: string): ApprovalRecord | undefined {
  return state.approvals.find((item) => item.taskId === taskId);
}

function recordPendingApproval(task: Task, state: OrchestratorState): void {
  const existing = findApproval(state, task.id);
  if (existing) return;

  state.approvals.push({
    taskId: task.id,
    type: task.type,
    payload: task.payload,
    requestedAt: new Date().toISOString(),
    status: "pending",
  });
}

export function requiresApproval(task: Task, config: OrchestratorConfig): boolean {
  const explicit = task.payload.requiresApproval === true;
  if (explicit) return true;
  return requestedTaskTypes(config).has(task.type);
}

export function assertApprovalIfRequired(
  task: Task,
  state: OrchestratorState,
  config: OrchestratorConfig,
): { allowed: boolean; reason?: string } {
  if (!requiresApproval(task, config)) {
    return { allowed: true };
  }

  const replayId = isReplayWithApproval(task);
  if (replayId) {
    const replayApproval = findApproval(state, replayId);
    if (replayApproval?.status === "approved") {
      return { allowed: true };
    }
  }

  const current = findApproval(state, task.id);
  if (current?.status === "approved") {
    return { allowed: true };
  }

  recordPendingApproval(task, state);
  return {
    allowed: false,
    reason: "Approval required before execution",
  };
}

export function listPendingApprovals(state: OrchestratorState): ApprovalRecord[] {
  return state.approvals.filter((item) => item.status === "pending");
}

export function decideApproval(
  state: OrchestratorState,
  taskId: string,
  decision: "approved" | "rejected",
  decidedBy: string,
  note?: string,
  decidedAt: string = new Date().toISOString(),
): ApprovalRecord {
  const target = findApproval(state, taskId);
  if (!target) {
    throw new Error(`Approval task not found: ${taskId}`);
  }

  target.status = decision;
  target.decidedAt = decidedAt;
  target.decidedBy = decidedBy;
  target.note = note;

  return target;
}

export function cancelApproval(
  state: OrchestratorState,
  taskId: string,
  cancelledBy: string,
  note?: string,
  cancelledAt: string = new Date().toISOString(),
): ApprovalRecord {
  const target = findApproval(state, taskId);
  if (!target) throw new Error(`Approval task not found: ${taskId}`);
  if (target.status !== "pending") throw new Error(`Approval is already ${target.status}`);
  target.status = "cancelled";
  target.decidedAt = cancelledAt;
  target.decidedBy = cancelledBy;
  target.note = note;
  return target;
}
