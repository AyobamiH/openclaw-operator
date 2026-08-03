# Agent Isolation and Dispatch Boundaries

Last reviewed: 2026-03-02

## Current Isolation Facts

- The orchestrator still runs most task agents as short-lived child processes.
- `drift-repair` and `reddit-response` also run through orchestrator-managed
  wrappers for `doc-specialist` and `reddit-helper`.
- The active task handlers now cover the broader agent set, including
  `market-research`, `data-extraction`, `qa-verification`, and `skill-audit`.
- ToolGate now issues a durable single-use capability immediately before
  governed queue and skill execution, so dispatch no longer relies on
  handler-local preflight conventions.

## Current Coverage

The canonical task agents are now wired through the orchestrator task map:

- `security-agent`
- `summarization-agent`
- `system-monitor-agent`
- `build-refactor-agent`
- `content-agent`
- `integration-agent`
- `normalization-agent`
- `market-research-agent`
- `data-extraction-agent`
- `qa-verification-agent`
- `skill-audit-agent`
- `doc-specialist`
- `reddit-helper`

That means the primary documented task-agent surface is now represented in the
runtime handler layer.

## Isolation Limits That Still Matter

1. ToolGate is a durable authorization layer, not a full process sandbox.
2. Child processes now run with an allowlisted environment, but they are still
   not sandboxed and do not fully enforce manifest runtime boundaries.
3. Direct task entrypoints are narrower now, but systemd service units still
   exist for multiple agents, so direct execution remains
   possible outside the queue path.
4. Agent config schemas and maturity still vary between agents, even though the
   README layer is now normalized.

## Governance Rule

- Preferred execution path: orchestrator queue and handler dispatch.
- Standalone services should be treated as operational exceptions, maintenance
  paths, or explicitly controlled deployments, not as proof that isolation is
  fully centralized.
- Future generated or imported skills should not be treated as trusted merely
  because a helper surface exists. The intended trusted path is registration,
  declared permissions, audit/review, and orchestrator-aware execution.

## Practical Hardening

1. Keep tightening the child env allowlist and review which provider secrets are
   still intentionally passed through.
2. Keep task-to-agent mapping tests aligned with `agent.config.json`.
3. Treat systemd direct-run paths as a documented exception and review them with
   the same rigor as the orchestrator path.
4. Do not flatten ToolGate, SkillAudit, manifest permission structures, or
   skill helper surfaces just because their runtime coverage is incomplete.
