import type { AuthorityClass, GraphNodeDefinition, GraphRunState } from "./types.js";
import { AUTHORITY_CLASSES } from "./types.js";
import { sha256 } from "./reducer.js";

export type GraphApproval = {
  approvalId: string;
  runId: string;
  graphVersion: string;
  nodeId: string;
  action: string;
  target: string;
  payloadHash: string;
  status: "pending" | "granted" | "denied" | "expired";
  requestedAt: string;
  decidedAt: string | null;
  expiresAt: string;
  approver: string | null;
  note: string | null;
};

export function authorityRank(value: AuthorityClass): number {
  return AUTHORITY_CLASSES.indexOf(value);
}

export function buildApprovalPayloadHash(payload: unknown): string {
  return sha256(payload);
}

export function evaluateAuthority(args: {
  run: GraphRunState;
  node: GraphNodeDefinition;
  graphMaximum: AuthorityClass;
  approvalThreshold: AuthorityClass;
  payloadHash: string;
  action: string;
  target: string;
  approvals: GraphApproval[];
  now?: Date;
}): { allowed: boolean; needsApproval: boolean; reason: string; approval?: GraphApproval } {
  const now = args.now ?? new Date();
  const requiredRank = Math.max(authorityRank(args.node.authority), authorityRank(args.node.sideEffectClass));
  if (requiredRank > authorityRank(args.graphMaximum)) {
    return { allowed: false, needsApproval: false, reason: "node_exceeds_graph_authority" };
  }
  if (requiredRank > authorityRank(args.run.authority.maximum)) {
    return { allowed: false, needsApproval: false, reason: "node_exceeds_run_authority" };
  }
  if (args.run.authority.expiresAt && Date.parse(args.run.authority.expiresAt) <= now.getTime()) {
    return { allowed: false, needsApproval: false, reason: "run_authority_expired" };
  }
  if (requiredRank < authorityRank(args.approvalThreshold)) {
    return { allowed: true, needsApproval: false, reason: "authority_sufficient" };
  }
  const matching = args.approvals.find((approval) =>
    approval.runId === args.run.runId &&
    approval.graphVersion === args.run.graphVersion &&
    approval.nodeId === args.node.id &&
    approval.action === args.action &&
    approval.target === args.target &&
    approval.payloadHash === args.payloadHash,
  );
  if (!matching) return { allowed: false, needsApproval: true, reason: "approval_required" };
  if (matching.status === "granted" && Date.parse(matching.expiresAt) > now.getTime()) {
    return { allowed: true, needsApproval: false, reason: "bound_approval_granted", approval: matching };
  }
  return {
    allowed: false,
    needsApproval: matching.status === "pending",
    reason: matching.status === "granted" ? "approval_expired" : `approval_${matching.status}`,
    approval: matching,
  };
}

