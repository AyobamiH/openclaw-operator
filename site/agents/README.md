# OpenClaw Agent Catalog

This directory contains the specialized worker agents the orchestrator can
dispatch or evolve toward. Some are richer, runtime-oriented agent surfaces
(`doc-specialist`, `reddit-helper`); others are structured task templates that
define scope, I/O, and governance for future or selective execution paths.

Telemetry helpers live under [`shared/`](./shared). New agents should start from
[`AGENT_TEMPLATE/`](./AGENT_TEMPLATE).

## Current Agent Surfaces

- [`doc-specialist/`](./doc-specialist) - documentation drift repair and
  knowledge-pack generation
- [`reddit-helper/`](./reddit-helper) - community response drafting using fresh
  knowledge packs
- [`build-refactor-agent/`](./build-refactor-agent) - safe refactor and
  build-oriented code changes
- [`content-agent/`](./content-agent) - repository-backed content generation
- [`data-extraction-agent/`](./data-extraction-agent) - structured extraction
  from local files
- [`integration-agent/`](./integration-agent) - multi-step workflow handoffs
- [`market-research-agent/`](./market-research-agent) - approved external
  research collection
- [`normalization-agent/`](./normalization-agent) - data normalization
- [`operations-analyst-agent/`](./operations-analyst-agent) - bounded
  control-plane synthesis and companion-facing operational briefs
- [`qa-verification-agent/`](./qa-verification-agent) - verification and QA
  evidence
- [`release-manager-agent/`](./release-manager-agent) - bounded release posture
  synthesis across verification, security, and system evidence
- [`security-agent/`](./security-agent) - security review and remediation
  guidance
- [`skill-audit-agent/`](./skill-audit-agent) - skill reliability and behavior
  audits
- [`summarization-agent/`](./summarization-agent) - long-form summarization
- [`system-monitor-agent/`](./system-monitor-agent) - health and observability
  reporting

## Operational Status Truth (Do Not Collapse Modes)

Use these terms separately:

- **declared agent**: agent folder + manifest/config exists.
- **spawned-worker capable**: orchestrator can spawn the task entrypoint for
  task execution.
- **serviceAvailable**: agent has a real long-running `src/service.ts`
  implementation in repo.
- **serviceInstalled**: a matching systemd unit is actually installed on the
  host the orchestrator is running on.
- **serviceRunning**: host-running state is actually proven for that service.

Current runtime truth:

- **Real long-running service implementations available in repo (`src/service.ts` present):**
  - all 15 declared runtime agents; `serviceAvailableCount` should now be read as `15`
- **Service-available and also spawned-worker capable, with live worker proof in the current runtime:**
  - [`doc-specialist/`](./doc-specialist) (`2026-03-07`; `drift-repair` live smoke `run_id=auto-8ef2eb1a3ff49ddd4237ee019d646b4810f9418c699b3a2a1de7682e388fd502`, knowledge-pack verification recorded in `/api/tasks/runs` and `/api/memory/recall`)
- **Service-available and spawned-worker capable, but worker path is still partial/degraded in the latest validation baseline:**
- [`reddit-helper/`](./reddit-helper) (`reddit-response` still depends on provider health for the optional final polish pass, but the runtime now hardens token use with service-state dedupe, per-cycle throttles, daily LLM budgets, deterministic local scoring, local-first fallback drafting, mandatory operator approval for `manual-review` RSS leads, and operator promotion approvals for the top `10` `draft` leads. Spawned helper runs now inherit orchestrator-shared runtime dependencies via `NODE_PATH`, and real helper exceptions fail the task instead of reporting a false-green draft.)
- **Focused contract-proven spawned workers in the current public expansion slice:**
  - [`operations-analyst-agent/`](./operations-analyst-agent) (`2026-04-02`; bounded `control-plane-brief` plus companion-overview proof)
  - [`release-manager-agent/`](./release-manager-agent) (`2026-04-02`; bounded `release-readiness` proof)
- **Confirmed working as spawned workers in the latest validation sweep (service availability is separate from worker proof):**
  - [`build-refactor-agent/`](./build-refactor-agent)
  - [`market-research-agent/`](./market-research-agent) (query-only mode)
  - [`content-agent/`](./content-agent) (`2026-03-07`; local/template output lane)
  - [`data-extraction-agent/`](./data-extraction-agent) (`2026-03-07`; inline-source lane only)
  - [`integration-agent/`](./integration-agent) (`2026-03-07`; local/simulated workflow lane)
  - [`normalization-agent/`](./normalization-agent) (`2026-03-07`)
  - [`qa-verification-agent/`](./qa-verification-agent) (`2026-03-07`; live dry-run proof plus minimal allowed `build-verify` run, with execute-mode `testRunner` audit evidence)
  - [`security-agent/`](./security-agent) (`2026-03-07`; local/simulated findings lane)
  - [`skill-audit-agent/`](./skill-audit-agent) (`2026-03-07`; live smoke after the orchestrator/agent contract fix)
  - [`summarization-agent/`](./summarization-agent) (`2026-03-07`)
  - [`system-monitor-agent/`](./system-monitor-agent) (`2026-03-07`; local/simulated monitoring lane)
- **Declared-only template surface (not service-operational and not a runtime worker):**
  - [`AGENT_TEMPLATE/`](./AGENT_TEMPLATE)

- **Service-running remains separate from service availability:**
  - current orchestrator truth can report `serviceAvailable`
  - current orchestrator truth now also reports `serviceInstalled`
  - current orchestrator truth must not report `serviceRunning` unless host evidence exists
  - placeholder gating remains relevant operationally because a unit can still be present before a host actually enables or proves it

Operator API mapping:

- `GET /api/agents/overview` is the runtime operator surface for these status
  distinctions and includes supporting evidence fields.
- In the `2026-03-07` spawned-worker sweep, `/api/agents/overview` memory
  fields reflected the successful runs, but the older
  `workerValidationStatus` label could still lag until evidence-backed route
  logic was updated.
- Treat that API output as runtime truth for operator UI/status reporting; do
  not infer service-operational behavior from manifests alone.
  Prefer `serviceAvailable` and `serviceRunning`; the older
  `serviceImplementation` / `serviceOperational` fields remain only as
  compatibility aliases.

Important: manifest presence or systemd declaration does not by itself prove
service-running runtime behavior.
Important: every non-template agent here is a declared agent and now has a
real service entrypoint, but current orchestrator truth still does not
host-prove any of them as running; on the current host, no agent service units
are installed yet, so `serviceInstalled=false` and `serviceRunning=false` are
the correct per-agent truths.
Important: "spawned-worker capable" is broader than "confirmed working in the
latest sweep." A task entrypoint can exist and still remain unconfirmed until a
real orchestrator task path is exercised successfully.
Most agents should still be read as spawned-worker surfaces first. Service-mode
availability does not replace orchestrator task routing, ToolGate, or worker
evidence.
Important: in current manifests, `id` is the runtime identifier the
orchestrator uses. `agentId` is present but null in current manifests and is
not the active runtime key.

## How To Read This Directory

- `agents/README.md` is the catalog and current entrypoint.
- Each `agents/*/README.md` is a specialized local runbook for that agent, using
  the same baseline structure (`Status`, `Primary orchestrator task`,
  `Canonical contract`, `Mission`, `Contract`, `Runtime`, `Governance`).
- `agent.config.json` and source code are the real contract when documentation
  and implementation differ.

## Shared Specialist Result Contract

All non-template agents should now converge on the same operator-facing result
shape. The exact specialist logic differs by lane, but the operator contract
should stay recognizable:

- `operatorSummary`: one short answer to "what happened here?"
- `recommendedNextActions[]`: bounded follow-up actions for the operator or
  downstream lane
- `specialistContract`: compact specialist metadata with
  - `role`
  - `workflowStage`
  - `deliverable`
  - `status`
  - `refusalReason`
  - `escalationReason`

Status vocabulary:

- `completed`
- `watching`
- `blocked`
- `escalate`
- `refused`

Refusal language should be explicit:

- say `Refused because ...` when the request is outside the governed lane
- say `Escalate because ...` when the lane is legitimate but cannot be closed
  safely with current evidence or permissions
- do not hide blocked or weak-evidence outcomes behind a generic success tone

Not every agent here is equally mature. The folder can contain both active
runtime surfaces and staged templates for orchestrated expansion.

## Memory Contract (Mandatory for all agents)

Every agent must include these config keys in `agent.config.json`:

- `orchestratorStatePath`
- `serviceStatePath`

Why this remains mandatory:

- Enables persistent cross-run memory continuity.
- Guarantees each agent has a durable execution timeline and status history.
- Supports operator auditability and replay-friendly diagnostics.

Runtime standard:

- The orchestrator updates each spawned agent `serviceStatePath` with memory
  state (`lastRunAt`, `lastStatus`, task IDs/types, counters, and bounded
  timeline history).
- Agents with richer pipelines may define additional memory I/O keys (for
  example `knowledgePackDir`, `draftLogPath`, `devvitQueuePath`) but cannot
  omit the baseline memory contract above.

## Capability And Access Policy

- every declared non-template agent remains in scope for full capability uplift
- full capability means each agent should eventually gain governed access to
  the skills and tools required for its role-complete execution path
- do not flatten permissions by giving every agent every skill or tool
- expand access through explicit manifest updates, ToolGate-visible policy,
  and evidence-backed runtime validation so operators can see what is truly
  available versus still missing

## Governance

Every agent folder should keep its local governance primitives (`ROLE.md`,
`SCOPE.md`, `POLICY.md`, `TOOLS.md`) aligned with
`../docs/GOVERNANCE_REPO_HYGIENE.md`.

Material agent code/config changes should update the appropriate existing `.md`
file in the same change set and reference the affected task, runtime, or config
paths where useful.
