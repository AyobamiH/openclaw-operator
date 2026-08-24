---
title: "Instagram Ambiguous Effect Reconciliation and Natural-Slot Proof"
summary: "Evidence-bound reconciliation of the 8 August upload-only Instagram Graph effect and observation of the next natural slot."
status: "complete"
date: "2026-08-09"
---

# Instagram Ambiguous Effect Reconciliation and Natural-Slot Proof

## Scope and safety boundary

John approved reconciliation of exactly one historical Instagram Graph effect
and observation of the next natural Instagram slot. The operation did not
authorize a replay, forced run, new provider write, schedule change, service
restart, permission expansion, or mutation of unrelated state. Official Meta
API reads were used with Browser Relay unavailable.

## Result chain

`EFFECT_IDENTIFIED -> ABSENCE_PROVEN -> RECONCILED -> GUARD_CLEARED -> RUNTIME_HEALTHY -> NATURAL_SLOT_OBSERVED`

All six stages pass. The next natural 17:00 Europe/London Instagram Reel slot
ran without being forced and was no longer blocked by the historical effect.

## EFFECT_IDENTIFIED — pass

- Graph run: `grzwcanary_2e731574-cfef-4795-8a5b-014d2e95b0e9`.
- Graph: `deterministic-social-publication@2.0.0`.
- Definition hash: `995ff8355a57113884129b7cda9f7966d4719163f9b9b81ed77e87d12c6a3473`.
- Effect: `gex_2ae1e769-4d7b-416e-8b53-c1cbd1cb8142`.
- Target: `instagram:17841453638630920`.
- Logical slot: `instagram:2026-08-08:15:00:2c7071ff-35dd-40d0-bf77-b1ed53de256e`.
- Outbox: `instagram:reel:2026-08-08:15:00:2c7071ff-35dd-40d0-bf77-b1ed53de256e`.
- Pre-state: `ambiguous`, no provider operation ID.

The canonical `publish_provider_object` node output records:

- `generatedMediaUploadCalls=1`;
- `instagramPublishCalls=0`;
- `browserRelayCalls=0`;
- `providerResultId=null`;
- `permalink=null`;
- worker status `blocked`.

This is an upload/container-preparation outcome, not a publication call.

## ABSENCE_PROVEN — pass

Loaded source commit `a410276` classifies the exact production-shaped object
as `confirmed_absent`:

```json
{
  "status": "blocked",
  "providerResultId": null,
  "permalink": null,
  "generatedMediaUploadCalls": 1,
  "instagramPublishCalls": 0,
  "browserRelayCalls": 0
}
```

The pure classifier returned `confirmed_absent`. Focused regression
`distinguishes a preparatory Instagram media upload from the publication
effect` passed (`1/1`). A contradictory provider ID with zero publish calls
remains `ambiguous`; a verified ID, permalink and one publish call remains
`effect_verified`.

Independent official API evidence:

- connector `0.10.3` was healthy and authenticated;
- represented account was exactly `17841453638630920`
  (`@tailwaggingwebdesigns`);
- official owned-media readback contained no matching caption/Reel;
- the latest owned object remained the 8 August 12:05:56 UTC image;
- the prior owned Reel remained the 6 August 22:05:43 UTC Reel;
- no provider publication ID or permalink contradicted absence;
- Browser Relay calls were zero.

## RECONCILED — pass

At `2026-08-09T15:34:41.983Z`, the authenticated canonical endpoint
`POST /api/graphs/runs/:runId/effects/reconcile` returned HTTP 200 for exactly
this run and effect with observation `confirmed_absent`, no provider operation
ID, and three evidence references: the canonical node result, official owned
readback, and the loaded `a410276` classifier.

The append-only Graph events are:

- sequence 123: `external_effect_reconciled`, actor `operator-key`, exact
  effect, `confirmed_absent`, three evidence references;
- sequence 124: `state_snapshot_recorded`.

The parent run remains historically failed; reconciliation truth is appended
without falsely rewriting the original terminal outcome.

## GUARD_CLEARED — pass

Pre/post Graph counts:

| Field | Before | After |
|---|---:|---:|
| runs | 1722 | 1722 |
| effects | 65 | 65 |
| events | 84733 | 84735 |
| ambiguous effects | 1 | 0 |
| active ambiguous/provider-accepted effects for Instagram account | 1 | 0 |
| target run revision | 21 | 22 |

State-isolation proof:

- unrelated Graph runs hash remained
  `167087773d96009e61a4d6668f5595cb64493e15f37b75597ba8a9624c96890b`;
- unrelated Graph effects hash remained
  `868c37df67ce8d0660b92b1cd083bec0414bb61ad719ac192affb5d8dc8fd311`;
- all pre-existing Graph events hash remained
  `eb9a7455f4ca3ccdaa1a981ba770102b3459df1ec85758e99356b54aa78b9879`;
- definitions, approvals, checkpoints, node attempts, child receipts,
  verifier receipts, capabilities, dispatches, leases, evidence, and schema
  metadata were byte-identical by table dump hash;
- the scheduler database was byte-identical before/after;
- the deterministic publishing database was byte-identical before/after.

Only the target effect, target run revision/state snapshot, and its two
append-only reconciliation events changed.

## RUNTIME_HEALTHY — pass

- `orchestrator.service` stayed active/running on PID `391978`; no restart.
- `/health`: HTTP 200.
- `/api/persistence/health`: HTTP 200; file persistence and Redis coordination
  healthy.
- `/api/graphs/health`: healthy, schema v3, 10 definitions, zero blocked runs,
  zero ambiguous effects.
- Scheduler: 11 migrations, 9 Graph-owned; no schedule mutation.
- Provider writes during reconciliation: 0.
- Browser Relay calls: 0.

## NATURAL_SLOT_OBSERVED — pass

The enabled `instagram-reel-video-daily` schedule
(`2c7071ff-35dd-40d0-bf77-b1ed53de256e`) fired naturally at
`2026-08-09T17:00:00+01:00`; no force or replay was used.

- Trigger: `gst_3d52d25f28a889b149601340c04726fe`.
- Logical slot:
  `instagram:2026-08-09:17:00:2c7071ff-35dd-40d0-bf77-b1ed53de256e`.
- Graph run: `grzwcanary_4e334aa9-92cd-4a44-85b4-f4a010b451bd`.
- Graph outcome: `completed`; terminal outcome `success`; revision `28`.
- Effect: `gex_07230ecb-67e7-400c-9844-1c1f3f473df6`,
  `effect_verified`.
- Graph event chain and child-receipt chain: valid.
- Completion assertions: `live-provider-publication-verified`,
  `live-payload-media-identity-verified`, and
  `live-local-state-finalised` all passed.
- Worker activity: `generatedMediaUploadCalls=1`,
  `instagramPublishCalls=1`, `browserRelayCalls=0`.
- Provider object: `18146423119532276`.
- Permalink: `https://www.instagram.com/reel/Db01LALD26o/`.
- Scheduler completion contract: passed; final classification `published`.

Independent official Meta readback verified the same object on
`@tailwaggingwebdesigns` as `VIDEO` / `REELS`, timestamped
`2026-08-09T16:07:53+00:00`, with the same permalink. The official verifier
returned `success` and `verified=true`.

The reconciliation itself caused **zero provider writes**. The later natural
slot used its pre-existing approved production authority and truthfully made
one intended Instagram publication after the guard had cleared. This was not a
manual publication, replay, forced trigger, or widened approval boundary.

Final post-observation health:

- historical effect remains `confirmed_absent`;
- ambiguous effect count remains `0`;
- Graph health is `healthy`, with zero active, waiting or blocked runs;
- `/health` and `/api/persistence/health` return HTTP 200;
- `orchestrator.service` remains active/running on unchanged PID `391978`;
- no service restart or schedule mutation occurred.

## Change and validation status

- `git diff --check`: passed.
- Markdown link validation: passed (`113` files).
- No source code, Graph definition, schedule, credential, permission, service,
  commit, remote branch, or deployment state was changed.
- Local documentation remains uncommitted; no commit or push was requested.
