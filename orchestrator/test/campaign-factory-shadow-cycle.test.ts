import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { auditCampaignContentFactory } from "../src/publishing/campaign-factory.js";
import { ensureCampaignMediaForDate } from "../src/publishing/campaign-factory-shadow-cycle.js";

const REGISTRY = "../config/publishing/registry.v1.json";
const INTEGRATION = "../config/publishing/production-integration.v1.json";
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fakeRenderer(root: string): Promise<string> {
  const rendererRoot = join(root, "renderer");
  const entrypoint = join(rendererRoot, "bin", "local-media-renderer.mjs");
  await mkdir(join(rendererRoot, "bin"), { recursive: true });
  await mkdir(join(rendererRoot, "lib"), { recursive: true });
  await writeFile(join(rendererRoot, "lib", "reel-creative-library.mjs"), `
export function compileReelStoryboard(input) { return { ...input.script, schema: "fake-reel", kind: "reel", slug: input.slug }; }
`);
  await writeFile(entrypoint, `
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const [, , kind, , specPath, , outputDir] = process.argv;
const spec = JSON.parse(await readFile(specPath, "utf8"));
const extension = kind === "reel" ? "mp4" : "png";
const mediaPath = join(outputDir, spec.slug + "." + extension);
const bytes = Buffer.from("fake-" + kind + "-" + spec.slug);
await writeFile(mediaPath, bytes, { flag: "wx" });
const sha256 = createHash("sha256").update(bytes).digest("hex");
const checks = kind === "reel"
  ? { hyperframes: true, highQualityRender: true, audioFinishing: true, fullDecode: true, encodedFrameVisibility: true, textFitAndSafeMargins: true, contrast: true, readingTime: true, temporaryWorkspaceCleaned: true }
  : { hyperframes: true, snapshot: true, layoutVerification: true, fullDecode: true, temporaryWorkspaceCleaned: true };
await writeFile(join(outputDir, spec.slug + "-local-render-receipt.json"), JSON.stringify({
  schema: "tailwagging-local-media-render-receipt.v1",
  outcome: "success",
  kind,
  slug: spec.slug,
  finalPath: mediaPath,
  media: kind === "reel"
    ? { width: 1080, height: 1920, durationSeconds: 12, bytes: bytes.length, sha256 }
    : { width: 1080, height: 1350, bytes: bytes.length, sha256 },
  renderer: { name: "HyperFrames", version: "test", outboundHttpBlocked: true },
  checks,
  layoutVerification: { status: "passed" },
  layoutAudit: { status: "passed" },
  encodedFrameAudit: { status: "passed" },
  externalMediaGenerationCalls: 0,
  generatedMediaUploadCalls: 0,
  instagramPublishCalls: 0
}) + "\\n", { flag: "wx" });
`);
  await chmod(entrypoint, 0o700);
  return entrypoint;
}

describe("campaign factory shadow cycle", () => {
  it("renders once, re-verifies immutable artifacts, and produces a ready zero-write audit", async () => {
    const root = await mkdtemp(join(tmpdir(), "campaign-factory-shadow-cycle-"));
    tempRoots.push(root);
    const artifactRoot = join(root, "artifacts");
    const rendererEntrypoint = await fakeRenderer(root);
    const input = {
      registryPath: REGISTRY,
      integrationPath: INTEGRATION,
      localDate: "2026-08-03",
      artifactRoot,
      rendererEntrypoint,
    };
    const first = await ensureCampaignMediaForDate(input);
    expect(first.results.map((item) => item.outcome)).toEqual([
      "not_required",
      "rendered_verified",
      "rendered_verified",
      "not_required",
      "rendered_verified",
    ]);
    expect(first.results.every((item) => item.externalWrites === 0)).toBe(true);
    const second = await ensureCampaignMediaForDate(input);
    expect(second.results.map((item) => item.outcome)).toEqual([
      "not_required",
      "reused_verified",
      "reused_verified",
      "not_required",
      "reused_verified",
    ]);
    expect(second.artifacts.map((item) => item.artifactHash)).toEqual(
      first.artifacts.map((item) => item.artifactHash),
    );
    const audit = await auditCampaignContentFactory({
      registryPath: REGISTRY,
      integrationPath: INTEGRATION,
      localDate: "2026-08-03",
      mediaArtifacts: second.artifacts,
    });
    expect(audit.verdict).toBe("ready");
    expect(audit.totals).toEqual({
      opportunities: 5,
      shadowReady: 5,
      mediaBlocked: 0,
      deliveryBlocked: 3,
    });
    expect(audit.activation.providerWrites).toBe(0);
  });
});
