---
summary: "Controlled transfer of one Instagram Image schedule from legacy execution to the payload-bound graph runtime."
status: "complete — graph authoritative for one production schedule"
date: "2026-08-02"
---

# Graph scheduler transfer and Phase G proof

## Current verdict

**PHASE G COMPLETE — GRAPH IS AUTHORITATIVE FOR ONE PRODUCTION SCHEDULE.**
Exactly one schedule remains graph-owned. Its second natural cycle passed the
full scheduler, graph, exactly-once, public-provider and creative-quality
contracts after the first natural cycle supplied scheduler-success and
quality-failure incident evidence. Restart recovery, zero-write policy,
single-schedule ownership and exact rollback readiness persist.

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

### First natural graph-owned cycle — scheduler passed, creative quality failed

The unchanged cron fired at `2026-08-02T13:00:00.024+01:00` and finished
`ok` after `261098 ms`. Its recorded command is only the allowlisted graph
trigger; the prior `11:00` run is the last history entry that used the legacy
direct Instagram runner. The graph-owned run is:

- scheduler trigger `gst_8c68fd2b9b23d0d008fd113a2fee551d`, attempt `1`,
  status `completed`;
- natural slot
  `instagram:2026-08-02:13:00:24afbb84-457c-41bb-92c9-24a19725e984`;
- graph run `grzwcanary_e0eb6eeb-10e6-4dea-bab6-d080032f498d`,
  `deterministic-social-publication@2.0.0`, completed at revision `28`;
- approval `gap_f7154c6351d85b7995c0084987936e3e`, granted only for the
  exact payload and represented account;
- capability `glc_297a230ea655fcc4147788a29cbdcb98`, permanently `consumed`
  at `2026-08-02T12:03:25.048Z` before Instagram publication;
- claim `gclaim_d5045b66bef3579a0f86e65fbdaab010`, final status
  `verified`;
- effect `gex_d8d8805d-92bb-4b6c-adec-281fb5bb580e`, final state
  `effect_verified`.

The two ordered capability dispatches each have a maximum and observed count
of one. Delivery upload succeeded first; `instagram_publish` then succeeded
once with provider object `18031591145828795`. The frozen identity is payload
SHA-256 `386f572ca9a156643331df2148977942788ed99112cdfff1abfeeb56e659fedc`,
media SHA-256 `a976e13bf9bec1a943b6cfac61ad84472b4475eb3843be3a49d281598e450f57`
and envelope SHA-256
`b95eceb901a453cf7cfcb5e1459a4ddeb860efd1da3fcc069069b66fa4a32afa`.

The canonical Instagram outbox contains exactly one row for the natural slot
and exactly one row for provider object `18031591145828795`. It is `verified`,
`published_verified`, counted once, and binds container
`18056370089787955` and
`https://www.instagram.com/p/DbiXsKmFjDK/`. Canonical verify, inspect and
owned-feed exact-caption readback all passed. Fresh official API reads before
and after restart returned the same IMAGE/FEED object, and the ten most recent
owned objects contained exactly one exact-caption match. Provider writes were
one, upload writes were one, retries were zero and Browser Relay calls were
zero.

The frozen image spec had already shortened the eyebrow to
`Weak product boun… · Practical` and the headline to
`Treat a product boundary nobody can explain as a state pr…`, while the
caption preserved the full source ideas. The renderer audited only the
shortened DOM and the worker required layout evidence only for Reels. This is
recorded as a production-quality incident in
`instagram-creative-layout-repair-and-quality-gate-2026-08-02.md`. The public
post remains evidence and was not deleted. Phase G cannot use this cycle as a
quality-verified natural execution.

Graph schema v2 has integrity `ok`, no foreign-key failures and mode `0600`.
The exact run has `174` contiguous hash-chained events, `32` evidence records,
one completed replay-equivalent state, no active run, no active capability and
no unresolved effect. Both the graph event chain and the seven-event scheduler
ownership/trigger chain validate. The scheduler database also has integrity
`ok`, no foreign-key failures and mode `0600`.

### Controlled restart recovery — passed

The first observer was interrupted by a separate Gateway restart at
`13:36:35 BST` and self-deleted. Sanitized session history plus the unchanged
orchestrator PID/timestamps proved that its approved orchestrator restart had
not been dispatched. The single approved restart was therefore submitted once
at `2026-08-02 14:38:27 BST`:

- PID changed from `1193152` to `1267217` with a newer activation timestamp;
- the old process shut down gracefully and the unit returned
  `active/running`, `Result=success`, `NRestarts=0`;
- loopback `127.0.0.1:3312` listened and `/health` returned HTTP `200`;
- the startup journal recorded `graph runtime initialized in zero-write mode
  (2 definitions, recovery resumed=0, blocked=0)` and no known startup failure;
- service and drop-in hashes stayed byte-identical, including zero-write
  drop-in SHA-256
  `a4be738e6c8ae4038021d24ae173bc3da29ff169c02bd1c3941edaf2b67098a9`;
- the fixed 17-key adjacent OpenClaw configuration snapshot stayed identical at
  SHA-256 `a7e35efb4926d6c0dc3fa8fae37f30c4d5eece9cf979b66e20545240d3ba51e2`.

After restart, the migration remained `graph_owned`; the trigger remained
`completed`; the exact capability remained `consumed`; the run, effect, claim
and outbox remained terminal; and active run/capability/unresolved-effect
counts remained zero. The public persistence endpoint returned HTTP `200` but
continues to label the intentionally skipped Mongo backend unhealthy because
this unit runs with file-backed runtime state and `strictPersistence=false`.
Redis coordination was healthy, and both Phase G SQLite stores independently
passed integrity and foreign-key checks. This pre-existing generic persistence
label is not a Phase G ownership or provider ambiguity.

### Second natural graph-owned cycle — scheduler and quality gate passed

The unchanged cron fired naturally at `2026-08-03T05:00:00.031+01:00` and
completed `ok` after `249382 ms`. The scheduler again invoked only
`trigger-graph-schedule.ts --migration-id phase-g-instagram-image-v1`; no
legacy direct executor ran. Its exact terminal lineage is:

- trigger `gst_c9be89200a77815fae6bab8f2f4300a1`, attempt `1`, status
  `completed`;
- natural slot
  `instagram:2026-08-03:05:00:24afbb84-457c-41bb-92c9-24a19725e984`;
- run `grzwcanary_594c74e4-49cb-4830-849e-89fc06c1f69f`, completed at
  revision `28` under immutable
  `deterministic-social-publication@2.0.0` hash
  `995ff8355a57113884129b7cda9f7966d4719163f9b9b81ed77e87d12c6a3473`;
- claim `gclaim_8b1ed00a08c42444d3dde6dd2c79172d`, final status
  `verified`;
- approval `gap_03023f56e20b90ada085da72a2cdd1cd`, exact status
  `granted`;
- capability `glc_c3b031dd0975ba7f7cdbee76309f1a6f`, permanently
  `consumed` at `2026-08-03T04:03:09.456Z`;
- dispatch `delivery_upload` followed by `instagram_publish`, each reserved
  once and completed once against a maximum count of one;
- effect `gex_9441458c-a0ca-402c-9bf5-93eee55d5cfe`, terminal
  `effect_verified`;
- provider container `18056487374787955` and exactly one provider object
  `18004466273976486` at
  `https://www.instagram.com/p/DbkFhmdF5I7/`.

The frozen identity is payload SHA-256
`ff084a77a2f250000ac71e03e283bc4ed9e4bad74d0300740d09b4257f82ca2e`,
media SHA-256
`2a3b6465e9a5741147c92a347092c20fc2b757a7c52d99f0a5a6928acc9fefcb`
and envelope SHA-256
`a53e2b4917f9749a701f2ac9c2f35551724cf415b5e5fee7a2e533efd0870642`.
The capability, frozen envelope, exact local file, outbox, upload receipt and
trigger receipt carry the same media hash.

The graph has `174` valid chained events, `32` evidence records and exact
replay equality. The scheduler chain has `12` valid events and both natural
triggers are terminal. The canonical Instagram outbox contains one exact slot
row and one exact provider-object row, terminal `published_verified`, counted
once. Upload writes were one, provider writes one, retries zero and Browser
Relay calls zero. Active graph runs, active capabilities, unresolved effects
and active/ambiguous triggers are zero. One historical legacy `2026-07-31
11:00` outbox item remains quarantined as `still_ambiguous`; it is outside this
exact slot, capability, effect and provider-object lineage and did not create a
duplicate or ambiguity for the second Phase G cycle.

Fresh official Meta API-only verification, direct object inspection and
owned-feed readback returned the exact Image/Feed object, caption, account and
permalink once. The same readback also proved the first incident object
`18031591145828795` still exists exactly once and was not deleted.

The persisted layout gate is `passed` under contract version `1.0.0` SHA-256
`87eb13371b5d8fbadb4a79ed7d13efd1e91d72143e1c32cba42e8dcf0969bb96`.
Its source and rendered text SHA-256 values are both
`5e52dc93fadc7254dfd1ba20a71686b422cf488addea391f69c58ff10947f3b4`;
`boundingBoxesValid`, `semanticCompleteness` and approved-font resolution are
true; the selected sixth repair profile is `compact-all`; and
`finalMediaSha256` equals the published envelope media hash. Original-resolution
visual inspection confirmed all 12 source text elements are present with no
ellipsis, clamp, clipping, overflow, overlap, missing character or unapproved
font. Full visual evidence is recorded in
`instagram-creative-layout-repair-and-quality-gate-2026-08-02.md`.

The repair was loaded by one further task-scoped controlled orchestrator
restart at `2026-08-02 15:48:13 BST`. PID `1299269` remains active with
`NRestarts=0`; startup proved and still preserves global zero-write, two
immutable graph definitions and recovery `resumed=0, blocked=0`. Service and
drop-in hashes are unchanged. Graph, scheduler and Instagram outbox stores
retain integrity `ok`, ownership remains `graph_owned`, and active run,
capability and unresolved-effect counts remain zero.

Loaded zero-write validation selected the exact natural candidate
`instagram-dynamic:9a216303f8ac4e56ffbb706a`. Its six-attempt bounded render
passed the canonical layout contract
`87eb13371b5d8fbadb4a79ed7d13efd1e91d72143e1c32cba42e8dcf0969bb96`
with equal source/rendered text hash
`5e52dc93fadc7254dfd1ba20a71686b422cf488addea391f69c58ff10947f3b4`,
strict geometry, approved font and manually confirmed full copy. It performed
zero uploads and zero publications. The natural cycle reproduced the same
deterministic media hash, passed the same frozen layout record and published it
through the one-use capability above. The observer
`ee64444d-9f66-4aee-a6a2-384b47bf9165` fired once at `05:20 BST` and
self-deleted.

Exactly one migration exists and remains `graph_owned`. Every other current
workflow is still legacy-owned. The current cron expression, timezone,
declaration, enabled state and fixed trigger are unchanged. The legacy rollback
artifact independently recomputes to
`94f7110c22083bf76eef3793d26ab38500d6879d4f03e41ff5c5694c7dc43b84`;
the current graph job recomputes to
`84f93b95fd7686d70eb72b03dc16d38d645bb7ff80444dae0eeae4872c6db57f`.
No rollback condition is active.

Terminal evidence:

- `artifacts/business-value/marketing/2026-08-03/phase-g-instagram-image-production-proof.json`;
- `artifacts/business-value/marketing/2026-08-03/instagram-image-outbox-0500-07e434c552c02506.json`;
- `artifacts/business-value/marketing/2026-08-03/instagram-outbox/dynamic-image-20260803-0500-de0399d98349/`;
- `/home/oneclickwebsitedesignfactory/.openclaw/state/activation/graph-phase-g-instagram-image-20260802/triggers/gst_c9be89200a77815fae6bab8f2f4300a1.json`.

## Completion boundary

Phase G authorises the graph runtime for this one production schedule only. Do
not infer authority for another migration, provider action, restart or rollback.
Remaining workflows stay legacy-owned until they are separately approved and
proved through the same evidence-first process.
