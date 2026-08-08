import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  CAMPAIGN_TYPES,
  PRODUCT_STATES,
  PROHIBITED_PLATFORM_IDS,
  type PublishingRegistryBundle,
  type VersionedRegistryRecord,
} from "./types.js";
import { sha256 } from "./canonical.js";

const ISO_DATE = z.string().datetime({ offset: true });
const platformId = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);
const status = z.enum(["draft", "approved", "active", "paused", "retired", "blocked"]);
const versioned = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  status,
  approvalId: z.string().min(1).nullable().optional(),
  createdAt: ISO_DATE,
  updatedAt: ISO_DATE,
});

const bundleSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  registryVersion: z.string().min(1),
  updatedAt: ISO_DATE,
  products: z.array(versioned.extend({
    name: z.string().min(1),
    state: z.enum(PRODUCT_STATES),
    targetAudienceIds: z.array(z.string().min(1)).min(1),
    allowedCampaignTypes: z.array(z.enum(CAMPAIGN_TYPES)).min(1),
    claimIds: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    assetIds: z.array(z.string().min(1)),
    defaultCtaId: z.string().min(1),
    minimumCooldownHours: z.number().nonnegative(),
    dailyPublicationCap: z.number().int().positive(),
  })),
  campaigns: z.array(versioned.extend({
    productId: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(CAMPAIGN_TYPES),
    audienceId: z.string().min(1),
    identitySignalIds: z.array(z.string().min(1)).min(1),
    problemOutcomeIds: z.array(z.string().min(1)).min(1),
    strategyId: z.string().min(1),
    templateIds: z.array(z.string().min(1)).min(1),
    platformIds: z.array(platformId).min(1),
    ctaId: z.string().min(1),
    claimIds: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    priority: z.number().min(0).max(1),
    minimumCooldownHours: z.number().nonnegative(),
    dailyCap: z.number().int().positive(),
    startAt: ISO_DATE.nullable().optional(),
    endAt: ISO_DATE.nullable().optional(),
  })),
  audiences: z.array(versioned.extend({
    name: z.string().min(1),
    description: z.string().min(1),
    exclusions: z.array(z.string()),
  })),
  identitySignals: z.array(versioned.extend({
    audienceId: z.string().min(1),
    signal: z.string().min(1),
    evidenceRequirement: z.string().min(1),
  })),
  problemsOutcomes: z.array(versioned.extend({
    problem: z.string().min(1),
    outcome: z.string().min(1),
    productIds: z.array(z.string().min(1)).min(1),
  })),
  contentStrategies: z.array(versioned.extend({
    name: z.string().min(1),
    objective: z.string().min(1),
    allowedCampaignTypes: z.array(z.enum(CAMPAIGN_TYPES)).min(1),
    prohibitedPatterns: z.array(z.string()),
  })),
  claims: z.array(versioned.extend({
    text: z.string().min(1),
    productId: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)).min(1),
    expiresAt: ISO_DATE.nullable().optional(),
    risk: z.enum(["low", "medium", "high"]),
  })),
  evidence: z.array(versioned.extend({
    kind: z.enum(["repository", "runtime", "provider", "document", "metric", "asset"]),
    source: z.string().min(1),
    capturedAt: ISO_DATE,
    summary: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
    expiresAt: ISO_DATE.nullable().optional(),
  })),
  assets: z.array(versioned.extend({
    productId: z.string().min(1),
    kind: z.enum(["image", "video", "audio", "document", "repository"]),
    source: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
    perceptualHash: z.string().min(1).nullable().optional(),
    canonical: z.boolean(),
    providerPublicationIds: z.array(z.string()),
  })),
  ctas: z.array(versioned.extend({
    label: z.string().min(1),
    intent: z.enum(["conversation", "diagnostic", "repository", "website", "none"]),
    text: z.string().min(1),
    url: z.string().url().nullable().optional(),
  })),
  platformPolicies: z.array(versioned.extend({
    platformId,
    accountId: z.string().min(1),
    connectorId: z.string().min(1),
    allowedFormats: z.array(z.enum(["text", "image", "reel"])).min(1),
    maxCaptionLength: z.number().int().positive(),
    maxDailyPublications: z.number().int().positive(),
    minimumSpacingMinutes: z.number().int().nonnegative(),
    requiresProviderReadback: z.literal(true),
    requiresOfficialApi: z.literal(true),
  })),
  schedules: z.array(versioned.extend({
    timezone: z.literal("Europe/London"),
    slotTimes: z.array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)).min(1),
    primaryCampaignType: z.literal("self-identification"),
    opportunityOnly: z.literal(true),
    enabled: z.boolean(),
  })),
  templates: z.array(versioned.extend({
    name: z.string().min(1),
    campaignTypes: z.array(z.enum(CAMPAIGN_TYPES)).min(1),
    platformIds: z.array(platformId).min(1),
    format: z.enum(["text", "image", "reel"]),
    fields: z.object({
      hook: z.string().min(1),
      body: z.string().min(1),
      cta: z.string().min(1),
      altText: z.string().min(1).optional(),
    }),
    requiredVariables: z.array(z.string().min(1)),
  })),
  prompts: z.array(versioned.extend({
    purpose: z.literal("constrained-language-render"),
    schemaVersion: z.string().min(1),
    instructions: z.string().min(1),
    allowedFields: z.array(z.string().min(1)),
    fallbackTemplateId: z.string().min(1),
  })),
  experiments: z.array(versioned.extend({
    name: z.string().min(1),
    approved: z.boolean(),
    hypothesis: z.string().min(1),
    metricDefinitionId: z.string().min(1),
    campaignIds: z.array(z.string().min(1)),
    adjustment: z.number().min(-0.15).max(0.15),
    startsAt: ISO_DATE,
    endsAt: ISO_DATE,
    minimumSamples: z.number().int().positive().optional(),
    stoppingRule: z.string().min(1).optional(),
  })),
  approvals: z.array(versioned.extend({
    scope: z.string().min(1),
    decision: z.enum(["approved", "rejected", "pending", "expired"]),
    approver: z.string().min(1),
    decidedAt: ISO_DATE.nullable().optional(),
    expiresAt: ISO_DATE.nullable().optional(),
    evidence: z.array(z.string()),
  })),
  metricDefinitions: z.array(versioned.extend({
    name: z.string().min(1),
    unit: z.string().min(1),
    source: z.enum(["provider", "website", "crm", "manual"]),
    unavailableIsZero: z.literal(false),
  })),
  attributionDefinitions: z.array(versioned.extend({
    name: z.string().min(1),
    fromType: z.string().min(1),
    toType: z.string().min(1),
    minimumEvidenceCount: z.number().int().positive(),
    allowedConfidence: z.array(z.enum(["low", "medium", "high"])).min(1),
  })),
});

type RegistryKey = Exclude<keyof PublishingRegistryBundle, "schemaVersion" | "registryVersion" | "updatedAt">;

function uniqueIds(key: RegistryKey, records: VersionedRegistryRecord[], errors: string[]): Set<string> {
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id)) errors.push(`${key}: duplicate id ${record.id}`);
    ids.add(record.id);
  }
  return ids;
}

function requireRefs(
  label: string,
  refs: string[],
  allowed: Set<string>,
  errors: string[],
): void {
  for (const ref of refs) {
    if (!allowed.has(ref)) errors.push(`${label}: missing reference ${ref}`);
  }
}

export function validateRegistryBundle(raw: unknown): PublishingRegistryBundle {
  const bundle = bundleSchema.parse(raw) as PublishingRegistryBundle;
  const errors: string[] = [];
  const ids = {
    products: uniqueIds("products", bundle.products, errors),
    campaigns: uniqueIds("campaigns", bundle.campaigns, errors),
    audiences: uniqueIds("audiences", bundle.audiences, errors),
    identitySignals: uniqueIds("identitySignals", bundle.identitySignals, errors),
    problemsOutcomes: uniqueIds("problemsOutcomes", bundle.problemsOutcomes, errors),
    contentStrategies: uniqueIds("contentStrategies", bundle.contentStrategies, errors),
    claims: uniqueIds("claims", bundle.claims, errors),
    evidence: uniqueIds("evidence", bundle.evidence, errors),
    assets: uniqueIds("assets", bundle.assets, errors),
    ctas: uniqueIds("ctas", bundle.ctas, errors),
    platformPolicies: uniqueIds("platformPolicies", bundle.platformPolicies, errors),
    schedules: uniqueIds("schedules", bundle.schedules, errors),
    templates: uniqueIds("templates", bundle.templates, errors),
    prompts: uniqueIds("prompts", bundle.prompts, errors),
    experiments: uniqueIds("experiments", bundle.experiments, errors),
    approvals: uniqueIds("approvals", bundle.approvals, errors),
    metricDefinitions: uniqueIds("metricDefinitions", bundle.metricDefinitions, errors),
    attributionDefinitions: uniqueIds("attributionDefinitions", bundle.attributionDefinitions, errors),
  };

  for (const product of bundle.products) {
    requireRefs(`product:${product.id}:audiences`, product.targetAudienceIds, ids.audiences, errors);
    requireRefs(`product:${product.id}:claims`, product.claimIds, ids.claims, errors);
    requireRefs(`product:${product.id}:evidence`, product.evidenceIds, ids.evidence, errors);
    requireRefs(`product:${product.id}:assets`, product.assetIds, ids.assets, errors);
    requireRefs(`product:${product.id}:cta`, [product.defaultCtaId], ids.ctas, errors);
  }
  for (const policy of bundle.platformPolicies) {
    if (PROHIBITED_PLATFORM_IDS.has(policy.platformId)) {
      errors.push(`platform-policy:${policy.id}: ${policy.platformId} is explicitly prohibited`);
    }
  }
  for (const campaign of bundle.campaigns) {
    for (const prohibited of campaign.platformIds.filter((id) => PROHIBITED_PLATFORM_IDS.has(id))) {
      errors.push(`campaign:${campaign.id}: ${prohibited} is explicitly prohibited`);
    }
    requireRefs(`campaign:${campaign.id}:product`, [campaign.productId], ids.products, errors);
    requireRefs(`campaign:${campaign.id}:audience`, [campaign.audienceId], ids.audiences, errors);
    requireRefs(`campaign:${campaign.id}:signals`, campaign.identitySignalIds, ids.identitySignals, errors);
    requireRefs(`campaign:${campaign.id}:problems`, campaign.problemOutcomeIds, ids.problemsOutcomes, errors);
    requireRefs(`campaign:${campaign.id}:strategy`, [campaign.strategyId], ids.contentStrategies, errors);
    requireRefs(`campaign:${campaign.id}:templates`, campaign.templateIds, ids.templates, errors);
    requireRefs(`campaign:${campaign.id}:cta`, [campaign.ctaId], ids.ctas, errors);
    requireRefs(`campaign:${campaign.id}:claims`, campaign.claimIds, ids.claims, errors);
    requireRefs(`campaign:${campaign.id}:evidence`, campaign.evidenceIds, ids.evidence, errors);
    const product = bundle.products.find((item) => item.id === campaign.productId);
    const strategy = bundle.contentStrategies.find((item) => item.id === campaign.strategyId);
    if (product && !product.allowedCampaignTypes.includes(campaign.type)) {
      errors.push(`campaign:${campaign.id}: type ${campaign.type} is not allowed by product ${product.id}`);
    }
    if (strategy && (
      strategy.status !== "active" ||
      !strategy.allowedCampaignTypes.includes(campaign.type)
    )) {
      errors.push(
        `campaign:${campaign.id}: strategy ${strategy.id} does not allow ${campaign.type}`,
      );
    }
    if (product && !product.targetAudienceIds.includes(campaign.audienceId)) {
      errors.push(`campaign:${campaign.id}: audience ${campaign.audienceId} is not approved for product ${product.id}`);
    }
    for (const signalId of campaign.identitySignalIds) {
      const signal = bundle.identitySignals.find((item) => item.id === signalId);
      if (signal && signal.audienceId !== campaign.audienceId) {
        errors.push(`campaign:${campaign.id}: identity signal ${signalId} belongs to audience ${signal.audienceId}`);
      }
    }
    for (const problemId of campaign.problemOutcomeIds) {
      const problem = bundle.problemsOutcomes.find((item) => item.id === problemId);
      if (problem && !problem.productIds.includes(campaign.productId)) {
        errors.push(`campaign:${campaign.id}: problem/outcome ${problemId} is not approved for product ${campaign.productId}`);
      }
    }
    for (const claimId of campaign.claimIds) {
      const claim = bundle.claims.find((item) => item.id === claimId);
      if (claim && claim.productId !== campaign.productId) {
        errors.push(`campaign:${campaign.id}: claim ${claimId} belongs to product ${claim.productId}`);
      }
    }
    for (const templateId of campaign.templateIds) {
      const template = bundle.templates.find((item) => item.id === templateId);
      if (template && !template.campaignTypes.includes(campaign.type)) {
        errors.push(`campaign:${campaign.id}: template ${templateId} does not allow ${campaign.type}`);
      }
      if (template && !template.platformIds.some((id) => campaign.platformIds.includes(id))) {
        errors.push(`campaign:${campaign.id}: template ${templateId} has no compatible platform`);
      }
    }
    if (campaign.status === "active") {
      for (const id of campaign.platformIds) {
        const activePolicy = bundle.platformPolicies.some(
          (policy) => policy.platformId === id && policy.status === "active",
        );
        if (!activePolicy) errors.push(`campaign:${campaign.id}: active platform ${id} has no active policy`);
      }
    }
  }
  for (const template of bundle.templates) {
    for (const prohibited of template.platformIds.filter((id) => PROHIBITED_PLATFORM_IDS.has(id))) {
      errors.push(`template:${template.id}: ${prohibited} is explicitly prohibited`);
    }
  }
  for (const claim of bundle.claims) {
    requireRefs(`claim:${claim.id}:product`, [claim.productId], ids.products, errors);
    requireRefs(`claim:${claim.id}:evidence`, claim.evidenceIds, ids.evidence, errors);
  }
  for (const asset of bundle.assets) {
    requireRefs(`asset:${asset.id}:product`, [asset.productId], ids.products, errors);
  }
  for (const experiment of bundle.experiments) {
    requireRefs(`experiment:${experiment.id}:metric`, [experiment.metricDefinitionId], ids.metricDefinitions, errors);
    requireRefs(`experiment:${experiment.id}:campaigns`, experiment.campaignIds, ids.campaigns, errors);
  }
  for (const prompt of bundle.prompts) {
    requireRefs(`prompt:${prompt.id}:fallback`, [prompt.fallbackTemplateId], ids.templates, errors);
  }
  for (const record of Object.values(bundle).flatMap((value) => Array.isArray(value) ? value : [])) {
    const approvalId = (record as VersionedRegistryRecord).approvalId;
    if (approvalId) {
      requireRefs(`record:${(record as VersionedRegistryRecord).id}:approval`, [approvalId], ids.approvals, errors);
      const approval = bundle.approvals.find((item) => item.id === approvalId);
      if (approval && approval.decision !== "approved") {
        errors.push(`record:${(record as VersionedRegistryRecord).id}: approval ${approvalId} is not approved`);
      }
    }
  }
  const activeSchedules = bundle.schedules.filter(
    (schedule) => schedule.status === "active" && schedule.enabled,
  );
  const activeSlots = activeSchedules.flatMap((schedule) => schedule.slotTimes).sort();
  const requiredSlots = ["05:00", "07:00", "11:00", "15:00", "17:00"];
  if (
    activeSchedules.length !== 1 ||
    activeSlots.length !== requiredSlots.length ||
    activeSlots.some((slot, index) => slot !== requiredSlots[index])
  ) {
    errors.push(
      `schedules: active opportunity contract must be exactly ${requiredSlots.join(",")}`,
    );
  }
  const primaryCampaignType = activeSchedules[0]?.primaryCampaignType;
  if (
    !primaryCampaignType ||
    !bundle.campaigns.some(
      (campaign) =>
        campaign.status === "active" &&
        campaign.type === primaryCampaignType,
    )
  ) {
    errors.push("campaigns: an active self-identification campaign is required as the primary campaign model");
  }
  if (errors.length > 0) {
    throw new Error(`Publishing registry failed closed:\n${errors.join("\n")}`);
  }
  return bundle;
}

export async function loadRegistryBundle(path: string): Promise<PublishingRegistryBundle> {
  return validateRegistryBundle(JSON.parse(await readFile(path, "utf8")));
}

export function registryBundleHash(bundle: PublishingRegistryBundle): string {
  return sha256(bundle);
}
