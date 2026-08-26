import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

const WORKSPACE = "/home/oneclickwebsitedesignfactory/.openclaw/workspace";
const URL_PATTERN = /https:\/\/(?:www\.)?(?:instagram\.com|threads\.com)\/[^\s)\]}>"']+/g;
const DISPLAY_LINK_LIMIT = 12;

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
  verifiedLinksByPlatform: Record<SocialPlatform, string[]>;
  evidenceCoverage: EvidenceCoverage;
  blockers: string[];
  approvals: string[];
  summary: string;
  outputPath: string;
};

type EvidenceItem = { path: string; text: string; mtimeMs: number };
type EvidenceLine = { path: string; line: string; mtimeMs: number };
type RenderSlot = `${string}:${string}:${string}`;
type SocialPlatform = "instagram" | "threads";
type EvidenceCoverage = {
  instagramPublicationReceipts: number;
  threadsPublicationReceipts: number;
  metaReplyMonitorReceipts: number;
  connectorPrimitiveReceipts: number;
  localRenderReceipts: number;
  runtimeServiceEvidenceFiles: number;
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function socialPlatformFromUrl(value: string): SocialPlatform | null {
  if (/https:\/\/(?:www\.)?instagram\.com\//i.test(value)) return "instagram";
  if (/https:\/\/(?:www\.)?threads\.com\//i.test(value)) return "threads";
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseRenderSlot(value: string): RenderSlot | null {
  const compact = value.match(/\b(?:dynamic|instagram)-(reel|image)(?:-diagnostic)?-(\d{8})-(\d{4})-[a-z0-9-]+\b/i);
  if (compact) return `${compact[1].toLowerCase()}:${compact[2]}:${compact[3]}` as RenderSlot;
  const primitive = value.match(/\b(?:instagram|threads)-(reel|image)-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\b/i);
  return primitive ? `${primitive[1].toLowerCase()}:${primitive[2]}${primitive[3]}${primitive[4]}:${primitive[5]}${primitive[6]}` as RenderSlot : null;
}

function isSuccessfulLocalRenderReceipt(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const record = value;
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

function parseJsonEvidence(item: EvidenceItem): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(item.text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function nestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function stringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function isVerifiedPublicationReceipt(record: Record<string, unknown>): boolean {
  const runner = stringValue(record, "runner") ?? "";
  const status = stringValue(record, "status") ?? "";
  const committedSlotOutcome = stringValue(record, "committedSlotOutcome") ?? "";
  if (runner === "deterministic_threads_outbox_v1") return status === "published_verified";
  if (runner === "deterministic_instagram_media_outbox_v1") return status === "verified" || committedSlotOutcome === "published_verified";
  const liveResult = nestedRecord(record, "liveResult");
  const liveEvidence = liveResult ? nestedRecord(liveResult, "evidence") : null;
  return liveEvidence?.verified === true && typeof liveEvidence.permalink === "string";
}

function verifiedReceiptLinks(evidence: EvidenceItem[]): string[] {
  const links: string[] = [];
  for (const item of evidence) {
    const record = parseJsonEvidence(item);
    if (!record || !isVerifiedPublicationReceipt(record)) continue;
    const directPermalink = stringValue(record, "permalink");
    const liveResult = nestedRecord(record, "liveResult");
    const liveEvidence = liveResult ? nestedRecord(liveResult, "evidence") : null;
    const livePermalink = liveEvidence ? stringValue(liveEvidence, "permalink") : null;
    for (const link of [directPermalink, livePermalink]) if (link && socialPlatformFromUrl(link)) links.push(link);
  }
  return unique(links);
}

function groupSocialLinks(links: string[]): Record<SocialPlatform, string[]> {
  const grouped: Record<SocialPlatform, string[]> = { instagram: [], threads: [] };
  for (const link of links) {
    const platform = socialPlatformFromUrl(link);
    if (platform) grouped[platform].push(link);
  }
  return { instagram: unique(grouped.instagram), threads: unique(grouped.threads) };
}

function evidenceCoverage(evidence: EvidenceItem[]): EvidenceCoverage {
  const coverage: EvidenceCoverage = {
    instagramPublicationReceipts: 0,
    threadsPublicationReceipts: 0,
    metaReplyMonitorReceipts: 0,
    connectorPrimitiveReceipts: 0,
    localRenderReceipts: 0,
    runtimeServiceEvidenceFiles: 0,
  };
  for (const item of evidence) {
    const record = parseJsonEvidence(item);
    const runner = record ? stringValue(record, "runner") : null;
    if (runner === "deterministic_instagram_media_outbox_v1") coverage.instagramPublicationReceipts += 1;
    if (runner === "deterministic_threads_outbox_v1") coverage.threadsPublicationReceipts += 1;
    if (runner === "deterministic_meta_reply_monitor_outbox_v2") coverage.metaReplyMonitorReceipts += 1;
    if (item.path.includes("relay_live_business_engagement_")) coverage.connectorPrimitiveReceipts += 1;
    if (record?.schema === "tailwagging-local-media-render-receipt.v1" || isRecord(record?.rendererReceipt)) coverage.localRenderReceipts += 1;
    if (/\b(?:systemd|orchestrator|service|health|scheduler)\b/i.test(item.path)) coverage.runtimeServiceEvidenceFiles += 1;
  }
  return coverage;
}

function formatPlatformLinks(platform: SocialPlatform, links: string[]): string {
  const label = platform === "instagram" ? "Instagram" : "Threads";
  const displayed = links.slice(0, DISPLAY_LINK_LIMIT);
  const more = links.length > displayed.length ? `\n  (+${links.length - displayed.length} more in digest record)` : "";
  return `- ${label}: ${links.length}${displayed.length ? `\n${displayed.map((link) => `  - ${link}`).join("\n")}${more}` : ""}`;
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
  evidence.sort((left, right) => left.mtimeMs - right.mtimeMs || left.path.localeCompare(right.path));
  const combined = evidence.map((item) => item.text).join("\n");
  const receiptLinks = verifiedReceiptLinks(evidence);
  const verifiedLinks = receiptLinks.length ? receiptLinks : unique(combined.match(URL_PATTERN) ?? []);
  const verifiedLinksByPlatform = groupSocialLinks(verifiedLinks);
  const coverage = evidenceCoverage(evidence);
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
    `Source boundary: ${sourceRoot === WORKSPACE ? "." : sourceRoot.replace(`${WORKSPACE}${sep}`, "")}`,
    `Evidence files: ${evidence.length}`,
    `Verified social objects: ${verifiedLinks.length}`,
    formatPlatformLinks("instagram", verifiedLinksByPlatform.instagram),
    formatPlatformLinks("threads", verifiedLinksByPlatform.threads),
    `Evidence coverage: Instagram publication receipts ${coverage.instagramPublicationReceipts}; Threads publication receipts ${coverage.threadsPublicationReceipts}; reply-monitor receipts ${coverage.metaReplyMonitorReceipts}; connector primitive receipts ${coverage.connectorPrimitiveReceipts}; local-render receipts ${coverage.localRenderReceipts}`,
    `Runtime/service evidence in digest source: ${coverage.runtimeServiceEvidenceFiles ? `${coverage.runtimeServiceEvidenceFiles} file(s)` : "none evidenced; this digest reads artifact files and does not inspect systemd journal/state directly"}`,
    `Blockers: ${blockers.length ? blockers.join(" | ") : "none evidenced"}`,
    `Approvals still needed: ${approvals.length ? approvals.join(" | ") : "none evidenced"}`,
    `Metrics not present in source evidence remain unavailable; no activity or metric was inferred.`,
  ];
  const summary = summaryLines.join("\n");
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(observedAt);
  const directory = bounded(join(outputRoot, date));
  await mkdir(directory, { recursive: true });
  const outputPath = bounded(join(directory, "graph-owned-daily-growth-digest.md"));
  const record = { generatedAt: observedAt.toISOString(), windowStartedAt: windowStartedAt.toISOString(), evidenceFiles: evidence.map((item) => basename(item.path)), verifiedLinks, verifiedLinksByPlatform, evidenceCoverage: coverage, blockers, approvals, summary };
  await writeFile(outputPath, `# Graph-owned daily growth digest\n\n${summary}\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`, "utf8");
  return { generatedAt: observedAt.toISOString(), windowStartedAt: windowStartedAt.toISOString(), evidenceFiles: evidence.length, verifiedLinks, verifiedLinksByPlatform, evidenceCoverage: coverage, blockers, approvals, summary, outputPath };
}
