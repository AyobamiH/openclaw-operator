#!/usr/bin/env node
// Emits a source identity receipt into the exact Pages artifact, never into source.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export function releaseReceipt({ sha, repository }) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('release_sha_invalid');
  if (repository !== 'AyobamiH/openclaw-operator') throw new Error('release_repository_invalid');
  return { schema_version: 1, repository, sha };
}

export async function writeReceipt(directory, environment = process.env) {
  if (!directory) throw new Error('build_directory_required');
  const receipt = releaseReceipt({ sha: environment.RELEASE_SHA, repository: environment.RELEASE_REPOSITORY });
  const target = resolve(directory);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, '__release.json'), JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o644 });
  return receipt;
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  writeReceipt(process.argv[2]).then(r => console.log(`Pages release receipt: ${r.sha}`)).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
