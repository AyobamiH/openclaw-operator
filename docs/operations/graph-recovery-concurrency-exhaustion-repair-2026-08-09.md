# Graph Recovery and Concurrency Exhaustion Repair — 2026-08-09

## Outcome

The Graph recovery defect is repaired, the three authorized stale
`governed-task-execution@1.0.0` runs are terminalized through the canonical
run-specific Graph API, and natural scheduling has resumed.

Success chain:

`STALE_RUNS_IDENTIFIED → ROOT_CAUSE_PROVED → RECOVERY_CONTRACT_FIXED → TESTED → STALE_RUNS_RECONCILED → PUSHED → RUNTIME_LOADED → CONCURRENCY_CLEARED → SCHEDULER_RUNTIME_VERIFIED`

Every stage passed. Repair and reconciliation provider writes were `0`.
Browser Relay calls were `0`. No campaign or social-publication run was forced.

## STALE_RUNS_IDENTIFIED

Exactly these three runs were in scope:

| Run | Ingress | Dead adapter attempt | Orphan child receipt | Dispatch task |
|---|---|---|---|---|
| `grzwcanary_3fff0781-623e-4381-a1ae-62a30e5aa7d8` | `github-workflow-monitor:5954318` | `gna_4bbbda65-fbf6-40c8-ae44-850781045883` | `gcr_de4f9468-14db-4ae0-a057-5466610c5fc1` | `9daba4f7-3a7f-4dbc-b0a5-d0dd7bfef681` |
| `grzwcanary_667b46aa-41b6-4056-a16f-8df5f7bbf16a` | `github-workflow-monitor:5954319` | `gna_22938637-c7b7-4d74-8d05-3c11c7c732c0` | `gcr_1ed40948-33f2-4286-9e9d-fc259b74281e` | `4266b85c-ec4a-49e5-a56d-765dc00cbffa` |
| `grzwcanary_a4049deb-3926-4228-aa77-c02cec407ed3` | `github-workflow-monitor:5954320` | `gna_357725fd-21ba-4d0a-b5c7-cf55878ca793` | `gcr_673bfbf0-1728-4cb5-a70e-7c2550904046` | `88276105-2bb3-49a0-8c82-fb8da5df35c6` |

Before repair, all three parent runs were `running` at
`dispatch_effect_adapter`, revision `4`. Their current-node attempts were
already `timed_out`, their child receipts remained `running`, their dispatch
task IDs did not exist in the live orchestrator task ledger, and they held no
resource lease, approval, live capability or external effect. This proves the
process owning the work was gone and that no valid executor could still be
performing the work.

The two terminal Telegram outage-artifact tasks were not these child dispatch
tasks and were not read, executed, resumed, cancelled or mutated during this
repair:

- `1991c393-d67d-45f6-9e42-4adf7031d1d8` — Threads readiness, terminal failed;
- `5d00d842-a79b-483a-86b7-1da47198800d` — Instagram Reel, terminal failed.

## ROOT_CAUSE_PROVED

Three lifecycle gaps combined:

1. Definition capacity counted every parent with `status=running`, even when
   its current attempt had timed out and no executor or lease survived.
2. Startup recovery expired attempts but left the parent `running`, appended a
   misleading resume event and never re-dispatched or terminalized the work.
   The orphan child receipt also remained non-terminal.
3. Startup Git-monitor admission allowed
   `graph_definition_concurrency_exhausted` to escape as an unhandled error.
   Systemd then restarted the orchestrator three times.

The stale parents therefore consumed three of the definition's four slots
indefinitely. The same stale-capacity semantics also prevented the 19:15 Meta
monitor from admitting a new run.

## RECOVERY_CONTRACT_FIXED

The repair defines these deterministic rules:

- A `running` parent does not consume definition capacity when its current-node
  attempt is proven timed out, or its running lease has expired, and there is
  no unexpired current-node attempt.
- Created/compensating work and every genuinely live current-node attempt still
  consume capacity.
- Passive startup recovery is classification-only for stale work. It reports
  stale run IDs but does not rewrite their history.
- Terminalization is available only through the run-specific
  `POST /api/graphs/runs/{runId}/recover-stale` route.
- That route rejects terminal runs, live/unproven attempts and any unresolved
  external effect. For a proven stale effect-free run it expires only that
  run's remaining attempt, closes only its orphan child receipt, appends the
  parent failure event/checkpoint, and preserves the event chain.
- Global or definition concurrency exhaustion at startup/scheduler admission
  is a non-fatal deferral. Unrelated exceptions still fail normally.

Source commits:

- `8b73ab6669771b74158a0164eff359c9da60430f` — implementation, route,
  OpenAPI/docs and regression coverage;
- `d8566ed5488b9cf97180533542ffdde8761548d6` — makes passive stale discovery
  explicitly read-only.

`origin/main` is exactly `d8566ed5488b9cf97180533542ffdde8761548d6`.

## TESTED

- Focused recovery/concurrency suite: `85/85` passed.
- Full Graph and OpenAPI regression set: `163/163` passed.
- TypeScript checks passed.
- The protected `verify:main` gate passed after the final passive-recovery
  tightening:
  - unit fixtures `97/97`;
  - runtime integration `35/35`;
  - operator UI `34/34`;
  - builds, typechecks, documentation sync/curation and VitePress build passed.

Regression coverage proves:

- process death with running Graph work;
- stale-capacity detection after restart;
- targeted recovery and orphan-receipt closure;
- passive recovery does not mutate stale history;
- stale definition capacity is released;
- live attempt capacity remains protected;
- startup/scheduler concurrency exhaustion defers without crashing;
- unrelated startup errors still throw;
- event chains remain valid.

## STALE_RUNS_RECONCILED

After the new runtime loaded, the run-specific recovery endpoint was submitted
once for each authorized ID. Every request returned HTTP `200`.

Post-state for all three:

- parent status `failed`;
- current node `null`;
- revision `5`;
- terminal outcome `recovery_stale_attempt_terminalized`;
- child receipt status `failed`;
- child outcome `parent_attempt_stale_after_process_death`;
- external effects `0`;
- event chain valid.

The Graph database was backed up before restart and immediately after targeted
reconciliation. For all pre-existing non-target rows, removed-or-changed counts
were zero across runs, node attempts, events, child receipts, external effects,
evidence, verifier receipts, approvals and checkpoints. Startup released two
expired resource leases as ordinary lease cleanup; it did not change Graph
history. Natural post-restart runs added new rows, as expected.

The Graph scheduler database was byte-identical immediately before and after
reconciliation. No schedule definition, migration binding or trigger was
manually changed.

## RUNTIME_LOADED and CONCURRENCY_CLEARED

Exactly one approved `orchestrator.service` restart was submitted.

- Old PID/start: `426880`, `2026-08-09 19:09:13 BST`.
- New PID/start: `445998`, `2026-08-09 20:05:17 BST`.
- The old process shut down gracefully.
- The new process became healthy on the first check.
- Systemd automatic restarts after this activation: `0`.
- Port `3312` reopened.
- `/health`: HTTP `200`.
- `/api/persistence/health`: HTTP `200`, file persistence and Redis
  coordination healthy.
- Authenticated Graph health: HTTP `200`, schema v3, zero-write mode, ten
  definitions, zero waiting, zero blocked, zero active live capabilities and
  zero ambiguous effects.
- Nine Graph-owned scheduler migrations remain registered; every one of the
  eleven migration event chains validates.
- All ten repaired source/doc/test paths in the canonical runtime worktree are
  byte-identical to final remote commit `d8566ed`.

The startup Git monitor and subsequent 20:10 and 20:15 monitor cycles all
completed through `governed-task-execution@1.0.0`. This proves the three stale
parents no longer consume that definition's capacity. Two unrelated historical
parents still have raw `running` status, so the health endpoint's raw active
count is `2`; they do not consume stale attempt capacity and were not mutated.

All eighteen fixed target/adjacent OpenClaw configuration records were
byte-identical pre/post. The orchestrator unit and both drop-in hashes were also
unchanged. No gateway restart, daemon reload, schedule update, permission
change, experiment activation or provider-authority change occurred.

## SCHEDULER_RUNTIME_VERIFIED

The prior 19:15 Meta monitor is the before-case:

```text
Graph execution outcome: deferred
Policy/skip reason: deferred:definition_concurrency_exhausted
Run: none
Provider writes: 0
```

No run was forced. The existing hourly job fired naturally at 20:15 BST and
created `grzwcanary_c730c571-2c8c-4070-9928-2784e58f1f06`. It completed at
20:19 BST with a valid event chain and a single `confirmed_absent` effect.

```text
Graph execution outcome: completed
Scheduler completion contract: passed
Publication outcome: missed
Policy/skip reason: zero_write:prepared_reply
Candidate ID: meta-reply-monitor-20260809T1915Z
Trigger: gst_8629953ba7c8e3882aac8391fa98251e
Provider writes: 0; Browser Relay calls: 0
Provider post: none
Verifier result: meta-reply-monitor-receipted:passed
Final classification: missed
```

This is a truthful business miss, not a concurrency deferral. The next natural
hourly opportunity is 21:15 BST.

## Hook-worker classification

The earlier `openclaw-hooks` workers remain a separate
`PROCESS_LIFECYCLE_LEAK_SUSPECTED` audit item. No hook worker was present during
this repair; gateway PID `371950` and its start time remained unchanged.

Evidence does not support a shared root cause:

- the repaired defect is durable Graph run/attempt/receipt state owned by
  `orchestrator.service`;
- the hook symptom involved operating-system worker processes under the
  gateway/Codex runtime;
- no shared run ID, lease, receipt, database record or causal log connects the
  two.

The hook symptom belongs in the remediation ledger because it recurred and
caused material host pressure, but it remains separately unproven. Its next
repair should add bounded parent/owner identity, lease/exit instrumentation and
orphan cleanup tests; this Graph patch must not be claimed as its fix.

## Changed-state declaration

Changed:

- ten isolated source/test/API/documentation paths;
- remote Git from `9de0aff` through `8b73ab6` to `d8566ed`;
- exactly the three authorized Graph parent runs and their three orphan child
  receipts;
- one approved orchestrator lifecycle restart;
- this report, audit ledger, tool ledger and daily continuity note.

Not changed by this repair:

- provider state or provider content;
- the two terminal Telegram outage tasks;
- experiments, campaigns, schedules or migration bindings;
- OpenClaw configuration, service unit/drop-ins, gateway lifecycle or
  capabilities;
- unrelated Graph history.

Provider writes during repair/reconciliation: `0`.
Browser Relay calls: `0`.
