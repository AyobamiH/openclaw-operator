import { decideApproval, operatorApprovalDecisionDigest } from "./approvalGate.js";
import { updateTaskQueueAttempt } from "./task-admission.js";
import type { TaskQueue } from "./taskQueue.js";
import type { ApprovalRecord, OrchestratorState, Task } from "./types.js";

export { operatorApprovalDecisionDigest } from "./approvalGate.js";

export type ApprovalReplayResult = {
  approval: ApprovalRecord;
  decisionId: string;
  decisionDigest: string;
  replay: Task | null;
  replayTaskId: string | null;
  status: "replay-enqueued" | "replay-suppressed" | "rejected" | "cancelled" | "expired";
};

function finalizeStoppedApproval(
  state: OrchestratorState,
  approval: ApprovalRecord,
  reason: "rejected" | "cancelled" | "expired",
  now: string,
): void {
  const execution = state.taskExecutions.find((item) => item.taskId === approval.taskId);
  if (!execution) return;
  execution.status = "failed";
  execution.completedAt = now;
  execution.lastHandledAt = now;
  execution.lastError = "approval_" + reason;
  updateTaskQueueAttempt(execution, approval.taskId, "failed", {
    timestamp: now, detail: "Approval " + reason + "; execution will not resume.",
  });
}

export function enqueueApprovedTaskReplay(args: {
  state: OrchestratorState;
  queue: TaskQueue;
  approval: ApprovalRecord;
  actor: string;
  role?: string;
  requestId?: string | null;
  now?: Date;
}): ApprovalReplayResult {
  const { approval } = args;
  const decisionDigest = operatorApprovalDecisionDigest(approval);
  const decisionId = "approval-decision:" + decisionDigest;
  if (approval.status === "rejected") {
    finalizeStoppedApproval(args.state, approval, "rejected", (args.now ?? new Date()).toISOString());
    return { approval, decisionId, decisionDigest, replay: null, replayTaskId: null, status: "rejected" };
  }
  if (approval.status === "cancelled") {
    finalizeStoppedApproval(args.state, approval, "cancelled", (args.now ?? new Date()).toISOString());
    return { approval, decisionId, decisionDigest, replay: null, replayTaskId: null, status: "cancelled" };
  }
  if (approval.status !== "approved") throw new Error("approval_not_decided");
  const agentProof = approval.payload.agentProof;
  if (agentProof && typeof agentProof === "object") {
    const expiresAt = String((agentProof as Record<string, unknown>).expiresAt ?? "");
    if (!Number.isFinite(Date.parse(expiresAt)) || (args.now ?? new Date()).getTime() >= Date.parse(expiresAt)) {
      finalizeStoppedApproval(args.state, approval, "expired", (args.now ?? new Date()).toISOString());
      return { approval, decisionId, decisionDigest, replay: null, replayTaskId: null, status: "expired" };
    }
  }
  const { idempotencyKey: _ignored, ...approvedPayload } = approval.payload;
  const replay = args.queue.enqueue(approval.type, {
    ...approvedPayload,
    idempotencyKey: "approval-replay:" + approval.taskId,
    approvedFromTaskId: approval.taskId,
    approvalDecisionId: decisionId,
    approvalDecisionDigest: decisionDigest,
    __actor: args.actor,
    __role: args.role ?? "operator",
    __requestId: args.requestId ?? null,
  });
  return {
    approval,
    decisionId,
    decisionDigest,
    replay,
    replayTaskId: replay.admission?.admitted === false ? null : replay.id,
    status: replay.admission?.admitted === false ? "replay-suppressed" : "replay-enqueued",
  };
}

export function decideAndEnqueueApprovalReplay(args: {
  state: OrchestratorState;
  queue: TaskQueue;
  taskId: string;
  decision: "approved" | "rejected";
  actor: string;
  note?: string;
  role?: string;
  requestId?: string | null;
  now?: Date;
}): ApprovalReplayResult {
  const approval = decideApproval(
    args.state,
    args.taskId,
    args.decision,
    args.actor,
    args.note,
    (args.now ?? new Date()).toISOString(),
  );
  return enqueueApprovedTaskReplay({ ...args, approval });
}
