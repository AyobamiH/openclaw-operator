---
title: "Documentation Summary"
summary: "Current status summary for the first-party docs set."
---

# Documentation Summary

This file summarizes the current state of the first-party OpenClaw Operator
docs after the OpenClaw-front-door repo-direction cutover on `2026-04-17`.

## Current State

- Public entry docs now tell one product story: OpenClaw is the daily front
  door, and `openclaw-operator` is the bounded, observable, auditable
  specialist orchestrator layer built on top of it.
- Canonical navigation docs point to the active runtime/doc pack, while
  completed implementation blueprints are clearly demoted as historical
  evidence.
- The bridge-backed `/orch` path is now part of the active operating story,
  instead of treating `/operator` as the only first-use surface.
- Public proof is documented as orchestrator-owned through
  `/api/command-center/*` and `/api/milestones/*`; the retired proof-surface
  docs now live in Git history instead of the active docs tree.
- Root-first onboarding, Docker paths, and the operator-console boundary are
  aligned across the root docs and subproject READMEs, with `/operator`
  positioned as a specialist surface rather than a competing shell roadmap.
- A repeatable first-party Markdown link check now exists at
  `npm run docs:links` so broken public-doc links are caught alongside doc
  drift checks.
- A VitePress-based docs site scaffold now exists, generated from canonical
  repo docs through `npm run docs:site:sync` and built through
  `npm run docs:site:build`.
- The numbered sprint ladder is now complete through Sprint 9; the remaining
  doc work is ongoing maintenance and future coordination scale-out, not active
  release/exposure drift inside the current operator repo.

## Primary Documents

| Category | Start Here |
|---|---|
| Repo overview | [../README.md](../README.md) |
| Runtime truth | [../OPENCLAW_CONTEXT_ANCHOR.md](../OPENCLAW_CONTEXT_ANCHOR.md) |
| Docs navigation | [INDEX.md](./INDEX.md) |
| By-role routing | [NAVIGATION.md](./NAVIGATION.md) |
| Audit / stale classification | [operations/DOCUMENT_AUDIT.md](./operations/DOCUMENT_AUDIT.md) |

## Active Runtime Docs

- [OPERATOR_GUIDE.md](./OPERATOR_GUIDE.md)
- [architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md](./architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md)
- [guides/configuration.md](./guides/configuration.md)
- [OPENCLAW_KB/02_GATEWAY_AND_POLICY.md](./OPENCLAW_KB/02_GATEWAY_AND_POLICY.md)
- [reference/task-types.md](./reference/task-types.md)
- [reference/state-schema.md](./reference/state-schema.md)
- [architecture/DOCUMENTATION_SITE_INFORMATION_ARCHITECTURE.md](./architecture/DOCUMENTATION_SITE_INFORMATION_ARCHITECTURE.md)
- [operations/SPRINT_TO_COMPLETION.md](./operations/SPRINT_TO_COMPLETION.md)

## Historical Docs Still Kept

These remain in the repo because they preserve earlier phase evidence, but they
are not the primary operating surface:

- [operations/DOCUMENTATION_COMPLETE.md](./operations/DOCUMENTATION_COMPLETE.md)
- [operations/IMPLEMENTATION_COMPLETE.md](./operations/IMPLEMENTATION_COMPLETE.md)
- [operations/OPERATOR_S_CONSOLE_CUTOVER_BLUEPRINT.md](./operations/OPERATOR_S_CONSOLE_CUTOVER_BLUEPRINT.md)
- [architecture/OPERATOR_CONSOLE_AUDIT_AND_SPEC.md](./architecture/OPERATOR_CONSOLE_AUDIT_AND_SPEC.md)
- [operations/orchestrator_documentation.md](./operations/orchestrator_documentation.md)
- [operations/orchestrator-status.md](./operations/orchestrator-status.md)
- [operations/orchestrator_workflow_plan.md](./operations/orchestrator_workflow_plan.md)
- [operations/PRD_GOVERNANCE_REMEDIATION.md](./operations/PRD_GOVERNANCE_REMEDIATION.md)

## Remaining Work

1. Keep the OpenClaw-front-door cutover aligned across active docs and any
   generated site mirrors.
2. Keep the KB classification and navigation surfaces current.
3. Keep the same runtime-truth discipline in place as docs evolve, even
   though the numbered sprint ladder is now complete.
