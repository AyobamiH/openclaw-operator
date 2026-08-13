import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ProductionAdapterRegistry } from "./adapter-registry.js";
import { failure } from "./failures.js";
import { sha256 } from "./reducer.js";
import type { JsonValue, NodeExecutionContext, NodeExecutionResult } from "./types.js";
import type { GraphStore } from "./store.js";
import { prepareProductionPublishingShadowDecision, ShadowDecisionEnvelopeSchema } from "../publishing/shadow-equivalence.js";
import {
  assertEnvelopeUnchanged,
  buildFrozenPublicationEnvelope,
  frozenEnvelopeHash,
  graphAuthorization,
  LivePublicationInputSchema,
  loadInstagramRunner,
  PublicationProjectionSchema,
  type LivePublicationInput,
  type PublicationProjection,
  type FrozenPublicationEnvelope,
} from "./live-publication.js";
import { expectedCapabilityBindings } from "./live-capability.js";
import type { GraphChildRunCoordinator } from "./child-runs.js";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = "/home/oneclickwebsitedesignfactory/.openclaw/workspace/projects";

function boundedRepositoryPath(candidate: string): string {
  const path = resolve(candidate);
  if (path !== PROJECT_ROOT && !path.startsWith(`${PROJECT_ROOT}${sep}`)) throw new Error("production_repository_path_outside_workspace_projects");
  return path;
}

async function git(repositoryPath: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", repositoryPath, ...args], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  return String(result.stdout ?? "").trim();
}

const RepoInputSchema = z.object({ repositoryPath: z.string().min(1) }).passthrough();
const RepoOutputSchema = z.object({ repositoryPath: z.string(), head: z.string(), branch: z.string(), dirty: z.boolean(), statusHash: z.string().regex(/^[a-f0-9]{64}$/), diffHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const CommandOutputSchema = z.object({ action: z.string(), exitCode: z.number().int(), outputHash: z.string().regex(/^[a-f0-9]{64}$/), skipped: z.boolean() }).strict();
const ChildRunInputSchema = z.object({ repositoryPath: z.string().min(1), childPayload: z.record(z.unknown()).optional(), verifierPayload: z.record(z.unknown()).optional() }).passthrough();
const ChildRunOutputSchema = z.object({ status: z.string(), childRunId: z.string(), childReceiptHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(), verifierRunId: z.string().optional(), verifierReceiptHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(), chainValid: z.boolean().optional() }).passthrough();
const GovernedTaskInputSchema = z.object({
  lane: z.enum([
    "business-value",
    "market-research",
    "git-monitor",
    "campaign-factory",
    "content-generation",
    "qa-verification",
    "system-monitor",
    "digest",
  ]),
  taskType: z.string().min(1),
  agentId: z.string().min(1),
  payload: z.record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.unknown()), z.record(z.unknown())])).default({}),
}).passthrough();
const GovernedTaskOutputSchema = z.object({
  status: z.string(), lane: z.string(), childRunId: z.string().optional(),
  childReceiptHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(), verifierRunId: z.string().optional(),
  verifierReceiptHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(), chainValid: z.boolean().optional(),
}).passthrough();

const ThreadsGraphInputSchema = z.object({
  provider: z.literal("threads"), accountKey: z.literal("threads:owner"),
  jobId: z.enum(["68b10c5c-f604-4567-9213-d0d1eab08106", "083e3560-40fd-4487-9d78-674f64866ef7"]),
  observedAt: z.string().datetime({ offset: true }), shadowMode: z.boolean(), maximumProviderMutations: z.literal(1),
}).strict();
const MetaReplyGraphInputSchema = z.object({
  provider: z.literal("meta"), accountKey: z.literal("meta:owner"), jobId: z.literal("4de811aa-f213-4cc3-b1aa-6c2cffb6a847"),
  observedAt: z.string().datetime({ offset: true }), shadowMode: z.boolean(), maximumProviderMutations: z.literal(1),
}).strict();
const ThreadsReadinessInputSchema = z.object({
  provider: z.literal("threads"), accountKey: z.literal("threads:owner"),
  jobId: z.literal("abb3e214-0ff6-4813-a18d-6d8ffb9080ad"),
  observedAt: z.string().datetime({ offset: true }), shadowMode: z.literal(true), maximumProviderMutations: z.literal(0),
}).strict();
const ThreadsReadinessOutputSchema = z.object({ outcome: z.literal("complete"), preparationHorizonHours: z.number().int().positive(), repairAttemptsMaximum: z.number().int().nonnegative(), providerWrites: z.literal(0), browserRelayCalls: z.literal(0), opportunity: z.record(z.unknown()), attempts: z.array(z.record(z.unknown())).optional(), runnerSummary: z.string() }).strict();
const SocialPreparationOutputSchema = z.object({
  status: z.string(), action: z.enum(["publish", "reply", "skip", "shadow"]), outboxId: z.string().nullable(), payloadHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  targetId: z.string().nullable(), approvalId: z.string().nullable(), topicTag: z.string().nullable(), mediaPath: z.string().nullable(),
  mediaHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), mediaBytesHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  creativeFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(), layoutReceipt: z.record(z.unknown()).nullable(),
  layoutReceiptHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), rendererIdentity: z.record(z.unknown()).nullable(),
  rendererIdentityHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), providerWrites: z.literal(0), browserRelayCalls: z.literal(0),
}).strict();
const SocialMutationOutputSchema = z.object({ status: z.string(), outboxId: z.string(), providerResultId: z.string().nullable(), permalink: z.string().nullable(), providerWrites: z.number().int().min(0).max(1), browserRelayCalls: z.literal(0) }).strict();
const SocialReadbackOutputSchema = z.object({ status: z.string(), outboxId: z.string(), verified: z.boolean(), providerResultId: z.string().nullable(), permalink: z.string().nullable(), providerWrites: z.literal(0), browserRelayCalls: z.literal(0) }).strict();

type ThreadsRunnerModule = {
  runOpportunity(jobId: string, options: Record<string, unknown>): Promise<{ entry: Record<string, any>; state?: unknown; preparedOnly?: boolean; readinessOnly?: boolean }>;
  reconcileOutboxEntry(outboxId: string): Promise<{ entry: Record<string, any> }>;
};
type MetaReplyRunnerModule = {
  runMonitor(options: Record<string, unknown>): Promise<{ entry: Record<string, any>; preparedOnly?: boolean }>;
  executePreparedReply(runId: string, options?: Record<string, unknown>): Promise<{ entry: Record<string, any> }>;
  reconcileReceiptOnly(runId: string): Promise<{ entry: Record<string, any> }>;
};
type ThreadsReadinessModule = {
  prepareNextThreadsOpportunity(now: Date): Record<string, unknown> | Promise<Record<string, unknown>>;
};
async function loadWorkspaceModule<T>(configured: string | undefined, fallback: string, symbols: string[]): Promise<T> {
  const path = resolve(configured || fallback);
  if (!existsSync(path)) throw new Error(`canonical_social_runner_missing:${path}`);
  const module = await import(pathToFileURL(path).href) as Record<string, unknown>;
  for (const symbol of symbols) if (typeof module[symbol] !== "function") throw new Error(`canonical_social_runner_contract_missing:${symbol}`);
  return module as T;
}
const loadThreadsRunner = () => loadWorkspaceModule<ThreadsRunnerModule>(process.env.OPENCLAW_THREADS_RUNNER_PATH, "/home/oneclickwebsitedesignfactory/.openclaw/workspace/scripts/threads-outbox-runner.mjs", ["runOpportunity", "reconcileOutboxEntry"]);
const loadMetaReplyRunner = () => loadWorkspaceModule<MetaReplyRunnerModule>(process.env.OPENCLAW_META_REPLY_RUNNER_PATH, "/home/oneclickwebsitedesignfactory/.openclaw/workspace/scripts/meta-reply-monitor-outbox-runner.mjs", ["runMonitor", "executePreparedReply", "reconcileReceiptOnly"]);
const loadThreadsReadiness = () => loadWorkspaceModule<ThreadsReadinessModule>(process.env.OPENCLAW_THREADS_READINESS_PREPARER_PATH, "/home/oneclickwebsitedesignfactory/.openclaw/workspace/scripts/threads-readiness-preparer.mjs", ["prepareNextThreadsOpportunity"]);

export async function reconcilePriorMetaReplyGraphEffects(
  graphStore: GraphStore,
  runner: MetaReplyRunnerModule,
  options: { target?: string; excludeRunId?: string } = {},
): Promise<Array<{ runId: string; effectId: string; outboxId: string; state: "effect_verified" | "confirmed_absent" }>> {
  const reconciled: Array<{ runId: string; effectId: string; outboxId: string; state: "effect_verified" | "confirmed_absent" }> = [];
  for (const priorRun of graphStore.listRuns({ graphId: "meta-reply-monitor", limit: 250 })) {
    if (priorRun.runId === options.excludeRunId) continue;
    const outboxId = String((priorRun.data.socialEffect as Record<string, unknown> | undefined)?.outboxId ?? "");
    if (!outboxId) continue;
    for (const effect of graphStore.externalEffects(priorRun.runId)) {
      if (
        effect.operationType !== "production.meta-reply-live.v1" ||
        !["request_sent", "provider_accepted", "ambiguous"].includes(effect.state) ||
        (options.target && effect.target !== options.target)
      ) continue;
      const result = await runner.reconcileReceiptOnly(outboxId);
      const entry = result.entry ?? {};
      const providerWrites = Number(entry.externalWriteCount ?? 0);
      const providerResultId = entry.providerResultId ? String(entry.providerResultId) : undefined;
      const receiptHash = String(entry.reconciliationReceiptSha256 ?? "");
      const receiptPath = String(entry.reconciliationReceiptPath ?? "");
      let state: "effect_verified" | "confirmed_absent" | null = null;
      if (entry.status === "verified" && providerWrites === 1 && providerResultId) state = "effect_verified";
      if (
        entry.status === "confirmed_failure" &&
        entry.providerReconciled === true &&
        providerWrites === 0 &&
        /^[a-f0-9]{64}$/.test(receiptHash) &&
        receiptPath.length > 0
      ) state = "confirmed_absent";
      if (!state) continue;
      const evidenceRefs = [receiptPath, receiptHash].filter(Boolean);
      graphStore.reconcileEffect(priorRun.runId, effect.effectId, state, providerResultId, evidenceRefs);
      const latest = graphStore.getRun(priorRun.runId);
      if (!latest) throw new Error(`meta_reply_prior_graph_run_missing:${priorRun.runId}`);
      graphStore.saveRun({
        ...latest,
        externalEffects: graphStore.externalEffects(priorRun.runId),
        updatedAt: new Date().toISOString(),
      }, latest.revision, [{
        type: state === "effect_verified" ? "external_effect_verified" : "external_effect_reconciled",
        nodeId: effect.nodeId,
        actor: "adapter:production.meta-reply-live.v1",
        payload: { effectId: effect.effectId, state, providerOperationId: providerResultId ?? null, evidenceRefs },
      }]);
      reconciled.push({ runId: priorRun.runId, effectId: effect.effectId, outboxId, state });
    }
  }
  return reconciled;
}

function socialDispatchGate(graphStore: GraphStore, context: NodeExecutionContext) {
  if (!context.liveCapability) throw new Error("social_live_capability_missing");
  const capability = graphStore.oneRunLiveCapability(context.liveCapability.capabilityId);
  if (!capability) throw new Error("social_live_capability_not_found");
  const { capabilityId: _capabilityId, status: _status, issuedAt: _issuedAt, notBefore: _notBefore, expiresAt: _expiresAt, issuedBy: _issuedBy, consumedAt: _consumedAt, revokedAt: _revokedAt, failureReason: _failureReason, ...expected } = capability;
  const effect = context.run.externalEffects.find((item) => item.nodeId === context.node.id && item.idempotencyKey === context.idempotencyKey);
  if (!effect) throw new Error("social_external_effect_intent_missing");
  return {
    reserve: (stepId: string, expectedOperation: string) => graphStore.reserveLiveCapabilityDispatch({ capabilityId: capability.capabilityId, stepId, expectedOperation, effectId: effect.effectId, expected, globalZeroWrite: true, actor: `adapter:${context.node.handler}` }),
    complete: (stepId: string, state: "succeeded" | "confirmed_absent" | "ambiguous" | "failed", evidence: { providerOperationId?: unknown; error?: unknown; outcome?: unknown } = {}) => graphStore.completeLiveCapabilityDispatch({ capabilityId: capability.capabilityId, stepId, state, providerOperationId: evidence.providerOperationId ? String(evidence.providerOperationId) : undefined, failureReason: evidence.error ? String(evidence.error) : state === "succeeded" ? undefined : evidence.outcome ? String(evidence.outcome) : state, actor: `adapter:${context.node.handler}` }),
  };
}

const CANONICAL_LOCAL_MEDIA_RENDERER = "/home/oneclickwebsitedesignfactory/.openclaw/workspace/projects/relay-live-business-engagement-connector/local-media-renderer/bin/local-media-renderer.mjs";

async function fileSha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function socialPreparation(entry: Record<string, any>, input: { shadowMode: boolean }, effect: "publish" | "reply"): Promise<z.infer<typeof SocialPreparationOutputSchema>> {
  const status = String(entry?.status ?? "unknown");
  const actionable = effect === "publish"
    ? ["prepared", "reserved", "render_validated"].includes(status)
    : status === "prepared_reply";
  const text = effect === "publish" ? entry?.selection?.text : entry?.draft;
  const imagePublication = effect === "publish" && actionable && entry?.selection?.mediaType === "IMAGE";
  let mediaPath: string | null = null;
  let mediaHash: string | null = null;
  let mediaBytesHash: string | null = null;
  let topicTag: string | null = null;
  let creativeFingerprint: string | null = null;
  let layoutReceipt: Record<string, unknown> | null = null;
  let layoutReceiptHash: string | null = null;
  let rendererIdentity: Record<string, unknown> | null = null;
  let rendererIdentityHash: string | null = null;
  if (imagePublication) {
    mediaPath = typeof entry?.mediaPath === "string" ? entry.mediaPath : null;
    mediaHash = typeof entry?.mediaSha256 === "string" ? entry.mediaSha256 : null;
    topicTag = typeof entry?.selection?.topicTag === "string" ? entry.selection.topicTag : null;
    creativeFingerprint = typeof entry?.selection?.creativeFingerprint === "string" ? entry.selection.creativeFingerprint : null;
    layoutReceipt = entry?.rendererReceipt && typeof entry.rendererReceipt === "object" ? structuredClone(entry.rendererReceipt) : null;
    if (!mediaPath || !mediaHash || !topicTag || !creativeFingerprint || !layoutReceipt) throw new Error("threads_graph_image_proof_binding_incomplete");
    if (layoutReceipt.checks && typeof layoutReceipt.checks === "object") {
      const checks = layoutReceipt.checks as Record<string, unknown>;
      if (checks.fullDecode !== true || checks.textFitAndSafeMargins !== true || checks.contrast !== true) throw new Error("threads_graph_image_layout_receipt_invalid");
    } else throw new Error("threads_graph_image_layout_receipt_missing_checks");
    mediaBytesHash = await fileSha256(mediaPath);
    if (mediaBytesHash !== mediaHash) throw new Error("threads_graph_image_bytes_changed_before_approval");
    layoutReceiptHash = sha256(layoutReceipt);
    rendererIdentity = {
      source: CANONICAL_LOCAL_MEDIA_RENDERER,
      sourceSha256: await fileSha256(CANONICAL_LOCAL_MEDIA_RENDERER),
      version: String((layoutReceipt.renderer as Record<string, unknown> | undefined)?.version ?? layoutReceipt.rendererVersion ?? layoutReceipt.version ?? "canonical-local-media-renderer"),
    };
    rendererIdentityHash = sha256(rendererIdentity);
  }
  return {
    status,
    action: !actionable ? "skip" : input.shadowMode ? "shadow" : effect,
    outboxId: entry?.id ? String(entry.id) : entry?.runId ? String(entry.runId) : null,
    payloadHash: typeof text === "string" && text.length > 0 ? sha256(text) : null,
    targetId: effect === "reply" && entry?.selectedCandidate?.id ? String(entry.selectedCandidate.id) : null,
    approvalId: entry?.selection?.approval?.approvalId ? String(entry.selection.approval.approvalId) : null,
    topicTag,
    mediaPath,
    mediaHash,
    mediaBytesHash,
    creativeFingerprint,
    layoutReceipt,
    layoutReceiptHash,
    rendererIdentity,
    rendererIdentityHash,
    providerWrites: 0,
    browserRelayCalls: 0,
  };
}

function isReadSideProviderFailure(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /Provider request failed with HTTP (?:4\d\d|5\d\d)|http.?4\d\d|http.?5\d\d|rate.?limit|timeout|transport|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(text);
}

function zeroWriteSocialSkip(status: string): z.infer<typeof SocialPreparationOutputSchema> {
  return {
    status,
    action: "skip",
    outboxId: null,
    payloadHash: null,
    targetId: null,
    approvalId: null,
    topicTag: null,
    mediaPath: null,
    mediaHash: null,
    mediaBytesHash: null,
    creativeFingerprint: null,
    layoutReceipt: null,
    layoutReceiptHash: null,
    rendererIdentity: null,
    rendererIdentityHash: null,
    providerWrites: 0,
    browserRelayCalls: 0,
  };
}

const PublishingInputSchema = z.object({
  integrationPath: z.string().min(1), registryPath: z.string().min(1), opportunityId: z.string().min(1), observedAt: z.string().datetime({ offset: true }), shadowMode: z.literal(true),
  authorityAllowed: z.boolean().optional(), effectState: z.enum(["none", "verified", "ambiguous", "duplicate"]).optional(), forcePolicyRejection: z.boolean().optional(), forceMissingCampaign: z.boolean().optional(), forceMalformedPayload: z.boolean().optional(),
}).passthrough();

const ResearchInputSchema = z.object({
  sources: z.array(z.object({ id: z.string().min(1), uri: z.string().min(1), quality: z.enum(["accepted", "rejected"]).default("accepted") }).passthrough()),
  claims: z.array(z.object({ id: z.string().min(1), text: z.string().optional(), sourceRefs: z.array(z.string()) }).passthrough()),
  resultSetHash: z.string().optional(),
}).passthrough();
const ResearchOutputSchema = z.object({ sourceCount: z.number().int(), claimCount: z.number().int(), unsupportedClaimIds: z.array(z.string()), rejectedSourceIds: z.array(z.string()), resultSetHash: z.string().regex(/^[a-f0-9]{64}$/), marginalInformationGain: z.number() }).strict();
const LivePreparationOutputSchema = z.object({
  status: z.enum(["previewed", "prepared", "blocked"]),
  projection: PublicationProjectionSchema.nullable(),
  envelope: z.record(z.unknown()),
  envelopeHash: z.string().regex(/^[a-f0-9]{64}$/),
  providerWrites: z.literal(0),
}).strict();
type LivePreparationOutput = z.infer<typeof LivePreparationOutputSchema>;
const LiveMutationOutputSchema = z.object({
  status: z.string(), providerResultId: z.string().nullable(), permalink: z.string().nullable(),
  generatedMediaUploadCalls: z.number().int().nonnegative(), instagramPublishCalls: z.number().int().nonnegative(), browserRelayCalls: z.literal(0),
}).strict();
const LiveReadbackOutputSchema = z.object({
  status: z.literal("verified"), providerResultId: z.string(), permalink: z.string(), officialReadback: z.literal(true), exactProviderObjectCount: z.literal(1), secondReadbackAt: z.string(), providerWrites: z.literal(0),
});

function projectionFromValidation(value: Record<string, unknown>, input: LivePublicationInput, context: Parameters<typeof graphAuthorization>[0]): PublicationProjection {
  return PublicationProjectionSchema.parse({
    outboxId: `instagram:${input.kind}:${String(value.localDate)}:${String(value.slot)}:${input.jobId}`,
    provider: "instagram", accountKey: "instagram:owner", representedAccountId: value.representedAccountId ?? null,
    jobId: input.jobId, kind: input.kind, publicationType: input.kind === "reel" ? "REELS" : "FEED",
    localDate: value.localDate ?? null, slot: value.slot ?? null, candidateId: value.candidateId ?? value.conceptKey ?? null,
    campaignId: value.campaignId ?? value.conceptKey ?? null, sequenceId: value.sequenceId ?? value.conceptKey ?? null,
    policyVersion: value.policyVersion ?? null, caption: value.caption ?? null, payloadSha256: value.captionSha256 ?? null,
    mediaPath: value.mediaArtifact ?? null, mediaSha256: value.mediaSha256 ?? null, mediaSizeBytes: value.mediaSizeBytes ?? null,
    mimeType: input.kind === "reel" ? "video/mp4" : "image/png", contentSpecSha256: value.contentSpecSha256 ?? null,
    materialContentSha256: value.materialContentSha256 ?? null, storyboardSha256: value.storyboardSha256 ?? null,
    creativeFingerprint: value.creativeFingerprint ?? null, rendererVersion: value.rendererVersion ?? null,
    layoutVerification: value.layoutVerification ?? null,
    layoutVerificationSha256: value.layoutVerification
      ? sha256(value.layoutVerification)
      : null,
    layoutAudit: value.layoutAudit ?? null,
    layoutAuditSha256: value.layoutAudit ? sha256(value.layoutAudit) : null,
    readingTimeVerification: value.readingTime ?? null,
    readingTimeVerificationSha256: value.readingTime ? sha256(value.readingTime) : null,
    claim: { ...graphAuthorization(context, input), status: "preview" }, providerResultId: null, permalink: null, status: "previewed", verification: null,
    generatedMediaUploadCalls: 0, instagramPublishCalls: 0, browserRelayCalls: 0,
  });
}

function recordFrom(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function instagramPreparationBlockedReason(entry: Record<string, any>): string {
  const failureRecord = recordFrom(entry.executionFailure);
  return String(
    entry.reason
      ?? failureRecord.rootCause
      ?? failureRecord.errorCode
      ?? failureRecord.category
      ?? "instagram_preparation_blocked_before_provider_dispatch",
  );
}

function instagramPreparationBlockResult(entry: Record<string, any>, context: NodeExecutionContext): NodeExecutionResult {
  const reason = instagramPreparationBlockedReason(entry);
  const providerWrites = Number(entry.generatedMediaUploadCalls ?? 0) + Number(entry.instagramPublishCalls ?? 0);
  if (providerWrites !== 0 || Number(entry.browserRelayCalls ?? 0) !== 0) {
    throw new Error(`instagram_graph_preparation_block_has_write_evidence:${reason}`);
  }
  const output: LivePreparationOutput = { status: "blocked", projection: null, envelope: {}, envelopeHash: sha256({}), providerWrites: 0 };
  const target = entry.id ? String(entry.id) : "instagram:none";
  return {
    outcome: "failed_terminal",
    output: output as unknown as Record<string, JsonValue>,
    patches: [
      { op: "set", path: "publicationLive", value: output as unknown as JsonValue },
      { op: "set", path: "target", value: target },
    ],
    evidence: [
      { kind: "candidate-claim", uri: `graph://${context.run.runId}/publication/claim`, sha256: sha256({ status: "blocked", target, reason }), summary: `Instagram preparation blocked before a durable candidate claim: ${reason}`, checker: "production.instagram-publication-prepare.v2" },
      { kind: "zero-provider-writes", uri: `graph://${context.run.runId}/publication/preparation-writes`, sha256: sha256({ providerWrites: 0, browserRelayCalls: 0 }), summary: "Blocked Instagram preparation performed zero provider writes", checker: "production.instagram-publication-prepare.v2" },
    ],
    failure: failure("verification_failed", reason, { status: String(entry.status ?? "blocked"), target }),
    progressFingerprint: sha256({ nodeId: context.node.id, status: "blocked", target, reason }),
  };
}

export function classifyInstagramPublicationEffect(value: {
  status?: string | null;
  providerResultId?: string | null;
  permalink?: string | null;
  generatedMediaUploadCalls: number;
  instagramPublishCalls: number;
  browserRelayCalls: number;
}): "effect_verified" | "confirmed_absent" | "ambiguous" {
  if (
    value.status === "verified" &&
    Boolean(value.providerResultId) &&
    Boolean(value.permalink) &&
    value.instagramPublishCalls === 1 &&
    value.browserRelayCalls === 0
  ) return "effect_verified";
  if (
    value.instagramPublishCalls === 0 &&
    !value.providerResultId &&
    !value.permalink &&
    value.browserRelayCalls === 0
  ) return "confirmed_absent";
  return "ambiguous";
}

export function createProductionAdapterRegistry(graphStore?: GraphStore, childRuns?: GraphChildRunCoordinator): ProductionAdapterRegistry {
  const registry = new ProductionAdapterRegistry();
  registry.register({
    adapterId: "production.repo-inspect.v1", version: "1.0.0", sourceOwner: "orchestrator/githubWorkflowMonitor.ts + git CLI", bindingStatus: "production",
    inputSchema: RepoInputSchema.describe("bounded repository inspection input"), outputSchema: RepoOutputSchema.describe("repository truth output"),
    sideEffectClass: "read_only", shadowSafe: true, idempotencyStrategy: "run_node_payload", authority: "read_only", timeoutMs: 60_000,
    retryableFailures: ["state_conflict"], evidenceProduced: ["repository-truth", "git-diff"], redactedKeys: [],
    execute: async (input, context) => {
      const repositoryPath = boundedRepositoryPath((input as z.infer<typeof RepoInputSchema>).repositoryPath);
      const [head, branch, status, diff] = await Promise.all([
        git(repositoryPath, ["rev-parse", "HEAD"]), git(repositoryPath, ["branch", "--show-current"]), git(repositoryPath, ["status", "--porcelain=v1"]), git(repositoryPath, ["diff", "--no-ext-diff"]),
      ]);
      const output = { repositoryPath, head, branch, dirty: status.length > 0, statusHash: sha256(status), diffHash: sha256(diff) };
      return { outcome: "succeeded", output, evidence: [{ kind: context.node.id === "diff_review" ? "git-diff" : "repository-truth", uri: `graph://${context.run.runId}/${context.node.id}`, sha256: sha256(output), summary: "Bounded canonical Git inspection completed", checker: "production.repo-inspect.v1" }], progressFingerprint: sha256({ nodeId: context.node.id, output }) };
    },
  });
  registry.register({
    adapterId: "production.digest-delivery.v1", version: "1.0.0", sourceOwner: "orchestrator send-digest narrow notification effect handler", bindingStatus: "production",
    inputSchema: GovernedTaskInputSchema.extend({ lane: z.literal("digest"), taskType: z.literal("send-digest"), agentId: z.literal("operations-analyst-agent") }).describe("exact graph-owned digest delivery contract"),
    outputSchema: GovernedTaskOutputSchema.describe("hash-bound digest effect and deterministic verifier receipts"),
    sideEffectClass: "external_reversible", shadowSafe: false, idempotencyStrategy: "external_operation", authority: "external_reversible", timeoutMs: 5 * 60_000,
    retryableFailures: ["state_conflict", "timeout", "network_transient"], evidenceProduced: ["child-run-receipt", "verifier-receipt", "child-run-audit-chain"], redactedKeys: ["credential", "token", "secret"],
    execute: async (input, context) => {
      if (!childRuns) return { outcome: "blocked", output: { status: "dispatcher_unavailable", lane: "digest" }, failure: failure("tool_unavailable", "Graph child-run coordinator is unavailable") };
      if (!graphStore) return { outcome: "blocked", output: { status: "graph_store_unavailable", lane: "digest" }, failure: failure("tool_unavailable", "Graph store is unavailable") };
      const dispatchGate = socialDispatchGate(graphStore, context);
      await dispatchGate.reserve("notification_effect", "production.digest-delivery.v1");
      const result = await childRuns.executeGovernedTask(input as never, context);
      const dispatchState = result.outcome === "succeeded" ? "succeeded" : result.outcome === "failed_repairable" ? "confirmed_absent" : "ambiguous";
      await dispatchGate.complete("notification_effect", dispatchState, { providerOperationId: (result.output as { childRunId?: unknown } | undefined)?.childRunId, outcome: result.outcome });
      return {
        ...result,
        externalEffect: {
          idempotencyKey: context.idempotencyKey,
          operationType: "digest-notification",
          target: "configured-notification-channel",
          payloadHash: context.effectPayloadHash,
          state: result.outcome === "succeeded" ? "effect_verified" : result.outcome === "failed_repairable" ? "confirmed_absent" : "ambiguous",
          lastObservedAt: new Date().toISOString(),
        },
      };
    },
  });
  registry.register({
    adapterId: "production.agent-child-run.v1", version: "1.0.0", sourceOwner: "orchestrator graph child-run coordinator + governed task queue", bindingStatus: "production",
    inputSchema: ChildRunInputSchema.describe("governed coding child-run and independent verifier input"), outputSchema: ChildRunOutputSchema.describe("hash-bound child-run and verifier receipt result"),
    sideEffectClass: "local_reversible", shadowSafe: true, idempotencyStrategy: "external_operation", authority: "local_reversible", timeoutMs: 30 * 60_000,
    retryableFailures: ["state_conflict", "timeout"], evidenceProduced: ["child-run-receipt", "verifier-receipt", "child-run-audit-chain"], redactedKeys: ["credential", "token", "secret"],
    execute: async (input, context) => childRuns
      ? childRuns.execute(input as never, context)
      : { outcome: "blocked", output: { status: "dispatcher_unavailable", childRunId: `child_${sha256(context.idempotencyKey).slice(0, 32)}` }, failure: failure("tool_unavailable", "Graph child-run coordinator is unavailable") },
  });
  registry.register({
    adapterId: "production.governed-task-dispatch.v1", version: "1.0.0", sourceOwner: "orchestrator graph child-run coordinator + narrow task effect handlers", bindingStatus: "production",
    inputSchema: GovernedTaskInputSchema.describe("allowlisted graph-owned task lane and exact payload contract"), outputSchema: GovernedTaskOutputSchema.describe("hash-bound effect and deterministic verifier receipts"),
    sideEffectClass: "local_persistent", shadowSafe: true, idempotencyStrategy: "run_node_payload", authority: "local_persistent", timeoutMs: 30 * 60_000,
    retryableFailures: ["state_conflict", "timeout", "verification_failed"], evidenceProduced: ["child-run-receipt", "verifier-receipt", "child-run-audit-chain"], redactedKeys: ["credential", "token", "secret"],
    execute: async (input, context) => childRuns
      ? childRuns.executeGovernedTask(input as never, context)
      : { outcome: "blocked", output: { status: "dispatcher_unavailable", lane: String((input as { lane?: unknown }).lane ?? "unknown") }, failure: failure("tool_unavailable", "Graph child-run coordinator is unavailable") },
  });
  registry.register({
    adapterId: "production.repo-command.v1", version: "1.0.0", sourceOwner: "orchestrator package scripts", bindingStatus: "production",
    inputSchema: RepoInputSchema.describe("bounded repository command input"), outputSchema: CommandOutputSchema.describe("allowlisted command evidence"),
    sideEffectClass: "local_reversible", shadowSafe: true, idempotencyStrategy: "run_node_payload", authority: "local_reversible", timeoutMs: 10 * 60_000,
    retryableFailures: ["timeout", "state_conflict"], evidenceProduced: ["test-output", "build-output"], redactedKeys: ["stdout", "stderr"],
    execute: async (input, context) => {
      const repositoryPath = boundedRepositoryPath((input as z.infer<typeof RepoInputSchema>).repositoryPath);
      const action = context.node.id;
      const scripts: Record<string, string> = { typecheck: "typecheck", test: "test:run", lint: "lint", build: "build" };
      const script = scripts[action];
      if (!script) return { outcome: "failed_terminal", output: { action, exitCode: 1, outputHash: sha256("unsupported"), skipped: true }, failure: failure("tool_unavailable", `No allowlisted package command for node ${action}`) };
      try {
        const result = await execFileAsync("npm", ["run", script], { cwd: repositoryPath, timeout: context.node.timeoutMs, maxBuffer: 4 * 1024 * 1024, signal: context.signal });
        const outputText = `${result.stdout ?? ""}${result.stderr ?? ""}`;
        const output = { action, exitCode: 0, outputHash: sha256(outputText), skipped: false };
        return { outcome: "succeeded", output, evidence: [{ kind: action === "build" ? "build-output" : "test-output", uri: `graph://${context.run.runId}/${action}`, sha256: output.outputHash, summary: `Allowlisted npm ${script} completed`, checker: "production.repo-command.v1" }], progressFingerprint: sha256({ nodeId: context.node.id, outputHash: output.outputHash }) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { outcome: "failed_repairable", output: { action, exitCode: 1, outputHash: sha256(message), skipped: false }, failure: failure("tool_contract_error", message), progressFingerprint: sha256(message) };
      }
    },
  });
  registry.register({
    adapterId: "production.publishing-shadow-decision.v1", version: "1.0.0", sourceOwner: "publishing/production-runner.ts + deterministic engine", bindingStatus: "production",
    inputSchema: PublishingInputSchema.describe("canonical zero-write publishing decision input"), outputSchema: ShadowDecisionEnvelopeSchema.describe("normalised zero-write publishing decision"),
    sideEffectClass: "read_only", shadowSafe: true, idempotencyStrategy: "run_node_payload", authority: "read_only", timeoutMs: 120_000,
    retryableFailures: ["state_conflict"], evidenceProduced: ["publication-shadow-decision", "payload-hash", "zero-provider-writes"], redactedKeys: ["credential", "token", "secret"],
    execute: async (input, context) => {
      const decision = await prepareProductionPublishingShadowDecision(input as z.infer<typeof PublishingInputSchema>);
      const blocked = decision.graphSafeState !== "completed";
      const output = structuredClone(decision) as unknown as Record<string, JsonValue>;
      const evidence = [
        { kind: "publication-shadow-decision", uri: `graph://${context.run.runId}/${context.node.id}/decision`, sha256: sha256(decision), summary: `Canonical publishing decision: ${decision.expectedNextAction}`, checker: "production.publishing-shadow-decision.v1" },
        { kind: "payload-hash", uri: `graph://${context.run.runId}/${context.node.id}/payload-hash`, sha256: decision.payloadHash ?? sha256(null), summary: decision.payloadHash ? "Canonical publication payload hash recorded" : "No payload exists for the controlled block", checker: "production.publishing-shadow-decision.v1" },
        { kind: "zero-provider-writes", uri: `graph://${context.run.runId}/${context.node.id}/zero-provider-writes`, sha256: sha256({ externalWrites: decision.externalWrites }), summary: "Shadow adapter structurally performed zero provider writes", checker: "production.publishing-shadow-decision.v1" },
      ];
      return { outcome: blocked ? "blocked" : "succeeded", output, patches: [{ op: "set", path: "publicationShadow", value: decision as unknown as JsonValue }], evidence, ...(blocked ? { failure: failure(decision.blockReason === "ambiguous_provider_state" ? "idempotency_conflict" : "verification_failed", decision.blockReason ?? "Publishing shadow decision blocked") } : {}), progressFingerprint: sha256({ nodeId: context.node.id, decision }) };
    },
  });
  registry.register({
    adapterId: "production.instagram-publication-prepare.v2", version: "2.0.0", sourceOwner: "scripts/instagram-publisher-outbox-runner.mjs", bindingStatus: "production",
    inputSchema: LivePublicationInputSchema.describe("exact Instagram graph publication preparation input"), outputSchema: LivePreparationOutputSchema.describe("frozen payload and media envelope"),
    sideEffectClass: "local_persistent", shadowSafe: true, idempotencyStrategy: "run_node_payload", authority: "local_persistent", timeoutMs: 15 * 60_000,
    retryableFailures: ["state_conflict", "timeout"], evidenceProduced: ["candidate-claim", "payload-hash", "media-hash", "frozen-envelope", "zero-provider-writes"], redactedKeys: ["credential", "token", "secret"],
    execute: async (inputValue, context) => {
      const input = inputValue as LivePublicationInput;
      const runner = await loadInstagramRunner();
      let projection: PublicationProjection;
      let status: "previewed" | "prepared";
      if (input.shadowMode) {
        const validated = await runner.runOpportunity(input.jobId, input.kind, { validateOnly: true, now: new Date(input.observedAt) }) as unknown as Record<string, unknown>;
        if (validated.valid !== true || Number(validated.providerWrites ?? 0) !== 0) {
          return { outcome: "blocked", output: { status: "previewed", projection: projectionFromValidation(validated, input, context), envelope: {}, envelopeHash: sha256({}), providerWrites: 0 } as unknown as Record<string, JsonValue>, failure: failure("verification_failed", "Canonical Instagram validation did not produce an eligible zero-write candidate") };
        }
        projection = projectionFromValidation(validated, input, context);
        status = "previewed";
      } else {
        const prepared = await runner.runOpportunity(input.jobId, input.kind, { prepareOnly: true, now: new Date(input.observedAt), graphAuthorization: graphAuthorization(context, input) });
        const entry = recordFrom(prepared.entry);
        if (String(entry.status ?? "") === "blocked") return instagramPreparationBlockResult(entry, context);
        projection = PublicationProjectionSchema.parse(await runner.instagramGraphPublicationProjection(prepared.entry));
        if (projection.status !== "render_validated" || projection.claim?.status !== "prepared") throw new Error("canonical_instagram_graph_prepare_incomplete");
        status = "prepared";
      }
      const envelope = buildFrozenPublicationEnvelope(context, input, projection);
      const envelopeHash = frozenEnvelopeHash(envelope);
      const output = { status, projection, envelope: envelope as unknown as Record<string, unknown>, envelopeHash, providerWrites: 0 };
      const evidence = [
        { kind: "candidate-claim", uri: `graph://${context.run.runId}/publication/claim`, sha256: sha256(projection.claim), summary: `${status} candidate claim bound to one graph run`, checker: "production.instagram-publication-prepare.v2" },
        { kind: "payload-hash", uri: `graph://${context.run.runId}/publication/payload`, sha256: envelope.payloadSha256, summary: "Exact canonical caption hash frozen", checker: "production.instagram-publication-prepare.v2" },
        { kind: "media-hash", uri: `graph://${context.run.runId}/publication/media`, sha256: envelope.mediaSha256, summary: "Exact rendered media bytes frozen", checker: "production.instagram-publication-prepare.v2" },
        { kind: "frozen-envelope", uri: `graph://${context.run.runId}/publication/envelope`, sha256: envelopeHash, summary: "Immutable publication envelope prepared", checker: "production.instagram-publication-prepare.v2" },
        { kind: "zero-provider-writes", uri: `graph://${context.run.runId}/publication/preparation-writes`, sha256: sha256({ providerWrites: 0 }), summary: "Preparation performed zero provider writes", checker: "production.instagram-publication-prepare.v2" },
      ];
      return { outcome: "succeeded", output: output as unknown as Record<string, JsonValue>, patches: [{ op: "set", path: "publicationLive", value: output as unknown as JsonValue }, { op: "set", path: "target", value: envelope.providerTarget }], evidence, progressFingerprint: envelopeHash };
    },
  });
  registry.register({
    adapterId: "production.instagram-publication-live.v2", version: "2.0.0", sourceOwner: "scripts/instagram-publisher-outbox-runner.mjs canonical official Meta worker", bindingStatus: "production",
    inputSchema: LivePublicationInputSchema.describe("approved exact Instagram graph publication input"), outputSchema: LiveMutationOutputSchema.describe("verified canonical Instagram publication result"),
    sideEffectClass: "external_public", shadowSafe: false, idempotencyStrategy: "external_operation", authority: "external_public", timeoutMs: 15 * 60_000,
    retryableFailures: ["provider_rate_limited", "network_transient", "timeout"], evidenceProduced: ["provider-publication", "official-provider-readback", "local-publication-state"], redactedKeys: ["credential", "token", "secret", "secureUrl"],
    execute: async (inputValue, context) => {
      const input = inputValue as LivePublicationInput;
      if (!context.approval) throw new Error("live_publication_payload_bound_approval_missing");
      if (!context.liveCapability || !graphStore) throw new Error("live_publication_one_run_capability_missing");
      const publicationLive = context.run.data.publicationLive as unknown as { projection: PublicationProjection; envelope: FrozenPublicationEnvelope; envelopeHash: string };
      const projection = PublicationProjectionSchema.parse(publicationLive?.projection);
      const envelope = publicationLive?.envelope;
      if (!envelope || frozenEnvelopeHash(envelope) !== publicationLive.envelopeHash) throw new Error("live_publication_frozen_envelope_hash_mismatch");
      assertEnvelopeUnchanged(buildFrozenPublicationEnvelope(context, input, projection), envelope);
      if (envelope.approvalId !== context.approval.approvalId) throw new Error("live_publication_approval_id_mismatch");
      const authorization = graphAuthorization(context, input, {
        approvalId: context.approval.approvalId,
        approvalPayloadHash: context.approval.payloadHash,
        approvalExpiresAt: context.approval.expiresAt,
        envelopeHash: publicationLive.envelopeHash,
        capabilityId: context.liveCapability.capabilityId,
      });
      const runner = await loadInstagramRunner();
      await runner.bindInstagramGraphPublicationEnvelope({ outboxId: projection.outboxId, graphAuthorization: authorization, envelope });
      const effect = context.run.externalEffects.find((item) => item.nodeId === context.node.id && item.idempotencyKey === context.idempotencyKey);
      if (!effect) throw new Error("live_publication_external_effect_intent_missing");
      const expected = expectedCapabilityBindings({
        runId: context.run.runId,
        approvalId: context.approval.approvalId,
        approvalPayloadHash: context.approval.payloadHash,
        envelope,
        envelopeHash: publicationLive.envelopeHash,
      });
      const graphDispatchGate = {
        reserve: async (stepId: string, expectedOperation: string) => graphStore.reserveLiveCapabilityDispatch({
          capabilityId: context.liveCapability!.capabilityId,
          stepId,
          expectedOperation,
          effectId: effect.effectId,
          expected,
          globalZeroWrite: true,
          actor: `adapter:${context.node.handler}`,
        }),
        complete: async (stepId: string, state: "succeeded" | "confirmed_absent" | "ambiguous" | "failed", evidence: { providerOperationId?: unknown; error?: unknown; outcome?: unknown } = {}) => graphStore.completeLiveCapabilityDispatch({
          capabilityId: context.liveCapability!.capabilityId,
          stepId,
          state,
          providerOperationId: evidence.providerOperationId ? String(evidence.providerOperationId) : undefined,
          failureReason: evidence.error ? String(evidence.error) : state === "succeeded" ? undefined : evidence.outcome ? String(evidence.outcome) : state,
          actor: `adapter:${context.node.handler}`,
        }),
      };
      const observedAt = new Date(input.observedAt);
      let result;
      try {
        result = await runner.runOpportunity(input.jobId, input.kind, { now: observedAt, graphAuthorization: authorization, graphDispatchGate });
      } catch (error) {
        await runner.recordUnhandledInstagramCommittedMiss(input.jobId, input.kind, observedAt, error);
        throw error;
      }
      const verified = PublicationProjectionSchema.parse(await runner.instagramGraphPublicationProjection(result.entry));
      const output = { status: verified.status ?? "unknown", providerResultId: verified.providerResultId, permalink: verified.permalink, generatedMediaUploadCalls: verified.generatedMediaUploadCalls, instagramPublishCalls: verified.instagramPublishCalls, browserRelayCalls: 0 as const };
      const state = classifyInstagramPublicationEffect(output);
      const correct = state === "effect_verified";
      return {
        outcome: correct ? "succeeded" : state === "confirmed_absent" ? "failed_repairable" : "blocked",
        output,
        patches: [{ op: "set", path: "publicationLive.result", value: verified as unknown as JsonValue }],
        evidence: correct ? [
          { kind: "provider-publication", uri: verified.permalink!, sha256: verified.payloadSha256!, summary: "One exact Instagram provider object created", checker: "production.instagram-publication-live.v2" },
          { kind: "official-provider-readback", uri: verified.permalink!, sha256: sha256(verified.verification), summary: "Canonical worker completed owned-feed, verify, and inspect readback", checker: "production.instagram-publication-live.v2" },
          { kind: "local-publication-state", uri: `graph://${context.run.runId}/publication/local-state`, sha256: sha256(verified), summary: "Canonical outbox and graph claim reached verified", checker: "production.instagram-publication-live.v2" },
        ] : state === "confirmed_absent" ? [
          { kind: "confirmed-absence", uri: `graph://${context.run.runId}/publication/confirmed-absence`, sha256: sha256(output), summary: "Canonical worker proved that no Instagram publication call occurred", checker: "production.instagram-publication-live.v2" },
          ...(verified.generatedMediaUploadCalls > 0 ? [
            { kind: "preparatory-external-effect", uri: `graph://${context.run.runId}/publication/media-upload`, sha256: sha256({ generatedMediaUploadCalls: verified.generatedMediaUploadCalls }), summary: "A preparatory media upload occurred but no Instagram publication call occurred", checker: "production.instagram-publication-live.v2" },
          ] : []),
        ] : [],
        externalEffect: { idempotencyKey: context.idempotencyKey, operationType: "instagram-publication", target: envelope.providerTarget, payloadHash: context.effectPayloadHash, state, providerOperationId: verified.providerResultId ?? undefined, lastObservedAt: new Date().toISOString() },
        ...(correct ? {} : { failure: failure(state === "confirmed_absent" ? "provider_rejected" : "idempotency_conflict", "Canonical Instagram worker did not reach one verified publication") }),
        progressFingerprint: sha256({ state, providerResultId: verified.providerResultId, status: verified.status }),
      };
    },
  });
  registry.register({
    adapterId: "production.instagram-publication-readback.v2", version: "2.0.0", sourceOwner: "scripts/instagram-publisher-outbox-runner.mjs official Meta read adapters", bindingStatus: "production",
    inputSchema: LivePublicationInputSchema.describe("exact Instagram graph readback input"), outputSchema: LiveReadbackOutputSchema.describe("second official provider readback"),
    sideEffectClass: "read_only", shadowSafe: false, idempotencyStrategy: "run_node_payload", authority: "read_only", timeoutMs: 5 * 60_000,
    retryableFailures: ["network_transient", "provider_rate_limited"], evidenceProduced: ["second-provider-readback", "payload-media-identity", "single-provider-object", "claim-finalised"], redactedKeys: ["credential", "token", "secret", "secureUrl"],
    execute: async (inputValue, context) => {
      const input = inputValue as LivePublicationInput;
      const publicationLive = context.run.data.publicationLive as unknown as { projection: PublicationProjection; envelope: FrozenPublicationEnvelope; envelopeHash: string; result: PublicationProjection };
      const envelope = publicationLive.envelope;
      const result = PublicationProjectionSchema.parse(publicationLive.result);
      const approval = context.run.externalEffects.find((effect) => effect.nodeId === "publish_provider_object");
      const storedApproval = context.run.data.publicationApproval as unknown as { approvalId?: string; payloadHash?: string; expiresAt?: string } | undefined;
      const approvalId = envelope?.approvalId || storedApproval?.approvalId;
      const approvalPayloadHash = approval?.payloadHash || storedApproval?.payloadHash;
      const consumedCapability = graphStore?.oneRunLiveCapabilityForRun(context.run.runId);
      if (!envelope || !result.outboxId || !approvalId || !approvalPayloadHash || !consumedCapability || consumedCapability.status !== "consumed" || consumedCapability.approvalId !== approvalId || consumedCapability.envelopeHash !== publicationLive.envelopeHash) {
        throw new Error("publication_readback_authority_material_missing");
      }
      const runner = await loadInstagramRunner();
      const readback = await runner.readBackVerifiedInstagramGraphPublication({ outboxId: result.outboxId, graphAuthorization: graphAuthorization(context, input, { approvalId, approvalPayloadHash, approvalExpiresAt: storedApproval?.expiresAt ?? envelope.approvalExpiry, envelopeHash: publicationLive.envelopeHash, capabilityId: consumedCapability.capabilityId }) }) as Record<string, unknown>;
      const output = LiveReadbackOutputSchema.parse(readback);
      const evidence = [
        { kind: "second-provider-readback", uri: String(output.permalink), sha256: sha256({ providerResultId: output.providerResultId, secondReadbackAt: output.secondReadbackAt }), summary: "Second bounded official provider readback passed", checker: "production.instagram-publication-readback.v2" },
        { kind: "payload-media-identity", uri: `graph://${context.run.runId}/publication/identity`, sha256: sha256({ payloadSha256: envelope.payloadSha256, mediaSha256: envelope.mediaSha256 }), summary: "Readback remains bound to the frozen payload and media identity", checker: "production.instagram-publication-readback.v2" },
        { kind: "single-provider-object", uri: String(output.permalink), sha256: sha256({ count: output.exactProviderObjectCount }), summary: "Exactly one exact provider object observed", checker: "production.instagram-publication-readback.v2" },
        { kind: "claim-finalised", uri: `graph://${context.run.runId}/publication/claim`, sha256: sha256((readback as { claim?: unknown }).claim), summary: "Durable candidate claim is verified and finalised", checker: "production.instagram-publication-readback.v2" },
      ];
      return { outcome: "succeeded", output: output as unknown as Record<string, JsonValue>, patches: [{ op: "set", path: "publicationLive.readback", value: output as unknown as JsonValue }], evidence, progressFingerprint: sha256(output) };
    },
  });
  registry.register({
    adapterId: "production.threads-readiness-prepare.v1", version: "1.0.0", sourceOwner: "scripts/threads-readiness-preparer.mjs exact zero-write preparation stage", bindingStatus: "production",
    inputSchema: ThreadsReadinessInputSchema, outputSchema: ThreadsReadinessOutputSchema,
    sideEffectClass: "local_persistent", shadowSafe: true, idempotencyStrategy: "run_node_payload", authority: "local_persistent", timeoutMs: 15 * 60_000,
    retryableFailures: ["state_conflict", "timeout"], evidenceProduced: ["threads-readiness-receipt", "zero-provider-writes"], redactedKeys: ["credential", "token", "secret"],
    execute: async (inputValue, context) => {
      const input = ThreadsReadinessInputSchema.parse(inputValue);
      const runner = await loadThreadsReadiness();
      const output = ThreadsReadinessOutputSchema.parse(await runner.prepareNextThreadsOpportunity(new Date(input.observedAt)));
      return { outcome: "succeeded", output: output as unknown as Record<string, JsonValue>, patches: [{ op: "set", path: "threadsReadiness", value: output as unknown as JsonValue }], evidence: [
        { kind: "threads-readiness-receipt", uri: `graph://${context.run.runId}/threads/readiness`, sha256: sha256(output), summary: "The next Threads opportunity was prepared under injected-clock zero-write rules", checker: "production.threads-readiness-prepare.v1" },
        { kind: "zero-provider-writes", uri: `graph://${context.run.runId}/threads/readiness-writes`, sha256: sha256({ providerWrites: 0 }), summary: "Readiness preparation performed zero provider writes", checker: "production.threads-readiness-prepare.v1" },
      ], progressFingerprint: sha256(output) };
    },
  });
  registry.register({
    adapterId: "production.threads-publication-prepare.v1", version: "1.0.0", sourceOwner: "scripts/threads-outbox-runner.mjs prepare-only stage", bindingStatus: "production",
    inputSchema: ThreadsGraphInputSchema, outputSchema: SocialPreparationOutputSchema,
    sideEffectClass: "local_persistent", shadowSafe: true, idempotencyStrategy: "run_node_payload", authority: "local_persistent", timeoutMs: 15 * 60_000,
    retryableFailures: ["state_conflict", "timeout"], evidenceProduced: ["social-preparation-receipt", "payload-hash", "zero-provider-writes"], redactedKeys: ["credential", "token", "secret"],
    execute: async (inputValue, context) => {
      const input = ThreadsGraphInputSchema.parse(inputValue);
      const runner = await loadThreadsRunner();
      const prepared = await runner.runOpportunity(input.jobId, { prepareOnly: true, now: new Date(input.observedAt), observedAt: new Date(input.observedAt) });
      const output = await socialPreparation(prepared.entry, input, "publish");
      return { outcome: "succeeded", output: output as unknown as Record<string, JsonValue>, patches: [{ op: "set", path: "socialEffect", value: output as unknown as JsonValue }, { op: "set", path: "target", value: output.outboxId ?? "threads:none" }], evidence: [
        { kind: "social-preparation-receipt", uri: `graph://${context.run.runId}/threads/preparation`, sha256: sha256(output), summary: `Threads preparation reached ${output.status}`, checker: "production.threads-publication-prepare.v1" },
        { kind: "payload-hash", uri: `graph://${context.run.runId}/threads/payload`, sha256: output.payloadHash ?? sha256(null), summary: output.payloadHash ? "Exact Threads payload frozen" : "No eligible Threads payload", checker: "production.threads-publication-prepare.v1" },
        ...(output.mediaHash ? [
          { kind: "media-hash", uri: `graph://${context.run.runId}/threads/media`, sha256: output.mediaHash, summary: "Exact Threads image bytes frozen", checker: "production.threads-publication-prepare.v1" },
          { kind: "creative-fingerprint", uri: `graph://${context.run.runId}/threads/creative`, sha256: output.creativeFingerprint!, summary: `Threads topic ${output.topicTag} and complete creative fingerprint frozen`, checker: "production.threads-publication-prepare.v1" },
          { kind: "layout-receipt", uri: `graph://${context.run.runId}/threads/layout`, sha256: output.layoutReceiptHash!, summary: "Canonical renderer layout receipt frozen", checker: "production.threads-publication-prepare.v1" },
          { kind: "renderer-identity", uri: `graph://${context.run.runId}/threads/renderer`, sha256: output.rendererIdentityHash!, summary: "Canonical renderer source identity frozen", checker: "production.threads-publication-prepare.v1" },
        ] : []),
        { kind: "zero-provider-writes", uri: `graph://${context.run.runId}/threads/preparation-writes`, sha256: sha256({ providerWrites: 0 }), summary: "Threads preparation performed zero provider writes", checker: "production.threads-publication-prepare.v1" },
      ], progressFingerprint: sha256(output) };
    },
  });
  registry.register({
    adapterId: "production.threads-publication-live.v1", version: "1.0.0", sourceOwner: "scripts/threads-outbox-runner.mjs exact committed-slot effect stage", bindingStatus: "production",
    inputSchema: ThreadsGraphInputSchema, outputSchema: SocialMutationOutputSchema,
    sideEffectClass: "external_public", shadowSafe: false, idempotencyStrategy: "external_operation", authority: "external_public", timeoutMs: 15 * 60_000,
    retryableFailures: [], evidenceProduced: ["provider-publication", "official-provider-readback"], redactedKeys: ["credential", "token", "secret", "secureUrl"],
    execute: async (inputValue, context) => {
      const input = ThreadsGraphInputSchema.parse(inputValue);
      const prepared = context.run.data.socialEffect as unknown as z.infer<typeof SocialPreparationOutputSchema>;
      if (!prepared?.outboxId || prepared.action !== "publish") throw new Error("threads_graph_exact_preparation_missing");
      if (input.jobId === "083e3560-40fd-4487-9d78-674f64866ef7") {
        if (!prepared.mediaPath || !prepared.mediaHash || !prepared.mediaBytesHash || !prepared.topicTag || !prepared.creativeFingerprint || !prepared.layoutReceipt || !prepared.layoutReceiptHash || !prepared.rendererIdentity || !prepared.rendererIdentityHash) throw new Error("threads_graph_image_live_proof_missing");
        const currentMediaHash = await fileSha256(prepared.mediaPath);
        if (currentMediaHash !== prepared.mediaHash || currentMediaHash !== prepared.mediaBytesHash) throw new Error("threads_graph_image_bytes_changed_before_live_handoff");
        if (sha256(prepared.layoutReceipt) !== prepared.layoutReceiptHash || sha256(prepared.rendererIdentity) !== prepared.rendererIdentityHash) throw new Error("threads_graph_image_proof_changed_before_live_handoff");
        if (String(prepared.rendererIdentity.source) !== CANONICAL_LOCAL_MEDIA_RENDERER || String(prepared.rendererIdentity.sourceSha256) !== await fileSha256(CANONICAL_LOCAL_MEDIA_RENDERER)) throw new Error("threads_graph_renderer_identity_changed_before_live_handoff");
      }
      if (!graphStore) throw new Error("threads_graph_store_missing");
      const runner = await loadThreadsRunner();
      const result = await runner.runOpportunity(input.jobId, { now: new Date(input.observedAt), graphAuthorization: { runId: context.run.runId, nodeId: context.node.id, idempotencyKey: context.idempotencyKey }, graphDispatchGate: socialDispatchGate(graphStore, context) });
      if (String(result.entry?.id) !== prepared.outboxId) throw new Error("threads_graph_outbox_binding_changed");
      const verified = result.entry?.status === "published_verified";
      const writes = Number(result.entry?.externalWriteCount ?? 0);
      const output = { status: String(result.entry?.status ?? "unknown"), outboxId: prepared.outboxId, providerResultId: result.entry?.providerResultId ? String(result.entry.providerResultId) : null, permalink: result.entry?.permalink ? String(result.entry.permalink) : null, providerWrites: writes, browserRelayCalls: 0 as const };
      const state = verified && writes === 1 ? "effect_verified" as const : writes === 0 ? "confirmed_absent" as const : "ambiguous" as const;
      return { outcome: verified ? "succeeded" : "failed_repairable", output, patches: [{ op: "set", path: "socialEffect.result", value: output as unknown as JsonValue }], evidence: verified ? [
        { kind: "provider-publication", uri: output.permalink!, sha256: prepared.payloadHash!, summary: "One exact Threads provider object created", checker: "production.threads-publication-live.v1" },
        { kind: "official-provider-readback", uri: output.permalink!, sha256: sha256(output), summary: "Threads canonical worker verified the provider object", checker: "production.threads-publication-live.v1" },
      ] : [], externalEffect: { idempotencyKey: context.idempotencyKey, operationType: "threads-publication", target: prepared.outboxId, payloadHash: context.effectPayloadHash, state, providerOperationId: output.providerResultId ?? undefined, lastObservedAt: new Date().toISOString() }, progressFingerprint: sha256(output) };
    },
  });
  registry.register({
    adapterId: "production.threads-publication-readback.v1", version: "1.0.0", sourceOwner: "scripts/threads-outbox-runner.mjs read-only reconciliation stage", bindingStatus: "production",
    inputSchema: ThreadsGraphInputSchema, outputSchema: SocialReadbackOutputSchema,
    sideEffectClass: "read_only", shadowSafe: false, idempotencyStrategy: "run_node_payload", authority: "read_only", timeoutMs: 5 * 60_000,
    retryableFailures: ["network_transient", "provider_rate_limited"], evidenceProduced: ["second-provider-readback", "social-terminal-receipt"], redactedKeys: ["credential", "token", "secret"],
    execute: async (_inputValue, context) => {
      const prepared = context.run.data.socialEffect as unknown as z.infer<typeof SocialPreparationOutputSchema>;
      if (!prepared?.outboxId) throw new Error("threads_graph_outbox_missing_for_readback");
      const runner = await loadThreadsRunner();
      const result = await runner.reconcileOutboxEntry(prepared.outboxId);
      const output = { status: String(result.entry?.status ?? "unknown"), outboxId: prepared.outboxId, verified: result.entry?.status === "published_verified", providerResultId: result.entry?.providerResultId ? String(result.entry.providerResultId) : null, permalink: result.entry?.permalink ? String(result.entry.permalink) : null, providerWrites: 0 as const, browserRelayCalls: 0 as const };
      if (!output.verified) return { outcome: "failed_terminal", output, failure: failure("idempotency_conflict", "Threads readback did not prove one exact publication") };
      return { outcome: "succeeded", output, evidence: [
        { kind: "second-provider-readback", uri: output.permalink!, sha256: sha256(output), summary: "Second Threads readback passed", checker: "production.threads-publication-readback.v1" },
        { kind: "social-terminal-receipt", uri: `graph://${context.run.runId}/threads/terminal`, sha256: sha256(output), summary: "Threads terminal state verified", checker: "production.threads-publication-readback.v1" },
      ], progressFingerprint: sha256(output) };
    },
  });
  registry.register({
    adapterId: "production.meta-reply-prepare.v1", version: "1.0.0", sourceOwner: "scripts/meta-reply-monitor-outbox-runner.mjs discovery and prepare-only stage", bindingStatus: "production",
    inputSchema: MetaReplyGraphInputSchema, outputSchema: SocialPreparationOutputSchema,
    sideEffectClass: "local_persistent", shadowSafe: true, idempotencyStrategy: "run_node_payload", authority: "local_persistent", timeoutMs: 10 * 60_000,
    retryableFailures: ["state_conflict", "network_transient", "timeout"], evidenceProduced: ["social-preparation-receipt", "payload-hash", "zero-provider-writes"], redactedKeys: ["credential", "token", "secret"],
    execute: async (inputValue, context) => {
      const input = MetaReplyGraphInputSchema.parse(inputValue);
      const runner = await loadMetaReplyRunner();
      let output: z.infer<typeof SocialPreparationOutputSchema>;
      try {
        const prepared = await runner.runMonitor({ prepareOnly: true, now: new Date(input.observedAt) });
        output = await socialPreparation(prepared.entry, input, "reply");
      } catch (error) {
        if (!isReadSideProviderFailure(error)) throw error;
        output = zeroWriteSocialSkip("provider_discovery_unavailable");
      }
      return { outcome: "succeeded", output: output as unknown as Record<string, JsonValue>, patches: [{ op: "set", path: "socialEffect", value: output as unknown as JsonValue }, { op: "set", path: "target", value: output.targetId ?? output.outboxId ?? "meta-reply:none" }], evidence: [
        { kind: "social-preparation-receipt", uri: `graph://${context.run.runId}/meta-reply/preparation`, sha256: sha256(output), summary: `Meta reply preparation reached ${output.status}`, checker: "production.meta-reply-prepare.v1" },
        { kind: "payload-hash", uri: `graph://${context.run.runId}/meta-reply/payload`, sha256: output.payloadHash ?? sha256(null), summary: output.payloadHash ? "Exact reply payload frozen" : "No eligible reply payload", checker: "production.meta-reply-prepare.v1" },
        { kind: "zero-provider-writes", uri: `graph://${context.run.runId}/meta-reply/preparation-writes`, sha256: sha256({ providerWrites: 0 }), summary: "Meta reply preparation performed zero provider writes", checker: "production.meta-reply-prepare.v1" },
      ], progressFingerprint: sha256(output) };
    },
  });
  registry.register({
    adapterId: "production.meta-reply-live.v1", version: "1.0.0", sourceOwner: "scripts/meta-reply-monitor-outbox-runner.mjs exact prepared-reply effect stage", bindingStatus: "production",
    inputSchema: MetaReplyGraphInputSchema, outputSchema: SocialMutationOutputSchema,
    sideEffectClass: "external_public", shadowSafe: false, idempotencyStrategy: "external_operation", authority: "external_public", timeoutMs: 5 * 60_000,
    retryableFailures: [], evidenceProduced: ["provider-reply", "official-provider-readback"], redactedKeys: ["credential", "token", "secret"],
    execute: async (_inputValue, context) => {
      const prepared = context.run.data.socialEffect as unknown as z.infer<typeof SocialPreparationOutputSchema>;
      if (!prepared?.outboxId || prepared.action !== "reply") throw new Error("meta_reply_graph_exact_preparation_missing");
      if (!graphStore) throw new Error("meta_reply_graph_store_missing");
      const runner = await loadMetaReplyRunner();
      await reconcilePriorMetaReplyGraphEffects(graphStore, runner, {
        target: prepared.targetId ?? prepared.outboxId,
        excludeRunId: context.run.runId,
      });
      const result = await runner.executePreparedReply(prepared.outboxId, { graphDispatchGate: socialDispatchGate(graphStore, context) });
      const verified = result.entry?.status === "verified";
      const writes = Number(result.entry?.externalWriteCount ?? 0);
      const output = { status: String(result.entry?.status ?? "unknown"), outboxId: prepared.outboxId, providerResultId: result.entry?.providerResultId ? String(result.entry.providerResultId) : null, permalink: result.entry?.permalink ? String(result.entry.permalink) : null, providerWrites: writes, browserRelayCalls: 0 as const };
      const state = verified && writes === 1 ? "effect_verified" as const : writes === 0 ? "confirmed_absent" as const : "ambiguous" as const;
      return { outcome: verified ? "succeeded" : "failed_repairable", output, patches: [{ op: "set", path: "socialEffect.result", value: output as unknown as JsonValue }], evidence: verified ? [
        { kind: "provider-reply", uri: output.permalink!, sha256: prepared.payloadHash!, summary: "One exact Meta reply created", checker: "production.meta-reply-live.v1" },
        { kind: "official-provider-readback", uri: output.permalink!, sha256: sha256(output), summary: "Canonical reply worker verified the provider object", checker: "production.meta-reply-live.v1" },
      ] : [], externalEffect: { idempotencyKey: context.idempotencyKey, operationType: "meta-reply", target: prepared.targetId ?? prepared.outboxId, payloadHash: context.effectPayloadHash, state, providerOperationId: output.providerResultId ?? undefined, lastObservedAt: new Date().toISOString() }, progressFingerprint: sha256(output) };
    },
  });
  registry.register({
    adapterId: "production.meta-reply-readback.v1", version: "1.0.0", sourceOwner: "scripts/meta-reply-monitor-outbox-runner.mjs receipt reconciliation stage", bindingStatus: "production",
    inputSchema: MetaReplyGraphInputSchema, outputSchema: SocialReadbackOutputSchema,
    sideEffectClass: "read_only", shadowSafe: false, idempotencyStrategy: "run_node_payload", authority: "read_only", timeoutMs: 5 * 60_000,
    retryableFailures: ["network_transient", "provider_rate_limited"], evidenceProduced: ["second-provider-readback", "social-terminal-receipt"], redactedKeys: ["credential", "token", "secret"],
    execute: async (_inputValue, context) => {
      const prepared = context.run.data.socialEffect as unknown as z.infer<typeof SocialPreparationOutputSchema>;
      if (!prepared?.outboxId) throw new Error("meta_reply_graph_outbox_missing_for_readback");
      const runner = await loadMetaReplyRunner();
      const result = await runner.reconcileReceiptOnly(prepared.outboxId);
      const output = { status: String(result.entry?.status ?? "unknown"), outboxId: prepared.outboxId, verified: result.entry?.status === "verified", providerResultId: result.entry?.providerResultId ? String(result.entry.providerResultId) : null, permalink: result.entry?.permalink ? String(result.entry.permalink) : null, providerWrites: 0 as const, browserRelayCalls: 0 as const };
      const confirmedAbsent = output.status === "confirmed_failure";
      if (!output.verified && !confirmedAbsent) return { outcome: "failed_terminal", output, failure: failure("idempotency_conflict", "Meta reply readback did not prove one exact reply") };
      const priorEffect = graphStore?.externalEffects(context.run.runId).find((effect) => effect.nodeId === "perform_exact_effect" && effect.operationType === "production.meta-reply-live.v1");
      if (!priorEffect) return { outcome: "failed_terminal", output, failure: failure("invariant_violation", "Meta reply readback lacks the exact prior effect to reconcile") };
      const evidenceRefs = [
        typeof result.entry?.reconciliationReceiptPath === "string" ? result.entry.reconciliationReceiptPath : null,
        typeof result.entry?.reconciliationReceiptSha256 === "string" ? result.entry.reconciliationReceiptSha256 : null,
        output.permalink,
      ].filter((value): value is string => Boolean(value));
      return { outcome: "succeeded", output, evidence: [
        { kind: "second-provider-readback", uri: output.permalink ?? `graph://${context.run.runId}/meta-reply/confirmed-absent`, sha256: sha256(output), summary: output.verified ? "Second Meta reply readback passed" : "Complete provider readback confirmed the authorized reply is absent", checker: "production.meta-reply-readback.v1" },
        { kind: "social-terminal-receipt", uri: `graph://${context.run.runId}/meta-reply/terminal`, sha256: sha256(output), summary: output.verified ? "Meta reply terminal state verified" : "Meta reply ambiguity was safely quarantined as confirmed absent", checker: "production.meta-reply-readback.v1" },
      ], externalEffect: {
        idempotencyKey: priorEffect.idempotencyKey,
        operationType: priorEffect.operationType,
        target: priorEffect.target,
        payloadHash: priorEffect.payloadHash,
        state: output.verified ? "effect_verified" : "confirmed_absent",
        providerOperationId: output.providerResultId ?? undefined,
        lastObservedAt: new Date().toISOString(),
        evidenceRefs,
      }, progressFingerprint: sha256(output) };
    },
  });
  registry.register({
    adapterId: "production.research-evidence.v1", version: "1.0.0", sourceOwner: "market-research/sourceFetch evidence contract", bindingStatus: "production",
    inputSchema: ResearchInputSchema.describe("governed research evidence input"), outputSchema: ResearchOutputSchema.describe("claim/source quality output"),
    sideEffectClass: "read_only", shadowSafe: true, idempotencyStrategy: "run_node_payload", authority: "read_only", timeoutMs: 60_000,
    retryableFailures: ["network_transient"], evidenceProduced: ["claim-source-ledger"], redactedKeys: ["authorization", "token", "secret"],
    execute: async (input, context) => {
      const value = input as z.infer<typeof ResearchInputSchema>;
      const acceptedSources = value.sources.filter((source) => source.quality === "accepted");
      const acceptedIds = new Set(acceptedSources.map((source) => source.id));
      const unsupportedClaimIds = value.claims.filter((claim) => claim.sourceRefs.length === 0 || claim.sourceRefs.some((ref) => !acceptedIds.has(ref))).map((claim) => claim.id);
      const rejectedSourceIds = value.sources.filter((source) => source.quality === "rejected").map((source) => source.id);
      const resultSetHash = sha256({ sources: value.sources, claims: value.claims });
      const output = { sourceCount: value.sources.length, claimCount: value.claims.length, unsupportedClaimIds, rejectedSourceIds, resultSetHash, marginalInformationGain: value.resultSetHash === resultSetHash ? 0 : acceptedSources.length };
      const progressFingerprint = sha256({ nodeId: context.node.id, resultSetHash });
      if (unsupportedClaimIds.length > 0 || rejectedSourceIds.length > 0) return { outcome: "failed_terminal", output, failure: failure("verification_failed", "Research evidence failed claim/source quality checks"), progressFingerprint };
      return { outcome: "succeeded", output, patches: [{ op: "set", path: "research", value: { sources: value.sources, claims: value.claims, marginalInformationGain: output.marginalInformationGain } as never }], evidence: [{ kind: "claim-source-ledger", uri: `graph://${context.run.runId}/${context.node.id}`, sha256: resultSetHash, summary: "Canonical claim/source evidence validation passed", checker: "production.research-evidence.v1" }], progressFingerprint };
    },
  });
  return registry;
}
