import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseReceipt, writeReceipt } from './write-pages-release-receipt.mjs';
const sha = 'a'.repeat(40), repository = 'AyobamiH/openclaw-operator';
test('canonical source identity and exact JSON', () => {
  assert.deepEqual(releaseReceipt({sha, repository}), {schema_version:1, repository, sha});
});
test('rejects untrusted or incomplete source identity', () => {
  for (const value of ['', '0'.repeat(39), 'G'.repeat(40), 'a'.repeat(41)])
    assert.throws(() => releaseReceipt({sha:value,repository}), /release_sha_invalid/);
  assert.throws(() => releaseReceipt({sha,repository:'someone/other'}), /release_repository_invalid/);
});
test('writes to artifact only and rejects replacement', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'openclaw-pages-receipt-'));
  try {
    const env={RELEASE_SHA:sha,RELEASE_REPOSITORY:repository};
    await writeReceipt(dir,env);
    assert.deepEqual(JSON.parse(await readFile(join(dir,'__release.json'),'utf8')),releaseReceipt({sha,repository}));
    await assert.rejects(writeReceipt(dir,env), /EEXIST/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
