---
title: "Operator Surface Capability Matrix"
summary: "Backend-first matrix for deciding what should be exposed now, later, or never across /operator and operator-s-console."
---

# Operator Surface Capability Matrix

This document is the backend-first decision aid for operator surface scope.

It exists to separate three things that currently get mixed together:

- backend implementation truth
- runtime validation / evidence truth
- frontend scope policy (`V1`, admin-only, observe-only, internal-only)

It is a current-runtime exposure matrix, not the sole authority for agent
promotion maturity. For any task-promotion or “is this agent ready to own this
lane?” decision, read this together with
`docs/architecture/AGENT_CAPABILITY_MODEL.md` and
`docs/architecture/AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md`.

## Core Interpretation

`V1` in the current repo mostly means:

- the curated first console scope for `operator-s-console`
- not the full limit of what orchestrator can route or expose

The orchestrator backend is broader than the current curated frontend scope.

That means:

- a route or task can already exist in backend
- the route or task can even have real success evidence
- but still be intentionally hidden from a normal operator frontend until the
  operator-facing classification is explicit and stable

That still does not mean every implemented task should be promoted
immediately. The intended promotion order is:

1. agent capability reaches the required maturity target
2. runtime evidence supports that claim
3. operator-facing task promotion follows

This document must stay synchronized with the capability docs. It describes
current exposure/runtime truth, not the finish line for agent maturity.

Current local-runtime note:

- The separate public-proof/openclawdbot surface is retired in the active local
  runtime.
- Public proof is now served from orchestrator-owned public routes.
- `/operator` and `/operator/*` now serve the built `operator-s-console`
  bundle from orchestrator itself.
- `operator-s-console/` is the canonical tracked operator UI in the root
  workspace repo and the only supported `/operator` delivery path.

## Documentation Maintenance

Whenever operator exposure changes, or when runtime truth materially changes
what an operator can credibly rely on, update this file together with:

- `AGENT_CAPABILITY_MODEL.md`
- `AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md`
- `../reference/task-types.md`
- `../reference/api.md`

If the backend becomes broader than the current frontend on purpose, say that
explicitly here rather than leaving the difference implicit.

## Decision Labels

- `Expose now`
  Safe and credible for normal operator use today.
- `Admin-only`
  Backend exists, but the runtime path is still low-confidence, side-effectful,
  or easy to misuse. Keep behind explicit admin intent.
- `Observe-only`
  Surface status, telemetry, readiness, and run history. Do not present as a
  normal user-triggerable workflow yet.
- `Internal-only`
  Never expose as a normal operator action. Runtime-only plumbing.

## Source of Truth

Primary sources for this matrix:

- `workspace/orchestrator/src/index.ts`
- `workspace/orchestrator/src/middleware/auth.ts`
- `workspace/docs/reference/task-types.md`
- `workspace/docs/reference/api.md`
- `workspace/docs/architecture/AGENT_CAPABILITY_MODEL.md`
- `workspace/OPENCLAW_CONTEXT_ANCHOR.md`

## 1. Task Capability Matrix

The backend allowlist is broader than the current curated UI task surfaces.
Normal operator UIs should follow the matrix below rather than the raw allowlist.

| Task Type | Backend Present | Runtime Truth | Safe for `/operator` | Safe for `operator-s-console` | Decision | Notes |
|---|---:|---|---|---|---|---|
| `heartbeat` | Yes | confirmed working | Yes | Yes | Expose now | Canonical fast liveness path through the queue. |
| `build-refactor` | Yes | approval-gated; explicit bounded patch mode now executes real edits + optional verification | Yes | Yes | Expose now | Sensitive and real. Keep approval language prominent and require explicit scoped payloads for code surgery. |
| `market-research` | Yes | confirmed-working fetch lane with explicit URLs or derived allowlisted source plans; network posture still matters | Yes | Yes | Expose now | Surface source-plan guidance and network caveats, but treat this as a real research lane rather than a placeholder query capture. |
| `doc-sync` | Yes | confirmed control-plane path; most useful when pending changes exist | Yes | Yes | Expose now | Safe low-side-effect queue action. |
| `nightly-batch` | Yes | historical success exists; scheduler and downstream feeds still matter | Yes | Yes | Expose now | Keep schedule/duplication caveat visible in both UIs. |
| `drift-repair` | Yes | local smoke proved with real knowledge-pack and repair evidence | Yes | Yes | Expose now | Operator-facing repair lane is live; keep doc-health caveats visible rather than hiding the repair posture. |
| `reddit-response` | Yes | confirmed-working drafting lane with deterministic local fallback and optional provider polish | Yes | Yes | Expose now | Allow manual queue payloads, and keep the optional provider-polish caveat explicit without understating the core drafting lane. |
| `send-digest` | Yes | partial; externally dependent | Yes | Yes | Expose now | Operator-facing now, but outbound channel dependency remains real. |
| `rss-sweep` | Yes | externally dependent | Yes | Yes | Expose now | Exposed with config/network caveats, not as a guaranteed-success lane. |
| `agent-deploy` | Yes | approval-gated; confirmed local deployment copy path | Yes | Yes | Expose now | Sensitive lane now has a real operator profile; keep approval language prominent because it writes deployment surfaces. |
| `security-audit` | Yes | confirmed working in live sweep | Yes | Yes | Expose now | Worker performs real repository/runtime inspection locally rather than a fake success wrapper. |
| `system-monitor` | Yes | confirmed working in live sweep | Yes | Yes | Expose now | Targeted monitor passes are now user-runnable and grounded in real runtime/service-state analysis. |
| `summarize-content` | Yes | confirmed working in live sweep | Yes | Yes | Expose now | Inline-content path is now a first-class operator task. |
| `content-generate` | Yes | confirmed working in live sweep with source-driven generation | Yes | Yes | Expose now | Safe enough as a grounded content lane when source fields are explicit. |
| `integration-workflow` | Yes | confirmed working in live sweep with deterministic reroute/replay orchestration | Yes | Yes | Expose now | Exposed with bounded default-plan plus shorthand-step guidance rather than implying a magical empty workflow. |
| `normalize-data` | Yes | confirmed working in live sweep | Yes | Yes | Expose now | Exposed with structured input/schema expectations. |
| `data-extraction` | Yes | inline lane proven; parser-backed file lanes implemented | Yes | Yes | Expose now | Expose now with parser/format caveats rather than implying only inline extraction is real. |
| `qa-verification` | Yes | confirmed working in live smoke | Yes | Yes | Expose now | Exposed with dry-run/live-check distinctions preserved. |
| `skill-audit` | Yes | confirmed working in live smoke | Yes | Yes | Expose now | Exposed as a bounded governance task profile. |
| `startup` | Yes | internal runtime task | No | No | Internal-only | Boot path only. Must not become a user action. |
| `doc-change` | Yes | internal runtime task | No | No | Internal-only | Watcher/buffer plumbing only. Must not become a user action. |

### Task Policy Notes

- `public-triggerable` means the trigger route accepts the task. It does not
  prove the downstream worker/service/dependency path is healthy.
- All non-internal public-triggerable tasks now have explicit operator-facing
  profiles in `OPERATOR_TASK_PROFILES`.
- Promotion does not erase runtime caveats. The operator-facing surfaces should
  expose those caveats rather than flattening every task into a “ready” button.
- The next clean backend move is deeper runtime proof, not another round of
  catalog hiding.
- Full-capability work should surface governed access gaps honestly. If an
  agent still lacks a required skill or tool for a task lane, show that as a
  readiness/policy problem rather than solving it by flattening permissions
  across the whole fleet.

## 2. Route Capability Matrix

This matrix is about backend route exposure, not current frontend implementation.

| Route / Family | Role | Safe for `/operator` | Safe for `operator-s-console` | Decision | Notes |
|---|---|---|---|---|---|
| `GET /operator` | private operator console | Yes | N/A | Expose now | Canonical private operator-console entrypoint served from the built `operator-s-console` bundle by orchestrator. |
| `GET /operator/*` | private operator console route family | Yes | N/A | Expose now | SPA route family for the canonical private `operator-s-console` bundle, served by orchestrator. |
| `GET /health` | public | Yes | Yes | Expose now | Public shallow liveness only. Do not treat returned localhost helper URLs as browser targets. |
| `GET /api/persistence/health` | public | Yes | Yes | Expose now | Public dependency truth only, not full operator state. |
| `GET /api/knowledge/summary` | public | Yes | Yes | Expose now | Safe public summary; protected query is a separate surface. |
| `GET /api/command-center/overview` | public proof | Yes | Yes | Expose now | Public orchestrator-owned proof overview contract for the show-off surface. |
| `GET /api/command-center/control` | public proof | Yes | Yes | Expose now | Public orchestrator-owned control-lane summary for the proof page. |
| `GET /api/command-center/demand` | public proof | Yes | Yes | Expose now | Public orchestrator-owned demand summary contract. |
| `GET /api/command-center/demand-live` | public proof | Yes | Yes | Expose now | Public orchestrator-owned live demand snapshot contract. |
| `GET /api/milestones/latest` | public proof | Yes | Yes | Expose now | Public orchestrator-owned latest milestone feed. |
| `GET /api/milestones/dead-letter` | public proof | Yes | Yes | Expose now | Public orchestrator-owned proof-risk feed for blocked or at-risk items. |
| `GET /api/openapi.json` | public | Optional | Optional | Observe-only | Useful for engineers and diagnostics, not a primary operator panel. |
| `GET /api/auth/me` | viewer | Yes | Yes | Expose now | Auth identity and role context. |
| `GET /api/dashboard/overview` | viewer | Yes | Yes | Expose now | Aggregate operator summary. Useful, but not stronger than its source routes. |
| `GET /api/health/extended` | viewer | Yes | Yes | Expose now | Authoritative protected operator-health surface. |
| `GET /api/tasks/catalog` | viewer | Yes | Yes | Expose now | Canonical operator capability endpoint for task surfacing. |
| `POST /api/tasks/trigger` | operator | Yes | Yes | Expose now | Curated tasks only. Frontends should not assume the full allowlist is user-facing. |
| `GET /api/tasks/runs` | viewer | Yes | Yes | Expose now | First-class run visibility surface. |
| `GET /api/tasks/runs/:runId` | viewer | Yes | Yes | Expose now | Full run detail / workflow graph / repair linkage surface. |
| `GET /api/approvals/pending` | operator | Yes | Yes | Expose now | Approval inbox for sensitive or review-gated flows. |
| `POST /api/approvals/:id/decision` | operator | Yes | Yes | Expose now | Action route; keep operator-only. |
| `GET /api/incidents` | viewer | Yes | Yes | Expose now | Core incident queue / ledger surface. |
| `GET /api/incidents/:id` | viewer | Yes | Yes | Expose now | Core incident detail surface. |
| `GET /api/incidents/:id/history` | viewer | Yes | Yes | Expose now | Important lifecycle stream; not admin-only. |
| `POST /api/incidents/:id/acknowledge` | operator | Yes | Yes | Expose now | Legitimate operator action, not just diagnostics. |
| `POST /api/incidents/:id/owner` | operator | Yes | Yes | Expose now | Legitimate operator action, not just diagnostics. |
| `POST /api/incidents/:id/remediate` | operator | Yes | Yes | Expose now | Legitimate operator action; better launched from incident context than a generic task list. |
| `GET /api/agents/overview` | viewer | Yes | Yes | Expose now | Canonical agent truth surface: declaration, worker path, explicit `serviceExpected`/`lifecycleMode`/host service status, readiness, topology. |
| `GET /api/memory/recall` | viewer | Yes | Yes | Expose now | Safe with default redaction. Good for activity/knowledge/operator context. |
| `POST /api/knowledge/query` | operator | Optional | Yes | Expose now | Safe operator workflow, but more naturally a deeper console page than the default overview/task rails. |
| `GET /api/persistence/summary` | viewer | Yes | Yes | Expose now | Strong operator-facing persistence summary. |
| `GET /api/skills/policy` | viewer | Yes | Yes | Expose now | Good for both shells. Summary-level governance posture. |
| `GET /api/skills/registry` | viewer | Optional | Yes | Expose now | Better fit for deeper governance pages than the default overview/task rails. |
| `GET /api/skills/telemetry` | viewer | Optional | Yes | Expose now | Better fit for deeper governance and diagnostics pages than the default overview/task rails. |
| `GET /api/skills/audit` | viewer | Optional | Yes | Expose now | Useful now, but more diagnostic/governance detail than the default overview/task rails. |
| `GET /api/persistence/historical` | viewer | No by default | No by default | Observe-only | Real route, but not essential to either current operator surface until a historical ops page exists. |
| `GET /api/knowledge/export` | admin | No | No | Admin-only | Export-heavy privileged route. Keep out of normal frontends. |
| `GET /api/persistence/export` | admin | No | No | Admin-only | Export-heavy privileged route. Keep out of normal frontends. |
| `POST /webhook/alerts` | signed ingest | No | No | Internal-only | Ingest boundary only. Never a UI route. |

### Route Policy Notes

- `operator-s-console` should not be forced to mirror every valid backend route.
- `GET /api/persistence/historical` is valid backend truth, but it is still
  reasonable to keep it out of both current consoles until a historical ops use
  case is designed.
- Export routes are real and supported, but they are privileged ops/admin
  surfaces, not day-to-day operator UI material.

## 3. Agent Capability Matrix

Agents should be judged on two separate axes:

- can the backend route work to them?
- has runtime evidence matured enough to trust their role-specific claims?

Do not confuse declared capability targets with current operator-safe maturity.

All declared agents should eventually become strong enough that this section is
explaining trustworthy operator exposure for a fully capable portfolio, not a
long-term excuse for permanent partial maturity.

| Agent | Task Lane(s) | Backend Status | Current Maturity Signal | Safe for `/operator` | Safe for `operator-s-console` | Decision | Notes |
|---|---|---|---|---|---|---|---|
| `doc-specialist` | `drift-repair`, `doc-sync` aligned work | Present | Wave 1 gate closed for the current runtime slice; richer truth-spine uplift remains roadmap | Summary only | Full readiness / evidence | Expose now | High-value to surface. Keep action entrypoints contextual through tasks/incidents, not by “run agent” UI. |
| `system-monitor-agent` | `system-monitor`, `heartbeat` aligned monitoring | Present | Wave 1 gate closed for the current runtime slice; deeper operator-action fusion remains roadmap | Summary only | Full readiness / evidence | Expose now | Strong candidate for deeper operator visibility before broader task exposure. |
| `security-agent` | `security-audit` | Present | Wave 1 gate closed for the current runtime slice; broader remediation-closure uplift remains roadmap | Summary only | Full readiness / evidence | Expose now | Surface readiness and evidence, but do not oversell as a finished end-state trust auditor. |
| `qa-verification-agent` | `qa-verification` | Present | Wave 1 gate closed for the current runtime slice; broader acceptance coverage remains roadmap | Summary only | Full readiness / evidence | Expose now | Best surfaced through verification-focused task flows and run detail, not as a generic direct-agent runner. |
| `integration-agent` | `integration-workflow` | Present | Wave 1 gate closed for the current runtime slice; broader workflow productization remains roadmap | Summary only | Full readiness / evidence | Expose now | Strong observability target; task exposure should follow clearer workflow productization. |
| `build-refactor-agent` | `build-refactor` | Present | Wave 3 gate closed for the current runtime slice; deeper applied-edit proof remains roadmap | Summary only | Full readiness / evidence | Expose now | Backing lane for one of the main operator tasks; current readiness now carries code-governance signals rather than a flat confirmed-worker label only. |
| `market-research-agent` | `market-research` | Present | confirmed worker path, external dependency caveats, and readiness now carries delta-capture evidence | Summary only | Full readiness / evidence | Expose now | Backing lane for one of the main operator tasks. |
| `reddit-helper` | `reddit-response` | Present | service/helper exists, community path is still degraded/external, and readiness now carries provider-posture evidence | Summary only | Full readiness / evidence | Expose now | Keep queue/provider caveats explicit and treat reply drafting as a dependency-sensitive workflow, not a flat always-green lane. |
| `content-agent` | `content-generate` | Present | backend lane proven with bounded operator profile, and readiness now carries publication-policy evidence | Summary only | Full readiness / evidence | Expose now | Expose the bounded generation lane now, while keeping publishing and evidence caveats explicit. |
| `data-extraction-agent` | `data-extraction` | Present | partial by lane; inline source proven; readiness now carries artifact-coverage evidence | Summary only | Full readiness / evidence | Expose now | Good visibility target; do not imply all artifact lanes are equally proven. |
| `normalization-agent` | `normalize-data` | Present | backend lane proven, and readiness now carries comparison-readiness evidence | Summary only | Full readiness / evidence | Expose now | Surface readiness first. |
| `summarization-agent` | `summarize-content` | Present | backend lane proven, and readiness now carries operational-compression evidence | Summary only | Full readiness / evidence | Expose now | Surface readiness first. |
| `skill-audit-agent` | `skill-audit` | Present | Wave 3 gate closed for the current runtime slice; broader operator adoption remains roadmap | Summary only | Full readiness / evidence | Expose now | Best surfaced with governance/tool audit views. |

### Agent Policy Notes

- All declared agents are valid to show in operator surfaces as long as the UI
  labels them honestly.
- The risky mistake is not surfacing them. The risky mistake is surfacing them
  as equally mature.
- `/operator` should stay at summary-level agent truth.
- `operator-s-console` is the better place for full readiness, gap, topology,
  and relationship history views.
- No current UI should imply “run this agent directly” unless the action is
  actually modeled as a safe task workflow.
- Full capability should appear here as stronger readiness, richer
  `allowedSkills[]`, and better evidence-backed task ownership, not as silent
  universal tool access for every agent.

## 4. Immediate Surfacing Policy

Use this policy until a stricter product split is chosen.

### Private operator console (`/operator` and `/operator/*`)

Keep as the canonical private operator console:

- auth identity
- curated task trigger
- approvals
- quick health and incident action
- summary agent truth
- summary governance / skill policy
- run detail only where it directly supports an operator action
- deeper task run history and workflow replay
- richer incident lifecycle and remediation detail
- agent capability readiness and relationship windows
- richer governance and skill surfaces
- richer knowledge atlas and diagnostics
- public proof page as a separate route family inside the same bundle

Current route contract:

- `/operator` and `/operator/*` are served from the built
  `operator-s-console` bundle by orchestrator
- protected routes remain orchestrator-backed under that console
- route depth within the same console is the exposure distinction now, not a
  separate “minimal shell versus richer console” product split

### Public proof boundary

Keep public proof separate from the private operator control plane:

- `/operator/public-proof` is the public page path in the same
  `operator-s-console` bundle
- it reads only orchestrator-owned public proof routes
  (`/api/command-center/*` and `/api/milestones/*`)
- it must not collapse protected operator state into public proof payloads
- it replaces the retired `openclawdbot` transport path without reviving a
  separate proof product boundary

### Not for either normal operator surface right now

- raw export routes
- webhook ingest routes
- internal runtime tasks
- unprofiled task lanes promoted as ordinary buttons without operator-facing
  classification

## 5. Practical Next Moves

If we want to expose more backend capability without creating chaos, the correct
order is:

1. Add operator-facing task profiles for any proven backend task we want to make
   user-runnable.
2. Decide whether that task belongs in the default overview/task rails, deeper
   console pages, or should remain visible only through runs/incidents/agents.
3. Keep everything else visible through runs, incidents, agents, and governance
   until the operator workflow is explicit.

That keeps the backend broad, the frontend honest, and the operator experience
trustworthy.
