# OpenClaw Operator

OpenClaw Operator is a self-hosted AI operations control plane built on
OpenClaw. It gives you a bounded, observable, auditable runtime with a
built-in operator console at `/operator`, governed task execution, approvals,
run history, incidents, and public proof separation.

It is built for people who are comfortable cloning a repo, setting env vars,
and self-hosting services, but who want day-to-day work to happen through a
GUI instead of stitching raw agent runtimes together by hand.

## Why This Repo Exists

This repository packages one opinionated operator product:

- a private orchestrator-first control plane
- a canonical built-in operator console
- a governed task surface with approvals and auditability
- an agent catalog with knowledge-backed workflows
- public proof routes that stay separate from internal operator truth

The goal is not to be a generic AI sandbox or a no-config SaaS clone. The goal
is to run AI-assisted operational work with explicit guardrails, visibility,
and durable state.

## What You Get

- **GUI-first operator workflow** through `/operator`
- **Governed tasks** with allowlisting, approval gates, and run history
- **Observable runtime** with health, incidents, agents, runs, and proof views
- **Auditable actions** through approvals, execution records, and operator APIs
- **Self-hosted deployment paths** for local root dev and Docker/cloud installs
- **Knowledge-backed execution** through local docs mirrors, knowledge packs, and recall surfaces

## What It Is Not

- not the upstream OpenClaw project in generic platform form
- not a hardened untrusted-code sandbox
- not a zero-config SaaS product
- not a promise that every historical markdown file in the repo is active truth

## Repository Layout

- `orchestrator/` — private control plane backend
- `operator-s-console/` — canonical operator UI source
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

## Using It For Real Client Work

OpenClaw Operator is most useful when you treat it as a governed web-dev
control plane instead of a single chatbot.

Typical service lanes:

- **Discovery and scoping** through `market-research`, `data-extraction`,
  `normalize-data`, and `summarize-content`
- **Build and repair work** through `build-refactor`,
  `integration-workflow`, and `qa-verification`
- **Audit and hardening** through `security-audit`, `system-monitor`, and
  `qa-verification`
- **Docs, handoff, and knowledge refresh** through `drift-repair`,
  `content-generate`, and `summarize-content`

The operator workflow is:

1. choose a lane in `/operator/tasks`
2. launch it
3. read the result in `/operator/runs`
4. handle approval-gated work in `/operator/approvals`
5. use `/operator/incidents` and `/operator/system-health` when the work is
   about repair or closure

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
- `DATABASE_URL`
- `REDIS_URL`
- usually `OPENAI_API_KEY`

Important local note:

- [orchestrator_config.json](./orchestrator_config.json) now resolves relative
  path fields from the config file location, so a normal clone should boot
  without path rewrites. Change those values only if you intentionally move the
  runtime roots.

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
  actually booted, authenticated, and served the built operator shell
- for anything beyond a throwaway local try-out, copy
  [docker-compose.override.example.yml](./docker-compose.override.example.yml)
  to `docker-compose.override.yml` and replace the demo credentials before you
  expose the stack anywhere

Advanced note:

- [orchestrator/docker-compose.yml](./orchestrator/docker-compose.yml) still
  exists as the heavier observability-focused stack with Prometheus, Grafana,
  and Alertmanager, but it is no longer the first-run public path

## Core Product Boundary

- `/operator` is the private operator control plane
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

After startup, these are the fastest checks:

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/api/knowledge/summary
curl http://127.0.0.1:4300/health
```

Then open `/operator`, authenticate with your bearer token, and verify the
console loads real backend data. Use `3000` for repo-native local dev and
`4300` for the Docker demo path.

For a first real workflow, use:

1. `/operator/agents` to see what each agent is for
2. `/operator/tasks` to launch work
3. `/operator/runs` to inspect the output
4. `logs/knowledge-packs/` or `logs/reddit-drafts.jsonl` only when that task
   writes a named artifact file

## Next Steps

- [docs/start/getting-started.md](./docs/start/getting-started.md)
- [docs/operations/deployment.md](./docs/operations/deployment.md)
- [docs/guides/monitoring.md](./docs/guides/monitoring.md)
- [docs/reference/task-types.md](./docs/reference/task-types.md)
