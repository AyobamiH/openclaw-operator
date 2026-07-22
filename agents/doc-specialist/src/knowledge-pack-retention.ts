import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const KNOWLEDGE_PACK_PATTERN = /^knowledge-pack-[0-9]+\.json$/;

export interface KnowledgePackRetentionOptions {
  directory: string;
  maxPacks?: number;
  manifestPath?: string;
}

export interface KnowledgePackRetentionResult {
  retainedCount: number;
  removedCount: number;
  removedBytes: number;
  removedIds: string[];
  manifestPath: string;
}

export async function enforceKnowledgePackRetention(
  options: KnowledgePackRetentionOptions,
): Promise<KnowledgePackRetentionResult> {
  const directory = resolve(options.directory);
  const maxPacks = options.maxPacks ?? 30;
  if (!Number.isInteger(maxPacks) || maxPacks < 1) {
    throw new Error("knowledge-pack maxPacks must be a positive integer");
  }

  const manifestPath = resolve(
    options.manifestPath ?? join(dirname(directory), "archive", "knowledge-pack-retention.jsonl"),
  );
  const entries = await readdir(directory, { withFileTypes: true });
  const packs = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && KNOWLEDGE_PACK_PATTERN.test(entry.name))
      .map(async (entry) => {
        const path = join(directory, entry.name);
        const fileStat = await stat(path);
        return {
          id: entry.name.slice(0, -".json".length),
          name: entry.name,
          path,
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
        };
      }),
  );
  packs.sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));

  const candidates = packs.slice(maxPacks);
  const removed = [];
  for (const candidate of candidates) {
    await unlink(candidate.path);
    removed.push(candidate);
  }

  if (removed.length > 0) {
    await mkdir(dirname(manifestPath), { recursive: true });
    await appendFile(
      manifestPath,
      `${JSON.stringify({
        event: "knowledge-pack-retention",
        prunedAt: new Date().toISOString(),
        directory,
        maxPacks,
        retainedCount: packs.length - removed.length,
        removedCount: removed.length,
        removedBytes: removed.reduce((total, entry) => total + entry.size, 0),
        removed: removed.map((entry) => ({
          id: entry.id,
          name: entry.name,
          size: entry.size,
          modifiedAt: new Date(entry.mtimeMs).toISOString(),
        })),
      })}\n`,
      "utf-8",
    );
  }

  return {
    retainedCount: packs.length - removed.length,
    removedCount: removed.length,
    removedBytes: removed.reduce((total, entry) => total + entry.size, 0),
    removedIds: removed.map((entry) => entry.id),
    manifestPath,
  };
}
