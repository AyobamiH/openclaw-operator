---
title: "Task Types Reference"
summary: "Current allowlisted task types in the orchestrator runtime."
---

# Task Types Reference

Related scope policy:

- see [../architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md](../architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md)
  for the current decision matrix that says which backend tasks should be
  exposed now, kept admin-only, treated as observe-only, or remain internal-only

The canonical task allowlist lives in:

```text
workspace/orchestrator/src/taskHandlers.ts
```

This document mirrors the current allowlist at a high level. If it diverges,
the code wins.

Capability-truth rule:

- all declared non-template agents remain in scope for full-capability uplift
- a task being allowlisted or operator-facing does not by itself prove the
  owning agent has reached full maturity
- when task promotion, runtime caveats, or agent-capability truth changes,
  update this reference together with the canonical capability docs in the same
  change set

Capability-access rule:

- full capability does not mean flattening ToolGate, manifest permissions, or
  skill allowlists into universal access for every agent
- every declared non-template agent should eventually gain governed access to
  the skills and tools required for its role-complete execution path
- when a capability gap is really an access gap, fix it through explicit
  allowlist and operator-visible policy/readiness updates, not by silently
  granting every skill/tool to every agent

## Current Allowlisted Task Types

### Core Runtime

- `startup`
- `doc-change`
- `doc-sync`
- `drift-repair`
- `rss-sweep`
- `nightly-batch`
- `send-digest`
- `heartbeat`

### External / Community / Content

- `reddit-response`
- `content-generate`
- `market-research`
- `data-extraction`
- `normalize-data`
- `summarize-content`

### Quality / Security / System

- `control-plane-brief`
- `incident-triage`
- `release-readiness`
- `security-audit`
- `system-monitor`
- `qa-verification`
- `skill-audit`
- `integration-workflow`

### Sensitive / Approval-Gated

- `build-refactor`
- `agent-deploy`

Documentation maintenance:

- update this file whenever `ALLOWED_TASK_TYPES`, approval posture, operator
  classification, or validation-sweep truth changes materially
- keep this file aligned with:
  - `../architecture/AGENT_CAPABILITY_MODEL.md`
  - `../architecture/AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md`
  - `../architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md`
  - `./api.md`

## Approval Requirements

By default, these task types require approval before execution:

- `build-refactor`
- `agent-deploy`

Every allowlisted task can also be dynamically approval-gated when
`payload.requiresApproval === true`.

The approval gate behavior is implemented in:

```text
workspace/orchestrator/src/approvalGate.ts
```

## Operational Classification (Validation Sweep Truth)

Labels used below:

- `internal-only`
- `public-triggerable`
- `approval-gated`
- `confirmed working`
- `partially operational`
- `externally dependent`
- `unconfirmed in latest sweep`

Status labels below are grounded in the latest completed validation sweep plus
the current runtime code path split in `taskHandlers.ts`,
`validation.ts`, and `approvalGate.ts`.

Do not treat `unconfirmed in latest sweep` as evidence of end-to-end health.
It means the task is present in runtime and may be routable, but it was not
confirmed as working through a real task execution path in the latest sweep.

Approval column:

- `dynamic-only`: not default-gated, but `payload.requiresApproval === true`
  can still force approval.
- `default + dynamic`: in the default approval-required set and also supports
  dynamic approval forcing.

| Task Type | Surface | Approval | Handler | Agent Dependency | ToolGate Preflight | Operational Truth / Dependency Notes |
|---|---|---|---|---|---|---|
| `startup` | `internal-only` | `dynamic-only` | `startupHandler` | none | no | Internal boot path; not publicly triggerable; do not present as user-runnable. |
| `doc-change` | `internal-only` | `dynamic-only` | `docChangeHandler` | none | no | Internal doc-watch buffer path; not publicly triggerable. When buffered drift reaches the runtime threshold (`25` pending paths), the orchestrator now uses shared coordination to claim a doc-repair lock, auto-enqueue a deterministic `drift-repair` run id, record bounded repair state, and apply a same-doc-set cooldown without multi-process repair churn. |
| `doc-sync` | `public-triggerable`; `confirmed working` | `dynamic-only` | `docSyncHandler` | none | no | Public schema allows it, and the current operator task profile treats it as a confirmed control-plane path. Most useful when pending doc changes exist. |
| `drift-repair` | `public-triggerable`; `confirmed working (2026-03-29 live repair refresh)` | `dynamic-only` | `driftRepairHandler` | `doc-specialist` | no | Custom helper spawn path, not ToolGate-preflighted. `POST /api/tasks/trigger` produced a first-class run record, verified a knowledge pack on disk, and surfaced repair evidence in `/api/tasks/runs`, `/api/dashboard/overview.selfHealing`, and `/api/health/extended.repairs`. The live `2026-03-29` repair refresh now also persists doc-specialist runtime-signal highlights into the operator readiness surface, and the service-expected `doc-specialist.service` user unit has been synced so host service coverage can be proven from the operator overview. Runtime now uses explicit idempotency only, so normal trigger calls fall back to the task id as the run id unless a payload supplies `idempotencyKey`. Phase 2 adaptation also standardizes operator-summary, next-action, and specialist-contract output on top of the existing knowledge-pack, contradiction, and repair-draft rails. |
| `control-plane-brief` | `public-triggerable`; `confirmed working (2026-04-02 focused contract proof)` | `dynamic-only` | `controlPlaneBriefHandler` | `operations-analyst-agent` | yes | Focused public synthesis lane. The handler fuses queue, approval, incident, service, and public-proof truth into one bounded control-plane brief, emits explicit operator summary and next actions, and now powers the companion `/api/companion/overview` surface instead of forcing external clients to scrape operator-only routes. |
| `incident-triage` | `public-triggerable`; `confirmed working (2026-04-02 focused contract proof)` | `dynamic-only` | `incidentTriageHandler` | `system-monitor-agent` | yes | Focused public triage lane. The worker turns open-incident pressure into a ranked queue with ownership, acknowledgement, remediation, and verification posture, and the same bounded triage contract now feeds the companion incident summary surface. |
| `release-readiness` | `public-triggerable`; `confirmed working (2026-04-02 focused contract proof)` | `dynamic-only` | `releaseReadinessHandler` | `release-manager-agent` | yes | Focused public release-governance lane. It synthesizes `go` / `hold` / `block` posture from the latest verification, security, system-monitor, build, incident, approval, and proof-freshness evidence, but it does not itself deploy or bypass approval policy. |
| `reddit-response` | `public-triggerable`; `confirmed working` | `dynamic-only` | `redditResponseHandler` | `reddit-helper` | no | Custom helper spawn path, not ToolGate-preflighted; `reddit-helper` now consumes the latest dual-source knowledge pack plus runtime doctrine/model defaults from `workspace/orchestrator_config.json`, applies shared coordination for processed-draft dedupe and daily LLM budgets, persists per-run service state, and treats provider polish as optional rather than the core lane. Spawned helper runs now inherit orchestrator-shared runtime dependencies through `NODE_PATH`, and real helper exceptions fail the task instead of silently falling back to a green run. `reddit-response` now consumes only `selectedForDraft=true` queue items from backlog; `priority` queue items are auto-selected by `nightly-batch`, `manual-review` leads require explicit approval through `/api/approvals/:id/decision`, and the top `10` `draft` leads can now be promoted through the same approval/replay surface. Automated proof now covers both the deterministic budget-exhausted local fallback lane and the `hybrid-polished` provider-success lane; the deterministic draft path is now explicitly knowledge-grounded and service-backed on `2026-03-29`, with the user `reddit-helper.service` synced to prove live service coverage in the operator overview. The runtime now also emits explicit knowledge-freshness warnings when the latest knowledge pack is aging, stale, missing, or behind the current `openclaw-docs` mirror so operators know when to refresh `drift-repair` before broad reuse. Phase 2 adaptation adds explicit operator summary, next-step guidance, and community-safety posture fields to each bounded draft result. |
| `security-audit` | `public-triggerable`; `confirmed working (2026-03-07 sweep)` | `dynamic-only` | `securityAuditHandler` | `security-agent` | yes | `POST /api/tasks/trigger` -> `/api/tasks/runs` -> `/api/memory/recall` produced a success path on `2026-03-07`; current worker logic performs real local repository/runtime inspection rather than relying on an external scanner. Logical `success !== true` now fails the run instead of reporting green, and the adapted lane now returns explicit operator summary, next actions, and escalation posture instead of only flat findings. |
| `summarize-content` | `public-triggerable`; `confirmed working (2026-03-07 sweep)` | `dynamic-only` | `summarizeContentHandler` | `summarization-agent` | yes | Local-content path was confirmed through a real spawned-worker run on `2026-03-07`; manifest network remains disabled. Logical `success !== true` now fails the run instead of reporting green. Phase 2 adaptation adds explicit operator summary, next-action guidance, and specialist-contract framing while preserving the existing compression, evidence-retention, and handoff signals. |
| `system-monitor` | `public-triggerable`; `confirmed working (2026-03-07 sweep)` | `dynamic-only` | `systemMonitorHandler` | `system-monitor-agent` | yes | Real spawned-worker success observed on `2026-03-07`; current worker logic performs real runtime, service-state, queue, proof, and incident analysis locally. Logical `success !== true` now fails the run instead of reporting green, and the adapted lane now returns runtime diagnosis plus prioritized operator next actions. |
| `build-refactor` | `public-triggerable`; `approval-gated`; `confirmed working` | `default + dynamic` | `buildRefactorHandler` | `build-refactor-agent` | yes | Confirmed working after approval; bounded autonomous synthesis now derives real `workspacePatch` edits from scoped repo evidence, explicit JSON payloads with `changes[]` still execute real patch sets, and optional whitelisted `testRunner` verification remains part of the live lane. Manual `POST /api/incidents/:id/remediate` can still queue `build-refactor` as an approval-bounded code-remediation lane with verifier-linked constraints. Phase 3 adaptation adds explicit scope/refusal posture, operator summary, next-action guidance, and specialist-contract framing without overstating the bounded patch and verification truth. |
| `content-generate` | `public-triggerable`; `confirmed working (2026-03-29 grounded live run)` | `dynamic-only` | `contentGenerateHandler` | `content-agent` | yes | Real spawned-worker success observed on `2026-03-07`; the worker now generates source-driven README/API/changelog/blog/proof/operator content from supplied fields instead of placeholder/template filler. The live `2026-03-29` grounding pass also proved parser-backed document grounding with real `doc:` evidence anchors and observed tool-execution evidence instead of preflight-only posture. Phase 2 adaptation adds explicit operator summary, next-action guidance, and specialist-contract output while keeping publication policy, routing, and evidence appendix behavior grounded in the current source payload. |
| `integration-workflow` | `public-triggerable`; `confirmed working (2026-03-07 sweep)` | `dynamic-only` | `integrationWorkflowHandler` | `integration-agent` | yes | Real spawned-worker success observed on `2026-03-07`; empty submissions now fall back to a bounded default workflow, shorthand step descriptors like `market-research: operator console trends` are normalized into routable steps, and the worker emits real delegation, dependency, tool, and verifier-handoff evidence rather than a fake success wrapper. The adapted lane now also returns explicit replay guidance, operator summary, and next actions when reroute or stop posture appears. |
| `normalize-data` | `public-triggerable`; `confirmed working (2026-03-07 sweep)` | `dynamic-only` | `normalizeDataHandler` | `normalization-agent` | yes | Local normalization path was confirmed through a real spawned-worker run on `2026-03-07`. Phase 3 adaptation adds canonical-schema narration, duplicate/uncertainty review guidance, and shared specialist output fields so operators can tell whether a dataset is truly comparison-ready or still needs review. |
| `market-research` | `public-triggerable`; `confirmed working` | `dynamic-only` | `marketResearchHandler` | `market-research-agent` | yes | Real spawned-worker success is now grounded in actual allowlisted fetches: the worker can fetch operator-supplied URLs or derive a bounded source plan from query/scope hints, then emit change intelligence, internal signals, and change packs from fetched evidence. Live success still depends on allowed-domain network reachability. Phase 3 adaptation adds clearer source-plan/signal-class output, degraded-but-actionable operator guidance, and the shared specialist contract without expanding network scope. |
| `data-extraction` | `public-triggerable`; `confirmed working (2026-03-29 parser-backed live run)` | `dynamic-only` | `dataExtractionHandler` | `data-extraction-agent` | yes | Inline-source lane was confirmed through a real spawned-worker run on `2026-03-07`; parser-backed file/document lanes are also implemented through `documentParser` and optional `normalizer`, with format-specific reliability still depending on parser coverage. The live `2026-03-29` canary now proves parser-backed file extraction plus optional normalization handoff with real tool-execution evidence in the operator readiness surface. Phase 3 adaptation adds clearer provenance/confidence narration, handoff guidance, and shared specialist output fields while keeping parser truth bounded to current coverage. |
| `qa-verification` | `public-triggerable`; `confirmed working (2026-03-07 live smoke)` | `dynamic-only` | `qaVerificationHandler` | `qa-verification-agent` | yes | `POST /api/tasks/trigger` proved both the explicit dry-run lane and a minimal allowed real run via `build-verify`. `/api/skills/audit?limit=20` now shows `mode=execute` records for `testRunner`, and the dry-run path is explicitly labeled instead of reporting a silent `0/0` green. Runtime now preserves per-trigger run visibility by using the task id as the default run id unless the payload explicitly supplies `idempotencyKey`. The adapted lane now also returns explicit refusal, closure, and next-action guidance instead of a naked verifier verdict. |
| `skill-audit` | `public-triggerable`; `confirmed working (2026-03-07 live smoke)` | `dynamic-only` | `skillAuditHandler` | `skill-audit-agent` | yes | `POST /api/tasks/trigger` produced a first-class run record after the contract fix. ToolGate preflight remains visible in `/api/skills/audit`, and the runtime now only reuses a run id when the payload explicitly carries `idempotencyKey`. Phase 3 adaptation adds governance-review posture, restart-safety narration, and shared specialist output fields so audit results read like actionable governance work instead of a flat checklist dump. |
| `rss-sweep` | `public-triggerable`; `externally dependent` | `dynamic-only` | `rssSweepHandler` | none | no | Depends on `rssConfigPath`, live feeds, and network availability; routing truth does not prove downstream feed success. |
| `nightly-batch` | `public-triggerable`; `historical success observed 2026-03-06` | `dynamic-only` | `nightlyBatchHandler` | none | no | Also runs from cron; `/api/dashboard/overview.recentTasks` showed success on `2026-03-06`, but the task was not re-run in the `2026-03-07` safe sweep because it writes digest artifacts and emits delivery surfaces. It now derives `selectedForDraft` from existing RSS routing tags: only `priority` queue items are auto-selected for `reddit-response`; `manual-review` items create mandatory pending approvals; and the top `10` `draft` items create optional promotion approvals while staying unselected until an operator approves replay. |
| `send-digest` | `public-triggerable`; `partially operational`; `externally dependent` | `dynamic-only` | `sendDigestHandler` | none | no | Historical success exists in protected recent-task data, but the `2026-03-07` safe sweep did not re-run it because the live config points at an outbound notification target. |
| `heartbeat` | `internal-only`; `confirmed working` | `dynamic-only` | `heartbeatHandler` | none | no | Internal control-plane maintenance path. Scheduled every `5` minutes and hidden from normal operator task launch surfaces. Inspect through diagnostics or `/api/tasks/runs?includeInternal=true`. |
| `agent-deploy` | `public-triggerable`; `approval-gated`; `confirmed working` | `default + dynamic` | `agentDeployHandler` | none | no | After approval, the handler now performs a real local deployment by copying the selected template into the runtime deployment directory, writing `DEPLOYMENT.json`, and persisting the deployment record in orchestrator state. |

## Public vs Internal Scope

- Internal runtime allowlist (`ALLOWED_TASK_TYPES`) is broader than public
  trigger schema (`TaskTriggerSchema`).
- `startup`, `doc-change`, and `heartbeat` are internal-only even though they
  are in the internal allowlist.
- Any allowlisted task can become approval-gated dynamically when
  `payload.requiresApproval === true`; the default gate set is narrower.
- Approval-gated does not mean risk-free:
  `build-refactor` and `agent-deploy` are both live gated paths, but they stay
  approval-heavy because they mutate code or deployment surfaces.
- A task being `public-triggerable` only means the trigger route accepts it. It
  does not, by itself, prove downstream dependencies are healthy.
- Public triggerability or operator exposure must not be used as shorthand for
  “fully capable agent.” Current maturity still belongs to the capability docs.
- Capability completeness should expand governed access to the right
  role-specific skills and tools, not flatten permissions across the full agent
  set. Use `/api/agents/overview.allowedSkills[]` and `/api/skills/*` as the
  current operator truth for what access is actually available.

## Operator API Truth for Task Capabilities

- `GET /api/tasks/catalog` is the operator capability endpoint.
- Internal tasks are filtered out of `GET /api/tasks/catalog`.
- It returns hybrid truth fields:
  - static operational classification labels (from validated runtime policy), and
  - telemetry overlays (recent execution success/failure/retrying counts).
- All non-internal public-triggerable task types now carry explicit
  operator-facing profiles in `OPERATOR_TASK_PROFILES`, and both `/operator`
  and `operator-s-console` bind task-specific forms instead of a
  three-task-only launcher.
- Telemetry overlays are observational and do **not** auto-mutate policy
  classifications.
- Mixed-mode task truth can still be narrower in the operator UI than in this
  reference table when live dependency posture degrades. Example:
  `market-research` is now a confirmed-working profile in `/api/tasks/catalog`,
  but live fetch failures can still appear in telemetry overlays if
  allowed-domain network reachability drops.
- `GET /api/tasks/runs` and `GET /api/tasks/runs/:runId` provide first-class run
  detail visibility for operator diagnostics.
- `GET /api/tasks/runs` hides internal task types by default; use
  `includeInternal=true` when you explicitly need maintenance-task visibility.

## Notes By Task Family

### Runtime Tasks

- `startup` records boot state and emits a startup milestone.
- `doc-change` and `doc-sync` manage the doc-change buffer.
- `drift-repair` can trigger doc-specialist work and emit milestone records.
- `rss-sweep`, `nightly-batch`, and `send-digest` support recurring
  operational flows.
- `heartbeat` is the internal scheduled maintenance tick for the control plane.

### Worker / Agent Tasks

These route work to specialized agents or helper flows:

- `reddit-response`
- `control-plane-brief`
- `incident-triage`
- `release-readiness`
- `security-audit`
- `summarize-content`
- `system-monitor`
- `content-generate`
- `integration-workflow`
- `normalize-data`
- `market-research`
- `data-extraction`
- `qa-verification`
- `skill-audit`

### Sensitive Tasks

- `build-refactor` is intentionally guarded because it can modify code and run
  tests.
- `agent-deploy` is intentionally guarded because it creates deployable agent
  surfaces.

## Where To Inspect Behavior

- `workspace/orchestrator/src/taskHandlers.ts`: handler implementations
- `workspace/orchestrator/src/middleware/validation.ts`: request schema allowlist
- `workspace/orchestrator/src/approvalGate.ts`: approval logic
- [./api.md](./api.md): API surfaces that trigger or inspect work
