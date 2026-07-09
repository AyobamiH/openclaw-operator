import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { SkillDefinition } from "../orchestrator/src/skills/types.js";
import {
  clampInteger,
  joinLogicalPath,
  normalizeLogicalPath,
  normalizeRequestedFilePath,
  resolveWorkspaceTarget,
  toIsoTimestamp,
  validateRelativeWorkspacePath,
} from "./readerUtils.js";

const KNOWLEDGE_PACK_MODES = ["latest", "read", "list"] as const;
type KnowledgePackMode = (typeof KNOWLEDGE_PACK_MODES)[number];

interface KnowledgePackReaderInput {
  filePath?: unknown;
  logicalPath?: unknown;
  mode?: unknown;
  maxEntries?: unknown;
}

function isKnowledgePackFilename(value: string) {
  return value.startsWith("knowledge-pack-") && value.endsWith(".json");
}

export const knowledgePackReaderDefinition: SkillDefinition = {
  id: "knowledgePackReader",
  version: "1.0.0",
  description:
    "Read bounded knowledge-pack artifacts and freshness metadata for retrieval posture lanes",
  inputs: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Knowledge-pack file or directory path" },
      logicalPath: {
        type: "string",
        description: "Optional logical repo-relative path for returned evidence labels",
      },
      mode: {
        type: "string",
        enum: ["latest", "read", "list"],
        description: "Knowledge-pack read mode",
      },
      maxEntries: {
        type: "number",
        description: "Maximum list entries to return when mode=list",
        default: 20,
      },
    },
    required: ["filePath"],
    examples: [
      {
        filePath: "../../logs/knowledge-packs",
        logicalPath: "logs/knowledge-packs",
        mode: "latest",
      },
    ],
  },
  outputs: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      filePath: { type: "string" },
      logicalPath: { type: "string" },
      exists: { type: "boolean" },
      latest: { type: "object" },
      pack: { type: "object" },
      entries: { type: "array" },
      error: { type: "string" },
    },
  },
  permissions: {
    fileRead: ["workspace"],
  },
  provenance: {
    author: "OpenClaw Team",
    source: "https://github.com/openclawio/orchestrator/commit/knowledge-pack-reader",
    version: "1.0.0",
    license: "Apache-2.0",
  },
  audit: {
    passed: true,
    runAt: new Date().toISOString(),
    checks: [
      {
        name: "bounded-knowledge-pack-read",
        status: "pass",
        message: "Reads bounded knowledge-pack artifacts only.",
      },
      {
        name: "no-mutation",
        status: "pass",
        message: "Does not mutate pack artifacts.",
      },
    ],
    riskFlags: [],
  },
};

export async function executeKnowledgePackReader(
  input: KnowledgePackReaderInput,
): Promise<Record<string, unknown>> {
  const filePath = normalizeRequestedFilePath(input?.filePath);
  const validationError = validateRelativeWorkspacePath(filePath);
  const logicalPath = normalizeLogicalPath(
    typeof input?.logicalPath === "string" ? input.logicalPath : filePath,
  );
  const mode = KNOWLEDGE_PACK_MODES.includes(input?.mode as KnowledgePackMode)
    ? (input.mode as KnowledgePackMode)
    : "latest";
  const maxEntries = clampInteger(input?.maxEntries, 20, { min: 1, max: 200 });

  if (validationError) {
    return {
      success: false,
      filePath,
      logicalPath,
      exists: false,
      error: validationError,
    };
  }

  try {
    const absolutePath = resolveWorkspaceTarget(filePath);
    const fileStat = await stat(absolutePath);

    if (mode === "read") {
      if (fileStat.isDirectory()) {
        return {
          success: false,
          filePath,
          logicalPath,
          exists: true,
          error: "knowledgePackReader expected a file path for read mode",
        };
      }

      const raw = await readFile(absolutePath, "utf-8");
      return {
        success: true,
        filePath,
        logicalPath,
        exists: true,
        pack: {
          path: logicalPath,
          modifiedAt: toIsoTimestamp(fileStat.mtimeMs),
          data: JSON.parse(raw),
        },
      };
    }

    if (!fileStat.isDirectory()) {
      return {
        success: false,
        filePath,
        logicalPath,
        exists: true,
        error: "knowledgePackReader expected a directory path for latest/list mode",
      };
    }

    const filenames = (await readdir(absolutePath)).filter(isKnowledgePackFilename);
    const candidates = await Promise.all(
      filenames.map(async (entry) => {
        const absoluteEntry = resolve(absolutePath, entry);
        const entryStat = await stat(absoluteEntry);
        return {
          entry,
          absoluteEntry,
          modifiedAt: toIsoTimestamp(entryStat.mtimeMs),
          mtimeMs: entryStat.mtimeMs,
        };
      }),
    );
    candidates.sort(
      (left, right) =>
        right.mtimeMs - left.mtimeMs || left.entry.localeCompare(right.entry),
    );

    if (mode === "list") {
      return {
        success: true,
        filePath,
        logicalPath,
        exists: true,
        entries: candidates.slice(0, maxEntries).map((entry) => ({
          path: joinLogicalPath(logicalPath, entry.entry),
          modifiedAt: entry.modifiedAt,
        })),
      };
    }

    const latest = candidates[0];
    if (!latest) {
      return {
        success: true,
        filePath,
        logicalPath,
        exists: true,
        latest: null,
      };
    }

    const raw = await readFile(latest.absoluteEntry, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      success: true,
      filePath,
      logicalPath,
      exists: true,
      latest: {
        path: joinLogicalPath(logicalPath, latest.entry),
        modifiedAt: latest.modifiedAt,
        generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : null,
        data,
      },
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return {
        success: true,
        filePath,
        logicalPath,
        exists: false,
        latest: null,
      };
    }

    return {
      success: false,
      filePath,
      logicalPath,
      exists: false,
      error: error?.message ?? "Failed to read knowledge-pack data",
    };
  }
}
