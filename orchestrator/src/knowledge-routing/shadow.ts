import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveKnowledgeRoute } from "./resolver.js";
import type { KnowledgeRoutingGraph, KnowledgeRoutingShadowComparison } from "./types.js";

export function createKnowledgeRoutingShadowComparison(
  graph: KnowledgeRoutingGraph,
  informationNeed: string,
  existingSourceUsed?: string,
): KnowledgeRoutingShadowComparison {
  const route = resolveKnowledgeRoute(graph, informationNeed, 5);
  const selectedNode = route.recommendedNodes[0]?.id ?? null;
  const proposedLocators = new Set(route.authoritativeSources.map((source) => source.locator));
  const agreement = existingSourceUsed
    ? Array.from(proposedLocators).some((locator) => locator.includes(existingSourceUsed) || existingSourceUsed.includes(locator))
      ? "agree"
      : "disagree"
    : "unknown";
  return {
    generatedAt: new Date().toISOString(),
    informationNeedHash: createHash("sha256").update(informationNeed).digest("hex"),
    informationNeedPreview: preview(informationNeed),
    graphRoute: {
      selectedNode,
      relationshipPath: route.relationshipPath.map((edge) => `${edge.from} ${edge.relationship} ${edge.to}`),
      proposedSources: route.authoritativeSources,
      verificationSources: route.verificationSources,
      warnings: route.warnings,
    },
    existingSourceUsed,
    agreement,
  };
}

export class KnowledgeRoutingShadowRecorder {
  constructor(private readonly path: string) {}

  async record(comparison: KnowledgeRoutingShadowComparison): Promise<KnowledgeRoutingShadowComparison> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(comparison) + "\n", "utf-8");
    return comparison;
  }
}

function preview(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b\d{8,}\b/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}
