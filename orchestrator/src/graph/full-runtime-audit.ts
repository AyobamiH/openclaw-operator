import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAgentRegistry } from "../agentRegistry.js";
import {
  ALLOWED_TASK_TYPES,
  TASK_AGENT_SKILL_REQUIREMENTS,
} from "../taskHandlers.js";
import { ToolGate } from "../toolGate.js";
import { createGraphRuntime } from "./runtime.js";
import { governedCodingChangeGraph, PRODUCTION_GRAPH_DEFINITION_IDENTITIES } from "./workflows.js";

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
  let runtime = createGraphRuntime(join(auditRoot, "graph.sqlite"), {
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

    const productionIdentities = new Set<string>(PRODUCTION_GRAPH_DEFINITION_IDENTITIES);
    const legacyBoundNodes = definitions.filter((definition) => productionIdentities.has(`${definition.graphId}@${definition.version}`)).flatMap((definition) =>
      definition.nodes
        .filter((node) => node.handler === "legacy.command")
        .map((node) => `${definition.graphId}@${definition.version}:${node.id}`),
    );
    const registeredLegacyTasks = runtime.legacy.list();
    findings.push({
      id: "graph-execution-completeness",
      status: legacyBoundNodes.length === 0 ? "passed" : "failed",
      summary: "Every production coding graph uses governed production adapters; legacy coding bodies are retired from production loading.",
      evidence: [
        `legacyBoundNodes=${legacyBoundNodes.join(",") || "none"}`,
        `registeredLegacyTasks=${registeredLegacyTasks.join(",") || "none"}`,
        "coding-change@1.0.0 and @1.1.0 remain immutable compatibility records but are excluded from production policy",
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
      status: loadedDefinitions.length === productionIdentities.size && loadedDefinitions.every((identity) => productionIdentities.has(identity)) ? "passed" : "failed",
      summary: "The production load policy activates exactly the supported social, coding and research graph portfolio.",
      evidence: [
        `supportedProduction=${[...productionIdentities].join(",")}`,
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
    const toolGatePath = join(auditRoot, "toolgate.sqlite");
    let toolGate = new ToolGate({ statePath: toolGatePath, agentRegistry });
    await toolGate.initialize();
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
      status: gateCapabilities.executionMode === "inline_capability_enforcement" && gateCapabilities.auditPersistence === "sqlite_hash_chain" && gateCapabilities.declaredButNotEnforced.length === 0 && gateCapabilities.decisionChainValid ? "passed" : "failed",
      summary: "Tool authorization decisions are durable and enforced beyond declarative preflight.",
      evidence: [
        `executionMode=${gateCapabilities.executionMode}`,
        `auditPersistence=${gateCapabilities.auditPersistence}`,
        `hostContainment=${gateCapabilities.hostContainment}`,
        `declaredButNotEnforced=${gateCapabilities.declaredButNotEnforced.join(",")}`,
        `decisionChainValid=${gateCapabilities.decisionChainValid}`,
      ],
    });

    const preRestartDecision = await toolGate.preflightSkillAccess("build-refactor-agent", "workspacePatch", { mode: "preflight", taskType: "build-refactor", scopeId: "full-runtime-audit" });
    toolGate.close();
    toolGate = new ToolGate({ statePath: toolGatePath, agentRegistry });
    await toolGate.initialize();
    const durableToolGate = toolGate.durableStats();
    if (!preRestartDecision.success || durableToolGate.decisions < 1 || !durableToolGate.chainValid) {
      findings.push({ id: "toolgate-restart-recovery", status: "failed", summary: "ToolGate decisions survive restart with an intact hash chain.", evidence: [`decisions=${durableToolGate.decisions}`, `chainValid=${durableToolGate.chainValid}`] });
    } else {
      findings.push({ id: "toolgate-restart-recovery", status: "passed", summary: "ToolGate policy and decision state survive restart with an intact hash chain.", evidence: [`decisions=${durableToolGate.decisions}`, `chainValid=${durableToolGate.chainValid}`] });
    }

    let dispatches = 0;
    runtime.attachChildDispatcher((request) => ({
      taskId: `audit-task-${++dispatches}`,
      completion: Promise.resolve({ status: "succeeded", outcome: request.phase === "child" ? "audit_child_succeeded" : "audit_verifier_passed", output: { phase: request.phase }, evidence: { runId: request.runId, receiptId: request.receiptId } }),
    }));
    const governedCoding = governedCodingChangeGraph();
    const proofRun = runtime.engine.start({ graphId: governedCoding.graphId, version: governedCoding.version, objective: "Audit governed child-run receipt continuity", input: { repositoryPath: process.cwd() }, authority: { maximum: "local_reversible", grantedBy: "full-runtime-audit" } });
    const proofNode = governedCoding.nodes.find((node) => node.id === "implement")!;
    const proofContext = { definition: governedCoding, node: proofNode, run: proofRun, attemptId: "audit-child-attempt", attemptNumber: 1, idempotencyKey: "audit-child-idempotency", effectPayloadHash: "audit-child-payload", signal: new AbortController().signal };
    const proofResult = await runtime.childRuns.execute({ repositoryPath: process.cwd() }, proofContext);
    const receiptChainBeforeRestart = runtime.store.verifyChildRunReceiptChain(proofRun.runId);
    const receiptCounts = { children: runtime.store.childRunReceipts(proofRun.runId).length, verifiers: runtime.store.verifierReceipts(proofRun.runId).length };
    runtime.scheduler.close();
    runtime.store.close();
    runtime = createGraphRuntime(join(auditRoot, "graph.sqlite"), { zeroWriteOnly: true, runIdPrefix: "graudit" });
    runtime.attachChildDispatcher((request) => ({ taskId: `unexpected-replay-${++dispatches}`, completion: Promise.resolve({ status: "failed", outcome: "unexpected_replay", output: {}, evidence: {}, failureReason: request.runId }) }));
    const replayResult = await runtime.childRuns.execute({ repositoryPath: process.cwd() }, { ...proofContext, run: runtime.store.getRun(proofRun.runId)! });
    const receiptChainAfterRestart = runtime.store.verifyChildRunReceiptChain(proofRun.runId);
    findings.push({
      id: "multi-agent-execution-receipts",
      status: proofResult.outcome === "succeeded" && replayResult.outcome === "succeeded" && receiptCounts.children === 1 && receiptCounts.verifiers === 1 && dispatches === 2 && receiptChainBeforeRestart && receiptChainAfterRestart ? "passed" : "failed",
      summary: "Graph-driven delegations resolve to durable child task/run receipts and verifier closure.",
      evidence: [
        `childReceipts=${receiptCounts.children}`,
        `verifierReceipts=${receiptCounts.verifiers}`,
        `dispatchesAcrossReplay=${dispatches}`,
        `chainBeforeRestart=${receiptChainBeforeRestart}`,
        `chainAfterRestart=${receiptChainAfterRestart}`,
        `replayOutcome=${replayResult.outcome}`,
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

    toolGate.close();
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
