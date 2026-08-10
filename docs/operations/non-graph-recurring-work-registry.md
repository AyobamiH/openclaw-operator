# Non-Graph recurring work registry

Date: 2026-08-10
Canonical source: `orchestrator/src/nonGraphRecurringWork.ts`
Runtime reporting: protected `GET /api/runtime/facts` at
`controlPlane.nonGraphRecurringWork`

## Ownership rule

Persistent Graph scheduler migrations remain authoritative for migrated Graph
capabilities. This registry covers application work that intentionally remains
outside that scheduler: process cron, intervals, watchers, event timers,
resident service loops, and startup hooks.

Each capability has one disposition and one execution owner. A trigger may
invoke a Graph-backed task without becoming a persistent Graph scheduler
migration; the trigger owner remains the process recorded here.

The registry does not grant external authority. External or irreversible work
continues to require its existing approval, ToolGate, worker, and provider
controls.

## Reconciliation decisions

- `continuous-marketing-digest-v1` is the sole recurring digest owner. The
  legacy in-process 06:00 policy-skip cron is removed, not retained as a second
  timer.
- The orchestrator watcher/queue is the sole document drift-repair owner.
  `doc-specialist.service` remains a one-minute health observer and may update
  only its service-state receipt; it may not clear orchestrator pending paths,
  append repair records, or generate knowledge packs independently.
- `reddit-helper.service` is disabled and is not a required resident service.
  The supported owner is the bounded worker-first `reddit-response` task path.
  The dormant service may be started only by an explicit operator action and
  retains no provider-posting authority.
- The six-hour business-value cadence and hourly business-day pulse share one
  controller and one active-cycle lock. When their cron expressions coincide,
  the second admission is recorded as `active` and no second cycle runs.
- Review-session sampling is active only while one review session is active.
  An in-flight guard skips a timer tick instead of overlapping sample/flush
  work.
- Nightly and heartbeat queue entries use deterministic slot keys. Document
  watcher entries use a path/mtime key. These keys make retries and duplicate
  events visible without allowing a second live owner.

## Registered capabilities

| Capability | Trigger | Owner | Effects | External authority | Disposition |
|---|---|---|---|---|---|
| Orchestrator heartbeat | `*/5 * * * *` | `orchestrator.service` | Local liveness receipt | none | `REGISTERED_IN_PROCESS` |
| OpenClaw agent heartbeats | every 1 hour per enabled agent | `openclaw-gateway.service` | Change-only agent health guard | agent-policy bounded; no provider-write grant | `REGISTERED_IN_PROCESS` |
| Business-value cadence | `17 */6 * * *` | orchestrator business-value controller | Local planning and one safe queue admission | approval-gated downstream | `REGISTERED_IN_PROCESS` |
| Business-day pulse | `17 8-17 * * 1-5`, Europe/London | same business-value controller | Local planning and one safe queue admission | approval-gated downstream | `REGISTERED_IN_PROCESS` |
| Nightly batch | `0 23 * * *` | `orchestrator.service` | Local docs/RSS/queue/approval/digest artifacts | read-only fetches; no provider write | `REGISTERED_IN_PROCESS` |
| Document watching | chokidar add/change/unlink | `orchestrator.service` | Local index, capped pending buffer, repair admission | none beyond local artifacts | `REGISTERED_EVENT_DRIVEN` |
| Doc-specialist heartbeat | every 60 seconds | `doc-specialist.service` | Service-state observation only | none | `REGISTERED_IN_PROCESS` |
| Missed-heartbeat detection | every 10 minutes | orchestrator alert manager | Local critical alert | none | `REGISTERED_IN_PROCESS` |
| Alert retention cleanup | every 6 hours | orchestrator alert manager | Local 48-hour retention | none | `REGISTERED_IN_PROCESS` |
| Alert fingerprint cleanup | every 1 hour | alert deduplicator | In-memory expiry | none | `REGISTERED_IN_PROCESS` |
| Startup recovery | listener-ready lifecycle hook | `orchestrator.service` | Local retry/controller/watcher reconciliation | approval-bounded downstream only | `REGISTERED_LIFECYCLE_HOOK` |
| Task retry recovery | one persisted timer per idempotency key | orchestrator retry controller | Local queue retry | inherits original task controls | `REGISTERED_EVENT_DRIVEN` |
| Review-session sampling | active-session interval | review-session service | Local host/process/activity samples | none | `REGISTERED_EVENT_DRIVEN` |
| GitHub workflow monitor | every 5 minutes plus startup | `orchestrator.service` | Read-only GitHub status and local evidence | read-only GitHub | `REGISTERED_IN_PROCESS` |
| Knowledge integration startup | startup when not fast-start | knowledge integration | Local knowledge initialization | none | `REGISTERED_LIFECYCLE_HOOK` |
| Agent overview cache warm | debounced one-shot timer | `orchestrator.service` | In-memory cache/read-only probes | none | `REGISTERED_EVENT_DRIVEN` |
| Reddit helper resident loop | only if disabled unit is explicitly started | `reddit-helper.service` | Local drafts/queue artifacts | no provider posting | `CONDITIONAL_INACTIVE` |
| Legacy send-digest cron | removed | none | none | none | `DISABLE` |

## Verification contract

The source registry test must prove:

1. every required capability appears exactly once;
2. every record includes purpose, trigger, owner, state, effects, idempotency,
   concurrency, recovery, verification, reporting, external authority, and one
   valid disposition;
3. the legacy digest timer is disabled;
4. the doc-specialist resident service has observation-only effects;
5. the review sampler has an explicit non-overlap guard.

Runtime closeout must additionally prove:

- current OpenClaw heartbeat configuration and Gateway reachability;
- orchestrator and doc-specialist unit active state and restart counters;
- `reddit-helper.service` disabled/inactive;
- current business scheduler mode and last natural outcomes;
- empty or intentionally populated retry/review/pending buffers;
- recent natural heartbeat, GitHub monitor, nightly, and watcher receipts;
- Graph ownership for digest without a second in-process cron;
- healthy orchestrator persistence/coordination surfaces;
- zero forced provider writes, campaigns, social work, or Graph executions.
