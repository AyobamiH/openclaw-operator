import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  artifactFromLocalRendererReceipt,
  bindCampaignMediaDelivery,
  buildLocalRendererSpec,
  parseCampaignMediaDelivery,
  renderedCandidateWithDelivery,
} from "../src/publishing/media-artifact.js";
import { planCampaignFactoryContentForDate } from "../src/publishing/campaign-factory.js";
import { loadProductionIntegration } from "../src/publishing/production-integration.js";
import { loadRegistryBundle } from "../src/publishing/registry.js";

const REGISTRY = "../config/publishing/registry.v1.json";
const INTEGRATION = "../config/publishing/production-integration.v1.json";
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function plannedImage() {
  const registry = await loadRegistryBundle(REGISTRY);
  const integration = await loadProductionIntegration(INTEGRATION, registry);
  const planned = planCampaignFactoryContentForDate({
    registry,
    integration,
    localDate: "2026-08-03",
  });
  const image = planned.find((item) => item.contentSpec.format === "image");
  if (!image) throw new Error("fixture image content was not planned");
  return { registry, contentSpec: image.contentSpec };
}

describe("campaign media artifacts", () => {
  it("compiles stable bounded renderer specs from immutable ContentSpec input", async () => {
    const { registry, contentSpec } = await plannedImage();
    const first = buildLocalRendererSpec(registry, contentSpec);
    const second = buildLocalRendererSpec(registry, contentSpec);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schema: "tailwagging-local-image-spec.v1",
      kind: "image",
    });
    expect(JSON.stringify(first)).not.toContain("http://");
    expect(JSON.stringify(first)).not.toContain("https://");
  });

  it("keeps internal ContentSpec identifiers out of public Reel concept labels", async () => {
    const registry = await loadRegistryBundle(REGISTRY);
    const integration = await loadProductionIntegration(INTEGRATION, registry);
    const reel = planCampaignFactoryContentForDate({ registry, integration, localDate: "2026-08-03" })
      .find((item) => item.contentSpec.format === "reel");
    if (!reel) throw new Error("fixture Reel content was not planned");
    const spec = buildLocalRendererSpec(registry, reel.contentSpec);
    expect(spec?.conceptLabel).toBeTypeOf("string");
    expect(spec?.conceptLabel).not.toContain(reel.contentSpec.id);
  });

  it("freezes verified local bytes and binds only a matching durable public delivery", async () => {
    const { contentSpec } = await plannedImage();
    const root = await mkdtemp(join(tmpdir(), "campaign-media-artifact-"));
    tempRoots.push(root);
    const outputDir = join(root, "2026-08-03", "self-id-1700");
    await mkdir(outputDir, { recursive: true });
    const mediaPath = join(outputDir, "fixture.png");
    const receiptPath = join(outputDir, "fixture-local-render-receipt.json");
    const mediaBytes = Buffer.from("deterministic-png-fixture");
    const mediaSha256 = createHash("sha256").update(mediaBytes).digest("hex");
    await writeFile(mediaPath, mediaBytes);
    await writeFile(receiptPath, `${JSON.stringify({
      schema: "tailwagging-local-media-render-receipt.v1",
      outcome: "success",
      kind: "image",
      slug: "fixture",
      finalPath: mediaPath,
      media: { width: 1080, height: 1350, codec: "png", bytes: mediaBytes.length, sha256: mediaSha256 },
      renderer: { name: "HyperFrames", version: "1.8.8", outboundHttpBlocked: true },
      checks: {
        hyperframes: true,
        snapshot: true,
        layoutVerification: true,
        fullDecode: true,
        temporaryWorkspaceCleaned: true,
      },
      layoutVerification: { status: "passed", finalMediaSha256: mediaSha256 },
      layoutAudit: { measured: true },
      externalMediaGenerationCalls: 0,
      generatedMediaUploadCalls: 0,
      instagramPublishCalls: 0,
    })}\n`);

    const artifact = await artifactFromLocalRendererReceipt({
      contentSpec,
      receiptPath,
      artifactRoot: root,
    });
    expect(artifact).toMatchObject({
      immutable: true,
      contentSpecId: contentSpec.id,
      contentHash: contentSpec.contentHash,
      sha256: mediaSha256,
      mimeType: "image/png",
      externalWrites: 0,
    });
    const delivery = bindCampaignMediaDelivery({
      artifact,
      publicUrl: "https://media.example.invalid/campaign/fixture.png",
      uploadProvider: "generated-media-delivery",
      uploadReceipt: { id: "upload_fixture", sourceSha256: mediaSha256 },
      uploadedSha256: mediaSha256,
    });
    expect(renderedCandidateWithDelivery(contentSpec, delivery)).toMatchObject({
      mediaUrl: delivery.publicUrl,
      mediaHash: mediaSha256,
    });
    expect(parseCampaignMediaDelivery(JSON.parse(JSON.stringify(delivery)))).toEqual(delivery);
    expect(() => parseCampaignMediaDelivery({
      ...delivery,
      mediaSha256: "changed",
    })).toThrow("campaign_media_delivery_media_hash_invalid");
    expect(() => renderedCandidateWithDelivery(contentSpec, null)).toThrow(
      "campaign_media_delivery_not_bound_to_content_spec",
    );
    expect(() => bindCampaignMediaDelivery({
      artifact,
      publicUrl: "http://127.0.0.1/media.png",
      uploadProvider: "generated-media-delivery",
      uploadReceipt: {},
      uploadedSha256: mediaSha256,
    })).toThrow("campaign_media_delivery_url_not_public_https");
  });
});
