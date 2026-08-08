import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DeterministicPublishingEngine,
  deterministicRenderedCandidate,
  slotKey,
} from "../src/publishing/engine.js";
import {
  extractProviderId,
  PublishingConnectorRegistry,
  WorkerBackedPublishingConnector,
} from "../src/publishing/connectors.js";
import { classifyAssetRelationship } from "../src/publishing/proof.js";
import {
  loadRegistryBundle,
  registryBundleHash,
  validateRegistryBundle,
} from "../src/publishing/registry.js";
import { PublishingStore } from "../src/publishing/store.js";
import type {
  ConnectorReadback,
  ContentSpec,
  PublishingConnector,
  PublishingRegistryBundle,
} from "../src/publishing/types.js";

const REGISTRY_PATH = fileURLToPath(
  new URL("../../config/publishing/registry.v1.json", import.meta.url),
);

async function registry(): Promise<PublishingRegistryBundle> {
  return loadRegistryBundle(REGISTRY_PATH);
}

async function rawRegistry(): Promise<any> {
  return JSON.parse(await readFile(REGISTRY_PATH, "utf8"));
}

async function harness(): Promise<{
  registry: PublishingRegistryBundle;
  store: PublishingStore;
  engine: DeterministicPublishingEngine;
}> {
  const bundle = await registry();
  const store = new PublishingStore(":memory:");
  const engine = new DeterministicPublishingEngine(bundle, store);
  engine.initialize();
  return { registry: bundle, store, engine };
}

function at(time = "05:00"): Date {
  return new Date(`2026-07-30T${time}:00+01:00`);
}

function verifiedReadback(
  providerId = "provider-1",
  contentHashMatches = true,
): ConnectorReadback {
  return {
    found: true,
    providerId,
    ownedByExpectedAccount: true,
    contentHashMatches,
    permalink: `https://provider.example/${providerId}`,
    publishedAt: "2026-07-30T04:00:02.000Z",
    mediaType: "text",
    evidence: { source: "official-provider-readback", providerId },
  };
}

function connector(input: {
  platformId?: string;
  connectorId?: string;
  publish?: () => Promise<any>;
  readBack?: () => Promise<ConnectorReadback>;
  findPossibleDuplicate?: (spec: ContentSpec) => Promise<ConnectorReadback[]>;
  fetchMetrics?: () => Promise<any[]>;
} = {}): PublishingConnector {
  return {
    platformId: input.platformId ?? "threads",
    connectorId: input.connectorId ?? "official-meta-threads-v1",
    readiness: async () => ({ ready: true, reasons: [] }),
    publish: input.publish ?? (async () => ({
      providerId: "provider-1",
      ambiguous: false,
      rawReceipt: { id: "provider-1" },
    })),
    readBack: input.readBack ?? (async () => verifiedReadback()),
    findPossibleDuplicate:
      input.findPossibleDuplicate ?? (async () => []),
    fetchMetrics: input.fetchMetrics ?? (async () => [{
      metricDefinitionId: "metric-impressions",
      value: 12,
      availability: "available",
      capturedAt: "2026-07-30T04:01:00.000Z",
      evidence: { source: "official-provider-metrics" },
    }]),
  };
}

describe("deterministic self-identification publishing engine", () => {
  it("loads the authoritative versioned registry", async () => {
    const bundle = await registry();
    expect(bundle.schemaVersion).toBe("1.0.0");
    expect(bundle.registryVersion).toBe("2026-08-08.1");
    expect(registryBundleHash(bundle)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("contains all eighteen registry families", async () => {
    const bundle = await registry();
    const families = Object.values(bundle).filter(Array.isArray);
    expect(families).toHaveLength(18);
    expect(families.every((records) => records.length > 0)).toBe(true);
  });

  it("defines exactly the five Europe/London opportunity slots", async () => {
    const bundle = await registry();
    expect(bundle.schedules).toHaveLength(1);
    expect(bundle.schedules[0]).toMatchObject({
      timezone: "Europe/London",
      opportunityOnly: true,
      enabled: true,
      primaryCampaignType: "self-identification",
      slotTimes: ["05:00", "07:00", "11:00", "15:00", "17:00"],
    });
  });

  it("requires an active self-identification campaign as the primary campaign model", async () => {
    const raw = await rawRegistry();
    for (const campaign of raw.campaigns) {
      if (campaign.type === "self-identification") campaign.status = "paused";
    }
    expect(() => validateRegistryBundle(raw)).toThrow(
      /active self-identification campaign is required/,
    );
  });

  it("fails closed when a campaign strategy does not allow its campaign type", async () => {
    const raw = await rawRegistry();
    raw.campaigns.find(
      (campaign: any) => campaign.id === "campaign-openclaw-proof",
    ).strategyId = "strategy-self-identification";
    expect(() => validateRegistryBundle(raw)).toThrow(
      /strategy strategy-self-identification does not allow proof-and-evidence/,
    );
  });

  it("registers Tax Lien Platform for its specified self-identification audience", async () => {
    const bundle = await registry();
    const product = bundle.products.find((item) => item.id === "tax-lien-platform");
    const campaign = bundle.campaigns.find(
      (item) => item.id === "campaign-tax-lien-self-identification",
    );
    expect(product?.allowedCampaignTypes).toContain("self-identification");
    expect(product?.targetAudienceIds).toContain(
      "audience-independent-tax-lien-investors",
    );
    expect(campaign).toMatchObject({
      type: "self-identification",
      audienceId: "audience-independent-tax-lien-investors",
      strategyId: "strategy-self-identification",
    });
    expect(campaign?.identitySignalIds).toContain(
      "signal-fragmented-county-research",
    );
  });

  it("contains no Reddit policy, campaign, or template reference", async () => {
    const bundle = await registry();
    const references = [
      ...bundle.platformPolicies.map((item) => item.platformId),
      ...bundle.campaigns.flatMap((item) => item.platformIds),
      ...bundle.templates.flatMap((item) => item.platformIds),
    ];
    expect(references).not.toContain("reddit");
  });

  it("fails closed when Reddit is introduced as a policy", async () => {
    const raw = await rawRegistry();
    raw.platformPolicies[0].platformId = "reddit";
    expect(() => validateRegistryBundle(raw)).toThrow(/explicitly prohibited/);
  });

  it("fails closed when Reddit is introduced only through a campaign", async () => {
    const raw = await rawRegistry();
    raw.campaigns[0].platformIds.push("reddit");
    expect(() => validateRegistryBundle(raw)).toThrow(/explicitly prohibited/);
  });

  it("accepts an unlisted future platform through the generic connector contract", async () => {
    const raw = await rawRegistry();
    for (const policy of raw.platformPolicies) {
      if (policy.platformId === "threads") {
        policy.id = "platform-policy-bluesky";
        policy.platformId = "bluesky";
        policy.connectorId = "official-bluesky-v1";
      }
    }
    for (const campaign of raw.campaigns) {
      campaign.platformIds = campaign.platformIds.map((id: string) =>
        id === "threads" ? "bluesky" : id);
    }
    for (const template of raw.templates) {
      template.platformIds = template.platformIds.map((id: string) =>
        id === "threads" ? "bluesky" : id);
    }
    expect(validateRegistryBundle(raw).platformPolicies.some(
      (policy) => policy.platformId === "bluesky",
    )).toBe(true);
  });

  it("fails closed on broken cross-registry references", async () => {
    const raw = await rawRegistry();
    raw.products[0].defaultCtaId = "missing-cta";
    expect(() => validateRegistryBundle(raw)).toThrow(/missing reference missing-cta/);
  });

  it("fails closed when the five-slot opportunity contract drifts", async () => {
    const raw = await rawRegistry();
    raw.schedules[0].slotTimes.push("19:00");
    expect(() => validateRegistryBundle(raw)).toThrow(/must be exactly/);
  });

  it("fails closed when a referenced approval is no longer approved", async () => {
    const raw = await rawRegistry();
    raw.approvals[0].decision = "pending";
    expect(() => validateRegistryBundle(raw)).toThrow(/is not approved/);
  });

  it("uses London-local slot identities", () => {
    expect(slotKey(at("05:00"))).toBe("2026-07-30:05:00");
  });

  it("skips times that are not approved opportunities", async () => {
    const { engine, store } = await harness();
    const plan = engine.planSlot({ scheduledFor: at("06:00"), now: at("06:00") });
    expect(plan.result).toBe("skipped_policy");
    expect(plan.reservation).toBeNull();
    expect(store.auditChainValid()).toBe(true);
    store.close();
  });

  it("selects the same candidate and immutable content hash on replay", async () => {
    const first = await harness();
    const second = await harness();
    const firstPlan = first.engine.planSlot({ scheduledFor: at(), now: at() });
    const secondPlan = second.engine.planSlot({ scheduledFor: at(), now: at() });
    expect(firstPlan.candidate?.id).toBe(secondPlan.candidate?.id);
    expect(firstPlan.contentSpec?.contentHash).toBe(secondPlan.contentSpec?.contentHash);
    expect(firstPlan.reservation).toBeTruthy();
    first.store.close();
    second.store.close();
  });

  it("includes the approved strategy in the immutable content specification", async () => {
    const { engine, store } = await harness();
    const plan = engine.planSlot({ scheduledFor: at(), now: at() });
    expect(plan.contentSpec?.strategyId).toBe("strategy-self-identification");
    const tampered = {
      ...plan.contentSpec!,
      strategyId: "strategy-practical-proof",
    };
    const validation = (
      await import("../src/publishing/content.js")
    ).validateContentSpec(
      engine.registry,
      tampered,
      { exactContentHashes: new Set() },
      at(),
    );
    expect(validation.passed).toBe(false);
    expect(validation.findings.some(
      (finding) =>
        finding.code === "content-hash" &&
        finding.status === "failed",
    )).toBe(true);
    expect(validation.findings.some(
      (finding) =>
        finding.code === "campaign-strategy" &&
        finding.status === "failed",
    )).toBe(true);
    store.close();
  });

  it("replays a sequential week with primary self-identification and portfolio rotation", async () => {
    const { registry: bundle, engine, store } = await harness();
    const schedule = bundle.schedules[0];
    const selected: Array<{
      day: string;
      productId: string;
      campaignId: string;
      campaignType: string;
      strategyId: string;
      primary: boolean;
    }> = [];
    const base = new Date("2026-07-30T12:00:00.000Z");
    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const dayValue = new Date(base);
      dayValue.setUTCDate(dayValue.getUTCDate() + dayOffset);
      const day = dayValue.toISOString().slice(0, 10);
      for (const slot of schedule.slotTimes) {
        const scheduledFor = new Date(`${day}T${slot}:00+01:00`);
        const plan = engine.planSlot({ scheduledFor, now: scheduledFor });
        if (plan.result !== "reserved" || !plan.reservation || !plan.contentSpec || !plan.candidate) {
          continue;
        }
        const providerId = `provider-${day}-${slot.replace(":", "")}`;
        const policy = bundle.platformPolicies.find(
          (item) =>
            item.platformId === plan.contentSpec!.platformId &&
            item.accountId === plan.contentSpec!.accountId,
        )!;
        const result = await engine.executeReserved({
          publicationId: plan.reservation.publicationId,
          connector: connector({
            platformId: plan.contentSpec.platformId,
            connectorId: policy.connectorId,
            publish: async () => ({
              providerId,
              ambiguous: false,
              rawReceipt: { providerId, simulated: true },
            }),
            readBack: async () => verifiedReadback(providerId),
            fetchMetrics: async () => [],
          }),
          renderedCandidate: deterministicRenderedCandidate(plan.contentSpec),
          now: scheduledFor,
        });
        expect(result.state).toBe("verified");
        selected.push({
          day,
          productId: plan.candidate.productId,
          campaignId: plan.candidate.campaignId,
          campaignType: plan.candidate.campaignType,
          strategyId: plan.contentSpec.strategyId,
          primary: plan.reasons.includes("primary-campaign-model-enforced"),
        });
      }
    }
    const activeProducts = bundle.products
      .filter((item) => item.status === "active" && item.state === "active")
      .map((item) => item.id)
      .sort();
    expect(Array.from(new Set(selected.map((item) => item.productId))).sort())
      .toEqual(activeProducts);
    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const dayValue = new Date(base);
      dayValue.setUTCDate(dayValue.getUTCDate() + dayOffset);
      const day = dayValue.toISOString().slice(0, 10);
      expect(selected.some(
        (item) =>
          item.day === day &&
          item.campaignType === schedule.primaryCampaignType &&
          item.primary,
      )).toBe(true);
    }
    expect(selected.some(
      (item) =>
        item.productId === "tax-lien-platform" &&
        item.campaignId === "campaign-tax-lien-self-identification",
    )).toBe(true);
    expect(selected.every((item) => {
      const campaign = bundle.campaigns.find((candidate) => candidate.id === item.campaignId);
      const strategy = bundle.contentStrategies.find((candidate) => candidate.id === item.strategyId);
      return campaign?.strategyId === item.strategyId &&
        strategy?.allowedCampaignTypes.includes(campaign.type);
    })).toBe(true);
    expect(store.auditChainValid()).toBe(true);
    store.close();
  });

  it("allows only one reservation for a global slot identity", async () => {
    const { engine, store } = await harness();
    engine.planSlot({ scheduledFor: at(), now: at() });
    expect(() => engine.planSlot({ scheduledFor: at(), now: at() })).toThrow();
    expect(store.counts().publishing_reservations).toBe(1);
    store.close();
  });

  it("persists immutable content specifications", async () => {
    const { engine, store } = await harness();
    const plan = engine.planSlot({ scheduledFor: at(), now: at() });
    expect(() => store.database.prepare(
      "UPDATE publishing_content_specs SET state='validated' WHERE id=?",
    ).run(plan.contentSpec!.id)).toThrow(/immutable/);
    store.close();
  });

  it("retires stale registry rows instead of leaving active drift", async () => {
    const bundle = await registry();
    const store = new PublishingStore(":memory:");
    const withStale = structuredClone(bundle);
    withStale.audiences.push({
      id: "audience-stale-fixture",
      version: "1",
      status: "active",
      createdAt: "2026-07-29T17:53:11+01:00",
      updatedAt: "2026-07-29T17:53:11+01:00",
      name: "Stale fixture",
      description: "Registry retirement fixture.",
      exclusions: [],
    });
    store.seedRegistry(withStale);
    store.seedRegistry(bundle);
    const row = store.database.prepare(
      "SELECT status FROM publishing_audiences WHERE id='audience-stale-fixture'",
    ).get() as { status: string };
    expect(row.status).toBe("retired");
    expect(store.auditChainValid()).toBe(true);
    store.close();
  });

  it("does not slice or truncate deterministic rendered copy", async () => {
    const { engine, store } = await harness();
    const plan = engine.planSlot({ scheduledFor: at(), now: at() });
    const rendered = deterministicRenderedCandidate(plan.contentSpec!);
    expect(rendered.text).toContain(plan.contentSpec!.renderedIntent.hook);
    expect(rendered.text).toContain(plan.contentSpec!.renderedIntent.body);
    expect(rendered.text).toContain(plan.contentSpec!.renderedIntent.cta);
    expect(rendered.text).not.toMatch(/\.\./);
    store.close();
  });

  it("requires the approved connector identity", async () => {
    const { engine, store } = await harness();
    const plan = engine.planSlot({ scheduledFor: at(), now: at(), platformId: "threads" });
    await expect(engine.executeReserved({
      publicationId: plan.reservation!.publicationId,
      connector: connector({ connectorId: "unapproved-adapter" }),
      renderedCandidate: deterministicRenderedCandidate(plan.contentSpec!),
      now: at(),
    })).rejects.toThrow(/not the active approved adapter/);
    store.close();
  });

  it("extracts successful provider IDs from nested worker evidence", () => {
    expect(extractProviderId({
      connector: {
        result: {
          response: {
            media_id: "nested-provider-1",
          },
        },
      },
    })).toBe("nested-provider-1");
  });

  it("fails connector coverage when an approved worker adapter is missing", async () => {
    const bundle = await registry();
    const connectors = new PublishingConnectorRegistry();
    expect(() => connectors.assertActivePolicyCoverage(bundle)).toThrow(
      /Approved connector is not registered/,
    );
  });

  it("binds official worker adapters without platform-specific core branches", async () => {
    const bundle = await registry();
    const makeWorker = (platformId: string, connectorId: string) =>
      new WorkerBackedPublishingConnector({
        platformId,
        connectorId,
        transport: "official-api-worker",
        readiness: async () => ({ ready: true, reasons: [] }),
        publishOnce: async () => ({ result: { id: `${platformId}-provider-1` } }),
        readBack: async (providerId) => verifiedReadback(providerId),
        findPossibleDuplicate: async () => [],
        fetchMetrics: async () => [],
      });
    const connectors = new PublishingConnectorRegistry();
    connectors.register(makeWorker("threads", "official-meta-threads-v1"));
    connectors.register(makeWorker("instagram", "official-meta-instagram-v1"));
    connectors.assertActivePolicyCoverage(bundle);
    expect(connectors.ids()).toEqual([
      "official-meta-instagram-v1",
      "official-meta-threads-v1",
    ]);
  });

  it("requires official provider readback before verified success", async () => {
    const { engine, store } = await harness();
    const plan = engine.planSlot({ scheduledFor: at(), now: at(), platformId: "threads" });
    const result = await engine.executeReserved({
      publicationId: plan.reservation!.publicationId,
      connector: connector(),
      renderedCandidate: deterministicRenderedCandidate(plan.contentSpec!),
      now: at(),
    });
    expect(result.state).toBe("verified");
    expect(store.publication(plan.reservation!.publicationId)?.state).toBe("verified");
    expect(store.counts().publishing_rendered_candidates).toBe(1);
    expect(store.counts().publishing_metrics).toBe(1);
    store.close();
  });

  it("never blindly retries a write after a lost response", async () => {
    const { engine, store } = await harness();
    const plan = engine.planSlot({ scheduledFor: at(), now: at(), platformId: "threads" });
    let writes = 0;
    const result = await engine.executeReserved({
      publicationId: plan.reservation!.publicationId,
      connector: connector({
        publish: async () => {
          writes += 1;
          throw new Error("response lost");
        },
      }),
      renderedCandidate: deterministicRenderedCandidate(plan.contentSpec!),
      now: at(),
    });
    expect(result.state).toBe("reconciliation_required");
    expect(writes).toBe(1);
    expect(store.publication(plan.reservation!.publicationId)?.state).toBe(
      "reconciliation_required",
    );
    store.close();
  });

  it("moves a failed provider readback to reconciliation", async () => {
    const { engine, store } = await harness();
    const plan = engine.planSlot({ scheduledFor: at(), now: at(), platformId: "threads" });
    const result = await engine.executeReserved({
      publicationId: plan.reservation!.publicationId,
      connector: connector({
        readBack: async () => {
          throw new Error("provider unavailable");
        },
      }),
      renderedCandidate: deterministicRenderedCandidate(plan.contentSpec!),
      now: at(),
    });
    expect(result.state).toBe("reconciliation_required");
    store.close();
  });

  it("reconciles a lost write response without making another write", async () => {
    const { engine, store } = await harness();
    const plan = engine.planSlot({ scheduledFor: at(), now: at(), platformId: "threads" });
    let writes = 0;
    const adapter = connector({
      publish: async () => {
        writes += 1;
        throw new Error("response lost");
      },
      findPossibleDuplicate: async () => [verifiedReadback("provider-reconciled")],
    });
    await engine.executeReserved({
      publicationId: plan.reservation!.publicationId,
      connector: adapter,
      renderedCandidate: deterministicRenderedCandidate(plan.contentSpec!),
      now: at(),
    });
    const result = await engine.reconcile({
      publicationId: plan.reservation!.publicationId,
      connector: adapter,
      now: at("05:05"),
    });
    expect(result).toEqual({ state: "verified", matches: 1 });
    expect(writes).toBe(1);
    store.close();
  });

  it("records confirmed absence instead of retrying", async () => {
    const { engine, store } = await harness();
    const plan = engine.planSlot({ scheduledFor: at(), now: at(), platformId: "threads" });
    const adapter = connector({
      publish: async () => {
        throw new Error("response lost");
      },
      findPossibleDuplicate: async () => [],
    });
    await engine.executeReserved({
      publicationId: plan.reservation!.publicationId,
      connector: adapter,
      renderedCandidate: deterministicRenderedCandidate(plan.contentSpec!),
      now: at(),
    });
    const result = await engine.reconcile({
      publicationId: plan.reservation!.publicationId,
      connector: adapter,
      now: at("05:05"),
    });
    expect(result.state).toBe("confirmed_absent");
    store.close();
  });

  it("keeps an unavailable provider metric null rather than zero", async () => {
    const { engine, store } = await harness();
    const plan = engine.planSlot({ scheduledFor: at(), now: at(), platformId: "threads" });
    await engine.executeReserved({
      publicationId: plan.reservation!.publicationId,
      connector: connector({
        fetchMetrics: async () => {
          throw new Error("metrics unavailable");
        },
      }),
      renderedCandidate: deterministicRenderedCandidate(plan.contentSpec!),
      now: at(),
    });
    const rows = store.database.prepare(
      "SELECT value, availability FROM publishing_metrics ORDER BY metric_definition_id",
    ).all() as Array<{ value: number | null; availability: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.value === null && row.availability === "unavailable")).toBe(true);
    store.close();
  });

  it("enforces evidence thresholds for attribution", async () => {
    const { engine, store } = await harness();
    expect(() => engine.recordAttribution({
      definitionId: "attribution-publication-to-conversation",
      fromType: "publication",
      fromId: "publication-1",
      toType: "conversation",
      toId: "conversation-1",
      confidence: "medium",
      evidence: [{ source: "provider-readback" }],
    })).toThrow(/at least 2 evidence records/);
    expect(engine.recordAttribution({
      definitionId: "attribution-publication-to-conversation",
      fromType: "publication",
      fromId: "publication-1",
      toType: "conversation",
      toId: "conversation-1",
      confidence: "medium",
      evidence: [{ source: "provider-readback" }, { source: "conversation-receipt" }],
    })).toBeTruthy();
    store.close();
  });

  it("maintains a valid hash-chained audit ledger", async () => {
    const { engine, store } = await harness();
    engine.planSlot({ scheduledFor: at(), now: at() });
    expect(store.auditChainValid()).toBe(true);
    store.database.prepare(
      "UPDATE publishing_audit_events SET payload_json='{}' WHERE sequence=1",
    ).run();
    expect(store.auditChainValid()).toBe(false);
    store.close();
  });

  it("classifies proof assets by exact and perceptual lineage", () => {
    expect(classifyAssetRelationship({
      sourceSha256: "a".repeat(64),
      candidateSha256: "a".repeat(64),
    }).classification).toBe("exact");
    expect(classifyAssetRelationship({
      sourceSha256: "a".repeat(64),
      candidateSha256: "b".repeat(64),
      sourcePerceptualHash: "ffff0000",
      candidatePerceptualHash: "ffff0001",
      sourceDurationSeconds: 42,
      candidateDurationSeconds: 42,
    }).classification).toBe("recompression");
  });
});
