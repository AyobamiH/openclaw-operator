import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { observeOnce } from "./service.js";

test("service heartbeat observes drift-repair evidence without mutating orchestrator state", async () => {
  const root = await mkdtemp(join(tmpdir(), "doc-specialist-observer-"));
  const orchestratorStatePath = join(root, "orchestrator-state.json");
  const serviceStatePath = join(root, "doc-specialist-service.json");
  const orchestratorState = {
    pendingDocChanges: ["docs/one.md", "docs/two.md"],
    driftRepairs: [{ runId: "existing-repair" }],
    lastDriftRepairAt: "2026-08-10T12:00:00.000Z",
    taskExecutions: [
      {
        idempotencyKey: "drift-repair:one",
        type: "drift-repair",
        status: "success",
        completedAt: "2026-08-10T12:00:00.000Z",
      },
    ],
  };
  await writeFile(
    orchestratorStatePath,
    JSON.stringify(orchestratorState, null, 2),
    "utf8",
  );

  await observeOnce({
    id: "doc-specialist",
    orchestratorTask: "drift-repair",
    orchestratorStatePath,
    serviceStatePath,
  });

  const after = JSON.parse(await readFile(orchestratorStatePath, "utf8"));
  const serviceState = JSON.parse(await readFile(serviceStatePath, "utf8"));

  assert.deepEqual(after, orchestratorState);
  assert.equal(serviceState.agentId, "doc-specialist");
  assert.equal(serviceState.lastStatus, "ok");
  assert.equal(serviceState.serviceHeartbeat.status, "ok");
  assert.equal(serviceState.serviceHeartbeat.source, "service-loop");
  assert.equal(serviceState.taskPath.taskType, "drift-repair");
  assert.equal(serviceState.taskPath.totalRuns, 1);
});
