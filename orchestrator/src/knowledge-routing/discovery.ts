import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import type { OrchestratorConfig } from "../types.js";
import { buildGraph, makeEdge, nodeId, stableHash } from "./graph.js";
import { classifyRouteSemantics } from "./semantic.js";
import type { KnowledgeRouteEdge, KnowledgeRouteNode, KnowledgeRoutingGraph } from "./types.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export interface KnowledgeRoutingDiscoveryOptions {
  operatorRoot: string;
  openclawRoot?: string;
  workspaceRoot?: string;
  openclawConfigPath?: string;
  config?: OrchestratorConfig;
  docsIndexSize?: number;
  now?: string;
  serviceUnits?: Array<{ name: string; active?: string; sub?: string; description?: string }>;
  runSystemctl?: boolean;
}

type MutableDiscovery = {
  nodes: KnowledgeRouteNode[];
  edges: KnowledgeRouteEdge[];
  generatedAt: string;
};

export function discoverKnowledgeRoutingGraph(
  options: KnowledgeRoutingDiscoveryOptions,
): KnowledgeRoutingGraph {
  const generatedAt = options.now ?? new Date().toISOString();
  const operatorRoot = resolve(options.operatorRoot);
  const workspaceRoot = resolve(options.workspaceRoot ?? inferWorkspaceRoot(operatorRoot));
  const openclawRoot = resolve(options.openclawRoot ?? dirname(workspaceRoot));
  const openclawConfigPath = resolve(
    options.openclawConfigPath ?? join(openclawRoot, "openclaw.json"),
  );
  const stateRoot = join(openclawRoot, "state");
  const ctx: MutableDiscovery = { nodes: [], edges: [], generatedAt };

  discoverRepositories(ctx, { operatorRoot, workspaceRoot, openclawRoot, generatedAt });
  discoverConfig(ctx, { openclawConfigPath, operatorRoot, config: options.config, generatedAt });
  discoverAgentsSkillsPlugins(ctx, { openclawConfigPath, workspaceRoot, generatedAt });
  discoverDocuments(ctx, {
    operatorRoot,
    config: options.config,
    docsIndexSize: options.docsIndexSize,
    generatedAt,
  });
  discoverDatabases(ctx, { stateRoot, openclawRoot, config: options.config, generatedAt });
  discoverServices(ctx, { units: options.serviceUnits, runSystemctl: options.runSystemctl, generatedAt });
  discoverOpenApi(ctx, { operatorRoot, generatedAt });
  discoverMemory(ctx, { workspaceRoot, openclawRoot, generatedAt });
  discoverCron(ctx, { openclawRoot, generatedAt });

  addDerivedRelationships(ctx);
  return buildGraph(ctx.nodes.map(classifyRouteSemantics), ctx.edges, generatedAt);
}

function inferWorkspaceRoot(operatorRoot: string): string {
  if (basename(dirname(operatorRoot)) === ".worktrees") {
    return resolve(operatorRoot, "../../..");
  }
  if (basename(dirname(operatorRoot)) === "projects") {
    return resolve(operatorRoot, "../..");
  }
  return dirname(operatorRoot);
}

function baseNode(params: {
  id: string;
  kind: KnowledgeRouteNode["kind"];
  domain: string;
  description: string;
  answers: string[];
  source: KnowledgeRouteNode["source"];
  authority: KnowledgeRouteNode["authority"];
  freshness: KnowledgeRouteNode["freshness"];
  loadPolicy?: string[];
  verification: KnowledgeRouteNode["verification"];
  discoveredBy: string;
  generatedAt: string;
  humanReviewRequired?: boolean;
}): KnowledgeRouteNode {
  return {
    id: params.id,
    kind: params.kind,
    domain: params.domain,
    description: params.description,
    answers: params.answers,
    source: params.source,
    authority: params.authority,
    freshness: params.freshness,
    loadPolicy:
      params.loadPolicy ??
      [
        "Load this source only after routing metadata identifies it as relevant.",
        "Retrieve the smallest range, query, or endpoint needed for the task.",
      ],
    verification: params.verification,
    provenance: {
      discoveredBy: params.discoveredBy,
      sourceHash: stableHash({
        id: params.id,
        locator: params.source.locator,
        description: params.description,
      }),
      generatedAt: params.generatedAt,
    },
    management: {
      generated: true,
      humanReviewRequired: params.humanReviewRequired ?? false,
      semanticStage: "deterministic",
    },
  };
}

function discoverRepositories(
  ctx: MutableDiscovery,
  params: { operatorRoot: string; workspaceRoot: string; openclawRoot: string; generatedAt: string },
) {
  const candidates = [
    {
      id: "openclaw-operator",
      kind: "repository" as const,
      path: params.operatorRoot,
      description: "Portable OpenClaw operator product repository.",
    },
    {
      id: "openclaw-ops",
      kind: "repository" as const,
      path: params.workspaceRoot,
      description: "Host-local OpenClaw operations workspace.",
    },
    {
      id: "telegram-live-execution",
      kind: "worktree" as const,
      path: join(params.workspaceRoot, "projects/.worktrees/openclaw-telegram-live-execution-20260821"),
      description: "Active Telegram gateway runtime source worktree when present.",
    },
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) continue;
    const gitPath = join(candidate.path, ".git");
    ctx.nodes.push(
      baseNode({
        id: nodeId("repo", candidate.id),
        kind: candidate.kind,
        domain: "repository-state",
        description: candidate.description,
        answers: [
          `Which repository owns ${candidate.id}?`,
          `Where is ${candidate.id} source code?`,
          "What source should be inspected before changing this component?",
        ],
        source: { type: "git", locator: candidate.path, resolver: "git" },
        authority: {
          class: "authoritative",
          priority: 80,
          reason: "Git worktree/source path is the current implementation authority for code behavior.",
        },
        freshness: { mode: "on-demand", checkedAt: params.generatedAt },
        verification: { method: "git", target: gitPath },
        discoveredBy: "repository-adapter",
        generatedAt: params.generatedAt,
      }),
    );
  }
}

function discoverConfig(
  ctx: MutableDiscovery,
  params: {
    openclawConfigPath: string;
    operatorRoot: string;
    config?: OrchestratorConfig;
    generatedAt: string;
  },
) {
  if (existsSync(params.openclawConfigPath)) {
    ctx.nodes.push(
      baseNode({
        id: nodeId("config", "openclaw"),
        kind: "config",
        domain: "agent-runtime",
        description: "Main OpenClaw runtime configuration, including channels, agents, plugins, tools and models.",
        answers: [
          "What is the current model configuration?",
          "Which agents/plugins/tools are configured?",
          "How is Telegram configured?",
        ],
        source: { type: "openclaw-config", locator: params.openclawConfigPath, resolver: "openclaw-config" },
        authority: {
          class: "authoritative",
          priority: 95,
          reason: "Current config outranks documentation that describes intended runtime behavior.",
        },
        freshness: { mode: "on-demand", maxAgeSeconds: 300, checkedAt: params.generatedAt },
        verification: { method: "config-read", target: params.openclawConfigPath },
        discoveredBy: "openclaw-config-adapter",
        generatedAt: params.generatedAt,
      }),
    );
  }
  const orchestratorConfigPath = join(params.operatorRoot, "orchestrator_config.json");
  if (existsSync(orchestratorConfigPath)) {
    ctx.nodes.push(
      baseNode({
        id: nodeId("config", "operator-orchestrator"),
        kind: "config",
        domain: "operator-runtime",
        description: "Operator orchestrator configuration and source locations.",
        answers: ["Where are operator docs/logs/state configured?", "What paths does the operator runtime use?"],
        source: { type: "file", locator: orchestratorConfigPath, resolver: "file" },
        authority: { class: "authoritative", priority: 90, reason: "Loaded orchestrator config owns operator paths." },
        freshness: { mode: "on-demand", checkedAt: params.generatedAt },
        verification: { method: "exists", target: orchestratorConfigPath },
        discoveredBy: "operator-config-adapter",
        generatedAt: params.generatedAt,
      }),
    );
  }
}

function readJsonIfPresent(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function discoverAgentsSkillsPlugins(
  ctx: MutableDiscovery,
  params: { openclawConfigPath: string; workspaceRoot: string; generatedAt: string },
) {
  const cfg = readJsonIfPresent(params.openclawConfigPath) as Record<string, unknown> | null;
  const agents = cfg && typeof cfg.agents === "object" ? (cfg.agents as Record<string, unknown>) : {};
  const agentList = Array.isArray((agents as { list?: unknown }).list)
    ? ((agents as { list: Array<Record<string, unknown>> }).list)
    : [];
  for (const agent of agentList) {
    const id = typeof agent.id === "string" ? agent.id : undefined;
    if (!id) continue;
    ctx.nodes.push(
      baseNode({
        id: nodeId("agent", id),
        kind: "agent",
        domain: "agent-runtime",
        description: `Configured OpenClaw agent ${id}.`,
        answers: [`Which agent handles ${id} work?`, "What model/runtime does this agent use?"],
        source: { type: "openclaw-config", locator: `${params.openclawConfigPath}#agents.list.${id}`, resolver: "openclaw-config" },
        authority: { class: "authoritative", priority: 90, reason: "Agent configuration is loaded from OpenClaw config." },
        freshness: { mode: "on-demand", checkedAt: params.generatedAt },
        verification: { method: "config-read", target: params.openclawConfigPath },
        discoveredBy: "agent-config-adapter",
        generatedAt: params.generatedAt,
      }),
    );
    ctx.edges.push(makeEdge(nodeId("agent", id), nodeId("config", "openclaw"), "configured_by", [params.openclawConfigPath]));
  }

  const skillRoots = [
    join(params.workspaceRoot, "skills"),
    join(params.workspaceRoot, ".agents/skills"),
    join(params.workspaceRoot, ".openclaw/skills"),
  ];
  for (const root of skillRoots) discoverSkillRoot(ctx, root, params.generatedAt);

  const plugins = cfg && typeof cfg.plugins === "object" ? (cfg.plugins as Record<string, unknown>) : {};
  for (const [pluginId, pluginConfig] of Object.entries(plugins)) {
    const enabled = typeof pluginConfig === "object" && pluginConfig !== null
      ? (pluginConfig as { enabled?: unknown }).enabled !== false
      : true;
    ctx.nodes.push(
      baseNode({
        id: nodeId("plugin", pluginId),
        kind: "plugin",
        domain: "tooling",
        description: `OpenClaw plugin ${pluginId}${enabled ? "" : " (disabled in config)"}.`,
        answers: ["Which plugins are enabled?", `What owns plugin ${pluginId}?`],
        source: { type: "openclaw-config", locator: `${params.openclawConfigPath}#plugins.${pluginId}`, resolver: "openclaw-config" },
        authority: { class: "authoritative", priority: 90, reason: "Plugin configuration is loaded from OpenClaw config." },
        freshness: { mode: "on-demand", checkedAt: params.generatedAt },
        verification: { method: "config-read", target: params.openclawConfigPath },
        discoveredBy: "plugin-config-adapter",
        generatedAt: params.generatedAt,
      }),
    );
    ctx.edges.push(makeEdge(nodeId("plugin", pluginId), nodeId("config", "openclaw"), "configured_by", [params.openclawConfigPath]));
  }
}

function discoverSkillRoot(ctx: MutableDiscovery, root: string, generatedAt: string) {
  if (!existsSync(root)) return;
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory() || dirent.name.startsWith(".")) continue;
    const skillPath = join(root, dirent.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    ctx.nodes.push(
      baseNode({
        id: nodeId("skill", dirent.name),
        kind: "skill",
        domain: "capability-routing",
        description: `Skill instruction source ${dirent.name}.`,
        answers: [`Which skill applies to ${dirent.name}?`, "Where are skill instructions stored?"],
        source: { type: "file", locator: skillPath, resolver: "file" },
        authority: { class: "advisory", priority: 60, reason: "Skill files route behavior but do not prove runtime truth." },
        freshness: { mode: "on-demand", checkedAt: generatedAt },
        verification: { method: "exists", target: skillPath },
        discoveredBy: "skill-registry-adapter",
        generatedAt,
      }),
    );
  }
}

function discoverDocuments(
  ctx: MutableDiscovery,
  params: { operatorRoot: string; config?: OrchestratorConfig; docsIndexSize?: number; generatedAt: string },
) {
  const docsIndex = join(params.operatorRoot, "docs/INDEX.md");
  if (existsSync(docsIndex)) {
    ctx.nodes.push(
      baseNode({
        id: nodeId("docs", "operator-index"),
        kind: "documentation",
        domain: "documentation",
        description: "Operator documentation index and authority order.",
        answers: ["Which docs are canonical?", "Where should documentation navigation start?"],
        source: { type: "file", locator: docsIndex, resolver: "file" },
        authority: { class: "authoritative", priority: 70, reason: "Docs index owns documentation navigation, not runtime truth." },
        freshness: { mode: "watch", checkedAt: params.generatedAt },
        verification: { method: "exists", target: docsIndex },
        discoveredBy: "docs-index-adapter",
        generatedAt: params.generatedAt,
      }),
    );
  }
  const docsPath = params.config?.docsPath;
  if (docsPath && existsSync(docsPath)) {
    ctx.nodes.push(
      baseNode({
        id: nodeId("document-index", "configured-docs"),
        kind: "document-index",
        domain: "documentation",
        description: `Configured document index root (${params.docsIndexSize ?? 0} indexed records observed by runtime when provided).`,
        answers: ["Which document corpus should be searched?", "Where are indexed docs rooted?"],
        source: { type: "directory", locator: docsPath, resolver: "directory" },
        authority: { class: "derived", priority: 55, reason: "The index locates docs; each source document owns its contents." },
        freshness: { mode: "watch", checkedAt: params.generatedAt },
        verification: { method: "exists", target: docsPath },
        discoveredBy: "doc-index-adapter",
        generatedAt: params.generatedAt,
      }),
    );
  }
}

function discoverDatabases(
  ctx: MutableDiscovery,
  params: { stateRoot: string; openclawRoot: string; config?: OrchestratorConfig; generatedAt: string },
) {
  const candidates = [
    join(params.openclawRoot, "state/openclaw.sqlite"),
    join(params.openclawRoot, "state/openclaw-operator/database/graph-runs.sqlite"),
    join(params.openclawRoot, "state/openclaw-operator/database/graph-scheduler.sqlite"),
    join(params.openclawRoot, "state/openclaw-operator/database/operator.sqlite"),
    join(params.openclawRoot, "state/openclaw-operator/database/toolgate.sqlite"),
    params.config?.publishingDatabasePath,
  ].filter((value): value is string => Boolean(value));
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const tables = readSqliteTables(path);
    const base = basename(path, extname(path));
    ctx.nodes.push(
      baseNode({
        id: nodeId("database", base),
        kind: "database",
        domain: tableDomain(tables),
        description: `SQLite state store ${base} with ${tables.length} table(s).`,
        answers: [`Where is ${base} state stored?`, "Which SQLite database owns this state?"],
        source: { type: "sqlite", locator: path, resolver: "sqlite-schema" },
        authority: { class: "authoritative", priority: 85, reason: "SQLite stores own current durable state, not descriptive knowledge bodies." },
        freshness: { mode: "live", maxAgeSeconds: 300, checkedAt: params.generatedAt },
        verification: { method: "sqlite-schema", target: path },
        discoveredBy: "sqlite-schema-adapter",
        generatedAt: params.generatedAt,
      }),
    );
  }
}

function readSqliteTables(path: string): string[] {
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
    db.close();
    return rows.map((row) => row.name);
  } catch {
    return [];
  }
}

function tableDomain(tables: string[]): string {
  if (tables.some((table) => table.startsWith("graph_"))) return "execution-graph";
  if (tables.some((table) => table.includes("knowledge") || table.includes("concept"))) return "knowledge-base";
  if (tables.some((table) => table.includes("cron"))) return "scheduler";
  if (tables.some((table) => table.includes("publishing"))) return "publishing-state";
  return "state";
}

function discoverServices(
  ctx: MutableDiscovery,
  params: {
    units?: Array<{ name: string; active?: string; sub?: string; description?: string }>;
    runSystemctl?: boolean;
    generatedAt: string;
  },
) {
  const units = params.units ?? (params.runSystemctl ? readSystemdUnits() : []);
  for (const unit of units.filter((entry) => /openclaw|orchestrator|doc-specialist/.test(entry.name))) {
    const extraAnswers = unit.name === "openclaw-gateway.service"
      ? ["What handles Telegram runtime?", "Which service owns the Telegram gateway?", "Is Telegram still working?"]
      : unit.name.includes("orchestrator")
        ? ["Which source tells us whether operator is healthy?", "Where is the operator API running?"]
        : [];
    ctx.nodes.push(
      baseNode({
        id: nodeId("service", unit.name),
        kind: "service",
        domain: "runtime",
        description: `${unit.description ?? unit.name} (${unit.active ?? "unknown"}/${unit.sub ?? "unknown"}).`,
        answers: ["What is actually running right now?", `What is the status of ${unit.name}?`, ...extraAnswers],
        source: { type: "systemd", locator: unit.name, resolver: "systemctl" },
        authority: { class: "runtime", priority: 100, reason: "Live service state outranks static documentation for runtime questions." },
        freshness: { mode: "live", maxAgeSeconds: 60, checkedAt: params.generatedAt },
        verification: { method: "systemctl", target: unit.name },
        discoveredBy: "systemd-service-adapter",
        generatedAt: params.generatedAt,
      }),
    );
  }
}

function readSystemdUnits(): Array<{ name: string; active?: string; sub?: string; description?: string }> {
  try {
    const output = execFileSync("systemctl", ["--user", "list-units", "--type=service", "--all", "--plain", "--no-legend"], {
      encoding: "utf-8",
      timeout: 3000,
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/);
        const [name, , active, sub, ...description] = parts;
        return { name, active, sub, description: description.join(" ") };
      });
  } catch {
    return [];
  }
}

function discoverOpenApi(ctx: MutableDiscovery, params: { operatorRoot: string; generatedAt: string }) {
  const openapiPath = join(params.operatorRoot, "orchestrator/src/openapi.ts");
  if (!existsSync(openapiPath)) return;
  const raw = readFileSync(openapiPath, "utf-8");
  const paths = Array.from(raw.matchAll(/"\/(api|health)[^"]+"/g)).map((match) => match[0].slice(1, -1));
  const unique = Array.from(new Set(paths)).slice(0, 250);
  for (const route of unique) {
    const routeAnswers = [`Which API route serves ${route}?`, "What runtime API can verify or retrieve this source?"];
    if (route.includes("approvals")) {
      routeAnswers.push("What still requires approval?", "Where is current approval state?");
    }
    if (route.includes("health")) {
      routeAnswers.push("Which source tells us whether operator is healthy?", "Where is runtime health verified?");
    }
    if (route.includes("knowledge-routing")) {
      routeAnswers.push("Where should an agent route an information need?", "How does the agent find authoritative sources?");
    }
    ctx.nodes.push(
      baseNode({
        id: nodeId("api", route),
        kind: "api",
        domain: route.includes("knowledge") ? "knowledge-routing" : "operator-api",
        description: `Operator API route ${route}.`,
        answers: routeAnswers,
        source: { type: "openapi", locator: `${openapiPath}#${route}`, resolver: "openapi" },
        authority: { class: "derived", priority: 65, reason: "OpenAPI/source route metadata locates APIs; live HTTP verifies availability." },
        freshness: { mode: "on-demand", checkedAt: params.generatedAt },
        verification: { method: "exists", target: openapiPath },
        discoveredBy: "openapi-adapter",
        generatedAt: params.generatedAt,
      }),
    );
  }
}

function discoverMemory(ctx: MutableDiscovery, params: { workspaceRoot: string; openclawRoot: string; generatedAt: string }) {
  const memoryIndex = join(params.workspaceRoot, "MEMORY.md");
  if (existsSync(memoryIndex)) {
    ctx.nodes.push(
      baseNode({
        id: nodeId("memory", "current-index"),
        kind: "memory",
        domain: "memory",
        description: "Durable memory source-of-truth index.",
        answers: ["Where are durable decisions recorded?", "How should historical memory be interpreted?"],
        source: { type: "memory", locator: memoryIndex, resolver: "file" },
        authority: { class: "advisory", priority: 60, reason: "Memory points to decisions and history; current runtime still wins for present-state claims." },
        freshness: { mode: "on-demand", checkedAt: params.generatedAt },
        verification: { method: "exists", target: memoryIndex },
        discoveredBy: "memory-adapter",
        generatedAt: params.generatedAt,
      }),
    );
  }
}

function discoverCron(ctx: MutableDiscovery, params: { openclawRoot: string; generatedAt: string }) {
  const cronStore = join(params.openclawRoot, "cron/jobs.json");
  if (!existsSync(cronStore)) return;
  ctx.nodes.push(
    baseNode({
      id: nodeId("cron", "openclaw-jobs"),
      kind: "cron-job",
      domain: "scheduler",
      description: "OpenClaw cron job registry.",
      answers: ["Where is cron state stored?", "Which scheduled jobs exist?"],
      source: { type: "file", locator: cronStore, resolver: "file" },
      authority: { class: "authoritative", priority: 80, reason: "Cron registry and SQLite run logs own scheduled-work state." },
      freshness: { mode: "live", maxAgeSeconds: 300, checkedAt: params.generatedAt },
      verification: { method: "exists", target: cronStore },
      discoveredBy: "cron-registry-adapter",
      generatedAt: params.generatedAt,
    }),
  );
}

function addDerivedRelationships(ctx: MutableDiscovery) {
  const has = (id: string) => ctx.nodes.some((node) => node.id === id);
  const edge = (from: string, to: string, rel: Parameters<typeof makeEdge>[2], evidence: string[]) => {
    if (has(from) && has(to)) ctx.edges.push(makeEdge(from, to, rel, evidence));
  };
  edge(nodeId("service", "openclaw-gateway.service"), nodeId("config", "openclaw"), "configured_by", ["openclaw config"]);
  edge(nodeId("service", "openclaw-gateway.service"), nodeId("repo", "telegram-live-execution"), "implemented_by", ["systemd ExecStart worktree"]);
  edge(nodeId("service", "orchestrator.service"), nodeId("repo", "openclaw-operator"), "implemented_by", ["systemd service/source repo"]);
  edge(nodeId("repo", "openclaw-operator"), nodeId("docs", "operator-index"), "documented_by", ["docs/INDEX.md"]);
  edge(nodeId("config", "openclaw"), nodeId("database", "openclaw"), "stores_state_in", ["OpenClaw sqlite state"]);
  edge(nodeId("cron", "openclaw-jobs"), nodeId("database", "openclaw"), "stores_state_in", ["cron sqlite store"]);
  edge(nodeId("database", "graph-runs"), nodeId("api", "/api/graphs/runs"), "retrieved_by", ["graph API routes"]);
  edge(nodeId("document-index", "configured-docs"), nodeId("api", "/api/knowledge/summary"), "observed_by", ["knowledge summary API"]);
}

export function relativeLocator(root: string, locator: string): string {
  if (!locator.startsWith(root)) return locator;
  return relative(root, locator) || ".";
}
