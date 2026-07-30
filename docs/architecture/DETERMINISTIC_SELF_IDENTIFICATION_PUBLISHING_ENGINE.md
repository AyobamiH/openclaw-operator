---
title: "Deterministic Self-Identification Publishing Engine"
summary: "Canonical product architecture for evidence-backed, drift-resistant commercial publishing."
---

# Deterministic Self-Identification Publishing Engine

This is the canonical product architecture implemented from the 29 July 2026
knowledge-base specification. The product lives entirely in
`projects/openclaw-operator`; host-specific schedulers and provider workers
remain adapters owned by local operations.

## Purpose

The engine chooses which approved product and evidence-backed problem should be
communicated at an approved opportunity. It does not guarantee that every
opportunity publishes. A slot produces exactly one auditable result:

- verified;
- confirmed absent;
- skipped by policy;
- skipped because no candidate is eligible;
- failed closed; or
- reconciliation required.

The product is a guard and harness, not a social-post generator. Its invariants
are enforced in code and durable state:

1. deterministic commercial selection;
2. immutable content specifications;
3. constrained language rendering only;
4. evidence before claims;
5. official APIs only;
6. provider readback before success;
7. no blind retry after an ambiguous write;
8. unavailable metrics remain unavailable, never zero;
9. evidence-backed attribution only; and
10. append-only, hash-chained auditability.

## Canonical Components

| Component | Path | Responsibility |
|---|---|---|
| Versioned registry | `config/publishing/registry.v1.json` | Product, campaign, evidence, policy and measurement truth |
| Registry validator | `orchestrator/src/publishing/registry.ts` | Schema, lifecycle, cross-reference and prohibited-platform enforcement |
| Selector | `orchestrator/src/publishing/selection.ts` | Deterministic eligibility, score components and seeded tie-break |
| Content contract | `orchestrator/src/publishing/content.ts` | Immutable structured specification and layered validation |
| State authority | `orchestrator/src/publishing/store.ts` | SQLite transactions, uniqueness barriers, state, evidence and audit chain |
| Execution guard | `orchestrator/src/publishing/engine.ts` | Reservation, connector authority, write ambiguity and provider verification |
| Provider contract | `orchestrator/src/publishing/types.ts` | Readiness, publish, readback, reconciliation and metrics adapter interface |
| Worker adapter registry | `orchestrator/src/publishing/connectors.ts` | Official-worker transport, nested provider-ID extraction and active-policy coverage |
| Proof lineage | `orchestrator/src/publishing/proof.ts` | Exact, recompressed, derivative and unknown asset relationships |
| Operator routes | `orchestrator/src/publishing/routes.ts` | Authenticated planning and evidence reads; no provider-write endpoint |
| Product harness | `orchestrator/src/publishing/cli.ts` | Registry validation, initialization, planning, overview and non-writing diagnostics |

## Registry Contract

The registry contains all 18 required families:

1. products;
2. campaigns;
3. audiences;
4. identity signals;
5. problems/outcomes;
6. content strategies;
7. claims;
8. evidence;
9. assets;
10. calls to action;
11. platform policies;
12. schedules;
13. templates;
14. prompts;
15. experiments;
16. approvals;
17. metric definitions; and
18. attribution definitions.

Every record is versioned and lifecycle-controlled. References are resolved
before the registry can seed durable state. A missing reference, stale approval,
unsupported platform contract or prohibited platform fails closed.

The active schedule declares `self-identification` as the primary campaign
model. At least one active campaign of that type must exist. Campaign strategy
references are also semantic contracts: the strategy must be active and must
explicitly allow the campaign type.

## Opportunity Contract

The product registry defines five opportunities in `Europe/London`:

`05:00`, `07:00`, `11:00`, `15:00`, `17:00`.

These are global selection opportunities, not platform-specific publication
promises. The SQLite `slot_key` is globally unique, so racing triggers cannot
reserve multiple candidates for the same opportunity.

Self-identification is primary, not exclusive. Until a verified
self-identification publication exists for the local day, the selector chooses
an eligible self-identification candidate whenever one is available. If none
is eligible at a particular opportunity, another approved family may proceed;
the next opportunity re-evaluates the primary requirement. Slots can still end
in an auditable skip when cooldowns or quotas leave no candidate.

The existing host schedules do not yet match this product contract. They are
not silently replaced by this implementation. Cutover requires an explicit
host migration, reconciliation of existing outboxes and an approved service
restart.

## Selection

Eligibility is enforced before scoring:

- product and campaign lifecycle;
- current approval;
- evidence presence and currency;
- campaign/platform compatibility;
- campaign/strategy compatibility;
- platform and product quotas;
- campaign and product cooldowns;
- approved experiment windows; and
- exact-content duplicate exclusion.

Scores are built from named components and bounded experiment adjustments.
Ties use a seed derived from registry version and slot identity. The same
registry, history and slot replay to the same candidate and immutable content
hash.

The immutable specification includes both `campaignType` and `strategyId`.
Changing the strategy therefore changes the content hash and requires a new
approved specification.

## Language Boundary

Commercial decisions cannot be delegated to an LLM. The current canonical
implementation renders deterministic templates. The registry contains a
constrained-language prompt contract for a future renderer, but such a renderer
may only fill allowed fields inside a preselected content specification.

Any LLM output must still pass the same schema, evidence, claim, platform,
completeness, duplicate, quota and readiness validation. Template fallback is
mandatory. The renderer may not select products, change evidence, invent
claims, mutate scores, choose platforms or authorize publication.

## State And Exactly-Once Control

Publication state is:

`planned → generated → validated → reserved → publishing → published_unverified → verified`

with bounded branches to:

- `confirmed_absent`;
- `reconciliation_required`;
- `failed_closed`; or
- `superseded`.

SQLite owns slot, content, reservation and idempotency uniqueness. Immutable
content rows have database update and delete triggers. A provider response that
is missing, ambiguous or lost moves to reconciliation. Reconciliation uses
provider readback or duplicate discovery and never calls publish again.

## Provider Adapter Boundary

An active platform policy names the only approved `connectorId`. The runtime
adapter must implement:

- readiness;
- one idempotent publish attempt;
- canonical provider object readback;
- possible-duplicate discovery;
- metrics readback; and
- optional deletion only outside this product contract and behind separate
  approval.

The product API deliberately does not expose a provider-write route. Host
workers retain raw connector access. This prevents an operator or conversational
surface from bypassing the deterministic state machine.

The production integration is a separate campaign lane declared in
`config/publishing/production-integration.v1.json`. It owns only the five
product opportunities, its product SQLite state, reservations, outcomes and
audit chain. It does not own any existing Threads or Instagram campaign.

`OpenClawOfficialApiWorkerClient` binds the registry connector IDs to the
existing `social-publication-worker` and invokes the official connector tool;
it does not add an HTTP provider-write route. Every live provider mutation,
legacy or product, must pass through the connector's SQLite-backed shared
account admission. That connector owns account quota, spacing, collision,
cross-lane duplicate and unresolved-write admission. Provider adapters remain
the transport owner, and official provider readback remains publication truth.
The product adapter owns metric collection for its own publications. Threads
metrics come from the connector's official `post_insights` surface: provider
`views` maps to the impressions definition and engagement rate is calculated
from the complete provider engagement counters. Instagram has no equivalent
surface in the current connector, so both provider metrics are recorded as
null `unavailable`, never as zero.

Shadow mode exercises the runner, allocation, product state, connector execute
contract, historical publication view and shared admission while forcing
`dryRun=true`, `explicitWriteApproval=false` and a terminal
`shadow_verified` product outcome. Canary and live modes fail closed unless the
approved integration manifest is changed separately and provider-write
authority is explicit.

## Platform Expansion

Platform IDs are data-driven slugs, not a closed TypeScript enum. Adding a
platform therefore requires no core-engine fork. Activation still requires:

1. a versioned active platform policy;
2. an approved official-API connector identity;
3. platform contract limits;
4. provider readback and duplicate-reconciliation support;
5. tests and non-writing diagnostics; and
6. an explicit activation approval.

Reddit is prohibited in code and rejected in policies, campaigns and templates.

Ferryman currently documents support for X, Bluesky, Threads, Instagram,
Mastodon, LinkedIn, Facebook and Substack, while its product page also presents
YouTube Shorts and TikTok. These are future discovery candidates, not active
platforms in this registry. Ferryman itself is not silently trusted as the
provider adapter: using it would require a separate approved connector,
security review and proof that provider readback meets this product contract.

Sources:

- <https://ferryman.io/help>
- <https://ferryman.io/>

## Proof Asset Lineage

The 42-second OpenClaw proof master is registered as the canonical asset with
SHA-256:

`6b6746fdfe5ea59369b7c40186d8f164e3d4c566d16388005d98a65ed6fa231f`

Exact equality requires SHA-256 equality. Perceptual similarity can classify a
recompression or derivative but cannot be reported as byte identity. Unknown
evidence remains unknown.

## Metrics And Attribution

Metrics are registry-defined. Provider failures create null `unavailable`
records; they do not create a value of zero. Unknown metric IDs are rejected
into the audit ledger.

Attribution is a durable evidence edge, not a revenue claim. Each definition
controls endpoint types, allowed confidence and minimum evidence count. The
current publication-to-conversation definition requires at least two evidence
records.

## Operational Harness

From `orchestrator/`:

```bash
npm run publishing:harness -- validate-registry \
  --registry ../config/publishing/registry.v1.json

npm run publishing:harness -- diagnose \
  --registry ../config/publishing/registry.v1.json

npm run publishing:harness -- portfolio-replay \
  --registry ../config/publishing/registry.v1.json \
  --date 2026-07-30 \
  --days 7
```

The diagnostic command uses in-memory databases, replays all five opportunities
twice and verifies deterministic candidate/content hashes, atomic reservation
and audit-chain integrity. It performs zero provider writes and zero LLM calls.

The portfolio replay uses one in-memory state store across a sequential week
and a simulated official-provider contract. It proves primary
self-identification, campaign/strategy integrity, Tax Lien
self-identification, product rotation, terminal opportunity outcomes, stable
replay and audit-chain integrity. Simulated provider calls never leave the
process; external writes and LLM calls remain zero.

The authenticated API surface is:

- `GET /api/publishing/overview`
- `GET /api/publishing/slots`
- `GET /api/publishing/publications`
- `GET /api/publishing/audit`
- `POST /api/publishing/slots/plan`

Planning is a local transactional mutation. None of these routes can publish.

## Cutover Boundary

This code is production-ready as a product-owned planning and governance
harness. It is not claimed as the active host publication authority until a
separate migration:

1. maps live Threads and Instagram outbox identities into this schema;
2. binds host workers to the connector contract;
3. reconciles current platform schedules with the five global opportunities;
4. reheases rollback and protected-state migration;
5. runs non-writing live-runtime diagnostics; and
6. receives explicit approval for migration, service restart and schedule
   changes.

Until then, the existing verified workers remain live truth and this product
remains the validated future authority.
