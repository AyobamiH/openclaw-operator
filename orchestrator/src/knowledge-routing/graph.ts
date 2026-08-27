import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import type {
  KnowledgeRelationship,
  KnowledgeRouteEdge,
  KnowledgeRouteNode,
  KnowledgeRoutingGraph,
  KnowledgeRoutingStats,
} from "./types.js";

export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function sanitizeIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function nodeId(kind: string, id: string): string {
  return `${kind}:${sanitizeIdPart(id)}`;
}

export function makeEdge(
  from: string,
  to: string,
  relationship: KnowledgeRelationship,
  evidence: string[],
): KnowledgeRouteEdge {
  return {
    id: `edge:${sanitizeIdPart(relationship)}:${stableHash({ from, to, relationship }).slice(0, 16)}`,
    from,
    to,
    relationship,
    evidence,
    generated: true,
    verified: true,
    confidence: "deterministic",
  };
}

export function buildGraph(
  nodes: KnowledgeRouteNode[],
  edges: KnowledgeRouteEdge[],
  generatedAt = new Date().toISOString(),
): KnowledgeRoutingGraph {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const uniqueNodes = Array.from(nodeById.values()).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const uniqueEdges = dedupeEdges(edges)
    .map((edge) => validateEdge(edge, nodeById))
    .sort((left, right) => left.id.localeCompare(right.id));
  const graph: KnowledgeRoutingGraph = {
    schemaVersion: 1,
    generatedAt,
    nodes: uniqueNodes.map(markStaleNode),
    edges: uniqueEdges,
    stats: emptyStats(),
  };
  graph.stats = summarizeGraph(graph);
  return graph;
}

function dedupeEdges(edges: KnowledgeRouteEdge[]): KnowledgeRouteEdge[] {
  const merged = new Map<string, KnowledgeRouteEdge>();
  for (const edge of edges) {
    merged.set(edge.id, edge);
  }
  return Array.from(merged.values());
}

function validateEdge(
  edge: KnowledgeRouteEdge,
  nodeById: Map<string, KnowledgeRouteNode>,
): KnowledgeRouteEdge {
  const staleReasons = [...(edge.staleReasons ?? [])];
  if (!nodeById.has(edge.from)) staleReasons.push(`missing source node ${edge.from}`);
  if (!nodeById.has(edge.to)) staleReasons.push(`missing target node ${edge.to}`);
  return {
    ...edge,
    verified: edge.verified && staleReasons.length === 0,
    stale: staleReasons.length > 0 ? true : edge.stale,
    staleReasons: staleReasons.length > 0 ? staleReasons : edge.staleReasons,
  };
}

function markStaleNode(node: KnowledgeRouteNode): KnowledgeRouteNode {
  const staleReasons = [...(node.management.staleReasons ?? [])];
  const locator = node.source.locator;
  if (
    ["file", "directory", "git"].includes(node.source.resolver) &&
    locator &&
    !locator.includes("#") &&
    !existsSync(locator)
  ) {
    staleReasons.push(`missing ${node.source.resolver} target`);
  }
  if (existsSync(locator)) {
    try {
      const stats = statSync(locator);
      if (node.source.resolver === "file" && !stats.isFile()) staleReasons.push("target is not a file");
      if (node.source.resolver === "directory" && !stats.isDirectory()) {
        staleReasons.push("target is not a directory");
      }
    } catch {
      staleReasons.push("target stat failed");
    }
  }
  return {
    ...node,
    management: {
      ...node.management,
      stale: staleReasons.length > 0 ? true : node.management.stale,
      staleReasons: staleReasons.length > 0 ? staleReasons : node.management.staleReasons,
    },
  };
}

function emptyStats(): KnowledgeRoutingStats {
  return {
    nodes: 0,
    edges: 0,
    sourceTypes: {},
    domains: {},
    generatedNodes: 0,
    aiClassifiedNodes: 0,
    verifiedRelationships: 0,
    unresolvedRelationships: 0,
    staleRoutes: 0,
  };
}

export function summarizeGraph(graph: KnowledgeRoutingGraph): KnowledgeRoutingStats {
  const stats = emptyStats();
  stats.nodes = graph.nodes.length;
  stats.edges = graph.edges.length;
  for (const node of graph.nodes) {
    stats.sourceTypes[node.source.type] = (stats.sourceTypes[node.source.type] ?? 0) + 1;
    stats.domains[node.domain] = (stats.domains[node.domain] ?? 0) + 1;
    if (node.management.generated) stats.generatedNodes += 1;
    if (node.management.semanticStage === "ai-proposed") stats.aiClassifiedNodes += 1;
    if (node.management.stale) stats.staleRoutes += 1;
  }
  for (const edge of graph.edges) {
    if (edge.verified && !edge.stale) stats.verifiedRelationships += 1;
    else stats.unresolvedRelationships += 1;
    if (edge.stale) stats.staleRoutes += 1;
  }
  return stats;
}
