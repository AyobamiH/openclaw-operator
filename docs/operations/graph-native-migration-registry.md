---
title: "Graph-Native Workflow Migration Registry"
status: "active"
updated: "2026-08-04"
---

# Graph-Native Workflow Migration Registry

Statuses: `graph_native`, `graph_wrapped_legacy`,
`legacy_approved_for_temporary_use`, `obsolete`, `unknown`.

| Workflow | Owner / active path | Trigger | Side effect | Persistence / retry / verification | Graph target | Status | Risk / next step |
|---|---|---|---|---|---|---|---|
| Coding and repository change | Governed graph child dispatcher into the Operator task queue | authenticated graph/manual | local reversible; commit/push separately gated | production schema v3 parent/child/verifier receipts; task queue ledger; hash-chain replay/tamper proof | `coding-change@1.2.0` | `graph_native`; production definition loaded zero-write | Low/medium. Runtime, restart/replay and tamper proof pass. No production child receipt exists yet because no post-activation coding graph run has been dispatched. |
| Deterministic Instagram image publication | graph scheduler trigger `phase-g-instagram-image-v1`; cron `24af…e984` | cron | external public | graph claim/effect/capability chain plus SQLite outbox and official provider readback | `deterministic-social-publication@1.1.0` | `graph_native` for this one transferred schedule | High. Phase G is complete for exactly this schedule. Preserve its one-run capability and verification guards; migrate no adjacent Meta schedule implicitly. |
| Deterministic Threads image rotation | root `scripts/threads-outbox-runner.mjs`; cron `083e…66f7` | cron | external public | durable outbox; ambiguous reconciliation; provider readback | `deterministic-social-publication@1.1.0` | `legacy_approved_for_temporary_use`; loaded graph zero-write equivalent | High. Loaded Threads proof passes; preserve legacy ownership until an independently approved Phase F. |
| Deterministic Threads early text rotation | root `scripts/threads-outbox-runner.mjs`; cron `68b1…8106` | cron | external public | same shared outbox and readback | `deterministic-social-publication@1.0.0` | `legacy_approved_for_temporary_use` | High. Same migration lane; preserve schedule and quota ownership. |
| Meta reply monitor | root `scripts/meta-reply-monitor-outbox-runner.mjs`; cron `4de8…a847` | hourly cron | external public replies | durable reply outbox; one write; verification | publication/reply reconciliation subgraph | `legacy_approved_for_temporary_use` | High. Migrate after standalone publishing reconciliation nodes. |
| Self-identification shadow | Operator publishing CLI; cron `6fd3…a03` | cron shadow | read-only | publishing SQLite audit; zero writes | social publication subgraph | `graph_wrapped_legacy` target | Medium. Wrap the shadow command before production-lane cutover. |
| Self-identification readiness monitor | historical isolated OpenClaw cron `91fb…54d` | completed observer | read-only | retained cron history and evidence report | verification/health graph | `obsolete` | Low. Observer self-deleted after terminal proof; retain evidence only. |
| Continuous social digest | OpenClaw cron `25a7…113a` | daily cron | local evidence; Telegram delivery | cron state; summary evidence | research-to-action + evidence packaging subgraph | `legacy_approved_for_temporary_use` | Medium. Separate evidence generation from external delivery authority. |
| Instagram Reel publisher | cron `2c70…113a`, disabled | cron | external public | legacy runner/outbox plus graph claim/envelope primitives | `deterministic-social-publication@2.0.0` | `legacy_approved_for_temporary_use`; v2 loaded zero-write proved | High. v2 prepares and freezes one exact candidate safely, but the production startup guard currently forbids non-zero-write graph runtime policy. Keep the job disabled and add a separately reviewed one-run live activation control before retrying Phase F. |
| Continuous social hourly cycle | cron `7985…a9`, disabled | hourly cron | mixed external | historical cron state | no immediate target | `obsolete` | Low. Retain historical evidence; do not migrate wasteful loop. |
| Queue admission activation one-shot | cron `ceb7…df39`, disabled/completed | one-shot | local persistent | cron receipt | none | `obsolete` | Low. Preserve receipt only. |
| Business-value cycle | orchestrator business scheduler/task queue | cron/manual | local planning; external actions gated | orchestrator state + scheduler state | planning/approval/evidence subgraphs | `legacy_approved_for_temporary_use` | Medium. Migrate planning first, keep external actions gated. |
| Existing task queue | `orchestrator/src/taskQueue.ts` | API/scheduler | mixed | task execution/admission/retry ledger | legacy-task wrapper graph | `graph_wrapped_legacy` capability available | Medium. Route task types incrementally; label wrapped debt in metrics. |
| Market research task | market-research handler/agent | API/task | read-only network | task ledger; handler evidence | `research-to-action@1.1.0` | `graph_wrapped_legacy`; production evidence adapter bound | Low/medium. Keep sourceFetch governed by the existing agent lane; next extract a stable read-only retrieval receipt contract. |
| Git publication | coding sessions / GitHub CLI | manual | external persistent | Git receipts vary | reusable Git publication subgraph | `unknown` | High. Define commit and push as separate payload-bound approvals. |

The approved 2026-08-03 activation loaded the exact four-definition production
portfolio and restarted the orchestrator/Gateway. It did not transfer, delete,
reschedule, disable or enable any additional legacy execution path.

## 2026-08-04 implementation increment: governed task ownership

The first autonomous-closure implementation increment adds
`governed-task-execution@1.0.0` to the supported production source portfolio.
It owns ingress, immutable lane/task/agent payload binding, durable graph state,
checkpoints, reconciliation, bounded graph retries, child effect receipts,
deterministic verifier receipts and terminal event-chain verification. The
allowlist currently covers business-value, market-research, Git monitor and
Campaign Factory task lanes. Queue children continue to pass through the
durable ToolGate, while queue-local retry is disabled for graph child attempts
so retry ownership cannot split.

This entry records source readiness only. The installed runtime and active
schedulers remain at the 2026-08-03 state until the remaining social adapters,
portfolio tests, backup and atomic cutover gates pass. No workflow in the table
is relabelled `graph_native` solely because this source increment exists.

The second source increment adds `digest-delivery@1.0.0`. It separates the
scheduled ingress and reconciliation stages from one narrow notification
effect, routes that effect through the normal task ToolGate with a single-call
`notificationSender` capability, and binds child/verifier receipts to the
parent graph. The orchestrator cron now selects this graph owner whenever the
graph runtime is enabled, while graph-disabled development fixtures retain the
legacy queue fallback. This is not an installed cutover claim: the production
zero-write policy and scheduler transfer gates must still pass before the live
runtime loads or executes the definition.

The third source increment adds `threads-publication@1.0.0` and
`meta-reply-monitor@1.0.0`. Both definitions now own schedule ingress, exact
zero-write preparation, immutable payload binding, the approval boundary, a
single-use live capability, provider-effect ordering, readback reconciliation
and terminal receipts. Their canonical workspace runners expose only narrow
prepare, exact-effect and reconciliation entry points to the graph adapters.
Injected-clock shadows and an exact Threads capability-consumption fixture
pass without a provider call. Scheduler ownership is intentionally unchanged
until the generic migration registry, rollback snapshot and atomic cron
repoint complete.

The fourth source increment adds `threads-readiness@1.0.0`, an immutable
six-job scheduler portfolio and the generic governed graph trigger. The
portfolio binds the readiness, two Threads, Meta reply, Factory shadow and
daily digest schedule identities to exact graph versions and definition
hashes. Cron admission uses injected-clock-tested Europe/London matching,
durable slot deduplication and a hash-chained migration ledger. The trigger
accepts only a portfolio migration identifier; graph, provider, account,
payload and authority bindings are immutable registry data. The digest worker
now has a deterministic evidence-only Continuous Marketing mode, and its one
notification is enclosed by the same single-use capability/dispatch ledger as
the social effects. These are source and rollback prerequisites; the rows
above become `graph_native` only after the backed-up installed runtime and cron
registry are atomically transferred and health-verified.

## Persistence activation status

The owner-only production graph database is schema v3 and retains the pre-v3
execution history. The running zero-write service loads exactly
`coding-change@1.2.0`, `deterministic-social-publication@1.1.0`,
`deterministic-social-publication@2.0.0` and `research-to-action@1.1.0`.
Durable ToolGate policy, decision, denial and capability state uses a separate
owner-only SQLite hash chain and is checked eagerly at startup. The first
post-restart queue activity appended both allowed and denied decisions to the
pre-restart chain, proving persistence and inline enforcement in the governed
queue path.

Production child-run and verifier tables are present but empty. This is
expected until a production coding or research graph actually delegates a
child after activation; isolated restart/replay/tamper tests and the repeatable
full-runtime audit prove the contract without inventing a live receipt.

## Live-capable v2 status

`deterministic-social-publication@2.0.0` is registered independently from the
unchanged `1.1.0` definition. It has allowlisted prepare, live publication and
official readback adapters, a durable canonical Instagram claim, immutable
payload/media envelope binding, and pre-dispatch external-effect intent
ordering. Loaded zero-write execution reached and was blocked at the first
external node with zero effects. The one-run live-capability control was
subsequently added, and Phase G transferred exactly the Instagram image
schedule above. The v2 definition remains loaded zero-write for all other
workflows; no Reel, Threads, reply-monitor, digest, business-value,
self-identification or general queue schedule was transferred by that proof.
