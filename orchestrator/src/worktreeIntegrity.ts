import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export const INTEGRITY_STATES = [
  "HEALTHY",
  "WORKTREE_METADATA_LOST",
  "WORKING_TREE_CONTENT_LOST",
  "FILESYSTEM_DAMAGE_DETECTED",
] as const;
export type IntegrityState = (typeof INTEGRITY_STATES)[number];

export interface WorktreeRegistration {
  repoRoot: string;
  worktreePath: string;
  gitDir: string;
  branchOrDetached: string;
  head: string;
  registered: boolean;
  prunable?: string;
}

export interface WorktreeBaseline {
  schemaVersion: 1;
  baselineId: string;
  repoRoot: string;
  worktreePath: string;
  gitDir: string;
  branchOrDetached: string;
  head: string;
  trackedFileCount: number;
  trackedFiles: string[];
  baselineHash: string;
  timestamp: string;
}

export interface WorktreeObservation {
  schemaVersion: 1;
  observationId: string;
  baselineId: string;
  timestamp: string;
  state: IntegrityState;
  firstObservedDamageAt: string | null;
  repoRoot: string;
  worktreePath: string;
  gitDir: string;
  branchOrDetached: string;
  head: string | null;
  registered: boolean;
  registration: WorktreeRegistration | null;
  trackedFileCount: number | null;
  missingTrackedFileCount: number;
  missingTrackedFiles: string[];
  baselineHash: string;
  currentHash: string | null;
}

export interface IntegrityCheckResult {
  checkedAt: string;
  observations: WorktreeObservation[];
  incidents: WorktreeObservation[];
  protectedWorktrees: string[];
}

function canonical(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function splitNul(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function writeDurable(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, "a", 0o600);
  try {
    appendFileSync(fd, value, { encoding: "utf8" });
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try { chmodSync(path, 0o600); } catch { /* best effort on non-POSIX fixtures */ }
}

function readJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return null; }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temp, path);
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
}

function parseWorktreePorcelain(repoRoot: string, raw: string): WorktreeRegistration[] {
  const records: WorktreeRegistration[] = [];
  for (const block of raw.split(/\n\n+/)) {
    const fields = new Map<string, string>();
    for (const line of block.split("\n")) {
      const match = /^(\w+) ?(.*)$/.exec(line);
      if (match) fields.set(match[1], match[2]);
    }
    const worktree = fields.get("worktree");
    const head = fields.get("HEAD");
    if (!worktree || !head || fields.has("bare")) continue;
    let gitDir = fields.get("gitdir");
    if (!gitDir) {
      try { gitDir = git(worktree, ["rev-parse", "--git-dir"]); } catch { gitDir = join(worktree, ".git"); }
    }
    records.push({
      repoRoot: canonical(repoRoot),
      worktreePath: canonical(worktree),
      gitDir: canonical(resolve(worktree, gitDir)),
      branchOrDetached: fields.get("branch")?.replace(/^refs\/heads\//, "") ?? "detached",
      head,
      registered: true,
      ...(fields.get("prunable") ? { prunable: fields.get("prunable") } : {}),
    });
  }
  return records;
}

export function discoverRegisteredWorktrees(repoRoot: string): WorktreeRegistration[] {
  const root = canonical(repoRoot);
  return parseWorktreePorcelain(root, git(root, ["worktree", "list", "--porcelain"]));
}

export function discoverRelevantRepositories(authoritativeRoot: string, maxDepth = 3): string[] {
  const result = new Set<string>();
  const visit = (path: string, depth: number): void => {
    if (depth > maxDepth || !existsSync(path)) return;
    let entries;
    try { entries = readdirSync(path, { withFileTypes: true }); } catch { return; }
    // A linked worktree has a `.git` file. Only repository roots with a real
    // `.git` directory are discovery roots; `git worktree list` expands the
    // linked worktrees from that owner and avoids duplicate baselines.
    if (depth > 0 && entries.some((entry) => entry.name === ".git" && entry.isDirectory())) {
      result.add(canonical(path));
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || ["node_modules", ".git", "dist", ".cache"].includes(entry.name)) continue;
      visit(join(path, entry.name), depth + 1);
    }
  };
  visit(canonical(authoritativeRoot), 0);
  return [...result].sort();
}

function trackedFiles(worktreePath: string): string[] {
  return splitNul(git(worktreePath, ["ls-files", "-z"]));
}

function indexIdentity(worktreePath: string): string {
  return git(worktreePath, ["ls-files", "-s", "-z"]);
}

function baselineId(repoRoot: string, worktreePath: string): string {
  return hash(`${canonical(repoRoot)}\0${canonical(worktreePath)}`).slice(0, 32);
}

function baselinePath(stateDir: string, id: string): string { return join(stateDir, "baselines", `${id}.json`); }

function baselineFor(registration: WorktreeRegistration, timestamp: string): WorktreeBaseline {
  let files: string[] = [];
  let identity = `unavailable:${registration.head}`;
  try {
    files = trackedFiles(registration.worktreePath);
    identity = indexIdentity(registration.worktreePath);
  } catch {
    // A prunable historical registration may already have lost its path. Keep
    // the registration/HEAD truth and record the degradation instead of
    // refusing to activate the witness for every other worktree.
  }
  return {
    schemaVersion: 1,
    baselineId: baselineId(registration.repoRoot, registration.worktreePath),
    repoRoot: registration.repoRoot,
    worktreePath: registration.worktreePath,
    gitDir: registration.gitDir,
    branchOrDetached: registration.branchOrDetached,
    head: registration.head,
    trackedFileCount: files.length,
    trackedFiles: files,
    baselineHash: hash(`${identity}\0${files.join("\0")}`),
    timestamp,
  };
}

function missingFiles(worktreePath: string, files: string[], limit = 10_000): string[] {
  const missing: string[] = [];
  for (const file of files) {
    try { if (!statSync(join(worktreePath, file)).isFile()) missing.push(file); }
    catch { missing.push(file); }
    if (missing.length >= limit) break;
  }
  return missing;
}

function previousObservation(stateDir: string, id: string): WorktreeObservation | null {
  const path = join(stateDir, "observations", `${id}.json`);
  return readJson<WorktreeObservation>(path);
}

function incidentPath(stateDir: string, observation: WorktreeObservation): string {
  const stamp = observation.timestamp.replace(/[:.]/g, "-");
  return join(stateDir, "incidents", `${stamp}-${observation.baselineId}.json`);
}

function observe(baseline: WorktreeBaseline, registration: WorktreeRegistration | null, timestamp: string): WorktreeObservation {
  const pathExists = existsSync(baseline.worktreePath);
  let state: IntegrityState = "HEALTHY";
  let head: string | null = null;
  let currentHash: string | null = null;
  let trackedFileCount: number | null = null;
  let missing: string[] = [];
  if (!pathExists || !statSync(baseline.worktreePath).isDirectory()) {
    state = "FILESYSTEM_DAMAGE_DETECTED";
  } else if (!registration) {
    state = "WORKTREE_METADATA_LOST";
  } else {
    try {
      const gitDir = git(baseline.worktreePath, ["rev-parse", "--git-dir"]);
      if (!existsSync(canonical(resolve(baseline.worktreePath, gitDir)))) state = "WORKTREE_METADATA_LOST";
      else {
        head = git(baseline.worktreePath, ["rev-parse", "HEAD"]);
        const files = trackedFiles(baseline.worktreePath);
        trackedFileCount = files.length;
        missing = missingFiles(baseline.worktreePath, baseline.trackedFiles);
        currentHash = hash(`${indexIdentity(baseline.worktreePath)}\0${files.join("\0")}`);
        if (missing.length > 0) state = "WORKING_TREE_CONTENT_LOST";
      }
    } catch {
      state = "WORKTREE_METADATA_LOST";
    }
  }
  return {
    schemaVersion: 1,
    observationId: randomUUID(),
    baselineId: baseline.baselineId,
    timestamp,
    state,
    firstObservedDamageAt: state === "HEALTHY" ? null : timestamp,
    repoRoot: baseline.repoRoot,
    worktreePath: baseline.worktreePath,
    gitDir: baseline.gitDir,
    branchOrDetached: registration?.branchOrDetached ?? baseline.branchOrDetached,
    head: head ?? registration?.head ?? null,
    registered: Boolean(registration),
    registration,
    trackedFileCount,
    missingTrackedFileCount: missing.length,
    missingTrackedFiles: missing,
    baselineHash: baseline.baselineHash,
    currentHash,
  };
}

export function runIntegrityCheck(args: {
  repoRoots: string[];
  stateDir: string;
  now?: Date;
  maxIncidents?: number;
}): IntegrityCheckResult {
  const checkedAt = (args.now ?? new Date()).toISOString();
  mkdirSync(args.stateDir, { recursive: true, mode: 0o700 });
  const scopedRoots = new Set(args.repoRoots.map(canonical));
  const registrations = args.repoRoots.flatMap((root) => {
    try { return discoverRegisteredWorktrees(root); } catch { return []; }
  });
  const byId = new Map<string, WorktreeRegistration>();
  for (const registration of registrations) byId.set(baselineId(registration.repoRoot, registration.worktreePath), registration);
  const baselines = new Map<string, WorktreeBaseline>();
  for (const registration of registrations) {
    const id = baselineId(registration.repoRoot, registration.worktreePath);
    const path = baselinePath(args.stateDir, id);
    const existing = readJson<WorktreeBaseline>(path);
    const baseline = existing ?? baselineFor(registration, checkedAt);
    if (!existing) writeJson(path, baseline);
    baselines.set(id, baseline);
  }
  // Historical baselines remain authoritative even after a registration disappears.
  try {
    for (const entry of readdirSync(join(args.stateDir, "baselines"))) {
      if (!entry.endsWith(".json")) continue;
      const baseline = readJson<WorktreeBaseline>(join(args.stateDir, "baselines", entry));
      if (baseline) baselines.set(baseline.baselineId, baseline);
    }
  } catch { /* first run */ }
  const observations: WorktreeObservation[] = [];
  const incidents: WorktreeObservation[] = [];
  for (const baseline of baselines.values()) {
    if (scopedRoots.size > 0 && !scopedRoots.has(canonical(baseline.repoRoot))) continue;
    const current = byId.get(baseline.baselineId) ?? null;
    const observation = observe(baseline, current, checkedAt);
    const previous = previousObservation(args.stateDir, baseline.baselineId);
    if (observation.state !== "HEALTHY") {
      observation.firstObservedDamageAt = previous?.state === observation.state && previous.firstObservedDamageAt
        ? previous.firstObservedDamageAt
        : checkedAt;
      const incident = { ...observation };
      if (previous?.state !== observation.state) {
        writeJson(incidentPath(args.stateDir, incident), incident);
        incidents.push(incident);
      }
    }
    writeJson(join(args.stateDir, "observations", `${baseline.baselineId}.json`), observation);
    observations.push(observation);
  }
  try {
    const incidentFiles = readdirSync(join(args.stateDir, "incidents")).filter((name) => name.endsWith(".json")).sort();
    const keep = 1000;
    for (const file of incidentFiles.slice(0, Math.max(0, incidentFiles.length - keep))) {
      try { unlinkSync(join(args.stateDir, "incidents", file)); } catch { /* retention is best effort */ }
    }
  } catch { /* first run */ }
  const boundedIncidents = incidents.slice(-Math.max(1, args.maxIncidents ?? 100));
  writeJson(join(args.stateDir, "active.json"), { schemaVersion: 1, checkedAt, observations, protectedWorktrees: observations.map((item) => item.worktreePath).sort() });
  writeDurable(join(args.stateDir, "runs.jsonl"), `${JSON.stringify({ schemaVersion: 1, checkedAt, states: observations.map((item) => ({ baselineId: item.baselineId, state: item.state })) })}\n`);
  return { checkedAt, observations, incidents: boundedIncidents, protectedWorktrees: observations.map((item) => item.worktreePath).sort() };
}

export function loadBaselines(stateDir: string): WorktreeBaseline[] {
  try {
    return readdirSync(join(stateDir, "baselines")).filter((name) => name.endsWith(".json")).map((name) => readJson<WorktreeBaseline>(join(stateDir, "baselines", name))).filter((value): value is WorktreeBaseline => value !== null);
  } catch { return []; }
}

export function isPathWithin(child: string, parent: string): boolean {
  const c = canonical(child);
  const p = canonical(parent);
  return c === p || c.startsWith(`${p}${sep}`);
}

export function relativePath(child: string, parent: string): string { return relative(canonical(parent), canonical(child)); }
