import { createHash } from "node:crypto";
import { ApprovalRecord, OrchestratorConfig, OrchestratorState, Task } from "./types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function operatorApprovalDecisionDigest(approval: ApprovalRecord): string {
  return createHash("sha256").update(JSON.stringify(canonicalize({
    taskId: approval.taskId,
    type: approval.type,
    payload: approval.payload,
    requestedAt: approval.requestedAt,
    status: approval.status,
    decidedAt: approval.decidedAt ?? null,
    decidedBy: approval.decidedBy ?? null,
    note: approval.note ?? null,
  }))).digest("hex");
}

const REPLAY_METADATA_KEYS = new Set([
  "idempotencyKey",
  "approvedFromTaskId",
  "approvalDecisionId",
  "approvalDecisionDigest",
  "__actor",
  "__role",
  "__requestId",
]);

function approvedPayloadForComparison(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => !REPLAY_METADATA_KEYS.has(key)),
  );
}

function approvalReplayBindingReason(task: Task, approval: ApprovalRecord): string | null {
  if (approval.status !== "approved") return "approval_replay_not_approved";
  if (approval.type !== task.type) return "approval_replay_task_type_mismatch";
  const digest = operatorApprovalDecisionDigest(approval);
  if (task.payload.approvalDecisionDigest !== digest) return "approval_replay_digest_mismatch";
  if (task.payload.approvalDecisionId !== `approval-decision:${digest}`) return "approval_replay_decision_id_mismatch";
  if (
    JSON.stringify(canonicalize(approvedPayloadForComparison(task.payload))) !==
    JSON.stringify(canonicalize(approvedPayloadForComparison(approval.payload)))
  ) return "approval_replay_payload_mismatch";

  const agentProof = approval.payload.agentProof;
  if (agentProof && typeof agentProof === "object") {
    const expiresAt = String((agentProof as Record<string, unknown>).expiresAt ?? "");
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.now() >= Date.parse(expiresAt)) {
      return "approval_replay_authority_expired";
    }
  }
  return null;
}

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
    payload: structuredClone(task.payload),
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
    if (!replayApproval) return { allowed: false, reason: "approval_replay_source_missing" };
    const bindingFailure = approvalReplayBindingReason(task, replayApproval);
    return bindingFailure
      ? { allowed: false, reason: bindingFailure }
      : { allowed: true, reason: "approval_replay_payload_bound" };
  }

  const current = findApproval(state, task.id);
  if (current?.status === "approved") {
    return { allowed: false, reason: "approved_task_requires_bound_replay" };
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
