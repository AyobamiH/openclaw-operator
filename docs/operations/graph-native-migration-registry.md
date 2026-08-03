---
title: "Graph-Native Workflow Migration Registry"
status: "active"
updated: "2026-08-03"
---

# Graph-Native Workflow Migration Registry

Statuses: `graph_native`, `graph_wrapped_legacy`,
`legacy_approved_for_temporary_use`, `obsolete`, `unknown`.

| Workflow | Owner / active path | Trigger | Side effect | Persistence / retry / verification | Graph target | Status | Risk / next step |
|---|---|---|---|---|---|---|---|
| Coding and repository change | Governed graph child dispatcher into the Operator task queue | authenticated graph/manual | local reversible; commit/push separately gated | schema-v3 parent/child/verifier receipts; task queue ledger; hash-chain replay/tamper proof | `coding-change@1.2.0` | `graph_native` source contract; production activation approval-gated | Low/medium. Engineering and restart/replay proof pass. Apply the production schema/config and reload only under a separate approved activation plan. |
| Deterministic Instagram image publication | root `scripts/instagram-publisher-outbox-runner.mjs`; cron `24af…e984` | cron | external public | SQLite outbox; no blind retry; provider readback | `deterministic-social-publication@1.1.0` | `legacy_approved_for_temporary_use`; loaded graph zero-write equivalent | High. Loaded Instagram and rejection/ambiguity samples pass; Phase F must name and bound the first live workflow before any provider write. |
| Deterministic Threads image rotation | root `scripts/threads-outbox-runner.mjs`; cron `083e…66f7` | cron | external public | durable outbox; ambiguous reconciliation; provider readback | `deterministic-social-publication@1.1.0` | `legacy_approved_for_temporary_use`; loaded graph zero-write equivalent | High. Loaded Threads proof passes; preserve legacy ownership until an independently approved Phase F. |
| Deterministic Threads early text rotation | root `scripts/threads-outbox-runner.mjs`; cron `68b1…8106` | cron | external public | same shared outbox and readback | `deterministic-social-publication@1.0.0` | `legacy_approved_for_temporary_use` | High. Same migration lane; preserve schedule and quota ownership. |
| Meta reply monitor | root `scripts/meta-reply-monitor-outbox-runner.mjs`; cron `4de8…a847` | hourly cron | external public replies | durable reply outbox; one write; verification | publication/reply reconciliation subgraph | `legacy_approved_for_temporary_use` | High. Migrate after standalone publishing reconciliation nodes. |
| Self-identification shadow | Operator publishing CLI; cron `6fd3…a03` | cron shadow | read-only | publishing SQLite audit; zero writes | social publication subgraph | `graph_wrapped_legacy` target | Medium. Wrap the shadow command before production-lane cutover. |
| Self-identification readiness monitor | isolated OpenClaw cron `91fb…54d` | cron | read-only | cron history and evidence report | verification/health graph | `legacy_approved_for_temporary_use` | Low. Replace only after graph health endpoint is deployed. |
| Continuous social digest | OpenClaw cron `25a7…113a` | daily cron | local evidence; Telegram delivery | cron state; summary evidence | research-to-action + evidence packaging subgraph | `legacy_approved_for_temporary_use` | Medium. Separate evidence generation from external delivery authority. |
| Instagram Reel publisher | cron `2c70…113a`, disabled | cron | external public | legacy runner/outbox plus graph claim/envelope primitives | `deterministic-social-publication@2.0.0` | `legacy_approved_for_temporary_use`; v2 loaded zero-write proved | High. v2 prepares and freezes one exact candidate safely, but the production startup guard currently forbids non-zero-write graph runtime policy. Keep the job disabled and add a separately reviewed one-run live activation control before retrying Phase F. |
| Continuous social hourly cycle | cron `7985…a9`, disabled | hourly cron | mixed external | historical cron state | no immediate target | `obsolete` | Low. Retain historical evidence; do not migrate wasteful loop. |
| Queue admission activation one-shot | cron `ceb7…df39`, disabled/completed | one-shot | local persistent | cron receipt | none | `obsolete` | Low. Preserve receipt only. |
| Business-value cycle | orchestrator business scheduler/task queue | cron/manual | local planning; external actions gated | orchestrator state + scheduler state | planning/approval/evidence subgraphs | `legacy_approved_for_temporary_use` | Medium. Migrate planning first, keep external actions gated. |
| Existing task queue | `orchestrator/src/taskQueue.ts` | API/scheduler | mixed | task execution/admission/retry ledger | legacy-task wrapper graph | `graph_wrapped_legacy` capability available | Medium. Route task types incrementally; label wrapped debt in metrics. |
| Market research task | market-research handler/agent | API/task | read-only network | task ledger; handler evidence | `research-to-action@1.1.0` | `graph_wrapped_legacy`; production evidence adapter bound | Low/medium. Keep sourceFetch governed by the existing agent lane; next extract a stable read-only retrieval receipt contract. |
| Git publication | coding sessions / GitHub CLI | manual | external persistent | Git receipts vary | reusable Git publication subgraph | `unknown` | High. Define commit and push as separate payload-bound approvals. |

No legacy execution path was deleted, rescheduled, disabled, enabled or
restarted by this migration.

## Persistence activation status

Gate B has production schema proof and Gate C loaded the single allowlisted
definition under structural zero-write policy. The exposed orchestrator API
set was rotated through the canonical owner-only secret path; replacement
acceptance and compromised-key rejection were proved without recording values.
Phase D completed one loaded canary and Phase E completed ten loaded natural
samples with 100% semantic equivalence, zero unexplained mismatches, zero graph
effects and valid event chains. A Phase F natural Instagram Reel candidate then
passed the canonical zero-write preflight, but live execution stopped before a
claim or provider mutation: the approved immutable `1.1.0` definition is
explicitly zero-write, has disabled external handlers, lacks pre-request effect
intent persistence, and cannot be changed under the same version hash. A new
reviewed graph version and fresh payload-bound live approval are required.
Legacy schedulers remain authoritative; Phase G scheduler transfer remains
separately gated.

## Live-capable v2 status

`deterministic-social-publication@2.0.0` is registered independently from the
unchanged `1.1.0` definition. It has allowlisted prepare, live publication and
official readback adapters, a durable canonical Instagram claim, immutable
payload/media envelope binding, and pre-dispatch external-effect intent
ordering. Loaded zero-write execution reached and was blocked at the first
external node with zero effects. One natural Reel candidate was then claimed
and frozen under zero-write, but the service startup guard correctly rejected
`OPENCLAW_GRAPH_ZERO_WRITE_ONLY=false`. The claim was released and the run was
cancelled without provider mutation. Phase F remains blocked pending a bounded
one-run live activation control; Phase G remains prohibited.
