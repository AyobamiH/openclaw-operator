---
title: "Runtime Repair Proof Chain 2026-09-14"
summary: "Dated evidence record for the September 14 Graph scheduler, reconciliation and restart-disconnect repairs, including remaining publication blockers."
status: "active"
updated: "2026-09-14"
---

# Runtime Repair Proof Chain 2026-09-14

This document records what was actually proved on 2026-09-14 and what remains
unproved. It is a project-level operational record for future agents. It is not
a claim that all social posting is healthy.

## Scope

Canonical repo: `projects/openclaw-operator`.

Runtime observed: `orchestrator.service` on loopback port `3312`.

Approved mutation classes used during the repair window:

- source edits in the canonical repo;
- normal commits and normal pushes through the strict pre-push hook;
- one `orchestrator.service` restart;
- bounded zero-provider-write Graph reconciliation for the stale Sep 8
  Instagram effect.

Forbidden or not performed:

- no hook relaxation or bypass;
- no second service restart;
- no scheduler or cron mutation;
- no credential/config mutation;
- no approval grant or live capability issue outside the existing graph path;
- no provider write and no Browser Relay call during repair.

## Stage Matrix

| Stage | Status | Evidence |
|---|---|---|
| Root cause: Sep 8 Instagram stale ambiguity | Passed | `production-adapters.ts` projected a terminal Instagram outbox absence after the generic publication projection, leaving a stale Graph effect ambiguous. |
| Contract: terminal absence owns reconciliation | Passed | Terminal `confirmed_absent` outbox reconciliation must outrank parseable publication projection and must not create provider writes. |
| Implemented source repair | Passed | Commit `4447a1f fix(graph): honor terminal Instagram reconciliation`. |
| Tested source repair | Passed | Focused Graph adapter test run passed 41 tests; full `verify:main` passed before the strict push sequence. |
| Pushed source repair | Passed | `origin/main` advanced through the normal protected hook. |
| Runtime loaded | Passed | One approved `systemctl --user restart orchestrator.service`; new service start at `2026-09-14 08:13:28 BST`; `/health` and `/api/persistence/health` returned HTTP 200. |
| State reconciled | Passed | Startup Graph maintenance reported `reconciled=1`, `providerWrites=0`, `browserRelayCalls=0`; the Sep 8 Instagram effect became `confirmed_absent` with no ambiguous row left for that target. |
| Hook reliability repair | Passed | Commits `89acf61 fix(test): wait on task-run completion in live integration` and `72eafb3 fix(test): bound operator contract surface timing`; normal strict push hook later passed full `verify:main`. |
| Restart disconnect handling | Passed for pre-trigger scheduler disconnects | Commit `91ee842 fix(graph): defer scheduler restart disconnects`; targeted restart/connectivity tests passed 3/3, scheduler migration suite passed 60/60, typecheck passed, strict `verify:main` passed during normal push. |
| Posting health | Failed / separate open blockers | Natural post attempts after the repairs still failed for Instagram, Threads and one Meta reply path. These are not proved fixed by the September 14 source repairs. |

## Current Publication Failures

Read-only Graph DB and journal inspection after the repairs showed these current
failure classes.

| Local time | Lane | Run | Observed failure | Effect state | Meaning |
|---|---|---|---|---|---|
| 2026-09-14 09:00 BST | Instagram image | `grzwcanary_0f9359bc-8a98-4c2a-a322-b4e95796ff33` | Gateway tool execution failed with internal error | `ambiguous` | Open. Requires exact effect/provider reconciliation before retry. |
| 2026-09-14 11:00 BST | Instagram image | `grzwcanary_c5d7a330-fcb2-47cd-a001-a4a61f9e3081` | `idempotency_conflict:instagram_account_effect_reconciliation_required` | No verified provider operation observed in the summary query | Open. A newer ambiguity or stale account-effect guard is still blocking. |
| 2026-09-14 11:35 BST | Threads daily image | `grzwcanary_b7e77eda-4aef-4cdc-8168-215a9d7299eb` | Another Threads outbox runner owns the active lock | No provider effect row in the summary query | Open. This is a concurrency/lock ownership problem, not a docs or hook problem. |
| 2026-09-14 13:00 BST | Instagram image | `grzwcanary_49a194bc-aade-4aa0-8dae-257ad9afcc78` | `idempotency_conflict:instagram_account_effect_reconciliation_required` | No verified provider operation observed in the summary query | Open. Same Instagram publication blocker remains. |
| 2026-09-14 13:15 BST | Meta reply monitor | `grzwcanary_a36b3064-30ab-40ba-9b3f-9824a36d4b5e` | Gateway tool execution failed with internal error | `confirmed_absent` at `2026-09-14T12:46:11.596Z` | Open as a successful reply proof. The effect was reconciled absent with zero writes, so it is not publication success. |
| 2026-09-14 13:30 BST | Threads readiness | `grzwcanary_ab4d255a-6e8d-4b21-a9e7-82a2f393da64` | Prepared item already active in historical Threads slot `threads:2026-08-29:16:30:083e3560-40fd-4487-9d78-674f64866ef7` | No provider effect row in the summary query | Open. Readiness collision must be repaired before it can feed reliable future posting. |

## What The Fixes Prove

The September 14 fixes prove only these bounded claims:

- terminal Instagram outbox absence can now clear the specific stale Sep 8
  Graph ambiguity without provider writes;
- the strict pre-push gate can pass without relaxing the hook after the live
  integration and UI timing harnesses were repaired;
- a scheduler invocation that starts while `orchestrator.service` is temporarily
  unavailable before trigger reservation now reports a controlled deferred
  outcome instead of an uncaught Node stack;
- source, tests, and push succeeded for those claims.

## What They Do Not Prove

These fixes do not prove:

- Instagram image or Reel posting is currently healthy;
- Threads daily image or readiness posting is currently healthy;
- Meta reply publication succeeded;
- provider write/readback paths are globally repaired;
- every future schedule will publish.

Future agents must not cite `verify:main`, docs checks, or a passing unit test
as posting proof. Posting proof requires a natural-slot or approved-run provider
effect with official readback, a valid Graph completion contract, and an
explicit publication report showing the current invocation's provider write.

## Documentation Guard

The repository docs checks now require this dated record to stay discoverable
from the active documentation map and to preserve the key negative claim:
posting health is still failed or open until live provider evidence proves
otherwise.

The docs checks are a guard against missing or misleading documentation. They
are not runtime evidence. Runtime evidence remains service health, Graph DB
state, effect rows, scheduler state, journal events, and provider readback.

## Next Repair Boundary

The next repair should start from live runtime truth and treat the remaining
failures as separate root causes:

1. Instagram account-effect/idempotency reconciliation and the 09:00 ambiguous
   effect.
2. Threads active-lock/readiness collision around the historical
   `2026-08-29 16:30` slot.
3. Meta reply gateway internal error versus confirmed-absent reconciliation.

Each needs its own proof chain. Do not mark any lane fixed until the natural
or approved run succeeds at the publication layer it claims to repair.
