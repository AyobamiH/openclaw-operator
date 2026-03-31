import { describe, expect, it } from "vitest";
import { TaskQueue } from "../src/taskQueue.ts";

describe("TaskQueue idempotency", () => {
  it("assigns unique run ids when no explicit idempotency key is provided", () => {
    const queue = new TaskQueue();

    const first = queue.enqueue("heartbeat", {
      reason: "shared-payload",
    });
    const second = queue.enqueue("heartbeat", {
      reason: "shared-payload",
    });

    expect(first.id).not.toBe(second.id);
    expect(first.idempotencyKey).toBe(first.id);
    expect(second.idempotencyKey).toBe(second.id);
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it("preserves an explicit idempotency key for replay and retry flows", () => {
    const queue = new TaskQueue();

    const replay = queue.enqueue("build-refactor", {
      idempotencyKey: "repair-run-1",
      target: "incident-1",
    });

    expect(replay.idempotencyKey).toBe("repair-run-1");
  });

  it("tracks queued and processing task snapshots for operator visibility", async () => {
    const queue = new TaskQueue();
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let runningCount = 0;
    let markBothStarted!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      markBothStarted = resolve;
    });

    queue.onProcess(async (task) => {
      if (task.payload.reason === "block-first-task") {
        runningCount += 1;
        if (runningCount === 2) {
          markBothStarted();
        }
        await new Promise<void>((resume) => {
          if (!releaseFirst) {
            releaseFirst = resume;
          } else {
            releaseSecond = resume;
          }
        });
      }
    });

    const first = queue.enqueue("heartbeat", {
      reason: "block-first-task",
    });
    const second = queue.enqueue("heartbeat", {
      reason: "block-first-task",
    });
    await bothStarted;

    const third = queue.enqueue("heartbeat", {
      reason: "snapshot-check",
    });

    expect(queue.getSnapshot().processing.map((item) => item.id)).toContain(first.id);
    expect(queue.getSnapshot().processing.map((item) => item.id)).toContain(second.id);
    expect(queue.getSnapshot().queued.map((item) => item.id)).toContain(third.id);

    releaseFirst();
    releaseSecond();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(queue.getSnapshot().queued).toHaveLength(0);
    expect(queue.getSnapshot().processing).toHaveLength(0);
  });
});
