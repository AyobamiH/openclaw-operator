import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import { loadCampaignDependencyReadiness } from "../src/publishing/dependency-readiness.js";

describe("campaign dependency readiness", () => {
  it("records every decision-dependent phase and all five recovered campaign families", async () => {
    const readiness = await loadCampaignDependencyReadiness(
      fileURLToPath(new URL("../../config/publishing/dependency-readiness.v1.json", import.meta.url)),
    );
    expect(new Set(readiness.dependencies.map((item) => item.phase))).toEqual(new Set([3, 6, 7, 8]));
    expect(readiness.campaignFamilies.map((item) => item.family).sort()).toEqual([
      "community-discussion",
      "founder-observation",
      "problem-education",
      "product-update",
      "research-insight",
    ]);
    expect(readiness.dependencies.find((item) => item.phase === 3)).toMatchObject({
      readiness: "TECHNICALLY_READY_APPROVAL_REQUIRED",
      categories: expect.arrayContaining(["APPROVAL_REQUIRED"]),
    });
    expect(readiness.dependencies.find((item) => item.phase === 7)).toMatchObject({
      readiness: "READY_BUT_INTENTIONALLY_INACTIVE",
      categories: expect.arrayContaining(["READY_BUT_INTENTIONALLY_INACTIVE"]),
    });
    expect(readiness.sourceState).toMatchObject({
      sourceImplemented: true,
      committed: true,
      pushed: true,
      runtimeLoaded: true,
      runtimeVerified: false,
    });
  });
});
