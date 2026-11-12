import test from 'node:test';
import assert from 'node:assert/strict';
import { intent, publish } from './record-pages-production-deployment.mjs';

const SHA = 'a'.repeat(40);
const PAGE = 'https://ayobamih.github.io/openclaw-operator/';
const API = 'https://api.github.com/repos/AyobamiH/openclaw-operator';
const env = Object.freeze({
  GITHUB_REPOSITORY: 'AyobamiH/openclaw-operator',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: SHA,
  PAGE_URL: PAGE,
  GITHUB_TOKEN: 'test-only-not-real-token',
});

function fixture(overrides = {}) {
  const calls = [];
  const statuses = overrides.statuses ?? [];
  const pages = overrides.pages ?? {
    html_url: PAGE, public: true, https_enforced: true,
    build_type: 'workflow', source: { branch: 'main', path: '/' },
  };
  const release = overrides.release ?? {
    schema_version: 1, repository: env.GITHUB_REPOSITORY, sha: SHA,
  };
  const state = { createdId: 900, created: false, latestStatuses: statuses };
  const json = (x, status = 200) => new Response(JSON.stringify(x), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  const request = async (url, options) => {
    const method = options?.method ?? 'GET';
    calls.push({ url, method, headers: options.headers, body: options.body });
    if (url === API + '/pages' && method === 'GET')
      return overrides.githubCode ? json({}, overrides.githubCode) : json(pages);
    if (url === PAGE + '__release.json') {
      if (overrides.pageCode) return json({}, overrides.pageCode);
      return json(release);
    }
    if (url === API + '/git/ref/heads/main')
      return json({ ref: 'refs/heads/main', object: { sha: overrides.branchSha ?? SHA } });
    if (url === API + '/deployments?sha=' + SHA + '&environment=production&per_page=10')
      return json(overrides.existing ?? []);
    if (url === API + '/deployments' && method === 'POST') {
      state.created = true;
      const body = JSON.parse(options.body);
      return json({ id: 900, sha: overrides.deployedSha ?? SHA, ref: body.ref, environment: body.environment });
    }
    if (/\/deployments\/\d+\/statuses\?per_page=10$/.test(url) && method === 'GET')
      return json(state.latestStatuses);
    if (/\/deployments\/\d+\/statuses$/.test(url) && method === 'POST') {
      const body = JSON.parse(options.body);
      const status = {
        id: 1100, state: body.state, environment_url: body.environment_url,
      };
      if (!overrides.badReadback) state.latestStatuses = [status];
      return json(overrides.badStatus ? { ...status, environment_url: 'https://evil.example/' } : status, 201);
    }
    throw Error('unexpected_test_request:' + method + ' ' + url);
  };
  return { calls, request, state };
}

async function run(f, options = {}) {
  return publish(env, { request: f.request, pause: async () => {}, maxAttempts: 2, ...options });
}

function writes(f) { return f.calls.filter(c => c.method !== 'GET'); }

test('rejects untrusted repository, branch, source and Pages URL before any request', () => {
  for (const field of ['GITHUB_REPOSITORY', 'GITHUB_REF', 'GITHUB_SHA', 'PAGE_URL', 'GITHUB_TOKEN']) {
    assert.throws(() => intent({ ...env, [field]: 'wrong' }));
  }
  assert.deepEqual(intent(env), { repository: env.GITHUB_REPOSITORY, sha: SHA, url: PAGE });
});

test('new status is emitted only after authenticated Pages and live SHA proof', async () => {
  const f = fixture();
  const result = await run(f);
  assert.equal(result.status, 'created_and_verified');
  assert.equal(result.source_sha, SHA);
  assert.equal(writes(f).length, 2);
  const created = JSON.parse(writes(f)[0].body);
  assert.equal(Object.hasOwn(created, 'required_contexts'), false); // honour GitHub CI admission
  assert.equal(created.auto_merge, false);
  assert.equal(created.production_environment, true);
  assert.equal(created.ref, 'main');
  assert.equal(created.environment, 'production');
  const posted = JSON.parse(writes(f)[1].body);
  assert.equal(posted.state, 'success');
  assert.equal(posted.environment_url, PAGE);
  assert.equal(posted.auto_inactive, false);
  assert.ok(f.calls.some(c => c.url === PAGE + '__release.json'));
  assert.ok(!f.calls.find(c => c.url === PAGE + '__release.json').headers.Authorization);
  assert.ok(f.calls.find(c => c.url === API + '/pages').headers.Authorization);
  assert.ok(f.calls.every(c => !c.url.startsWith('http://')));
});

test('existing exact successful status is idempotent and requires no writes', async () => {
  const f = fixture({
    existing: [{ id: 42, sha: SHA, environment: 'production', ref: 'main',
      description: 'Verified source-bound GitHub Pages release' }],
    statuses: [{ id: 77, state: 'success', environment_url: PAGE }],
  });
  assert.equal((await run(f)).status, 'already_verified');
  assert.equal(writes(f).length, 0);
});

test('a new source proof reuses only its own pending deployment', async () => {
  const f = fixture({
    existing: [{ id: 42, sha: SHA, environment: 'production', ref: 'main',
      description: 'Verified source-bound GitHub Pages release' }],
    statuses: [{ id: 77, state: 'pending', environment_url: '' }],
  });
  assert.equal((await run(f)).deployment_id, 42);
  assert.equal(writes(f).length, 1);
  assert.match(writes(f)[0].url, /deployments\/42\/statuses$/);
});

test('old legacy deployment descriptions are not rewritten', async () => {
  const f = fixture({
    existing: [{ id: 42, sha: SHA, environment: 'production', ref: 'main',
      description: 'Old deploy with missing environment URL' }],
  });
  assert.equal((await run(f)).status, 'created_and_verified');
  assert.equal(writes(f).length, 2);
  assert.ok(!f.calls.some(c => c.url.includes('/deployments/42/statuses')));
});

test('a later failure or mismatched success on our own deployment refuses', async () => {
  for (const statuses of [
    [{ id: 1, state: 'failure', environment_url: PAGE },
      { id: 0, state: 'success', environment_url: PAGE }],
    [{ id: 1, state: 'success', environment_url: 'https://other.example/' }],
  ]) {
    const f = fixture({
      existing: [{ id: 42, sha: SHA, environment: 'production', ref: 'main',
        description: 'Verified source-bound GitHub Pages release' }],
      statuses,
    });
    await assert.rejects(run(f), /previous_source_proof_conflict/);
    assert.equal(writes(f).length, 0);
  }
});

test('Pages configuration must independently match public main-branch origin', async () => {
  const baseline = {
    html_url: PAGE, public: true, https_enforced: true,
    build_type: 'workflow', source: { branch: 'main' },
  };
  for (const changed of [
    { html_url: 'https://other.example/' }, { public: false },
    { https_enforced: false }, { build_type: 'legacy' },
    { source: { branch: 'gh-pages' } },
  ]) {
    const f = fixture({ pages: { ...baseline, ...changed } });
    await assert.rejects(run(f), /pages_configuration_not_authenticated/);
    assert.equal(writes(f).length, 0);
  }
});

test('stale, swapped or absent live release receipts never post success', async () => {
  for (const change of [
    { release: { schema_version: 1, repository: env.GITHUB_REPOSITORY, sha: 'b'.repeat(40) } },
    { release: { schema_version: 1, repository: 'attacker/project', sha: SHA } },
    { release: { schema_version: 0, repository: env.GITHUB_REPOSITORY, sha: SHA } },
    { pageCode: 404 },
  ]) {
    const f = fixture(change);
    await assert.rejects(run(f), /exact_live_pages_release_unverified/);
    assert.equal(writes(f).length, 0);
  }
});

test('created success requires exact status readback and refuses status mismatch', async () => {
  for (const change of [{ badStatus: true }, { badReadback: true }]) {
    const f = fixture(change);
    await assert.rejects(run(f), /created_status_identity_mismatch|deployment_status_readback_mismatch/);
  }
});

test('stale main cannot be recorded as production even with a matching live receipt', async () => {
  const f = fixture({ branchSha: 'b'.repeat(40) });
  await assert.rejects(run(f), /default_branch_source_changed/);
  assert.equal(writes(f).length, 0);
});

test('GitHub deployment SHA must match the released Pages revision', async () => {
  const f = fixture({ deployedSha: 'b'.repeat(40) });
  await assert.rejects(run(f), /created_deployment_identity_mismatch/);
  assert.equal(writes(f).length, 1);
  assert.ok(!writes(f).some(c => c.url.endsWith('/statuses')));
});

test('GitHub 403 and public-site redirects cannot produce a status write', async () => {
  const forbidden = fixture({ githubCode: 403 });
  await assert.rejects(run(forbidden), /github_request_unsuccessful/);
  assert.equal(writes(forbidden).length, 0);
  const redirected = fixture({ pageCode: 302 });
  await assert.rejects(run(redirected), /exact_live_pages_release_unverified/);
  assert.equal(writes(redirected).length, 0);
});
