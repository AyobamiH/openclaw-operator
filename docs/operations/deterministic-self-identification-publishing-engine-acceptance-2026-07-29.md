---
title: "Deterministic Publishing Engine Acceptance — 2026-07-29"
summary: "Local acceptance evidence for the product-owned guard and publishing harness."
---

# Deterministic Publishing Engine Acceptance — 2026-07-29

## Result

The authoritative product specification is implemented as a maintainable,
product-owned guard and harness. Local acceptance passed. Live provider and
schedule cutover was intentionally not performed.

The 30 July specification-conformance review closed the remaining product
identity gaps without changing the live runtime.

## Implemented Surface

- complete 18-family versioned registry;
- registry schema and cross-reference validation;
- Reddit prohibition in policy, campaign, template and plan boundaries;
- generic future-platform connector identities;
- deterministic eligibility, scoring and seeded replay;
- self-identification enforced as the primary campaign model when an eligible
  candidate exists;
- fail-closed campaign-to-strategy compatibility;
- immutable hashed content specifications;
- immutable `strategyId` binding;
- Tax Lien Platform self-identification audience, signal and campaign;
- sequential seven-day portfolio replay;
- deterministic template rendering and constrained-language prompt contract;
- layered validation for claims, evidence, lifecycle, copy, duplication,
  quota, cooldown and official API/readback;
- SQLite WAL/FULL transactional state;
- global atomic opportunity reservations;
- common publication and reconciliation states;
- one approved connector identity per platform/account;
- official-worker adapter registry and nested provider-ID extraction;
- provider readback before verification;
- no blind retry;
- rendered-output hashing;
- metrics with honest unavailable semantics;
- durable conversation and evidence-threshold attribution records;
- 42-second proof asset fingerprint and perceptual-lineage classification;
- append-only hash-chained audit ledger;
- non-writing CLI diagnostics;
- protected API overview, slot, publication, audit and planning routes;
- no API provider-write route.

## Deterministic Diagnostic

Command:

```bash
npm run publishing:harness -- diagnose \
  --registry ../config/publishing/registry.v1.json
```

Result:

- passed: `true`
- registry version: `2026-07-30.1`
- registry SHA-256:
  `7ae0ff2850e7e2005e1b5aaf339505e8156fc507193be02e2a8b793cc6a1c609`
- slots: `05:00`, `07:00`, `11:00`, `15:00`, `17:00`
- each slot reserved once in an isolated in-memory database;
- every replay selected the same candidate and content hash;
- every audit chain passed;
- prohibited references: none;
- external writes: zero;
- LLM calls: zero.

## Sequential Portfolio Replay

Command:

```bash
npm run publishing:harness -- portfolio-replay \
  --registry ../config/publishing/registry.v1.json \
  --date 2026-07-30 \
  --days 7
```

Result:

- passed: `true`;
- opportunities: `35`;
- terminal outcomes: `35`;
- verified simulated outcomes: `33`;
- policy-correct no-candidate skips: `2`;
- primary self-identification enforced on `7/7` days;
- all seven active products represented;
- Tax Lien self-identification verified in the simulated provider path;
- campaign/strategy integrity: `true`;
- deterministic replay: `true`;
- audit chain: `true`;
- external writes: `0`;
- LLM calls: `0`.

## Test Evidence

Focused publishing acceptance:

```text
Test Files  1 passed (1)
Tests      35 passed (35)
```

Coverage includes:

- all registry families;
- exact five-slot contract;
- Reddit absence and fail-closed rejection;
- unlisted future-platform extensibility;
- broken-reference rejection;
- approval-state and five-slot drift rejection;
- missing-primary-campaign rejection;
- campaign/strategy mismatch rejection;
- Tax Lien self-identification contract;
- London slot identity;
- policy skip;
- deterministic replay;
- sequential week portfolio rotation;
- immutable strategy binding and tamper rejection;
- duplicate-trigger reservation barrier;
- database content immutability;
- retirement of stale registry rows;
- full-copy rendering without truncation;
- connector identity enforcement;
- approved connector coverage and nested provider-ID extraction;
- provider readback verification;
- lost-response no-retry;
- readback failure reconciliation;
- confirmed absence;
- unavailable metric null semantics;
- attribution evidence threshold;
- audit-chain tamper detection;
- proof-asset exact and perceptual classification; and
- OpenAPI route/RBAC contract.

TypeScript:

```text
npx tsc --noEmit --pretty false
exit 0
```

Repository validation:

- orchestrator and operator UI builds: passed;
- documentation drift check: passed;
- Markdown link check: passed (`89` files);
- unit integration fixtures: `86` passed;
- live-process middleware integration: `33` passed, including the publishing
  overview/planning contract and proof that no raw publish route exists;
- operator UI: `33` passed;
- orchestrator and operator UI TypeScript checks: passed;
- documentation coverage sync: passed;
- `git diff --check`: passed.

## Definition-Of-Done Reconciliation

| Acceptance item | Result |
|---|---|
| Product-owned registries | Passed |
| Deterministic selection | Passed |
| Immutable content contract | Passed |
| Constrained language boundary | Passed |
| Evidence-backed claims | Passed |
| Atomic reservation | Passed |
| Provider-readback requirement | Passed by contract and mock adapter |
| No blind retry | Passed |
| Complete auditability | Passed |
| Metrics unavailable ≠ zero | Passed |
| Evidence-based attribution | Passed |
| Proof-master lineage | Passed |
| Reddit excluded | Passed |
| Future platforms extensible | Passed |
| Operator guard/harness | Passed |
| Live Threads/Instagram adapter cutover | Pending separately approved migration |
| Live five-slot schedule cutover | Pending separately approved schedule change |
| Service restart/deployment | Not performed |

## Honest Production Status

The project now contains a production-ready control product, schemas and
verification harness. It is not yet the running host publication authority.
Current provider workers remain live truth until the documented migration,
schedule reconciliation, non-writing runtime diagnostics and explicit
operational approval are completed.
