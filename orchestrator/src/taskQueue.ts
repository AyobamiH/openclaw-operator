import PQueue from "p-queue";
import { randomUUID } from "node:crypto";
import { Task } from "./types.js";
import { validateTaskType, ALLOWED_TASK_TYPES } from "./taskHandlers.js";

export class TaskQueue {
  private queue = new PQueue({ concurrency: 2 });
  private listeners: Array<(task: Task) => void> = [];
  private enqueueListeners: Array<(task: Task) => void> = [];
  private queuedTasks = new Map<string, Task>();
  private processingTasks = new Map<string, Task>();

  private deriveIdempotencyKey(
    payload: Record<string, unknown>,
    fallbackId: string,
  ): string {
    const provided = payload.idempotencyKey;
    if (typeof provided === "string" && provided.trim().length > 0) {
      return provided.trim();
    }
    return fallbackId;
  }

  enqueue(type: string, payload: Record<string, unknown>) {
    // Enforce task type allowlist at queue entry point (deny-by-default)
    if (!validateTaskType(type)) {
      throw new Error(
        `Invalid task type: ${type}. Allowed types: ${ALLOWED_TASK_TYPES.join(', ')}`
      );
    }

    const attemptValue = Number(payload.__attempt ?? 1);
    const retryValue = Number(payload.maxRetries ?? 2);

    const taskId = randomUUID();
    const task: Task = {
      id: taskId,
      type,
      payload,
      createdAt: Date.now(),
      idempotencyKey: this.deriveIdempotencyKey(payload, taskId),
      attempt: Number.isFinite(attemptValue) && attemptValue > 0 ? Math.floor(attemptValue) : 1,
      maxRetries: Number.isFinite(retryValue) && retryValue >= 0 ? Math.floor(retryValue) : 2,
    };

    for (const listener of this.enqueueListeners) {
      listener(task);
    }

    this.queuedTasks.set(task.id, task);

    const queuedExecution = this.queue.add(async () => {
      this.queuedTasks.delete(task.id);
      this.processingTasks.set(task.id, task);
      try {
        for (const listener of this.listeners) {
          await listener(task);
        }
      } finally {
        this.processingTasks.delete(task.id);
      }
    });
    queuedExecution.catch((error) => {
      console.error(
        `[task-queue] Unhandled listener failure for ${task.type}:`,
        error,
      );
    });

    return task;
  }

  onProcess(listener: (task: Task) => Promise<void> | void) {
    this.listeners.push(listener);
  }

  onEnqueue(listener: (task: Task) => void) {
    this.enqueueListeners.push(listener);
  }

  getPendingCount() {
    return this.queue.pending;
  }

  getQueuedCount() {
    return this.queue.size;
  }

  getSnapshot() {
    return {
      queued: [...this.queuedTasks.values()].map((task) => ({ ...task })),
      processing: [...this.processingTasks.values()].map((task) => ({ ...task })),
    };
  }
}
