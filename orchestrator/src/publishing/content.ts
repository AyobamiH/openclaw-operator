import { interpolate, sha256, stableId } from "./canonical.js";
import { deterministicSelectionSeed } from "./selection.js";
import type {
  ContentSpec,
  PublishingCandidate,
  PublishingRegistryBundle,
  ValidationFinding,
  ValidationResult,
} from "./types.js";

function firstOrFail<T extends { id: string }>(records: T[], id: string, label: string): T {
  const value = records.find((item) => item.id === id);
  if (!value) throw new Error(`Missing ${label}: ${id}`);
  return value;
}

function templateVariables(
  registry: PublishingRegistryBundle,
  candidate: PublishingCandidate,
): Record<string, string> {
  const product = firstOrFail(registry.products, candidate.productId, "product");
  const audience = firstOrFail(registry.audiences, candidate.audienceId, "audience");
  const problem = firstOrFail(registry.problemsOutcomes, candidate.problemOutcomeIds[0], "problem/outcome");
  const identitySignal = firstOrFail(registry.identitySignals, candidate.identitySignalIds[0], "identity signal");
  const cta = firstOrFail(registry.ctas, candidate.ctaId, "CTA");
  const evidence = firstOrFail(registry.evidence, candidate.evidenceIds[0], "evidence");
  return {
    product_name: product.name,
    audience_name: audience.name,
    problem: problem.problem,
    outcome: problem.outcome,
    identity_signal: identitySignal.signal,
    evidence_summary: evidence.summary,
    cta_text: cta.text,
  };
}

export function buildContentSpec(
  registry: PublishingRegistryBundle,
  candidate: PublishingCandidate,
  slotKey: string,
  now: Date,
): ContentSpec {
  const campaign = firstOrFail(registry.campaigns, candidate.campaignId, "campaign");
  const product = firstOrFail(registry.products, candidate.productId, "product");
  const template = firstOrFail(registry.templates, candidate.templateId, "template");
  const cta = firstOrFail(registry.ctas, candidate.ctaId, "CTA");
  const variables = templateVariables(registry, candidate);
  for (const variable of template.requiredVariables) {
    if (!variables[variable]) throw new Error(`Template ${template.id} requires missing variable ${variable}`);
  }
  const renderedIntent = {
    hook: interpolate(template.fields.hook, variables),
    body: interpolate(template.fields.body, variables),
    cta: interpolate(template.fields.cta || cta.text, variables),
    ...(template.fields.altText
      ? { altText: interpolate(template.fields.altText, variables) }
      : {}),
  };
  const unhashed = {
    schemaVersion: "1.0.0" as const,
    createdAt: now.toISOString(),
    immutable: true as const,
    productId: candidate.productId,
    campaignId: candidate.campaignId,
    audienceId: candidate.audienceId,
    platformId: candidate.platformId,
    accountId: candidate.accountId,
    slotKey,
    format: template.format,
    campaignType: campaign.type,
    strategyId: campaign.strategyId,
    identitySignalIds: candidate.identitySignalIds,
    problemOutcomeIds: candidate.problemOutcomeIds,
    claimIds: candidate.claimIds,
    evidenceIds: candidate.evidenceIds,
    assetIds: product.assetIds,
    ctaId: candidate.ctaId,
    templateId: candidate.templateId,
    languageRenderer: { mode: "template" as const },
    renderedIntent,
    selection: {
      seed: deterministicSelectionSeed(registry.registryVersion, slotKey),
      score: candidate.score,
      components: candidate.scoreComponents,
      tieBreak: candidate.tieBreak,
      registryVersion: registry.registryVersion,
    },
  };
  const contentHash = sha256(unhashed);
  return {
    id: stableId("content", { slotKey, contentHash }),
    contentHash,
    ...unhashed,
  };
}

function finding(
  layer: ValidationFinding["layer"],
  status: ValidationFinding["status"],
  code: string,
  message: string,
  evidence: string[] = [],
): ValidationFinding {
  return { layer, status, code, message, evidence };
}

function incomplete(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  if (/[,:;\-–—/]$/.test(normalized)) return true;
  if (/\b(?:a|an|and|are|as|at|because|but|by|for|from|has|have|if|in|is|of|on|or|the|to|was|with)$/i.test(normalized)) return true;
  return false;
}

export function validateContentSpec(
  registry: PublishingRegistryBundle,
  spec: ContentSpec,
  history: { exactContentHashes: Set<string> },
  now: Date,
): ValidationResult {
  const findings: ValidationFinding[] = [];
  const product = registry.products.find((item) => item.id === spec.productId);
  const campaign = registry.campaigns.find((item) => item.id === spec.campaignId);
  const strategy = registry.contentStrategies.find((item) => item.id === spec.strategyId);
  const audience = registry.audiences.find((item) => item.id === spec.audienceId);
  const template = registry.templates.find((item) => item.id === spec.templateId);
  const policy = registry.platformPolicies.find((item) =>
    item.platformId === spec.platformId && item.accountId === spec.accountId && item.status === "active");

  findings.push(finding("schema", spec.contentHash === sha256({
    schemaVersion: spec.schemaVersion,
    createdAt: spec.createdAt,
    immutable: spec.immutable,
    productId: spec.productId,
    campaignId: spec.campaignId,
    audienceId: spec.audienceId,
    platformId: spec.platformId,
    accountId: spec.accountId,
    slotKey: spec.slotKey,
    format: spec.format,
    campaignType: spec.campaignType,
    strategyId: spec.strategyId,
    identitySignalIds: spec.identitySignalIds,
    problemOutcomeIds: spec.problemOutcomeIds,
    claimIds: spec.claimIds,
    evidenceIds: spec.evidenceIds,
    assetIds: spec.assetIds,
    ctaId: spec.ctaId,
    templateId: spec.templateId,
    languageRenderer: spec.languageRenderer,
    renderedIntent: spec.renderedIntent,
    selection: spec.selection,
  }) ? "passed" : "failed", "content-hash", "Immutable content hash must match the complete structured specification."));
  findings.push(finding("references", product && campaign && audience && template && policy ? "passed" : "failed", "registry-references", "All content references must exist and the platform policy must be active."));
  findings.push(finding(
    "references",
    campaign &&
      strategy &&
      strategy.status === "active" &&
      campaign.strategyId === spec.strategyId &&
      strategy.allowedCampaignTypes.includes(spec.campaignType)
      ? "passed"
      : "failed",
    "campaign-strategy",
    "The immutable strategy must match the campaign and allow its campaign type.",
    [spec.strategyId],
  ));
  findings.push(finding("lifecycle", product?.state === "active" && campaign?.status === "active" ? "passed" : "failed", "active-lifecycle", "Product and campaign must both be active."));
  const approvalIds = [product?.approvalId, campaign?.approvalId, ...spec.claimIds.map((id) => registry.claims.find((item) => item.id === id)?.approvalId)].filter(Boolean) as string[];
  const approvalsValid = approvalIds.every((id) => {
    const approval = registry.approvals.find((item) => item.id === id);
    return approval?.decision === "approved" && (!approval.expiresAt || Date.parse(approval.expiresAt) > now.getTime());
  });
  findings.push(finding("approval", approvalsValid ? "passed" : "failed", "approval-scope", "All approval references must resolve to current approved decisions.", approvalIds));
  const combined = `${spec.renderedIntent.hook}\n\n${spec.renderedIntent.body}\n\n${spec.renderedIntent.cta}`;
  const platformValid = Boolean(policy) &&
    policy!.allowedFormats.includes(spec.format) &&
    combined.length <= policy!.maxCaptionLength &&
    !incomplete(spec.renderedIntent.hook) &&
    !incomplete(spec.renderedIntent.body) &&
    !incomplete(spec.renderedIntent.cta);
  findings.push(finding("platform", platformValid ? "passed" : "failed", "copy-contract", "Copy must be complete and within the platform contract.", [`characters:${combined.length}`]));
  const claimValid = spec.claimIds.every((id) => {
    const claim = registry.claims.find((item) => item.id === id);
    return claim &&
      claim.productId === spec.productId &&
      claim.evidenceIds.length > 0 &&
      claim.evidenceIds.every((evidenceId) => spec.evidenceIds.includes(evidenceId)) &&
      (!claim.expiresAt || Date.parse(claim.expiresAt) > now.getTime());
  });
  findings.push(finding("claims", claimValid ? "passed" : "failed", "claim-evidence", "Every claim must be approved, current, product-bound, and backed by attached evidence."));
  const salesy = /\b(?:guaranteed|best in class|revolutionary|buy now|limited time|risk[- ]free)\b/i.test(combined);
  findings.push(finding("sales-language", salesy ? "failed" : "passed", "prohibited-sales-language", "Prohibited or unverifiable sales language must not appear."));
  const linksValid = !/(?:https?:\/\/)[^\s]+/i.test(combined) || registry.ctas.some((cta) => cta.id === spec.ctaId && cta.url && combined.includes(cta.url));
  findings.push(finding("links-assets", linksValid ? "passed" : "failed", "approved-links-assets", "Links and assets must resolve through approved registries."));
  findings.push(finding("duplicate", history.exactContentHashes.has(spec.contentHash) ? "failed" : "passed", "exact-duplicate", "An immutable content hash may not be republished."));
  findings.push(finding("cooldown", "passed", "planner-cooldown", "Cooldown eligibility was enforced before content generation."));
  findings.push(finding("quota-distribution", "passed", "planner-quota", "Quota and distribution constraints were enforced before content generation."));
  findings.push(finding("readiness", policy?.requiresOfficialApi && policy.requiresProviderReadback ? "passed" : "failed", "official-api-readback", "The active platform contract must require official API publication and provider readback."));
  return {
    passed: findings.every((item) => item.status === "passed"),
    contentHash: spec.contentHash,
    findings,
  };
}
