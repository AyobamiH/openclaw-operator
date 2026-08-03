# Claims vs Reality Matrix

Last reviewed: 2026-02-28

## Claim: Task Intake Is Deny-by-Default

- Claim source: runtime intent and current docs
- Runtime evidence: `ALLOWED_TASK_TYPES`, `TaskTriggerSchema`, and
  `TaskQueue.enqueue()` all enforce allowlisting
- Verdict: **Implemented**

## Claim: ToolGate Exists in Runtime

- Claim source: current runtime design
- Runtime evidence: `orchestrator/src/toolGate.ts` and `toolGateStore.ts`
  persist policy/decision/denial/capability state; central task execution and
  `skills/index.ts` require single-use execution capabilities
- Verdict: **Implemented for governed queue and skill execution**

It is a durable authorization layer. It intentionally does not claim universal
host-level execution isolation.

## Claim: Skill Audit Runs During Skill Registration

- Claim source: current skill loader design
- Runtime evidence: `skills/index.ts` imports and uses
  `orchestrator/src/skillAudit.ts`. The registry now bootstraps either through
  the explicit `initializeSkills()` path or lazily on the first
  `executeSkill()` call.
- Verdict: **Implemented for the current skill-registry execution path, but still partial in scope**

## Claim: Generated Or Imported Skills Require Governed Registration And Explicit Approval

- Claim source: current governed-skill direction
- Runtime evidence: non-built-in skills now have a narrow intake path through
  `skills/index.ts -> registerGovernedSkill() -> approveGovernedSkill()`, and
  they do not become executable on the normal `executeSkill()` path unless
  that intake path stages and then explicitly approves them
- Verdict: **Implemented as a narrow runtime trust scaffold, not as end-to-end governed self-extension**

## Claim: Approved Governed Skills Survive Restart Safely

- Claim source: current governed-skill durability direction
- Runtime evidence: governed skill state is now persisted in
  `OrchestratorState.governedSkillState`, and `skills/index.ts` rehydrates
  approved governed skills during skill bootstrap when a builtin executor
  binding is available
- Verdict: **Implemented as partial restart-safe durability; metadata-only governed skills still require re-registration**

## Claim: The Broader Agent Task Surface Is Wired

- Claim source: current agent catalog and task docs
- Runtime evidence: `taskHandlers.ts` now wires the extended agent task set,
  including `market-research`, `data-extraction`, `qa-verification`, and
  `skill-audit`
- Verdict: **Implemented for the canonical task map**

## Claim: Orchestrator Is the Only Execution Authority

- Claim source: architecture intent
- Runtime evidence: the repo still includes multiple agent systemd units that
  can run outside the queue path
- Verdict: **Not strictly enforced operationally**

## Claim: Runtime Controls Are Fully Closed

- Claim source: safe-autonomy ambition
- Runtime evidence: governed queue and skill authorization is durable and
  fail-closed, while host process isolation and deployment-surface
  consolidation remain separate incomplete controls
- Verdict: **Directionally stronger, not fully closed**
