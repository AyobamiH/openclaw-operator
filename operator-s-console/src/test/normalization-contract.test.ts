import { describe, expect, it } from "vitest";
import { normalizeObject } from "@/lib/normalize";

describe("API normalization contract", () => {
  it("preserves raw diagnostics without polluting enumerable records", () => {
    const normalized = normalizeObject<{
      components: Record<string, number> & { __raw?: Record<string, number> };
      __raw?: unknown;
    }>({
      components: { confidence: 4, urgency: 3 },
    });

    expect(Object.keys(normalized)).toEqual(["components"]);
    expect(Object.entries(normalized.components)).toEqual([
      ["confidence", 4],
      ["urgency", 3],
    ]);
    expect(normalized.__raw).toEqual({ components: { confidence: 4, urgency: 3 } });
    expect(normalized.components.__raw).toEqual({ confidence: 4, urgency: 3 });
  });

  it("keeps remapped keys available without exposing raw objects in iteration", () => {
    const normalized = normalizeObject<Record<string, unknown>>({
      run_id: "run-1",
      bands: { fresh: 2, stale: 1 },
    });

    expect(normalized.runId).toBe("run-1");
    expect(normalized.run_id).toBe("run-1");
    expect(Object.keys(normalized.bands as object)).toEqual(["fresh", "stale"]);
  });
});

import { asRecord } from "@/lib/safe-render";

it("extracts records without treating arrays or primitives as records", () => {
  const value = { runId: "run-1" };
  expect(asRecord(value)).toBe(value);
  for (const invalid of [null, undefined, [], 0, "", true]) expect(asRecord(invalid)).toBeNull();
});
