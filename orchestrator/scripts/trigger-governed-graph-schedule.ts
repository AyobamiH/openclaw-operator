import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readApiCredentialReference } from "../src/auth/credential-reference.js";
import { GraphSchedulerStore } from "../src/graph/scheduler-store.js";
import { governedSchedulerPortfolioEntry } from "../src/graph/scheduler-portfolio.js";

const BASE_URL = "http://127.0.0.1:3312";
const CREDENTIAL_FILE = "/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/credentials/orchestrator.env";
export const PRODUCTION_GRAPH_SCHEDULER_DATABASE_PATH = "/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/database/graph-scheduler.sqlite";
const EVIDENCE_ROOT = "/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/evidence/graph-scheduler-triggers";

type HttpRequest = (route: string, init?: RequestInit) => Promise<any>;

export function resolveGovernedSchedulerDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.OPENCLAW_GRAPH_SCHEDULER_DATABASE_PATH?.trim();
  if (configured) return configured;
  const stateRoot = env.OPENCLAW_OPERATOR_STATE_DIR?.trim();
  if (stateRoot) return join(stateRoot, "database", "graph-scheduler.sqlite");
  return PRODUCTION_GRAPH_SCHEDULER_DATABASE_PATH;
}

function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  if (/^\*\/\d+$/.test(field)) return value % Number(field.slice(2)) === 0;
  return field.split(",").some((part) => Number(part) === value);
}

function localParts(date: Date, timezone: string): { date: string; hour: number; minute: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

function isDefinitionConcurrencyExhausted(error: unknown, graph: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(`graph_definition_concurrency_exhausted:${graph}`);
}

export function resolveNaturalSlot(args: { now: Date; cronExpression: string; timezone: string; scheduleId: string; provider: string; latenessToleranceMinutes: number }): { slotId: string; scheduledFor: string } {
  const [minuteField, hourField, dayField, monthField, weekdayField] = args.cronExpression.trim().split(/\s+/);
  if (!minuteField || !hourField || dayField !== "*" || monthField !== "*" || weekdayField !== "*") throw new Error("graph_scheduler_cron_expression_not_supported");
  const rounded = new Date(args.now); rounded.setSeconds(0, 0);
  for (let offset = 0; offset <= args.latenessToleranceMinutes; offset += 1) {
    const candidate = new Date(rounded.getTime() - offset * 60_000);
    const local = localParts(candidate, args.timezone);
    if (!fieldMatches(minuteField, local.minute) || !fieldMatches(hourField, local.hour)) continue;
    const time = `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
    return { slotId: `${args.provider}:${local.date}:${time}:${args.scheduleId}`, scheduledFor: candidate.toISOString() };
  }
  throw new Error("graph_scheduler_trigger_outside_natural_slot_window");
}

export function resolveInputTemplate(value: unknown, slot: { slotId: string; scheduledFor: string }): unknown {
  if (value === "$scheduledAt") return slot.scheduledFor;
  if (value === "$slotId") return slot.slotId;
  if (Array.isArray(value)) return value.map((item) => resolveInputTemplate(item, slot));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, resolveInputTemplate(nested, slot)]));
  return value;
}

async function defaultRequest(route: string, init?: RequestInit): Promise<any> {
  const token = readApiCredentialReference(CREDENTIAL_FILE, { requiredRole: "admin" });
  const response = await fetch(`${BASE_URL}${route}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
  let body: any = null;
  try { body = await response.json(); } catch { /* HTTP status remains authoritative */ }
  if (!response.ok) throw new Error(`graph_scheduler_http_${response.status}:${body?.error ?? "unknown"}`);
  return body;
}

export async function executeGovernedSchedule(args: { migrationId: string; now?: Date; schedulerPath?: string; request?: HttpRequest }): Promise<Record<string, unknown>> {
  const portfolio = governedSchedulerPortfolioEntry(args.migrationId);
  const request = args.request ?? defaultRequest;
  const store = new GraphSchedulerStore(args.schedulerPath ?? resolveGovernedSchedulerDatabasePath());
  let triggerId: string | undefined;
  let runId: string | undefined;
  try {
    const health = await request("/api/graphs/health");
    if (health?.status !== "healthy" || health?.zeroWriteOnly !== true) throw new Error("graph_scheduler_runtime_health_gate_failed");
    const migration = store.migration(args.migrationId);
    if (!migration || migration.status !== "graph_owned" || migration.graphDefinitionHash !== portfolio.declaration.graphDefinitionHash) throw new Error("graph_scheduler_migration_not_active_or_exact");
    const slot = resolveNaturalSlot({ now: args.now ?? new Date(), cronExpression: migration.cronExpression, timezone: migration.timezone, scheduleId: migration.scheduleId, provider: migration.provider, latenessToleranceMinutes: portfolio.latenessToleranceMinutes });
    const reservation = store.reserveTrigger(args.migrationId, slot.slotId, slot.scheduledFor, `graph-scheduler:${args.migrationId}`);
    triggerId = reservation.trigger.triggerId;
    if (!reservation.created) {
      if (reservation.trigger.status === "completed") return { outcome: "duplicate_suppressed", trigger: reservation.trigger, providerWrites: 0 };
      if (["reserved", "preparing", "executing", "ambiguous"].includes(reservation.trigger.status)) return { outcome: "concurrent_or_ambiguous_trigger_suppressed", trigger: reservation.trigger, providerWrites: 0 };
      runId = reservation.trigger.graphRunId;
    }
    store.updateTrigger(triggerId, "preparing", `graph-scheduler:${args.migrationId}`, runId ? { graphRunId: runId, failureReason: undefined } : {});
    let detail: any;
    if (!runId) {
      let created: any;
      try {
        created = await request("/api/graphs/runs", { method: "POST", body: JSON.stringify({
          graphId: migration.graphId, version: migration.graphVersion, objective: `Graph-owned scheduled workflow ${slot.slotId}`,
          correlationId: triggerId, input: resolveInputTemplate(portfolio.input, slot), authority: portfolio.authority,
        }) });
      } catch (error) {
        if (!isDefinitionConcurrencyExhausted(error, `${migration.graphId}@${migration.graphVersion}`)) throw error;
        const deferred = store.updateTrigger(triggerId, "failed_safe", `graph-scheduler:${args.migrationId}`, {
          failureReason: `deferred:definition_concurrency_exhausted:${migration.graphId}@${migration.graphVersion}`,
        });
        return {
          outcome: "deferred",
          reason: "definition_concurrency_exhausted",
          migrationId: args.migrationId,
          graph: `${migration.graphId}@${migration.graphVersion}`,
          trigger: deferred,
          providerWrites: 0,
          eventChainValid: store.eventChainValid(args.migrationId),
          childReceiptChainValid: true,
        };
      }
      runId = String(created.run.runId);
      detail = await request(`/api/graphs/runs/${runId}`);
      store.updateTrigger(triggerId, "preparing", `graph-scheduler:${args.migrationId}`, { graphRunId: runId, approvalId: detail.approvals?.[0]?.approvalId });
    } else detail = await request(`/api/graphs/runs/${runId}`);

    if (reservation.trigger.status === "failed_safe" && detail.run?.status === "failed") {
      const unsafeEffects = (detail.externalEffects ?? []).filter((item: any) => item.state !== "not_requested" && item.state !== "confirmed_absent");
      if (unsafeEffects.length > 0 || detail.liveCapability?.status === "consumed") {
        throw new Error("graph_scheduler_failed_safe_recovery_requires_zero_effects");
      }
      const recovered = await request("/api/graphs/runs", { method: "POST", body: JSON.stringify({
        graphId: migration.graphId, version: migration.graphVersion, objective: `Graph-owned scheduled workflow recovery ${slot.slotId}`,
        correlationId: `${triggerId}:attempt:${reservation.trigger.attemptCount + 1}`, input: resolveInputTemplate(portfolio.input, slot), authority: portfolio.authority,
      }) });
      runId = String(recovered.run.runId);
      detail = await request(`/api/graphs/runs/${runId}`);
      store.updateTrigger(triggerId, "preparing", `graph-scheduler:${args.migrationId}`, { graphRunId: runId });
    }

    if (detail.run?.status === "waiting_for_approval") {
      const pendingApproval = detail.approvals?.find((item: any) => item.status === "pending");
      const grantedApproval = detail.approvals?.find((item: any) => item.status === "granted");
      if (portfolio.approvalPolicy === "none" || (!pendingApproval && !grantedApproval)) throw new Error("graph_scheduler_unexpected_approval_boundary");
      if (pendingApproval && portfolio.approvalPolicy === "prepared_payload_only" && !detail.run?.data?.socialEffect?.approvalId) throw new Error("graph_scheduler_exact_prepared_payload_approval_missing");
      const approval = pendingApproval ?? grantedApproval;
      const latestExpiry = new Date(Date.now() + 15 * 60_000);
      const expiryMs = grantedApproval?.expiresAt ? Math.min(latestExpiry.getTime(), Date.parse(grantedApproval.expiresAt)) : latestExpiry.getTime();
      if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) throw new Error("graph_scheduler_approval_expired_before_capability_issue");
      const expiresAt = new Date(expiryMs).toISOString();
      if (pendingApproval) {
        await request(`/api/graphs/runs/${runId}/approvals/${approval.approvalId}`, { method: "POST", body: JSON.stringify({ decision: "granted", action: approval.action, target: approval.target, payloadHash: approval.payloadHash, expiresAt, note: portfolio.approvalPolicy === "prepared_payload_only" ? `Bound to existing exact prepared payload approval ${String(detail.run.data.socialEffect.approvalId)}` : `Standing exact schedule authority ${args.migrationId}` }) });
      }
      if (!detail.liveCapability) await request(`/api/graphs/runs/${runId}/live-capabilities`, { method: "POST", body: JSON.stringify({ approvalId: approval.approvalId, expiresAt }) });
      detail = await request(`/api/graphs/runs/${runId}`);
    }
    if (!detail.liveCapability && ["running", "blocked"].includes(String(detail.run?.status))) {
      const approval = detail.approvals?.find((item: any) => item.status === "granted");
      if (approval) {
        const expiryMs = Math.min(Date.now() + 15 * 60_000, Date.parse(approval.expiresAt));
        if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) throw new Error("graph_scheduler_approval_expired_before_capability_issue");
        await request(`/api/graphs/runs/${runId}/live-capabilities`, { method: "POST", body: JSON.stringify({ approvalId: approval.approvalId, expiresAt: new Date(expiryMs).toISOString() }) });
        detail = await request(`/api/graphs/runs/${runId}`);
      }
    }

    store.updateTrigger(triggerId, "executing", `graph-scheduler:${args.migrationId}`, { graphRunId: runId, approvalId: detail.approvals?.find((item: any) => item.status === "granted")?.approvalId, capabilityId: detail.liveCapability?.capabilityId });
    if (["waiting_for_approval", "blocked", "paused"].includes(String(detail.run?.status))) await request(`/api/graphs/runs/${runId}/resume`, { method: "POST" });
    if (!['completed','failed','cancelled'].includes(String(detail.run?.status))) await request(`/api/graphs/runs/${runId}/execute`, { method: "POST" });
    detail = await request(`/api/graphs/runs/${runId}`);
    const effects = (detail.externalEffects ?? []).filter((item: any) => item.state === "effect_verified");
    if (detail.run?.status !== "completed" || detail.eventChainValid !== true || detail.childRunReceiptChainValid !== true || effects.length > portfolio.maximumExternalWrites) throw new Error("graph_scheduler_completion_contract_failed");
    if (portfolio.maximumExternalWrites === 1 && effects.length === 1 && detail.liveCapability?.status !== "consumed") throw new Error("graph_scheduler_live_capability_not_consumed");
    const effect = effects[0];
    const terminalReceipt = [...(detail.childRunReceipts ?? [])].reverse().find((item: any) => item.status === "succeeded");
    const terminalOutcome = typeof terminalReceipt?.outcome === "string" ? terminalReceipt.outcome : "completed";
    const completed = store.updateTrigger(triggerId, "completed", `graph-scheduler:${args.migrationId}`, { graphRunId: runId, approvalId: detail.approvals?.find((item: any) => item.status === "granted")?.approvalId, capabilityId: detail.liveCapability?.capabilityId, providerObjectId: effect?.providerOperationId, permalink: detail.run?.data?.socialEffect?.result?.permalink });
    return { outcome: terminalOutcome, migrationId: args.migrationId, graph: `${migration.graphId}@${migration.graphVersion}`, definitionHash: migration.graphDefinitionHash, terminalReceipt: terminalReceipt ? { receiptId: terminalReceipt.receiptId, outcome: terminalReceipt.outcome, receiptHash: terminalReceipt.receiptHash } : null, trigger: completed, providerWrites: effects.length, eventChainValid: true, childReceiptChainValid: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (triggerId) {
      try {
        const detail = runId ? await request(`/api/graphs/runs/${runId}`) : null;
        const ambiguous = detail?.liveCapability?.status === "consumed" || detail?.externalEffects?.some((item: any) => ["request_sent", "provider_accepted", "ambiguous"].includes(item.state));
        store.updateTrigger(triggerId, ambiguous ? "ambiguous" : "failed_safe", `graph-scheduler:${args.migrationId}`, { graphRunId: runId, approvalId: detail?.approvals?.find((item: any) => item.status === "granted")?.approvalId, capabilityId: detail?.liveCapability?.capabilityId, failureReason: message });
      } catch { /* primary failure remains authoritative */ }
    }
    throw error;
  } finally { store.close(); }
}

async function main(): Promise<void> {
  if (process.argv.length !== 4 || process.argv[2] !== "--migration-id" || !process.argv[3]) throw new Error("graph_scheduler_trigger_requires_exact_migration_reference");
  const result = await executeGovernedSchedule({ migrationId: process.argv[3] });
  const trigger = result.trigger as Record<string, unknown>;
  mkdirSync(EVIDENCE_ROOT, { recursive: true, mode: 0o700 });
  const evidencePath = join(EVIDENCE_ROOT, `${String(trigger.triggerId)}.json`);
  if (!existsSync(evidencePath)) { writeFileSync(evidencePath, `${JSON.stringify({ recordedAt: new Date().toISOString(), ...result }, null, 2)}\n`, { mode: 0o600, flag: "wx" }); chmodSync(evidencePath, 0o600); }
  process.stdout.write(`Graph-owned ${String(result.migrationId ?? process.argv[3])} ${String(result.outcome)}\nTrigger: ${String(trigger.triggerId)}\nRun: ${String(trigger.graphRunId ?? "none")}\nProvider writes: ${String(result.providerWrites ?? 0)}; Browser Relay calls: 0\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
