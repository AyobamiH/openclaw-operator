#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [outputPath, preservationCommit = "6b66c83c1174159ab0a760eb67d3f5915b38d39b"] =
  process.argv.slice(2);
if (!outputPath) {
  throw new Error("Usage: generate-release-recovery-manifest.mjs <output.json> [preservation-commit]");
}
const repositoryRoot = resolve(import.meta.dirname, "..");
const baseCommit = execFileSync(
  "git",
  ["rev-parse", `${preservationCommit}^`],
  { cwd: repositoryRoot, encoding: "utf8" },
).trim();

function gitLines(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).trim().split("\n").filter(Boolean);
}

const snapshotEntries = gitLines([
  "diff",
  "--name-status",
  "--no-renames",
  baseCommit,
  preservationCommit,
]).map((line) => {
  const [status, ...parts] = line.split("\t");
  return { status, path: parts.join("\t") };
});
const commitGroups = [
  {
    id: "a34583b2fb461edb89ccd84dd3f1c998c8d90dec",
    label: "coding-evidence-adapter",
  },
  {
    id: "0243b281898ad17d0757a800a08a5fc2df427932",
    label: "external-runtime-state",
  },
  {
    id: "5d206332edb49042992cf86ac18c3662fd55a045",
    label: "terminal-test-reliability",
  },
  {
    id: "f321f868c4b66047ddfb1c4536711f0924eca365",
    label: "publishing-engine-release-source",
  },
].map((group) => ({
  ...group,
  paths: new Set(gitLines(["show", "--pretty=format:", "--name-only", group.id])),
}));

function classify(entry) {
  const group = commitGroups.find((candidate) => candidate.paths.has(entry.path));
  if (entry.path.startsWith("agentproof/")) {
    return {
      classification: "duplicate or superseded content",
      owner: "AgentProof RC4 validation work",
      uniqueness: "Superseded by standalone AgentProof RC5; exact RC4 copy retained",
      destinationOrAction:
        "Archived outside product source and preserved in the pre-recovery branch",
      reversibility: "Full path recoverable from preservation commit and archive",
      testImpact: "None on operator RC; standalone RC5 remains authoritative",
      commitGrouping: "not committed to operator RC",
    };
  }
  if (
    entry.path.startsWith("validation-kits/") ||
    entry.path.startsWith("test-consumers/")
  ) {
    return {
      classification: "generated reproducible artefact",
      owner: "AgentProof release validation",
      uniqueness: "Unique historical evidence, reproducible from preserved release inputs",
      destinationOrAction:
        "Archived outside product source and preserved in the pre-recovery branch",
      reversibility: "Full path recoverable from preservation commit and archive",
      testImpact: "Excluded from operator gates; historical validation remains inspectable",
      commitGrouping: "not committed to operator RC",
    };
  }
  if (
    entry.path === "orchestrator/src/agentproof/approvalReplay.ts" ||
    entry.path === "orchestrator/src/approvalGate.ts" ||
    entry.path === "orchestrator/src/approvalReplay.ts" ||
    entry.path === "orchestrator/test/agentproof-canonical-approval.test.ts" ||
    entry.path === "orchestrator/test/agentproof-repository-patch.test.ts" ||
    entry.path === "README.md" ||
    entry.path.includes("agentproof-approval-replay") ||
    entry.path.includes("agentproof-official-consumer")
  ) {
    return {
      classification: "valid unrelated source work",
      owner: "AgentProof operator integration",
      uniqueness: "Unique local RC4-era integration delta",
      destinationOrAction:
        "Preserved on preserve/pre-recovery-20260730 and in the external recovery archive; omitted from this product RC",
      reversibility: "Cherry-pick or recover exact blobs from preservation commit",
      testImpact: "Would require separate AgentProof RC5 rebinding before reintegration",
      commitGrouping: "separate future AgentProof integration",
    };
  }
  if (group) {
    const isTest = /(?:^|\/)(?:test|tests|fixtures)(?:\/|$)|\.test\.[^.]+$/.test(entry.path);
    const isDoc = entry.path.endsWith(".md") || entry.path.startsWith("docs/");
    const isConfig =
      entry.path.startsWith("config/") ||
      entry.path.endsWith(".example") ||
      entry.path.includes("systemd") ||
      entry.path === "docker-compose.yml" ||
      entry.path.startsWith(".coding-agent/");
    return {
      classification: isTest
        ? "required test or fixture"
        : isDoc
          ? "required documentation"
          : isConfig
            ? "required configuration"
            : group.label === "publishing-engine-release-source"
              ? "publishing-engine release source"
              : "valid unrelated source work",
      owner:
        group.label === "publishing-engine-release-source"
          ? "Deterministic Self-Identification Publishing Engine"
          : group.label,
      uniqueness: "Retained intentional local work; committed after review",
      destinationOrAction: `Retained in canonical operator repository commit ${group.id}`,
      reversibility: `Commit ${group.id} can be reverted independently`,
      testImpact: "Covered by the full operator verification gate",
      commitGrouping: group.label,
    };
  }
  return {
    classification: "unresolved and preservation-required",
    owner: "Not safely attributable from path name alone",
    uniqueness: "Preserved because uniqueness could not be disproved",
    destinationOrAction:
      "Retained only on preserve/pre-recovery-20260730 pending separate review",
    reversibility: "Exact blob recoverable from preservation commit",
    testImpact: "Excluded from operator RC; no silent deletion",
    commitGrouping: "preservation-only",
  };
}

const paths = snapshotEntries.map((entry) => ({ ...entry, ...classify(entry) }));
const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  repositoryRoot,
  baseCommit,
  preservationCommit,
  preservationBranch: "preserve/pre-recovery-20260730",
  pathCount: paths.length,
  countsByClassification: Object.fromEntries(
    [...new Set(paths.map((entry) => entry.classification))]
      .sort()
      .map((classification) => [
        classification,
        paths.filter((entry) => entry.classification === classification).length,
      ]),
  ),
  paths,
};
mkdirSync(dirname(resolve(outputPath)), { recursive: true });
writeFileSync(resolve(outputPath), `${JSON.stringify(payload, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
const bytes = readFileSync(resolve(outputPath));
const receipt = {
  path: resolve(outputPath),
  bytes: statSync(resolve(outputPath)).size,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  pathCount: paths.length,
};
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
