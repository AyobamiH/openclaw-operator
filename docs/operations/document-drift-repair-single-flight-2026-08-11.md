---
title: "Document Drift Repair Single-Flight Closure"
summary: "Evidence and contract for closing overlapping document drift-repair execution."
status: "implementation-verified"
owner: "orchestrator"
lastVerified: "2026-08-11"
---

# Document Drift Repair Single-Flight Closure

## Scope

This repair closes the document drift-repair concurrency defect from the final
Full Graph Campaign and Recurring Workflow Operating-System Audit. It does not
change ownership, Graph scheduling, provider authority, or product behavior.

The orchestrator remains the sole document-repair mutation owner.
`doc-specialist.service` remains an observer-only health process.

## Canonical reproduction

The natural document burst recorded on 2026-08-11 admitted overlapping
`drift-repair` executions. Both invoked doc-specialist knowledge-pack builds.
During retention cleanup, one execution removed a candidate and the other then
failed with:

```text
ENOENT: no such file or directory, unlink '.../knowledge-pack-1786186946664.json'
```

The companion execution completed successfully. The two receipts therefore
showed one failure and one success for work originating in one burst.

## Root cause

The owner was already singular; the execution contract was not.

1. Admission locks were keyed by the exact sorted pending-path snapshot.
2. Repair idempotency used the same exact path-set digest.
3. A changing burst produced different snapshots and therefore different lock
   and idempotency keys.
4. Both handlers could pass the active-execution recheck before either enqueue
   became visible to the other.
5. Both knowledge-pack builds enumerated the same retention candidates.
6. Retention treated an already-removed candidate as a new failure.

## Corrected contract

- Knowledge-pack mutation has one coordination lane, regardless of the current
  path snapshot.
- Central task admission permits at most one `drift-repair` execution in
  `pending`, `running`, or `retrying` state.
- A suppressed expanded burst is recorded as
  `coalesced-active-drift-repair`; it is not reported as a successful repair.
- Incoming repair paths are staged once in the durable pending-path buffer.
- The active handler atomically takes the current buffer and unions it with its
  immutable payload.
- Paths arriving after that take remain pending and receive a distinct repair
  identity only after the active run reaches its own terminal state.
- A terminal failure remains failed. A later follow-up has a different run and
  cannot convert the failed run to success.
- Exact same-run retries remain bound to persisted retry-recovery evidence.
- Persisted pending paths are re-enqueued during startup recovery.
- Retention ignores only `ENOENT` for a candidate already removed by an
  overlapping snapshot. Other filesystem errors still fail closed.
- Retention counts only files actually removed by that invocation and reports
  the post-cleanup observed retained count.

## Regression coverage

The focused suite covers:

- changing path snapshots in one concurrent burst;
- active-run coalescing across different repair identities;
- duplicate same-run admission;
- independent non-document work while repair is active;
- duplicate path staging and independent document preservation;
- deterministic terminal follow-up identity;
- startup recovery identity;
- same-run persisted retry recovery;
- restart reconciliation of admitted work;
- failed-run truth followed by a distinct recovery burst;
- concurrent retention cleanup;
- non-`ENOENT` cleanup failure propagation; and
- observer-only doc-specialist ownership.

## Local verification

- focused admission/coalescing/coordination tests: `27/27` passed;
- changing-snapshot handler regression: `1/1` passed;
- retention tests: `4/4` passed;
- orchestrator TypeScript: passed;
- orchestrator build: passed;
- `git diff --check`: passed.

The complete owned-SSH `npm run verify:main` gate passed as Crabbox run
`run_0dcc3e44296f`: builds, 97 unit simulations, 35 live middleware tests,
34 operator-console tests, both TypeScript projects, documentation drift/link
checks, curation, and the VitePress production build were green. The focused
concurrency suites also passed on the same owned `web` compute as
`run_58a1fbeeb6a8` (`27/27`, `1/1`, and `4/4`). The exact remote work root was
removed after both exit statuses were preserved.

Exact commit/push, runtime load, and natural concurrency observation are
recorded during deployment closeout.

## Effects boundary

This repair performs no provider writes, Browser Relay calls, campaign work,
social publication, Graph execution, schedule mutation, credential access, or
backlog execution.
