import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGraphRuntime, type GraphRuntime } from "../src/graph/runtime.js";
import { findEquivalentLiveGraphRun, type GraphSingleFlightKey } from "../src/graph/single-flight.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const monitorKey: GraphSingleFlightKey = {
  graphId: "governed-task-execution",
  graphVersion: "1.0.0",
  lane: "git-monitor",
  taskType: "github-workflow-monitor",
  agentId: "operations-analyst-agent",
};

async function runtimeFixture(): Promise<{ runtime: GraphRuntime; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "openclaw-graph-single-flight-"));
  const runtime = createGraphRuntime(join(root, "graph.sqlite"));
  cleanups.push(async () => {
    runtime.store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { runtime, root };
}

function createRunningMonitor(
  runtime: GraphRuntime,
  args: { ingressId: string; leaseExpiresAt: string; lane?: string; taskType?: string },
) {
  const created = runtime.engine.start({
    graphId: "governed-task-execution",
    version: "1.0.0",
    objective: "Monitor GitHub workflow state",
    correlationId: args.ingressId,
    input: {
      lane: args.lane ?? monitorKey.lane,
      taskType: args.taskType ?? monitorKey.taskType,
      agentId: monitorKey.agentId,
      payload: { reason: "scheduled-poll" },
      ingressId: args.ingressId,
      shadowMode: false,
    },
    authority: { maximum: "local_persistent", grantedBy: "test" },
  });
  const running = runtime.store.saveRun(
    { ...created, status: "running", updatedAt: new Date().toISOString() },
    created.revision,
    [{ type: "graph_started", payload: {} }],
  );
  runtime.store.createAttempt({
    attemptId: `attempt:${args.ingressId}`,
    runId: running.runId,
    nodeId: running.currentNodeId!,
    attemptNumber: 1,
    idempotencyKey: `attempt-key:${args.ingressId}`,
    owner: "graph-worker",
    leaseExpiresAt: args.leaseExpiresAt,
    startedAt: new Date().toISOString(),
  });
  return running;
}

describe("Graph-owned GitHub monitor single-flight selection", () => {
  it("coalesces overlapping ticks onto one genuinely live equivalent run", async () => {
    const { runtime } = await runtimeFixture();
    const now = new Date("2026-08-09T17:00:00.000Z");
    const running = createRunningMonitor(runtime, {
      ingressId: "github-workflow-monitor:tick-a",
      leaseExpiresAt: new Date(now.getTime() + 20 * 60_000).toISOString(),
    });

    expect(findEquivalentLiveGraphRun(runtime.store, monitorKey, now)?.runId).toBe(running.runId);
    expect(findEquivalentLiveGraphRun(runtime.store, monitorKey, new Date(now.getTime() + 5 * 60_000))?.runId).toBe(running.runId);
    expect(runtime.store.listRuns({ graphId: monitorKey.graphId, limit: 250 })).toHaveLength(1);
  });

  it("does not coalesce an expired process-death attempt after restart", async () => {
    const { runtime, root } = await runtimeFixture();
    const now = new Date("2026-08-09T17:00:00.000Z");
    createRunningMonitor(runtime, {
      ingressId: "github-workflow-monitor:dead-process",
      leaseExpiresAt: new Date(now.getTime() + 1_000).toISOString(),
    });
    runtime.store.close();
    cleanups.pop();

    const restarted = createGraphRuntime(join(root, "graph.sqlite"));
    cleanups.push(async () => {
      restarted.store.close();
      await rm(root, { recursive: true, force: true });
    });
    const afterLease = new Date(now.getTime() + 2_000);
    expect(findEquivalentLiveGraphRun(restarted.store, monitorKey, afterLease)).toBeNull();
    expect(restarted.store.activeRunCount(monitorKey.graphId, monitorKey.graphVersion, afterLease)).toBe(0);
    expect(() => restarted.engine.start({
      graphId: monitorKey.graphId,
      version: monitorKey.graphVersion,
      objective: "Next GitHub monitor tick after process death",
      correlationId: "github-workflow-monitor:restart",
      input: { ...monitorKey, ingressId: "github-workflow-monitor:restart", payload: {}, shadowMode: false },
      authority: { maximum: "local_persistent", grantedBy: "test-restart" },
    })).not.toThrow();
  });

  it("allows the next tick after a failed attempt", async () => {
    const { runtime } = await runtimeFixture();
    const now = new Date("2026-08-09T17:00:00.000Z");
    const running = createRunningMonitor(runtime, {
      ingressId: "github-workflow-monitor:failed",
      leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
    });
    runtime.store.finishAttempt(`attempt:github-workflow-monitor:failed`, "failed", "monitor_failed", {}, { message: "fixture failure" });
    runtime.store.saveRun(
      { ...running, status: "failed", currentNodeId: null, terminalOutcome: "monitor_failed", updatedAt: now.toISOString() },
      running.revision,
      [{ type: "graph_failed", payload: { reason: "fixture failure" } }],
    );

    expect(findEquivalentLiveGraphRun(runtime.store, monitorKey, now)).toBeNull();
    expect(() => runtime.engine.start({
      graphId: monitorKey.graphId,
      version: monitorKey.graphVersion,
      objective: "Next GitHub monitor tick after failure",
      correlationId: "github-workflow-monitor:next",
      input: { ...monitorKey, ingressId: "github-workflow-monitor:next", payload: {}, shadowMode: false },
      authority: { maximum: "local_persistent", grantedBy: "test-next" },
    })).not.toThrow();
  });

  it("does not coalesce other governed-task workflows", async () => {
    const { runtime } = await runtimeFixture();
    const now = new Date("2026-08-09T17:00:00.000Z");
    createRunningMonitor(runtime, {
      ingressId: "system-monitor:tick",
      lane: "system-monitor",
      taskType: "system-monitor",
      leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
    });

    expect(findEquivalentLiveGraphRun(runtime.store, monitorKey, now)).toBeNull();
  });
});
