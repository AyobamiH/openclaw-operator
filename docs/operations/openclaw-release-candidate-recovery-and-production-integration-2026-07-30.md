---
title: "OpenClaw Release-Candidate Recovery And Production Integration"
summary: "Dirty-tree forensics, preserved-work receipts, production integration evidence, activation gates, rollback, and final readiness decision."
---

# OpenClaw Release-Candidate Recovery And Production Integration

Date: 2026-07-30
Scope: Deterministic Self-Identification Publishing Engine
Decision scope: local release recovery and production integration only
External publications during this work: 0
Service restarts, schedule changes, installs, pushes, releases and deployments: 0

## Executive Verdict

**CONDITIONAL GO for an explicitly approved shadow-only installation. NO GO for
provider-writing activation.**

The source is now an explainable, recoverable local release candidate. The
publishing engine is specification-conformant, the separate production campaign
lane exists, shared account admission is implemented in the canonical official
connector, exact-runner shadow execution passed with live publication history,
and rollback logic passed in isolation.

Production is not yet allowed to publish through this lane because the
candidate connector and host configuration are not installed, the Gateway has
not been reloaded, the product schedule does not exist, and the candidate has
not accumulated natural-slot shadow evidence in the installed runtime. Those
steps change runtime ownership and remain separately approval-gated.

This is an operational gate, not a request for more product features.

## Evidence And Repository Recovery

### Canonical repositories

| Responsibility | Canonical repository | Remote | Candidate commit |
|---|---|---|---|
| Operator product and campaign lane | `projects/openclaw-operator` | `https://github.com/AyobamiH/openclaw-operator.git` | `5301ffce18ef49a0bcb7091799e8c84c75363c01` before this evidence-only report commit |
| Official Meta connector and shared admission | `projects/relay-live-business-engagement-connector` | `https://github.com/AyobamiH/relay-live-business-engagement-connector.git` | `ee2c2cc96105a08f278ae8e61f0e369d7f127e90` |

The operator candidate is on
`reconcile/control-plane-portable-20260725`, six commits ahead of
`origin/main` and zero behind. The branch has no configured upstream, so
`origin/main...HEAD` was used explicitly. The connector candidate is on
`main`, one commit ahead of its configured upstream and zero behind. Neither
repository was pushed.

Other worktrees were not guessed to be canonical. They were inventoried and
left untouched. The active repository path is the workspace-bounded product
root declared by `docs/operations/repo-boundary.md`; the other worktrees remain
independent historical or feature branches.

### Preservation before disposition

The complete pre-recovery dirty tree was committed without filtering to:

- branch: `preserve/pre-recovery-20260730`
- commit: `6b66c83c1174159ab0a760eb67d3f5915b38d39b`
- worktree:
  `~/.openclaw/worktrees/openclaw-operator-pre-recovery-20260730`

Superseded AgentProof copies and generated release evidence were also copied
outside product source to:

`~/.openclaw/workspace/artifacts/release-recovery/openclaw-operator-20260730`

The standalone AgentProof repository was already the newer authoritative RC5
at `901c161`; the operator tree contained an older RC4 copy plus valid
operator-side integration deltas. The copy was therefore not silently
committed as parallel source. Unique deltas remain recoverable from the
preservation commit and archive.

No broad clean, destructive reset, forced checkout, opaque terminal stash or
unexplained deletion was used.

The read-only coding secret audit was unavailable for this repository because
its adapter enables only `repo-map`; it did not read target files. A bounded
filename-only scan of the candidate diffs found no committed `.env`, private
key, credential or secret file, and a value-suppressing candidate-diff pattern
scan found no newly introduced private-key, API-key, access-token or
client-secret assignment. `.env` values, credential stores and runtime-injected
secrets were not read. SecretRefs remain the runtime contract.

### Path-by-path disposition

The full 408-path machine-readable disposition is:

`~/.openclaw/workspace/artifacts/release-recovery/openclaw-operator-20260730/path-disposition.json`

SHA-256:
`1e64eb5bd3345750922c603556cb0c3687e0c4a004de1c8a7e873590c0999aed`

It records, for every original dirty path: Git status, classification, owner,
uniqueness, destination/action, reversibility, test impact and commit grouping.
The checked-in generator is
`scripts/generate-release-recovery-manifest.mjs`.

| Classification | Paths | Disposition |
|---|---:|---|
| Publishing-engine release source | 21 | retained and intentionally committed |
| Valid unrelated source work | 16 | retained in coherent commits or isolated in preservation branch |
| Required documentation | 10 | retained and intentionally committed |
| Required test or fixture | 4 | retained and intentionally committed |
| Required configuration | 7 | retained and intentionally committed |
| Generated reproducible artefact | 272 | external recovery archive; not product source |
| Duplicate or superseded content | 78 | external archive and preservation branch |
| Unresolved and preservation-required | 0 | none |

Mutable SQLite databases, JSON state, logs and generated evidence are no longer
product-source responsibilities. Systemd declarations point operator state to
`~/.openclaw/state/openclaw-operator`, and
`OPENCLAW_OPERATOR_STATE_DIR` forces publishing state to:

`~/.openclaw/state/openclaw-operator/database/deterministic-publishing.sqlite`

No active service was found writing state into the canonical Git repository.

### Intentional commit groups

| Commit | Concern |
|---|---|
| `a34583b2fb461edb89ccd84dd3f1c998c8d90dec` | declare the coding evidence adapter |
| `0243b281898ad17d0757a800a08a5fc2df427932` | route operator mutable state outside source |
| `5d206332edb49042992cf86ac18c3662fd55a045` | fail fast on terminal integration runs |
| `f321f868c4b66047ddfb1c4536711f0924eca365` | deterministic publishing-engine release source |
| `5301ffce18ef49a0bcb7091799e8c84c75363c01` | separate production shadow lane and official worker |
| `ee2c2cc96105a08f278ae8e61f0e369d7f127e90` | connector-owned shared account publication admission |

The final documentation/disposition commit that contains this report is the
terminal local release-candidate receipt. Its exact hash is recorded by the
operator performing the review after the commit is created.

## Verified Production Topology

The live estate currently has four independent publication jobs:

| Job | Runtime owner | Campaign ownership | State/outbox |
|---|---|---|---|
| `68b10c5c-f604-4567-9213-d0d1eab08106` | `threads-outbox-runner:text` | existing Threads text campaign | legacy Threads state/outbox |
| `083e3560-40fd-4487-9d78-674f64866ef7` | `threads-outbox-runner:image` | existing Threads image campaign | legacy Threads state/outbox |
| `24afbb84-457c-41bb-92c9-24a19725e984` | `instagram-publisher-outbox-runner:image` | existing Instagram image campaign | legacy Instagram state/outbox |
| `2c7071ff-35dd-40d0-bf77-b1ed53de256e` | `instagram-publisher-outbox-runner:reel` | existing Instagram Reel campaign | legacy Instagram state/outbox |

The reply monitor is not a publication authority. All legacy writers call the
existing `social-publication-worker`, which invokes the official
`relay_live_business_engagement_execute` connector path. The connector is
therefore the correct shared account-admission boundary; it is not the owner of
campaign selection or campaign schedules.

The installed connector remains version 0.8.1. Canonical source was 0.8.2
before this work and now has the uninstalled 0.9.0 candidate. The installed
Gateway has not loaded shared admission or the product runner.

## Final Ownership Matrix

| Responsibility | Authority after approved shadow installation | Evidence |
|---|---|---|
| Existing campaign planning | existing four legacy runners | protected job IDs have `mutationPolicy: untouched` |
| Self-Identification planning | deterministic engine | registry, selector and immutable content specification |
| Existing campaign slots | existing legacy schedulers | no legacy schedule/config change |
| Five product opportunities | separate product runner | exact allocation in `production-integration.v1.json` |
| Account quota, spacing, collision, duplicate and unresolved-write admission | official connector 0.9.0 | atomic SQLite `BEGIN IMMEDIATE` admission |
| Product reservations, outcomes and audit | product SQLite store | deterministic state machine and hash-chained audit |
| Provider transport | existing official Meta adapters | no product provider-write HTTP route |
| Publication truth | official provider readback | verify/owned-history discovery contract |
| Product-publication metrics | product official-worker adapter | Threads `post_insights`; Instagram honest null unavailable |
| Legacy metric collection | existing legacy workflows | explicitly outside this lane |

Exactly one owner exists for each product responsibility in the candidate
design. Shared admission is intentionally account-scoped and cross-lane;
campaign planning remains lane-scoped.

## Opportunity Allocation

The five Europe/London opportunities are product-specific, not estate-global:

| Product opportunity | Platform | Canary eligibility |
|---|---|---|
| `self-id-0500` at 05:00 | Threads | no |
| `self-id-0700` at 07:00 | Instagram | no |
| `self-id-1100` at 11:00 | Instagram | no |
| `self-id-1500` at 15:00 | Threads | yes |
| `self-id-1700` at 17:00 | Instagram | no |

Only 15:00 Threads currently has canary eligibility because it is the bounded
non-overlapping natural slot demonstrated against the legacy cadence. An
unknown or mismatched time fails closed. Canary/live execution also fails
closed while the approved manifest remains `mode: shadow`.

## Integration Blockers: Finding And Resolution

| Blocker | Verified finding | Local resolution | Production status |
|---|---|---|---|
| No production runner | no loaded product job or adapter existed | exact production runner, CLI and official-worker adapter added | uninstalled |
| No shared admission | legacy paths converged only at connector execute | connector 0.9.0 adds atomic cross-lane admission | uninstalled |
| No explicit allocation | five registry times were not live-owned | five named product-only opportunities declared | uninstalled |
| No exact shadow proof | previous proof was harness-only | exact runner/connector/history path exercised with final mutation disabled | passed locally |
| No rollback rehearsal | prior plan only described rollback | backup/replace/restore/remove-job rehearsal added | isolated pass; live reload not rehearsed |
| Reel scheduler error | cron retained prior layout-validation error | exact Reel validate-only path now passes | natural cron status still awaits a successful run |
| Metric adapter empty | runtime adapter returned no metric records | official Threads insights mapped; Instagram returns null unavailable | focused tests pass |

## Shared Account Admission

Connector 0.9.0 owns the sole cross-campaign admission database. It:

- imports existing activity history read-only;
- reserves atomically with SQLite `BEGIN IMMEDIATE`;
- applies account/platform daily limits, minimum spacing and collision windows;
- admits only declared lane/opportunity pairs;
- blocks exact and normalized near-duplicates across legacy and product lanes;
- blocks while any provider write remains pending or ambiguous;
- keeps ambiguous reservations across restart;
- requires evidence-bound reconciliation before an old ambiguous write can be
  classified as confirmed absent;
- finalizes the reservation from official connector outcome; and
- evaluates the same policy in shadow mode without creating a reservation or
  resolving credentials.

Two historical Threads ambiguities were not ignored. Their idempotency keys and
evidence references are declared in the integration manifest. Both were
officially checked and classified as absent, so they do not permanently block
the account and cannot be retried accidentally.

## State And Migration Scope

No destructive legacy state migration is required or permitted.

Required new runtime state:

- product database:
  `~/.openclaw/state/openclaw-operator/database/deterministic-publishing.sqlite`;
- shared admission database:
  `~/.openclaw/state/relay-live-business-engagement/account-admission.sqlite`;
- existing connector activity ledger remains the historical publication source.

At first connector load, historical publication entries are imported with
`INSERT OR IGNORE`; the source ledger is not rewritten. Product state,
reservations, audit history and final outcomes stay in the product database.
Admission reservations and cross-lane publication facts stay in the separate
admission database. Existing campaign SQLite/JSON state and outboxes are not
moved.

## Components Outside Activation Scope

The following must remain untouched:

- all four legacy job IDs, schedules, campaign copy and quotas;
- legacy Threads and Instagram outboxes and campaign state;
- reply monitoring;
- account identities and credential references;
- official provider adapters except installation of the reviewed connector
  candidate at the existing connector boundary;
- existing publication history;
- unrelated AgentProof worktrees and repositories;
- operator UI and unrelated agent workflows.

Activation must not retire, merge or reduce the frequency of an existing
campaign.

## Zero-Write Shadow Evidence

The exact product runner was invoked for `self-id-1500` at 15:00 Europe/London
through connector 0.9.0 with the real activity ledger and isolated candidate
state:

- product result: `shadow_verified`;
- content hash:
  `4cf646de9e59675b7aeb094736f0535ca1b5fbdffa97324903a5f9a7c8c09070`;
- connector idempotency key:
  `46d663304aa05ba4ab8c29b23a1e1c640e4550b30400af1fa9daf5dac7f3e6b0`;
- shared admission: passed under `threads-owner-shared`;
- imported history counted: 3;
- unresolved writes: 0;
- audit chain: valid;
- external writes: 0;
- LLM calls: 0.

The same rendered candidate was also sent through the currently installed
Gateway connector in official dry-run mode. It validated with the same
idempotency key and zero writes, but returned no `accountAdmission` receipt.
That difference proves both the installed-runtime blocker and the candidate
resolution.

A second execution against the same product state recovered the terminal
`shadow_verified` outcome and suppressed connector dispatch, proving restart
idempotency.

## Instagram Reel Baseline

The live cron record still carries its previous
`command exited with code 1` layout-validation result. The exact production
worker was subsequently executed for its natural slot with `--validate-only`.
It passed:

- canonical render/layout audit;
- scene coverage, safe margins, contrast and reading time;
- connector authentication/readiness;
- 100-item official owned-feed read;
- no unresolved Instagram outbox write;
- upload dry-run only;
- SHA-256:
  `80d9e0e782301e2e5e1dc224564add7db8918013ae546efb3f58fe9924432b42`;
- external writes: 0;
- LLM calls: 0;
- Browser Relay calls: 0.

The underlying error is locally repaired. The production baseline remains
operationally conditional until the unchanged natural Reel job records one
successful scheduled result. This does not authorize a manual publication.

## Rollback Verification

The isolated rehearsal:

1. recorded hashes of the installed connector/config and both new state files;
2. backed up connector and config;
3. installed candidate files and declared a product job in the rehearsal area;
4. restored the previous connector and config;
5. removed only the product job declaration;
6. verified product and admission evidence hashes were unchanged.

Result: pass, zero provider writes, and no Gateway reload.

Rollback is therefore complete at the file/state contract level. It is not yet
production-rehearsed across an actual Gateway reload because restarting or
reloading production was explicitly forbidden. That remaining operational step
must be rehearsed during the approved shadow installation window before any
canary approval.

## Verification Results

- full operator `npm run verify`: passed;
  - operator UI and orchestrator builds;
  - both TypeScript checks;
  - documentation drift and link checks;
  - 92/92 unit fixtures;
  - 33/33 live middleware integration tests;
  - 33/33 operator UI tests;
- focused publishing engine acceptance: 35/35 passed;
- production integration tests: 6/6 passed;
- connector full check: passed;
  - typecheck;
  - 118 tests: 117 passed and one intentionally skipped non-publishing canary;
  - account-admission focused tests: 7/7;
  - manifest and portable-package checks;
- deterministic five-slot diagnostic: passed;
- seven-day sequential portfolio replay: 35 opportunities, 33 simulated
  verified outcomes and two policy-correct skips;
- all seven products rotated;
- Self-Identification primary on 7/7 days;
- Tax Lien Self-Identification exercised;
- campaign/strategy integrity, immutable hash tamper protection, stable replay
  and audit chain: passed;
- account-admission quota, spacing, collision, concurrency, exact duplicate,
  near-duplicate, unresolved-write and historical reconciliation tests: passed;
- provider-ID extraction and ambiguous-write reconciliation tests: passed;
- verification provider writes: 0;
- verification LLM calls: 0.

## Remaining Operational Blockers

Provider-writing activation remains blocked until all of the following are
closed:

1. local commits are reviewed and the separately approved release/install path
   is chosen; nothing has been pushed or released;
2. connector 0.9.0 and its admission configuration are installed at the
   existing connector boundary;
3. protected-state backup hashes and a production rollback packet are recorded;
4. the Gateway is reloaded and reports the candidate connector/config;
5. exact dry-runs prove all four legacy jobs still pass through shared admission
   without campaign-behaviour changes;
6. one product shadow job is installed with the manifest still locked to
   `shadow`;
7. all five natural product opportunities complete exact-path shadows with zero
   external writes and valid audit chains;
8. the unchanged Reel scheduler records a natural successful result;
9. rollback is rehearsed through the installed runtime without deleting either
   evidence database;
10. a separate human approval names the one 15:00 Threads canary opportunity
    and authorizes one provider write.

## Risk Assessment And Mitigations

| Risk | Severity | Mitigation/gate |
|---|---|---|
| Legacy and product publish concurrently | high | connector-owned atomic admission, spacing and collision checks |
| Product consumes legacy slots | high | five explicit product opportunity IDs; four legacy jobs protected |
| Duplicate across lanes | high | activity import plus exact/normalized fingerprints |
| Retry after ambiguous provider response | critical | persistent ambiguous reservation; reconcile before another attempt |
| Installed candidate differs from tested source | high | record source/package/config hashes before reload |
| Mutable state returns to Git source | medium | external state directories and clean-tree post-run proof |
| Rollback loses product evidence | high | remove job/restore connector only; preserve both databases |
| Historical Reel failure obscures baseline | medium | require one natural green result before canary |
| Instagram metrics mistaken for zero | medium | explicit null `unavailable` records |
| Local commits lost or mis-grouped | medium | preservation branch, archive and coherent commit receipts |

## Bounded Production Activation Sequence

This sequence requires separate approval. Stop on any failed check.

### A. Shadow installation

1. Record exact operator and connector commit/package hashes.
2. Back up installed connector files, connector configuration, activity ledger
   and current scheduler declarations; verify backup hashes.
3. Create the external product/admission state directories with owner-only
   permissions.
4. Install connector 0.9.0 over the existing connector boundary; do not add a
   second connector or transport.
5. Add account-admission configuration for the two existing account keys,
   legacy lane and five product opportunities; keep existing credential
   references unchanged.
6. Reload the Gateway in the approved window.
7. Verify connector version, account identities, readiness, official owned-feed
   reads and zero unresolved writes.
8. Dry-run each of the four existing publication workers through the exact
   connector path. Confirm no copy, schedule, quota or outbox change.
9. Install exactly one product scheduler declaration that invokes the runner
   with `opportunityId=auto`; keep the integration manifest `mode: shadow`.
10. Observe all five natural Europe/London opportunities. Require
    `shadow_verified`, admission evidence, valid audit chain, zero provider
    writes and zero LLM calls at each.
11. Rehearse installed-runtime rollback: remove product job, restore connector
    and config, reload, verify legacy paths, then reinstall shadow candidate.
    Preserve both new databases throughout.

### B. One-write canary

Only after a separate approval:

1. name `self-id-1500` and a single date in the approval record;
2. verify the preceding and following legacy Threads windows remain outside the
   admission spacing boundary;
3. back up state and confirm no pending/ambiguous write;
4. change only the approved manifest mode to `canary`;
5. authorize one provider write for that opportunity;
6. require a single reservation, a single connector mutation attempt, official
   provider-ID extraction, official readback and terminal verified outcome;
7. return immediately to shadow mode;
8. do not expand to the other four opportunities without a new evidence review
   and approval.

## Post-Activation Verification

1. Confirm the product outcome, provider ID, permalink and official account
   ownership.
2. Verify connector activity, admission reservation and product audit all share
   the same idempotency/content identity.
3. Verify no pending or ambiguous write remains.
4. Confirm the product daily quota and primary-campaign rule from product state.
5. Confirm account-level quota, spacing and collision counts include both
   legacy and product publications.
6. Check official owned history for exact and normalized duplicates.
7. Verify Threads metrics from official post insights or honest unavailable
   records; verify Instagram metrics remain null unavailable.
8. Verify all four legacy jobs remain enabled, retain their original schedules
   and continue to use their original state/outboxes.
9. Verify the Reel natural-run status is green.
10. Verify source repositories remain clean and runtime state exists only in
    external state directories.
11. Verify audit chains and backup hashes.
12. If any check fails, remove the product job, restore connector/config,
    reload, verify legacy publishing readiness, and retain both product and
    admission databases for reconciliation.

## Final Recommendation

Approve only a bounded **shadow installation and installed-runtime rollback
rehearsal** after reviewing the local commits. Do not approve provider-writing
activation yet.

If the five natural shadows, unchanged legacy dry-runs, natural Reel recovery
and live rollback rehearsal all pass, approve one explicitly dated
`self-id-1500` Threads canary. The product remains a separate campaign lane; it
must never become the publication authority for unrelated Threads or Instagram
campaigns.
