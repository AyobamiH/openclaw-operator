import { resolve } from "node:path";

import { runCampaignFactoryShadowCycle } from "./campaign-factory-shadow-cycle.js";

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function optionalArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const at = optionalArgument("--at");
const result = await runCampaignFactoryShadowCycle({
  registryPath: resolve(requiredArgument("--registry")),
  integrationPath: resolve(requiredArgument("--integration")),
  databasePath: resolve(requiredArgument("--db")),
  artifactRoot: resolve(requiredArgument("--artifact-root")),
  rendererEntrypoint: resolve(requiredArgument("--renderer-entrypoint")),
  observedAt: at ? new Date(at) : new Date(),
  opportunityId: optionalArgument("--opportunity") ?? "auto",
  nodeExecutable: optionalArgument("--node-executable"),
  openclawBin: optionalArgument("--openclaw-bin"),
  workspace: optionalArgument("--workspace"),
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
