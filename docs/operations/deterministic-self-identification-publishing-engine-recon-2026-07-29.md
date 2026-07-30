---
title: "Deterministic Publishing Engine Recon — 2026-07-29"
summary: "Evidence-first reconciliation of the product specification with current source and runtime."
---

# Deterministic Publishing Engine Recon — 2026-07-29

## Scope

The complete 5,012-word knowledge-base attachment was treated as the
authoritative target specification. Reconnaissance was read-only. No live
provider write, schedule change, service restart, migration, dependency change,
commit, push or deployment was performed.

## Canonical Ownership

- Portable product source:
  `projects/openclaw-operator/`
- Host/local operations:
  workspace-root schedules, connectors, evidence and live outbox workers
- Existing live provider workers:
  - `scripts/threads-outbox-runner.mjs`
  - `scripts/instagram-publisher-outbox-runner.mjs`

The root installed-runtime copies are not parallel canonical product source and
were not modified for this implementation.

## Observed Runtime

The live scheduler was enabled with eight jobs. Relevant verified jobs were:

| Platform/lane | Job | Observed schedule | Status |
|---|---|---|---|
| Threads text | `68b10…` | `05:00`, `07:00` | enabled |
| Threads image | `083e3560-40fd-4487-9d78-674f64866ef7` | `11:30`, `16:30`, `21:30` | enabled |
| Instagram image | `24af…` | `05:00`, `07:00`, `09:00`, `11:00`, `13:00` | enabled |
| Instagram Reel | `2c707…` | `15:00`, `17:00`, `19:00`, `21:00`, `23:00` | enabled |

These platform schedules are not equivalent to the specification’s five global
commercial opportunities at `05:00`, `07:00`, `11:00`, `15:00`, `17:00`.

The current host workers already provide useful foundations:

- SQLite-backed reservations and state;
- official Meta API publication;
- provider readback;
- reconciliation rather than blind retry;
- durable receipts; and
- separately verified Threads/Instagram renderer hardening.

They did not provide one product-owned commercial registry, global opportunity
selection, immutable cross-platform content specifications, complete
attribution definitions or a common operator guard.

## Gap Matrix

| Specification capability | Before | Reconciled product implementation | Activation impact |
|---|---|---|---|
| 18 registries | Fragmented across runtime/docs | Versioned canonical registry + cross-reference validation | Local product complete |
| Five global opportunities | Not present | Exact Europe/London opportunity contract | Host schedule cutover pending |
| Deterministic commercial scoring | Partial campaign sequencing | Explainable score + seeded tie-break + bounded experiment adjustment | Local product complete |
| Immutable content specification | Lane-specific payloads | Full structured hash + DB immutability triggers | Local product complete |
| LLM constraint | Lane-specific | Template canonical; constrained prompt contract only | Local product complete |
| Global atomic reservation | Per-worker identities | One globally unique slot and idempotency authority | Host migration pending |
| Common publication states | Similar but lane-specific | Canonical state machine and validated transitions | Adapter cutover pending |
| Provider verification | Already implemented in live workers | Required connector readback before verified | Adapter cutover pending |
| Ambiguous-write handling | Already present in live workers | Common reconciliation contract; no publish retry | Local product complete |
| Metrics unavailable semantics | Inconsistent/partial | Null unavailable records; unknown metrics rejected | Local product complete |
| Conversation/attribution | Partial evidence ledgers | Durable conversations and evidence-threshold attribution | Local product complete |
| Proof master lineage | Evidence existed | Canonical SHA and relationship classifier | Local product complete |
| Drift guard | No single product harness | CLI + authenticated API + audit chain | Local product complete |
| Future platforms | Hard-coded lanes | Generic platform/connector identity contract | Per-platform activation needed |
| Reddit | Existing unrelated task/service surfaces | Explicitly prohibited from publishing engine | Product complete |

## Ambiguities And Decisions

### Global opportunities versus current schedules

The specification is explicit; runtime differs. Replacing live schedules during
source implementation would be a migration and service-level change. The
safest deterministic decision was to implement the five-slot authority in the
product while preserving live runtime unchanged. Cutover impact is documented,
not hidden.

### Future Ferryman platforms

The user wants more future platforms than those named in the attachment.
Ferryman’s official help currently names X, Bluesky, Threads, Instagram,
Mastodon, LinkedIn, Facebook and Substack. Its homepage also presents YouTube
Shorts and TikTok.

Decision:

- make platform IDs extensible data;
- keep only currently evidenced Threads and Instagram policies active;
- reject Reddit everywhere;
- require an approved official/API-capable connector and provider-readback
  contract before adding any future active policy;
- do not make Ferryman an implicit trusted adapter.

Trade-off: activation takes deliberate registry and connector work, but core
code does not need a new platform branch and unsupported platforms cannot drift
into production.

### Constrained LLM

The specification permits an LLM only as a constrained renderer. No approved
model/runtime contract was provided for this engine. The canonical
implementation therefore uses templates and records a future prompt contract
with mandatory template fallback. This preserves the product boundary without
inventing a model dependency.

### Provider adapters

The live Meta workers are host-owned and mature. Copying them into the product
would create a second raw-write path. The implementation defines the common
adapter contract but does not duplicate or redirect live workers without a
separate migration.

## Current Classification

- Product implementation: complete locally
- Guard/harness: complete locally
- Threads/Instagram live adapter cutover: not performed
- Five-slot production schedule cutover: not performed
- Provider writes during implementation: zero
- LLM calls during implementation: zero
- Browser/Relay calls during implementation: zero

## Required Activation Work

1. Write host adapters that bind the current two worker entrypoints to the
   product connector contract without creating alternate writes.
2. Produce a live-state migration mapping for existing outbox and provider IDs.
3. Reconcile the existing multiple platform schedules with five global
   opportunities.
4. Rehearse migration and rollback against copies of protected state.
5. Run three non-writing diagnostics per worker path.
6. Obtain explicit approval for migration, configuration/schedule changes and
   service restart.

No item above is authorized merely by the local product implementation.
