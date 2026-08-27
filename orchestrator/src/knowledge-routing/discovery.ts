import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import type { OrchestratorConfig } from "../types.js";
import { buildGraph, makeEdge, nodeId, stableHash } from "./graph.js";
import { classifyRouteSemantics, validateSemanticRelationshipProposals } from "./semantic.js";
import type {
  KnowledgeRouteEdge,
  KnowledgeRouteNode,
  KnowledgeRoutingGraph,
  KnowledgeRoutingSemanticAudit,
} from "./types.js";

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
  semanticAudit?: KnowledgeRoutingSemanticAudit;
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

  addSemanticConcepts(ctx);
  addDerivedRelationships(ctx);
  addSemanticRelationships(ctx);
  return buildGraph(ctx.nodes.map(classifyRouteSemantics), ctx.edges, generatedAt, ctx.semanticAudit);
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
  aliases?: string[];
  taskIntents?: string[];
  semanticStage?: KnowledgeRouteNode["management"]["semanticStage"];
}): KnowledgeRouteNode {
  return {
    id: params.id,
    kind: params.kind,
    domain: params.domain,
    description: params.description,
    answers: params.answers,
    aliases: params.aliases,
    taskIntents: params.taskIntents,
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
      semanticStage: params.semanticStage ?? "deterministic",
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
  discoverDocumentFile(ctx, params.operatorRoot, {
    id: "knowledge-routing-foundation",
    path: "docs/operations/knowledge-routing-foundation.md",
    domain: "knowledge-routing",
    authority: "authoritative",
    description: "Knowledge-routing foundation design and operating contract.",
    answers: [
      "Which source describes knowledge-routing architecture?",
      "How should agents navigate current source truth?",
    ],
    aliases: ["knowledge routing docs", "knowledge routing foundation"],
    intents: ["routing architecture", "knowledge navigation contract"],
    generatedAt: params.generatedAt,
  });
  discoverDocumentFile(ctx, params.operatorRoot, {
    id: "operator-deployment",
    path: "docs/operations/deployment.md",
    domain: "deployment",
    authority: "advisory",
    description: "Operator deployment runbook and deployment boundaries.",
    answers: ["Which source describes deployment procedure?", "What evidence is needed before deployment claims?"],
    aliases: ["deployment runbook", "operator deployment"],
    intents: ["deployment question", "activation question"],
    generatedAt: params.generatedAt,
  });
  discoverDocumentFile(ctx, params.operatorRoot, {
    id: "live-runtime-branch-first-development",
    path: "docs/operations/live-runtime-branch-first-development.md",
    domain: "deployment",
    authority: "advisory",
    description: "Live-runtime branch-first development policy.",
    answers: ["How should runtime branch changes be introduced?", "What is the safe activation boundary?"],
    aliases: ["branch first development", "live runtime branch"],
    intents: ["merge policy", "runtime activation policy"],
    generatedAt: params.generatedAt,
  });
  discoverDocumentFile(ctx, params.operatorRoot, {
    id: "tool-invocation-ledger",
    path: "docs/operations/tool-invocation-ledger.md",
    domain: "verification",
    authority: "historical",
    description: "Tool invocation ledger for operation evidence.",
    answers: ["Which evidence proves an operation or deployment?", "Where are tool invocation decisions recorded?"],
    aliases: ["tool ledger", "operation evidence"],
    intents: ["verification evidence", "completion proof"],
    generatedAt: params.generatedAt,
  });
  discoverDocumentFile(ctx, params.operatorRoot, {
    id: "worktree-integrity",
    path: "docs/operations/worktree-integrity-and-execution-attribution.md",
    domain: "repositories",
    authority: "authoritative",
    description: "Worktree integrity and execution attribution rules.",
    answers: ["Which source proves repository state?", "How is source execution attributed?"],
    aliases: ["worktree integrity", "repository proof"],
    intents: ["repository evidence", "git authority"],
    generatedAt: params.generatedAt,
  });
  discoverDocumentFile(ctx, params.operatorRoot, {
    id: "agent-capability-model",
    path: "docs/architecture/AGENT_CAPABILITY_MODEL.md",
    domain: "agents",
    authority: "advisory",
    description: "Intended agent capability architecture.",
    answers: ["Which source describes intended agent architecture?", "How are agent capabilities modeled?"],
    aliases: ["agent capability model", "agent architecture"],
    intents: ["agent architecture", "agent capability"],
    generatedAt: params.generatedAt,
  });
  discoverDocumentFile(ctx, params.operatorRoot, {
    id: "system-truth",
    path: "docs/OPENCLAW_KB/00_SYSTEM_TRUTH.md",
    domain: "documentation",
    authority: "authoritative",
    description: "System-truth knowledge-base entry and source precedence guidance.",
    answers: ["Which source describes intended operator architecture?", "How should claims vs current truth be handled?"],
    aliases: ["system truth", "operator architecture truth", "intended operator architecture"],
    intents: ["architecture documentation", "truth hierarchy", "intended operator architecture"],
    generatedAt: params.generatedAt,
  });
  discoverDocumentFile(ctx, params.operatorRoot, {
    id: "runtime-behavior",
    path: "docs/OPENCLAW_KB/operations/RUNTIME_BEHAVIOR.md",
    domain: "runtime",
    authority: "advisory",
    description: "Runtime behavior documentation for OpenClaw operations.",
    answers: ["Which source describes intended runtime behavior?", "Where should runtime behavior documentation be checked?"],
    aliases: ["runtime behavior", "runtime docs"],
    intents: ["runtime documentation", "runtime behavior"],
    generatedAt: params.generatedAt,
  });
  discoverDocumentFile(ctx, params.operatorRoot, {
    id: "approval-gates",
    path: "docs/OPENCLAW_KB/governance/APPROVAL_GATES.md",
    domain: "approvals",
    authority: "authoritative",
    description: "Approval boundary and gate documentation.",
    answers: ["What still requires human approval?", "Which source describes approval gates?"],
    aliases: ["approval gates", "human approval"],
    intents: ["approval question", "authority boundary"],
    generatedAt: params.generatedAt,
  });
  discoverDocumentFile(ctx, params.operatorRoot, {
    id: "failure-modes",
    path: "docs/OPENCLAW_KB/operations/FAILURE_MODES.md",
    domain: "incidents",
    authority: "historical",
    description: "Runtime failure mode documentation for incident investigation.",
    answers: ["Where should I look for an old runtime incident?", "Which source describes incident classes?"],
    aliases: ["failure modes", "runtime incident"],
    intents: ["incident question", "old runtime incident"],
    generatedAt: params.generatedAt,
  });
}

function discoverDocumentFile(
  ctx: MutableDiscovery,
  operatorRoot: string,
  params: {
    id: string;
    path: string;
    domain: string;
    authority: "authoritative" | "advisory" | "historical";
    description: string;
    answers: string[];
    aliases: string[];
    intents: string[];
    generatedAt: string;
  },
) {
  const path = join(operatorRoot, params.path);
  if (!existsSync(path)) return;
  ctx.nodes.push(
    baseNode({
      id: nodeId("docs", params.id),
      kind: "documentation",
      domain: params.domain,
      description: params.description,
      answers: params.answers,
      aliases: params.aliases,
      taskIntents: params.intents,
      source: { type: "file", locator: path, resolver: "file" },
      authority: {
        class: params.authority,
        priority: params.authority === "authoritative" ? 72 : params.authority === "advisory" ? 58 : 45,
        reason:
          params.authority === "historical"
            ? "Historical/runbook evidence informs why and how; live sources still win for current state."
            : "Documented source owns intended behavior within its scoped domain.",
      },
      freshness: { mode: params.authority === "historical" ? "historical" : "watch", checkedAt: params.generatedAt },
      verification: { method: "exists", target: path },
      discoveredBy: "curated-doc-route-adapter",
      generatedAt: params.generatedAt,
    }),
  );
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

function addSemanticConcepts(ctx: MutableDiscovery) {
  concept(ctx, {
    id: "telegram.runtime",
    domain: "telegram",
    description: "Telegram execution path spanning the live gateway service, Telegram runtime worktree, OpenClaw config and main agent routing.",
    answers: [
      "Which repository currently owns Telegram execution?",
      "What controls the current Telegram model?",
      "Which source is authoritative for current Telegram runtime health?",
      "How should Telegram runtime repair be routed?",
    ],
    aliases: ["Telegram", "Telegram runtime", "main Telegram agent", "Telegram execution"],
    taskIntents: ["telegram runtime repair", "telegram model question", "telegram delivery regression"],
    evidenceNodeIds: [nodeId("service", "openclaw-gateway.service"), nodeId("repo", "telegram-live-execution"), nodeId("config", "openclaw")],
  });
  concept(ctx, {
    id: "gateway.runtime",
    domain: "runtime",
    description: "OpenClaw gateway runtime that owns external channel ingress and Telegram delivery.",
    answers: ["Which service owns the gateway?", "Where is gateway runtime health verified?"],
    aliases: ["gateway", "OpenClaw gateway", "gateway runtime"],
    taskIntents: ["gateway runtime", "external channel ingress", "telegram delivery"],
    evidenceNodeIds: [nodeId("service", "openclaw-gateway.service"), nodeId("config", "openclaw")],
  });
  concept(ctx, {
    id: "operator.runtime",
    domain: "operator",
    description: "Operator service runtime, source tree, configuration and state ownership.",
    answers: [
      "What version of OpenClaw is actually running?",
      "Which service hosts the operator?",
      "Where is operator state persisted?",
      "Which source is authoritative for current runtime health?",
    ],
    aliases: ["operator", "operator runtime", "orchestrator", "OpenClaw operator"],
    taskIntents: ["operator health", "operator source", "current runtime question"],
    evidenceNodeIds: [nodeId("service", "orchestrator.service"), nodeId("repo", "openclaw-operator"), nodeId("config", "operator-orchestrator")],
  });
  concept(ctx, {
    id: "operator.api",
    domain: "operator",
    description: "Operator HTTP API surface, with endpoint-level OpenAPI nodes retained as detailed retrieval targets.",
    answers: ["Which API route serves an operator question?", "Where are operator API routes documented?"],
    aliases: ["operator API", "OpenAPI", "api routes"],
    taskIntents: ["api route lookup", "operator endpoint"],
    evidenceNodeIds: [nodeId("api", "/api/openapi.json"), nodeId("repo", "openclaw-operator")],
  });
  concept(ctx, {
    id: "runtime.health",
    domain: "runtime",
    description: "Live runtime health evidence across service manager and operator health endpoints.",
    answers: ["Which source is authoritative for current runtime health?", "Where is runtime health verified?"],
    aliases: ["runtime health", "operator health", "current health", "gateway health"],
    taskIntents: ["current runtime health", "health verification", "service health"],
    evidenceNodeIds: [nodeId("service", "orchestrator.service"), nodeId("api", "/api/health/extended"), nodeId("api", "/api/persistence/health")],
  });
  concept(ctx, {
    id: "knowledge.routing",
    domain: "knowledge-routing",
    description: "Knowledge-routing resolver, generated graph, map views, refresh path and evaluation gates.",
    answers: [
      "Where should an agent route an information need?",
      "How does the agent find authoritative sources?",
      "Which source describes knowledge-routing architecture?",
    ],
    aliases: ["knowledge routing", "semantic graph", "route resolver", "knowledge graph", "shadow graph routing"],
    taskIntents: ["knowledge route", "graph route", "semantic graph evaluation", "shadow routing", "shadow graph routing recorded"],
    evidenceNodeIds: [nodeId("api", "/api/knowledge-routing/route"), nodeId("docs", "knowledge-routing-foundation")],
  });
  concept(ctx, {
    id: "model.routing",
    domain: "models",
    description: "Current model and agent routing configuration authority.",
    answers: ["What controls the current Telegram model?", "Where is the current model configuration?"],
    aliases: ["current model", "model routing", "Telegram model"],
    taskIntents: ["model question", "agent model config"],
    evidenceNodeIds: [nodeId("config", "openclaw"), nodeId("agent", "main")],
  });
  concept(ctx, {
    id: "agent.runtime",
    domain: "agents",
    description: "Configured OpenClaw agents and the operator views used to inspect them.",
    answers: ["Which agents are configured?", "Which source describes intended agent architecture?"],
    aliases: ["agents", "agent runtime", "main agent"],
    taskIntents: ["agent config", "agent capability"],
    evidenceNodeIds: [nodeId("agent", "main"), nodeId("api", "/api/agents/overview")],
  });
  concept(ctx, {
    id: "skill.registry",
    domain: "skills",
    description: "Skill instruction registry and skill policy/telemetry surfaces.",
    answers: ["Which skill should be used for Telegram runtime repair?", "Where are skill instructions stored?"],
    aliases: ["skills", "skill registry", "runtime repair skill"],
    taskIntents: ["skill selection", "runtime repair"],
    evidenceNodeIds: [nodeId("skill", "openclaw-runtime-repair-closeout"), nodeId("api", "/api/skills/registry")],
  });
  concept(ctx, {
    id: "plugin.registry",
    domain: "plugins",
    description: "Configured plugin registry and plugin activation authority.",
    answers: ["Which plugins are enabled?", "Where is plugin state configured?"],
    aliases: ["plugins", "plugin registry", "enabled plugins"],
    taskIntents: ["plugin question", "connector question"],
    evidenceNodeIds: [nodeId("config", "openclaw"), nodeId("plugin", "entries")],
  });
  concept(ctx, {
    id: "cron.runtime",
    domain: "cron",
    description: "OpenClaw scheduled job registry and scheduler state.",
    answers: ["Where is cron state authoritative?", "Which scheduled jobs exist?"],
    aliases: ["cron", "scheduler", "scheduled jobs"],
    taskIntents: ["cron state", "schedule question"],
    evidenceNodeIds: [nodeId("database", "openclaw")],
  });
  concept(ctx, {
    id: "business.systems",
    domain: "business systems",
    description: "Business-value and publishing operator surfaces exposed by the operator API.",
    answers: ["Where should business system routes start?", "Which API routes expose business systems?"],
    aliases: ["business systems", "business system routes", "business value", "publishing"],
    taskIntents: ["business system route", "business operations", "publishing state"],
    evidenceNodeIds: [nodeId("api", "/api/business/overview"), nodeId("api", "/api/publishing/overview")],
  });
  concept(ctx, {
    id: "operator.state",
    domain: "state",
    description: "Operator durable state stores and persistence health.",
    answers: ["Where is operator state persisted?", "Which database owns graph run state?"],
    aliases: ["operator state", "operator state persisted", "state stores", "databases", "persistence"],
    taskIntents: ["database question", "state ownership", "operator state persisted", "persistence health"],
    evidenceNodeIds: [nodeId("database", "operator"), nodeId("api", "/api/persistence/health")],
  });
  concept(ctx, {
    id: "memory.system",
    domain: "memory",
    description: "Durable memory and historical decision routing.",
    answers: ["Where are durable decisions recorded?", "Where should historical memory be interpreted?"],
    aliases: ["memory", "durable memory", "historical memory", "durable decisions recorded"],
    taskIntents: ["memory recall", "historical decision", "durable decisions recorded"],
    evidenceNodeIds: [nodeId("memory", "current-index"), nodeId("api", "/api/memory/recall")],
  });
  concept(ctx, {
    id: "repository.state",
    domain: "repositories",
    description: "Repository/worktree source authority and execution attribution.",
    answers: ["Which source proves repository state?", "Where is source code for a component?"],
    aliases: ["repos", "repositories", "worktrees", "repository state"],
    taskIntents: ["repo proof", "source authority", "git state"],
    evidenceNodeIds: [nodeId("repo", "openclaw-operator"), nodeId("repo", "openclaw-ops")],
  });
  concept(ctx, {
    id: "approval.gates",
    domain: "approvals",
    description: "Human approval boundaries and pending approval retrieval.",
    answers: ["What still requires human approval?", "Which source describes approval gates?"],
    aliases: ["approval", "approvals", "human approval", "approval gates"],
    taskIntents: ["approval boundary", "pending approval"],
    evidenceNodeIds: [nodeId("api", "/api/approvals/pending"), nodeId("docs", "approval-gates")],
  });
  concept(ctx, {
    id: "verification.evidence",
    domain: "verification",
    description: "Verification evidence routing for health, deployment, run and operation claims.",
    answers: ["Which evidence proves a deployment succeeded?", "Which source proves repository state?", "Where are verification records?"],
    aliases: ["verification", "evidence", "proof", "deployment proof"],
    taskIntents: ["completion claim", "verification evidence", "proof chain"],
    evidenceNodeIds: [nodeId("docs", "tool-invocation-ledger"), nodeId("api", "/api/graphs/runs")],
  });
  concept(ctx, {
    id: "incident.decision.history",
    domain: "incidents",
    description: "Incident and decision history routing across incident APIs, failure docs and memory.",
    answers: ["Where should I look for an old runtime incident?", "Why was Telegram live execution changed?"],
    aliases: ["incidents", "decisions", "old runtime incident", "why changed", "why was telegram live execution changed"],
    taskIntents: ["incident investigation", "historical why", "runtime incident", "telegram history", "telegram live execution changed"],
    evidenceNodeIds: [nodeId("api", "/api/incidents"), nodeId("docs", "failure-modes"), nodeId("memory", "current-index")],
  });
  concept(ctx, {
    id: "deployment.runtime",
    domain: "deployment",
    description: "Deployment, activation and runtime-loaded evidence routing.",
    answers: ["Which evidence proves a deployment succeeded?", "What still requires human approval before activation?"],
    aliases: ["deployment", "activation", "production activation", "restart"],
    taskIntents: ["deploy question", "activation gate", "runtime loaded proof"],
    evidenceNodeIds: [nodeId("docs", "operator-deployment"), nodeId("service", "orchestrator.service"), nodeId("component", "approval.gates")],
  });
}

function concept(
  ctx: MutableDiscovery,
  params: {
    id: string;
    domain: string;
    description: string;
    answers: string[];
    aliases: string[];
    taskIntents: string[];
    evidenceNodeIds: string[];
  },
) {
  const nodeIds = new Set(ctx.nodes.map((node) => node.id));
  if (!params.evidenceNodeIds.every((id) => nodeIds.has(id))) return;
  ctx.nodes.push(
    baseNode({
      id: nodeId("component", params.id),
      kind: "component",
      domain: params.domain,
      description: params.description,
      answers: params.answers,
      aliases: params.aliases,
      taskIntents: params.taskIntents,
      source: { type: "generated", locator: `knowledge-routing://concept/${params.id}`, resolver: "generated" },
      authority: {
        class: "derived",
        priority: 78,
        reason: "Semantic routing concept derived from deterministic existing nodes; follow edges to current source truth.",
      },
      freshness: { mode: "on-demand", checkedAt: ctx.generatedAt },
      verification: { method: "manual-review", target: params.evidenceNodeIds.join(",") },
      discoveredBy: "ai-assisted-semantic-layer",
      generatedAt: ctx.generatedAt,
      semanticStage: "reviewed",
    }),
  );
}

function addSemanticRelationships(ctx: MutableDiscovery) {
  const c = (id: string) => nodeId("component", id);
  const proposals = [
    proposal(c("telegram.runtime"), c("gateway.runtime"), "handled_by", ctx),
    proposal(c("telegram.runtime"), nodeId("repo", "telegram-live-execution"), "implemented_by", ctx),
    proposal(c("telegram.runtime"), nodeId("service", "openclaw-gateway.service"), "runs_as", ctx),
    proposal(c("telegram.runtime"), nodeId("config", "openclaw"), "configured_by", ctx),
    proposal(c("telegram.runtime"), c("model.routing"), "uses", ctx),
    proposal(c("telegram.runtime"), c("skill.registry"), "uses", ctx),
    proposal(c("telegram.runtime"), nodeId("service", "openclaw-gateway.service"), "verified_by", ctx),
    proposal(c("gateway.runtime"), nodeId("service", "openclaw-gateway.service"), "runs_as", ctx),
    proposal(c("gateway.runtime"), nodeId("config", "openclaw"), "configured_by", ctx),
    proposal(c("gateway.runtime"), nodeId("repo", "telegram-live-execution"), "implemented_by", ctx),
    proposal(c("operator.runtime"), nodeId("service", "orchestrator.service"), "runs_as", ctx),
    proposal(c("operator.runtime"), nodeId("repo", "openclaw-operator"), "implemented_by", ctx),
    proposal(c("operator.runtime"), nodeId("config", "operator-orchestrator"), "configured_by", ctx),
    proposal(c("operator.runtime"), c("operator.api"), "exposes", ctx),
    proposal(c("operator.runtime"), nodeId("database", "operator"), "stores_state_in", ctx),
    proposal(c("operator.runtime"), nodeId("database", "graph-runs"), "stores_state_in", ctx),
    proposal(c("operator.runtime"), c("runtime.health"), "observed_by", ctx),
    proposal(c("operator.api"), nodeId("api", "/api/openapi.json"), "exposes", ctx),
    proposal(c("operator.api"), nodeId("api", "/api/health/extended"), "verified_by", ctx),
    proposal(c("knowledge.routing"), nodeId("api", "/api/knowledge-routing/route"), "exposes", ctx),
    proposal(c("knowledge.routing"), nodeId("api", "/api/knowledge-routing/graph"), "exposes", ctx),
    proposal(c("knowledge.routing"), nodeId("api", "/api/knowledge-routing/maps"), "exposes", ctx),
    proposal(c("knowledge.routing"), nodeId("api", "/api/knowledge-routing/refresh"), "exposes", ctx),
    proposal(c("knowledge.routing"), nodeId("docs", "knowledge-routing-foundation"), "documented_by", ctx),
    proposal(c("knowledge.routing"), nodeId("docs", "tool-invocation-ledger"), "documented_by", ctx),
    proposal(c("model.routing"), nodeId("config", "openclaw"), "configured_by", ctx),
    proposal(c("model.routing"), nodeId("agent", "main"), "handled_by", ctx),
    proposal(c("agent.runtime"), nodeId("agent", "main"), "handled_by", ctx),
    proposal(c("agent.runtime"), nodeId("api", "/api/agents/overview"), "observed_by", ctx),
    proposal(c("agent.runtime"), nodeId("docs", "agent-capability-model"), "documented_by", ctx),
    proposal(c("skill.registry"), nodeId("skill", "openclaw-runtime-repair-closeout"), "uses", ctx),
    proposal(c("skill.registry"), nodeId("api", "/api/skills/registry"), "observed_by", ctx),
    proposal(c("plugin.registry"), nodeId("config", "openclaw"), "configured_by", ctx),
    proposal(c("plugin.registry"), nodeId("plugin", "entries"), "uses", ctx),
    proposal(c("cron.runtime"), nodeId("cron", "openclaw-jobs"), "retrieved_by", ctx),
    proposal(c("cron.runtime"), nodeId("database", "openclaw"), "stores_state_in", ctx),
    proposal(c("business.systems"), nodeId("api", "/api/business/overview"), "exposes", ctx),
    proposal(c("business.systems"), nodeId("api", "/api/publishing/overview"), "exposes", ctx),
    proposal(c("business.systems"), c("operator.api"), "handled_by", ctx),
    proposal(c("operator.state"), nodeId("database", "operator"), "stores_state_in", ctx),
    proposal(c("operator.state"), nodeId("database", "graph-runs"), "stores_state_in", ctx),
    proposal(c("operator.state"), nodeId("api", "/api/persistence/health"), "observed_by", ctx),
    proposal(c("memory.system"), nodeId("memory", "current-index"), "uses", ctx),
    proposal(c("memory.system"), nodeId("api", "/api/memory/recall"), "observed_by", ctx),
    proposal(c("repository.state"), nodeId("repo", "openclaw-operator"), "uses", ctx),
    proposal(c("repository.state"), nodeId("repo", "telegram-live-execution"), "uses", ctx),
    proposal(c("repository.state"), nodeId("docs", "worktree-integrity"), "documented_by", ctx),
    proposal(c("approval.gates"), nodeId("api", "/api/approvals/pending"), "observed_by", ctx),
    proposal(c("approval.gates"), nodeId("docs", "approval-gates"), "documented_by", ctx),
    proposal(c("verification.evidence"), nodeId("docs", "tool-invocation-ledger"), "documented_by", ctx),
    proposal(c("verification.evidence"), nodeId("api", "/api/graphs/runs"), "observed_by", ctx),
    proposal(c("incident.decision.history"), nodeId("api", "/api/incidents"), "observed_by", ctx),
    proposal(c("incident.decision.history"), nodeId("docs", "failure-modes"), "documented_by", ctx),
    proposal(c("incident.decision.history"), c("memory.system"), "uses", ctx),
    proposal(c("deployment.runtime"), nodeId("docs", "operator-deployment"), "documented_by", ctx),
    proposal(c("deployment.runtime"), nodeId("service", "orchestrator.service"), "verified_by", ctx),
    proposal(c("deployment.runtime"), c("approval.gates"), "requires_approval", ctx),
    {
      from: c("telegram.runtime"),
      to: nodeId("api", "/api/knowledge-routing/route"),
      relationship: "implemented_by" as const,
      evidence: [nodeId("api", "/api/knowledge-routing/route")],
      confidence: "reviewed" as const,
    },
    {
      from: c("operator.runtime"),
      to: "component:missing-production-runtime",
      relationship: "observed_by" as const,
      evidence: [c("operator.runtime")],
      confidence: "reviewed" as const,
    },
  ];
  const result = validateSemanticRelationshipProposals(ctx.nodes, proposals);
  ctx.edges.push(...result.accepted);
  ctx.semanticAudit = {
    generatedAt: ctx.generatedAt,
    proposedRelationships: proposals.length,
    acceptedRelationships: result.accepted.length,
    rejectedRelationships: result.rejected.map((item) => ({
      from: item.from,
      to: item.to,
      relationship: String(item.relationship),
      reason: item.reason,
      evidence: item.evidence,
    })),
  };
}

function proposal(
  from: string,
  to: string,
  relationship: Parameters<typeof makeEdge>[2],
  ctx: MutableDiscovery,
) {
  const node = ctx.nodes.find((item) => item.id === to);
  return {
    from,
    to,
    relationship,
    evidence: [node?.source.locator ?? to],
    confidence: "reviewed" as const,
  };
}

export function relativeLocator(root: string, locator: string): string {
  if (!locator.startsWith(root)) return locator;
  return relative(root, locator) || ".";
}
