---
title: "Threads Readiness, Instagram Comparison, and Pipeline Repair"
summary: "End-to-end Threads readiness repair, cross-platform review, loaded zero-write proof, and the exact approved-content boundary."
---

# Threads Readiness, Instagram Comparison, and Pipeline Repair

## 1. Final verdict

`THREADS READINESS ARCHITECTURE REPAIR BLOCKED`

The architecture repair is implemented, tested, loaded, and scheduled. A
Threads timer can no longer create or report a committed slot unless an exact
durable allocation passes the canonical readiness contract. The successful
mission verdict is not claimed because the campaign has no approved fresh
cycle-3/sequence-2 payload or policy-valid approved fallback. The next natural
05:00 cycle therefore cannot prove a committed publication. This is the
documented stop condition: campaign policy cannot provide an approved
candidate or fallback without a new human content approval.

## 2. Exact incident and affected slots

The 16:30 and 21:30 BST image timers on 2 August 2026 both selected campaign
cycle 3, sequence 2 but found no prepared allocation. Each stopped before a
provider call with zero external writes and zero Browser Relay calls. Their
historical JSON evidence incorrectly called them committed misses even though
candidate, payload, media, and approval fields were empty. Both records are
now correctly closed as `not_ready_before_commit`, `committedSlot=false`, and
`recoveryRequired=false`. Neither is eligible for historical replay.

## 3. Canonical Threads pipeline discovered

The host workspace owns the canonical legacy Threads path:

`campaign pack/state -> prepared-payload queue -> threads readiness preparer -> publication_readiness SQLite row -> exact allocation/commit transaction -> legacy timer -> outbox claim -> API-only provider mutation -> canonical verify + exact owned-feed readback -> terminal state`

The provider-writing runner is `scripts/threads-outbox-runner.mjs`. SQLite at
`~/.openclaw/state/business-operations/social-outboxes/threads-scheduler.sqlite`
is authoritative. Campaign JSON and outbox JSON are evidence mirrors. No graph
ownership transfer occurred.

## 4. Canonical Instagram pipeline discovered

The only graph-owned production schedule remains
`24afbb84-457c-41bb-92c9-24a19725e984` under
`phase-g-instagram-image-v1`. Its flow reserves a trigger, selects from a large
approved deterministic content supply just in time, renders, applies the
layout contract and bounded repair, freezes media, creates the envelope,
issues approval and a one-run capability, publishes, reconciles, and reads
back. Legacy Instagram remains outside graph ownership.

Instagram was not copied wholesale: it still reserves execution before final
payload readiness. Its useful properties are deterministic allocation,
semantic/geometric quality validation, frozen-byte binding, bounded repair,
single-run authority, and provider reconciliation.

## 5. Specialist-agent findings

- Threads archaeology found no recurring future-slot producer, split
  JSON/SQLite/campaign cursor authority, premature commitment language, no
  preparation deadlines or fallbacks, media-agnostic approval assumptions,
  and legacy import drift. The post-allocation write and reconciliation path
  was already strong.
- Instagram analysis found that recent reliability came from a large approved
  content inventory plus deterministic layout repair, not from advance slot
  commitment. Copying its trigger-first semantics would retain the Threads
  defect.
- Concurrency review found crash windows between allocation and cursor
  advancement, weak candidate/prepared-item uniqueness, and the possibility
  of publishing a revoked allocation. It required one SQLite transaction for
  commitment and cursor movement, exact immutable bindings, and explicit
  invalidation/recovery states.

The three lanes agreed that payload production/approval is a separate policy
authority from deterministic scheduling. The repair therefore never invents
or self-approves campaign copy.

## 6. Root causes

1. The cron timetable was treated as commitment even when it represented only
   intent.
2. Cycle 3 advanced after the recovered 11:30 sequence-1 publication, but the
   prepared queue contained no cycle-3/sequence-2 item.
3. No recurring worker forecasted and prepared the next slot.
4. Allocation, outbox reservation, and campaign cursor advancement were split
   across JSON and SQLite operations.
5. Legacy import marked unapproved rows approved and normalized media to text,
   obscuring evidence.
6. Text and image payloads did not share one exact commitment-readiness model.

## 7. New readiness state machine

The durable state model is:

`forecasted -> preparation_requested -> preparing -> prepared -> quality_verified -> approval_pending/approved -> allocated -> commit_ready -> committed -> claimed -> publishing -> published -> verified`

Terminal and exception states are `skipped`, `failed`, and
`recovery_required`. A timer with no exact committed row reports
`not_ready_before_commit` without creating a committed miss or provider
authority.

## 8. PublicationReadinessContract

`threads-publication-readiness.v1` is shared by preparation, state storage, and
the runner. It requires exact platform/account, candidate/campaign/sequence,
Europe/London slot identity, frozen payload/hash, frozen media/hash where
required, quality verification, payload/media-bound approval valid through the
execution window, duplicate and policy checks, provider target, recovery
window, and idempotency lineage. All assertions are recomputed inside the
commit transaction.

Any regenerated payload or media changes the hash and prevents commitment or
claim. Image and text approvals now use distinct strict frozen-preparation
schemas.

## 9. Preparation and fallback loop

`scripts/threads-readiness-preparer.mjs` runs every 30 minutes under cron
`abb3e214-0ff6-4813-a18d-6d8ffb9080ad`. It deterministically finds the next
natural slot, invokes non-writing preparation, and records 24-hour, six-hour,
90-minute, 30-minute, and at-slot classifications. Repair/fallback selection
is capped at six attempts and constrained to the same account, campaign,
cycle, sequence policy, candidate lineage, and slot. Exhaustion leaves the
slot uncommitted.

The live queue currently has only one cycle-3 item: the used and expired
sequence-1/11:30 creative. `reuseForbidden=true` and
`futureCyclesRequireFreshCopy=true`; it is not a valid fallback for sequence 2.

## 10. Commitment and allocation guarantees

The SQLite commitment transaction persists one slot, allocation, candidate,
prepared item, payload hash, media hash, envelope hash, approval, complete
assertions, contract version, deadlines, recovery window, and idempotency
lineage. It advances the campaign cursor in the same transaction. Unique
partial indexes prevent conflicting active candidate, prepared-item, and
envelope allocation. An existing commitment is immutable and replay-safe.

The runner recomputes the stored binding before claim. Missing or changed
payload/media/approval transitions the row to `recovery_required` before any
provider mutation.

## 11. Scheduler and recovery behaviour

- `committed`: the runner may atomically claim it.
- `not_ready_yet` / `preparation_requested`: the preparer continues bounded
  work and records deadline evidence.
- `not_ready_before_commit`: the publication timer exits successfully with
  zero writes and no false recovery demand.
- `recovery_required`: only readback/reconciliation or separately authorized
  recovery may proceed.
- Provider-write evidence always triggers reconciliation, never blind replay.

## 12. Threads-versus-Instagram comparison

| Concern | Threads after repair | Graph-owned Instagram | Consequence |
|---|---|---|---|
| Candidate forecasting | next exact legacy slot | trigger-time deterministic selection | Threads explicitly detects inventory gaps early |
| Preparation lead time | recurring 30-minute scan, 24-hour horizon | just in time | Threads differs intentionally |
| Asset generation | approved frozen queue item | graph render | both freeze exact media |
| Quality validation | canonical payload/media readiness | semantic/geometric layout contract | both fail closed |
| Approval binding | exact payload/media/slot and execution window | exact envelope/media capability | equivalent authority principle |
| Slot allocation | durable SQLite allocation | graph claim/envelope | both inspectable |
| Commitment timing | only after all readiness assertions | trigger reserved before final render | Instagram timing not copied |
| Durable claim | committed -> claimed | graph claim | exactly once |
| Fallback | six bounded policy-constrained attempts | bounded render/template repair | no arbitrary generator |
| Pre-slot recovery | deadlines and repeated preparation | bounded in-run repair | Threads now earlier |
| Post-slot recovery | reconciliation or explicit recovery | effect reconciliation | no blind retry |
| Provider verification | canonical verify + exact owned feed | effect/provider readback | equivalent evidence requirement |
| Ownership | legacy cron | one graph-owned schedule | unchanged |

## 13. Implementation

- `scripts/threads-publication-readiness.mjs`
- `scripts/threads-readiness-preparer.mjs`
- `scripts/threads-deterministic-state.mjs`
- `scripts/threads-prepared-image-creative.mjs`
- `scripts/threads-outbox-runner.mjs`
- readiness and full-day simulation tests
- host test manifest and Threads runbook

The additive schema is version 1 with checksum
`64fac3b02559cf63527c14499aa75c4f5d216d0f9446a5783072c34b74babeae`.

## 14. Tests and simulation

- Focused readiness and full-day simulation: 13/13.
- Existing Threads state/runner/creative/recovery suites: 39/39.
- Complete host-operations suite: 188/188.
- Model-routing validation: passed.
- Operator and UI typechecks: passed.
- Operator UI and orchestrator builds: passed.
- Documentation links: 134 Markdown files passed.
- Syntax checks: passed.
- Task-owned bounded secret scan: no matches; the coding adapter secret audit
  reported its documented adapter limitation and read no secret-bearing files.
- SQLite integrity: `ok`; foreign-key check: empty.

The full-day simulation covered a ready allocation, failed image quality,
bounded image repair, approved fallback, exhausted fallbacks, approval expiry,
cursor advancement, preparer crash/lease recovery, commitment invalidation,
and publication replay. Acceptance counters were all zero: committed slots
without allocations, unapproved commitments, duplicate allocations, unbounded
loops, provider writes, and Browser Relay calls.

## 15. Production rollout and loaded proof

The database was backed up before migration, the additive schema was loaded,
and the preparer was installed without restarting Gateway or any publisher.
Forced scheduler run
`manual:abb3e214-0ff6-4813-a18d-6d8ffb9080ad:1785711184942:1`
finished `ok` in 317 ms. It forecast the 05:00 BST slot 306 minutes early,
persisted `preparation_requested`, and reported zero provider writes and zero
Browser Relay calls. No outbox commitment, allocation, or approval was
invented.

Post-rollout selected-scheduler digest:
`e8043afbfdf4bae6ca3709f5d8f0e285ba70e70f4a2f5c8160827f75e4af38ca`.

## 16. Natural-cycle proof

No post-repair natural Threads publication has occurred yet. The next slot is
05:00 BST on 3 August. Because there is no approved sequence-2 payload, it is
expected to prove fail-closed `not_ready_before_commit`, not a successful
committed publication. This missing success criterion is why the terminal
verdict remains blocked.

## 17. Missed-slot disposition

The 16:30 and 21:30 2 August slots are correctly closed locally as historical
unready slots. Both have zero provider-write evidence, no approved allocation,
and no lawful fallback. They will not be replayed.

## 18. Instagram isolation and service state

Instagram schedule `24afbb84-457c-41bb-92c9-24a19725e984` remains the only
graph-owned schedule. Phase G observer
`ee64444d-9f66-4aee-a6a2-384b47bf9165` remains enabled for its existing 05:20
terminal check. No Instagram claim, graph definition, migration, capability,
or provider object changed. Global API-only/zero-write controls were not
broadened. Gateway remains active/running at PID 1363900; it was not restarted.

## 19. Metrics and operator visibility

The readiness database exposes exact state, deadlines, assertion results,
allocation, hashes, approval, version, failure reason, events, and cursor.
Cron history records every preparation outcome. Publication-time output now
distinguishes an uncommitted readiness gap from a missed committed execution.

## 20. Rollback and residual risks

Consistent pre-migration SQLite backup:

`artifacts/business-value/marketing/2026-08-02/threads-readiness-repair/rollback/threads-scheduler-pre-readiness.sqlite`

SHA-256:
`c391a6b13005376edf15ccec7caedcea18f43d3e44105da802c769d8f41c0cc9`.

Rollback would disable/remove preparer cron
`abb3e214-0ff6-4813-a18d-6d8ffb9080ad`, restore the sealed database while
writers are stopped, and revert the task-owned source. It was not exercised
because production health is good.

Residual risk is policy-owned, not an engineering defect: campaign sequence 2
still needs one fresh, complete, account/slot-bound approval with validity
through its execution window. Until supplied, all future slots remain safely
uncommitted and no successful natural publication proof can exist.
