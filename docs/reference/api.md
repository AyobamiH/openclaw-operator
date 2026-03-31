---
title: "API Reference"
summary: "Task handlers, types, and interfaces."
---

# API Reference

Complete reference for task handlers, types, and interfaces used in the orchestrator.

Capability-truth rule:

- all declared non-template agents remain in scope for full-capability uplift
- current route exposure and runtime evidence must stay honest about what is
  already mature versus what is still partial
- when capability, runtime truth, operator exposure, or task-promotion truth
  changes materially, update this reference together with the canonical
  architecture capability pack in the same change set

## Current Operator-Facing Route Contract (Runtime Truth)

Related scope policy:

- see [../architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md](../architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md)
  for the backend-first decision matrix that separates implemented routes/tasks
  from current frontend exposure policy
- see [../architecture/AGENT_CAPABILITY_MODEL.md](../architecture/AGENT_CAPABILITY_MODEL.md)
  for the intended agent-maturity gate that should be satisfied before broad
  task promotion is treated as product truth
- see [../architecture/AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md](../architecture/AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md)
  for the concrete per-agent implementation and promotion gate matrix used to
  sequence that work across the full declared agent set

Documentation maintenance:

- if a route becomes newly operator-facing, newly admin-only, newly
  observe-only, or materially changes its runtime caveats, update this file in
  the same change set
- if a task or route is promoted because an agent matured, reflect that here
  without flattening remaining maturity gaps elsewhere into “fully capable”

Primary private operator console route family:

- `GET /operator` (served by orchestrator runtime)
- `GET /operator/*` (SPA route family for the canonical private
  `operator-s-console` bundle)

Public monitoring/read-only:

- `GET /health`
- `GET /api/persistence/health`
- `GET /api/knowledge/summary`
- `GET /api/openapi.json`

Public proof/read-only:

- `GET /api/command-center/overview`
- `GET /api/command-center/control`
- `GET /api/command-center/demand`
- `GET /api/command-center/demand-live`
- `GET /api/milestones/latest`
- `GET /api/milestones/dead-letter`

Protected operator routes (bearer token):

- `GET /api/auth/me`
- `GET /api/dashboard/overview`
- `GET /api/tasks/catalog`
- `POST /api/tasks/trigger`
- `GET /api/tasks/runs`
- `GET /api/tasks/runs/:runId`
- `POST /api/review-sessions/bootstrap-handoff`
- `GET /api/review-sessions`
- `GET /api/review-sessions/:id`
- `POST /api/review-sessions/:id/bucket`
- `POST /api/review-sessions/:id/note`
- `POST /api/review-sessions/:id/link-run`
- `POST /api/review-sessions/:id/stop`
- `GET /api/review-sessions/:id/export`
- `GET /api/approvals/pending`
- `POST /api/approvals/:id/decision`
- `GET /api/incidents`
- `GET /api/incidents/:id`
- `GET /api/incidents/:id/history`
- `POST /api/incidents/:id/acknowledge`
- `POST /api/incidents/:id/owner`
- `POST /api/incidents/:id/remediate`
- `GET /api/agents/overview`
- `GET /api/skills/registry`
- `GET /api/skills/policy`
- `GET /api/skills/telemetry`
- `GET /api/skills/audit`
- `GET /api/skills/registry` now reflects live governed-skill runtime truth, including executability, executor binding, persistence mode, and provenance snapshot for each intake record.
- `GET /api/memory/recall`
- `GET /api/health/extended`
- `POST /api/knowledge/query`
- `GET /api/knowledge/export`
- `GET /api/persistence/historical`
- `GET /api/persistence/summary`
- `GET /api/persistence/export`

Internal ingest:

- `POST /webhook/alerts` (HMAC signature required)

Boundary reminder:

- the retired proof/community lane is not part of the active local-runtime API
  contract.
- the active public proof surface is now sourced from orchestrator-owned
  public routes rather than `openclawdbot`.

Operator truth reminder:

- this reference describes current route contract truth, not the final agent
  maturity state
- broader operator exposure should follow the same order documented in the
  capability pack: agent maturity first, runtime evidence second, task/route
  promotion third

Mission Control implementation note:

- the larger Mission Control blueprint remains future operator-console work
  only
- this phase adds persistent incidents, incident history/remediation routes,
  deeper workflow graphs, knowledge graphs, topology relationship edges, and
  agent capability readiness inside the existing console rails
- the canonical agent maturity target for these surfaces now lives in
  `docs/architecture/AGENT_CAPABILITY_MODEL.md`
- it does **not** adopt a new global shell, Three.js background, or starfield
  environment yet

Operator Console contract truth:

- `GET /api/health/extended`: authoritative protected operator-health surface.
- `GET /api/dashboard/overview`: protected operator aggregation only. Useful
  for queue, approvals, governance, and recent-task visibility, but not
  authoritative system health.
- `GET /health`: shallow public liveness only. It returns helper URLs for
  metrics, knowledge summary, and persistence health using the request host;
  the metrics helper uses the configured Prometheus port.
- `GET /api/command-center/overview`: public proof overview surface sourced
  directly from orchestrator runtime state.
- `GET /api/command-center/control`: public proof control-cluster surface for
  curated agent/control-lane visibility.
- `GET /api/command-center/demand` and `GET /api/command-center/demand-live`:
  public proof demand summary surfaces sourced from live orchestrator demand
  state.
- `GET /api/milestones/latest` and `GET /api/milestones/dead-letter`: public
  orchestrator milestone feed surfaces for latest visible proof and proof-risk
  items.
- `GET /api/auth/me`: protected auth identity surface.
- `POST /api/review-sessions/bootstrap-handoff`: protected bootstrap seam. The bootstrap helper creates a persisted `pending_handoff` session before startup, then the orchestrator accepts this route only to promote that existing session to `active` after startup ownership is transferred.
- `GET /api/review-sessions` and `GET /api/review-sessions/:id`: protected review-session ledger and detail surfaces.
- `POST /api/review-sessions/:id/bucket`, `POST /api/review-sessions/:id/note`, and `POST /api/review-sessions/:id/link-run`: protected operator mutation routes for active review sessions only.
- `POST /api/review-sessions/:id/stop`: protected terminal transition from `active` to `completed`.
- `GET /api/review-sessions/:id/export`: protected export surface for review-session evidence snapshots.
- `GET /api/persistence/health`: public persistence dependency truth, now
  including first-slice coordination status for Redis-backed claims, locks, and
  shared helper budgets.
- `/system-health`: not a backend route; it is a frontend-only page path.

### Review Session Lifecycle Contract

- Lifecycle states are exactly `pending_handoff`, `active`, `completed`, and `handoff_failed`.
- The bootstrap helper is responsible for creating the persisted `pending_handoff` record before orchestrator startup.
- The orchestrator owns the transition from `pending_handoff` to `active` when `POST /api/review-sessions/bootstrap-handoff` succeeds.
- `completed` and `handoff_failed` are terminal. Review-session note and run-link mutation is allowed only while the session is `active`.
- `POST /api/review-sessions/:id/link-run` validates the provided identifier against canonical task execution truth before storing the linked run.

### Operator Console Rendering Guardrails

Do not render these nested objects directly:

- the `controlPlane` field in `GET /api/health/extended`
- the `controlPlane.queue` field in `GET /api/health/extended`
- the `workers` field in `GET /api/health/extended`
- the `repairs` field in `GET /api/health/extended`
- the `dependencies` field in `GET /api/health/extended`
- the `dependencies.persistence` field in `GET /api/health/extended`
- the `dependencies.knowledge` field in `GET /api/health/extended`
- the `dependencies.github` field in `GET /api/health/extended`
- the `health` field in `GET /api/dashboard/overview`
- the `persistence` field in `GET /api/dashboard/overview`
- the `accounting` field in `GET /api/dashboard/overview`
- the `queue` field in `GET /api/dashboard/overview`
- the `approvals` field in `GET /api/dashboard/overview`
- the `selfHealing` field in `GET /api/dashboard/overview`
- the `governance` field in `GET /api/dashboard/overview`
- the `incidents` field in `GET /api/dashboard/overview`
- the `recentTasks` field in `GET /api/dashboard/overview`
- the `truthLayers` field in `GET /api/health/extended`
- the `incidents` field in `GET /api/health/extended`
- the `topology` field in `GET /api/agents/overview`

Safe leaf fields to render:

- `/api/auth/me`: `actor`, `role`, `apiKeyLabel`, `apiKeyExpiresAt`
- `/api/health/extended`: `status`, `controlPlane.routing`,
  `controlPlane.queue.queued`, `controlPlane.queue.processing`,
  `workers.declaredAgents`, `workers.spawnedWorkerCapableCount`,
  `workers.serviceExpectedCount`,
  `workers.serviceAvailableCount`, `workers.serviceInstalledCount`,
  `workers.serviceRunningCount`, `workers.serviceExpectedGapCount`,
  `workers.serviceOperationalCount` (legacy compatibility alias),
  `repairs.activeCount`,
  `repairs.verifiedCount`, `repairs.failedCount`,
  `dependencies.persistence.status`,
  `dependencies.persistence.database`, `dependencies.persistence.collections`,
  `dependencies.persistence.coordination.status`,
  `dependencies.persistence.coordination.store`,
  `dependencies.persistence.coordination.redisConfigured`,
  `dependencies.persistence.coordination.redisReachable`,
  `dependencies.persistence.coordination.detail`,
  `dependencies.knowledge.indexedEntries`,
  `dependencies.knowledge.conceptCount`,
  `dependencies.github.status`,
  `dependencies.github.summary`,
  `dependencies.github.repository`,
  `dependencies.github.branch`,
  `dependencies.github.latestRun.workflowName`,
  `dependencies.github.latestRun.conclusion`,
  `dependencies.github.latestRun.url`,
  `truthLayers.configured.status`,
  `truthLayers.configured.summary`,
  `truthLayers.observed.status`,
  `truthLayers.observed.summary`,
  `topology.status`,
  `topology.counts.totalNodes`,
  `topology.counts.totalEdges`,
  `topology.counts.relationshipEdges`,
  `topology.relationshipHistory.totalObservations`,
  `topology.relationshipHistory.lastObservedAt`,
  `topology.relationshipHistory.windows.short.totalObservations`,
  `topology.relationshipHistory.windows.long.totalObservations`,
  `topology.relationshipHistory.graph.totalNodes`,
  `topology.relationshipHistory.graph.totalEdges`,
  `topology.hotspots[]`,
  `incidents.overallStatus`,
  `incidents.openCount`,
  `incidents.activeCount`,
  `incidents.bySeverity.critical`,
  `incidents.bySeverity.warning`,
  `incidents.bySeverity.info`
- `/api/dashboard/overview`: `health.fastStartMode`, `queue.queued`,
  `queue.processing`, `queue.pressure[]`,
  `queue.pressure[].type`, `queue.pressure[].label`,
  `queue.pressure[].source`, `queue.pressure[].queuedCount`,
  `queue.pressure[].processingCount`, `queue.pressure[].totalCount`,
  `approvals.pendingCount`,
  `selfHealing.summary.totalCount`, `selfHealing.summary.activeCount`,
  `selfHealing.summary.verifiedCount`, governance count fields,
  `accounting.totalCostUsd`, `accounting.currentBudget`,
  `incidents.overallStatus`,
  `incidents.openCount`,
  `incidents.activeCount`,
  `incidents.watchingCount`,
  `incidents.bySeverity.critical`,
  `incidents.bySeverity.warning`,
  `incidents.bySeverity.info`,
  `incidents.topClassifications[]`,
  `incidents.topClassifications[].classification`,
  `incidents.topClassifications[].label`,
  `incidents.topClassifications[].count`,
  `incidents.topClassifications[].activeCount`,
  `incidents.topClassifications[].watchingCount`,
  `incidents.topClassifications[].highestSeverity`,
  `recentTasks[]`,
- `/api/agents/overview`: `agents[].id`, `agents[].orchestratorTask`,
  `agents[].spawnedWorkerCapable`, `agents[].serviceExpected`,
  `agents[].lifecycleMode`, `agents[].hostServiceStatus`,
  `agents[].serviceUnitName`, `agents[].serviceAvailable`,
  `agents[].serviceInstalled`, `agents[].serviceRunning`,
  `agents[].serviceUnitState`, `agents[].serviceUnitSubState`,
  `agents[].serviceUnitFileState`, `agents[].capability.currentReadiness`,
  `agents[].memory.totalRuns`, `agents[].memory.lastRunAt`
  `incidents.incidents[].linkedRunIds[]`,
  `incidents.incidents[].linkedRepairIds[]`,
  `incidents.incidents[].linkedProofDeliveries[]`,
  `incidents.incidents[].recommendedSteps[]`,
  `incidents.incidents[].policy.policyId`,
  `incidents.incidents[].policy.autoRetryBlockedRemediation`,
  `incidents.incidents[].policy.maxAutoRemediationAttempts`,
  `incidents.incidents[].policy.autoEscalateOnBreach`,
  `incidents.incidents[].policy.remediationTaskType`,
  `incidents.incidents[].policy.verifierTaskType`,
  `incidents.incidents[].policy.escalationTaskType`,
  `incidents.incidents[].policy.targetSlaMinutes`,
  `incidents.incidents[].escalation.level`,
  `incidents.incidents[].escalation.summary`,
  `incidents.incidents[].escalation.dueAt`,
  `incidents.incidents[].verification.required`,
  `incidents.incidents[].verification.status`,
  `incidents.incidents[].verification.summary`,
  `incidents.incidents[].remediation.status`,
  `incidents.incidents[].remediation.owner`,
  `incidents.incidents[].remediation.nextAction`,
  `incidents.incidents[].remediation.blockers[]`,
  `incidents.incidents[].remediationPlan[]`,
  `incidents.incidents[].policyExecutions[]`,
  `recentTasks[].handledAt`, `recentTasks[].type`, `recentTasks[].result`,
  `recentTasks[].message`
  Approval payloads can now include review-gated Reddit lead promotions:
  `manual-review` leads require explicit approval, and the top `10` `draft`
  leads can be optionally promoted into `reddit-response` through the same
  replay surface.
- `/api/tasks/runs` and `/api/tasks/runs/:runId`: `repair.repairId`,
  `repair.classification`, `repair.status`, `repair.verificationMode`,
  `repair.verificationSummary`, `workflow.stage`, `workflow.graphStatus`,
  `workflow.currentStage`, `workflow.blockedStage`, `workflow.stopReason`,
  `workflow.stopClassification`,
  `workflow.awaitingApproval`, `workflow.retryScheduled`,
  `workflow.nextRetryAt`, `workflow.repairStatus`, `workflow.eventCount`,
  `workflow.stageDurations`, `workflow.timingBreakdown`,
  `workflow.nodeCount`, `workflow.edgeCount`,
  `workflowGraph.causalLinks[]`,
  `workflowGraph.crossRunLinks[]`,
  `workflowGraph.relatedRuns[]`,
  `workflowGraph.dependencySummary`,
  `approval.required`, `approval.status`, `approval.requestedAt`,
  `approval.decidedAt`, `events[]`, `proofLinks[]`, and
  `workflowGraph.{nodes,edges,events,proofLinks,stopClassification,timingBreakdown}`
  plus `workflowGraph.{crossRunLinks,relatedRuns,dependencySummary}` when
  present
- `/api/incidents` and `/api/incidents/:id`: stable incident IDs,
  first/last-seen timestamps, acknowledgement state, owner,
  `history[]`, `policyExecutions[]`, `acknowledgements[]`, `ownershipHistory[]`,
  `remediationTasks[]`, linked service/task/run/proof references, and
  current remediation guidance, policy, escalation, verification, and
  remediation plan state
- `/api/incidents/:id/history`: isolated incident history stream with
  `history[]`, `acknowledgements[]`, `ownershipHistory[]`, and remediation
  task lifecycle records including assignment/execution/verification/resolution
- `/api/knowledge/summary` and `/api/knowledge/query`: provenance,
  contradiction, and freshness graphs plus `runtime.repairLoop` /
  `meta.repairLoop` for knowledge-repair posture
- `/api/agents/overview`: relationship history windows, observed relationship
  graph, target capability set, and evidence profiles showing how close an
  agent is to the capability target
  timestamps
- `/api/approvals/pending`: `impact.riskLevel`, `impact.approvalReason`,
  `impact.dependencyClass`, `impact.affectedSurfaces`,
  `impact.dependencyRequirements`, `impact.caveats`,
  `payloadPreview.keyCount`, `payloadPreview.keys`,
  `payloadPreview.internalKeyCount`
- `/api/knowledge/summary`: `diagnostics.freshness`,
  `diagnostics.provenance`, `diagnostics.contradictionSignals`,
  `diagnostics.graphs.{provenance,contradictions,freshness}`,
  `runtime.index`, `runtime.coverage`, `runtime.freshness`,
  `runtime.signals.coverage`, `runtime.signals.staleness`,
  `runtime.signals.contradictions`,
  `runtime.graphs.{provenance,contradictions,freshness}`
- `/api/knowledge/query`: top-level `meta` (query-scoped freshness,
  provenance, contradiction signals, and knowledge graphs) and `runtime`
  (repo/runtime knowledge signals and knowledge graphs)
- `/api/agents/overview`: `modelTier`, `allowedSkills[]`,
  `capability.role`, `capability.spine`, `capability.currentReadiness`,
  `capability.targetCapabilities[]`, `capability.evidence[]`,
  `capability.presentCapabilities[]`, `capability.missingCapabilities[]`,
  `capability.evidenceProfiles[]`,
  `capability.runtimeEvidence.latestSuccessfulRunId`,
  `capability.runtimeEvidence.latestSuccessfulTaskId`,
  `capability.runtimeEvidence.latestHandledAt`,
  `capability.runtimeEvidence.highlightKeys[]`,
  `capability.runtimeEvidence.signals[]`, `capability.ultraGapSummary`,
  `topology.edges[].relationship`,
  `relationshipHistory.totalObservations`,
  `relationshipHistory.lastObservedAt`,
  `relationshipHistory.byRelationship`,
  `relationshipHistory.byStatus`,
  `relationshipHistory.timeline[]`,
  `relationshipHistory.recent[]`
- `/api/agents/overview`: `skill-audit-agent` now promotes governed-skill
  trust-state signals through `capability.runtimeEvidence.signals[]`
  (`trustPosture`, `policyHandoff`, `telemetryHandoff`,
  `intakeCoverage`, `restartSafetySummary`) and a `governance-depth`
  evidence profile.
- `GET /api/tasks/runs` and `GET /api/tasks/runs/:runId` now preserve the
  shared specialist-agent result contract for adapted lanes, including
  `operatorSummary`, `recommendedNextActions[]`, and
  `specialistContract.{role,workflowStage,deliverable,status,refusalReason,escalationReason}`
  when the owning agent emits them.
- `/health`: `status`, `timestamp`

Auth persistence requirement:

- External operator-console frontends must persist the bearer token across
  preview/auth-bridge redirects. In-memory-only token state is not reliable for
  protected fetch flows when the hosting shell can redirect before protected
  route calls complete.

Operational worker-proof workflow used in the `2026-03-07` spawned-worker sweep:

- `POST /api/tasks/trigger`
- `GET /api/tasks/runs` or `GET /api/tasks/runs/:runId`
- `GET /api/skills/audit` (ToolGate preflight / execute evidence where present)
- `GET /api/memory/recall?agentId=...`

Run identity contract:

- `runId` reuses `payload.idempotencyKey` only when the caller supplies one
- otherwise the task id becomes the run id, so normal trigger calls stay
  visible as distinct entries in `/api/tasks/runs`

Interpretation note from the `2026-03-07` repair follow-up:

- `GET /api/dashboard/overview` now exposes bounded repair evidence under the
  `selfHealing` field, and `GET /api/health/extended` exposes the parallel
  repair summary under `repairs`, for the live
  `doc-drift -> drift-repair -> knowledge-pack verification` loop.
- `GET /api/dashboard/overview` is intentionally lean and now returns the
  summary fields used by the Overview page only. Incident detail, agent
  topology, memory drill-down, and truth-layer detail stay on their dedicated
  routes so the overview surface remains fast on large ledgers.
- `GET /api/tasks/runs` and `GET /api/tasks/runs/:runId` now include `repair`
  metadata when a task run belongs to a tracked repair attempt.
- `GET /api/tasks/runs` and `GET /api/tasks/runs/:runId` now also expose
  `workflow`, `approval`, and ordered `events[]` so frontends can render run
  replay state from real queue/approval/retry/repair evidence instead of
  inventing it client-side.
- `GET /api/tasks/runs` and `GET /api/tasks/runs/:runId` now also expose
  `proofLinks[]` and canonical `workflowGraph` payloads so the operator console
  can show where execution stopped across ingress, queue, approval, agent,
  result, and public-proof publication.
- Those `proofLinks[]` records are now derived from canonical proof workflow
  events, proof relationship observations, and linked incidents, so run detail
  can show concrete proof ids, type, status, target, summary, and last-attempt
  time.
- `GET /api/tasks/runs` and `GET /api/tasks/runs/:runId` now also expose
  `workflowGraph.crossRunLinks[]`, `workflowGraph.relatedRuns[]`, and
  `workflowGraph.dependencySummary` so consumers can inspect upstream/downstream
  remediation handoffs and run dependencies instead of inferring them from
  stage events alone.
- `GET /api/tasks/runs` and `GET /api/tasks/runs/:runId` now also expose
  bounded `resultSummary` payloads with top-level agent result keys plus
  sanitized `highlights` for promoted capability fields such as
  `queueBudgetFusion`, `routingDecision`, `acceptanceCoverage`, and
  `comparisonReadiness`, so operator surfaces can render real worker output
  contracts without shipping full raw agent artifacts through the API.
- `GET /api/tasks/runs` and `GET /api/tasks/runs/:runId` now also expose
  deterministic execution accounting: `model`, `cost`, `latency`, `usage`,
  `budget`, and `accounting`. Local-only runs report `cost=0` with an explicit
  unmetered note; metered helper runs can attach provider model and token-based
  spend when the worker reports usage.
- `GET /api/approvals/pending` now includes `impact` and `payloadPreview`
  metadata so approval review UIs can surface risk, affected surfaces, and
  replay semantics without reconstructing those fields on the client.
- `GET /api/agents/overview` now exposes `serviceExpected`,
  `lifecycleMode`, and `hostServiceStatus` so operator clients can tell the
  difference between service-expected agents and worker-first agents without
  inferring that contract from booleans alone. `serviceUnitName` is also
  returned as the canonical host hint for systemd-backed troubleshooting.
- `GET /api/agents/overview` also exposes `serviceAvailable` separately from
  `serviceInstalled` and `serviceRunning`. The older
  `serviceImplementation` and `serviceOperational` fields remain compatibility
  aliases and should not be treated as stronger truth than the explicit split
  fields. `serviceRunning=false` is valid host truth when the unit is absent or
  inactive; `null` is reserved for probe-unavailable cases. Per-agent host
  hints now also include `serviceUnitState`, `serviceUnitSubState`, and
  `serviceUnitFileState`.
- `GET /api/health/extended` now exposes aggregate service-mode truth as
  `workers.serviceExpectedCount` and `workers.serviceExpectedGapCount`, and the
  parallel `truthLayers.observed.serviceMode` block distinguishes service-mode
  expectations from raw service entrypoint presence. This keeps worker-only
  agents from being mistaken for unmet service installs.
- `GET /api/dashboard/overview` now also exposes an `accounting` block with
  aggregate spend, metered/unmetered run counts, token totals, average
  latency, per-model rollups, and the latest Reddit-helper budget posture when
  that helper has emitted a budget snapshot.
- `POST /api/incidents/:id/acknowledge` and `POST /api/incidents/:id/owner`
  now mutate the persistent incident ledger. Incident payloads returned by
  overview and extended health retain stable IDs, first/last seen timestamps,
  acknowledgement state, owner, linked service/task/run/proof references, and
  remediation steps.
- `GET /api/incidents` and `GET /api/incidents/:id` now expose incident list and
  detail views from the persistent ledger. The detail route materializes the
  current incident plus embedded lifecycle arrays including acknowledgement
  history, explicit ownership lifecycle history, policy execution history, and
  linked remediation task records.
- `GET /api/incidents/:id/history` now provides the incident lifecycle stream as
  a dedicated route for consumers that only need lifecycle progression
  (`history`, `acknowledgements`, `ownershipHistory`, `policyExecutions`, and
  remediation task status) without relying on the broader materialized incident
  detail payload.
- `POST /api/incidents/:id/remediate` now creates a linked remediation task
  using an allowlisted remediation mapping (`drift-repair`, `build-refactor`,
  `qa-verification`, or `system-monitor`) and persists that linkage back into
  the incident ledger.
- Manual `build-refactor` incident remediation now carries approval-bounded
  code-remediation payloads with verifier-linked constraints so code surgery
  can enter the incident/remediation/verifier loop without bypassing approval
  gates.
- Incident remediation policy is now operational rather than descriptive:
  policy records include automatic retry / escalation controls, and
  `policyExecutions[]` captures when the orchestrator automatically assigned an
  owner, queued a primary remediation lane, retried a blocked remediation,
  queued a verifier lane, or escalated a breached incident.
- `GET /api/agents/overview` now also exposes capability readiness derived from
  real runtime evidence. It distinguishes declared/foundation/operational/
  advanced readiness and reports remaining capability gaps instead of labeling
  agents “ultra” prematurely.
- `GET /api/agents/overview` now also exposes `capability.runtimeEvidence`, a
  bounded latest-successful-run view that promotes agent-specific readiness
  signals into the capability surface. Wave 1 examples include
  `taskSpecificKnowledge`, `entityFreshnessLedger`, `contradictionGraph`,
  `partialCompletion`, `dependencyPlan`, `workflowMemory`,
  `queueBudgetFusion`, `operatorClosureEvidence`, `trendSummary`,
  `regressionReview`, `exploitabilityRanking`, `remediationClosure`,
  `acceptanceCoverage`, `closureContract`, and `reproducibilityProfile`.
  Wave 2 examples now include `providerPosture`, `publicationPolicy`,
  `operationalCompression`, `artifactCoverage`, `comparisonReadiness`, and
  `deltaCapture`. Wave 3 examples now include `scopeContract`,
  `surgeryProfile`, `verificationLoop`, `impactEnvelope`, `refusalProfile`,
  `trustPosture`, `policyHandoff`, `telemetryHandoff`, `intakeCoverage`, and
  `restartSafetySummary`.
- Those Wave 2 readiness signals now correspond to durable runtime artifacts in
  the underlying agent contracts, not just summary hints. Current examples
  include systematic community routing from `reddit-helper`, evidence-attached
  publishing schema from `content-agent`, replay artifacts from
  `summarization-agent`, uniform artifact records from `data-extraction-agent`,
  explainable schema/dedupe decisions from `normalization-agent`, and durable
  internal signal packs from `market-research-agent`.
- Those Wave 3 readiness signals now correspond to governed code and skill
  runtime artifacts rather than hidden worker-only metadata. Current examples
  include bounded code-surgery contracts plus verifier handoff posture from
  `build-refactor-agent`, and governed-skill trust-state depth from
  `skill-audit-agent`.
- `GET /api/agents/overview` now also exposes `topology`, a derived graph of
  `orchestrator -> task -> agent -> skill` relationships plus bounded
  `agent -> agent` relationship edges (`feeds-agent`, `verifies-agent`,
  `monitors-agent`, `audits-agent`, `coordinates-agent`). This is derived from
  manifests, task/skill contracts, declared ultra-agent roles, and current
  runtime evidence.
- `GET /api/agents/overview` now also exposes `relationshipHistory`, a bounded
  history view of observed delegation, tool-use, verification, and monitoring
  edges over time. `topology` remains the current graph shape;
  `relationshipHistory` preserves the underlying observed events and their
  hourly aggregation window for operator replay.
- `GET /api/health/extended` exposes `truthLayers` so frontends can distinguish
  declared control-plane intent, current runtime configuration, and observed
  operator state without inventing those distinctions client-side.
- `GET /api/dashboard/overview` and `GET /api/health/extended` both expose
  runtime-governed `incidents` summaries refreshed from persistence, repairs,
  retry recovery, agent service gaps, approval backlog, and knowledge
  freshness/contradiction signals. Full incident detail remains on
  `GET /api/incidents` and `GET /api/incidents/:id`.
- `GET /api/knowledge/summary` and `POST /api/knowledge/query` now expose
  knowledge freshness, provenance, contradiction signals, and runtime
  coverage/staleness signals. They now also expose first-class provenance,
  contradiction, and freshness graphs so consumers can reason over topology and
  drift rather than just scalar signals. These are deterministic diagnostics
  based on the current knowledge base and indexed doc/runtime state; they are
  not speculative AI summaries.

The route contract above is authoritative for operator-console integration.
Generic handler/type sketches lower in this file are legacy orientation only;
runtime code wins if those examples diverge.

## Machine-Readable Contract

- `GET /api/openapi.json` is the machine-readable companion to this document.
- It now covers the active public proof routes and the protected operator route
  families, including request bodies, query/path parameters, success/error
  response schemas, security schemes, and response headers that matter to real
  clients.
- Protected operations also carry explicit role and limiter metadata in the
  `x-openclaw-access` extension so RBAC and bucket policy stay attached to the
  route contract instead of being implied only by prose.
- Current supporting clients (`operator-s-console/src/lib/api.ts`) are aligned
  to those same authoritative routes, and `operator-s-console/` is the
  canonical tracked `/operator` client in this repo.

## CORS Contract (Direct Frontend Integration)

- CORS policy is backend-owned and deny-by-default.
- Cross-origin requests from origins not on the allowlist are rejected (`403`).
- No wildcard origin (`*`) policy is used.
- Required header for protected routes:
  `Authorization: Bearer <token>`.
- Default preflight-allowed methods: `GET, POST` (+ `OPTIONS` handling).
- Default preflight-allowed request headers:
  `Authorization, Content-Type`.
- Default exposed response headers:
  `X-Request-Id, X-API-Key-Expires, ratelimit-limit, ratelimit-remaining, ratelimit-reset, Retry-After`.
- Credentials are disabled by default (`corsAllowCredentials=false`) unless
  explicitly enabled.

Configuration keys (JSON config or env override):

- `corsAllowedOrigins` / `ORCHESTRATOR_CORS_ALLOWED_ORIGINS`
- `corsAllowedMethods` / `ORCHESTRATOR_CORS_ALLOWED_METHODS`
- `corsAllowedHeaders` / `ORCHESTRATOR_CORS_ALLOWED_HEADERS`
- `corsExposedHeaders` / `ORCHESTRATOR_CORS_EXPOSED_HEADERS`
- `corsAllowCredentials` / `ORCHESTRATOR_CORS_ALLOW_CREDENTIALS`
- `corsMaxAgeSeconds` / `ORCHESTRATOR_CORS_MAX_AGE_SECONDS`

## Response Cache Contract

The orchestrator now uses a bounded response cache for repeated read-heavy API
surfaces.

Runtime truth:

- If `REDIS_URL` is reachable, cached responses are stored in Redis.
- If Redis is unavailable or not configured, the orchestrator falls back to a
  bounded in-memory cache instead of failing startup.
- Cache invalidation is tag-based and tied to orchestrator runtime state
  writes. Knowledge surfaces are invalidated separately from broader runtime
  state.

Operator-visible headers:

- `X-OpenClaw-Cache: hit|miss`
- `X-OpenClaw-Cache-Store: redis|memory`
- `Cache-Control: public|max-age=*` for public cached reads
- `Cache-Control: private|max-age=*` plus `Vary: Authorization` for protected
  cached reads

Current cached read surfaces:

- Public:
  - `GET /api/knowledge/summary`
  - `GET /api/openapi.json`
  - `GET /api/persistence/health`
- Protected:
  - `GET /api/tasks/catalog`
  - `GET /api/approvals/pending`
  - `GET /api/incidents`
  - `GET /api/incidents/:id`
  - `GET /api/incidents/:id/history`
  - `GET /api/dashboard/overview`
  - `GET /api/agents/overview`
  - `GET /api/memory/recall`
  - `POST /api/knowledge/query`
  - `GET /api/tasks/runs`
  - `GET /api/tasks/runs/:runId`
  - `GET /api/skills/registry`
  - `GET /api/skills/policy`
  - `GET /api/skills/telemetry`
  - `GET /api/skills/audit`
  - `GET /api/health/extended`
  - `GET /api/persistence/summary`

The response cache is intended to reduce repeated operator-console fetch cost
for identical route/query/body/auth combinations over short windows. It is not
a claim of browser-side offline caching or immutable API payloads.

## Rate Limits And 429 Handling

Current runtime limiter policy:

- Public monitoring endpoints:
  - `/health`: `1000 requests / 60s / IP`
  - `/api/persistence/health`: `1000 requests / 60s / IP`
- Public read endpoints:
  - `/api/knowledge/summary`, `/api/openapi.json`:
    `30 requests / 60s / IP`
- Protected endpoints:
  - pre-auth abuse guard: `300 requests / 60s / IP`
  - bucket A (`viewer-read`): `120 requests / 60s` per authenticated actor/key
    label for protected read routes (`GET` visibility endpoints including
    `/api/skills/audit`, `/api/health/extended`, `/api/persistence/summary`)
  - bucket B (`operator-write`): `30 requests / 60s` per authenticated
    actor/key label for protected write routes
    (`POST /api/tasks/trigger`, `POST /api/approvals/:id/decision`,
    `POST /api/knowledge/query`)
  - bucket C (`admin-export`): `10 requests / 60s` per authenticated
    actor/key label for admin export routes
    (`GET /api/knowledge/export`, `GET /api/persistence/export`)
  - authenticated bucket key precedence:
    `req.auth.actor` -> `req.auth.apiKeyLabel[:version]` -> IP fallback

Client contract:

- Treat `429` as expected flow-control, not a fatal API outage.
- On `429`, respect `Retry-After` first.
- If `Retry-After` is absent, use `ratelimit-reset` as the minimum wait.
- Normal operator-console polling is supported by bucket A, but avoid
  synchronized parallel bursts; stagger polling intervals with jitter.

---

## Task Handler Interface

All task handlers follow this signature:

```typescript
async function taskHandler(
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<TaskResult>
```

Where:

- **`state`** (`OrchestratorState`): Current system state
- **`config`** (`OrchestratorConfig`): Loaded configuration
- **Returns**: `TaskResult` with status, result, and optional error

### Example Handler

```typescript
async function myTaskHandler(
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<TaskResult> {
  const startTime = Date.now();
  
  try {
    // Do work
    const result = {
      itemsProcessed: 42,
      success: true
    };
    
    return {
      status: 'completed',
      result,
      durationMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      status: 'error',
      error: String(error),
      durationMs: Date.now() - startTime
    };
  }
}
```

---

## Core Types

### OrchestratorState

```typescript
interface OrchestratorState {
  lastStartedAt: string;              // ISO 8601
  tasksProcessed: number;             // Total count
  taskHistory: TaskRecord[];          // Last 50
  docsIndexed: string[];              // File paths
  redditResponses: RedditRecord[];    // Last 100
  rssDrafts: RSSRecord[];             // Last 200
  deployedAgents: DeploymentRecord[]; // This session
  notes?: string;                     // User notes
}
```

### TaskRecord

```typescript
interface TaskRecord {
  type: string;
  status: 'pending' | 'completed' | 'error';
  timestamp: string;                  // ISO 8601
  durationMs: number;                 // Milliseconds
  result?: any;                       // Task-specific
  error?: string;                     // Error message
}
```

### TaskResult

```typescript
interface TaskResult {
  status: 'pending' | 'completed' | 'error';
  result?: any;                       // Task-specific output
  error?: string;                     // Error message if status="error"
  durationMs?: number;                // How long took
}
```

### OrchestratorConfig

```typescript
interface OrchestratorConfig {
  docsPath: string;                   // Path to docs
  logsDir: string;                    // Where to write logs
  stateFile: string;                  // Where to persist state
  deployBaseDir?: string;             // Where agents deploy
  rssConfigPath?: string;             // RSS filter config
  redditDraftsPath?: string;          // Reddit drafts log
  knowledgePackDir?: string;          // Knowledge pack dir
  notes?: string;                     // Custom notes
}
```

### RedditRecord

```typescript
interface RedditRecord {
  timestamp: string;                  // ISO 8601
  postId: string;                     // Reddit ID
  postTitle: string;                  // Post title
  subreddit: string;                  // Subreddit name
  draftResponse: string;              // Proposed response
  confidence: number;                 // 0-1 score
  approved?: boolean;                 // Human approval
  posted?: string;                    // When posted (ISO 8601)
}
```

### RSSRecord

```typescript
interface RSSRecord {
  timestamp: string;                  // ISO 8601
  feedUrl: string;                    // Feed URL
  itemTitle: string;                  // Item title
  itemUrl: string;                    // Item link
  publishedAt: string;                // ISO 8601
  relevanceScore: number;             // 0-100
  urgency: 'high' | 'medium' | 'low';
  notes?: string;                     // Summary/reason
}
```

### DeploymentRecord

```typescript
interface DeploymentRecord {
  timestamp: string;                  // ISO 8601
  agentName: string;                  // Template name
  deployPath: string;                 // Deployment path
  metadata?: {
    version?: string;
    tags?: string[];
    config?: any;
  };
}
```

---

## Built-in Task Handlers

### startupHandler()

```typescript
async function startupHandler(
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<TaskResult>
```

**What it does**: Initialize orchestrator, load config, build doc index

**Result structure**:
```json
{
  "configLoaded": true,
  "docsIndexed": 42,
  "stateInitialized": true
}
```

**Spawns agents**: No

---

### docSyncHandler()

```typescript
async function docSyncHandler(
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<TaskResult>
```

**What it does**: Check for doc changes, regenerate knowledge pack if needed

**Result structure**:
```json
{
  "filesIndexed": 42,
  "changeDetected": true,
  "knowledgePackGenerated": true
}
```

**Spawns agents**: Yes (`doc-specialist` if changes detected)

---

### drift-repairHandler()

```typescript
async function driftRepairHandler(
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<TaskResult>
```

**What it does**: Full audit of docs, regenerate knowledge pack

**Result structure**:
```json
{
  "filesAudited": 42,
  "driftDetected": false,
  "knowledgePackRegenerated": true,
  "agentAuditResult": { ... }
}
```

**Spawns agents**: Yes (`doc-specialist`)

---

### redditResponseHandler()

```typescript
async function redditResponseHandler(
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<TaskResult>
```

**What it does**: Monitor Reddit, draft responses using knowledge pack

**Result structure**:
```json
{
  "postsEvaluated": 12,
  "draftedResponses": 3,
  "draftsLogPath": "logs/reddit-drafts.jsonl",
  "agentResult": { ... }
}
```

**Spawns agents**: Yes (`reddit-helper`)

---

### rssSweepHandler()

```typescript
async function rssSweepHandler(
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<TaskResult>
```

**What it does**: Parse RSS feeds, score/filter, generate drafts

**Result structure**:
```json
{
  "feedsParsed": 3,
  "entriesParsed": 127,
  "entriesScored": 127,
  "highPriorityItemsCount": 5,
  "draftsLogPath": "logs/rss-drafts.jsonl"
}
```

**Spawns agents**: No

---

### heartbeatHandler()

```typescript
async function heartbeatHandler(
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<TaskResult>
```

**What it does**: Health check, collect diagnostics

**Result structure**:
```json
{
  "uptime": 3600000,
  "memoryUsageMb": 127,
  "taskQueueDepth": 2,
  "healthStatus": "ok"
}
```

**Spawns agents**: No

---

### agentDeployHandler()

```typescript
async function agentDeployHandler(
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<TaskResult>
```

**What it does**: Deploy template agent to deploy directory

**Result structure**:
```json
{
  "agentName": "doc-specialist",
  "deployPath": "agents-deployed/doc-specialist-1705416768123",
  "deploymentMetadata": { ... }
}
```

**Spawns agents**: No (creates copy)

---

## Agent Spawning

When a handler needs to spawn an agent:

```typescript
import { spawn } from 'child_process';

const result = spawn('tsx', [
  'src/index.ts',
  '--payload', '/tmp/payload-123.json'
], {
  cwd: '/path/to/agent',
  stdio: ['pipe', 'pipe', 'inherit']  // ignore stdin, capture stdout, inherit stderr
});

// Collect stdout (agent output)
const chunks = [];
result.stdout.on('data', chunk => chunks.push(chunk));

// Wait for completion
result.on('close', (code) => {
  const output = Buffer.concat(chunks).toString();
  const agentResult = JSON.parse(output);
  // ... handle agentResult
});
```

The orchestrator passes task context via JSON file in `--payload` argument.

---

## Utility Functions

### State Persistence

```typescript
// Load state from file
const state = await loadState(config.stateFile);

// Save state to file
await saveState(state, config.stateFile);
```

### Documentation Indexing

```typescript
// Watch docs directory and emit changes
const indexer = new DocIndexer(config.docsPath);

indexer.on('fileChanged', (path) => {
  console.log(`Doc changed: ${path}`);
  // Trigger doc-sync or doc-change task
});

// Get current index
const docs = indexer.getIndexedDocs();
```

### Task Queue

```typescript
// Add task to queue
queue.add({
  type: 'heartbeat',
  priority: 'normal'
});

// Listen for completions
queue.on('completed', (task, result) => {
  console.log(`Task ${task.type} completed`);
});

// Listen for errors
queue.on('error', (task, error) => {
  console.error(`Task ${task.type} failed: ${error}`);
});
```

---

## Error Handling

All task handlers should wrap their work in try-catch:

```typescript
try {
  // Do work
  const result = await doSomething();
  return { status: 'completed', result };
} catch (error) {
  return {
    status: 'error',
    error: error instanceof Error ? error.message : String(error)
  };
}
```

Errors are logged and recorded in state history. The orchestrator continues running (doesn't crash).

---

## Custom Task Handler Template

```typescript
// In taskHandlers.ts

export async function myCustomHandler(
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<TaskResult> {
  const startTime = Date.now();
  
  try {
    // Validate config
    if (!config.myCustomField) {
      throw new Error('Missing myCustomField in config');
    }
    
    // Do work
    const result = {
      itemsProcessed: 0,
      successCount: 0
    };
    
    // Optional: spawn agent
    // const agentResult = await spawnAgent(...);
    // result.agentResult = agentResult;
    
    // Update state
    state.taskHistory.push({
      type: 'my-custom-task',
      status: 'completed',
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      result
    });
    
    return { status: 'completed', result };
  } catch (error) {
    return {
      status: 'error',
      error: String(error),
      durationMs: Date.now() - startTime
    };
  }
}

// Register in handlers map
export const handlers: Record<string, TaskHandler> = {
  startup: startupHandler,
  'doc-sync': docSyncHandler,
  'my-custom-task': myCustomHandler,  // ← Add here
  // ... other handlers
};
```

Then add schedule in `index.ts`:

```typescript
setInterval(async () => {
  queue.add({
    type: 'my-custom-task'
  });
}, 1000 * 60 * 10); // Every 10 minutes
```

---

See [Task Types](./task-types.md) for detailed task descriptions.
