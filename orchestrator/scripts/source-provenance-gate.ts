import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readResidentServiceSnapshot, assertStableResidentServiceSnapshot } from "./source-provenance-resident.js";
import {
  inspectSourceState,
  sha256File,
  verifyActivationProof,
  verifyPreEditManifest,
  verifyRuntimeProof,
  type ActivationProof,
  type ResidentRuntimeProof,
  type SourceProvenanceManifest,
} from "../src/sourceProvenanceGate.js";

function value(name: string): string {
  const index = process.argv.indexOf(name);
  const result = index >= 0 ? process.argv[index + 1] : undefined;
  if (!result) throw new Error(`missing_argument:${name}`);
  return result;
}

function optional(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function emit(payload: unknown) {
  const output = optional("--output");
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  if (output) writeFileSync(resolve(output), body, { encoding: "utf8", mode: 0o600, flag: "wx" });
  else process.stdout.write(body);
}

function command(program: string, args: string[]): string {
  return execFileSync(program, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const action = process.argv[2];

if (action === "capture-preedit") {
  const state = inspectSourceState({ worktree: value("--worktree"), runtimeOwner: value("--runtime-owner"), liveTargetPath: value("--live-target") });
  const manifest: SourceProvenanceManifest = {
    schemaVersion: 1,
    expectedRuntimeOwner: state.runtimeOwner,
    serviceOrRunnerId: value("--service-id"),
    expectedRepoRoot: state.repoRoot,
    expectedGitDir: state.gitDir,
    expectedWorktree: state.worktree,
    expectedBranchOrDetachedState: state.branchOrDetachedState,
    baseCommit: state.head,
    targetFile: value("--target-file"),
    liveTargetPath: state.liveTargetPath,
    preEditLiveHash: state.liveHash,
  };
  emit({ manifest, decision: verifyPreEditManifest(manifest, state) });
} else if (action === "verify-preedit") {
  const manifest = readJson<{ manifest?: SourceProvenanceManifest } & SourceProvenanceManifest>(value("--manifest"));
  const selected = manifest.manifest ?? manifest;
  const state = inspectSourceState({ worktree: selected.expectedWorktree, runtimeOwner: selected.expectedRuntimeOwner, liveTargetPath: selected.liveTargetPath });
  const result = verifyPreEditManifest(selected, state);
  emit({ manifest: selected, observed: state, decision: result });
  if (!result.allowed) process.exitCode = 2;
} else if (action === "verify-activation") {
  const proof = readJson<ActivationProof>(value("--proof"));
  const result = verifyActivationProof(proof);
  emit({ proof, decision: result });
  if (!result.allowed) process.exitCode = 2;
} else if (action === "capture-resident") {
  const unit = value("--unit");
  const sourcePath = resolve(value("--source-path"));
  const activatedHash = value("--activated-hash");
  const testedHash = value("--tested-hash");
  const activationTime = value("--activation-time");
  if (!Number.isFinite(Date.parse(activationTime))) throw new Error("activation_timestamp_invalid");
  const before = readResidentServiceSnapshot(command, unit);
  const pid = before.pid;
  const cmdline = readFileSync(`/proc/${pid}/cmdline`).toString("utf8").replaceAll("\0", " ").trim();
  const cwd = command("readlink", ["-f", `/proc/${pid}/cwd`]);
  const unitText = command("systemctl", ["--user", "cat", unit, "--no-pager"]);
  const runtime: ResidentRuntimeProof = {
    kind: "resident",
    runningPid: pid,
    processStartTime: before.processStartTime,
    runningCwd: cwd,
    runningEntrypoint: cmdline,
    runningSourcePath: sourcePath,
    runningFileHash: sha256File(sourcePath),
    serviceUnitAndDropinDigest: createHash("sha256").update(unitText).digest("hex"),
    startOrReloadEvent: before.startOrReloadEvent,
    activationTime,
    postActivationHealth: command("systemctl", ["--user", "is-active", unit]) === "active" ? "healthy" : "unhealthy",
  };
  const after = readResidentServiceSnapshot(command, unit);
  assertStableResidentServiceSnapshot(before, after);
  const result = verifyRuntimeProof({ expectedSourcePath: sourcePath, activatedHash, testedHash, runtime });
  emit({ unit, effectiveProperties: before.properties, hostTimestampEvidence: { unitPath: before.unitPath, invocationId: before.invocationId, execMainStartTimestampUs: before.execMainStartTimestampUs, activeEnterTimestampUs: before.activeEnterTimestampUs }, runtime, decision: result });
  if (!result.allowed) process.exitCode = 2;
} else {
  throw new Error("usage: source-provenance-gate <capture-preedit|verify-preedit|verify-activation|capture-resident> ...");
}
