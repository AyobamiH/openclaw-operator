import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createGraphRuntime, type GraphRuntime } from "../src/graph/runtime.js";
import { codingChangeGraph } from "../src/graph/workflows.js";
import { applyStatePatches } from "../src/graph/reducer.js";
import { evaluateAuthority } from "../src/graph/authority.js";
import { failure } from "../src/graph/failures.js";
import { runWithGraphConcurrencyDeferral } from "../src/graph/engine.js";
import type { GraphDefinition, GraphRunState, NodeExecutionResult } from "../src/graph/types.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function createTestRuntime(options: { zeroWriteOnly?: boolean } = {}): Promise<{ runtime: GraphRuntime; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "openclaw-graph-kernel-"));
  const value = createGraphRuntime(join(root, "graph.sqlite"), options);
  cleanups.push(async () => {
    value.store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { runtime: value, root };
}

function request(graphId: string, input: Record<string, any>, maximum: GraphRunState["authority"]["maximum"] = "read_only") {
  return { graphId, version: "1.0.0", objective: `Prove ${graphId}`, input, authority: { maximum, grantedBy: "test-operator" } };
}

describe("graph definition and state invariants", () => {
  it("rejects mutated bytes under an already registered graph version", async () => {
    const { runtime } = await createTestRuntime();
    const altered = structuredClone(codingChangeGraph());
    altered.description = "Mutated immutable version";
    expect(() => runtime.engine.register(altered)).toThrow("graph_definition_version_immutable");
  });

  it("rejects unknown node handlers and unsafe state patch paths", async () => {
    const { runtime } = await createTestRuntime();
    const altered = structuredClone(codingChangeGraph());
    altered.graphId = "unknown-handler-graph";
    altered.nodes[0]!.handler = "unknown.executor";
    expect(() => runtime.engine.register(altered)).toThrow("graph_handler_unavailable");
    expect(runtime.registry.list().some((definition) => definition.graphId === altered.graphId)).toBe(false);
    const run = runtime.engine.start(request("research-to-action", { sources: [], claims: [] }));
    expect(() => applyStatePatches(run, [{ op: "set", path: "__proto__.polluted", value: true }], ["__proto__"]))
      .toThrow("unsafe_state_patch_path");
  });

  it("prevents duplicate worker acquisition across database clients", async () => {
    const { runtime: first, root } = await createTestRuntime();
    const second = createGraphRuntime(join(root, "graph.sqlite"));
    cleanups.push(async () => second.store.close());
    expect(first.store.acquireLease("repo:fixture", "run-a", "worker-a", 60_000)).toBe(true);
    expect(second.store.acquireLease("repo:fixture", "run-b", "worker-b", 60_000)).toBe(false);
  });

  it("enforces per-definition concurrency and declared resource locks", async () => {
    const { runtime } = await createTestRuntime();
    for (let index = 0; index < 4; index += 1) runtime.engine.start(request("research-to-action", { sources: [], claims: [] }));
    expect(() => runtime.engine.start(request("research-to-action", { sources: [], claims: [] }))).toThrow("graph_definition_concurrency_exhausted");

    const { runtime: lockedRuntime } = await createTestRuntime();
    const locked = structuredClone(codingChangeGraph());
    locked.graphId = "resource-lock-test";
    locked.concurrency = { ...locked.concurrency, resourceKeys: ["repo:shared"] };
    lockedRuntime.engine.register(locked);
    const created = lockedRuntime.engine.start(request("resource-lock-test", {}, "local_reversible"));
    expect(lockedRuntime.store.acquireLease("repo:shared", "other-run", "other-worker", 60_000)).toBe(true);
    await expect(lockedRuntime.engine.step(created.runId, "graph-worker")).rejects.toThrow("graph_resource_lease_conflict:repo:shared");
  });

  it("releases definition capacity for waiting runs while retaining active execution pressure", async () => {
    const { runtime } = await createTestRuntime({ zeroWriteOnly: false });
    const waitingRun = runtime.engine.start(request("deterministic-social-publication", { dryRun: false, payload: { caption: "approval wait" } }, "external_public"));
    const waiting = await runtime.engine.runUntilSettled(waitingRun.runId);
    expect(waiting.status).toBe("waiting_for_approval");
    expect(runtime.store.activeRunCount("deterministic-social-publication", "1.0.0")).toBe(0);

    const source = codingChangeGraph();
    const limited: GraphDefinition = {
      ...source,
      graphId: "single-active-capacity",
      description: "Single active capacity fixture",
      concurrency: { ...source.concurrency, maxRuns: 1 },
    };
    runtime.engine.register(limited);
    runtime.engine.start(request("single-active-capacity", { sources: [], claims: [] }));
    expect(runtime.store.activeRunCount("single-active-capacity", "1.0.0")).toBe(1);
    expect(() => runtime.engine.start(request("single-active-capacity", { sources: [], claims: [] }))).toThrow("graph_definition_concurrency_exhausted");
  });
});

describe("representative graph workflows", () => {
  it("executes a real low-risk coding fixture and requires test, diff and build evidence", async () => {
    const { runtime, root } = await createTestRuntime();
    const fixture = join(root, "fixture.txt");
    await writeFile(fixture, "baseline\n", "utf8");
    runtime.legacy.register("coding-fixture", async (context): Promise<NodeExecutionResult> => {
      if (context.node.id === "implement") await writeFile(fixture, "baseline\ngraph-native\n", "utf8");
      const content = await readFile(fixture, "utf8");
      if (!content.includes("graph-native")) return { outcome: "failed_repairable", output: {}, failure: failure("verification_failed", "fixture change absent"), progressFingerprint: "fixture-absent" };
      return { outcome: "succeeded", output: { contentHash: content.length }, evidence: context.node.evidenceEmitted.map((kind) => ({ kind, uri: `fixture://${context.node.id}/${kind}`, summary: `${kind} fixture evidence`, checker: "legacy.command" })), progressFingerprint: `${context.node.id}:${content.length}` };
    });
    const created = runtime.engine.start(request("coding-change", { legacyTaskId: "coding-fixture" }, "local_reversible"));
    const completed = await runtime.engine.runUntilSettled(created.runId);
    expect(completed.status).toBe("completed");
    expect(completed.assertions.map((item) => item.assertionId).sort()).toEqual(["coding-build-passed", "coding-diff-reviewed", "coding-tests-passed"]);
    expect(runtime.store.evidence(created.runId).map((item) => item.kind)).toEqual(expect.arrayContaining(["repository-truth", "test-output", "git-diff", "build-output"]));
    expect(await readFile(fixture, "utf8")).toContain("graph-native");
  });

  it("completes the social publication graph in zero-write dry-run mode", async () => {
    const { runtime } = await createTestRuntime();
    const created = runtime.engine.start(request("deterministic-social-publication", { dryRun: true, payload: { account: "fixture", caption: "Evidence first" } }));
    const completed = await runtime.engine.runUntilSettled(created.runId);
    expect(completed.status).toBe("completed");
    expect(completed.data.publication).toMatchObject({ mode: "dry_run", providerWrites: 0 });
    expect(completed.externalEffects).toHaveLength(0);
    expect(runtime.store.evidence(created.runId).some((item) => item.kind === "publication-dry-run")).toBe(true);
  });

  it("completes fixture-backed research only when every claim has a source", async () => {
    const { runtime } = await createTestRuntime();
    const sources = [{ id: "source-1", title: "SQLite transactions", uri: "fixture://sqlite" }];
    const claims = [{ id: "claim-1", text: "Durable state uses transactions", sourceRefs: ["source-1"] }];
    const created = runtime.engine.start(request("research-to-action", { sources, claims }));
    const completed = await runtime.engine.runUntilSettled(created.runId);
    expect(completed.status).toBe("completed");
    expect(completed.assertions.every((item) => item.status === "passed")).toBe(true);
    expect(completed.data.research).toMatchObject({ marginalInformationGain: 0 });
  });

  it("executes a registered child graph with durable lineage and inherited authority", async () => {
    const { runtime } = await createTestRuntime();
    const source = codingChangeGraph();
    const definition: GraphDefinition = {
      ...source, graphId: "subgraph-parent-test", description: "Subgraph lineage fixture", evidenceRequirements: [],
      nodes: [
        { ...source.nodes[0]!, id: "research_child", type: "subgraph", handler: "graph.subgraph", subgraphId: "research-to-action", subgraphVersion: "1.0.0", possibleOutcomes: ["succeeded", "failed_repairable", "failed_terminal", "needs_approval", "blocked"], evidenceEmitted: ["subgraph-outcome"] },
        { ...source.nodes.find((node) => node.id === "complete")!, id: "complete" },
      ],
      edges: [
        { from: "research_child", to: "complete", on: "succeeded" },
        { from: "research_child", to: "complete", on: "failed_repairable" },
        { from: "research_child", to: "complete", on: "failed_terminal" },
        { from: "research_child", to: "complete", on: "needs_approval" },
        { from: "research_child", to: "complete", on: "blocked" },
      ], entryNodeId: "research_child", terminalNodeIds: ["complete"],
    };
    runtime.engine.register(definition);
    const parent = runtime.engine.start(request("subgraph-parent-test", { subgraphInput: { sources: [], claims: [] } }));
    const completed = await runtime.engine.runUntilSettled(parent.runId);
    const child = runtime.store.listRuns({ graphId: "research-to-action" }).find((candidate) => candidate.parentRunId === parent.runId)!;
    expect(completed.status).toBe("completed");
    expect(child.status).toBe("completed");
    expect(child.correlationId).toBe(parent.correlationId);
    expect(child.authority.maximum).toBe(parent.authority.maximum);
    expect(completed.evidence.some((item) => item.kind === "subgraph-outcome" && item.uri === `graph://${child.runId}`)).toBe(true);
  });

  it("routes unsupported research claims into a bounded failure instead of declaring completion", async () => {
    const { runtime } = await createTestRuntime();
    const created = runtime.engine.start(request("research-to-action", { sources: [], claims: [{ id: "unsupported", sourceRefs: [] }] }));
    const terminal = await runtime.engine.runUntilSettled(created.runId);
    expect(terminal.status).toBe("failed");
    expect(terminal.terminalOutcome).toBe("verification_failed");
    expect(terminal.assertions).toHaveLength(0);
  });
});

describe("ledger, approvals, recovery and idempotency", () => {
  it("replays the hash-chained event ledger to the exact persisted run state", async () => {
    const { runtime } = await createTestRuntime();
    const created = runtime.engine.start(request("research-to-action", { sources: [], claims: [] }));
    const completed = await runtime.engine.runUntilSettled(created.runId);
    expect(runtime.store.verifyEventChain(created.runId)).toBe(true);
    expect(runtime.store.replayRun(created.runId)).toEqual(completed);
    const sequences = runtime.store.events(created.runId).map((event) => event.sequence);
    expect(sequences).toEqual(sequences.map((_, index) => index + 1));
    const eventTypes = runtime.store.events(created.runId).map((event) => event.type);
    expect(eventTypes).toEqual(expect.arrayContaining(["graph_run_created", "graph_started", "node_scheduled", "node_started", "node_output_recorded", "node_succeeded", "transition_selected", "checkpoint_created", "graph_completed"]));
  });

  it("fails closed when a registered executor violates its structured output contract", async () => {
    const { runtime } = await createTestRuntime();
    runtime.executors.register("test.invalid-output", async () => ({ outcome: "invented-route", output: "not-an-object" }) as unknown as NodeExecutionResult);
    const source = codingChangeGraph();
    const definition: GraphDefinition = {
      ...source, graphId: "invalid-output-test", description: "Invalid executor output fixture", evidenceRequirements: [],
      nodes: [
        { ...source.nodes[0]!, id: "execute", handler: "test.invalid-output", possibleOutcomes: ["failed_terminal"] },
        { ...source.nodes.find((node) => node.id === "complete")!, id: "complete" },
      ],
      edges: [{ from: "execute", to: "complete", on: "failed_terminal" }], entryNodeId: "execute", terminalNodeIds: ["complete"],
    };
    runtime.engine.register(definition);
    const created = runtime.engine.start(request("invalid-output-test", {}));
    const failed = await runtime.engine.runUntilSettled(created.runId);
    expect(failed.status).toBe("failed");
    expect(failed.lastError?.category).toBe("unknown");
  });

  it("binds approval to graph version, node, action, target and payload hash", async () => {
    const { runtime } = await createTestRuntime({ zeroWriteOnly: false });
    const created = runtime.engine.start(request("deterministic-social-publication", { dryRun: false, payload: { caption: "live fixture" } }, "external_public"));
    const waiting = await runtime.engine.runUntilSettled(created.runId);
    expect(waiting.status).toBe("waiting_for_approval");
    const approval = runtime.store.approvals(created.runId)[0]!;
    const node = runtime.registry.get(created.graphId, created.graphVersion).nodes.find((item) => item.id === approval.nodeId)!;
    expect(evaluateAuthority({ run: waiting, node, graphMaximum: "external_public", approvalThreshold: "external_reversible", payloadHash: "0".repeat(64), action: approval.action, target: approval.target, approvals: [approval] }).allowed).toBe(false);
    runtime.engine.decideApproval(created.runId, approval.approvalId, "granted", "john", new Date(Date.now() + 60_000).toISOString());
    const resumed = runtime.engine.resume(created.runId, "john");
    expect(resumed.status).toBe("running");
  });

  it("does not replay a provider-accepted effect after a crash", async () => {
    const { runtime } = await createTestRuntime();
    const created = runtime.engine.start(request("deterministic-social-publication", { dryRun: true, payload: { caption: "fixture" } }));
    const effect = {
      effectId: `effect_${randomUUID()}`, runId: created.runId, nodeId: "publish", idempotencyKey: "provider-accepted-once", operationType: "publish", target: "fixture-account", payloadHash: "a".repeat(64), state: "provider_accepted" as const, providerOperationId: "provider-1", evidenceRefs: [],
    };
    const injected = { ...created, status: "running" as const, externalEffects: [effect], updatedAt: new Date().toISOString() };
    runtime.store.saveRun(injected, created.revision, [{ type: "external_effect_observed", nodeId: "publish", payload: { state: "provider_accepted" } }]);
    const recovery = runtime.engine.recover(new Date(Date.now() + 1000));
    expect(recovery.blocked).toContain(created.runId);
    expect(runtime.store.getRun(created.runId)?.status).toBe("blocked");
    expect(runtime.store.activeAttempts()).toHaveLength(0);
  });

  it("persists external reconciliation into both state and the event ledger", async () => {
    const { runtime } = await createTestRuntime();
    const created = runtime.engine.start(request("deterministic-social-publication", { dryRun: true, payload: {} }));
    const effect = {
      effectId: `effect_${randomUUID()}`, runId: created.runId, nodeId: "publish", idempotencyKey: "ambiguous-once", operationType: "publish", target: "fixture-account", payloadHash: "b".repeat(64), state: "ambiguous" as const, evidenceRefs: [],
    };
    runtime.store.saveRun({ ...created, status: "blocked", externalEffects: [effect], updatedAt: new Date().toISOString() }, created.revision, [{ type: "external_effect_observed", nodeId: "publish", payload: { state: "ambiguous" } }]);
    runtime.engine.reconcileEffect(created.runId, effect.effectId, "effect_verified", "provider-verified", ["fixture://readback"], "operator");
    expect(runtime.store.getRun(created.runId)?.externalEffects[0]).toMatchObject({ state: "effect_verified", providerOperationId: "provider-verified" });
    expect(runtime.store.events(created.runId).at(-2)?.type).toBe("external_effect_verified");
    expect(runtime.store.replayRun(created.runId)).toEqual(runtime.store.getRun(created.runId));
  });

  it("resumes when approval arrived while the worker was offline", async () => {
    const { runtime } = await createTestRuntime({ zeroWriteOnly: false });
    const created = runtime.engine.start(request("deterministic-social-publication", { dryRun: false, payload: {} }, "external_public"));
    await runtime.engine.runUntilSettled(created.runId);
    const approval = runtime.store.approvals(created.runId)[0]!;
    runtime.store.decideApproval(approval.approvalId, "granted", "john", new Date(Date.now() + 60_000).toISOString());
    const recovery = runtime.engine.recover();
    expect(recovery.resumed).toContain(created.runId);
    expect(runtime.store.getRun(created.runId)?.status).toBe("running");
  });

  it("preserves consumed budgets when retrying from a checkpoint", async () => {
    const { runtime } = await createTestRuntime();
    const created = runtime.engine.start(request("research-to-action", { sources: [], claims: [] }));
    const advanced = await runtime.engine.step(created.runId);
    const checkpointId = advanced.checkpoints[0]!.checkpointId;
    const retried = runtime.engine.retryFromCheckpoint(created.runId, checkpointId, "operator");
    expect(retried.budgets.nodeAttempts).toBeGreaterThanOrEqual(advanced.budgets.nodeAttempts);
    expect(retried.budgets.transitions).toBeGreaterThanOrEqual(advanced.budgets.transitions);
  });

  it("detects process-death work as stale and terminalises it only through targeted recovery", async () => {
    const { runtime } = await createTestRuntime();
    const created = runtime.engine.start(request("research-to-action", { sources: [], claims: [] }));
    const running = runtime.store.saveRun({ ...created, status: "running", updatedAt: new Date().toISOString() }, created.revision, [{ type: "graph_started", payload: {} }]);
    runtime.store.createAttempt({ attemptId: "expired-attempt", runId: running.runId, nodeId: running.currentNodeId!, attemptNumber: 1, idempotencyKey: "expired-attempt-key", owner: "dead-worker", leaseExpiresAt: new Date(Date.now() - 1000).toISOString(), startedAt: new Date(Date.now() - 2000).toISOString() });
    const recovery = runtime.engine.recover();
    expect(recovery.stale).toContain(running.runId);
    expect(recovery.expiredAttempts).not.toContain("expired-attempt");
    expect(runtime.store.getRun(running.runId)?.currentNodeId).toBe(running.currentNodeId);
    expect(runtime.store.activeAttempts()).toHaveLength(1);
    const terminal = runtime.engine.reconcileStaleRun(running.runId, "test-recovery");
    expect(terminal).toMatchObject({ status: "failed", terminalOutcome: "recovery_stale_attempt_terminalized", currentNodeId: null });
    expect(runtime.store.activeAttempts()).toHaveLength(0);
  });

  it("closes an orphaned child receipt when targeted stale recovery terminalises its parent", async () => {
    const { runtime } = await createTestRuntime();
    const created = runtime.engine.start(request("research-to-action", { sources: [], claims: [] }));
    const running = runtime.store.saveRun({ ...created, status: "running", updatedAt: new Date().toISOString() }, created.revision, [{ type: "graph_started", payload: {} }]);
    runtime.store.createAttempt({ attemptId: "dead-child-attempt", runId: running.runId, nodeId: running.currentNodeId!, attemptNumber: 1, idempotencyKey: "dead-child-attempt-key", owner: "dead-process", leaseExpiresAt: new Date(Date.now() - 1000).toISOString(), startedAt: new Date(Date.now() - 2000).toISOString() });
    const receipt = runtime.store.prepareChildRunReceipt({
      parentRunId: running.runId,
      parentNodeId: running.currentNodeId!,
      parentAttemptId: "dead-child-attempt",
      idempotencyKey: "dead-child-receipt-key",
      childRunId: "dead-child-run",
      childTaskType: "build-refactor",
      childAgentId: "build-refactor-agent",
      authority: running.authority,
      input: { repositoryPath: "/fixture" },
      policyHash: "a".repeat(64),
    });
    runtime.store.bindChildRunDispatch(receipt.receiptId, "missing-dispatch-task");
    runtime.store.markChildRunRunning(receipt.receiptId);
    runtime.engine.recover();
    runtime.engine.reconcileStaleRun(running.runId, "test-recovery");
    expect(runtime.store.childRunReceipt(receipt.receiptId)).toMatchObject({
      status: "failed",
      outcome: "parent_attempt_stale_after_process_death",
      failureReason: "Parent Graph attempt was proven stale after its execution lease ended",
    });
    expect(runtime.store.verifyEventChain(running.runId)).toBe(true);
  });

  it("releases stale definition concurrency after process death without freeing a live attempt", async () => {
    const { runtime } = await createTestRuntime();
    const source = codingChangeGraph();
    const limited: GraphDefinition = { ...source, graphId: "stale-capacity", concurrency: { ...source.concurrency, maxRuns: 1 } };
    runtime.engine.register(limited);
    const stale = runtime.engine.start(request("stale-capacity", { sources: [], claims: [] }));
    const staleRunning = runtime.store.saveRun({ ...stale, status: "running", updatedAt: new Date().toISOString() }, stale.revision, [{ type: "graph_started", payload: {} }]);
    runtime.store.createAttempt({ attemptId: "dead-attempt", runId: staleRunning.runId, nodeId: staleRunning.currentNodeId!, attemptNumber: 1, idempotencyKey: "dead-attempt-key", owner: "dead-process", leaseExpiresAt: new Date(Date.now() - 1000).toISOString(), startedAt: new Date(Date.now() - 2000).toISOString() });
    expect(runtime.store.activeRunCount("stale-capacity", "1.0.0")).toBe(0);
    expect(() => runtime.engine.start(request("stale-capacity", { sources: [], claims: [] }))).not.toThrow();

    const protectedDefinition: GraphDefinition = { ...source, graphId: "live-capacity", concurrency: { ...source.concurrency, maxRuns: 1 } };
    runtime.engine.register(protectedDefinition);
    const live = runtime.engine.start(request("live-capacity", { sources: [], claims: [] }));
    const liveRunning = runtime.store.saveRun({ ...live, status: "running", updatedAt: new Date().toISOString() }, live.revision, [{ type: "graph_started", payload: {} }]);
    runtime.store.createAttempt({ attemptId: "live-attempt", runId: liveRunning.runId, nodeId: liveRunning.currentNodeId!, attemptNumber: 1, idempotencyKey: "live-attempt-key", owner: "live-process", leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), startedAt: new Date().toISOString() });
    expect(runtime.store.activeRunCount("live-capacity", "1.0.0")).toBe(1);
    expect(() => runtime.engine.start(request("live-capacity", { sources: [], claims: [] }))).toThrow("graph_definition_concurrency_exhausted");
    expect(() => runtime.engine.reconcileStaleRun(liveRunning.runId, "test-recovery")).toThrow("graph_stale_recovery_not_proven");
  });

  it("defers startup and scheduler concurrency exhaustion without throwing", () => {
    const definition = runWithGraphConcurrencyDeferral(() => { throw new Error("graph_definition_concurrency_exhausted:governed-task-execution@1.0.0"); });
    expect(definition).toMatchObject({ outcome: "deferred", reason: "definition_concurrency_exhausted" });
    const global = runWithGraphConcurrencyDeferral(() => { throw new Error("graph_global_concurrency_exhausted"); });
    expect(global).toMatchObject({ outcome: "deferred", reason: "global_concurrency_exhausted" });
    expect(() => runWithGraphConcurrencyDeferral(() => { throw new Error("unrelated-startup-failure"); })).toThrow("unrelated-startup-failure");
  });

  it("terminalises stale non-terminal runs without external effects during recovery", async () => {
    const { runtime } = await createTestRuntime({ zeroWriteOnly: false });
    const created = runtime.engine.start(request("deterministic-social-publication", { dryRun: false, payload: { caption: "stale approval" } }, "external_public"));
    const waiting = await runtime.engine.runUntilSettled(created.runId);
    expect(waiting.status).toBe("waiting_for_approval");
    const recovery = runtime.engine.recover(new Date(Date.parse(waiting.createdAt) + 2 * 60 * 60 * 1000), "restart-recovery");
    expect(recovery.failed).toContain(waiting.runId);
    const terminal = runtime.store.getRun(waiting.runId);
    expect(terminal).toMatchObject({ status: "failed", terminalOutcome: "recovery_wall_clock_timeout", currentNodeId: null });
    expect(runtime.store.activeRunCount("deterministic-social-publication", "1.0.0")).toBe(0);
  });

  it("terminalises effect-free runs when granted approval expires before capability issue", async () => {
    const { runtime } = await createTestRuntime({ zeroWriteOnly: false });
    const created = runtime.engine.start(request("deterministic-social-publication", { dryRun: false, payload: { caption: "expired approval" } }, "external_public"));
    const waiting = await runtime.engine.runUntilSettled(created.runId);
    expect(waiting.status).toBe("waiting_for_approval");
    const approval = runtime.store.approvals(waiting.runId)[0]!;
    runtime.store.decideApproval(approval.approvalId, "granted", "john", new Date(Date.now() - 1000).toISOString());
    const running = runtime.store.saveRun({ ...waiting, status: "running", updatedAt: new Date().toISOString() }, waiting.revision, [{ type: "graph_resumed", payload: { reason: "fixture" } }]);
    const recovery = runtime.engine.recover(new Date(Date.now() + 1000), "restart-recovery");
    expect(recovery.failed).toContain(running.runId);
    const terminal = runtime.store.getRun(running.runId);
    expect(terminal).toMatchObject({ status: "failed", terminalOutcome: "recovery_approval_expired_before_capability_issue", currentNodeId: null });
    expect(runtime.store.activeRunCount("deterministic-social-publication", "1.0.0")).toBe(0);
  });

  it("keeps an older run attached to its immutable definition after a new version registers", async () => {
    const { runtime } = await createTestRuntime();
    const created = runtime.engine.start(request("research-to-action", { sources: [], claims: [] }));
    const next = structuredClone(runtime.registry.get("research-to-action", "1.0.0"));
    next.version = "1.2.0";
    next.description = "Compatible later graph version";
    next.migrationCompatibility.compatibleFromVersions = ["1.0.0"];
    runtime.engine.register(next);
    expect(runtime.store.getRun(created.runId)?.graphVersion).toBe("1.0.0");
    expect(runtime.registry.latest("research-to-action").version).toBe("1.2.0");
  });

  it("detects stale concurrent state revisions", async () => {
    const { runtime } = await createTestRuntime();
    const created = runtime.engine.start(request("research-to-action", { sources: [], claims: [] }));
    runtime.store.saveRun({ ...created, status: "running", updatedAt: new Date().toISOString() }, created.revision, [{ type: "graph_started", payload: {} }]);
    expect(() => runtime.store.saveRun({ ...created, status: "paused", updatedAt: new Date().toISOString() }, created.revision, [{ type: "graph_paused", payload: {} }]))
      .toThrow("graph_run_revision_conflict");
  });

  it("propagates parent authority and remaining budgets to child runs", async () => {
    const { runtime } = await createTestRuntime();
    const parent = runtime.engine.start(request("research-to-action", { sources: [], claims: [] }, "read_only"));
    expect(() => runtime.engine.start({ ...request("research-to-action", { sources: [], claims: [] }, "local_reversible"), parentRunId: parent.runId })).toThrow("child_graph_authority_exceeds_parent");
    const child = runtime.engine.start({ ...request("research-to-action", { sources: [], claims: [{ sourceRefs: [] }] }), parentRunId: parent.runId });
    const failed = await runtime.engine.runUntilSettled(child.runId);
    expect(failed.parentRunId).toBe(parent.runId);
    expect(runtime.store.getRun(parent.runId)?.status).toBe("created");
  });

  it("cancels a waiting local graph but refuses terminal resurrection", async () => {
    const { runtime } = await createTestRuntime();
    runtime.executors.register("test.wait", async () => ({ outcome: "succeeded", output: {}, waitUntil: new Date(Date.now() + 60_000).toISOString() }));
    const source = codingChangeGraph();
    const definition: GraphDefinition = {
      ...source, graphId: "wait-cancel-test", description: "Wait cancellation fixture", evidenceRequirements: [],
      nodes: [
        { ...source.nodes[0]!, id: "wait", type: "wait", handler: "test.wait", possibleOutcomes: ["succeeded"] },
        { ...source.nodes[0]!, id: "after_wait", possibleOutcomes: ["succeeded"] },
        { ...source.nodes.find((node) => node.id === "complete")!, id: "complete" },
      ],
      edges: [{ from: "wait", to: "after_wait", on: "succeeded" }, { from: "after_wait", to: "complete", on: "succeeded" }], entryNodeId: "wait", terminalNodeIds: ["complete"],
    };
    runtime.engine.register(definition);
    const created = runtime.engine.start(request("wait-cancel-test", {}));
    const waiting = await runtime.engine.runUntilSettled(created.runId);
    expect(waiting.status).toBe("waiting");
    const cancelled = runtime.engine.cancel(created.runId, "operator");
    expect(cancelled.status).toBe("cancelled");
    expect(() => runtime.engine.resume(created.runId, "operator")).toThrow("graph_run_not_resumable");
  });
});

describe("bounded loops", () => {
  it("terminates a repeated identical repair attempt as no progress", async () => {
    const { runtime } = await createTestRuntime();
    runtime.executors.register("test.no-progress", async () => ({ outcome: "failed_repairable", output: {}, failure: failure("verification_failed", "same assertion"), progressFingerprint: "same-fingerprint" }));
    const definition: GraphDefinition = {
      ...codingChangeGraph(), graphId: "no-progress-test", description: "No progress invariant fixture",
      nodes: [
        { ...codingChangeGraph().nodes[0]!, id: "attempt", handler: "test.no-progress", possibleOutcomes: ["failed_repairable", "failed_terminal"], maxAttempts: 5, loopId: "repair" },
        { ...codingChangeGraph().nodes.find((node) => node.id === "complete")!, id: "complete" },
      ],
      edges: [
        { from: "attempt", to: "attempt", on: "failed_repairable", loopId: "repair" },
        { from: "attempt", to: "complete", on: "failed_terminal" },
      ],
      entryNodeId: "attempt", terminalNodeIds: ["complete"], evidenceRequirements: [],
      loopBudgets: { ...codingChangeGraph().loopBudgets, noProgressThreshold: 1, maxLoopIterations: 5 },
    };
    runtime.engine.register(definition);
    const created = runtime.engine.start(request("no-progress-test", {}));
    const terminal = await runtime.engine.runUntilSettled(created.runId);
    expect(terminal.status).toBe("failed");
    expect(terminal.lastError?.category).toBe("no_progress");
    expect(terminal.budgets.nodeAttempts).toBe(2);
  });

  it("fails when a node retry budget is exhausted", async () => {
    const { runtime } = await createTestRuntime();
    runtime.executors.register("test.retry", async () => ({ outcome: "failed_repairable", output: {}, failure: failure("verification_failed", "retry fixture"), progressFingerprint: randomUUID() }));
    const source = codingChangeGraph();
    const definition: GraphDefinition = {
      ...source, graphId: "retry-budget-test", description: "Retry budget fixture", evidenceRequirements: [],
      nodes: [
        { ...source.nodes[0]!, id: "retry", handler: "test.retry", possibleOutcomes: ["failed_repairable", "failed_terminal"], maxAttempts: 1, retryEligible: true },
        { ...source.nodes.find((node) => node.id === "complete")!, id: "complete" },
      ],
      edges: [{ from: "retry", to: "retry", on: "failed_repairable", loopId: "retry" }, { from: "retry", to: "complete", on: "failed_terminal" }], entryNodeId: "retry", terminalNodeIds: ["complete"],
    };
    runtime.engine.register(definition);
    const created = runtime.engine.start(request("retry-budget-test", {}));
    const terminal = await runtime.engine.runUntilSettled(created.runId);
    expect(terminal.status).toBe("failed");
    expect(terminal.lastError?.category).toBe("budget_exhausted");
  });
});
