import { z } from "zod";
import { resolve } from "node:path";
import { loadRegistryBundle } from "./registry.js";
import { loadProductionIntegration, opportunityFor, resolveProductionOpportunity } from "./production-integration.js";
import { DeterministicPublishingEngine, deterministicRenderedCandidate } from "./engine.js";
import { PublishingStore } from "./store.js";
import { sha256 } from "./canonical.js";

export const ShadowDecisionEnvelopeSchema = z.object({
  workflow: z.string().min(1),
  trigger: z.record(z.unknown()),
  candidate: z.record(z.unknown()).nullable(),
  decision: z.record(z.unknown()),
  authority: z.record(z.unknown()),
  payload: z.record(z.unknown()).nullable(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  idempotencyKey: z.string().min(1).nullable(),
  providerTarget: z.record(z.unknown()).nullable(),
  expectedNextAction: z.string().min(1),
  evidenceRequirements: z.array(z.string()),
  blockReason: z.string().nullable(),
  externalWrites: z.literal(0),
  graphSafeState: z.enum(["completed", "blocked", "failed"]),
}).strict();

export type ShadowDecisionEnvelope = z.infer<typeof ShadowDecisionEnvelopeSchema>;

export type PublishingShadowInput = {
  integrationPath: string;
  registryPath: string;
  opportunityId: string;
  observedAt: string;
  authorityAllowed?: boolean;
  effectState?: "none" | "verified" | "ambiguous" | "duplicate";
  forcePolicyRejection?: boolean;
  forceMissingCampaign?: boolean;
  forceMalformedPayload?: boolean;
};

function controlledBlock(input: PublishingShadowInput, reason: string, nextAction: string): ShadowDecisionEnvelope {
  return ShadowDecisionEnvelopeSchema.parse({
    workflow: "deterministic-social-publication",
    trigger: { opportunityId: input.opportunityId, observedAt: input.observedAt },
    candidate: null,
    decision: { eligible: false, effectState: input.effectState ?? "none" },
    authority: { required: "external_public", allowed: input.authorityAllowed !== false },
    payload: null,
    payloadHash: null,
    idempotencyKey: null,
    providerTarget: null,
    expectedNextAction: nextAction,
    evidenceRequirements: ["publication-shadow-decision"],
    blockReason: reason,
    externalWrites: 0,
    graphSafeState: "blocked",
  });
}

export async function prepareProductionPublishingShadowDecision(input: PublishingShadowInput): Promise<ShadowDecisionEnvelope> {
  if (input.authorityAllowed === false) return controlledBlock(input, "authority_rejected", "wait_for_payload_bound_approval");
  if (input.effectState === "ambiguous") return controlledBlock(input, "ambiguous_provider_state", "reconcile_only");
  if (input.effectState === "verified") return controlledBlock(input, "already_verified", "no_action");
  const registry = structuredClone(await loadRegistryBundle(resolve(input.registryPath)));
  const integration = await loadProductionIntegration(resolve(input.integrationPath), registry);
  if (input.forcePolicyRejection) {
    for (const policy of registry.platformPolicies) policy.status = "retired";
  }
  if (input.forceMissingCampaign) {
    for (const campaign of registry.campaigns) campaign.status = "retired";
  }
  const observedAt = new Date(input.observedAt);
  if (Number.isNaN(observedAt.getTime())) throw new Error("publishing_shadow_observed_at_invalid");
  let resolution: ReturnType<typeof resolveProductionOpportunity>;
  try {
    resolution = resolveProductionOpportunity(integration, input.opportunityId, observedAt);
  } catch (error) {
    return controlledBlock(input, error instanceof Error ? error.message : String(error), "no_action");
  }
  const opportunity = opportunityFor(integration, resolution.opportunity.id, resolution.scheduledFor);
  const store = new PublishingStore(":memory:");
  try {
    const engine = new DeterministicPublishingEngine(registry, store);
    engine.initialize();
    const plan = engine.planSlot({ platformId: opportunity.platformId, accountId: opportunity.accountId, scheduledFor: resolution.scheduledFor, now: resolution.scheduledFor });
    if (plan.result !== "reserved" || !plan.candidate || !plan.contentSpec || !plan.reservation) {
      return ShadowDecisionEnvelopeSchema.parse({
        workflow: "deterministic-social-publication",
        trigger: { opportunityId: opportunity.id, observedAt: input.observedAt, scheduledFor: resolution.scheduledFor.toISOString() },
        candidate: plan.candidate as unknown as Record<string, unknown> | null,
        decision: { eligible: false, result: plan.result, reasons: plan.reasons },
        authority: { required: "external_public", allowed: true },
        payload: null,
        payloadHash: null,
        idempotencyKey: null,
        providerTarget: { platformId: opportunity.platformId, accountId: opportunity.accountId, connectorAccountKey: opportunity.connectorAccountKey },
        expectedNextAction: "no_action",
        evidenceRequirements: ["publication-shadow-decision"],
        blockReason: plan.reasons.join(",") || plan.result,
        externalWrites: 0,
        graphSafeState: "blocked",
      });
    }
    const rendered = deterministicRenderedCandidate(plan.contentSpec);
    const payload = { text: rendered.text, mediaUrl: rendered.mediaUrl ?? null, mediaHash: rendered.mediaHash ?? null, format: plan.contentSpec.format };
    if (input.forceMalformedPayload || !rendered.text.trim()) return controlledBlock(input, "malformed_payload", "repair_payload");
    if (input.effectState === "duplicate") return controlledBlock(input, "duplicate_candidate", "no_action");
    return ShadowDecisionEnvelopeSchema.parse({
      workflow: "deterministic-social-publication",
      trigger: { opportunityId: opportunity.id, observedAt: input.observedAt, scheduledFor: resolution.scheduledFor.toISOString(), schedulerLatenessMs: resolution.latenessMs },
      candidate: plan.candidate as unknown as Record<string, unknown>,
      decision: { eligible: true, result: "reserved", reasons: plan.reasons, contentSpecId: plan.contentSpec.id },
      authority: { required: "external_public", allowed: true },
      payload,
      payloadHash: sha256(payload),
      idempotencyKey: plan.reservation.idempotencyKey,
      providerTarget: { platformId: opportunity.platformId, accountId: opportunity.accountId, connectorAccountKey: opportunity.connectorAccountKey },
      expectedNextAction: "write_blocked_by_shadow_mode",
      evidenceRequirements: ["publication-shadow-decision", "payload-hash", "zero-provider-writes"],
      blockReason: "write_blocked_by_shadow_mode",
      externalWrites: 0,
      graphSafeState: "completed",
    });
  } finally {
    store.close();
  }
}

export type ShadowMismatch = {
  workflow: string;
  sampleId: string;
  differingFields: string[];
  category: "graph_defect" | "legacy_defect" | "normalisation_difference" | "evidence_improvement" | "authority_difference" | "idempotency_difference" | "reconciliation_difference" | "intentional_graph_hardening" | "test_fixture_defect" | "unknown";
  risk: "low" | "medium" | "high";
  disposition: string;
};

function stripIgnored(value: unknown, ignored: Set<string>, path = ""): unknown {
  if (Array.isArray(value)) return value.map((item, index) => stripIgnored(item, ignored, `${path}[${index}]`));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !ignored.has(path ? `${path}.${key}` : key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, stripIgnored(nested, ignored, path ? `${path}.${key}` : key)]));
}

function differingFields(left: unknown, right: unknown, path = ""): string[] {
  if (JSON.stringify(left) === JSON.stringify(right)) return [];
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return [path || "$root"];
  if (Array.isArray(left) && Array.isArray(right)) {
    return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => differingFields(left[index], right[index], `${path}[${index}]`)).flat();
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  return [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort()
    .flatMap((key) => differingFields(leftRecord[key], rightRecord[key], path ? `${path}.${key}` : key));
}

export function compareShadowDecisions(args: {
  workflow: string;
  sampleId: string;
  legacy: ShadowDecisionEnvelope;
  graph: ShadowDecisionEnvelope;
  ignoredFields?: string[];
  mismatchClassification?: Pick<ShadowMismatch, "category" | "risk" | "disposition">;
}): { equivalent: boolean; mismatch: ShadowMismatch | null; comparisonHash: string } {
  const ignored = new Set(args.ignoredFields ?? []);
  const legacy = stripIgnored(args.legacy, ignored);
  const graph = stripIgnored(args.graph, ignored);
  const differences = differingFields(legacy, graph);
  return {
    equivalent: differences.length === 0,
    mismatch: differences.length === 0 ? null : {
      workflow: args.workflow,
      sampleId: args.sampleId,
      differingFields: differences,
      ...(args.mismatchClassification ?? { category: "unknown", risk: "high", disposition: "unexplained_mismatch_blocks_activation" }),
    },
    comparisonHash: sha256({ legacy, graph }),
  };
}
