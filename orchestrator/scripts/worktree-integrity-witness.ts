import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { correlateDamage } from "../src/executionCorrelation.js";
import { ExecutionReceiptStore } from "../src/executionReceipts.js";
import { discoverRelevantRepositories, runIntegrityCheck } from "../src/worktreeIntegrity.js";

function value(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function values(flag: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) if (process.argv[index] === flag && process.argv[index + 1]) result.push(process.argv[index + 1]);
  return result;
}
function output(payload: unknown): void {
  const path = value("--output");
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  if (path) writeFileSync(resolve(path), body, { encoding: "utf8", mode: 0o600, flag: "wx" });
  else process.stdout.write(body);
}

const stateDir = resolve(value("--state-dir") ?? "/home/oneclickwebsitedesignfactory/.openclaw/state/worktree-integrity");
const root = value("--root") ?? "/home/oneclickwebsitedesignfactory/.openclaw";
const repoRoots = values("--repo");
const repos = repoRoots.length > 0 ? repoRoots : discoverRelevantRepositories(root);
const action = process.argv[2] ?? "check";

if (action === "check") {
  const result = runIntegrityCheck({ repoRoots: repos, stateDir });
  output({ ...result, repoRoots: repos });
  if (!process.argv.includes("--degraded-exit-zero") && result.incidents.some((item) => item.state !== "HEALTHY")) process.exitCode = 3;
} else if (action === "correlate") {
  const incidentPath = value("--incident");
  if (!incidentPath) throw new Error("missing_argument:--incident");
  const incident = JSON.parse(readFileSync(resolve(incidentPath), "utf8")) as Parameters<typeof correlateDamage>[0]["incident"];
  const kernelPath = value("--kernel-evidence");
  const kernelEvidence = kernelPath ? JSON.parse(readFileSync(resolve(kernelPath), "utf8")) : undefined;
  const receipts = new ExecutionReceiptStore(stateDir).read();
  output(correlateDamage({ incident, receipts, kernelEvidence }));
} else {
  throw new Error("usage: worktree-integrity-witness <check|correlate> [--root path] [--repo path] [--state-dir path]");
}
