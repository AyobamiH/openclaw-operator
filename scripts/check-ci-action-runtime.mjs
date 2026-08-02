import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const workflowDirectory = path.resolve(".github/workflows");
const workflowFiles = readdirSync(workflowDirectory)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .sort();
const actionPattern = /uses:\s*actions\/(checkout|setup-node)@v(\d+)/g;
const observed = [];

for (const workflowFile of workflowFiles) {
  const source = readFileSync(path.join(workflowDirectory, workflowFile), "utf8");
  for (const match of source.matchAll(actionPattern)) {
    const major = Number(match[2]);
    observed.push({ action: match[1], major, workflowFile });
    assert.ok(
      major >= 7,
      `${workflowFile} uses actions/${match[1]}@v${major}; Node 24 action runtime requires v7 or newer`,
    );
  }
}

assert.ok(observed.some(({ action }) => action === "checkout"), "checkout action must be audited");
assert.ok(observed.some(({ action }) => action === "setup-node"), "setup-node action must be audited");
console.log(`[ci-actions] PASS (${observed.length} Node 24 action references)`);
