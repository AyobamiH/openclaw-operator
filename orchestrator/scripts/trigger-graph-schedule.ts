import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readApiCredentialReference } from "../src/auth/credential-reference.js";
import { frozenEnvelopeHash } from "../src/graph/live-publication.js";
import { sha256 as canonicalSha256 } from "../src/graph/reducer.js";
import {
  GraphSchedulerStore,
  PHASE_G_ACCOUNT_ID,
  PHASE_G_GRAPH_DEFINITION_HASH,
  PHASE_G_GRAPH_ID,
  PHASE_G_GRAPH_VERSION,
  PHASE_G_MIGRATION_ID,
  PHASE_G_PROVIDER,
} from "../src/graph/scheduler-store.js";

const baseUrl = "http://127.0.0.1:3312";
const credentialFile = "/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/credentials/orchestrator.env";
const evidenceRoot = "/home/oneclickwebsitedesignfactory/.openclaw/state/activation/graph-phase-g-instagram-image-20260802/triggers";
const schedulerDatabasePath = "/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/database/graph-scheduler.sqlite";
const defaultInstagramOutboxPath = "/home/oneclickwebsitedesignfactory/.openclaw/state/business-operations/social-outboxes/instagram-publisher-outbox.json";

type HttpRequest = (route: string, init?: RequestInit) => Promise<any>;

async function request(route: string, init?: RequestInit): Promise<any> {
  const token = readApiCredentialReference(credentialFile, { requiredRole: "admin" });
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  let body: any = null;
  try { body = await response.json(); } catch { /* HTTP status remains authoritative */ }
  if (!response.ok) throw new Error(`graph_scheduler_http_${response.status}:${body?.error ?? "unknown"}`);
  return body;
}

function localParts(date: Date): { date: string; hour: number; minute: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

function resolveNaturalSlot(now: Date): { slotId: string; scheduledFor: string } {
  const local = localParts(now);
  if (![5, 7, 9, 11, 13].includes(local.hour) || local.minute > 10) throw new Error("graph_scheduler_trigger_outside_natural_slot_window");
  const scheduledFor = new Date(now);
  scheduledFor.setSeconds(0, 0);
  scheduledFor.setMinutes(scheduledFor.getMinutes() - local.minute);
  return { slotId: `instagram:${local.date}:${String(local.hour).padStart(2, "0")}:00:24afbb84-457c-41bb-92c9-24a19725e984`, scheduledFor: scheduledFor.toISOString() };
}

function inspect(detail: any): any {
  const run = detail?.run;
  const live = run?.data?.publicationLive;
  const envelope = live?.envelope;
  if (!run || !envelope) throw new Error("graph_scheduler_frozen_envelope_missing");
  if (run.graphId !== PHASE_G_GRAPH_ID || run.graphVersion !== PHASE_G_GRAPH_VERSION || envelope.definitionHash !== PHASE_G_GRAPH_DEFINITION_HASH) throw new Error("graph_scheduler_graph_binding_mismatch");
  const envelopeHash = frozenEnvelopeHash(envelope);
  if (live.envelopeHash !== envelopeHash) throw new Error("graph_scheduler_envelope_hash_mismatch");
  const payloadHash = createHash("sha256").update(envelope.canonicalPayload.caption).digest("hex");
  const media = readFileSync(envelope.mediaPath);
  const mediaHash = createHash("sha256").update(media).digest("hex");
  if (payloadHash !== envelope.payloadSha256 || mediaHash !== envelope.mediaSha256 || media.byteLength !== envelope.mediaSizeBytes) throw new Error("graph_scheduler_frozen_bytes_mismatch");
  const layoutVerificationHash = envelope.layoutVerification
    ? canonicalSha256(envelope.layoutVerification)
    : null;
  if (
    envelope.publicationType === "FEED" &&
    (envelope.layoutVerification?.status !== "passed" ||
      envelope.layoutVerification?.semanticCompleteness !== true ||
      envelope.layoutVerification?.boundingBoxesValid !== true ||
      envelope.layoutVerification?.sourceTextSha256 !== envelope.layoutVerification?.renderedTextSha256 ||
      envelope.layoutVerification?.finalMediaSha256 !== mediaHash ||
      layoutVerificationHash !== envelope.layoutVerificationSha256)
  ) throw new Error("graph_scheduler_layout_verification_mismatch");
  if (envelope.provider !== PHASE_G_PROVIDER || envelope.accountId !== PHASE_G_ACCOUNT_ID || envelope.slotId !== resolveNaturalSlot(new Date(envelope.europeLondonTimestamp)).slotId) throw new Error("graph_scheduler_provider_or_slot_binding_mismatch");
  const approval = detail.approvals?.find((item: any) => item.approvalId === envelope.approvalId);
  return { run, live, envelope, approval, capability: detail.liveCapability, effects: detail.externalEffects ?? [], eventChainValid: detail.eventChainValid === true, envelopeHash, payloadHash, mediaHash };
}

function verifiedEffects(detail: any): any[] {
  return (detail?.externalEffects ?? []).filter((item: any) => item.state === "effect_verified");
}

function hasUnsafeEffect(detail: any): boolean {
  return detail?.liveCapability?.status === "consumed" || (detail?.externalEffects ?? []).some((item: any) => ["request_sent", "provider_accepted", "ambiguous", "effect_observed", "effect_verified"].includes(item.state));
}

function hasCompleteFrozenEnvelope(detail: any): boolean {
  const envelope = detail?.run?.data?.publicationLive?.envelope;
  return Boolean(
    envelope &&
      typeof envelope === "object" &&
      envelope.definitionHash &&
      envelope.provider &&
      envelope.accountId &&
      envelope.mediaPath &&
      envelope.canonicalPayload,
  );
}

function parseJsonFile(path: string): any | null {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function phaseGOutboxIds(slotId: string): string[] {
  const parts = slotId.split(":");
  if (parts.length < 5 || parts[0] !== "instagram") return [slotId];
  const date = parts[1];
  const slot = `${parts[2]}:${parts[3]}`;
  const jobId = parts.slice(4).join(":");
  return [`instagram:image:${date}:${slot}:${jobId}`, slotId];
}

function refinePreEnvelopeReason(rawReason: string, trigger: Record<string, unknown> | null, outboxPath: string): string {
  if (!trigger?.slotId) return rawReason;
  const outbox = parseJsonFile(outboxPath);
  const ids = new Set(phaseGOutboxIds(String(trigger.slotId)));
  const entry = Array.isArray(outbox?.items) ? outbox.items.find((item: any) => ids.has(String(item?.id))) : null;
  if (!entry || String(entry.status ?? "") !== "blocked") return rawReason;
  const providerWrites = Number(entry.generatedMediaUploadCalls ?? 0) + Number(entry.instagramPublishCalls ?? 0);
  if (providerWrites !== 0 || Number(entry.browserRelayCalls ?? 0) !== 0) return rawReason;
  return String(entry.reason ?? entry.executionFailure?.rootCause ?? rawReason);
}

function failedSafeReport(args: { detail: any; trigger: Record<string, unknown>; migrationId: string; graph: string; definitionHash: string; failureReason: string; recoveryResult: string }): Record<string, unknown> {
  const effects = verifiedEffects(args.detail);
  return {
    outcome: "completion_contract_failed",
    migrationId: args.migrationId,
    graph: args.graph,
    definitionHash: args.definitionHash,
    trigger: args.trigger,
    providerWrites: effects.length,
    browserRelayCalls: 0,
    publicationReport: {
      graphExecutionOutcome: "completion_contract_failed",
      schedulerCompletionContractStatus: "terminal",
      publicationOutcome: effects.length > 0 ? "published" : "failed",
      policyOrSkipReason: args.failureReason,
      candidateId: null,
      targetId: args.detail?.run?.data?.target ?? null,
      providerWrites: effects.length,
      providerPostId: effects[0]?.providerOperationId ?? null,
      providerPostUrl: args.detail?.run?.data?.publicationLive?.result?.permalink ?? null,
      verifierResult: args.detail?.eventChainValid === true ? "chain_valid_no_child_verifier" : "verifier_not_available",
      recoveryRequired: true,
      recoveryResult: args.recoveryResult,
      finalClassification: "failed",
    },
  };
}

async function createPhaseGRun(args: { request: HttpRequest; slot: { slotId: string; scheduledFor: string }; triggerId: string; migration: { scheduleId: string }; correlationId?: string }): Promise<{ runId: string; detail: any }> {
  const created = await args.request("/api/graphs/runs", { method: "POST", body: JSON.stringify({
    graphId: PHASE_G_GRAPH_ID,
    version: PHASE_G_GRAPH_VERSION,
    objective: `Graph-owned recurring Instagram image publication ${args.slot.slotId}`,
    correlationId: args.correlationId ?? args.triggerId,
    input: { provider: PHASE_G_PROVIDER, accountKey: "instagram:owner", expectedAccountId: PHASE_G_ACCOUNT_ID, jobId: args.migration.scheduleId, kind: "image", observedAt: args.slot.scheduledFor, shadowMode: false, maximumProviderMutations: 1 },
    authority: { maximum: "external_public", grantedBy: `graph-scheduler-migration:${PHASE_G_MIGRATION_ID}` },
  }) });
  const runId = String(created.run.runId);
  return { runId, detail: await args.request(`/api/graphs/runs/${runId}`) };
}

function classifyMissingEnvelope(args: { store: GraphSchedulerStore; triggerId: string; migrationId: string; detail: any; actor: string; graphRunId?: string; instagramOutboxPath: string }): Record<string, unknown> | null {
  const run = args.detail?.run;
  const live = run?.data?.publicationLive;
  if (run && hasCompleteFrozenEnvelope(args.detail)) return null;
  const trigger = args.store.trigger(args.triggerId);
  const rawReason = run?.lastError?.message ?? args.detail?.run?.lastError?.message ?? "graph_scheduler_frozen_envelope_missing";
  const reason = refinePreEnvelopeReason(rawReason, trigger as unknown as Record<string, unknown> | null, args.instagramOutboxPath);
  const ambiguous = hasUnsafeEffect(args.detail);
  const updated = args.store.updateTrigger(args.triggerId, ambiguous ? "ambiguous" : "failed_safe", args.actor, {
    graphRunId: args.graphRunId,
    capabilityId: args.detail?.liveCapability?.capabilityId,
    failureReason: JSON.stringify({
      type: "graph_scheduler_pre_envelope_terminal",
      runStatus: run?.status ?? "missing",
      runId: args.graphRunId ?? null,
      reason,
      recoverySafe: !ambiguous,
      effectCount: verifiedEffects(args.detail).length,
    }),
  });
  return failedSafeReport({
    detail: args.detail,
    trigger: updated as unknown as Record<string, unknown>,
    migrationId: args.migrationId,
    graph: `${PHASE_G_GRAPH_ID}@${PHASE_G_GRAPH_VERSION}`,
    definitionHash: PHASE_G_GRAPH_DEFINITION_HASH,
    failureReason: `pre_envelope_terminal:${reason}`,
    recoveryResult: ambiguous ? "recovery_refused_unsafe_or_ambiguous" : "failed_safe_recovery_available",
  });
}

export async function executePhaseGSchedule(args: { now?: Date; schedulerPath?: string; request?: HttpRequest; recoveryTriggerId?: string; instagramOutboxPath?: string } = {}): Promise<Record<string, unknown>> {
  const activeRequest = args.request ?? request;
  const activeMigrationId = PHASE_G_MIGRATION_ID;
  const activeInstagramOutboxPath = args.instagramOutboxPath ?? defaultInstagramOutboxPath;
  const store = new GraphSchedulerStore(args.schedulerPath ?? schedulerDatabasePath);
  let triggerId: string | undefined;
  let runId: string | undefined;
  try {
    const health = await activeRequest("/api/graphs/health");
    if (health?.zeroWriteOnly !== true) throw new Error("graph_scheduler_trigger_requires_global_zero_write");
    const migration = store.migration(activeMigrationId)!;
    if (!migration || migration.status !== "graph_owned" || migration.graphDefinitionHash !== PHASE_G_GRAPH_DEFINITION_HASH) throw new Error("graph_scheduler_migration_not_active_or_exact");
    const recoveryTrigger = args.recoveryTriggerId ? store.trigger(args.recoveryTriggerId) : null;
    if (args.recoveryTriggerId && (!recoveryTrigger || recoveryTrigger.migrationId !== activeMigrationId)) throw new Error("graph_scheduler_recovery_trigger_not_found_or_mismatched");
    if (recoveryTrigger && !["failed_safe", "completed"].includes(recoveryTrigger.status)) throw new Error(`graph_scheduler_recovery_trigger_not_terminal_or_failed_safe:${recoveryTrigger.status}`);
    const slot = recoveryTrigger
      ? { slotId: recoveryTrigger.slotId, scheduledFor: recoveryTrigger.scheduledFor }
      : resolveNaturalSlot(args.now ?? new Date());
    const reservation = recoveryTrigger
      ? { trigger: recoveryTrigger, created: false }
      : store.reserveTrigger(activeMigrationId, slot.slotId, slot.scheduledFor, `graph-scheduler:${activeMigrationId}`);
    triggerId = reservation.trigger.triggerId;
    if (!reservation.created) {
      if (reservation.trigger.status === "completed") return { outcome: "duplicate_suppressed", trigger: reservation.trigger, providerWrites: 0 };
      if (["reserved", "preparing", "executing", "ambiguous"].includes(reservation.trigger.status)) return { outcome: "concurrent_or_ambiguous_trigger_suppressed", trigger: reservation.trigger, providerWrites: 0 };
      runId = reservation.trigger.graphRunId;
    }

    let detail: any;
    if (reservation.trigger.status === "failed_safe") {
      const prior = runId ? await activeRequest(`/api/graphs/runs/${runId}`) : null;
      if (hasUnsafeEffect(prior)) throw new Error("graph_scheduler_failed_safe_recovery_requires_zero_effects");
      store.updateTrigger(triggerId, "preparing", `graph-scheduler:${activeMigrationId}`, { graphRunId: runId, failureReason: undefined });
      if (!prior?.run || ["failed", "cancelled"].includes(String(prior.run.status)) || !hasCompleteFrozenEnvelope(prior)) {
        const recovered = await createPhaseGRun({ request: activeRequest, slot, triggerId, migration, correlationId: `${triggerId}:attempt:${reservation.trigger.attemptCount + 1}` });
        runId = recovered.runId;
        detail = recovered.detail;
      } else detail = prior;
    } else {
      store.updateTrigger(triggerId, "preparing", `graph-scheduler:${activeMigrationId}`);
      if (!runId) {
        const created = await createPhaseGRun({ request: activeRequest, slot, triggerId, migration });
        runId = created.runId;
        detail = created.detail;
      } else {
        detail = await activeRequest(`/api/graphs/runs/${runId}`);
      }
    }

    if (!runId) throw new Error("graph_scheduler_run_id_missing");
    if (!detail) detail = await activeRequest(`/api/graphs/runs/${runId}`);
    const missingEnvelope = classifyMissingEnvelope({ store, triggerId, migrationId: activeMigrationId, detail, actor: `graph-scheduler:${activeMigrationId}`, graphRunId: runId, instagramOutboxPath: activeInstagramOutboxPath });
    if (missingEnvelope) return missingEnvelope;
    if (reservation.trigger.status !== "failed_safe") {
      const exact = inspect(detail);
      store.updateTrigger(triggerId, "preparing", `graph-scheduler:${activeMigrationId}`, { graphRunId: runId, approvalId: exact.approval?.approvalId });
    }

    let exact = inspect(detail);
    const expiry = new Date(Math.min(Date.now() + 15 * 60_000, Date.parse(exact.envelope.approvalExpiry) - 1000, Date.parse(String(exact.live.projection.claim.leaseExpiresAt)) - 1000)).toISOString();
    if (exact.approval?.status === "pending") {
      await activeRequest(`/api/graphs/runs/${runId}/approvals/${exact.approval.approvalId}`, { method: "POST", body: JSON.stringify({ decision: "granted", action: exact.approval.action, target: exact.approval.target, payloadHash: exact.approval.payloadHash, expiresAt: expiry, note: `Exact payload approval under active graph-owned migration ${activeMigrationId}` }) });
      detail = await activeRequest(`/api/graphs/runs/${runId}`);
      exact = inspect(detail);
    }
    if (!exact.capability) {
      await activeRequest(`/api/graphs/runs/${runId}/live-capabilities`, { method: "POST", body: JSON.stringify({ approvalId: exact.approval.approvalId, expiresAt: expiry }) });
      detail = await activeRequest(`/api/graphs/runs/${runId}`);
      exact = inspect(detail);
    }
    if (!exact.capability || exact.capability.status !== "prepared") throw new Error(`graph_scheduler_capability_not_prepared:${exact.capability?.status ?? "missing"}`);
    store.updateTrigger(triggerId, "executing", `graph-scheduler:${activeMigrationId}`, { graphRunId: runId, approvalId: exact.approval.approvalId, capabilityId: exact.capability.capabilityId });
    if (["waiting_for_approval", "blocked", "paused"].includes(exact.run.status)) await activeRequest(`/api/graphs/runs/${runId}/resume`, { method: "POST" });
    await activeRequest(`/api/graphs/runs/${runId}/execute`, { method: "POST" });
    detail = await activeRequest(`/api/graphs/runs/${runId}`);
    const postExecuteMissingEnvelope = classifyMissingEnvelope({ store, triggerId, migrationId: activeMigrationId, detail, actor: `graph-scheduler:${activeMigrationId}`, graphRunId: runId, instagramOutboxPath: activeInstagramOutboxPath });
    if (postExecuteMissingEnvelope) return postExecuteMissingEnvelope;
    exact = inspect(detail);

    if (exact.run.status === "failed" && exact.capability?.status === "consumed" && exact.effects.some((item: any) => item.state === "effect_verified")) {
      const checkpoint = exact.run.checkpoints?.find((item: any) => item.reason === "after_reconcile_publication");
      if (!checkpoint) throw new Error("graph_scheduler_verified_effect_missing_safe_checkpoint");
      await activeRequest(`/api/graphs/runs/${runId}/checkpoints/${checkpoint.checkpointId}/retry`, { method: "POST" });
      await activeRequest(`/api/graphs/runs/${runId}/execute`, { method: "POST" });
      detail = await activeRequest(`/api/graphs/runs/${runId}`);
      exact = inspect(detail);
    }

    const effect = exact.effects.find((item: any) => item.state === "effect_verified");
    const permalink = exact.live?.readback?.permalink ?? exact.live?.result?.permalink ?? exact.live?.projection?.permalink;
    if (exact.run.status !== "completed" || exact.capability?.status !== "consumed" || !effect?.providerOperationId || !permalink || !exact.eventChainValid) throw new Error("graph_scheduler_completion_contract_failed");
    const completed = store.updateTrigger(triggerId, "completed", `graph-scheduler:${activeMigrationId}`, { graphRunId: runId, approvalId: exact.approval.approvalId, capabilityId: exact.capability.capabilityId, providerObjectId: effect.providerOperationId, permalink: String(permalink) });
    return { outcome: "completed", trigger: completed, graph: `${exact.run.graphId}@${exact.run.graphVersion}`, definitionHash: PHASE_G_GRAPH_DEFINITION_HASH, envelopeHash: exact.envelopeHash, payloadHash: exact.payloadHash, mediaHash: exact.mediaHash, providerWrites: 1, browserRelayCalls: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (triggerId) {
      try {
        const detail = runId ? await activeRequest(`/api/graphs/runs/${runId}`) : null;
        const capabilityStatus = detail?.liveCapability?.status;
        const ambiguous = capabilityStatus === "consumed" || detail?.externalEffects?.some((item: any) => ["request_sent", "provider_accepted", "ambiguous"].includes(item.state));
        store.updateTrigger(triggerId, ambiguous ? "ambiguous" : "failed_safe", `graph-scheduler:${activeMigrationId}`, { graphRunId: runId, capabilityId: detail?.liveCapability?.capabilityId, failureReason: message });
      } catch { /* preserve the primary failure */ }
    }
    throw error;
  } finally {
    store.close();
  }
}

function format(result: Record<string, unknown>): string {
  const trigger = result.trigger as Record<string, unknown>;
  const report = result.publicationReport as Record<string, unknown> | undefined;
  if (report) {
    return [
      `Graph-owned Instagram image ${String(report.finalClassification)}`,
      `Graph execution outcome: ${String(report.graphExecutionOutcome)}`,
      `Scheduler completion contract: ${String(report.schedulerCompletionContractStatus)}`,
      `Publication outcome: ${String(report.publicationOutcome)}`,
      `Policy/skip reason: ${String(report.policyOrSkipReason)}`,
      `Trigger: ${String(trigger.triggerId)}`,
      `Run: ${String(trigger.graphRunId ?? "none")}`,
      `Provider writes: ${String(report.providerWrites ?? 0)}; Browser Relay calls: 0`,
      `Provider post: ${String(report.providerPostUrl ?? report.providerPostId ?? "none")}`,
      `Recovery required: ${String(report.recoveryRequired) === "true" ? "yes" : "no"}`,
      `Recovery result: ${String(report.recoveryResult)}`,
      `Final classification: ${String(report.finalClassification)}`,
      "",
    ].join("\n");
  }
  return result.outcome === "completed"
    ? `Graph-owned Instagram image verified: ${String(trigger.permalink)}\nTrigger: ${String(trigger.triggerId)}\nRun: ${String(trigger.graphRunId)}\nProvider object: ${String(trigger.providerObjectId)}\nProvider writes: 1; Browser Relay calls: 0\n`
    : `Graph-owned Instagram image ${String(result.outcome)}\nTrigger: ${String(trigger.triggerId)}\nProvider writes: 0; Browser Relay calls: 0\n`;
}

async function main(): Promise<void> {
  const migrationFlag = process.argv[2];
  const migrationId = process.argv[3];
  if ((process.argv.length !== 4 && process.argv.length !== 6) || migrationFlag !== "--migration-id" || migrationId !== PHASE_G_MIGRATION_ID) throw new Error("graph_scheduler_trigger_requires_exact_migration_reference");
  if (process.argv.length === 6 && process.argv[4] !== "--recover-trigger-id") throw new Error("graph_scheduler_recovery_requires_exact_trigger_reference");
  const result = await executePhaseGSchedule({ recoveryTriggerId: process.argv[5] });
  const trigger = result.trigger as Record<string, unknown>;
  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  const evidencePath = join(evidenceRoot, `${String(trigger.triggerId)}.json`);
  if (!existsSync(evidencePath)) {
    writeFileSync(evidencePath, `${JSON.stringify({ recordedAt: new Date().toISOString(), ...result }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    chmodSync(evidencePath, 0o600);
  } else if (result.publicationReport) {
    const correctivePath = join(evidenceRoot, `${String(trigger.triggerId)}.corrective-${new Date().toISOString().replace(/[:.]/g, "")}.json`);
    writeFileSync(correctivePath, `${JSON.stringify({ recordedAt: new Date().toISOString(), correctiveFor: evidencePath, ...result }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    chmodSync(correctivePath, 0o600);
  }
  process.stdout.write(format(result));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
