---
title: "Graph persistence initializer hardening"
summary: "Atomic, deterministic and owner-only local persistence initialisation proof before a fresh Gate B approval."
---

# Graph persistence initializer hardening

## 1. Verdict

**INITIALIZER HARDENING COMPLETE — GATE B READY FOR FRESH APPROVAL**

This is a local source-and-test verdict only. The production graph database
remains absent, PID 461 still runs the old loaded modules, and Gate B itself is
not complete.

## 2. Original defect reproduced

The original `GraphStore.migrate()` issued a multi-statement DDL batch and then
updated metadata outside the existing transaction helper. An isolated Node
`DatabaseSync.exec()` reproduction retained the first table after a later SQL
syntax error, proving partial schema creation was possible.

The original initializer also inherited caller umask, refreshed metadata on
every store open, rejected re-entry without proving the underlying store was
idempotent, and had no canonical physical-schema verifier.

## 3. Files changed

Runtime/initializer scope:

- `orchestrator/src/graph/store.ts`;
- `orchestrator/src/graph/migrations.ts`;
- `orchestrator/src/graph/schema-verifier.ts`;
- `orchestrator/src/graph/initializer.ts`;
- `orchestrator/scripts/initialize-graph-database.ts`.

Tests and documentation:

- `orchestrator/test/graph-persistence-initializer.test.ts`;
- this report;
- the graph ADR, runbook, migration registry, blocked Gate B report, docs index
  and tool invocation ledger.

Publishing, systemd, scheduler, provider, service and runtime-activation files
were not changed by this repair.

## 4. Transactional migration implementation

`GRAPH_SCHEMA_OBJECTS` is one ordered, immutable version-1 manifest. A new
database executes:

1. `BEGIN IMMEDIATE`;
2. all 10 table statements;
3. all five index statements;
4. both immutability triggers;
5. the single migration-history row;
6. `PRAGMA user_version=1`;
7. `COMMIT`.

Any error attempts `ROLLBACK` and throws a structured
`migration_rolled_back` error when rollback succeeds. A rollback error is
recorded without replacing the primary migration cause.

No manifest statement uses `IF NOT EXISTS`. Existing databases are verified,
not silently repaired or adopted.

## 5. Schema metadata behaviour

`graph_schema_meta` now stores exactly:

- `schema_name`;
- `schema_version`;
- `migration_id`;
- `migration_checksum`;
- stable `applied_at`.

It no longer stores an open-time `updated_at`. Re-entry tests prove metadata,
object definitions, schema fingerprint and database digest remain unchanged.

## 6. Permission and umask enforcement

Database creation temporarily sets umask `0077`, restores the previous umask
in `finally`, explicitly applies mode `0600`, verifies current-user ownership,
and repeats checks for WAL, SHM and journal sidecars. Vitest worker contexts,
where Node forbids changing process umask, still apply and verify mode `0600`;
the production CLI runs in a normal main process and uses both controls.

The initializer requires owner-only state-root/database directories and does
not loosen an already secure shared parent.

## 7. Path and symlink protections

Production execution requires the exact absolute target under the resolved
Operator state root. Relative paths, out-of-root paths, source-tree/dist paths,
unsafe state roots, symlink targets, symlink parents and unsafe sidecars fail
before SQLite opens the target. Existing non-SQLite files are header-checked
and rejected without byte or mode mutation.

Temporary paths require both an explicit state root and
`--test-only-allow-unsafe-path`.

## 8. Initializer contract

The CLI delegates to the testable `initializeGraphDatabase()` function and
prints structured success or failure JSON. Success includes creation/re-entry
status, schema/user versions, migration identity/checksum, stable applied time,
integrity/foreign-key checks, object counts, execution row count, schema
fingerprint and mode.

Failures distinguish unsafe path, target exists, permissions, migration
rollback/failure, incomplete/drifted/future schema, integrity/foreign-key
failure and invalid database. The import chain is initializer -> graph store,
manifest and verifier only; it does not load the main runtime, routes,
schedulers or publishing connectors.

## 9. Idempotency semantics

- `--expect-absent`: first execution may create; later execution returns
  `target_exists` before opening or mutating the file.
- Non-production re-entry without the guard: a matching version-1 database
  returns `already_initialised` after canonical verification.
- Re-entry does not refresh metadata, insert duplicate rows, recreate objects,
  change the schema fingerprint, change execution row counts or weaken mode.
- Existing databases with no valid graph schema are not adopted.

## 10. Schema verifier

`verifyGraphSchema()` is the one schema truth used by migration completion,
ordinary store re-entry and initializer output. It checks:

- `PRAGMA integrity_check`;
- `PRAGMA foreign_key_check` and enabled enforcement;
- metadata and `PRAGMA user_version`;
- exact required tables, indexes and triggers;
- normalized SQL definitions and deterministic fingerprint;
- missing or unexpected graph objects;
- migration ID/checksum;
- optional zero rows across all nine execution-state tables.

Inventory remains exactly 10 tables, five indexes and two triggers.

- Tables: `graph_schema_meta`, `graph_definitions`, `graph_runs`,
  `graph_events`, `graph_node_attempts`, `graph_approvals`, `graph_evidence`,
  `graph_external_effects`, `graph_checkpoints`, `graph_resource_leases`.
- Indexes: `graph_runs_status_idx`, `graph_runs_graph_idx`,
  `graph_events_run_idx`, `graph_attempts_active_idx`,
  `graph_effects_state_idx`.
- Triggers: `graph_definitions_immutable_update`,
  `graph_definitions_immutable_delete`.

## 11. Atomicity tests

Focused test `graph schema migration atomicity` injects failures:

- after the first table;
- after all indexes;
- after both triggers but before metadata.

For every point, the result is `migration_rolled_back`, the graph object
inventory is empty, `PRAGMA user_version=0`, and no metadata survives.

## 12. Permission tests

Tests prove:

- umask `0002` still produces database mode `0600`;
- the caller umask is restored to `0002`;
- present sidecars are owner-only;
- unsafe directory mode and simulated ownership mismatch fail closed;
- an existing non-SQLite file retains its original digest and mode on rejection.

## 13. Drift and path-safety tests

Tests reject relative/out-of-root/source paths, symlink targets/parents/sidecars,
missing tables/indexes, changed triggers, unexpected graph objects, wrong
checksum, future/older versions, partial metadata, empty/malformed database
files and foreign-key orphans.

## 14. Verification results

- Focused initializer suite: 18/18 passed.
- Graph kernel + production adapters + initializer: 61/61 passed.
- Typecheck: passed, exit 0.
- Build: passed, exit 0.
- Complete self-contained Operator suite: 496/496 across 40 files, exit 0.
- Documentation sync, Git whitespace validation and task-owned secret scan:
  passed.
- Unfiltered live-HTTP file: 10/10 tests failed with
  `ECONNREFUSED 127.0.0.1:3000`, exit 1. This is the documented environmental
  boundary because no service is approved on that address; no service was
  started to mask it.

## 15. New source and migration digests

| Surface | SHA-256 |
|---|---|
| `store.ts` | `2bd6cbd96ae31554b82f1ff6a3e7a6160c3a5d30d11c9b356ff52b9ee894d978` |
| `migrations.ts` | `58fd06145d194b0a0007ba60ad5ec7922b8bdbc5a3e9ea7732d3d87c71bca52c` |
| `schema-verifier.ts` | `67eb823fc7f65663858606047a9ace3170007bd3c81924983f54dc2ebe310043` |
| `initializer.ts` | `fa39fcadec29c0649a2547d3cbfe2b78b59dda788451059c2a52807b04ed58f8` |
| CLI initializer | `c04176dfb14d9d2512a1cd08b93bdae1e77d35b57fac0009896e13347b23c4c8` |
| focused tests | `188e7e8e5fe2c304e76202ffde8d925fca583faa36ae55093a23fa4cb6c5c231` |
| ordered production initializer source set | `689473875a34cd252cc02bdab33f4f07eb3ec524c97dab3e4deda11ee2f2923a` |
| migration manifest | `51bd7a5920e2584f83199119796a2509d37e4088d55aa013db613b707364844f` |

Digests are re-recorded after final verification; documentation-only changes do
not affect these source values.

## 16. Production-state protection proof

Throughout the repair:

- production `graph-runs.sqlite`: absent;
- PID: 461;
- `NRestarts`: 0;
- service: active/running;
- `/health`: HTTP 200;
- `/api/persistence/health`: HTTP 200;
- `/api/graphs/health`: HTTP 404;
- graph metrics: absent;
- scheduler identity set: unchanged at 10 jobs;
- provider writes, graph runs and graph effects: 0.

All database tests used isolated `mkdtemp` paths with explicit test-only
override. The production initializer command was never executed.

## 17. Documentation updated

The ADR now records atomic manifest semantics and owner-only persistence. The
runbook documents production/test path behavior and structured results. The
migration registry records fresh Gate B as the next gate. The original blocked
Gate B report references this repair without changing its verdict.

## 18. Residual risks

- The production migration is deliberately unexecuted; filesystem ownership,
  final DB digest and PRAGMA evidence remain Gate B evidence, not local-repair
  evidence.
- SQLite access may create transient WAL/SHM artifacts; the initializer
  checkpoints, secures and closes them, but Gate B must independently verify
  final files.
- There is no adopted version-0 or foreign graph database path. Such files fail
  closed and require a separately reviewed migration/adoption decision.
- Gate C remains ineligible until a fresh Gate B succeeds.

## 19. Exact fresh Gate B command

Do not execute without fresh approval:

```text
cd /home/oneclickwebsitedesignfactory/.openclaw/workspace/projects/openclaw-operator/orchestrator
node --import tsx scripts/initialize-graph-database.ts --expect-absent --path /home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/database/graph-runs.sqlite
```

The production command intentionally contains no test-only override.

## 20. Exact next approval required

**Fresh Gate B — initialise the reviewed production graph persistence schema
using the hardened initializer while the graph runtime remains disabled.**

The production initializer, Gate C restart and all later gates were not
executed.
