import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { evaluateKnowledgeRoutingGraph, KnowledgeRoutingRuntime } from "../src/knowledge-routing/index.js";

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
  runSystemctl: process.env.KNOWLEDGE_ROUTING_SYSTEMD !== "false",
});

const graph = await runtime.refresh();
const report = evaluateKnowledgeRoutingGraph(graph);
const reportPath = join(config.logsDir, "knowledge-routing", "evaluation-report.generated.json");
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
console.log(JSON.stringify({ ok: true, reportPath, summary: report.summary }, null, 2));
