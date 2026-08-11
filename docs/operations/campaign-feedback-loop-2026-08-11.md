---
title: "Campaign Measurement And Attribution Feedback Loop"
summary: "Evidence audit, deterministic ingestion contract, ownership and runtime activation boundary."
---

# Campaign Measurement And Attribution Feedback Loop

## Pre-change evidence audit

The canonical deterministic publishing database passed `PRAGMA quick_check`
but contained zero rows in `publishing_metrics`, `publishing_conversations`,
`publishing_attribution_edges`, and `publishing_reconciliation_attempts`. Its
35 product publications were shadow evidence only and had no provider object
IDs. Existing campaign reports therefore did not carry a real publication to
provider-measurement chain.

The Graph run database separately contained real verified external effects.
Each row binds a campaign, candidate, provider/account, provider object, Graph
run/effect and schedule slot. The official connector proved exact readback for
both Threads and Instagram examples. A verified Threads object returned ten
views and zero likes/replies/reposts/quotes/shares; exact reply reads for that
Threads object and a verified Instagram Reel returned no conversations. This
is engagement evidence, not a business conversion.

The official connector has no current Instagram post-insights surface. No
website or CRM conversion connector is bound to campaign evidence. Instagram
metrics and all conversion/revenue outcomes therefore remain unproven.

## Authority and execution contract

`campaign-factory-full-pregraph-v4` remains the only recurring owner. Its
existing Campaign Factory child invokes the feedback cycle before the shadow
selection cycle; no new cron, interval, schedule or provider-write authority is
introduced. Reads use the official connector with `relayAvailable=false`.

The feedback ledger uses these identities:

| Evidence | Deterministic identity |
|---|---|
| Publication | platform + account + provider object |
| Metric observation | publication + metric definition + availability + value |
| Conversation | platform + account + provider conversation object |
| Attribution | definition + publication + conversation |
| Reconciliation | publication + current evidence fingerprint |
| Poll | owner + scheduled slot |

Graph evidence is imported append-only. Repeated provider counts deduplicate;
corrected values append. Conversation observations append when their content
changes. Historical Graph, publication, metric and reconciliation records are
not rewritten or deleted.

## Scheduler completion-truth repair

The 11:00 natural slot reproduced a split-brain receipt without a split-brain
transaction. Scheduler trigger `gst_8161ea6f854cb2ca1aa26d79205d6800`
reserved at `10:06:03.364Z`; its synchronous `POST /api/graphs/runs` created
Graph run `grzwcanary_5506eec0-db33-4ace-955e-cded51ba592b` at
`10:06:03.406Z`. The HTTP client reached its 300-second headers timeout and
sealed the scheduler trigger `failed_safe` at `10:11:04.121Z`, while the
durable Graph run continued and completed with valid child/verifier chains at
`10:14:54.276Z`. Total Graph duration was 8 minutes 50.870 seconds.

The repaired contract separates acceptance from settlement:

1. `POST /api/graphs/runs/accepted` persists the root run and returns its
   correlation-bound `runId` with HTTP 202 before background execution;
2. the scheduler persists that `runId` before observing terminal state;
3. a bounded observation timeout leaves the trigger `executing` and reports
   `accepted_pending`, never `failed_safe`;
4. duplicate delivery observes and terminally reconciles the same `runId`
   without creating another Graph run or measurement transaction;
5. completed/failed runs with an invalid receipt chain remain terminal and
   fail closed; an unobservable accepted run remains `ambiguous`, not replayable.

## Canonical campaign identity reconstruction

The immutable source evidence does not support a one-to-one alias for any of
the eight historical values. The reviewed bridge therefore records all eight
as `unmapped`; zero mappings were invented.

| Historical value | Proven source identity | Reviewed disposition |
|---|---|---|
| `68b10c5c-f604-4567-9213-d0d1eab08106` | Threads text scheduler/outbox ID | `unmapped` |
| `083e3560-40fd-4487-9d78-674f64866ef7` | Threads image scheduler/outbox ID | `unmapped` |
| `qualified-enquiries` | legacy strategic-objective rotation category spanning five products and five audiences | `unmapped` |
| `pet-care-category` | legacy strategic-pillar rotation category spanning five products and five audiences | `unmapped` |
| `productised-engineering` | legacy strategic-pillar rotation category spanning three products and three audiences | `unmapped` |
| `governed-automation` | legacy capability rotation category spanning six products and six audiences | `unmapped` |
| `market-authority` | legacy strategic-pillar rotation category spanning six products and six audiences | `unmapped` |
| `operational-excellence` | legacy strategic-pillar rotation category spanning four products and four audiences | `unmapped` |

`publishing_campaign_identity_bridge` is append-only and protected against
update/delete. Each reviewed record carries source references, reviewer,
review time and a deterministic provenance hash. Feedback publications retain
their original `campaign_id` permanently. Reports resolve only direct current
registry IDs or exact reviewed aliases; all others appear as
`UNMAPPED:<historical-id>`. Future Graph publications carrying one of the 13
canonical registry IDs are accepted directly without an alias.

Instagram post insights and CRM/website conversion evidence remain
`EVIDENCE_UNAVAILABLE`. Those connector gaps are not implementation failures
and are never converted to zero or inferred attribution.

## Meaning of states

- `observed`: evidence exists but is not yet provider-verified.
- `verified`: the exact provider publication or metric value is verified.
- `unattributed`: a verified publication has no exact conversation link.
- `attributed`: an exact provider conversation is linked to its publication.
- `ambiguous`: publication or connector evidence is insufficient or failed.
- `reconciled`: the current exact publication/conversation evidence agrees.

An attributed provider conversation is scoped to `provider-engagement` and
retains `business_outcome_status=unproven`. Engagement does not prove an
enquiry, qualified lead, sale or revenue.

## Reporting contract

Daily and weekly report schema v2 separates, per campaign:

1. content produced;
2. provider-verified publications;
3. provider metric observations;
4. conversations observed;
5. exact attribution edges;
6. attributed business outcomes; and
7. unattributed or unknown outcomes.

Unavailable values remain null/unavailable. A missing connector is reported as
an evidence gap. Reporting does not mutate campaigns, provider state,
experiments, schedules or selection weights.

## Verification and activation boundary

Focused tests cover duplicate reads, corrected counts, late replies, ambiguous
publication evidence, timeout-after-acceptance, terminal reconciliation,
duplicate scheduler delivery, immutable historical aliases, unmapped
identities, direct future canonical identities and reconciliation without
fabricated business outcomes.
The complete protected gate passed on the owned Crabbox SSH host as
`run_eeaacd8d757a` with exit `0`: 97 unit simulations, 35 live middleware
integrations, 34 operator-console tests, both TypeScript checks, both builds,
documentation drift/link checks and the VitePress production build were green.

Loading the changed orchestrator process remains a separate service-lifecycle
stage. The mission authorizes at most the single minimum orchestrator lifecycle
action needed after the isolated commit is pushed; natural verification still
must wait for a later scheduled polling opportunity.

## Pre-Graph viewer rate-limit reconstruction

The 15:00 Europe/London opportunity exposed a separate failure before Campaign
Feedback Graph admission. The governed scheduler client uses the local
orchestrator API at `127.0.0.1:3312`; its initial request is
`GET /api/graphs/health`, and accepted-run observation uses
`GET /api/graphs/runs/:runId`. Both protected reads share the internal
`viewer-read` limiter: 120 requests per 60 seconds for the authenticated
`admin-key` actor. This was not a Meta/provider quota.

The immediately preceding Instagram Reel scheduler execution consumed the
bucket with one health read and 119 run-detail reads for
`grzwcanary_916edf43-3dea-4907-aaef-03da93133263`. Two run-detail reads and two
health reads then received HTTP 429. The Campaign Feedback owner therefore
failed on its initial health read before Graph accepted a measurement run.
Five observed natural windows showed the same deterministic shape: 119
run-detail reads plus one health read within the minute, followed by 429s.

The source cause was 250 ms approval polling and one-second completion polling,
plus a duplicate first approval read. The repair preserves fresh fail-closed
state reads while changing the base interval to ten seconds with deterministic
jitter, reusing the accepted run detail, and waiting on `Retry-After` (then
`ratelimit-reset`, then response-body evidence) before retrying an idempotent
read. POST requests are never automatically retried. Observation windows remain
ten minutes for approval and thirty minutes for completion; no cache, schedule,
Graph authority or provider authority was added.

This defect is independent of the scheduler completion contract. The earlier
repair governs durable acceptance, execution identity and terminal settlement
after Graph admission. This repair prevents a local shared read bucket from
blocking that admission in the first place.
