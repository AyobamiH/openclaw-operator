import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCompanionOverview,
  formatCompanionRuns,
  formatCompanionTaskList,
  isReadOnlyOperatorTask,
  normalizeBridgeConfig,
  parseBridgeCommand,
} from "./bridge.ts";

test("normalizeBridgeConfig accepts read-only companion bridge config", () => {
  const config = normalizeBridgeConfig({
    allowedViews: ["status", "runs", "bogus"],
  });

  assert.deepEqual(config.allowedViews, ["status", "runs"]);
  assert.deepEqual(config.allowedTasks, []);
  assert.equal(config.baseUrl, "http://127.0.0.1:3312");
  assert.equal(config.metricsBaseUrl, "http://127.0.0.1:9100");
});

test("normalizeBridgeConfig rejects a bridge with no views and no tasks", () => {
  assert.throws(
    () => normalizeBridgeConfig({}),
    /needs at least one valid allowed view or allowed task/i,
  );
});

test("parseBridgeCommand prefers read-first companion commands", () => {
  const config = normalizeBridgeConfig({
    allowedViews: ["status", "tasks", "runs", "approvals"],
    allowedTasks: ["summarize-content"],
  });

  assert.deepEqual(parseBridgeCommand("status", config), {
    kind: "view",
    view: "status",
  });
  assert.deepEqual(parseBridgeCommand("runs 3", config), {
    kind: "view",
    view: "runs",
    limit: 3,
  });
  assert.deepEqual(parseBridgeCommand("summarize-content launch pricing page", config), {
    kind: "run",
    taskType: "summarize-content",
    payload: { content: "launch pricing page" },
  });
});

test("normalizeBridgeConfig accepts current operator task lanes", () => {
  const config = normalizeBridgeConfig({
    allowedViews: ["status"],
    allowedTasks: [
      "control-plane-brief",
      "incident-triage",
      "release-readiness",
      "deployment-ops",
      "code-index",
      "test-intelligence",
      "compliance-review",
    ],
  });

  assert.deepEqual(config.allowedTasks, [
    "control-plane-brief",
    "incident-triage",
    "release-readiness",
    "deployment-ops",
    "code-index",
    "test-intelligence",
    "compliance-review",
  ]);
});

test("parseBridgeCommand supports safe current operator shorthand", () => {
  const config = normalizeBridgeConfig({
    allowedViews: ["status"],
    allowedTasks: ["control-plane-brief", "incident-triage", "code-index"],
  });

  assert.deepEqual(parseBridgeCommand("control-plane-brief OpenClaw bridge", config), {
    kind: "run",
    taskType: "control-plane-brief",
    payload: { scope: "OpenClaw bridge" },
  });
  assert.deepEqual(parseBridgeCommand("incident-triage current queue", config), {
    kind: "run",
    taskType: "incident-triage",
    payload: { scope: "current queue" },
  });
  assert.deepEqual(parseBridgeCommand("code-index openclaw-operator", config), {
    kind: "run",
    taskType: "code-index",
    payload: { scope: "openclaw-operator" },
  });
});

test("read-only task classification excludes approval-gated lanes", () => {
  assert.equal(isReadOnlyOperatorTask("system-monitor"), true);
  assert.equal(isReadOnlyOperatorTask("control-plane-brief"), true);
  assert.equal(isReadOnlyOperatorTask("build-refactor"), false);
  assert.equal(isReadOnlyOperatorTask("agent-deploy"), false);
  assert.equal(isReadOnlyOperatorTask("market-research"), false);
});

test("parseBridgeCommand requires explicit approval for gated task dispatch", () => {
  const config = normalizeBridgeConfig({
    allowedViews: ["status"],
    allowedTasks: ["build-refactor"],
  });

  assert.throws(
    () => parseBridgeCommand("build-refactor operator bridge cleanup", config),
    /requires a JSON payload with requiresApproval=true/i,
  );
  assert.deepEqual(
    parseBridgeCommand('build-refactor {"scope":"operator bridge cleanup","requiresApproval":true}', config),
    {
      kind: "run",
      taskType: "build-refactor",
      payload: { scope: "operator bridge cleanup", requiresApproval: true },
    },
  );
});

test("parseBridgeCommand rejects disabled companion views", () => {
  const config = normalizeBridgeConfig({
    allowedViews: ["status"],
    allowedTasks: ["summarize-content"],
  });

  assert.throws(
    () => parseBridgeCommand("approvals", config),
    /View "approvals" is not enabled/i,
  );
});

test("formatCompanionOverview renders bounded operator truth", () => {
  const output = formatCompanionOverview({
    controlPlaneMode: {
      label: "Incident Storm",
      detail: "Incidents outrank routine queue work.",
    },
    primaryOperatorMove: {
      title: "Stabilize the incident queue first",
      detail: "A critical incident is outranking the rest of the runtime.",
      supportingSignals: ["6 open incidents", "2 critical"],
    },
    pressureStory: {
      headline: "Incident pressure is dominating the control plane.",
      detail: "Approvals are secondary right now.",
    },
    queue: { queued: 4, processing: 1 },
    approvals: { pendingCount: 2 },
    incidents: { openCount: 6, criticalCount: 2 },
    publicProof: { status: "watching", stale: true, deadLetterCount: 1 },
    services: { declaredCount: 15, serviceExpectedCount: 2, serviceRunningCount: 2 },
    freshnessTimestamp: "2026-04-06T12:00:00.000Z",
  });

  assert.match(output, /Companion status/);
  assert.match(output, /Mode: Incident Storm/);
  assert.match(output, /Primary move: Stabilize the incident queue first/);
  assert.match(output, /Queue: 4 queued, 1 processing/);
  assert.match(output, /Public proof: watching/);
});

test("formatCompanionTaskList marks launch-enabled tasks without scraping operator-only routes", () => {
  const output = formatCompanionTaskList(["market-research"], {
    tasks: [
      {
        type: "market-research",
        label: "Market Research",
        purpose: "Find external change signals.",
        operationalStatus: "confirmed-working",
        dependencyClass: "worker",
        approvalGated: false,
        caveats: ["Network reachability still matters."],
      },
      {
        type: "control-plane-brief",
        label: "Control Plane Brief",
        purpose: "Summarize bounded control-plane truth.",
        operationalStatus: "confirmed-working",
        dependencyClass: "worker",
        approvalGated: false,
        caveats: [],
      },
    ],
  });

  assert.match(output, /Companion task catalog/);
  assert.match(output, /Market Research/);
  assert.doesNotMatch(output, /Control Plane Brief/);
  assert.match(output, /launch-enabled/);
});

test("formatCompanionRuns preserves operator summary and next actions", () => {
  const output = formatCompanionRuns({
    runs: [
      {
        runId: "run-123",
        type: "control-plane-brief",
        status: "success",
        lastHandledAt: "2026-04-06T12:00:00.000Z",
        operatorSummary: "Proof posture is behind queue truth.",
        recommendedNextActions: [
          "Refresh public proof before external claims.",
          "Watch the approval inbox.",
        ],
        freshnessStatus: "watching",
        workflowStage: "proof-review",
      },
    ],
  });

  assert.match(output, /Companion run briefs/);
  assert.match(output, /control-plane-brief success run-123/);
  assert.match(output, /Proof posture is behind queue truth/);
  assert.match(output, /Next: Refresh public proof before external claims/);
});
