import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { auditCampaignContentFactory } from "../src/publishing/campaign-factory.js";
import {
  ensureCampaignMediaForDate,
  runCampaignFactoryScheduledCycle,
} from "../src/publishing/campaign-factory-shadow-cycle.js";
import { bindCampaignMediaDelivery } from "../src/publishing/media-artifact.js";

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

  it("promotes a canary-mode text opportunity only after explicit provider-write authorization", async () => {
    const root = await mkdtemp(join(tmpdir(), "campaign-factory-canary-cycle-"));
    tempRoots.push(root);
    const integrationFixture = JSON.parse(await readFile(INTEGRATION, "utf8")) as Record<string, unknown>;
    integrationFixture.mode = "canary";
    const integrationFixturePath = join(root, "production-integration-canary.json");
    await writeFile(integrationFixturePath, `${JSON.stringify(integrationFixture)}\n`);
    const rendererEntrypoint = await fakeRenderer(root);
    const common = {
      registryPath: REGISTRY,
      integrationPath: integrationFixturePath,
      databasePath: join(root, "publishing.sqlite"),
      artifactRoot: join(root, "artifacts"),
      rendererEntrypoint,
      observedAt: new Date("2026-07-30T15:00:00+01:00"),
      opportunityId: "self-id-1500",
    };
    const blocked = await runCampaignFactoryScheduledCycle({
      ...common,
      toolInvoker: async () => {
        throw new Error("approval-required promotion must not invoke provider-capable worker");
      },
    });
    expect(blocked).toMatchObject({
      mode: "canary",
      terminalOutcome: "approval_required",
      providerDispatchSuppressed: true,
      externalWrites: 0,
      opportunity: {
        opportunityId: "self-id-1500",
        platformId: "threads",
      },
    });

    const calls: Array<Record<string, unknown>> = [];
    const rendered = await ensureCampaignMediaForDate({
      registryPath: REGISTRY,
      integrationPath: integrationFixturePath,
      localDate: "2026-07-30",
      artifactRoot: join(root, "artifacts"),
      rendererEntrypoint,
      opportunityIds: ["self-id-1500"],
    });
    const mediaDelivery = bindCampaignMediaDelivery({
      artifact: rendered.artifacts[0]!,
      publicUrl: "https://cdn.example.com/campaign-factory/self-id-1500.png",
      uploadProvider: "test-public-media-staging",
      uploadReceipt: { provider: "test-public-media-staging", id: "upload-self-id-1500" },
      uploadedSha256: rendered.artifacts[0]!.sha256,
    });
    const approvedContentSpec = rendered.planned.find((item) => item.opportunityId === "self-id-1500")!.contentSpec;
    const approvedText = [
      approvedContentSpec.renderedIntent.hook,
      approvedContentSpec.renderedIntent.body,
      approvedContentSpec.renderedIntent.cta,
    ].join("\n\n");
    const promoted = await runCampaignFactoryScheduledCycle({
      ...common,
      databasePath: join(root, "publishing-approved.sqlite"),
      allowProviderWrite: true,
      mediaDelivery,
      toolInvoker: async (invocation) => {
        calls.push(invocation);
        if (invocation.tool === "relay_live_business_engagement_execute") {
          expect(invocation.args).toMatchObject({
            platform: "threads",
            accountKey: "threads:owner",
            campaignLaneId: "self-identification-engine",
            opportunityId: "self-id-1500",
            dryRun: false,
            explicitWriteApproval: true,
            imageUrl: "https://cdn.example.com/campaign-factory/self-id-1500.png",
            text: approvedText,
          });
          return { outcome: "success", providerId: "thread-canary-provider-id" };
        }
        if (invocation.tool === "relay_live_business_engagement_verify") {
          expect(invocation.args).toMatchObject({
            platform: "threads",
            accountKey: "threads:owner",
            relayAvailable: false,
          });
          return {
            outcome: "success",
            evidence: {
              verified: true,
              permalink: "https://www.threads.com/@tailwaggingwebdesigns/post/thread-canary-provider-id",
            },
          };
        }
        if (invocation.tool === "relay_live_business_engagement_discover") {
          return { performed: true, results: { data: [] } };
        }
        throw new Error(`unexpected tool ${invocation.tool}`);
      },
    });
    expect(promoted).toMatchObject({
      mode: "canary",
      terminalOutcome: "published_verified",
      opportunity: {
        result: "verified",
        providerId: "thread-canary-provider-id",
        externalWrites: 1,
      },
      externalWrites: 1,
    });
    expect(calls.map((call) => call.tool)).toContain("relay_live_business_engagement_execute");
    expect(calls.map((call) => call.tool)).toContain("relay_live_business_engagement_verify");
  });
});
