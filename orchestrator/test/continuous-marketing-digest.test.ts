import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContinuousMarketingDigest } from "../src/business/continuousMarketingDigest.js";

describe("continuous marketing digest", () => {
  it("creates a deterministic evidence-only digest without inventing unavailable metrics", async () => {
    const workspace = "/home/oneclickwebsitedesignfactory/.openclaw/workspace";
    const root = await mkdtemp(join(workspace, ".tmp-graph-digest-"));
    const sourceRoot = join(root, "source"), outputRoot = join(root, "output"), missionPath = join(root, "mission.md");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(missionPath, "# Mission\n", "utf8");
    await writeFile(join(sourceRoot, "evidence.md"), "Published and verified: https://www.instagram.com/p/example/\nBlocker: metrics unavailable\nApproval needed: exact outreach copy\n", "utf8");
    const result = await buildContinuousMarketingDigest({ observedAt: new Date().toISOString(), sourceRoot, missionPath, outputRoot });
    expect(result.verifiedLinks).toEqual(["https://www.instagram.com/p/example/"]);
    expect(result.blockers).toHaveLength(1);
    expect(result.approvals).toHaveLength(1);
    expect(await readFile(result.outputPath, "utf8")).toContain("no activity or metric was inferred");
    await rm(root, { recursive: true, force: true });
  });

  it("does not surface historical render failures after the same slot has a successful local receipt", async () => {
    const workspace = "/home/oneclickwebsitedesignfactory/.openclaw/workspace";
    const root = await mkdtemp(join(workspace, ".tmp-graph-digest-"));
    const sourceRoot = join(root, "source"), outputRoot = join(root, "output"), missionPath = join(root, "mission.md");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(missionPath, "# Mission\n", "utf8");
    const failedPath = join(sourceRoot, "dynamic-reel-20260825-2100-old-local-render-receipt.json");
    const successPath = join(sourceRoot, "instagram-reel-diagnostic-20260825-2100-new-local-render-receipt.json");
    await writeFile(failedPath, JSON.stringify({
      schema: "tailwagging-local-media-render-receipt.v1",
      outcome: "failed_closed",
      kind: "reel",
      slug: "dynamic-reel-20260825-2100-old",
      state: "failed",
      error: "Image layout repair stopped after 2 identical no-progress layouts",
    }, null, 2), "utf8");
    await writeFile(successPath, JSON.stringify({
      schema: "tailwagging-local-media-render-receipt.v1",
      outcome: "success",
      kind: "reel",
      slug: "instagram-reel-diagnostic-20260825-2100-new",
    }, null, 2), "utf8");
    await writeFile(join(sourceRoot, "graph-owned-daily-growth-digest.md"), "Blockers: old digest blocker should not be re-ingested\n", "utf8");
    const observedAt = new Date("2026-08-26T08:30:00.000Z");
    await utimes(failedPath, new Date("2026-08-25T20:01:00.000Z"), new Date("2026-08-25T20:01:00.000Z"));
    await utimes(successPath, new Date("2026-08-25T21:22:00.000Z"), new Date("2026-08-25T21:22:00.000Z"));
    const result = await buildContinuousMarketingDigest({ observedAt: observedAt.toISOString(), sourceRoot, missionPath, outputRoot });
    expect(result.blockers).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });

  it("keeps render failures when no later successful slot receipt is evidenced", async () => {
    const workspace = "/home/oneclickwebsitedesignfactory/.openclaw/workspace";
    const root = await mkdtemp(join(workspace, ".tmp-graph-digest-"));
    const sourceRoot = join(root, "source"), outputRoot = join(root, "output"), missionPath = join(root, "mission.md");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(missionPath, "# Mission\n", "utf8");
    await writeFile(join(sourceRoot, "dynamic-reel-20260825-2100-old-local-render-receipt.json"), JSON.stringify({
      schema: "tailwagging-local-media-render-receipt.v1",
      outcome: "failed_closed",
      kind: "reel",
      slug: "dynamic-reel-20260825-2100-old",
      error: "Prepared Reel layout audit failed for dynamic-reel-20260825-2100-old",
    }, null, 2), "utf8");
    const result = await buildContinuousMarketingDigest({ observedAt: new Date().toISOString(), sourceRoot, missionPath, outputRoot });
    expect(result.blockers.some((line) => line.includes("Prepared Reel layout audit failed"))).toBe(true);
    await rm(root, { recursive: true, force: true });
  });
});
