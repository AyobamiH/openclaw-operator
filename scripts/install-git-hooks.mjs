import { chmodSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const managedHook = path.join(repoRoot, ".githooks", "pre-push");

function log(message) {
  console.log(`[hooks] ${message}`);
}

if (!existsSync(managedHook)) {
  log("No managed pre-push hook found; skipping install.");
  process.exit(0);
}

try {
  chmodSync(managedHook, 0o755);
} catch {
  // Best-effort only. Git can still use the hook if the mode is already right.
}

try {
  const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();

  if (path.resolve(topLevel) !== path.resolve(repoRoot)) {
    log("Current directory is not the repo toplevel; skipping hook install.");
    process.exit(0);
  }

  execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    cwd: repoRoot,
    stdio: "ignore"
  });
  log("Configured git core.hooksPath to .githooks");
} catch {
  log("Git metadata was unavailable; skipping hook install.");
}
