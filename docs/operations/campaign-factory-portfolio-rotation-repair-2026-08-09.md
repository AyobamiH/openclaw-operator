---
title: "Campaign Factory Portfolio Rotation Repair"
summary: "Root-cause, contract, deterministic replay, deployment and runtime evidence for eliminating Campaign Factory shadow-selection starvation."
status: "source-verified-runtime-pending"
date: "2026-08-09"
---

# Campaign Factory Portfolio Rotation Repair

## Safety and authority

This repair is limited to Campaign Factory selection history, deterministic
preplanning, tests, source control, and one approved orchestrator runtime load.
It does not activate experiments, change schedules, grant capabilities, create
provider writes, or convert shadow evidence into provider-publication evidence.

## Result chain

`ROOT_CAUSE_PROVED -> ROTATION_CONTRACT_DEFINED -> IMPLEMENTED -> TESTED -> PORTFOLIO_REPLAY_PROVED -> PUSHED -> RUNTIME_LOADED -> RUNTIME_VERIFIED`

The first five stages pass. Push and runtime stages are pending the protected
repository gate and the separately evidenced approved lifecycle action.

## ROOT_CAUSE_PROVED — pass

Source had two mutually reinforcing resets:

1. `planCampaignFactoryContentForDate` constructed a fresh `:memory:` store for
   each opportunity, so every preplanned slot saw an empty selector history.
2. `DeterministicPublishingEngine` derived caps, cooldowns, recency,
   distribution and the daily `primaryCampaignType` floor only from
   `state='verified'`. Campaign Factory runs are intentionally zero-write and
   finish `shadow_verified` or downstream-policy `superseded`, so none of their
   valid decisions influenced the next shadow selection.

Canonical runtime state independently matched the source defect:

- 13 campaigns are registered active;
- 31 content specifications exist;
- all 31 belong to `campaign-founder-rescue-identification`;
- 21 are `shadow_verified`, 10 are `superseded`, and zero are provider
  `verified`.

A pre-repair 30-day/150-slot in-memory shadow replay selected Founder Rescue in
all 150 slots. A pre-repair five-opportunity preplan also selected it five
times. Provider writes were zero throughout.

## ROTATION_CONTRACT_DEFINED — pass

Selection now has two explicit histories:

- `provider_verified`: the existing live/canary contract. Only independently
  verified provider publications count.
- `shadow_portfolio`: a selection-governance projection over terminal
  `verified`, `shadow_verified`, and downstream-policy `superseded` decisions.

The shadow contract is deliberately narrow:

- `reserved`, `publishing`, `failed_closed`, and `reconciliation_required` do
  not consume rotation;
- shadow portfolio decisions affect only candidate caps, cooldowns, recency,
  distribution and the primary daily floor;
- they never increment provider-publication evidence or claim an external
  business effect;
- `primaryCampaignType=self-identification` remains a once-per-day floor when
  an eligible primary candidate exists, not a permanent pool restriction;
- registry priority, product/campaign daily caps, product/campaign cooldowns,
  platform eligibility, evidence validity, format compatibility and inactive
  campaign exclusion remain authoritative.

## IMPLEMENTED — pass

The smallest shared-state seam was changed:

- `PublishingStore` exposes separate shadow-portfolio counts, cooldown clocks
  and product-share history without a schema migration;
- production shadow runs request `shadow_portfolio`; canary/live retain
  `provider_verified`;
- preplanning uses one deterministic planning store across opportunities and
  can merge a read-only canonical history store;
- production Campaign Factory preplanning supplies its canonical database path;
- the render/audit phase consumes the same planned content, preventing a
  selector/artifact mismatch;
- the standalone render CLI accepts an optional read-only `--database` history
  path.

No registry priority, campaign status, schedule, Graph definition, approval,
experiment, provider adapter or external-effect authority was changed.

## TESTED — pass

- Focused publishing/factory/media suite: `43/43` passed.
- Broader publishing, factory, Graph scheduler/adapter/receipt suite: `130/130`
  passed.
- Production integration, dependency and campaign operations suite: `14/14`
  passed.
- Orchestrator TypeScript: passed.
- Protected repository gate (`npm run verify:main`): passed, including the
  orchestrator fixture/integration suite, operator UI `34/34`, both
  TypeScript projects, documentation curation, and the production docs build.

One initial focused command was invoked from the repository root, where legacy
relative-path fixtures could not resolve; its failures are not counted. The
same named suites were rerun from the orchestrator package root and passed.

## PORTFOLIO_REPLAY_PROVED — pass

A deterministic 60-day/300-slot zero-write replay produced:

- active/eligible campaigns: 13;
- distinct campaigns selected: 13;
- every eligible campaign reached selection: yes;
- daily primary-floor violations: 0;
- campaign daily-cap violations: 0;
- product daily-cap violations: 0;
- campaign cooldown violations: 0;
- product cooldown violations: 0;
- provider-verified publications: 0;
- external writes: 0;
- publishing audit chain: valid.

First selection of every campaign occurred by day five of the replay. A
negative-control replay paused
`campaign-openclaw-community-discussion`; it was never selected, while every
remaining eligible campaign still reached selection.

The repaired read-only projection over current canonical history selects
`campaign-tax-lien-self-identification` for the next 05:00 opportunity rather
than repeating Founder Rescue. This is a projection only; it creates no slot,
reservation, artifact, Graph run or provider effect.

## PUSHED — pending

Pending protected gate, exact commit and non-force push evidence.

## RUNTIME_LOADED — pending

Pending one approved orchestrator restart and PID/source proof.

## RUNTIME_VERIFIED — pending

Pending post-restart health, loaded source, Graph portfolio, schedule binding,
read-only canonical projection, and zero-write safety evidence.
