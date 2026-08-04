import type { Task } from "../types.js";
import type { GraphStore } from "./store.js";

export type GraphTaskAuthorityDecision = {
  allowed: boolean;
  reason: string;
  graphRunId?: string;
  receiptId?: string;
  approvalId?: string;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Allows the normal queue approval gate to reuse a graph's exact durable
 * approval without trusting caller-supplied internal metadata on its own.
 */
export function verifyGraphChildTaskAuthority(store: GraphStore, task: Task, now = new Date()): GraphTaskAuthorityDecision {
  const parentRunId = text(task.payload.__graphParentRunId);
  const parentNodeId = text(task.payload.__graphParentNodeId);
  const receiptId = text(task.payload.__graphReceiptId);
  const childRunId = text(task.payload.__graphRunId);
  const phase = text(task.payload.__graphPhase);
  const idempotencyKey = text(task.payload.idempotencyKey) ?? text(task.idempotencyKey);
  if (!parentRunId || !parentNodeId || !receiptId || !childRunId || !phase || !idempotencyKey) {
    return { allowed: false, reason: "graph_task_authority_metadata_missing" };
  }
  if (phase !== "child") return { allowed: false, reason: "graph_task_authority_not_child_phase" };
  const run = store.getRun(parentRunId);
  const codingGraph = run?.graphId === "coding-change" && run.graphVersion === "1.2.0";
  const governedTaskGraph = run?.graphId === "governed-task-execution" && run.graphVersion === "1.0.0";
  const digestGraph = run?.graphId === "digest-delivery" && run.graphVersion === "1.0.0";
  if (!run || (!codingGraph && !governedTaskGraph && !digestGraph)) {
    return { allowed: false, reason: "graph_task_authority_unsupported_graph" };
  }
  const receipt = store.childRunReceipt(receiptId);
  if (!receipt || !["prepared", "dispatched", "running"].includes(receipt.status)) {
    return { allowed: false, reason: "graph_task_authority_receipt_not_active" };
  }
  if (receipt.parentRunId !== parentRunId || receipt.parentNodeId !== parentNodeId || receipt.childRunId !== childRunId || receipt.idempotencyKey !== idempotencyKey || receipt.childTaskType !== task.type) {
    return { allowed: false, reason: "graph_task_authority_receipt_mismatch" };
  }
  if (governedTaskGraph || digestGraph) {
    const lane = text(run.input.lane);
    const taskType = text(run.input.taskType);
    const agentId = text(run.input.agentId);
    if (!lane || taskType !== task.type || agentId !== receipt.childAgentId || text(receipt.input.graphLane) !== lane) {
      return { allowed: false, reason: "graph_task_authority_payload_binding_mismatch" };
    }
    if (run.authority.maximum !== "local_persistent" && run.authority.maximum !== "local_reversible" && run.authority.maximum !== "external_reversible" && run.authority.maximum !== "external_public" && run.authority.maximum !== "irreversible") {
      return { allowed: false, reason: "graph_task_authority_insufficient" };
    }
    return { allowed: true, reason: "graph_task_authority_granted", graphRunId: parentRunId, receiptId };
  }
  const approval = store.approvals(parentRunId).find((item) => item.nodeId === parentNodeId && item.status === "granted" && Date.parse(item.expiresAt) > now.getTime());
  if (!approval) return { allowed: false, reason: "graph_task_authority_approval_missing" };
  return { allowed: true, reason: "graph_task_authority_granted", graphRunId: parentRunId, receiptId, approvalId: approval.approvalId };
}
