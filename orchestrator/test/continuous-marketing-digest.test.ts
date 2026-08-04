import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
});
