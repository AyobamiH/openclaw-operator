---
title: "Full Graph Campaign and Recurring Workflow Operating-System Audit"
summary: "Authoritative inventory, lifecycle, ownership, migration, execution, failure and runtime reconciliation evidence for the active OpenClaw estate."
---

# Full Graph Campaign and Recurring Workflow Operating-System Audit

Audit snapshot: `2026-08-09T12:09:47+01:00` (`Europe/London`)

Classification: `ARCHITECTURE_RECONSTRUCTED_WITH_RUNTIME_BLOCKERS`

Post-audit runtime addendum (`2026-08-09T17:08:50+01:00`): the Threads
reporting repair is loaded, and the exact 8 August Instagram upload-only effect
has been reconciled through the canonical API to `confirmed_absent` with zero
provider writes. The account ambiguity guard cleared, and the unforced natural
17:00 Reel slot completed and was independently verified by official Meta
readback. The audit snapshot below remains unchanged as historical evidence;
the addendum is proven in
`docs/operations/instagram-ambiguous-effect-reconciliation-and-natural-slot-2026-08-09.md`.

This is the authoritative answer to what autonomous work the inspected estate
should perform, who owns it, how it proves completion, and what is currently
blocked. It is not a claim that all configured work is operational.

## Executive decision

The active estate was not found at the requested
`/home/johnh/.openclaw`; that path does not exist. The actual estate is
`/home/oneclickwebsitedesignfactory/.openclaw`. Canonical portable product
source is `workspace/projects/openclaw-operator`; host schedules, state and
installed runtime data remain outside the repository under the OpenClaw state
and workspace roots.

The system is partially healthy, but the words `ACTIVE`, `completed` and
`published` are not reliable across all layers:

1. Eight of sixteen OpenClaw jobs are enabled. Eleven scheduler migrations
   exist, but both Campaign Factory v3 and v4 say `graph_owned` even though only
   v4 is enabled.
2. Thirteen campaigns are registered `active`, but only
   `campaign-founder-rescue-identification` has ever produced a content spec.
   The other twelve are configured, not operational.
3. Threads did not create the linked post on 9 August. A duplicate trigger
   reused the completed 7 August/8 August state and reported its historical
   effect as current. Source commit `a410276` repairs the report, but the running
   process has not loaded it.
4. Instagram's connector is healthy and authenticated. Publishing is blocked
   by one Graph effect left `ambiguous` on 8 August. Its worker evidence says
   `generatedMediaUploadCalls=1`, `instagramPublishCalls=0`, no provider ID and
   no permalink. That proves a preparatory upload, not an Instagram
   publication. Commit `a410276` repairs future classification. Live
   reconciliation and service loading remain approval boundaries.
5. Campaign Factory instantiates a new in-memory selector when it preplans each
   opportunity and publication history counts only provider-verified posts.
   In shadow mode, history is therefore erased for selection purposes. The
   highest-scoring self-identification campaign wins repeatedly. This is the
   root cause of campaign starvation and remains a product/implementation
   blocker.
6. The 5-minute GitHub workflow monitor is Graph-owned but has no in-flight
   coalescing. 141 governed v1 runs existed by the snapshot, 138 of them GitHub
   monitor runs; multiple completions clustered at `06:07` and `11:35`. The
   work is operational but can overlap and accumulate.
7. Campaign metrics, conversations, attribution edges and campaign-engine
   reconciliation attempts are all zero. Daily and weekly reports exist, but
   there is no measurement or feedback loop to operate on.
8. Three host crons bypass Graph. Two synchronize documentation repositories;
   one polls every two minutes and can automatically commit and push a
   milestones feed. The latter is presently dormant because its data file is
   absent, but it is still a legacy external-write authority.

## Evidence and scope

Evidence came from canonical source, Git history, OpenClaw cron state, the
Graph scheduler and run databases, deterministic publishing state, systemd
unit truth, user/system cron, service journals, local reports/receipts, and
read-only official connector health. No browser or Browser Relay was used. No
provider write, retry, live reconciliation, schedule mutation, restart, push,
deployment or permission change occurred.

Key immutable source hashes at the snapshot:

| Artifact | SHA-256 |
|---|---|
| Graph workflow definitions source | `05117209119ce62d3e6160dd97a38a2c2523e3709bf69bdb6fcac73899aaeb85` |
| Scheduler portfolio | `92bcb78e0d88bad2ac97a8ff0565ecbbf361731829b08953eb278a83b492f424` |
| Campaign registry | `68673f5f9741b32a37291889925faeaed5b327b379f68257408216c44970563c` |
| Production integration | `1a65d0cf2fe48405fb2f814d26acd0b519a8bc3e8d6ba93a3a15e02ec531e9a5` |

## A/C. Complete Graph and recurring-work inventory

The tables below preserve apparently similar workflows as separate rows.

### Graph-owned scheduled workflows

Common trigger is OpenClaw's persistent cron scheduler. Common scheduler state
is `graph-scheduler.sqlite`; run/effect/evidence state is `graph-runs.sqlite`.
Every external social owner is limited to one publication/reply write per
logical slot and uses official-provider workers only.

| Workflow | Purpose / expected output | Frequency and schedule | Graph owner; version; hash prefix | Entrypoint → worker/adapter | State and effects | Approval / maximum writes | Verification, completion, reconciliation, retry/recovery | Last attempt / last success | Loaded and migration status | Operational status |
|---|---|---|---|---|---|---|---|---|---|---|
| Threads readiness | Prepare future deterministic Threads opportunities; zero-write receipt | Every 30 minutes, London | `threads-readiness@1.0.0`; `419f6c6380b4` | governed trigger script → `threads-readiness-preparer.mjs` → `production.threads-readiness-prepare.v1` | readiness/outbox artifacts; no provider effect | local persistent; 0 | assertion `threads-readiness-zero-write`; trigger uniqueness; failed-safe recovery | `12:00` local completed | enabled; `graph_owned`; runtime loaded | `LIVE/COMPLETED` (23 today by snapshot) |
| Threads early text | Publish or legitimately skip an exact 05:00/07:00 text slot | `0 5,7 * * *`, London | `threads-publication@1.0.0`; `0744f0a6fe8d` | trigger script → `threads-outbox-runner.mjs` → prepare/live/readback v1 | outbox, Graph effect, provider object when written | exact payload approval/capability; max 1 | provider receipt assertion, official readback, slot idempotency, no blind retry | 07:00 slot referenced historical run; 05:00 current run completed | enabled; `graph_owned`; runtime loaded | `VERIFIED_BUT_MISREPORTED`; current write 0 |
| Threads image | Publish or skip exact image package | `30 11,16,21 * * *`, London | `threads-publication@1.0.0`; `0744f0a6fe8d` | same worker; image preparation/media proof | outbox/media/Graph effect | exact approval/capability; max 1 | same receipt/readback; failed-safe trigger retained | 11:30 failed-safe; last completed 8 Aug 11:30 | enabled; `graph_owned`; runtime loaded | `FAILED/BLOCKED` |
| Instagram image | Publish one verified feed image | `0 5,7,9,11,13 * * *`, London | `deterministic-social-publication@2.0.0`; `995ff8355a57` | trigger → Instagram runner → prepare/live/readback v2 | outbox, claim, media, envelope, effect, provider object | exact dated payload approval + one-run capability; max 1 publication | three completion assertions; official readback; account ambiguity guard; failed-safe recovery | 05:00, 07:00, 09:00 all failed-safe; last completed 8 Aug 13:00 | enabled; `graph_owned`; runtime loaded | `BLOCKED` by prior ambiguous effect |
| Instagram Reel | Publish one verified Reel | `0 15,17,19,21,23 * * *`, London | `deterministic-social-publication@2.0.0`; `995ff8355a57` | same v2 owner with Reel renderer | same, plus storyboard/readability/media upload | exact approval/capability; max 1 publication | same; upload/container reconciliation before publication | last attempt 8 Aug 23:00; last completed 6 Aug 23:00; first 9 Aug slot not due at snapshot | enabled; `graph_owned`; runtime loaded | `BLOCKED` by prior ambiguous effect |
| Meta reply monitor | Discover owned-thread replies/comments, prepare/reply when eligible | minute 15 hourly, London | `meta-reply-monitor@1.0.0`; `079c29a4061b` | trigger → `meta-reply-monitor-outbox-runner.mjs` → prepare/live/readback v1 | monitor outbox and Graph effects | exact reply approval/capability; max 1 | receipt assertion; receipt-only reconciliation; confirmed absence terminal | 10:15 local completed; 11/11 today completed | enabled; `graph_owned`; runtime loaded | `LIVE`, but historical provider-readback mismatch remains |
| Campaign Factory v4 | Generate, render, audit and shadow-execute one five-opportunity campaign package; emit commercial reports | `0 5,7,11,15,17 * * *`, London | `governed-task-execution@1.0.0`; `ad9c80668bc0` | Graph governed child → `campaign-content-factory` → deterministic engine/render/operations | publishing DB; artifacts; daily/weekly reports; zero provider write | local persistent; max 0 | child + verifier receipts; terminal receipt; content/media audit; trigger idempotency | 07:00 completed; 2/2 today completed | enabled; v4 `graph_owned`; v3 also incorrectly `graph_owned` but disabled | `SHADOW/PARTIALLY_OPERATIONAL` |
| Daily growth digest | Summarize last 24h verified marketing evidence to notification channel | `30 8 * * *`, London | `digest-delivery@1.0.0`; `0930dfa7392a` | trigger → `send-digest` child → notifier | digest artifact and notification effect | standing exact; max 1 reversible notification | child/verifier receipt assertions; delivery receipt; prior-delivery reconciliation | 08:30 completed; 12 historical verified objects summarized | enabled; `graph_owned`; runtime loaded | `LIVE/COMPLETED`, but historical/current wording needs scrutiny |

### Recurrent work outside the persistent Graph scheduler

| Workflow | Purpose / output | Owner and trigger | Graph binding | State / verification / recovery | Recent evidence | Status/divergence |
|---|---|---|---|---|---|---|
| Orchestrator heartbeat | Queue liveness marker | in-process node-cron `*/5 * * * *` | none | task execution/history; missed-heartbeat detector checks every 10m, alerts after 15m | continuous journal completions | `LIVE`; `LEGACY_BYPASS` from Graph vocabulary |
| OpenClaw agent heartbeat | Main-agent proactive checks | OpenClaw agent config every 1h, isolated/light context | none | session/heartbeat state; conversational result | configured and enabled | `LIVE`; separate operator-layer mechanism, justified domain difference |
| Business-value cycle | Rank evidence-backed business work and enqueue one bounded task | in-process node-cron `17 */6 * * *`; startup recovery | parent `governed-task-execution@1.0.0`; children use v1.0/v1.1 | business scheduler file/state; fingerprint, cooldown, backoff, active lock; child/verifier receipts | 00:17 completed; 06:17 correctly `not-due` by 1.8s | `LIVE`; scheduler is not persistent OpenClaw cron |
| Business-day pulse | Force a revenue/business-value evaluation | node-cron `17 8-17 * * 1-5`, London | same parent | same state; `force=true`; approval-gated candidates remain blocked | Sunday at snapshot, not due | `INTENDED_INACTIVE_TODAY` |
| GitHub workflow monitor | Poll latest workflow truth | `setInterval` every 5m plus startup | `governed-task-execution@1.0.0` | Graph ingress bucket idempotency; child/verifier receipt | 138 completed today; clustered completions prove overlap/backlog | `LIVE/DUPLICATED_EXECUTION_PATH` at concurrency level |
| Nightly batch | Drain pending docs, select Reddit leads, create digest/approval requests | in-process `0 23 * * *` (host timezone) | none | local state + digest JSON + approval records | 8 Aug 23:00 completed, selected 0 | `LIVE/LEGACY_BYPASS`; no Graph lifecycle |
| Legacy 06:00 digest guard | Retained rollback owner | in-process `0 6 * * *` | policy checks Graph digest migration | log-only policy skip when Graph owns digest | 06:00 policy-skipped | `LEGACY`, intentionally non-executing |
| Document watching | Index source changes and enqueue `doc-change` | chokidar add/change/unlink | none | pending-doc buffer, doc version, task result | watchers enabled after startup | `LIVE/UNREGISTERED` recurring event loop |
| Startup recovery | Rehydrate retries, reconcile stale locks, recover due business cycle, warm index, startup task | orchestrator start | mixed | retry records, scheduler state, Graph recovery report | current service startup resumed 0 Graph runs and blocked 0 | `LIVE`, justified lifecycle hook |
| Alert cleanup | Remove alerts older than 48h | `setInterval` every 6h | none | in-memory/local alert state; log count | configured | `LIVE/UNREGISTERED` |
| Missed-heartbeat detector | Raise critical alert when heartbeat stale | `setInterval` every 10m | none | alert manager | configured; no current critical evidence | `LIVE/UNREGISTERED` |
| Docs mirror sync | Refresh OpenClaw documentation mirror | host crontab `0 */6 * * *` | none | Git clone/fetch + local `rsync --delete`; shell exit only | schedule installed | `LIVE/LEGACY_BYPASS` |
| Cookbook mirror sync | Refresh OpenAI Cookbook mirror | host crontab `15 */6 * * *` | none | same | schedule installed | `LIVE/LEGACY_BYPASS` |
| Milestones feed push | Commit/push feed changes | host crontab every 2m | none | script checks data file and Git diff, then commits/pushes | target data file absent; current runs no-op | `DORMANT_DANGEROUS_LEGACY_BYPASS` |
| Knowledge integration | Historical snapshots/consolidation/cleanup | code supports startup integration and retention cleanup | none | current `fastStartMode` skips startup integration; persistence health says file store, 0 historical collections | not active in current PID | `INTENDED_INACTIVE/SHADOW` |
| Review-session sampling | Collect review telemetry only while a review session is active | service-owned interval | none | review session state; currently 0 sessions/samples | inactive | `CONDITIONAL/INTENDED_INACTIVE` |

`rss-sweep`, `market-research`, `content-generate`, `qa-verification` and
`system-monitor` are implemented task capabilities, but no independent
recurring schedule was found. They run only as selected/child/on-demand work.
They must not be described as daily autonomous jobs.

## B. Campaign inventory

Common product contract: immutable registry input; constrained templates;
evidence/claim validation; deterministic candidate score; Threads/Instagram
channels; five global opportunities; Campaign Factory Graph; shadow worker;
provider measurement when available; experiments require separate approval.
The actual current schedule sets `primaryCampaignType=self-identification`.

| Campaign | Objective / audience problem | Product; family | Priority; cap/cooldown | Generation and rotation | Measurement / feedback / termination | Actual evidence | Status |
|---|---|---|---|---|---|---|---|
| `campaign-openclaw-proof` | Prove governed AI workflow trust to governed-AI operators | OpenClaw Operator; proof/evidence | .95; 1/day; 24h | deterministic templates; nominal score rotation | provider metrics + attribution; no data; no termination criterion beyond registry state | 0 specs, 0 publications | `ACTIVE_CONFIG_ONLY` |
| `campaign-founder-rescue-identification` | Help founders recognise technical delivery friction | Founder Rescue; self-identification | .90; 1/day; 36h | always wins fresh selector's primary pool | same; shadow outcomes do not affect selector history | 30 specs, 30 publications, 21 shadow-verified, 0 provider-verified | `SHADOW_OPERATIONAL/STARVING_OTHERS` |
| `campaign-coding-agent-diagnostic` | Diagnose evidence gaps for engineering teams | Coding Agent Skills; practical diagnostic | .88; 1/day; 24h | nominal | no metric rows | 0/0 | `ACTIVE_CONFIG_ONLY` |
| `campaign-wagging-web-diagnostic` | Diagnose website conversion friction | Wagging Web Wins; practical diagnostic | .86; 1/day; 24h | nominal | no metric rows | 0/0 | `ACTIVE_CONFIG_ONLY` |
| `campaign-tax-lien-product-proof` | Prove tax-lien data workflow | Tax Lien Platform; proof/evidence | .72; 1/day; 48h | nominal | no metric rows | 0/0 | `ACTIVE_CONFIG_ONLY` |
| `campaign-tax-lien-self-identification` | Help investors recognise data-workflow friction | Tax Lien Platform; self-identification | .85; 1/day; 48h | eligible primary but never selected | no metric rows | 0/0 | `ACTIVE_CONFIG_ONLY` |
| `campaign-tail-wagging-services` | Help small firms recognise website conversion friction | Tail Wagging Services; self-identification | .84; 1/day; 24h | eligible primary but never selected | no metric rows | 0/0 | `ACTIVE_CONFIG_ONLY` |
| `campaign-social-agent-proof` | Prove safe social-publishing reliability | Social Agent; proof/evidence | .82; 1/day; 36h | nominal | no metric rows | 0/0 | `ACTIVE_CONFIG_ONLY` |
| `campaign-founder-problem-education` | Explain founder delivery friction | Founder Rescue; problem education | .80; 1/day; 36h | excluded while primary pool is repeatedly treated as needed | no metric rows | 0/0 | `ACTIVE_CONFIG_ONLY` |
| `campaign-founder-observation` | Share bounded founder observations | Founder Rescue; founder observation | .79; 1/day; 36h | same | no metric rows | 0/0 | `ACTIVE_CONFIG_ONLY` |
| `campaign-social-agent-product-update` | Report evidence-backed Social Agent updates | Social Agent; product update | .78; 1/day; 36h | same | no metric rows | 0/0 | `ACTIVE_CONFIG_ONLY` |
| `campaign-openclaw-community-discussion` | Start governed-AI community discussion | OpenClaw Operator; community discussion | .77; 1/day; 24h | same | no metric rows | 0/0 | `ACTIVE_CONFIG_ONLY` |
| `campaign-coding-agent-research-insight` | Share evidence-backed agent workflow research | Coding Agent Skills; research insight | .76; 1/day; 24h | same | no metric rows | 0/0 | `ACTIVE_CONFIG_ONLY` |

Both experiment records are `paused`, `approved=false`. Phase 7 is correctly
inactive. There are zero rows in campaign metrics, conversations,
attributions and reconciliation attempts. Campaign reports exist at
`artifacts/business-value/marketing/campaign-commercial-reports/`, but they
cannot close a feedback loop without evidence.

## D. Daily execution map

This map is chronological in `Europe/London`. `As observed` covers the day up
to the audit snapshot; later slots are expected, not yet classified.

| Time | Expected work / owner | Expected business outcome and effect | Proof / recovery | 9 Aug classification |
|---|---|---|---|---|
| 00:00–23:59 / :30 | Threads readiness | future opportunity prepared; no provider write | zero-write assertion; failed-safe trigger | `COMPLETED` through 12:00 |
| :15 hourly | Meta reply monitor | discover/reconcile/reply at most once | receipt + official readback; receipt-only recovery | `COMPLETED` 11/11 through 10:15; no new reply proved |
| every 5m | Orchestrator heartbeat | liveness marker | 15m detector | `COMPLETED`, with one journal gap during audit load but recovered |
| every 5m | GitHub monitor | current CI/workflow state | child/verifier receipt | `COMPLETED`, but overlapping/backlogged executions occurred |
| 00:17 | Business-value cycle | select highest-value safe work | scheduler lock/backoff; Graph child receipt | `COMPLETED`; selected QA for Tax Lien Platform |
| 05:00 | Threads text | one new verified text or truthful skip | provider readback / no blind retry | `VERIFIED_BUT_MISREPORTED`; zero current writes |
| 05:00 | Instagram image | one verified feed image | v2 assertions / reconcile ambiguity first | `FAILED/BLOCKED` |
| 05:00 | Campaign Factory | early-discovery package/report, zero write | child/verifier receipt | `COMPLETED`; founder-rescue only |
| 06:00 | Legacy digest guard | no effect when Graph digest owns delivery | policy-skip log | `SKIPPED_BY_POLICY` correctly |
| 06:17 | Business-value cadence | due-only evaluation | next-run timestamp | `SKIPPED_BY_POLICY` (`not-due`, next time 1.8s later) |
| 07:00 | Threads text | one new verified text or truthful skip | same | `DUPLICATE_SUPPRESSED`, but runtime falsely said published |
| 07:00 | Instagram image | one verified image | same v2 recovery | `FAILED/BLOCKED` |
| 07:00 | Campaign Factory | recognition package/report | same | `COMPLETED`; founder-rescue only |
| 08:17–17:17 weekdays | Business-day pulse | forced revenue/value evaluation | same Graph parent | `INTENDED_INACTIVE_TODAY` (Sunday) |
| 08:30 | Daily growth digest | one notification with separated current/historical truth | delivery/verifier receipts | `COMPLETED`; report said 12 historical verified objects |
| 09:00 | Instagram image | one verified image | same | `FAILED/BLOCKED` |
| 11:00 | Campaign Factory + Instagram image | problem-insight package and image | same | Factory not yet triggered at snapshot; Instagram expected blocked |
| 11:30 | Threads image | one verified image or truthful skip | readback; failed-safe recovery | `FAILED/BLOCKED` |
| 13:00 | Instagram image | one verified image | same | `NOT_DUE_AT_SNAPSHOT` |
| 15:00 | Campaign Factory + Reel | practical-outcome package and Reel | same | `NOT_DUE_AT_SNAPSHOT`; Reel expected blocked until reconciliation |
| 16:30 | Threads image | one verified image | same | `NOT_DUE_AT_SNAPSHOT` |
| 17:00 | Campaign Factory + Reel | conversation package and Reel | same | `NOT_DUE_AT_SNAPSHOT` |
| 19:00, 21:00, 23:00 | Reels | verified Reels | same | `NOT_DUE_AT_SNAPSHOT` |
| 21:30 | Threads image | verified image | same | `NOT_DUE_AT_SNAPSHOT` |
| 23:00 | Nightly batch | drain docs/select leads/create digest and approvals | digest JSON + task result | next occurrence not due; previous completed with 0 selected |

## E. Pre-Graph to Graph migration ledger

| Pre-Graph capability | Original implementation / safety / completion | Graph equivalent | Migration status / behavioural difference | Consequence |
|---|---|---|---|---|
| Threads text/image | canonical outbox runner; official API; locked idempotency; provider readback | `threads-publication@1.0.0`, readiness helper | workers retained as adapters; Graph owns schedule/approval/effect | migrated, but duplicate notification confused historical and current state |
| Instagram image/Reel | canonical Instagram runner; local rendering; upload/publish/readback and ambiguity guard | social publication v2 | migrated; upload and publication were collapsed into one effect classification | preparatory upload left publication effect ambiguous and blocked account |
| Meta reply monitor | deterministic discovery/outbox/reply/readback | `meta-reply-monitor@1.0.0` | migrated; prior receipts once disagreed with official readback | operational but receipt truth needs continued verification |
| Five-opportunity Self-Identification campaign | deterministic registry/selector/engine in zero-write shadow | governed task v1 Campaign Factory | migrated scheduler and child receipt; selector history reset in preplanning/shadow | one campaign executes; portfolio promise not met |
| Business-value parent | direct planner and task queue | governed task v1 | migrated | parent lifecycle is Graph-owned |
| Business-value children | queue-owned content/research/QA/monitor tasks | governed task v1 research; v1.1 content/QA/system | completed in prior hard cutover | child/verifier receipts now close lifecycle |
| Daily digest | in-process 06:00 notification | digest graph 08:30 | Graph owner active; legacy cron retained as policy-skip | correct single execution owner with rollback trace |
| Heartbeat/nightly/docs/alerts | in-process cron/interval/watchers | none | not migrated | split lifecycle vocabulary and evidence quality remain |
| Host documentation sync | shell cron | none | not migrated | operational outside Graph governance |
| Milestones auto-push | shell cron + Git push | none | not migrated/dormant | hidden external mutation authority remains installed |
| Metrics/attribution/experiments | registry contracts and reporting | Campaign Factory operations child, not a dedicated Graph | partially migrated; no connectors/data; experiments paused | reporting exists without feedback data |

## F. Canonical Graph lifecycle specification

The implementation does not contain one literal universal node list. The
canonical kernel contract reconstructed from code is:

`ingress → validate immutable identity/input → reconcile prior logical work →`
`prepare/bind intent → authority and idempotency gate → execute bounded adapter`
`→ observe/classify effect → verify receipts/readback → assert completion →`
`checkpoint/persist hash-chained evidence → report this invocation`.

Per-stage contract:

| Stage | Input / output | Persistent state | Failure / retry / recovery semantics |
|---|---|---|---|
| Ingress | graph ID/version/hash, objective, correlation/logical ID, input, authority → immutable run | graph run + initial event/checkpoint | invalid definition/input fails before effect |
| Resolve/validate | schedule slot/candidate/policy → eligible or explicit skip | run data/evidence | policy skip is terminal zero-write, not success-by-history |
| Reconcile prior | prior trigger/run/effect/outbox → confirmed present/absent/ambiguous | effect and reconciliation evidence | ambiguity blocks; no blind write retry |
| Prepare/bind | canonical payload/media/envelope/hash → frozen intent | outbox/claim/evidence | local repair/retry allowed where declared; no provider write |
| Authority/idempotency | approval, capability, account, duplicate and effect intent → reserved dispatch | approval/capability/effect/claim | conflict blocks; one-run capability cannot widen authority |
| Execute | exact adapter input → bounded effect result | attempt + live dispatch + provider receipt | per-node retry only for declared transient categories; ambiguous is not retryable |
| Classify | current invocation effect plus preparatory effects → verified/absent/ambiguous | external-effect state | preparatory upload must not imply publication |
| Verify | independent receipt/readback/hash checks → assertions | verifier receipts/evidence | failed verification blocks/fails; confirmed absence is safe recovery evidence |
| Complete | all required assertions/effects terminal → completed checkpoint/terminal receipt | checkpoint, child receipt, hash chain | scheduler completion contract must pass; otherwise failed-safe/ambiguous |
| Report | current invocation, historical references and business outcome → notification/artifact | scheduler evidence/digest | current writes must be zero on duplicate suppression |

Implemented domain mappings:

- governed tasks v1/v1.1: `ingress → validate_payload_contract →`
  `reconcile_prior_attempt → dispatch_effect_adapter → verify_receipts →`
  `package_terminal_receipt → complete`;
- digest: `schedule_ingress → load_latest_digest → reconcile_prior_delivery →`
  `deliver_notification → verify_receipts → complete`;
- Threads/Meta v1: `schedule_ingress → prepare_exact_effect → route_effect →`
  `perform_exact_effect → reconcile_provider_state → package_terminal_receipt → complete`;
- Instagram/social v2: 25 stages from intake/state load through slot selection,
  policy, claim, frozen payload/media/envelope, approval/effect intent, provider
  execution/reconciliation, official readback, identity verification, local
  commit, claim finalization, evidence packaging and completion.

## G. Graph ownership map

| Capability | Intended authority | Actual competing/bypass authority | Verdict |
|---|---|---|---|
| Threads readiness/text/image | corresponding persistent Graph migration | no enabled legacy social schedule found | single owner |
| Instagram image/Reel | social v2 Graph schedules | no enabled legacy publisher schedule found | single owner, shared ambiguity guard |
| Meta replies | Meta Graph schedule | no enabled direct worker schedule found | single owner |
| Campaign Factory | v4 schedule | v3 migration still `graph_owned` in DB but cron disabled; v2 prepared; v1 rolled back | physical single owner, state ownership ambiguous |
| Daily digest | Graph 08:30 | legacy 06:00 cron remains but policy-skips | controlled dual declaration, single effect owner |
| Business-value | in-process cron calling Graph | no persistent schedule | split trigger/Graph execution owner, intentional but inconsistent |
| GitHub monitor | interval calling Graph | startup call uses same owner | one logical owner, concurrent invocations not coalesced |
| Heartbeat/nightly/docs/alerts | in-process owner | none | ungoverned by Graph |
| Host sync/push | shell cron | none | external legacy bypass |

## H. Divergence ledger

| Severity | Classification | Evidence / why it exists | Consequence | Disposition |
|---|---|---|---|---|
| Critical | `REPORTING_DIVERGENCE` | duplicate branch counted sealed historical effect and permalink as current | false “published today” claim | repaired in local commit `a410276`; not loaded |
| Critical | `STATE_MODEL_DIVERGENCE` / `IDEMPOTENCY_DIVERGENCE` | Instagram upload count made publication effect ambiguous even with `instagramPublishCalls=0` | all later Instagram work blocked | future classifier repaired in `a410276`; live effect still unreconciled |
| High | `MIGRATION_REGRESSION` / `CAMPAIGN_ROTATION_DIVERGENCE` | fresh in-memory preplanner + provider-verified-only history in shadow | 12/13 active campaigns never execute | unresolved; requires selector/shadow-history design and replay |
| High | `REPORTING_DIVERGENCE` | dependency readiness still says no natural v3 trigger/runtime unverified after natural v4 proof | stale operator truth | unresolved source record |
| High | `DUPLICATE_EXECUTION_PATH` | GitHub monitor starts every 5m without active-run coalescing | redundant overlapping/backlogged Graph work | unresolved source repair |
| High | `LEGACY_BYPASS` | two repo-sync crons and dormant auto-push cron operate outside Graph | incomplete governance; potential unexpected push | requires explicit scheduler decision |
| Medium | `STATE_MODEL_DIVERGENCE` | Campaign v3 and v4 migrations both `graph_owned`, only v4 enabled | ownership query can lie | live DB correction requires approval |
| Medium | `REPORTING_DIVERGENCE` | v4 enabled job description says “Disabled rollback placeholder” | operator confusion | cron metadata update requires approval |
| Medium | `ORPHANED_WORKFLOW/STATE` | several zero-byte obsolete Graph/publisher DB paths remain beside active DBs | archaeology and wrong-store risk | inventory only; deletion not authorized |
| Medium | `SCHEDULER_DIVERGENCE` | persistent OpenClaw cron, in-process cron/interval, file watchers and host cron all coexist | no single schedule registry | architectural backlog |
| Medium | `COMPLETION_CONTRACT_DIVERGENCE` | heartbeats/nightly/watchers rely on task/log state, unlike Graph assertions/receipts | weaker proof | normalize future recurrence ownership |
| Medium | `REPORTING_DIVERGENCE` | campaign `active` means registry-eligible, not executed | 12 false operational impressions | report now distinguishes config vs operation |
| Low | `JUSTIFIED_DOMAIN_DIFFERENCE` | startup recovery and file watchers are event/lifecycle driven | cron mapping inappropriate | retain, but register/document |
| Low | `JUSTIFIED_DOMAIN_DIFFERENCE` | hourly OpenClaw agent heartbeat is conversational operator work | separate from deterministic orchestrator heartbeat | retain separate vocabulary |

## I. Failure and recovery matrix

No external effects were created for testing. Evidence comes from deterministic
tests, schema/contracts and historical receipts.

| Mode | Governed local task | Social publication | Digest/notification | Campaign shadow |
|---|---|---|---|---|
| Success | child succeeds, verifier passes, terminal receipt | one effect verified by official readback | delivery + verifier receipts | artifact/audit + zero-write child receipt |
| Duplicate trigger | ingress ID reuses run | slot trigger suppresses; current writes must be 0 | delivery reconciliation/idempotency | slot/content hash prevents repeat |
| Early/late | caller-defined ingress | five-minute early window; bounded lateness tolerance; otherwise no trigger | natural slot only | bounded natural slot |
| Restart before effect | persisted retries/startup recovery | trigger/run/outbox recovered | prior delivery reconciled | Graph/slot replay |
| Crash during effect | child failure receipt / retry category | effect remains sent/accepted/ambiguous; reconcile only | delivery ambiguity must reconcile | no external write in shadow |
| Crash after effect | verifier closes or blocks | provider readback before any retry | receipt verification | terminal artifact replay |
| Timeout/network/5xx | declared retryable with max attempts | Instagram v2 declares transient retry categories, but ambiguity forbids blind retry | retryable categories declared | local renderer/task retry only |
| Provider 4xx | terminal/provider-rejected | confirmed absence if no publication call; otherwise failure/ambiguity | notification failure | not applicable |
| Failed verification | terminal failed/repairable | failed-safe/blocked; never call published | completion contract fails | audit not ready |
| Confirmed absence | safe terminal evidence | no publication occurred; later authorized slot may proceed after reconciliation | no delivery | legitimate shadow zero-write |
| Confirmed presence after timeout | verifier seals existing effect | effect verified, no replay | delivered, no replay | not applicable |
| Scheduler restart | persistent Graph trigger DB | same slot/trigger recovered | same | same |
| Graph DB restart | SQLite/WAL and startup recovery | active effects block until reconciliation | persisted | persisted child receipt |
| Reporting after recovery | terminal receipt | must distinguish recovery current activity from historical effect | same | same |

Coverage added in this audit proves duplicate-suppressed historical effects are
reported as zero current writes and proves upload-only Instagram outcomes are
`confirmed_absent`, while contradictory IDs remain `ambiguous`.

## J. Runtime schedule matrix

| Scheduler | Active declarations | Health | Truth gap |
|---|---:|---|---|
| OpenClaw persistent cron | 8 enabled / 16 total | enabled; enabled jobs report `ok` at snapshot | v3/v4 migration-status conflict; bad v4 description |
| Graph scheduler DB | 11 migrations | event/trigger state readable; active jobs produce receipts | v3 and v4 both `graph_owned`; historical rows retained |
| Orchestrator in-process cron | 5 jobs | current PID journal proves heartbeat/business/digest policy | not centrally registered/persistent |
| Orchestrator intervals/watchers | GitHub, missed heartbeat, alerts, docs, conditional reviews | running | no unified inventory or coalescing |
| OpenClaw agent heartbeat | hourly | configured | distinct conversational semantics |
| Host crontab | 3 jobs | installed | outside Graph; auto-push authority |
| systemd timers | no OpenClaw-specific timer | no conflict found | none |

## K. State/effect semantic specification

- **Workflow:** versioned executable lifecycle and its contracts; not a cron
  line.
- **Campaign:** business objective, audience/problem, sources, generation,
  eligibility, channels, measurement and termination; `active` means eligible
  in configuration only.
- **Scheduled slot:** one timezone-bound expected opportunity.
- **Logical run:** the durable identity for one workflow and logical unit.
- **Invocation:** one scheduler/caller interaction now; it may reuse a logical
  run but must not inherit its effect count as current activity.
- **Candidate:** selected business/content/action object, distinct from outbox
  ID, target ID and provider object ID.
- **Attempt:** one node/worker execution under a logical run.
- **Preparatory effect:** external or persistent work enabling an action, such
  as media upload; it is not the publication/action.
- **External write:** consequential provider mutation made by this invocation.
- **Publication/action:** the intended business effect, e.g. provider post or
  reply; only `instagramPublishCalls`, not media upload calls, proves the
  Instagram publication call.
- **Verification:** deterministic receipt and independent readback of exact
  account/payload/media/object.
- **Confirmed presence:** exact owned object is independently observed.
- **Confirmed absence:** evidence proves no intended action occurred; it is not
  a generic failure and not ambiguity.
- **Ambiguity:** presence/absence cannot be decided; blocks retries and later
  account writes where shared safety requires it.
- **Reconciliation:** read-only/evidence-bound resolution of prior ambiguity;
  never a blind replay.
- **Recovery:** resume or terminally classify the original logical run without
  widening authority.
- **Completion:** every required assertion/effect/receipt is terminal and
  persisted; scheduler exit alone is insufficient.
- **Skip:** current invocation intentionally performed no business effect for a
  named policy/eligibility reason.
- **Duplicate suppression:** current invocation performed zero new effects
  because the logical unit already exists; historical effects remain labeled
  historical.
- **Failure:** required work did not complete; must state whether effect is
  absent, present, or ambiguous.

## L/M. Repairs performed and regression tests

Local commit `a410276d429d35da6e7f5181ca0db768fc678bf3`:

1. Makes duplicate-suppressed reports set current `providerWrites=0`, current
   provider post fields to `none`, and exposes historical writes/post in
   explicitly historical fields.
2. Makes Instagram effect classification depend on the publication call and
   provider identity, not the preparatory media-upload count. Upload-only,
   zero-publication outcomes become `confirmed_absent`; contradictory provider
   evidence remains `ambiguous`.
3. Adds a regression fixture for the exact false Threads report pattern.
4. Adds pure classification coverage for Instagram upload-only, contradictory
   and verified-publication cases.

Validation:

- focused Graph scheduler/adapters: `77/77` passed;
- TypeScript: passed;
- `git diff --check`: passed before commit;
- broad repository test run: the repaired scheduler suite passed, but the
  broad command was stopped after unrelated baseline failures: ten API load
  tests could not reach their configured endpoint and one full-runtime audit
  expected 13 where 14 were observed. These are not represented as green.

## N–S. Remaining blockers and exception lists

### N. Blockers

1. Approval required to load the new commit into the service, reconcile the
   historical Instagram effect, change cron metadata/state, disable legacy
   cron, or push commits.
2. Campaign portfolio rotation needs a product decision: should shadow content
   specs count for cap/cooldown/rotation, and should `primaryCampaignType` be a
   daily floor or a permanent pool restriction?
3. External CRM/website/conversion evidence is unavailable; attribution and
   outcome measurement cannot be proven.
4. Current ambiguous Instagram effect has no provider operation ID. Its local
   worker proves no Instagram publish call, but only the deterministic
   reconciliation path may mutate Graph state.

### O. Configured but not operational

- twelve named campaigns in the campaign table;
- provider metrics, conversation capture and attribution;
- both experiments (intentionally paused);
- Campaign Factory v2/v3 schedule generations;
- knowledge integration in current fast-start mode;
- milestones feed push cron (dormant target absent).

### P. Expected daily but not occurring correctly

- Instagram image and Reel publication after the 8 August ambiguity;
- Threads image at 11:30 on 9 August;
- truthful Threads duplicate reporting in the currently loaded runtime;
- campaign family/product rotation beyond Founder Rescue;
- campaign measurement/feedback.

### Q. Occurring unexpectedly

- historical Threads provider effect presented as today's publication;
- duplicate/overlapping GitHub monitor runs;
- host crons with repo synchronization and latent auto-push authority outside
  Graph.

### R. Duplicated work/authority

- Campaign v3 and v4 both marked `graph_owned` in migration state;
- GitHub monitor concurrent invocations;
- legacy digest cron still triggers but safely policy-skips;
- transitional zero-byte/stale DB locations remain beside active stores.

### S. Unmigrated historical capabilities

- heartbeat, nightly batch, document watching, alert cleanup/detection;
- host documentation sync and milestones feed push;
- campaign measurement connectors and full attribution feedback loop.

The disabled hourly continuous-social cycle is intentionally obsolete, not a
missing migration. Reactivating it would recreate waste and overlapping
authority.

## T. Exact runtime verification and source/deployment separation

| Fact | Evidence | Status |
|---|---|---|
| Source baseline before repair | local/origin `78733d7` | equal before repair |
| Repair source | commit `a410276`; scheduler and adapter worktree blobs exactly match target | `SOURCE_IMPLEMENTED`, `COMMITTED` |
| Remote | exact push advanced `origin/main` from `78733d7` to `a410276` | `PUSHED` |
| Running service | PID changed `239207` -> `391978`; new activation `2026-08-09 16:06:40 BST`, active/running | healthy |
| Runtime source | canonical process cwd under `projects/openclaw-operator/orchestrator`; local audit-only successor `80ec317` contains byte-identical `a410276` runtime blobs | repair `RUNTIME_LOADED`, `RUNTIME_VERIFIED` |
| Runtime health | `/health` HTTP success; persistence healthy file state + Redis coordination | healthy control plane |
| Graph registry | post-restart journal loaded ten production definitions; recovery resumed `0`, blocked `0` | loaded after repair |
| Graph scheduler | post-restart read shows eight enabled jobs with next-trigger fields populated | schedules loaded; historical workflow results remain mixed |
| Official connector | connector `0.10.3`, Instagram/Threads authenticated, represented accounts verified, Browser Relay unavailable | read capability healthy |
| Duplicate-report replay | exact regression `1/1`; formatted current write `0`, provider post `none`, historical effect separate | corrected zero-write semantics verified |
| Configuration adjacency | resolved pre/post snapshot hash `47a3c17fb18efc8561d8c8bfd6fc20353996c4a98f44c862a5f18765de77f835` | unchanged |
| External effects during audit/deployment | none | zero writes, zero Browser Relay calls |
| Instagram live-state reconciliation | exact effect reconciled to `confirmed_absent`; natural 17:00 slot verified | zero writes during reconciliation; one pre-authorized natural publication |

## Required next safe sequence

1. Observe the next natural Threads duplicate-suppressed slot for corrected
   scheduler notification proof. Do not force a provider write.
2. Decide campaign shadow-history semantics, implement a deterministic
   portfolio rotation replay, and require each active campaign to produce an
   eligible content spec before describing it as operational.
3. Add in-flight coalescing to the GitHub monitor.
4. Correct v3/v4 scheduler migration truth and v4 cron description.
5. Decide whether host sync/push crons should migrate, remain explicitly
   exempt, or be disabled. Any change requires explicit scheduler/external
   authority.
6. Add evidence-bearing CRM/website connectors before claiming campaign
   conversion or attribution outcomes.

The Threads historical/current reporting repair is pushed and runtime-verified.
Instagram's historical ambiguity is reconciled and its next natural slot is
provider-verified; no manual or forced publication was used.
Until step 2 completes, “13 active campaigns” must always be qualified as “13
registered; 1 shadow-operational.”

Deployment evidence:
`docs/operations/threads-duplicate-reporting-repair-deployment-2026-08-09.md`.

Instagram reconciliation and recovery evidence:
`docs/operations/instagram-ambiguous-effect-reconciliation-and-natural-slot-2026-08-09.md`.

## Post-audit remediation update: Campaign Factory and runtime lifecycle

Campaign Factory starvation was repaired and deployed in remote commit
`9de0aff48551810d4487cd1f42c3f3e1c91ff469`. Its separate shadow-portfolio
history rotates all thirteen eligible campaigns without converting shadow
decisions into provider-publication evidence. A 60-day/300-slot deterministic
replay reached all thirteen by day five with no cap, cooldown, eligibility or
primary-floor violations and no provider writes. Runtime PID `426880` loads
source matching the remote repair; a canonical read-only next-day projection
selects five distinct campaigns.

Two runtime lifecycle findings belong in this audit's remediation ledger:

1. `PROCESS_LIFECYCLE_LEAK_SUSPECTED`: several orphaned `openclaw-hooks`
   workers existed outside `orchestrator.service` for more than twenty minutes,
   with sustained CPU/memory pressure. They later disappeared without the
   approved gateway restart being dispatched; gateway PID/start were unchanged.
   The symptom recurred within the incident, but exact ownership/root cause is
   not yet proven. Add bounded hook-worker ownership, parent/lease tracking and
   orphan cleanup verification before calling this resolved.
2. `GRAPH_RECOVERY_CONCURRENCY_DEFECT_PROVED`: three stale
   `governed-task-execution@1.0.0` runs consume three of four concurrency slots.
   Startup treats `graph_definition_concurrency_exhausted` as an unhandled
   exception, causing three automatic orchestrator restarts. Recovery continues
   to report one failed and five unchanged runs, and the natural 19:15 Meta
   monitor deferred for concurrency. Fix startup classification/coalescing and
   reconcile only the stale governed-task runs under explicit state-mutation
   authority.

Campaign Factory is therefore runtime-verified, but the autonomous Graph estate
remains degraded. Provider writes during verification were `0`; no gateway
restart, second manual orchestrator restart, forced campaign run, task mutation,
schedule mutation or provider-authority change occurred.

## Post-audit remediation update: Graph recovery and definition concurrency

The proven Graph recovery/concurrency defect is repaired in remote commits
`8b73ab6669771b74158a0164eff359c9da60430f` and
`d8566ed5488b9cf97180533542ffdde8761548d6`.

The three stale `governed-task-execution@1.0.0` parents were independently
proven dead and effect-free, then terminalized only through the new run-specific
canonical recovery API. Their orphan child receipts are closed, their event
chains validate, and pre-existing non-target Graph history is unchanged.

Exactly one orchestrator restart loaded source byte-identical to final remote
`d8566ed`. PID changed `426880` to `445998`; port `3312`, health, persistence,
ten definitions and scheduler migrations recovered with no automatic restart.
The natural 20:15 Meta monitor then completed through a new Graph run instead of
deferring for concurrency. It truthfully reported `missed / zero_write`, with
provider writes `0` and a passed verifier.

`GRAPH_RECOVERY_CONCURRENCY_DEFECT_PROVED` is therefore resolved. The earlier
`PROCESS_LIFECYCLE_LEAK_SUSPECTED` hook-worker symptom remains a separate audit
item: it belongs in remediation, but there is no evidence that it shares the
Graph database/attempt/receipt root cause. No hook worker or gateway lifecycle
mutation occurred during this repair.

Evidence:
`docs/operations/graph-recovery-concurrency-exhaustion-repair-2026-08-09.md`.

## Post-audit remediation update: GitHub monitor single-flight

The GitHub monitor `DUPLICATE_EXECUTION_PATH` is repaired in remote commit
`23382bf`. Canonical history proved the failure mechanism: bucket `5954316`
remained genuinely active for 350.5 seconds, while buckets `5954317` through
`5954320` were admitted as distinct equivalent runs and accumulated into the
stale concurrency incident.

Monitor ingress now coalesces only onto an equivalent Graph run with a running,
unexpired current-node attempt. Exact ingress idempotency remains authoritative;
failed, terminal, timed-out, lease-expired, process-death-stale, and
other-governed-lane runs cannot suppress the next tick. This reuses the Graph
attempt/lease recovery model rather than adding another lifecycle mechanism.

Exactly one restart loaded source byte-identical to `23382bf`; PID changed
`445998` to `473485`, with no automatic restart. Startup plus three natural
five-minute ticks completed in 1.4–1.6 seconds. Observed overlapping pairs,
non-terminal monitor backlog, deferrals, Graph external effects, provider
writes, and Browser Relay calls were all `0`.

The overlap is proven to have contributed to Graph/queue pressure. It is not
proven to have caused the separate orphaned `openclaw-hooks` processes, whose
classification remains `PROCESS_LIFECYCLE_LEAK_SUSPECTED`.

Evidence:
`docs/operations/github-workflow-monitor-single-flight-repair-2026-08-09.md`.
