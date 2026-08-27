import { createHash } from "node:crypto";
import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveKnowledgeRoute } from "./resolver.js";
import type { KnowledgeRouteNode, KnowledgeRouteSource, KnowledgeRoutingGraph, KnowledgeRoutingShadowComparison } from "./types.js";

const DEFAULT_MAX_SHADOW_LOG_BYTES = 1_000_000;
const DEFAULT_MAX_SHADOW_RECORD_BYTES = 16_384;

export interface KnowledgeRoutingShadowOptions {
  requestId?: string;
  sessionId?: string;
}

export function createKnowledgeRoutingShadowComparison(
  graph: KnowledgeRoutingGraph,
  informationNeed: string,
  existingSourceUsed?: string,
  options: KnowledgeRoutingShadowOptions = {},
): KnowledgeRoutingShadowComparison {
  const route = resolveKnowledgeRoute(graph, informationNeed, 5);
  const selectedNode = route.recommendedNodes[0]?.id ?? null;
  const match = classifyAgreement(graph, route, existingSourceUsed);
  return {
    generatedAt: new Date().toISOString(),
    informationNeedHash: createHash("sha256").update(informationNeed).digest("hex"),
    informationNeedPreview: preview(informationNeed),
    requestId: options.requestId ? preview(options.requestId, 96) : undefined,
    sessionHash: options.sessionId ? createHash("sha256").update(options.sessionId).digest("hex") : undefined,
    graphRoute: {
      selectedNode,
      relationshipPath: route.relationshipPath.map((edge) => `${edge.from} ${edge.relationship} ${edge.to}`),
      proposedSources: route.authoritativeSources,
      verificationSources: route.verificationSources,
      warnings: route.warnings,
    },
    existingSourceUsed: existingSourceUsed ? preview(existingSourceUsed, 240) : undefined,
    agreement: match.agreement,
    agreementReason: match.agreementReason,
    resultClassification: match.resultClassification,
    matchedSourceIdentity: match.matchedSourceIdentity,
  };
}

export class KnowledgeRoutingShadowRecorder {
  constructor(
    private readonly path: string,
    private readonly options: { maxLogBytes?: number; maxRecordBytes?: number } = {},
  ) {}

  async record(comparison: KnowledgeRoutingShadowComparison): Promise<KnowledgeRoutingShadowComparison> {
    const record = JSON.stringify(comparison);
    const maxRecordBytes = this.options.maxRecordBytes ?? DEFAULT_MAX_SHADOW_RECORD_BYTES;
    if (Buffer.byteLength(record, "utf-8") > maxRecordBytes) {
      throw new Error(`shadow_record_too_large:${Buffer.byteLength(record, "utf-8")}`);
    }
    await mkdir(dirname(this.path), { recursive: true });
    await rotateIfNeeded(this.path, Buffer.byteLength(record, "utf-8") + 1, this.options.maxLogBytes);
    await appendFile(this.path, record + "\n", "utf-8");
    return comparison;
  }
}

async function rotateIfNeeded(path: string, nextBytes: number, maxLogBytes = DEFAULT_MAX_SHADOW_LOG_BYTES) {
  try {
    const current = await stat(path);
    if (current.size + nextBytes <= maxLogBytes) return;
    await rename(path, `${path}.1`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function preview(value: string, maxLength = 160): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "[secret]=[redacted]")
    .replace(/\b(?:sk|ghp|gho|github_pat)_[A-Za-z0-9_]{12,}\b/g, "[token]")
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g, "[token]")
    .replace(/\b\d{8,}\b/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function classifyAgreement(
  graph: KnowledgeRoutingGraph,
  route: ReturnType<typeof resolveKnowledgeRoute>,
  existingSourceUsed?: string,
): Pick<KnowledgeRoutingShadowComparison, "agreement" | "agreementReason" | "resultClassification" | "matchedSourceIdentity"> {
  if (route.recommendedNodes.length === 0) {
    return { agreement: "unknown", agreementReason: "no_graph_route", resultClassification: "NO_ROUTE" };
  }
  if (route.recommendedNodes.some((node) => node.management.stale)) {
    return { agreement: "disagree", agreementReason: "graph_route_marked_stale", resultClassification: "STALE_SOURCE" };
  }
  if (!existingSourceUsed?.trim()) {
    return { agreement: "unknown", agreementReason: "no_existing_source_supplied", resultClassification: "NEUTRAL" };
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const selectedNodes = route.recommendedNodes;
  const pathNodes = route.relationshipPath
    .flatMap((edge) => [edge.from, edge.to])
    .map((id) => nodeById.get(id))
    .filter((node): node is KnowledgeRouteNode => Boolean(node));
  const retrievalNodes = route.retrievalMethods
    .map((source) => graph.nodes.find((node) => sameSource(node.source, source)))
    .filter((node): node is KnowledgeRouteNode => Boolean(node));

  const existingIdentities = sourceIdentities(existingSourceUsed);
  const selectedMatch = matchNodeIdentity(selectedNodes, existingIdentities);
  if (selectedMatch) {
    return {
      agreement: "agree",
      agreementReason: "existing_source_matches_selected_route_identity",
      resultClassification: "EXACT",
      matchedSourceIdentity: selectedMatch,
    };
  }

  const pathMatch = matchNodeIdentity(pathNodes, existingIdentities);
  if (pathMatch) {
    return {
      agreement: "agree",
      agreementReason: "existing_source_matches_relationship_path_identity",
      resultClassification: "USEFUL",
      matchedSourceIdentity: pathMatch,
    };
  }

  const retrievalMatch = matchNodeIdentity(retrievalNodes, existingIdentities);
  if (retrievalMatch) {
    return {
      agreement: "agree",
      agreementReason: "existing_source_matches_retrieval_source_identity",
      resultClassification: "USEFUL",
      matchedSourceIdentity: retrievalMatch,
    };
  }

  const domainMatch = selectedNodes.some((node) =>
    existingIdentities.some((identity) => identity.includes(node.domain) || node.domain.includes(identity)),
  );
  if (domainMatch) {
    return { agreement: "agree", agreementReason: "existing_source_matches_route_domain_only", resultClassification: "PARTIAL" };
  }

  return { agreement: "disagree", agreementReason: "existing_source_identity_not_found_in_route", resultClassification: "WRONG_SOURCE" };
}

function sameSource(left: KnowledgeRouteSource, right: KnowledgeRouteSource): boolean {
  return left.resolver === right.resolver && left.locator === right.locator;
}

function matchNodeIdentity(nodes: KnowledgeRouteNode[], identities: string[]): string | undefined {
  for (const node of nodes) {
    const nodeIdentities = [
      node.id,
      node.source.locator,
      node.verification.target,
      ...sourceIdentities(node.id),
      ...sourceIdentities(node.source.locator),
      ...sourceIdentities(node.verification.target),
    ];
    const match = identities.find((identity) => nodeIdentities.some((candidate) => candidate === identity));
    if (match) return match;
  }
  return undefined;
}

function sourceIdentities(value: string): string[] {
  const lower = value.toLowerCase();
  const identities = new Set<string>();
  identities.add(lower);
  for (const endpoint of lower.match(/\/api\/[a-z0-9._~:/-]+|\/health\b/g) ?? []) identities.add(endpoint);
  for (const service of lower.match(/\b[a-z0-9_.@-]+\.service\b/g) ?? []) identities.add(service);
  for (const node of lower.match(/\b(?:api|component|repo|service|docs|database|config|memory|skill|plugin|cron):[a-z0-9._:/-]+\b/g) ?? []) {
    identities.add(node);
    if (node.startsWith("api:")) identities.add(node.slice(4));
  }
  const hashIndex = lower.indexOf("#");
  if (hashIndex >= 0 && hashIndex < lower.length - 1) identities.add(lower.slice(hashIndex + 1));
  const fileMatch = lower.match(/[a-z0-9._/-]+\.(?:md|json|sqlite|ts)$/);
  if (fileMatch) {
    identities.add(fileMatch[0]);
    identities.add(fileMatch[0].split("/").filter(Boolean).slice(-3).join("/"));
  }
  return Array.from(identities).filter(Boolean);
}
