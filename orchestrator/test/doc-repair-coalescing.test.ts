import { describe, expect, it } from "vitest";
import {
  buildCoalescedDriftRepairPayload,
  buildStartupDriftRepairPayload,
  stageDriftRepairPaths,
} from "../src/doc-repair-coalescing.ts";
import { createDefaultState } from "../src/state.ts";
import type { Task } from "../src/types.ts";

function driftTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "drift-attempt-1",
    type: "drift-repair",
    payload: {
      paths: ["docs/a.md", "docs/b.md"],
      targets: ["doc-specialist"],
      idempotencyKey: "doc-drift:first",
    },
    createdAt: Date.now(),
    idempotencyKey: "doc-drift:first",
    ...overrides,
  };
}

describe("document repair coalescing", () => {
  it("stages duplicate events once while preserving independent document paths", () => {
    const state = createDefaultState();
    state.pendingDocChanges = ["docs/a.md"];

    stageDriftRepairPaths(state, driftTask());
    stageDriftRepairPaths(
      state,
      driftTask({
        id: "drift-attempt-2",
        payload: { paths: ["docs/b.md", "docs/c.md"] },
      }),
    );

    expect(state.pendingDocChanges).toEqual([
      "docs/b.md",
      "docs/c.md",
      "docs/a.md",
    ]);
  });

  it("builds a distinct deterministic successor for changes arriving during a run", () => {
    const state = createDefaultState();
    state.pendingDocChanges = ["docs/c.md"];
    const terminal = driftTask();

    const first = buildCoalescedDriftRepairPayload(state, terminal);
    const second = buildCoalescedDriftRepairPayload(state, terminal);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      requestedBy: "coalesced-doc-drift-follow-up",
      paths: ["docs/c.md"],
      targets: ["doc-specialist"],
      __coalescedFromTaskId: "drift-attempt-1",
    });
    expect(first?.idempotencyKey).not.toBe(terminal.idempotencyKey);
  });

  it("does not create a successor when no document changes remain", () => {
    const state = createDefaultState();
    expect(buildCoalescedDriftRepairPayload(state, driftTask())).toBeNull();
  });

  it("does not restage a terminal duplicate event", () => {
    const state = createDefaultState();
    state.taskExecutions.push({
      taskId: "drift-attempt-1",
      idempotencyKey: "doc-drift:first",
      type: "drift-repair",
      status: "failed",
      attempt: 3,
      maxRetries: 2,
      startedAt: "2026-08-11T17:04:00.000Z",
      completedAt: "2026-08-11T17:05:00.000Z",
      lastHandledAt: "2026-08-11T17:05:00.000Z",
      lastError: "knowledge pack verification failed",
      queueAttempts: [],
    });

    expect(stageDriftRepairPaths(state, driftTask())).toEqual([]);
    expect(state.pendingDocChanges).toEqual([]);
  });

  it("creates a restart-safe repair identity for persisted pending paths", () => {
    const state = createDefaultState();
    state.pendingDocChanges = ["docs/recovered.md"];

    const first = buildStartupDriftRepairPayload(state, "doc-index-version:42");
    const second = buildStartupDriftRepairPayload(state, "doc-index-version:42");
    const nextBoot = buildStartupDriftRepairPayload(state, "doc-index-version:43");

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      requestedBy: "startup-doc-drift-recovery",
      paths: ["docs/recovered.md"],
    });
    expect(nextBoot?.idempotencyKey).not.toBe(first?.idempotencyKey);
  });
});
