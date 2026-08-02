---
title: "Graph runtime Gate B persistence initialisation evidence"
summary: "Gate B preflight stopped before production database creation because the reviewed schema migration is not atomic."
---

# Graph runtime Gate B persistence initialisation evidence

## 1. Verdict

**GATE B BLOCKED — PRODUCTION DATABASE NOT INITIALISED**

Gate B did not meet its completion contract. The reviewed migration issues its
DDL batch and schema-metadata upsert outside the `GraphStore.transaction()`
boundary. A deterministic in-memory proof using the same Node `DatabaseSync`
API showed that `exec()` retains earlier DDL after a later statement fails.
The user-required atomic migration property therefore cannot be established.

The production initializer was not executed. The graph database remains absent,
the runtime remains disabled, and no later gate was entered.

Evidence timestamp: `2026-08-01T19:49:43+01:00`.

## 2. Canonical graph database path

The one canonical path is:

`/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/database/graph-runs.sqlite`

This is derived from:

- installed unit `OPENCLAW_OPERATOR_STATE_DIR=/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator`;
- `orchestrator/src/graph/runtime.ts:20-26`, which appends
  `database/graph-runs.sqlite` when no explicit graph database override exists;
- key-only inspection of the installed credential environment, which found no
  `OPENCLAW_GRAPH_*` keys;
- the reviewed initializer guard requiring an absolute path ending in
  `/database/graph-runs.sqlite`.

No second plausible production path was found.

## 3. Pre-initialisation state

| Property | Evidence |
|---|---|
| Repository | `/home/oneclickwebsitedesignfactory/.openclaw/workspace/projects/openclaw-operator` |
| Branch / HEAD | `main` / `df765e90aa5d11b9deaf7795112e85e0f628ddd3` |
| Upstream | `0` ahead / `0` behind `origin/main` from Gate A |
| Reviewed graph source | byte-identical to the Gate A source snapshot carrying approved digest `1edff568572cf06a98cb3eb9cec328cb5503952fb7c6d4474bb425dc9036fa1e` |
| Target | absent before and after preflight |
| Parent | owner/group `oneclickwebsitedesignfactory:oneclickwebsitedesignfactory`, mode `0700` |
| Free space | `884G` available, filesystem 8% used |
| Service | `MainPID=461`, `NRestarts=0`, active/running |
| Loaded graph API | `GET /api/graphs/health` -> HTTP 404 |
| Graph metrics | no `openclaw_graph_*` series emitted by PID 461 |
| Scheduler | 10 jobs; the same IDs, schedule kinds and enabled states in both read-only snapshots |

The checkout already contained pre-existing publishing and graph-migration
work. No unrelated path was overwritten or reformatted.

Existing production SQLite inventory under the canonical Operator database
directory remained:

- `operator.sqlite` plus its live WAL/SHM sidecars;
- `deterministic-publishing.sqlite`;
- `deterministic-publishing-pre-recovery-20260801T0626.sqlite`.

## 4. Initializer and migrations reviewed

| Surface | SHA-256 | Finding |
|---|---|---|
| `orchestrator/scripts/initialize-graph-database.ts` | `388f5077cc70ffea22e80018a16550d21c0e39f929fd3a714e930e229995db78` | absolute-path and expect-absent guards; opens `GraphStore`; creates no runs or definitions |
| `orchestrator/src/graph/store.ts` | `5443e01c82f4e90481a74b4d872706a2839ea0070d1b34cb37268dfd08bf7570` | schema version 1; schema DDL at lines 62-196; metadata upsert at lines 197-201; transaction helper only begins at line 204 and is not used by `migrate()` |

The intended schema is reviewed and bounded to:

- `graph_schema_meta`;
- `graph_definitions` with immutable update/delete triggers;
- `graph_runs`;
- `graph_events`;
- `graph_node_attempts`;
- `graph_approvals`;
- `graph_evidence`;
- `graph_external_effects`;
- `graph_checkpoints`;
- `graph_resource_leases`.

The migration does not register graph definitions, create runs, start workers,
load connectors, alter legacy databases, edit service configuration, or signal
the service. The blocking defect is narrower: schema creation and the metadata
write are not one atomic transaction.

## 5. Exact initialisation command

The reviewed command would have been:

```text
node --import tsx scripts/initialize-graph-database.ts --expect-absent --path /home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/database/graph-runs.sqlite
```

It was **not executed**. Exit code is therefore not applicable. This is the
required fail-closed response to the failed atomicity precondition.

## 6. Files and directories created

Production graph files or directories created: **zero**.

The canonical parent directory already existed. No `graph-runs.sqlite`, WAL,
SHM, journal, graph event, graph lease or graph state file exists.

## 7. Schema version

Reviewed intended schema version: `1`, stored in `graph_schema_meta`.

Production schema version: not applicable because the production database was
not created. The implementation does not set `PRAGMA user_version`; the
authoritative reviewed version is the `graph_schema_meta` row.

## 8. Table, index and constraint inventory

The intended inventory was inspected in source. Production inventory is empty
because no database exists. Expected indexes were:

- `graph_runs_status_idx`;
- `graph_runs_graph_idx`;
- `graph_events_run_idx`;
- `graph_attempts_active_idx`;
- `graph_effects_state_idx`.

Expected uniqueness includes immutable definition identity, run/event
sequence, node-attempt lineage, approval payload binding and external-effect
idempotency keys. This inventory was not materialised in production.

## 9. Integrity and foreign-key checks

Not applicable: executing `PRAGMA integrity_check` or
`PRAGMA foreign_key_check` requires a created database, and the precondition
failed before creation. No empty SQLite file was opened merely to make these
queries possible.

## 10. Empty-state proof

The stronger absence invariant holds:

```text
ABSENT /home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/database/graph-runs.sqlite
```

Consequently graph definitions, runs, events, attempts, approvals, evidence,
effects, checkpoints and leases all have zero persisted rows because their
production tables do not exist.

## 11. Graph-disabled proof

- Installed unit and drop-ins contain no `OPENCLAW_GRAPH_*` activation keys.
- Key-only credential-environment inspection found no graph keys; values were
  not printed.
- Missing or invalid `OPENCLAW_GRAPH_RUNTIME_ENABLED` resolves false at
  `orchestrator/src/index.ts:10494`.
- Graph database construction and route registration are inside the exact
  enabled branch.
- PID 461 returns HTTP 404 for `/api/graphs/health`.
- PID 461 emits no `openclaw_graph_*` metrics.

## 12. Legacy-persistence comparison

No initializer, migration or SQLite write command was run. Post-preflight
`GET /api/persistence/health` returned HTTP 200 with SQLite healthy (9
collections) and Redis coordination healthy. No legacy file was moved,
renamed, copied or used as an initializer target.

Because `operator.sqlite` is live and its WAL changes during normal heartbeat
activity, no unsafe raw-file comparison was used as a substitute for SQLite
health. The no-execution boundary is the primary changed-state proof.

## 13. Running-service proof

Post-preflight properties:

```text
MainPID=461
NRestarts=0
ActiveState=active
SubState=running
ActiveEnterTimestamp=Wed 2026-07-29 08:23:04 BST
```

- `GET http://127.0.0.1:3312/health` -> HTTP 200, healthy.
- `GET http://127.0.0.1:3312/api/persistence/health` -> HTTP 200.
- No start, stop, reload, restart, daemon reload, kill or signal occurred.

## 14. Scheduler proof

Two OpenClaw cron `list` snapshots each returned the same 10 job IDs, schedule
kinds and enabled states. No scheduler mutation tool or command was called.
No graph trigger, canary schedule, shadow schedule or workflow cutover exists.

## 15. External-effect proof

Gate B preflight invoked no production initializer, graph runtime, connector,
provider, publication worker, Browser Relay, message sender or reconciliation
path.

- provider writes: 0;
- container creations: 0;
- publications: 0;
- Browser Relay mutations: 0;
- graph runs/events/effects: 0.

## 16. Database digest, ownership and permissions

Database digest, ownership, mode and size: not applicable because the target is
absent. The parent directory is safely owned by the Operator user and mode
`0700`.

The invoking shell's umask was `0002`; the initializer does not enforce a file
mode. A later reviewed repair should either set the production command's umask
to `0077` or enforce mode `0600` in code and test it. This is secondary to the
atomicity blocker but must be resolved before a new Gate B attempt.

## 17. Idempotency verification

Production idempotency verification was not attempted. The initializer is
explicitly single-use: `--expect-absent` is mandatory and it rejects an
existing target with `graph_database_already_exists`. There is no
initializer-specific test proving safe re-entry against an initialized copy.

Schema DDL uses `IF NOT EXISTS`, but the metadata upsert refreshes `updated_at`
on every `GraphStore` open. Therefore the requested initializer-level
idempotency contract is not established by the reviewed evidence.

## 18. Rollback procedure

No rollback is required because no production state changed. After a repaired,
separately approved Gate B, rollback should remain graph-only: confirm runtime
disabled and no open handle, move `graph-runs.sqlite` and any graph-only
WAL/SHM/journal sidecars into recoverable quarantine, verify legacy persistence,
and retain the quarantined digest. Never remove the shared database directory.

## 19. Files changed during this gate

Evidence-only changes:

- `docs/operations/graph-runtime-gate-b-persistence-initialisation-2026-08-01.md`;
- `docs/INDEX.md`;
- `docs/operations/tool-invocation-ledger.md`;
- workspace daily memory through the crash-safe memory guard.

Runtime source, service configuration, production databases, schedulers and
Git history were not changed.

## 20. Deviations

The approved initializer was not run because its precondition review failed.
This is a disclosed stop, not a silent deviation. The coding migration evidence
tool returned an adapter-limited partial result, so narrow core inspection was
used and recorded.

## 21. Blockers

1. `GraphStore.migrate()` is not wrapped by the existing
   `BEGIN IMMEDIATE`/commit/rollback helper. Node `DatabaseSync.exec()` was
   proven non-atomic without an explicit transaction: after an injected second
   statement failure, the first table remained.
2. Initializer re-entry/idempotency against an initialized copy is not covered;
   the command rejects any existing target and the metadata timestamp changes
   on every store open.
3. The production command needs an explicit safe file-mode contract because
   the current shell umask is `0002` and the initializer does not set mode.

Repairing these items changes the approved graph source digest and therefore
requires local verification and a newly reviewed Gate B approval. No structural
repair was improvised under this database-only authority.

## 22. Exact next independently approved gate

Gate C is **not eligible** because Gate B did not complete.

The exact next action is to approve a bounded initializer-hardening repair and
local re-verification: make schema creation plus metadata recording one
transaction, define safe file permissions, add initializer atomicity and
idempotency tests, reproduce the approved graph/source digest evidence, then
return for a fresh Gate B execution approval.

Only after a future successful Gate B may the next independently approved gate
be:

**Gate C — restart the canonical orchestrator once so the reviewed
graph-enabled code is loaded, while keeping the graph runtime disabled and
executing no graph run.**

Gate C was not executed.

## Atomicity reproduction

The isolated in-memory proof used no production path:

```text
node --input-type=module -
```

It called `DatabaseSync.exec()` with a valid `CREATE TABLE`, an invalid
statement and a second `CREATE TABLE`. Result:

```json
{
  "error": "near \"INVALID\": syntax error",
  "tables": ["survives_partial_exec"],
  "atomicWithoutExplicitTransaction": false
}
```

This establishes that the current migration can leave a partial schema if a
later statement fails.

## Post-blocker repair reference

The blocker was subsequently repaired and locally re-verified under a separate
source-change approval. The repair is documented in
`docs/operations/graph-persistence-initializer-hardening-2026-08-01.md`.

This does **not** change this report's verdict and does not mark Gate B
complete. The production target remains absent. Because the source digest and
initializer contract changed, running the hardened production command requires
a fresh Gate B approval.
