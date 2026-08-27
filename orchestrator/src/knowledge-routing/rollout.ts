import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { evaluateKnowledgeRoutingGraph } from "./evaluation.js";
import type { KnowledgeRoutingGraph, KnowledgeRoutingRolloutCheckpoint, KnowledgeRoutingShadowComparison } from "./types.js";

export interface KnowledgeRoutingRolloutCheckpointInput {
  path: string;
  graph: KnowledgeRoutingGraph;
  operatorRoot: string;
  graphPath?: string;
  shadowLogPath?: string;
}

export async function writeKnowledgeRoutingRolloutCheckpoint(
  input: KnowledgeRoutingRolloutCheckpointInput,
): Promise<KnowledgeRoutingRolloutCheckpoint> {
  const generatedAt = new Date().toISOString();
  const prior = await readPriorCheckpoint(input.path);
  const evaluation = evaluateKnowledgeRoutingGraph(input.graph);
  const shadow = readShadowSummary(input.shadowLogPath);
  const currentCommit = readGitHead(input.operatorRoot) ?? prior?.currentCandidateCommit;
  const checkpoint: KnowledgeRoutingRolloutCheckpoint = {
    schemaVersion: 1,
    program: "knowledge-routing-rollout",
    generatedAt,
    phase: {
      status: shadow.realComparisons > 0 ? "shadow_observing" : "shadow_deployed",
      lastCompletedGate: "shadow-deployment-health",
    },
    currentCandidateCommit: currentCommit,
    productionCommit: currentCommit ?? prior?.productionCommit,
    rollbackCommit: prior?.rollbackCommit,
    graph: {
      buildId: graphBuildId(input.graph),
      nodes: input.graph.stats.nodes,
      edges: input.graph.stats.edges,
      stale: input.graph.stats.staleRoutes,
      unresolved: input.graph.stats.unresolvedRelationships,
    },
    evaluation: {
      fixedTotal: evaluation.summary.totalQueries,
      fixedPassed: evaluation.summary.correct,
      routingAccuracy: evaluation.summary.routingAccuracy,
      authorityAccuracy: evaluation.summary.authorityAccuracy,
    },
    shadow,
    gates: {
      correctness: evaluation.summary.wrongSource === 0 && evaluation.summary.staleSource === 0 && evaluation.summary.noRoute === 0 ? "PASS" : "FAIL",
      authority: evaluation.summary.authorityAccuracy >= 0.8 ? "PASS" : "FAIL",
      safety: "UNPROVEN",
      fallback: "UNPROVEN",
      retrievalImprovement: "UNPROVEN",
      performance: "UNPROVEN",
      activation: "UNPROVEN",
    },
    evidence: [
      input.graphPath ? { kind: "graph", locator: input.graphPath, checkedAt: generatedAt } : undefined,
      { kind: "evaluation", locator: "knowledge-routing://evaluation/default", checkedAt: generatedAt },
      input.shadowLogPath && existsSync(input.shadowLogPath)
        ? { kind: "shadow-log", locator: input.shadowLogPath, checkedAt: generatedAt }
        : undefined,
      currentCommit ? { kind: "git", locator: `${input.operatorRoot}@${currentCommit}`, checkedAt: generatedAt } : undefined,
    ].filter((item): item is KnowledgeRoutingRolloutCheckpoint["evidence"][number] => Boolean(item)),
    nextAction:
      shadow.realComparisons >= 20
        ? "Review activation gates and request separate approval before preferred routing."
        : "Continue collecting bounded real shadow comparisons across materially different domains.",
    approval: {
      required: shadow.realComparisons >= 20,
      reason: shadow.realComparisons >= 20 ? "Preferred routing activation requires separate human approval." : undefined,
    },
  };
  await mkdir(dirname(input.path), { recursive: true });
  await writeFile(input.path, JSON.stringify(checkpoint, null, 2) + "\n", "utf-8");
  return checkpoint;
}

async function readPriorCheckpoint(path: string): Promise<KnowledgeRoutingRolloutCheckpoint | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as KnowledgeRoutingRolloutCheckpoint;
  } catch {
    return null;
  }
}

function readShadowSummary(path?: string): KnowledgeRoutingRolloutCheckpoint["shadow"] {
  const summary: KnowledgeRoutingRolloutCheckpoint["shadow"] = {
    realComparisons: 0,
    exact: 0,
    useful: 0,
    neutral: 0,
    partial: 0,
    wrongSource: 0,
    staleSource: 0,
    noRoute: 0,
    ambiguous: 0,
  };
  if (!path || !existsSync(path)) return summary;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    let record: KnowledgeRoutingShadowComparison;
    try {
      record = JSON.parse(line) as KnowledgeRoutingShadowComparison;
    } catch {
      continue;
    }
    if (!record.informationNeedPreview.startsWith("real:")) continue;
    summary.realComparisons += 1;
    switch (record.resultClassification ?? legacyClassification(record)) {
      case "EXACT":
        summary.exact += 1;
        break;
      case "USEFUL":
        summary.useful += 1;
        break;
      case "NEUTRAL":
        summary.neutral += 1;
        break;
      case "PARTIAL":
        summary.partial += 1;
        break;
      case "WRONG_SOURCE":
        summary.wrongSource += 1;
        break;
      case "STALE_SOURCE":
        summary.staleSource += 1;
        break;
      case "NO_ROUTE":
        summary.noRoute += 1;
        break;
      case "AMBIGUOUS":
        summary.ambiguous += 1;
        break;
    }
  }
  return summary;
}

function legacyClassification(record: KnowledgeRoutingShadowComparison) {
  if (record.agreement === "agree") return "EXACT";
  if (record.agreement === "disagree") return "PARTIAL";
  return "NEUTRAL";
}

function graphBuildId(graph: KnowledgeRoutingGraph): string {
  return createHash("sha256")
    .update(JSON.stringify({ generatedAt: graph.generatedAt, stats: graph.stats }))
    .digest("hex");
}

function readGitHead(operatorRoot: string): string | undefined {
  try {
    return execFileSync("git", ["-C", operatorRoot, "rev-parse", "HEAD"], {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}
