import { createHash, randomUUID } from "node:crypto";
import type { AgentRegistry } from "../agentRegistry.js";
import type { ToolGate } from "../toolGate.js";
import {
  applyProviderRateLimitEvent,
  evaluateContext,
  evaluateModelToolPolicy,
  resolveSafeSessionAlias,
  resumeProviderLimitedCheckpoint,
} from "./runtime-hardening.js";
import type {
  AutonomousWorkItem, CapabilityGap, CapabilityGapClass, ContextSnapshot,
  ControllerCheckpoint, InvocationLedgerEvent, ProviderRateLimitBridgeState, ProviderRateLimitEvent,
  RecommendedAction, RiskClass, ToolResult, WorkflowLane,
} from "./types.js";

export interface ControllerDependencies {
  toolGate: Pick<ToolGate, "preflightSkillAccess">;
  agentRegistry: Pick<AgentRegistry, "getAgent" | "listAgents">;
  executeTool: (tool: string, args: Record<string, unknown>) => Promise<ToolResult>;
  loadCheckpoint?: (key: string) => Promise<ControllerCheckpoint | null>;
  saveCheckpoint?: (key: string, value: ControllerCheckpoint) => Promise<void>;
  providerRateLimited?: () => boolean;
  providerRateLimitEvent?: () => ProviderRateLimitEvent | null;
  providerRateLimitBridge?: () => Promise<ProviderRateLimitBridgeState | null>;
  providerRateLimitCleared?: () => boolean;
  contextSnapshot?: () => ContextSnapshot | undefined;
  requestCompaction?: (checkpoint: ControllerCheckpoint) => Promise<boolean>;
  modelRuntime?: () => { model: string; parameterCountBillions?: number; local?: boolean; strongerModelAvailable?: boolean };
  sessionAlias?: () => { alias?: string; inboundSessionBound?: boolean; channel?: string };
  now?: () => Date;
  maxSteps?: number;
}

const CODING_TOOLS: Array<[RegExp, string]> = [
  [/route|endpoint/i, "coding_route_trace"], [/env(?:ironment)?\b/i, "coding_env_audit"],
  [/secret/i, "coding_secret_audit"], [/api contract/i, "coding_api_contract_audit"],
  [/migration/i, "coding_migration_review"], [/git|handoff/i, "coding_github_handoff"],
  [/deploy(?:ment)? readiness|preflight/i, "coding_deployment_preflight"],
  [/adapter root/i, "coding_validate_adapters"], [/project declaration/i, "coding_validate_project"],
  [/package health|validate pack/i, "coding_validate_pack"], [/repository orientation|repo map/i, "coding_repo_map"],
];
const SAFE_ACTIONS = new Set([
  "coding_audit", "coding_repo_map", "coding_route_trace", "coding_env_audit",
  "coding_secret_audit", "coding_api_contract_audit", "coding_migration_review",
  "coding_github_handoff", "coding_deployment_preflight", "coding_validate_project",
  "coding_validate_adapters", "coding_validate_pack", "record_evidence", "verify_readonly",
]);
const SENSITIVE = /token|secret|password|credential|authorization|api[-_]?key|chat[-_]?id|message|prompt/i;

export function classifyWorkflowLane(text: string): WorkflowLane {
  if (/deploy|release/i.test(text)) return "deployment_release";
  if (/cron|schedule|heartbeat/i.test(text)) return "scheduling_cron";
  if (/repo(?:sitory)?|code|route|endpoint|env(?:ironment)?|migration|git|adapter|package/i.test(text)) return "coding_repository";
  if (/telegram|operator/i.test(text)) return "telegram_operator";
  if (/plugin|gateway|runtime/i.test(text)) return "plugin_runtime";
  if (/memory|context/i.test(text)) return "memory";
  if (/documentation|docs?\b|knowledge/i.test(text)) return "documentation_knowledge";
  return "unknown";
}

export function classifyRisk(text: string): RiskClass {
  if (/delete|destroy|force[- ]?push|exfiltrate/i.test(text)) return "forbidden";
  if (/secret|credential|\.env|deploy|release|migration|install|restart|commit|push|merge/i.test(text)) return "approval_required";
  if (/test|validate|verify|audit|inspect|read|map|trace|status/i.test(text)) return "safe_readonly";
  return "bounded_local_change";
}

export function selectCodingTool(text: string) {
  return CODING_TOOLS.find(([pattern]) => pattern.test(text))?.[1] ?? "coding_audit";
}

export function sanitizeArguments(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [
    key,
    SENSITIVE.test(key) || typeof value === "string" && /bearer\s+|sk-[a-z0-9]|telegram:\w+:/i.test(value)
      ? "[REDACTED]" : value,
  ]));
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

export function normalizeWorkItem(
  input: { requestedOutcome: string; source?: AutonomousWorkItem["source"]; idempotencyKey?: string; taskId?: string },
  now = new Date(),
): AutonomousWorkItem {
  const lane = classifyWorkflowLane(input.requestedOutcome);
  const risk = classifyRisk(input.requestedOutcome);
  const stamp = now.toISOString();
  return {
    taskId: input.taskId ?? randomUUID(), source: input.source ?? "operator",
    requestedOutcome: input.requestedOutcome, workflowLane: lane, riskClass: risk,
    autonomyLevel: risk === "safe_readonly" ? "read_only" : risk === "bounded_local_change" ? "bounded" : "approval_gated",
    requiredEvidence: ["invocation-ledger", "structured-result"],
    approvalState: risk === "approval_required" ? "pending" : "not_required", status: "queued",
    selectedTool: lane === "coding_repository" ? selectCodingTool(input.requestedOutcome) : null,
    selectedWorker: null, nextSafeAction: null,
    idempotencyKey: input.idempotencyKey ?? hash(input.requestedOutcome), createdAt: stamp, updatedAt: stamp,
  };
}

export function recordCapabilityGap(
  checkpoint: ControllerCheckpoint, boundaryClass: CapabilityGapClass,
  capability: string, limitation: string, now: string,
): CapabilityGap {
  const gapId = hash(`${boundaryClass}:${checkpoint.item.workflowLane}:${capability}`);
  const existing = checkpoint.gaps.find((gap) => gap.gapId === gapId);
  if (existing) { existing.occurrenceCount += 1; existing.lastSeen = now; return existing; }
  const gap: CapabilityGap = {
    gapId, boundaryClass, blockedTask: checkpoint.item.taskId, missingCapability: capability,
    currentLimitation: limitation, workflowLane: checkpoint.item.workflowLane,
    riskLevel: checkpoint.item.riskClass, occurrenceCount: 1, firstSeen: now, lastSeen: now,
    evidenceReferences: [], proposedCapabilityType: boundaryClass === "missing_specialist_worker" ? "worker" : "plugin",
    suggestedImplementation: `Provide an approved ${capability} capability without widening ToolGate authority.`,
    requiredApproval: true, validationPlan: "Run a bounded synthetic task and verify the durable invocation ledger.",
    recommendedPriority: "high",
  };
  checkpoint.gaps.push(gap);
  return gap;
}

export function shouldContinue(action: RecommendedAction | null | undefined, checkpoint: ControllerCheckpoint, maxSteps: number) {
  if (!action) return { allowed: false, reason: "no_recommended_action" };
  if (action.requiresApproval || !action.readOnly) return { allowed: false, reason: "approval_required" };
  if (!SAFE_ACTIONS.has(action.action)) return { allowed: false, reason: "not_allowlisted" };
  if (checkpoint.stepCount >= maxSteps) return { allowed: false, reason: "step_budget_exhausted" };
  if (checkpoint.completedActions.includes(action.action)) return { allowed: false, reason: "duplicate_action" };
  return { allowed: true, reason: "safe_allowlisted" };
}

export async function runAutonomousController(
  input: { requestedOutcome: string; source?: AutonomousWorkItem["source"]; idempotencyKey?: string; projectRoot?: string },
  deps: ControllerDependencies,
): Promise<ControllerCheckpoint> {
  const now = deps.now ?? (() => new Date());
  const maxSteps = deps.maxSteps ?? 4;
  let checkpoint = input.idempotencyKey && deps.loadCheckpoint ? await deps.loadCheckpoint(input.idempotencyKey) : null;
  if (!checkpoint) checkpoint = { item: normalizeWorkItem(input, now()), stepCount: 0, completedActions: [], repeatedFailures: 0, events: [], gaps: [] };
  const persist = async () => deps.saveCheckpoint?.(checkpoint!.item.idempotencyKey, checkpoint!);

  const bridge = await deps.providerRateLimitBridge?.();
  const rateEvent = bridge?.status === "blocked" ? bridge.event : deps.providerRateLimitEvent?.();
  if (rateEvent) {
    applyProviderRateLimitEvent(checkpoint, rateEvent, now());
    recordCapabilityGap(checkpoint, "provider_rate_limit", "model_provider", "Provider guard reports exhaustion.", now().toISOString());
    await persist();
    return checkpoint;
  }
  if (checkpoint.item.status === "paused_rate_limit") {
    const resumed = resumeProviderLimitedCheckpoint(checkpoint, {
      conditionCleared: bridge?.status === "resume_requested" || deps.providerRateLimitCleared?.() === true,
      restored: true,
      now: now(),
    });
    if (!resumed.resumed) return checkpoint;
    await persist();
  }
  if (["complete", "awaiting_approval", "blocked_context_invalid"].includes(checkpoint.item.status)) return checkpoint;
  if (deps.providerRateLimited?.()) {
    checkpoint.item.status = "paused_rate_limit";
    recordCapabilityGap(checkpoint, "provider_rate_limit", "model_provider", "Provider guard reports exhaustion.", now().toISOString());
    await persist();
    return checkpoint;
  }

  const contextSnapshot = deps.contextSnapshot?.();
  const contextDecision = evaluateContext(contextSnapshot);
  if (contextSnapshot) checkpoint.context = { decision: contextDecision, snapshot: { ...contextSnapshot } };
  if (contextDecision.status !== "proceed") {
    checkpoint.item.status = contextDecision.status;
    checkpoint.item.updatedAt = now().toISOString();
    await persist();
    if (contextDecision.status === "checkpoint_compact" && deps.requestCompaction) {
      const compacted = await deps.requestCompaction(checkpoint);
      if (compacted) { checkpoint.item.status = "queued"; checkpoint.item.updatedAt = now().toISOString(); await persist(); }
    }
    if (checkpoint.item.status !== "queued") return checkpoint;
  }

  const aliasInput = deps.sessionAlias?.();
  if (aliasInput) checkpoint.sessionAlias = resolveSafeSessionAlias(aliasInput);
  if (checkpoint.item.riskClass === "forbidden") {
    checkpoint.item.status = "blocked";
    recordCapabilityGap(checkpoint, "forbidden_action", "policy", "Requested action is forbidden.", now().toISOString());
    await persist(); return checkpoint;
  }
  if (checkpoint.item.riskClass === "approval_required") {
    checkpoint.item.status = "awaiting_approval";
    recordCapabilityGap(checkpoint, "approval_required", "operator_approval", "A governed mutation boundary was reached.", now().toISOString());
    await persist(); return checkpoint;
  }
  if (checkpoint.item.workflowLane !== "coding_repository") {
    checkpoint.item.status = "complete"; checkpoint.item.updatedAt = now().toISOString(); await persist(); return checkpoint;
  }

  checkpoint.item.status = "running";
  let tool = checkpoint.item.selectedTool ?? "coding_audit";
  while (tool) {
    const args = { projectRoot: input.projectRoot ?? process.cwd(), intent: checkpoint.item.requestedOutcome };
    const gate = await deps.toolGate.preflightSkillAccess("code-index-agent", tool, { ...args, taskType: "autonomous-work-cycle" });
    const runtime = deps.modelRuntime?.();
    const modelPolicy = runtime ? evaluateModelToolPolicy({ ...runtime, tool, toolGateAllowed: gate.success }) : null;
    let result: ToolResult;
    let fallbackReason: string | null = null;
    let source: InvocationLedgerEvent["source"] = "plugin";
    if (!gate.success || modelPolicy?.allowed === false) {
      fallbackReason = gate.error ?? modelPolicy?.reason ?? "ToolGate denied optional coding tool";
      result = { handled: false, status: "denied", changedState: false, safety: { readOnly: true }, summary: fallbackReason };
      recordCapabilityGap(checkpoint, modelPolicy?.escalate ? "missing_specialist_worker" : "missing_tool_or_plugin", tool, fallbackReason, now().toISOString());
    } else {
      result = await deps.executeTool(tool, args);
      if (result.status === "unavailable") {
        fallbackReason = `${tool} unavailable`; source = "core";
        recordCapabilityGap(checkpoint, "missing_tool_or_plugin", tool, fallbackReason, now().toISOString());
      }
    }
    checkpoint.stepCount += 1;
    checkpoint.completedActions.push(tool);
    checkpoint.item.nextSafeAction = result.recommendedNextAction ?? null;
    const continuation = shouldContinue(result.recommendedNextAction, checkpoint, maxSteps);
    checkpoint.events.push({
      taskId: checkpoint.item.taskId, timestamp: now().toISOString(), requestedTask: "[REDACTED_OPERATOR_INTENT]",
      workflowLane: checkpoint.item.workflowLane, riskClass: checkpoint.item.riskClass, selectedTool: tool,
      source, governedIntent: "[REDACTED_OPERATOR_INTENT]", sanitizedArguments: sanitizeArguments(args),
      resultStatus: result.status, exitCode: result.exitCode ?? null, changedState: result.changedState,
      evidenceLocation: result.evidenceLocation ?? null, fallbackReason,
      recommendedNextAction: result.recommendedNextAction ?? null,
      approvalRequired: continuation.reason === "approval_required",
      continuationDecision: continuation.reason, workerSessionId: null,
    });
    checkpoint.item.updatedAt = now().toISOString();
    await persist();
    if (result.status === "rate_limited") {
      checkpoint.item.status = "paused_rate_limit";
      recordCapabilityGap(checkpoint, "provider_rate_limit", "model_provider", result.summary ?? "Provider rate limited.", now().toISOString());
      break;
    }
    if (["failed", "denied", "unavailable"].includes(result.status)) {
      checkpoint.repeatedFailures += 1;
      checkpoint.item.status = checkpoint.repeatedFailures >= 2 ? "failed" : "blocked";
      break;
    }
    if (!continuation.allowed) {
      checkpoint.item.status = continuation.reason === "approval_required" ? "awaiting_approval" : result.handled ? "complete" : "partial";
      break;
    }
    tool = result.recommendedNextAction!.action;
  }
  await persist();
  return checkpoint;
}
