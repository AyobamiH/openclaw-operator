import type { KnowledgeRouteEdge, KnowledgeRouteNode, KnowledgeRelationship } from "./types.js";
import { makeEdge } from "./graph.js";

const ALLOWED_RELATIONSHIPS = new Set<KnowledgeRelationship>([
  "depends_on",
  "implemented_by",
  "handled_by",
  "configured_by",
  "runs_as",
  "uses",
  "reads",
  "writes",
  "documented_by",
  "hosts",
  "supersedes",
  "verified_by",
  "observed_by",
  "owned_by",
  "triggered_by",
  "produces",
  "stores_state_in",
  "retrieved_by",
  "requires_approval",
  "exposes",
]);

export interface SemanticRelationshipProposal {
  from: string;
  to: string;
  relationship: KnowledgeRelationship;
  evidence: string[];
  confidence?: "ai-proposed" | "reviewed";
}

export interface SemanticValidationResult {
  accepted: KnowledgeRouteEdge[];
  rejected: Array<SemanticRelationshipProposal & { reason: string }>;
}

export function validateSemanticRelationshipProposals(
  nodes: KnowledgeRouteNode[],
  proposals: SemanticRelationshipProposal[],
): SemanticValidationResult {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const accepted: KnowledgeRouteEdge[] = [];
  const rejected: Array<SemanticRelationshipProposal & { reason: string }> = [];

  for (const proposal of proposals) {
    if (!nodeIds.has(proposal.from)) {
      rejected.push({ ...proposal, reason: `source node does not exist: ${proposal.from}` });
      continue;
    }
    if (!nodeIds.has(proposal.to)) {
      rejected.push({ ...proposal, reason: `target node does not exist: ${proposal.to}` });
      continue;
    }
    if (!ALLOWED_RELATIONSHIPS.has(proposal.relationship)) {
      rejected.push({ ...proposal, reason: `relationship is not allowed: ${String(proposal.relationship)}` });
      continue;
    }
    if (proposal.evidence.length === 0) {
      rejected.push({ ...proposal, reason: "relationship proposal has no source evidence" });
      continue;
    }
    const evidenceReason = validateEvidence(proposal, nodeById);
    if (evidenceReason) {
      rejected.push({ ...proposal, reason: evidenceReason });
      continue;
    }
    const authorityReason = validateAuthorityShape(proposal, nodeById);
    if (authorityReason) {
      rejected.push({ ...proposal, reason: authorityReason });
      continue;
    }
    const edge = makeEdge(proposal.from, proposal.to, proposal.relationship, proposal.evidence);
    accepted.push({
      ...edge,
      confidence: proposal.confidence ?? "ai-proposed",
      verified: proposal.confidence === "reviewed",
    });
  }

  return { accepted, rejected };
}

function validateEvidence(
  proposal: SemanticRelationshipProposal,
  nodeById: Map<string, KnowledgeRouteNode>,
): string | null {
  const from = nodeById.get(proposal.from);
  const to = nodeById.get(proposal.to);
  if (!from || !to) return "proposal endpoints were not available for evidence validation";
  const evidenceText = proposal.evidence.join("\n").toLowerCase();
  const acceptedEvidence = [
    from.id,
    to.id,
    from.source.locator,
    to.source.locator,
    from.verification.target,
    to.verification.target,
  ].map((value) => value.toLowerCase());
  if (!acceptedEvidence.some((value) => value && evidenceText.includes(value))) {
    return "supporting evidence does not reference an existing endpoint locator or verification target";
  }
  return null;
}

function validateAuthorityShape(
  proposal: SemanticRelationshipProposal,
  nodeById: Map<string, KnowledgeRouteNode>,
): string | null {
  const to = nodeById.get(proposal.to);
  if (!to) return "target node was unavailable for authority validation";
  switch (proposal.relationship) {
    case "implemented_by":
      return to.kind === "repository" || to.kind === "worktree"
        ? null
        : "implemented_by must target a repository or worktree";
    case "configured_by":
      return to.kind === "config" ? null : "configured_by must target a config node";
    case "runs_as":
    case "handled_by":
      return to.kind === "service" || to.kind === "component" || to.kind === "agent"
        ? null
        : `${proposal.relationship} must target a service, component or agent`;
    case "documented_by":
      return to.kind === "documentation" || to.kind === "document-index"
        ? null
        : "documented_by must target documentation or a document index";
    case "stores_state_in":
      return to.kind === "database" || to.kind === "state-store" ? null : "stores_state_in must target a state store";
    case "verified_by":
    case "observed_by":
      return to.kind === "service" ||
        to.kind === "api" ||
        to.kind === "database" ||
        to.kind === "verification-source" ||
        (to.kind === "component" && (to.domain === "runtime" || to.domain === "verification"))
        ? null
        : `${proposal.relationship} must target a live, API, database or verification source`;
    case "retrieved_by":
    case "exposes":
      return to.kind === "api" || to.kind === "tool" || to.kind === "component"
        ? null
        : `${proposal.relationship} must target an API, tool or component`;
    case "requires_approval":
      return to.domain === "approvals" || to.id.includes("approval")
        ? null
        : "requires_approval must target an approval authority route or concept";
    default:
      return null;
  }
}

export function classifyRouteSemantics(node: KnowledgeRouteNode): KnowledgeRouteNode {
  const domainHints: Record<string, string[]> = {
    runtime: ["actually running", "service", "health", "live"],
    "agent-runtime": ["agent", "model", "telegram"],
    scheduler: ["cron", "schedule", "job"],
    "capability-routing": ["skill", "capability", "which skill"],
    tooling: ["plugin", "tool", "connector"],
    documentation: ["docs", "documentation", "architecture"],
    state: ["state", "database", "stored"],
  };
  const answers = new Set(node.answers);
  for (const [domain, hints] of Object.entries(domainHints)) {
    if (node.domain !== domain) continue;
    for (const hint of hints) answers.add(`Where should I look for ${hint}?`);
  }
  return {
    ...node,
    answers: Array.from(answers),
    management: {
      ...node.management,
      semanticStage: node.management.semanticStage ?? "deterministic",
    },
  };
}
