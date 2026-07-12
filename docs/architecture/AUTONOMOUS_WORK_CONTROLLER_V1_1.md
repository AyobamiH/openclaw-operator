# Autonomous Work Controller v1.1

Version 1.1 hardens the existing controller rather than adding a parallel
control plane. The existing queue, approval gate, ToolGate, agent registry,
provider-rate-limit guard, heartbeat/cron runtime, and durable ledgers remain
authoritative.

## Approved intake

`autonomous-intake-cycle` accepts bounded, explicitly approved records from:

1. operator or Telegram intake
2. active queue work
3. resumable paused work
4. standing orders and approved workboard items
5. scheduled read-only audits
6. capability-gap review

Items carry source provenance and source-specific idempotency keys. Unknown,
unapproved, stale, and duplicate records are ignored with a reason. Batch size
is capped. No arbitrary filesystem discovery occurs.

## Provider pause and resume

The existing provider guard emits a sanitized `controller-event.json` containing
only event id, timestamp, resume phrase, provider class, and pause state. The
controller never reads the guard's session key, channel identifiers, request
body, or provider response. One event produces one `paused_rate_limit`
checkpoint. Repeated event ids are ignored. Resume requires both a
`resume_requested` bridge state and successful checkpoint restoration; already
completed actions remain in the checkpoint and are not replayed.

Safe non-model operations remain available through the existing guard's bounded
`/orch` status surfaces and read-only coding tools. Model-dependent continuation
stays paused.

## Context compatibility

Before continuation the controller compares tracked context metadata with the
selected model's actual context window and configured reserve. Normal usage
continues. Reaching the reserve threshold checkpoints first and requests one
compaction. Impossible restored metadata, including a large session restored
under a much smaller model window, becomes `blocked_context_invalid`; task state
is preserved and no model call occurs. This prevents silent truncation and
compaction loops.

The observed `189k / 4.1k` status was a transient model-label/session-counter
mismatch: filtered Gateway metadata later showed the session owned by
`openai/gpt-5.5` with a 272k window. Session counters are documented as
best-effort metadata. The controller therefore validates compatibility rather
than editing Gateway session storage.

## Small-model policy

Small/local models cannot use unrestricted web, browser, runtime execution,
filesystem mutation, automation, deployment, or migration tools. A structured
read-only coding-agent-skills tool remains eligible only after ToolGate allows
it. When a stronger approved model is available, a denial may recommend
escalation instead of widening permissions. Hosted/non-small routing retains
its existing ToolGate behavior.

## Telegram targeting

The controller accepts only opaque aliases `current`, `current-operator`, or
`current-task` when the request is already bound to an inbound session. The
delivery contract is `reply_to_current_task`. Raw chat ids, arbitrary targets,
and unbound aliases are rejected and never logged.

## Evidence

New checkpoints include intake provenance, context decision, sanitized
rate-limit state, model/tool decision, continuation result, capability gaps,
and the opaque session alias. Operator message text, chat identifiers, secrets,
tokens, credentials, and provider bodies are excluded from invocation events.

Mutation, installation, restart, deployment, migration, commit, push, merge,
secret access, permission expansion, and destructive work remain approval-gated.
