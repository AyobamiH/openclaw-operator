import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAutonomousController } from "../src/autonomy/controller.js";
import {
  applyProviderRateLimitEvent, evaluateContext, evaluateModelToolPolicy,
  normalizeApprovedIntake, resolveSafeSessionAlias, resumeProviderLimitedCheckpoint,
  readProviderRateLimitBridge,
} from "../src/autonomy/runtime-hardening.js";
import type { ApprovedIntakeRecord, ControllerCheckpoint, ToolResult } from "../src/autonomy/types.js";

const success: ToolResult = { handled: true, status: "success", changedState: false, safety: { readOnly: true }, evidenceLocation: "/tmp/evidence.json" };
function deps() {
  return {
    toolGate: { preflightSkillAccess: vi.fn(async () => ({ success: true })) },
    agentRegistry: { getAgent: vi.fn(), listAgents: vi.fn(() => []) },
    executeTool: vi.fn(async () => success),
  };
}
function checkpoint(): ControllerCheckpoint {
  return {
    item: {
      taskId: "task-1", source: "operator", requestedOutcome: "Audit repository",
      workflowLane: "coding_repository", riskClass: "safe_readonly", autonomyLevel: "read_only",
      requiredEvidence: [], approvalState: "not_required", status: "running",
      selectedTool: "coding_audit", selectedWorker: null, nextSafeAction: null,
      idempotencyKey: "stable", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    },
    stepCount: 1, completedActions: ["coding_audit"], repeatedFailures: 0, events: [], gaps: [],
  };
}

describe("provider-rate-limit bridge", () => {
  it("creates one durable pause for duplicate events", () => {
    const c = checkpoint();
    const event = { eventId: "rate-1", observedAt: "2026-01-01T00:01:00Z", resumePhrase: "RESUME CODING WORKFLOW", safeNonModelWorkAllowed: true as const };
    expect(applyProviderRateLimitEvent(c, event).duplicate).toBe(false);
    expect(applyProviderRateLimitEvent(c, event).duplicate).toBe(true);
    expect(c.item.status).toBe("paused_rate_limit");
  });
  it("resumes only after clear and checkpoint restoration without replay", () => {
    const c = checkpoint();
    applyProviderRateLimitEvent(c, { eventId: "rate-1", observedAt: "2026-01-01T00:01:00Z", resumePhrase: "RESUME", safeNonModelWorkAllowed: true });
    expect(resumeProviderLimitedCheckpoint(c, { conditionCleared: false, restored: true }).resumed).toBe(false);
    expect(resumeProviderLimitedCheckpoint(c, { conditionCleared: true, restored: true }).resumed).toBe(true);
    expect(c.completedActions).toEqual(["coding_audit"]);
  });
  it("controller records one pause checkpoint and no tool call", async () => {
    const d = deps(); const saves: ControllerCheckpoint[] = [];
    const out = await runAutonomousController({ requestedOutcome: "Audit repository", idempotencyKey: "rate" }, {
      ...d,
      providerRateLimitEvent: () => ({ eventId: "rate-1", observedAt: "2026-01-01T00:01:00Z", resumePhrase: "RESUME", safeNonModelWorkAllowed: true }),
      saveCheckpoint: async (_key, value) => { saves.push(structuredClone(value)); },
    });
    expect(out.item.status).toBe("paused_rate_limit"); expect(saves).toHaveLength(1); expect(d.executeTool).not.toHaveBeenCalled();
  });
  it("reads only the sanitized provider bridge contract", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rate-bridge-"));
    const path = join(dir, "controller-event.json");
    await writeFile(path, JSON.stringify({ status: "blocked", eventId: "rate-1", observedAt: "2026-01-01T00:00:00Z", resumePhrase: "RESUME", providerClass: "hosted", sessionKey: "must-not-propagate", token: "must-not-propagate" }));
    const bridge = await readProviderRateLimitBridge(path);
    expect(bridge).toEqual({ status: "blocked", event: { eventId: "rate-1", observedAt: "2026-01-01T00:00:00Z", resumePhrase: "RESUME", providerClass: "hosted", safeNonModelWorkAllowed: true } });
    expect(JSON.stringify(bridge)).not.toContain("sessionKey"); expect(JSON.stringify(bridge)).not.toContain("token");
  });
});

describe("approved intake", () => {
  const now = new Date("2026-01-02T00:00:00Z");
  const sources: ApprovedIntakeRecord["source"][] = ["operator", "queue", "paused_task", "standing_order", "workboard", "schedule", "capability_gap"];
  it("normalizes every approved source in priority order", () => {
    const records = sources.map((source, index) => ({ source, sourceId: `${index}`, requestedOutcome: "Audit repository", updatedAt: "2026-01-01T00:00:00Z", approved: true }));
    const out = normalizeApprovedIntake(records, { now });
    expect(out.accepted).toHaveLength(7); expect(out.accepted[0].source).toBe("operator"); expect(out.accepted.at(-1)?.source).toBe("capability_gap");
  });
  it("suppresses duplicates, stale, unapproved, and unknown sources", () => {
    const base = { source: "queue" as const, sourceId: "same", requestedOutcome: "Audit", updatedAt: "2026-01-01T00:00:00Z", approved: true, idempotencyKey: "same" };
    const out = normalizeApprovedIntake([base, { ...base }, { ...base, idempotencyKey: "stale", updatedAt: "2020-01-01T00:00:00Z" }, { ...base, idempotencyKey: "no", approved: false }, { ...base, source: "unknown" as never, idempotencyKey: "unknown" }], { now });
    expect(out.accepted).toHaveLength(1); expect(out.ignored.map((entry) => entry.reason)).toEqual(expect.arrayContaining(["duplicate", "stale", "approval_missing", "unapproved_source"]));
  });
  it("enforces a bounded batch", () => {
    const records = Array.from({ length: 50 }, (_, index) => ({ source: "queue" as const, sourceId: `${index}`, requestedOutcome: "Audit", updatedAt: "2026-01-01T00:00:00Z", approved: true }));
    expect(normalizeApprovedIntake(records, { now, maxBatch: 5 }).accepted).toHaveLength(5);
  });
});

describe("routing precedence", () => {
  it("treats openclaw-operator repository requests as coding work", async () => {
    const out = await runAutonomousController({ requestedOutcome: "Audit the openclaw-operator repository" }, deps());
    expect(out.item.workflowLane).toBe("coding_repository");
    expect(out.item.selectedTool).toBe("coding_audit");
  });
});

describe("context compatibility", () => {
  it("allows normal context and checkpoints at reserve threshold", () => {
    expect(evaluateContext({ model: "gpt", contextWindow: 100_000, trackedTokens: 20_000, reserveTokens: 20_000 }).status).toBe("proceed");
    expect(evaluateContext({ model: "gpt", contextWindow: 100_000, trackedTokens: 80_000, reserveTokens: 20_000 }).status).toBe("checkpoint_compact");
  });
  it("blocks impossible restored 189k/4.1k state", () => {
    expect(evaluateContext({ model: "qwen", contextWindow: 4_096, trackedTokens: 189_000, reserveTokens: 1_000, modelChanged: true })).toEqual({ status: "blocked_context_invalid", reason: "restored_context_exceeds_selected_model" });
  });
  it("checkpoints before compaction and resumes safely", async () => {
    const saved: string[] = []; const d = deps();
    const out = await runAutonomousController({ requestedOutcome: "Audit repository" }, {
      ...d,
      contextSnapshot: () => ({ model: "gpt", contextWindow: 100_000, trackedTokens: 85_000, reserveTokens: 20_000 }),
      saveCheckpoint: async (_key, value) => { saved.push(value.item.status); },
      requestCompaction: async () => true,
    });
    expect(saved.slice(0, 2)).toEqual(["checkpoint_compact", "queued"]); expect(out.item.status).toBe("complete");
  });
});

describe("small-model tool safety", () => {
  it("denies web/exec and offers stronger-model escalation", () => {
    expect(evaluateModelToolPolicy({ model: "qwen", local: true, tool: "exec", toolGateAllowed: true, strongerModelAvailable: true })).toEqual({ allowed: false, reason: "small_model_unsafe_tool_denied", escalate: true });
    expect(evaluateModelToolPolicy({ model: "qwen", local: true, tool: "web_fetch", toolGateAllowed: true })).toMatchObject({ allowed: false });
  });
  it("preserves ToolGate-governed structured reads and normal-model routing", () => {
    expect(evaluateModelToolPolicy({ model: "qwen", local: true, tool: "coding_audit", toolGateAllowed: true }).allowed).toBe(true);
    expect(evaluateModelToolPolicy({ model: "gpt", local: false, tool: "coding_audit", toolGateAllowed: true }).allowed).toBe(true);
  });
});

describe("safe Telegram alias", () => {
  it("uses only a bound opaque current-session alias", () => {
    expect(resolveSafeSessionAlias({ alias: "current-operator", inboundSessionBound: true, channel: "telegram" })).toEqual({ alias: "current-operator", channel: "telegram", delivery: "reply_to_current_task" });
    expect(resolveSafeSessionAlias({ alias: "telegram:private:123", inboundSessionBound: true })).toBeNull();
    expect(resolveSafeSessionAlias({ alias: "current-operator", inboundSessionBound: false })).toBeNull();
  });
  it("does not log operator text or raw session identifiers", async () => {
    const out = await runAutonomousController({ requestedOutcome: "Audit repository" }, { ...deps(), sessionAlias: () => ({ alias: "current-task", inboundSessionBound: true, channel: "telegram" }) });
    expect(out.events[0].requestedTask).toBe("[REDACTED_OPERATOR_INTENT]");
    expect(JSON.stringify(out)).not.toContain("telegram:private:");
  });
});
