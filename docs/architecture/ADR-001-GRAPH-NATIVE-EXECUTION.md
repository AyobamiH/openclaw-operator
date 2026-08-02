---
title: "ADR-001: Graph-Native Execution Kernel"
status: "accepted-source-not-yet-activated"
date: "2026-08-01"
owner: "OpenClaw Operator"
---

# ADR-001: Graph-Native Execution Kernel

## Decision

Introduce a small internal TypeScript graph kernel in the canonical Operator
orchestrator. SQLite remains durable truth. Redis remains optional coordination
for cross-process locks and rate/budget coordination; losing Redis cannot erase
runs, approvals, events, evidence, or completion state.

The kernel is additive. Existing task, scheduler, agent, publishing and reply
paths remain operational until their graph replacements pass equivalence and a
rollback observation period.

## Verified before-state

- The live `orchestrator.service` runs `node --import tsx src/index.ts` from
  `projects/openclaw-operator/orchestrator`.
- The canonical product source is `projects/openclaw-operator`; root copies are
  host/local operations or transitional runtime surfaces.
- The existing orchestrator has an Express control plane, bearer/RBAC
  middleware, Zod, SQLite persistence, Redis-backed coordination, Prometheus,
  task admission, approval records, deterministic publishing state and
  provider reconciliation.
- OpenClaw cron owns ten current declarations: seven enabled and three disabled
  on the 2026-08-01 inspection. Public-side-effect schedulers are still legacy
  execution paths and are not silently rerouted by this change.
- Both canonical repositories had pre-existing unrelated dirty work. This
  migration uses new `orchestrator/src/graph/*` modules plus narrow imports,
  route registration, API-contract and documentation edits; it does not reset
  or rewrite that work.

## Build versus adopt

LangGraph, Temporal, BullMQ and XState were not added.

Reasons:

1. The required semantics are specialised: payload-bound approval, evidence
   completion contracts, explicit ambiguous external effects, fail-closed
   publication reconciliation and retained OpenClaw authority policy.
2. The current runtime already supplies Node.js, TypeScript, Zod, SQLite,
   Redis coordination, Prometheus and Express.
3. A framework dependency would add deployment and operational failure modes
   before removing any current risk.
4. The internal kernel is under 1:1 control of the existing persistence and
   security boundaries and can be introduced without a big-bang rewrite.

Reconsider an external engine only if measured load, cross-host scheduling or
long-duration timer volume exceeds the internal kernel's tested envelope. Any
future adoption must preserve the event, approval, evidence and reconciliation
contracts defined here.

## Definition and transition model

Definitions are validated, serialisable TypeScript data and persisted by
`graph_id + graph_version`. SQLite triggers forbid update or deletion. A
definition includes node contracts, typed outcomes, guarded edges, budgets,
authority, completion assertions, compensation posture, concurrency,
ownership, and migration compatibility.

Node handlers are allowlisted in `NodeExecutorRegistry`. A definition cannot
name a file or arbitrary module. Handlers return typed outcomes and constrained
patch operations. `StateReducer` rejects mutations outside a node's declared
paths and rejects prototype-pollution segments.

Production handlers add a second registry in `graph/adapter-registry.ts`.
Their input/output schemas, side-effect class, shadow safety, idempotency,
authority, timeout, evidence and redaction posture are code-registered. Graph
registration rejects any node that omits the adapter capability or weakens its
contract.

Edges are selected only from declared outcomes and structured guards. Missing
or equally ranked matching transitions fail closed with diagnostic evidence.

## Persistence and migrations

`GraphStore` applies immutable schema version 1 to a separate database:

`$OPENCLAW_OPERATOR_STATE_DIR/database/graph-runs.sqlite`

Tables:

- `graph_definitions`
- `graph_runs`
- `graph_events`
- `graph_node_attempts`
- `graph_approvals`
- `graph_evidence`
- `graph_external_effects`
- `graph_checkpoints`
- `graph_resource_leases`
- `graph_schema_meta`

`graph-schema-v1` is an ordered manifest of 10 tables, five indexes and two
triggers. Its deterministic SHA-256 checksum is persisted once with the schema
version, migration ID and stable `applied_at` timestamp. All DDL, indexes,
triggers, metadata and `PRAGMA user_version` advancement execute inside one
`BEGIN IMMEDIATE` transaction; any failure rolls the complete migration back.
Opening an unchanged version-1 store verifies the manifest and does not refresh
migration history.

The canonical verifier checks SQLite integrity, foreign keys, exact graph
objects and normalized definitions, migration metadata/checksum, schema and
user versions, unexpected graph objects and optional empty execution state.
WAL, foreign keys, full synchronous mode, a five-second busy timeout, unique
attempt and event constraints, revision compare-and-swap, and resource leases
protect concurrent execution. Database and sidecar files are owner-only mode
`0600`; the guarded initializer rejects unsafe roots, symlinks and source-tree
paths. Existing task and publishing history is not migrated or destroyed.

The executor enforces a global run ceiling (default 32, configurable through
`OPENCLAW_GRAPH_GLOBAL_CONCURRENCY`), each definition's `maxRuns`, one lease per
active run/node, and every declared resource key. Static resource keys
serialize shared repositories/accounts; `{runId}` may scope a key to one run.

Rollback is code-level: stop registering graph routes/executors and retain the
database read-only for audit. Do not drop graph tables during rollback. Schema
destruction requires a separate approved retention decision.

The runtime is disabled by default and does not open graph persistence unless
`OPENCLAW_GRAPH_RUNTIME_ENABLED=true`. The initial production posture also
requires `OPENCLAW_GRAPH_ZERO_WRITE_ONLY=true`, an exact definition allowlist,
and a dedicated run namespace. This preserves separate database, restart and
canary approval gates.

## Events and snapshots

Events are append-only, strictly sequenced per run, correlation-linked and
SHA-256 chained. Every durable state update also emits a redacted
`state_snapshot_recorded` event. Replaying the last snapshot reconstructs the
same state as `graph_runs`, while the chain proves sequence integrity.

Attempt creation transactionally records `node_scheduled` and `node_started`.
Checkpoint creation, structured node output, transition selection, approval
decisions and external-effect reconciliation are explicit events. Registered
executor output is runtime-validated before any patch or transition is
accepted; invented outcomes and malformed payloads fail closed.

Snapshots are intentionally redacted by key name. Graph state stores secret
references only; secret values must never be supplied as graph input.

## Recovery and external effects

Startup recovery inspects nonterminal runs and active attempts.

- expired local attempt with no unresolved effect: safe to resume;
- approval granted while offline: safe to resume;
- `request_sent`, `provider_accepted` or `ambiguous`: block for reconciliation;
- verified effect: do not repeat;
- checkpoint retry: restore safe state while retaining the greater consumed
  budget and current external-effect/evidence history.

The kernel never blindly repeats a creation or publication after a crash.

## Authority

Authority classes are ordered from `read_only` through `irreversible`. The
most restrictive of graph, run, node and approval state wins. Approvals bind
run, graph version, node, action, target, canonical payload hash, expiry and
approver. A changed payload requires a new approval.

## Compatibility and migration

`LegacyTaskAdapterRegistry` exposes only code-registered legacy handlers. Each
wrapped node still receives timeout, attempt, idempotency, authority, evidence
and failure semantics. Arbitrary command or module names from API input are
rejected.

Migration order is:

1. externally visible and ambiguous-write workflows;
2. workflows that can falsely report completion or lose restart state;
3. duplicated schedulers and ownership;
4. coding workflows;
5. research/internal workflows;
6. low-risk convenience jobs.

Legacy deletion is forbidden until equivalence proof and a rollback period are
complete.

Subgraph nodes resolve only registered graph IDs and exact versions. The child
run records its parent, reuses the correlation ID, inherits the parent's
maximum authority, and receives no more than the parent's remaining budgets.
Recovery locates the durable child by parent and parent-node identity rather
than creating a second child after a crash.
