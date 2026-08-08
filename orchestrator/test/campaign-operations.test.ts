import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runCampaignOperationsCycle } from "../src/publishing/campaign-operations.js";
import { DeterministicPublishingEngine } from "../src/publishing/engine.js";
import { loadRegistryBundle } from "../src/publishing/registry.js";
import { PublishingStore } from "../src/publishing/store.js";

const roots: string[] = [];
const REGISTRY_PATH = fileURLToPath(new URL("../../config/publishing/registry.v1.json", import.meta.url));
const INTEGRATION_PATH = fileURLToPath(new URL("../../config/publishing/production-integration.v1.json", import.meta.url));

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
      registryPath: REGISTRY_PATH,
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
    expect(report.experiments).toEqual([]);
    expect(first.metricRefresh).toMatchObject({ status: "not_requested", externalWrites: 0 });
    const second = await runCampaignOperationsCycle(input);
    expect(second.externalWrites).toBe(0);
    expect((second.reports as Array<Record<string, unknown>>).map((item) => item.periodId)).toEqual(
      (first.reports as Array<Record<string, unknown>>).map((item) => item.periodId),
    );
  });

  it("refreshes supported official provider metrics without a provider write", async () => {
    const root = await mkdtemp(join(tmpdir(), "campaign-metric-refresh-"));
    roots.push(root);
    const artifactRoot = join(root, "artifacts", "business-value", "marketing");
    const databasePath = join(root, "publishing.sqlite");
    await mkdir(artifactRoot, { recursive: true });
    const registry = await loadRegistryBundle(REGISTRY_PATH);
    const store = new PublishingStore(databasePath);
    const engine = new DeterministicPublishingEngine(registry, store);
    engine.initialize();
    const scheduledFor = new Date("2026-08-08T14:00:00.000Z");
    const plan = engine.planSlot({
      platformId: "threads",
      accountId: "tailwaggingwebdesigns",
      scheduledFor,
      now: scheduledFor,
    });
    expect(plan.result).toBe("reserved");
    store.database.prepare(`
      UPDATE publishing_publications
      SET state='verified', provider_id='threads-provider-object-1',
          verified_at=?, updated_at=?
      WHERE id=?
    `).run(scheduledFor.toISOString(), scheduledFor.toISOString(), plan.reservation!.publicationId);
    store.close();

    const invocations: string[] = [];
    const result = await runCampaignOperationsCycle({
      registryPath: REGISTRY_PATH,
      integrationPath: INTEGRATION_PATH,
      databasePath,
      artifactRoot,
      observedAt: new Date("2026-08-08T17:00:00.000Z"),
      toolInvoker: async (invocation) => {
        invocations.push(invocation.tool);
        expect(invocation.tool).toBe("relay_live_business_engagement_discover");
        expect(invocation.args).toMatchObject({
          platform: "threads",
          surface: "post_insights",
          targetId: "threads-provider-object-1",
        });
        return {
          metrics: [
            { name: "views", value: 100 },
            { name: "likes", value: 5 },
            { name: "replies", value: 2 },
            { name: "reposts", value: 1 },
            { name: "quotes", value: 1 },
            { name: "shares", value: 1 },
          ],
        };
      },
    });
    expect(invocations).toEqual(["relay_live_business_engagement_discover"]);
    expect(result).toMatchObject({
      outcome: "completed",
      externalWrites: 0,
      metricRefresh: {
        status: "completed",
        eligibleProviderObjects: 1,
        officialReadCalls: 1,
        recordedMetrics: 2,
        unavailableMetrics: 0,
        externalWrites: 0,
      },
    });
  });
});
