import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { auditCampaignContentFactory } from "./campaign-factory.js";
import { loadCampaignMediaArtifact } from "./media-artifact.js";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const londonDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

async function loadArtifacts(artifactRoot: string | null, localDate: string) {
  if (!artifactRoot) return [];
  const factoryRoot = join(resolve(artifactRoot), localDate, "campaign-content-factory");
  const opportunities = await readdir(factoryRoot, { withFileTypes: true });
  const artifactPaths: string[] = [];
  for (const opportunity of opportunities.filter((entry) => entry.isDirectory())) {
    const opportunityRoot = join(factoryRoot, opportunity.name);
    for (const entry of await readdir(opportunityRoot, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith("-campaign-media-artifact.json")) {
        artifactPaths.push(join(opportunityRoot, entry.name));
      }
    }
  }
  return Promise.all(artifactPaths.sort().map((artifactPath) => loadCampaignMediaArtifact(artifactPath)));
}

const localDate = argument("--local-date", londonDate);
const artifactRootIndex = process.argv.indexOf("--artifact-root");
const artifactRoot = artifactRootIndex >= 0 ? process.argv[artifactRootIndex + 1] ?? null : null;
const mediaArtifacts = await loadArtifacts(artifactRoot, localDate);

const report = await auditCampaignContentFactory({
  registryPath: argument("--registry", "../config/publishing/registry.v1.json"),
  integrationPath: argument("--integration", "../config/publishing/production-integration.v1.json"),
  localDate,
  mediaArtifacts,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.verdict === "blocked") process.exitCode = 1;
