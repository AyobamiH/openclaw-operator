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

export async function buildContinuousMarketingDigest(input: { observedAt: string; sourceRoot: string; missionPath: string; outputRoot: string }): Promise<ContinuousMarketingDigest> {
  const observedAt = new Date(input.observedAt);
  if (!Number.isFinite(observedAt.getTime())) throw new Error("continuous_marketing_digest_observed_at_invalid");
  const sourceRoot = bounded(input.sourceRoot), outputRoot = bounded(input.outputRoot), missionPath = bounded(input.missionPath);
  await stat(missionPath);
  const windowStartedAt = new Date(observedAt.getTime() - 24 * 60 * 60_000);
  const entries = await readdir(sourceRoot, { recursive: true, withFileTypes: true });
  const evidence: Array<{ path: string; text: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(?:json|md|txt)$/i.test(entry.name)) continue;
    const parent = "parentPath" in entry && typeof entry.parentPath === "string" ? entry.parentPath : sourceRoot;
    const path = bounded(join(parent, entry.name));
    const info = await stat(path);
    if (info.mtimeMs < windowStartedAt.getTime() || info.mtimeMs > observedAt.getTime() + 5 * 60_000) continue;
    evidence.push({ path, text: await readFile(path, "utf8") });
  }
  const combined = evidence.map((item) => item.text).join("\n");
  const verifiedLinks = [...new Set(combined.match(URL_PATTERN) ?? [])].slice(0, 12);
  const lines = combined.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const blockers = [...new Set(lines.filter((line) => /\b(?:blocker|blocked|failed|failure|unavailable)\b/i.test(line) && !/no blocker|0 failures?/i.test(line)))].slice(0, 5);
  const approvals = [...new Set(lines.filter((line) => /\bapproval (?:needed|required|pending)\b/i.test(line)))].slice(0, 5);
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
