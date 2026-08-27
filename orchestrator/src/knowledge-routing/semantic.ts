import type { KnowledgeRouteEdge, KnowledgeRouteNode, KnowledgeRelationship } from "./types.js";
import { makeEdge } from "./graph.js";

const ALLOWED_RELATIONSHIPS = new Set<KnowledgeRelationship>([
  "depends_on",
  "implemented_by",
  "configured_by",
  "runs_as",
  "reads",
  "writes",
  "documented_by",
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
    const edge = makeEdge(proposal.from, proposal.to, proposal.relationship, proposal.evidence);
    accepted.push({
      ...edge,
      confidence: proposal.confidence ?? "ai-proposed",
      verified: proposal.confidence === "reviewed",
    });
  }

  return { accepted, rejected };
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
