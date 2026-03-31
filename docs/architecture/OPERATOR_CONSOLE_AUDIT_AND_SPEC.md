---
title: "Operator Console Audit And Spec"
summary: "Backend-first audit and redesign spec for the private OpenClaw Operator console."
---

# Operator Console Audit And Spec

This document is the backend-first product audit and redesign spec for the
private `OpenClaw Operator` console served at `/operator`.

It exists to answer four questions:

1. what the backend can truthfully expose today
2. what the current frontend is doing with that backend truth
3. where the current IA and UX are mixing scopes or overloading pages
4. what the next full redesign should look like

Use this together with:

- [OPERATOR_SURFACE_CAPABILITY_MATRIX.md](./OPERATOR_SURFACE_CAPABILITY_MATRIX.md)
- [AGENT_CAPABILITY_MODEL.md](./AGENT_CAPABILITY_MODEL.md)
- [AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md](./AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md)
- [../reference/api.md](../reference/api.md)
- [../reference/task-types.md](../reference/task-types.md)

## Product Truth

`OpenClaw Operator` is:

- a bounded, observable, auditable private operator console
- a control-plane interface for governed task execution, runtime truth, and
  operator action
- distinct from the public proof surface

It is **not**:

- a generic developer portal
- a raw API mirror
- a public proof site
- a marketing dashboard

The design target is therefore:

- high-trust
- dark and premium
- mission-control-like
- explicit about uncertainty, degradation, and dependency limits

## Backend Truth Map

The console does not need every route. It needs the right route families.

## Implementation Status

- Phase 1 landed: operator-first IA cutover, dedicated `Incidents` page, and
  reduced `Overview`/`System Health` scope.
- Phase 2 landed: `Tasks` now reads as a category-led launcher, `Runs` now
  reads as an execution ledger with cost and budget posture, and `Approvals`
  now reads as a decision inbox with a separate action box.
- Phase 3 landed: `Overview`, `Runs`, `Approvals`, and `Incidents` now surface
  operator-focus triage signals first, including queue pressure, repeated
  activity grouping, approval age/lane clustering, and incident ownership /
  verification / remediation pressure before drill-down.

### Private Operator Truth

These are the main protected route groups already available:

| Route Group | Role In Product |
|---|---|
| `GET /api/dashboard/overview` | aggregate operator summary |
| `GET /api/tasks/catalog` + `POST /api/tasks/trigger` | curated safe action surface |
| `GET /api/tasks/runs` + `GET /api/tasks/runs/:runId` | execution ledger and detail |
| `GET /api/approvals/pending` + `POST /api/approvals/:id/decision` | approval inbox |
| `GET /api/incidents*` + incident action routes | incident queue, detail, remediation, ownership |
| `GET /api/health/extended` | authoritative protected health surface |
| `GET /health` + `GET /api/persistence/health` + `GET /api/persistence/summary` | shallow public liveness plus persistence dependency truth |
| `GET /api/agents/overview` | fleet and readiness truth |
| `GET /api/skills/*` | governance and policy truth |
| `GET /api/knowledge/summary` + `POST /api/knowledge/query` + `GET /api/memory/recall` | knowledge and memory surfaces |

### Public Proof Truth

These are intentionally separate from private operator truth:

| Route Group | Role In Product |
|---|---|
| `GET /api/command-center/*` | public proof summary |
| `GET /api/milestones/latest` | latest public milestone evidence |
| `GET /api/milestones/dead-letter` | public proof-risk feed |

### Key Product Boundary

The backend already draws the correct line:

- `/operator` is private operator control-plane work
- `/operator/public-proof` is a separate page consuming public proof routes
- public proof must stay visually and semantically separate from internal
  operator certainty

## Current Frontend Route Audit

Current private route map:

- `/`
- `/tasks`
- `/activity`
- `/task-runs`
- `/approvals`
- `/agents`
- `/knowledge`
- `/governance`
- `/system-health`
- `/diagnostics`

Separate public route:

- `/public-proof`

### What Is Working Well

- The console already consumes real backend truth instead of mocks.
- The product boundary between private operator routes and public proof is
  present.
- Tasks, runs, approvals, agents, governance, knowledge, and public proof are
  already first-class pages.
- The visual language is already close to the intended industrial mission
  control look.
- The console now has command-palette and stronger task-action ergonomics.

### Main IA Problems

#### 1. Overview Is Overloaded

The current overview is trying to be:

- command center
- incident queue
- topology dashboard
- diagnostics summary
- governance summary
- public proof teaser
- recent activity surface

That makes it informative, but not focused.

The overview should answer:

1. is the system up
2. what needs operator action now
3. what can I safely do next
4. what just happened

Anything beyond that should route deeper.

#### 2. System Health Is Carrying Too Much Product Weight

The current `System Health` page is doing the job of:

- runtime health
- dependencies
- persistence
- truth layers
- incident queue
- incident detail
- remediation action

Those are all valid surfaces, but combined they become cognitively heavy.

Incidents are first-class backend truth and deserve their own operator mental
model, not just a subsection inside health.

#### 3. Diagnostics Is Too Prominent

Diagnostics is real and useful, but it is a utility workflow, not a primary
operator destination.

Putting it at the same level as core workflow pages makes the product feel
implementation-led rather than operator-led.

#### 4. Governance And Knowledge Are Correctly Present But Not Hierarchically Clear

They are good secondary/control-plane pages, but the product does not yet make
it obvious that:

- Governance = policy, governed skills, audit posture
- Knowledge = indexed truth, query, recall, memory, repair loop

They read more like “extra pages” than clearly named operational domains.

#### 5. Public Proof Is Good But Still Echoed Too Much In Overview

A proof teaser on overview is correct.

A proof mini-dashboard plus truth rails plus command-center copy plus separate
public proof page starts to duplicate too much.

Overview should point toward proof, not partially become proof.

#### 6. Navigation Reflects Implementation History More Than Operator Workflow

The current order is:

- Overview
- Tasks
- Activity
- Runs
- Approvals
- Agents
- Knowledge
- Governance
- System Health
- Diagnostics

This is understandable for builders, but not ideal for operators.

## Recommended Information Architecture

This is the recommended operator-first IA.

### Primary Navigation

1. `Overview`
2. `Tasks`
3. `Runs`
4. `Approvals`
5. `Incidents`
6. `Agents`
7. `Governance`
8. `Knowledge`

### Secondary / Utility Navigation

1. `System Health`
2. `Diagnostics`

### Separate Public Surface

1. `Public Proof`

### Why This Order

- `Overview` answers “what needs attention?”
- `Tasks` is the safe action launcher
- `Runs` is the execution ledger
- `Approvals` is the gated-action inbox
- `Incidents` is the operational trouble queue
- `Agents` is readiness and lifecycle truth
- `Governance` is policy and trust posture
- `Knowledge` is retrieval, memory, and repair intelligence
- `System Health` and `Diagnostics` are supporting operator utilities

## Page-by-Page Spec

### 1. Overview

**Purpose**

Answer the operator’s first-session question in under 10 seconds.

**Primary sections**

1. top status bar
2. needs-attention rail
3. execution snapshot
4. safe next actions
5. recent runs
6. proof and trust teaser

**Do not keep on overview**

- full incident queue
- full topology analysis
- full diagnostics summary
- deep governance registry tables

**Hero copy**

- title: `Operator Overview`
- subtitle: `Live control-plane truth, governed work, and safe next actions.`

**Top status bar**

- show:
  - system status
  - fast-start
  - persistence status
  - pending approvals
  - metered spend

**Needs-attention rail**

- prioritize:
  - pending approvals
  - active incidents
  - degraded persistence
  - retry/repair pressure
  - stale public proof

**Safe next actions**

- show 3-6 task shortcuts only
- use task classification:
  - `Available Now`
  - `Requires Approval`
  - `Partially Available`
  - `Externally Dependent`

### 2. Tasks

**Purpose**

Launch bounded operator-safe workflows.

**Sections**

1. task category filter
2. action cards
3. selected task launcher
4. submission preview
5. caveats and approval notes

**Task categories**

- `Routine`
- `Repair`
- `Research`
- `Governance`
- `Sensitive`

**Copy rule**

Every task must state:

- what it does
- what it depends on
- whether approval is needed
- whether it is fully proven or partially available

### 3. Runs

**Purpose**

Show what actually happened.

**Sections**

1. execution summary strip
2. filters
3. run ledger table
4. cost and budget summary
5. status breakdown

**This page should own**

- metered spend
- per-run cost
- budget posture
- latency
- run outcome truth

### 4. Approvals

**Purpose**

Be the operator’s decision inbox.

**Sections**

1. approval summary
2. pending approval list
3. selected approval detail
4. decision action box

**Copy**

- headline: `Approval Inbox`
- subtitle: `Review gated work before it can continue.`

### 5. Incidents

**Purpose**

Own the incident queue as a first-class surface.

**Reason**

The backend already treats incidents as first-class truth. The UI should too.

**Sections**

1. incident posture summary
2. severity/status filters
3. incident queue
4. incident detail panel
5. remediation and verification actions
6. history / ownership / acknowledgements

**Guidance layer**

- The page must explain what acknowledgement, assignment, and remediation do in
  plain operator language.
- Manual remediation options should be presented as overrides, not as proof
  that remediation already exists.
- Empty remediation or ownership sections should become instructional empty
  states instead of occupying half the detail layout with blank panes.
- The detail view should always surface a visible `what to do next` block near
  the action deck.

**Status honesty**

Use explicit labels:

- `Open`
- `Watching`
- `Acknowledged`
- `Remediating`
- `Verification Required`
- `Resolved`

### 6. Agents

**Purpose**

Show fleet readiness, lifecycle, and evidence posture.

**Sections**

1. readiness summary
2. fleet filters
3. agent cards or rows
4. service truth
5. allowed skills / lifecycle mode / host service posture

**Copy**

Avoid “smart agent” hype. Prefer:

- `Declared`
- `Worker-capable`
- `Service expected`
- `Service running`
- `Policy constrained`
- `Partially verified`

### 7. Governance

**Purpose**

Explain what is allowed, reviewed, restart-safe, and auditable.

**Sections**

1. governed-skill posture
2. telemetry
3. policy summary
4. registry table
5. audit feed

**Tone**

This page should feel administrative and trustworthy, not flashy.

### 8. Knowledge

**Purpose**

Show the state of indexed truth, query, recall, and repair posture.

**Sections**

1. knowledge summary
2. freshness and repair posture
3. query surface
4. memory recall
5. graph / topology / contradiction support

**Copy**

- title: `Knowledge`
- subtitle: `Indexed truth, retrieval, memory recall, and repair posture.`

### 9. System Health

**Purpose**

Be the authoritative technical health and dependency page.

**Sections**

1. runtime health
2. dependency health
3. persistence posture
4. truth layers
5. coordination / Redis posture

**Do not overload with**

- full incident queue
- full remediation workflow
- broad operator summaries

Those belong elsewhere.

### 10. Diagnostics

**Purpose**

Run targeted operator checks when needed.

**Positioning**

Utility route, not a top-level product identity page.

**Sections**

1. environment target summary
2. run checks
3. results
4. retry failed checks

### 11. Public Proof

**Purpose**

Public-facing evidence surface, separate from private control-plane certainty.

**Sections**

1. proof overview
2. proof nodes
3. latest milestones
4. demand and control clusters
5. dead-letter / proof-risk

**Visual distinction**

Keep it cooler, cleaner, and more public-facing than the private operator
shell, while still clearly part of the same product family.

## Design System Direction

### Visual Tone

Use:

- dark industrial premium surfaces
- machined metal framing
- deliberate glows
- low-noise motion
- strong typography hierarchy

Avoid:

- generic SaaS cards
- too many tiny widgets
- decorative dashboards with no decision value
- sci-fi clutter that reduces readability

### Color Role System

- `amber/orange`: actions, active focus, command accents
- `green`: healthy, verified, clear
- `amber/yellow`: caution, pending, partially available
- `red`: blocked, failed, critical
- `cyan/blue`: public proof, diagnostics, information
- `steel neutrals`: panel framing, separators, inactive structure

### Typography

- `Orbitron`: masthead and major display headings only
- `JetBrains Mono`: operational labels, metrics, status, machine-like text
- `Inter`: readable explanatory copy

### Motion

Use motion only for:

- route transitions
- reveal-in on major cards
- command palette
- active state emphasis

Do not use floaty constant motion or decorative starfield-like effects.

### Responsive Behavior

- desktop: 12-column grid
- tablet: 6-8 column adaptive grid
- mobile: stacked sections with clear priority order

On mobile:

- keep the attention rail near the top
- limit dense tables
- collapse secondary metrics into drawers or smaller stacked modules

## Copy System

The copy style should be:

- plainspoken
- high-trust
- explicit about caveats
- never overclaiming

### Approved status language

- `Healthy`
- `Degraded`
- `Down`
- `Partially Available`
- `Not Yet Verified`
- `Externally Dependent`
- `Requires Approval`
- `Watching`

### Avoid

- `Everything looks great`
- `AI is thinking`
- `All clear` when data is partial
- `Guaranteed`
- `Fully autonomous`

### Preferred explanatory style

- `Control plane is reachable, but one or more dependencies are degraded.`
- `This task is available, but downstream provider success still depends on external quota or network posture.`
- `No approvals are waiting right now.`
- `Public proof is live, but the latest evidence may be stale.`

## Backend Rendering Guardrails

The frontend should continue following the API guardrails:

- render safe leaf fields, not raw nested objects
- separate private operator truth from public proof truth
- keep externally dependent task lanes visibly caveated
- do not flatten `confirmed route exists` into `workflow always succeeds`
- do not treat public proof as the same as internal operator certainty

## Implementation Order

Recommended redesign order:

1. lock this spec as the design source of truth
2. restructure navigation and page responsibilities
3. rewrite `Overview` around attention, action, and recent truth
4. split `Incidents` from `System Health`
5. clean up `Tasks`, `Runs`, and `Approvals` as the main workflow trio
6. demote `Diagnostics` into utility status
7. polish `Agents`, `Governance`, and `Knowledge`
8. retune `Public Proof` as a separate public-facing sibling surface

### Phase 1 Landed

The first cutover is now implemented in the integrated `/operator` console:

- primary navigation reordered to `Overview`, `Tasks`, `Runs`, `Approvals`,
  `Incidents`, `Agents`, `Governance`, and `Knowledge`
- `Incidents` split into its own dedicated operator route and command deck
- `Overview` reduced to status, attention, safe-action shortcuts, and recent
  truth
- `System Health` slimmed back to runtime, dependency, truth-layer, and
  coordination posture

### Phase 3 Guidance Layer

The next console pass should make decision-heavy pages self-explaining rather
than assuming prior operator knowledge.

- Add reusable guidance panels and action-hint patterns.
- Prefer visible helper copy near decision points over hidden-only tooltips.
- Collapse empty detail sections so the layout promotes populated truth and
  uses empty states for instruction, not filler.
- Start with `Incidents`, then apply the same guidance pattern to `Tasks`,
  `Runs`, and `Approvals`.

## Hard-Cutover Rule

Do not keep two competing console architectures alive.

When the redesign begins:

- cut pages over deliberately
- retire the old structure
- do not maintain parallel legacy/new console IA indefinitely

This product already has enough backend truth to support a cleaner operator
experience. The next work is not inventing more surface area. It is presenting
the existing truth with better hierarchy, clearer copy, and stronger trust
signals.
