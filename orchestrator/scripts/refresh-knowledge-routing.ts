import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { KnowledgeRoutingRuntime } from "../src/knowledge-routing/index.js";

const operatorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspaceRoot = operatorRoot.includes("/projects/.worktrees/")
  ? resolve(operatorRoot, "../../..")
  : resolve(operatorRoot, "../..");
const openclawRoot = resolve(workspaceRoot, "..");
const config = await loadConfig();
const runtime = new KnowledgeRoutingRuntime({
  operatorRoot,
  workspaceRoot,
  openclawRoot,
  openclawConfigPath: join(openclawRoot, "openclaw.json"),
  config,
  graphPath: join(config.logsDir, "knowledge-routing", "routing-graph.generated.json"),
  shadowLogPath: join(config.logsDir, "knowledge-routing", "shadow-routing.jsonl"),
  rolloutCheckpointPath: join(config.logsDir, "knowledge-routing", "rollout-checkpoint.json"),
  runSystemctl: process.env.KNOWLEDGE_ROUTING_SYSTEMD !== "false",
});

const graph = await runtime.refresh();
console.log(
  JSON.stringify(
    {
      ok: true,
      graphPath: join(config.logsDir, "knowledge-routing", "routing-graph.generated.json"),
      generatedAt: graph.generatedAt,
      stats: graph.stats,
    },
    null,
    2,
  ),
);
