# Autonomous Work Controller v1

The Autonomous Work Controller is a bounded orchestration layer for approved
operator work. It extends the existing queue, approval gate, ToolGate, agent
registry, run summaries, and file/Mongo persistence abstractions; it does not
create a second scheduler, queue, memory system, or approval engine.

## Existing control-plane extension points

- Task model and queue: `orchestrator/src/types.ts` and `taskQueue.ts`
- Dispatch: the `autonomous-work-cycle` handler in `taskHandlers.ts`
- Approval authority: the existing `approvalGate.ts`
- Tool authorization: the existing `toolGate.ts` and `code-index-agent` manifest
- Specialist registry: the existing `agentRegistry.ts`
- Durable evidence: controller checkpoints beneath configured `logsDir`, plus
  the existing task execution summary and workflow ledger
- Scheduling: the existing heartbeat/cron runtime; v1 does not add a cadence

## Runtime contract

Approved inputs normalize into a structural work item. V1 classifies the lane
and risk, selects the narrowest coding-agent-skills tool for repository
inspection, runs ToolGate preflight, records a sanitized invocation event,
checkpoints, and evaluates the returned next action. The broad coding default
is `coding_audit`; narrow route, environment, secret, API, migration, Git,
deployment-readiness, project, adapter, package, and orientation intents select
their corresponding tools. Non-coding lanes retain existing routing.

Continuation occurs only for handled, unchanged, read-only results whose next
action is explicitly allowlisted and does not require approval. The controller
stops at duplicate actions, step-budget exhaustion, provider-rate-limit pause,
forbidden work, repeated failure, or an approval boundary. Checkpoints make a
cycle resumable without retaining chat history.

## Evidence and capability gaps

Each attempt records selected tool/source, governed intent, sanitized
arguments, status, exit code, changed-state claim, evidence path, fallback
reason, next action, approval requirement, and continuation decision.
Sensitive-looking keys and values are redacted.

Missing plugins, workers, policy authority, provider capacity, and validation
capabilities produce deduplicated gap records with occurrence counts and a
bounded validation proposal. V1 records gaps; it does not install capabilities
or widen ToolGate authority automatically.

Implemented: structural contracts, classification, coding-agent-skills-first
execution, ToolGate enforcement, bounded continuation, checkpointing,
invocation evidence, gap deduplication, rate-limit status, catalog exposure,
and synthetic tests.

Planned: automatic ingestion hooks for every approved OpenClaw workboard and
standing-order source, plus direct provider-rate-limit-guard event bridging.
Those sources can submit the stable task contract now; v1 does not overclaim
universal discovery hooks that have not been runtime-proven.
