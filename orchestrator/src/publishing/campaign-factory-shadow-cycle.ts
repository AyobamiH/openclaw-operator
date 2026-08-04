import { readdir } from "node:fs/promises";
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

export async function ensureCampaignMediaForDate(input: {
  registryPath: string;
  integrationPath: string;
  localDate: string;
  artifactRoot: string;
  rendererEntrypoint: string;
  nodeExecutable?: string;
  opportunityIds?: string[];
}): Promise<{ results: CampaignFactoryMediaResult[]; artifacts: CampaignMediaArtifact[] }> {
  const registryPath = resolve(input.registryPath);
  const integrationPath = resolve(input.integrationPath);
  const artifactRoot = resolve(input.artifactRoot);
  const rendererEntrypoint = resolve(input.rendererEntrypoint);
  const nodeExecutable = resolve(input.nodeExecutable ?? process.execPath);
  const registry = await loadRegistryBundle(registryPath);
  const integration = await loadProductionIntegration(integrationPath, registry);
  if (integration.mode !== "shadow") {
    throw new Error("campaign_factory_shadow_cycle_requires_shadow_mode");
  }
  const planned = planCampaignFactoryContentForDate({
    registry,
    integration,
    localDate: input.localDate,
    opportunityIds: input.opportunityIds,
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
  return { results, artifacts };
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
  });
  const audit = await auditCampaignContentFactory({
    registryPath: input.registryPath,
    integrationPath: input.integrationPath,
    localDate,
    mediaArtifacts: media.artifacts,
    opportunityIds,
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
