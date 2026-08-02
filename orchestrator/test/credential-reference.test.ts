import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  credentialFingerprint,
  readApiCredentialReference,
} from '../src/auth/credential-reference.js';

const roots: string[] = [];

function fixture(contents: string, mode = 0o600) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-reference-'));
  roots.push(root);
  const file = path.join(root, 'orchestrator.env');
  fs.writeFileSync(file, contents, { mode });
  fs.chmodSync(file, mode);
  return file;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('credential-safe API reference', () => {
  it('selects a role-bound active rotation entry without logging it', () => {
    const file = fixture(`API_KEY_ROTATION='${JSON.stringify([
      { key: 'viewer-secret', label: 'viewer-key', roles: ['viewer'], active: true, expiresAt: '2030-01-01T00:00:00Z' },
      { key: 'admin-secret', label: 'admin-key', roles: ['admin'], active: true, expiresAt: '2030-01-01T00:00:00Z' },
    ])}'\n`);
    expect(readApiCredentialReference(file, { requiredRole: 'admin' })).toBe('admin-secret');
    expect(credentialFingerprint('admin-secret')).toMatch(/^[a-f0-9]{12}$/);
  });

  it('rejects a group-readable reference', () => {
    const file = fixture('API_KEY=unsafe\n', 0o640);
    expect(() => readApiCredentialReference(file)).toThrow('credential_reference_permissions_unsafe');
  });

  it('rejects a symlink reference', () => {
    const target = fixture('API_KEY=secret\n');
    const link = `${target}.link`;
    fs.symlinkSync(target, link);
    expect(() => readApiCredentialReference(link)).toThrow('credential_reference_symlink_or_non_file');
  });

  it('rejects missing or expired role-bound entries', () => {
    const file = fixture(`API_KEY_ROTATION='${JSON.stringify([
      { key: 'viewer-secret', roles: ['viewer'], active: true, expiresAt: '2020-01-01T00:00:00Z' },
    ])}'\n`);
    expect(() => readApiCredentialReference(file, { requiredRole: 'admin' })).toThrow(
      'credential_reference_no_matching_active_key',
    );
  });
});
