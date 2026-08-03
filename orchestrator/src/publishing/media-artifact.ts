import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256, stableId } from "./canonical.js";
import type { ContentSpec, PublishingRegistryBundle } from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/;
const REMOTE_REFERENCE = /(?:https?:\/\/|\/\/[a-z0-9.-]+\.[a-z]{2,})/i;

export type CampaignMediaFormat = "image" | "reel";

export type CampaignMediaArtifact = {
  schemaVersion: "1.0.0";
  id: string;
  artifactHash: string;
  immutable: true;
  contentSpecId: string;
  contentHash: string;
  platformId: string;
  accountId: string;
  format: CampaignMediaFormat;
  localPath: string;
  sha256: string;
  bytes: number;
  mimeType: "image/png" | "video/mp4";
  width: number;
  height: number;
  durationSeconds: number | null;
  renderer: {
    name: "HyperFrames";
    version: string;
    outboundHttpBlocked: true;
  };
  receiptPath: string;
  receiptSha256: string;
  verificationHash: string;
  externalWrites: 0;
};

export type CampaignMediaDelivery = {
  schemaVersion: "1.0.0";
  artifactId: string;
  artifactHash: string;
  contentSpecId: string;
  contentHash: string;
  format: CampaignMediaFormat;
  mediaSha256: string;
  publicUrl: string;
  uploadProvider: string;
  uploadReceiptHash: string;
};

type RendererReceipt = {
  schema?: unknown;
  outcome?: unknown;
  kind?: unknown;
  slug?: unknown;
  finalPath?: unknown;
  media?: Record<string, unknown>;
  renderer?: Record<string, unknown>;
  checks?: Record<string, unknown>;
  layoutVerification?: unknown;
  layoutAudit?: unknown;
  encodedFrameAudit?: unknown;
  externalMediaGenerationCalls?: unknown;
  generatedMediaUploadCalls?: unknown;
  instagramPublishCalls?: unknown;
};

function fileSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inside(root: string, candidate: string, label: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const pathFromRoot = relative(resolvedRoot, resolvedCandidate);
  if (!pathFromRoot || pathFromRoot === ".") return resolvedCandidate;
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error(`${label}_outside_artifact_root`);
  }
  return resolvedCandidate;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}_missing`);
  return value.trim();
}

function requiredNumber(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label}_invalid`);
  return number;
}

function requiredChecks(format: CampaignMediaFormat): string[] {
  return format === "image"
    ? ["hyperframes", "snapshot", "layoutVerification", "fullDecode", "temporaryWorkspaceCleaned"]
    : [
        "hyperframes",
        "highQualityRender",
        "audioFinishing",
        "fullDecode",
        "encodedFrameVisibility",
        "textFitAndSafeMargins",
        "contrast",
        "readingTime",
        "temporaryWorkspaceCleaned",
      ];
}

export async function artifactFromLocalRendererReceipt(input: {
  contentSpec: ContentSpec;
  receiptPath: string;
  artifactRoot: string;
}): Promise<CampaignMediaArtifact> {
  if (input.contentSpec.format === "text") throw new Error("text_content_has_no_media_artifact");
  const format = input.contentSpec.format;
  const receiptPath = inside(input.artifactRoot, input.receiptPath, "receipt");
  const receiptBytes = await readFile(receiptPath);
  const receipt = JSON.parse(receiptBytes.toString("utf8")) as RendererReceipt;
  if (
    receipt.schema !== "tailwagging-local-media-render-receipt.v1" ||
    receipt.outcome !== "success" ||
    receipt.kind !== format
  ) {
    throw new Error("local_renderer_receipt_not_successful");
  }
  for (const counter of [
    receipt.externalMediaGenerationCalls,
    receipt.generatedMediaUploadCalls,
    receipt.instagramPublishCalls,
  ]) {
    if (Number(counter ?? 0) !== 0) throw new Error("local_renderer_receipt_contains_external_write");
  }
  const checks = receipt.checks ?? {};
  const failedCheck = requiredChecks(format).find((check) => checks[check] !== true);
  if (failedCheck) throw new Error(`local_renderer_check_failed:${failedCheck}`);

  const localPath = inside(
    input.artifactRoot,
    requiredString(receipt.finalPath, "local_renderer_final_path"),
    "media",
  );
  const mediaBytes = await readFile(localPath);
  const mediaStat = await stat(localPath);
  if (!mediaStat.isFile() || mediaBytes.length === 0) throw new Error("local_media_file_empty");
  const media = receipt.media ?? {};
  const observedSha256 = fileSha256(mediaBytes);
  const receiptMediaSha256 = requiredString(media.sha256, "local_renderer_media_sha256");
  if (!SHA256.test(receiptMediaSha256) || observedSha256 !== receiptMediaSha256) {
    throw new Error("local_media_sha256_mismatch");
  }
  const receiptBytesCount = requiredNumber(media.bytes, "local_renderer_media_bytes");
  if (receiptBytesCount !== mediaBytes.length) throw new Error("local_media_bytes_mismatch");
  const width = requiredNumber(media.width, "local_renderer_media_width");
  const height = requiredNumber(media.height, "local_renderer_media_height");
  if (format === "image" && (width !== 1080 || height !== 1350)) {
    throw new Error("campaign_image_dimensions_invalid");
  }
  if (format === "reel" && (width / height < 0.54 || width / height > 0.59)) {
    throw new Error("campaign_reel_aspect_ratio_invalid");
  }
  const durationSeconds = format === "reel"
    ? requiredNumber(media.durationSeconds, "local_renderer_media_duration")
    : null;
  if (durationSeconds !== null && (durationSeconds < 3 || durationSeconds > 15)) {
    throw new Error("campaign_reel_duration_invalid");
  }
  const rendererName = requiredString(receipt.renderer?.name, "local_renderer_name");
  const rendererVersion = requiredString(receipt.renderer?.version, "local_renderer_version");
  if (
    rendererName !== "HyperFrames" ||
    receipt.renderer?.outboundHttpBlocked !== true
  ) {
    throw new Error("local_renderer_governance_invalid");
  }
  const verification = format === "image"
    ? { layoutVerification: receipt.layoutVerification, layoutAudit: receipt.layoutAudit, checks }
    : { layoutAudit: receipt.layoutAudit, encodedFrameAudit: receipt.encodedFrameAudit, checks };
  const unhashed = {
    schemaVersion: "1.0.0" as const,
    immutable: true as const,
    contentSpecId: input.contentSpec.id,
    contentHash: input.contentSpec.contentHash,
    platformId: input.contentSpec.platformId,
    accountId: input.contentSpec.accountId,
    format,
    localPath,
    sha256: observedSha256,
    bytes: mediaBytes.length,
    mimeType: format === "image" ? "image/png" as const : "video/mp4" as const,
    width,
    height,
    durationSeconds,
    renderer: {
      name: "HyperFrames" as const,
      version: rendererVersion,
      outboundHttpBlocked: true as const,
    },
    receiptPath,
    receiptSha256: fileSha256(receiptBytes),
    verificationHash: sha256(verification),
    externalWrites: 0 as const,
  };
  const artifactHash = sha256(unhashed);
  return {
    id: stableId("campaign_media", {
      contentSpecId: input.contentSpec.id,
      artifactHash,
    }),
    artifactHash,
    ...unhashed,
  };
}

export function bindCampaignMediaDelivery(input: {
  artifact: CampaignMediaArtifact;
  publicUrl: string;
  uploadProvider: string;
  uploadReceipt: unknown;
  uploadedSha256: string;
}): CampaignMediaDelivery {
  const url = new URL(input.publicUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  ) {
    throw new Error("campaign_media_delivery_url_not_public_https");
  }
  if (input.uploadedSha256 !== input.artifact.sha256) {
    throw new Error("campaign_media_delivery_hash_mismatch");
  }
  return {
    schemaVersion: "1.0.0",
    artifactId: input.artifact.id,
    artifactHash: input.artifact.artifactHash,
    contentSpecId: input.artifact.contentSpecId,
    contentHash: input.artifact.contentHash,
    format: input.artifact.format,
    mediaSha256: input.artifact.sha256,
    publicUrl: url.toString(),
    uploadProvider: requiredString(input.uploadProvider, "campaign_media_upload_provider"),
    uploadReceiptHash: sha256(input.uploadReceipt),
  };
}

export function renderedCandidateWithDelivery(
  contentSpec: ContentSpec,
  delivery?: CampaignMediaDelivery | null,
): { text: string; mediaUrl: string | null; mediaHash: string | null } {
  const text = `${contentSpec.renderedIntent.hook}\n\n${contentSpec.renderedIntent.body}\n\n${contentSpec.renderedIntent.cta}`;
  if (contentSpec.format === "text") return { text, mediaUrl: null, mediaHash: null };
  if (
    !delivery ||
    delivery.contentSpecId !== contentSpec.id ||
    delivery.contentHash !== contentSpec.contentHash ||
    delivery.format !== contentSpec.format
  ) {
    throw new Error("campaign_media_delivery_not_bound_to_content_spec");
  }
  return { text, mediaUrl: delivery.publicUrl, mediaHash: delivery.mediaSha256 };
}

function displayText(value: string | null | undefined, maxLength: number, fallback: string): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized && normalized.length <= maxLength && !REMOTE_REFERENCE.test(normalized)) return normalized;
  if (!fallback || fallback.length > maxLength || REMOTE_REFERENCE.test(fallback)) {
    throw new Error("campaign_media_fallback_copy_invalid");
  }
  return fallback;
}

function registryRecord<T extends { id: string }>(records: T[], id: string, label: string): T {
  const record = records.find((candidate) => candidate.id === id);
  if (!record) throw new Error(`campaign_media_registry_record_missing:${label}:${id}`);
  return record;
}

export function buildLocalRendererSpec(
  registry: PublishingRegistryBundle,
  contentSpec: ContentSpec,
): Record<string, unknown> | null {
  if (contentSpec.format === "text") return null;
  const product = registryRecord(registry.products, contentSpec.productId, "product");
  const campaign = registryRecord(registry.campaigns, contentSpec.campaignId, "campaign");
  const signal = registryRecord(registry.identitySignals, contentSpec.identitySignalIds[0]!, "identity_signal");
  const problem = registryRecord(registry.problemsOutcomes, contentSpec.problemOutcomeIds[0]!, "problem_outcome");
  const slug = `campaign-${contentSpec.id}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72);
  if (contentSpec.format === "image") {
    return {
      schema: "tailwagging-local-image-spec.v1",
      kind: "image",
      slug,
      kicker: displayText(product.name, 48, "Campaign self-identification"),
      eyebrow: displayText(campaign.name, 64, "A practical self-identification check"),
      headline: displayText(contentSpec.renderedIntent.hook, 96, "Does this situation feel familiar?"),
      body: displayText(contentSpec.renderedIntent.body, 180, "A recurring problem is easier to act on when the signal, friction and next step are made explicit."),
      items: [
        { label: "Signal", detail: displayText(signal.signal, 96, "A recurring situation worth checking.") },
        { label: "Problem", detail: displayText(problem.problem, 96, "The current path creates avoidable friction.") },
        { label: "Outcome", detail: displayText(problem.outcome, 96, "A clearer next step becomes easier to see.") },
      ],
      footer: displayText(contentSpec.renderedIntent.cta, 64, "Review the next useful step."),
    };
  }
  return {
    schema: "tailwagging-local-reel-spec.v1",
    kind: "reel",
    slug,
    visualVariant: "state-flow",
    audioProfile: "precise",
    conceptLabel: displayText(campaign.name, 42, "Campaign self-identification"),
    topline: displayText(product.name, 42, "Campaign self-identification"),
    eyebrow: "Self-identification",
    hookTitle: displayText(contentSpec.renderedIntent.hook, 52, "Does this situation feel familiar?"),
    hookBody: displayText(contentSpec.renderedIntent.body, 100, "A recurring problem becomes easier to assess when the signal and next step are explicit."),
    simplifyEyebrow: "Make the signal explicit",
    simplifyTitle: "Turn friction into a clear check.",
    brand: displayText(product.name, 32, "Campaign evidence"),
    problemTitle: "Recognise the recurring pattern",
    problemBody: displayText(problem.problem, 88, "The current path creates avoidable friction and makes the next decision harder."),
    problemFields: [
      "Recurring signal",
      "Visible friction",
      "Affected audience",
      "Evidence source",
      "Current constraint",
      "Useful outcome",
      "Next action",
    ],
    problemWarning: "Treat the pattern as a check, not as an unsupported claim.",
    stepsKicker: "Three bounded checks",
    stepsTitle: "Inspect before taking action",
    stepsBody: "Keep the signal, evidence and next step connected.",
    steps: [
      { label: "Signal", hint: "Name what is recurring." },
      { label: "Evidence", hint: "Keep the source attached." },
      { label: "Next step", hint: "Choose one useful action." },
    ],
    confirmationTitle: "The path is inspectable",
    confirmationBody: displayText(problem.outcome, 82, "A clearer next step is visible without overstating the evidence."),
    confirmationBadge: "Evidence kept attached",
    closingTag: "Practical next step",
    closingTitle: displayText(contentSpec.renderedIntent.cta, 50, "Review the next useful step."),
    closingBody: "Use the full caption for the evidence, context and governed call to action.",
    footer: displayText(campaign.name, 38, "Campaign content factory"),
  };
}

function runRenderer(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes <= 8 * 1024 * 1024) stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes <= 8 * 1024 * 1024) stderr.push(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const errorText = Buffer.concat(stderr).toString("utf8");
      if (outputBytes > 8 * 1024 * 1024) reject(new Error("local_media_renderer_output_limit_exceeded"));
      else if (code !== 0) reject(new Error(`local_media_renderer_failed:${code}:${errorText.slice(-1200)}`));
      else resolvePromise(Buffer.concat(stdout).toString("utf8"));
    });
  });
}

export async function renderCampaignMediaLocally(input: {
  registry: PublishingRegistryBundle;
  contentSpec: ContentSpec;
  artifactRoot: string;
  outputDir: string;
  nodeExecutable: string;
  rendererEntrypoint: string;
}): Promise<CampaignMediaArtifact | null> {
  const factorySpec = buildLocalRendererSpec(input.registry, input.contentSpec);
  if (!factorySpec) return null;
  const outputDir = inside(input.artifactRoot, input.outputDir, "campaign_media_output");
  const nodeExecutable = resolve(input.nodeExecutable);
  const rendererEntrypoint = resolve(input.rendererEntrypoint);
  await mkdir(outputDir, { recursive: true });
  const slug = requiredString(factorySpec.slug, "campaign_media_slug");
  let rendererSpec = factorySpec;
  if (input.contentSpec.format === "reel") {
    const libraryPath = resolve(
      dirname(rendererEntrypoint),
      "../lib/reel-creative-library.mjs",
    );
    const library = await import(pathToFileURL(libraryPath).href) as {
      compileReelStoryboard: (input: Record<string, unknown>) => Record<string, unknown>;
    };
    rendererSpec = library.compileReelStoryboard({
      slug,
      creativeId: "workflow-process-animation",
      recentTreatments: [],
      concept: {
        key: requiredString(factorySpec.conceptLabel, "campaign_media_concept_label"),
        headline: input.contentSpec.renderedIntent.hook,
        creativeBrief: {
          topics: ["governed-automation", "workflow"],
          storySignals: ["process", "evidence", "state"],
          preferredTreatments: ["workflow-process-animation"],
        },
      },
      script: {
        ...factorySpec,
        problemKicker: factorySpec.simplifyEyebrow,
      },
    });
  }
  const specPath = join(outputDir, `${slug}-campaign-media-spec.json`);
  await writeFile(specPath, `${JSON.stringify(rendererSpec, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await runRenderer(
    nodeExecutable,
    [rendererEntrypoint, input.contentSpec.format, "--spec", specPath, "--output-dir", outputDir],
    input.contentSpec.format === "reel" ? 1_200_000 : 300_000,
  );
  const receiptPath = join(outputDir, `${slug}-local-render-receipt.json`);
  const artifact = await artifactFromLocalRendererReceipt({
    contentSpec: input.contentSpec,
    receiptPath,
    artifactRoot: input.artifactRoot,
  });
  const artifactPath = join(outputDir, `${slug}-campaign-media-artifact.json`);
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  return artifact;
}

export async function loadCampaignMediaArtifact(
  artifactPath: string,
): Promise<CampaignMediaArtifact> {
  const artifact = JSON.parse(await readFile(resolve(artifactPath), "utf8")) as CampaignMediaArtifact;
  if (
    artifact.schemaVersion !== "1.0.0" ||
    artifact.immutable !== true ||
    !SHA256.test(artifact.artifactHash) ||
    artifact.artifactHash !== sha256({
      schemaVersion: artifact.schemaVersion,
      immutable: artifact.immutable,
      contentSpecId: artifact.contentSpecId,
      contentHash: artifact.contentHash,
      platformId: artifact.platformId,
      accountId: artifact.accountId,
      format: artifact.format,
      localPath: artifact.localPath,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      mimeType: artifact.mimeType,
      width: artifact.width,
      height: artifact.height,
      durationSeconds: artifact.durationSeconds,
      renderer: artifact.renderer,
      receiptPath: artifact.receiptPath,
      receiptSha256: artifact.receiptSha256,
      verificationHash: artifact.verificationHash,
      externalWrites: artifact.externalWrites,
    })
  ) {
    throw new Error(`campaign_media_artifact_invalid:${basename(artifactPath)}`);
  }
  return artifact;
}
