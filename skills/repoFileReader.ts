import { readdir, readFile, stat } from "node:fs/promises";
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

const REPO_READER_MODES = ["exists", "text", "json", "directory"] as const;
type RepoReaderMode = (typeof REPO_READER_MODES)[number];

interface RepoFileReaderInput {
  filePath?: unknown;
  logicalPath?: unknown;
  mode?: unknown;
  recursive?: unknown;
  maxEntries?: unknown;
  extensions?: unknown;
}

interface RepoDirectoryEntry {
  path: string;
  relativePath: string;
  kind: "file" | "directory";
  bytes: number | null;
  modifiedAt: string | null;
}

async function collectDirectoryEntries(args: {
  absoluteRoot: string;
  logicalRoot: string;
  recursive: boolean;
  maxEntries: number;
  extensions: string[];
}) {
  const entries: RepoDirectoryEntry[] = [];
  const normalizedExtensions = args.extensions.map((entry) => entry.toLowerCase());
  let truncated = false;

  // Keep traversal deterministic so sample outputs and posture diffs do not
  // depend on filesystem enumeration order.
  const walk = async (absoluteDir: string, relativeDir: string) => {
    const dirEntries = await readdir(absoluteDir, { withFileTypes: true });
    const sortedEntries = [...dirEntries].sort((left, right) =>
      left.name.localeCompare(right.name),
    );

    for (const entry of sortedEntries) {
      if (entries.length >= args.maxEntries) {
        truncated = true;
        return;
      }

      const absoluteEntry = resolve(absoluteDir, entry.name);
      const relativeEntry = normalizeLogicalPath(joinLogicalPath(relativeDir, entry.name));
      const logicalPath = normalizeLogicalPath(
        joinLogicalPath(args.logicalRoot, relativeEntry),
      );

      if (entry.isDirectory()) {
        entries.push({
          path: logicalPath,
          relativePath: relativeEntry,
          kind: "directory",
          bytes: null,
          modifiedAt: null,
        });
        if (args.recursive) {
          await walk(absoluteEntry, relativeEntry);
        }
        continue;
      }

      const extension = entry.name.includes(".")
        ? `.${entry.name.split(".").pop()!.toLowerCase()}`
        : "";
      if (
        normalizedExtensions.length > 0 &&
        !normalizedExtensions.includes(extension)
      ) {
        continue;
      }

      const fileStat = await stat(absoluteEntry);
      entries.push({
        path: logicalPath,
        relativePath: relativeEntry,
        kind: "file",
        bytes: fileStat.size,
        modifiedAt: toIsoTimestamp(fileStat.mtimeMs),
      });
    }
  };

  await walk(args.absoluteRoot, "");
  return {
    entries,
    truncated,
  };
}

export const repoFileReaderDefinition: SkillDefinition = {
  id: "repoFileReader",
  version: "1.0.0",
  description:
    "Read bounded repository files, JSON metadata, or directory listings for posture lanes",
  inputs: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Repo-relative file or directory path from the requesting agent workspace",
      },
      logicalPath: {
        type: "string",
        description: "Optional logical repo-relative path for returned evidence labels",
      },
      mode: {
        type: "string",
        enum: ["exists", "text", "json", "directory"],
        description: "Read mode",
      },
      recursive: {
        type: "boolean",
        description: "Recurse into directories when mode=directory",
        default: false,
      },
      maxEntries: {
        type: "number",
        description: "Maximum directory entries to return",
        default: 200,
      },
      extensions: {
        type: "array",
        items: { type: "string" },
        description: "Optional file extensions to include when mode=directory",
      },
    },
    required: ["filePath"],
    examples: [
      { filePath: "../../package.json", logicalPath: "package.json", mode: "json" },
      {
        filePath: "../../agents",
        logicalPath: "agents",
        mode: "directory",
        recursive: false,
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
      kind: { type: "string" },
      content: { type: "string" },
      json: { type: "object" },
      entries: { type: "array" },
      metadata: { type: "object" },
      error: { type: "string" },
    },
  },
  permissions: {
    fileRead: ["workspace"],
  },
  provenance: {
    author: "OpenClaw Team",
    source: "https://github.com/openclawio/orchestrator/commit/repo-file-reader",
    version: "1.0.0",
    license: "Apache-2.0",
  },
  audit: {
    passed: true,
    runAt: new Date().toISOString(),
    checks: [
      {
        name: "bounded-repo-read",
        status: "pass",
        message: "Reads bounded repo files or directory metadata only.",
      },
      {
        name: "no-mutation",
        status: "pass",
        message: "Does not modify repository content.",
      },
    ],
    riskFlags: [],
  },
};

export async function executeRepoFileReader(
  input: RepoFileReaderInput,
): Promise<Record<string, unknown>> {
  const filePath = normalizeRequestedFilePath(input?.filePath);
  const validationError = validateRelativeWorkspacePath(filePath);
  const logicalPath = normalizeLogicalPath(
    typeof input?.logicalPath === "string" ? input.logicalPath : filePath,
  );
  const mode = REPO_READER_MODES.includes(input?.mode as RepoReaderMode)
    ? (input.mode as RepoReaderMode)
    : "text";
  const recursive = input?.recursive === true;
  const maxEntries = clampInteger(input?.maxEntries, 200, { min: 1, max: 1000 });
  const extensions = Array.isArray(input?.extensions)
    ? input.extensions
        .filter(
          (entry): entry is string =>
            typeof entry === "string" && entry.trim().length > 0,
        )
        .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`).toLowerCase())
    : [];

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

    if (mode === "exists") {
      return {
        success: true,
        filePath,
        logicalPath,
        exists: true,
        kind: fileStat.isDirectory() ? "directory" : "file",
        metadata: {
          bytes: fileStat.isDirectory() ? null : fileStat.size,
          modifiedAt: toIsoTimestamp(fileStat.mtimeMs),
        },
      };
    }

    if (mode === "directory") {
      if (!fileStat.isDirectory()) {
        return {
          success: false,
          filePath,
          logicalPath,
          exists: true,
          error: "repoFileReader expected a directory path",
        };
      }

      const directoryResult = await collectDirectoryEntries({
        absoluteRoot: absolutePath,
        logicalRoot: logicalPath,
        recursive,
        maxEntries,
        extensions,
      });

      return {
        success: true,
        filePath,
        logicalPath,
        exists: true,
        kind: "directory",
        entries: directoryResult.entries,
        metadata: {
          bytes: null,
          modifiedAt: toIsoTimestamp(fileStat.mtimeMs),
          recursive,
          truncated: directoryResult.truncated,
          entryCount: directoryResult.entries.length,
        },
      };
    }

    if (fileStat.isDirectory()) {
      return {
        success: false,
        filePath,
        logicalPath,
        exists: true,
        error: "repoFileReader expected a file path",
      };
    }

    const content = await readFile(absolutePath, "utf-8");

    if (mode === "json") {
      return {
        success: true,
        filePath,
        logicalPath,
        exists: true,
        kind: "file",
        json: JSON.parse(content),
        metadata: {
          bytes: fileStat.size,
          modifiedAt: toIsoTimestamp(fileStat.mtimeMs),
        },
      };
    }

    return {
      success: true,
      filePath,
      logicalPath,
      exists: true,
      kind: "file",
      content,
      metadata: {
        bytes: fileStat.size,
        modifiedAt: toIsoTimestamp(fileStat.mtimeMs),
      },
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return {
        success: true,
        filePath,
        logicalPath,
        exists: false,
        kind: "missing",
      };
    }

    return {
      success: false,
      filePath,
      logicalPath,
      exists: false,
      error: error?.message ?? "Failed to read repository file",
    };
  }
}
