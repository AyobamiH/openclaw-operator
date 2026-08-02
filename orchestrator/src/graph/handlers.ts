import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, sep } from "node:path";
import type { NodeExecutionContext, NodeExecutionResult, NodeExecutor } from "./types.js";
import { failure } from "./failures.js";
import { sha256 } from "./reducer.js";
import { NodeExecutorRegistry } from "./engine.js";

const execFileAsync = promisify(execFile);

export type LegacyTaskHandler = (context: NodeExecutionContext) => Promise<NodeExecutionResult>;

export class LegacyTaskAdapterRegistry {
  private readonly tasks = new Map<string, LegacyTaskHandler>();

  register(taskId: string, handler: LegacyTaskHandler): void {
    if (!/^[a-z][a-z0-9._-]{1,119}$/.test(taskId)) throw new Error(`invalid_legacy_task_id:${taskId}`);
    if (this.tasks.has(taskId)) throw new Error(`legacy_task_already_registered:${taskId}`);
    this.tasks.set(taskId, handler);
  }

  executor(): NodeExecutor {
    return async (context) => {
      const taskId = context.run.input.legacyTaskId;
      if (typeof taskId !== "string") {
        return { outcome: "failed_terminal", output: {}, failure: failure("validation_error", "legacyTaskId is required") };
      }
      const handler = this.tasks.get(taskId);
      if (!handler) {
        return { outcome: "failed_terminal", output: {}, failure: failure("tool_unavailable", `Legacy task is not allowlisted: ${taskId}`) };
      }
      return handler(context);
    };
  }
}

function evidenceResult(context: NodeExecutionContext): NodeExecutionResult {
  const kinds = context.node.evidenceEmitted.length > 0 ? context.node.evidenceEmitted : ["structured-node-output"];
  const summary = `${context.node.id} completed under graph ${context.definition.graphId}@${context.definition.version}`;
  return {
    outcome: "succeeded",
    output: { nodeId: context.node.id, verified: true },
    evidence: kinds.map((kind) => ({ kind, uri: `graph://${context.run.runId}/${context.node.id}`, summary, checker: context.node.handler })),
    progressFingerprint: sha256({ nodeId: context.node.id, input: context.run.input, data: context.run.data }),
  };
}

function planHandler(context: NodeExecutionContext): NodeExecutionResult {
  const supplied = context.run.input.plan;
  const plan = supplied && typeof supplied === "object" && !Array.isArray(supplied)
    ? supplied as Record<string, unknown>
    : {
        objective: context.run.objective,
        assumptions: [],
        constraints: ["No authority expansion", "Evidence required before completion"],
        steps: context.definition.nodes.filter((node) => node.type !== "terminal").map((node) => node.id),
        verificationPlan: context.definition.evidenceRequirements.map((item) => item.assertionId),
        requiredAuthorities: [context.definition.authorityRequirements.maximum],
        risks: [],
        rollbackPlan: ["Pause the run", "Resume from the latest safe checkpoint"],
        completionCriteria: context.definition.evidenceRequirements.map((item) => item.claim),
      };
  const requiredArrays = ["assumptions", "constraints", "steps", "verificationPlan", "requiredAuthorities", "risks", "rollbackPlan", "completionCriteria"];
  const invalid = typeof plan.objective !== "string" || requiredArrays.some((key) => !Array.isArray(plan[key]));
  if (invalid || (plan.verificationPlan as unknown[]).length === 0 || (plan.completionCriteria as unknown[]).length === 0) {
    return { outcome: "failed_repairable", output: {}, failure: failure("validation_error", "Structured plan omitted required verification or completion fields") };
  }
  return {
    outcome: "succeeded",
    output: { accepted: true },
    patches: [
      { op: "set", path: "plan", value: plan as never },
      { op: "increment", path: "planVersion", value: 1 },
    ],
    evidence: [{ kind: "plan-validation", uri: `graph://${context.run.runId}/plan`, sha256: sha256(plan), summary: "Structured plan passed deterministic validation", checker: "graph.plan" }],
    progressFingerprint: sha256(plan),
  };
}

function completionEvidenceHandler(context: NodeExecutionContext): NodeExecutionResult {
  const assertions = context.definition.evidenceRequirements.map((required) => {
    const matching = context.run.evidence.filter((item) => required.requiredEvidenceKinds.includes(item.kind));
    const observedKinds = new Set(matching.map((item) => item.kind));
    const passed = required.requiredEvidenceKinds.every((kind) => observedKinds.has(kind));
    return { assertionId: required.assertionId, claim: required.claim, method: required.method, status: passed ? "passed" as const : "failed" as const, evidenceRefs: matching.map((item) => item.evidenceId), checker: context.node.handler };
  });
  const failed = assertions.filter((assertion) => assertion.status !== "passed");
  if (failed.length > 0) {
    return { outcome: "failed_terminal", output: { assertionsPassed: assertions.length - failed.length, assertionsFailed: failed.length }, assertions, failure: failure("verification_failed", `Completion evidence missing for: ${failed.map((item) => item.assertionId).join(",")}`), progressFingerprint: sha256(assertions) };
  }
  return { outcome: "succeeded", output: { assertionsPassed: assertions.length }, assertions, progressFingerprint: sha256(assertions) };
}

function researchHandler(context: NodeExecutionContext): NodeExecutionResult {
  const sources = Array.isArray(context.run.input.sources) ? context.run.input.sources : [];
  const claims = Array.isArray(context.run.input.claims) ? context.run.input.claims : [];
  const unsupported = claims.filter((claim) => {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) return true;
    const refs = (claim as Record<string, unknown>).sourceRefs;
    return !Array.isArray(refs) || refs.length === 0 || refs.some((ref) => typeof ref !== "string" || !sources.some((source) => source && typeof source === "object" && !Array.isArray(source) && (source as Record<string, unknown>).id === ref));
  });
  if (unsupported.length > 0) {
    return { outcome: "failed_terminal", output: { unsupportedClaims: unsupported.length }, failure: failure("verification_failed", "Research claims lack source evidence"), progressFingerprint: sha256(unsupported) };
  }
  return {
    outcome: "succeeded",
    output: { sourceCount: sources.length, claimCount: claims.length, marginalInformationGain: 0 },
    patches: [{ op: "set", path: "research", value: { sources, claims, marginalInformationGain: 0 } as never }],
    evidence: [{ kind: "claim-source-ledger", uri: `graph://${context.run.runId}/research`, sha256: sha256({ sources, claims }), summary: "Claims and sources stored separately and cross-checked", checker: "graph.research" }],
    progressFingerprint: sha256({ sources, claims }),
  };
}

function socialDryRunHandler(context: NodeExecutionContext): NodeExecutionResult {
  if (context.run.input.dryRun !== true) {
    return { outcome: "blocked", output: {}, failure: failure("approval_required", "Live publication requires a separately bound external-public approval") };
  }
  const payload = context.run.input.payload ?? {};
  return {
    outcome: "succeeded",
    output: { dryRun: true, providerWrites: 0, payloadHash: sha256(payload) },
    patches: [{ op: "set", path: "publication", value: { mode: "dry_run", payloadHash: sha256(payload), providerWrites: 0 } }],
    evidence: [{ kind: "publication-dry-run", uri: `graph://${context.run.runId}/publication-dry-run`, sha256: sha256(payload), summary: "Deterministic publication path validated with zero provider writes", checker: "graph.social-dry-run" }],
    progressFingerprint: sha256(payload),
  };
}

export function createCommandEvidenceLegacyHandler(args: {
  executable: string;
  argv: string[];
  cwd: string;
  allowedRoot: string;
  evidenceKind: string;
  timeoutMs?: number;
}): LegacyTaskHandler {
  const cwd = resolve(args.cwd);
  const allowedRoot = resolve(args.allowedRoot);
  if (cwd !== allowedRoot && !cwd.startsWith(`${allowedRoot}${sep}`)) throw new Error("legacy_command_cwd_outside_allowed_root");
  return async (context): Promise<NodeExecutionResult> => {
    try {
      const result = await execFileAsync(args.executable, args.argv, { cwd, timeout: args.timeoutMs ?? context.node.timeoutMs, maxBuffer: 1024 * 1024, signal: context.signal });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(0, 100_000);
      return { outcome: "succeeded", output: { exitCode: 0, outputHash: sha256(output) }, evidence: [{ kind: args.evidenceKind, uri: `graph://${context.run.runId}/${context.node.id}/command`, sha256: sha256(output), summary: "Allowlisted legacy command completed successfully", checker: "legacy.command" }], progressFingerprint: sha256(output) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed: NodeExecutionResult = { outcome: "failed_repairable", output: {}, failure: failure("tool_contract_error", message), progressFingerprint: sha256(message) };
      return failed;
    }
  };
}

export function registerBuiltinGraphHandlers(registry: NodeExecutorRegistry, legacy: LegacyTaskAdapterRegistry): void {
  registry.register("graph.pass", async (context) => evidenceResult(context));
  registry.register("graph.plan", async (context) => planHandler(context));
  registry.register("graph.evidence-gate", async (context) => completionEvidenceHandler(context));
  registry.register("graph.research", async (context) => researchHandler(context));
  registry.register("graph.social-dry-run", async (context) => socialDryRunHandler(context));
  registry.register("graph.subgraph", async () => ({ outcome: "failed_terminal", output: {}, failure: failure("invariant_violation", "Subgraph nodes are owned by GraphExecutor") }));
  registry.register("legacy.command", legacy.executor());
  registry.register("graph.external-disabled", async () => ({
    outcome: "blocked",
    output: {},
    failure: failure("tool_unavailable", "No official external connector node is registered for this graph version"),
  }));
  registry.register("graph.terminal", async () => ({ outcome: "succeeded", output: {} }));
}
