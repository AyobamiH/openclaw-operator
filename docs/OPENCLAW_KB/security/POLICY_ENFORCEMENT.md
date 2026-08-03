# Security Policy Enforcement

Last updated: 2026-03-02

## Enforced Today
- Bearer auth on protected APIs
- Constant-time bearer token comparison
- HMAC webhook signature verification
- Request schema validation and content-size restrictions
- Task allowlist at queue ingress
- Durable ToolGate policy, decision, denial and single-use capability state
- Immediate pre-execution ToolGate enforcement for governed tasks and skills
- Manifest skill call ceilings and concrete read/write/network target checks
- Hash-chain and terminal-state tamper rejection for ToolGate decisions and
  execution capabilities
- Explicit context gating on `openclawdbot` internal mutating route groups
- Fail-closed bootstrap signing in `openclawdbot` when the app signing secret is missing

## Not Fully Enforced Yet
- Universal skill/tool policy gateway for every execution path
- Approval hard-stop for all destructive actions
- Host/process sandboxing for spawned agents

## Partial Runtime Controls
- SkillAudit-backed skill registration through the current skill-registry
  bootstrap path
- Governed non-built-in skill intake and explicit review approval through
  `skills/index.ts -> registerGovernedSkill() -> approveGovernedSkill()`,
  including a reviewable provenance check before activation
- Restart-safe governed skill rehydration for approved governed skills with a
  persisted builtin executor binding via `OrchestratorState.governedSkillState`
- Protected `/api/dashboard/overview` governance visibility for pending
  approvals, retry backlog, delivery backlog, and governed skill durability
  state
- Manifest skill allowlists
- Child-process env minimization
- Direct task-run narrowing via orchestrator-run marker

## Deferred Governance Controls
- SkillAudit as a universal, provably wired enforcement gate across all
  execution paths. The current bootstrap path is real, but still limited in
  scope.
- End-to-end governed skill generation / intake / approval beyond the current
  narrow `registerGovernedSkill()` + `approveGovernedSkill()` trust scaffold
- Full governed skill durability across arbitrary executor types. The current
  durable path is limited to approved governed skills whose executor can be
  rehydrated from a builtin binding; metadata-only governed entries still
  require re-registration after restart.
- Host-level enforcement outside governed queue/skill paths

## Protected Governance Surfaces
- `orchestrator/src/toolGate.ts`
- `orchestrator/src/skillAudit.ts`
- `orchestrator/src/agentRegistry.ts`
- manifest permission structures in `agents/*/agent.config.json`
- `skills/index.ts` and the skill helper/executor surface

These should be preserved and described honestly as enforced, partial, or deferred based on runtime evidence.

## Priority Fixes
1. Preserve the mandatory ToolGate execution-capability boundary for governed
   queue and skill actions.
2. Tighten the current child env allowlist and align it more closely with per-agent manifests.
3. Signed audit records for state-changing operations.
