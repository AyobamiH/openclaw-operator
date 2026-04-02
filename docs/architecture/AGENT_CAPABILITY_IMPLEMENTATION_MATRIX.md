---
title: "Agent Capability Implementation Matrix"
summary: "Concrete implementation and promotion matrix for all declared OpenClaw agents."
---

# Agent Capability Implementation Matrix

This document turns the capability target in
[`AGENT_CAPABILITY_MODEL.md`](./AGENT_CAPABILITY_MODEL.md) into an execution
matrix for the whole agent set.

When the work is specifically about adapting proven external specialist-role
patterns into the current agent portfolio without changing the task/runtime
architecture, use
[`AGENT_ADAPTATION_PLAN.md`](./AGENT_ADAPTATION_PLAN.md) together with this
matrix.

Use it when deciding:

- what capability work is still missing for an agent
- whether an agent's task lane is mature enough to be treated as product truth
- what order to implement capability uplift without dropping any agent from scope

## Core Policy

All declared agents are in scope.

Execution can be staged, but scope is not selective. No declared agent should
be treated as permanently secondary, optional, or out-of-model.

The promotion rule is:

1. the agent must approach its target capability model
2. runtime evidence must support that claim
3. then its task lane can be treated as final operator-facing product truth

Current UI exposure is therefore not the same thing as promotion completion.

The intended end state is still full-capability coverage across the entire
declared agent portfolio. This matrix exists to make that visible rather than
to legitimize partial completion as the steady state.

Capability-access boundary:

- full capability must not be interpreted as universal unrestricted access to
  every skill or tool for every agent
- each agent should instead reach role-complete governed access to the skills
  and tools it actually needs
- missing access should be documented as a real implementation gap until the
  manifest, ToolGate, policy, and runtime evidence all support the expansion

Portfolio-growth boundary:

- broader public agent growth is now defined as one-by-one productization of
  usable external agent ideas or role catalogs that the repo does not already
  cover
- each new agent must earn the same standard as the current shipped agents:
  bounded mission, owned lane, governed access, runtime evidence, operator
  truth, tests, and docs
- external prose or repo presence alone is never enough to count an agent as
  part of the public portfolio

External-capability translation rule:

- external role, workflow, skill, or tool ideas may inform the public roadmap,
  but they must be translated into OpenClaw-native contracts before they count
  as real capability
- that translation must preserve the current execution model: bounded task
  lanes, governed skills and manifests, approval boundaries, operator-visible
  evidence, and tests
- external modules, scripts, or automation should not be adopted wholesale just
  because the source prose implies a capability; rebuild the useful idea inside
  the existing trust model instead

## Documentation Maintenance

Update this matrix whenever any of the following changes materially:

- a declared agent's runtime evidence
- a declared agent's promotion gate
- the current maturity assessment for an agent
- execution-wave ordering because shared leverage has changed

Those updates should be kept aligned with:

- `AGENT_CAPABILITY_MODEL.md`
- `OPERATOR_SURFACE_CAPABILITY_MATRIX.md`
- `../reference/task-types.md`
- `../reference/api.md`

## Source Of Truth

Use these together:

1. active runtime code and live config
2. [`AGENT_CAPABILITY_MODEL.md`](./AGENT_CAPABILITY_MODEL.md)
3. [`AGENT_ADAPTATION_PLAN.md`](./AGENT_ADAPTATION_PLAN.md) when the work is an adaptation/uplift pass rather than a new lane or architecture change
4. [`OPERATOR_SURFACE_CAPABILITY_MATRIX.md`](./OPERATOR_SURFACE_CAPABILITY_MATRIX.md)
5. [`../reference/task-types.md`](../reference/task-types.md)
6. [`../reference/api.md`](../reference/api.md)
7. [`../../agents/README.md`](../../agents/README.md)

## Universal Promotion Gate

Before any agent should be considered fully promoted in-role, the following
must be substantially true:

- Role intelligence: the agent refuses out-of-scope work and can explain what
  belongs to it.
- Skill intelligence: the agent can choose among allowed skills intentionally,
  not just call a single default path.
- Tool intelligence: the agent distinguishes informative tool output from
  evidence-producing output.
- Planning intelligence: the agent can stage work, surface blockers, and
  recover after partial failure.
- Verification intelligence: the agent validates its output against contracts,
  runtime evidence, or explicit checks relevant to its role.
- Memory intelligence: the agent uses short-run state and durable memory
  instead of re-deriving everything as if fresh.
- Evidence intelligence: the agent can distinguish code, config, runtime,
  public proof, and inference.
- Recovery intelligence: the agent does not report false-green completion when
  it should retry, fall back, or escalate.
- Access intelligence: the agent has the governed skill and tool access needed
  for its role, and any missing access is visible as a real maturity gap rather
  than hidden behind optimistic task exposure.

## Portfolio Summary

| Agent | Spine | Current Maturity Signal | Current Runtime Signal | Promotion State | Execution Wave |
|---|---|---|---|---|---|
| `doc-specialist` | truth | Strong foundation | strong truth-spine evidence now includes complete agent-overview runtime-signal coverage for task-specific knowledge, evidence rails, topology packs, contradiction ledger, repair drafts, and freshness signals, with focused integration proof and runtime-contract proof green | complete | Wave 1 |
| `integration-agent` | execution | Strong foundation | workflow lane now emits delegation, replay, recovery, handoff, workflow-profile, explicit partial-completion evidence, and incident-linked readiness/trust-aware candidate selection, and those conductor signals are now preserved end-to-end in readiness output with live proof in the integration suite | complete | Wave 1 |
| `system-monitor-agent` | trust | Strong foundation | monitor path now includes incident causality, trust-boundary pressure, degradation windows, early warnings, dependency health, and queue/budget fusion evidence, and those runtime signals are now surfaced end-to-end through agent overview with live proof | complete | Wave 1 |
| `security-agent` | trust | Strong foundation | audit lane now scores exploitability and auth/trust-boundary findings with route-protection review, bounded containment guidance, regression review, permission drift, route-boundary watch, and remediation-depth evidence surfaced end-to-end with live proof | complete | Wave 1 |
| `qa-verification-agent` | trust | Strong foundation | verifier path now emits authority, trace, surface, refusal, and explicit acceptance-coverage evidence across verification surfaces, and those signals are now surfaced end-to-end through agent overview with live proof | complete | Wave 1 |
| `reddit-helper` | communication | Strong foundation | strongest communication lane today now carries provider posture, doctrine verification, explanation-boundary review, and systematic community routing into docs, FAQ, and proof follow-through, and that provider posture remains surfaced in readiness output | complete | Wave 2 |
| `content-agent` | communication | Strong foundation | generation lane now carries evidence-attached publishing schema, specialized operator/release/proof modes, speculative-refusal policy, and explicit routing decisions, and publication policy remains surfaced in readiness output | complete | Wave 2 |
| `summarization-agent` | communication | Strong foundation | summarization now supports handoff modes, anchor preservation checks, action-critical replay details, and downstream replay artifacts, and that operational compression posture remains surfaced in readiness output | complete | Wave 2 |
| `data-extraction-agent` | ingestion | Strong foundation | extraction now carries provenance, confidence, normalization handoff data, explicit artifact records across multiple artifact classes, and artifact-coverage summaries, and that artifact coverage remains surfaced in readiness output | complete | Wave 2 |
| `normalization-agent` | ingestion | Strong foundation | normalization now emits canonical ids, dedupe keys, uncertainty flags, explainable schema mismatches, and explicit comparison-ready handoff posture, and that comparison readiness remains surfaced in readiness output | complete | Wave 2 |
| `market-research-agent` | ingestion | Strong foundation | query and URL lanes now emit change-intelligence, internal durable signal packs, structured change packs, and explicit delta-capture posture, and that delta-capture posture remains surfaced in readiness output | complete | Wave 2 |
| `deployment-ops-agent` | trust | Focused bounded lane | deployment-ops synthesis now emits explicit `ready` / `watch` / `blocked` posture across rollout surfaces, rollback readiness, pipeline evidence, and docs parity with targeted contract proof | active | Wave 4 |
| `operations-analyst-agent` | truth | Focused bounded lane | control-plane brief synthesis now emits mode, dominant move, pressure story, proof posture, and portable companion-facing summaries with targeted contract proof | active | Wave 4 |
| `release-manager-agent` | trust | Focused bounded lane | release-readiness synthesis now emits explicit `go` / `hold` / `block` posture across verification, security, system, incident, approval, and proof evidence with targeted contract proof | active | Wave 4 |
| `build-refactor-agent` | code | Strong foundation | build lane now emits bounded scope contracts, surgery profiles, rollback/verification context, verifier handoff relationships, and repair-linked verification-loop evidence, and those governance signals are now surfaced end-to-end through agent overview with live proof | complete | Wave 3 |
| `skill-audit-agent` | trust | Strong foundation | governance lane now promotes trust posture, policy handoff, and telemetry handoff into runtime readiness with governed-skill depth, and those signals remain proven end-to-end through the control-plane readiness surface | complete | Wave 3 |

Wave meaning:

- Wave 1: truth / trust / execution core
- Wave 2: communication and ingestion expansion
- Wave 3: code-governance hardening and final uplift
- Wave 4: companion-facing synthesis and release-governance expansion

All waves remain in scope. This is ordering only.

## Per-Agent Implementation Matrix

### doc-specialist

**Current runtime truth**

- Wave 1 promotion gate is closed for the current runtime slice.
- Real evidence exists for knowledge-pack generation, doc-drift repair linkage,
  contradiction ranking, evidence rails, topology packs, repair drafts, and
  freshness signals, with those artifacts surfaced through agent overview and
  covered by focused runtime proof plus the targeted topology-pack runtime
  contract.
- It now also emits target-specific knowledge bundles so downstream agents can
  consume primary docs, runtime signals, and contradiction IDs directly.
- It now also emits an entity-level freshness ledger plus a contradiction-graph
  summary so stale-versus-fresh truth and cross-rail contradiction depth are
  consumable without re-parsing the raw ledger.

**Post-gate uplift targets**

- The current control-plane slice now covers these uplift targets through the
  ranked contradiction graph, route/env/service topology packs, structured
  repair drafts, and entity-level freshness ledger.
- Remaining work is broader downstream adoption of those pack contracts, not
  missing runtime evidence in the current slice.

**Promotion gate**

- Contradiction graph is real and ranked.
- Runtime truth, public proof, and config truth are packed as separate evidence rails.
- Repair drafts are structured enough for downstream execution without free-form reinterpretation.

**First implementation slices**

1. entity-level contradiction ledger
2. task-specific knowledge pack shaping
3. stronger doc-repair draft structure
4. freshness and provenance weighting in retrieval

### integration-agent

**Current runtime truth**

- Wave 1 promotion gate is closed for the current runtime slice.
- The workflow lane now emits explicit stop-cause and resume guidance instead
  of only a flattened stop summary.
- It now also emits delegation decisions, execution lanes, and replay
  checkpoints so reroute and resume state are preserved as first-class
  workflow artifacts.
- It now also classifies workflow surface, critical path, and coordination
  risks, and emits explicit verifier/doc/publication handoff packages.
- It now also emits explicit partial-completion state so blocked steps,
  remaining steps, reroute count, and replayability are consumable without
  reconstructing them from the workflow plan and replay contract separately.
- It now also scores workflow candidates against incident-linked operational
  posture, task-path proof, and service heartbeat evidence, and preserves
  readiness deltas when it auto-selects the healthier lane.
- It now also emits explicit dependency plans and workflow-memory snapshots,
  and candidate selection now uses relationship-window and workflow-pressure
  inputs in addition to incident/service/task evidence.

**Post-gate uplift targets**

- The current control-plane slice now covers these uplift targets through
  dependency-aware workflow planning, richer readiness/trust inputs, durable
  workflow-memory state, and stronger blocked-state causality.
- Remaining work is broader workflow-class adoption, not a missing Wave 1
  runtime contract.

**Promotion gate**

- Workflow plans are explicit and replayable.
- Re-routing and blocked-state explanations are part of the normal path.
- Cross-agent delegation is visible in runtime history, not just inferred.

**First implementation slices**

1. bounded workflow plan object
2. dependency-aware delegation selection
3. partial-completion / resume contract
4. richer stop-cause and fallback emission

### system-monitor-agent

**Current runtime truth**

- Wave 1 promotion gate is closed for the current runtime slice.
- It now emits explicit incident-causality and influence relationships instead
  of only agent-health snapshots.
- It now also tracks trust-boundary pressure and rolling degradation windows so
  recurring auth/proof pressure is visible before it is flattened into a later
  operator-only summary.
- It now also emits early-warning signals when proof, retry, workflow, and
  trust-boundary evidence converge on the same lane.
- It now also emits explicit dependency-health posture covering blocked
  workflows, proof failures, stale agents, and retry recoveries.
- It now also emits operator-closure evidence and trend summaries so
  queue/budget/trust/proof pressure becomes reviewable as a closure-oriented
  runtime contract instead of only a diagnosis list.

**Post-gate uplift targets**

- The current control-plane slice now covers these uplift targets through
  fused operator diagnosis, early-warning emission, queue/budget prioritization,
  operator-closure evidence, and rolling trend summaries.
- Remaining work is wider operator adoption beyond the focused fixture path.

**Promotion gate**

- Monitoring outputs consistently drive incidents or remediation prioritization.
- Relationship history shows monitoring influence over other agents or services.
- Proof freshness and budget posture become first-class monitoring inputs.

**First implementation slices**

1. proof freshness + retry backlog fusion
2. budget posture and queue-pressure diagnosis
3. monitor-to-incident causality emission
4. rolling degradation trend summaries

### security-agent

**Current runtime truth**

- Wave 1 promotion gate is closed for the current runtime slice.
- Findings now carry scored exploitability, blast-radius, and historical
  trust-boundary evidence instead of only flat severity labels.
- The audit path now also inspects the live auth-boundary contract for
  constant-time comparison protection and returns bounded fixes with
  containment and rollback context.
- It now also reviews route declarations for missing auth middleware so route
  protection regressions are surfaced as first-class findings.
- It now also emits route-boundary watch posture so recurring auth regressions
  are summarized across findings and historical evidence.
- It now also emits exploitability-ranked findings and remediation-closure
  posture so rollback-aware fixes, owner gaps, and verifier-sensitive blockers
  are visible as first-class outputs.

**Post-gate uplift targets**

- The current control-plane slice now covers these uplift targets through
  exploitability ranking, historical permission-drift review, route/auth
  boundary review, and bounded remediation-closure guidance.
- Remaining work is wider verifier/operator adoption of those closure signals.

**Promotion gate**

- Findings distinguish severity from exploitability.
- Route/auth boundary regressions are evidence-backed and historical.
- Security remediation recommendations are bounded and operator-credible.

**First implementation slices**

1. trust-boundary regression history
2. blast-radius scoring
3. permission-drift timeline
4. remediation guidance with rollback notes

### qa-verification-agent

**Current runtime truth**

- Wave 1 promotion gate is closed for the current runtime slice.
- Verification runs exist, including dry-run and limited execute-mode
  evidence, and verifier outcomes now drive linked incident resolution and
  reopen state in the orchestrator instead of remaining advisory-only traces.
- It now also emits explicit verification authority over incident, repair,
  agent, workflow, and workspace targets so closure decisions are reviewable.
- It now also applies surface-aware acceptance contracts so docs/public-proof
  verification can refuse execute-mode closure when evidence anchors are
  missing.
- It now also emits explicit acceptance coverage so closure readiness over
  code, docs, public-proof, workflow, and runtime surfaces is reviewable as a
  first-class output.
- It now also emits explicit closure contracts and reproducibility profiles so
  close/reopen authority, regression risk, and unresolved verification pressure
  are visible without reconstructing them from traces manually.

**Post-gate uplift targets**

- The current control-plane slice now covers these uplift targets through
  verifier-backed closure contracts, unified traces, reproducibility profiles,
  and surface-aware refusal logic.
- Remaining work is broader target-surface adoption, not missing runtime proof.

**Promotion gate**

- Verification outcomes drive incident closure and reopen decisions reliably.
- Reproducibility and policy-fit checks are explicit in outputs.
- False-green completions are rare and detectable from evidence traces.

**First implementation slices**

1. verifier-driven closure / reopen contract
2. richer verification trace schema
3. policy-fit and reproducibility scoring
4. broader target modes beyond code/test checks

### reddit-helper

**Current runtime truth**

- One of the stronger live agent paths.
- It now clusters recurring confusion, emits FAQ/doc-gap handoff records,
  verifies reply doctrine, marks internal-review-only explanations when a
  draft crosses the public boundary, and routes community signals into docs,
  FAQ, and bounded proof follow-through systematically.
- Provider fallback preserves local doctrine and keeps the communication lane
  reviewable when the model path is rate-limited or unavailable.

**Missing ultra behaviors**

- No open Wave 2 promotion blockers remain in the current runtime slice.

**Promotion gate**

- Public drafting is knowledge-grounded, reviewable, and self-auditing.
- Community signals feed doc-specialist and proof surfaces systematically.
- Provider outage does not collapse the whole communication lane.

**First implementation slices**

1. recurring confusion clustering
2. FAQ/doc-gap handoff records
3. reply verification trace
4. public-safe vs internal-only explanation boundary
5. systematic community routing across docs, FAQ, and proof follow-through

### content-agent

**Current runtime truth**

- Can generate bounded content from supplied source context.
- It now carries evidence anchors and refuses speculative publication unless
  the source explicitly allows labeled speculation.
- It now also emits explicit downstream handoff packages for doc-specialist,
  summarization-agent, or reddit-helper depending on publication mode.
- It now also emits explicit routing decisions so operator/public/general
  audience handling and proof versus incident document mode are visible in the
  result contract.
- It now also attaches evidence rails and source summaries directly to the
  generated content contract and specializes operator notices and release notes
  alongside proof-facing output.

**Missing ultra behaviors**

- No open Wave 2 promotion blockers remain in the current runtime slice.

**Promotion gate**

- Generated content cites evidence rails or source summaries.
- Publishing modes are differentiated by risk and audience.
- Speculative output is rejected or clearly labeled.

**First implementation slices**

1. evidence-attached publishing schema
2. specialized modes for README / release notes / operator notices
3. proof-facing summary mode
4. speculative-claim refusal checks

### summarization-agent

**Current runtime truth**

- Summarization lane works.
- It now supports incident/workflow handoff modes and reports whether runtime
  evidence anchors survived compression.
- It now also emits downstream handoff packages for QA, integration, or content
  consumers depending on summary mode.
- It now also emits operational compression posture so downstream consumers can
  tell whether anchor retention and blocker safety stayed intact.
- It now also emits action-critical replay details and downstream replay
  artifacts so incident/workflow summaries become reusable workflow objects.

**Missing ultra behaviors**

- No open Wave 2 promotion blockers remain in the current runtime slice.

**Promotion gate**

- Summaries are mode-aware and retain action-critical details.
- Agent handoff and incident replay summaries become normal workflow artifacts.
- Summaries are used downstream, not just produced in isolation.

**First implementation slices**

1. multi-mode summary contract
2. incident replay summarization
3. handoff summary integration
4. evidence-preserving compression checks

### data-extraction-agent

**Current runtime truth**

- Inline-source extraction works.
- Extraction output now carries provenance, confidence, and explicit
  normalization handoff metadata.
- It now also emits extraction handoff packages so normalization and
  doc-specialist can consume raw or normalized artifacts directly.
- It now also emits explicit artifact-coverage summaries so format mix,
  adapter mode, and normalization readiness are visible in one place.
- It now also emits uniform artifact records across inline and structured
  artifact classes so multiple source types share one evidence-preserving model.

**Missing ultra behaviors**

- No open Wave 2 promotion blockers remain in the current runtime slice.

**Promotion gate**

- Multiple artifact classes are handled under one evidence-preserving model.
- Extraction output carries provenance and confidence explicitly.
- Handoff to normalization is structured and predictable.

**First implementation slices**

1. source-type-specific extraction adapters
2. provenance-rich extraction schema
3. explicit confidence markings
4. structured normalization handoff

### normalization-agent

**Current runtime truth**

- Normalization works on bounded inputs.
- It now emits canonical identifiers, dedupe keys, and uncertainty flags
  instead of only silent cleaned records.
- It now also emits canonical dataset handoff packages so downstream agents can
  consume comparison-ready normalized records directly.
- It now also emits explicit comparison-readiness posture covering duplicate
  keys, uncertainty counts, and canonical id coverage.
- It now also emits explainable schema mismatches and dedupe decisions so
  downstream consumers can trust why records stayed distinct or require review.

**Missing ultra behaviors**

- No open Wave 2 promotion blockers remain in the current runtime slice.

**Promotion gate**

- Normalization preserves uncertainty explicitly.
- Deduplication and schema decisions are explainable.
- Downstream agents can trust normalized output as comparable input.

**First implementation slices**

1. uncertainty and schema-mismatch markers
2. canonical identifier shaping
3. dedupe rationale output
4. comparison-ready normalized record format

### build-refactor-agent

**Current runtime truth**

- Wave 3 promotion gate is closed for the current runtime slice.
- One of the clearest practical worker paths.
- It now emits bounded scope contracts, surgery profiles, rollback-aware patch
  summaries, verification plans, verifier handoff relationships, and a
  low-confidence refusal path for overly broad scopes.
- Explicit `changes[]` payloads now execute real bounded `workspacePatch`
  edits and optional whitelisted `testRunner` verification instead of only
  returning placeholder “would edit” summaries.
- Manual incident remediation can now launch `build-refactor` as an
  approval-bounded code-remediation lane with verifier-linked constraints, and
  those signals are now surfaced through `/api/agents/overview` with live
  proof.
- It now also emits explicit impact envelopes and refusal profiles so
  multi-step edit depth, rollback window, verification depth, and narrow-scope
  retry guidance are first-class runtime signals.

**Missing ultra behaviors**

- The current control-plane slice now covers real explicit code-surgery
  execution, impact-aware patch contracts, explicit refusal profiles, and
  verifier-linked repair-safe edit posture.
- Remaining work is deeper autonomous patch synthesis for remediation/planning
  lanes beyond the current explicit-payload execution path, not a missing Wave
  3 runtime signal surface.

**Promotion gate**

- Patch results include impact, rollback, and verification context.
- Edits that lack credible verification are refused or held.
- Repair-linked code actions close the loop with QA and incident state.

**First implementation slices**

1. rollback-aware patch summary
2. stronger verification loop after edits
3. low-confidence refusal rules
4. repair-linked edit mode

### market-research-agent

**Current runtime truth**

- Query-first lane works.
- It now emits change-intelligence summaries and downstream handoff signals
  even when operating in query-only mode.
- It now also emits structured market change packs for summarization or
  integration follow-through.
- It now also emits explicit delta-capture posture so query-only, fetched, and
  mixed-source runs remain distinguishable during degradation.
- It now also emits durable internal signal packs with classified research
  surfaces so pricing, policy, API, and vendor changes can feed docs and
  workflow decisions instead of remaining one-off findings.

**Missing ultra behaviors**

- No open Wave 2 promotion blockers remain in the current runtime slice.

**Promotion gate**

- Research outputs become durable internal signals, not just one-off findings.
- External changes are structured enough to feed drift, docs, or workflow decisions.
- URL/network failures do not erase the value of the query-first lane.

**First implementation slices**

1. change-intelligence output schema
2. doc-specialist handoff for external change packs
3. structured vendor/policy/API delta capture
4. stronger query-only default with graceful URL degradation

### operations-analyst-agent

**Current runtime truth**

- The focused public control-plane brief lane is now live for the current
  runtime slice.
- It emits bounded control-plane mode, ranked primary operator move, pressure
  story, queue posture, incident pressure, service posture, and public-proof
  posture in one reusable contract.
- The same bounded brief now feeds the companion overview surface, so external
  bridge and channel clients do not need to scrape operator-only payloads.

**Missing ultra behaviors**

- Broader live adoption is still ahead, but the current runtime slice already
  proves the bounded synthesis contract.

**Promotion gate**

- The brief stays machine-readable and bounded.
- Operator move ranking is grounded in live queue, approval, incident, and
  proof signals.
- External clients can reuse the contract without inventing their own control
  plane summary logic.

**First implementation slices**

1. control-plane mode contract
2. dominant operator move ranking
3. portable companion-overview payload
4. bounded service and proof synthesis

### deployment-ops-agent

**Current runtime truth**

- The focused public deployment-ops lane is now live for the current runtime
  slice.
- It emits explicit `ready` / `watch` / `blocked` posture, blocker summaries,
  follow-up actions, rollback readiness, environment drift, pipeline posture,
  and rollout-surface checks across the public service and Docker demo paths.
- The lane remains bounded: it summarizes deployment posture but does not
  itself deploy, restart, or bypass approval policy.

**Missing ultra behaviors**

- Broader deployment-process adoption is still ahead, but the current runtime
  slice already proves the bounded deployment-synthesis contract.

**Promotion gate**

- Deployment posture is evidence-backed rather than optimistic.
- Missing rollout surfaces or blocked verification/security/runtime evidence
  can all block the lane.
- Operators can act on rollback, drift, and pipeline guidance without
  reconstructing deployment posture from multiple routes and docs.

**First implementation slices**

1. deployment posture contract
2. rollback readiness synthesis
3. docs and workflow drift review
4. bounded rollout follow-up guidance

### release-manager-agent

**Current runtime truth**

- The focused public release-readiness lane is now live for the current runtime
  slice.
- It emits explicit `go` / `hold` / `block` posture, blocker summaries,
  follow-up actions, and evidence-window details across verification,
  security, system-monitor, build, incident, approval, and proof-freshness
  inputs.
- The lane remains bounded: it summarizes release posture but does not itself
  deploy or bypass approval gates.

**Missing ultra behaviors**

- Broader release-process adoption is still ahead, but the current runtime
  slice already proves the bounded release-synthesis contract.

**Promotion gate**

- Release posture is evidence-backed rather than optimistic.
- Verification, security, system, and approval pressure can all block the lane.
- Operators can act on the returned blockers and follow-up guidance without
  reconstructing the release story from multiple routes.

**First implementation slices**

1. release posture contract
2. blocker and follow-up synthesis
3. evidence-window aggregation
4. bounded operator-visible release guidance

### skill-audit-agent

**Current runtime truth**

- Wave 3 promotion gate is closed for the current runtime slice.
- Runtime readiness now promotes trust-state depth directly through
  `/api/agents/overview`.
- It emits governed-skill intake checklist items, restart-safety
  classification, operator-facing trust explanation, and promoted
  `trustPosture`, `policyHandoff`, and `telemetryHandoff` signals.
- It now also emits aggregated intake-coverage and restart-safety summaries so
  provenance depth, checklist failures, and executable-vs-metadata-only
  outcomes are visible without drilling into each raw result record.
- Live proof now covers those runtime readiness signals end to end through the
  operator capability surface.
- The remaining work is operator adoption and governance workflow usage,
  not missing runtime evidence.

**Missing ultra behaviors**

- The current control-plane slice now covers these uplift targets through
  governed-skill intake coverage, restart-safety summaries, and promoted
  policy/telemetry handoff signals.
- Remaining work is operator adoption of those signals, not missing runtime
  evidence in the current slice.

**Promotion gate**

- New or changed skills get evidence-backed intake decisions.
- Restart-safe and metadata-only distinctions are explicit.
- Operators can see why a skill is trusted, restricted, or non-executable.

**First implementation slices**

1. governed skill intake checklist
2. provenance and restart-safety evidence capture
3. operator-facing trust-state explanation
4. tighter policy telemetry handoff

## Execution Rule

All agents are in scope.

Execution order should prioritize shared leverage first:

1. truth / trust / execution core
2. communication and ingestion layers
3. code and governance hardening

But no implementation phase should redefine a non-template declared agent as
out of scope.

Document movement as it happens. If one wave advances materially, update this
matrix in the same change set so the repo continues to describe what has been
built versus what is still missing.

## Done Condition

This matrix should be considered materially complete only when:

- each agent has a current runtime assessment
- each agent has a concrete gap list
- each agent has a promotion gate
- each agent has a first implementation slice
- task promotion decisions can point back to this matrix instead of relying on
  memory or chat history
