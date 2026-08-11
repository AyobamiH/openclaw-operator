import { canonicalJson, sha256 } from "./canonical.js";
import type { PublishingStore } from "./store.js";
import type { PublishingRegistryBundle } from "./types.js";

export type CampaignIdentityBridgeEntry = {
  historicalCampaignId: string;
  canonicalCampaignId: string | null;
  status: "mapped" | "unmapped";
  reason: string;
  provenanceRefs: string[];
  reviewedBy: string;
  reviewedAt: string;
};

export type CampaignIdentityResolution = {
  sourceCampaignId: string;
  canonicalCampaignId: string | null;
  matrixCampaignId: string;
  status: "direct" | "mapped" | "unmapped";
  provenanceHash: string | null;
  reason: string;
};

const REVIEWED_BY = "operator-reviewed-campaign-feedback-runtime-repair";
const REVIEWED_AT = "2026-08-11T11:50:00.000Z";
const GRAPH_EVIDENCE = "graph-runs.sqlite:graph_one_run_live_capabilities+graph_runs.state_json";

export const REVIEWED_CAMPAIGN_IDENTITY_BRIDGE: CampaignIdentityBridgeEntry[] = [
  {
    historicalCampaignId: "68b10c5c-f604-4567-9213-d0d1eab08106",
    canonicalCampaignId: null,
    status: "unmapped",
    reason: "Historical value is an immutable Threads text schedule/outbox identity, not a campaign identity; no exact canonical campaign binding exists.",
    provenanceRefs: ["config/publishing/production-integration.v1.json:protectedLegacyJobs", "orchestrator/src/graph/scheduler-portfolio.ts:threads-early-text-v1", GRAPH_EVIDENCE],
    reviewedBy: REVIEWED_BY,
    reviewedAt: REVIEWED_AT,
  },
  {
    historicalCampaignId: "083e3560-40fd-4487-9d78-674f64866ef7",
    canonicalCampaignId: null,
    status: "unmapped",
    reason: "Historical value is an immutable Threads image schedule/outbox identity, not a campaign identity; no exact canonical campaign binding exists.",
    provenanceRefs: ["config/publishing/production-integration.v1.json:protectedLegacyJobs", "orchestrator/src/graph/scheduler-portfolio.ts:threads-daily-image-v1", GRAPH_EVIDENCE],
    reviewedBy: REVIEWED_BY,
    reviewedAt: REVIEWED_AT,
  },
  ...[
    ["qualified-enquiries", "strategicObjectives:objective:repeatable-sales-engine"],
    ["pet-care-category", "strategicPillars:pet-care-category-leadership"],
    ["productised-engineering", "strategicPillars:productised-engineering-services"],
    ["governed-automation", "capabilities:business-automation"],
    ["market-authority", "strategicPillars:market-authority-and-community"],
    ["operational-excellence", "strategicPillars:operational-excellence"],
  ].map(([historicalCampaignId, sourceRef]) => ({
    historicalCampaignId: historicalCampaignId!,
    canonicalCampaignId: null,
    status: "unmapped" as const,
    reason: "Historical Instagram rotation category spans multiple immutable product/audience sequences and is not one-to-one with any canonical campaign; mapping by similar wording would fabricate identity.",
    provenanceRefs: ["business/content/instagram-dynamic-content-engine.v1.json:campaigns", sourceRef!, GRAPH_EVIDENCE],
    reviewedBy: REVIEWED_BY,
    reviewedAt: REVIEWED_AT,
  })),
];

function material(entry: CampaignIdentityBridgeEntry): Record<string, unknown> {
  return {
    historicalCampaignId: entry.historicalCampaignId,
    canonicalCampaignId: entry.canonicalCampaignId,
    status: entry.status,
    reason: entry.reason,
    provenanceRefs: entry.provenanceRefs,
    reviewedBy: entry.reviewedBy,
    reviewedAt: entry.reviewedAt,
  };
}

export function registerCampaignIdentityBridge(
  store: PublishingStore,
  entries: CampaignIdentityBridgeEntry[] = REVIEWED_CAMPAIGN_IDENTITY_BRIDGE,
): void {
  for (const entry of entries) {
    if ((entry.status === "mapped") !== Boolean(entry.canonicalCampaignId)) {
      throw new Error(`campaign_identity_bridge_status_binding_invalid:${entry.historicalCampaignId}`);
    }
    const provenanceJson = canonicalJson(entry.provenanceRefs);
    const provenanceHash = sha256(canonicalJson(material(entry)));
    store.database.prepare(`
      INSERT OR IGNORE INTO publishing_campaign_identity_bridge(
        historical_campaign_id, canonical_campaign_id, status, reason,
        provenance_json, provenance_hash, reviewed_by, reviewed_at, created_at
      ) VALUES(?,?,?,?,?,?,?,?,?)
    `).run(
      entry.historicalCampaignId,
      entry.canonicalCampaignId,
      entry.status,
      entry.reason,
      provenanceJson,
      provenanceHash,
      entry.reviewedBy,
      entry.reviewedAt,
      entry.reviewedAt,
    );
    const row = store.database.prepare(`
      SELECT canonical_campaign_id, status, reason, provenance_json,
        provenance_hash, reviewed_by, reviewed_at
      FROM publishing_campaign_identity_bridge
      WHERE historical_campaign_id=?
    `).get(entry.historicalCampaignId) as Record<string, unknown> | undefined;
    if (!row
      || (row.canonical_campaign_id ?? null) !== entry.canonicalCampaignId
      || row.status !== entry.status
      || row.reason !== entry.reason
      || row.provenance_json !== provenanceJson
      || row.provenance_hash !== provenanceHash
      || row.reviewed_by !== entry.reviewedBy
      || row.reviewed_at !== entry.reviewedAt) {
      throw new Error(`campaign_identity_bridge_immutable_mismatch:${entry.historicalCampaignId}`);
    }
  }
}

export function resolveCampaignIdentity(
  store: PublishingStore,
  registry: PublishingRegistryBundle,
  sourceCampaignId: string,
): CampaignIdentityResolution {
  if (registry.campaigns.some((campaign) => campaign.id === sourceCampaignId)) {
    return {
      sourceCampaignId,
      canonicalCampaignId: sourceCampaignId,
      matrixCampaignId: sourceCampaignId,
      status: "direct",
      provenanceHash: null,
      reason: "publication carries a canonical registry campaign identity directly",
    };
  }
  const row = store.database.prepare(`
    SELECT canonical_campaign_id, status, reason, provenance_hash
    FROM publishing_campaign_identity_bridge
    WHERE historical_campaign_id=?
  `).get(sourceCampaignId) as Record<string, unknown> | undefined;
  if (row?.status === "mapped" && typeof row.canonical_campaign_id === "string") {
    if (!registry.campaigns.some((campaign) => campaign.id === row.canonical_campaign_id)) {
      throw new Error(`campaign_identity_bridge_canonical_target_missing:${sourceCampaignId}:${String(row.canonical_campaign_id)}`);
    }
    return {
      sourceCampaignId,
      canonicalCampaignId: String(row.canonical_campaign_id),
      matrixCampaignId: String(row.canonical_campaign_id),
      status: "mapped",
      provenanceHash: String(row.provenance_hash),
      reason: String(row.reason),
    };
  }
  return {
    sourceCampaignId,
    canonicalCampaignId: null,
    matrixCampaignId: `UNMAPPED:${sourceCampaignId}`,
    status: "unmapped",
    provenanceHash: row?.provenance_hash ? String(row.provenance_hash) : null,
    reason: row?.reason ? String(row.reason) : "no reviewed immutable campaign identity evidence exists",
  };
}
