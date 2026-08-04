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
| Coding and repository change | Governed graph child dispatcher into the Operator task queue | authenticated graph/manual | local reversible; commit/push separately gated | production schema v3 parent/child/verifier receipts; task queue ledger; hash-chain replay/tamper proof | `coding-change@1.2.0` | `graph_native`; production definition loaded zero-write | Low/medium. Runtime, restart/replay and tamper proof pass. Production child and verifier receipt chains are now populated and valid. |
| Deterministic Instagram image publication | graph scheduler trigger `phase-g-instagram-image-v1`; cron `24af…e984` | cron | external public | graph claim/effect/capability chain plus SQLite outbox and official provider readback | `deterministic-social-publication@1.1.0` | `graph_native` for this one transferred schedule | High. Phase G is complete for exactly this schedule. Preserve its one-run capability and verification guards; migrate no adjacent Meta schedule implicitly. |
| Deterministic Threads image rotation | graph scheduler migration `threads-daily-image-v1`; cron `083e…66f7` | cron | external public | graph state/checkpoints/retries; exact prepared-payload approval; one-use capability; narrow provider adapter; official readback and terminal receipt | `threads-publication@1.0.0` | `graph_native` | High. Missing exact approval fails closed before capability issuance or provider work; schedule and daily limits are unchanged. |
| Deterministic Threads early text rotation | graph scheduler migration `threads-early-text-v1`; cron `68b1…8106` | cron | external public | same graph-owned approval/effect/reconciliation chain with durable slot dedupe | `threads-publication@1.0.0` | `graph_native` | High. Legacy runner remains only behind prepare/effect/readback adapter contracts; it is no longer the cron owner. |
| Meta reply monitor | graph scheduler migration `meta-reply-monitor-v1`; cron `4de8…a847` | hourly cron | external public replies | graph-owned discovery, exact reply authority, one-use capability, durable outbox reconciliation, child/verifier receipts | `meta-reply-monitor@1.0.0` | `graph_native` | High. `completed` and `completed_with_receipt_sync_failure` remain terminal and uncertain prior attempts reconcile before reuse. |
| Self-identification shadow | graph scheduler migration `campaign-content-factory-shadow-v1`; cron `6fd3…a03` | cron shadow | read-only | graph-owned ingress/checkpoints/retries/child and verifier receipts; pinned Factory adapter; zero provider writes | `governed-task-execution@1.0.0` with immutable `campaign-factory` lane contract | `graph_native` | Medium. The deterministic Factory worker is an effect adapter only; the graph owns lifecycle and `self-id-1100` remains reserved for its separately approved natural canary. |
| Self-identification readiness monitor | historical isolated OpenClaw cron `91fb…54d` | completed observer | read-only | retained cron history and evidence report | verification/health graph | `obsolete` | Low. Observer self-deleted after terminal proof; retain evidence only. |
| Continuous social digest | graph scheduler migration `continuous-marketing-digest-v1`; cron `25a7…113a` | daily cron | local evidence; one Telegram delivery | graph-owned evidence load, delivery intent, bounded retry, reconciliation, child/verifier receipts and terminal receipt | `digest-delivery@1.0.0` | `graph_native` | Medium. Delivery capability remains single-use and bound to the configured digest schedule. |
| Instagram Reel publisher | cron `2c70…113a`, disabled | cron | external public | legacy runner/outbox plus graph claim/envelope primitives | `deterministic-social-publication@2.0.0` | `legacy_approved_for_temporary_use`; v2 loaded zero-write proved | High. v2 prepares and freezes one exact candidate safely, but the production startup guard currently forbids non-zero-write graph runtime policy. Keep the job disabled and add a separately reviewed one-run live activation control before retrying Phase F. |
| Continuous social hourly cycle | cron `7985…a9`, disabled | hourly cron | mixed external | historical cron state | no immediate target | `obsolete` | Low. Retain historical evidence; do not migrate wasteful loop. |
| Queue admission activation one-shot | cron `ceb7…df39`, disabled/completed | one-shot | local persistent | cron receipt | none | `obsolete` | Low. Preserve receipt only. |
| Business-value cycle | graph-owned scheduler/manual ingress; deterministic planner child | cron/manual | local planning; external actions gated | graph state, checkpoints, idempotent ingress, bounded retry, child/verifier receipts | `governed-task-execution@1.0.0` with immutable `business-value` lane contract | `graph_native` | Medium. Financial and public actions remain separate ToolGate approval boundaries. |
| Existing task queue | graph ingress for the scoped business-value, market-research, Git-monitor, Factory and digest task types; queue is a child-effect transport only | API/scheduler/recovery | mixed | graph is retry owner (`maxRetries=0` for child tasks); durable queue attempt evidence is bound into child/verifier receipts | governed task and digest graphs | `graph_native` for the migration scope; deliberately retained transport for other task types | Medium. The queue cannot become an alternate owner for scoped types because every scheduler, manual API, replay and child-handler entry point is routed through `startGraphOwnedTask`. |
| Market research task | graph-owned manual/API/child-handler ingress; deterministic market-research child | API/task | read-only network | graph state/checkpoints/retry, ToolGate, child/verifier receipts, source evidence | `governed-task-execution@1.0.0` with immutable `market-research` lane contract; `research-to-action@1.1.0` retained as evidence graph | `graph_native` | Low/medium. The task handler remains the narrow source-fetch/evidence adapter; graph lifecycle cannot be bypassed by scoped entry points. |
| Git workflow monitor and governed Git task lane | graph-owned startup, five-minute scheduler and manual ingress; deterministic Git monitor child | startup/scheduler/manual | read-only monitor; commit/push/release/deploy remain external persistent | graph idempotency, ToolGate, bounded retry, child/verifier receipts | `governed-task-execution@1.0.0` with immutable `git-monitor` lane contract | `graph_native` | High. Monitor runs are proven. Commit, push, release, deploy and destructive Git operations remain payload-bound ToolGate approvals and are not implied by monitor ownership. |

The approved 2026-08-04 cutover expanded the production portfolio to nine exact
definitions and atomically transferred the six active schedules listed above.
Names, declaration keys, enabled state, cron expressions, timezone, delivery,
payload authority and limits were preserved; only the command owner changed.
The already graph-owned Instagram image schedule was not modified.

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

This was initially a source-readiness increment. It is now installed and has
produced production child/verifier receipts; the table labels reflect the
subsequent scheduler and runtime cutover rather than source presence alone.

The second source increment adds `digest-delivery@1.0.0`. It separates the
scheduled ingress and reconciliation stages from one narrow notification
effect, routes that effect through the normal task ToolGate with a single-call
`notificationSender` capability, and binds child/verifier receipts to the
parent graph. The orchestrator cron now selects this graph owner whenever the
graph runtime is enabled, while graph-disabled development fixtures retain the
legacy queue fallback. The definition is installed and its cron is transferred;
standing delivery authority and the single-effect limit remain unchanged.

The third source increment adds `threads-publication@1.0.0` and
`meta-reply-monitor@1.0.0`. Both definitions now own schedule ingress, exact
zero-write preparation, immutable payload binding, the approval boundary, a
single-use live capability, provider-effect ordering, readback reconciliation
and terminal receipts. Their canonical workspace runners expose only narrow
prepare, exact-effect and reconciliation entry points to the graph adapters.
Injected-clock shadows and an exact Threads capability-consumption fixture
pass without a provider call. Scheduler ownership was subsequently transferred
after the registry, rollback snapshot and atomic cron repoint passed.

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
the social effects. The backed-up installed runtime and cron registry have now
been atomically transferred and health-verified.

## Persistence activation status

The owner-only production graph database is schema v3 and retains the pre-v3
execution history. The running zero-write service loads the nine identities in
`PRODUCTION_GRAPH_DEFINITION_IDENTITIES`, including the governed task, digest,
Threads readiness/publication and Meta reply graphs. Durable ToolGate policy,
decision, denial and capability state uses a separate owner-only SQLite hash
chain and is checked eagerly at startup. Post-restart graph and queue activity
continues the same decision chain, including enforced denials.

Production child-run and verifier tables are populated by Git-monitor runs.
Their hashes are bound to parent run/event-chain state, and replay, restart
recovery, tamper detection and deterministic verifier tests pass. The other
governed lanes have the same immutable receipt contract and regression proof;
their first natural post-cutover receipts remain schedule or demand dependent.
Scheduler ownership is recorded in the separate owner-only graph-scheduler
database with one immutable migration row per active cron and a hash-chained
prepare/cutover event pair.

## 2026-08-04 terminal closure proof

| Required lane | Source / runtime owner | Scheduler or ingress proof | Durable proof | Terminal status |
|---|---|---|---|---|
| Both Threads schedules | `threads-publication@1.0.0`; readiness uses `threads-readiness@1.0.0` | crons `68b1…8106`, `083e…66f7` and `abb3…80ad` invoke only `trigger-governed-graph-schedule.ts` with immutable migration IDs | exact approval and one-use capability contract; injected-clock portfolio test; natural 05:30 readiness run completed with zero external effects | `graph_native`; next natural publication slots remain fail-closed without exact approved payloads |
| Meta replies | `meta-reply-monitor@1.0.0` | cron `4de8…a847` invokes `meta-reply-monitor-v1` | natural 05:15 run `grzwcanary_512e370a-4cac-4645-9a6a-2d16f275ca79` completed with zero external effects | `graph_native` |
| Digest | `digest-delivery@1.0.0` | cron `25a7…113a` invokes `continuous-marketing-digest-v1` | exact approval plus one-use notification capability; child/verifier receipt regression passes | `graph_native`; first post-cutover natural slot is 08:30 Europe/London |
| Business value | `governed-task-execution@1.0.0` / `business-value` | scheduler, manual and recovery ingress call `startGraphOwnedTask` | immutable ToolGate/child/verifier receipt contract; production receipt awaits the next admitted cycle | `graph_native` |
| Task queue and market research | `governed-task-execution@1.0.0` / immutable lane bindings | scoped API, scheduler and child-handler ingress call `startGraphOwnedTask`; queue is effect transport only | queue retry disabled for graph children; injected market-research receipt chain passes | `graph_native` for the requested scope |
| Git workflow | `governed-task-execution@1.0.0` / `git-monitor` | startup, five-minute scheduler and manual ingress are graph-owned | production monitor runs and child/verifier receipt pairs exist; commit/push authority remains separate | `graph_native` |
| Campaign Factory | `governed-task-execution@1.0.0` / `campaign-factory` | cron `6fd3…a03` invokes `campaign-content-factory-shadow-v1` | immutable zero-write Factory adapter and hash-bound child/verifier receipt contract | `graph_native`; first post-cutover natural slot is 07:00 Europe/London; `self-id-1100` remains reserved |

The live production portfolio contains nine exact definitions. All six newly
transferred migrations plus the existing Instagram migration are recorded
`graph_owned`. The scoped registry contains no `graph_wrapped_legacy` row.
Natural 05:15 Meta and 05:30 Threads-readiness triggers completed after the
cutover. At the terminal snapshot, the production graph database contained 17
child receipts and 17 verifier receipts; the scoped natural runs above added no
provider effect. No forced out-of-slot diagnostic, reply, duplicate, deletion
or repost was performed.

The adjacent host repairs also converged. The persistence endpoint now reports
the selected file store healthy with Redis coordination healthy, rather than
misreporting an unavailable Mongo store as the active dependency. The approved
local `llama-cpp` update is loaded at `2026.7.1`, matching OpenClaw `2026.7.1`;
the single approved Gateway restart completed and was not repeated.

Verification passed the 61-test graph runtime, scheduler, live-capability,
adapter and receipt pack; the repository-wide protected gate passed 95 unit
simulations, 35 live middleware integrations, 34 operator UI tests, builds,
typechecks, documentation drift and link checks. The immutable portfolio test
exercises all six scheduler bindings with injected Europe/London clocks and
asserts zero provider effects.

### Tool invocation record

- Requested task: implement and activate the remaining graph-native workflow
  migrations, repair locally bounded runtime drift, verify, commit and push.
- Workflow lane: coding, runtime, scheduler cutover and deployment evidence.
- Tools and source: coding-agent-skills `coding_repo_map` (read-only,
  adapter-limited); OpenClaw cron read/update surfaces; local project commands
  for TypeScript/Vitest/build/docs validation; user systemd and HTTP health
  reads; SQLite read-only evidence queries; Git commit/push under the explicit
  approval in the 2026-08-04 resume instruction.
- Changed state: `true`. Source, installed portfolio, six cron payload owners,
  persistence reporting and the approved local plugin version changed. No
  diagnostic provider write, reply, duplicate, deletion or repost was caused
  by the migration. The pre-existing Instagram graph schedule ran normally
  under its preserved authority and remained outside the transferred scope.
- Evidence: this registry, the protected test output, the graph and scheduler
  SQLite receipt chains, and rollback directory
  `~/.openclaw/state/openclaw-operator/backups/20260804-remaining-graph-cutover.ar7Pqd/`.
- Fallback reason: coding-agent-skills is metadata-only for this adapter, so
  implementation, tests and narrow live-state verification used local project
  commands and read-only runtime surfaces.
- Next safe step: observe the next natural graph-owned slots. Exact Threads,
  digest or Factory provider authority remains separately payload-bound; no
  additional restart or provider mutation is implied by this closure.

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
self-identification or general queue schedule was transferred by that Phase G
proof. Those scoped lanes were transferred later under the 2026-08-04
governed-portfolio cutover.
