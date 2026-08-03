import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGraphRuntime, type GraphRuntime } from "../src/graph/runtime.js";
import { verifyGraphChildTaskAuthority } from "../src/graph/task-authority.js";
import { governedCodingChangeGraph } from "../src/graph/workflows.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function fixture(): Promise<{ root: string; path: string; runtime: GraphRuntime }> {
  const root = await mkdtemp(join(tmpdir(), "graph-child-receipts-"));
  const path = join(root, "graph.sqlite");
  const runtime = createGraphRuntime(path, { zeroWriteOnly: true, runIdPrefix: "receipt" });
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return { root, path, runtime };
}

function attachSuccessfulDispatcher(runtime: GraphRuntime, calls: string[]): void {
  runtime.attachChildDispatcher((request) => {
    calls.push(`${request.phase}:${request.runId}`);
    return {
      taskId: `task-${calls.length}`,
      completion: Promise.resolve({
        status: "succeeded",
        outcome: request.phase === "child" ? "implemented" : "verified",
        output: { phase: request.phase, runId: request.runId },
        evidence: { receiptId: request.receiptId, authority: request.agentId },
      }),
    };
  });
}

describe("graph child-run and verifier receipts", () => {
  it("accepts queue approval reuse only for an active receipt bound to an exact granted production graph approval", async () => {
    const value = await fixture();
    const definition = governedCodingChangeGraph();
    const run = value.runtime.engine.start({ graphId: definition.graphId, version: definition.version, objective: "Approved governed edit", input: { repositoryPath: "/workspace/project" }, authority: { maximum: "local_reversible", grantedBy: "receipt-test" } });
    const requested = value.runtime.store.requestApproval({ approvalId: "approval-one", runId: run.runId, graphVersion: run.graphVersion, nodeId: "implement", action: "production.agent-child-run.v1", target: "coding-change:implement", payloadHash: "payload", status: "pending", requestedAt: new Date().toISOString(), decidedAt: null, expiresAt: new Date(Date.now() + 60_000).toISOString(), approver: null, note: null });
    value.runtime.store.decideApproval(requested.approvalId, "granted", "operator", new Date(Date.now() + 60_000).toISOString());
    const receipt = value.runtime.store.prepareChildRunReceipt({ parentRunId: run.runId, parentNodeId: "implement", parentAttemptId: "attempt", idempotencyKey: "graph-child-key", childRunId: "child-run-one", childTaskType: "build-refactor", childAgentId: "build-refactor-agent", authority: run.authority, input: { repositoryPath: "/workspace/project" }, policyHash: "policy" });
    const task = { id: "task-one", type: "build-refactor", createdAt: Date.now(), payload: { idempotencyKey: receipt.idempotencyKey, __graphParentRunId: run.runId, __graphParentNodeId: "implement", __graphReceiptId: receipt.receiptId, __graphRunId: receipt.childRunId, __graphPhase: "child" } };
    expect(verifyGraphChildTaskAuthority(value.runtime.store, task)).toMatchObject({ allowed: true, approvalId: requested.approvalId, receiptId: receipt.receiptId });
    expect(verifyGraphChildTaskAuthority(value.runtime.store, { ...task, payload: { ...task.payload, __graphReceiptId: "spoofed" } })).toMatchObject({ allowed: false });
    expect(verifyGraphChildTaskAuthority(value.runtime.store, { ...task, type: "agent-deploy" })).toMatchObject({ allowed: false });
    value.runtime.scheduler.close();
    value.runtime.store.close();
  });

  it("binds authority, evidence and outcomes to a restart-safe deterministic receipt chain", async () => {
    const value = await fixture();
    const definition = governedCodingChangeGraph();
    const run = value.runtime.engine.start({
      graphId: definition.graphId,
      version: definition.version,
      objective: "Implement a governed change",
      input: { repositoryPath: "/workspace/project" },
      authority: { maximum: "local_reversible", grantedBy: "receipt-test" },
    });
    const node = definition.nodes.find((item) => item.id === "implement")!;
    const context = {
      definition,
      node,
      run,
      attemptId: "attempt-one",
      attemptNumber: 1,
      idempotencyKey: "stable-attempt",
      effectPayloadHash: "payload-hash",
      signal: new AbortController().signal,
    };
    const dispatches: string[] = [];
    attachSuccessfulDispatcher(value.runtime, dispatches);

    const first = await value.runtime.childRuns.execute({ repositoryPath: "/workspace/project" }, context);
    expect(first).toMatchObject({ outcome: "succeeded", output: { status: "verified", chainValid: true } });
    expect(dispatches).toHaveLength(2);
    const child = value.runtime.store.childRunReceipts(run.runId)[0]!;
    const verifier = value.runtime.store.verifierReceipts(run.runId)[0]!;
    expect(child).toMatchObject({ parentRunId: run.runId, parentNodeId: "implement", childAgentId: "build-refactor-agent", status: "succeeded", outcome: "implemented" });
    expect(verifier).toMatchObject({ parentRunId: run.runId, childReceiptId: child.receiptId, verifierAgentId: "qa-verification-agent", status: "passed", outcome: "verified", childReceiptHash: child.receiptHash });
    expect(child.receiptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifier.receiptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(value.runtime.store.verifyChildRunReceiptChain(run.runId)).toBe(true);

    const database = new DatabaseSync(value.path);
    expect(() => database.prepare("UPDATE graph_child_run_receipts SET outcome='tampered' WHERE receipt_id=?").run(child.receiptId)).toThrow(/immutable/i);
    expect(() => database.prepare("UPDATE graph_verifier_receipts SET evidence_hash='tampered' WHERE verifier_receipt_id=?").run(verifier.verifierReceiptId)).toThrow(/immutable/i);
    database.close();

    value.runtime.scheduler.close();
    value.runtime.store.close();
    const reopened = createGraphRuntime(value.path, { zeroWriteOnly: true, runIdPrefix: "receipt" });
    const replayDispatches: string[] = [];
    attachSuccessfulDispatcher(reopened, replayDispatches);
    const replay = await reopened.childRuns.execute({ repositoryPath: "/workspace/project" }, { ...context, run: reopened.store.getRun(run.runId)! });
    expect(replay).toMatchObject({ outcome: "succeeded", output: { chainValid: true } });
    expect(replayDispatches).toEqual([]);
    expect(reopened.store.verifyChildRunReceiptChain(run.runId)).toBe(true);
    reopened.scheduler.close();
    reopened.store.close();
  });
});
