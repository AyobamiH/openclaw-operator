import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(scriptDir, "..");
const siteRoot = join(workspaceRoot, "site");

const managedTargets = [
  "README.md",
  "QUICKSTART.md",
  "DEPLOYMENT.md",
  "OPENCLAW_CONTEXT_ANCHOR.md",
  "SPRINT_HARDENING_BASELINE.md",
  "docs",
  "operations",
  "agents",
  "incubation",
];

const copyTargets = [
  { from: "README.md", to: "README.md" },
  { from: "QUICKSTART.md", to: "QUICKSTART.md" },
  { from: "DEPLOYMENT.md", to: "DEPLOYMENT.md" },
  { from: "OPENCLAW_CONTEXT_ANCHOR.md", to: "OPENCLAW_CONTEXT_ANCHOR.md" },
  { from: "SPRINT_HARDENING_BASELINE.md", to: "SPRINT_HARDENING_BASELINE.md" },
  { from: "docs", to: "docs" },
  { from: "operations/RUNBOOK_BOUNDARIES.md", to: "operations/RUNBOOK_BOUNDARIES.md" },
  { from: "agents/README.md", to: "agents/README.md" },
];

const siteExclusions = [
  "docs/OPENCLAW_KB",
  "docs/MEMORY_SYSTEM_GUIDE.md",
  "docs/OPTION_A_IMPLEMENTATION_ROADMAP.md",
  "docs/SYSTEM_ARCHITECTURE.mmd",
  "docs/SYSTEM_DIAGRAM_PROMPT.md",
  "docs/repo-folder-tree-depth3.txt",
  "docs/operations/DOCUMENTATION_COMPLETE.md",
  "docs/operations/DOCUMENT_AUDIT.md",
  "docs/operations/IMPLEMENTATION_COMPLETE.md",
  "docs/operations/OPERATOR_S_CONSOLE_CUTOVER_BLUEPRINT.md",
  "docs/operations/PRD_GOVERNANCE_REMEDIATION.md",
  "docs/operations/SPRINT_TO_COMPLETION.md",
  "docs/operations/orchestrator-status.md",
  "docs/operations/orchestrator_documentation.md",
  "docs/operations/orchestrator_workflow_plan.md",
  "docs/operations/public-release.md",
];

async function resetManagedTargets() {
  await mkdir(siteRoot, { recursive: true });
  for (const relativeTarget of managedTargets) {
    await rm(join(siteRoot, relativeTarget), { recursive: true, force: true });
  }
}

async function copyCanonicalDocs() {
  for (const target of copyTargets) {
    const source = join(workspaceRoot, target.from);
    const destination = join(siteRoot, target.to);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }
}

async function pruneSiteOnlyInternalDocs() {
  for (const relativeTarget of siteExclusions) {
    await rm(join(siteRoot, relativeTarget), { recursive: true, force: true });
  }
}

async function main() {
  await resetManagedTargets();
  await copyCanonicalDocs();
  await pruneSiteOnlyInternalDocs();
  console.log(`[docs-site] synced canonical docs into ${siteRoot}`);
}

main().catch((error) => {
  console.error("[docs-site] sync failed:", error);
  process.exitCode = 1;
});
