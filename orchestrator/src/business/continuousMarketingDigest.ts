import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

const WORKSPACE = "/home/oneclickwebsitedesignfactory/.openclaw/workspace";
const URL_PATTERN = /https:\/\/(?:www\.)?(?:instagram\.com|threads\.com)\/[^\s)\]}>"']+/g;

function bounded(path: string): string {
  const value = resolve(path);
  if (value !== WORKSPACE && !value.startsWith(`${WORKSPACE}${sep}`)) throw new Error("continuous_marketing_digest_path_outside_workspace");
  return value;
}

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

export type ContinuousMarketingDigest = {
  generatedAt: string;
  windowStartedAt: string;
  evidenceFiles: number;
  verifiedLinks: string[];
  blockers: string[];
  approvals: string[];
  summary: string;
  outputPath: string;
};

type EvidenceItem = { path: string; text: string; mtimeMs: number };
type EvidenceLine = { path: string; line: string; mtimeMs: number };
type RenderSlot = `${string}:${string}:${string}`;

function parseRenderSlot(value: string): RenderSlot | null {
  const compact = value.match(/\b(?:dynamic|instagram)-(reel|image)(?:-diagnostic)?-(\d{8})-(\d{4})-[a-z0-9-]+\b/i);
  if (compact) return `${compact[1].toLowerCase()}:${compact[2]}:${compact[3]}` as RenderSlot;
  const primitive = value.match(/\b(?:instagram|threads)-(reel|image)-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\b/i);
  return primitive ? `${primitive[1].toLowerCase()}:${primitive[2]}${primitive[3]}${primitive[4]}:${primitive[5]}${primitive[6]}` as RenderSlot : null;
}

function isSuccessfulLocalRenderReceipt(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.schema === "tailwagging-local-media-render-receipt.v1" && record.outcome === "success";
}

function successfulRenderSlots(evidence: EvidenceItem[]): Map<RenderSlot, number> {
  const slots = new Map<RenderSlot, number>();
  for (const item of evidence) {
    let record: unknown;
    try {
      record = JSON.parse(item.text);
    } catch {
      continue;
    }
    if (!isSuccessfulLocalRenderReceipt(record)) continue;
    const slot = parseRenderSlot(`${(record as Record<string, unknown>).slug ?? ""} ${item.path}`);
    if (slot) slots.set(slot, Math.max(slots.get(slot) ?? 0, item.mtimeMs));
  }
  return slots;
}

function isSupersededRenderFailureLine(line: string, path: string, lineMtimeMs: number, resolvedSlots: Map<RenderSlot, number>): boolean {
  if (!resolvedSlots.size || !/\b(?:failed|failure|error)\b/i.test(line)) return false;
  const slot = parseRenderSlot(`${line} ${path}`);
  return slot ? (resolvedSlots.get(slot) ?? 0) >= lineMtimeMs : false;
}

function isActionableBlockerLine(line: string): boolean {
  if (!/\b(?:blocker|blocked|failed|failure|unavailable|error)\b/i.test(line)) return false;
  if (/no blocker|0 failures?/i.test(line)) return false;
  if (/"failed"\s*:\s*0\b/i.test(line)) return false;
  if (/^"(?:state|outcome)"\s*:\s*"failed"/i.test(line)) return false;
  if (/^"caption"\s*:/i.test(line)) return false;
  if (/^Publications:.*\bfailed:\s*0\b/i.test(line)) return false;
  if (/^-\s*metric-[\w-]+:\s*unavailable\b/i.test(line)) return false;
  if (/^Unavailable values are not treated as zero\./i.test(line)) return false;
  return true;
}

export async function buildContinuousMarketingDigest(input: { observedAt: string; sourceRoot: string; missionPath: string; outputRoot: string }): Promise<ContinuousMarketingDigest> {
  const observedAt = new Date(input.observedAt);
  if (!Number.isFinite(observedAt.getTime())) throw new Error("continuous_marketing_digest_observed_at_invalid");
  const sourceRoot = bounded(input.sourceRoot), outputRoot = bounded(input.outputRoot), missionPath = bounded(input.missionPath);
  await stat(missionPath);
  const windowStartedAt = new Date(observedAt.getTime() - 24 * 60 * 60_000);
  const entries = await readdir(sourceRoot, { recursive: true, withFileTypes: true });
  const evidence: EvidenceItem[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(?:json|md|txt)$/i.test(entry.name)) continue;
    if (entry.name === "graph-owned-daily-growth-digest.md") continue;
    const parent = "parentPath" in entry && typeof entry.parentPath === "string" ? entry.parentPath : sourceRoot;
    const path = bounded(join(parent, entry.name));
    const info = await stat(path);
    if (info.mtimeMs < windowStartedAt.getTime() || info.mtimeMs > observedAt.getTime() + 5 * 60_000) continue;
    evidence.push({ path, text: await readFile(path, "utf8"), mtimeMs: info.mtimeMs });
  }
  const combined = evidence.map((item) => item.text).join("\n");
  const verifiedLinks = [...new Set(combined.match(URL_PATTERN) ?? [])].slice(0, 12);
  const lines = evidence.flatMap<EvidenceLine>((item) =>
    item.text.split(/\r?\n/).map((line) => ({ path: item.path, line: cleanLine(line), mtimeMs: item.mtimeMs })).filter((item) => Boolean(item.line))
  );
  const resolvedRenderSlots = successfulRenderSlots(evidence);
  const blockers = [...new Set(lines.filter((item) =>
    isActionableBlockerLine(item.line) &&
    !isSupersededRenderFailureLine(item.line, item.path, item.mtimeMs, resolvedRenderSlots)
  ).map((item) => item.line))].slice(0, 5);
  const approvals = [...new Set(lines.filter((item) => /\bapproval (?:needed|required|pending)\b/i.test(item.line)).map((item) => item.line))].slice(0, 5);
  const summaryLines = [
    `Daily growth evidence — preceding 24 hours`,
    `Evidence files: ${evidence.length}`,
    `Verified social objects: ${verifiedLinks.length}${verifiedLinks.length ? `\n${verifiedLinks.map((link) => `- ${link}`).join("\n")}` : " (none evidenced)"}`,
    `Blockers: ${blockers.length ? blockers.join(" | ") : "none evidenced"}`,
    `Approvals still needed: ${approvals.length ? approvals.join(" | ") : "none evidenced"}`,
    `Metrics not present in source evidence remain unavailable; no activity or metric was inferred.`,
  ];
  const summary = summaryLines.join("\n");
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(observedAt);
  const directory = bounded(join(outputRoot, date));
  await mkdir(directory, { recursive: true });
  const outputPath = bounded(join(directory, "graph-owned-daily-growth-digest.md"));
  const record = { generatedAt: observedAt.toISOString(), windowStartedAt: windowStartedAt.toISOString(), evidenceFiles: evidence.map((item) => basename(item.path)), verifiedLinks, blockers, approvals, summary };
  await writeFile(outputPath, `# Graph-owned daily growth digest\n\n${summary}\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`, "utf8");
  return { generatedAt: observedAt.toISOString(), windowStartedAt: windowStartedAt.toISOString(), evidenceFiles: evidence.length, verifiedLinks, blockers, approvals, summary, outputPath };
}
