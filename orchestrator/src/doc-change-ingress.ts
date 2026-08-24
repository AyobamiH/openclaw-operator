import { createHash } from "node:crypto";

export type WatchedDocumentChange = {
  path: string;
  lastModified: number;
};

export type DocChangeBatchPayload = {
  path: string;
  paths: string[];
  changes: WatchedDocumentChange[];
  lastModified: number;
  idempotencyKey: string;
};

type TimerHandle = ReturnType<typeof setTimeout> | number;

const DEFAULT_FLUSH_DELAY_MS = 100;
const DEFAULT_MAX_BATCH_SIZE = 200;

export function docChangePathsFromPayload(
  payload: Record<string, unknown>,
  limit = DEFAULT_MAX_BATCH_SIZE,
) {
  const values = Array.isArray(payload.paths)
    ? payload.paths
    : [payload.path ?? "unknown"];
  return [
    ...new Set(
      values
        .filter((path): path is string => typeof path === "string")
        .map((path) => path.trim())
        .filter(Boolean),
    ),
  ].slice(0, Math.max(1, Math.floor(limit)));
}

function normalizeChange(change: WatchedDocumentChange): WatchedDocumentChange | null {
  const path = String(change.path ?? "").trim();
  const lastModified = Number(change.lastModified);
  if (!path || !Number.isFinite(lastModified)) return null;
  return { path, lastModified };
}

function batchId(changes: WatchedDocumentChange[]) {
  return createHash("sha256")
    .update(JSON.stringify(changes))
    .digest("hex");
}

export function createDocChangeIngress(options: {
  enqueue: (payload: DocChangeBatchPayload) => void;
  flushDelayMs?: number;
  maxBatchSize?: number;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
}) {
  const flushDelayMs = Math.max(
    0,
    Math.floor(options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS),
  );
  const maxBatchSize = Math.max(
    1,
    Math.floor(options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE),
  );
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  const pending = new Map<string, WatchedDocumentChange>();
  let timer: TimerHandle | null = null;

  const flush = () => {
    if (timer) {
      cancel(timer);
      timer = null;
    }
    let flushed = 0;
    while (pending.size > 0) {
      const changes = [...pending.values()]
        .sort((left, right) => left.path.localeCompare(right.path))
        .slice(0, maxBatchSize);
      for (const change of changes) pending.delete(change.path);

      options.enqueue({
        path: changes[0].path,
        paths: changes.map((change) => change.path),
        changes,
        lastModified: Math.max(...changes.map((change) => change.lastModified)),
        idempotencyKey: `doc-change-batch:${batchId(changes)}`,
      });
      flushed += changes.length;
    }
    return flushed;
  };

  const push = (change: WatchedDocumentChange) => {
    const normalized = normalizeChange(change);
    if (!normalized) return false;
    const previous = pending.get(normalized.path);
    if (!previous || previous.lastModified <= normalized.lastModified) {
      pending.set(normalized.path, normalized);
    }
    if (!timer) timer = schedule(flush, flushDelayMs);
    return true;
  };

  return {
    push,
    flush,
    pendingCount: () => pending.size,
  };
}
