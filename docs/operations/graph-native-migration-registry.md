---
title: "Graph-Native Workflow Migration Registry"
status: "active"
updated: "2026-08-04"
---

# Graph-Native Workflow Migration Registry

Statuses: `graph_native`, `graph_wrapped_legacy`, `obsolete`, `unknown`.

| Workflow | Owner / active path | Trigger | Side effect | Persistence / retry / verification | Graph target | Status | Risk / next step |
|---|---|---|---|---|---|---|---|
| Coding and repository change | Governed graph child dispatcher into the Operator task queue | authenticated graph/manual | local reversible; commit/push separately gated | production schema v3 parent/child/verifier receipts; task queue ledger; hash-chain replay/tamper proof | `coding-change@1.2.0` | `graph_native`; production definition loaded zero-write | Low/medium. Runtime, restart/replay and tamper proof pass. Production child and verifier receipt chains are now populated and valid. |
| Deterministic Instagram image publication | graph scheduler trigger `phase-g-instagram-image-v1`; cron `24af…e984` | cron | external public | graph claim/effect/capability chain plus SQLite outbox and official provider readback | `deterministic-social-publication@1.1.0` | `graph_native` for this one transferred schedule | High. Phase G is complete for exactly this schedule. Preserve its one-run capability and verification guards; migrate no adjacent Meta schedule implicitly. |
| Deterministic Threads image rotation | graph scheduler migration `threads-daily-image-v1`; cron `083e…66f7` | cron | external public | graph state/checkpoints/retries; exact prepared-payload approval; one-use capability; narrow provider adapter; official readback and terminal receipt | `threads-publication@1.0.0` | `graph_native` | High. Missing exact approval fails closed before capability issuance or provider work; schedule and daily limits are unchanged. |
| Deterministic Threads early text rotation | graph scheduler migration `threads-early-text-v1`; cron `68b1…8106` | cron | external public | same graph-owned approval/effect/reconciliation chain with durable slot dedupe | `threads-publication@1.0.0` | `graph_native` | High. Legacy runner remains only behind prepare/effect/readback adapter contracts; it is no longer the cron owner. |
| Meta reply monitor | graph scheduler migration `meta-reply-monitor-v1`; cron `4de8…a847` | hourly cron | external public replies | graph-owned discovery, exact reply authority, one-use capability, durable outbox reconciliation, child/verifier receipts | `meta-reply-monitor@1.0.0` | `graph_native` | High. `completed` and `completed_with_receipt_sync_failure` remain terminal and uncertain prior attempts reconcile before reuse. |
| Self-identification shadow | graph scheduler migration `campaign-content-factory-shadow-v1`; cron `6fd3…a03` | cron shadow | read-only | graph-owned ingress/replay/child and verifier receipts; pinned Factory adapter; explicit empty and policy-skip terminal outcomes; zero provider writes | `governed-task-execution@1.0.0` with immutable `campaign-factory` lane contract | `graph_native` | Medium. The repaired 07:00 slot selected exactly one candidate and completed with a valid `completed_policy_skip` receipt because shared-account admission detected the existing Instagram slot. `self-id-1100` remains reserved for its separately approved natural canary. |
| Self-identification readiness monitor | historical isolated OpenClaw cron `91fb…54d` | completed observer | read-only | retained cron history and evidence report | verification/health graph | `obsolete` | Low. Observer self-deleted after terminal proof; retain evidence only. |
| Continuous social digest | graph scheduler migration `continuous-marketing-digest-v1`; cron `25a7…113a` | daily cron | local evidence; one Telegram delivery | graph-owned evidence load, delivery intent, bounded retry, reconciliation, child/verifier receipts and terminal receipt | `digest-delivery@1.0.0` | `graph_native` | Medium. Delivery capability remains single-use and bound to the configured digest schedule. |
| Instagram Reel publisher | cron `2c70…256e`, disabled | none while disabled | external public | historical runner/outbox evidence plus loaded v2 graph proof | `deterministic-social-publication@2.0.0` | `obsolete` as an active workflow; historical disabled job retained | High. There is no active owner or next run. Any future Reel publication is a new, separately reviewed one-run live activation rather than continued legacy authority. |
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
| Campaign Factory | `governed-task-execution@1.0.0` / `campaign-factory` | cron `6fd3…a03` invokes `campaign-content-factory-shadow-v1` | recovered 07:00 trigger `gst_9611…6ca9`; child `gcr_abcc…1ddf` and verifier `gvr_fb7f…814e` chains pass with zero effects | `graph_native`; repaired trigger completed `completed_policy_skip`; natural unique canary proof remains pending and `self-id-1100` remains reserved |

The live production portfolio contains nine exact definitions. All six newly
transferred migrations plus the existing Instagram migration are recorded
`graph_owned`. The scoped registry contains no active `graph_wrapped_legacy`,
legacy-approved or `unknown` row. The disabled Reel job is historical evidence,
not an active owner.
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

## Threads readiness scheduler-path repair

The first graph-owned readiness invocation at 05:06 Europe/London failed before
trigger reservation with `graph_scheduler_migration_not_active_or_exact`. The
canonical migration was not missing, inactive or hash-mismatched: migration
`threads-readiness-v1` was already `graph_owned`, bound to cron
`abb3e214-0ff6-4813-a18d-6d8ffb9080ad`, graph
`threads-readiness@1.0.0`, and immutable definition hash
`419f6c6380b43cbc6f7336dc747e6de1d83940ff095e9491224d4ba0bf43779f`.
The failed standalone cron process had resolved a cwd-local scheduler database
because it did not inherit the service-only state environment. Commit `bedd2f9`
pins standalone governed triggers to the production scheduler database unless
an exact scheduler path or state root is supplied.

Natural readiness runs at 05:30, 06:00 and 06:30 then completed against the
exact active migration. The 06:30 run
`grzwcanary_25e60dbc-7168-453b-a053-7f2d6406f1ff` recorded zero provider writes
and zero Browser Relay calls; the cron readback reports `lastRunStatus=ok` and
`consecutiveErrors=0`, so the prior failure alert is cleared.

The portfolio cutover coordinator is also ordered defensively: it commits the
immutable `graph_owned` activation before repointing the cron, classifies the
retained owner on replay, completes an interrupted post-activation repoint,
and restores only the retained legacy job before rolling the migration back if
repoint or readback fails. Focused regression coverage now distinguishes
missing, inactive, mismatched and exact migration records and proves rollback,
concurrent replay admission, restart recovery and preservation of the existing
Instagram graph owner.

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

## 2026-08-04 Campaign Factory completion-contract closure

The 07:00 Europe/London run was not an empty-candidate case and was not rejected
by freshness, the ten-minute tolerance or deduplication. Trigger
`gst_9611a714bd4ab8ad1811aa2d23ee6ca9` resolved exactly one eligible candidate,
`self-id-0700`, at zero milliseconds lateness. The original child receipt
failed because the image renderer contract lacked `cta`; the installed
immutable renderer then required a writable temporary staging copy. The graph
correctly remained failed-safe with no external effects.

Commits `26507a3` and `30254ad` add the explicit
`completed_no_eligible_opportunity` terminal contract, exact-candidate Factory
scoping, immutable receipt outcome propagation, writable ephemeral renderer
staging, and zero-effect failed-safe replay as a new graph attempt. The graph
definition itself did not change. Migration `campaign-content-factory-shadow-v1`
remains pinned to `governed-task-execution@1.0.0` hash
`ad9c80668bc0b348bf48abe5fe2cf4854b95d38682b64f67e6bcf53ee45f240b`.

After restart, the same scheduler slot completed on attempt 3 through graph run
`grzwcanary_025f3f72-ca8e-428a-a375-d621c3165098`. It selected the unique 07:00
candidate, rendered and validated one local image package, then correctly
recorded `completed_policy_skip` because shared-account admission found an
`account-slot-collision` with the existing Instagram schedule. Child receipt
`gcr_abccb29f-6a77-4dde-ad22-7c17023e1ddf` has hash
`61d790507cd193048162b84d39577ade0f9f1cb0d4d0e79a32809f6d588493dd`;
verifier receipt `gvr_fb7f10fe-9d73-41b0-a60b-02fde670814e` passed. Provider
writes, graph external effects and Browser Relay calls were zero. The result is
a healthy policy no-op, not the natural unique canary proof, so `self-id-1100`
and its approval remain unused.

The Gateway cron remains enabled with its unchanged expression and exact graph
payload; its durable scheduler slot is healthy and completed. Gateway cron
history still shows the original 07:00 command error until the next natural
11:00 run updates that outer status, so the natural cron proof and alert clear
are explicitly pending rather than inferred from the injected recovery.

Exact active scheduled ownership is now:

| Migration | Schedule | Owner | State |
|---|---|---|---|
| `phase-g-instagram-image-v1` | `24afbb84-457c-41bb-92c9-24a19725e984` | graph scheduler | `graph_owned` |
| `threads-early-text-v1` | `68b10c5c-f604-4567-9213-d0d1eab08106` | graph scheduler | `graph_owned` |
| `threads-daily-image-v1` | `083e3560-40fd-4487-9d78-674f64866ef7` | graph scheduler | `graph_owned` |
| `threads-readiness-v1` | `abb3e214-0ff6-4813-a18d-6d8ffb9080ad` | graph scheduler | `graph_owned` |
| `meta-reply-monitor-v1` | `4de811aa-f213-4cc3-b1aa-6c2cffb6a847` | graph scheduler | `graph_owned` |
| `campaign-content-factory-shadow-v1` | `6fd37958-b450-400e-8c06-a781670f3a03` | graph scheduler | `graph_owned` |
| `continuous-marketing-digest-v1` | `25a7ffd8-d777-4dc5-a49a-76a229a5113a` | graph scheduler | `graph_owned` |

Business value, scoped task queue, market research and Git monitor remain
graph-owned ingress lanes under `governed-task-execution@1.0.0`. Disabled or
completed historical crons are `obsolete`; there is no remaining active legacy,
graph-wrapped or unknown owner in the canonical scope.

## 2026-08-04 Digest concurrency-exhaustion closure

The 08:30 Europe/London digest slot
`telegram:2026-08-04:08:30:25a7ffd8-d777-4dc5-a49a-76a229a5113a` originally
failed as
`graph_scheduler_http_400:graph_definition_concurrency_exhausted:digest-delivery@1.0.0`.
The concurrency holder was
`grzwcanary_fa6f11f3-1e0c-4183-a3d0-99e90cd45d7c`, a legacy 06:00
`send-digest:2026-08-04` graph-owned task stranded at `deliver_notification`
with approval `gap_4bc711db-bb45-45e3-b772-674f937b1d8e` and no provider
effect.

The root cause was duplicate active ingress: the governed graph scheduler owned
`continuous-marketing-digest-v1`, but the in-process legacy 06:00 cron still
created `send-digest` graph runs. Graph definition concurrency then counted the
non-terminal approval wait against `digest-delivery@1.0.0` capacity.

The repair makes scheduler ownership singular and fail-closed:

- `continuous-marketing-digest-v1` is the only active digest owner for
  schedule `25a7ffd8-d777-4dc5-a49a-76a229a5113a`.
- legacy `send-digest` cron startup and graph-owned task admission now
  policy-skip when that migration is `graph_owned`.
- graph definition concurrency counts only executing capacity
  (`created`, `running`, `compensating`) and not approval waits.
- recovery releases expired resource leases, expires abandoned attempts, fails
  stale effect-free non-terminal runs after wall-clock timeout, and fails
  effect-free runs whose granted mutation approval expires before one-run live
  capability issue.
- failed-safe scheduler contention is recorded durably as `deferred` instead
  of surfacing as an unclassified command crash.
- failed-safe replay is allowed only when observed effects are zero and no live
  capability was consumed; already-granted approval recovery can issue the
  missing one-run capability idempotently.

Runtime recovery terminalised the stale holder as
`recovery_wall_clock_timeout` and a partial replay run
`grzwcanary_a0a3c620-d9f6-4860-9ea6-450b39eaf63d` as
`recovery_approval_expired_before_capability_issue`, both with zero provider
effects. The affected slot then completed through governed graph run
`grzwcanary_125adde3-09e2-4f38-bb7b-a473abb01016`, approval
`gap_7b1b3a49-696d-4be3-bd87-874d47a2ab70`, capability
`glc_aa5e0aa7278d74ff579f53391177dfb3`, child receipt
`gcr_e7c32de5-cce8-4375-b988-5b9947584bb8`, receipt hash
`061a2be14e061a7c3e62695569e3a42974671c77e3c8cfdd1ec3ffcd7ee09962`, and one
`effect_verified` digest operation. A second injected trigger for the same slot
returned `duplicate_suppressed` with zero provider writes.

Post-restart `/api/graphs/health` reported `active=0`, `waiting=0`,
`blocked=0`, `activeLiveCapabilities=0`, and Redis-backed persistence
coordination was healthy and reachable. SQLite showed zero active
`digest-delivery@1.0.0` runs and zero active digest resource leases. The next
natural digest slot resolves to
`telegram:2026-08-05:08:30:25a7ffd8-d777-4dc5-a49a-76a229a5113a`; no future
trigger was executed early.

## 2026-08-04 Threads daily-image zero-write classification

The 16:30 Europe/London `threads-daily-image-v1` trigger
`gst_3016f8f745076068472437e55760488d` completed through graph run
`grzwcanary_5b48d1e5-f9b3-445d-a3eb-c2b06206ca29` with zero provider writes.
Completion alone is not publication proof. Direct graph and scheduler SQLite
inspection classified the slot as a legitimate zero-write skip:

- slot:
  `threads:2026-08-04:16:30:083e3560-40fd-4487-9d78-674f64866ef7`;
- graph status: `completed`, current node `complete`, event chain valid;
- preparation status: `not_ready_before_commit`, action `skip`;
- candidate ID: none; no current outbox/prepared-payload row existed for this
  2026-08-04 16:30 slot;
- approval, live capability, external-effect, child-run receipt and verifier
  receipt rows: none, because no candidate was admitted to publication;
- evidence: `social-preparation-receipt`, `payload-hash` summarised as no
  eligible Threads payload, and `zero-provider-writes`;
- terminal assertion: `threads-publication-receipted` passed from graph
  evidence gate; terminal checkpoint `completion_verified`;
- recovery required: no.

The source scheduler completion message now carries a publication report for
every governed run: graph execution outcome, publication outcome, policy/skip
reason, candidate ID, provider write count, provider post ID or URL when
present, verifier result, recovery requirement and final classification. A
zero-write publication path must no longer report only `completed`; the repaired
classification for this slot is `legitimate_skip`.
