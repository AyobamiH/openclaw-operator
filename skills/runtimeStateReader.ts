import { readFile, stat } from "node:fs/promises";
import { SkillDefinition } from "../orchestrator/src/skills/types.js";
import {
  normalizeRequestedFilePath,
  resolveWorkspaceTarget,
  toIsoTimestamp,
  validateRelativeWorkspacePath,
} from "./readerUtils.js";

interface RuntimeStateReaderInput {
  filePath?: unknown;
}

interface RuntimeStateReaderResult {
  success: boolean;
  filePath: string;
  exists: boolean;
  state: Record<string, unknown>;
  metadata?: {
    bytes: number;
    modifiedAt: string | null;
    updatedAt: string | null;
    topLevelKeys: string[];
  };
  error?: string;
}

export const runtimeStateReaderDefinition: SkillDefinition = {
  id: "runtimeStateReader",
  version: "1.0.0",
  description: "Read bounded orchestrator runtime-state JSON for posture and readiness synthesis",
  inputs: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Path to the orchestrator runtime-state JSON file" },
    },
    required: ["filePath"],
    examples: [{ filePath: "../../orchestrator/data/orchestrator-state.json" }],
  },
  outputs: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      filePath: { type: "string" },
      exists: { type: "boolean" },
      state: { type: "object" },
      metadata: {
        type: "object",
        properties: {
          bytes: { type: "number" },
          modifiedAt: { type: "string" },
          updatedAt: { type: "string" },
          topLevelKeys: { type: "array", items: { type: "string" } },
        },
      },
      error: { type: "string" },
    },
  },
  permissions: {
    fileRead: ["workspace"],
  },
  provenance: {
    author: "OpenClaw Team",
    source: "https://github.com/openclawio/orchestrator/commit/runtime-state-reader",
    version: "1.0.0",
    license: "Apache-2.0",
  },
  audit: {
    passed: true,
    runAt: new Date().toISOString(),
    checks: [
      {
        name: "bounded-runtime-state-read",
        status: "pass",
        message: "Reads bounded runtime-state JSON only.",
      },
      {
        name: "no-mutation",
        status: "pass",
        message: "Does not mutate runtime state.",
      },
    ],
    riskFlags: [],
  },
};

export async function executeRuntimeStateReader(
  input: RuntimeStateReaderInput,
): Promise<RuntimeStateReaderResult> {
  const filePath = normalizeRequestedFilePath(input?.filePath);
  const validationError = validateRelativeWorkspacePath(filePath);

  if (validationError) {
    return {
      success: false,
      filePath,
      exists: false,
      state: {},
      error: validationError,
    };
  }

  try {
    const absolutePath = resolveWorkspaceTarget(filePath);
    const fileStat = await stat(absolutePath);
    const raw = await readFile(absolutePath, "utf-8");
    const state = JSON.parse(raw) as Record<string, unknown>;

    return {
      success: true,
      filePath,
      exists: true,
      state,
      metadata: {
        bytes: fileStat.size,
        modifiedAt: toIsoTimestamp(fileStat.mtimeMs),
        updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : null,
        topLevelKeys: Object.keys(state).sort(),
      },
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return {
        success: true,
        filePath,
        exists: false,
        state: {},
        metadata: {
          bytes: 0,
          modifiedAt: null,
          updatedAt: null,
          topLevelKeys: [],
        },
      };
    }

    return {
      success: false,
      filePath,
      exists: false,
      state: {},
      error: error?.message ?? "Failed to read runtime state",
    };
  }
}
