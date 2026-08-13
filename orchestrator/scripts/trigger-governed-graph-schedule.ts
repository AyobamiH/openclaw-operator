import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readApiCredentialReference } from "../src/auth/credential-reference.js";
import { GraphSchedulerStore } from "../src/graph/scheduler-store.js";
import { governedSchedulerPortfolioEntry } from "../src/graph/scheduler-portfolio.js";

const BASE_URL = "http://127.0.0.1:3312";
const CREDENTIAL_FILE = "/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/credentials/orchestrator.env";
export const PRODUCTION_GRAPH_SCHEDULER_DATABASE_PATH = "/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/database/graph-scheduler.sqlite";
const EVIDENCE_ROOT = "/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/evidence/graph-scheduler-triggers";
const CONTINUOUS_MARKETING_DIGEST_OUTPUT_ROOT = "/home/oneclickwebsitedesignfactory/.openclaw/workspace/artifacts/business-value/marketing";
export const GRAPH_SCHEDULER_READ_POLL_INTERVAL_MS = 10_000;
export const GRAPH_SCHEDULER_APPROVAL_POLL_ATTEMPTS = 60;
export const GRAPH_SCHEDULER_COMPLETION_POLL_ATTEMPTS = 180;
const GRAPH_SCHEDULER_READ_RATE_LIMIT_RETRIES = 3;
const GRAPH_SCHEDULER_READ_JITTER_WINDOW_MS = 1_000;

export type HttpRequest = (route: string, init?: RequestInit) => Promise<any>;
type PublicationClassification = "published" | "legitimate_skip" | "missed" | "failed" | "deferred";
type SchedulerCompletionPredicate = {
  name: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
};
type SchedulerCompletionContract = {
  status: "passed" | "transient" | "terminal";
  transient: boolean;
  recoverySafe: boolean;
  originalSlot: string;
  triggerId: string;
  runId: string | null;
  observedRunStatus: string;
  childReceiptIds: string[];
  verifierReceiptIds: string[];
  chainValidationReasons: string[];
  effectCount: number;
  maximumExternalWrites: number;
  predicates: SchedulerCompletionPredicate[];
};

type PublicationReport = {
  graphExecutionOutcome: string;
  schedulerCompletionContractStatus: string;
  publicationOutcome: string;
  recoveryResult: string;
  policyOrSkipReason: string;
  candidateId: string | null;
  targetId: string | null;
  providerWrites: number;
  providerPostId: string | null;
  providerPostUrl: string | null;
  historicalProviderWrites: number;
  historicalProviderPostId: string | null;
  historicalProviderPostUrl: string | null;
  verifierResult: string;
  recoveryRequired: boolean;
  finalClassification: PublicationClassification;
};
type NaturalSlotResolution = {
  slotId: string;
  scheduledFor: string;
  waitUntil?: string;
};
type ExecutionAcceptance = {
  status: "accepted" | "already_accepted" | "reconciled_existing";
  runId: string;
  correlationId: string;
  acceptedAt: string;
  durable: true;
};

type DigestArtifactEvidence = {
  path: string;
  sha256: string;
  bytes: number;
};

const EARLY_NATURAL_SLOT_TOLERANCE_MINUTES = 5;

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

export function resolveNaturalSlot(args: { now: Date; cronExpression: string; timezone: string; scheduleId: string; provider: string; latenessToleranceMinutes: number }): NaturalSlotResolution {
  const [minuteField, hourField, dayField, monthField, weekdayField] = args.cronExpression.trim().split(/\s+/);
  if (!minuteField || !hourField || dayField !== "*" || monthField !== "*" || weekdayField !== "*") throw new Error("graph_scheduler_cron_expression_not_supported");
  const rounded = new Date(args.now); rounded.setSeconds(0, 0);
  const nowMs = args.now.getTime();
  for (let offset = 0; offset <= args.latenessToleranceMinutes; offset += 1) {
    const candidate = new Date(rounded.getTime() - offset * 60_000);
    const ageMs = nowMs - candidate.getTime();
    if (ageMs < 0 || ageMs > args.latenessToleranceMinutes * 60_000) continue;
    const local = localParts(candidate, args.timezone);
    if (!fieldMatches(minuteField, local.minute) || !fieldMatches(hourField, local.hour)) continue;
    const time = `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
    return { slotId: `${args.provider}:${local.date}:${time}:${args.scheduleId}`, scheduledFor: candidate.toISOString() };
  }
  const earlyToleranceMinutes = Math.min(EARLY_NATURAL_SLOT_TOLERANCE_MINUTES, args.latenessToleranceMinutes);
  for (let offset = 1; offset <= earlyToleranceMinutes; offset += 1) {
    const candidate = new Date(rounded.getTime() + offset * 60_000);
    const waitMs = candidate.getTime() - nowMs;
    if (waitMs <= 0 || waitMs > earlyToleranceMinutes * 60_000) continue;
    const local = localParts(candidate, args.timezone);
    if (!fieldMatches(minuteField, local.minute) || !fieldMatches(hourField, local.hour)) continue;
    const time = `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
    return { slotId: `${args.provider}:${local.date}:${time}:${args.scheduleId}`, scheduledFor: candidate.toISOString(), waitUntil: candidate.toISOString() };
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

function deterministicReadJitterMs(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % GRAPH_SCHEDULER_READ_JITTER_WINDOW_MS;
}

function secondsHeaderDelayMs(value: string | null, nowMs: number, allowHttpDate: boolean): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    if (numeric > nowMs / 1000) return Math.max(0, Math.ceil(numeric * 1000 - nowMs));
    return Math.ceil(numeric * 1000);
  }
  if (!allowHttpDate) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed - nowMs) : null;
}

export function resolveGraphSchedulerReadRetryDelayMs(args: {
  route: string;
  attempt: number;
  headers: Headers;
  body?: any;
  nowMs?: number;
}): number {
  const nowMs = args.nowMs ?? Date.now();
  const retryAfterMs = secondsHeaderDelayMs(args.headers.get("Retry-After"), nowMs, true);
  const resetMs = secondsHeaderDelayMs(args.headers.get("ratelimit-reset"), nowMs, false);
  const bodyMs = Number.isFinite(Number(args.body?.retryAfterSeconds))
    ? Math.max(0, Math.ceil(Number(args.body.retryAfterSeconds) * 1000))
    : null;
  const providerDelayMs = retryAfterMs ?? resetMs ?? bodyMs ?? 60_000;
  return Math.max(1_000, providerDelayMs) + deterministicReadJitterMs(`${args.route}:${args.attempt}`);
}

export class GraphSchedulerHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(status: number, message: string, retryAfterMs: number | null) {
    super(message);
    this.name = "GraphSchedulerHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export async function requestGraphSchedulerJson(args: {
  route: string;
  init?: RequestInit;
  dispatch: () => Promise<Response>;
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => number;
  maxReadRateLimitRetries?: number;
}): Promise<any> {
  const method = String(args.init?.method ?? "GET").toUpperCase();
  const isIdempotentRead = method === "GET" || method === "HEAD";
  const maxRetries = args.maxReadRateLimitRetries ?? GRAPH_SCHEDULER_READ_RATE_LIMIT_RETRIES;
  for (let attempt = 0; ; attempt += 1) {
    const response = await args.dispatch();
    let body: any = null;
    try { body = await response.json(); } catch { /* HTTP status remains authoritative */ }
    if (response.ok) return body;
    const retryAfterMs = response.status === 429
      ? resolveGraphSchedulerReadRetryDelayMs({ route: args.route, attempt, headers: response.headers, body, nowMs: args.now?.() })
      : null;
    if (response.status === 429 && isIdempotentRead && attempt < maxRetries) {
      await (args.sleepFn ?? sleep)(retryAfterMs!);
      continue;
    }
    throw new GraphSchedulerHttpError(response.status, `graph_scheduler_http_${response.status}:${body?.error ?? "unknown"}`, retryAfterMs);
  }
}

async function defaultRequest(route: string, init?: RequestInit): Promise<any> {
  const token = readApiCredentialReference(CREDENTIAL_FILE, { requiredRole: "admin" });
  return requestGraphSchedulerJson({
    route,
    init,
    dispatch: () => fetch(`${BASE_URL}${route}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } }),
  });
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function socialEffectFrom(detail: any): Record<string, any> | null {
  const value = detail?.run?.data?.socialEffect;
  return value && typeof value === "object" ? value as Record<string, any> : null;
}

function resultFrom(socialEffect: Record<string, any> | null): Record<string, any> | null {
  const value = socialEffect?.result;
  return value && typeof value === "object" ? value as Record<string, any> : null;
}

function publicationLiveFrom(detail: any): Record<string, any> | null {
  const value = detail?.run?.data?.publicationLive;
  return value && typeof value === "object" ? value as Record<string, any> : null;
}

function publicationResultFrom(publicationLive: Record<string, any> | null): Record<string, any> | null {
  const value = publicationLive?.readback ?? publicationLive?.result ?? publicationLive?.projection;
  return value && typeof value === "object" ? value as Record<string, any> : null;
}

function compactReason(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function terminalZeroWriteReasonFrom(detail: any): string | null {
  if (detail?.run?.status === "completed") return null;
  const error = detail?.run?.lastError && typeof detail.run.lastError === "object" ? detail.run.lastError : null;
  const category = optionalString(error?.category) ?? optionalString(detail?.run?.terminalOutcome);
  const message = optionalString(error?.message);
  if (category && message) return `zero_write_terminal:${compactReason(category)}:${compactReason(message)}`;
  if (category) return `zero_write_terminal:${compactReason(category)}`;
  if (message) return `zero_write_terminal:unknown:${compactReason(message)}`;
  return null;
}

function terminalCheckpointFrom(detail: any): { checkpointId: string; reason: string; stateHash: string } | null {
  const checkpoints = Array.isArray(detail?.run?.checkpoints) ? detail.run.checkpoints : [];
  const checkpoint = [...checkpoints].reverse().find((item: any) => item?.reason === "completion_verified" || item?.nodeId === "complete");
  return checkpoint ? { checkpointId: String(checkpoint.checkpointId), reason: String(checkpoint.reason), stateHash: String(checkpoint.stateHash) } : null;
}

function verifierResultFrom(detail: any): string {
  const verifierReceipts = Array.isArray(detail?.verifierReceipts) ? detail.verifierReceipts : [];
  if (verifierReceipts.length > 0) return verifierReceipts.map((item: any) => `${String(item.verifierReceiptId)}:${String(item.status)}:${String(item.outcome ?? "none")}`).join(",");
  const assertions = Array.isArray(detail?.run?.assertions) ? detail.run.assertions : [];
  if (assertions.length > 0) return assertions.map((item: any) => `${String(item.assertionId)}:${String(item.status)}`).join(",");
  return detail?.childRunReceiptChainValid === true || detail?.childReceiptChainValid === true
    ? "chain_valid_no_child_verifier"
    : "verifier_not_available";
}

function verifierReceiptsAccepted(detail: any): boolean {
  const verifierReceipts = Array.isArray(detail?.verifierReceipts) ? detail.verifierReceipts : [];
  return verifierReceipts.every((item: any) => ["succeeded", "passed", "verified"].includes(String(item.status)));
}

function preparedPayloadApprovalId(detail: any): string | null {
  return optionalString(detail?.run?.data?.socialEffect?.approvalId)
    ?? optionalString(detail?.run?.data?.publicationLive?.envelope?.approvalId)
    ?? optionalString(detail?.run?.data?.publicationApproval?.approvalId);
}

function receiptIds(detail: any, key: "childRunReceipts" | "verifierReceipts"): string[] {
  const receipts = Array.isArray(detail?.[key]) ? detail[key] : [];
  return receipts.map((item: any) => String(item.receiptId ?? item.verifierReceiptId ?? item.childRunId ?? "unknown"));
}

function isLegitimateZeroWriteReason(reason: string): boolean {
  return /not_ready_before_commit|no_eligible|duplicate|collision|cooldown|policy|confirmed_absent|confirmed_failure|skip:|skipped|shadow|approval_missing|already_published|discovery_unavailable/i.test(reason);
}

function isOutsideNaturalSlotWindow(error: unknown): boolean {
  return error instanceof Error && error.message === "graph_scheduler_trigger_outside_natural_slot_window";
}

function syntheticSkipTrigger(migrationId: string, now: Date, reason: string): Record<string, unknown> {
  const compactTimestamp = now.toISOString().replace(/[^0-9TZ]/g, "");
  return {
    triggerId: `gst_skip_${migrationId.replace(/[^a-z0-9]+/gi, "_")}_${compactTimestamp}`,
    migrationId,
    status: "skipped",
    failureReason: reason,
  };
}

export function buildPublicationReport(args: { detail: any; outcome: string; providerWrites: number; maximumExternalWrites: 0 | 1; eventChainValid: boolean; childReceiptChainValid: boolean; providerOperationId?: string | null; deferredReason?: string; completionContract?: SchedulerCompletionContract; recoveryResult?: string; historicalEffect?: { providerWrites: number; providerPostId: string | null; providerPostUrl: string | null } }): PublicationReport {
  const socialEffect = socialEffectFrom(args.detail);
  const result = resultFrom(socialEffect);
  const publicationLive = publicationLiveFrom(args.detail);
  const publicationResult = publicationResultFrom(publicationLive);
  const socialStatus = optionalString(socialEffect?.status) ?? optionalString(result?.status);
  const action = optionalString(socialEffect?.action);
  const providerPostId = args.outcome === "duplicate_suppressed" ? null
    : optionalString(result?.providerResultId) ?? optionalString(result?.providerOperationId) ?? optionalString(publicationResult?.providerResultId) ?? optionalString(args.providerOperationId);
  const providerPostUrl = args.outcome === "duplicate_suppressed" ? null
    : optionalString(result?.permalink) ?? optionalString(publicationResult?.permalink);
  const candidateId = action && ["publish", "reply", "shadow"].includes(action)
    ? optionalString(socialEffect?.outboxId)
    : optionalString(publicationResult?.outboxId) ?? optionalString(publicationLive?.projection?.outboxId);
  const targetId = optionalString(socialEffect?.targetId) ?? optionalString(socialEffect?.outboxId) ?? optionalString(args.detail?.run?.data?.target) ?? optionalString(publicationResult?.outboxId);
  const terminalZeroWriteReason = args.providerWrites === 0 ? terminalZeroWriteReasonFrom(args.detail) : null;
  const policyOrSkipReason = args.outcome === "duplicate_suppressed" ? "zero_write:duplicate_suppressed"
    : args.deferredReason ? `deferred:${args.deferredReason}`
    : args.providerWrites > 0 ? "published"
      : socialStatus ? `${action === "skip" ? "skip" : "zero_write"}:${socialStatus}`
        : terminalZeroWriteReason ? terminalZeroWriteReason
        : args.maximumExternalWrites === 0 ? "zero_write_policy"
          : "zero_provider_writes_without_publication_reason";
  const finalClassification: PublicationClassification = args.outcome === "deferred" ? "deferred"
    : args.detail?.run?.status !== "completed" || !args.eventChainValid || !args.childReceiptChainValid ? "failed"
      : args.providerWrites > 0 ? "published"
        : isLegitimateZeroWriteReason(policyOrSkipReason) || args.maximumExternalWrites === 0 ? "legitimate_skip"
          : "missed";
  const publicationOutcome = finalClassification === "published" ? "published"
    : finalClassification === "legitimate_skip" ? "not_published_zero_write"
      : finalClassification;
  return {
    graphExecutionOutcome: args.outcome,
    schedulerCompletionContractStatus: args.completionContract?.status ?? (finalClassification === "failed" ? "terminal" : "passed"),
    publicationOutcome,
    recoveryResult: args.recoveryResult ?? "not_required",
    policyOrSkipReason,
    candidateId,
    targetId,
    providerWrites: args.providerWrites,
    providerPostId,
    providerPostUrl,
    historicalProviderWrites: args.historicalEffect?.providerWrites ?? 0,
    historicalProviderPostId: args.historicalEffect?.providerPostId ?? null,
    historicalProviderPostUrl: args.historicalEffect?.providerPostUrl ?? null,
    verifierResult: verifierResultFrom(args.detail),
    recoveryRequired: finalClassification === "missed" || finalClassification === "failed",
    finalClassification,
  };
}

export function formatGovernedScheduleOutput(result: Record<string, unknown>, fallbackMigrationId: string): string {
  const trigger = result.trigger as Record<string, unknown>;
  const report = result.publicationReport as PublicationReport | undefined;
  const acceptance = result.executionAcceptance as ExecutionAcceptance | undefined;
  if (!report) {
    return `Graph-owned ${String(result.migrationId ?? fallbackMigrationId)} ${String(result.outcome)}\nTrigger: ${String(trigger.triggerId)}\nRun: ${String(trigger.graphRunId ?? "none")}\nProvider writes: ${String(result.providerWrites ?? 0)}; Browser Relay calls: 0\n`;
  }
  const digestArtifact = result.digestArtifact as DigestArtifactEvidence | undefined;
  const lines = [
    `Graph-owned ${String(result.migrationId ?? fallbackMigrationId)} ${report.finalClassification}`,
    `Graph execution outcome: ${report.graphExecutionOutcome}`,
    `Scheduler completion contract: ${report.schedulerCompletionContractStatus}`,
    `Publication outcome: ${report.publicationOutcome}`,
    `Policy/skip reason: ${report.policyOrSkipReason}`,
    `Candidate ID: ${report.candidateId ?? "none"}`,
    `Target ID: ${report.targetId ?? "none"}`,
    `Trigger: ${String(trigger.triggerId)}`,
    `Run: ${String(trigger.graphRunId ?? "none")}`,
    `Scheduler acknowledgement: ${acceptance ? `${acceptance.status}:${acceptance.runId}:durable` : "not_available"}`,
    `Provider writes: ${String(report.providerWrites)}; Browser Relay calls: 0`,
    `Provider post: ${report.providerPostUrl ?? report.providerPostId ?? "none"}`,
    `Historical provider writes referenced: ${String(report.historicalProviderWrites)}`,
    `Historical provider post: ${report.historicalProviderPostUrl ?? report.historicalProviderPostId ?? "none"}`,
    `Verifier result: ${report.verifierResult}`,
    `Recovery required: ${report.recoveryRequired ? "yes" : "no"}`,
    `Recovery result: ${report.recoveryResult}`,
    `Final classification: ${report.finalClassification}`,
  ];
  if (digestArtifact) {
    lines.push(
      `Digest artifact: ${digestArtifact.path}`,
      `Digest SHA-256: ${digestArtifact.sha256}; bytes: ${digestArtifact.bytes}`,
      `MEDIA:${digestArtifact.path}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function resolveDigestArtifactEvidence(args: {
  result: Record<string, unknown>;
  outputRoot?: string;
  readFile?: (path: string) => Buffer;
}): DigestArtifactEvidence | null {
  const report = args.result.publicationReport as PublicationReport | undefined;
  if (args.result.migrationId !== "continuous-marketing-digest-v1"
    || report?.finalClassification !== "published"
    || report.schedulerCompletionContractStatus !== "passed") return null;
  const trigger = args.result.trigger as Record<string, unknown> | undefined;
  const scheduledFor = new Date(String(trigger?.scheduledFor ?? ""));
  if (!Number.isFinite(scheduledFor.getTime())) throw new Error("continuous_marketing_digest_scheduled_time_missing");
  const outputRoot = resolve(args.outputRoot ?? CONTINUOUS_MARKETING_DIGEST_OUTPUT_ROOT);
  const artifactPath = resolve(join(outputRoot, localParts(scheduledFor, "Europe/London").date, "graph-owned-daily-growth-digest.md"));
  if (artifactPath !== outputRoot && !artifactPath.startsWith(`${outputRoot}${sep}`)) throw new Error("continuous_marketing_digest_artifact_outside_output_root");
  const bytes = (args.readFile ?? readFileSync)(artifactPath);
  if (bytes.length === 0 || !bytes.toString("utf8", 0, Math.min(bytes.length, 128)).startsWith("# Graph-owned daily growth digest")) {
    throw new Error("continuous_marketing_digest_artifact_invalid");
  }
  return { path: artifactPath, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function schedulerCompletionContract(args: { detail: any; slotId: string; triggerId: string; runId?: string; maximumExternalWrites: number }): SchedulerCompletionContract {
  const effects = (args.detail?.externalEffects ?? []).filter((item: any) => item.state === "effect_verified");
  const predicates: SchedulerCompletionPredicate[] = [
    { name: "detail.run.status === \"completed\"", expected: "completed", actual: String(args.detail?.run?.status ?? "missing"), passed: args.detail?.run?.status === "completed" },
    { name: "detail.eventChainValid === true", expected: true, actual: args.detail?.eventChainValid ?? null, passed: args.detail?.eventChainValid === true },
    { name: "detail.childRunReceiptChainValid === true", expected: true, actual: args.detail?.childRunReceiptChainValid ?? null, passed: args.detail?.childRunReceiptChainValid === true },
    { name: "effects.length <= portfolio.maximumExternalWrites", expected: `<=${args.maximumExternalWrites}`, actual: effects.length, passed: effects.length <= args.maximumExternalWrites },
    { name: "verifier receipts accepted", expected: "no failed verifier receipts", actual: verifierResultFrom(args.detail), passed: verifierReceiptsAccepted(args.detail) },
  ];
  const chainValidationReasons = predicates.filter((item) => !item.passed).map((item) => `${item.name}: expected ${JSON.stringify(item.expected)} actual ${JSON.stringify(item.actual)}`);
  const terminal = ["failed", "cancelled"].includes(String(args.detail?.run?.status))
    || predicates.some((item) => item.name === "effects.length <= portfolio.maximumExternalWrites" && !item.passed)
    || predicates.some((item) => item.name === "verifier receipts accepted" && !item.passed)
    || args.detail?.eventChainValid === false
    || args.detail?.childRunReceiptChainValid === false;
  const allPassed = predicates.every((item) => item.passed);
  const activeEffects = (args.detail?.externalEffects ?? []).some((item: any) => ["request_sent", "provider_accepted", "ambiguous"].includes(item.state));
  const consumedCapability = args.detail?.liveCapability?.status === "consumed";
  return {
    status: allPassed ? "passed" : terminal ? "terminal" : "transient",
    transient: !allPassed && !terminal,
    recoverySafe: !activeEffects && !consumedCapability && effects.length === 0,
    originalSlot: args.slotId,
    triggerId: args.triggerId,
    runId: args.runId ?? optionalString(args.detail?.run?.runId),
    observedRunStatus: String(args.detail?.run?.status ?? "missing"),
    childReceiptIds: receiptIds(args.detail, "childRunReceipts"),
    verifierReceiptIds: receiptIds(args.detail, "verifierReceipts"),
    chainValidationReasons,
    effectCount: effects.length,
    maximumExternalWrites: args.maximumExternalWrites,
    predicates,
  };
}

async function waitForSchedulerCompletionContract(args: { request: HttpRequest; runId: string; slotId: string; triggerId: string; maximumExternalWrites: number; attempts: number; intervalMs: number }): Promise<{ detail: any; contract: SchedulerCompletionContract }> {
  let detail: any = null;
  let contract: SchedulerCompletionContract | null = null;
  for (let attempt = 0; attempt < args.attempts; attempt += 1) {
    detail = await args.request(`/api/graphs/runs/${args.runId}`);
    contract = schedulerCompletionContract({ detail, slotId: args.slotId, triggerId: args.triggerId, runId: args.runId, maximumExternalWrites: args.maximumExternalWrites });
    if (contract.status === "passed" || contract.status === "terminal") return { detail, contract };
    if (attempt < args.attempts - 1) await sleep(args.intervalMs + (args.intervalMs > 0 ? deterministicReadJitterMs(`${args.runId}:completion:${attempt}`) : 0));
  }
  const terminalRunObserved = ["completed", "failed", "cancelled"].includes(String(detail?.run?.status));
  return {
    detail,
    contract: {
      ...contract!,
      status: terminalRunObserved ? "terminal" : "transient",
      transient: !terminalRunObserved,
      chainValidationReasons: [
        ...contract!.chainValidationReasons,
        terminalRunObserved
          ? "sealed terminal state not observed before bounded polling limit"
          : "sealed terminal state not observed within bounded observation window",
      ],
    },
  };
}

export async function waitForApprovalBoundary(args: { request: HttpRequest; runId: string; initialDetail?: any; attempts?: number; intervalMs?: number }): Promise<any> {
  let detail: any = args.initialDetail ?? null;
  const attempts = args.attempts ?? GRAPH_SCHEDULER_APPROVAL_POLL_ATTEMPTS;
  const intervalMs = args.intervalMs ?? GRAPH_SCHEDULER_READ_POLL_INTERVAL_MS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const approvalResolved = Array.isArray(detail?.approvals)
      && detail.approvals.some((approval: any) => ["granted", "rejected", "expired"].includes(String(approval?.status)));
    if (approvalResolved || ["waiting_for_approval", "blocked", "paused", "waiting", "completed", "failed", "cancelled"].includes(String(detail?.run?.status))) return detail;
    await sleep(intervalMs + (intervalMs > 0 ? deterministicReadJitterMs(`${args.runId}:approval:${attempt}`) : 0));
    detail = await args.request(`/api/graphs/runs/${args.runId}`);
  }
  return detail;
}

export type GovernedScheduleExecutionArgs = {
  migrationId: string;
  now?: Date;
  schedulerPath?: string;
  request?: HttpRequest;
  recoveryTriggerId?: string;
  completionPollAttempts?: number;
  completionPollIntervalMs?: number;
  preSlotSleep?: (ms: number) => Promise<void>;
};

export async function executeGovernedSchedule(args: GovernedScheduleExecutionArgs): Promise<Record<string, unknown>> {
  const portfolio = governedSchedulerPortfolioEntry(args.migrationId);
  const request = args.request ?? defaultRequest;
  const store = new GraphSchedulerStore(args.schedulerPath ?? resolveGovernedSchedulerDatabasePath());
  const observedNow = args.now ?? new Date();
  let triggerId: string | undefined;
  let runId: string | undefined;
  let executionAcceptance: ExecutionAcceptance | undefined;
  try {
    const health = await request("/api/graphs/health");
    if (health?.status !== "healthy" || health?.zeroWriteOnly !== true) throw new Error("graph_scheduler_runtime_health_gate_failed");
    const migration = store.migration(args.migrationId);
    if (!migration || migration.status !== "graph_owned" || migration.graphDefinitionHash !== portfolio.declaration.graphDefinitionHash) throw new Error("graph_scheduler_migration_not_active_or_exact");
    const recoveryTrigger = args.recoveryTriggerId ? store.trigger(args.recoveryTriggerId) : null;
    if (args.recoveryTriggerId && (!recoveryTrigger || recoveryTrigger.migrationId !== args.migrationId)) throw new Error("graph_scheduler_recovery_trigger_not_found_or_mismatched");
    if (recoveryTrigger && !["failed_safe", "completed"].includes(recoveryTrigger.status)) throw new Error(`graph_scheduler_recovery_trigger_not_terminal_or_failed_safe:${recoveryTrigger.status}`);
    let slot: NaturalSlotResolution | { slotId: string; scheduledFor: string };
    if (recoveryTrigger) {
      slot = { slotId: recoveryTrigger.slotId, scheduledFor: recoveryTrigger.scheduledFor };
    } else {
      try {
        slot = resolveNaturalSlot({ now: observedNow, cronExpression: migration.cronExpression, timezone: migration.timezone, scheduleId: migration.scheduleId, provider: migration.provider, latenessToleranceMinutes: portfolio.latenessToleranceMinutes });
      } catch (error) {
        if (!isOutsideNaturalSlotWindow(error)) throw error;
        const reason = "outside_natural_slot_window";
        return {
          outcome: "deferred",
          reason,
          migrationId: args.migrationId,
          graph: `${migration.graphId}@${migration.graphVersion}`,
          definitionHash: migration.graphDefinitionHash,
          trigger: syntheticSkipTrigger(args.migrationId, observedNow, reason),
          providerWrites: 0,
          publicationReport: buildPublicationReport({
            detail: { run: { status: "completed" }, childReceiptChainValid: true },
            outcome: "deferred",
            providerWrites: 0,
            maximumExternalWrites: portfolio.maximumExternalWrites,
            eventChainValid: store.eventChainValid(args.migrationId),
            childReceiptChainValid: true,
            deferredReason: reason,
          }),
          eventChainValid: store.eventChainValid(args.migrationId),
          childReceiptChainValid: true,
        };
      }
    }
    if (!recoveryTrigger && slot.waitUntil) {
      const waitMs = Math.max(0, Date.parse(slot.waitUntil) - (args.now?.getTime() ?? Date.now()));
      await (args.preSlotSleep ?? sleep)(waitMs);
      const postWaitHealth = await request("/api/graphs/health");
      if (postWaitHealth?.status !== "healthy" || postWaitHealth?.zeroWriteOnly !== true) throw new Error("graph_scheduler_runtime_health_gate_failed_after_slot_wait");
    }
    const reservation = recoveryTrigger
      ? { trigger: recoveryTrigger, created: false }
      : store.reserveTrigger(args.migrationId, slot.slotId, slot.scheduledFor, `graph-scheduler:${args.migrationId}`);
    triggerId = reservation.trigger.triggerId;
    if (!reservation.created) {
      if (reservation.trigger.status === "completed") {
        runId = reservation.trigger.graphRunId;
        if (!runId) return { outcome: "duplicate_suppressed", trigger: reservation.trigger, providerWrites: 0 };
        const sealed = await waitForSchedulerCompletionContract({
          request,
          runId,
          slotId: slot.slotId,
          triggerId,
          maximumExternalWrites: portfolio.maximumExternalWrites,
          attempts: args.completionPollAttempts ?? 3,
          intervalMs: args.completionPollIntervalMs ?? 250,
        });
        const effects = (sealed.detail.externalEffects ?? []).filter((item: any) => item.state === "effect_verified");
        const effect = effects[0];
        const terminalReceipt = [...(sealed.detail.childRunReceipts ?? [])].reverse().find((item: any) => item.status === "succeeded");
        const terminalOutcome = typeof terminalReceipt?.outcome === "string" ? terminalReceipt.outcome : "completed";
        return {
          outcome: args.recoveryTriggerId ? terminalOutcome : "duplicate_suppressed",
          migrationId: args.migrationId,
          graph: `${migration.graphId}@${migration.graphVersion}`,
          definitionHash: migration.graphDefinitionHash,
          terminalReceipt: terminalReceipt
            ? { receiptId: terminalReceipt.receiptId, outcome: terminalReceipt.outcome, receiptHash: terminalReceipt.receiptHash }
            : terminalCheckpointFrom(sealed.detail),
          trigger: reservation.trigger,
          providerWrites: args.recoveryTriggerId ? effects.length : 0,
          publicationReport: buildPublicationReport({
            detail: sealed.detail,
            outcome: args.recoveryTriggerId ? terminalOutcome : "duplicate_suppressed",
            providerWrites: args.recoveryTriggerId ? effects.length : 0,
            maximumExternalWrites: portfolio.maximumExternalWrites,
            eventChainValid: sealed.detail.eventChainValid === true,
            childReceiptChainValid: sealed.detail.childRunReceiptChainValid === true,
            providerOperationId: args.recoveryTriggerId ? effect?.providerOperationId ?? null : null,
            completionContract: sealed.contract,
            recoveryResult: args.recoveryTriggerId ? "terminal_reconciled_no_replay" : "duplicate_suppressed",
            historicalEffect: args.recoveryTriggerId ? undefined : {
              providerWrites: effects.length,
              providerPostId: optionalString(effect?.providerOperationId),
              providerPostUrl: optionalString(reservation.trigger.permalink),
            },
          }),
          completionContract: sealed.contract,
          eventChainValid: sealed.detail.eventChainValid === true,
          childReceiptChainValid: sealed.detail.childRunReceiptChainValid === true,
        };
      }
      if (["reserved", "preparing", "executing", "ambiguous"].includes(reservation.trigger.status)) {
        runId = reservation.trigger.graphRunId;
        if (!runId) return { outcome: "concurrent_or_ambiguous_trigger_suppressed", trigger: reservation.trigger, providerWrites: 0 };
        executionAcceptance = {
          status: "reconciled_existing",
          runId,
          correlationId: triggerId,
          acceptedAt: reservation.trigger.updatedAt,
          durable: true,
        };
        if (reservation.trigger.status === "reserved") store.updateTrigger(triggerId, "preparing", `graph-scheduler:${args.migrationId}`, { graphRunId: runId });
        if (["reserved", "preparing"].includes(reservation.trigger.status)) store.updateTrigger(triggerId, "executing", `graph-scheduler:${args.migrationId}`, { graphRunId: runId });
        const sealed = await waitForSchedulerCompletionContract({
          request,
          runId,
          slotId: slot.slotId,
          triggerId,
          maximumExternalWrites: portfolio.maximumExternalWrites,
          attempts: args.completionPollAttempts ?? GRAPH_SCHEDULER_COMPLETION_POLL_ATTEMPTS,
          intervalMs: args.completionPollIntervalMs ?? GRAPH_SCHEDULER_READ_POLL_INTERVAL_MS,
        });
        const effects = (sealed.detail?.externalEffects ?? []).filter((item: any) => item.state === "effect_verified");
        if (sealed.contract.status === "transient") {
          return {
            outcome: "accepted_pending",
            migrationId: args.migrationId,
            graph: `${migration.graphId}@${migration.graphVersion}`,
            definitionHash: migration.graphDefinitionHash,
            trigger: store.trigger(triggerId),
            providerWrites: effects.length,
            executionAcceptance,
            completionContract: sealed.contract,
            publicationReport: buildPublicationReport({
              detail: sealed.detail,
              outcome: "deferred",
              providerWrites: effects.length,
              maximumExternalWrites: portfolio.maximumExternalWrites,
              eventChainValid: sealed.detail?.eventChainValid === true,
              childReceiptChainValid: sealed.detail?.childRunReceiptChainValid === true,
              deferredReason: "accepted_execution_pending_terminal_reconciliation",
              completionContract: sealed.contract,
              recoveryResult: "observe_same_run_no_replay",
            }),
          };
        }
        if (sealed.contract.status === "terminal") {
          const failed = store.updateTrigger(triggerId, reservation.trigger.status === "ambiguous" || !sealed.contract.recoverySafe ? "ambiguous" : "failed_safe", `graph-scheduler:${args.migrationId}`, {
            graphRunId: runId,
            failureReason: JSON.stringify({ type: "graph_scheduler_terminal_reconciliation_failed", runId, predicates: sealed.contract.predicates, chainValidationReasons: sealed.contract.chainValidationReasons }),
          });
          return { outcome: "completion_contract_failed", trigger: failed, providerWrites: effects.length, executionAcceptance, completionContract: sealed.contract };
        }
        const terminalReceipt = [...(sealed.detail.childRunReceipts ?? [])].reverse().find((item: any) => item.status === "succeeded");
        const terminalOutcome = typeof terminalReceipt?.outcome === "string" ? terminalReceipt.outcome : "completed";
        const completed = store.updateTrigger(triggerId, "completed", `graph-scheduler:${args.migrationId}`, { graphRunId: runId });
        return {
          outcome: terminalOutcome,
          migrationId: args.migrationId,
          graph: `${migration.graphId}@${migration.graphVersion}`,
          definitionHash: migration.graphDefinitionHash,
          trigger: completed,
          providerWrites: effects.length,
          executionAcceptance,
          completionContract: sealed.contract,
          publicationReport: buildPublicationReport({
            detail: sealed.detail,
            outcome: terminalOutcome,
            providerWrites: effects.length,
            maximumExternalWrites: portfolio.maximumExternalWrites,
            eventChainValid: true,
            childReceiptChainValid: true,
            completionContract: sealed.contract,
            recoveryResult: "terminal_reconciled_no_replay",
          }),
          eventChainValid: true,
          childReceiptChainValid: true,
        };
      }
      runId = reservation.trigger.graphRunId;
    }
    store.updateTrigger(triggerId, "preparing", `graph-scheduler:${args.migrationId}`, runId ? { graphRunId: runId, failureReason: undefined } : {});
    let detail: any;
    let executionNeedsDispatch = reservation.trigger.status === "failed_safe";
    if (!runId) {
      let created: any;
      try {
        created = await request("/api/graphs/runs/accepted", { method: "POST", body: JSON.stringify({
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
          publicationReport: buildPublicationReport({
            detail: { run: { status: "deferred" }, childReceiptChainValid: true },
            outcome: "deferred",
            providerWrites: 0,
            maximumExternalWrites: portfolio.maximumExternalWrites,
            eventChainValid: store.eventChainValid(args.migrationId),
            childReceiptChainValid: true,
            deferredReason: "definition_concurrency_exhausted",
          }),
          eventChainValid: store.eventChainValid(args.migrationId),
          childReceiptChainValid: true,
        };
      }
      runId = String(created.run.runId);
      executionAcceptance = {
        status: created.acceptance?.status === "already_accepted" ? "already_accepted" : "accepted",
        runId,
        correlationId: String(created.acceptance?.correlationId ?? triggerId),
        acceptedAt: String(created.acceptance?.acceptedAt ?? new Date().toISOString()),
        durable: true,
      };
      detail = await request(`/api/graphs/runs/${runId}`);
      store.updateTrigger(triggerId, "preparing", `graph-scheduler:${args.migrationId}`, { graphRunId: runId, approvalId: detail.approvals?.[0]?.approvalId });
    } else detail = await request(`/api/graphs/runs/${runId}`);

    if (reservation.trigger.status === "failed_safe") {
      const unsafeEffects = (detail?.externalEffects ?? []).filter((item: any) => item.state !== "not_requested" && item.state !== "confirmed_absent");
      if (unsafeEffects.length > 0 || detail?.liveCapability?.status === "consumed") {
        throw new Error("graph_scheduler_failed_safe_recovery_requires_zero_effects");
      }
      if (!detail?.run || detail.run.status === "failed" || detail.run.status === "cancelled") {
        const recovered = await request("/api/graphs/runs/accepted", { method: "POST", body: JSON.stringify({
          graphId: migration.graphId, version: migration.graphVersion, objective: `Graph-owned scheduled workflow recovery ${slot.slotId}`,
          correlationId: `${triggerId}:attempt:${reservation.trigger.attemptCount + 1}`, input: resolveInputTemplate(portfolio.input, slot), authority: portfolio.authority,
        }) });
        runId = String(recovered.run.runId);
        executionAcceptance = {
          status: recovered.acceptance?.status === "already_accepted" ? "already_accepted" : "accepted",
          runId,
          correlationId: String(recovered.acceptance?.correlationId ?? `${triggerId}:attempt:${reservation.trigger.attemptCount + 1}`),
          acceptedAt: String(recovered.acceptance?.acceptedAt ?? new Date().toISOString()),
          durable: true,
        };
        executionNeedsDispatch = false;
        detail = await request(`/api/graphs/runs/${runId}`);
        store.updateTrigger(triggerId, "preparing", `graph-scheduler:${args.migrationId}`, { graphRunId: runId });
      }
    }

    if (portfolio.approvalPolicy !== "none" && !["waiting_for_approval", "blocked", "paused", "waiting", "completed", "failed", "cancelled"].includes(String(detail.run?.status))) {
      detail = await waitForApprovalBoundary({ request, runId: runId!, initialDetail: detail });
    }
    if (detail.run?.status === "waiting_for_approval") {
      executionNeedsDispatch = true;
      const pendingApproval = detail.approvals?.find((item: any) => item.status === "pending");
      const grantedApproval = detail.approvals?.find((item: any) => item.status === "granted");
      if (portfolio.approvalPolicy === "none" || (!pendingApproval && !grantedApproval)) throw new Error("graph_scheduler_unexpected_approval_boundary");
      if (pendingApproval && portfolio.approvalPolicy === "prepared_payload_only" && !preparedPayloadApprovalId(detail)) throw new Error("graph_scheduler_exact_prepared_payload_approval_missing");
      const approval = pendingApproval ?? grantedApproval;
      const latestExpiry = new Date(Date.now() + 15 * 60_000);
      const expiryMs = grantedApproval?.expiresAt ? Math.min(latestExpiry.getTime(), Date.parse(grantedApproval.expiresAt)) : latestExpiry.getTime();
      if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) throw new Error("graph_scheduler_approval_expired_before_capability_issue");
      const expiresAt = new Date(expiryMs).toISOString();
      if (pendingApproval) {
        await request(`/api/graphs/runs/${runId}/approvals/${approval.approvalId}`, { method: "POST", body: JSON.stringify({ decision: "granted", action: approval.action, target: approval.target, payloadHash: approval.payloadHash, expiresAt, note: portfolio.approvalPolicy === "prepared_payload_only" ? `Bound to existing exact prepared payload approval ${String(preparedPayloadApprovalId(detail))}` : `Standing exact schedule authority ${args.migrationId}` }) });
      }
      if (!detail.liveCapability) await request(`/api/graphs/runs/${runId}/live-capabilities`, { method: "POST", body: JSON.stringify({ approvalId: approval.approvalId, expiresAt }) });
      detail = await request(`/api/graphs/runs/${runId}`);
    }
    if (!detail.liveCapability && ["running", "blocked"].includes(String(detail.run?.status))) {
      const approval = detail.approvals?.find((item: any) => item.status === "granted");
      if (approval) {
        executionNeedsDispatch = true;
        const expiryMs = Math.min(Date.now() + 15 * 60_000, Date.parse(approval.expiresAt));
        if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) throw new Error("graph_scheduler_approval_expired_before_capability_issue");
        await request(`/api/graphs/runs/${runId}/live-capabilities`, { method: "POST", body: JSON.stringify({ approvalId: approval.approvalId, expiresAt: new Date(expiryMs).toISOString() }) });
        detail = await request(`/api/graphs/runs/${runId}`);
      }
    }

    store.updateTrigger(triggerId, "executing", `graph-scheduler:${args.migrationId}`, { graphRunId: runId, approvalId: detail.approvals?.find((item: any) => item.status === "granted")?.approvalId, capabilityId: detail.liveCapability?.capabilityId });
    let resumed = false;
    if (["waiting_for_approval", "blocked", "paused", "waiting"].includes(String(detail.run?.status))) {
      await request(`/api/graphs/runs/${runId}/resume`, { method: "POST" });
      resumed = true;
    }
    if (resumed || executionNeedsDispatch) await request(`/api/graphs/runs/${runId}/execute-accepted`, { method: "POST" });
    const sealed = await waitForSchedulerCompletionContract({
      request,
      runId: runId!,
      slotId: slot.slotId,
      triggerId,
      maximumExternalWrites: portfolio.maximumExternalWrites,
      attempts: args.completionPollAttempts ?? GRAPH_SCHEDULER_COMPLETION_POLL_ATTEMPTS,
      intervalMs: args.completionPollIntervalMs ?? GRAPH_SCHEDULER_READ_POLL_INTERVAL_MS,
    });
    detail = sealed.detail;
    const completionContract = sealed.contract;
    const effects = (detail.externalEffects ?? []).filter((item: any) => item.state === "effect_verified");
    if (completionContract.status === "transient") {
      return {
        outcome: "accepted_pending",
        migrationId: args.migrationId,
        graph: `${migration.graphId}@${migration.graphVersion}`,
        definitionHash: migration.graphDefinitionHash,
        trigger: store.trigger(triggerId),
        providerWrites: effects.length,
        executionAcceptance,
        completionContract,
        publicationReport: buildPublicationReport({
          detail,
          outcome: "deferred",
          providerWrites: effects.length,
          maximumExternalWrites: portfolio.maximumExternalWrites,
          eventChainValid: detail.eventChainValid === true,
          childReceiptChainValid: detail.childRunReceiptChainValid === true,
          deferredReason: "accepted_execution_pending_terminal_reconciliation",
          completionContract,
          recoveryResult: "observe_same_run_no_replay",
        }),
        eventChainValid: detail.eventChainValid === true,
        childReceiptChainValid: detail.childRunReceiptChainValid === true,
      };
    }
    if (completionContract.status !== "passed") {
      const failed = store.updateTrigger(triggerId, completionContract.recoverySafe ? "failed_safe" : "ambiguous", `graph-scheduler:${args.migrationId}`, {
        graphRunId: runId,
        approvalId: detail.approvals?.find((item: any) => item.status === "granted")?.approvalId,
        capabilityId: detail.liveCapability?.capabilityId,
        failureReason: JSON.stringify({
          type: "graph_scheduler_completion_contract_classified",
          transient: completionContract.transient,
          recoverySafe: completionContract.recoverySafe,
          originalSlot: slot.slotId,
          originalTriggerId: triggerId,
          runId,
          predicates: completionContract.predicates,
          childReceiptIds: completionContract.childReceiptIds,
          verifierReceiptIds: completionContract.verifierReceiptIds,
          chainValidationReasons: completionContract.chainValidationReasons,
          effectCount: completionContract.effectCount,
          maximumExternalWrites: completionContract.maximumExternalWrites,
        }),
      });
      return {
        outcome: "completion_contract_failed",
        migrationId: args.migrationId,
        graph: `${migration.graphId}@${migration.graphVersion}`,
        definitionHash: migration.graphDefinitionHash,
        trigger: failed,
        providerWrites: effects.length,
        completionContract,
        publicationReport: buildPublicationReport({
          detail,
          outcome: "completion_contract_failed",
          providerWrites: effects.length,
          maximumExternalWrites: portfolio.maximumExternalWrites,
          eventChainValid: detail.eventChainValid === true,
          childReceiptChainValid: detail.childRunReceiptChainValid === true,
          completionContract,
          recoveryResult: completionContract.recoverySafe ? "failed_safe_recovery_available" : "recovery_refused_unsafe_or_ambiguous",
        }),
        eventChainValid: detail.eventChainValid === true,
        childReceiptChainValid: detail.childRunReceiptChainValid === true,
      };
    }
    if (portfolio.maximumExternalWrites === 1 && effects.length === 1 && detail.liveCapability?.status !== "consumed") throw new Error("graph_scheduler_live_capability_not_consumed");
    const effect = effects[0];
    const terminalReceipt = [...(detail.childRunReceipts ?? [])].reverse().find((item: any) => item.status === "succeeded");
    const terminalOutcome = typeof terminalReceipt?.outcome === "string" ? terminalReceipt.outcome : "completed";
    const publicationPermalink = optionalString(detail.run?.data?.socialEffect?.result?.permalink)
      ?? optionalString(detail.run?.data?.publicationLive?.readback?.permalink)
      ?? optionalString(detail.run?.data?.publicationLive?.result?.permalink);
    const completed = store.updateTrigger(triggerId, "completed", `graph-scheduler:${args.migrationId}`, { graphRunId: runId, approvalId: detail.approvals?.find((item: any) => item.status === "granted")?.approvalId, capabilityId: detail.liveCapability?.capabilityId, providerObjectId: effect?.providerOperationId, permalink: publicationPermalink ?? undefined });
    const publicationReport = buildPublicationReport({ detail, outcome: terminalOutcome, providerWrites: effects.length, maximumExternalWrites: portfolio.maximumExternalWrites, eventChainValid: true, childReceiptChainValid: true, providerOperationId: effect?.providerOperationId ?? null, completionContract, recoveryResult: args.recoveryTriggerId ? "original_slot_recovered" : "not_required" });
    return {
      outcome: terminalOutcome,
      migrationId: args.migrationId,
      graph: `${migration.graphId}@${migration.graphVersion}`,
      definitionHash: migration.graphDefinitionHash,
      terminalReceipt: terminalReceipt
        ? { receiptId: terminalReceipt.receiptId, outcome: terminalReceipt.outcome, receiptHash: terminalReceipt.receiptHash }
        : terminalCheckpointFrom(detail),
      trigger: completed,
      providerWrites: effects.length,
      executionAcceptance,
      publicationReport,
      completionContract,
      eventChainValid: true,
      childReceiptChainValid: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (triggerId) {
      try {
        if (!runId) {
          try {
            const correlated = await request(`/api/graphs/correlations/${encodeURIComponent(triggerId)}/run`);
            runId = optionalString(correlated?.run?.runId) ?? undefined;
          } catch { /* an unobserved start remains fail-closed */ }
        }
        const detail = runId ? await request(`/api/graphs/runs/${runId}`) : null;
        const ambiguous = Boolean(runId)
          || detail?.liveCapability?.status === "consumed"
          || detail?.externalEffects?.some((item: any) => ["request_sent", "provider_accepted", "ambiguous"].includes(item.state));
        store.updateTrigger(triggerId, ambiguous ? "ambiguous" : "failed_safe", `graph-scheduler:${args.migrationId}`, { graphRunId: runId, approvalId: detail?.approvals?.find((item: any) => item.status === "granted")?.approvalId, capabilityId: detail?.liveCapability?.capabilityId, failureReason: message });
      } catch { /* primary failure remains authoritative */ }
    }
    throw error;
  } finally { store.close(); }
}

async function main(): Promise<void> {
  if ((process.argv.length !== 4 && process.argv.length !== 6) || process.argv[2] !== "--migration-id" || !process.argv[3]) throw new Error("graph_scheduler_trigger_requires_exact_migration_reference");
  if (process.argv.length === 6 && process.argv[4] !== "--recover-trigger-id") throw new Error("graph_scheduler_recovery_requires_exact_trigger_reference");
  const scheduleResult = await executeGovernedSchedule({ migrationId: process.argv[3], recoveryTriggerId: process.argv[5] });
  const digestArtifact = resolveDigestArtifactEvidence({ result: scheduleResult });
  const result = digestArtifact ? { ...scheduleResult, digestArtifact } : scheduleResult;
  const trigger = result.trigger as Record<string, unknown>;
  mkdirSync(EVIDENCE_ROOT, { recursive: true, mode: 0o700 });
  const evidencePath = join(EVIDENCE_ROOT, `${String(trigger.triggerId)}.json`);
  if (!existsSync(evidencePath)) { writeFileSync(evidencePath, `${JSON.stringify({ recordedAt: new Date().toISOString(), ...result }, null, 2)}\n`, { mode: 0o600, flag: "wx" }); chmodSync(evidencePath, 0o600); }
  else if (result.publicationReport) {
    const correctivePath = join(EVIDENCE_ROOT, `${String(trigger.triggerId)}.corrective-${new Date().toISOString().replace(/[:.]/g, "")}.json`);
    writeFileSync(correctivePath, `${JSON.stringify({ recordedAt: new Date().toISOString(), correctiveFor: evidencePath, ...result }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    chmodSync(correctivePath, 0o600);
  }
  process.stdout.write(formatGovernedScheduleOutput(result, process.argv[3]!));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
