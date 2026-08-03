import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAgentRegistry } from "../agentRegistry.js";
import {
  ALLOWED_TASK_TYPES,
  TASK_AGENT_SKILL_REQUIREMENTS,
} from "../taskHandlers.js";
import { getToolGate } from "../toolGate.js";
import { createGraphRuntime } from "./runtime.js";

export type RuntimeAuditFinding = {
  id: string;
  status: "passed" | "failed" | "warning";
  summary: string;
  evidence: string[];
};

export type FullRuntimeAudit = {
  schemaVersion: "1.0.0";
  generatedAt: string;
  verdict: "passed" | "partial" | "failed";
  graphDefinitions: number;
  graphFamilies: number;
  productionAdapters: number;
  registeredAgents: number;
  governedTaskBindings: number;
  findings: RuntimeAuditFinding[];
};

export async function auditFullGraphMultiAgentRuntime(): Promise<FullRuntimeAudit> {
  const auditRoot = await mkdtemp(join(tmpdir(), "openclaw-full-graph-audit-"));
  const findings: RuntimeAuditFinding[] = [];
  const runtime = createGraphRuntime(join(auditRoot, "graph.sqlite"), {
    zeroWriteOnly: true,
    runIdPrefix: "graudit",
  });
  try {
    const definitions = runtime.registry.list();
    const adapters = runtime.adapters.list();
    const missingHandlers = definitions.flatMap((definition) =>
      definition.nodes
        .filter((node) => !runtime.executors.has(node.handler))
        .map((node) => `${definition.graphId}@${definition.version}:${node.id}:${node.handler}`),
    );
    const unboundProductionNodes = definitions.flatMap((definition) =>
      definition.nodes
        .filter((node) => node.handler.startsWith("production.") && !node.requiredCapabilities.includes(node.handler))
        .map((node) => `${definition.graphId}@${definition.version}:${node.id}:${node.handler}`),
    );
    findings.push({
      id: "graph-definition-registration",
      status: missingHandlers.length === 0 && unboundProductionNodes.length === 0 ? "passed" : "failed",
      summary: "Every immutable graph definition registers with an available handler and explicit production capability binding.",
      evidence: [
        `definitions=${definitions.length}`,
        `families=${new Set(definitions.map((definition) => definition.graphId)).size}`,
        `missingHandlers=${missingHandlers.join(",") || "none"}`,
        `unboundProductionNodes=${unboundProductionNodes.join(",") || "none"}`,
      ],
    });

    const legacyBoundNodes = definitions.flatMap((definition) =>
      definition.nodes
        .filter((node) => node.handler === "legacy.command")
        .map((node) => `${definition.graphId}@${definition.version}:${node.id}`),
    );
    const registeredLegacyTasks = runtime.legacy.list();
    findings.push({
      id: "graph-execution-completeness",
      status: legacyBoundNodes.length === 0 || registeredLegacyTasks.length > 0 ? "passed" : "warning",
      summary: "Every advertised execution graph has concrete runtime handlers for implementation work.",
      evidence: [
        `legacyBoundNodes=${legacyBoundNodes.join(",") || "none"}`,
        `registeredLegacyTasks=${registeredLegacyTasks.join(",") || "none"}`,
        registeredLegacyTasks.length === 0 && legacyBoundNodes.length > 0
          ? "coding implementation and repair nodes are declared but no legacy task body is registered"
          : "all legacy-bound nodes have a registered task body",
      ],
    });

    let loadedDefinitions: string[] = [];
    try {
      const loadPolicy = await readFile(
        join(process.cwd(), "..", "systemd", "orchestrator-graph-zero-write-canary.conf"),
        "utf-8",
      );
      const match = loadPolicy.match(/OPENCLAW_GRAPH_ALLOWED_DEFINITIONS=([^\n]+)/);
      loadedDefinitions = match?.[1]?.trim().split(",").filter(Boolean) ?? [];
    } catch {
      loadedDefinitions = [];
    }
    findings.push({
      id: "production-graph-portfolio",
      status: loadedDefinitions.length === definitions.length ? "passed" : "warning",
      summary: "The production load policy activates the complete registered graph portfolio.",
      evidence: [
        `registered=${definitions.map((definition) => `${definition.graphId}@${definition.version}`).join(",")}`,
        `productionAllowed=${loadedDefinitions.join(",") || "not-declared"}`,
      ],
    });

    const unsafeShadowAdapters = adapters
      .filter((adapter) => adapter.shadowSafe && adapter.sideEffectClass.startsWith("external_"))
      .map((adapter) => adapter.adapterId);
    findings.push({
      id: "zero-write-authority-boundary",
      status: runtime.zeroWriteOnly && unsafeShadowAdapters.length === 0 ? "passed" : "failed",
      summary: "The audited runtime defaults to zero-write and no external adapter is incorrectly marked shadow-safe.",
      evidence: [
        `zeroWriteOnly=${runtime.zeroWriteOnly}`,
        `productionAdapters=${adapters.length}`,
        `unsafeShadowAdapters=${unsafeShadowAdapters.join(",") || "none"}`,
      ],
    });

    const agentRegistry = await getAgentRegistry();
    const toolGate = await getToolGate();
    const agents = agentRegistry.listAgents();
    const invalidAgents = agents.flatMap((agent) => {
      const validation = agentRegistry.validateAgent(agent.id);
      return validation.valid ? [] : [`${agent.id}:${validation.errors.join("|")}`];
    });
    findings.push({
      id: "agent-manifest-validation",
      status: invalidAgents.length === 0 ? "passed" : "failed",
      summary: "Every discovered agent manifest has a model, timeout, and at least one allowlisted skill.",
      evidence: [
        `registeredAgents=${agents.length}`,
        `invalidAgents=${invalidAgents.join(",") || "none"}`,
      ],
    });

    const gateCapabilities = toolGate.capabilities();
    findings.push({
      id: "toolgate-enforcement-depth",
      status: gateCapabilities.executionMode === "preflight_only" || gateCapabilities.auditPersistence === "process_memory"
        ? "warning"
        : "passed",
      summary: "Tool authorization decisions are durable and enforced beyond declarative preflight.",
      evidence: [
        `executionMode=${gateCapabilities.executionMode}`,
        `auditPersistence=${gateCapabilities.auditPersistence}`,
        `hostContainment=${gateCapabilities.hostContainment}`,
        `declaredButNotEnforced=${gateCapabilities.declaredButNotEnforced.join(",")}`,
      ],
    });

    findings.push({
      id: "multi-agent-execution-receipts",
      status: "warning",
      summary: "Graph-driven delegations resolve to durable child task/run receipts and verifier closure.",
      evidence: [
        "integration-agent currently emits plans and handoff packages",
        "no graph production adapter owns downstream agent dispatch",
        "no durable child-run receipt contract is registered",
      ],
    });

    const bindingFailures: string[] = [];
    for (const [taskType, requirement] of Object.entries(TASK_AGENT_SKILL_REQUIREMENTS)) {
      if (!requirement) continue;
      if (!ALLOWED_TASK_TYPES.includes(taskType as (typeof ALLOWED_TASK_TYPES)[number])) {
        bindingFailures.push(`${taskType}:task-not-allowlisted`);
        continue;
      }
      const agent = agentRegistry.getAgent(requirement.agentId);
      if (!agent) {
        bindingFailures.push(`${taskType}:agent-missing:${requirement.agentId}`);
        continue;
      }
      const declaredTasks = agent.orchestratorTasks?.length
        ? agent.orchestratorTasks
        : agent.orchestratorTask
          ? [agent.orchestratorTask]
          : [];
      if (!declaredTasks.includes(taskType)) {
        bindingFailures.push(`${taskType}:manifest-task:${declaredTasks.join("|") || "missing"}`);
      }
      const taskPermission = toolGate.canExecuteTask(requirement.agentId, taskType);
      if (!taskPermission.allowed) {
        bindingFailures.push(`${taskType}:task-denied:${taskPermission.reason ?? "unknown"}`);
      }
      if (!agentRegistry.canUseSkill(requirement.agentId, requirement.skillId)) {
        bindingFailures.push(`${taskType}:skill-denied:${requirement.skillId}`);
      }
    }
    findings.push({
      id: "task-agent-skill-bindings",
      status: bindingFailures.length === 0 ? "passed" : "failed",
      summary: "Each governed task binding resolves to one declared agent task and one manifest-allowed skill.",
      evidence: [
        `governedTaskBindings=${Object.keys(TASK_AGENT_SKILL_REQUIREMENTS).length}`,
        `bindingFailures=${bindingFailures.join(",") || "none"}`,
      ],
    });

    const ungovernedAgentTasks = agents
      .filter((agent) => agent.orchestratorTask || agent.orchestratorTasks?.length)
      .filter((agent) => !Object.values(TASK_AGENT_SKILL_REQUIREMENTS).some((binding) => binding?.agentId === agent.id))
      .map((agent) => `${agent.id}:${agent.orchestratorTasks?.join("|") ?? agent.orchestratorTask}`)
      .sort();
    findings.push({
      id: "agent-task-coverage",
      status: ungovernedAgentTasks.length === 0 ? "passed" : "warning",
      summary: "Agent manifests with orchestrator tasks are represented in the central task-agent-skill binding map.",
      evidence: [`ungovernedAgentTasks=${ungovernedAgentTasks.join(",") || "none"}`],
    });

    const failures = findings.filter((finding) => finding.status === "failed");
    const warnings = findings.filter((finding) => finding.status === "warning");
    return {
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      verdict: failures.length > 0 ? "failed" : warnings.length > 0 ? "partial" : "passed",
      graphDefinitions: definitions.length,
      graphFamilies: new Set(definitions.map((definition) => definition.graphId)).size,
      productionAdapters: adapters.length,
      registeredAgents: agents.length,
      governedTaskBindings: Object.keys(TASK_AGENT_SKILL_REQUIREMENTS).length,
      findings,
    };
  } finally {
    runtime.scheduler.close();
    runtime.store.close();
    await rm(auditRoot, { recursive: true, force: true });
  }
}
