---
summary: "Controlled transfer of one Instagram Image schedule from legacy execution to the payload-bound graph runtime."
status: "active observation — graph owned"
date: "2026-08-02"
---

# Graph scheduler transfer and Phase G proof

## Current verdict

Phase G is not terminal until multiple natural graph-owned cycles have
completed. The controlled ownership cutover is active and observation is in
progress.

## Scope and invariants

Only job `24afbb84-457c-41bb-92c9-24a19725e984`, declaration
`instagram-single-image-feed-daily-v1`, is in scope. Its unchanged schedule is
`0 5,7,9,11,13 * * *` in `Europe/London`. Nine adjacent cron job projections
are unchanged. Threads, replies, Reels, shadow publishing and all other
schedules remain legacy-owned.

`OPENCLAW_GRAPH_ZERO_WRITE_ONLY=true` remains mandatory. The unchanged startup
guard rejected an isolated false-policy start with
`graph_runtime_requires_explicit_zero_write_policy`. A trigger can refer only
to `phase-g-instagram-image-v1`; the mutating node still requires the exact
one-run capability proven in Phase F.

## Architecture and threat model

The scheduler command contains only:

```text
trigger-graph-schedule.ts --migration-id phase-g-instagram-image-v1
```

The durable record binds the cron job/declaration, graph ID/version and
immutable definition hash, namespace, provider, represented account, schedule,
timezone, legacy rollback digest and graph-trigger digest. The trigger derives
the natural slot and rejects arbitrary graph, provider, account, payload or
slot arguments.

The graph owns candidate selection, durable claim, deterministic preparation,
immutable envelope, exact approval, one-run capability, effect intent, ordered
provider reservations, official mutation, reconciliation, second readback,
local commit, claim finalisation and completion evidence. Cron owns timing only.

## Persistence and rollback

Owner-only SQLite schema `graph-scheduler-schema-v1` contains:

- `graph_scheduler_migrations` — immutable ownership and rollback binding;
- `graph_scheduler_triggers` — unique natural-slot/run/capability lineage;
- `graph_scheduler_events` — hash-chained ownership and trigger events.

Migration is transactional, checksum-backed, mode `0600`, and initially empty.
It creates no capability, run, approval, claim or effect. The production record
was prepared before activation and became `graph_owned` only after the cron
payload matched the fixed trigger.

Rollback disables graph ownership first, then restores the exact legacy job
whose digest is
`94f7110c22083bf76eef3793d26ab38500d6879d4f03e41ff5c5694c7dc43b84`.
Rollback is blocked while a trigger is active or ambiguous; completed provider
truth and trigger evidence are retained.

## Implementation and immutable definitions

Primary files:

- `orchestrator/src/graph/scheduler-store.ts`
- `orchestrator/scripts/manage-graph-scheduler-migration.ts`
- `orchestrator/scripts/trigger-graph-schedule.ts`
- `orchestrator/src/graph/runtime.ts`
- `orchestrator/src/graph/routes.ts`
- `orchestrator/src/graph/metrics.ts`
- `orchestrator/src/openapi.ts`
- `orchestrator/test/graph-scheduler-migration.test.ts`

Definitions remain immutable:

- `1.1.0` — `f4f41c406ff8399c8e10b2012bf06a5dc0357a28f983e73f328cac3a2d3d592c`;
- `2.0.0` — `995ff8355a57113884129b7cda9f7966d4719163f9b9b81ed77e87d12c6a3473`.

## Verification before load

- scheduler schema/lifecycle/rollback/replay: `5/5` passed;
- focused graph/capability/adapter/kernel/OpenAPI: `68/68` passed;
- isolated loaded API/auth/runtime: `45/45` passed;
- typecheck and build: passed;
- false global policy: failed closed at the unchanged guard;
- Instagram account `17841453638630920`: API-ready and authenticated;
- graph DB: integrity `ok`, no FK failures, no active capability/effect/run;
- Instagram outbox: integrity `ok`, no FK failures or active graph claim;
- Browser Relay calls: zero.

The coding migration/API tools returned partial because the project adapter
enables only `repo-map`; narrow schema, OpenAPI, auth, integration and runtime
checks were used as the documented fallback.

## Controlled load and repair

Pre-load PID `1155926` was healthy. The first load PID `1192616` failed safely
at the registry check: the CLI prepared a cwd-local DB while the service used
the production state root. Neither DB held a trigger or graph-owned record.
The repair fixed the trigger to the exact production DB and requires an
explicit absolute DB path for owner mutations. The empty first-load and
misdirected prepared DB are retained owner-only.

The second load PID `1193152` is active/running with `NRestarts=0`, HTTP `200`,
global zero-write true, two exact definitions, no active capability and no
ambiguous effect.

## Ownership cutover

The update retained job ID, declaration, enabled state, cron expression,
timezone, delivery and ceilings. It replaced only the legacy command and
ownership description with the fixed trigger, and tightened failure alerting.
The record became `graph_owned` at `2026-08-02T10:41:02.725Z`.

Post-cutover health reports one migration, one graph-owned schedule and no
active trigger. Prometheus reports graph owner `1` and legacy owner `0` for the
named migration.

## Natural observation ledger

Pending. Phase G completes only after multiple natural executions, official
provider readback, duplicate checks, consumed capabilities, valid event chains
and a restart-recovery cycle are recorded here.

## Remaining boundary

Do not migrate another schedule. Remaining workflows continue to migrate
individually through the same evidence-first process.
