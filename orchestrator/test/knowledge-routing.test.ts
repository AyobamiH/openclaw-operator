import { createRequire } from "node:module";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGraph, makeEdge, nodeId } from "../src/knowledge-routing/graph.js";
import {
  discoverKnowledgeRoutingGraph,
  evaluateKnowledgeRoutingGraph,
  resolveKnowledgeRoute,
  createKnowledgeRoutingShadowComparison,
  validateSemanticRelationshipProposals,
  type KnowledgeRouteNode,
} from "../src/knowledge-routing/index.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const root = join(process.cwd(), "test/.tmp/knowledge-routing");
const marker = "DO_NOT_COPY_FULL_DOCUMENT_BODY_SECRET_MARKER";

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  buildFixture(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("knowledge routing foundation", () => {
  it("discovers current source categories without copying source bodies", () => {
    const graph = discoverFixtureGraph();
    const kinds = new Set(graph.nodes.map((node) => node.kind));

    expect(kinds).toContain("repository");
    expect(kinds).toContain("service");
    expect(kinds).toContain("skill");
    expect(kinds).toContain("plugin");
    expect(kinds).toContain("agent");
    expect(kinds).toContain("api");
    expect(kinds).toContain("documentation");
    expect(kinds).toContain("document-index");
    expect(kinds).toContain("database");
    expect(JSON.stringify(graph)).not.toContain(marker);
  });

  it("resolves routing metadata before source retrieval", () => {
    const graph = discoverFixtureGraph();
    const route = resolveKnowledgeRoute(graph, "telegram runtime", 4);

    expect(route.recommendedNodes.length).toBeGreaterThan(0);
    expect(route.authoritativeSources.some((source) => source.type === "systemd")).toBe(true);
    expect(route.freshnessRequirement).toMatch(/live|on-demand/i);
    expect(JSON.stringify(route)).not.toContain(marker);
  });

  it("keeps current/live authority ahead of stale narratives", () => {
    const graph = discoverFixtureGraph();
    const route = resolveKnowledgeRoute(graph, "What is actually running right now?", 3);

    expect(route.recommendedNodes[0]?.authority.class).toBe("runtime");
    expect(route.recommendedNodes[0]?.source.resolver).toBe("systemctl");
  });

  it("detects dead source locators and broken relationships", () => {
    const stale = testNode("documentation:missing", join(root, "missing.md"));
    const graph = buildGraph(
      [stale],
      [makeEdge(stale.id, "documentation:not-present", "documented_by", ["unit-test"])],
      "2026-08-27T00:00:00.000Z",
    );

    expect(graph.stats.staleRoutes).toBeGreaterThanOrEqual(2);
    expect(graph.nodes[0]?.management.stale).toBe(true);
    expect(graph.edges[0]?.stale).toBe(true);
  });

  it("accepts only validated AI-assisted semantic proposals", () => {
    const graph = discoverFixtureGraph();
    const docsNode = graph.nodes.find((node) => node.kind === "documentation");
    const serviceNode = graph.nodes.find((node) => node.kind === "service");
    expect(docsNode).toBeTruthy();
    expect(serviceNode).toBeTruthy();

    const result = validateSemanticRelationshipProposals(graph.nodes, [
      {
        from: serviceNode!.id,
        to: docsNode!.id,
        relationship: "documented_by",
        evidence: [docsNode!.source.locator],
        confidence: "reviewed",
      },
      {
        from: serviceNode!.id,
        to: "missing:target",
        relationship: "documented_by",
        evidence: [docsNode!.source.locator],
        confidence: "reviewed",
      },
      {
        from: serviceNode!.id,
        to: docsNode!.id,
        relationship: "invented_link" as any,
        evidence: [docsNode!.source.locator],
        confidence: "reviewed",
      },
    ]);

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(2);
  });

  it("builds semantic component concepts over deterministic entities", () => {
    const graph = discoverFixtureGraph();
    const telegram = graph.nodes.find((node) => node.id === "component:telegram.runtime");
    const operator = graph.nodes.find((node) => node.id === "component:operator.runtime");

    expect(telegram?.kind).toBe("component");
    expect(operator?.kind).toBe("component");
    expect(graph.stats.aiClassifiedNodes).toBeGreaterThan(5);
    expect(graph.stats.acceptedAiRelationships).toBeGreaterThan(20);
    expect(graph.stats.rejectedSemanticProposals).toBeGreaterThanOrEqual(2);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: "component:telegram.runtime",
        to: "repo:telegram-live-execution",
        relationship: "implemented_by",
        verified: true,
      }),
    );
  });

  it("routes aliases and task intents to concept nodes first", () => {
    const graph = discoverFixtureGraph();
    const route = resolveKnowledgeRoute(graph, "main Telegram agent current model", 4);

    expect(route.recommendedNodes[0]?.id).toBe("component:telegram.runtime");
    expect(route.recommendedNodes.map((node) => node.id)).toContain("component:model.routing");
    expect(route.authoritativeSources.some((source) => source.resolver === "openclaw-config")).toBe(true);
  });

  it("evaluates a fixed OpenClaw routing suite", () => {
    const graph = discoverFixtureGraph();
    const report = evaluateKnowledgeRoutingGraph(graph);

    expect(report.summary.totalQueries).toBeGreaterThanOrEqual(25);
    expect(report.summary.noRoute).toBe(0);
    expect(report.summary.staleSource).toBe(0);
    expect(report.summary.wrongSource).toBe(0);
    expect(report.summary.routingAccuracy).toBeGreaterThanOrEqual(0.8);
    expect(report.summary.authorityAccuracy).toBeGreaterThanOrEqual(0.8);
  });

  it("creates bounded shadow comparisons without raw long message bodies", () => {
    const graph = discoverFixtureGraph();
    const comparison = createKnowledgeRoutingShadowComparison(
      graph,
      "Where is cron state authoritative? Contact root@example.com 12345678901234567890",
      "openclaw.sqlite",
    );

    expect(comparison.informationNeedHash).toHaveLength(64);
    expect(comparison.informationNeedPreview).not.toContain("root@example.com");
    expect(comparison.informationNeedPreview).not.toContain("12345678901234567890");
    expect(comparison.graphRoute.selectedNode).toBeTruthy();
  });
});

function discoverFixtureGraph() {
  const workspaceRoot = join(root, "workspace");
  const openclawRoot = join(root, "openclaw");
  const operatorRoot = join(workspaceRoot, "projects/openclaw-operator");
  return discoverKnowledgeRoutingGraph({
    operatorRoot,
    workspaceRoot,
    openclawRoot,
    openclawConfigPath: join(openclawRoot, "openclaw.json"),
    config: {
      docsPath: join(operatorRoot, "docs"),
      cookbookPath: undefined,
      publishingDatabasePath: join(openclawRoot, "state/openclaw-operator/database/deterministic-publishing.sqlite"),
    } as any,
    docsIndexSize: 2,
    serviceUnits: [
      {
        name: "openclaw-gateway.service",
        active: "active",
        sub: "running",
        description: "OpenClaw Telegram gateway",
      },
      {
        name: "orchestrator.service",
        active: "active",
        sub: "running",
        description: "OpenClaw operator API",
      },
    ],
  });
}

function buildFixture(base: string) {
  const workspaceRoot = join(base, "workspace");
  const openclawRoot = join(base, "openclaw");
  const operatorRoot = join(workspaceRoot, "projects/openclaw-operator");
  mkdirSync(join(operatorRoot, ".git"), { recursive: true });
  mkdirSync(join(workspaceRoot, ".git"), { recursive: true });
  mkdirSync(join(workspaceRoot, "projects/.worktrees/openclaw-telegram-live-execution-20260821/.git"), {
    recursive: true,
  });
  mkdirSync(join(workspaceRoot, "skills/openclaw-runtime-repair-closeout"), { recursive: true });
  mkdirSync(join(operatorRoot, "docs"), { recursive: true });
  mkdirSync(join(operatorRoot, "docs/operations"), { recursive: true });
  mkdirSync(join(operatorRoot, "orchestrator/src"), { recursive: true });
  mkdirSync(join(openclawRoot, "state/openclaw-operator/database"), { recursive: true });
  mkdirSync(join(openclawRoot, "cron"), { recursive: true });

  writeFileSync(
    join(openclawRoot, "openclaw.json"),
    JSON.stringify({
      agents: { list: [{ id: "main", model: "gpt-5" }] },
      plugins: { telegram: { enabled: true }, browser: { enabled: true } },
    }),
  );
  writeFileSync(join(workspaceRoot, "MEMORY.md"), "# Memory\nCurrent durable decisions live here.\n");
  writeFileSync(join(workspaceRoot, "skills/openclaw-runtime-repair-closeout/SKILL.md"), "# Runtime repair\n");
  writeFileSync(join(operatorRoot, "orchestrator_config.json"), JSON.stringify({ docsPath: join(operatorRoot, "docs") }));
  writeFileSync(join(operatorRoot, "docs/INDEX.md"), `# Docs\n${marker}\n`);
  writeFileSync(join(operatorRoot, "docs/operations/knowledge-routing-foundation.md"), "# Knowledge routing\n");
  writeFileSync(join(operatorRoot, "docs/operations/deployment.md"), "# Deployment\n");
  writeFileSync(join(operatorRoot, "docs/operations/live-runtime-branch-first-development.md"), "# Branch first\n");
  writeFileSync(join(operatorRoot, "docs/operations/tool-invocation-ledger.md"), "# Ledger\n");
  writeFileSync(join(operatorRoot, "docs/operations/worktree-integrity-and-execution-attribution.md"), "# Worktree\n");
  mkdirSync(join(operatorRoot, "docs/architecture"), { recursive: true });
  writeFileSync(join(operatorRoot, "docs/architecture/AGENT_CAPABILITY_MODEL.md"), "# Agents\n");
  mkdirSync(join(operatorRoot, "docs/OPENCLAW_KB/operations"), { recursive: true });
  mkdirSync(join(operatorRoot, "docs/OPENCLAW_KB/governance"), { recursive: true });
  writeFileSync(join(operatorRoot, "docs/OPENCLAW_KB/00_SYSTEM_TRUTH.md"), "# System truth\n");
  writeFileSync(join(operatorRoot, "docs/OPENCLAW_KB/operations/RUNTIME_BEHAVIOR.md"), "# Runtime\n");
  writeFileSync(join(operatorRoot, "docs/OPENCLAW_KB/operations/FAILURE_MODES.md"), "# Failure modes\n");
  writeFileSync(join(operatorRoot, "docs/OPENCLAW_KB/governance/APPROVAL_GATES.md"), "# Approvals\n");
  writeFileSync(
    join(operatorRoot, "orchestrator/src/openapi.ts"),
    [
      'export const paths = {',
      '"/health": {},',
      '"/api/agents/overview": {},',
      '"/api/approvals/pending": {},',
      '"/api/business/overview": {},',
      '"/api/graphs/runs": {},',
      '"/api/health/extended": {},',
      '"/api/incidents": {},',
      '"/api/knowledge-routing/graph": {},',
      '"/api/knowledge-routing/maps": {},',
      '"/api/knowledge-routing/refresh": {},',
      '"/api/knowledge-routing/route": {},',
      '"/api/knowledge-routing/summary": {},',
      '"/api/knowledge/summary": {},',
      '"/api/memory/recall": {},',
      '"/api/openapi.json": {},',
      '"/api/persistence/health": {},',
      '"/api/publishing/overview": {},',
      '"/api/skills/registry": {},',
      '};\n',
    ].join("\n"),
  );
  writeFileSync(join(openclawRoot, "cron/jobs.json"), JSON.stringify([{ id: "hourly" }]));
  createSqlite(join(openclawRoot, "state/openclaw.sqlite"), "cron_jobs");
  createSqlite(join(openclawRoot, "state/openclaw-operator/database/graph-runs.sqlite"), "graph_runs");
  createSqlite(join(openclawRoot, "state/openclaw-operator/database/graph-scheduler.sqlite"), "graph_schedules");
  createSqlite(join(openclawRoot, "state/openclaw-operator/database/operator.sqlite"), "knowledge_entries");
  createSqlite(join(openclawRoot, "state/openclaw-operator/database/toolgate.sqlite"), "tool_invocations");
  createSqlite(join(openclawRoot, "state/openclaw-operator/database/deterministic-publishing.sqlite"), "publishing_outbox");
}

function createSqlite(path: string, table: string) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`);
  db.close();
}

function testNode(id: string, locator: string): KnowledgeRouteNode {
  return {
    id,
    kind: "documentation",
    domain: "documentation",
    description: "missing test source",
    answers: ["missing source"],
    source: { type: "file", locator, resolver: "file" },
    authority: { class: "historical", priority: 10, reason: "test" },
    freshness: { mode: "historical", checkedAt: "2026-08-27T00:00:00.000Z" },
    loadPolicy: ["test"],
    verification: { method: "exists", target: locator },
    provenance: { discoveredBy: "test", generatedAt: "2026-08-27T00:00:00.000Z" },
    management: { generated: true, humanReviewRequired: false },
  };
}
