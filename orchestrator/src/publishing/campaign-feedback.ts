import { createRequire } from "node:module";

import { canonicalJson, sha256, stableId } from "./canonical.js";
import {
  OpenClawOfficialApiWorkerClient,
  type ProductionToolInvoker,
} from "./official-worker.js";
import type {
  ProductionIntegration,
  ProductionOpportunity,
} from "./production-integration.js";
import type { PublishingStore } from "./store.js";
import type { PlatformId, PublishingRegistryBundle } from "./types.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type SqliteDatabase = InstanceType<typeof DatabaseSync>;

export type FeedbackPublicationEvidence = {
  graphRunId: string;
  graphEffectId: string;
  graphId: string;
  graphVersion: string;
  campaignId: string;
  candidateId: string;
  platformId: PlatformId;
  accountId: string;
  providerObjectId: string;
  slotId: string;
  permalink: string | null;
  state: "observed" | "verified" | "ambiguous";
  observedAt: string;
  evidenceRefs: unknown;
};

type FeedbackSummary = {
  owner: "campaign-factory-v4-measurement-reconciliation";
  pollId: string;
  status: "completed" | "duplicate_completed" | "overlap_skipped";
  importedPublications: number;
  verifiedPublications: number;
  officialMetricReads: number;
  officialConversationReads: number;
  metricObservationsInserted: number;
  metricObservationsDeduplicated: number;
  conversationsInserted: number;
  conversationObservationsInserted: number;
  attributionEdgesInserted: number;
  reconciliationsInserted: number;
  businessOutcomesVerified: 0;
  connectorFailures: Array<{ publicationId: string; error: string }>;
  externalWrites: 0;
  browserRelayCalls: 0;
};

const OWNER = "campaign-factory-v4-measurement-reconciliation" as const;
const EXACT_REPLY_ATTRIBUTION = "exact-provider-reply-chain-v1";

function openReadOnly(path: string): SqliteDatabase {
  const database = new DatabaseSync(path, { readOnly: true });
  database.exec("PRAGMA query_only=ON");
  return database;
}

function effectState(value: string): FeedbackPublicationEvidence["state"] {
  if (value === "effect_verified") return "verified";
  if (value === "ambiguous") return "ambiguous";
  return "observed";
}

export function loadGraphPublicationEvidence(input: {
  graphRunDatabasePath: string;
  graphSchedulerDatabasePath?: string;
}): FeedbackPublicationEvidence[] {
  const schedulerPermalinks = new Map<string, string>();
  if (input.graphSchedulerDatabasePath) {
    const scheduler = openReadOnly(input.graphSchedulerDatabasePath);
    try {
      const rows = scheduler.prepare(`
        SELECT graph_run_id, permalink
        FROM graph_scheduler_triggers
        WHERE graph_run_id IS NOT NULL AND permalink IS NOT NULL
      `).all() as Array<{ graph_run_id: string; permalink: string }>;
      for (const row of rows) schedulerPermalinks.set(row.graph_run_id, row.permalink);
    } finally {
      scheduler.close();
    }
  }

  const graph = openReadOnly(input.graphRunDatabasePath);
  try {
    const rows = graph.prepare(`
      SELECT
        capability.graph_run_id,
        capability.graph_id,
        capability.graph_version,
        capability.campaign_id,
        capability.candidate_id,
        capability.provider,
        capability.account_id,
        capability.slot_id,
        effect.effect_id,
        effect.state,
        effect.provider_operation_id,
        effect.last_observed_at,
        effect.evidence_refs_json
      FROM graph_one_run_live_capabilities AS capability
      JOIN graph_external_effects AS effect ON effect.run_id=capability.graph_run_id
      WHERE capability.operation_type LIKE '%publication%'
        AND capability.provider IN ('threads','instagram')
        AND effect.provider_operation_id IS NOT NULL
      ORDER BY effect.last_observed_at ASC, effect.effect_id ASC
    `).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      graphRunId: String(row.graph_run_id),
      graphEffectId: String(row.effect_id),
      graphId: String(row.graph_id),
      graphVersion: String(row.graph_version),
      campaignId: String(row.campaign_id),
      candidateId: String(row.candidate_id),
      platformId: String(row.provider) as PlatformId,
      accountId: String(row.account_id),
      providerObjectId: String(row.provider_operation_id),
      slotId: String(row.slot_id),
      permalink: schedulerPermalinks.get(String(row.graph_run_id)) ?? null,
      state: effectState(String(row.state)),
      observedAt: String(row.last_observed_at || new Date(0).toISOString()),
      evidenceRefs: JSON.parse(String(row.evidence_refs_json || "[]")),
    }));
  } finally {
    graph.close();
  }
}

function acquirePoll(input: {
  store: PublishingStore;
  scheduledFor: string;
  now: Date;
}): { pollId: string; status: "acquired" | "duplicate_completed" | "overlap_skipped" } {
  return input.store.transaction(() => {
    const pollId = stableId("feedback-poll", { owner: OWNER, scheduledFor: input.scheduledFor });
    const existing = input.store.database.prepare(`
      SELECT status FROM publishing_feedback_poll_runs WHERE id=?
    `).get(pollId) as { status: string } | undefined;
    if (existing?.status === "completed") return { pollId, status: "duplicate_completed" };
    const nowIso = input.now.toISOString();
    const activeClaim = input.store.database.prepare(`
      SELECT poll_id, expires_at FROM publishing_feedback_poll_claims WHERE owner=?
    `).get(OWNER) as { poll_id: string; expires_at: string } | undefined;
    if (activeClaim && activeClaim.poll_id !== pollId && activeClaim.expires_at > nowIso) {
      input.store.database.prepare(`
        INSERT INTO publishing_feedback_poll_runs(
          id, owner, scheduled_for, status, summary_json, started_at, completed_at
        ) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status,
          summary_json=excluded.summary_json, completed_at=excluded.completed_at
      `).run(
        pollId,
        OWNER,
        input.scheduledFor,
        "overlap_skipped",
        canonicalJson({ activePollId: activeClaim.poll_id }),
        nowIso,
        nowIso,
      );
      return { pollId, status: "overlap_skipped" };
    }
    const expiresAt = new Date(input.now.getTime() + 15 * 60_000).toISOString();
    input.store.database.prepare(`
      INSERT INTO publishing_feedback_poll_claims(owner, poll_id, claimed_at, expires_at)
      VALUES(?,?,?,?)
      ON CONFLICT(owner) DO UPDATE SET
        poll_id=excluded.poll_id, claimed_at=excluded.claimed_at, expires_at=excluded.expires_at
    `).run(OWNER, pollId, nowIso, expiresAt);
    input.store.database.prepare(`
      INSERT INTO publishing_feedback_poll_runs(
        id, owner, scheduled_for, status, summary_json, started_at, completed_at
      ) VALUES(?,?,?,?,?,?,NULL)
      ON CONFLICT(id) DO UPDATE SET status='running', summary_json='{}', completed_at=NULL
    `).run(pollId, OWNER, input.scheduledFor, "running", "{}", nowIso);
    return { pollId, status: "acquired" };
  });
}

function opportunityFor(
  integration: ProductionIntegration,
  publication: FeedbackPublicationEvidence,
): ProductionOpportunity | undefined {
  return integration.opportunities.find(
    (candidate) =>
      candidate.enabled &&
      candidate.platformId === publication.platformId &&
      (candidate.connectorAccountKey === publication.accountId ||
        candidate.accountId === publication.accountId ||
        candidate.accountId === "tailwaggingwebdesigns"),
  );
}

function insertPublication(
  store: PublishingStore,
  publication: FeedbackPublicationEvidence,
  nowIso: string,
): { id: string; inserted: boolean } {
  const id = stableId("feedback-publication", {
    platformId: publication.platformId,
    accountId: publication.accountId,
    providerObjectId: publication.providerObjectId,
  });
  const existing = store.database.prepare(`
    SELECT id FROM publishing_feedback_publications WHERE id=?
  `).get(id);
  const result = store.database.prepare(`
    INSERT INTO publishing_feedback_publications(
      id, campaign_id, candidate_id, platform_id, account_id, provider_object_id,
      graph_run_id, graph_effect_id, slot_id, permalink, state, evidence_json,
      observed_at, verified_at, created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      state=CASE
        WHEN publishing_feedback_publications.state='verified' THEN 'verified'
        ELSE excluded.state
      END,
      permalink=COALESCE(excluded.permalink, publishing_feedback_publications.permalink),
      evidence_json=excluded.evidence_json,
      observed_at=excluded.observed_at,
      verified_at=COALESCE(publishing_feedback_publications.verified_at, excluded.verified_at)
  `).run(
    id,
    publication.campaignId,
    publication.candidateId,
    publication.platformId,
    publication.accountId,
    publication.providerObjectId,
    publication.graphRunId,
    publication.graphEffectId,
    publication.slotId,
    publication.permalink,
    publication.state,
    canonicalJson({
      source: "graph-external-effect",
      graphId: publication.graphId,
      graphVersion: publication.graphVersion,
      graphRunId: publication.graphRunId,
      graphEffectId: publication.graphEffectId,
      evidenceRefs: publication.evidenceRefs,
    }),
    publication.observedAt,
    publication.state === "verified" ? publication.observedAt : null,
    nowIso,
  );
  void result;
  return { id, inserted: !existing };
}

function insertMetric(input: {
  store: PublishingStore;
  publicationId: string;
  metricDefinitionId: string;
  value: number | null;
  availability: "available" | "unavailable";
  evidence: Record<string, unknown>;
  observedAt: string;
  nowIso: string;
}): boolean {
  const fingerprint = {
    publicationId: input.publicationId,
    metricDefinitionId: input.metricDefinitionId,
    value: input.value,
    availability: input.availability,
  };
  const evidenceHash = sha256(canonicalJson(fingerprint));
  const result = input.store.database.prepare(`
    INSERT OR IGNORE INTO publishing_feedback_metric_observations(
      id, publication_id, metric_definition_id, value, availability, state,
      evidence_hash, evidence_json, observed_at, created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
  `).run(
    stableId("feedback-metric", { ...fingerprint, evidenceHash }),
    input.publicationId,
    input.metricDefinitionId,
    input.value,
    input.availability,
    input.availability === "available" ? "verified" : "observed",
    evidenceHash,
    canonicalJson(input.evidence),
    input.observedAt,
    input.nowIso,
  );
  return Number(result.changes) === 1;
}

function insertConversation(input: {
  store: PublishingStore;
  publicationId: string;
  publication: FeedbackPublicationEvidence;
  providerConversationId: string;
  text: string;
  evidence: Record<string, unknown>;
  observedAt: string;
}): { conversationInserted: boolean; observationInserted: boolean; edgeInserted: boolean } {
  const conversationId = stableId("feedback-conversation", {
    platformId: input.publication.platformId,
    accountId: input.publication.accountId,
    providerConversationId: input.providerConversationId,
  });
  const existing = input.store.database.prepare(`
    SELECT id FROM publishing_feedback_conversations WHERE id=?
  `).get(conversationId);
  input.store.database.prepare(`
    INSERT INTO publishing_feedback_conversations(
      id, publication_id, platform_id, account_id, provider_conversation_id,
      state, evidence_json, first_observed_at, last_observed_at
    ) VALUES(?,?,?,?,?,'attributed',?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      state='attributed', evidence_json=excluded.evidence_json,
      last_observed_at=excluded.last_observed_at
  `).run(
    conversationId,
    input.publicationId,
    input.publication.platformId,
    input.publication.accountId,
    input.providerConversationId,
    canonicalJson(input.evidence),
    input.observedAt,
    input.observedAt,
  );
  const evidenceHash = sha256(canonicalJson({
    providerConversationId: input.providerConversationId,
    text: input.text,
  }));
  const observation = input.store.database.prepare(`
    INSERT OR IGNORE INTO publishing_feedback_conversation_observations(
      id, conversation_id, state, evidence_hash, evidence_json, observed_at
    ) VALUES(?,?,'attributed',?,?,?)
  `).run(
    stableId("feedback-conversation-observation", { conversationId, evidenceHash }),
    conversationId,
    evidenceHash,
    canonicalJson(input.evidence),
    input.observedAt,
  );
  const edge = input.store.database.prepare(`
    INSERT OR IGNORE INTO publishing_feedback_attribution_edges(
      id, definition_id, publication_id, conversation_id, state, confidence,
      scope, business_outcome_status, evidence_json, created_at
    ) VALUES(?,?,?,?,'attributed','high','provider-engagement','unproven',?,?)
  `).run(
    stableId("feedback-attribution", {
      definitionId: EXACT_REPLY_ATTRIBUTION,
      publicationId: input.publicationId,
      conversationId,
    }),
    EXACT_REPLY_ATTRIBUTION,
    input.publicationId,
    conversationId,
    canonicalJson({
      source: "exact-provider-reply-chain",
      providerPublicationId: input.publication.providerObjectId,
      providerConversationId: input.providerConversationId,
      businessOutcomeEvidence: "absent",
    }),
    input.observedAt,
  );
  return {
    conversationInserted: !existing,
    observationInserted: Number(observation.changes) === 1,
    edgeInserted: Number(edge.changes) === 1,
  };
}

function reconcilePublication(
  store: PublishingStore,
  publicationId: string,
  at: string,
  connectorFailed = false,
): boolean {
  const conversationCount = Number((store.database.prepare(`
    SELECT COUNT(*) AS count FROM publishing_feedback_conversations WHERE publication_id=?
  `).get(publicationId) as { count: number }).count);
  const metricCount = Number((store.database.prepare(`
    SELECT COUNT(*) AS count FROM publishing_feedback_metric_observations WHERE publication_id=?
  `).get(publicationId) as { count: number }).count);
  const outcome = connectorFailed
    ? "provider_read_failed_business_outcome_unproven"
    : conversationCount > 0
      ? "exact_provider_conversation_attributed_business_outcome_unproven"
      : "verified_publication_no_exact_conversation_business_outcome_unproven";
  const state = connectorFailed ? "ambiguous" : conversationCount > 0 ? "reconciled" : "unattributed";
  const fingerprint = { publicationId, conversationCount, metricCount, outcome };
  const evidenceHash = sha256(canonicalJson(fingerprint));
  const result = store.database.prepare(`
    INSERT OR IGNORE INTO publishing_feedback_reconciliations(
      id, publication_id, state, outcome, evidence_hash, evidence_json, reconciled_at
    ) VALUES(?,?,?,?,?,?,?)
  `).run(
    stableId("feedback-reconciliation", { publicationId, evidenceHash }),
    publicationId,
    state,
    outcome,
    evidenceHash,
    canonicalJson({ ...fingerprint, attributedBusinessOutcomeCount: 0 }),
    at,
  );
  return Number(result.changes) === 1;
}

export async function runCampaignFeedbackCycle(input: {
  store: PublishingStore;
  registry: PublishingRegistryBundle;
  integration: ProductionIntegration;
  graphRunDatabasePath: string;
  graphSchedulerDatabasePath?: string;
  observedAt: Date;
  toolInvoker: ProductionToolInvoker;
  openclawBin?: string;
}): Promise<FeedbackSummary> {
  const scheduledFor = input.observedAt.toISOString();
  const claim = acquirePoll({ store: input.store, scheduledFor, now: input.observedAt });
  const summary: FeedbackSummary = {
    owner: OWNER,
    pollId: claim.pollId,
    status: claim.status === "acquired" ? "completed" : claim.status,
    importedPublications: 0,
    verifiedPublications: 0,
    officialMetricReads: 0,
    officialConversationReads: 0,
    metricObservationsInserted: 0,
    metricObservationsDeduplicated: 0,
    conversationsInserted: 0,
    conversationObservationsInserted: 0,
    attributionEdgesInserted: 0,
    reconciliationsInserted: 0,
    businessOutcomesVerified: 0,
    connectorFailures: [],
    externalWrites: 0,
    browserRelayCalls: 0,
  };
  if (claim.status !== "acquired") return summary;

  const nowIso = input.observedAt.toISOString();
  try {
    const publications = loadGraphPublicationEvidence({
      graphRunDatabasePath: input.graphRunDatabasePath,
      graphSchedulerDatabasePath: input.graphSchedulerDatabasePath,
    });
    for (const publication of publications) {
      const imported = insertPublication(input.store, publication, nowIso);
      if (imported.inserted) summary.importedPublications += 1;
      if (publication.state !== "verified") {
        const evidenceHash = sha256(canonicalJson({
          publicationId: imported.id,
          state: publication.state,
          outcome: "provider_publication_not_verified",
        }));
        const result = input.store.database.prepare(`
          INSERT OR IGNORE INTO publishing_feedback_reconciliations(
            id, publication_id, state, outcome, evidence_hash, evidence_json, reconciled_at
          ) VALUES(?,?,'ambiguous','provider_publication_not_verified',?,?,?)
        `).run(
          stableId("feedback-reconciliation", { publicationId: imported.id, evidenceHash }),
          imported.id,
          evidenceHash,
          canonicalJson({ businessOutcomeEvidence: "unproven" }),
          nowIso,
        );
        summary.reconciliationsInserted += Number(result.changes);
        continue;
      }
      summary.verifiedPublications += 1;
      const opportunity = opportunityFor(input.integration, publication);
      const policy = input.registry.platformPolicies.find(
        (candidate) =>
          candidate.status === "active" && candidate.platformId === publication.platformId,
      );
      if (!opportunity || !policy) {
        summary.connectorFailures.push({
          publicationId: imported.id,
          error: "official-provider-route-missing",
        });
        continue;
      }
      const worker = new OpenClawOfficialApiWorkerClient({
        connectorId: policy.connectorId,
        integration: input.integration,
        opportunity,
        scheduledFor: input.observedAt,
        mode: "shadow",
        allowProviderWrite: false,
        invoker: input.toolInvoker,
        openclawBin: input.openclawBin,
      });
      let connectorFailed = false;
      try {
        summary.officialMetricReads += publication.platformId === "threads" ? 1 : 0;
        const metrics = await worker.fetchMetrics(publication.providerObjectId);
        for (const metric of metrics) {
          const inserted = insertMetric({
            store: input.store,
            publicationId: imported.id,
            metricDefinitionId: metric.metricDefinitionId,
            value: metric.value,
            availability: metric.availability,
            evidence: metric.evidence,
            observedAt: nowIso,
            nowIso,
          });
          if (inserted) summary.metricObservationsInserted += 1;
          else summary.metricObservationsDeduplicated += 1;
        }
        summary.officialConversationReads += 1;
        const conversations = await worker.fetchConversations(publication.providerObjectId);
        for (const conversation of conversations) {
          const inserted = insertConversation({
            store: input.store,
            publicationId: imported.id,
            publication,
            ...conversation,
          });
          summary.conversationsInserted += inserted.conversationInserted ? 1 : 0;
          summary.conversationObservationsInserted += inserted.observationInserted ? 1 : 0;
          summary.attributionEdgesInserted += inserted.edgeInserted ? 1 : 0;
        }
      } catch (error) {
        connectorFailed = true;
        summary.connectorFailures.push({
          publicationId: imported.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (reconcilePublication(input.store, imported.id, nowIso, connectorFailed)) {
        summary.reconciliationsInserted += 1;
      }
    }
    input.store.database.prepare(`
      UPDATE publishing_feedback_poll_runs
      SET status='completed', summary_json=?, completed_at=? WHERE id=?
    `).run(canonicalJson(summary), nowIso, claim.pollId);
    return summary;
  } catch (error) {
    input.store.database.prepare(`
      UPDATE publishing_feedback_poll_runs
      SET status='failed', summary_json=?, completed_at=? WHERE id=?
    `).run(canonicalJson({ error: error instanceof Error ? error.message : String(error) }), nowIso, claim.pollId);
    throw error;
  } finally {
    input.store.database.prepare(`
      DELETE FROM publishing_feedback_poll_claims WHERE owner=? AND poll_id=?
    `).run(OWNER, claim.pollId);
  }
}
