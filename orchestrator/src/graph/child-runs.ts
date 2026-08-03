import { sha256 } from "./reducer.js";
import { failure } from "./failures.js";
import type { GraphStore } from "./store.js";
import type { JsonValue, NodeExecutionContext, NodeExecutionResult } from "./types.js";

export type ChildDispatchCompletion = {
  status: "succeeded" | "failed" | "blocked";
  outcome: string;
  output: unknown;
  evidence: unknown;
  failureReason?: string;
};

export type ChildDispatchHandle = {
  taskId: string;
  completion: Promise<ChildDispatchCompletion>;
};

export type ChildRunDispatcher = (request: {
  phase: "child" | "verifier";
  parentRunId: string;
  parentNodeId: string;
  receiptId: string;
  runId: string;
  taskType: string;
  agentId: string;
  idempotencyKey: string;
  payload: Record<string, JsonValue>;
}) => ChildDispatchHandle;

export type GovernedChildRunInput = {
  repositoryPath: string;
  childPayload?: Record<string, JsonValue>;
  verifierPayload?: Record<string, JsonValue>;
};

const CHILD_TASK_TYPE = "build-refactor";
const CHILD_AGENT_ID = "build-refactor-agent";
const VERIFIER_TASK_TYPE = "qa-verification";
const VERIFIER_AGENT_ID = "qa-verification-agent";

export class GraphChildRunCoordinator {
  private dispatcher: ChildRunDispatcher | null = null;

  constructor(private readonly store: GraphStore) {}

  setDispatcher(dispatcher: ChildRunDispatcher): void {
    if (this.dispatcher) throw new Error("graph_child_run_dispatcher_already_attached");
    this.dispatcher = dispatcher;
  }

  capabilities(): { durableReceipts: true; verifierReceipts: true; restartReplay: true; tamperDetection: true; dispatcherAttached: boolean } {
    return { durableReceipts: true, verifierReceipts: true, restartReplay: true, tamperDetection: true, dispatcherAttached: this.dispatcher !== null };
  }

  async execute(input: GovernedChildRunInput, context: NodeExecutionContext): Promise<NodeExecutionResult> {
    if (!this.dispatcher) {
      return { outcome: "blocked", output: { status: "dispatcher_unavailable" }, failure: failure("tool_unavailable", "Graph child-run dispatcher is not attached") };
    }
    const childInput = {
      repositoryPath: input.repositoryPath,
      mode: context.node.id === "repair" ? "repair" : "implement",
      objective: context.run.objective,
      parentGraphRunId: context.run.runId,
      parentGraphNodeId: context.node.id,
      ...(input.childPayload ?? {}),
    } as Record<string, JsonValue>;
    const policyHash = sha256({ taskType: CHILD_TASK_TYPE, agentId: CHILD_AGENT_ID, verifierTaskType: VERIFIER_TASK_TYPE, verifierAgentId: VERIFIER_AGENT_ID, authority: context.run.authority.maximum });
    const idempotencyKey = `graph-child:${context.run.runId}:${context.node.id}:${context.idempotencyKey}`;
    const childRunId = `child_${sha256(idempotencyKey).slice(0, 32)}`;
    let child = this.store.prepareChildRunReceipt({
      parentRunId: context.run.runId,
      parentNodeId: context.node.id,
      parentAttemptId: context.attemptId,
      idempotencyKey,
      childRunId,
      childTaskType: CHILD_TASK_TYPE,
      childAgentId: CHILD_AGENT_ID,
      authority: context.run.authority,
      input: childInput,
      policyHash,
    });

    if (!["succeeded", "failed", "blocked"].includes(child.status)) {
      const handle = this.dispatcher({ phase: "child", parentRunId: context.run.runId, parentNodeId: context.node.id, receiptId: child.receiptId, runId: child.childRunId, taskType: child.childTaskType, agentId: child.childAgentId, idempotencyKey: child.idempotencyKey, payload: child.input });
      if (!child.dispatchTaskId) child = this.store.bindChildRunDispatch(child.receiptId, handle.taskId);
      if (child.status === "dispatched") child = this.store.markChildRunRunning(child.receiptId);
      const completed = await handle.completion;
      child = this.store.completeChildRunReceipt({ receiptId: child.receiptId, ...completed });
    }
    if (child.status !== "succeeded" || !child.receiptHash) {
      return { outcome: child.status === "blocked" ? "blocked" : "failed_terminal", output: { status: child.status, childRunId: child.childRunId, childReceiptHash: child.receiptHash ?? null }, failure: failure(child.status === "blocked" ? "authority_denied" : "verification_failed", child.failureReason ?? `Child run ${child.status}`), progressFingerprint: sha256(child) };
    }

    const verifierInput = {
      parentGraphRunId: context.run.runId,
      childRunId: child.childRunId,
      childReceiptId: child.receiptId,
      childReceiptHash: child.receiptHash,
      repositoryPath: input.repositoryPath,
      executionMode: "live",
      verificationTarget: context.node.id,
      ...(input.verifierPayload ?? {}),
    } as Record<string, JsonValue>;
    const verifierPolicyHash = sha256({ taskType: VERIFIER_TASK_TYPE, agentId: VERIFIER_AGENT_ID, authority: "read_only", childReceiptHash: child.receiptHash });
    const verifierRunId = `verify_${sha256(`${child.receiptHash}:${VERIFIER_TASK_TYPE}`).slice(0, 32)}`;
    let verifier = this.store.prepareVerifierReceipt({ parentRunId: context.run.runId, childReceiptId: child.receiptId, verifierRunId, verifierTaskType: VERIFIER_TASK_TYPE, verifierAgentId: VERIFIER_AGENT_ID, authority: { maximum: "read_only", grantedBy: context.run.authority.grantedBy, grantedAt: context.run.authority.grantedAt, ...(context.run.authority.expiresAt ? { expiresAt: context.run.authority.expiresAt } : {}) }, input: verifierInput, policyHash: verifierPolicyHash });
    if (!["passed", "failed", "blocked"].includes(verifier.status)) {
      const handle = this.dispatcher({ phase: "verifier", parentRunId: context.run.runId, parentNodeId: context.node.id, receiptId: verifier.verifierReceiptId, runId: verifier.verifierRunId, taskType: verifier.verifierTaskType, agentId: verifier.verifierAgentId, idempotencyKey: `graph-verifier:${verifier.verifierRunId}`, payload: verifier.input });
      if (!verifier.dispatchTaskId) verifier = this.store.bindVerifierDispatch(verifier.verifierReceiptId, handle.taskId);
      if (verifier.status === "dispatched") verifier = this.store.markVerifierRunning(verifier.verifierReceiptId);
      const completed = await handle.completion;
      verifier = this.store.completeVerifierReceipt({ verifierReceiptId: verifier.verifierReceiptId, status: completed.status === "succeeded" ? "passed" : completed.status, outcome: completed.outcome, evidence: completed.evidence, failureReason: completed.failureReason });
    }
    const chainValid = this.store.verifyChildRunReceiptChain(context.run.runId);
    if (verifier.status !== "passed" || !verifier.receiptHash || !chainValid) {
      return { outcome: verifier.status === "blocked" ? "blocked" : "failed_terminal", output: { status: verifier.status, childRunId: child.childRunId, childReceiptHash: child.receiptHash, verifierRunId: verifier.verifierRunId, verifierReceiptHash: verifier.receiptHash ?? null, chainValid }, failure: failure(chainValid ? "verification_failed" : "invariant_violation", verifier.failureReason ?? "Verifier receipt chain did not pass"), progressFingerprint: sha256({ child, verifier, chainValid }) };
    }
    const evidence = [
      { kind: "child-run-receipt", uri: `graph://${context.run.runId}/children/${child.childRunId}`, sha256: child.receiptHash, summary: `${child.childAgentId} completed governed child run ${child.childRunId}`, checker: "production.agent-child-run.v1" },
      { kind: "verifier-receipt", uri: `graph://${context.run.runId}/verifiers/${verifier.verifierRunId}`, sha256: verifier.receiptHash, summary: `${verifier.verifierAgentId} independently verified ${child.childRunId}`, checker: "production.agent-child-run.v1" },
      { kind: "child-run-audit-chain", uri: `graph://${context.run.runId}/child-run-chain`, sha256: sha256({ child: child.receiptHash, verifier: verifier.receiptHash }), summary: "Child and verifier receipts remain bound to the parent graph event chain", checker: "production.agent-child-run.v1" },
    ];
    return { outcome: "succeeded", output: { status: "verified", childRunId: child.childRunId, childReceiptHash: child.receiptHash, verifierRunId: verifier.verifierRunId, verifierReceiptHash: verifier.receiptHash, chainValid }, evidence, progressFingerprint: sha256({ childReceiptHash: child.receiptHash, verifierReceiptHash: verifier.receiptHash }) };
  }
}
