import { describe, expect, it } from "vitest";
import {
  auditCampaignContentFactory,
  planCampaignFactoryContentForDate,
} from "../src/publishing/campaign-factory.js";
import { loadProductionIntegration } from "../src/publishing/production-integration.js";
import { loadRegistryBundle } from "../src/publishing/registry.js";

const REGISTRY = "../config/publishing/registry.v1.json";
const INTEGRATION = "../config/publishing/production-integration.v1.json";

describe("campaigns content factory", () => {
  it("shares deterministic shadow portfolio history across preplanned opportunities", async () => {
    const registry = await loadRegistryBundle(REGISTRY);
    const integration = await loadProductionIntegration(INTEGRATION, registry);
    const planned = planCampaignFactoryContentForDate({
      registry,
      integration,
      localDate: "2026-08-10",
    });
    expect(planned).toHaveLength(5);
    expect(new Set(planned.map((item) => item.contentSpec.campaignId)).size).toBeGreaterThan(1);
    expect(planned[0]?.contentSpec.campaignType).toBe(
      registry.schedules[0]?.primaryCampaignType,
    );
  });

  it("produces deterministic zero-write packages and refuses false Instagram readiness without media", async () => {
    const input = {
      registryPath: REGISTRY,
      integrationPath: INTEGRATION,
      localDate: "2026-08-03",
    };
    const first = await auditCampaignContentFactory(input);
    const second = await auditCampaignContentFactory(input);
    expect(first.verdict).toBe("partial");
    expect(first.configuredMode).toBe("shadow");
    expect(first.activation.providerWrites).toBe(0);
    expect(first.activation.liveActivationReady).toBe(false);
    expect(first.totals).toEqual({ opportunities: 5, shadowReady: 2, mediaBlocked: 3, deliveryBlocked: 0 });
    expect(first.opportunities.filter((item) => item.platformId === "threads").every((item) => item.shadowReady)).toBe(true);
    expect(first.opportunities.filter((item) => item.platformId === "instagram").every((item) => item.blockers.some((blocker) => blocker.startsWith("immutable_media_artifact_missing:")))).toBe(true);
    expect(second.opportunities).toEqual(first.opportunities);
  });
});
