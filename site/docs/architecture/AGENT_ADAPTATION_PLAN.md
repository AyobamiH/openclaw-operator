---
title: "Agent Adaptation Plan"
summary: "Implementation-ready plan for adapting proven role patterns from agency-agents into the current OpenClaw Operator agent portfolio."
---

# Agent Adaptation Plan

This document defines the current adaptation plan for improving the existing
OpenClaw Operator agents by borrowing the strongest role, workflow, and
deliverable patterns from the external
[`msitarzewski/agency-agents`](https://github.com/msitarzewski/agency-agents)
repository.

This is an adaptation plan, not an architectural inversion plan.

The current runtime model remains:

- OpenClaw gateway/runtime as ingress and channel companion
- orchestrator as the execution and governance authority
- current task lanes, API contracts, approval boundaries, and operator truth as
  the controlling product contract

## Hard Scope For This Plan

This plan is intentionally narrow.

In scope:

- improving the existing 13 declared non-template agents
- strengthening role intelligence, workflow clarity, refusal quality,
  deliverable framing, and operator-facing output usefulness
- adapting wording, structure, and reasoning patterns from strong external
  agent specs into the current agent portfolio

Out of scope:

- adding new task lanes
- replacing orchestrator with OpenClaw-native agent dispatch
- flattening ToolGate, skill allowlists, or governance boundaries
- importing the external repository as a runtime architecture template
- adding broad new operator pages solely for the adaptation pass

New task lanes are future work and should only start after this plan is agreed
on and implemented.

## Why Adapt Instead Of Copy

`agency-agents` is strong at:

- specialist role definition
- workflow and deliverable clarity
- persona and communication discipline
- explicit "when to use this agent" framing

This workspace is strong at:

- orchestration
- approvals
- run history
- incidents
- readiness and proof
- governed skills and runtime evidence

The right move is therefore:

- borrow role and workflow patterns
- keep the current orchestrator architecture
- make existing agents feel more expert, more explicit, and more useful inside
  the current operator product

## Cross-Cutting Adaptation Rules

Every adaptation slice should improve one or more of these without changing the
task lane identity:

1. clearer role boundaries and refusal rules
2. stronger internal workflow stages
3. better deliverable contracts and output summaries
4. sharper operator-facing "what happened / what to do next" language
5. more explicit evidence and verification posture
6. stronger specialist voice without turning the agent into roleplay noise

Do not adapt:

- ornamental personality for its own sake
- broad capabilities that require new tools or permissions without explicit
  governance work
- external-repo architecture assumptions that conflict with the current queue,
  approval, incident, or proof model

## Portfolio Mapping

| Current Agent | Closest `agency-agents` Sources | Borrow Now | Explicitly Defer |
|---|---|---|---|
| `build-refactor-agent` | Frontend Developer, Backend Architect, Code Reviewer, Software Architect, Git Workflow Master | pre-change reasoning checklist, stronger scope/refusal posture, better change-plan narration, clearer verification and rollback language | new code lanes, broader mutating permissions, autonomous architecture rewrites |
| `content-agent` | Content Creator, Technical Writer, Executive Summary Generator | deliverable types by audience, stronger source-to-output discipline, clearer publishability rules, better operator-ready summary copy | net-new marketing channels |
| `data-extraction-agent` | Email Intelligence Engineer, Sales Data Extraction Agent, Document Generator | extraction contract language, schema-minded deliverables, confidence and provenance framing, clearer handoff to normalization | new file-format lanes beyond current parser/tool limits |
| `doc-specialist` | Technical Writer, ZK Steward, Workflow Architect | stronger pack narratives, clearer contradiction/repair storytelling, better downstream handoff framing, more readable knowledge-pack summaries | broader knowledge-product surfaces not already in runtime |
| `integration-agent` | Agents Orchestrator, Workflow Architect, Studio Producer | better stage plans, blocker language, handoff contract clarity, stronger route-selection explanations, explicit workflow deliverables | OpenClaw-native parent runtime inversion |
| `market-research-agent` | Trend Researcher, SEO Specialist, AI Citation Strategist, Growth Hacker | clearer signal classes, stronger source-plan framing, better change-detection language, more useful output sections for operators | new external collection surfaces beyond current allowlist/network policy |
| `normalization-agent` | Data Consolidation Agent, AI Data Remediation Engineer | canonical schema language, cleanup/uncertainty explanation, comparison-ready output framing, better downstream handoff contract | broader ETL pipeline families |
| `qa-verification-agent` | Reality Checker, Evidence Collector, API Tester, Accessibility Auditor, Performance Benchmarker | stricter acceptance posture, stronger closure/refusal language, better proof summaries, clearer "not verified yet" output | new verification task lanes beyond current scope |
| `reddit-helper` | Reddit Community Builder, Support Responder, Content Creator | community-trust heuristics, authenticity rules, reply-quality rubric, better explanation of why a draft is safe/value-first | new community platforms |
| `security-agent` | Security Engineer, Threat Detection Engineer, Compliance Auditor, Incident Response Commander | threat-model language, finding prioritization, remediation storytelling, stronger regression and closure summaries | new scanner/deployment surfaces beyond current local/runtime inspection |
| `skill-audit-agent` | MCP Builder, Tool Evaluator, Automation Governance Architect | better governance checklist structure, tool-interface quality rules, clearer approval/review language, better audit deliverable shape | new skill families or governance products |
| `summarization-agent` | Executive Summary Generator, Feedback Synthesizer, Analytics Reporter | audience-specific compression modes, action-summary structure, better preserved decision/risk framing, stronger handoff-ready summaries | new communication channels |
| `system-monitor-agent` | SRE, Infrastructure Maintainer, Incident Response Commander, Analytics Reporter | clearer reliability language, stronger diagnosis-to-action summaries, better incident/pressure storytelling, operator-next-step guidance | infrastructure task lanes not already in the current monitor surface |

## Implementation Pattern To Reuse Across Agents

Each adaptation should land through the same four-layer pattern:

1. agent spec uplift
2. runtime output uplift
3. operator wording uplift
4. proof uplift

### 1. Agent Spec Uplift

Update the local agent contract files first:

- `README.md`
- `ROLE.md`
- `SCOPE.md`
- `POLICY.md`
- `SOUL.md` or equivalent local identity file where present

Target shape:

- mission
- what this agent owns
- what it must refuse or delegate
- standard workflow stages
- deliverables
- failure modes
- success criteria

### 2. Runtime Output Uplift

Update the agent result payload and handler summary logic so operator-visible
output becomes more useful.

Target additions by lane:

- clearer summary blocks
- explicit recommended next actions
- confidence/evidence wording that reflects real proof
- audience-specific result shaping where already appropriate for the task

### 3. Operator Wording Uplift

Only update operator copy where the underlying output truth is already real.

Likely touch points:

- task descriptions
- run detail summaries
- approval context copy
- incident remediation context
- agent overview notes

### 4. Proof Uplift

Each adaptation slice must be proven in the current architecture:

- focused unit/runtime tests
- integration tests where readiness or operator contract changes
- live canary only when it strengthens runtime truth materially

## Immediate Implementation Order

The implementation order below is the current recommended sequence.

### Phase 0: Shared Adaptation Contract

Goal:

- standardize the adaptation shape before touching individual agents

Work:

- define a common specialist-agent contract template for current agents
- define standard result-summary fields for operator usefulness
- define standard refusal-language expectations
- define standard "next action" language for operators

Phase 0 contract fields:

- `operatorSummary`
- `recommendedNextActions[]`
- `specialistContract.{role, workflowStage, deliverable, status, refusalReason, escalationReason}`

Shared status vocabulary:

- `completed`
- `watching`
- `blocked`
- `escalate`
- `refused`

Acceptance:

- plan approved
- common adaptation checklist documented
- no task-lane expansion introduced

### Phase 1: Core Trust And Workflow Agents

Agents:

- `integration-agent`
- `qa-verification-agent`
- `security-agent`
- `system-monitor-agent`

Why first:

- these agents define the system's credibility
- they shape runs, incidents, approvals, and operator trust
- improvements here raise the value of the whole control plane

Primary borrow targets:

- Workflow Architect
- Agents Orchestrator
- Reality Checker
- Security Engineer
- SRE
- Incident Response Commander

Acceptance:

- stronger result summaries and recommended actions
- clearer refusal and escalation language
- readiness and operator truth remain aligned
- focused tests plus at least one relevant live proof refresh where justified

### Phase 2: Communication And Knowledge Agents

Agents:

- `doc-specialist`
- `content-agent`
- `summarization-agent`
- `reddit-helper`

Why second:

- these agents shape what operators and external readers actually consume
- better framing here makes the system feel more expert immediately

Primary borrow targets:

- Technical Writer
- Content Creator
- Executive Summary Generator
- Reddit Community Builder
- ZK Steward

Acceptance:

- clearer deliverable structures
- stronger audience targeting
- more readable handoff/report outputs
- unchanged task identities and approval model

### Phase 3: Code, Research, And Data Agents

Agents:

- `build-refactor-agent`
- `market-research-agent`
- `data-extraction-agent`
- `normalization-agent`
- `skill-audit-agent`

Why third:

- these lanes benefit from the adaptation work but are downstream of the core
  trust and communication upgrades
- they also need their wording kept tightly aligned to real tool/governance
  truth

Primary borrow targets:

- Frontend Developer
- Backend Architect
- Code Reviewer
- Trend Researcher
- AI Citation Strategist
- Email Intelligence Engineer
- Data Consolidation Agent
- MCP Builder

Acceptance:

- better scope/risk narration
- stronger structured deliverables
- clearer normalization and research handoff output
- no overstatement beyond current tool and network boundaries

## Post-Adaptation Public Refinement Order

Once Phases 0 through 3 are implemented, the next work is not new lanes first.

The first public follow-through is to operate the adapted portfolio in real
work and tighten the current operator experience around what those agents now
emit.

Current agreed order after the adaptation implementation:

1. operate and refine the adapted current portfolio in the public repo
2. then consider new task lanes
3. then consider broader agent portfolio growth
4. then add richer OpenClaw companion or plugin metadata
5. then tighten channel or runtime integration

### What "Broader Agent Portfolio Growth" Means

This phrase is now explicit and should not be interpreted loosely.

It means:

- use strong external agent catalogs or prose role repositories as a source of
  candidate agents the public repo does not already have
- select one candidate at a time
- turn each selected candidate into a real OpenClaw public agent with the same
  quality bar as the existing shipped agents

It does not mean:

- bulk-importing a whole external catalog
- adding vague or overlapping assistants just because the source repo lists
  them
- treating prose descriptions as enough to claim a new public agent exists

The standard for each new public agent is the same one used for the current
portfolio:

- a bounded mission
- an owned task lane
- governed access and least-privilege manifests
- operator-visible evidence and truthful exposure
- tests, docs, and productized runtime behavior

### External-Catalog Selection Rule

When choosing the next public agent from an external catalog, prefer candidates
that are:

- not already covered by an existing public agent or lane
- clearly productizable into a bounded open-source workflow
- safe to expose publicly without relying on private-lab assumptions
- useful to operators and external users, not only to the maintainer's
  personal workflow

Reject or defer candidates that are:

- mostly duplicates of current spines
- too private, machine-specific, or one-off to justify public productization
- too broad to own a bounded lane honestly
- dependent on permissions that would flatten the current trust model

### Delivery Rule

Broader portfolio growth happens one agent at a time.

For each candidate:

1. define the owned lane and bounded mission
2. implement the runtime agent and governed access
3. expose truthful operator-facing evidence
4. validate tests, docs, and runtime behavior
5. only then treat it as part of the public shipped agent catalog

## External Catalog Candidate Board

The external catalog remains useful, but the public repo does not treat it as a
bulk-import backlog.

The practical public rule is:

- keep the original adaptation borrow targets as already-absorbed role patterns
- only create new public agents from external roles the repo does not already
  cover
- keep a small explicit queue of productizable candidates instead of promising
  the whole catalog

### Already Absorbed Into The Current Public Portfolio

These external roles are already represented in the current public product as
adapted patterns or covered spines and should not be reintroduced as separate
public agents unless the bounded lane genuinely changes:

- Workflow Architect
- Agents Orchestrator
- Reality Checker
- Security Engineer
- SRE
- Incident Response Commander
- Technical Writer
- Content Creator
- Executive Summary Generator
- Reddit Community Builder
- ZK Steward
- Frontend Developer
- Backend Architect
- Code Reviewer
- Trend Researcher
- AI Citation Strategist
- Email Intelligence Engineer
- Data Consolidation Agent
- MCP Builder

### Planned Future Public Adaptation Queue

These are the current external-catalog roles we plan to adapt one by one into
new public agents or lanes because they are not already covered and can be
shipped honestly in open source:

| External Role | Queue Status | Intended Public Shape | Why It Belongs |
|---|---|---|---|
| DevOps Automator | adapt next | `deployment-ops-agent` | bounded deploy, rollback, release-ops, and service-runtime guidance fit the operator product directly |
| LSP/Index Engineer | adapt next | `code-index-agent` | searchable code and knowledge indexing is productizable, operator-visible, and useful beyond the maintainer's private lab |
| Test Results Analyzer | adapt next | `test-intelligence-agent` | multi-suite test evidence synthesis is a real public control-plane workflow that complements, rather than duplicates, verification |
| Legal Compliance Checker | adapt next | `compliance-agent` | bounded compliance, policy, and dependency-posture review is open-source shippable and useful for releases and operator decisions |
| Support Responder | adapt next | `support-operations-agent` | support and FAQ response quality can be productized without turning the public repo into a private customer-ops layer |
| Sprint Prioritizer | adapt next | `backlog-prioritization-agent` | bounded sequencing, scoping, and priority guidance is productizable for open-source workflow management |
| UX Researcher | maybe later | `ux-research-agent` | operator and docs usability review is valuable, but it should follow the stronger operational lanes above |
| Feedback Synthesizer | maybe later | `feedback-intelligence-agent` | structured community and operator-feedback synthesis is useful once more public usage volume exists |
| Experiment Tracker | maybe later | `experiment-governance-agent` | experiment posture and result tracking can become a real lane after deployment and release workflows deepen |
| Workflow Optimizer | maybe later | `workflow-optimization-agent` | useful once workflow telemetry matures further, but too abstract to jump ahead of the more bounded candidates |
| Data Analytics Reporter | maybe later | `analytics-intelligence-agent` | durable metrics narration could be strong, but it should follow stronger deployment, test, and support surfaces |
| Analytics Reporter | maybe later | `analytics-brief-agent` | likely useful as a compact reporting lane, but not ahead of the more operationally critical candidates |

### Explicit Public Deferrals

These external roles are not current public backlog because they are too
duplicative, too marketing- or channel-specific, too design-heavy for the
current product focus, or too private/specialized to justify immediate public
productization:

- Mobile App Builder
- AI Engineer
- Rapid Prototyper
- Senior Developer
- UI Designer
- UX Architect
- Brand Guardian
- Visual Storyteller
- Whimsy Injector
- Growth Hacker
- Twitter Engager
- TikTok Strategist
- Instagram Curator
- App Store Optimizer
- Social Media Strategist
- Studio Producer
- Project Shepherd
- Studio Operations
- Senior Project Manager
- Evidence Collector
- Performance Benchmarker
- API Tester
- Tool Evaluator
- Finance Tracker
- Infrastructure Maintainer
- XR Interface Architect
- macOS Spatial/Metal Engineer
- XR Immersive Developer
- XR Cockpit Interaction Specialist
- visionOS Spatial Engineer
- Terminal Integration Specialist

### Next Practical Move

The next practical move after this board is not to add all candidates at once.

It is to take the first `adapt next` candidate, define its bounded lane, and
productize it end to end before opening the next one.

Current recommended first candidate:

- DevOps Automator -> `deployment-ops-agent`

Why first:

- it strengthens public deployment and runtime operations directly
- it fits the control-plane/operator theme cleanly
- it has a clearer owned lane than the more abstract later candidates
- it can produce operator-visible proof without flattening the current trust
  model

### Sprint 1: Trust And Governance Adoption

Public refinement sprint 1 is complete.

Agents and lanes:

- `qa-verification-agent` via `qa-verification`
- `security-agent` via `security-audit`
- `system-monitor-agent` via `system-monitor`
- `skill-audit-agent` via `skill-audit`

What this sprint hardened:

- clearer trust and governance control decks in run detail
- stronger governance-focus guidance in the operator console
- lane-specific status handling for review, closure, watch, and escalation

### Sprint 2: Remaining Nine-Lane Adoption

Public refinement sprint 2 covers the rest of the adapted portfolio.

Agents and lanes:

- `integration-agent` via `integration-workflow`
- `build-refactor-agent` via `build-refactor`
- `doc-specialist` via `drift-repair`
- `content-agent` via `content-generate`
- `summarization-agent` via `summarize-content`
- `reddit-helper` via `reddit-response`
- `data-extraction-agent` via `data-extraction`
- `normalization-agent` via `normalize-data`
- `market-research-agent` via `market-research`

What this sprint must deliver:

- lane-specific operator control decks for the remaining nine run-detail paths
- clearer reading of handoff, bounded-scope, freshness, publication, and
  comparison-ready posture
- focused operator-console proof so the adapted output shape is not just agent
  truth but operator-usable product truth

What this sprint must not do:

- add new task lanes
- add new specialist agents
- widen tool or network boundaries just to make the UI look richer

### Live Usage Refinement Sprint 1

After the adaptation-adoption sprints, the next real usage refinement is to
make the existing operator surfaces cheaper to use in day-to-day triage.

Current focus:

- promote adapted operator guidance into the execution ledger, not only the
  single-run detail page
- surface next-action and knowledge-freshness posture before deep drill-down
- keep run detail as the full evidence page while making the run list better
  for queue-style triage

Guardrail:

- do not add new task lanes or widen runtime scope under the label of usage
  refinement

## Per-Agent First Slices

### `integration-agent`

First slices:

- rewrite local role/workflow docs around conductor stages
- add clearer workflow outcome blocks: `what ran`, `what blocked`, `what to do next`
- strengthen delegated-step rationale in result summaries
- ensure run detail and readiness wording reflect the richer workflow story

### `qa-verification-agent`

First slices:

- strengthen certification/refusal contract in local docs
- add explicit acceptance verdict language with reasoned closure posture
- improve operator-visible distinction between verified, unverified, and blocked
- keep proof and closure contract aligned in run results

### `security-agent`

First slices:

- rewrite local docs around threat posture, regression review, and bounded fixes
- improve finding/risk narrative in results and highlights
- strengthen remediation and closure wording for operators
- keep claims bounded to current local/runtime inspection surfaces

### `system-monitor-agent`

First slices:

- rewrite local docs around diagnosis, reliability posture, and operator action
- improve summary language for incidents, pressure, and next actions
- shape results more clearly for "watching", "degraded", and "action required"
- keep output grounded in current runtime signals and not synthetic ops theater

### `doc-specialist`

First slices:

- rewrite local docs for knowledge-pack mission and repair planning
- improve pack-level executive summary and downstream handoff sections
- make contradiction and repair-draft output easier for operators to interpret
- preserve existing evidence rails and freshness semantics

### `content-agent`

First slices:

- define output modes by audience more sharply
- improve source-grounding and publication-policy wording
- standardize readable deliverable sections for README/report/changelog modes
- keep generation bounded to current grounded sources

### `summarization-agent`

First slices:

- define summary modes by operator need: quick read, action summary, handoff
- improve what gets preserved versus compressed
- standardize downstream-ready summary sections
- ensure result summaries expose what context was intentionally retained

### `reddit-helper`

First slices:

- strengthen local docs around authenticity, value, and community trust
- improve draft rationale and "why this reply is safe/helpful" output
- standardize explanation of fallback vs provider-polished posture
- keep subreddit-culture heuristics grounded and not overconfident

### `build-refactor-agent`

First slices:

- tighten pre-edit reasoning and refusal language
- improve change-plan, risk, and rollback narration
- improve verification summary readability for operators
- keep all claims strictly aligned to bounded patch and verification truth

### `market-research-agent`

First slices:

- improve source-plan and signal classification language
- define clearer output sections for findings, confidence, and delta capture
- strengthen explanation of degraded-but-actionable fetch results
- preserve current allowlisted-fetch boundary

### `data-extraction-agent`

First slices:

- improve extraction deliverable shape and schema/provenance language
- standardize confidence and normalization-handoff sections
- improve explanation of parser limitations without flattening value
- keep format truth aligned with current parser support

### `normalization-agent`

First slices:

- sharpen canonical-schema and uncertainty language
- improve comparison-ready output formatting
- standardize normalization summaries for operators and downstream agents
- preserve current governed access and schema boundaries

### `skill-audit-agent`

First slices:

- improve governance checklist and review posture wording
- tighten tool-interface and provenance quality language
- standardize operator-facing audit deliverables
- keep all approval and trust posture claims aligned to current runtime truth

## Acceptance Gate For Each Agent

No agent adaptation slice is done until all of the following are true:

1. local agent docs reflect the new specialist contract
2. runtime result summaries or highlights reflect the improved deliverable
   shape where relevant
3. operator-facing wording stays honest about what the lane can actually do
4. focused tests pass
5. if readiness/runtime truth changes materially, the canonical capability docs
   are updated in the same change set

## Explicit Future Work Boundary

Future work may include:

- new task lanes
- broader role portfolio growth
- OpenClaw-side richer companion-plugin metadata
- tighter channel/runtime integration

Do not start any of that work under the label of this adaptation plan.

This plan is complete only when the current 13-agent portfolio has been
upgraded in-role without changing the current architecture.
