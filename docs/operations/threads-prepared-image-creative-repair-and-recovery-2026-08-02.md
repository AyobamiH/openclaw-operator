---
summary: "Threads prepared-image contract repair and exact missed-slot recovery proof."
status: "complete — recovered and provider verified"
date: "2026-08-02"
---

# Threads prepared-image creative repair and recovery

## 1. Verdict

`THREADS PREPARED-IMAGE FAILURE REPAIRED — MISSED SLOT SAFELY RECOVERED`

The 11:30 Europe/London Threads image slot failed closed before any provider
mutation. The producer/selection gap and misleading null-validation path were
repaired without weakening approval or completeness checks. The exact missed
slot was then recovered once through the official Threads API and independently
read back as exactly one public object.

## 2. Exact failed item

- cron job: `083e3560-40fd-4487-9d78-674f64866ef7`
- declaration: `threads-confirmed-topic-tags-daily-image-rotation-v1`
- outbox/idempotency identity:
  `threads:2026-08-02:11:30:083e3560-40fd-4487-9d78-674f64866ef7`
- failure time: `2026-08-02T10:30:00.030Z` scheduler start; the runner failed
  after 395 ms
- slot: `2026-08-02 11:30 Europe/London`
- provider/account: Threads / `threads:owner`, represented account
  `25914281681582868`
- campaign: `threads-19-confirmed-tags-image-series-20260721`
- candidate: `threads-19-confirmed-tags-image-series-20260721:cycle-3:sequence-1`
- cycle/sequence/topic: `3` / `1` / `Business Threads`
- intended type: `IMAGE`
- preparation store:
  `/home/oneclickwebsitedesignfactory/.openclaw/state/business-operations/social-outboxes/threads-prepared-payloads.json`
- durable outbox stores:
  `threads-opportunity-outbox.json` and `threads-scheduler.sqlite` in the same
  owner state directory
- preparation/approval evidence:
  `artifacts/business-value/marketing/2026-08-02/threads-prepared-image-recovery/`

At failure there was no JSON or SQLite outbox row, provider attempt, container
ID or publication ID. The null prepared allocation reached
`validatePreparedImageCreative` before the missing-allocation block could be
persisted. Recovery was therefore initially classified `confirmed_absent`, not
ambiguous or already published.

## 3. Root cause

The canonical prepared queue contained only the 19 cycle-2 creatives. The
07:00 publication advanced the campaign to cycle 3, sequence 1, but no
slot-bound cycle-3 producer record existed for 11:30. The runner correctly
rejected the absent creative, but called `buildThreadsImageSpec(null)` before
persisting its missing-allocation result, producing the less precise error
`Prepared Threads image creative must be explicitly approved and complete`.

This was a producer/selection readiness gap plus null-handling defect. It was
not a reason to weaken the validator, infer approval, or accept an incomplete
record.

## 4. Canonical creative contract

Cycle 3 and later images now use one shared producer/runner contract. A
selectable creative must be atomically durable and bind all of the following:

- schema and creative version;
- `ready`, `prepared`, `complete`, and explicitly `approved` state;
- provider `threads`, exact account and represented account;
- job, candidate, campaign, cycle, sequence, local date, slot and topic;
- complete publication text, text SHA-256 and creative fingerprint;
- frozen PNG path, actual byte SHA-256, MIME type and decoded dimensions;
- alt text and alt-text SHA-256;
- approval ID, issuer/source, binding hash, not-before and expiry;
- exact equality between approval bindings, prepared record and actual file.

Missing assets, partial persistence, changed text or bytes, cross-candidate or
cross-slot approvals, expiry, path mismatch and schema drift fail closed before
the provider boundary.

## 5. Repair implemented

- Added `scripts/threads-prepared-image-creative.mjs` as the canonical shared
  validator and selection predicate.
- Updated `scripts/threads-outbox-runner.mjs` to require the shared frozen
  contract for cycle 3+, reject partial records, persist missing allocation
  before image construction, and consume the approved pre-rendered file rather
  than regenerate after approval.
- Added an exact recovery mode. It accepts only an existing declared slot on
  the current local date, the exact job/outbox identity and a maximum 180-minute
  recovery window; arbitrary time, payload, candidate and provider overrides
  are unavailable.
- Added `scripts/prepare-threads-image-recovery-20260802.mjs`, scoped to this
  one candidate and authorisation reference. It renders first, freezes actual
  bytes and metadata, computes bindings, then atomically writes the approval
  and ready record.
- Added focused contract and recovery tests and included them in
  `npm run test:host-ops`.

The durable ordering was: render asset; verify/decode bytes; persist metadata
and hashes; bind exact approval; mark ready; select; reserve outbox; persist
write intent; upload; publish; reconcile; verify.

## 6. Approval and frozen asset

- approval: `tpa_0c1a33ad2c3e58e1ab7359cd6f3ec7d0`
- approval source: John's exact Telegram authorisation, message `3056`
- binding hash:
  `0c1a33ad2c3e58e1ab7359cd6f3ec7d013973d9b27f0bfd38cfc0784c33cd0ef`
- approved: `2026-08-02T11:27:50.784Z`
- expires: `2026-08-02T12:57:50.784Z`
- payload SHA-256:
  `b4e5ab0eae08a8b33064ca297efe7ce494489c2dd9b075887e16814fe7d2d07c`
- creative fingerprint:
  `fa51992947076d5bd94932e677f69148b9c2953d835c4f53f3451d941dd12ba2`
- image SHA-256:
  `2a6e8b66d737848a566601fdadd0b9f3e70f4405fee918e3b5003c02d81d2eed`
- image: PNG, `1080x1350`
- frozen asset:
  `artifacts/business-value/marketing/2026-08-02/threads-prepared/cycle-3-sequence-1/threads-image-20260802-1130-cycle3-seq1.png`

No media regeneration occurred after approval.

## 7. Provider absence proof before recovery

Official Threads owned-feed readback showed only the 05:00 and 07:00 posts for
2026-08-02. The exact live-session activity ledger was empty, the failed runner
had no durable provider write attempt, and the provider adapter had not been
called. No matching text/image object, container, timeout or ambiguous response
existed. Browser Relay was unavailable and unused.

## 8. Recovery decision

Classification: `recoverable`.

Provider absence was conclusive; the exact campaign candidate remained current;
the recovery was on the same local date and inside the bounded window; the
frozen creative and approval matched; no runner owned the item; no duplicate
or adjacent Threads slot collision existed; and the durable SQLite idempotency
key could enforce at-most-once dispatch.

The exact recovery command was run once. A second invocation was used only to
prove replay protection: it returned the terminal outbox row without entering
the provider adapter.

## 9. Publication and official readback

- public URL:
  `https://www.threads.com/@tailwaggingwebdesigns/post/DbiUBL1jnVc`
- provider object: `18083008883283769`
- container: `17973297489109365`
- published timestamp: `2026-08-02T11:31:30Z`
- represented username: `tailwaggingwebdesigns`
- media identity: `IMAGE` / `THREADS`
- provider mutation counts: one generated-media upload, one live publish, zero
  retries
- Browser Relay mutations: zero

Official verify and inspect calls confirmed the account, exact caption, media
type and permalink. A second bounded owned-feed readback after replay testing
found one provider-ID occurrence, one permalink occurrence and one exact
caption-lead occurrence.

## 10. Final outbox state

The exact row in `threads-scheduler.sqlite` is `published_verified`,
classification `published_verified`, provider object `18083008883283769`,
`write_evidence=1`, and `counted=1`.

One `write_attempts` row exists. It records `external_write=1`, the same exact
idempotency key and the verified provider object. Media stages are durably
ordered `render_started`, `rendered`, `validated`, `upload_started`, `uploaded`.
State transitions are `prepared -> reserved -> write_started ->
published_unverified -> published_verified`. SQLite integrity is `ok` and the
foreign-key check is empty.

## 11. Tests and validation

- focused prepared-creative, runner and state suite: `39/39` passed;
- complete host operations suite: `171/171` passed;
- workspace/product typecheck: passed;
- Node syntax checks for all changed scripts: passed;
- zero-write preflight for the frozen item: valid, exact hashes matched,
  duplicate false, provider writes `0`, Browser Relay writes `0`;
- terminal replay: no provider mutation;
- post-replay official duplicate readback: exactly one matching object;
- root adapter secret audit: complete; task-owned secret-pattern scan: zero
  matching files. The nested product adapter does not enable secret-audit, so
  its task-owned report/index files were covered by the bounded local scan.

Tests cover unapproved/incomplete/missing assets, changed image/text,
cross-candidate and cross-slot approval, expiry, partial-selection rejection,
shared producer/runner validation, zero mutation on validation failure, bounded
recovery, durable idempotency and existing-object replay prevention.

## 12. Phase G isolation proof

Before and after this repair, the only graph-owned schedule was Instagram job
`24afbb84-457c-41b3-87b6-592c209a5b80` under migration
`phase-g-instagram-image-v1`. Its graph version remains
`deterministic-social-publication@2.0.0`, status `graph_owned`, and the 13:00
natural trigger plus 13:20 observation job remained enabled and unchanged.

The graph scheduler DB still contains exactly one migration and zero triggers
before that natural cycle. The graph runtime DB has zero active runs, zero
active capabilities and zero unresolved effects. Threads job
`083e3560-40fd-4487-9d78-674f64866ef7` remains legacy-owned. No Instagram
claim or trigger was created, removed or modified by this repair.

## 13. Service and scheduler state

The orchestrator remained `active/running` at PID `1193152`, `NRestarts=0`,
with `HTTP 200` health. No service or scheduler restart was performed. Global
`OPENCLAW_GRAPH_ZERO_WRITE_ONLY=true` and the graph startup guard were not
changed. No cron definition or ownership metadata was modified. The Threads
cron remains enabled for `11:30,16:30,21:30 Europe/London`.

## 14. Files changed and evidence

- `scripts/threads-prepared-image-creative.mjs`
- `scripts/threads-outbox-runner.mjs`
- `scripts/prepare-threads-image-recovery-20260802.mjs`
- `scripts/threads-prepared-image-creative.test.mjs`
- root `package.json`
- this report and the documentation index
- owner/runtime state in the canonical Threads prepared queue, JSON outbox and
  SQLite outbox
- preparation evidence under
  `artifacts/business-value/marketing/2026-08-02/threads-prepared-image-recovery/`

No credential values are present. No commit, push, install, release, deployment,
Instagram mutation, scheduler transfer or browser mutation occurred.

## 15. Residual risks

The Threads cron's scheduler summary still displays the original 11:30 failed
run until its next natural cycle; provider and canonical outbox truth are
terminal and verified. Only cycle-3 sequence 1 was prepared because the user's
authority was limited to the exact failed candidate. Later cycle-3 items remain
fail-closed until an independently valid slot-bound creative and approval are
prepared; they were not silently minted by this recovery.

An unrelated historical Instagram outbox ambiguity remains outside this task
and was untouched. Active Phase G observation remains pending on its own
schedule.
