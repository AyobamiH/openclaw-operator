import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { OrchestratorConfig } from "../types.js";
import { discoverKnowledgeRoutingGraph, type KnowledgeRoutingDiscoveryOptions } from "./discovery.js";
import { resolveKnowledgeRoute } from "./resolver.js";
import { buildKnowledgeRoutingMapViews } from "./views.js";
import type { KnowledgeRouteResult, KnowledgeRoutingGraph } from "./types.js";

export interface KnowledgeRoutingRuntimeOptions extends Omit<KnowledgeRoutingDiscoveryOptions, "config"> {
  config?: OrchestratorConfig;
  graphPath?: string;
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

  getMaps() {
    return buildKnowledgeRoutingMapViews(this.getGraph());
  }
}

export async function loadKnowledgeRoutingGraph(path: string): Promise<KnowledgeRoutingGraph> {
  return JSON.parse(await readFile(resolve(path), "utf-8")) as KnowledgeRoutingGraph;
}

export * from "./types.js";
export { discoverKnowledgeRoutingGraph } from "./discovery.js";
export { resolveKnowledgeRoute } from "./resolver.js";
export { buildKnowledgeRoutingMapViews } from "./views.js";
export { validateSemanticRelationshipProposals } from "./semantic.js";
