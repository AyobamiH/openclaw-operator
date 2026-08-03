import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

const migrationFlag = process.argv[2];
const migrationId = process.argv[3];
if (process.argv.length !== 4 || migrationFlag !== "--migration-id" || migrationId !== PHASE_G_MIGRATION_ID) throw new Error("graph_scheduler_trigger_requires_exact_migration_reference");

const baseUrl = "http://127.0.0.1:3312";
const credentialFile = "/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/credentials/orchestrator.env";
const evidenceRoot = "/home/oneclickwebsitedesignfactory/.openclaw/state/activation/graph-phase-g-instagram-image-20260802/triggers";
const schedulerDatabasePath = "/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/database/graph-scheduler.sqlite";
const token = readApiCredentialReference(credentialFile, { requiredRole: "admin" });

async function request(route: string, init?: RequestInit): Promise<any> {
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

async function run(): Promise<Record<string, unknown>> {
  const store = new GraphSchedulerStore(schedulerDatabasePath);
  let triggerId: string | undefined;
  let runId: string | undefined;
  try {
    const health = await request("/api/graphs/health");
    if (health?.zeroWriteOnly !== true) throw new Error("graph_scheduler_trigger_requires_global_zero_write");
    const migration = store.migration(migrationId)!;
    if (!migration || migration.status !== "graph_owned" || migration.graphDefinitionHash !== PHASE_G_GRAPH_DEFINITION_HASH) throw new Error("graph_scheduler_migration_not_active_or_exact");
    const slot = resolveNaturalSlot(new Date());
    const reservation = store.reserveTrigger(migrationId, slot.slotId, slot.scheduledFor, `graph-scheduler:${migrationId}`);
    triggerId = reservation.trigger.triggerId;
    if (!reservation.created) {
      if (reservation.trigger.status === "completed") return { outcome: "duplicate_suppressed", trigger: reservation.trigger, providerWrites: 0 };
      if (["reserved", "preparing", "executing", "ambiguous"].includes(reservation.trigger.status)) return { outcome: "concurrent_or_ambiguous_trigger_suppressed", trigger: reservation.trigger, providerWrites: 0 };
      runId = reservation.trigger.graphRunId;
    }
    store.updateTrigger(triggerId, "preparing", `graph-scheduler:${migrationId}`);

    let detail: any;
    if (!runId) {
      const created = await request("/api/graphs/runs", { method: "POST", body: JSON.stringify({
        graphId: PHASE_G_GRAPH_ID,
        version: PHASE_G_GRAPH_VERSION,
        objective: `Graph-owned recurring Instagram image publication ${slot.slotId}`,
        correlationId: triggerId,
        input: { provider: PHASE_G_PROVIDER, accountKey: "instagram:owner", expectedAccountId: PHASE_G_ACCOUNT_ID, jobId: migration.scheduleId, kind: "image", observedAt: new Date().toISOString(), shadowMode: false, maximumProviderMutations: 1 },
        authority: { maximum: "external_public", grantedBy: `graph-scheduler-migration:${migrationId}` },
      }) });
      runId = created.run.runId;
      detail = await request(`/api/graphs/runs/${runId}`);
      const exact = inspect(detail);
      store.updateTrigger(triggerId, "preparing", `graph-scheduler:${migrationId}`, { graphRunId: runId, approvalId: exact.approval?.approvalId });
    } else {
      detail = await request(`/api/graphs/runs/${runId}`);
    }

    let exact = inspect(detail);
    const expiry = new Date(Math.min(Date.now() + 15 * 60_000, Date.parse(exact.envelope.approvalExpiry) - 1000, Date.parse(String(exact.live.projection.claim.leaseExpiresAt)) - 1000)).toISOString();
    if (exact.approval?.status === "pending") {
      await request(`/api/graphs/runs/${runId}/approvals/${exact.approval.approvalId}`, { method: "POST", body: JSON.stringify({ decision: "granted", action: exact.approval.action, target: exact.approval.target, payloadHash: exact.approval.payloadHash, expiresAt: expiry, note: `Exact payload approval under active graph-owned migration ${migrationId}` }) });
      detail = await request(`/api/graphs/runs/${runId}`);
      exact = inspect(detail);
    }
    if (!exact.capability) {
      await request(`/api/graphs/runs/${runId}/live-capabilities`, { method: "POST", body: JSON.stringify({ approvalId: exact.approval.approvalId, expiresAt: expiry }) });
      detail = await request(`/api/graphs/runs/${runId}`);
      exact = inspect(detail);
    }
    if (!exact.capability || exact.capability.status !== "prepared") throw new Error(`graph_scheduler_capability_not_prepared:${exact.capability?.status ?? "missing"}`);
    store.updateTrigger(triggerId, "executing", `graph-scheduler:${migrationId}`, { graphRunId: runId, approvalId: exact.approval.approvalId, capabilityId: exact.capability.capabilityId });
    if (["waiting_for_approval", "blocked", "paused"].includes(exact.run.status)) await request(`/api/graphs/runs/${runId}/resume`, { method: "POST" });
    await request(`/api/graphs/runs/${runId}/execute`, { method: "POST" });
    detail = await request(`/api/graphs/runs/${runId}`);
    exact = inspect(detail);

    if (exact.run.status === "failed" && exact.capability?.status === "consumed" && exact.effects.some((item: any) => item.state === "effect_verified")) {
      const checkpoint = exact.run.checkpoints?.find((item: any) => item.reason === "after_reconcile_publication");
      if (!checkpoint) throw new Error("graph_scheduler_verified_effect_missing_safe_checkpoint");
      await request(`/api/graphs/runs/${runId}/checkpoints/${checkpoint.checkpointId}/retry`, { method: "POST" });
      await request(`/api/graphs/runs/${runId}/execute`, { method: "POST" });
      detail = await request(`/api/graphs/runs/${runId}`);
      exact = inspect(detail);
    }

    const effect = exact.effects.find((item: any) => item.state === "effect_verified");
    const permalink = exact.live?.readback?.permalink ?? exact.live?.result?.permalink ?? exact.live?.projection?.permalink;
    if (exact.run.status !== "completed" || exact.capability?.status !== "consumed" || !effect?.providerOperationId || !permalink || !exact.eventChainValid) throw new Error("graph_scheduler_completion_contract_failed");
    const completed = store.updateTrigger(triggerId, "completed", `graph-scheduler:${migrationId}`, { graphRunId: runId, approvalId: exact.approval.approvalId, capabilityId: exact.capability.capabilityId, providerObjectId: effect.providerOperationId, permalink: String(permalink) });
    return { outcome: "completed", trigger: completed, graph: `${exact.run.graphId}@${exact.run.graphVersion}`, definitionHash: PHASE_G_GRAPH_DEFINITION_HASH, envelopeHash: exact.envelopeHash, payloadHash: exact.payloadHash, mediaHash: exact.mediaHash, providerWrites: 1, browserRelayCalls: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (triggerId) {
      try {
        const detail = runId ? await request(`/api/graphs/runs/${runId}`) : null;
        const capabilityStatus = detail?.liveCapability?.status;
        const ambiguous = capabilityStatus === "consumed" || detail?.externalEffects?.some((item: any) => ["request_sent", "provider_accepted", "ambiguous"].includes(item.state));
        store.updateTrigger(triggerId, ambiguous ? "ambiguous" : "failed_safe", `graph-scheduler:${migrationId}`, { graphRunId: runId, capabilityId: detail?.liveCapability?.capabilityId, failureReason: message });
      } catch { /* preserve the primary failure */ }
    }
    throw error;
  } finally {
    store.close();
  }
}

const result = await run();
const trigger = result.trigger as Record<string, unknown>;
mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
const evidencePath = join(evidenceRoot, `${String(trigger.triggerId)}.json`);
if (!existsSync(evidencePath)) {
  writeFileSync(evidencePath, `${JSON.stringify({ recordedAt: new Date().toISOString(), ...result }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(evidencePath, 0o600);
}
process.stdout.write(result.outcome === "completed"
  ? `Graph-owned Instagram image verified: ${String(trigger.permalink)}\nTrigger: ${String(trigger.triggerId)}\nRun: ${String(trigger.graphRunId)}\nProvider object: ${String(trigger.providerObjectId)}\nProvider writes: 1; Browser Relay calls: 0\n`
  : `Graph-owned Instagram image ${String(result.outcome)}\nTrigger: ${String(trigger.triggerId)}\nProvider writes: 0; Browser Relay calls: 0\n`);
