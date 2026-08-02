import { join } from "node:path";
import { GraphExecutor, NodeExecutorRegistry } from "./engine.js";
import { GraphRegistry } from "./registry.js";
import { registerBuiltinGraphHandlers, LegacyTaskAdapterRegistry } from "./handlers.js";
import { GraphStore } from "./store.js";
import { representativeGraphDefinitions } from "./workflows.js";
import { createProductionAdapterRegistry } from "./production-adapters.js";
import type { ProductionAdapterRegistry } from "./adapter-registry.js";
import { GraphSchedulerStore, resolveGraphSchedulerDatabasePath } from "./scheduler-store.js";

export type GraphRuntime = {
  store: GraphStore;
  registry: GraphRegistry;
  executors: NodeExecutorRegistry;
  legacy: LegacyTaskAdapterRegistry;
  adapters: ProductionAdapterRegistry;
  engine: GraphExecutor;
  scheduler: GraphSchedulerStore;
  zeroWriteOnly: boolean;
  expiredCapabilities: ReturnType<GraphStore["expireOneRunLiveCapabilities"]>;
  recovery: ReturnType<GraphExecutor["recover"]>;
};

export function resolveGraphDatabasePath(): string {
  const configured = process.env.OPENCLAW_GRAPH_DATABASE_PATH?.trim();
  if (configured) return configured;
  const stateRoot = process.env.OPENCLAW_OPERATOR_STATE_DIR?.trim();
  return stateRoot
    ? join(stateRoot, "database", "graph-runs.sqlite")
    : join(process.cwd(), "data", "graph-runs.sqlite");
}

export function createGraphRuntime(path = resolveGraphDatabasePath(), options: { zeroWriteOnly?: boolean; runIdPrefix?: string; allowedDefinitions?: string[]; schedulerPath?: string } = {}): GraphRuntime {
  const zeroWriteOnly = options.zeroWriteOnly ?? true;
  const store = new GraphStore(path);
  const schedulerPath = options.schedulerPath ?? (path === resolveGraphDatabasePath() ? resolveGraphSchedulerDatabasePath() : `${path}.scheduler`);
  const scheduler = new GraphSchedulerStore(schedulerPath);
  const registry = new GraphRegistry();
  const executors = new NodeExecutorRegistry();
  const legacy = new LegacyTaskAdapterRegistry();
  registerBuiltinGraphHandlers(executors, legacy);
  const adapters = createProductionAdapterRegistry(store);
  adapters.bindExecutors(executors);
  const engine = new GraphExecutor(registry, store, executors, undefined, adapters, { zeroWriteOnly, runIdPrefix: options.runIdPrefix });
  const allowed = options.allowedDefinitions ? new Set(options.allowedDefinitions) : null;
  for (const definition of representativeGraphDefinitions()) {
    if (!allowed || allowed.has(`${definition.graphId}@${definition.version}`)) engine.register(definition);
  }
  if (allowed && registry.list().length !== allowed.size) {
    const registered = new Set(registry.list().map((definition) => `${definition.graphId}@${definition.version}`));
    const missing = [...allowed].filter((identity) => !registered.has(identity));
    scheduler.close();
    store.close();
    throw new Error(`graph_allowed_definition_not_found:${missing.join(",")}`);
  }
  const expiredCapabilities = store.expireOneRunLiveCapabilities();
  const recovery = engine.recover();
  return { store, registry, executors, legacy, adapters, engine, scheduler, zeroWriteOnly, expiredCapabilities, recovery };
}
