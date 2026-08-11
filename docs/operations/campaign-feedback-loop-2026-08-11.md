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
publication evidence and reconciliation without fabricated business outcomes.
The complete protected gate must pass on the owned Crabbox SSH host before the
isolated change is committed and pushed.

Loading the changed orchestrator process is a separate service-lifecycle
boundary. Until that exact action is approved and completed, the deployed
runtime remains on the prior feedback behavior even if source validation is
green.
