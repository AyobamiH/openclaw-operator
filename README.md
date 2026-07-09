# OpenClaw Operator

OpenClaw Operator is a self-hosted specialist orchestration layer built on
OpenClaw. OpenClaw itself is now the recommended front door for day-to-day use
through its Control UI, chat surfaces, and gateway control plane. This repo
adds bounded, observable, auditable specialist runtime lanes behind that front
door: governed task execution, release/compliance/test/code posture, incidents,
runs, and public-proof separation.

It is built for people who are comfortable cloning a repo, setting env vars,
and self-hosting services, but who want OpenClaw to handle the generic shell
and messaging experience while this repo handles the orchestrator-specific
operational intelligence.

## Why This Repo Exists

This repository packages one opinionated specialist orchestrator:

- a private orchestrator-first control plane
- a bridgeable specialist task surface behind OpenClaw
- a governed task surface with approvals and auditability
- an agent catalog with knowledge-backed workflows
- public proof routes that stay separate from internal operator truth

The goal is not to compete with OpenClaw's generic gateway, Control UI, or
approval/task shell. The goal is to run AI-assisted operational work with
explicit guardrails, visibility, and durable specialist state.

## What You Get

- **Specialist orchestrator workflow** through `/operator` or the OpenClaw
  bridge when you need bounded operational lanes
- **Governed tasks** with allowlisting, approval gates, and run history
- **Observable runtime** with health, incidents, agents, runs, and proof views
- **Auditable actions** through approvals, execution records, and operator APIs
- **Self-hosted deployment paths** for local root dev and Docker/cloud installs
- **Knowledge-backed execution** through local docs mirrors, knowledge packs, and recall surfaces

## What It Is Not

- not the upstream OpenClaw project in generic platform form
- not a second generic control UI or shell roadmap competing with OpenClaw
- not a hardened untrusted-code sandbox
- not a zero-config SaaS product
- not a promise that every historical markdown file in the repo is active truth

## Direction Note

Current repo direction:

- use OpenClaw as the front door
- keep this repo focused on specialist orchestrator value
- maintain `/operator` and `operator-s-console` only where they expose unique
  orchestrator workflows or evidence that OpenClaw does not already provide
- stop planning new generic shell/dashboard growth here

## Repository Layout

- `orchestrator/` — private control plane backend
- `operator-s-console/` — maintained specialist console for orchestrator-only
  workflows, not the primary product front door
- `agents/` — task specialists and service loops
- `skills/` — bounded capability definitions
- `docs/` — first-party product and operator docs
- `openclaw-docs/` — mirrored runtime knowledge input
- `orchestrator_config.json` — local runtime config
- `orchestrator/orchestrator_config.json` — container runtime config

## Managed Knowledge Mirror

`openclaw-docs/` is a managed local knowledge mirror, not ordinary feature code.

In the live runtime it feeds:

- the docs index and `doc-change` watcher
- `drift-repair` / `doc-specialist` knowledge-pack generation
- downstream grounded lanes such as `reddit-response`

Treat the flow as:

`openclaw-docs/` -> `drift-repair` -> `logs/knowledge-packs/` -> `reddit-helper`

Recommended commit policy:

- do not mix `openclaw-docs/` changes into normal feature commits
- refresh it intentionally with the sync script
- if you choose to version a mirror refresh, commit it separately with a message like `docs(openclaw-docs): sync upstream mirror`

If the mirror changed after the latest knowledge pack was generated, refresh
`drift-repair` before you treat Reddit or content drafts as current.

## Public Release Path

If you want a public GitHub repo without rewriting this repo's private history,
use the sanitized public-mirror workflow instead of changing this repo's
visibility directly.

That path exports a clean tree from the current working copy, excludes tracked
local/session material such as `MEMORY.md` and `.openclaw/workspace-state.json`,
and lets you publish a separate public repo with fresh history.

The operational guide lives at
[docs/operations/public-release.md](./docs/operations/public-release.md).

## Canonical Public Home

This repository is now the canonical home for public product work.

Use this repo for:

- product behavior meant for users and contributors
- public docs, examples, and self-hosting guidance
- agent, task, operator, API, and runtime changes that should ship publicly
- issues, pull requests, and releases for the open-source product

The private workspace continues to exist as a personal lab for local notes,
machine-specific helpers, incubation, and rough experiments, but those
side-step workflows should only land here once they are ready for public use.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the working rule.

## Branch-First Workflow

Public product work should happen on a local branch first, not directly on
`main`.

The expected flow is:

1. create a local feature branch
2. make and validate the change there
3. merge into `main` locally once the branch is ready
4. push the merged `main`

That is the normal working style for this repo going forward.

Protected branch pushes are now gated by a repo-managed pre-push hook. After
`npm install`, pushes to `main` or `master` run `npm run verify:main` before
Git will allow the push. You can also reapply the hook setup with
`npm run setup:hooks`.

## Using It For Real Client Work

OpenClaw Operator is most useful when you treat it as a governed web-dev
specialist orchestrator layer instead of a standalone shell.

Typical service lanes:

- **Discovery and scoping** through `market-research`, `data-extraction`,
  `normalize-data`, and `summarize-content`
- **Build and repair work** through `build-refactor`,
  `integration-workflow`, and `qa-verification`
- **Audit and hardening** through `security-audit`, `system-monitor`, and
  `qa-verification`
- **Docs, handoff, and knowledge refresh** through `drift-repair`,
  `content-generate`, and `summarize-content`

The recommended workflow is:

1. use OpenClaw plus `/orch tasks` or `/orch run ...` as the preferred daily
   front door
2. read bounded summaries through `/orch runs` and `/orch approvals`
3. open `/operator/runs`, `/operator/approvals`, `/operator/incidents`, or
   `/operator/system-health` when you need the repo-native specialist drill-down
4. check `logs/` only for lanes that explicitly write named artifacts

## Where Project Repos Go

If you want the agents to work on another codebase, clone it **inside this
workspace tree**.

Recommended layout:

```text
workspace/
  projects/
    acme-site/
    beta-dashboard/
    client-landing-page/
```

Why this matters:

- the current agent permission model is scoped to `workspace`, not your entire
  machine
- bounded code-edit lanes such as `build-refactor` resolve `scope` relative to
  the workspace root
- keeping client repos under one folder makes task payloads predictable and
  easier to explain in docs, reviews, and approvals

Recommended task scopes:

- `projects/acme-site`
- `projects/acme-site/src`
- `projects/acme-site/app/page.tsx`

## Where Outputs Land

Different lanes produce different kinds of output. The three main places to
look are:

1. **Operator run history** in `/operator/runs`
   This is the main place for summaries, traces, findings, workflow evidence,
   and verification output.
2. **Artifact files** in `logs/`
   Use this for durable outputs such as knowledge packs, Reddit drafts, and
   digest artifacts.
3. **The target repo or deployment directory**
   Code-edit and deployment lanes change the repo itself or create generated
   runtime folders.

Common output rails:

- `drift-repair` -> `logs/knowledge-packs/`
- `reddit-response` -> `logs/reddit-drafts.jsonl` and
  `logs/devvit-submissions.jsonl`
- `build-refactor` -> real code changes in the scoped repo, plus run evidence
- `qa-verification` -> verification trace in `/operator/runs`
- `agent-deploy` -> generated folders under `agents-deployed/`

## Service Recipes

If you want concrete playbooks instead of abstract capability lists, start with
these three:

- **Client audit**: run `security-audit`, `system-monitor`, then optionally
  `content-generate` to turn the findings into a client-facing report
- **Scoped feature build**: run `build-refactor` on a narrow repo path, approve
  it if needed, then run `qa-verification`
- **Handoff package**: run `drift-repair`, `summarize-content`, and
  `content-generate` to leave a knowledge pack plus a readable project summary

The detailed task flows, sample payloads, and expected outputs live in
[docs/guides/running-agents.md#service-recipes](./docs/guides/running-agents.md#service-recipes).

If you want the shortest visual path through the operator UI, use the
walkthrough at
[docs/guides/running-agents.md#operator-walkthrough](./docs/guides/running-agents.md#operator-walkthrough).

## Local Quick Start

Use this path when you want to run the repo directly on your own machine.

```bash
git clone https://github.com/AyobamiH/openclaw-operator.git
cd openclaw-operator
npm install
cp orchestrator/.env.example orchestrator/.env
# fill in orchestrator/.env
npm run dev
```

Open:

- `http://127.0.0.1:3000/operator`

If you run the service under systemd or a local tunnel, your host port may
change. The repo-native `npm run dev` path still defaults to the orchestrator's
standard local dev port.

At minimum, set these env vars in `orchestrator/.env`:

- `API_KEY_ROTATION` or `API_KEY`
- `WEBHOOK_SECRET`
- usually `OPENAI_API_KEY`

Optional for richer local setups:

- `DATABASE_URL` for Mongo-backed historical persistence and exports
- `REDIS_URL` for shared coordination and response caching

Important local note:

- [orchestrator_config.json](./orchestrator_config.json) now resolves relative
  path fields from the config file location, so a normal clone should boot
  without path rewrites. The repo-native default now persists hot runtime state
  to `./orchestrator/data/orchestrator-state.json`, so Path A does not require
  Mongo or Redis just to boot. Change those values only if you intentionally
  move the runtime roots.

## Docker Quick Start

Use this path when you want the official public demo stack: one compose file at
the repo root, localhost-only by default, with MongoDB and Redis included.

```bash
git clone https://github.com/AyobamiH/openclaw-operator.git
cd openclaw-operator
docker compose up -d --build
npm run docker:demo:smoke
```

Open:

- `http://127.0.0.1:4300/operator`

Local demo bearer keys:

- viewer: `demo-viewer-key-local-only`
- operator: `demo-operator-key-local-only`
- admin: `demo-admin-key-local-only`

Important Docker truth:

- the root [docker-compose.yml](./docker-compose.yml) is now the official
  public quickstart
- it is intentionally localhost-only and uses demo-local credentials so a new
  user can boot the product without first creating a private `.env`
- provider-backed lanes will stay degraded until you add real provider keys
- `npm run docker:demo:smoke` is the local proof that the official demo stack
  actually booted, authenticated, and served the built specialist console
- for anything beyond a throwaway local try-out, copy
  [docker-compose.override.example.yml](./docker-compose.override.example.yml)
  to `docker-compose.override.yml` and replace the demo credentials before you
  expose the stack anywhere

Advanced note:

- [orchestrator/docker-compose.yml](./orchestrator/docker-compose.yml) still
  exists as the heavier observability-focused stack with Prometheus, Grafana,
  and Alertmanager, but it is no longer the first-run public path

## Core Product Boundary

- OpenClaw is the primary front door for daily use
- `/operator` is the private specialist sidecar control plane
- public proof stays separate through orchestrator-owned public routes
- task exposure is curated, not every internal path is promoted to operators
- ToolGate and policy surfaces are real governance layers, not container-grade sandboxing

## Documentation

Start here:

- [Docs Hub](./docs/README.md)
- [Getting Started](./docs/start/getting-started.md)
- [Quick Start](./QUICKSTART.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Configuration](./docs/guides/configuration.md)
- [API Reference](./docs/reference/api.md)
- [Sprint To Completion](./docs/operations/SPRINT_TO_COMPLETION.md)
- [Operator Console Audit And Spec](./docs/architecture/OPERATOR_CONSOLE_AUDIT_AND_SPEC.md)

Published docs site workflow:

```bash
npm run docs:site:dev
npm run docs:site:build
npm run docs:site:preview
```

The docs site is generated from the canonical repo docs. The site is meant to
improve navigation and onboarding, not create a second documentation truth
layer.

GitHub Pages deployment:

- workflow: `.github/workflows/docs-pages.yml`
- public URL: `https://ayobamih.github.io/openclaw-operator/`
- first publish requirement: in the GitHub repository settings, Pages should use
  `GitHub Actions` as the build and deployment source

GitHub Navigation Tabs:

- `Code` for the product source and runtime files
- `Issues` and `Pull requests` for active delivery work
- `Actions` for CI and release verification
- `Wiki` is not the canonical docs surface; prefer this README and
  [docs/operations/SPRINT_TO_COMPLETION.md](./docs/operations/SPRINT_TO_COMPLETION.md)

## Common Root Commands

```bash
npm run dev
npm run build
npm run typecheck
npm run test
npm run test:integration
npm run docs:drift
npm run docs:links
npm run docs:site:build
```

## Verification

For branch work, the canonical local validation pass is:

```bash
npm run verify
```

For anything headed to `main`, use:

```bash
npm run verify:main
```

The protected-branch pre-push hook uses that same `verify:main` contract for
`main` and `master`.

After startup, these are the fastest checks:

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/api/knowledge/summary
curl http://127.0.0.1:4300/health
```

Then prefer OpenClaw plus the orchestrator bridge for day-to-day use. If you
need the repo-native specialist console, open `/operator`, authenticate with
your bearer token, and verify it loads real backend data. Use `3000` for
repo-native local dev and `4300` for the Docker demo path.

For a first repo-native specialist workflow, use:

1. `/orch tasks` or `/operator/agents` to see what lanes and agents are
   available
2. `/orch run ...` or `/operator/tasks` to launch work
3. `/orch runs` or `/operator/runs` to inspect the output
4. `logs/knowledge-packs/` or `logs/reddit-drafts.jsonl` only when that task
   writes a named artifact file

## Next Steps

- [docs/start/getting-started.md](./docs/start/getting-started.md)
- [docs/operations/deployment.md](./docs/operations/deployment.md)
- [docs/guides/monitoring.md](./docs/guides/monitoring.md)
- [docs/reference/task-types.md](./docs/reference/task-types.md)
