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
  "handled_by",
  "stores_state_in",
  "runs_as",
  "observed_by",
  "documented_by",
  "retrieved_by",
  "uses",
  "requires_approval",
];

const STOP_TOKENS = new Set([
  "what",
  "which",
  "where",
  "when",
  "does",
  "with",
  "from",
  "this",
  "that",
  "current",
  "should",
  "look",
  "source",
  "sources",
]);

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
  const relationshipPath = collectRelationshipPath(graph, recommendedNodes);
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
    authoritativeSources: collectAuthoritativeSources(recommendedNodes, relationshipPath, graph),
    relationshipPath,
    freshnessRequirement: summarizeFreshness(recommendedNodes),
    retrievalMethods: collectRetrievalSources(recommendedNodes, relationshipPath, graph),
    verificationSources: collectVerificationSources(recommendedNodes, relationshipPath, graph),
    warnings,
  };
}

function normalize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9._:/-]+/)
    .filter((token) => token.length > 1 && !STOP_TOKENS.has(token));
}

function scoreNode(node: KnowledgeRouteNode, tokens: string[]): number {
  const query = tokens.join(" ");
  const aliases = [...(node.aliases ?? []), ...(node.taskIntents ?? [])].map((value) => value.toLowerCase());
  const haystack = [
    node.id,
    node.kind,
    node.domain,
    node.description,
    node.source.locator,
    ...node.answers,
    ...aliases,
  ]
    .join(" ")
    .toLowerCase();
  let score = 0;
  if (aliases.some((alias) => query.includes(alias) || alias.includes(query))) score += 50;
  if (query && node.id.replace(/^[^:]+:/, "").replace(/[._:-]+/g, " ").includes(query)) score += 24;
  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length >= 6 ? 3 : 1;
  }
  if (node.management.stale) score -= 3;
  if (node.authority.class === "runtime") score += 2;
  if (node.authority.class === "authoritative") score += 1;
  if (
    node.freshness.mode === "live" &&
    node.source.resolver === "systemctl" &&
    tokens.some((token) => ["actually", "running", "right", "now", "live", "status"].includes(token))
  ) {
    score += 16;
  }
  if (
    tokens.includes("openclaw") &&
    tokens.includes("version") &&
    (node.id === "component:operator.runtime" || node.id === "service:orchestrator.service" || node.id === "repo:openclaw-operator")
  ) {
    score += 22;
  }
  if (
    node.id === "component:operator.state" &&
    tokens.includes("operator") &&
    tokens.some((token) => ["state", "persisted", "persistence", "database"].includes(token))
  ) {
    score += 30;
  }
  if (node.kind === "component") score += 8;
  if (node.kind === "api" && !tokens.some((token) => ["api", "route", "endpoint", "http"].includes(token))) {
    score -= 4;
  }
  return score;
}

function relationshipRank(edge: KnowledgeRouteEdge): number {
  const rank = RELATIONSHIP_PRIORITY.indexOf(edge.relationship);
  return rank === -1 ? RELATIONSHIP_PRIORITY.length : rank;
}

function collectRelationshipPath(graph: KnowledgeRoutingGraph, nodes: KnowledgeRouteNode[]): KnowledgeRouteEdge[] {
  const primary = nodes[0]?.id;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const ranked = graph.edges
    .filter((edge) => !edge.stale && (nodeIds.has(edge.from) || nodeIds.has(edge.to)))
    .sort((left, right) => {
      const leftPrimary = primary && left.from === primary ? 0 : primary && left.to === primary ? 1 : 2;
      const rightPrimary = primary && right.from === primary ? 0 : primary && right.to === primary ? 1 : 2;
      return leftPrimary - rightPrimary || relationshipRank(left) - relationshipRank(right) || left.id.localeCompare(right.id);
    });
  return ranked.slice(0, 12);
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
  return "Retrieve on-demand; routing metadata is not the source body.";
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

function collectAuthoritativeSources(
  nodes: KnowledgeRouteNode[],
  edges: KnowledgeRouteEdge[],
  graph: KnowledgeRoutingGraph,
) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const sources: KnowledgeRouteNode[] = [];
  for (const node of nodes) {
    if (node.source.resolver !== "generated" && (node.authority.class === "authoritative" || node.authority.class === "runtime")) {
      sources.push(node);
    }
  }
  for (const edge of edges) {
    if (!["implemented_by", "configured_by", "runs_as", "stores_state_in", "verified_by", "observed_by", "documented_by", "retrieved_by"].includes(edge.relationship)) {
      continue;
    }
    const target = nodeById.get(edge.to);
    if (!target || target.source.resolver === "generated") continue;
    if (target.authority.class === "authoritative" || target.authority.class === "runtime" || target.authority.class === "historical") {
      sources.push(target);
    }
  }
  return dedupeSources(sources);
}

function collectRetrievalSources(
  nodes: KnowledgeRouteNode[],
  edges: KnowledgeRouteEdge[],
  graph: KnowledgeRoutingGraph,
) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const sources = [...nodes];
  for (const edge of edges) {
    const target = nodeById.get(edge.to);
    if (target) sources.push(target);
  }
  return dedupeSources(sources);
}

function dedupeSources(nodes: KnowledgeRouteNode[]) {
  return Array.from(
    new Map(
      nodes
        .filter((node) => node.source.resolver !== "generated")
        .map((node) => [`${node.source.resolver}:${node.source.locator}`, node.source]),
    ).values(),
  );
}
