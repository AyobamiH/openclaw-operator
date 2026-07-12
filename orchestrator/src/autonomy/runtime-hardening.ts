import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  ApprovedIntakeRecord,
  ContextDecision,
  ContextSnapshot,
  ControllerCheckpoint,
  ModelToolDecision,
  ProviderRateLimitEvent,
  ProviderRateLimitBridgeState,
  SafeSessionAlias,
} from "./types.js";

const APPROVED_SOURCES = new Set([
  "operator", "queue", "paused_task", "standing_order", "workboard",
  "schedule", "capability_gap",
]);
const SOURCE_PRIORITY: Record<ApprovedIntakeRecord["source"], number> = {
  operator: 1, queue: 2, paused_task: 3, standing_order: 4,
  workboard: 4, schedule: 5, capability_gap: 6,
};
const UNSAFE_SMALL_MODEL_TOOLS = new Set([
  "exec", "process", "code_execution", "browser", "web_search", "web_fetch",
  "write", "edit", "apply_patch", "gateway", "cron", "deployment", "migration",
]);
const STRUCTURED_READ_ONLY_TOOLS = new Set([
  "coding_audit", "coding_repo_map", "coding_route_trace", "coding_env_audit",
  "coding_secret_audit", "coding_api_contract_audit", "coding_migration_review",
  "coding_github_handoff", "coding_deployment_preflight", "coding_validate_project",
  "coding_validate_adapters", "coding_validate_pack",
]);

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

export function normalizeApprovedIntake(
  records: ApprovedIntakeRecord[],
  options: { now?: Date; maxBatch?: number; staleAfterMs?: number } = {},
) {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? 7 * 24 * 60 * 60 * 1000;
  const maxBatch = Math.max(1, Math.min(options.maxBatch ?? 20, 100));
  const seen = new Set<string>();
  const ignored: Array<{ source: string; reason: string }> = [];
  const accepted = records
    .filter((record) => {
      if (!APPROVED_SOURCES.has(record.source)) {
        ignored.push({ source: record.source, reason: "unapproved_source" });
        return false;
      }
      if (!record.approved) {
        ignored.push({ source: record.source, reason: "approval_missing" });
        return false;
      }
      if (now.getTime() - new Date(record.updatedAt).getTime() > staleAfterMs) {
        ignored.push({ source: record.source, reason: "stale" });
        return false;
      }
      const key = record.idempotencyKey || `${record.source}:${hash(record.sourceId)}`;
      if (seen.has(key)) {
        ignored.push({ source: record.source, reason: "duplicate" });
        return false;
      }
      seen.add(key);
      record.idempotencyKey = key;
      return true;
    })
    .sort((left, right) => SOURCE_PRIORITY[left.source] - SOURCE_PRIORITY[right.source])
    .slice(0, maxBatch);
  return { accepted, ignored };
}

export function evaluateContext(snapshot?: ContextSnapshot): ContextDecision {
  if (!snapshot) return { status: "proceed", reason: "context_unreported" };
  if (!Number.isFinite(snapshot.contextWindow) || snapshot.contextWindow <= 0) {
    return { status: "blocked_context_invalid", reason: "invalid_context_window" };
  }
  if (snapshot.modelChanged && snapshot.trackedTokens > snapshot.contextWindow) {
    return { status: "blocked_context_invalid", reason: "restored_context_exceeds_selected_model" };
  }
  if (snapshot.trackedTokens > snapshot.contextWindow) {
    return { status: "blocked_context_invalid", reason: "tracked_context_exceeds_model_window" };
  }
  const reserve = Math.max(1, snapshot.reserveTokens);
  if (snapshot.trackedTokens >= snapshot.contextWindow - reserve) {
    return { status: "checkpoint_compact", reason: "context_reserve_threshold_reached" };
  }
  return { status: "proceed", reason: "context_within_limit" };
}

export function evaluateModelToolPolicy(params: {
  model: string;
  parameterCountBillions?: number;
  local?: boolean;
  tool: string;
  toolGateAllowed: boolean;
  strongerModelAvailable?: boolean;
}): ModelToolDecision {
  const small = params.local === true || (params.parameterCountBillions ?? Infinity) <= 300;
  if (!small) return { allowed: params.toolGateAllowed, reason: params.toolGateAllowed ? "toolgate_allowed" : "toolgate_denied", escalate: false };
  if (UNSAFE_SMALL_MODEL_TOOLS.has(params.tool)) {
    return { allowed: false, reason: "small_model_unsafe_tool_denied", escalate: params.strongerModelAvailable === true };
  }
  if (STRUCTURED_READ_ONLY_TOOLS.has(params.tool) && params.toolGateAllowed) {
    return { allowed: true, reason: "small_model_structured_readonly_toolgate_allowed", escalate: false };
  }
  return { allowed: false, reason: "small_model_tool_not_allowlisted", escalate: params.strongerModelAvailable === true };
}

export function applyProviderRateLimitEvent(
  checkpoint: ControllerCheckpoint,
  event: ProviderRateLimitEvent,
  now = new Date(),
) {
  const duplicate = checkpoint.rateLimit?.eventId === event.eventId;
  if (duplicate) return { checkpoint, duplicate: true };
  checkpoint.item.status = "paused_rate_limit";
  checkpoint.item.updatedAt = now.toISOString();
  checkpoint.rateLimit = {
    eventId: event.eventId,
    status: "blocked",
    resumePhrase: event.resumePhrase,
    pausedAt: event.observedAt,
    checkpointRestored: false,
  };
  return { checkpoint, duplicate: false };
}

export function resumeProviderLimitedCheckpoint(
  checkpoint: ControllerCheckpoint,
  params: { conditionCleared: boolean; restored: boolean; now?: Date },
) {
  if (!checkpoint.rateLimit || checkpoint.item.status !== "paused_rate_limit") {
    return { resumed: false, reason: "not_paused" };
  }
  if (!params.conditionCleared) return { resumed: false, reason: "provider_still_limited" };
  if (!params.restored) return { resumed: false, reason: "checkpoint_restore_failed" };
  checkpoint.rateLimit.status = "cleared";
  checkpoint.rateLimit.checkpointRestored = true;
  checkpoint.item.status = "queued";
  checkpoint.item.updatedAt = (params.now ?? new Date()).toISOString();
  return { resumed: true, reason: "checkpoint_restored" };
}

export function resolveSafeSessionAlias(input: {
  alias?: string;
  inboundSessionBound?: boolean;
  channel?: string;
}): SafeSessionAlias | null {
  if (!input.alias || !/^current(?:-operator|-task)?$/u.test(input.alias)) return null;
  if (!input.inboundSessionBound) return null;
  return { alias: input.alias, channel: input.channel ?? "current", delivery: "reply_to_current_task" };
}

export async function readProviderRateLimitBridge(path: string): Promise<ProviderRateLimitBridgeState | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    if (parsed.status !== "blocked" && parsed.status !== "resume_requested") return null;
    if (typeof parsed.eventId !== "string" || typeof parsed.observedAt !== "string" || typeof parsed.resumePhrase !== "string") return null;
    return {
      status: parsed.status,
      event: {
        eventId: parsed.eventId,
        observedAt: parsed.observedAt,
        resumePhrase: parsed.resumePhrase,
        providerClass: typeof parsed.providerClass === "string" ? parsed.providerClass : undefined,
        safeNonModelWorkAllowed: true,
      },
    };
  } catch {
    return null;
  }
}
