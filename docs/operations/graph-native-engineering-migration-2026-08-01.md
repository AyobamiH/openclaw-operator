---
title: "Graph-Native Agent Engineering Migration Evidence"
status: "locally-verified-activation-gated"
date: "2026-08-01"
---

# Graph-Native Agent Engineering Migration Evidence

## Outcome

A production-oriented graph execution lane now exists in canonical Operator
source. It compiles, builds, and passes the complete self-contained test suite.
It is not active in the loaded service because deployment, database
initialisation against the live state directory, and service restart were not
authorised.

## Protected baseline

- canonical repository: `projects/openclaw-operator`
- baseline commit: `df765e90aa5d11b9deaf7795112e85e0f628ddd3`
- live service: `orchestrator.service`
- live working directory:
  `projects/openclaw-operator/orchestrator`
- live entry: `node --import tsx src/index.ts`
- pre-existing dirty files: publishing production-integration config/source,
  publishing store/CLI/engine/runner tests and one production-readiness report
- root operations repository also had unrelated renderer/outbox work
- baseline protection: no reset, cleanup, commit, push, installation,
  deployment, migration execution, scheduler mutation or service restart

## Implemented components

| Required responsibility | Implementation |
|---|---|
| Definition registry/validator | `graph/registry.ts`, `graph/schema.ts` |
| Run service/executor | `graph/engine.ts` |
| Node registry/legacy adapter | `graph/engine.ts`, `graph/handlers.ts` |
| Transition resolver/guards | `graph/engine.ts` |
| Constrained reducer | `graph/reducer.ts` |
| Event/checkpoint/evidence store | `graph/store.ts` |
| Approval/authority evaluator | `graph/authority.ts` |
| Failure taxonomy | `graph/failures.ts` |
| Budgets/no-progress | `graph/engine.ts` |
| Idempotency/effect reconciliation | `graph/engine.ts`, `graph/store.ts` |
| Recovery | `GraphExecutor.recover()` |
| Nested subgraphs | `GraphExecutor.executeSubgraph()` with durable parent/correlation lineage |
| Metrics | `graph/metrics.ts` |
| Runtime registration | `graph/runtime.ts` |
| Authenticated API | `graph/routes.ts`, `openapi.ts` |
| Telegram summary | `graph/summary.ts` |

## Representative workflows

1. `coding-change@1.0.0`: dirty-state/repo/plan/implementation/verification
   stages, bounded repair loop, completion evidence and no commit/push authority.
   A temporary real file fixture proves implementation plus validation flow.
2. `deterministic-social-publication@1.0.0`: schedule, deterministic selection,
   duplicate/policy/authority gates, payload identity, zero-write dry run,
   external-effect reconciliation stages and evidence completion. Live provider
   handlers fail closed until an exact official connector adapter is registered.
3. `research-to-action@1.0.0`: source and claim separation, unsupported-claim
   rejection, bounded refinement shape, business relevance and evidence gate.

## Recovery and safety proof

Focused tests cover:

- immutable graph versions;
- unknown-handler rejection;
- reducer mutation boundaries and prototype protection;
- duplicate worker lease acquisition;
- global/per-definition run limits and declared resource-lock contention;
- three representative workflows;
- unsupported-claim terminal failure;
- hash-chain verification and state replay;
- approval binding;
- provider acceptance before crash producing `blocked`, not duplicate replay;
- approval granted while offline;
- checkpoint retry retaining consumed budgets;
- real nested child execution with inherited authority, remaining budgets and correlation lineage;
- repeated identical repair stopping as `no_progress`.

Additional contract proof covers allowlisted handler output validation,
durable `node_scheduled` / `node_started` events, checkpoint events, and
external reconciliation updating both the state snapshot and event ledger.

## Validation record

- `npm run typecheck`: passed.
- `npm run build`: passed.
- graph kernel plus OpenAPI contracts: 28/28 passed.
- authoritative self-contained orchestrator suite:
  458/458 passed across 38/38 files.
- unfiltered `npm run test:run`: 454 passed and 10 failed across 39 files. All
  ten failures were the existing `test/load.test.ts` live HTTP checks because
  no server was listening at `127.0.0.1:3000`; the nine fetch cases reported
  `ECONNREFUSED` and the timeout case consequently received `TypeError` instead
  of `AbortError`. The separate in-process load suites did run and pass.
- `git diff --check`: passed.

No service was started merely to make the environmental live-server tests
green. Doing so would have crossed the service lifecycle boundary and could
have loaded the dirty source tree.

No provider, browser, Git remote, scheduler or service lifecycle write occurred.

## Remaining activation gates

1. Register production legacy/connector adapters for the chosen first live workflow.
2. Run shadow equivalence against natural executions.
3. Review the full diff against pre-existing publishing changes.
4. Obtain explicit approval to commit/push if desired.
5. Obtain explicit deployment/database-initialisation/service-restart approval.
6. After deployment, verify authenticated graph health, SQLite schema, metrics,
   recovery and one zero-write production-path run before any scheduler cutover.

Verdict: **LOCALLY VERIFIED — PRODUCTION ACTIVATION GATED**.
