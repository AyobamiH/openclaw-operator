# Skills Runtime and Supply Chain Governance

Last reviewed: 2026-02-28

## Current Runtime Behavior

Verified:

- Skills are implemented in `skills/*.ts`.
- `skills/index.ts` contains the current skill-registry bootstrap path and now
  uses the explicit named `auditSkill()` export from
  `orchestrator/src/skillAudit.ts`, so the SkillAudit contract is coherent at
  the bootstrap boundary.
- `skills/index.ts` now supports both:
  - the explicit/manual `initializeSkills()` bootstrap path, and
  - lazy bootstrap on the first `executeSkill()` call
  so active skill-execution paths no longer depend on preloaded registry state.
- `skills/index.ts` now also exposes a narrow governed intake path for
  non-built-in skills through `registerGovernedSkill()`. Generated/imported
  skills do not become executable on the normal `executeSkill()` path unless
  that intake path stages them and `approveGovernedSkill()` explicitly
  approves them. That approval step now also checks for a reviewable
  provenance snapshot. When a requesting agent is supplied, ToolGate and
  manifest skill allowlists still apply after approval.
- `skills/index.ts` now persists governed skill trust state through the
  existing orchestrator JSON state file. Approved governed skills with builtin
  executor bindings are rehydrated during skill bootstrap after restart;
  governed skills without a restart-safe executor binding persist as metadata
  only and remain non-executable until they are re-registered.
- The protected `/api/dashboard/overview` operator surface now exposes the
  governed skill trust split from `OrchestratorState.governedSkillState`,
  including pending-review versus approved state and restart-safe versus
  metadata-only durability.
- `skills/index.ts` obtains a durable single-use ToolGate execution capability
  immediately before each governed skill call and closes it as consumed or
  failed. Concrete read, write and network targets are checked against the
  agent manifest at execution time.
- central queue execution obtains the equivalent task capability before a
  handler runs. Graph child tasks use the same queue path and may reuse graph
  approval only through a validated active receipt and unexpired exact graph
  approval.

ToolGate policies, decisions, denials and capability consumption are persisted
in an owner-only SQLite database with an immutable decision hash chain. This
is durable authorization for governed queue and skill paths, while SkillAudit
continues to own bootstrap and reviewed skill intake.

## What The Audit Gate Actually Covers

`SkillAuditGate` currently evaluates:

- provenance metadata
- permission bounds
- dangerous runtime patterns
- direct secret access
- input/output schema presence

That is a meaningful supply-chain review step for skills loaded through the
registry, but governed skill intake now also requires an explicit review step
before the staged skill becomes executable.

## Remaining Runtime Limits

- ToolGate is not a full filesystem/network/process sandbox. Host containment
  remains a separate system boundary and is reported as unsupported rather
  than implied by manifest policy.
- Child-process tasks in `taskHandlers.ts` do not force every action through the
  skill registry; some execution remains agent-process based rather than
  skill-gateway based.

## Current Risk Notes

- `sourceFetch` safety depends on its executor and declared bounds, not a global
  egress firewall.
- `documentParser`, `workspacePatch` and `sourceFetch` now receive concrete
  manifest-backed read/write/network checks on the normal skill path.
- `testRunner` still represents command execution and therefore deserves tighter
  scrutiny than read-only skills.

## Governance Actions

1. Keep preflight as inspection only; `authorizeSkillExecution()` and the
   single-use capability lifecycle are the canonical execution boundary.
2. Keep both the explicit/manual `initializeSkills()` path and the lazy
   `executeSkill()` bootstrap path coherent; they are now the trusted registry
   bootstrap surfaces.
3. Keep `registerGovernedSkill()` plus `approveGovernedSkill()` as the only
   supported intake and trust path for generated/imported skills on the normal
   skill path.
4. Keep `OrchestratorState.governedSkillState` as the current narrow durable
   governed-skill store; restart-safe execution should only be assumed for
   approved governed skills with a rehydratable executor binding.
5. Treat stronger host/process sandboxing as a separate deployment/security
   control, not a ToolGate capability claim.
6. Continue treating skill metadata as necessary but not sufficient for runtime
   safety.
