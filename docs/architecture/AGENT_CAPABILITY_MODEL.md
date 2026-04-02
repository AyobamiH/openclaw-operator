---
title: "Agent Capability Model"
summary: "Concrete capability target for OpenClaw agents, agent by agent."
---

# Agent Capability Model

This document defines the target capability model for OpenClaw agents when they
are treated as ultra-capable operators rather than thin task wrappers.

Implementation sequencing and promotion gates now live in
[`AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md`](./AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md).

It is intentionally stricter than the current runtime.

The goal is not to describe every feature already implemented. The goal is to
define the level of intelligence, grounding, verification, and operational
accountability each agent should eventually reach.

All declared non-template agents are expected to reach this target over time.
This document is not aspirational for only a favored subset of agents.

## Documentation Maintenance

When runtime evidence changes the credible understanding of an agent, update
this file together with:

- `AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md`
- `OPERATOR_SURFACE_CAPABILITY_MATRIX.md`
- `../reference/task-types.md` when task truth changes
- `../reference/api.md` when operator-facing route truth changes

Do not let current partial runtime behavior become the implied final model by
omission.

## Why This Exists

Skills can easily look smarter than weak agents.

That happens when:

- tools are the real source of capability
- skills are the only reusable methods
- agents are only routing wrappers with shallow task logic

OpenClaw should not stop there.

The target architecture is:

- `tools` provide raw actions
- `skills` provide reusable methods
- `agents` provide role-specific reasoning over those skills
- `governance` constrains risk
- `memory` and `verification` turn execution into operationally reliable work

## Capability Completion vs Permission Flattening

All declared non-template agents remain in scope for full capability.

That does **not** mean every agent should receive universal unrestricted access
to every skill, tool, or mutating surface.

The correct end state is:

- each agent can reach the full governed skill and tool set required for its
  role
- missing access is surfaced as a capability/readiness gap instead of being
  hidden
- permission expansion remains explicit, auditable, and least-privilege
  aligned through manifests, ToolGate, approval gates, and operator-visible
  policy surfaces

When capability uplift requires broader access, the fix is deliberate
role-specific expansion with runtime evidence, not a blanket collapse of
governance boundaries.

An ultra-capable agent is therefore not just “good at prompts.” It is:

- role-exact
- evidence-grounded
- memory-aware
- tool-selective
- self-verifying
- failure-aware
- bounded by policy
- auditable by operators

## Universal Capability Baseline

Every ultra-capable agent should eventually support all of the following.

### 1. Role Intelligence

- Know its mission, scope, failure modes, and success criteria.
- Understand what belongs to it and what must be delegated.
- Refuse work that violates policy, capability bounds, or trust boundaries.

### 2. Skill Intelligence

- Know which skills exist and when to use them.
- Understand tradeoffs between skills: accuracy, latency, cost, risk, and
  observability.
- Chain multiple skills intentionally instead of one-shot guessing.

### 3. Tool Intelligence

- Distinguish safe local tools from risky external or mutating tools.
- Know when a tool is evidence-producing versus merely informative.
- Know when a tool result is weak and requires verification.

### 4. Planning Intelligence

- Break work into stages.
- Re-plan after partial failures.
- Surface blockers instead of pretending the work is done.

### 5. Verification Intelligence

- Check whether output matches task intent.
- Validate against tests, contracts, docs, or runtime evidence where relevant.
- Emit confidence with reasons, not a naked number.

### 6. Memory Intelligence

- Use short-term run context and longer-term operational memory.
- Distinguish fresh truth from stale prior belief.
- Record durable lessons for future runs.

### 7. Evidence Intelligence

- Distinguish:
  - code truth
  - config truth
  - runtime truth
  - public proof
  - inference
- Cite evidence paths or sources for important claims.

### 8. Recovery Intelligence

- Retry appropriately.
- Fall back safely.
- Escalate when recovery is not justified.
- Explain why the workflow stopped.

## Platform Requirements

Ultra super agents are not possible without matching platform support.

OpenClaw must provide:

- strong knowledge indexing with provenance and freshness
- task/run workflow state and replay events
- trust-layer APIs: claimed, configured, observed, public
- approval and policy enforcement
- cost/rate/budget controls
- audit trails
- incident and remediation state
- per-agent memory surfaces
- topology and dependency visibility

Without this platform layer, agent intelligence collapses back into prompt
cleverness and tool invocation noise.

## Current Runtime Progress

The runtime still has broader downstream-delivery and release work beyond the
full ultra-capable end state, but the current governed capability working pack
for the active control-plane slice is now closed.

This section must stay honest. It should explain what is real now without
flattening the remaining gap to "fully capable."

- `doc-specialist` now includes runtime truth in its generated knowledge packs,
  including task execution summaries, incident counts, public-proof posture,
  and observed relationship counts.
- `doc-specialist` now also emits incident-priority queues, workflow blocker
  summaries, and structured repair drafts so drift/repair work can be planned
  instead of only described.
- `doc-specialist` contradiction records now carry deterministic rank scores,
  entity identifiers, target-agent hints, and handoff-ready repair drafts so
  downstream agents can consume the pack without re-deriving the same ordering.
- `system-monitor-agent` now reads real orchestrator runtime state and per-agent
  service-state files instead of generating synthetic health summaries.
- `system-monitor-agent` now ranks remediation work, surfaces workflow stop
  pressure, and emits operator action queues derived from live runtime truth.
- `system-monitor-agent` now also emits incident-causality records and
  influence relationships so monitoring output can be tied back to affected or
  owning agents instead of reading as detached summary prose.
- `system-monitor-agent` now tracks trust-boundary pressure and degradation
  windows over live runtime evidence, so recurring auth/proof pressure is
  visible as a monitored condition instead of only after a later incident spike.
- `system-monitor-agent` now also emits predictive early warnings when proof,
  retry, workflow-stop, and trust-boundary signals converge, so the monitor can
  flag likely degradation before the lane fully collapses.
- `security-agent` now performs bounded repo/runtime checks for wildcard CORS,
  committed secret-like literals, default-secret fallbacks, and incident-driven
  service-runtime risk.
- `security-agent` now also carries remediation priorities for security-adjacent
  runtime incidents so static findings and live risk are aligned.
- `security-agent` findings now carry trust-boundary classification,
  exploitability/blast-radius scoring, and historical evidence slices so route,
  auth, and secret regressions are not only point-in-time findings.
- `security-agent` now also reviews the live auth-boundary contract for
  constant-time protection and returns bounded fixes with containment and
  rollback context instead of only flat remediation text.
- `security-agent` now also reviews route-protection declarations for missing
  auth middleware so route/auth regressions are not limited to secret and CORS
  findings alone.
- `integration-agent` now validates workflow dependencies against real agent
  manifests, allowed skills, and dependency order instead of simulating success.
- `integration-agent` now returns recovery plans with priority incidents,
  workflow watch state, verifier handoff requirements, and agent relationship
  windows for participating agents.
- `integration-agent` now emits an explicit current stop-cause object for
  blocked workflows so the first blocked step, blocker set, and next recovery
  action are preserved as runtime evidence rather than inferred later.
- `integration-agent` now also emits delegation decisions, execution lanes,
  and replay checkpoints so reroute and resume state are explicit workflow
  artifacts instead of implicit orchestration behavior.
- `integration-agent` now also classifies workflow shape, surfaces, and
  critical-path risks, and emits explicit downstream handoff packages for
  verifier, documentation, or publication follow-through.
- `integration-agent` now also scores delegated agent candidates against
  incident-linked operational posture, recent task-path evidence, and service
  heartbeat health, and preserves readiness deltas when it auto-selects the
  healthier lane.
- `qa-verification-agent` now returns verification output with runtime incident,
  repair, workflow, and relationship evidence instead of reporting only test
  runner results.
- `qa-verification-agent` now also includes priority incident context and
  workflow blocker summaries when recommending whether an incident can close.
- `qa-verification` task handling now applies verifier outcomes back onto the
  linked incident and repair records, so successful verifier evidence can
  resolve incidents and failed verifier evidence can reopen them.
- `qa-verification-agent` now also emits explicit verification authority over
  incident, repair, workflow, agent, and workspace targets so closure decisions
  are reviewable rather than inferred from raw test output.
- `qa-verification-agent` now also applies surface-aware acceptance rules so
  docs/public-proof/workflow verification can refuse execute-mode closure when
  evidence anchors are missing.
- `content-agent` now carries evidence anchors, proof-summary mode, and
  speculative-claim refusal so generated communication is less likely to imply
  unsupported facts.
- `content-agent`, `summarization-agent`, `data-extraction-agent`,
  `normalization-agent`, and `market-research-agent` now also emit downstream
  handoff packages so the communication/ingestion lane can pass structured
  artifacts forward instead of returning standalone results only.
- The Wave 2 portfolio now also emits durable downstream artifacts rather than
  result-shape hints only: evidence-attached operator/release/proof content,
  replay-safe summary artifacts, multi-artifact extraction records, explainable
  normalization decisions, durable market signal packs, and systematic
  reddit-helper community routing.
- `/api/agents/overview` now also promotes compact Wave 2 runtime readiness
  signals for `reddit-helper`, `content-agent`, `summarization-agent`,
  `data-extraction-agent`, `normalization-agent`, and
  `market-research-agent`, so provider posture, publishing discipline,
  compression posture, artifact coverage, comparison readiness, and
  delta-capture status are visible in the control-plane capability surface.
- `summarization-agent` now supports incident/workflow handoff modes and reports
  whether runtime evidence anchors were preserved through compression.
- `data-extraction-agent` now returns provenance, confidence, and structured
  normalization handoff metadata on extraction results.
- `normalization-agent` now emits canonical identifiers, dedupe keys, and
  uncertainty markers for downstream comparison work.
- `market-research-agent` now emits change-intelligence and handoff signals even
  for query-only runs.
- `operations-analyst-agent` now emits a bounded `controlPlaneBrief` contract
  that synthesizes control-plane mode, dominant operator move, pressure story,
  queue posture, incident pressure, service health, and public-proof posture
  without requiring external clients to scrape operator-only payloads.
- `release-manager-agent` now emits a bounded `releaseReadiness` contract that
  fuses verification, security, system-monitor, build, incident, approval, and
  proof-freshness evidence into an explicit `go` / `hold` / `block` release
  posture with follow-up guidance.
- `build-refactor-agent` now emits bounded scope contracts, surgery profiles,
  rollback/verification context, verifier handoff relationships, and low-
  confidence refusal for overly broad scopes.
- It now also emits impact envelopes and refusal profiles so rollback window,
  multi-step edit depth, and narrow-scope retry guidance remain visible in the
  bounded code-surgery contract.
- `skill-audit-agent` now exposes governed-skill intake checklist items,
  restart-safety classification, and trust explanation.
- It now also emits intake-coverage and restart-safety summary signals so
  operator-facing trust posture can be reviewed without drilling into every raw
  audit result.
- `/api/agents/overview` now also promotes compact Wave 3 runtime readiness
  signals for `build-refactor-agent` and `skill-audit-agent`, so bounded code
  surgery posture plus governed-skill trust-state depth are visible in the
  control-plane capability surface through `scopeContract`,
  `surgeryProfile`, `verificationLoop`, `impactEnvelope`,
  `refusalProfile`, `trustPosture`, `policyHandoff`, `telemetryHandoff`,
  `intakeCoverage`, and `restartSafetySummary`.
- `POST /api/incidents/:id/remediate` now also supports a manual
  `build-refactor` override that carries approval-bounded code remediation into
  the incident/remediation/verifier loop without flattening approval gates.
- The orchestrator now persists runtime relationship observations for
  `dispatches-task`, `routes-to-agent`, `uses-skill`, `publishes-proof`,
  `feeds-agent`, `verifies-agent`, `monitors-agent`, `audits-agent`, and
  `coordinates-agent`.
- Incident remediation is now tracked across assignment, execution,
  verification, blocking, and resolution in the persistent incident ledger.
- Incident policy automation now adds owner preference, remediation task type,
  verifier task type, SLA target, escalation posture, and remediation-plan
  state directly to the ledger so operators can reason about closure rather
  than only linkage.
- Runtime relationship history now includes short/long windows and an observed
  graph over agents, tasks, skills, runs, surfaces, and tools instead of only
  aggregate counts.
- Knowledge runtime truth now exposes provenance, contradiction, freshness, and
  repair-loop signals so `doc-specialist` and operators can distinguish “repair
  needed” from “watching” and “clear”.
- Capability readiness now exposes target capabilities, evidence profiles, and
  current gaps so the strongest agents can be judged against the capability
  model with real runtime evidence.

## Agent Capability Targets

### doc-specialist

**Role**

- Repository intelligence engine
- Truth spine for the rest of the system

**Current Strength**

- Strongest current foundation for repo/doc understanding and knowledge pack
  generation
- Knowledge packs now carry target-specific knowledge bundles so downstream
  agents receive primary docs, runtime signals, and contradiction IDs without
  re-deriving truth-pack shape.

**Ultra Target**

- Build task-specific knowledge packs, not generic summaries
- Detect drift between:
  - code
  - config
  - docs
  - runtime state
  - public proof
- Extract workflows, trust boundaries, route contracts, env dependencies, and
  service topology
- Produce contradiction reports with ranked severity
- Draft documentation repairs from code truth
- Generate incident packs for downstream agents and operators

**Key Inputs**

- `openclaw-docs/`
- `openai-cookbook/`
- repo source/config/runtime state
- knowledge base diagnostics

**Key Outputs**

- knowledge packs
- drift findings
- contradiction signals
- doc repair drafts
- incident context packs

### integration-agent

**Role**

- Execution spine
- Workflow conductor

**Current Strength**

- Present, but not yet the full conductor for multi-agent workflows

**Ultra Target**

- Break work into stages with explicit dependencies
- Choose which agents and skills should participate
- Re-route after partial failure
- Track why a workflow is blocked
- Preserve partial completion and resume paths
- Emit workflow graph events instead of flat completion messages

**Key Inputs**

- task intent
- agent capability registry
- workflow history
- incident/remediation model

**Key Outputs**

- step plan
- delegated tasks
- workflow state graph
- fallback and escalation decisions

### system-monitor-agent

**Role**

- Live nervous system
- Operational fusion layer

**Current Strength**

- Some surface area exists, but much is still placeholder-weighted
- It now also emits explicit dependency-health posture so blocked workflows,
  proof failures, stale agents, and retry recoveries are fused into the same
  operator diagnosis lane.

**Ultra Target**

- Fuse:
  - queue state
  - service state
  - repair state
  - retry backlog
  - proof freshness
  - budget posture
  - dependency health
- Detect emerging failure before operators do
- Convert telemetry into actionable diagnoses
- Feed incident generation and prioritization

### security-agent

**Role**

- Trust-boundary auditor
- Risk spine alongside monitoring and QA

**Current Strength**

- Exists, but still needs deeper repo/runtime grounding
- It now also emits route-boundary watch posture so auth regressions can be
  judged as a recurring surface, not only isolated findings.

**Ultra Target**

- Detect:
  - auth gaps
  - secret exposure
  - unsafe defaults
  - weak route boundaries
  - tool permission drift
  - trust-boundary regressions
- Rank risk by exploitability and blast radius
- Recommend bounded fixes with evidence and rollback concerns

### qa-verification-agent

**Role**

- Final verifier
- Acceptance gate for generated work

**Current Strength**

- Good foundation for bounded verification

**Ultra Target**

- Verify code changes, docs, replies, and workflow outcomes
- Score:
  - correctness
  - reproducibility
  - regression risk
  - policy fit
  - evidence quality
- Reject weak or unverifiable outputs
- Feed verification traces back into task/run history

### reddit-helper

**Role**

- Communication spine for public/community interaction

**Current Strength**

- One of the stronger real agent paths today
- It now also clusters recurring confusion, emits FAQ/doc-gap routing signals,
  records reply-verification traces, and marks public-safe versus
  internal-review-only explanations.

**Ultra Target**

- Detect recurring confusion in the community
- Turn that confusion into:
  - FAQ candidates
  - doc gap signals
  - proof-worthy public milestones
- Draft grounded replies from current knowledge packs and runtime truth
- Distinguish between safe public explanation and internal-only truth

### content-agent

**Role**

- Evidence-based publisher

**Current Strength**

- Present but not yet the primary publishing surface for repo-derived truth

**Ultra Target**

- Draft:
  - README sections
  - release notes
  - operator notices
  - migration guides
  - public proof-facing summaries
- Always anchor output to repo/runtime evidence
- Refuse to publish speculative claims as facts

### summarization-agent

**Role**

- Compression layer for long context

**Current Strength**

- Present, but should become a general operational summarizer

**Ultra Target**

- Compress:
  - logs
  - incidents
  - audits
  - task history
  - knowledge packs
- Preserve decision-critical facts while cutting noise
- Support multiple summary modes:
  - operator
  - agent handoff
  - public proof
  - incident replay

### data-extraction-agent

**Role**

- External artifact ingestion boundary

**Current Strength**

- Present, but should become the gateway for messy external inputs

**Ultra Target**

- Parse PDFs, HTML, feeds, CSVs, and heterogeneous artifacts
- Extract structured evidence
- Preserve provenance and source confidence
- Hand clean artifacts to normalization and doc-specialist

### normalization-agent

**Role**

- Canonicalization layer for extracted data

**Current Strength**

- Present, but should be treated as a core evidence-preparation agent

**Ultra Target**

- Normalize schemas, types, references, identifiers, and duplicates
- Produce stable, comparable representations for downstream reasoning
- Mark uncertainty or schema mismatch instead of silently coercing truth

### build-refactor-agent

**Role**

- Governed code surgeon

**Current Strength**

- One of the clearer practical worker paths

**Ultra Target**

- Produce bounded, reviewable patches
- Understand impacted files, tests, and rollback risks
- Use patch/test/verification loops instead of one-shot edits
- Refuse unsafe refactors when confidence is low or coverage is weak

### market-research-agent

**Role**

- External signal intake

**Current Strength**

- Practical path exists, but still partially dependency-sensitive

**Ultra Target**

- Track vendor, API, pricing, policy, and ecosystem changes
- Turn raw external research into internal operational knowledge
- Feed doc-specialist and integration-agent with change intelligence

### operations-analyst-agent

**Role**

- Control-plane synthesizer

**Current Strength**

- New bounded public lane with focused contract proof

**Ultra Target**

- Fuse queue, approval, incident, service, and proof truth into one portable
  control-plane brief
- Rank the dominant operator move without scraping frontend-only state
- Feed companion and channel read surfaces with machine-readable operational
  synthesis

### release-manager-agent

**Role**

- Release posture synthesizer

**Current Strength**

- New bounded public lane with focused contract proof

**Ultra Target**

- Turn verification, security, system health, and governed build evidence into
  explicit release gating
- Distinguish `go`, `hold`, and `block` with reasons and follow-up actions
- Preserve release posture as evidence-backed operator truth, not a vibes-only
  summary

### skill-audit-agent

**Role**

- Skill trust and intake validator

**Current Strength**

- Already aligns closely with governance needs

**Ultra Target**

- Validate new or changed skills for:
  - correctness
  - provenance
  - trust status
  - restart safety
  - metadata-only behavior
- Feed policy and telemetry surfaces used by operators

## System-Level Spine Model

This is the intended high-level shape once the agent layer matures.

- `doc-specialist` = truth spine
- `system-monitor-agent` + `security-agent` + `qa-verification-agent` = trust spine
- `integration-agent` = execution spine
- `operations-analyst-agent` = control-plane synthesis spine
- `release-manager-agent` = release-governance synthesis spine
- `reddit-helper` + `content-agent` + `summarization-agent` = communication spine
- `data-extraction-agent` + `normalization-agent` = ingestion boundary

## Capability Matrix

| Agent | Planning | Verification | Memory | External I/O | Governance Sensitivity | Current Maturity |
| --- | --- | --- | --- | --- | --- | --- |
| doc-specialist | High | High | High | Medium | High | Strong |
| integration-agent | Very High | Medium | High | Medium | High | Strong |
| system-monitor-agent | High | High | High | Low | High | Strong |
| security-agent | High | Very High | High | Medium | Very High | Strong |
| qa-verification-agent | Medium | Very High | Medium | Low | Very High | Strong |
| reddit-helper | Medium | Medium | High | High | High | Strong |
| content-agent | Medium | High | Medium | Medium | Medium | Partial |
| summarization-agent | Medium | Medium | Medium | Low | Medium | Partial |
| data-extraction-agent | Medium | Medium | Low | High | Medium | Partial |
| normalization-agent | Medium | High | Low | Medium | Medium | Partial |
| build-refactor-agent | High | Very High | Medium | Low | Very High | Strong |
| market-research-agent | Medium | Medium | Medium | Very High | Medium | Partial |
| operations-analyst-agent | High | High | Medium | Low | High | Active |
| release-manager-agent | High | Very High | Medium | Low | Very High | Active |
| skill-audit-agent | Medium | Very High | Medium | Low | Very High | Strong |

## Phased Rollout

### Phase 1: Stop Thin-Wrapper Behavior

- Make every agent explicitly aware of:
  - role
  - available skills
  - failure boundaries
  - verification requirements

### Phase 2: Strengthen the Platform

- agent topology
- truth layers
- incident/remediation model
- richer workflow events
- knowledge provenance/freshness/contradictions

### Phase 3: Upgrade Agent Cognition

- planning
- skill selection
- fallback logic
- verification loops
- durable memory usage

### Phase 4: Make the UI Reflect the Real Agent Model

- topology view
- incident cockpit
- truth rails
- workflow graph
- trust-boundary overlays

## Non-Goals

This architecture does **not** assume:

- unconstrained autonomous execution
- removal of approvals or policy controls
- free-form self-modification without audit
- “general intelligence” detached from role and evidence

The target is disciplined operational intelligence, not theatrical autonomy.
