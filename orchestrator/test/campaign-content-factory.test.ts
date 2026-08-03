import { describe, expect, it } from "vitest";
import { auditCampaignContentFactory } from "../src/publishing/campaign-factory.js";

const REGISTRY = "../config/publishing/registry.v1.json";
const INTEGRATION = "../config/publishing/production-integration.v1.json";

describe("campaigns content factory", () => {
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
