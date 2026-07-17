---
title: "Documentation Index"
summary: "Authoritative map of active first-party documentation."
---

# Documentation Index

This is the authoritative file map for the first-party OpenClaw workspace docs.

If a doc is not listed here as active, do not assume it is canonical. Check the
audit register first.

Anti-drift rule:

- when code or config changes materially, update the appropriate existing
  canonical `.md` file in the same change set and reference the relevant paths
  where useful

Capability-truth rule:

- all declared non-template agents remain in scope for full capability uplift
- do not let current partial runtime truth silently become the documented end
  state
- when agent capability, task promotion, service truth, or operator exposure
  changes, review the full canonical capability pack, not only the single file
  you touched

Direction rule:

- OpenClaw itself is the primary front door
- do not create new generic shell-roadmap docs here unless runtime code already
  proves a unique orchestrator-specific need
- treat `/operator` and `operator-s-console` as specialist surfaces, not the
  default product center

## Authority Order

Use this order when determining documentation truth:

1. active runtime code and live config
2. canonical anchors (`../OPENCLAW_CONTEXT_ANCHOR.md`, `../README.md`, this index, current KB truth docs)
3. supporting docs and runbooks
4. historical or snapshot docs

If a supporting or historical document conflicts with runtime code, it is not canonical.

## Canonical Navigation

| File | Purpose |
|---|---|
| [README.md](./README.md) | docs entrypoint |
| [NAVIGATION.md](./NAVIGATION.md) | role-based routes |
| [SUMMARY.md](./SUMMARY.md) | current docs status summary |
| [operations/DOCUMENT_AUDIT.md](./operations/DOCUMENT_AUDIT.md) | canonical vs historical classification |

## Runtime And Operations

| File | Purpose |
|---|---|
| [OPERATOR_GUIDE.md](./OPERATOR_GUIDE.md) | operator-facing runtime behavior |
| [GOVERNANCE_REPO_HYGIENE.md](./GOVERNANCE_REPO_HYGIENE.md) | cleanup and protection policy |
| [operations/KNOWLEDGE_MIRROR_POLICY.md](./operations/KNOWLEDGE_MIRROR_POLICY.md) | policy for mirrored upstream knowledge sources |
| [operations/public-release.md](./operations/public-release.md) | sanitized public mirror workflow |
| [operations/SPRINT_TO_COMPLETION.md](./operations/SPRINT_TO_COMPLETION.md) | Orchestrator-first Sprint To Completion subordinate execution tracker for the root anchor |
| [operations/deployment.md](./operations/deployment.md) | production operations checklist |
| [operations/backup-recovery.md](./operations/backup-recovery.md) | recovery guidance |
| [operations/operator-sqlite-cutover-2026-07-16.md](./operations/operator-sqlite-cutover-2026-07-16.md) | normalized SQLite host cutover evidence and rollback window |
| [operations/startup-reconciliation-audit-2026-07-16.md](./operations/startup-reconciliation-audit-2026-07-16.md) | read-only integrity audit and no-replay decision for the 732 startup-reconciled executions |

## Guides

| File | Purpose |
|---|---|
| [guides/configuration.md](./guides/configuration.md) | `orchestrator_config.json` and env settings |
| [guides/running-agents.md](./guides/running-agents.md) | agent execution guidance |
| [guides/monitoring.md](./guides/monitoring.md) | monitoring and health checks |
| [guides/adding-tasks.md](./guides/adding-tasks.md) | extending the task surface |

## Technical References

| File | Purpose |
|---|---|
| [concepts/architecture.md](./concepts/architecture.md) | technical system explanation |
| [architecture/AGENT_CAPABILITY_MODEL.md](./architecture/AGENT_CAPABILITY_MODEL.md) | target maturity model for agent capability and promotion gating |
| [architecture/AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md](./architecture/AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md) | concrete per-agent implementation and promotion matrix for the full declared agent set |
| [architecture/AGENT_ADAPTATION_PLAN.md](./architecture/AGENT_ADAPTATION_PLAN.md) | implementation-ready adaptation plan for strengthening the current agent portfolio using proven role patterns without changing the current runtime architecture |
| [architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md](./architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md) | current runtime/operator exposure matrix for routes, tasks, and agents |
| [architecture/DOCUMENTATION_SITE_INFORMATION_ARCHITECTURE.md](./architecture/DOCUMENTATION_SITE_INFORMATION_ARCHITECTURE.md) | published docs-site structure and downstream publishing model |
| [reference/api.md](./reference/api.md) | API and code-facing reference |
| [reference/task-types.md](./reference/task-types.md) | task allowlist reference |
| [reference/state-schema.md](./reference/state-schema.md) | runtime state summary |
| [WEBHOOK_SIGNING_CONTRACT.md](./WEBHOOK_SIGNING_CONTRACT.md) | webhook HMAC contract |

## Mandatory Working Sets

Use the smallest relevant pack below before making material changes.

### Agent Capability / Task Promotion

Read in this order:

1. [../OPENCLAW_CONTEXT_ANCHOR.md](../OPENCLAW_CONTEXT_ANCHOR.md)
2. [architecture/AGENT_CAPABILITY_MODEL.md](./architecture/AGENT_CAPABILITY_MODEL.md)
3. [architecture/AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md](./architecture/AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md)
4. [architecture/AGENT_ADAPTATION_PLAN.md](./architecture/AGENT_ADAPTATION_PLAN.md) when the work is specifically about adapting proven external role patterns into the current agent set without adding new task lanes
5. [architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md](./architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md)
6. [reference/task-types.md](./reference/task-types.md)
7. [reference/api.md](./reference/api.md)

Use this pack when:

- promoting tasks into operator-facing profiles
- changing agent readiness or capability claims
- changing `/operator` or `operator-s-console` task exposure
- checking whether a planned `/operator` change duplicates OpenClaw-native
  control-plane capability
- updating the documented understanding of what OpenClaw has actually built so
  far versus what is still partial

### Operator Surface / UX Wiring

Read in this order:

1. [../OPENCLAW_CONTEXT_ANCHOR.md](../OPENCLAW_CONTEXT_ANCHOR.md)
2. [architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md](./architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md)
3. [reference/api.md](./reference/api.md)
4. [reference/task-types.md](./reference/task-types.md)
5. [OPERATOR_GUIDE.md](./OPERATOR_GUIDE.md)

Use this pack when:

- wiring new backend routes into `/operator`
- wiring or trimming specialist routes in `operator-s-console`
- deciding whether a route belongs in a private operator surface

## Start And Troubleshooting

| File | Purpose |
|---|---|
| [start/getting-started.md](./start/getting-started.md) | docs-local onboarding |
| [start/quickstart.md](./start/quickstart.md) | short checklist |
| [start/architecture-overview.md](./start/architecture-overview.md) | non-technical overview |
| [troubleshooting/common-issues.md](./troubleshooting/common-issues.md) | common fixes |
| [troubleshooting/debugging.md](./troubleshooting/debugging.md) | deeper debugging |

## Historical Or Snapshot Docs

These are not canonical, but they are still useful as historical evidence:

- [../SPRINT_HARDENING_BASELINE.md](../SPRINT_HARDENING_BASELINE.md)
- [operations/DOCUMENTATION_COMPLETE.md](./operations/DOCUMENTATION_COMPLETE.md)
- [operations/IMPLEMENTATION_COMPLETE.md](./operations/IMPLEMENTATION_COMPLETE.md)
- [architecture/OPERATOR_CONSOLE_AUDIT_AND_SPEC.md](./architecture/OPERATOR_CONSOLE_AUDIT_AND_SPEC.md)
- [operations/OPERATOR_S_CONSOLE_CUTOVER_BLUEPRINT.md](./operations/OPERATOR_S_CONSOLE_CUTOVER_BLUEPRINT.md)
- [operations/orchestrator_documentation.md](./operations/orchestrator_documentation.md)
- [operations/orchestrator-status.md](./operations/orchestrator-status.md)
- [operations/orchestrator_workflow_plan.md](./operations/orchestrator_workflow_plan.md)
- [operations/PRD_GOVERNANCE_REMEDIATION.md](./operations/PRD_GOVERNANCE_REMEDIATION.md)
- `../orchestrator/docs/hostile-audit/*` should also be treated as historical audit evidence, not current runtime truth.

Retired proof-surface docs were removed from `main`; use Git history if you
need the old milestone ingest or proof-lane runbooks.

## Root Workspace Companions

- [../README.md](../README.md)
- [../QUICKSTART.md](../QUICKSTART.md)
- [../DEPLOYMENT.md](../DEPLOYMENT.md)
- [../OPENCLAW_CONTEXT_ANCHOR.md](../OPENCLAW_CONTEXT_ANCHOR.md)

## Published Docs Site

The published docs site is scaffolded from canonical repo docs, not maintained
as a separate doc tree.

- local dev: `npm run docs:site:dev`
- production build: `npm run docs:site:build`
