#!/usr/bin/env node
// A production deployment status is written only after a completed Pages
// deployment serves the exact source-bound release receipt. No historical
// deployment status is rewritten.
const REPOSITORY = 'AyobamiH/openclaw-operator';
const PAGE = 'https://ayobamih.github.io/openclaw-operator/';
const API = 'https://api.github.com/repos/' + REPOSITORY;
const DESCRIPTION = 'Verified source-bound GitHub Pages release';
const SHA = /^[a-f0-9]{40}$/;

function refuse(code) { throw new Error(code); }
function validResponse(x) { return x && typeof x.status === 'number' && typeof x.text === 'function'; }

export function intent(environment) {
  if (environment.GITHUB_REPOSITORY !== REPOSITORY || environment.GITHUB_REF !== 'refs/heads/main')
    refuse('unexpected_repository_or_branch');
  if (!SHA.test(environment.GITHUB_SHA || '')) refuse('source_sha_invalid');
  if (environment.PAGE_URL !== PAGE) refuse('pages_url_not_canonical');
  if (typeof environment.GITHUB_TOKEN !== 'string' || environment.GITHUB_TOKEN.length < 10)
    refuse('missing_github_authority');
  return { repository: REPOSITORY, sha: environment.GITHUB_SHA, url: PAGE };
}

export async function publish(environment = process.env, { request = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), maxAttempts = 5 } = {}) {
  const { sha, url } = intent(environment);
  const apiHeaders = {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + environment.GITHUB_TOKEN,
    'X-GitHub-Api-Version': '2022-11-28',
  };

  async function json(endpoint, { method = 'GET', body, github = true, limit = 131072 } = {}) {
    const headers = github ? { ...apiHeaders } : { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await request(endpoint, {
        method,
        redirect: 'manual',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(8000),
      });
    } catch { refuse(github ? 'github_transport_unavailable' : 'pages_receipt_unavailable'); }
    if (!validResponse(response) || response.status < 200 || response.status >= 300)
      refuse(github ? 'github_request_unsuccessful' : 'pages_receipt_unavailable');
    let raw;
    try { raw = await response.text(); } catch { refuse('response_read_unavailable'); }
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > limit) refuse('response_oversize');
    try { return JSON.parse(raw); } catch { refuse('response_json_invalid'); }
  }

  // GitHub's Pages API is independent confirmation of the configured official
  // public destination, not a replacement for the on-site exact SHA receipt.
  const pages = await json(API + '/pages');
  if (!pages || pages.html_url !== url || pages.https_enforced !== true
      || pages.public !== true || pages.build_type !== 'workflow'
      || pages.source?.branch !== 'main')
    refuse('pages_configuration_not_authenticated');

  // A prior, cached site or a 200 HTML response is not proof of this release.
  let live = false;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const receipt = await json(url + '__release.json', { github: false, limit: 4096 });
      live = receipt?.schema_version === 1 && receipt.repository === REPOSITORY && receipt.sha === sha;
    } catch (err) {
      if (!['pages_receipt_unavailable', 'github_request_unsuccessful'].includes(err.message)) throw err;
    }
    if (live) break;
    if (attempt + 1 < maxAttempts) await pause(2000);
  }
  if (!live) refuse('exact_live_pages_release_unverified');

  // Post-Once requires the deployment ref to be the repository's default
  // branch AND the resulting deployment SHA to match the live Pages receipt.
  // Refuse if main moved since the Pages workflow began; never create a
  // successful status for a different checkout.
  const branch = await json(API + '/git/ref/heads/main');
  if (branch?.ref !== 'refs/heads/main' || branch?.object?.sha !== sha)
    refuse('default_branch_source_changed');

  // Resume only this source's own pending proof. A legacy production status
  // with a different description/URL is not retroactively overwritten.
  const existing = await json(API + '/deployments?sha=' + sha + '&environment=production&per_page=10');
  if (!Array.isArray(existing)) refuse('deployment_inventory_invalid');
  let deployment;
  for (const row of existing) {
    if (!row || row.sha !== sha || row.environment !== 'production'
        || row.ref !== 'main' || row.description !== DESCRIPTION) continue;
    if (!Number.isSafeInteger(row.id) || row.id <= 0) refuse('deployment_identity_invalid');
    const statuses = await json(API + '/deployments/' + row.id + '/statuses?per_page=10');
    if (!Array.isArray(statuses)) refuse('deployment_status_invalid');
    const latest = statuses[0];
    if (latest?.state === 'success' && latest.environment_url === url)
      return { status: 'already_verified', deployment_id: row.id, source_sha: sha };
    if (latest && latest.state !== 'pending')
      refuse('previous_source_proof_conflict');
    deployment = row;
    break;
  }

  if (!deployment) {
    deployment = await json(API + '/deployments', {
      method: 'POST',
      body: {
        ref: 'main', environment: 'production', production_environment: true,
        auto_merge: false, description: DESCRIPTION,
      },
    });
    if (!Number.isSafeInteger(deployment?.id) || deployment.id <= 0
        || deployment.sha !== sha || deployment.ref !== 'main'
        || deployment.environment !== 'production')
      refuse('created_deployment_identity_mismatch');
  }

  const status = await json(API + '/deployments/' + deployment.id + '/statuses', {
    method: 'POST',
    body: {
      state: 'success', environment_url: url, auto_inactive: false,
      description: 'Live exact source receipt independently verified',
    },
  });
  if (status?.state !== 'success' || status.environment_url !== url)
    refuse('created_status_identity_mismatch');
  const readback = await json(API + '/deployments/' + deployment.id + '/statuses?per_page=10');
  if (!Array.isArray(readback) || readback[0]?.id !== status.id
      || readback[0]?.state !== 'success' || readback[0]?.environment_url !== url)
    refuse('deployment_status_readback_mismatch');
  return { status: 'created_and_verified', deployment_id: deployment.id, source_sha: sha };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  publish().then(result => {
    process.stdout.write(JSON.stringify(result) + '\n');
  }).catch(error => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
