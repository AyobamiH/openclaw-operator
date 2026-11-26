import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDocChangeIngress,
  docChangePathsFromPayload,
  type DocChangeBatchPayload,
} from "../../src/doc-change-ingress.js";

describe("document change ingress", () => {
  afterEach(() => vi.useRealTimers());
  it("coalesces a filesystem burst into one deterministic queue task", () => {
    vi.useFakeTimers();
    const batches: DocChangeBatchPayload[] = [];
    const ingress = createDocChangeIngress({
      enqueue: (payload) => batches.push(payload),
      flushDelayMs: 100,
    });

    for (let index = 0; index < 100; index += 1) {
      ingress.push({
        path: `/docs/${index % 10}.md`,
        lastModified: index,
      });
    }
    expect(batches).toHaveLength(0);
    expect(ingress.pendingCount()).toBe(10);

    vi.advanceTimersByTime(100);

    expect(batches).toHaveLength(1);
    expect(batches[0].paths).toHaveLength(10);
    expect(batches[0].changes.find((change) => change.path === "/docs/0.md"))
      .toEqual({ path: "/docs/0.md", lastModified: 90 });
    expect(batches[0].idempotencyKey).toMatch(/^doc-change-batch:[a-f0-9]{64}$/);
    vi.useRealTimers();
  });

  it("bounds each admitted batch without dropping overflow", () => {
    const batches: DocChangeBatchPayload[] = [];
    const ingress = createDocChangeIngress({
      enqueue: (payload) => batches.push(payload),
      flushDelayMs: 60_000,
      maxBatchSize: 2,
    });

    ingress.push({ path: "/docs/a.md", lastModified: 1 });
    ingress.push({ path: "/docs/b.md", lastModified: 2 });
    ingress.push({ path: "/docs/c.md", lastModified: 3 });
    ingress.flush();

    expect(batches.map((batch) => batch.paths)).toEqual([
      ["/docs/a.md", "/docs/b.md"],
      ["/docs/c.md"],
    ]);
  });

  it("collapses the observed burst scale before queue admission", () => {
    vi.useFakeTimers();
    const batches: DocChangeBatchPayload[] = [];
    const ingress = createDocChangeIngress({
      enqueue: (payload) => batches.push(payload),
      flushDelayMs: 100,
      maxBatchSize: 200,
    });

    for (let index = 0; index < 22_849; index += 1) {
      ingress.push({
        path: `/docs/${index % 500}.md`,
        lastModified: index,
      });
    }
    vi.advanceTimersByTime(100);

    expect(batches).toHaveLength(3);
    expect(batches.flatMap((batch) => batch.paths)).toHaveLength(500);
    expect(batches.every((batch) => batch.paths.length <= 200)).toBe(true);
    expect(ingress.pendingCount()).toBe(0);
    vi.useRealTimers();
  });

  it("rejects malformed events before they consume queue capacity", () => {
    const batches: DocChangeBatchPayload[] = [];
    const ingress = createDocChangeIngress({
      enqueue: (payload) => batches.push(payload),
    });

    expect(ingress.push({ path: "", lastModified: 1 })).toBe(false);
    expect(ingress.push({ path: "/docs/a.md", lastModified: Number.NaN })).toBe(false);
    expect(ingress.flush()).toBe(0);
    expect(batches).toHaveLength(0);
  });

  it("normalizes and bounds batched handler input", () => {
    expect(docChangePathsFromPayload({
      path: "/ignored.md",
      paths: [" /docs/a.md ", "/docs/a.md", "/docs/b.md", 42],
    })).toEqual(["/docs/a.md", "/docs/b.md"]);
    expect(docChangePathsFromPayload({ path: "/docs/single.md" }))
      .toEqual(["/docs/single.md"]);
    expect(docChangePathsFromPayload({
      paths: Array.from({ length: 250 }, (_, index) => `/docs/${index}.md`),
    })).toHaveLength(200);
  });
});
