---
title: "Autonomous Coding Controls Forward Operating Reference"
summary: "Forward-only agent-readable operating contract for OpenClaw graph, verification, ledgers, permissions, and controlled learning."
status: active-forward-reference
scope: "AyobamiH/openclaw-operator"
created: "2026-08-11"
---

# Autonomous Coding Controls Forward Operating Reference

This file is the agent-readable forward operating contract extracted from the OpenClaw operating-reference briefings.

It is intentionally **not** a historical archive, market summary, or backward-looking projection. Use it only to guide current and future OpenClaw Operator work around graph execution, authority, verification, work ledgers, permission boundaries, child-run reconciliation, and controlled learning.

The source Google Doc contains broader historical synthesis. This repo file keeps only the forward direction that an engineering agent can safely convert into bounded backlog work.

## Usage Contract

Use this file before planning or executing work involving:

- graph-owned autonomous coding workflows;
- graph migration or graph-child execution;
- verification receipts and proof packets;
- authority, approval, permissions, or sandbox changes;
- work ledgers, incident ledgers, or run-state changes;
- child-run reconciliation and terminal-state hardening;
- failure-to-control loops, skill evolution, or memory promotion;
- external writes such as publication, GitHub mutation, deployment, restart, or messaging.

Do **not** use this file to:

- create broad backlog work merely because a topic appeared in an old briefing;
- infer runtime truth without reading current code and live configuration;
- bypass approval for external, destructive, credential, deployment, publishing, legal, financial, or irreversible actions;
- justify more graph parallelism before write claims, child reconciliation, and effect envelopes exist;
- promote global skills, memories, or policies from one successful or failed run;
- treat reviewer confidence, LLM judgement, or model output as a security boundary.

Every recommendation from this file must be converted into a bounded task with:

- objective;
- current runtime evidence;
- scope;
- acceptance criteria;
- required verification;
- authority boundary;
- rollback or stop condition;
- evidence/receipt output.

## Forward Doctrine

The current forward direction is:

```text
mission or trigger
→ run admission receipt
→ authority and policy decision
→ active execution ledger
→ isolated write claim or read-only lane
→ bounded execution
→ child-run reconciliation
→ source-bound verification receipt
→ idempotent effect envelope when external writes occur
→ terminal integrity barrier
→ knowledge projection
→ controlled learning lifecycle
```

OpenClaw already has Graph. The next maturity step is not “more autonomous agents.” The next step is making Graph execution **provable, reconciled, bounded, and learnable without silently rewriting authority**.

The LLM may propose, rank, investigate, summarize, and draft. Deterministic code must own admission, permission, write claims, verification, terminal transitions, provider reconciliation, failure clustering, and durable promotion.

## Current Non-Negotiables

1. **Verification beats generation.** A convincing agent summary is not evidence.
2. **Authority is action-level.** Credential possession is not permission.
3. **Graph parent state is derived, not declared.** Parent completion must be recomputed from authoritative child records.
4. **External writes are idempotent by effect, not by attempt.** Retrying an ambiguous write requires provider readback.
5. **Workspace truth is versioned.** Write-capable children need claim leases or isolated worktrees.
6. **Learning is staged.** Incidents may propose lessons; they do not automatically become global skills or policy.
7. **Forward docs must stay current.** If this file conflicts with active runtime code, live config, or source-controlled policy, current code/config wins and this file must be updated.

## P0 — Source-Bound Verification Receipts

### Problem
Agents can claim work is complete even when evidence is stale, incomplete, not replayed, or not bound to the current source state.

### OpenClaw change
Create a first-class verification receipt required before a task may become `DONE_WITH_EVIDENCE`, `published`, `deployed`, `pushed`, `released`, `restarted`, or externally reconciled.

### Minimum fields

```text
receipt_id
run_id
task_id
source_commit
workspace_epoch
material_hash
policy_digest
tool_registry_digest
command_set_hash
environment_digest
verifier_identity
verification_command
arguments
working_directory
exit_code
output_digest
verified_at
verdict
invalidated_by
```

### Rules

- A receipt is invalid if the source commit, policy, tool registry, workspace epoch, or verification command set changes.
- The operating agent may request verification, but only the verifier may issue the verified terminal state.
- Summaries may explain evidence; they must not create evidence.
- Unknown, partial, stale, or skipped verification cannot be surfaced as success.

### First implementation
Add receipt interfaces and storage without changing live behaviour. Gate one high-value path first: graph-owned social publication, repo push, or service restart.

## P0 — Authority-Decision Receipts

### Problem
Modern agent systems have several permission deciders: task authority, approval UI, risk reviewer, sandbox, MCP server, operating-system boundary, and observed effect. Recording only `approved` or `denied` loses the actual security story.

### OpenClaw change
Split approval from enforcement. Approval answers “may this be attempted?” Enforcement answers “was it physically constrained?” Reconciliation answers “what actually happened?”

### Minimum fields

```text
authority_receipt_id
run_id
task_id
requested_capability
task_authority_decision
approval_policy_decision
risk_reviewer_decision
security_boundary_decision
sandbox_canary_decision
mcp_tool_decision
effective_decision
observed_effect
denial_reason
narrower_alternative
human_escalation_available
```

### Rules

- Assisted or LLM-reviewed approval is not a security boundary.
- UI approval cannot override runtime policy.
- A policy conflict pauses the run rather than widening authority.
- Failed sandbox health cannot retry unrestricted.
- The receipt must distinguish “approved but blocked by environment” from “not approved.”

### First implementation
Extend `approvalGate.ts` to emit a decision trace while preserving existing pending/approved/rejected/cancelled semantics.

## P0 — Active Execution Ledger: Inform and Govern

### Problem
A work ledger that only records history does not stop the agent from repeating commands, re-reading stale data, ignoring prior outcomes, or acting on invalid observations.

### OpenClaw change
Split the execution ledger into two runtime surfaces:

```text
inform(run_id)
```

Returns the compact current execution state for the model.

```text
govern(run_id, proposed_action)
```

Deterministically classifies the proposed action before execution.

### Govern decisions

```text
execute
reuse_previous_result
stale_reinspect
redundant
policy_blocked
authority_required
claim_conflict
verification_required
```

### Minimum state fields

```text
observed_files
observed_symbols
modified_files
attempted_commands
successful_commands
failed_commands
verification_receipts
active_claims
stale_observations
open_obligations
current_workspace_epoch
current_policy_digest
```

### Rules

- The model may request action, but `govern` decides whether the action is fresh, redundant, stale, blocked, or allowed.
- Previous successful results can be reused only when source, policy, environment, and command digests still match.
- Stale observations trigger targeted reinspection, not blind patching.
- Ledger state must survive compaction and resume as structured facts, not transcript summaries.

### First implementation
Start with command-result reuse and stale file-read detection. Then add policy and claim checks.

## P0 — Isolated Write Claims for Graph Children

### Problem
Separate graph children or subagents can still share one checkout. Separate run IDs do not imply separate repository truth.

### OpenClaw change
Create an isolated write-claim contract for every write-capable graph child before it mutates source.

### Minimum fields

```text
claim_lease_id
run_id
parent_run_id
base_head
workspace_epoch
claimed_paths
read_blob_hashes
worktree_path
conflicting_run_ids
integration_order
claim_status
claim_amendments
required_integration_tests
```

### Rules

- Every write-capable child declares intended paths before writing.
- Each child should work in an isolated worktree where practical.
- Before applying a patch, compare current blob hash with the blob hash the child inspected.
- A mismatch creates `workspace_stale_before_write`, not an automatic patch attempt.
- Scope expansion requires claim amendment and re-admission.
- Parent integration order must be explicit and evidence-backed.

### First implementation
Start with path-level claims and Git blob hashes in SQLite. Add symbol/interface claims later.

## P0 — Authoritative Child-Run Reconciliation

### Problem
Parent state can disagree with child state. A parent can look complete while a child is still unresolved, or a child can be complete while the parent projection is stale.

### OpenClaw change
Add deterministic child-run reconciliation before any parent terminal transition.

### Minimum fields

```text
parent_run_id
child_run_id
child_type
child_claim_lease_id
child_latest_state
child_terminal_record_id
child_verification_receipt_id
child_error_class
child_partial_output_digest
child_reconciled_at
parent_completion_blocker
```

### Rules

- Parent completion is recomputed from authoritative child run records.
- Missing or contradictory child state creates `incomplete_reconciliation`.
- Restart, resume, upgrade, and scheduler recovery must reconcile children before reporting success.
- Early child events for unknown child IDs should be queued, not dropped.
- A parent run is complete only when every child is verified, failed, cancelled, or explicitly abandoned with evidence.

### First implementation
Add `reconcileChildRunStates(parent_run_id)` as a pure function. Test: all children complete, missing child terminal state, stale parent event, duplicate child event, child failure with partial output, and policy-cancelled child.

## P0 — Idempotent Effect Envelopes for External Writes

### Problem
Approval persistence and effect execution are different problems. A repeated approval prompt or retry must not duplicate GitHub issues, comments, posts, messages, deployments, or restarts.

### OpenClaw change
Wrap every connector mutation in an effect envelope keyed by intended effect, not by attempt.

### Minimum fields

```text
effect_key
task_id
run_id
approval_scope_digest
payload_digest
attempt_id
provider
provider_request_id
provider_readback
reconciliation_status
first_seen_at
last_checked_at
retry_policy
ambiguity_status
```

### Rules

- The same intended mutation reuses the same `effect_key` across retries.
- Before retrying an ambiguous write, query authoritative provider state.
- If the intended effect already exists, return `already_applied`.
- Ambiguous external writes must not be retried blindly.
- Approval replay binds to effect scope; it must not widen or duplicate the effect.

### First implementation
Apply first to social publication and GitHub issue/comment creation.

## P0 — Effective Permission and Sandbox Canaries

### Problem
Policy files are not proof that runtime containment works. Different tool paths may enforce different boundaries.

### OpenClaw change
Add a fail-closed effective-authority preflight that attempts harmless prohibited actions through each execution path.

### Test routes

```text
shell command
patch tool
file read tool
MCP tool
subagent path
scheduler path
approval replay path
resume path
external connector path
```

### Rules

- Deny rules outrank temporary leases.
- Displayed action and effective action must match.
- Boundary mismatch blocks effectful work.
- Re-run after restart, resume, model/tool upgrade, config change, or permission profile change.

### First implementation
Add a read-only `authority:canary` command and one orchestrator test suite.

## P0 — Trajectory Health and Restart-Smart Recovery

### Problem
Long-running failed trajectories can keep spending context and cost after failure is visible.

### OpenClaw change
Add `trajectory_health` monitoring for no-progress loops, repeated verifier failures, context bloat, redundant actions, repeated denials, and budget decay.

### Minimum fields

```text
trajectory_id
health_status
health_signals
first_failure_at
no_progress_count
repeated_action_count
verifier_regression_count
context_growth_rate
budget_spend_rate
frozen_diff_digest
frozen_evidence_ids
restart_decision
reuse_decision
```

### Health statuses

```text
healthy
watching
degraded
restart_recommended
restart_required
abandoned
recovered
```

### Rules

- A degraded trajectory should not automatically keep its conversation history as trusted context.
- Restart preserves source state, diff, receipts, failed-route evidence, and next safe action.
- The new run explicitly chooses `reuse`, `cherry-pick`, or `discard` interrupted work.
- Lessons from the failure are not promoted until independently verified.

### First implementation
Start report-only for graph repair, code refactor, and QA verification lanes.

## P1 — Structured Failure Fingerprints

### Problem
Naive failure hashes either merge unrelated incidents or split the same incident into many unique failures.

### OpenClaw change
Replace `hash(errorText)` with structured failure fingerprints.

### Stable dimensions

```text
failure_class
affected_subsystem
command_or_tool
normalised_stack_frames
policy_decision
verifier_outcome
external_provider
terminal_state
source_state_family
configuration_family
```

### Volatile dimensions to strip

```text
timestamps
process_ids
random_ids
absolute_temp_paths
request_ids
line_numbers_when_stack_shape_is_stable
job_names_when_not_semantically_relevant
```

### Rules

- Raw evidence digest is stored separately from cluster fingerprint.
- Clustering explains which fields matched and which were ignored.
- A human or verifier can split or merge clusters with an audit record.
- Hardening tasks reference failure clusters, not single raw events.

### First implementation
Start with scheduler failures, graph completion failures, provider publication ambiguity, approval replay defects, and service restart failures.

## P1 — Failure-to-Control Pipeline

### Problem
Repairing the same failure twice is waste.

### OpenClaw change
Add a `failure-to-control` transition to incidents and run history.

### Minimum fields

```text
failure_signature
occurrence_count
root_cause_evidence
control_type
context_patch_id
regression_test_id
evaluation_fixture_id
policy_gate_id
control_verified_at
owner
```

### Rules

- First occurrence can be repaired.
- Second independently verified occurrence opens a hardening task.
- The hardening task is not complete until a regression, evaluation, or policy gate catches the failure class.
- Production failures feed QA fixtures and operator docs.

## P1 — Controlled Learning Lifecycle

### Problem
Incidents and successful runs are valuable, but they should not automatically rewrite skills, policies, or memory.

### OpenClaw change
Introduce a lifecycle for durable memory, skills, routing rules, verifiers, and policy changes.

### Lifecycle

```text
proposed
staged
transfer_tested
replay_checked
verifier_approved
active
superseded
retracted
```

### Rules

- `local_context_only` must not become a global skill.
- Failed approaches are preserved with evidence so future agents do not rediscover dead ends.
- Skill or policy changes become active only after transfer test and connected regression replay.
- Retraction cascades to dependent memories, routes, or skills.

## P1 — Skill Relation Graph

### Problem
A new skill can fix one incident while silently regressing adjacent workflows.

### OpenClaw change
Create a `skill_relation` registry for durable skills, policies, verifiers, and prompt fragments.

### Relation types

```text
supersedes
depends_on
conflicts_with
generalises
derived_from
blocks
requires_replay_of
```

### Rules

- Proposed skill changes replay fixtures for connected skills before promotion.
- Conflicting skills cannot both become active without a resolution record.
- Superseded skills remain inspectable for rollback and evidence.
- Skill relation changes are reviewed like source changes.

## P1 — Knowledge Projection After Accepted Work

### Problem
A patch and green tests do not preserve why decisions were made, what was rejected, and what future agents should know.

### OpenClaw change
Every accepted material task produces a compact knowledge projection generated from structured ledger data.

### Minimum fields

```text
decision
alternatives_rejected
assumptions_changed
interfaces_affected
verification_receipts
known_limitations
next_safe_action
rollback_target
reusable_pattern
should_become_skill
promotion_status
```

### Rules

- Projection is generated from ledger and receipts, not free-form memory reconstruction.
- It links to proof packets and receipts rather than copying raw logs.
- It separates reusable lessons from task-local context.
- It feeds the controlled learning lifecycle only when transfer criteria are met.

## Best First PR

Title: `Add active execution ledger and authority-bound child reconciliation primitives`

Scope:

- Add `RunExecutionState`, `AuthorityDecisionReceipt`, `VerificationReceipt`, `ChildRunReconciliation`, `WriteClaimLease`, `EffectEnvelope`, and `TrajectoryHealth` interfaces.
- Implement `inform(run_id)` and first `govern(run_id, proposed_action)` classifiers for redundant command reuse, stale observations, and claim conflicts.
- Add `reconcileChildRunStates(parent_run_id)` as a pure function.
- Add tests for missing child terminal state, stale parent event, child failure with partial output, write-claim conflict, stale blob before write, and sandbox/policy conflict.
- Add docs showing how graph parents must use reconciliation before terminal state.

Acceptance criteria:

- Existing verification pack remains green.
- Parent completion cannot pass in tests while any child lacks authoritative terminal state.
- Write-capable child runs must carry a claim lease in new tests.
- Repeated command proposals can be classified as `reuse_previous_result` only when command, source, policy, and environment digests still match.
- Stale file observations trigger `stale_reinspect`, not blind patching.
- No external write path may advance from ambiguous to success without authoritative readback.

## Recommended 30-Day Order

### Week 1 — Receipt and reconciliation spine

- Add receipt interfaces and structured storage.
- Add child-run reconciliation as a pure function.
- Add active execution state and `inform/govern` read-only surfaces.
- Keep live behaviour unchanged except for report-only evidence.

### Week 2 — Effective authority and write protection

- Add canaries for denied paths, policy conflicts, approval replay, and sandbox degradation.
- Add path-level write claims for graph children.
- Add idempotent effect envelopes for social and GitHub mutations.

### Week 3 — Terminal-state hardening

- Require child reconciliation before parent completion.
- Require verification receipts for social publication, deployment, push, release, service restart, and external effects.
- Add stale-observation detection and redundant-command reuse.

### Week 4 — Learning controls

- Add structured failure fingerprints.
- Add failure-to-control transition.
- Add controlled learning lifecycle for failure-derived lessons.
- Add knowledge projection for accepted material tasks.

## What Not To Build Yet

- More graph parallelism without isolated worktrees or claim leases.
- Self-improving skills that become active after one successful run.
- Failure-to-control automation before failure fingerprints are reliable.
- Proactive repair that grants write access from speculative findings.
- Parent completion based only on expected child event count.
- Retry of ambiguous external writes without provider readback.
- Broad auto-approval that treats reviewer confidence as a boundary.
- Dashboard activity expansion that does not expose accepted outcome, evidence, cost, and terminal integrity.

## Agent Instruction

When an agent reads this file, it must do the following:

1. Determine which single forward control is relevant to the current task.
2. Read current source and runtime configuration before acting.
3. Convert the selected control into one bounded implementation task.
4. Preserve external-write and destructive-action approval boundaries.
5. Produce verification evidence before claiming completion.
6. Write any accepted lesson as a candidate, not an active skill, unless transfer and replay checks pass.

## Bottom Line

OpenClaw Operator’s forward direction is to become a proof-producing, authority-aware graph execution kernel.

The immediate shippable path is:

```text
source-bound receipts
+ active execution ledger
+ child-run reconciliation
+ write claims
+ idempotent effect envelopes
```

That gives Graph a trustworthy spine before adding more autonomy, more parallelism, or self-improving behaviour.
