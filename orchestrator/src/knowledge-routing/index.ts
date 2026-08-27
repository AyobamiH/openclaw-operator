import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { OrchestratorConfig } from "../types.js";
import { discoverKnowledgeRoutingGraph, type KnowledgeRoutingDiscoveryOptions } from "./discovery.js";
import { evaluateKnowledgeRoutingGraph } from "./evaluation.js";
import { resolveKnowledgeRoute } from "./resolver.js";
import { createKnowledgeRoutingShadowComparison, KnowledgeRoutingShadowRecorder } from "./shadow.js";
import { buildKnowledgeRoutingMapViews } from "./views.js";
import type {
  KnowledgeRouteEvaluationReport,
  KnowledgeRouteResult,
  KnowledgeRoutingGraph,
  KnowledgeRoutingShadowComparison,
} from "./types.js";

export interface KnowledgeRoutingRuntimeOptions extends Omit<KnowledgeRoutingDiscoveryOptions, "config"> {
  config?: OrchestratorConfig;
  graphPath?: string;
  shadowLogPath?: string;
  autoRefreshMs?: number;
}

export class KnowledgeRoutingRuntime {
  private graph: KnowledgeRoutingGraph | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: KnowledgeRoutingRuntimeOptions) {}

  async start(): Promise<KnowledgeRoutingGraph> {
    const graph = await this.refresh();
    if (this.options.autoRefreshMs && this.options.autoRefreshMs > 0) {
      this.timer = setInterval(() => {
        void this.refresh().catch((error) => {
          console.error("[knowledge-routing] refresh failed", { error: String(error) });
        });
      }, this.options.autoRefreshMs);
      this.timer.unref?.();
    }
    return graph;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<KnowledgeRoutingGraph> {
    const graph = discoverKnowledgeRoutingGraph(this.options);
    this.graph = graph;
    if (this.options.graphPath) {
      await mkdir(dirname(this.options.graphPath), { recursive: true });
      await writeFile(this.options.graphPath, JSON.stringify(graph, null, 2) + "\n", "utf-8");
    }
    return graph;
  }

  getGraph(): KnowledgeRoutingGraph {
    if (!this.graph) {
      this.graph = discoverKnowledgeRoutingGraph(this.options);
    }
    return this.graph;
  }

  resolve(query: string, limit?: number): KnowledgeRouteResult {
    return resolveKnowledgeRoute(this.getGraph(), query, limit);
  }

  evaluate(): KnowledgeRouteEvaluationReport {
    return evaluateKnowledgeRoutingGraph(this.getGraph());
  }

  async shadowCompare(query: string, existingSourceUsed?: string): Promise<KnowledgeRoutingShadowComparison> {
    const comparison = createKnowledgeRoutingShadowComparison(this.getGraph(), query, existingSourceUsed);
    if (this.options.shadowLogPath) {
      await new KnowledgeRoutingShadowRecorder(this.options.shadowLogPath).record(comparison);
    }
    return comparison;
  }

  getMaps() {
    return buildKnowledgeRoutingMapViews(this.getGraph());
  }
}

export async function loadKnowledgeRoutingGraph(path: string): Promise<KnowledgeRoutingGraph> {
  return JSON.parse(await readFile(resolve(path), "utf-8")) as KnowledgeRoutingGraph;
}

export * from "./types.js";
export { discoverKnowledgeRoutingGraph } from "./discovery.js";
export { evaluateKnowledgeRoutingGraph, DEFAULT_KNOWLEDGE_ROUTING_EVALUATION } from "./evaluation.js";
export { resolveKnowledgeRoute } from "./resolver.js";
export { createKnowledgeRoutingShadowComparison, KnowledgeRoutingShadowRecorder } from "./shadow.js";
export { buildKnowledgeRoutingMapViews } from "./views.js";
export { validateSemanticRelationshipProposals } from "./semantic.js";
