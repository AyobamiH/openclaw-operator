import { describe, expect, it } from "vitest";
import {
  assertApprovalIfRequired,
  decideApproval,
} from "../src/approvalGate.js";
import { enqueueApprovedTaskReplay } from "../src/approvalReplay.js";
import { createDefaultState } from "../src/state.js";
import { TaskQueue } from "../src/taskQueue.js";
import type { Task } from "../src/types.js";

describe("approval replay execution binding", () => {
  it("allows only the exact payload-bound replay and rejects altered consequential input", () => {
    const state = createDefaultState();
    const original: Task = {
      id: "deploy-request-1",
      type: "agent-deploy",
      payload: { agentName: "bounded-agent", template: "doc-specialist" },
      createdAt: Date.now(),
    };
    expect(assertApprovalIfRequired(original, state, {})).toMatchObject({ allowed: false });
    const approval = decideApproval(state, original.id, "approved", "operator");
    const queue = new TaskQueue();
    const replay = enqueueApprovedTaskReplay({ state, queue, approval, actor: "operator" });
    expect(replay.replay).not.toBeNull();
    expect(assertApprovalIfRequired(replay.replay!, state, {})).toMatchObject({
      allowed: true,
      reason: "approval_replay_payload_bound",
    });

    const altered: Task = {
      ...replay.replay!,
      payload: { ...replay.replay!.payload, template: "security-agent" },
    };
    expect(assertApprovalIfRequired(altered, state, {})).toMatchObject({
      allowed: false,
      reason: "approval_replay_payload_mismatch",
    });
  });

  it("does not execute an approved original task without the bound replay envelope", () => {
    const state = createDefaultState();
    const task: Task = {
      id: "refactor-request-1",
      type: "build-refactor",
      payload: { objective: "bounded refactor" },
      createdAt: Date.now(),
    };
    assertApprovalIfRequired(task, state, {});
    decideApproval(state, task.id, "approved", "operator");
    expect(assertApprovalIfRequired(task, state, {})).toEqual({
      allowed: false,
      reason: "approved_task_requires_bound_replay",
    });
  });

  it("stores an immutable approval payload snapshot", () => {
    const state = createDefaultState();
    const task: Task = {
      id: "deploy-request-2",
      type: "agent-deploy",
      payload: { agentName: "first-name", template: "doc-specialist" },
      createdAt: Date.now(),
    };
    assertApprovalIfRequired(task, state, {});
    task.payload.agentName = "mutated-after-request";
    expect(state.approvals[0]?.payload.agentName).toBe("first-name");
  });
});
