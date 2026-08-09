import { stableFraction, sha256 } from "./canonical.js";
import type {
  CampaignRecord,
  PublishingCandidate,
  PublishingRegistryBundle,
  ScoreComponents,
  PlatformId,
} from "./types.js";

export interface SelectionHistory {
  productPublicationCountToday(productId: string): number;
  campaignPublicationCountToday(campaignId: string): number;
  campaignTypePublicationCountToday(campaignType: CampaignRecord["type"]): number;
  platformPublicationCountToday(platformId: PlatformId, accountId: string): number;
  hoursSinceProductPublication(productId: string): number | null;
  hoursSinceCampaignPublication(campaignId: string): number | null;
  recentProductShare(productId: string): number;
  exactContentHashes: Set<string>;
}

export interface SelectionInput {
  registry: PublishingRegistryBundle;
  platformId: PlatformId;
  accountId: string;
  slotKey: string;
  now: Date;
  history: SelectionHistory;
}

export function mergeSelectionHistories(
  histories: SelectionHistory[],
): SelectionHistory {
  const minimumKnown = (values: Array<number | null>): number | null => {
    const known = values.filter((value): value is number => value !== null);
    return known.length === 0 ? null : Math.min(...known);
  };
  return {
    productPublicationCountToday: (productId) => histories.reduce(
      (total, value) => total + value.productPublicationCountToday(productId),
      0,
    ),
    campaignPublicationCountToday: (campaignId) => histories.reduce(
      (total, value) => total + value.campaignPublicationCountToday(campaignId),
      0,
    ),
    campaignTypePublicationCountToday: (campaignType) => histories.reduce(
      (total, value) => total + value.campaignTypePublicationCountToday(campaignType),
      0,
    ),
    platformPublicationCountToday: (platformId, accountId) => histories.reduce(
      (total, value) => total + value.platformPublicationCountToday(platformId, accountId),
      0,
    ),
    hoursSinceProductPublication: (productId) => minimumKnown(
      histories.map((value) => value.hoursSinceProductPublication(productId)),
    ),
    hoursSinceCampaignPublication: (campaignId) => minimumKnown(
      histories.map((value) => value.hoursSinceCampaignPublication(campaignId)),
    ),
    recentProductShare: (productId) => Math.max(
      0,
      ...histories.map((value) => value.recentProductShare(productId)),
    ),
    exactContentHashes: new Set(histories.flatMap(
      (value) => Array.from(value.exactContentHashes),
    )),
  };
}

function activeAt(campaign: CampaignRecord, now: Date): boolean {
  if (campaign.startAt && Date.parse(campaign.startAt) > now.getTime()) return false;
  if (campaign.endAt && Date.parse(campaign.endAt) <= now.getTime()) return false;
  return true;
}

function evidenceQuality(registry: PublishingRegistryBundle, ids: string[], now: Date): number {
  if (ids.length === 0) return 0;
  const valid = ids.filter((id) => {
    const evidence = registry.evidence.find((item) => item.id === id);
    return evidence && (!evidence.expiresAt || Date.parse(evidence.expiresAt) > now.getTime());
  }).length;
  return valid / ids.length;
}

function experimentAdjustment(
  registry: PublishingRegistryBundle,
  campaignId: string,
  now: Date,
): number {
  return registry.experiments
    .filter((experiment) =>
      experiment.status === "active" &&
      experiment.approved &&
      experiment.campaignIds.includes(campaignId) &&
      Date.parse(experiment.startsAt) <= now.getTime() &&
      Date.parse(experiment.endsAt) > now.getTime())
    .reduce((total, experiment) => total + experiment.adjustment, 0);
}

function score(
  components: ScoreComponents,
): number {
  const positive =
    components.productPriority * 0.16 +
    components.campaignPriority * 0.20 +
    components.identitySignalStrength * 0.12 +
    components.evidenceQuality * 0.18 +
    components.recency * 0.08 +
    components.platformFit * 0.10 +
    components.distributionNeed * 0.16 +
    components.performanceAdjustment;
  return Number(Math.max(0, Math.min(1, positive - components.cooldownPenalty - components.saturationPenalty)).toFixed(6));
}

export function buildEligibleCandidates(input: SelectionInput): PublishingCandidate[] {
  const { registry, platformId, accountId, slotKey, now, history } = input;
  const policy = registry.platformPolicies.find((item) =>
    item.status === "active" &&
    item.platformId === platformId &&
    item.accountId === accountId);
  if (!policy) return [];
  if (history.platformPublicationCountToday(platformId, accountId) >= policy.maxDailyPublications) return [];

  const candidates: PublishingCandidate[] = [];
  for (const campaign of registry.campaigns) {
    if (campaign.status !== "active" || !campaign.platformIds.includes(platformId) || !activeAt(campaign, now)) continue;
    const product = registry.products.find((item) => item.id === campaign.productId);
    if (!product || product.status !== "active" || product.state !== "active") continue;
    if (!product.allowedCampaignTypes.includes(campaign.type)) continue;
    const strategy = registry.contentStrategies.find((item) => item.id === campaign.strategyId);
    if (
      !strategy ||
      strategy.status !== "active" ||
      !strategy.allowedCampaignTypes.includes(campaign.type)
    ) continue;
    if (history.productPublicationCountToday(product.id) >= product.dailyPublicationCap) continue;
    if (history.campaignPublicationCountToday(campaign.id) >= campaign.dailyCap) continue;
    const productCooldown = history.hoursSinceProductPublication(product.id);
    const campaignCooldown = history.hoursSinceCampaignPublication(campaign.id);
    if (productCooldown !== null && productCooldown < product.minimumCooldownHours) continue;
    if (campaignCooldown !== null && campaignCooldown < campaign.minimumCooldownHours) continue;

    const claimEvidence = campaign.claimIds.flatMap((claimId) =>
      registry.claims.find((claim) => claim.id === claimId)?.evidenceIds ?? []);
    const evidenceIds = Array.from(new Set([...campaign.evidenceIds, ...claimEvidence]));
    if (evidenceQuality(registry, evidenceIds, now) < 1) continue;

    for (const templateId of campaign.templateIds) {
      const template = registry.templates.find((item) => item.id === templateId);
      if (!template || template.status !== "active" || !template.platformIds.includes(platformId)) continue;
      if (!template.campaignTypes.includes(campaign.type)) continue;
      if (!policy.allowedFormats.includes(template.format)) continue;

      const adjustment = Math.max(-0.15, Math.min(0.15, experimentAdjustment(registry, campaign.id, now)));
      const components: ScoreComponents = {
        productPriority: 0.75,
        campaignPriority: campaign.priority,
        identitySignalStrength: Math.min(1, campaign.identitySignalIds.length / 3),
        evidenceQuality: evidenceQuality(registry, evidenceIds, now),
        recency: campaignCooldown === null ? 1 : Math.min(1, campaignCooldown / 168),
        platformFit: 1,
        distributionNeed: Math.max(0, 1 - history.recentProductShare(product.id)),
        performanceAdjustment: adjustment,
        cooldownPenalty: 0,
        saturationPenalty: Math.min(0.25, history.recentProductShare(product.id) * 0.25),
      };
      const id = `candidate:${platformId}:${accountId}:${slotKey}:${campaign.id}:${template.id}`;
      const tieBreak = sha256(`${registry.registryVersion}|${slotKey}|${id}`);
      candidates.push({
        id,
        productId: product.id,
        campaignId: campaign.id,
        campaignType: campaign.type,
        audienceId: campaign.audienceId,
        platformId,
        accountId,
        templateId: template.id,
        ctaId: campaign.ctaId,
        claimIds: campaign.claimIds,
        evidenceIds,
        identitySignalIds: campaign.identitySignalIds,
        problemOutcomeIds: campaign.problemOutcomeIds,
        score: score(components),
        scoreComponents: components,
        tieBreak,
        eligibilityReasons: [
          "product-active",
          "campaign-active",
          "references-valid",
          "evidence-current",
          "cooldown-satisfied",
          "quota-available",
          "platform-format-supported",
        ],
      });
    }
  }
  return candidates.sort((left, right) =>
    right.score - left.score || left.tieBreak.localeCompare(right.tieBreak));
}

export function selectCandidate(input: SelectionInput): PublishingCandidate | null {
  return buildEligibleCandidates(input)[0] ?? null;
}

export function deterministicSelectionSeed(registryVersion: string, slotKey: string): string {
  return sha256(`${registryVersion}|${slotKey}`);
}

export function deterministicSample<T extends { id: string }>(
  values: T[],
  seed: string,
): T | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left.id.localeCompare(right.id));
  return ordered[Math.floor(stableFraction(seed) * ordered.length)] ?? ordered[0];
}
