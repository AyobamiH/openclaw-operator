---
title: "Graph Execution Operator Runbook"
summary: "Define, run, inspect, approve, recover, and migrate durable OpenClaw graphs."
---

# Graph Execution Operator Runbook

## Current activation state

The graph kernel and production adapter registry are source-complete and
locally verified. `OPENCLAW_GRAPH_RUNTIME_ENABLED` defaults to disabled, so no
graph database or routes are initialized by a normal service boot. It is not
loaded by the running production service until separately approved database,
configuration and restart gates occur.
Existing schedulers and publishers remain authoritative until explicitly cut
over.

## Define a graph

Use a versioned object satisfying `GraphDefinitionSchema` in
`orchestrator/src/graph/schema.ts`. Register only handler IDs already present in
`NodeExecutorRegistry`. Never identify an executor by a filesystem path.

Validate without registration:

```text
POST /api/graphs/definitions/validate
```

Register as an authenticated admin:

```text
POST /api/graphs/definitions/register
```

Changing bytes under an existing `graphId@version` is rejected. Create a new
semantic version instead.

List code-registered production adapter contracts:

```text
GET /api/graphs/adapters
```

A production handler must also appear in the node's `requiredCapabilities`.
The registry rejects side-effect, authority, timeout and idempotency downgrades.

## Run and inspect

Start with an explicit authority envelope:

```json
{
  "graphId": "research-to-action",
  "objective": "Evaluate one evidence-backed engineering decision",
  "input": { "sources": [], "claims": [] },
  "authority": { "maximum": "read_only", "grantedBy": "operator" }
}
```

Interfaces:

- `POST /api/graphs/runs`
- `GET /api/graphs/runs`
- `GET /api/graphs/runs/:runId`
- `GET /api/graphs/runs/:runId/events`
- `GET /api/graphs/runs/:runId/evidence`
- `POST /api/graphs/runs/:runId/step`
- `POST /api/graphs/runs/:runId/execute`

Run detail includes a Telegram-friendly summary plus `childRunReceipts`,
`verifierReceipts`, `eventChainValid` and `childRunReceiptChainValid`. SQLite
remains truth. A terminal receipt is immutable and replay returns its stored
outcome without another child dispatch.

For `coding-change@1.2.0`, implementation and repair require an exact graph
approval at `local_reversible`. The task queue may reuse that decision only
when the task resolves to the active parent run, prepared receipt, child task
identity and unexpired granted approval. Caller-supplied `__graph*` fields are
not authority by themselves.

## Pause, resume and cancel

- Pause: `POST /api/graphs/runs/:runId/pause`
- Resume: `POST /api/graphs/runs/:runId/resume`
- Cancel: `POST /api/graphs/runs/:runId/cancel`

Resume fails if approval is absent or an external effect needs reconciliation.
Cancel fails if provider-side work is active or ambiguous.

## Approvals

Inspect pending approvals in run detail. Decision requests must repeat the
exact `action`, `target`, and `payloadHash` from the pending record:

```text
POST /api/graphs/runs/:runId/approvals/:approvalId
```

Changing any bound field invalidates the decision. Expired approval cannot be
replayed.

## Recovery

Inspect:

- `GET /api/graphs/blocked`
- `GET /api/graphs/orphaned`
- `GET /api/graphs/health`

Run bounded recovery:

```text
POST /api/graphs/recover
```

Recovery resumes only safe local or approved work. It blocks ambiguous
external effects.

Retry an allowed checkpoint:

```text
POST /api/graphs/runs/:runId/checkpoints/:checkpointId/retry
```

Checkpoint retry never resets consumed budgets or external-effect history.

## Resolve an ambiguous effect

First use the official provider read path. Then record exactly one structured
observation with evidence references:

```text
POST /api/graphs/runs/:runId/effects/reconcile
```

Allowed observations are `effect_observed`, `effect_verified`,
`confirmed_absent`, `ambiguous`, or `compensated`. Creation/publication can be
retried only after `confirmed_absent` and a valid authority decision.

## Migrate another workflow

1. Inventory its trigger, owner, persistence, retry, side-effect and
   verification behavior.
2. Define the completion assertions before execution nodes.
3. Wrap the existing command/worker with a code-registered legacy adapter.
4. Run fixtures and zero-write production-path validation.
5. Simulate restart and ambiguous effects.
6. Compare old and graph outputs over a shadow period.
7. Request approval for scheduler/service cutover.
8. Retain the old path during the rollback window.
9. Mark the registry `graph_native` only after equivalence and live recovery
   evidence pass.

## Run shadow equivalence

The publishing harness is deliberately local and zero-write:

```text
node --import tsx scripts/run-graph-shadow-equivalence.ts
```

Every mismatch must be classified. Unknown mismatches are high risk and block
activation. Only explicit nondeterministic paths may be ignored; ignored paths
cannot hide semantic payload, candidate, authority, idempotency or transition
differences.

## Loaded zero-write canary

Production activation evidence and the current live-cutover boundary are recorded in
`docs/operations/graph-runtime-autonomous-zero-write-activation-2026-08-01.md`.
Do not shell-source a credential environment file to derive API authentication:
shell parsing can change structured rotation data and error output may expose
values. Use `src/auth/credential-reference.ts` through an absolute, owner-only,
non-symlink credential file reference; it never prints parser input or token
material. After suspected exposure, rotate first and prove replacement
acceptance plus compromised-key rejection before graph requests resume.

Loaded shadow equivalence is run through the authenticated file-reference
harness:

```text
node --import tsx scripts/run-loaded-graph-shadow-equivalence.ts \
  --base-url http://127.0.0.1:3312 \
  --credential-file /home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/credentials/orchestrator.env \
  --output /home/oneclickwebsitedesignfactory/.openclaw/state/activation/graph-zero-write-runtime-20260801/loaded-shadow-corpus.json
```

The harness reuses already recorded sample runs, reads back events/evidence,
cancels proved blocked samples to release concurrency, and fails unless all ten
semantic comparisons and all event chains pass with zero effects. It never
calls a provider mutation.

Use the reviewed `systemd/orchestrator-graph-zero-write-canary.conf` only under
separate deployment, database and restart approvals. It declares exactly
`coding-change@1.2.0`, `deterministic-social-publication@1.1.0`,
`deterministic-social-publication@2.0.0`, and
`research-to-action@1.1.0`, prefixes runs `grzwcanary_`, and sets the
executor-level zero-write barrier. Experimental and unsupported definitions
fail the production load policy. This source declaration is not active until
the separately approved production config/database migration and service
reload. Legacy scheduling remains authoritative until an explicit transfer.

Database initialization is a separate guarded command:

```text
node --import tsx scripts/initialize-graph-database.ts --expect-absent --path /home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/database/graph-runs.sqlite
```

The command has no current-working-directory fallback. It resolves the verified
Operator state root from `OPENCLAW_OPERATOR_STATE_DIR` or the fixed
`~/.openclaw/state/openclaw-operator` convention, requires the exact production
target, rejects symlinks/source paths/out-of-root paths, and fails before
mutation when `--expect-absent` finds an existing target. Temporary fixtures
require the explicit `--test-only-allow-unsafe-path` test flag and an explicit
`--state-root`.

Schema version 3 is one atomic `BEGIN IMMEDIATE` migration. Existing exact
version-1 or version-2 databases upgrade transactionally; a failed upgrade
rolls back to the previously verified state. Version 3 adds immutable
`graph_child_run_receipts` and `graph_verifier_receipts`, their indexes and
terminal-mutation triggers. The migration creates no run, approval,
capability, dispatch or effect authority. The initializer
returns structured JSON containing creation/re-entry status, schema and user
versions, migration ID/checksum, integrity and foreign-key results, object
counts, execution-row count, schema fingerprint and verified mode `0600`.
Reopening a matching database without `--expect-absent` returns
`already_initialised` without changing migration metadata or schema. Missing,
changed, partial or future graph schemas fail closed through the canonical
schema verifier.

Production initialization remains a separately approved gate. Never use the
test-only override for production and never combine database creation with a
service restart, runtime flag, graph registration or canary run.

Never delete graph tables for rollback. Disable the runtime flag and retain
the database read-only for audit.

## Metrics

The Prometheus surface exports the required `openclaw_graph_*` families for
runs, durations, attempts, failures, transitions, loops, approvals, budgets,
ambiguous effects and recoveries. Labels use graph/version/node/category, never
raw run IDs.
# Payload-bound one-run live publication

`deterministic-social-publication@2.0.0` remains immutable and the production
startup guard still rejects any graph runtime that does not explicitly set
`OPENCLAW_GRAPH_ZERO_WRITE_ONLY=true`. A live exception is never a global
mode. It is one durable capability bound to the exact graph definition hash,
run, claim, approval, provider/account, candidate/campaign/sequence/slot,
payload, media, envelope, idempotency fingerprint, expiry and mutation plan.

The ordered Instagram plan is:

1. reserve `delivery_upload`, then invoke the exact generated-media delivery
   upload;
2. require that predecessor to be verified, atomically consume the capability
   while reserving `instagram_publish`, then invoke the official Meta publish
   connector sequence.

The graph effect intent must already be durable before either reservation.
`request_sent` is recorded in the same transaction as dispatch reservation.
Consumed, revoked, expired and blocked authority cannot become active again.
A restart with `request_sent`, provider-accepted or ambiguous evidence blocks
the run for official readback; database event replay never reconstructs
capability authority.

The owner-only local control surface accepts references, never raw payload
prose:

```text
OPENCLAW_GRAPH_ZERO_WRITE_ONLY=true npm --prefix orchestrator run graph:live-capability -- \
  --action status --path /absolute/owner-only/graph-runs.sqlite
```

Use `--action approve` or `--action issue` only for the exact prepared run and
short expiry. The authenticated admin API exposes equivalent issue/revoke
operations. Neither surface executes a run. Scheduler-originated runs cannot
self-mint or inherit capability authority. Scheduler transfer remains Phase G
and is outside this runbook's Phase F procedure.

## One-schedule graph ownership

Phase G uses a separate owner-only scheduler-control database. A durable
migration must be `graph_owned` before its fixed trigger can reserve a natural
slot. Cron supplies one allowlisted migration ID, never a graph definition,
provider, account, payload or arbitrary command. The graph then creates a fresh
exact approval and one-run capability for that run.

Inspect the record through the owner-only local surface:

```text
OPENCLAW_GRAPH_SCHEDULER_DATABASE_PATH=/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/database/graph-scheduler.sqlite \
node --import tsx scripts/manage-graph-scheduler-migration.ts \
  --action status --migration-id phase-g-instagram-image-v1
```

Rollback disables graph ownership first and restores the exact legacy cron
projection second. It is forbidden while a trigger is active or an effect is
ambiguous, and never erases provider truth or consumed authority.
