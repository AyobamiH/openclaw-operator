import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultState, loadState, saveState } from "../src/state.js";
import {
  buildBusinessValueOperationalView,
  computeBusinessValueChangeFingerprint,
  ensureBusinessValueSchedulerState,
  evaluateBusinessValueTrigger,
  markBusinessValueCycleEnqueued,
  loadBusinessValueSchedulerState,
  reconcileBusinessValueOperations,
  recordBusinessValueCycleOutcome,
  saveBusinessValueSchedulerState,
  setBusinessValueSchedulerMode,
} from "../src/business/operations.js";
import type { BusinessValueCycle } from "../src/business/types.js";

function makeCycle(status: BusinessValueCycle["status"]): BusinessValueCycle {
  return {
    cycleId: `cycle-${status}`,
    triggerSource: "operator",
    triggerReason: "test",
    status,
    startedAt: "2026-07-11T08:00:00.000Z",
    completedAt: "2026-07-11T08:01:00.000Z",
    missionLoaded: true,
    registrySource: "business/registry.json",
    candidates: [],
    selectedTask: null,
    approvalGatedCandidates: [],
    unsupportedCandidates: [],
    verificationStatus: status === "failed" ? "failed" : "skipped",
    evidence: [],
    nextSafeAction: "Continue with the next safe task.",
  };
}

describe("business-value operations", () => {
  it("persists explicit disabled, paused, and enabled scheduler modes", () => {
    const state = createDefaultState();
    expect(ensureBusinessValueSchedulerState(state).mode).toBe("disabled");

    setBusinessValueSchedulerMode(state, "enabled", new Date("2026-07-11T08:00:00.000Z"));
    expect(state.businessValue?.scheduler.mode).toBe("enabled");
    expect(state.businessValue?.scheduler.nextRunAt).toBe("2026-07-11T14:00:00.000Z");

    setBusinessValueSchedulerMode(state, "paused", new Date("2026-07-11T08:05:00.000Z"));
    expect(state.businessValue?.scheduler.mode).toBe("paused");
    expect(state.businessValue?.scheduler.nextRunAt).toBeNull();
  });

  it("prevents duplicate manual triggers while a cycle task is active", () => {
    const state = createDefaultState();
    const fingerprint = computeBusinessValueChangeFingerprint(state);
    markBusinessValueCycleEnqueued({
      state,
      task: {
        id: "business-task-1",
        type: "business-value-cycle",
        payload: {},
        createdAt: Date.parse("2026-07-11T08:00:00.000Z"),
      },
      source: "operator",
      reason: "operator-trigger",
      fingerprint,
      now: new Date("2026-07-11T08:00:00.000Z"),
    });

    const decision = evaluateBusinessValueTrigger({
      state,
      source: "operator",
      now: new Date("2026-07-11T08:00:01.000Z"),
    });
    expect(decision).toMatchObject({ allowed: false, code: "active" });
  });

  it("skips automatic cycles when relevant state has not changed", () => {
    const state = createDefaultState();
    const scheduler = setBusinessValueSchedulerMode(
      state,
      "enabled",
      new Date("2026-07-11T01:00:00.000Z"),
    );
    scheduler.nextRunAt = "2026-07-11T07:00:00.000Z";
    scheduler.lastChangeFingerprint = computeBusinessValueChangeFingerprint(state);

    const decision = evaluateBusinessValueTrigger({
      state,
      source: "scheduler",
      now: new Date("2026-07-11T08:00:00.000Z"),
    });
    expect(decision).toMatchObject({ allowed: false, code: "unchanged" });
  });

  it("clears a stale lock only when no live cycle execution remains", () => {
    const state = createDefaultState();
    const scheduler = ensureBusinessValueSchedulerState(state);
    scheduler.activeTaskId = "stale-task";
    scheduler.activeTaskEnqueuedAt = "2026-07-11T06:00:00.000Z";
    state.businessValue!.activeCycleId = "stale-cycle";

    const recovered = reconcileBusinessValueOperations(
      state,
      new Date("2026-07-11T08:00:00.000Z"),
    );
    expect(recovered).toEqual({ changed: true, staleLockCleared: true });
    expect(scheduler.activeTaskId).toBeNull();
    expect(state.businessValue?.activeCycleId).toBeNull();
  });

  it("backs off failed cycles and resets after a successful cycle", () => {
    const state = createDefaultState();
    setBusinessValueSchedulerMode(state, "enabled", new Date("2026-07-11T07:00:00.000Z"));
    recordBusinessValueCycleOutcome(
      state,
      makeCycle("failed"),
      new Date("2026-07-11T08:00:00.000Z"),
    );
    expect(state.businessValue?.scheduler.consecutiveFailures).toBe(1);
    expect(state.businessValue?.scheduler.backoffUntil).toBe("2026-07-11T08:15:00.000Z");

    recordBusinessValueCycleOutcome(
      state,
      makeCycle("completed"),
      new Date("2026-07-11T09:00:00.000Z"),
    );
    expect(state.businessValue?.scheduler.consecutiveFailures).toBe(0);
    expect(state.businessValue?.scheduler.backoffUntil).toBeNull();
    expect(state.businessValue?.scheduler.nextRunAt).toBe("2026-07-11T15:00:00.000Z");
  });

  it("reports unknown worker and model truthfully in an empty operational view", () => {
    const state = createDefaultState();
    const view = buildBusinessValueOperationalView(state);
    expect(view.loopStatus).toBe("stopped");
    expect(view.activeWorker).toBeNull();
    expect(view.activeModel).toBeNull();
    expect(view.verificationStatus).toBe("not-verified");
  });

  it("recovers persisted scheduler state and safely reconciles a stale restart lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "business-operations-"));
    const statePath = join(root, "state.json");
    try {
      const state = createDefaultState();
      const scheduler = setBusinessValueSchedulerMode(
        state,
        "enabled",
        new Date("2026-07-11T01:00:00.000Z"),
      );
      scheduler.activeTaskId = "interrupted-task";
      scheduler.activeTaskEnqueuedAt = "2026-07-11T01:00:00.000Z";
      state.businessValue!.activeCycleId = "interrupted-cycle";
      await saveState(statePath, state);

      const recovered = await loadState(statePath);
      expect(recovered.businessValue?.scheduler.mode).toBe("enabled");
      const result = reconcileBusinessValueOperations(
        recovered,
        new Date("2026-07-11T08:00:00.000Z"),
      );
      expect(result.staleLockCleared).toBe(true);
      expect(recovered.businessValue?.scheduler.activeTaskId).toBeNull();
      expect(recovered.businessValue?.activeCycleId).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serializes concurrent scheduler-state writes without losing the latest update", async () => {
    const root = await mkdtemp(join(tmpdir(), "business-scheduler-writes-"));
    const schedulerPath = join(root, "business-value-operations.json");
    try {
      const first = ensureBusinessValueSchedulerState(createDefaultState());
      first.mode = "enabled";
      const second = ensureBusinessValueSchedulerState(createDefaultState());
      second.mode = "disabled";

      await Promise.all([
        saveBusinessValueSchedulerState(schedulerPath, first),
        saveBusinessValueSchedulerState(schedulerPath, second),
      ]);

      expect((await loadBusinessValueSchedulerState(schedulerPath))?.mode).toBe("disabled");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("clears a fresh orphaned lock during authoritative startup reconciliation", () => {
    const state = createDefaultState();
    const scheduler = ensureBusinessValueSchedulerState(state);
    scheduler.activeTaskId = "fresh-orphan";
    scheduler.activeTaskEnqueuedAt = "2026-07-11T07:59:00.000Z";
    state.businessValue!.activeCycleId = "fresh-orphan-cycle";

    const result = reconcileBusinessValueOperations(
      state,
      new Date("2026-07-11T08:00:00.000Z"),
      { clearOrphanedLocks: true },
    );
    expect(result.staleLockCleared).toBe(true);
    expect(scheduler.activeTaskId).toBeNull();
  });
});
