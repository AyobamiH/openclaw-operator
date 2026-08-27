import type { KnowledgeRouteNode, KnowledgeRoutingGraph, KnowledgeRoutingMapViews } from "./types.js";

export function buildKnowledgeRoutingMapViews(graph: KnowledgeRoutingGraph): KnowledgeRoutingMapViews {
  return {
    systemMap: mermaid(graph, ["service", "agent", "config", "database", "api"]),
    runtimeMap: mermaid(graph, ["service", "cron-job", "database", "verification-source"]),
    knowledgeSourceMap: mermaid(graph, ["documentation", "document-index", "memory", "repository", "database"]),
    repositoryMap: mermaid(graph, ["repository", "worktree", "component", "documentation"]),
    agentCapabilityMap: mermaid(graph, ["agent", "skill", "tool", "plugin"]),
    skillMap: mermaid(graph, ["skill"]),
    pluginMap: mermaid(graph, ["plugin", "tool"]),
    stateStoreMap: mermaid(graph, ["database", "state-store", "cron-job"]),
    verificationMap: mermaid(graph, ["service", "database", "api", "verification-source", "repository"]),
  };
}

function mermaid(graph: KnowledgeRoutingGraph, kinds: KnowledgeRouteNode["kind"][]): string {
  const allowed = new Set(kinds);
  const nodes = graph.nodes.filter((node) => allowed.has(node.kind));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const lines = ["```mermaid", "graph LR"];
  for (const node of nodes.slice(0, 120)) {
    lines.push(`  ${mId(node.id)}["${escapeLabel(node.id)}<br/>${escapeLabel(node.kind)}"]`);
  }
  for (const edge of edges.slice(0, 180)) {
    lines.push(`  ${mId(edge.from)} -->|${edge.relationship}| ${mId(edge.to)}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function mId(value: string): string {
  return `n_${Buffer.from(value).toString("hex").slice(0, 24)}`;
}

function escapeLabel(value: string): string {
  return value.replace(/["<>]/g, "");
}
