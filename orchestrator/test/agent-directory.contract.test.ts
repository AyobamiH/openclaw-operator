import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentsRoot = resolve(__dirname, "../../agents");
const requiredContractFiles = [
  "README.md",
  "SOUL.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "IDENTITY.md",
  "POLICY.md",
  "ROLE.md",
  "SCOPE.md",
  "agent.config.json",
  "src/index.ts",
];
const expectedRuntimeStateTarget =
  "../../orchestrator/data/orchestrator-state.json";

const agentDirectories = readdirSync(agentsRoot, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      entry.name !== "shared",
  )
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

describe("agent directory contracts", () => {
  for (const agentId of agentDirectories) {
    it(`${agentId} carries the bounded agent scaffold`, () => {
      for (const relativePath of requiredContractFiles) {
        expect(
          existsSync(resolve(agentsRoot, agentId, relativePath)),
          `${agentId} is missing ${relativePath}`,
        ).toBe(true);
      }
    });

    it(`${agentId} manifest follows the local-first runtime state target`, () => {
      const manifestPath = resolve(agentsRoot, agentId, "agent.config.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
        orchestratorStatePath?: string;
        stateFile?: string;
      };

      expect(manifest.orchestratorStatePath).toBe(expectedRuntimeStateTarget);
      if ("stateFile" in manifest) {
        expect(manifest.stateFile).toBe(expectedRuntimeStateTarget);
      }
    });
  }
});
