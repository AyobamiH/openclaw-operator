# GitHub workflow-monitor single-flight repair — 2026-08-09

## Decision

The GitHub workflow monitor remains Graph-owned, runs once at startup, and
retains its five-minute interval. Equivalent monitor invocations are now
single-flight. A later tick is coalesced only while a matching Graph run has a
`running` current-node attempt with an unexpired lease.

Success chain:

`OVERLAP_PROVED → COALESCING_CONTRACT_DEFINED → IMPLEMENTED → TESTED → PUSHED → RUNTIME_LOADED → NATURAL_CADENCE_VERIFIED → NO_OVERLAP_PROVED`

## OVERLAP_PROVED

Recent canonical Graph history distinguishes normal sequential polling from
the failure window:

- Buckets `5954298` through `5954313` ran at five-minute intervals and normally
  completed in 1.3–2.0 seconds.
- Bucket `5954316`, run
  `grzwcanary_96382cc4-0ccf-4a8a-8218-ac3b33d436a4`, started at
  `17:02:30Z` and did not complete until `17:08:20Z` (350.5 seconds).
- Bucket `5954317` was created at `17:07:58Z`, while `5954316` still had a live
  `dispatch_effect_adapter` attempt leased until `17:32:33Z`.
- Buckets `5954318`, `5954319`, and `5954320` were then created at
  `17:12:58Z`, `17:18:06Z`, and `17:24:13Z`. Their dispatch attempts timed out
  with leases ending at `17:43:03Z`, `17:48:11Z`, and `17:54:20Z`.
- The distinct time-bucket ingress IDs made every tick idempotent only with
  itself. They did not express equivalence with an already-running monitor.

The redundant runs were not legitimate sequential polling: each new run began
before an equivalent prior monitor was terminal. By contrast, the ordinary
post-recovery series completed before the next five-minute tick.

## COALESCING_CONTRACT_DEFINED

The complete equivalence key is:

- Graph ID and immutable version;
- governed-task lane;
- task type;
- agent ID.

Coalescing requires a durable Graph run whose current node has a running,
unexpired attempt. It references the existing run without starting or driving a
second Graph execution. Exact ingress idempotency remains higher priority.

The following never suppress a later tick:

- terminal or failed runs;
- timed-out attempts;
- lease-expired attempts;
- stale process-death history;
- a run from another governed-task lane.

This uses the Graph attempt/lease truth repaired in `d8566ed`; it does not add a
parallel lifecycle store, lock, timer, or schedule. An unexpired attempt remains
protected after restart. Once its lease expires, stale-attempt capacity rules
allow the next natural tick to restore freshness.

## IMPLEMENTED

Commit `23382bf` contains the isolated repair:

- `orchestrator/src/graph/store.ts` exposes a read-only live-current-attempt
  predicate over existing Graph attempt/lease state.
- `orchestrator/src/graph/single-flight.ts` resolves a matching live run.
- `orchestrator/src/index.ts` applies that policy only to
  `github-workflow-monitor`, after exact-ingress idempotency and before new-run
  creation.
- `orchestrator/test/graph-single-flight.test.ts` covers overlap, long-running
  work, restart/process death, stale lease expiry, failed-run recovery, and
  unaffected governed-task lanes.
- `docs/architecture/ADR-001-GRAPH-NATIVE-EXECUTION.md` defines the contract.

No startup trigger, interval, schedule, task authority, provider capability, or
Graph definition changed.

## TESTED

- Focused single-flight and Graph kernel: `33/33` passed.
- Single-flight regressions: `4/4` passed.
- TypeScript: passed.
- Protected `verify:main`: build, docs drift and links, unit simulations
  `97/97`, live integration `35/35`, UI `34/34`, both typechecks, and docs-site
  build passed.
- The protected pre-push hook repeated the full protected gate and passed.

An exploratory repository-wide Vitest command also selected live-attached and
randomized load suites that are not part of the protected gate. It exposed
pre-existing environment/randomness failures (missing attached HTTP test
service, one approval-count sample below its random threshold, an unrelated
campaign-count expectation, and one unrelated timeout). Focused tests and both
protected gates were clean; no failure implicated the repair.

## PUSHED

- Base remote: `d8566ed5488b9cf97180533542ffdde8761548d6`.
- Repair: `23382bf` (`fix(graph): coalesce overlapping GitHub monitor runs`).
- `origin/main` advanced by normal fast-forward push; no force push.

## RUNTIME_LOADED

- Canonical source for all five changed paths byte-matches `origin/main`.
- Exactly one authorized `orchestrator.service` restart was performed.
- PID changed `445998 → 473485` at `21:40:04 BST`.
- `NRestarts=0` after the restart; port `3312` reopened.
- `/health` and `/api/persistence/health` returned HTTP 200.
- Startup logged ten Graph definitions and `recovery resumed=0, blocked=0`.
- The startup monitor completed in 1.5 seconds.

Pre/post fixed fingerprints match:

- `orchestrator_config.json`:
  `8c4118209da4ca029d734578dc7c6a5d986e2d7c381453af65909286f04ee1b6`;
- Graph definitions:
  `dbc1e1e0b7d328027f209c19482a8cb1fc8bdf7feb703323c54b33cd7847f394`;
- scheduler migrations:
  `b8906f47268c5e3a76c322ce0a8a079c946f9fa4f27743e5ae7a61db6a33d4b2`;
- scheduler triggers at the deployment boundary:
  `f8b42a82cfb7eb57191723ef31265e68aaec00895d7af8a79de89c240d379b81`.

## NATURAL_CADENCE_VERIFIED / NO_OVERLAP_PROVED

Post-restart observations are recorded from canonical Graph state only. No run
was forced:

- startup `5954360`: `20:40:23.764Z → 20:40:25.304Z`, completed, 1.5 seconds;
- natural `5954361`: `20:45:23.733Z → 20:45:25.218Z`, completed, 1.5 seconds.
- natural `5954362`: `20:50:23.749Z → 20:50:25.301Z`, completed, 1.6 seconds;
- natural `5954363`: `20:55:23.737Z → 20:55:25.167Z`, completed, 1.4 seconds.

For the startup sample plus all three natural ticks:

- overlapping interval pairs: `0`;
- non-terminal GitHub-monitor runs after observation: `0`;
- Graph external effects: `0`;
- coalesced ticks: `0` (none was required because every poll completed before
  the next tick);
- deferred ticks: `0`;
- service automatic restarts: `0`.

This proves both sides of the contract: normal cadence remains one fresh run per
tick, while the deterministic fixtures prove a second tick reuses rather than
duplicates a genuinely long-running equivalent run.

## External effects and boundaries

- Provider writes: `0`.
- Browser Relay calls: `0`.
- No experiment activation, social publication, provider-authority change,
  schedule mutation, unrelated Graph reconciliation, or Telegram outage-task
  mutation occurred.
- The two terminal Telegram outage-artifact tasks were not read or changed by
  this repair.

## Host-pressure classification

The monitor overlap materially contributed to Graph/queue pressure: four
equivalent governed-task parents existed concurrently, and three later became
the stale runs that consumed definition concurrency. This is directly proven.

Evidence remains insufficient to connect it causally to the earlier orphaned
`openclaw-hooks` processes. Those processes belonged to a separate
gateway/Codex hook lifecycle, and no shared PID, parent, task ID, lease, or
receipt links them to these monitor runs. The audit classification remains
`PROCESS_LIFECYCLE_LEAK_SUSPECTED`, separate from this Graph single-flight
defect.
