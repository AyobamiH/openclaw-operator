---
summary: "Payload-bound one-run graph capability, structural zero-write preservation, adversarial proof and Phase F publication evidence."
status: "complete — one payload-bound live graph run verified"
date: "2026-08-02"
---

# One-run live capability and Phase F proof

## Verdict

`PHASE F COMPLETE — ONE PAYLOAD-BOUND LIVE GRAPH RUN VERIFIED`

Exactly one fresh payload-bound graph run published exactly one Instagram feed
object through the canonical deterministic worker and official connector. The
object was reconciled twice, the provider effect and local publication state
are verified, the durable claim is final, and the capability was consumed
before the publish request. Global zero-write remained enabled throughout.
Scheduler ownership is unchanged and Phase G was not executed.

## Architecture and threat model

The global graph runtime remains structural zero-write. The startup invariant
`OPENCLAW_GRAPH_ZERO_WRITE_ONLY=true` and the existing
`graph_runtime_requires_explicit_zero_write_policy` guard are unchanged. A
mutation is possible only at the immutable
`deterministic-social-publication@2.0.0` node
`publish_provider_object`, whose handler is the only capability-aware handler.
Every other external node is blocked by the runtime zero-write policy.

The durable capability binds graph ID/version/definition hash, graph run,
claim, approval, provider and represented account, operation type, candidate,
campaign, sequence, slot, payload hash, media hash, complete envelope hash,
idempotency fingerprint, validity window and dispatch/publication ceilings.
Wildcards and caller-supplied hashes are rejected. The admin issue surface
accepts only approval/timing references and recomputes the binding from
canonical persisted state. Issuance never executes a node.

The ordered dispatch plan has two one-use reservations:

1. `delivery_upload` → `generated_media_delivery_upload`;
2. `instagram_publish` →
   `relay_live_business_engagement_execute:publish`, requiring step 1 success.

Before either network boundary, one SQLite transaction verifies the global
zero-write invariant, immutable bindings, current run/node and definition,
granted unexpired approval, durable `request_prepared` effect intent, absence
of a verified duplicate or unresolved ambiguity, predecessor and total budget.
It then reserves the dispatch, records `request_sent` and appends dispatch
events. The public-publish reservation permanently consumes the capability
before the connector is invoked. Ambiguity also permanently consumes it.

## Schema and migration

Schema v2 adds only:

- `graph_one_run_live_capabilities`;
- `graph_live_capability_dispatches`;
- two supporting indexes;
- immutable-binding and terminal-state triggers.

The version-1 to version-2 upgrade is `BEGIN IMMEDIATE`, checksum-backed and
backward compatible. It creates no capability, approval, run, dispatch or
effect row and modifies no registered graph definition or historical run.
Corrupt/future schemas fail closed. Capability terminal states cannot return to
prepared or active, and expiry timestamps are immutable.

## Local adversarial and lifecycle proof

Focused capability and initializer suite: `35/35` passed. Combined focused
graph/adapter/kernel suite: `80/80` passed before the additional restart case;
the complete self-contained suite subsequently passed all non-attached tests.
The attached-host load file was separately classified because it expected a
service on `127.0.0.1:3000`; it is rerun after controlled production load.

Proved with zero provider-spy mutations:

- missing capability;
- wrong run, graph version or definition hash;
- changed payload or media hash;
- changed provider, account, candidate or slot;
- changed approval or idempotency fingerprint;
- expired and revoked capability;
- consumed reuse and second-dispatch reuse;
- unapproved envelope issuance;
- issuance without execution.

The exact positive fixture reached only its bound adapter, persisted effect
intent before both reservations, executed exactly the two planned spy
boundaries, and left the capability consumed. A crash fixture reserved the
publish step, restarted from the same SQLite database, remained consumed,
blocked recovery on `request_sent`, rejected reuse and proved event replay does
not reconstruct authority.

The loaded-runtime adversarial matrix repeated wrong run, graph version,
definition hash, payload, media, provider, account, candidate, slot, expired,
revoked, consumed, missing-approval, modified-envelope, duplicate-effect,
ambiguous-effect and scheduler-originated/no-capability cases against a
provider spy. Every negative path produced zero adapter mutation calls. The
only positive test fixture reached its two exact ordered spy operations, and
issuance alone remained inert. A normal `2.0.0` canary without a capability
remained structurally zero-write.

## Source and control surfaces

Primary implementation:

- `orchestrator/src/graph/migrations.ts`
- `orchestrator/src/graph/schema-verifier.ts`
- `orchestrator/src/graph/store.ts`
- `orchestrator/src/graph/live-capability.ts`
- `orchestrator/src/graph/engine.ts`
- `orchestrator/src/graph/production-adapters.ts`
- `orchestrator/src/graph/routes.ts`
- `orchestrator/src/graph/runtime.ts`
- `orchestrator/scripts/manage-one-run-live-capability.ts`
- canonical deterministic worker
  `scripts/instagram-publisher-outbox-runner.mjs`

The HTTP issuance and revocation endpoints require the `admin` role. The local
CLI uses the secure GraphStore path rules and requires the global zero-write
environment value for approval, issue or revoke. Neither surface accepts raw
payload prose or credentials.

## Immutable graph proof

- `deterministic-social-publication@1.1.0` remains
  `f4f41c406ff8399c8e10b2012bf06a5dc0357a28f983e73f328cac3a2d3d592c`.
- `deterministic-social-publication@2.0.0` remains
  `995ff8355a57113884129b7cda9f7966d4719163f9b9b81ed77e87d12c6a3473`.

## Production, provider and completion evidence

### Controlled load and zero-write preservation

Pre-load service evidence recorded PID `1076883`, HTTP health `200`, HTTP
persistence route `200`, schema v1 integrity `ok`, zero capabilities and zero
effects. The v1 rollback database is retained owner-only at
`state/activation/graph-one-run-live-capability-20260802/graph-runs.sqlite.v1.rollback`
with SHA-256
`de6e74018f6629cb6575c8cc21167ce503cce6d3defae2e328baf2bb0dda84da`.

An isolated start with `OPENCLAW_GRAPH_ZERO_WRITE_ONLY=false` exited with
`graph_runtime_requires_explicit_zero_write_policy`. An isolated true-policy
start migrated a copy to schema v2, exposed zero capabilities, became healthy
and shut down cleanly. Production was stopped before migration and loaded with
two controlled restarts in total: the initial v2 load and one narrow post-write
readback-adapter repair. No automatic failed restart occurred. Final service
evidence is PID `1155926`, `ActiveState=active`, `SubState=running`,
`NRestarts=0`, main HTTP health `200`, metrics health `200`, and startup log
`graph runtime initialized in zero-write mode`. The public persistence route
also returns HTTP `200`; its legacy Mongo-oriented body reports unhealthy
because this service intentionally logged `file-backed runtime state
configured; skipping Mongo persistence initialization`. Graph persistence is
the separately verified owner-only SQLite store.

Schema v2 integrity is `ok`, foreign-key check is empty, file mode is `0600`,
and the final graph database SHA-256 is
`980bd7b88b39b4592b498367063dc208c099e760b9d545f20642b4d34e752234`.
Migration created no authority automatically.

### Fresh candidate and frozen authority

The previous cancelled claim, approval and canary were not reused. The one
fresh naturally eligible candidate was:

- candidate: `instagram-dynamic:e6a2ee4574e0cdec5d697e37`;
- campaign: `operational-excellence`;
- sequence: `unrecorded-automation:feature-spotlight:custom-mern-software:local-service-owner`;
- slot: `instagram:2026-08-02:09:00:24afbb84-457c-41bb-92c9-24a19725e984`;
- provider/account: Instagram / `instagram:owner`, represented account
  `17841453638630920`;
- graph run: `grzwcanary_0b3d659f-2889-41b3-87b6-592c209a5b80`;
- claim: `gclaim_cb2e4d7e8c2cfc3dea75d82fee9258c5`;
- payload SHA-256:
  `07e6ab5f84b0a98cb4bfdf18d6135c99cd5750efc895f40840fea99c4021c820`;
- media SHA-256:
  `60bca61ba1b74dc9492fd93d8f62467f4c281c5856ad7c7249cb7c4e14fd8a09`
  (`247927` frozen bytes);
- envelope SHA-256:
  `1199df703c39fa202206c0831da218acb2471b627b6925a92cec351957d8f7f7`;
- approval: `gap_10d5ba98569ad47c07567fc1fb9e4fc1`;
- approval payload SHA-256:
  `80423620cc42b263b44a442f29ff0570187c0c30efe31d109904aa6751d9a423`;
- capability: `glc_1b0bc8a14b5dc416b23a55e95aceb5e3`;
- idempotency fingerprint:
  `94e257affc3510cc51ec3378638c5496092f39afe586ccf8f25a6b4f746e7735`;
- capability issued `2026-08-02T07:20:38.723Z`, expiry
  `2026-08-02T07:34:00.000Z`, maximum two ordered mutating dispatches and one
  successful publication.

Eligibility/readiness passed all 15 checks with zero preflight provider writes.
The exact envelope was validated twice before approval and capability issue;
media was not regenerated afterward.

### Durable ordering and provider proof

Effect `gex_5c32eeff-5d2f-4696-9125-18207568ffd6` existed as durable intent
before dispatch. The ordered capability records prove:

1. `delivery_upload` reserved at `2026-08-02T07:22:37.020Z`, then succeeded at
   `07:22:44.664Z`;
2. `instagram_publish` reserved at `2026-08-02T07:22:50.348Z`, atomically
   consuming the capability before the connector call, then succeeded at
   `07:23:03.760Z`.

Each dispatch count is exactly one. The official connector returned provider
object `17926760331380951`, container `18056333045787955`, and public reference
<https://www.instagram.com/p/Dbh3lIrFqWr/>. The effect became
`effect_verified` at `2026-08-02T07:23:22.569Z`. Canonical outbox state is
`published_verified`, counted once, with one delivery upload, one publish,
`recoveryRequired=false`, and graph claim status `verified`.

Official provider inspection confirmed the object on represented account
`17841453638630920`, username `tailwaggingwebdesigns`, media type `IMAGE`,
product type `FEED`, exact caption identity, permalink and timestamp. A second
bounded readback completed at `2026-08-02T07:27:26.844Z`; the graph recorded
`exactProviderObjectCount=1`. The outbox contains exactly one row for the
provider object. Browser Relay mutation count remained zero.

### Completion, event chain and repair

The first provider operation succeeded, but the graph's post-write readback
adapter omitted the newly mandatory capability lineage. The graph failed
closed after the verified provider write; it did not retry or republish. The
official read immediately established provider truth. A narrow repair made
readback require the consumed capability matching the approval and envelope,
passed focused tests/typecheck/build, and was loaded by the second controlled
restart. Only checkpoint
`gcp_503353a6-946a-478d-bb6c-8dcd3ece64ca` after reconciliation was retried.
No mutating node was replayed.

The final graph status is `completed`, revision `30`, current node `complete`,
with 25 node attempts, 25 transitions and one external request budget unit.
All three terminal assertions passed: live provider publication verified,
payload/media identity verified, and local state finalised. Its hash-chained
event ledger has 184 valid events and 32 evidence records. There is one
approval, one permanently consumed capability, zero active capabilities and
zero unresolved graph effects. Consumed authority remained consumed across
the repair restart.

### Scheduler, duplicate and rollback state

The legacy Instagram Image schedule remains enabled with the same ID
`24afbb84-457c-41bb-92c9-24a19725e984`, expression
`0 5,7,9,11,13 * * *`, timezone `Europe/London`, isolated command owner and
delivery configuration. The Instagram Reel schedule remains disabled. The
pre-load stable scheduler snapshot digest was
`05f5c5efd580a8d9034f8d11452f5e305e8329f1dafbbb212a3f75de5cb2b745`;
the final complete configuration projection digest is
`ef20166ec4d19fe3786081ce8dc59e9462808e4e99298917fbcdf5642ffcd171`.
These use different documented projections; field comparison of the named
schedule is unchanged. No scheduler write or ownership transfer occurred.
The graph claim was durable before the natural slot and the canonical outbox
was terminal before legacy execution, preventing a competing claimant.

No compensation is required: provider truth and local truth agree. The v1
database rollback image is preserved, but rolling back runtime code after the
verified provider effect would not undo or replay the publication; the
consumed authority and provider object remain the truth anchors.

### Verification inventory

- capability/initializer: `35/35`;
- canonical worker: `60/60`;
- loaded attached HTTP/authentication: `10/10`;
- loaded focused graph/kernel/adapter: `44/44`;
- post-repair focused: `36/36`;
- final graph/capability/initializer/adapter/credential suite: `85/85`;
- typecheck and build: passed;
- full self-contained suite: `521/531`, with the only ten failures from its
  attached-service file while the expected default port was unavailable; the
  same attached file passed `10/10` against the controlled loaded service;
- immutable graph hashes: exact for `1.1.0` and `2.0.0`;
- OpenAPI/authentication, migration/initializer, documentation sync/link check,
  `git diff --check` and task-scoped secret scan: passed;
- provider writes for adversarial/zero-write proof: zero;
- live provider writes: one bounded upload plus one publish, producing exactly
  one public object.

Primary non-secret execution artifacts are retained owner-only under
`state/activation/graph-one-run-live-capability-20260802/`. No credential value
is included in this report. The final `completion-summary.json` SHA-256 is
`e0df3bc140792370658fcd837d2456bfeb20ecb509050ac9b2501bb4ec2476ea`.

## Remaining boundary

Phase G is not authorised here: transfer one explicitly named publication
schedule from the legacy system to the graph runtime, with bounded observation
and immediate rollback.
