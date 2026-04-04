import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { siteCopyTargets, siteManagedTargets } from "./docs-site-manifest.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(scriptDir, "..");
const siteRoot = join(workspaceRoot, "site");

async function resetManagedTargets() {
  await mkdir(siteRoot, { recursive: true });
  for (const relativeTarget of siteManagedTargets) {
    await rm(join(siteRoot, relativeTarget), { recursive: true, force: true });
  }
}

async function copyCanonicalDocs() {
  for (const target of siteCopyTargets) {
    const source = join(workspaceRoot, target.from);
    const destination = join(siteRoot, target.to);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }
}

async function main() {
  await resetManagedTargets();
  await copyCanonicalDocs();
  console.log(`[docs-site] synced canonical docs into ${siteRoot}`);
}

main().catch((error) => {
  console.error("[docs-site] sync failed:", error);
  process.exitCode = 1;
});
