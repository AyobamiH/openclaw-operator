import { randomUUID } from "node:crypto";
import { GraphRegistry } from "./registry.js";
import { applyStatePatches, readPath, sha256 } from "./reducer.js";
import { buildApprovalPayloadHash, evaluateAuthority, type GraphApproval } from "./authority.js";
import { failure } from "./failures.js";
import { NodeExecutionResultSchema, validateGraphDefinition } from "./schema.js";
import { GraphStore, type EventInput } from "./store.js";
import { LIVE_CAPABILITY_AWARE_HANDLER, SOCIAL_LIVE_CAPABILITY_AWARE_HANDLERS, validateOneRunLiveCapabilityForMutation } from "./live-capability.js";
import type {
  EvidenceReference,
  GraphBudgetState,
  GraphCheckpoint,
  GraphDefinition,
  GraphEdgeDefinition,
  GraphNodeDefinition,
  GraphRunState,
  JsonValue,
  NodeExecutionResult,
  NodeExecutor,
  VerificationAssertion,
} from "./types.js";
import {
  graphApprovalsWaiting,
  graphAmbiguousEffects,
  graphBudgetExhaustions,
  graphLoopIterations,
  graphNodeAttempts,
  graphNodeFailures,
  graphRecoveries,
  graphRunDuration,
  graphRunsActive,
  graphRunsTotal,
  graphTransitions,
} from "./metrics.js";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export class NodeExecutorRegistry {
  private readonly handlers = new Map<string, NodeExecutor>();

  register(id: string, executor: NodeExecutor): void {
    if (!/^[a-z][a-z0-9._-]{1,119}$/.test(id)) throw new Error(`invalid_node_executor_id:${id}`);
    if (this.handlers.has(id)) throw new Error(`node_executor_already_registered:${id}`);
    this.handlers.set(id, executor);
  }

  get(id: string): NodeExecutor {
    const handler = this.handlers.get(id);
    if (!handler) throw new Error(`node_executor_not_registered:${id}`);
    return handler;
  }

  has(id: string): boolean {
    return this.handlers.has(id);
  }
}

function budgetState(definition: GraphDefinition): GraphBudgetState {
  return {
    ...definition.loopBudgets,
    nodeAttempts: 0,
    transitions: 0,
    loopIterations: 0,
    tokensConsumed: 0,
    toolCallsConsumed: 0,
    externalRequestsConsumed: 0,
    costConsumedUsd: 0,
  };
}

function checkpoint(run: GraphRunState, reason: string, nodeId: string | null): GraphCheckpoint {
  const createdAt = new Date().toISOString();
  return {
    checkpointId: `gcp_${randomUUID()}`,
    runId: run.runId,
    nodeId,
    reason,
    stateHash: sha256({ ...run, checkpoints: [] }),
    createdAt,
  };
}

function evaluateGuard(run: GraphRunState, edge: GraphEdgeDefinition): boolean {
  return (edge.guards ?? []).every((guard) => {
    const value = readPath(run, guard.path);
    if (guard.operator === "exists") return value !== undefined;
    if (guard.operator === "not_exists") return value === undefined;
    if (guard.operator === "eq") return JSON.stringify(value) === JSON.stringify(guard.value);
    if (guard.operator === "neq") return JSON.stringify(value) !== JSON.stringify(guard.value);
    if (guard.operator === "in") return Array.isArray(guard.value) && guard.value.some((entry) => JSON.stringify(entry) === JSON.stringify(value));
    if (typeof value !== "number" || typeof guard.value !== "number") return false;
    if (guard.operator === "lt") return value < guard.value;
    if (guard.operator === "lte") return value <= guard.value;
    if (guard.operator === "gt") return value > guard.value;
    return value >= guard.value;
  });
}

export function resolveTransition(definition: GraphDefinition, nodeId: string, result: NodeExecutionResult, run: GraphRunState): GraphEdgeDefinition {
  const candidates = definition.edges
    .filter((edge) => edge.from === nodeId && edge.on === result.outcome && evaluateGuard(run, edge))
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
  if (candidates.length === 0) throw new Error(`graph_transition_missing:${nodeId}:${result.outcome}`);
  if (candidates.length > 1 && (candidates[0]?.priority ?? 0) === (candidates[1]?.priority ?? 0)) {
    throw new Error(`graph_transition_ambiguous:${nodeId}:${result.outcome}`);
  }
  return candidates[0]!;
}

export function evaluateCompletion(definition: GraphDefinition, run: GraphRunState): { passed: boolean; missing: string[] } {
  const missing = definition.evidenceRequirements.flatMap((required) => {
    const assertion = run.assertions.find((item) => item.assertionId === required.assertionId && item.status === "passed");
    if (!assertion) return [required.assertionId];
    const evidenceKinds = new Set(run.evidence.filter((item) => assertion.evidenceRefs.includes(item.evidenceId)).map((item) => item.kind));
    return required.requiredEvidenceKinds.every((kind) => evidenceKinds.has(kind)) ? [] : [required.assertionId];
  });
  return { passed: missing.length === 0, missing };
}

export type StartRunRequest = {
  graphId: string;
  version?: string;
  objective: string;
  input: Record<string, JsonValue>;
  correlationId?: string;
  parentRunId?: string;
  authority: { maximum: GraphRunState["authority"]["maximum"]; grantedBy: string; expiresAt?: string };
};

export class GraphExecutor {
  constructor(
    readonly registry: GraphRegistry,
    readonly store: GraphStore,
    readonly executors: NodeExecutorRegistry,
    readonly globalConcurrency = Math.max(1, Number.parseInt(process.env.OPENCLAW_GRAPH_GLOBAL_CONCURRENCY ?? "32", 10) || 32),
    readonly adapterContracts?: { validateNode(node: GraphNodeDefinition, definition: GraphDefinition): void },
    readonly runtimePolicy: { zeroWriteOnly?: boolean; runIdPrefix?: string } = {},
  ) {}

  register(definition: unknown): GraphDefinition {
    const validated = validateGraphDefinition(definition);
    for (const node of validated.nodes) {
      this.adapterContracts?.validateNode(node, validated);
      if (!this.executors.has(node.handler)) throw new Error(`graph_handler_unavailable:${node.handler}`);
      if (node.type === "subgraph") this.registry.get(node.subgraphId!, node.subgraphVersion!);
    }
    const registered = this.registry.register(validated);
    this.store.registerDefinition(registered);
    return registered;
  }

  start(request: StartRunRequest): GraphRunState {
    const definition = request.version
      ? this.registry.get(request.graphId, request.version)
      : this.registry.latest(request.graphId);
    if (this.store.activeRunCount() >= this.globalConcurrency) throw new Error("graph_global_concurrency_exhausted");
    if (this.store.activeRunCount(definition.graphId, definition.version) >= definition.concurrency.maxRuns) {
      throw new Error(`graph_definition_concurrency_exhausted:${definition.graphId}@${definition.version}`);
    }
    let parent: GraphRunState | null = null;
    if (request.parentRunId) {
      parent = this.store.getRun(request.parentRunId);
      if (!parent) throw new Error(`parent_graph_run_not_found:${request.parentRunId}`);
      const parentRank = this.authorityRank(parent.authority.maximum);
      if (this.authorityRank(request.authority.maximum) > parentRank) throw new Error("child_graph_authority_exceeds_parent");
    }
    const now = new Date().toISOString();
    const initialBudgets = budgetState(definition);
    if (parent) {
      initialBudgets.maxNodeAttempts = Math.min(initialBudgets.maxNodeAttempts, Math.max(0, parent.budgets.maxNodeAttempts - parent.budgets.nodeAttempts));
      initialBudgets.maxTransitions = Math.min(initialBudgets.maxTransitions, Math.max(0, parent.budgets.maxTransitions - parent.budgets.transitions));
      initialBudgets.maxLoopIterations = Math.min(initialBudgets.maxLoopIterations, Math.max(0, parent.budgets.maxLoopIterations - parent.budgets.loopIterations));
      initialBudgets.tokenBudget = Math.min(initialBudgets.tokenBudget ?? Number.MAX_SAFE_INTEGER, Math.max(0, (parent.budgets.tokenBudget ?? 0) - parent.budgets.tokensConsumed));
      initialBudgets.toolCallBudget = Math.min(initialBudgets.toolCallBudget ?? Number.MAX_SAFE_INTEGER, Math.max(0, (parent.budgets.toolCallBudget ?? 0) - parent.budgets.toolCallsConsumed));
      initialBudgets.externalRequestBudget = Math.min(initialBudgets.externalRequestBudget ?? Number.MAX_SAFE_INTEGER, Math.max(0, (parent.budgets.externalRequestBudget ?? 0) - parent.budgets.externalRequestsConsumed));
      initialBudgets.costBudgetUsd = Math.min(initialBudgets.costBudgetUsd ?? Number.MAX_SAFE_INTEGER, Math.max(0, (parent.budgets.costBudgetUsd ?? 0) - parent.budgets.costConsumedUsd));
    }
    const run: GraphRunState = {
      runId: `${this.runIdPrefix()}_${randomUUID()}`,
      graphId: definition.graphId,
      graphVersion: definition.version,
      parentRunId: request.parentRunId ?? null,
      correlationId: request.correlationId ?? parent?.correlationId ?? randomUUID(),
      objective: request.objective,
      status: "created",
      currentNodeId: definition.entryNodeId,
      input: structuredClone(request.input),
      data: {},
      planVersion: 0,
      authority: { ...request.authority, grantedAt: now },
      budgets: initialBudgets,
      evidence: [], assertions: [], externalEffects: [], checkpoints: [], terminalOutcome: null,
      lastError: null, lastProgressFingerprint: null, repeatedFingerprintCount: 0,
      lastProgressAt: now, createdAt: now, updatedAt: now, revision: 0,
    };
    run.checkpoints.push(checkpoint(run, "objective_normalised", definition.entryNodeId));
    graphRunsActive.labels(run.graphId, run.graphVersion).inc();
    return this.store.createRun(run);
  }

  async runUntilSettled(runId: string, maxSteps = 250, owner = `executor:${process.pid}`): Promise<GraphRunState> {
    let run = this.requireRun(runId);
    for (let index = 0; index < maxSteps; index += 1) {
      if (TERMINAL_STATUSES.has(run.status) || ["waiting", "waiting_for_approval", "paused", "blocked"].includes(run.status)) return run;
      run = await this.step(runId, owner);
    }
    throw new Error(`graph_executor_step_budget_exhausted:${runId}`);
  }

  async step(runId: string, owner = `executor:${process.pid}`): Promise<GraphRunState> {
    let run = this.requireRun(runId);
    if (TERMINAL_STATUSES.has(run.status)) return run;
    if (["paused", "waiting", "waiting_for_approval", "blocked"].includes(run.status)) {
      throw new Error(`graph_run_not_executable:${run.status}`);
    }
    const definition = this.registry.get(run.graphId, run.graphVersion);
    if (Date.now() - Date.parse(run.createdAt) > definition.timeoutPolicy.wallClockMs) {
      return this.failRun(run, failure("budget_exhausted", "Graph wall-clock budget exhausted"));
    }
    if (run.budgets.nodeAttempts >= run.budgets.maxNodeAttempts || run.budgets.transitions >= run.budgets.maxTransitions) {
      return this.failRun(run, failure("budget_exhausted", "Graph execution budget exhausted"));
    }
    const node = definition.nodes.find((item) => item.id === run.currentNodeId);
    if (!node) return this.failRun(run, failure("invariant_violation", `Current node is not registered: ${run.currentNodeId}`));
    if ((node.type === "tool" || node.type === "connector") && run.budgets.toolCallBudget !== undefined && run.budgets.toolCallsConsumed >= run.budgets.toolCallBudget) {
      return this.failRun(run, failure("budget_exhausted", "Graph tool-call budget exhausted"));
    }
    if (this.authorityRank(node.sideEffectClass) >= this.authorityRank("external_reversible") && run.budgets.externalRequestBudget !== undefined && run.budgets.externalRequestsConsumed >= run.budgets.externalRequestBudget) {
      return this.failRun(run, failure("budget_exhausted", "Graph external-request budget exhausted"));
    }
    if (run.budgets.tokenBudget !== undefined && run.budgets.tokensConsumed > run.budgets.tokenBudget) {
      return this.failRun(run, failure("budget_exhausted", "Graph token budget exhausted"));
    }
    if (run.budgets.costBudgetUsd !== undefined && run.budgets.costConsumedUsd > run.budgets.costBudgetUsd) {
      return this.failRun(run, failure("budget_exhausted", "Graph cost budget exhausted"));
    }
    const resourceKeys = [`graph-node:${run.runId}`, ...definition.concurrency.resourceKeys.map((key) => key.replaceAll("{runId}", run.runId))];
    const acquired: string[] = [];
    for (const resourceKey of resourceKeys) {
      if (!this.store.acquireLease(resourceKey, run.runId, owner, definition.concurrency.leaseMs)) {
        for (const held of acquired) this.store.releaseLease(held, owner);
        throw new Error(`graph_resource_lease_conflict:${resourceKey}`);
      }
      acquired.push(resourceKey);
    }
    try {
      run = this.requireRun(runId);
      return await this.executeNode(definition, node, run, owner);
    } finally {
      for (const resourceKey of acquired) this.store.releaseLease(resourceKey, owner);
    }
  }

  private runIdPrefix(): string {
    const prefix = this.runtimePolicy.runIdPrefix ?? "gr";
    if (!/^[a-z][a-z0-9_-]{1,31}$/.test(prefix)) throw new Error("graph_run_id_prefix_invalid");
    return prefix;
  }

  private async executeNode(definition: GraphDefinition, node: GraphNodeDefinition, initialRun: GraphRunState, owner: string): Promise<GraphRunState> {
    let run = initialRun;
    const attemptNumber = this.store.attemptCount(run.runId, node.id) + 1;
    if (attemptNumber > node.maxAttempts) return this.failRun(run, failure("budget_exhausted", `Node attempt budget exhausted: ${node.id}`));
    const inputProjection = Object.fromEntries(node.inputProjection.map((path) => [path, readPath(run, path) ?? null]));
    const payloadHash = buildApprovalPayloadHash(inputProjection);
    const action = node.handler;
    const target = String(readPath(run, "data.target") ?? `${run.graphId}:${node.id}`);
    const externalMutation = this.authorityRank(node.sideEffectClass) >= this.authorityRank("external_reversible");
    if (externalMutation && this.runtimePolicy.zeroWriteOnly === true && node.handler === "graph.external-disabled") {
      const reason = "runtime_zero_write_policy";
      const blocked = { ...run, status: "blocked" as const, lastError: failure("unsafe_operation", reason), updatedAt: new Date().toISOString() };
      return this.store.saveRun(blocked, initialRun.revision, [{ type: "graph_blocked", nodeId: node.id, actor: owner, payload: { reason, capabilityFailure: "node_not_live_capability_aware", sideEffectClass: node.sideEffectClass } }]);
    }
    if (run.input.shadowMode === true && externalMutation) {
      return this.commitResult(definition, node, run, attemptNumber, owner, {
        outcome: "blocked",
        output: { blockReason: "shadow_mode_external_mutation_unreachable" },
        failure: failure("unsafe_operation", "Shadow mode blocked the first external mutation node"),
        progressFingerprint: sha256({ nodeId: node.id, reason: "shadow_mode_external_mutation_unreachable" }),
      }, null);
    }
    if (externalMutation && this.runtimePolicy.zeroWriteOnly === true && node.handler !== LIVE_CAPABILITY_AWARE_HANDLER && !SOCIAL_LIVE_CAPABILITY_AWARE_HANDLERS.includes(node.handler as (typeof SOCIAL_LIVE_CAPABILITY_AWARE_HANDLERS)[number])) {
      const reason = "runtime_zero_write_policy";
      const blocked = { ...run, status: "blocked" as const, lastError: failure("unsafe_operation", reason), updatedAt: new Date().toISOString() };
      return this.store.saveRun(blocked, initialRun.revision, [{ type: "graph_blocked", nodeId: node.id, actor: owner, payload: { reason, capabilityFailure: "node_not_live_capability_aware", sideEffectClass: node.sideEffectClass } }]);
    }
    const authority = evaluateAuthority({
      run, node, graphMaximum: definition.authorityRequirements.maximum,
      approvalThreshold: definition.authorityRequirements.approvalsRequiredAtOrAbove,
      payloadHash, action, target, approvals: this.store.approvals(run.runId),
    });
    if (!authority.allowed) {
      if (authority.needsApproval) {
        const approval = this.store.requestApproval(this.approval(run, node, action, target, payloadHash));
        graphApprovalsWaiting.labels(run.graphId, run.graphVersion).inc();
        run = { ...run, status: "waiting_for_approval", updatedAt: new Date().toISOString() };
        return this.store.saveRun(run, initialRun.revision, [{ type: "approval_requested", nodeId: node.id, actor: owner, payload: { approvalId: approval.approvalId, action, target, payloadHash } }]);
      }
      return this.failRun(run, failure("authority_denied", authority.reason));
    }

    let liveCapability: { capabilityId: string; envelopeHash: string } | undefined;
    if (externalMutation && this.runtimePolicy.zeroWriteOnly === true) {
      try {
        if (!authority.approval) throw new Error("one_run_live_capability_approval_missing");
        const validated = validateOneRunLiveCapabilityForMutation({
          store: this.store,
          run,
          approval: authority.approval,
          nodeHandler: node.handler,
          globalZeroWrite: true,
        });
        liveCapability = {
          capabilityId: validated.capability.capabilityId,
          envelopeHash: validated.capability.envelopeHash,
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const blocked = { ...run, status: "blocked" as const, lastError: failure("unsafe_operation", reason), updatedAt: new Date().toISOString() };
        return this.store.saveRun(blocked, initialRun.revision, [{ type: "graph_blocked", nodeId: node.id, actor: owner, payload: { reason: "runtime_zero_write_policy", capabilityFailure: reason, sideEffectClass: node.sideEffectClass } }]);
      }
    }

    const existingEffect = this.store.externalEffects(run.runId).find((effect) => effect.nodeId === node.id && effect.payloadHash === payloadHash);
    if (existingEffect?.state === "ambiguous" || existingEffect?.state === "provider_accepted" || existingEffect?.state === "request_sent") {
      run = { ...run, status: "blocked", lastError: failure("idempotency_conflict", "External effect requires reconciliation before retry"), updatedAt: new Date().toISOString() };
      return this.store.saveRun(run, initialRun.revision, [{ type: "graph_blocked", nodeId: node.id, actor: owner, payload: { reason: "external_effect_reconciliation_required", effectId: existingEffect.effectId } }]);
    }
    if (existingEffect?.state === "effect_verified") {
      return this.commitResult(definition, node, run, attemptNumber, owner, {
        outcome: "succeeded", output: { reconciledExistingEffect: true }, progressFingerprint: sha256(existingEffect),
      }, null);
    }

    const attemptId = `gna_${randomUUID()}`;
    const attemptIdempotencyKey = sha256({ runId: run.runId, nodeId: node.id, attemptNumber, target, payloadHash, operationType: node.handler });
    const idempotencyKey = externalMutation
      ? sha256({ runId: run.runId, nodeId: node.id, target, payloadHash, operationType: node.handler })
      : attemptIdempotencyKey;
    this.store.createAttempt({ attemptId, runId: run.runId, nodeId: node.id, attemptNumber, idempotencyKey: attemptIdempotencyKey, owner, leaseExpiresAt: new Date(Date.now() + node.timeoutMs).toISOString(), startedAt: new Date().toISOString(), run });
    if (externalMutation) {
      const effect: GraphRunState["externalEffects"][number] = existingEffect ?? {
        effectId: `gex_${randomUUID()}`,
        runId: run.runId,
        nodeId: node.id,
        idempotencyKey,
        operationType: node.handler,
        target,
        payloadHash,
        state: "request_prepared",
        lastObservedAt: new Date().toISOString(),
        evidenceRefs: authority.approval ? [authority.approval.approvalId] : [],
      };
      if (effect.idempotencyKey !== idempotencyKey) throw new Error(`external_effect_idempotency_mismatch:${node.id}`);
      if (effect.state !== "request_prepared") {
        const prepared = { ...effect, state: "request_prepared" as const, lastObservedAt: new Date().toISOString() };
        run = this.store.saveRun({ ...run, externalEffects: [...run.externalEffects.filter((item) => item.effectId !== prepared.effectId), prepared], updatedAt: prepared.lastObservedAt! }, run.revision, [
          { type: "external_effect_prepared", nodeId: node.id, attemptNumber, actor: owner, payload: { effectId: prepared.effectId, operationType: prepared.operationType, target, payloadHash, idempotencyKey } },
        ]);
      } else if (!run.externalEffects.some((item) => item.effectId === effect.effectId)) {
        run = this.store.saveRun({ ...run, externalEffects: [...run.externalEffects, effect], updatedAt: effect.lastObservedAt! }, run.revision, [
          { type: "external_effect_prepared", nodeId: node.id, attemptNumber, actor: owner, payload: { effectId: effect.effectId, operationType: effect.operationType, target, payloadHash, idempotencyKey } },
        ]);
      }
    }
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), node.timeoutMs);
    let result: NodeExecutionResult;
    try {
      const rawResult = node.type === "subgraph"
        ? await this.executeSubgraph(node, run, owner)
        : await this.executors.get(node.handler)({
          definition, node, run, attemptId, attemptNumber, idempotencyKey, effectPayloadHash: payloadHash,
          approval: authority.approval?.status === "granted" ? {
            approvalId: authority.approval.approvalId,
            payloadHash: authority.approval.payloadHash,
            expiresAt: authority.approval.expiresAt,
            approver: authority.approval.approver ?? "unknown",
          } : undefined,
          liveCapability,
          signal: abortController.signal,
        });
      result = NodeExecutionResultSchema.parse(rawResult) as NodeExecutionResult;
      if (externalMutation && (result.externalEffect?.idempotencyKey !== idempotencyKey || result.externalEffect.payloadHash !== payloadHash)) {
        throw new Error(`external_effect_result_contract_invalid:${node.id}`);
      }
      if (!node.possibleOutcomes.includes(result.outcome)) throw new Error(`node_outcome_not_declared:${node.id}:${result.outcome}`);
    } catch (error) {
      const timedOut = abortController.signal.aborted;
      result = {
        outcome: timedOut ? "timed_out" : "failed_terminal",
        output: {},
        failure: failure(timedOut ? "timeout" : "unknown", error instanceof Error ? error.message : String(error)),
        progressFingerprint: sha256({ nodeId: node.id, error: error instanceof Error ? error.message : String(error) }),
      };
    } finally {
      clearTimeout(timer);
    }
    return this.commitResult(definition, node, run, attemptNumber, owner, result, attemptId);
  }

  private async executeSubgraph(node: GraphNodeDefinition, parent: GraphRunState, owner: string): Promise<NodeExecutionResult> {
    const graphId = node.subgraphId!;
    const graphVersion = node.subgraphVersion!;
    let child = this.store.listRuns({ graphId, limit: 250 }).find((candidate) =>
      candidate.parentRunId === parent.runId
      && candidate.graphVersion === graphVersion
      && candidate.input.__parentNodeId === node.id,
    );
    if (!child) {
      const projected = parent.input.subgraphInput;
      const childInput = projected && typeof projected === "object" && !Array.isArray(projected)
        ? structuredClone(projected) as Record<string, JsonValue>
        : structuredClone(parent.input);
      childInput.__parentNodeId = node.id;
      child = this.start({
        graphId,
        version: graphVersion,
        objective: `${parent.objective} [subgraph:${node.id}]`,
        input: childInput,
        correlationId: parent.correlationId,
        parentRunId: parent.runId,
        authority: {
          maximum: parent.authority.maximum,
          grantedBy: parent.authority.grantedBy,
          expiresAt: parent.authority.expiresAt,
        },
      });
    }
    if (!TERMINAL_STATUSES.has(child.status) && !["waiting", "waiting_for_approval", "paused", "blocked"].includes(child.status)) {
      child = await this.runUntilSettled(child.runId, 250, `${owner}:subgraph`);
    }
    const evidence = [{
      kind: "subgraph-outcome",
      uri: `graph://${child.runId}`,
      sha256: sha256({ runId: child.runId, graphId: child.graphId, version: child.graphVersion, status: child.status, terminalOutcome: child.terminalOutcome }),
      summary: `Child graph ${child.graphId}@${child.graphVersion} settled as ${child.status}`,
      checker: "graph.subgraph",
    }];
    const common = { output: { childRunId: child.runId, childStatus: child.status }, evidence, progressFingerprint: sha256({ childRunId: child.runId, revision: child.revision, status: child.status }) };
    if (child.status === "completed") return { ...common, outcome: "succeeded" };
    if (child.status === "waiting_for_approval") return { ...common, outcome: "needs_approval", failure: failure("approval_required", `Child graph ${child.runId} is waiting for approval`) };
    if (child.status === "blocked" || child.status === "waiting" || child.status === "paused") return { ...common, outcome: "blocked", failure: child.lastError ?? failure("human_input_required", `Child graph ${child.runId} requires intervention`) };
    return { ...common, outcome: child.lastError?.repairable ? "failed_repairable" : "failed_terminal", failure: child.lastError ?? failure("unknown", `Child graph ${child.runId} failed`) };
  }

  private commitResult(definition: GraphDefinition, node: GraphNodeDefinition, initialRun: GraphRunState, attemptNumber: number, owner: string, result: NodeExecutionResult, attemptId: string | null): GraphRunState {
    let run = initialRun;
    try {
      run = applyStatePatches(run, result.patches ?? [], node.permittedStateMutations);
    } catch (error) {
      result = { outcome: "failed_terminal", output: {}, failure: failure("invariant_violation", error instanceof Error ? error.message : String(error)), progressFingerprint: sha256(String(error)) };
    }
    const now = new Date().toISOString();
    const newEvidence: EvidenceReference[] = (result.evidence ?? []).map((item) => ({ ...item, evidenceId: `gev_${randomUUID()}`, createdAt: now }));
    const assertions: VerificationAssertion[] = (result.assertions ?? []).map((item) => ({
      ...item,
      evidenceRefs: item.evidenceRefs.length > 0 ? item.evidenceRefs : newEvidence.map((evidence) => evidence.evidenceId),
      checkedAt: now,
    }));
    const fingerprint = result.progressFingerprint ?? sha256({ node: node.id, outcome: result.outcome, output: result.output });
    const repeated = fingerprint === run.lastProgressFingerprint ? run.repeatedFingerprintCount + 1 : 0;
    run = {
      ...run,
      status: "running",
      budgets: {
        ...run.budgets,
        nodeAttempts: run.budgets.nodeAttempts + 1,
        toolCallsConsumed: run.budgets.toolCallsConsumed + (node.type === "tool" || node.type === "connector" ? 1 : 0),
        externalRequestsConsumed: run.budgets.externalRequestsConsumed + (this.authorityRank(node.sideEffectClass) >= this.authorityRank("external_reversible") ? 1 : 0),
      },
      evidence: [...run.evidence, ...newEvidence],
      assertions: [...run.assertions.filter((existing) => !assertions.some((candidate) => candidate.assertionId === existing.assertionId)), ...assertions],
      externalEffects: result.externalEffect ? (() => {
        const existing = run.externalEffects.find((effect) => effect.idempotencyKey === result.externalEffect!.idempotencyKey);
        return [...run.externalEffects.filter((effect) => effect.idempotencyKey !== result.externalEffect!.idempotencyKey), {
          ...existing,
          ...result.externalEffect,
          effectId: existing?.effectId ?? `gex_${randomUUID()}`,
          runId: run.runId,
          nodeId: node.id,
          evidenceRefs: result.externalEffect.evidenceRefs ?? existing?.evidenceRefs ?? [],
        }];
      })() : run.externalEffects,
      lastError: result.failure ?? null,
      lastProgressFingerprint: fingerprint,
      repeatedFingerprintCount: repeated,
      lastProgressAt: repeated === 0 ? now : run.lastProgressAt,
      updatedAt: now,
    };
    if (result.externalEffect?.state === "ambiguous") {
      graphAmbiguousEffects.labels(run.graphId, run.graphVersion, result.externalEffect.operationType).inc();
    }
    if (repeated >= run.budgets.noProgressThreshold) {
      result = { ...result, outcome: "failed_terminal", failure: failure("no_progress", `No material progress after ${repeated + 1} equivalent attempts`) };
      run.lastError = result.failure ?? null;
    }
    let edge: GraphEdgeDefinition;
    try {
      edge = resolveTransition(definition, node.id, result, run);
    } catch (error) {
      result = { ...result, outcome: "failed_terminal", failure: failure("invariant_violation", error instanceof Error ? error.message : String(error)) };
      run.lastError = result.failure ?? null;
      run.status = "failed";
      run.terminalOutcome = "transition_resolution_failed";
      run.currentNodeId = null;
      run.checkpoints = [...run.checkpoints, checkpoint(run, "terminal_failure", node.id)];
      if (attemptId) this.store.finishAttempt(attemptId, "failed", result.outcome, result.output, result.failure);
      this.recordTerminalMetrics(run);
      return this.store.saveRun(run, initialRun.revision, [
        { type: "node_failed", nodeId: node.id, attemptNumber, actor: owner, payload: { outcome: result.outcome, failure: result.failure as unknown as JsonValue } },
        { type: "graph_failed", nodeId: node.id, attemptNumber, actor: owner, payload: { unmetCompletionCriteria: definition.evidenceRequirements.map((item) => item.assertionId) } },
      ]);
    }
    run.currentNodeId = edge.to;
    run.budgets.transitions += 1;
    graphNodeAttempts.labels(run.graphId, run.graphVersion, node.id, result.outcome).inc();
    graphTransitions.labels(run.graphId, run.graphVersion, result.outcome).inc();
    if (result.outcome !== "succeeded") graphNodeFailures.labels(run.graphId, run.graphVersion, node.id, result.failure?.category ?? "unknown").inc();
    if (edge.loopId) {
      run.budgets.loopIterations += 1;
      graphLoopIterations.labels(run.graphId, run.graphVersion, edge.loopId).inc();
    }
    if (run.budgets.loopIterations > run.budgets.maxLoopIterations) {
      run.status = "failed";
      run.terminalOutcome = "loop_budget_exhausted";
      run.lastError = failure("budget_exhausted", `Loop budget exhausted: ${edge.loopId}`);
      run.currentNodeId = null;
    } else if (result.outcome === "needs_approval") {
      run.status = "waiting_for_approval";
    } else if (result.outcome === "blocked") {
      run.status = "blocked";
    } else if (result.waitUntil) {
      run.status = "waiting";
      run.data.waitUntil = result.waitUntil;
    }
    const reachedTerminal = definition.terminalNodeIds.includes(edge.to);
    if (reachedTerminal) {
      const completion = evaluateCompletion(definition, run);
      if (completion.passed && result.outcome === "succeeded") {
        run.status = "completed";
        run.terminalOutcome = "success";
        run.currentNodeId = edge.to;
        run.checkpoints = [...run.checkpoints, checkpoint(run, "completion_verified", edge.to)];
      } else {
        run.status = "failed";
        run.terminalOutcome = result.failure?.category ?? "completion_contract_failed";
        run.lastError = result.failure ?? failure("verification_failed", "Completion contract not satisfied", { missingAssertions: completion.missing as unknown as JsonValue });
        run.checkpoints = [...run.checkpoints, checkpoint(run, "terminal_failure", edge.to)];
      }
    } else if (node.type === "checkpoint" || node.type === "verification") {
      run.checkpoints = [...run.checkpoints, checkpoint(run, `after_${node.id}`, node.id)];
    }
    if (attemptId) this.store.finishAttempt(attemptId, result.outcome === "succeeded" ? "succeeded" : result.outcome === "timed_out" ? "timed_out" : result.outcome === "cancelled" ? "cancelled" : result.externalEffect?.state === "ambiguous" ? "ambiguous" : "failed", result.outcome, result.output, result.failure);
    const events: EventInput[] = [
      { type: "node_output_recorded", nodeId: node.id, attemptNumber, actor: owner, payload: { outputHash: sha256(result.output), evidenceIds: newEvidence.map((item) => item.evidenceId) as unknown as JsonValue } },
      { type: result.outcome === "succeeded" ? "node_succeeded" : "node_failed", nodeId: node.id, attemptNumber, actor: owner, payload: { outcome: result.outcome, failureCategory: result.failure?.category ?? null } },
      { type: "transition_selected", nodeId: node.id, attemptNumber, actor: owner, payload: { from: node.id, to: edge.to, outcome: result.outcome } },
    ];
    for (const savedCheckpoint of run.checkpoints.slice(initialRun.checkpoints.length)) {
      events.push({ type: "checkpoint_created", nodeId: savedCheckpoint.nodeId, attemptNumber, actor: owner, payload: { checkpointId: savedCheckpoint.checkpointId, reason: savedCheckpoint.reason, stateHash: savedCheckpoint.stateHash } });
    }
    if (result.externalEffect) {
      const eventType = result.externalEffect.state === "effect_verified" ? "external_effect_verified"
        : result.externalEffect.state === "effect_observed" ? "external_effect_observed"
          : "external_effect_requested";
      events.push({ type: eventType, nodeId: node.id, attemptNumber, actor: owner, payload: { operationType: result.externalEffect.operationType, target: result.externalEffect.target, payloadHash: result.externalEffect.payloadHash, state: result.externalEffect.state } });
    }
    if (result.outcome === "failed_retryable") events.push({ type: "retry_scheduled", nodeId: node.id, attemptNumber, actor: owner, payload: { nextNodeId: edge.to } });
    if (run.status === "completed") events.push({ type: "graph_completed", nodeId: edge.to, attemptNumber, actor: owner, payload: { evidenceCount: run.evidence.length, assertionCount: run.assertions.length } });
    if (run.status === "failed") events.push({ type: "graph_failed", nodeId: edge.to, attemptNumber, actor: owner, payload: { terminalOutcome: run.terminalOutcome } });
    if (run.status === "completed" || run.status === "failed") this.recordTerminalMetrics(run);
    return this.store.saveRun(run, initialRun.revision, events);
  }

  pause(runId: string, actor: string): GraphRunState {
    const run = this.requireRun(runId);
    if (TERMINAL_STATUSES.has(run.status)) throw new Error("terminal_graph_cannot_pause");
    return this.store.saveRun({ ...run, status: "paused", updatedAt: new Date().toISOString(), checkpoints: [...run.checkpoints, checkpoint(run, "paused", run.currentNodeId)] }, run.revision, [{ type: "graph_paused", actor, payload: {} }]);
  }

  resume(runId: string, actor: string): GraphRunState {
    const run = this.requireRun(runId);
    if (!["paused", "waiting", "waiting_for_approval", "blocked"].includes(run.status)) throw new Error(`graph_run_not_resumable:${run.status}`);
    if (this.store.externalEffects(runId).some((effect) => ["request_sent", "provider_accepted", "ambiguous"].includes(effect.state))) throw new Error("graph_run_external_effect_requires_reconciliation");
    if (run.status === "waiting_for_approval" && !this.store.approvals(runId).some((item) => item.status === "granted" && Date.parse(item.expiresAt) > Date.now())) throw new Error("graph_run_approval_not_granted");
    return this.store.saveRun({ ...run, status: "running", updatedAt: new Date().toISOString() }, run.revision, [{ type: "graph_resumed", actor, payload: {} }]);
  }

  cancel(runId: string, actor: string): GraphRunState {
    const run = this.requireRun(runId);
    if (TERMINAL_STATUSES.has(run.status)) throw new Error("terminal_graph_cannot_transition");
    const activeExternal = this.store.externalEffects(runId).filter((effect) => !["not_requested", "confirmed_absent", "effect_verified", "compensated"].includes(effect.state));
    if (activeExternal.length > 0) throw new Error("graph_cancel_requires_external_effect_reconciliation");
    const cancelled = { ...run, status: "cancelled" as const, currentNodeId: null, terminalOutcome: "cancelled", updatedAt: new Date().toISOString(), checkpoints: [...run.checkpoints, checkpoint(run, "cancelled", run.currentNodeId)] };
    this.recordTerminalMetrics(cancelled);
    return this.store.saveRun(cancelled, run.revision, [{ type: "graph_cancelled", actor, payload: {} }]);
  }

  retryFromCheckpoint(runId: string, checkpointId: string, actor: string): GraphRunState {
    const current = this.requireRun(runId);
    if (current.status === "completed" || current.status === "cancelled") throw new Error("terminal_graph_checkpoint_retry_forbidden");
    if (this.store.externalEffects(runId).some((effect) => ["request_sent", "provider_accepted", "ambiguous"].includes(effect.state))) {
      throw new Error("graph_checkpoint_retry_requires_external_effect_reconciliation");
    }
    const snapshot = this.store.checkpointSnapshot(runId, checkpointId);
    if (!snapshot) throw new Error(`graph_checkpoint_not_found:${checkpointId}`);
    const resumed: GraphRunState = {
      ...snapshot,
      runId: current.runId,
      graphId: current.graphId,
      graphVersion: current.graphVersion,
      authority: current.authority,
      budgets: {
        ...snapshot.budgets,
        nodeAttempts: Math.max(snapshot.budgets.nodeAttempts, current.budgets.nodeAttempts),
        transitions: Math.max(snapshot.budgets.transitions, current.budgets.transitions),
        loopIterations: Math.max(snapshot.budgets.loopIterations, current.budgets.loopIterations),
        tokensConsumed: Math.max(snapshot.budgets.tokensConsumed, current.budgets.tokensConsumed),
        toolCallsConsumed: Math.max(snapshot.budgets.toolCallsConsumed, current.budgets.toolCallsConsumed),
        externalRequestsConsumed: Math.max(snapshot.budgets.externalRequestsConsumed, current.budgets.externalRequestsConsumed),
        costConsumedUsd: Math.max(snapshot.budgets.costConsumedUsd, current.budgets.costConsumedUsd),
      },
      externalEffects: current.externalEffects,
      evidence: current.evidence,
      assertions: current.assertions,
      checkpoints: current.checkpoints,
      status: "running",
      terminalOutcome: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
      revision: current.revision,
    };
    return this.store.saveRun(resumed, current.revision, [{ type: "graph_resumed", actor, payload: { reason: "checkpoint_retry", checkpointId } }]);
  }

  recover(now = new Date(), actor = "recovery-manager"): { resumed: string[]; blocked: string[]; unchanged: string[] } {
    const resumed: string[] = []; const blocked: string[] = []; const unchanged: string[] = [];
    for (const run of this.store.listRuns({ limit: 250 }).filter((item) => item.status === "running" || item.status === "waiting_for_approval" || item.status === "waiting")) {
      const effects = this.store.externalEffects(run.runId);
      if (effects.some((effect) => ["request_sent", "provider_accepted", "ambiguous"].includes(effect.state))) {
        this.store.saveRun({ ...run, status: "blocked", lastError: failure("idempotency_conflict", "Recovery requires external effect reconciliation"), updatedAt: now.toISOString() }, run.revision, [{ type: "graph_blocked", actor, payload: { reason: "external_effect_reconciliation_required" } }]);
        blocked.push(run.runId);
        graphRecoveries.labels("blocked_for_reconciliation").inc();
      } else if (run.status === "running" && this.store.activeAttempts().some((attempt) => attempt.runId === run.runId && Date.parse(attempt.leaseExpiresAt) <= now.getTime())) {
        this.store.saveRun({ ...run, status: "running", updatedAt: now.toISOString() }, run.revision, [{ type: "graph_resumed", actor, payload: { reason: "expired_attempt_lease_recovered" } }]);
        resumed.push(run.runId);
        graphRecoveries.labels("expired_lease_resumed").inc();
      } else if (run.status === "waiting_for_approval" && this.store.approvals(run.runId).some((approval) => approval.status === "granted" && Date.parse(approval.expiresAt) > now.getTime())) {
        this.store.saveRun({ ...run, status: "running", updatedAt: now.toISOString() }, run.revision, [{ type: "graph_resumed", actor, payload: { reason: "approval_granted_while_offline" } }]);
        resumed.push(run.runId);
        graphRecoveries.labels("approval_resumed").inc();
      } else unchanged.push(run.runId);
    }
    return { resumed, blocked, unchanged };
  }

  decideApproval(runId: string, approvalId: string, decision: "granted" | "denied", approver: string, expiresAt: string, note?: string): GraphApproval {
    const approval = this.store.decideApproval(approvalId, decision, approver, expiresAt, note);
    if (approval.runId !== runId) throw new Error("graph_approval_run_mismatch");
    const run = this.requireRun(runId);
    graphApprovalsWaiting.labels(run.graphId, run.graphVersion).dec();
    this.store.saveRun(run, run.revision, [{ type: decision === "granted" ? "approval_granted" : "approval_denied", nodeId: approval.nodeId, actor: approver, payload: { approvalId, payloadHash: approval.payloadHash } }]);
    return approval;
  }

  reconcileEffect(runId: string, effectId: string, state: GraphRunState["externalEffects"][number]["state"], providerOperationId: string | undefined, evidenceRefs: string[], actor: string): GraphRunState["externalEffects"][number] {
    const run = this.requireRun(runId);
    const effect = this.store.reconcileEffect(runId, effectId, state, providerOperationId, evidenceRefs);
    const updated = {
      ...run,
      externalEffects: run.externalEffects.some((item) => item.effectId === effectId)
        ? run.externalEffects.map((item) => item.effectId === effectId ? effect : item)
        : [...run.externalEffects, effect],
      updatedAt: new Date().toISOString(),
    };
    const eventType = state === "effect_verified" ? "external_effect_verified" : state === "effect_observed" ? "external_effect_observed" : "external_effect_reconciled";
    this.store.saveRun(updated, run.revision, [{ type: eventType, nodeId: effect.nodeId, actor, payload: { effectId, state, providerOperationId: providerOperationId ?? null, evidenceRefs } }]);
    return effect;
  }

  private approval(run: GraphRunState, node: GraphNodeDefinition, action: string, target: string, payloadHash: string): GraphApproval {
    const now = new Date();
    const requestedId = readPath(run, "data.publicationLive.envelope.approvalId");
    const approvalId = typeof requestedId === "string" && /^gap_[a-f0-9]{32}$/.test(requestedId)
      ? requestedId
      : `gap_${randomUUID()}`;
    return { approvalId, runId: run.runId, graphVersion: run.graphVersion, nodeId: node.id, action, target, payloadHash, status: "pending", requestedAt: now.toISOString(), decidedAt: null, expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), approver: null, note: null };
  }

  private failRun(run: GraphRunState, error: GraphRunState["lastError"]): GraphRunState {
    const failed = { ...run, status: "failed" as const, currentNodeId: null, terminalOutcome: error?.category ?? "failed", lastError: error, updatedAt: new Date().toISOString(), checkpoints: [...run.checkpoints, checkpoint(run, "terminal_failure", run.currentNodeId)] };
    this.recordTerminalMetrics(failed);
    if (error?.category === "budget_exhausted") graphBudgetExhaustions.labels(run.graphId, run.graphVersion, "execution").inc();
    return this.store.saveRun(failed, run.revision, [{ type: "graph_failed", nodeId: run.currentNodeId, payload: { failure: error as unknown as JsonValue, unmetCompletionCriteria: this.registry.get(run.graphId, run.graphVersion).evidenceRequirements.map((item) => item.assertionId) as unknown as JsonValue } }]);
  }

  private recordTerminalMetrics(run: GraphRunState): void {
    graphRunsActive.labels(run.graphId, run.graphVersion).dec();
    graphRunsTotal.labels(run.graphId, run.graphVersion, run.status).inc();
    graphRunDuration.labels(run.graphId, run.graphVersion, run.status).observe(Math.max(0, (Date.parse(run.updatedAt) - Date.parse(run.createdAt)) / 1000));
  }

  private requireRun(runId: string): GraphRunState {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`graph_run_not_found:${runId}`);
    return run;
  }

  private authorityRank(value: GraphRunState["authority"]["maximum"]): number {
    return ["read_only", "local_reversible", "local_persistent", "external_reversible", "external_public", "credential_sensitive", "financial", "legal", "destructive", "irreversible"].indexOf(value);
  }
}
