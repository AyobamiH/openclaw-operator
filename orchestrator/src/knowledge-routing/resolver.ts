import type {
  KnowledgeRelationship,
  KnowledgeRouteEdge,
  KnowledgeRouteNode,
  KnowledgeRouteResult,
  KnowledgeRoutingGraph,
} from "./types.js";

const RELATIONSHIP_PRIORITY: KnowledgeRelationship[] = [
  "verified_by",
  "configured_by",
  "implemented_by",
  "stores_state_in",
  "observed_by",
  "documented_by",
  "retrieved_by",
  "requires_approval",
];

export function resolveKnowledgeRoute(
  graph: KnowledgeRoutingGraph,
  query: string,
  limit = 5,
): KnowledgeRouteResult {
  const normalized = normalize(query);
  const scored = graph.nodes
    .map((node) => ({ node, score: scoreNode(node, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      const authority = right.node.authority.priority - left.node.authority.priority;
      return right.score - left.score || authority || left.node.id.localeCompare(right.node.id);
    })
    .slice(0, Math.max(1, Math.min(limit, 20)));
  const recommendedNodes = scored.map((entry) => entry.node);
  const nodeIds = new Set(recommendedNodes.map((node) => node.id));
  const relationshipPath = graph.edges
    .filter((edge) => !edge.stale && (nodeIds.has(edge.from) || nodeIds.has(edge.to)))
    .sort((left, right) => relationshipRank(left) - relationshipRank(right))
    .slice(0, 12);
  const warnings: string[] = [];
  if (recommendedNodes.length === 0) warnings.push("No high-confidence route matched the query.");
  for (const node of recommendedNodes) {
    if (node.management.stale) {
      warnings.push(`${node.id} is stale: ${(node.management.staleReasons ?? []).join("; ")}`);
    }
  }
  return {
    query,
    generatedAt: new Date().toISOString(),
    recommendedNodes,
    authoritativeSources: recommendedNodes
      .filter((node) => node.authority.class === "authoritative" || node.authority.class === "runtime")
      .map((node) => node.source),
    relationshipPath,
    freshnessRequirement: summarizeFreshness(recommendedNodes),
    retrievalMethods: recommendedNodes.map((node) => node.source),
    verificationSources: collectVerificationSources(recommendedNodes, relationshipPath, graph),
    warnings,
  };
}

function normalize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9._:/-]+/)
    .filter((token) => token.length > 1);
}

function scoreNode(node: KnowledgeRouteNode, tokens: string[]): number {
  const haystack = [
    node.id,
    node.kind,
    node.domain,
    node.description,
    node.source.locator,
    ...node.answers,
  ]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length >= 6 ? 3 : 1;
  }
  if (node.management.stale) score -= 3;
  if (node.authority.class === "runtime") score += 2;
  if (node.authority.class === "authoritative") score += 1;
  return score;
}

function relationshipRank(edge: KnowledgeRouteEdge): number {
  const rank = RELATIONSHIP_PRIORITY.indexOf(edge.relationship);
  return rank === -1 ? RELATIONSHIP_PRIORITY.length : rank;
}

function summarizeFreshness(nodes: KnowledgeRouteNode[]): string {
  if (nodes.some((node) => node.freshness.mode === "live")) {
    return "Use live/on-demand verification before making current-state claims.";
  }
  if (nodes.some((node) => node.freshness.mode === "watch")) {
    return "Use the index for navigation, then open the source document only if needed.";
  }
  if (nodes.some((node) => node.freshness.mode === "historical")) {
    return "Use as historical evidence only unless another current source confirms it.";
  }
  return "Retrieve on demand; routing metadata is not the source body.";
}

function collectVerificationSources(
  nodes: KnowledgeRouteNode[],
  edges: KnowledgeRouteEdge[],
  graph: KnowledgeRoutingGraph,
) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const verifiers = [...nodes.map((node) => node.verification)];
  for (const edge of edges.filter((edge) => edge.relationship === "verified_by" || edge.relationship === "observed_by")) {
    const target = nodeById.get(edge.to);
    if (target) verifiers.push(target.verification);
  }
  return Array.from(new Map(verifiers.map((item) => [`${item.method}:${item.target}`, item])).values());
}
