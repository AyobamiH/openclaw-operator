---
title: "Documentation Site Information Architecture"
summary: "Navigation and publishing model for the OpenClaw Operator docs site."
---

# Documentation Site Information Architecture

This document defines the published documentation-site structure for
OpenClaw Operator.

The goal is not to create a second doc system. The goal is to publish a
cleaner reader experience from the same repo-truth markdown that already
exists in this workspace.

## Principles

1. **One truth source**
   Canonical docs stay in the repository. The site is generated from those docs.

2. **README is the GitHub front door**
   The README explains the product, the audience, and the two main install
   paths quickly.

3. **Published docs handle depth**
   Install detail, deployment detail, architecture, operator workflows, API,
   and troubleshooting belong in the docs site.

4. **No mirror pollution**
   The published site must not accidentally become a public rendering of the
   `openclaw-docs/` knowledge mirror or other non-product workspace material.

5. **Operator-first navigation**
   The docs should help a self-hoster move from install to operation to
   extension without needing repo archaeology.

## Audience Layers

### 1. Evaluators

Need:

- what the product is
- what it is not
- who it is for
- local and Docker startup paths

Primary entrypoints:

- `README.md`
- docs site home

### 2. Self-hosting operators

Need:

- local install
- Docker/cloud deployment
- config and monitoring
- troubleshooting

Primary entrypoints:

- `docs/start/getting-started.md`
- `docs/start/quickstart.md`
- `docs/operations/deployment.md`
- `docs/guides/configuration.md`
- `docs/guides/monitoring.md`

### 3. Builders and extenders

Need:

- API contracts
- task types
- operator-console scope
- architecture and capability packs

Primary entrypoints:

- `docs/reference/api.md`
- `docs/reference/task-types.md`
- `docs/architecture/OPERATOR_CONSOLE_AUDIT_AND_SPEC.md`
- `docs/architecture/AGENT_CAPABILITY_*`

## Published Site Structure

### Top Navigation

1. `Home`
2. `Start`
3. `Deploy`
4. `Console`
5. `API`
6. `GitHub`

### Sidebar Groups

1. `Product`
   - site home
   - repository overview
   - docs hub
   - docs index
   - docs navigation
   - docs summary

2. `Install And Deploy`
   - getting started
   - quick start checklist
   - root quickstart
   - deployment guide
   - deployment checklist
   - configuration
   - backup and recovery

3. `Operate`
   - operator guide
   - monitoring
   - running agents
   - knowledge mirror policy

4. `Reference`
   - API
   - task types
   - state schema
   - webhook signing contract

5. `Architecture`
   - architecture overview
   - technical architecture
   - operator console audit and spec
   - operator surface capability matrix
   - agent capability docs
   - public decision intelligence boundary
   - this IA document

6. `Troubleshooting`
   - common issues
   - debugging

## Publishing Model

The site is scaffolded under `site/`, but `site/` is generated from the
canonical docs in the repo.

The expected flow is:

1. update canonical docs in `README.md`, `QUICKSTART.md`, `DEPLOYMENT.md`, and
   `docs/`
2. run `npm run docs:site:sync`
3. run `npm run docs:site:check`
4. run `npm run docs:site:build`

This keeps the published site downstream from repo truth instead of creating a
parallel editorial workflow.

The site export is intentionally allowlist-driven. `scripts/docs-site-manifest.mjs`
defines the exact canonical files that are mirrored into `site/`, and
`scripts/check-docs-site-curation.mjs` fails when unexpected or forbidden docs
appear under `site/docs`. Internal or historical docs may remain in the repo,
but they are not publishable until they are deliberately added to the manifest.

## Future Direction

The next phase after the scaffold is:

1. publish the generated site to a stable docs host
2. tighten install/deploy copy so the site and README feel like one product
3. progressively replace historical/internal-heavy landing pages with more
   operator-facing docs where needed
