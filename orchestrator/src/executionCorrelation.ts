import { isPathWithin } from "./worktreeIntegrity.js";
import type { ExecutionReceipt } from "./executionReceipts.js";

export type CorrelationOutcome =
  | "OWNER_IDENTIFIED"
  | "STRONG_PROCESS_CORRELATION"
  | "MULTIPLE_CANDIDATES"
  | "NO_CONTROLLED_PROCESS_MATCH"
  | "ATTRIBUTION_INCOMPLETE";

export interface KernelEvidence {
  syscall?: string;
  path?: string;
  pid?: number;
  ppid?: number;
  uid?: number;
  comm?: string;
  cgroup?: string;
}

export interface DamageWindow {
  start: string;
  end: string;
}

export interface DamageIncidentForCorrelation {
  worktreePath: string;
  repoRoot?: string;
  firstObservedDamageAt: string;
  observedAt?: string;
  timestamp?: string;
  missingTrackedFileCount?: number;
  missingTrackedFiles?: string[];
  damageWindow?: DamageWindow;
}

export interface CorrelationCandidate {
  eventId: string;
  score: number;
  matchedBy: string[];
  start: ExecutionReceipt;
  end: ExecutionReceipt | null;
}

export interface CorrelationResult {
  schemaVersion: 1;
  outcome: CorrelationOutcome;
  damageWindow: DamageWindow;
  worktreePath: string;
  missingTrackedFileCount: number;
  candidates: CorrelationCandidate[];
  kernelEvidence: KernelEvidence | null;
  explanation: string;
}

function time(value: string): number { return new Date(value).getTime(); }
function within(value: string, start: number, end: number): boolean { const parsed = time(value); return Number.isFinite(parsed) && parsed >= start && parsed <= end; }
function pathArgMatches(receipt: ExecutionReceipt, incident: DamageIncidentForCorrelation): boolean {
  const paths = [incident.worktreePath, ...(incident.missingTrackedFiles ?? [])];
  return paths.some((path) => receipt.fullArgv.some((arg) => arg.includes(path))) || receipt.fullArgv.some((arg) => isPathWithin(incident.worktreePath, arg));
}

export function correlateDamage(args: {
  incident: DamageIncidentForCorrelation;
  receipts: ExecutionReceipt[];
  kernelEvidence?: KernelEvidence;
  windowPaddingMs?: number;
}): CorrelationResult {
  const padding = args.windowPaddingMs ?? 5_000;
  const defaultWindow = { start: args.incident.firstObservedDamageAt, end: args.incident.observedAt ?? args.incident.timestamp ?? args.incident.firstObservedDamageAt };
  const damageWindow = args.incident.damageWindow ?? defaultWindow;
  const start = time(damageWindow.start) - padding;
  const end = time(damageWindow.end) + padding;
  const starts = args.receipts.filter((receipt) => receipt.phase === "start" && within(receipt.timestamp, start, end));
  const ends = new Map(args.receipts.filter((receipt) => receipt.phase === "end").map((receipt) => [receipt.eventId, receipt]));
  const candidates = starts.map((receipt): CorrelationCandidate => {
    let score = 1;
    const matchedBy: string[] = ["timestamp"];
    if (receipt.worktreePath === args.incident.worktreePath) { score += 5; matchedBy.push("worktree"); }
    if (args.incident.repoRoot && receipt.repoRoot === args.incident.repoRoot) { score += 2; matchedBy.push("repo"); }
    if (isPathWithin(receipt.cwd, args.incident.worktreePath) || isPathWithin(args.incident.worktreePath, receipt.cwd)) { score += 3; matchedBy.push("cwd"); }
    if (pathArgMatches(receipt, args.incident)) { score += 3; matchedBy.push("command-path"); }
    const kernel = args.kernelEvidence;
    const endReceipt = ends.get(receipt.eventId) ?? null;
    if (kernel?.pid !== undefined && endReceipt?.pid === kernel.pid) { score += 5; matchedBy.push("pid"); }
    if (kernel?.ppid !== undefined && receipt.ppid === kernel.ppid) { score += 2; matchedBy.push("ppid"); }
    if (kernel?.uid !== undefined && receipt.uid === kernel.uid) { score += 1; matchedBy.push("uid"); }
    if (kernel?.cgroup && receipt.cgroupOrService === kernel.cgroup) { score += 2; matchedBy.push("cgroup"); }
    if (kernel?.comm && receipt.executable.endsWith(`/${kernel.comm}`)) { score += 2; matchedBy.push("comm"); }
    if (kernel?.path && receipt.fullArgv.some((arg) => arg.includes(kernel.path!))) { score += 2; matchedBy.push("kernel-path"); }
    return { eventId: receipt.eventId, score, matchedBy, start: receipt, end: endReceipt };
  }).sort((a, b) => b.score - a.score || a.eventId.localeCompare(b.eventId));
  const top = candidates[0];
  let outcome: CorrelationOutcome;
  let explanation: string;
  if (!top) {
    outcome = args.kernelEvidence && (args.kernelEvidence.pid !== undefined || args.kernelEvidence.path) ? "ATTRIBUTION_INCOMPLETE" : "NO_CONTROLLED_PROCESS_MATCH";
    explanation = outcome === "ATTRIBUTION_INCOMPLETE" ? "Kernel evidence exists, but no bounded controlled receipt matched the damage window." : "No controlled execution receipt fell inside the bounded damage window.";
  } else if (candidates.length > 1 && candidates[1].score >= top.score - 1) {
    outcome = "MULTIPLE_CANDIDATES";
    explanation = "More than one controlled receipt has comparable evidence; no owner is accused.";
  } else if (top.score >= 12 && top.matchedBy.includes("command-path")) {
    outcome = "OWNER_IDENTIFIED";
    explanation = "One receipt matches the exact worktree/path and process context in the bounded damage window.";
  } else if (top.score >= 6) {
    outcome = "STRONG_PROCESS_CORRELATION";
    explanation = "One receipt has strong process/worktree correlation, but exact ownership evidence is incomplete.";
  } else {
    outcome = args.kernelEvidence ? "ATTRIBUTION_INCOMPLETE" : "NO_CONTROLLED_PROCESS_MATCH";
    explanation = "A receipt exists in the time window, but it lacks sufficient ownership evidence.";
  }
  return {
    schemaVersion: 1,
    outcome,
    damageWindow,
    worktreePath: args.incident.worktreePath,
    missingTrackedFileCount: args.incident.missingTrackedFileCount ?? 0,
    candidates,
    kernelEvidence: args.kernelEvidence ?? null,
    explanation,
  };
}
