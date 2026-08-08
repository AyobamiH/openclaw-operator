import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCampaignOperationsCycle } from "../src/publishing/campaign-operations.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("campaign operations", () => {
  it("writes distinct daily and weekly evidence reports without converting unavailable data to zero", async () => {
    const root = await mkdtemp(join(tmpdir(), "campaign-operations-"));
    roots.push(root);
    const artifactRoot = join(root, "artifacts", "business-value", "marketing");
    await mkdir(artifactRoot, { recursive: true });
    const input = {
      registryPath: "../config/publishing/registry.v1.json",
      databasePath: join(root, "publishing.sqlite"),
      artifactRoot,
      observedAt: new Date("2026-08-08T14:00:00.000Z"),
    };
    const first = await runCampaignOperationsCycle(input);
    expect(first.externalWrites).toBe(0);
    expect(first.reports).toHaveLength(2);
    const daily = (first.reports as Array<Record<string, unknown>>).find((item) => item.cadence === "daily")!;
    const report = JSON.parse(await readFile(String(daily.jsonPath), "utf8")) as Record<string, unknown>;
    expect(report.externalWrites).toBe(0);
    expect(report.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricDefinitionId: "metric-impressions", availableSamples: 0, value: null }),
      expect.objectContaining({ metricDefinitionId: "metric-engagement-rate", availableSamples: 0, value: null }),
    ]));
    expect(report.experiments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "experiment-full-pregraph-baseline-2026-08-08",
        evaluation: "insufficient_evidence",
        adjustment: 0,
      }),
    ]));
    const second = await runCampaignOperationsCycle(input);
    expect(second.externalWrites).toBe(0);
    expect((second.reports as Array<Record<string, unknown>>).map((item) => item.periodId)).toEqual(
      (first.reports as Array<Record<string, unknown>>).map((item) => item.periodId),
    );
  });
});
