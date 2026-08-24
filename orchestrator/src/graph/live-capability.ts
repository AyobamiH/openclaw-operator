import { randomUUID } from "node:crypto";
import { buildApprovalPayloadHash } from "./authority.js";
import { frozenEnvelopeHash, type FrozenPublicationEnvelope, LIVE_PUBLICATION_GRAPH_IDENTITY } from "./live-publication.js";
import { sha256 } from "./reducer.js";
import type { GraphStore } from "./store.js";
import type { GraphRunState, LiveCapabilityDispatch, OneRunLiveCapability } from "./types.js";
import type { GraphApproval } from "./authority.js";

export const LIVE_CAPABILITY_AWARE_HANDLER = "production.instagram-publication-live.v2";
export const SOCIAL_LIVE_CAPABILITY_AWARE_HANDLERS = Object.freeze([
  "production.threads-publication-live.v1",
  "production.meta-reply-live.v1",
  "production.digest-delivery.v1",
] as const);
export const LIVE_CAPABILITY_GRAPH_ID = "deterministic-social-publication";
export const LIVE_CAPABILITY_GRAPH_VERSION = "2.0.0";
export const LIVE_CAPABILITY_DEFINITION_HASH = "995ff8355a57113884129b7cda9f7966d4719163f9b9b81ed77e87d12c6a3473";

export const INSTAGRAM_LIVE_MUTATION_PLAN = Object.freeze([
  { stepIndex: 0, stepId: "delivery_upload", expectedOperation: "generated_media_delivery_upload", predecessorStepId: undefined },
  { stepIndex: 1, stepId: "instagram_publish", expectedOperation: "relay_live_business_engagement_execute:publish", predecessorStepId: "delivery_upload" },
] as const);

type PublicationLiveState = {
  projection: {
    claim?: Record<string, unknown> | null;
  };
  envelope: FrozenPublicationEnvelope;
  envelopeHash: string;
};

type SocialEffectState = {
  status: string;
  action: "publish" | "reply" | "skip" | "shadow";
  outboxId: string | null;
  payloadHash: string | null;
  targetId: string | null;
  topicTag: string | null;
  mediaPath: string | null;
  mediaHash: string | null;
  mediaBytesHash: string | null;
  creativeFingerprint: string | null;
  layoutReceipt: Record<string, unknown> | null;
  layoutReceiptHash: string | null;
  rendererIdentity: Record<string, unknown> | null;
  rendererIdentityHash: string | null;
};

function isSocialHandler(value: string): value is (typeof SOCIAL_LIVE_CAPABILITY_AWARE_HANDLERS)[number] {
  return SOCIAL_LIVE_CAPABILITY_AWARE_HANDLERS.includes(value as (typeof SOCIAL_LIVE_CAPABILITY_AWARE_HANDLERS)[number]);
}

function expectedDigestCapabilityBindings(args: { run: GraphRunState; approval: GraphApproval; definitionHash: string }) {
  const target = String((args.run.data as Record<string, unknown>).target ?? "digest-delivery:deliver_notification");
  const ingressId = String(args.run.input.ingressId ?? args.run.correlationId ?? args.run.runId);
  const idempotencyKey = sha256({ runId: args.run.runId, nodeId: "deliver_notification", target, payloadHash: args.approval.payloadHash, operationType: "production.digest-delivery.v1" });
  const envelopeHash = sha256({ graphId: args.run.graphId, graphVersion: args.run.graphVersion, runId: args.run.runId, input: args.run.input, definitionHash: args.definitionHash });
  return {
    graphId: args.run.graphId, graphVersion: args.run.graphVersion, graphDefinitionHash: args.definitionHash, graphRunId: args.run.runId,
    claimId: `digest:${args.run.runId}`, approvalId: args.approval.approvalId, provider: "telegram", accountId: "configured-notification-channel",
    operationType: "production.digest-delivery.v1", candidateId: ingressId, campaignId: "continuous-marketing-end-of-day-digest-v1",
    sequenceId: ingressId, slotId: ingressId, payloadHash: args.approval.payloadHash, mediaHash: undefined, envelopeHash,
    idempotencyKeyFingerprint: sha256(idempotencyKey), maximumMutatingDispatches: 1, maximumSuccessfulPublications: 1,
  };
}

function expectedSocialCapabilityBindings(args: { run: GraphRunState; approval: GraphApproval; nodeHandler: string; definitionHash: string }) {
  const social = args.run.data.socialEffect as unknown as SocialEffectState | undefined;
  const provider = String(args.run.input.provider ?? "");
  const accountKey = String(args.run.input.accountKey ?? "");
  const jobId = String(args.run.input.jobId ?? "");
  const requiresDeliveryUpload = args.run.graphId === "threads-publication" && jobId === "083e3560-40fd-4487-9d78-674f64866ef7";
  if (!social?.outboxId || !social.payloadHash || !["publish", "reply"].includes(social.action)) throw new Error("social_live_capability_preparation_missing");
  if ((args.nodeHandler.includes("threads") && social.action !== "publish") || (args.nodeHandler.includes("meta-reply") && social.action !== "reply")) throw new Error("social_live_capability_action_mismatch");
  if (requiresDeliveryUpload && (!social.mediaHash || social.mediaBytesHash !== social.mediaHash || !social.topicTag || !social.creativeFingerprint || !social.layoutReceiptHash || !social.rendererIdentityHash)) throw new Error("social_live_capability_image_proof_missing");
  const definitionHash = args.definitionHash;
  const envelopeHash = sha256({ graphId: args.run.graphId, graphVersion: args.run.graphVersion, runId: args.run.runId, social, provider, accountKey, jobId, definitionHash });
  const idempotencyKey = sha256({ runId: args.run.runId, nodeId: "perform_exact_effect", target: social.targetId ?? social.outboxId, payloadHash: args.approval.payloadHash, operationType: args.nodeHandler });
  return {
    graphId: args.run.graphId,
    graphVersion: args.run.graphVersion,
    graphDefinitionHash: definitionHash,
    graphRunId: args.run.runId,
    claimId: `social:${social.outboxId}:${args.run.runId}`,
    approvalId: args.approval.approvalId,
    provider,
    accountId: accountKey,
    operationType: args.nodeHandler,
    candidateId: social.targetId ?? social.outboxId,
    campaignId: jobId,
    sequenceId: social.outboxId,
    slotId: social.outboxId,
    payloadHash: social.payloadHash,
    mediaHash: social.mediaHash ?? undefined,
    envelopeHash,
    idempotencyKeyFingerprint: sha256(idempotencyKey),
    maximumMutatingDispatches: requiresDeliveryUpload ? 2 : 1,
    maximumSuccessfulPublications: 1,
  };
}

function nonWildcard(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === "*" || normalized.includes("*")) throw new Error(`one_run_live_capability_wildcard_rejected:${field}`);
  return normalized;
}

export function expectedCapabilityBindings(args: {
  runId: string;
  approvalId: string;
  approvalPayloadHash: string;
  envelope: FrozenPublicationEnvelope;
  envelopeHash: string;
}): Omit<OneRunLiveCapability, "capabilityId" | "status" | "issuedAt" | "notBefore" | "expiresAt" | "issuedBy" | "consumedAt" | "revokedAt" | "failureReason"> {
  const effectIdempotencyKey = sha256({
    runId: args.runId,
    nodeId: "publish_provider_object",
    target: args.envelope.providerTarget,
    payloadHash: args.approvalPayloadHash,
    operationType: LIVE_CAPABILITY_AWARE_HANDLER,
  });
  return {
    graphId: args.envelope.graphId,
    graphVersion: args.envelope.graphVersion,
    graphDefinitionHash: args.envelope.definitionHash,
    graphRunId: args.runId,
    claimId: args.envelope.claimId,
    approvalId: args.approvalId,
    provider: args.envelope.provider,
    accountId: args.envelope.accountId,
    operationType: LIVE_CAPABILITY_AWARE_HANDLER,
    candidateId: args.envelope.candidateId,
    campaignId: args.envelope.campaignId,
    sequenceId: args.envelope.sequenceId,
    slotId: args.envelope.slotId,
    payloadHash: args.envelope.payloadSha256,
    mediaHash: args.envelope.mediaSha256,
    envelopeHash: args.envelopeHash,
    idempotencyKeyFingerprint: sha256(effectIdempotencyKey),
    maximumMutatingDispatches: INSTAGRAM_LIVE_MUTATION_PLAN.length,
    maximumSuccessfulPublications: 1,
  };
}

export function validateOneRunLiveCapabilityForMutation(args: {
  store: GraphStore;
  run: GraphRunState;
  approval: GraphApproval;
  nodeHandler: string;
  globalZeroWrite: boolean;
  now?: Date;
}): { capability: OneRunLiveCapability; expected: ReturnType<typeof expectedCapabilityBindings> } {
  if (args.globalZeroWrite !== true) throw new Error("one_run_live_capability_requires_global_zero_write");
  if (args.nodeHandler !== LIVE_CAPABILITY_AWARE_HANDLER && !isSocialHandler(args.nodeHandler)) throw new Error("one_run_live_capability_node_not_aware");
  const capability = args.store.oneRunLiveCapabilityForRun(args.run.runId);
  if (!capability) throw new Error("one_run_live_capability_missing");
  const now = args.now ?? new Date();
  if (!["prepared", "active"].includes(capability.status)) throw new Error(`one_run_live_capability_not_usable:${capability.status}`);
  if (Date.parse(capability.notBefore) > now.getTime()) throw new Error("one_run_live_capability_not_yet_valid");
  if (Date.parse(capability.expiresAt) <= now.getTime()) throw new Error("one_run_live_capability_expired");
  if (isSocialHandler(args.nodeHandler)) {
    const definition = args.store.definitionRecord(args.run.graphId, args.run.graphVersion);
    if (!definition) throw new Error("one_run_live_capability_definition_missing");
    const expected = args.nodeHandler === "production.digest-delivery.v1"
      ? expectedDigestCapabilityBindings({ run: args.run, approval: args.approval, definitionHash: definition.definitionHash })
      : expectedSocialCapabilityBindings({ run: args.run, approval: args.approval, nodeHandler: args.nodeHandler, definitionHash: definition.definitionHash });
    for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
      if ((capability[key] ?? null) !== (expected[key] ?? null)) throw new Error(`one_run_live_capability_binding_mismatch:${key}`);
    }
    return { capability, expected };
  }
  const publicationLive = args.run.data.publicationLive as unknown as PublicationLiveState | undefined;
  const envelope = publicationLive?.envelope;
  if (!envelope || publicationLive?.envelopeHash !== frozenEnvelopeHash(envelope)) throw new Error("one_run_live_capability_frozen_envelope_missing");
  const expected = expectedCapabilityBindings({
    runId: args.run.runId,
    approvalId: args.approval.approvalId,
    approvalPayloadHash: args.approval.payloadHash,
    envelope,
    envelopeHash: publicationLive.envelopeHash,
  });
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if ((capability[key] ?? null) !== (expected[key] ?? null)) throw new Error(`one_run_live_capability_binding_mismatch:${key}`);
  }
  return { capability, expected };
}

export function issueOneRunLiveCapability(args: {
  store: GraphStore;
  runId: string;
  approvalId: string;
  issuedBy: string;
  expiresAt: string;
  notBefore?: string;
  globalZeroWrite: boolean;
  now?: Date;
}): OneRunLiveCapability {
  if (args.globalZeroWrite !== true) throw new Error("one_run_live_capability_requires_global_zero_write");
  const now = args.now ?? new Date();
  const run = args.store.getRun(args.runId);
  if (!run) throw new Error(`graph_run_not_found:${args.runId}`);
  if (["threads-publication", "meta-reply-monitor", "digest-delivery"].includes(run.graphId) && run.graphVersion === "1.0.0") {
    const nodeId = run.graphId === "digest-delivery" ? "deliver_notification" : "perform_exact_effect";
    if (run.currentNodeId !== nodeId || !["waiting_for_approval", "running", "blocked"].includes(run.status)) throw new Error("one_run_live_capability_run_not_at_mutation_boundary");
    if (run.input.shadowMode === true) throw new Error("one_run_live_capability_shadow_run_forbidden");
    const definition = args.store.definitionRecord(run.graphId, run.graphVersion);
    if (!definition) throw new Error("one_run_live_capability_definition_missing");
    const approval = args.store.approvals(run.runId).find((item) => item.approvalId === args.approvalId);
    if (!approval || approval.status !== "granted" || Date.parse(approval.expiresAt) <= now.getTime()) throw new Error("one_run_live_capability_approval_not_granted");
    const nodeHandler = run.graphId === "threads-publication" ? "production.threads-publication-live.v1" : run.graphId === "meta-reply-monitor" ? "production.meta-reply-live.v1" : "production.digest-delivery.v1";
    const expectedTarget = String((run.data as Record<string, unknown>).target ?? `${run.graphId}:${nodeId}`);
    const recomputedApprovalPayloadHash = buildApprovalPayloadHash({ objective: run.objective, input: run.input, data: run.data });
    if (approval.nodeId !== nodeId || approval.action !== nodeHandler || approval.target !== expectedTarget || approval.payloadHash !== recomputedApprovalPayloadHash) throw new Error("one_run_live_capability_approval_envelope_mismatch");
    if (args.store.externalEffects(run.runId).length !== 0) throw new Error("one_run_live_capability_effect_already_exists");
    const notBefore = args.notBefore ?? now.toISOString();
    const expiry = Date.parse(args.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Math.max(now.getTime(), Date.parse(notBefore)) || expiry - now.getTime() > 30 * 60_000 || expiry > Date.parse(approval.expiresAt)) throw new Error("one_run_live_capability_expiry_invalid");
    const bindings = run.graphId === "digest-delivery"
      ? expectedDigestCapabilityBindings({ run, approval, definitionHash: definition.definitionHash })
      : expectedSocialCapabilityBindings({ run, approval, nodeHandler, definitionHash: definition.definitionHash });
    for (const [field, value] of Object.entries(bindings)) if (value !== undefined) nonWildcard(String(value), field);
    const capabilityId = `glc_${sha256({ bindings, issuedAt: now.toISOString(), issuedBy: args.issuedBy, nonce: randomUUID() }).slice(0, 32)}`;
    const capability: OneRunLiveCapability = { capabilityId, status: "prepared", ...bindings, issuedAt: now.toISOString(), notBefore, expiresAt: args.expiresAt, issuedBy: nonWildcard(args.issuedBy, "issuedBy") };
    const requiresDeliveryUpload = run.graphId === "threads-publication" && String(run.input.jobId) === "083e3560-40fd-4487-9d78-674f64866ef7";
    const providerStepId = run.graphId === "digest-delivery" ? "notification_effect" : "provider_effect";
    const dispatches: LiveCapabilityDispatch[] = [
      ...(requiresDeliveryUpload ? [{ dispatchId: `glcd_${sha256({ capabilityId, stepId: "delivery_upload" }).slice(0, 32)}`, capabilityId, stepIndex: 0, stepId: "delivery_upload", expectedOperation: "generated_media_delivery_upload", maximumDispatchCount: 1 as const, dispatchCount: 0, state: "prepared" as const }] : []),
      { dispatchId: `glcd_${sha256({ capabilityId, stepId: providerStepId }).slice(0, 32)}`, capabilityId, stepIndex: requiresDeliveryUpload ? 1 : 0, stepId: providerStepId, expectedOperation: nodeHandler, ...(requiresDeliveryUpload ? { predecessorStepId: "delivery_upload" } : {}), maximumDispatchCount: 1, dispatchCount: 0, state: "prepared" },
    ];
    return args.store.issueOneRunLiveCapability(capability, dispatches, args.issuedBy);
  }
  if (run.graphId !== LIVE_CAPABILITY_GRAPH_ID || run.graphVersion !== LIVE_CAPABILITY_GRAPH_VERSION) throw new Error("one_run_live_capability_graph_not_allowed");
  if (run.currentNodeId !== "publish_provider_object" || !["waiting_for_approval", "running", "blocked"].includes(run.status)) throw new Error("one_run_live_capability_run_not_at_mutation_boundary");
  if (run.input.shadowMode === true) throw new Error("one_run_live_capability_shadow_run_forbidden");
  const definition = args.store.definitionRecord(run.graphId, run.graphVersion);
  if (!definition || definition.definitionHash !== LIVE_CAPABILITY_DEFINITION_HASH) throw new Error("one_run_live_capability_definition_hash_mismatch");
  const publicationLive = run.data.publicationLive as unknown as PublicationLiveState | undefined;
  const envelope = publicationLive?.envelope;
  if (!envelope || publicationLive?.envelopeHash !== frozenEnvelopeHash(envelope)) throw new Error("one_run_live_capability_frozen_envelope_missing");
  if (`${envelope.graphId}@${envelope.graphVersion}` !== LIVE_PUBLICATION_GRAPH_IDENTITY || envelope.definitionHash !== definition.definitionHash || envelope.graphRunId !== run.runId) throw new Error("one_run_live_capability_envelope_graph_binding_mismatch");
  const claim = publicationLive.projection?.claim;
  if (!claim || !["prepared", "approved"].includes(String(claim.status)) || String(claim.claimId) !== envelope.claimId || String(claim.runId) !== run.runId || String(claim.definitionHash) !== definition.definitionHash) {
    throw new Error("one_run_live_capability_claim_binding_invalid");
  }
  if (!claim.leaseExpiresAt || Date.parse(String(claim.leaseExpiresAt)) <= now.getTime()) throw new Error("one_run_live_capability_claim_expired");
  const approval = args.store.approvals(run.runId).find((item) => item.approvalId === args.approvalId);
  if (!approval || approval.status !== "granted" || Date.parse(approval.expiresAt) <= now.getTime()) throw new Error("one_run_live_capability_approval_not_granted");
  const recomputedApprovalPayloadHash = buildApprovalPayloadHash({ objective: run.objective, input: run.input, data: run.data });
  if (approval.nodeId !== "publish_provider_object" || approval.action !== LIVE_CAPABILITY_AWARE_HANDLER || approval.target !== envelope.providerTarget || approval.payloadHash !== recomputedApprovalPayloadHash || envelope.approvalId !== approval.approvalId) {
    throw new Error("one_run_live_capability_approval_envelope_mismatch");
  }
  if (args.store.externalEffects(run.runId).length !== 0) throw new Error("one_run_live_capability_effect_already_exists");
  const notBefore = args.notBefore ?? now.toISOString();
  const expiry = Date.parse(args.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Math.max(now.getTime(), Date.parse(notBefore))) throw new Error("one_run_live_capability_expiry_invalid");
  if (expiry - now.getTime() > 30 * 60 * 1000) throw new Error("one_run_live_capability_expiry_too_long");
  if (expiry > Date.parse(approval.expiresAt) || expiry > Date.parse(String(claim.leaseExpiresAt)) || expiry > Date.parse(envelope.approvalExpiry)) throw new Error("one_run_live_capability_expiry_exceeds_binding");
  for (const [field, value] of Object.entries({
    graphId: envelope.graphId, graphVersion: envelope.graphVersion, graphRunId: run.runId, claimId: envelope.claimId,
    approvalId: approval.approvalId, provider: envelope.provider, accountId: envelope.accountId,
    candidateId: envelope.candidateId, campaignId: envelope.campaignId, sequenceId: envelope.sequenceId,
    slotId: envelope.slotId, payloadHash: envelope.payloadSha256, mediaHash: envelope.mediaSha256,
  })) nonWildcard(String(value), field);
  const bindings = expectedCapabilityBindings({ runId: run.runId, approvalId: approval.approvalId, approvalPayloadHash: approval.payloadHash, envelope, envelopeHash: publicationLive.envelopeHash });
  const capabilityId = `glc_${sha256({ bindings, issuedAt: now.toISOString(), issuedBy: args.issuedBy, nonce: randomUUID() }).slice(0, 32)}`;
  const capability: OneRunLiveCapability = {
    capabilityId,
    status: "prepared",
    ...bindings,
    issuedAt: now.toISOString(),
    notBefore,
    expiresAt: args.expiresAt,
    issuedBy: nonWildcard(args.issuedBy, "issuedBy"),
  };
  const dispatches: LiveCapabilityDispatch[] = INSTAGRAM_LIVE_MUTATION_PLAN.map((step) => ({
    dispatchId: `glcd_${sha256({ capabilityId, stepId: step.stepId }).slice(0, 32)}`,
    capabilityId,
    stepIndex: step.stepIndex,
    stepId: step.stepId,
    expectedOperation: step.expectedOperation,
    predecessorStepId: step.predecessorStepId,
    maximumDispatchCount: 1,
    dispatchCount: 0,
    state: "prepared",
  }));
  return args.store.issueOneRunLiveCapability(capability, dispatches, args.issuedBy);
}

export function grantOneRunLiveApproval(args: {
  store: GraphStore;
  runId: string;
  approvalId: string;
  approver: string;
  expiresAt: string;
  note?: string;
  globalZeroWrite: boolean;
  now?: Date;
}): GraphApproval {
  if (args.globalZeroWrite !== true) throw new Error("one_run_live_approval_requires_global_zero_write");
  const now = args.now ?? new Date();
  const run = args.store.getRun(args.runId);
  if (!run || run.graphId !== LIVE_CAPABILITY_GRAPH_ID || run.graphVersion !== LIVE_CAPABILITY_GRAPH_VERSION) throw new Error("one_run_live_approval_graph_not_allowed");
  const publicationLive = run.data.publicationLive as unknown as PublicationLiveState | undefined;
  const envelope = publicationLive?.envelope;
  if (!envelope || publicationLive?.envelopeHash !== frozenEnvelopeHash(envelope)) throw new Error("one_run_live_approval_frozen_envelope_missing");
  if (envelope.graphRunId !== run.runId || envelope.approvalId !== args.approvalId || envelope.definitionHash !== LIVE_CAPABILITY_DEFINITION_HASH) throw new Error("one_run_live_approval_envelope_binding_mismatch");
  const approval = args.store.approvals(run.runId).find((item) => item.approvalId === args.approvalId);
  const payloadHash = buildApprovalPayloadHash({ objective: run.objective, input: run.input, data: run.data });
  if (!approval || approval.status !== "pending" || approval.nodeId !== "publish_provider_object" || approval.action !== LIVE_CAPABILITY_AWARE_HANDLER || approval.target !== envelope.providerTarget || approval.payloadHash !== payloadHash) {
    throw new Error("one_run_live_approval_not_exact_pending_envelope");
  }
  const claim = publicationLive.projection?.claim;
  if (!claim || String(claim.claimId) !== envelope.claimId || String(claim.runId) !== run.runId || !["prepared", "approved"].includes(String(claim.status))) throw new Error("one_run_live_approval_claim_binding_invalid");
  const expiry = Date.parse(args.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now.getTime() || expiry - now.getTime() > 30 * 60_000) throw new Error("one_run_live_approval_expiry_invalid");
  if (expiry > Date.parse(envelope.approvalExpiry) || expiry > Date.parse(String(claim.leaseExpiresAt))) throw new Error("one_run_live_approval_expiry_exceeds_binding");
  return args.store.decideApproval(args.approvalId, "granted", nonWildcard(args.approver, "approver"), args.expiresAt, args.note);
}
