import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, sep } from "node:path";
import { z } from "zod";
import { ProductionAdapterRegistry } from "./adapter-registry.js";
import { failure } from "./failures.js";
import { sha256 } from "./reducer.js";
import type { JsonValue } from "./types.js";
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
  lane: z.enum(["business-value", "market-research", "git-monitor", "campaign-factory", "digest"]),
  taskType: z.string().min(1),
  agentId: z.string().min(1),
  payload: z.record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.unknown()), z.record(z.unknown())])).default({}),
}).passthrough();
const GovernedTaskOutputSchema = z.object({
  status: z.string(), lane: z.string(), childRunId: z.string().optional(),
  childReceiptHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(), verifierRunId: z.string().optional(),
  verifierReceiptHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(), chainValid: z.boolean().optional(),
}).passthrough();

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
  status: z.enum(["previewed", "prepared"]),
  projection: PublicationProjectionSchema,
  envelope: z.record(z.unknown()),
  envelopeHash: z.string().regex(/^[a-f0-9]{64}$/),
  providerWrites: z.literal(0),
}).strict();
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
    claim: { ...graphAuthorization(context, input), status: "preview" }, providerResultId: null, permalink: null, status: "previewed", verification: null,
    generatedMediaUploadCalls: 0, instagramPublishCalls: 0, browserRelayCalls: 0,
  });
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
      const result = await childRuns.executeGovernedTask(input as never, context);
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
      const result = await runner.runOpportunity(input.jobId, input.kind, { now: new Date(input.observedAt), graphAuthorization: authorization, graphDispatchGate });
      const verified = PublicationProjectionSchema.parse(await runner.instagramGraphPublicationProjection(result.entry));
      const output = { status: verified.status ?? "unknown", providerResultId: verified.providerResultId, permalink: verified.permalink, generatedMediaUploadCalls: verified.generatedMediaUploadCalls, instagramPublishCalls: verified.instagramPublishCalls, browserRelayCalls: 0 as const };
      const correct = verified.status === "verified" && verified.providerResultId && verified.permalink && verified.instagramPublishCalls === 1 && verified.browserRelayCalls === 0;
      const state = correct ? "effect_verified" as const : verified.instagramPublishCalls === 0 && verified.generatedMediaUploadCalls === 0 ? "confirmed_absent" as const : "ambiguous" as const;
      return {
        outcome: correct ? "succeeded" : state === "confirmed_absent" ? "failed_repairable" : "blocked",
        output,
        patches: [{ op: "set", path: "publicationLive.result", value: verified as unknown as JsonValue }],
        evidence: correct ? [
          { kind: "provider-publication", uri: verified.permalink!, sha256: verified.payloadSha256!, summary: "One exact Instagram provider object created", checker: "production.instagram-publication-live.v2" },
          { kind: "official-provider-readback", uri: verified.permalink!, sha256: sha256(verified.verification), summary: "Canonical worker completed owned-feed, verify, and inspect readback", checker: "production.instagram-publication-live.v2" },
          { kind: "local-publication-state", uri: `graph://${context.run.runId}/publication/local-state`, sha256: sha256(verified), summary: "Canonical outbox and graph claim reached verified", checker: "production.instagram-publication-live.v2" },
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
