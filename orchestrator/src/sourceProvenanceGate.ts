import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const SOURCE_PROVENANCE_OUTCOMES = [
  "WRONG_REPO",
  "WRONG_WORKTREE",
  "WRONG_RUNTIME_OWNER",
  "STALE_BASE",
  "LIVE_HASH_DRIFT",
  "TESTED_NOT_ACTIVATED",
  "ACTIVATED_NOT_RELOADED",
  "RUNTIME_HASH_MISMATCH",
  "ACTIVATED_WAITING_FOR_RUNTIME_WITNESS",
  "PROVEN_ACTIVE",
] as const;

export type SourceProvenanceOutcome = (typeof SOURCE_PROVENANCE_OUTCOMES)[number];

export type SourceProvenanceManifest = {
  schemaVersion: 1;
  expectedRuntimeOwner: string;
  serviceOrRunnerId: string;
  expectedRepoRoot: string;
  expectedGitDir: string;
  expectedWorktree: string;
  expectedBranchOrDetachedState: string;
  baseCommit: string;
  targetFile: string;
  liveTargetPath: string;
  preEditLiveHash: string;
};

export type ObservedSourceState = {
  runtimeOwner: string;
  repoRoot: string;
  gitDir: string;
  worktree: string;
  branchOrDetachedState: string;
  head: string;
  liveTargetPath: string;
  liveHash: string;
};

export type SourceProvenanceDecision = {
  allowed: boolean;
  outcome: SourceProvenanceOutcome;
  reason: string;
  evidenceHash: string;
};

export type ActivationProof = {
  testedWorktree: string;
  testedCommit: string;
  testedFileHash: string;
  activationSourceHash: string;
  liveTargetPath: string;
  preActivationLiveHash: string;
  activatedFileHash: string;
  expectedPreActivationLiveHash: string;
  exactActivatedHashTested?: boolean;
};

export type ResidentRuntimeProof = {
  kind: "resident";
  runningPid: number;
  processStartTime: string;
  runningCwd: string;
  runningEntrypoint: string;
  runningSourcePath: string;
  runningFileHash: string;
  serviceUnitAndDropinDigest: string;
  startOrReloadEvent: string;
  activationTime: string;
  postActivationHealth: "healthy" | "unhealthy";
};

export type EphemeralRuntimeProof = {
  kind: "ephemeral";
  witnessed: boolean;
  pid?: number;
  commandLine?: string;
  sourcePath?: string;
  sourceHash?: string;
  terminalReceipt?: string;
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

function decision(allowed: boolean, outcome: SourceProvenanceOutcome, reason: string, evidence: unknown): SourceProvenanceDecision {
  return { allowed, outcome, reason, evidenceHash: createHash("sha256").update(canonical(evidence)).digest("hex") };
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitOptional(cwd: string, args: string[]): string {
  try { return git(cwd, args); } catch { return ""; }
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try { return realpathSync(absolute); } catch { return absolute; }
}

export function inspectSourceState(args: {
  worktree: string;
  runtimeOwner: string;
  liveTargetPath: string;
}): ObservedSourceState {
  const worktree = canonicalPath(args.worktree);
  const repoRoot = canonicalPath(git(worktree, ["rev-parse", "--show-toplevel"]));
  const gitDirRaw = git(worktree, ["rev-parse", "--git-dir"]);
  const gitDir = canonicalPath(isAbsolute(gitDirRaw) ? gitDirRaw : resolve(worktree, gitDirRaw));
  const branch = gitOptional(worktree, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const liveTargetPath = canonicalPath(args.liveTargetPath);
  return {
    runtimeOwner: args.runtimeOwner,
    repoRoot,
    gitDir,
    worktree,
    branchOrDetachedState: branch || "DETACHED",
    head: git(worktree, ["rev-parse", "HEAD"]),
    liveTargetPath,
    liveHash: sha256File(liveTargetPath),
  };
}

function samePath(left: string, right: string): boolean {
  return canonicalPath(left) === canonicalPath(right);
}

export function verifyPreEditManifest(manifest: SourceProvenanceManifest, observed: ObservedSourceState): SourceProvenanceDecision {
  if (!samePath(observed.repoRoot, manifest.expectedRepoRoot) || !samePath(observed.gitDir, manifest.expectedGitDir)) {
    return decision(false, "WRONG_REPO", "Git toplevel or git-dir ownership differs from the manifest", { manifest, observed });
  }
  if (!samePath(observed.worktree, manifest.expectedWorktree) || observed.branchOrDetachedState !== manifest.expectedBranchOrDetachedState) {
    return decision(false, "WRONG_WORKTREE", "Worktree or branch/detached state differs from the manifest", { manifest, observed });
  }
  if (observed.head !== manifest.baseCommit) return decision(false, "STALE_BASE", "HEAD differs from the manifest base commit", { manifest, observed });
  if (observed.runtimeOwner !== manifest.expectedRuntimeOwner || !samePath(observed.liveTargetPath, manifest.liveTargetPath)) {
    return decision(false, "WRONG_RUNTIME_OWNER", "Runtime owner or live target differs from the manifest", { manifest, observed });
  }
  if (observed.liveHash !== manifest.preEditLiveHash) return decision(false, "LIVE_HASH_DRIFT", "Live target changed after manifest creation", { manifest, observed });
  const rel = relative(observed.repoRoot, resolve(observed.worktree, manifest.targetFile));
  if (rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
    return decision(false, "WRONG_REPO", "Target file resolves outside the expected repository", { manifest, observed });
  }
  return decision(true, "PROVEN_ACTIVE", "Pre-edit source ownership and live hash are bound", { manifest, observed });
}

export function verifyActivationProof(proof: ActivationProof): SourceProvenanceDecision {
  if (proof.preActivationLiveHash !== proof.expectedPreActivationLiveHash) {
    return decision(false, "LIVE_HASH_DRIFT", "Live target changed before activation", proof);
  }
  if (proof.testedFileHash !== proof.activationSourceHash) {
    return decision(false, "TESTED_NOT_ACTIVATED", "Activation source was not the tested bytes", proof);
  }
  if (proof.activatedFileHash !== proof.testedFileHash) {
    return decision(false, "TESTED_NOT_ACTIVATED", "Activated bytes differ from tested bytes", proof);
  }
  if (proof.exactActivatedHashTested === false) {
    return decision(false, "TESTED_NOT_ACTIVATED", "An intentional live superset must be tested at its exact resulting hash", proof);
  }
  return decision(true, "PROVEN_ACTIVE", "Tested, activation-source, and activated hashes are identical", proof);
}

export function verifyRuntimeProof(args: {
  expectedSourcePath: string;
  activatedHash: string;
  testedHash: string;
  runtime: ResidentRuntimeProof | EphemeralRuntimeProof;
}): SourceProvenanceDecision {
  const { runtime } = args;
  if (args.activatedHash !== args.testedHash) return decision(false, "TESTED_NOT_ACTIVATED", "Activated and tested hashes differ", args);
  if (runtime.kind === "ephemeral") {
    if (!runtime.witnessed) return decision(false, "ACTIVATED_WAITING_FOR_RUNTIME_WITNESS", "No natural runner invocation has been witnessed", args);
    if (!runtime.pid || !runtime.commandLine || !runtime.terminalReceipt || !runtime.sourcePath || !runtime.sourceHash) {
      return decision(false, "RUNTIME_HASH_MISMATCH", "Ephemeral witness is incomplete", args);
    }
    if (!samePath(runtime.sourcePath, args.expectedSourcePath) || runtime.sourceHash !== args.activatedHash) {
      return decision(false, "RUNTIME_HASH_MISMATCH", "Ephemeral runner path or hash differs from activation", args);
    }
    return decision(true, "PROVEN_ACTIVE", "Ephemeral invocation witnessed exact activated bytes and terminal receipt", args);
  }
  if (Date.parse(runtime.processStartTime) <= Date.parse(runtime.activationTime) || Date.parse(runtime.startOrReloadEvent) <= Date.parse(runtime.activationTime)) {
    return decision(false, "ACTIVATED_NOT_RELOADED", "Resident process was not started or reloaded after activation", args);
  }
  if (!samePath(runtime.runningSourcePath, args.expectedSourcePath) || runtime.runningFileHash !== args.activatedHash) {
    return decision(false, "RUNTIME_HASH_MISMATCH", "Resident runtime path or hash differs from activation", args);
  }
  if (runtime.postActivationHealth !== "healthy") return decision(false, "ACTIVATED_NOT_RELOADED", "Post-activation service health failed", args);
  return decision(true, "PROVEN_ACTIVE", "Resident runtime loaded the exact tested and activated bytes", args);
}
