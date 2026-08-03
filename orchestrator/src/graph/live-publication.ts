import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { canonicalJson, sha256 } from "./reducer.js";
import type { JsonValue, NodeExecutionContext } from "./types.js";

export const LIVE_PUBLICATION_GRAPH_IDENTITY = "deterministic-social-publication@2.0.0";
export const INSTAGRAM_REEL_JOB_ID = "2c7071ff-35dd-40d0-bf77-b1ed53de256e";
export const INSTAGRAM_IMAGE_JOB_ID = "24afbb84-457c-41bb-92c9-24a19725e984";

export const LivePublicationInputSchema = z.object({
  provider: z.literal("instagram"),
  accountKey: z.literal("instagram:owner"),
  expectedAccountId: z.string().min(1),
  jobId: z.enum([INSTAGRAM_REEL_JOB_ID, INSTAGRAM_IMAGE_JOB_ID]),
  kind: z.enum(["reel", "image"]),
  observedAt: z.string().datetime({ offset: true }),
  shadowMode: z.boolean(),
  maximumProviderMutations: z.literal(1),
}).strict();

export const PublicationProjectionSchema = z.object({
  outboxId: z.string().nullable(),
  provider: z.literal("instagram"),
  accountKey: z.literal("instagram:owner"),
  representedAccountId: z.string().nullable(),
  jobId: z.string().nullable(),
  kind: z.enum(["reel", "image"]).nullable(),
  publicationType: z.string().nullable(),
  localDate: z.string().nullable(),
  slot: z.string().nullable(),
  candidateId: z.string().nullable(),
  campaignId: z.string().nullable(),
  sequenceId: z.string().nullable(),
  policyVersion: z.string().nullable(),
  caption: z.string().nullable(),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  mediaPath: z.string().nullable(),
  mediaSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  mediaSizeBytes: z.number().int().nonnegative().nullable(),
  mimeType: z.string(),
  contentSpecSha256: z.string().nullable(),
  materialContentSha256: z.string().nullable(),
  storyboardSha256: z.string().nullable(),
  creativeFingerprint: z.string().nullable(),
  rendererVersion: z.string().nullable(),
  layoutVerification: z.record(z.unknown()).nullable(),
  layoutVerificationSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  claim: z.record(z.unknown()).nullable(),
  providerResultId: z.string().nullable(),
  permalink: z.string().nullable(),
  status: z.string().nullable(),
  verification: z.record(z.unknown()).nullable(),
  generatedMediaUploadCalls: z.number().int().nonnegative(),
  instagramPublishCalls: z.number().int().nonnegative(),
  browserRelayCalls: z.literal(0),
}).strict();

export type LivePublicationInput = z.infer<typeof LivePublicationInputSchema>;
export type PublicationProjection = z.infer<typeof PublicationProjectionSchema>;

export type FrozenPublicationEnvelope = {
  graphId: "deterministic-social-publication";
  graphVersion: "2.0.0";
  definitionHash: string;
  graphRunId: string;
  claimId: string;
  provider: "instagram";
  providerApiVersion: string;
  accountId: string;
  accountKey: "instagram:owner";
  publicationType: string;
  candidateId: string;
  campaignId: string;
  sequenceId: string;
  slotId: string;
  europeLondonTimestamp: string;
  canonicalPayload: { caption: string };
  payloadSha256: string;
  mediaPath: string;
  mediaSha256: string;
  mediaSizeBytes: number;
  mimeType: string;
  layoutVerification: Record<string, unknown> | null;
  layoutVerificationSha256: string | null;
  providerTarget: string;
  idempotencyKey: string;
  authorityClass: "external_public";
  approvalId: string;
  approvalExpiry: string;
  maximumProviderMutations: 1;
  verificationAssertions: string[];
  compensationPolicy: string;
  preparationLineage: {
    jobId: string;
    contentSpecSha256: string;
    materialContentSha256: string;
    storyboardSha256: string | null;
    creativeFingerprint: string | null;
    rendererVersion: string | null;
  };
};

type InstagramRunnerModule = {
  runOpportunity(jobId: string, kind: "reel" | "image", options: Record<string, unknown>): Promise<{ entry: unknown; existing?: boolean }>;
  instagramGraphPublicationProjection(entry: unknown): Promise<unknown>;
  bindInstagramGraphPublicationEnvelope(args: Record<string, unknown>): Promise<unknown>;
  releaseInstagramGraphPublicationClaim(args: Record<string, unknown>): Promise<unknown>;
  reconcileInstagramOutboxEntry(outboxId: string): Promise<unknown>;
  readBackVerifiedInstagramGraphPublication(args: Record<string, unknown>): Promise<unknown>;
};

export async function loadInstagramRunner(): Promise<InstagramRunnerModule> {
  const path = resolve(
    process.env.OPENCLAW_INSTAGRAM_PUBLISHER_RUNNER_PATH ||
      "/home/oneclickwebsitedesignfactory/.openclaw/workspace/scripts/instagram-publisher-outbox-runner.mjs",
  );
  if (!existsSync(path)) throw new Error("canonical_instagram_runner_missing");
  const module = await import(pathToFileURL(path).href) as Partial<InstagramRunnerModule>;
  for (const symbol of [
    "runOpportunity",
    "instagramGraphPublicationProjection",
    "bindInstagramGraphPublicationEnvelope",
    "releaseInstagramGraphPublicationClaim",
    "reconcileInstagramOutboxEntry",
    "readBackVerifiedInstagramGraphPublication",
  ] as const) {
    if (typeof module[symbol] !== "function") throw new Error(`canonical_instagram_runner_contract_missing:${symbol}`);
  }
  return module as InstagramRunnerModule;
}

export function definitionHash(context: NodeExecutionContext): string {
  return sha256(context.definition);
}

export function graphClaimId(context: NodeExecutionContext, input: LivePublicationInput): string {
  return `gclaim_${sha256({ runId: context.run.runId, definition: LIVE_PUBLICATION_GRAPH_IDENTITY, provider: input.provider, jobId: input.jobId, kind: input.kind }).slice(0, 32)}`;
}

export function graphAuthorization(context: NodeExecutionContext, input: LivePublicationInput, extras: Record<string, JsonValue> = {}): Record<string, JsonValue> {
  return {
    runId: context.run.runId,
    definition: LIVE_PUBLICATION_GRAPH_IDENTITY,
    definitionHash: definitionHash(context),
    claimId: graphClaimId(context, input),
    leaseExpiresAt: new Date(Date.parse(input.observedAt) + 2 * 60 * 60 * 1000).toISOString(),
    ...extras,
  };
}

export function buildFrozenPublicationEnvelope(
  context: NodeExecutionContext,
  input: LivePublicationInput,
  projection: PublicationProjection,
): FrozenPublicationEnvelope {
  const required = {
    accountId: projection.representedAccountId,
    publicationType: projection.publicationType,
    candidateId: projection.candidateId,
    campaignId: projection.campaignId,
    sequenceId: projection.sequenceId,
    localDate: projection.localDate,
    slot: projection.slot,
    caption: projection.caption,
    payloadSha256: projection.payloadSha256,
    mediaPath: projection.mediaPath,
    mediaSha256: projection.mediaSha256,
    mediaSizeBytes: projection.mediaSizeBytes,
    jobId: projection.jobId,
    contentSpecSha256: projection.contentSpecSha256,
    materialContentSha256: projection.materialContentSha256,
  };
  for (const [key, value] of Object.entries(required)) {
    if (value === null || value === "") throw new Error(`publication_envelope_field_missing:${key}`);
  }
  if (projection.representedAccountId !== input.expectedAccountId) throw new Error("publication_envelope_account_mismatch");
  if (projection.jobId !== input.jobId || projection.kind !== input.kind) throw new Error("publication_envelope_candidate_scope_mismatch");
  if (
    input.kind === "image" &&
    (projection.layoutVerification?.status !== "passed" ||
      !projection.layoutVerificationSha256 ||
      projection.layoutVerification?.finalMediaSha256 !== projection.mediaSha256)
  ) {
    throw new Error("publication_envelope_image_layout_verification_missing");
  }
  const providerTarget = `instagram:${input.expectedAccountId}`;
  const core = {
    graphId: "deterministic-social-publication" as const,
    graphVersion: "2.0.0" as const,
    definitionHash: definitionHash(context),
    graphRunId: context.run.runId,
    claimId: graphClaimId(context, input),
    provider: "instagram" as const,
    providerApiVersion: "v25.0",
    accountId: projection.representedAccountId!,
    accountKey: "instagram:owner" as const,
    publicationType: projection.publicationType!,
    candidateId: projection.candidateId!,
    campaignId: projection.campaignId!,
    sequenceId: projection.sequenceId!,
    slotId: `instagram:${projection.localDate}:${projection.slot}:${input.jobId}`,
    europeLondonTimestamp: `${projection.localDate}T${projection.slot}:00+01:00`,
    canonicalPayload: { caption: projection.caption! },
    payloadSha256: projection.payloadSha256!,
    mediaPath: projection.mediaPath!,
    mediaSha256: projection.mediaSha256!,
    mediaSizeBytes: projection.mediaSizeBytes!,
    mimeType: projection.mimeType,
    layoutVerification: projection.layoutVerification,
    layoutVerificationSha256: projection.layoutVerificationSha256,
    providerTarget,
    idempotencyKey: sha256({ providerTarget, candidateId: projection.candidateId, payloadSha256: projection.payloadSha256, mediaSha256: projection.mediaSha256 }),
    authorityClass: "external_public" as const,
    approvalExpiry: new Date(Date.parse(input.observedAt) + 90 * 60 * 1000).toISOString(),
    maximumProviderMutations: 1 as const,
    verificationAssertions: [
      "official-provider-readback",
      "exact-account",
      "exact-payload-hash",
      "exact-media-hash",
      "single-provider-object",
      "local-state-committed",
      "candidate-claim-finalised",
      "event-chain-valid",
      ...(input.kind === "image"
        ? ["layout-semantic-completeness", "layout-geometric-validity"]
        : []),
    ],
    compensationPolicy: "reconcile_first_delete_only_wrong_account_materially_incorrect_or_duplicate",
    preparationLineage: {
      jobId: projection.jobId!,
      contentSpecSha256: projection.contentSpecSha256!,
      materialContentSha256: projection.materialContentSha256!,
      storyboardSha256: projection.storyboardSha256,
      creativeFingerprint: projection.creativeFingerprint,
      rendererVersion: projection.rendererVersion,
    },
  };
  const approvalId = `gap_${sha256({ runId: context.run.runId, nodeId: "publish_provider_object", action: "production.instagram-publication-live.v2", target: providerTarget, envelopeCoreHash: sha256(core) }).slice(0, 32)}`;
  return Object.freeze({ ...core, approvalId });
}

export function frozenEnvelopeHash(envelope: FrozenPublicationEnvelope): string {
  return sha256(envelope);
}

export function assertEnvelopeUnchanged(left: FrozenPublicationEnvelope, right: FrozenPublicationEnvelope): void {
  if (canonicalJson(left) !== canonicalJson(right)) throw new Error("publication_envelope_immutable_violation");
}
