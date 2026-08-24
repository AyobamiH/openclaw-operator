import { access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  auditCampaignContentFactory,
  planCampaignFactoryContentForDate,
} from "./campaign-factory.js";
import {
  artifactFromLocalRendererReceipt,
  loadCampaignMediaArtifact,
  renderCampaignMediaLocally,
  type CampaignMediaArtifact,
  type CampaignMediaDelivery,
} from "./media-artifact.js";
import { decideProductionOpportunity, loadProductionIntegration } from "./production-integration.js";
import { runProductionOpportunity } from "./production-runner.js";
import type { ProductionToolInvoker } from "./official-worker.js";
import { loadRegistryBundle } from "./registry.js";
import type { ContentSpec } from "./types.js";

export type CampaignFactoryMediaResult = {
  opportunityId: string;
  contentSpecId: string;
  format: string;
  outcome: "not_required" | "rendered_verified" | "reused_verified";
  artifactId: string | null;
  artifactHash: string | null;
  mediaSha256: string | null;
  externalWrites: 0;
};

function londonDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

async function existingArtifact(input: {
  outputDir: string;
  artifactRoot: string;
  contentSpec: ContentSpec;
}): Promise<CampaignMediaArtifact | null> {
  let entries;
  try {
    entries = await readdir(input.outputDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const manifests = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith("-campaign-media-artifact.json"))
    .map((entry) => join(input.outputDir, entry.name))
    .sort();
  if (manifests.length === 0) {
    if (entries.length > 0) throw new Error(`campaign_media_output_incomplete:${input.contentSpec.id}`);
    return null;
  }
  if (manifests.length !== 1) {
    throw new Error(`campaign_media_artifact_ambiguous:${input.contentSpec.id}`);
  }
  const manifest = await loadCampaignMediaArtifact(manifests[0]!);
  if (
    manifest.contentSpecId !== input.contentSpec.id ||
    manifest.contentHash !== input.contentSpec.contentHash
  ) {
    throw new Error(`campaign_media_artifact_content_mismatch:${input.contentSpec.id}`);
  }
  const verified = await artifactFromLocalRendererReceipt({
    contentSpec: input.contentSpec,
    receiptPath: manifest.receiptPath,
    artifactRoot: input.artifactRoot,
  });
  if (
    verified.id !== manifest.id ||
    verified.artifactHash !== manifest.artifactHash ||
    verified.sha256 !== manifest.sha256
  ) {
    throw new Error(`campaign_media_artifact_reverification_mismatch:${input.contentSpec.id}`);
  }
  return manifest;
}

async function existingPath(path: string | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    await access(path);
    return path;
  } catch {
    return undefined;
  }
}

export async function ensureCampaignMediaForDate(input: {
  registryPath: string;
  integrationPath: string;
  localDate: string;
  artifactRoot: string;
  rendererEntrypoint: string;
  nodeExecutable?: string;
  opportunityIds?: string[];
  databasePath?: string;
}): Promise<{
  results: CampaignFactoryMediaResult[];
  artifacts: CampaignMediaArtifact[];
  planned: ReturnType<typeof planCampaignFactoryContentForDate>;
}> {
  const registryPath = resolve(input.registryPath);
  const integrationPath = resolve(input.integrationPath);
  const artifactRoot = resolve(input.artifactRoot);
  const rendererEntrypoint = resolve(input.rendererEntrypoint);
  const nodeExecutable = resolve(input.nodeExecutable ?? process.execPath);
  const registry = await loadRegistryBundle(registryPath);
  const integration = await loadProductionIntegration(integrationPath, registry);
  const planned = planCampaignFactoryContentForDate({
    registry,
    integration,
    localDate: input.localDate,
    opportunityIds: input.opportunityIds,
    historyDatabasePath: await existingPath(input.databasePath),
  });
  const results: CampaignFactoryMediaResult[] = [];
  const artifacts: CampaignMediaArtifact[] = [];
  for (const item of planned) {
    if (item.contentSpec.format === "text") {
      results.push({
        opportunityId: item.opportunityId,
        contentSpecId: item.contentSpec.id,
        format: "text",
        outcome: "not_required",
        artifactId: null,
        artifactHash: null,
        mediaSha256: null,
        externalWrites: 0,
      });
      continue;
    }
    const outputDir = join(
      artifactRoot,
      input.localDate,
      "campaign-content-factory",
      item.opportunityId,
    );
    const reusable = await existingArtifact({
      outputDir,
      artifactRoot,
      contentSpec: item.contentSpec,
    });
    const artifact = reusable ?? await renderCampaignMediaLocally({
      registry,
      contentSpec: item.contentSpec,
      artifactRoot,
      outputDir,
      nodeExecutable,
      rendererEntrypoint,
    });
    if (!artifact) throw new Error(`campaign_media_artifact_missing:${item.opportunityId}`);
    artifacts.push(artifact);
    results.push({
      opportunityId: item.opportunityId,
      contentSpecId: item.contentSpec.id,
      format: item.contentSpec.format,
      outcome: reusable ? "reused_verified" : "rendered_verified",
      artifactId: artifact.id,
      artifactHash: artifact.artifactHash,
      mediaSha256: artifact.sha256,
      externalWrites: 0,
    });
  }
  return { results, artifacts, planned };
}

export async function runCampaignFactoryScheduledCycle(input: {
  registryPath: string;
  integrationPath: string;
  databasePath: string;
  artifactRoot: string;
  rendererEntrypoint: string;
  observedAt?: Date;
  opportunityId?: string;
  nodeExecutable?: string;
  openclawBin?: string;
  workspace?: string;
  allowProviderWrite?: boolean;
  mediaDelivery?: CampaignMediaDelivery | null;
  toolInvoker?: ProductionToolInvoker;
}): Promise<Record<string, unknown>> {
  const observedAt = input.observedAt ?? new Date();
  const registry = await loadRegistryBundle(resolve(input.registryPath));
  const integration = await loadProductionIntegration(resolve(input.integrationPath), registry);
  if (integration.mode === "shadow") {
    return runCampaignFactoryShadowCycle(input);
  }

  const localDate = londonDate(observedAt);
  const uniqueness = decideProductionOpportunity(integration, input.opportunityId ?? "auto", observedAt);
  if (uniqueness.outcome === "completed_no_eligible_opportunity") {
    const opportunity = await runProductionOpportunity({
      registryPath: input.registryPath,
      integrationPath: input.integrationPath,
      databasePath: input.databasePath,
      opportunityId: input.opportunityId ?? "auto",
      scheduledFor: observedAt,
      mode: integration.mode,
      allowProviderWrite: false,
      openclawBin: input.openclawBin,
      workspace: input.workspace,
      toolInvoker: input.toolInvoker,
    });
    return {
      schemaVersion: "1.2.0",
      factoryId: "campaigns-content-factory",
      mode: integration.mode,
      localDate,
      uniquenessDecision: uniqueness,
      media: [],
      audit: null,
      opportunity,
      terminalOutcome: "completed_no_eligible_opportunity",
      providerDispatchSuppressed: true,
      externalWrites: 0,
    };
  }

  const opportunityIds = [uniqueness.opportunity.id];
  const media = await ensureCampaignMediaForDate({
    registryPath: input.registryPath,
    integrationPath: input.integrationPath,
    localDate,
    artifactRoot: input.artifactRoot,
    rendererEntrypoint: input.rendererEntrypoint,
    nodeExecutable: input.nodeExecutable,
    opportunityIds,
    databasePath: input.databasePath,
  });
  const deliveries = input.mediaDelivery ? [input.mediaDelivery] : [];
  const audit = await auditCampaignContentFactory({
    registryPath: input.registryPath,
    integrationPath: input.integrationPath,
    localDate,
    mediaArtifacts: media.artifacts,
    mediaDeliveries: deliveries,
    opportunityIds,
    plannedContent: media.planned,
  });
  const readyOpportunity = audit.opportunities[0];
  if (!readyOpportunity || readyOpportunity.contentReady !== true || readyOpportunity.mediaArtifactReady !== true) {
    throw new Error(`campaign_factory_promotion_candidate_not_ready:${audit.verdict}`);
  }
  if (integration.mode === "canary" && uniqueness.opportunity.canaryEligible !== true) {
    throw new Error(`campaign_factory_canary_opportunity_not_allowed:${uniqueness.opportunity.id}`);
  }
  if (input.allowProviderWrite !== true) {
    return {
      schemaVersion: "1.2.0",
      factoryId: "campaigns-content-factory",
      mode: integration.mode,
      localDate,
      uniquenessDecision: uniqueness,
      media: media.results,
      audit,
      opportunity: {
        opportunityId: uniqueness.opportunity.id,
        platformId: uniqueness.opportunity.platformId,
        scheduledFor: uniqueness.scheduledFor.toISOString(),
        contentSpecId: readyOpportunity.contentSpecId,
        payloadHash: readyOpportunity.payloadHash,
      },
      terminalOutcome: "approval_required",
      providerDispatchSuppressed: true,
      approvalBoundary: "Campaign Factory canary/live provider writes require exact explicit approval; pass allowProviderWrite only for that approved run.",
      externalWrites: 0,
    };
  }
  if (readyOpportunity.durableDeliveryReady !== true) {
    throw new Error(`campaign_factory_promotion_delivery_not_ready:${readyOpportunity.format ?? "unknown"}`);
  }
  const preparedContent = media.planned.find(
    (item) => item.contentSpec.id === readyOpportunity.contentSpecId,
  )?.contentSpec;
  if (!preparedContent) {
    throw new Error(`campaign_factory_prepared_content_spec_missing:${readyOpportunity.contentSpecId ?? "unknown"}`);
  }

  const opportunity = await runProductionOpportunity({
    registryPath: input.registryPath,
    integrationPath: input.integrationPath,
    databasePath: input.databasePath,
    opportunityId: input.opportunityId ?? "auto",
    scheduledFor: observedAt,
    mode: integration.mode,
    allowProviderWrite: true,
    openclawBin: input.openclawBin,
    workspace: input.workspace,
    mediaDelivery: input.mediaDelivery,
    preparedContentSpec: preparedContent,
    toolInvoker: input.toolInvoker,
  });
  return {
    schemaVersion: "1.2.0",
    factoryId: "campaigns-content-factory",
    mode: integration.mode,
    localDate,
    uniquenessDecision: uniqueness,
    media: media.results,
    audit,
    opportunity,
    terminalOutcome: opportunity.result === "verified" ? "published_verified" : String(opportunity.result ?? "unknown"),
    externalWrites: opportunity.externalWrites,
  };
}

export async function runCampaignFactoryShadowCycle(input: {
  registryPath: string;
  integrationPath: string;
  databasePath: string;
  artifactRoot: string;
  rendererEntrypoint: string;
  observedAt?: Date;
  opportunityId?: string;
  nodeExecutable?: string;
  openclawBin?: string;
  workspace?: string;
  toolInvoker?: ProductionToolInvoker;
}): Promise<Record<string, unknown>> {
  const observedAt = input.observedAt ?? new Date();
  const localDate = londonDate(observedAt);
  const registry = await loadRegistryBundle(resolve(input.registryPath));
  const integration = await loadProductionIntegration(resolve(input.integrationPath), registry);
  const uniqueness = decideProductionOpportunity(integration, input.opportunityId ?? "auto", observedAt);
  if (uniqueness.outcome === "completed_no_eligible_opportunity") {
    const shadow = await runProductionOpportunity({
      registryPath: input.registryPath,
      integrationPath: input.integrationPath,
      databasePath: input.databasePath,
      opportunityId: input.opportunityId ?? "auto",
      scheduledFor: observedAt,
      mode: "shadow",
      allowProviderWrite: false,
      openclawBin: input.openclawBin,
      workspace: input.workspace,
      toolInvoker: input.toolInvoker,
    });
    return {
      schemaVersion: "1.1.0",
      factoryId: "campaigns-content-factory",
      mode: "shadow",
      localDate,
      uniquenessDecision: uniqueness,
      media: [],
      audit: null,
      opportunity: shadow,
      terminalOutcome: "completed_no_eligible_opportunity",
      externalWrites: 0,
    };
  }
  const opportunityIds = [uniqueness.opportunity.id];
  const media = await ensureCampaignMediaForDate({
    registryPath: input.registryPath,
    integrationPath: input.integrationPath,
    localDate,
    artifactRoot: input.artifactRoot,
    rendererEntrypoint: input.rendererEntrypoint,
    nodeExecutable: input.nodeExecutable,
    opportunityIds,
    databasePath: input.databasePath,
  });
  const audit = await auditCampaignContentFactory({
    registryPath: input.registryPath,
    integrationPath: input.integrationPath,
    localDate,
    mediaArtifacts: media.artifacts,
    opportunityIds,
    plannedContent: media.planned,
  });
  if (audit.verdict !== "ready" || audit.totals.shadowReady !== audit.totals.opportunities) {
    throw new Error(`campaign_factory_shadow_audit_not_ready:${audit.verdict}`);
  }
  const shadow = await runProductionOpportunity({
    registryPath: input.registryPath,
    integrationPath: input.integrationPath,
    databasePath: input.databasePath,
    opportunityId: input.opportunityId ?? "auto",
    scheduledFor: observedAt,
    mode: "shadow",
    allowProviderWrite: false,
    openclawBin: input.openclawBin,
    workspace: input.workspace,
    toolInvoker: input.toolInvoker,
  });
  if (shadow.externalWrites !== 0) {
    throw new Error("campaign_factory_shadow_cycle_external_write_detected");
  }
  return {
    schemaVersion: "1.1.0",
    factoryId: "campaigns-content-factory",
    mode: "shadow",
    localDate,
    uniquenessDecision: uniqueness,
    media: media.results,
    audit,
    opportunity: shadow,
    terminalOutcome: shadow.result === "skipped_no_eligible_candidate"
      ? "completed_no_eligible_opportunity"
      : shadow.result === "skipped_policy"
        ? "completed_policy_skip"
        : "completed_unique_opportunity",
    externalWrites: 0,
  };
}
