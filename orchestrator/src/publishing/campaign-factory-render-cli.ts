import { resolve } from "node:path";

import {
  planCampaignFactoryContentForDate,
} from "./campaign-factory.js";
import { renderCampaignMediaLocally } from "./media-artifact.js";
import { loadProductionIntegration } from "./production-integration.js";
import { loadRegistryBundle } from "./registry.js";

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function optionalArgument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const registryPath = resolve(optionalArgument("--registry", "../config/publishing/registry.v1.json"));
const integrationPath = resolve(optionalArgument("--integration", "../config/publishing/production-integration.v1.json"));
const localDate = requiredArgument("--local-date");
const artifactRoot = resolve(requiredArgument("--artifact-root"));
const rendererEntrypoint = resolve(requiredArgument("--renderer-entrypoint"));
const nodeExecutable = resolve(optionalArgument("--node-executable", process.execPath));
const registry = await loadRegistryBundle(registryPath);
const integration = await loadProductionIntegration(integrationPath, registry);
if (integration.mode !== "shadow") {
  throw new Error("campaign_factory_local_render_requires_shadow_mode");
}
const planned = planCampaignFactoryContentForDate({ registry, integration, localDate });
const results = [];
for (const item of planned) {
  if (item.contentSpec.format === "text") {
    results.push({
      opportunityId: item.opportunityId,
      contentSpecId: item.contentSpec.id,
      format: "text",
      outcome: "not_required",
      externalWrites: 0,
    });
    continue;
  }
  const artifact = await renderCampaignMediaLocally({
    registry,
    contentSpec: item.contentSpec,
    artifactRoot,
    outputDir: resolve(artifactRoot, localDate, "campaign-content-factory", item.opportunityId),
    nodeExecutable,
    rendererEntrypoint,
  });
  results.push({
    opportunityId: item.opportunityId,
    contentSpecId: item.contentSpec.id,
    format: item.contentSpec.format,
    outcome: artifact ? "rendered_verified" : "not_required",
    artifactId: artifact?.id ?? null,
    artifactHash: artifact?.artifactHash ?? null,
    mediaSha256: artifact?.sha256 ?? null,
    externalWrites: 0,
  });
}
process.stdout.write(`${JSON.stringify({
  schemaVersion: "1.0.0",
  factoryId: "campaigns-content-factory",
  mode: "shadow",
  localDate,
  results,
  externalWrites: 0,
}, null, 2)}\n`);
