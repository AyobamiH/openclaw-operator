import { describe, expect, it, vi } from "vitest";
import { classifyWorkflowLane, normalizeWorkItem, recordCapabilityGap, runAutonomousController, sanitizeArguments, selectCodingTool, shouldContinue } from "../src/autonomy/controller.js";
import type { ControllerCheckpoint, ToolResult } from "../src/autonomy/types.js";

const success = (next: ToolResult["recommendedNextAction"] = null): ToolResult => ({ handled: true, status: "success", changedState: false, safety: { readOnly: true }, evidenceLocation: "/tmp/evidence.json", recommendedNextAction: next });
function deps(results: ToolResult[] = [success()]) {
  const executeTool = vi.fn(async () => results.shift() ?? success());
  return { toolGate: { preflightSkillAccess: vi.fn(async () => ({ success: true })) }, agentRegistry: { getAgent: vi.fn(), listAgents: vi.fn(() => []) }, executeTool };
}

describe("Autonomous Work Controller v1", () => {
  it("selects broad and narrow coding tools", () => {
    expect(selectCodingTool("Audit this repository")).toBe("coding_audit");
    expect(selectCodingTool("Trace repository routes and endpoints")).toBe("coding_route_trace");
    expect(selectCodingTool("Audit the environment surface")).toBe("coding_env_audit");
  });
  it("preserves non-coding routing", () => {
    expect(classifyWorkflowLane("Summarize documentation knowledge")).toBe("documentation_knowledge");
    expect(normalizeWorkItem({ requestedOutcome: "Summarize documentation knowledge" }).selectedTool).toBeNull();
  });
  it("records a ToolGate denial without execution", async () => {
    const d = deps(); d.toolGate.preflightSkillAccess.mockResolvedValue({ success: false, error: "denied" });
    const out = await runAutonomousController({ requestedOutcome: "Audit this repository" }, d);
    expect(d.executeTool).not.toHaveBeenCalled(); expect(out.item.status).toBe("blocked"); expect(out.gaps[0].boundaryClass).toBe("missing_tool_or_plugin");
  });
  it("records missing plugin fallback and reason", async () => {
    const out = await runAutonomousController({ requestedOutcome: "Audit this repository" }, deps([{ ...success(), handled: false, status: "unavailable" }]));
    expect(out.events[0].source).toBe("core"); expect(out.events[0].fallbackReason).toContain("unavailable");
  });
  it("continues one safe allowlisted next action", async () => {
    const d = deps([success({ action: "coding_repo_map", requiresApproval: false, readOnly: true }), success()]);
    const out = await runAutonomousController({ requestedOutcome: "Audit this repository" }, d);
    expect(out.completedActions).toEqual(["coding_audit", "coding_repo_map"]); expect(out.item.status).toBe("complete");
  });
  it("stops once at approval-required next action", async () => {
    const out = await runAutonomousController({ requestedOutcome: "Audit this repository" }, deps([success({ action: "commit", requiresApproval: true, readOnly: false })]));
    expect(out.item.status).toBe("awaiting_approval"); expect(out.events).toHaveLength(1);
  });
  it("blocks duplicate actions and runaway step budgets", () => {
    const c = { item: normalizeWorkItem({ requestedOutcome: "Audit repository" }), stepCount: 1, completedActions: ["coding_audit"], repeatedFailures: 0, events: [], gaps: [] } satisfies ControllerCheckpoint;
    expect(shouldContinue({ action: "coding_audit", requiresApproval: false, readOnly: true }, c, 4).reason).toBe("duplicate_action");
    expect(shouldContinue({ action: "coding_repo_map", requiresApproval: false, readOnly: true }, { ...c, stepCount: 4 }, 4).reason).toBe("step_budget_exhausted");
  });
  it("pauses, checkpoints, and resumes idempotently after rate limit", async () => {
    const saved = new Map<string, ControllerCheckpoint>();
    const d = { ...deps(), providerRateLimited: () => true, saveCheckpoint: async (k:string,v:ControllerCheckpoint) => { saved.set(k, structuredClone(v)); } };
    const paused = await runAutonomousController({ requestedOutcome: "Audit this repository", idempotencyKey: "rate" }, d);
    expect(paused.item.status).toBe("paused_rate_limit"); expect(saved.get("rate")?.gaps[0].boundaryClass).toBe("provider_rate_limit");
    const resumed = structuredClone(paused); resumed.item.status = "queued";
    const live = { ...deps(), loadCheckpoint: async () => resumed, saveCheckpoint: async () => undefined };
    expect((await runAutonomousController({ requestedOutcome: "Audit this repository", idempotencyKey: "rate" }, live)).stepCount).toBe(1);
  });
  it("deduplicates capability gaps and increments occurrenceCount", () => {
    const c = { item: normalizeWorkItem({ requestedOutcome: "Audit repository" }), stepCount: 0, completedActions: [], repeatedFailures: 0, events: [], gaps: [] } satisfies ControllerCheckpoint;
    recordCapabilityGap(c, "missing_specialist_worker", "codex-worker", "missing", "2026-01-01T00:00:00Z");
    recordCapabilityGap(c, "missing_specialist_worker", "codex-worker", "missing", "2026-01-02T00:00:00Z");
    expect(c.gaps).toHaveLength(1); expect(c.gaps[0].occurrenceCount).toBe(2);
  });
  it("automatically records invocation evidence", async () => {
    const out = await runAutonomousController({ requestedOutcome: "Audit this repository" }, deps());
    expect(out.events[0]).toMatchObject({ selectedTool: "coding_audit", resultStatus: "success", changedState: false, evidenceLocation: "/tmp/evidence.json" });
  });
  it("sanitizes sensitive-looking arguments", () => {
    expect(sanitizeArguments({ token: "abc", note: "Bearer abc", safe: "ok" })).toEqual({ token: "[REDACTED]", note: "[REDACTED]", safe: "ok" });
  });
  it("fails closed for forbidden work and preserves mutation approvals", async () => {
    expect((await runAutonomousController({ requestedOutcome: "Delete repository" }, deps())).item.status).toBe("blocked");
    expect((await runAutonomousController({ requestedOutcome: "Commit and push repository change" }, deps())).item.status).toBe("awaiting_approval");
  });
});
