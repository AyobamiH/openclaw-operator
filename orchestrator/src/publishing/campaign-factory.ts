import { resolve } from "node:path";
import { DeterministicPublishingEngine } from "./engine.js";
import type { CampaignMediaArtifact, CampaignMediaDelivery } from "./media-artifact.js";
import { loadRegistryBundle } from "./registry.js";
import {
  loadProductionIntegration,
  opportunityFor,
  resolveProductionOpportunity,
} from "./production-integration.js";
import { prepareProductionPublishingShadowDecision } from "./shadow-equivalence.js";
import { PublishingStore } from "./store.js";
import type { ContentSpec, PublishingRegistryBundle } from "./types.js";

export type CampaignFactoryOpportunity = {
  opportunityId: string;
  platformId: string;
  localTime: string;
  contentSpecId: string | null;
  payloadHash: string | null;
  format: string | null;
  contentReady: boolean;
  mediaArtifactReady: boolean;
  mediaArtifactHash: string | null;
  durableDeliveryReady: boolean;
  shadowReady: boolean;
  providerWrites: 0;
  blockers: string[];
};

export type CampaignFactoryAudit = {
  schemaVersion: "1.0.0";
  factoryId: "campaigns-content-factory";
  generatedAt: string;
  localDate: string;
  timezone: "Europe/London";
  configuredMode: "shadow" | "canary" | "live";
  verdict: "ready" | "partial" | "blocked";
  activation: {
    shadowCapable: boolean;
    liveActivationReady: boolean;
    providerWrites: 0;
    approvalBoundary: string;
  };
  totals: {
    opportunities: number;
    shadowReady: number;
    mediaBlocked: number;
    deliveryBlocked: number;
  };
  opportunities: CampaignFactoryOpportunity[];
};

function londonOffsetFor(localDate: string): string {
  const reference = new Date(`${localDate}T12:00:00Z`);
  if (Number.isNaN(reference.getTime())) throw new Error("campaign_factory_local_date_invalid");
  const zone = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    timeZoneName: "longOffset",
  }).formatToParts(reference).find((part) => part.type === "timeZoneName")?.value;
  if (!zone || zone === "GMT") return "Z";
  const match = zone.match(/^GMT([+-]\d{2}:\d{2})$/);
  if (!match) throw new Error(`campaign_factory_timezone_offset_unresolved:${zone}`);
  return match[1]!;
}

export async function auditCampaignContentFactory(input: {
  registryPath: string;
  integrationPath: string;
  localDate: string;
  mediaArtifacts?: CampaignMediaArtifact[];
  mediaDeliveries?: CampaignMediaDelivery[];
  opportunityIds?: string[];
}): Promise<CampaignFactoryAudit> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.localDate)) {
    throw new Error("campaign_factory_local_date_invalid");
  }
  const registryPath = resolve(input.registryPath);
  const integrationPath = resolve(input.integrationPath);
  const registry = await loadRegistryBundle(registryPath);
  const integration = await loadProductionIntegration(integrationPath, registry);
  const offset = londonOffsetFor(input.localDate);
  const opportunities: CampaignFactoryOpportunity[] = [];
  const artifacts = new Map((input.mediaArtifacts ?? []).map((artifact) => [artifact.contentSpecId, artifact]));
  const deliveries = new Map((input.mediaDeliveries ?? []).map((delivery) => [delivery.contentSpecId, delivery]));

  const opportunityIds = input.opportunityIds ? new Set(input.opportunityIds) : null;
  for (const opportunity of integration.opportunities.filter(
    (candidate) => candidate.enabled && (!opportunityIds || opportunityIds.has(candidate.id)),
  )) {
    const observedAt = `${input.localDate}T${opportunity.localTime}:00${offset}`;
    const decision = await prepareProductionPublishingShadowDecision({
      integrationPath,
      registryPath,
      opportunityId: opportunity.id,
      observedAt,
    });
    const format = typeof decision.payload?.format === "string" ? decision.payload.format : null;
    const mediaUrl = typeof decision.payload?.mediaUrl === "string" && decision.payload.mediaUrl.length > 0
      ? decision.payload.mediaUrl
      : null;
    const contentReady = decision.graphSafeState === "completed" && Boolean(decision.payloadHash);
    const contentSpecId = typeof decision.decision.contentSpecId === "string" ? decision.decision.contentSpecId : null;
    const artifact = contentSpecId ? artifacts.get(contentSpecId) : undefined;
    const delivery = contentSpecId ? deliveries.get(contentSpecId) : undefined;
    const artifactBound = Boolean(
      artifact &&
      artifact.contentSpecId === contentSpecId &&
      artifact.platformId === opportunity.platformId &&
      artifact.format === format &&
      artifact.externalWrites === 0,
    );
    const deliveryBound = Boolean(
      delivery &&
      artifact &&
      delivery.artifactId === artifact.id &&
      delivery.artifactHash === artifact.artifactHash &&
      delivery.mediaSha256 === artifact.sha256,
    );
    const mediaArtifactReady = format === "text" || artifactBound || Boolean(mediaUrl);
    const durableDeliveryReady = format === "text" || deliveryBound || Boolean(mediaUrl);
    const blockers = [
      ...(contentReady ? [] : [decision.blockReason ?? "content_not_ready"]),
      ...(contentReady && !mediaArtifactReady ? [`immutable_media_artifact_missing:${format ?? "unknown"}`] : []),
      ...(contentReady && mediaArtifactReady && !durableDeliveryReady
        ? [`durable_public_media_delivery_missing:${format ?? "unknown"}`]
        : []),
    ];
    opportunities.push({
      opportunityId: opportunity.id,
      platformId: opportunity.platformId,
      localTime: opportunity.localTime,
      contentSpecId,
      payloadHash: decision.payloadHash,
      format,
      contentReady,
      mediaArtifactReady,
      mediaArtifactHash: artifact?.artifactHash ?? null,
      durableDeliveryReady,
      shadowReady: contentReady && mediaArtifactReady,
      providerWrites: 0,
      blockers,
    });
  }

  const shadowReady = opportunities.filter((opportunity) => opportunity.shadowReady).length;
  const mediaBlocked = opportunities.filter((opportunity) =>
    opportunity.blockers.some((blocker) => blocker.startsWith("immutable_media_artifact_missing:")),
  ).length;
  const deliveryBlocked = opportunities.filter((opportunity) =>
    opportunity.blockers.some((blocker) => blocker.startsWith("durable_public_media_delivery_missing:")),
  ).length;
  const verdict = shadowReady === opportunities.length
    ? "ready"
    : shadowReady > 0
      ? "partial"
      : "blocked";
  return {
    schemaVersion: "1.0.0",
    factoryId: "campaigns-content-factory",
    generatedAt: new Date().toISOString(),
    localDate: input.localDate,
    timezone: integration.timezone,
    configuredMode: integration.mode,
    verdict,
    activation: {
      shadowCapable: shadowReady > 0,
      liveActivationReady:
        verdict === "ready" &&
        deliveryBlocked === 0 &&
        integration.mode !== "shadow",
      providerWrites: 0,
      approvalBoundary: "Any canary or live provider write requires an exact dated payload-bound approval and a separately issued one-run capability.",
    },
    totals: {
      opportunities: opportunities.length,
      shadowReady,
      mediaBlocked,
      deliveryBlocked,
    },
    opportunities,
  };
}

export type CampaignFactoryPlannedContent = {
  opportunityId: string;
  scheduledFor: string;
  contentSpec: ContentSpec;
};

export function planCampaignFactoryContentForDate(input: {
  registry: PublishingRegistryBundle;
  integration: Awaited<ReturnType<typeof loadProductionIntegration>>;
  localDate: string;
  opportunityIds?: string[];
}): CampaignFactoryPlannedContent[] {
  const offset = londonOffsetFor(input.localDate);
  const opportunityIds = input.opportunityIds ? new Set(input.opportunityIds) : null;
  return input.integration.opportunities
    .filter((candidate) => candidate.enabled && (!opportunityIds || opportunityIds.has(candidate.id)))
    .map((configuredOpportunity) => {
      const observedAt = new Date(`${input.localDate}T${configuredOpportunity.localTime}:00${offset}`);
      const resolution = resolveProductionOpportunity(input.integration, configuredOpportunity.id, observedAt);
      const opportunity = opportunityFor(input.integration, configuredOpportunity.id, resolution.scheduledFor);
      const store = new PublishingStore(":memory:");
      try {
        const engine = new DeterministicPublishingEngine(input.registry, store);
        engine.initialize();
        const plan = engine.planSlot({
          platformId: opportunity.platformId,
          accountId: opportunity.accountId,
          scheduledFor: resolution.scheduledFor,
          now: resolution.scheduledFor,
        });
        if (plan.result !== "reserved" || !plan.contentSpec) {
          throw new Error(`campaign_factory_content_not_reserved:${opportunity.id}:${plan.result}`);
        }
        return {
          opportunityId: opportunity.id,
          scheduledFor: resolution.scheduledFor.toISOString(),
          contentSpec: plan.contentSpec,
        };
      } finally {
        store.close();
      }
    });
}
