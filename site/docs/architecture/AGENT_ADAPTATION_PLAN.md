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
| DevOps Automator | completed | `deployment-ops-agent` | bounded deploy, rollback, release-ops, and service-runtime guidance fit the operator product directly |
| LSP/Index Engineer | completed | `code-index-agent` | searchable code and knowledge indexing is productizable, operator-visible, and useful beyond the maintainer's private lab |
| Test Results Analyzer | completed | `test-intelligence-agent` | multi-suite test evidence synthesis is now productized as a bounded public control-plane lane with live canary proof |
| Legal Compliance Checker | completed | `compliance-agent` | bounded compliance, policy, and dependency-posture review is open-source shippable and useful for releases and operator decisions |
| Support Responder | adapt next | `support-operations-agent` | support and FAQ response quality can be productized without turning the public repo into a private customer-ops layer |
| Sprint Prioritizer | adapt next | `backlog-prioritization-agent` | bounded sequencing, scoping, and priority guidance is productizable for open-source workflow management |
| UX Researcher | maybe later | `ux-research-agent` | operator and docs usability review is valuable, but it should follow the stronger operational lanes above |
| Feedback Synthesizer | maybe later | `feedback-intelligence-agent` | structured community and operator-feedback synthesis is useful once more public usage volume exists |
| Experiment Tracker | maybe later | `experiment-governance-agent` | experiment posture and result tracking can become a real lane after deployment and release workflows deepen |
| Workflow Optimizer | maybe later | `workflow-optimization-agent` | useful once workflow telemetry matures further, but too abstract to jump ahead of the more bounded candidates |
| Data Analytics Reporter | maybe later | `analytics-intelligence-agent` | durable metrics narration could be strong, but it should follow stronger deployment, test, and support surfaces |
| Analytics Reporter | maybe later | `analytics-brief-agent` | likely useful as a compact reporting lane, but not ahead of the more operationally critical candidates |

### What To Harvest Beyond Role Names

The external repo is useful not only because it names roles, but because each
role file tends to carry:

- mission and ownership framing
- critical rules and refusal boundaries
- workflow stages and handoff patterns
- technical deliverables and output shapes
- quality bars and verification expectations

Those are the parts worth adapting.

The public repo should therefore treat the external catalog as a source of:

- workflow and checklist patterns
- operator-facing deliverable contracts
- domain-specific verification rules
- skill and tool expectations that can be rebuilt safely inside OpenClaw

The public repo should not treat the external catalog as a source of:

- executable modules to import directly
- privileged scripts or automation to trust by default
- opaque external integrations that bypass current governance and ToolGate

### Safe Adaptation Rule For Skills And Tools

When a prose agent suggests a useful tool or skill pattern, adapt it by
building an OpenClaw-native equivalent.

Do:

- copy the idea, workflow shape, or validation rule
- rebuild the implementation with local governed skills, manifests, and
  runtime contracts
- keep least-privilege access and explicit operator-facing proof

Do not:

- vendor external automation modules wholesale
- trust external scripts just because the prose agent references them
- import third-party execution surfaces in a way that would flatten the current
  trust model or increase malware risk

### Tool And Skill Harvest Targets For The Current Queue

The next public-agent queue should be evaluated at the level of internal skills,
tooling contracts, and deliverables, not just names.

| Intended Public Shape | External Skill/Tool Patterns Worth Harvesting | OpenClaw-Native Build Rule |
|---|---|---|
| `deployment-ops-agent` | deploy-readiness checklist, rollback checklist, environment drift review, pipeline-failure triage, infra-doc parity checks | rebuild as governed deployment-readiness, workflow/log inspection, and rollback-planning skills; do not import external deploy scripts |
| `code-index-agent` | indexing workflow, symbol coverage expectations, retrieval-quality checks, documentation-to-code linkage, search-gap diagnosis | rebuild as local indexing and retrieval contracts over current repos and knowledge packs; do not import foreign indexers or binaries blindly |
| `test-intelligence-agent` | test-suite classification, failure clustering, flaky-test heuristics, evidence-window summaries, release-risk narration | rebuild as local result parsers and test-evidence summaries over governed test artifacts; do not import external test-processing modules wholesale |
| `compliance-agent` | requirement matrixing, policy-to-artifact mapping, dependency/license review, release-blocker compliance posture | rebuild as bounded policy, manifest, and evidence-review skills; do not import external compliance frameworks as trusted runtime code |
| `support-operations-agent` | response rubric, escalation rules, FAQ extraction, issue-to-answer handoff, trust-and-tone boundaries | rebuild as governed support drafting and FAQ-routing skills; do not import external support bots or automations |
| `backlog-prioritization-agent` | backlog scoring rubric, sequencing heuristics, dependency-aware slicing, urgency-vs-value framing, release-window prioritization | rebuild as local backlog ranking and planning contracts using existing run, incident, approval, and repo truth; do not import external PM tooling logic blindly |

### Completed Contract: `deployment-ops-agent`

This is the current implementation-ready contract for the first new public
agent candidate.

It is derived from the current repo code, not only from external prose:

- `release-readiness` already owns bounded `go` / `hold` / `block` synthesis
  over verification, security, monitor, build, incident, approval, and proof
  freshness evidence
- `agent-deploy` already owns the approval-gated mutating template deployment
  path
- the repo already has first-class deployment surfaces worth inspecting:
  `systemd/orchestrator.service`, `docker-compose.yml`,
  `.github/workflows/deploy.yml`, `.github/workflows/docker-demo-smoke.yml`,
  `DEPLOYMENT.md`, `QUICKSTART.md`, and `docs/operations/deployment.md`

The missing bounded lane is therefore not "do the deploy." The missing lane is
"tell the operator whether the selected public deployment surface is actually
ready, aligned, rollback-safe, and evidence-backed."

#### Owned Lane

- task type: `deployment-ops`
- mission: synthesize bounded deployment posture across rollout surfaces,
  rollback readiness, deployment/docs parity, and pipeline evidence for the
  supported public deployment modes
- lifecycle: `worker-first`
- exposure target: `public-triggerable`
- approval posture: `dynamic-only`

#### What It Owns

`deployment-ops-agent` should own read-only deployment posture synthesis for:

- systemd host-service readiness
- official public Docker demo readiness
- dual-surface parity when both modes matter
- deployment-doc and quickstart parity
- deploy workflow and docker-demo smoke workflow presence
- rollback readiness and deployment-surface drift review
- bounded pipeline posture based on the latest relevant task evidence

This lane should answer:

1. is the selected rollout mode structurally present?
2. is rollback posture credible for that mode?
3. are deployment docs and workflow surfaces aligned with the repo?
4. does recent bounded runtime evidence support or block deployment posture?

#### What It Must Not Own

This lane must not duplicate or absorb:

- `release-readiness`
  - release governance still belongs to `release-manager-agent`
- `agent-deploy`
  - mutating deployment actions still belong to the explicit approval-gated
    deploy path
- ad hoc remote host administration
  - no service restarts, no remote shelling, no cloud-provider control-plane
    actions

#### Governed Access It Can Honestly Use Right Now

Current honest governed skill access should stay narrow:

- `documentParser`
  - parse bounded deployment docs and runtime-evidence inputs

Do not widen this first slice to require:

- remote shell access
- cloud-provider APIs
- arbitrary deploy scripts
- ungoverned network access

The agent can still read local repo/runtime files directly inside the current
worker model, but its governed skill contract should remain least-privilege and
explicit.

#### Minimum Operator-Visible Evidence

The result contract should mirror the current bounded synthesis lanes and make
deployment posture operator-legible at a glance.

Required lane payload:

- `deploymentOps.decision`
  - `ready` | `watch` | `blocked`
- `deploymentOps.rolloutMode`
  - `service` | `docker-demo` | `dual`
- `deploymentOps.summary`
- `deploymentOps.blockers[]`
- `deploymentOps.followups[]`
- `deploymentOps.rollbackReadiness`
- `deploymentOps.environmentDrift`
- `deploymentOps.pipelinePosture`
- `deploymentOps.surfaceChecks`

Required shared fields:

- `operatorSummary`
- `recommendedNextActions[]`
- `specialistContract`
- `toolInvocations[]`
- `handoffPackage`

The runtime should also be able to promote a compact deployment-readiness
signal into `/api/agents/overview` the same way the current bounded lanes
promote `controlPlaneBrief` and `releaseReadiness`.

#### Explicit Refusal / Block Rules

`deployment-ops-agent` should explicitly refuse or block when asked to:

- execute a deployment
- restart services or mutate host state
- claim release approval authority
- bypass the approval model
- validate remote/cloud deployment state it cannot observe locally
- trust imported third-party deploy scripts as evidence

It should block normally when:

- critical runtime incidents are still open
- required rollout surfaces for the selected mode are missing
- rollback posture is missing for the selected mode
- core bounded release, monitor, security, or verification evidence is blocked

#### First Implementation Slice

Status:

- completed in repo code on `2026-04-09`
- verified through focused task-catalog, operator-UI, and integration proof,
  then through the full protected-branch `verify:main` contract
- confirmed on the live `3312` runtime on `2026-04-10`
- `/api/agents/overview` now promotes current-run `deploymentOps` runtime
  evidence for the worker on the live surface
- protected task-catalog surfaces now vary their cache key with the live task
  profile set so new lanes cannot stay hidden behind a stale Redis snapshot

Build this lane in the same bounded pattern as `control-plane-brief` and
`release-readiness`:

1. add `agents/deployment-ops-agent/` with a local-first state path and
   worker-first config
2. add `deploymentOpsHandler` and allowlist/catalog/task-profile wiring
3. add focused contract proof for:
   - `ready`
   - `watch`
   - `blocked`
   - promoted runtime evidence
4. add truthful docs and operator copy

Immediate follow-up is now closed. The next contract pass should move to
`code-index-agent`.

### Completed Contract: `code-index-agent`

This is the current implementation-ready contract for the second new public
agent candidate.

It is derived from the current repo code, not only from external prose:

- `orchestrator/src/docIndexer.ts` already indexes markdown, code, config,
  notebooks, and asset-manifest clues across local roots using a bounded
  local-first crawler
- `GET /api/knowledge/summary` already exposes indexed-entry counts plus
  freshness and contradiction signals sourced from runtime truth
- `POST /api/knowledge/query` already exposes bounded retrieval over the
  current local index
- `doc-specialist` already generates knowledge packs and repair drafts from
  local mirrors using governed `documentParser` access
- `operator-s-console` already has the launcher, run-detail, knowledge
  summary, and agent-overview surfaces needed to expose an indexing lane
  without inventing a new console shell first

The missing bounded lane is therefore not "be Codex" and not "import a foreign
LSP stack wholesale." The missing lane is "tell the operator whether current
local repo and knowledge indexing is fresh, linked, searchable, and trustworthy
enough for downstream retrieval and diagnosis."

#### Owned Lane

- task type: `code-index`
- mission: synthesize bounded local indexing posture across repo/code/docs
  coverage, documentation-to-code linkage, search-gap diagnosis, and freshness
  for the current workspace mirrors and knowledge-pack workflow
- lifecycle: `worker-first`
- exposure target: `public-triggerable`
- approval posture: `dynamic-only`

#### What It Owns

`code-index-agent` should own read-only indexing posture synthesis for:

- local repo/code/docs index coverage
- documentation-to-code and code-to-doc linkage review
- knowledge-pack and index freshness review
- retrieval-readiness posture for downstream operator and companion workflows
- search-gap diagnosis across canonical docs, runtime code, and agent docs
- bounded symbol and reference coverage expectations grounded in the current
  local index, not an implied full semantic language server

This lane should answer:

1. are the current repo and mirror roots indexed enough for downstream
   retrieval work?
2. where are the strongest doc-to-code or code-to-doc linkage gaps?
3. what freshness or contradiction gaps will mislead operators or downstream
   agents?
4. is the current local index trustworthy enough for bounded retrieval, or
   should the operator refresh or repair first?

#### What It Must Not Own

This lane must not duplicate or absorb:

- `drift-repair`
  - documentation repair and pack regeneration still belong to
    `doc-specialist`
- `build-refactor`
  - code edits, patches, and mutating refactors still belong to the explicit
    code-change lane
- `deployment-ops` or `release-readiness`
  - deployment and release posture remain separate bounded synthesis lanes
- ad hoc unrestricted repo analysis
  - no arbitrary shell execution, no generic "run Codex on the repo" authority,
    and no implied remote repo crawling

#### Governed Access It Can Honestly Use Right Now

Current honest governed skill access should stay narrow:

- `documentParser`
  - parse bounded local docs, code/config files, and knowledge-pack artifacts
    already visible in the workspace

Do not widen this first slice to require:

- `workspacePatch`
- `testRunner`
- `sourceFetch`
- external LSP daemons or imported third-party index binaries
- arbitrary shell execution
- network access

If richer repo intelligence is needed later, add a bounded local
index/search-oriented skill explicitly. Do not collapse the current
manifest/ToolGate model into unrestricted Codex-equivalent authority.

#### Minimum Operator-Visible Evidence

The result contract should mirror the current bounded synthesis lanes and make
index posture operator-legible at a glance.

Required lane payload:

- `codeIndex.decision`
  - `ready` | `refresh` | `blocked`
- `codeIndex.summary`
- `codeIndex.indexScope`
- `codeIndex.indexCoverage`
- `codeIndex.docLinks`
- `codeIndex.searchGaps`
- `codeIndex.freshness`
- `codeIndex.retrievalReadiness`
- `codeIndex.evidenceSources`

Required shared fields:

- `operatorSummary`
- `recommendedNextActions[]`
- `specialistContract`
- `toolInvocations[]`
- `handoffPackage`

The runtime should also be able to promote a compact indexing-readiness signal
into `/api/agents/overview` the same way the current bounded lanes promote
`controlPlaneBrief`, `releaseReadiness`, and `deploymentOps`.

#### Explicit Refusal / Block Rules

`code-index-agent` should explicitly refuse or block when asked to:

- edit code or docs
- claim full semantic/LSP certainty it cannot produce from the current local
  text-first index
- execute builds, tests, or shell commands
- fetch external repos, networks, or cloud sources as index inputs
- bypass `drift-repair` when freshness or contradiction repair is the real next
  step

It should block normally when:

- required local index roots are missing or unreadable
- current freshness or contradiction signals indicate stale or conflicting
  source truth
- requested targets fall outside the manifest read scope
- linkage or retrieval coverage is too weak to support a bounded reliable
  answer

#### First Implementation Slice

Status:

- implemented in repo code on `2026-04-10`
- live canary confirmed on `3312` on `2026-04-10`
- current promoted runtime evidence confirms `codeIndex` readiness output in
  `/api/agents/overview` for the canary run

The shipped first slice follows the same bounded pattern as `deployment-ops`,
`control-plane-brief`, and `release-readiness`:

1. add `agents/code-index-agent/` with a local-first state path and
   worker-first config
2. add `codeIndexHandler` plus allowlist, validation, catalog, and task-profile
   wiring
3. add focused operator UI wiring through the existing task launcher and run
   detail surfaces rather than a new page
4. add focused contract proof for:
   - `ready`
   - `refresh`
   - `blocked`
   - promoted runtime evidence
   - refusal when write, shell, or external-index authority is requested
5. add truthful docs and site mirrors

Immediate follow-up is now closed:

1. a live `code-index` canary succeeded on the running runtime on
   `2026-04-10`
2. `/api/agents/overview` and `/operator/agents` both confirmed current-run
   `codeIndex` evidence during that canary
3. that follow-up is now closed through the completed
   `test-intelligence-agent` slice

### Completed Contract: `test-intelligence-agent`

`test-intelligence-agent` is now implemented as a worker-first, read-only,
local-first lane over the current runtime and bounded local test surfaces.

#### Lane Ownership

`test-intelligence-agent` should own read-only synthesis for:

- bounded local suite coverage across:
  - `orchestrator/test`
  - `operator-s-console/src/test`
  - selected test-bearing agent roots
- recent runtime failure clustering from persisted task execution history
- flaky-signal detection from retry recovery and multi-attempt run evidence
- release-facing risk posture from the latest verification, build, and release
  readiness outputs
- operator-visible next-action guidance when the real next move is repair,
  rerun, or review

It should not own:

- test execution
- code edits or refactors
- shell or CI control
- external provider test analytics
- hidden judgment outside the bounded runtime and local repo evidence

#### Explicit Refusals

`test-intelligence-agent` should explicitly refuse or block when asked to:

- run tests itself
- edit source or test files
- execute shell commands or CI jobs
- fetch external dashboards, SaaS test reports, or private artifacts
- claim certainty beyond the bounded local suite and runtime evidence window

It should block normally when:

- required local test roots are missing or unreadable
- requested suites fall outside the manifest read scope
- runtime evidence is too sparse to support bounded posture synthesis
- release-facing signals are missing enough context to support a grounded risk
  summary

#### First Implementation Slice

Status:

- implemented in repo code on `2026-04-12`
- live canary confirmed on `3312` on `2026-04-12`
- current promoted runtime evidence confirms `testIntelligence` output in
  `/api/agents/overview` for the canary run

The shipped first slice follows the same bounded pattern as `deployment-ops`
and `code-index`:

1. add `agents/test-intelligence-agent/` with a local-first state path and
   worker-first config
2. add `testIntelligenceHandler` plus allowlist, validation, catalog, and
   task-profile wiring
3. add focused operator UI wiring through the existing task launcher and run
   detail surfaces rather than a new page
4. add focused contract proof for:
   - `ready`
   - `watching`
   - `blocked`
   - promoted runtime evidence
   - refusal when execution, write, shell, or external-report authority is
     requested
5. add truthful docs and site mirrors

Immediate follow-up is now closed:

1. a live `compliance-review` canary succeeded on the running runtime on
   `2026-04-13`
2. `/api/agents/overview` confirmed current-run `compliance` evidence
   for the canary run
3. the next candidate is now `support-operations-agent`

### Practical Skill-Gap Lens

For each future candidate, the key question is not only "do we want this role?"

It is also:

1. what workflow intelligence from the prose repo is actually useful?
2. what internal skills or tool contracts do we not already have?
3. can we build those safely inside OpenClaw with governed access?
4. can the result produce operator-visible evidence instead of hidden magic?

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

Current recommended next candidate:

- Support Responder -> `support-operations-agent`

Why next:

- `deployment-ops-agent`, `code-index-agent`, `test-intelligence-agent`, and
  `compliance-agent` are now all implemented and live-confirmed on the running
  operator surface
- support-response synthesis can be bounded to read-only policy + FAQ guidance
  without expanding the live execution or deployment surface
- it can reuse the current knowledge-pack and doc-index posture to ground
  support guidance without introducing new external integrations
- the next useful product question is how to route operator-safe answers into
  support and FAQ workflows without diluting governance posture

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
