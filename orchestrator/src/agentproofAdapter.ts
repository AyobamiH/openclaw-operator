import { canonicalDocumentDigest, type PortableApprovalDecisionDocument, type PortableApprovalRequestDocument } from "@openclaw/agentproof";
import { operatorApprovalDecisionDigest } from "./approvalReplay.js";
import type { ApprovalRecord, Task } from "./types.js";

export function adaptApprovedReplayToAgentProofDevelopmentDecision(args: {
  approval: ApprovalRecord;
  replay: Task;
  approvalRequest: PortableApprovalRequestDocument;
  authorityIssuer: { issue(request: PortableApprovalRequestDocument, context: { issuer: string; decidedAt: string }): PortableApprovalDecisionDocument };
}): PortableApprovalDecisionDocument {
  if (args.approval.status !== "approved" || !args.approval.decidedAt || !args.approval.decidedBy) throw new Error("agentproof_operator_approval_not_approved");
  if (args.replay.payload.approvedFromTaskId !== args.approval.taskId) throw new Error("agentproof_operator_replay_link_invalid");
  const digest = operatorApprovalDecisionDigest(args.approval);
  if (args.replay.payload.approvalDecisionDigest !== digest || args.replay.payload.approvalDecisionId !== `approval-decision:${digest}`) throw new Error("agentproof_operator_decision_binding_invalid");
  if (args.approval.payload.agentProofApprovalRequestDigest !== args.approvalRequest.requestDigest ||
      args.approval.payload.agentProofApprovalDocumentDigest !== canonicalDocumentDigest(args.approvalRequest)) throw new Error("agentproof_operator_prepared_request_binding_invalid");
  return args.authorityIssuer.issue(args.approvalRequest, { issuer: args.approval.decidedBy, decidedAt: args.approval.decidedAt });
}
