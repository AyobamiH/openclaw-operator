import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildAgentRelationshipWindow,
  buildIncidentPriorityQueue,
  buildWorkflowBlockerSummary,
  loadRuntimeStateTarget,
  resolveOperatorStatePath,
  resolveRuntimeStateTarget,
  saveRuntimeStateTarget,
  setRuntimeStateMongoClientFactoryForTest,
  type RuntimeIncidentLedgerRecord,
  type RuntimeRelationshipObservation,
  type RuntimeWorkflowEvent,
} from "../../agents/shared/runtime-evidence.js";

describe("runtime intelligence helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setRuntimeStateMongoClientFactoryForTest(null);
  });

  it("ranks open incidents by severity, escalation, and remediation blockage", () => {
    const incidents: RuntimeIncidentLedgerRecord[] = [
      {
        incidentId: "inc-critical",
        classification: "proof-delivery",
        severity: "critical",
        status: "active",
        escalation: { level: "breached" },
        remediation: {
          nextAction: "Restart the public proof surface worker.",
          blockers: ["verification still pending"],
        },
        remediationTasks: [{ status: "failed", blockers: ["worker crashed"] }],
        recommendedSteps: ["Inspect delivery errors"],
        affectedSurfaces: ["public-proof"],
        linkedServiceIds: ["service:public-proof"],
      },
      {
        incidentId: "inc-warning",
        classification: "service-runtime",
        severity: "warning",
        status: "watching",
        owner: "ops",
        remediation: { nextAction: "Watch the service." },
      },
      {
        incidentId: "inc-resolved",
        classification: "service-runtime",
        severity: "critical",
        status: "resolved",
      },
    ];

    const queue = buildIncidentPriorityQueue(incidents);

    expect(queue).toHaveLength(2);
    expect(queue[0]?.incidentId).toBe("inc-critical");
    expect(queue[0]?.priorityScore).toBeGreaterThan(queue[1]?.priorityScore ?? 0);
    expect(queue[0]?.blockers).toContain("worker crashed");
    expect(queue[0]?.nextAction).toBe("Restart the public proof surface worker.");
    expect(queue[0]?.affectedSurfaces).toContain("public-proof");
  });

  it("summarizes workflow stop signals across stages and stop codes", () => {
    const events: RuntimeWorkflowEvent[] = [
      {
        eventId: "evt-1",
        runId: "run-1",
        stage: "agent",
        state: "failed",
        timestamp: "2026-03-12T10:00:00.000Z",
        classification: "execution",
        stopCode: "agent-exit-1",
      },
      {
        eventId: "evt-2",
        runId: "run-1",
        stage: "proof",
        state: "blocked",
        timestamp: "2026-03-12T10:05:00.000Z",
        classification: "delivery",
        stopCode: "proof-timeout",
      },
      {
        eventId: "evt-3",
        runId: "run-2",
        relatedRunId: "run-1",
        stage: "approval",
        state: "completed",
        timestamp: "2026-03-12T10:03:00.000Z",
      },
    ];

    const summary = buildWorkflowBlockerSummary(events);

    expect(summary.totalStopSignals).toBe(2);
    expect(summary.byStage.agent).toBe(1);
    expect(summary.byStage.proof).toBe(1);
    expect(summary.byClassification.execution).toBe(1);
    expect(summary.byStopCode["proof-timeout"]).toBe(1);
    expect(summary.latestStopCode).toBe("proof-timeout");
    expect(summary.blockedRunIds).toContain("run-1");
    expect(summary.proofStopSignals).toBe(1);
  });

  it("ignores stale stop signals once the same run later succeeds", () => {
    const events: RuntimeWorkflowEvent[] = [
      {
        eventId: "evt-stop-1",
        runId: "run-1",
        stage: "proof",
        state: "blocked",
        timestamp: "2026-03-12T10:00:00.000Z",
        classification: "delivery",
        stopCode: "proof-timeout",
      },
      {
        eventId: "evt-proof-complete",
        runId: "run-1",
        stage: "proof",
        state: "completed",
        timestamp: "2026-03-12T10:01:00.000Z",
      },
      {
        eventId: "evt-result-success",
        runId: "run-1",
        stage: "result",
        state: "success",
        timestamp: "2026-03-12T10:02:00.000Z",
      },
    ];

    const summary = buildWorkflowBlockerSummary(events);

    expect(summary.totalStopSignals).toBe(0);
    expect(summary.latestStopAt).toBeNull();
    expect(summary.latestStopCode).toBeNull();
    expect(summary.blockedRunIds).toHaveLength(0);
  });

  it("builds an agent relationship window with recent-edge slices", () => {
    const now = Date.now();
    const observations: RuntimeRelationshipObservation[] = [
      {
        observationId: "obs-1",
        from: "agent:doc-specialist",
        to: "agent:integration-agent",
        relationship: "feeds-agent",
        timestamp: new Date(now - 30 * 60 * 1000).toISOString(),
        source: "knowledge-pack",
      },
      {
        observationId: "obs-2",
        from: "agent:qa-verification-agent",
        to: "agent:integration-agent",
        relationship: "verifies-agent",
        timestamp: new Date(now - 8 * 60 * 60 * 1000).toISOString(),
        source: "verification",
      },
      {
        observationId: "obs-3",
        from: "agent:system-monitor-agent",
        to: "agent:security-agent",
        relationship: "monitors-agent",
        timestamp: new Date(now - 26 * 60 * 60 * 1000).toISOString(),
        source: "monitoring",
      },
    ];

    const window = buildAgentRelationshipWindow(observations, "integration-agent");

    expect(window.agentId).toBe("integration-agent");
    expect(window.total).toBe(2);
    expect(window.recentSixHours).toBe(1);
    expect(window.recentTwentyFourHours).toBe(2);
    expect(window.byRelationship["feeds-agent"]).toBe(1);
    expect(window.byRelationship["verifies-agent"]).toBe(1);
    expect(window.recentEdges[0]?.relationship).toBe("feeds-agent");
  });

  it("keeps mongo runtime-state targets opaque when resolving config-relative paths", () => {
    expect(
      resolveRuntimeStateTarget("/tmp/agent/agent.config.json", "mongo:runtime-truth"),
    ).toBe("mongo:runtime-truth");
    expect(
      resolveRuntimeStateTarget("/tmp/agent/agent.config.json", "../state.json"),
    ).toBe("/tmp/state.json");
  });

  it("routes mutable agent outputs through the configured operator state root", () => {
    const previousStateRoot = process.env.OPENCLAW_OPERATOR_STATE_DIR;
    process.env.OPENCLAW_OPERATOR_STATE_DIR = "/tmp/openclaw-operator-state";

    try {
      expect(
        resolveOperatorStatePath(
          "/tmp/operator/agents/reddit-helper/agent.config.json",
          "../../logs/reddit-drafts.jsonl",
          "logs/reddit-drafts.jsonl",
        ),
      ).toBe("/tmp/openclaw-operator-state/logs/reddit-drafts.jsonl");
    } finally {
      if (previousStateRoot === undefined) {
        delete process.env.OPENCLAW_OPERATOR_STATE_DIR;
      } else {
        process.env.OPENCLAW_OPERATOR_STATE_DIR = previousStateRoot;
      }
    }
  });

  it("reads and writes JSON runtime-state targets directly", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "runtime-state-target-"));
    const targetPath = join(fixtureRoot, "state.json");

    try {
      await saveRuntimeStateTarget(targetPath, {
        updatedAt: "2026-03-28T10:00:00.000Z",
        taskExecutions: [{ idempotencyKey: "task-1", status: "success" }],
      });

      const persisted = JSON.parse(await readFile(targetPath, "utf-8")) as {
        updatedAt?: string;
        taskExecutions?: Array<{ idempotencyKey?: string; status?: string }>;
      };
      expect(persisted.updatedAt).toBe("2026-03-28T10:00:00.000Z");
      expect(persisted.taskExecutions?.[0]?.idempotencyKey).toBe("task-1");

      const loaded = await loadRuntimeStateTarget(targetPath, {});
      expect(loaded).toMatchObject({
        updatedAt: "2026-03-28T10:00:00.000Z",
      });
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("reads and writes normalized SQLite runtime-state targets through the canonical store", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "runtime-state-sqlite-target-"));
    const target = `sqlite:${join(fixtureRoot, "operator.sqlite")}`;

    try {
      await saveRuntimeStateTarget(target, {
        updatedAt: "2026-07-26T15:45:00.000Z",
        taskExecutions: [{ idempotencyKey: "task-sqlite-1", status: "success" }],
      });

      const loaded = await loadRuntimeStateTarget(target, {});
      expect(loaded).toMatchObject({
        updatedAt: "2026-07-26T15:45:00.000Z",
        taskExecutions: [{ idempotencyKey: "task-sqlite-1", status: "success" }],
      });
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("reads and writes mongo runtime-state targets through system_state", async () => {
    const encoded = gzipSync(
      Buffer.from(
        JSON.stringify({
          updatedAt: "2026-03-28T11:00:00.000Z",
          taskExecutions: [{ type: "heartbeat", status: "success" }],
        }),
        "utf-8",
      ),
    );
    const findOne = vi.fn().mockResolvedValue({
      encoding: "gzip-json",
      payload: encoded,
      version: 4,
    });
    const updateOne = vi.fn().mockResolvedValue({});
    const collection = vi.fn(() => ({ findOne, updateOne }));
    const db = vi.fn(() => ({ collection }));
    const close = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn().mockResolvedValue(undefined);
    setRuntimeStateMongoClientFactoryForTest(async () => ({ connect, db, close }));

    const loaded = await loadRuntimeStateTarget("mongo:runtime-truth", {});
    expect(loaded).toMatchObject({
      updatedAt: "2026-03-28T11:00:00.000Z",
    });

    await saveRuntimeStateTarget("mongo:runtime-truth", {
      updatedAt: "2026-03-28T11:05:00.000Z",
      taskExecutions: [{ type: "system-monitor", status: "success" }],
    });

    expect(collection).toHaveBeenCalledWith("system_state");
    expect(findOne).toHaveBeenCalledWith({ key: "runtime-truth" });
    expect(updateOne).toHaveBeenCalledWith(
      { key: "runtime-truth" },
      expect.objectContaining({
        $set: expect.objectContaining({
          encoding: "gzip-json",
          payloadBytes: expect.any(Number),
          version: 5,
        }),
      }),
      { upsert: true },
    );
    const savedPayload = updateOne.mock.calls[0]?.[1]?.$set?.payload;
    expect(savedPayload).toBeInstanceOf(Buffer);
    expect(
      JSON.parse(gunzipSync(savedPayload).toString("utf-8")) as {
        updatedAt?: string;
      },
    ).toMatchObject({
      updatedAt: "2026-03-28T11:05:00.000Z",
    });
    expect(close).toHaveBeenCalledTimes(2);
  });
});
