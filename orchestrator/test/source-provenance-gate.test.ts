import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  verifyActivationProof,
  verifyPreEditManifest,
  verifyRuntimeProof,
  type ObservedSourceState,
  type SourceProvenanceManifest,
} from "../src/sourceProvenanceGate.js";

const root = process.cwd();
const gitDir = join(root, "..", ".git");
const livePath = join(root, "src", "toolGate.ts");
const manifest: SourceProvenanceManifest = {
  schemaVersion: 1,
  expectedRuntimeOwner: "orchestrator.service",
  serviceOrRunnerId: "orchestrator",
  expectedRepoRoot: join(root, ".."),
  expectedGitDir: gitDir,
  expectedWorktree: join(root, ".."),
  expectedBranchOrDetachedState: "hardening/source-provenance-gate-20260822",
  baseCommit: "a".repeat(40),
  targetFile: "orchestrator/src/toolGate.ts",
  liveTargetPath: livePath,
  preEditLiveHash: "b".repeat(64),
};
const observed: ObservedSourceState = {
  runtimeOwner: manifest.expectedRuntimeOwner,
  repoRoot: manifest.expectedRepoRoot,
  gitDir: manifest.expectedGitDir,
  worktree: manifest.expectedWorktree,
  branchOrDetachedState: manifest.expectedBranchOrDetachedState,
  head: manifest.baseCommit,
  liveTargetPath: manifest.liveTargetPath,
  liveHash: manifest.preEditLiveHash,
};

describe("source provenance gate", () => {
  it.each([
    ["wrong repository", { repoRoot: join(root, "elsewhere") }, "WRONG_REPO"],
    ["wrong worktree", { worktree: join(root, "other-worktree") }, "WRONG_WORKTREE"],
    ["stale base", { head: "c".repeat(40) }, "STALE_BASE"],
    ["live drift", { liveHash: "d".repeat(64) }, "LIVE_HASH_DRIFT"],
    ["wrong runtime owner", { runtimeOwner: "different.service" }, "WRONG_RUNTIME_OWNER"],
  ])("rejects %s", (_name, change, outcome) => {
    expect(verifyPreEditManifest(manifest, { ...observed, ...change })).toMatchObject({ allowed: false, outcome });
  });

  it("accepts the current dirty production model when ownership and hashes are exact", () => {
    expect(verifyPreEditManifest(manifest, observed)).toMatchObject({ allowed: true, outcome: "PROVEN_ACTIVE" });
  });

  it("rejects green tests in an unactivated worktree", () => {
    expect(verifyActivationProof({ testedWorktree: root, testedCommit: "a".repeat(40), testedFileHash: "1".repeat(64), activationSourceHash: "1".repeat(64), liveTargetPath: livePath, preActivationLiveHash: "0".repeat(64), expectedPreActivationLiveHash: "0".repeat(64), activatedFileHash: "2".repeat(64) })).toMatchObject({ allowed: false, outcome: "TESTED_NOT_ACTIVATED" });
  });

  it("accepts an exact live superset only after testing the exact resulting hash", () => {
    expect(verifyActivationProof({ testedWorktree: root, testedCommit: "a".repeat(40), testedFileHash: "2".repeat(64), activationSourceHash: "2".repeat(64), liveTargetPath: livePath, preActivationLiveHash: "0".repeat(64), expectedPreActivationLiveHash: "0".repeat(64), activatedFileHash: "2".repeat(64), exactActivatedHashTested: true })).toMatchObject({ allowed: true });
  });

  it("rejects activated bytes when the resident service still predates activation", () => {
    expect(verifyRuntimeProof({ expectedSourcePath: livePath, activatedHash: "2".repeat(64), testedHash: "2".repeat(64), runtime: { kind: "resident", runningPid: 1, processStartTime: "2026-08-22T08:00:00Z", runningCwd: root, runningEntrypoint: livePath, runningSourcePath: livePath, runningFileHash: "2".repeat(64), serviceUnitAndDropinDigest: "3".repeat(64), startOrReloadEvent: "2026-08-22T08:00:00Z", activationTime: "2026-08-22T09:00:00Z", postActivationHealth: "healthy" } })).toMatchObject({ allowed: false, outcome: "ACTIVATED_NOT_RELOADED" });
  });

  it("fails closed when a base unit is misleading and the effective runtime path differs", () => {
    expect(verifyRuntimeProof({ expectedSourcePath: livePath, activatedHash: "2".repeat(64), testedHash: "2".repeat(64), runtime: { kind: "resident", runningPid: 1, processStartTime: "2026-08-22T10:00:00Z", runningCwd: root, runningEntrypoint: "/global/dist/index.js", runningSourcePath: "/repair-worktree/dist/index.js", runningFileHash: "2".repeat(64), serviceUnitAndDropinDigest: "3".repeat(64), startOrReloadEvent: "2026-08-22T10:00:00Z", activationTime: "2026-08-22T09:00:00Z", postActivationHealth: "healthy" } })).toMatchObject({ allowed: false, outcome: "RUNTIME_HASH_MISMATCH" });
  });

  it("supports workspace-owned ephemeral social runners and waits for a natural witness", () => {
    expect(verifyRuntimeProof({ expectedSourcePath: livePath, activatedHash: "2".repeat(64), testedHash: "2".repeat(64), runtime: { kind: "ephemeral", witnessed: false } })).toMatchObject({ allowed: false, outcome: "ACTIVATED_WAITING_FOR_RUNTIME_WITNESS" });
    expect(verifyRuntimeProof({ expectedSourcePath: livePath, activatedHash: "2".repeat(64), testedHash: "2".repeat(64), runtime: { kind: "ephemeral", witnessed: true, pid: 42, commandLine: `node ${livePath}`, sourcePath: livePath, sourceHash: "2".repeat(64), terminalReceipt: "receipt:ok" } })).toMatchObject({ allowed: true, outcome: "PROVEN_ACTIVE" });
  });
});
