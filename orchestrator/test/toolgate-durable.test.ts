import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAgentRegistry } from "../src/agentRegistry.js";
import { ToolGate } from "../src/toolGate.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

describe("durable ToolGate enforcement", () => {
  it("persists policies, denials and single-use capabilities across restart with tamper detection", async () => {
    const root = await mkdtemp(join(tmpdir(), "toolgate-durable-"));
    const path = join(root, "toolgate.sqlite");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const agentRegistry = await getAgentRegistry();
    let gate = new ToolGate({ statePath: path, agentRegistry });
    await gate.initialize();

    const denied = gate.authorizeSkillExecution("build-refactor-agent", "workspacePatch", { scopeId: "run-one", filePath: "/outside/authority.txt" }, { fileWrite: true });
    expect(denied).toMatchObject({ success: false });
    const allowed = gate.authorizeSkillExecution("build-refactor-agent", "workspacePatch", { scopeId: "run-one", filePath: "workspace/projects/openclaw-operator/orchestrator/src/index.ts" }, { fileWrite: true });
    expect(allowed.success).toBe(true);
    expect(allowed.capability?.status).toBe("issued");
    gate.completeExecutionCapability(allowed.capability!.capabilityId, "consumed");
    expect(() => gate.completeExecutionCapability(allowed.capability!.capabilityId, "consumed")).toThrow("toolgate_capability_not_issued");
    expect(gate.durableStats()).toMatchObject({ decisions: 2, denials: 1, consumed: 1, chainValid: true });
    gate.close();

    gate = new ToolGate({ statePath: path, agentRegistry });
    await gate.initialize();
    expect(gate.durableStats()).toMatchObject({ decisions: 2, denials: 1, consumed: 1, chainValid: true });
    const task = gate.authorizeTaskExecution("build-refactor-agent", "build-refactor", { taskId: "child-task-one" });
    expect(task.success).toBe(true);
    gate.completeExecutionCapability(task.capability!.capabilityId);
    expect(gate.durableStats()).toMatchObject({ decisions: 3, denials: 1, consumed: 2, chainValid: true });
    gate.close();

    const database = new DatabaseSync(path);
    expect(() => database.prepare("UPDATE toolgate_decisions SET reason='tampered' WHERE allowed=0").run()).toThrow(/immutable/i);
    expect(() => database.prepare("UPDATE toolgate_capabilities SET status='issued' WHERE status='consumed'").run()).toThrow(/immutable/i);
    database.close();
  });
});
