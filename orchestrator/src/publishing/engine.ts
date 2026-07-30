import { randomUUID } from "node:crypto";
import { buildContentSpec, validateContentSpec } from "./content.js";
import { buildEligibleCandidates, type SelectionHistory } from "./selection.js";
import { sha256 } from "./canonical.js";
import { PROHIBITED_PLATFORM_IDS } from "./types.js";
import type {
  ConnectorReadback,
  ContentSpec,
  PlatformId,
  PublishingConnector,
  PublishingRegistryBundle,
  SlotPlan,
} from "./types.js";
import { PublishingStore } from "./store.js";

function datePartInLondon(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function timePartInLondon(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function slotKey(scheduledFor: Date): string {
  return `${datePartInLondon(scheduledFor)}:${timePartInLondon(scheduledFor)}`;
}

function activeSlot(registry: PublishingRegistryBundle, scheduledFor: Date): boolean {
  const time = timePartInLondon(scheduledFor);
  return registry.schedules.some((schedule) =>
    schedule.status === "active" &&
    schedule.enabled &&
    schedule.timezone === "Europe/London" &&
    schedule.slotTimes.includes(time));
}

function history(store: PublishingStore, now: Date): SelectionHistory {
  const date = datePartInLondon(now);
  return {
    productPublicationCountToday: (productId) => store.productVerifiedCountForDate(productId, date),
    campaignPublicationCountToday: (campaignId) => store.campaignVerifiedCountForDate(campaignId, date),
    campaignTypePublicationCountToday: (campaignType) =>
      store.campaignTypeVerifiedCountForDate(campaignType, date),
    platformPublicationCountToday: (platformId, accountId) => store.verifiedCountForDate(platformId, accountId, date),
    hoursSinceProductPublication: (productId) => store.hoursSinceVerified("product", productId, now),
    hoursSinceCampaignPublication: (campaignId) => store.hoursSinceVerified("campaign", campaignId, now),
    recentProductShare: (productId) => store.recentProductShare(productId),
    exactContentHashes: store.contentHashes(),
  };
}

export class DeterministicPublishingEngine {
  constructor(
    readonly registry: PublishingRegistryBundle,
    readonly store: PublishingStore,
  ) {}

  initialize(): void {
    this.store.seedRegistry(this.registry);
  }

  recordAttribution(input: {
    definitionId: string;
    fromType: string;
    fromId: string;
    toType: string;
    toId: string;
    confidence: "low" | "medium" | "high";
    evidence: unknown[];
    now?: Date;
  }): string {
    const definition = this.registry.attributionDefinitions.find(
      (candidate) => candidate.id === input.definitionId && candidate.status === "active",
    );
    if (!definition) throw new Error(`Unknown or inactive attribution definition: ${input.definitionId}`);
    if (input.fromType !== definition.fromType || input.toType !== definition.toType) {
      throw new Error(`Attribution type mismatch for ${definition.id}`);
    }
    if (!definition.allowedConfidence.includes(input.confidence)) {
      throw new Error(`Attribution confidence ${input.confidence} is not allowed`);
    }
    if (input.evidence.length < definition.minimumEvidenceCount) {
      throw new Error(
        `Attribution ${definition.id} requires at least ${definition.minimumEvidenceCount} evidence records`,
      );
    }
    return this.store.recordAttribution(input);
  }

  planSlot(input: {
    platformId?: PlatformId;
    accountId?: string;
    scheduledFor: Date;
    now?: Date;
  }): SlotPlan {
    const now = input.now ?? new Date();
    if (input.platformId && PROHIBITED_PLATFORM_IDS.has(input.platformId)) {
      throw new Error(`Platform is explicitly prohibited: ${input.platformId}`);
    }
    const key = slotKey(input.scheduledFor);
    const slotRunId = `slot_${sha256(key).slice(0, 24)}`;
    if (!activeSlot(this.registry, input.scheduledFor)) {
      this.store.startSlot(
        slotRunId,
        key,
        input.platformId ?? "none",
        input.accountId ?? "none",
        input.scheduledFor.toISOString(),
        now,
      );
      const reasons = ["not-an-active-Europe/London-planning-slot"];
      this.store.completeSlot(slotRunId, "skipped_policy", reasons, null, null, now);
      return { slotRunId, slotKey: key, result: "skipped_policy", candidate: null, contentSpec: null, validation: null, reasons, reservation: null };
    }
    const selectionHistory = history(this.store, now);
    const policies = this.registry.platformPolicies.filter((policy) =>
      policy.status === "active" &&
      !PROHIBITED_PLATFORM_IDS.has(policy.platformId) &&
      (!input.platformId || policy.platformId === input.platformId) &&
      (!input.accountId || policy.accountId === input.accountId));
    const candidates = policies.flatMap((policy) => buildEligibleCandidates({
      registry: this.registry,
      platformId: policy.platformId,
      accountId: policy.accountId,
      slotKey: key,
      now,
      history: selectionHistory,
    }));
    const primaryCampaignType = this.registry.schedules.find(
      (schedule) => schedule.status === "active" && schedule.enabled,
    )?.primaryCampaignType;
    const primaryNeeded = Boolean(primaryCampaignType) &&
      selectionHistory.campaignTypePublicationCountToday(primaryCampaignType!) === 0;
    const primaryCandidates = primaryCampaignType
      ? candidates.filter((item) => item.campaignType === primaryCampaignType)
      : [];
    const candidatePool = primaryNeeded && primaryCandidates.length > 0
      ? primaryCandidates
      : candidates;
    const candidate = candidatePool.sort((left, right) =>
      right.score - left.score || left.tieBreak.localeCompare(right.tieBreak))[0] ?? null;
    this.store.startSlot(
      slotRunId,
      key,
      candidate?.platformId ?? input.platformId ?? "none",
      candidate?.accountId ?? input.accountId ?? "none",
      input.scheduledFor.toISOString(),
      now,
    );
    if (!candidate) {
      const reasons = ["no-eligible-candidate"];
      this.store.completeSlot(slotRunId, "skipped_no_eligible_candidate", reasons, null, null, now);
      return { slotRunId, slotKey: key, result: "skipped_no_eligible_candidate", candidate: null, contentSpec: null, validation: null, reasons, reservation: null };
    }
    const spec = buildContentSpec(this.registry, candidate, key, now);
    this.store.saveContentSpec(spec);
    const validation = validateContentSpec(this.registry, spec, selectionHistory, now);
    this.store.saveValidation(spec.id, validation, now);
    if (!validation.passed) {
      const reasons = validation.findings.filter((item) => item.status === "failed").map((item) => item.code);
      this.store.completeSlot(slotRunId, "failed_closed", reasons, candidate, spec.id, now);
      return { slotRunId, slotKey: key, result: "failed_closed", candidate, contentSpec: spec, validation, reasons, reservation: null };
    }
    const reservation = this.store.reserve(slotRunId, spec, now);
    return {
      slotRunId,
      slotKey: key,
      result: "reserved",
      candidate,
      contentSpec: spec,
      validation,
      reasons: [
        "candidate-selected",
        ...(primaryNeeded && candidate.campaignType === primaryCampaignType
          ? ["primary-campaign-model-enforced"]
          : []),
        "content-spec-immutable",
        "validation-passed",
        "reservation-acquired",
      ],
      reservation,
    };
  }

  private verifyReadback(spec: ContentSpec, readback: ConnectorReadback): boolean {
    return readback.found &&
      readback.ownedByExpectedAccount &&
      readback.contentHashMatches &&
      Boolean(readback.providerId);
  }

  private async captureMetrics(
    publicationId: string,
    providerId: string,
    connector: PublishingConnector,
    now: Date,
  ): Promise<void> {
    const providerDefinitions = this.registry.metricDefinitions.filter(
      (definition) => definition.status === "active" && definition.source === "provider",
    );
    try {
      const metrics = await connector.fetchMetrics(providerId);
      for (const metric of metrics) {
        const definition = providerDefinitions.find(
          (candidate) => candidate.id === metric.metricDefinitionId,
        );
        if (!definition) {
          this.store.appendAudit("publication", publicationId, "metric.rejected", {
            metricDefinitionId: metric.metricDefinitionId,
            reason: "unknown-or-inactive-provider-metric-definition",
          }, now);
          continue;
        }
        if (metric.availability === "unavailable" && metric.value !== null) {
          this.store.appendAudit("publication", publicationId, "metric.rejected", {
            metricDefinitionId: metric.metricDefinitionId,
            reason: "unavailable-metric-must-have-null-value",
          }, now);
          continue;
        }
        this.store.recordMetric(
          publicationId,
          metric.metricDefinitionId,
          metric.value,
          metric.availability,
          metric.evidence,
          metric.capturedAt,
        );
      }
    } catch (error) {
      for (const definition of providerDefinitions) {
        this.store.recordMetric(
          publicationId,
          definition.id,
          null,
          "unavailable",
          {
            reason: "provider-metrics-fetch-failed",
            error: error instanceof Error ? error.message : String(error),
          },
          now.toISOString(),
        );
      }
    }
  }

  async executeReserved(input: {
    publicationId: string;
    connector: PublishingConnector;
    renderedCandidate: {
      text: string;
      mediaUrl?: string | null;
      mediaHash?: string | null;
    };
    now?: Date;
  }): Promise<{ state: string; providerId?: string | null; permalink?: string | null }> {
    const now = input.now ?? new Date();
    const publication = this.store.publication(input.publicationId);
    if (!publication) throw new Error(`Unknown publication: ${input.publicationId}`);
    if (publication.state !== "reserved") {
      throw new Error(`Publication ${input.publicationId} is not reserved; current state=${publication.state}`);
    }
    const spec = this.store.contentSpec(publication.contentSpecId);
    if (!spec) throw new Error(`Content spec missing: ${publication.contentSpecId}`);
    if (input.connector.platformId !== spec.platformId) {
      throw new Error(`Connector platform mismatch: ${input.connector.platformId} != ${spec.platformId}`);
    }
    const policy = this.registry.platformPolicies.find((item) =>
      item.platformId === spec.platformId && item.accountId === spec.accountId && item.status === "active");
    if (!policy || policy.connectorId !== input.connector.connectorId) {
      throw new Error(`Connector is not the active approved adapter for ${spec.platformId}/${spec.accountId}`);
    }
    this.store.saveRenderedCandidate(
      spec.id,
      input.connector.connectorId,
      "connector-contract-v1",
      input.renderedCandidate,
      now,
    );
    const readiness = await input.connector.readiness();
    if (!readiness.ready) {
      this.store.transitionPublication(publication.id, "failed_closed", {
        failureCode: `connector-not-ready:${readiness.reasons.join(",")}`,
      }, now);
      this.store.completeSlot(
        `slot_${sha256(spec.slotKey).slice(0, 24)}`,
        "failed_closed",
        readiness.reasons,
        null,
        spec.id,
        now,
      );
      return { state: "failed_closed" };
    }
    this.store.transitionPublication(publication.id, "publishing", {}, now);
    let result;
    try {
      result = await input.connector.publish({
        idempotencyKey: publication.idempotencyKey,
        contentSpec: spec,
        renderedCandidate: input.renderedCandidate,
      });
    } catch (error) {
      this.store.transitionPublication(publication.id, "reconciliation_required", {
        failureCode: "publish-response-lost-or-failed",
        providerReceipt: { error: error instanceof Error ? error.message : String(error) },
      }, now);
      this.store.completeSlot(
        `slot_${sha256(spec.slotKey).slice(0, 24)}`,
        "reconciliation_required",
        ["publish-response-lost-or-failed", "blind-retry-forbidden"],
        null,
        spec.id,
        now,
      );
      return { state: "reconciliation_required" };
    }
    if (result.ambiguous || !result.providerId) {
      this.store.transitionPublication(publication.id, "reconciliation_required", {
        providerId: result.providerId ?? null,
        providerReceipt: result.rawReceipt,
        failureCode: "ambiguous-provider-write",
      }, now);
      this.store.completeSlot(
        `slot_${sha256(spec.slotKey).slice(0, 24)}`,
        "reconciliation_required",
        ["ambiguous-provider-write", "blind-retry-forbidden"],
        null,
        spec.id,
        now,
      );
      return { state: "reconciliation_required", providerId: result.providerId ?? null };
    }
    this.store.transitionPublication(publication.id, "published_unverified", {
      providerId: result.providerId,
      providerReceipt: result.rawReceipt,
      publishedAt: now.toISOString(),
    }, now);
    let readback: ConnectorReadback;
    try {
      readback = await input.connector.readBack(result.providerId);
    } catch (error) {
      this.store.transitionPublication(publication.id, "reconciliation_required", {
        providerId: result.providerId,
        readback: {
          error: error instanceof Error ? error.message : String(error),
        },
        failureCode: "provider-readback-failed",
      }, now);
      this.store.completeSlot(
        `slot_${sha256(spec.slotKey).slice(0, 24)}`,
        "reconciliation_required",
        ["provider-readback-failed", "blind-retry-forbidden"],
        null,
        spec.id,
        now,
      );
      return { state: "reconciliation_required", providerId: result.providerId };
    }
    if (!this.verifyReadback(spec, readback)) {
      this.store.transitionPublication(publication.id, "reconciliation_required", {
        providerId: result.providerId,
        readback: readback.evidence,
        failureCode: "provider-readback-not-proven",
      }, now);
      this.store.completeSlot(
        `slot_${sha256(spec.slotKey).slice(0, 24)}`,
        "reconciliation_required",
        ["provider-readback-not-proven", "blind-retry-forbidden"],
        null,
        spec.id,
        now,
      );
      return { state: "reconciliation_required", providerId: result.providerId };
    }
    this.store.transitionPublication(publication.id, "verified", {
      providerId: result.providerId,
      permalink: readback.permalink ?? null,
      readback: readback.evidence,
      publishedAt: readback.publishedAt ?? now.toISOString(),
    }, now);
    this.store.completeSlot(
      `slot_${sha256(spec.slotKey).slice(0, 24)}`,
      "verified",
      ["official-provider-readback", "ownership-proven", "content-hash-proven"],
      null,
      spec.id,
      now,
    );
    await this.captureMetrics(publication.id, result.providerId, input.connector, now);
    return { state: "verified", providerId: result.providerId, permalink: readback.permalink ?? null };
  }

  async reconcile(input: {
    publicationId: string;
    connector: PublishingConnector;
    now?: Date;
  }): Promise<{ state: string; matches: number }> {
    const now = input.now ?? new Date();
    const publication = this.store.publication(input.publicationId);
    if (!publication) throw new Error(`Unknown publication: ${input.publicationId}`);
    if (publication.state !== "reconciliation_required" && publication.state !== "published_unverified") {
      throw new Error(`Publication ${publication.id} is not eligible for reconciliation`);
    }
    const spec = this.store.contentSpec(publication.contentSpecId);
    if (!spec) throw new Error(`Content spec missing: ${publication.contentSpecId}`);
    let matches: ConnectorReadback[];
    try {
      matches = publication.providerId
        ? [await input.connector.readBack(publication.providerId)]
        : await input.connector.findPossibleDuplicate(spec);
    } catch (error) {
      this.store.recordReconciliation(publication.id, "readback_failed", {
        error: error instanceof Error ? error.message : String(error),
      }, now);
      return { state: "reconciliation_required", matches: 0 };
    }
    const verified = matches.filter((match) => this.verifyReadback(spec, match));
    if (verified.length === 1) {
      const match = verified[0];
      this.store.recordReconciliation(publication.id, "verified", match.evidence, now);
      this.store.transitionPublication(publication.id, "verified", {
        providerId: match.providerId ?? null,
        permalink: match.permalink ?? null,
        readback: match.evidence,
        publishedAt: match.publishedAt ?? null,
      }, now);
      this.store.completeSlot(
        `slot_${sha256(spec.slotKey).slice(0, 24)}`,
        "verified",
        ["reconciled-provider-readback", "ownership-proven", "content-hash-proven"],
        null,
        spec.id,
        now,
      );
      if (match.providerId) {
        await this.captureMetrics(publication.id, match.providerId, input.connector, now);
      }
      return { state: "verified", matches: 1 };
    }
    if (matches.length === 0) {
      this.store.recordReconciliation(publication.id, "confirmed_absent", { matches: [] }, now);
      this.store.transitionPublication(publication.id, "confirmed_absent", {
        failureCode: "confirmed-absent-after-readback",
        readback: { matches: [] },
      }, now);
      this.store.completeSlot(
        `slot_${sha256(spec.slotKey).slice(0, 24)}`,
        "confirmed_absent",
        ["confirmed-absent-after-provider-readback"],
        null,
        spec.id,
        now,
      );
      return { state: "confirmed_absent", matches: 0 };
    }
    this.store.recordReconciliation(publication.id, "ambiguous", { matches }, now);
    return { state: "reconciliation_required", matches: matches.length };
  }

  overview(): {
    registryVersion: string;
    databaseCounts: Record<string, number>;
    auditChainValid: boolean;
    slotTimes: string[];
    principles: string[];
  } {
    return {
      registryVersion: this.registry.registryVersion,
      databaseCounts: this.store.counts(),
      auditChainValid: this.store.auditChainValid(),
      slotTimes: this.registry.schedules.flatMap((schedule) => schedule.slotTimes),
      principles: [
        "deterministic-selection",
        "immutable-content-specs",
        "official-api-only",
        "provider-readback-before-success",
        "no-blind-retry",
        "unavailable-is-not-zero",
        "append-only-hash-chained-audit",
      ],
    };
  }
}

export function deterministicRenderedCandidate(spec: ContentSpec): {
  text: string;
  mediaUrl: null;
  mediaHash: string;
} {
  const text = `${spec.renderedIntent.hook}\n\n${spec.renderedIntent.body}\n\n${spec.renderedIntent.cta}`;
  return { text, mediaUrl: null, mediaHash: sha256(text) };
}

export function newDiagnosticPublicationId(): string {
  return `diagnostic_${randomUUID()}`;
}
