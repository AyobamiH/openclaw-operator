import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { runCampaignOperationsCycle } from "../src/publishing/campaign-operations.js";
import { PublishingStore } from "../src/publishing/store.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const roots: string[] = [];
const REGISTRY_PATH = fileURLToPath(new URL("../../config/publishing/registry.v1.json", import.meta.url));
const INTEGRATION_PATH = fileURLToPath(new URL("../../config/publishing/production-integration.v1.json", import.meta.url));

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function createGraphFixture(root: string, state = "effect_verified"): {
  graphRunDatabasePath: string;
  graphSchedulerDatabasePath: string;
} {
  const graphRunDatabasePath = join(root, "graph-runs.sqlite");
  const graph = new DatabaseSync(graphRunDatabasePath);
  graph.exec(`
    CREATE TABLE graph_one_run_live_capabilities(
      graph_run_id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      graph_version TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      account_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      operation_type TEXT NOT NULL
    );
    CREATE TABLE graph_external_effects(
      effect_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      state TEXT NOT NULL,
      provider_operation_id TEXT,
      last_observed_at TEXT,
      evidence_refs_json TEXT NOT NULL
    );
    INSERT INTO graph_one_run_live_capabilities VALUES(
      'graph-run-1','threads-daily-image','1.0.0','campaign-live-1',
      'threads:candidate:campaign-live-1','threads','threads:owner',
      'threads:2026-08-11:09:00:campaign-live-1','publish'
    );
    INSERT INTO graph_external_effects VALUES(
      'graph-effect-1','graph-run-1','${state}','provider-thread-1',
      '2026-08-11T08:05:00.000Z','["graph-effect-proof"]'
    );
  `);
  graph.close();

  const graphSchedulerDatabasePath = join(root, "graph-scheduler.sqlite");
  const scheduler = new DatabaseSync(graphSchedulerDatabasePath);
  scheduler.exec(`
    CREATE TABLE graph_scheduler_triggers(
      graph_run_id TEXT,
      permalink TEXT
    );
    INSERT INTO graph_scheduler_triggers VALUES(
      'graph-run-1','https://www.threads.com/@tailwaggingwebdesigns/post/provider-thread-1'
    );
  `);
  scheduler.close();
  return { graphRunDatabasePath, graphSchedulerDatabasePath };
}

describe("campaign feedback", () => {
  it("deduplicates repeated metric reads, appends provider corrections, and reconciles a late exact conversation", async () => {
    const root = await mkdtemp(join(tmpdir(), "campaign-feedback-"));
    roots.push(root);
    const databasePath = join(root, "publishing.sqlite");
    const artifactRoot = join(root, "artifacts");
    await mkdir(artifactRoot, { recursive: true });
    const graphPaths = createGraphFixture(root);
    let views = 10;
    let replies: Array<Record<string, unknown>> = [];
    const invocations: Array<Record<string, unknown>> = [];
    const toolInvoker = async (invocation: { tool: string; args: Record<string, unknown> }) => {
      invocations.push(invocation.args);
      expect(invocation.args.relayAvailable).toBe(false);
      if (invocation.args.surface === "post_insights") {
        return {
          metrics: [
            { name: "views", value: views },
            { name: "likes", value: 0 },
            { name: "replies", value: replies.length },
            { name: "reposts", value: 0 },
            { name: "quotes", value: 0 },
            { name: "shares", value: 0 },
          ],
        };
      }
      expect(invocation.args.surface).toBe("post_replies");
      expect(invocation.args.targetId).toBe("provider-thread-1");
      return { records: replies };
    };
    const base = {
      registryPath: REGISTRY_PATH,
      integrationPath: INTEGRATION_PATH,
      databasePath,
      artifactRoot,
      toolInvoker,
      ...graphPaths,
    };

    const first = await runCampaignOperationsCycle({
      ...base,
      observedAt: new Date("2026-08-11T09:00:00.000Z"),
    });
    expect(first.feedback).toMatchObject({
      status: "completed",
      verifiedPublications: 1,
      metricObservationsInserted: 2,
      conversationsInserted: 0,
      businessOutcomesVerified: 0,
      externalWrites: 0,
      browserRelayCalls: 0,
    });
    const callCountAfterFirst = invocations.length;
    const duplicate = await runCampaignOperationsCycle({
      ...base,
      observedAt: new Date("2026-08-11T09:00:00.000Z"),
    });
    expect(duplicate.feedback).toMatchObject({ status: "duplicate_completed" });
    expect(invocations).toHaveLength(callCountAfterFirst);

    const repeated = await runCampaignOperationsCycle({
      ...base,
      observedAt: new Date("2026-08-11T10:00:00.000Z"),
    });
    expect(repeated.feedback).toMatchObject({
      metricObservationsInserted: 0,
      metricObservationsDeduplicated: 2,
    });

    views = 12;
    const corrected = await runCampaignOperationsCycle({
      ...base,
      observedAt: new Date("2026-08-11T11:00:00.000Z"),
    });
    expect(corrected.feedback).toMatchObject({
      metricObservationsInserted: 1,
      metricObservationsDeduplicated: 1,
    });

    replies = [{
      id: "provider-reply-1",
      text: "Can you help with a website?",
      timestamp: "2026-08-11T11:30:00.000Z",
    }];
    const late = await runCampaignOperationsCycle({
      ...base,
      observedAt: new Date("2026-08-11T12:00:00.000Z"),
    });
    expect(late.feedback).toMatchObject({
      conversationsInserted: 1,
      conversationObservationsInserted: 1,
      attributionEdgesInserted: 1,
      businessOutcomesVerified: 0,
    });

    const store = new PublishingStore(databasePath);
    expect(store.counts()).toMatchObject({
      publishing_feedback_publications: 1,
      publishing_feedback_metric_observations: 4,
      publishing_feedback_conversations: 1,
      publishing_feedback_conversation_observations: 1,
      publishing_feedback_attribution_edges: 1,
    });
    const edge = store.database.prepare(`
      SELECT state, confidence, scope, business_outcome_status
      FROM publishing_feedback_attribution_edges
    `).get();
    expect(edge).toEqual({
      state: "attributed",
      confidence: "high",
      scope: "provider-engagement",
      business_outcome_status: "unproven",
    });
    const outcomes = store.database.prepare(`
      SELECT DISTINCT outcome FROM publishing_feedback_reconciliations ORDER BY outcome
    `).all() as Array<{ outcome: string }>;
    expect(outcomes.map((row) => row.outcome)).toEqual([
      "exact_provider_conversation_attributed_business_outcome_unproven",
      "verified_publication_no_exact_conversation_business_outcome_unproven",
    ]);
    store.close();
  });

  it("keeps an ambiguous provider effect unpolled and business evidence unproven", async () => {
    const root = await mkdtemp(join(tmpdir(), "campaign-feedback-ambiguous-"));
    roots.push(root);
    const graphPaths = createGraphFixture(root, "ambiguous");
    const result = await runCampaignOperationsCycle({
      registryPath: REGISTRY_PATH,
      integrationPath: INTEGRATION_PATH,
      databasePath: join(root, "publishing.sqlite"),
      artifactRoot: join(root, "artifacts"),
      observedAt: new Date("2026-08-11T09:00:00.000Z"),
      ...graphPaths,
      toolInvoker: async () => {
        throw new Error("ambiguous publication must not be polled");
      },
    });
    expect(result.feedback).toMatchObject({
      verifiedPublications: 0,
      officialMetricReads: 0,
      officialConversationReads: 0,
      reconciliationsInserted: 1,
      businessOutcomesVerified: 0,
      externalWrites: 0,
    });
  });

  it("skips an overlapping poll while the authoritative owner holds its SQLite claim", async () => {
    const root = await mkdtemp(join(tmpdir(), "campaign-feedback-overlap-"));
    roots.push(root);
    const graphPaths = createGraphFixture(root);
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const common = {
      registryPath: REGISTRY_PATH,
      integrationPath: INTEGRATION_PATH,
      databasePath: join(root, "publishing.sqlite"),
      artifactRoot: join(root, "artifacts"),
      ...graphPaths,
      toolInvoker: async (invocation: { args: Record<string, unknown> }) => {
        if (invocation.args.surface === "post_insights") {
          markFirstStarted();
          await release;
          return {
            metrics: [
              { name: "views", value: 1 },
              { name: "likes", value: 0 },
              { name: "replies", value: 0 },
              { name: "reposts", value: 0 },
              { name: "quotes", value: 0 },
              { name: "shares", value: 0 },
            ],
          };
        }
        return { records: [] };
      },
    };
    const first = runCampaignOperationsCycle({
      ...common,
      observedAt: new Date("2026-08-11T09:00:00.000Z"),
    });
    await firstStarted;
    const overlap = await runCampaignOperationsCycle({
      ...common,
      observedAt: new Date("2026-08-11T09:01:00.000Z"),
    });
    expect(overlap.feedback).toMatchObject({
      status: "overlap_skipped",
      officialMetricReads: 0,
      officialConversationReads: 0,
      externalWrites: 0,
    });
    releaseFirst();
    await expect(first).resolves.toMatchObject({
      feedback: { status: "completed", externalWrites: 0 },
    });
  });
});
