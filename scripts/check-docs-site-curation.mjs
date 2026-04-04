import { access, readdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { siteForbiddenTargets, sitePublishedDocFiles } from "./docs-site-manifest.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(scriptDir, "..");
const siteRoot = join(workspaceRoot, "site");
const siteDocsRoot = join(siteRoot, "docs");

async function walkFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const nextPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(nextPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(nextPath);
    }
  }
  return files;
}

async function pathExists(target) {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!await pathExists(siteDocsRoot)) {
    throw new Error(`site docs root missing: ${siteDocsRoot}`);
  }

  const actualFiles = (await walkFiles(siteDocsRoot))
    .map((target) => relative(siteRoot, target))
    .sort();
  const expectedFiles = [...sitePublishedDocFiles].sort();

  const unexpectedFiles = actualFiles.filter((target) => !expectedFiles.includes(target));
  const missingFiles = expectedFiles.filter((target) => !actualFiles.includes(target));
  const forbiddenTargetsPresent = [];
  for (const relativeTarget of siteForbiddenTargets) {
    if (await pathExists(join(siteRoot, relativeTarget))) {
      forbiddenTargetsPresent.push(relativeTarget);
    }
  }

  if (unexpectedFiles.length > 0 || missingFiles.length > 0 || forbiddenTargetsPresent.length > 0) {
    const lines = [
      "[docs-site] curation check failed",
      unexpectedFiles.length > 0 ? `unexpected files:\n- ${unexpectedFiles.join("\n- ")}` : "",
      missingFiles.length > 0 ? `missing files:\n- ${missingFiles.join("\n- ")}` : "",
      forbiddenTargetsPresent.length > 0 ? `forbidden targets present:\n- ${forbiddenTargetsPresent.join("\n- ")}` : "",
    ].filter(Boolean);
    throw new Error(lines.join("\n"));
  }

  console.log(`[docs-site] curation check passed (${actualFiles.length} published docs files)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
