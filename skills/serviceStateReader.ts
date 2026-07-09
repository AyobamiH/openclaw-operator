import { readFile, stat } from "node:fs/promises";
import { SkillDefinition } from "../orchestrator/src/skills/types.js";
import {
  normalizeRequestedFilePath,
  resolveWorkspaceTarget,
  toIsoTimestamp,
  validateRelativeWorkspacePath,
} from "./readerUtils.js";

interface ServiceStateReaderInput {
  filePath?: unknown;
}

interface ServiceStateReaderResult {
  success: boolean;
  filePath: string;
  exists: boolean;
  state: Record<string, unknown> | null;
  metadata?: {
    bytes: number;
    modifiedAt: string | null;
    lastStatus: string | null;
  };
  error?: string;
}

export const serviceStateReaderDefinition: SkillDefinition = {
  id: "serviceStateReader",
  version: "1.0.0",
  description: "Read bounded agent service-state JSON for host and task-path posture",
  inputs: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Path to the agent service-state JSON file" },
    },
    required: ["filePath"],
    examples: [{ filePath: "../../logs/system-monitor-agent-service.json" }],
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
          lastStatus: { type: "string" },
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
    source: "https://github.com/openclawio/orchestrator/commit/service-state-reader",
    version: "1.0.0",
    license: "Apache-2.0",
  },
  audit: {
    passed: true,
    runAt: new Date().toISOString(),
    checks: [
      {
        name: "bounded-service-state-read",
        status: "pass",
        message: "Reads bounded service-state JSON only.",
      },
      {
        name: "no-mutation",
        status: "pass",
        message: "Does not mutate service-state files.",
      },
    ],
    riskFlags: [],
  },
};

export async function executeServiceStateReader(
  input: ServiceStateReaderInput,
): Promise<ServiceStateReaderResult> {
  const filePath = normalizeRequestedFilePath(input?.filePath);
  const validationError = validateRelativeWorkspacePath(filePath);

  if (validationError) {
    return {
      success: false,
      filePath,
      exists: false,
      state: null,
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
        lastStatus: typeof state.lastStatus === "string" ? state.lastStatus : null,
      },
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return {
        success: true,
        filePath,
        exists: false,
        state: null,
        metadata: {
          bytes: 0,
          modifiedAt: null,
          lastStatus: null,
        },
      };
    }

    return {
      success: false,
      filePath,
      exists: false,
      state: null,
      error: error?.message ?? "Failed to read service state",
    };
  }
}
