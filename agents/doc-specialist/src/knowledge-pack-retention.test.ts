import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { enforceKnowledgePackRetention } from "./knowledge-pack-retention.js";

test("retains the newest bounded pack set and records pruned metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "knowledge-pack-retention-"));
  const packDir = join(root, "knowledge-packs");
  const manifestPath = join(root, "archive", "retention.jsonl");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(packDir, { recursive: true }));

  for (let index = 1; index <= 5; index += 1) {
    const path = join(packDir, `knowledge-pack-${index}.json`);
    await writeFile(path, JSON.stringify({ id: `knowledge-pack-${index}` }), "utf-8");
    await utimes(path, index, index);
  }
  await writeFile(join(packDir, "keep-me.txt"), "not a pack", "utf-8");

  const result = await enforceKnowledgePackRetention({
    directory: packDir,
    maxPacks: 3,
    manifestPath,
  });

  assert.equal(result.retainedCount, 3);
  assert.equal(result.removedCount, 2);
  assert.deepEqual(result.removedIds, ["knowledge-pack-2", "knowledge-pack-1"]);
  assert.deepEqual(
    (await readdir(packDir)).sort(),
    [
      "keep-me.txt",
      "knowledge-pack-3.json",
      "knowledge-pack-4.json",
      "knowledge-pack-5.json",
    ],
  );

  const manifest = JSON.parse((await readFile(manifestPath, "utf-8")).trim());
  assert.equal(manifest.event, "knowledge-pack-retention");
  assert.equal(manifest.maxPacks, 3);
  assert.equal(manifest.removedCount, 2);
});

test("rejects an invalid retention count", async () => {
  await assert.rejects(
    enforceKnowledgePackRetention({
      directory: tmpdir(),
      maxPacks: 0,
    }),
    /positive integer/,
  );
});
