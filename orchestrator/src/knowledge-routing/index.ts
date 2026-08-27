import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { OrchestratorConfig } from "../types.js";
import { discoverKnowledgeRoutingGraph, type KnowledgeRoutingDiscoveryOptions } from "./discovery.js";
import { evaluateKnowledgeRoutingGraph } from "./evaluation.js";
import { resolveKnowledgeRoute } from "./resolver.js";
import { writeKnowledgeRoutingRolloutCheckpoint } from "./rollout.js";
import { createKnowledgeRoutingShadowComparison, KnowledgeRoutingShadowRecorder } from "./shadow.js";
import type { KnowledgeRoutingShadowOptions } from "./shadow.js";
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
  rolloutCheckpointPath?: string;
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
    await this.writeRolloutCheckpoint(graph);
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

  async shadowCompare(
    query: string,
    existingSourceUsed?: string,
    options: KnowledgeRoutingShadowOptions = {},
  ): Promise<KnowledgeRoutingShadowComparison> {
    const comparison = createKnowledgeRoutingShadowComparison(this.getGraph(), query, existingSourceUsed, options);
    if (this.options.shadowLogPath) {
      try {
        await new KnowledgeRoutingShadowRecorder(this.options.shadowLogPath).record(comparison);
        await this.writeRolloutCheckpoint(this.getGraph());
        return { ...comparison, recording: { attempted: true, ok: true } };
      } catch (error) {
        console.warn("[knowledge-routing] shadow record failed", { error: error instanceof Error ? error.message : String(error) });
        return {
          ...comparison,
          recording: {
            attempted: true,
            ok: false,
            error: "shadow_record_failed",
          },
        };
      }
    }
    return { ...comparison, recording: { attempted: false, ok: true } };
  }

  getMaps() {
    return buildKnowledgeRoutingMapViews(this.getGraph());
  }

  private async writeRolloutCheckpoint(graph: KnowledgeRoutingGraph): Promise<void> {
    if (!this.options.rolloutCheckpointPath) return;
    try {
      await writeKnowledgeRoutingRolloutCheckpoint({
        path: this.options.rolloutCheckpointPath,
        graph,
        operatorRoot: this.options.operatorRoot,
        graphPath: this.options.graphPath,
        shadowLogPath: this.options.shadowLogPath,
      });
    } catch (error) {
      console.warn("[knowledge-routing] rollout checkpoint failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function loadKnowledgeRoutingGraph(path: string): Promise<KnowledgeRoutingGraph> {
  return JSON.parse(await readFile(resolve(path), "utf-8")) as KnowledgeRoutingGraph;
}

export * from "./types.js";
export { discoverKnowledgeRoutingGraph } from "./discovery.js";
export { evaluateKnowledgeRoutingGraph, DEFAULT_KNOWLEDGE_ROUTING_EVALUATION } from "./evaluation.js";
export { resolveKnowledgeRoute } from "./resolver.js";
export { writeKnowledgeRoutingRolloutCheckpoint } from "./rollout.js";
export { createKnowledgeRoutingShadowComparison, KnowledgeRoutingShadowRecorder } from "./shadow.js";
export { buildKnowledgeRoutingMapViews } from "./views.js";
export { validateSemanticRelationshipProposals } from "./semantic.js";
