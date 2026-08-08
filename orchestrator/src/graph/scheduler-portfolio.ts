import { sha256 } from "./reducer.js";
import type { AuthorityClass, JsonValue } from "./types.js";
import {
  PHASE_G_ACCOUNT_ID,
  PHASE_G_DECLARATION_KEY,
  PHASE_G_MIGRATION_ID,
  PHASE_G_SCHEDULE_ID,
  type GraphSchedulerMigrationDeclaration,
} from "./scheduler-store.js";
import { digestDeliveryGraph, governedTaskExecutionGraph, liveCapableSocialPublicationGraph, metaReplyMonitorGraph, threadsPublicationGraph, threadsReadinessGraph } from "./workflows.js";

export type SchedulerApprovalPolicy = "none" | "prepared_payload_only" | "standing_exact";

export type GovernedSchedulerPortfolioEntry = {
  declaration: GraphSchedulerMigrationDeclaration;
  input: Record<string, JsonValue>;
  authority: { maximum: AuthorityClass; grantedBy: string };
  approvalPolicy: SchedulerApprovalPolicy;
  maximumExternalWrites: 0 | 1;
  latenessToleranceMinutes: number;
  graphJobEnabled?: boolean;
  commandTimeoutSeconds?: number;
  commandNoOutputTimeoutSeconds?: number;
};

const WORKSPACE = "/home/oneclickwebsitedesignfactory/.openclaw/workspace";
const FACTORY_RUNTIME = "/home/oneclickwebsitedesignfactory/.openclaw/runtime/deterministic-self-identification-publishing-engine/20260808-full-pregraph-v2";
const definitions = {
  "threads-readiness@1.0.0": threadsReadinessGraph(),
  "threads-publication@1.0.0": threadsPublicationGraph(),
  "meta-reply-monitor@1.0.0": metaReplyMonitorGraph(),
  "governed-task-execution@1.0.0": governedTaskExecutionGraph(),
  "digest-delivery@1.0.0": digestDeliveryGraph(),
  "deterministic-social-publication@2.0.0": liveCapableSocialPublicationGraph(),
};

function entry(args: {
  migrationId: string; scheduleId: string; declarationKey: string; graphIdentity: keyof typeof definitions;
  namespace: string; provider: string; accountId: string; cronExpression: string; input: Record<string, JsonValue>;
  authority: AuthorityClass; approvalPolicy?: SchedulerApprovalPolicy; maximumExternalWrites?: 0 | 1; latenessToleranceMinutes?: number;
  graphJobEnabled?: boolean; commandTimeoutSeconds?: number; commandNoOutputTimeoutSeconds?: number;
}): GovernedSchedulerPortfolioEntry {
  const [graphId, graphVersion] = args.graphIdentity.split("@");
  return {
    declaration: {
      migrationId: args.migrationId, scheduleId: args.scheduleId, declarationKey: args.declarationKey,
      graphId: graphId!, graphVersion: graphVersion!, graphDefinitionHash: sha256(definitions[args.graphIdentity]),
      graphNamespace: args.namespace, provider: args.provider, accountId: args.accountId,
      cronExpression: args.cronExpression, timezone: "Europe/London",
    },
    input: args.input,
    authority: { maximum: args.authority, grantedBy: `graph-scheduler-migration:${args.migrationId}` },
    approvalPolicy: args.approvalPolicy ?? "none",
    maximumExternalWrites: args.maximumExternalWrites ?? 0,
    latenessToleranceMinutes: args.latenessToleranceMinutes ?? 10,
    graphJobEnabled: args.graphJobEnabled,
    commandTimeoutSeconds: args.commandTimeoutSeconds,
    commandNoOutputTimeoutSeconds: args.commandNoOutputTimeoutSeconds,
  };
}

const portfolio = [
  entry({ migrationId: PHASE_G_MIGRATION_ID, scheduleId: PHASE_G_SCHEDULE_ID, declarationKey: PHASE_G_DECLARATION_KEY, graphIdentity: "deterministic-social-publication@2.0.0", namespace: "production.instagram.single-image-feed", provider: "instagram", accountId: PHASE_G_ACCOUNT_ID, cronExpression: "0 5,7,9,11,13 * * *", authority: "external_public", approvalPolicy: "prepared_payload_only", maximumExternalWrites: 1, latenessToleranceMinutes: 10, graphJobEnabled: true, input: { provider: "instagram", accountKey: "instagram:owner", expectedAccountId: PHASE_G_ACCOUNT_ID, jobId: PHASE_G_SCHEDULE_ID, kind: "image", observedAt: "$scheduledAt", shadowMode: false, maximumProviderMutations: 1 } }),
  entry({ migrationId: "threads-readiness-v1", scheduleId: "abb3e214-0ff6-4813-a18d-6d8ffb9080ad", declarationKey: "threads-publication-readiness-preparer-v1", graphIdentity: "threads-readiness@1.0.0", namespace: "production.threads.readiness", provider: "threads", accountId: "threads:owner", cronExpression: "*/30 * * * *", authority: "local_persistent", input: { provider: "threads", accountKey: "threads:owner", jobId: "abb3e214-0ff6-4813-a18d-6d8ffb9080ad", observedAt: "$scheduledAt", shadowMode: true, maximumProviderMutations: 0 } }),
  entry({ migrationId: "threads-early-text-v1", scheduleId: "68b10c5c-f604-4567-9213-d0d1eab08106", declarationKey: "threads-confirmed-topic-tags-early-text-rotation-v1", graphIdentity: "threads-publication@1.0.0", namespace: "production.threads.early-text", provider: "threads", accountId: "threads:owner", cronExpression: "0 5,7 * * *", authority: "external_public", approvalPolicy: "prepared_payload_only", maximumExternalWrites: 1, input: { provider: "threads", accountKey: "threads:owner", jobId: "68b10c5c-f604-4567-9213-d0d1eab08106", observedAt: "$scheduledAt", shadowMode: false, maximumProviderMutations: 1 } }),
  entry({ migrationId: "threads-daily-image-v1", scheduleId: "083e3560-40fd-4487-9d78-674f64866ef7", declarationKey: "threads-confirmed-topic-tags-daily-image-rotation-v1", graphIdentity: "threads-publication@1.0.0", namespace: "production.threads.daily-image", provider: "threads", accountId: "threads:owner", cronExpression: "30 11,16,21 * * *", authority: "external_public", approvalPolicy: "prepared_payload_only", maximumExternalWrites: 1, input: { provider: "threads", accountKey: "threads:owner", jobId: "083e3560-40fd-4487-9d78-674f64866ef7", observedAt: "$scheduledAt", shadowMode: false, maximumProviderMutations: 1 } }),
  entry({ migrationId: "meta-reply-monitor-v1", scheduleId: "4de811aa-f213-4cc3-b1aa-6c2cffb6a847", declarationKey: "meta-api-reply-monitor-hourly-v1", graphIdentity: "meta-reply-monitor@1.0.0", namespace: "production.meta.reply-monitor", provider: "meta", accountId: "meta:owner", cronExpression: "15 * * * *", authority: "external_public", approvalPolicy: "standing_exact", maximumExternalWrites: 1, latenessToleranceMinutes: 20, input: { provider: "meta", accountKey: "meta:owner", jobId: "4de811aa-f213-4cc3-b1aa-6c2cffb6a847", observedAt: "$scheduledAt", shadowMode: false, maximumProviderMutations: 1 } }),
  entry({ migrationId: "campaign-content-factory-shadow-v1", scheduleId: "6fd37958-b450-400e-8c06-a781670f3a03", declarationKey: "deterministic-self-identification-shadow-v1", graphIdentity: "governed-task-execution@1.0.0", namespace: "production.campaign-factory.shadow", provider: "local", accountId: "campaign-factory", cronExpression: "0 5,7,11,15,17 * * *", authority: "local_persistent", input: { lane: "campaign-factory", taskType: "campaign-content-factory", agentId: "content-agent", ingressId: "$slotId", shadowMode: false, payload: { registryPath: `${FACTORY_RUNTIME}/config/publishing/registry.v1.json`, integrationPath: `${FACTORY_RUNTIME}/config/publishing/production-integration.v1.json`, databasePath: "/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/database/deterministic-publishing.sqlite", artifactRoot: `${WORKSPACE}/artifacts/business-value/marketing`, rendererEntrypoint: `${FACTORY_RUNTIME}/renderer/bin/local-media-renderer.mjs`, opportunityId: "auto", observedAt: "$scheduledAt", nodeExecutable: "/home/oneclickwebsitedesignfactory/.nvm/versions/node/v24.18.0/bin/node", openclawBin: "/home/oneclickwebsitedesignfactory/.nvm/versions/node/v24.18.0/bin/openclaw", workspace: WORKSPACE } } }),
  entry({ migrationId: "continuous-marketing-digest-v1", scheduleId: "25a7ffd8-d777-4dc5-a49a-76a229a5113a", declarationKey: "continuous-marketing-end-of-day-digest-v1", graphIdentity: "digest-delivery@1.0.0", namespace: "production.business-value.daily-digest", provider: "telegram", accountId: "configured-notification-channel", cronExpression: "30 8 * * *", authority: "external_reversible", approvalPolicy: "standing_exact", maximumExternalWrites: 1, input: { lane: "digest", taskType: "send-digest", agentId: "operations-analyst-agent", ingressId: "$slotId", shadowMode: false, payload: { mode: "continuous-marketing", observedAt: "$scheduledAt", sourceRoot: `${WORKSPACE}/artifacts/business-value/marketing`, missionPath: `${WORKSPACE}/artifacts/system/operator/continuous-marketing-mission-2026-07-18.md`, outputRoot: `${WORKSPACE}/artifacts/business-value/marketing` } } }),
  entry({ migrationId: "instagram-reel-v1", scheduleId: "2c7071ff-35dd-40d0-bf77-b1ed53de256e", declarationKey: "instagram-reel-video-daily-v1", graphIdentity: "deterministic-social-publication@2.0.0", namespace: "production.instagram.reel", provider: "instagram", accountId: "17841453638630920", cronExpression: "0 15,17,19,21,23 * * *", authority: "external_public", approvalPolicy: "prepared_payload_only", maximumExternalWrites: 1, latenessToleranceMinutes: 10, graphJobEnabled: true, commandTimeoutSeconds: 2_400, commandNoOutputTimeoutSeconds: 1_800, input: { provider: "instagram", accountKey: "instagram:owner", expectedAccountId: "17841453638630920", jobId: "2c7071ff-35dd-40d0-bf77-b1ed53de256e", kind: "reel", observedAt: "$scheduledAt", shadowMode: false, maximumProviderMutations: 1 } }),
] as const;

export const GOVERNED_SCHEDULER_PORTFOLIO: ReadonlyMap<string, GovernedSchedulerPortfolioEntry> = new Map(portfolio.map((item) => [item.declaration.migrationId, item]));

export function governedSchedulerPortfolioEntry(migrationId: string): GovernedSchedulerPortfolioEntry {
  const value = GOVERNED_SCHEDULER_PORTFOLIO.get(migrationId);
  if (!value) throw new Error(`graph_scheduler_portfolio_migration_not_allowed:${migrationId}`);
  return structuredClone(value);
}

export function buildGovernedGraphJob(legacyJob: Record<string, unknown>, migrationId: string, triggerScriptPath: string, nodeExecutable = process.execPath): Record<string, unknown> {
  const value = governedSchedulerPortfolioEntry(migrationId);
  if (legacyJob.id !== value.declaration.scheduleId || legacyJob.declarationKey !== value.declaration.declarationKey) throw new Error("graph_scheduler_portfolio_legacy_binding_mismatch");
  return {
    ...structuredClone(legacyJob),
    enabled: value.graphJobEnabled ?? legacyJob.enabled,
    payload: {
      kind: "command",
      argv: [nodeExecutable, "--import", "tsx", triggerScriptPath, "--migration-id", migrationId],
      cwd: triggerScriptPath.replace(/\/orchestrator\/scripts\/[^/]+$/, "/orchestrator"),
      noOutputTimeoutSeconds: value.commandNoOutputTimeoutSeconds ?? 900,
      outputMaxBytes: 20000,
      timeoutSeconds: value.commandTimeoutSeconds ?? 1200,
    },
    graphTrigger: { graphId: value.declaration.graphId, graphVersion: value.declaration.graphVersion, definitionHash: value.declaration.graphDefinitionHash, input: value.input, authority: value.authority, approvalPolicy: value.approvalPolicy, maximumExternalWrites: value.maximumExternalWrites, latenessToleranceMinutes: value.latenessToleranceMinutes },
  };
}
