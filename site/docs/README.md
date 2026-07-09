---
title: "Docs Hub"
summary: "Primary entrypoint for first-party OpenClaw workspace documentation."
---

# OpenClaw Docs Hub

This directory contains the first-party documentation for the OpenClaw
workspace runtime.

For current runtime truth, treat code and config as canonical first, then use
the navigation files in this directory.

Documentation growth rule:

- update the existing canonical file for a topic before creating a new Markdown
  file
- avoid adding new root-level docs when the topic belongs under `docs/` or a
  subproject README
- every material code or config change must be reflected in the relevant
  existing `.md` file in the same change set, with code/config path references
  where they help prevent drift

## Start Here

- [INDEX.md](./INDEX.md): authoritative map of active docs
- [NAVIGATION.md](./NAVIGATION.md): by-role and by-task routes
- [SUMMARY.md](./SUMMARY.md): current documentation status summary
- [architecture/DOCUMENTATION_SITE_INFORMATION_ARCHITECTURE.md](./architecture/DOCUMENTATION_SITE_INFORMATION_ARCHITECTURE.md): published docs-site structure and publishing model
- [operations/DOCUMENT_AUDIT.md](./operations/DOCUMENT_AUDIT.md): what is
  canonical, historical, stale, or still pending

Published docs-site workflow:

```bash
npm run docs:site:dev
npm run docs:site:build
```

## Core Runtime Docs

- [Operator Guide](./OPERATOR_GUIDE.md)
- [System Architecture](./concepts/architecture.md)
- [Agent Adaptation Plan](./architecture/AGENT_ADAPTATION_PLAN.md)
- [Operator Surface Capability Matrix](./architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md)
- [Documentation Site Information Architecture](./architecture/DOCUMENTATION_SITE_INFORMATION_ARCHITECTURE.md)
- [Configuration Guide](./guides/configuration.md)
- [Knowledge Mirror Policy](./operations/KNOWLEDGE_MIRROR_POLICY.md)
- [Public Release Guide](./operations/public-release.md)
- [Task Types](./reference/task-types.md)
- [State Schema](./reference/state-schema.md)

## Historical Implementation Docs

- [Operator Console Audit And Spec](./architecture/OPERATOR_CONSOLE_AUDIT_AND_SPEC.md)
- [Operator-s-console Cutover Blueprint](./operations/OPERATOR_S_CONSOLE_CUTOVER_BLUEPRINT.md)

Retired proof-surface runbooks were removed from `main`; use Git history if you
need that old delivery path.

## Active Closure Plan

- [Sprint To Completion](./operations/SPRINT_TO_COMPLETION.md)

## Root-Level Companions

- [../README.md](../README.md): public workspace overview
- [../QUICKSTART.md](../QUICKSTART.md): fast local startup
- [../DEPLOYMENT.md](../DEPLOYMENT.md): deployment paths
- [../OPENCLAW_CONTEXT_ANCHOR.md](../OPENCLAW_CONTEXT_ANCHOR.md): canonical
  runtime orientation
