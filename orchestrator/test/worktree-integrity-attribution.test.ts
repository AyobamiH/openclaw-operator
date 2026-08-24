import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { correlateDamage } from "../src/executionCorrelation.js";
import { ExecutionReceiptStore, executeControlledCommand } from "../src/executionReceipts.js";
import { destructiveCommandHash, evaluateDestructiveCommand } from "../src/destructiveCommandGuard.js";
import { runIntegrityCheck } from "../src/worktreeIntegrity.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function fixture(): { root: string; state: string } {
  const root = mkdtempSync(join(tmpdir(), "openclaw-integrity-fixture-"));
  const state = mkdtempSync(join(tmpdir(), "openclaw-integrity-state-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  writeFileSync(join(root, "tracked.txt"), "fixture\n");
  writeFileSync(join(root, "second.txt"), "fixture-two\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fixture"]);
  return { root, state };
}

describe("worktree integrity witness", () => {
  it("keeps a healthy baseline and classifies tracked-file loss", () => {
    const item = fixture();
    try {
      const healthy = runIntegrityCheck({ repoRoots: [item.root], stateDir: item.state, now: new Date("2026-08-22T10:00:00.000Z") });
      expect(healthy.observations[0].state).toBe("HEALTHY");
      rmSync(join(item.root, "tracked.txt"));
      const damaged = runIntegrityCheck({ repoRoots: [item.root], stateDir: item.state, now: new Date("2026-08-22T10:01:00.000Z") });
      expect(damaged.observations[0].state).toBe("WORKING_TREE_CONTENT_LOST");
      expect(damaged.observations[0].missingTrackedFileCount).toBe(1);
      expect(damaged.observations[0].firstObservedDamageAt).toBe("2026-08-22T10:01:00.000Z");
      expect(readFileSync(join(item.state, "baselines", `${damaged.observations[0].baselineId}.json`), "utf8")).toContain("tracked.txt");
    } finally { rmSync(item.root, { recursive: true, force: true }); rmSync(item.state, { recursive: true, force: true }); }
  });

  it("separates missing worktree metadata from filesystem loss", () => {
    const item = fixture();
    try {
      runIntegrityCheck({ repoRoots: [item.root], stateDir: item.state });
      renameSync(join(item.root, ".git"), join(item.root, ".git.saved"));
      const metadata = runIntegrityCheck({ repoRoots: [], stateDir: item.state });
      expect(metadata.observations[0].state).toBe("WORKTREE_METADATA_LOST");
      renameSync(join(item.root, ".git.saved"), join(item.root, ".git"));
      rmSync(item.root, { recursive: true, force: true });
      const filesystem = runIntegrityCheck({ repoRoots: [], stateDir: item.state });
      expect(filesystem.observations[0].state).toBe("FILESYSTEM_DAMAGE_DETECTED");
    } finally { rmSync(item.root, { recursive: true, force: true }); rmSync(item.state, { recursive: true, force: true }); }
  });
});

describe("execution receipts, guard and correlation", () => {
  it("records a redacted receipt, blocks protected recursive deletion, and correlates an exact disposable deletion", async () => {
    const item = fixture();
    try {
      runIntegrityCheck({ repoRoots: [item.root], stateDir: item.state });
      const store = new ExecutionReceiptStore(item.state, { maxRecords: 20, maxBytes: 100_000 });
      const safe = await executeControlledCommand({ executable: "/bin/printf", argv: ["--token", "supersecret", "ok"], cwd: item.root, receiptStore: store, context: { agent: "fixture-agent", sessionId: "session-1", taskId: "task-1", runId: "run-1", repoRoot: item.root, worktreePath: item.root } });
      expect(safe.exitStatus).toBe(0);
      const stored = store.read();
      expect(stored.some((receipt) => receipt.fullArgv.includes("[REDACTED]"))).toBe(true);
      expect(stored.map((receipt) => JSON.stringify(receipt)).join("\n")).not.toContain("supersecret");

      const blocked = evaluateDestructiveCommand("/bin/rm", ["-rf", item.root], item.root, { protectedPaths: [{ repoRoot: item.root, worktreePath: item.root, registered: true }] });
      expect(blocked.allowed).toBe(false);
      const authority = { nonce: "fixture-once", operation: "rm-rf" as const, canonicalTargetPath: item.root, commandHash: destructiveCommandHash("/bin/rm", ["-rf", item.root], "/tmp"), expiresAt: "2099-01-01T00:00:00.000Z" };
      const deleting = await executeControlledCommand({ executable: "/bin/rm", argv: ["-rf", item.root], cwd: "/tmp", receiptStore: store, context: { agent: "fixture-agent", sessionId: "session-1", taskId: "delete-task", runId: "run-2", repoRoot: item.root, worktreePath: item.root }, destructive: true, guard: { protectedPaths: [{ repoRoot: item.root, worktreePath: item.root, registered: true }], authority } });
      expect(deleting.exitStatus).toBe(0);
      const incident = runIntegrityCheck({ repoRoots: [], stateDir: item.state }).observations[0];
      expect(incident.state).toBe("FILESYSTEM_DAMAGE_DETECTED");
      const correlation = correlateDamage({ incident, receipts: store.read() });
      expect(correlation.outcome).toBe("OWNER_IDENTIFIED");
      expect(correlation.candidates[0].start.taskId).toBe("delete-task");
      expect(correlation.candidates[0].matchedBy).toContain("command-path");
    } finally { rmSync(item.root, { recursive: true, force: true }); rmSync(item.state, { recursive: true, force: true }); }
  });

  it("keeps receipt retention bounded", async () => {
    const item = fixture();
    try {
      const store = new ExecutionReceiptStore(item.state, { maxRecords: 10, maxBytes: 4096 });
      for (let index = 0; index < 20; index += 1) await executeControlledCommand({ executable: "/bin/true", argv: [String(index)], cwd: item.root, receiptStore: store });
      expect(store.read().length).toBeLessThanOrEqual(10);
      expect(Buffer.byteLength(readFileSync(store.path))).toBeLessThanOrEqual(4096);
    } finally { rmSync(item.root, { recursive: true, force: true }); rmSync(item.state, { recursive: true, force: true }); }
  });
});
