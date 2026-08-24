import { ExecutionReceiptStore, executeControlledCommand } from "../src/executionReceipts.js";
import { loadBaselines } from "../src/worktreeIntegrity.js";

function value(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const executable = process.argv[2];
if (!executable) throw new Error("usage: execute-controlled-command <executable> [argv...] --state-dir path");
const stateDir = value("--state-dir") ?? "/home/oneclickwebsitedesignfactory/.openclaw/state/worktree-integrity";
const separator = process.argv.indexOf("--");
const argv = (separator >= 0 ? process.argv.slice(separator + 1) : process.argv.slice(3)).filter((item) => item !== "--state-dir" && item !== stateDir);
const cwd = value("--cwd") ?? process.cwd();
const store = new ExecutionReceiptStore(stateDir);
const result = await executeControlledCommand({
  executable,
  argv,
  cwd,
  receiptStore: store,
  context: { agent: value("--agent"), sessionId: value("--session-id"), taskId: value("--task-id"), runId: value("--run-id"), repoRoot: value("--repo-root"), worktreePath: value("--worktree") },
  destructive: value("--destructive") === "true",
  guard: { protectedPaths: loadBaselines(stateDir).map((baseline) => ({ repoRoot: baseline.repoRoot, worktreePath: baseline.worktreePath, registered: true })) },
});
process.stdout.write(`${JSON.stringify({ eventId: result.eventId, pid: result.pid, exitStatus: result.exitStatus, stdout: result.stdout, stderr: result.stderr, receipt: result.receipt }, null, 2)}\n`);
process.exitCode = result.exitStatus;
