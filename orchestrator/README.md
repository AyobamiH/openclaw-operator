# OpenClaw Operator Control Plane

This directory contains the control plane inside OpenClaw Operator. It is the
runtime that accepts tasks, applies policy, dispatches work, records state,
and serves both the protected operator surface and the public proof surface.

## What Lives Here

- `src/index.ts`: runtime bootstrap and HTTP surface
- `src/taskHandlers.ts`: task allowlist and dispatch logic
- `src/openapi.ts`: machine-readable route contract for public and protected APIs
- `orchestrator_config.json`: local runtime configuration
- `docker-compose.yml`: advanced local stack for orchestrator + dependencies

For product-level orientation, start with `../README.md` and
`../OPENCLAW_CONTEXT_ANCHOR.md`. This README is the internal runtime guide for
the control plane itself.

## Compose Modes

The canonical public Docker quickstart now lives at the repo root in
`../docker-compose.yml`. It is the easiest localhost-only demo path and ships
demo-local credentials so a new user can boot the product without first
creating a private `.env`.

Use `orchestrator/docker-compose.yml` only when you intentionally need the
heavier local development stack, including Prometheus, Grafana, and
Alertmanager.

For this advanced compose mode, create `orchestrator/.env` from `.env.example`
first. The container startup posture requires `API_KEY_ROTATION`/`API_KEY`,
`WEBHOOK_SECRET`, `MONGO_USERNAME`, `MONGO_PASSWORD`, and `REDIS_PASSWORD`;
compose passes those through from the env file instead of hardcoding them in
YAML.

The full compose stack intentionally overrides `DATABASE_URL` inside the
orchestrator container so it always uses the local `mongo` service. That keeps
Docker validation honest even when the host `.env` used by systemd or manual
runs points at an external database.

The host/user-service path can either point at your own reachable `REDIS_URL`
from `orchestrator/.env` or use the repo-managed
`systemd/openclaw-redis.service`, which runs `redis:7-alpine` locally through
Docker. No paid Redis subscription is required for the local-service posture.

## Common Commands

From this directory:

```bash
npm install
PORT=3313 npm run dev
npm run dev
npm run build
npm run test:run
```

`npm run dev` now loads `./.env` automatically. If the systemd-managed
orchestrator is already using `3312`, run a second local dev instance on a
different port such as `3313`.
The user-level `orchestrator.service` should mirror this same `tsx` +
`src/index.ts` entrypoint for the always-on local/tunnel runtime rather than
booting a separate `dist/index.js` posture. The tracked
`systemd/orchestrator.service` now follows that exact user-service posture and
expects a clone at `~/openclaw-operator`.

Useful targeted checks:

- `npm run test:unit:fixtures`
- `npm run test:integration`
- `npm run docs:check-sync`

## Response Cache

The orchestrator now uses a bounded response cache for repeated read-heavy API
surfaces such as `/api/dashboard/overview`, `/api/health/extended`,
`/api/tasks/runs`, `/api/agents/overview`, `/api/memory/recall`, and the
knowledge summary/query paths.

Runtime behavior:

- if `REDIS_URL` is reachable, the response cache uses Redis
- if Redis is unavailable, the orchestrator falls back to an in-memory cache
  instead of failing startup
- cache invalidation is tag-based and tied to orchestrator runtime state
  writes

Cached responses expose:

- `X-OpenClaw-Cache: hit|miss`
- `X-OpenClaw-Cache-Store: redis|memory`

Protected cached reads also return `Cache-Control: private, max-age=*` and
`Vary: Authorization` so repeated identical operator fetches do less work
without mixing actor-scoped views.

## Operational Notes

- Do not run the root and orchestrator compose stacks at the same time unless
  you have intentionally reconciled their port/container overlap.
- The runtime security posture is intentional: local and host startup both
  require `WEBHOOK_SECRET`, `MONGO_USERNAME`, `MONGO_PASSWORD`, and
  `REDIS_PASSWORD` in addition to the bearer auth key configuration.
- `WEBHOOK_SECRET` is used to verify HMAC signatures on `POST /webhook/alerts`
  so AlertManager-style webhook traffic cannot inject fake incidents.
- `REDIS_PASSWORD` is required because the compose/runtime posture treats Redis
  as an authenticated dependency; `docker-compose.yml` starts Redis with
  `--requirepass`, and bootstrap refuses to start without the matching secret.
- Code and config are the source of truth. This README is a current entrypoint,
  not a replacement for the implementation.
- Material orchestrator code/config changes should update the appropriate
  existing `.md` file in the same change set and reference the affected runtime
  paths where useful.
- The active documentation surface for runtime and operations lives under
  `../docs/`.

## Runtime Task Surface (Operational Truth)

- **Internal runtime allowlist (broader):** enforced by
  `src/taskHandlers.ts` (`ALLOWED_TASK_TYPES`) for orchestrator-internal queue
  routing.
- **Public trigger subset (narrower):** enforced by
  `src/middleware/validation.ts` (`TaskTriggerSchema`) on `POST /api/tasks/trigger`.
- **Internal-only tasks:** `startup`, `doc-change` (internally allowlisted but
  not publicly triggerable).
- **Default approval-gated tasks:** `agent-deploy`, `build-refactor` (from the
  `approvalGate` defaults unless `approvalRequiredTaskTypes` overrides them).
- **Dynamic approval gate:** any allowlisted task can still require approval if
  `payload.requiresApproval === true`.
- **Per-task operator classification:** see `../docs/reference/task-types.md`
  for the current internal-only / public-triggerable / approval-gated /
  confirmed-working / degraded split.

## Current Runtime Confidence

- **Confirmed working paths:**
  - `heartbeat`
  - `build-refactor` after approval
  - `market-research` through actual allowlisted fetches from explicit URLs or derived source plans
  - `drift-repair` (`2026-03-07` local smoke: first-class run record plus knowledge-pack verification recorded in `/api/tasks/runs` and `/api/dashboard/overview.selfHealing`)
  - `reddit-response` through deterministic local drafting plus optional provider polish
  - `summarize-content` (`2026-03-07` spawned-worker sweep via `/api/tasks/trigger` -> `/api/tasks/runs` -> `/api/memory/recall`)
  - `normalize-data` (`2026-03-07` spawned-worker sweep)
  - `data-extraction` inline-source lane (`2026-03-07` spawned-worker sweep)
  - `security-audit` (`2026-03-07` spawned-worker sweep; current worker logic performs real local repo/runtime inspection)
  - `system-monitor` (`2026-03-07` spawned-worker sweep; current worker logic performs real runtime/service-state analysis)
  - `content-generate` (`2026-03-07` spawned-worker sweep; current worker logic now produces source-driven content instead of placeholder/template filler)
  - `integration-workflow` (`2026-03-07` spawned-worker sweep; current worker logic now performs deterministic reroute/replay orchestration)
  - `qa-verification` (`2026-03-07` live smoke: dry-run plus real `build-verify` run, execute-mode `testRunner` evidence visible in `/api/skills/audit`)
  - `skill-audit` (`2026-03-07` live smoke: first-class run record visible after the contract fix`)
- **Approval-gated confirmed paths:**
  - `agent-deploy`
- **Partially operational / degraded paths:**
  - `send-digest`
- **Externally dependent path:**
  - `rss-sweep` (depends on runtime config + external network/feed availability)
- **Historical-only evidence in protected recent-task view (not safely re-run in the `2026-03-07` sweep):**
  - `nightly-batch` (`2026-03-06T23:00:01.268Z` in `/api/dashboard/overview.recentTasks`)
    - `nightly-batch` now derives `selectedForDraft` from RSS routing tags instead of a redundant score check: only `priority` leads are auto-selected for `reddit-response`; `manual-review` leads create mandatory operator approvals; and the top `10` `draft` leads create optional promotion approvals. `reddit-response` now consumes only selected queue items unless an approved review-gated queue payload is replayed.

Safe-sweep note: `send-digest` was not re-run on `2026-03-07` because the live
config points at an outbound notifier target; routing truth and historical task
success remain separate from safe local re-run truth.

Run-id note: orchestrator now reuses `payload.idempotencyKey` only when a
caller explicitly supplies it. Normal task triggers fall back to the task id
as the run id so `/api/tasks/runs` preserves distinct operator-visible runs.

Current stabilisation truth after the approved production-grade pass:

- Auto `doc-change -> drift-repair` is still threshold-driven, but identical
  buffered doc sets now cool down before re-enqueueing another auto repair.
- Fast-start no longer disables doc/cookbook freshness; the runtime now
  constructs the indexers immediately, attaches watch hooks, and warms the
  initial crawl after HTTP startup so `3312` does not stall during boot.
- The canonical non-fast-start path is now proven on `3312`: Mongo-backed
  persistence and KnowledgeIntegration start cleanly. The synthetic
  orchestrator-local memory scheduler was removed on `2026-03-21`; workspace
  continuity now lives only in the root `MEMORY.md` plus
  `memory/YYYY-MM-DD.md` through `scripts/memory_guard.sh`.
- `/api/agents/overview` now separates `serviceAvailable` from
  `serviceInstalled` and `serviceRunning`; the orchestrator no longer implies
  host-running proof for agent services it cannot actually verify.
- Placeholder agent systemd units are now explicitly gated on `src/service.ts`
  with `ConditionPathExists=` so unfinished daemon surfaces do not present as
  runnable services.
- `security-audit`, `summarize-content`, and `system-monitor` no longer report
  green when the agent returns `success !== true`.
- `reddit-response` still remains partially operational because of provider
  dependence, but its local context path is now stronger: `reddit-helper`
  pulls runtime doctrine/model defaults from `workspace/orchestrator_config.json`
  and the latest `drift-repair` pack remains dual-source (OpenClaw docs +
  OpenAI Cookbook) even for targeted repairs. The helper now also uses
  shared coordination for backlog dedupe and daily LLM budgets, plus
  per-cycle throttles,
  deterministic local scoring, and local-first hybrid drafting so the model is
  only used for an optional final polish pass when budget allows. Real helper
  exceptions now fail the task instead of silently recording a drafted success.

Operational interpretation: queue acceptance and task routing can succeed while
the downstream dependency chain for a task is still degraded. Approval posture,
route acceptance, and downstream completion should be read as separate truths.
The operator-facing self-healing model is now explicit but still partial:
`/api/dashboard/overview.selfHealing` and `/api/health/extended.repairs`
expose bounded repair evidence for the live `doc-drift -> drift-repair ->
knowledge-pack verification` loop and for retry-recovery bookkeeping. This is
evidence-backed repair coordination, not a claim of universal autonomous
healing across every task lane.

## Private Operator Console

- **Route:** `GET /operator`
- **Purpose:** private orchestrator-facing UI shell for non-CLI operators.
- **Boundary:** this surface is private operator workflow; the public proof
  surface stays on separate orchestrator-owned public routes.
- **Auth model:** the UI itself is served locally from orchestrator, and it uses
  bearer-protected API routes for protected actions/data.

The console is intentionally aligned to current runtime truth and exposes:

- protected aggregation (`/api/dashboard/overview`)
- protected self-healing, repair, and incident summary
  (`/api/dashboard/overview`, `/api/health/extended`, `/api/incidents`,
  `/api/incidents/:id`, `/api/incidents/:id/history`)
- curated task runner (`/api/tasks/catalog`, `/api/tasks/trigger`)
- run visibility (`/api/tasks/runs`, `/api/tasks/runs/:runId`)
- approvals with impact metadata
  (`/api/approvals/pending`, `/api/approvals/:id/decision`)
- agents operational matrix, capability readiness, and topology pulse
  (`/api/agents/overview`)
- governed-skill policy visibility (`/api/skills/policy`)
- activity + memory recall (`/api/memory/recall`)
- liveness + dependency + authoritative health (`/health`, `/api/persistence/health`, `/api/health/extended`)
- persistence summaries (`/api/persistence/summary`)
- knowledge summary/query (`/api/knowledge/summary`, `/api/knowledge/query`)

It does **not** convert internal-only tasks (`startup`, `doc-change`) into
normal user-runnable actions, and it keeps public proof surfaces separate from
private operator actions.

Route contract for operator/frontends:

- `/api/health/extended`: authoritative protected operator-health surface.
- `/api/dashboard/overview`: protected operator aggregation surface; useful for
  queue, approvals, governance, and recent-task visibility, but not
  authoritative system health.
- `/api/tasks/runs` and `/api/tasks/runs/:runId` now include bounded `repair`
  metadata when a task run is part of a tracked repair attempt.
- `/api/persistence/health`: public persistence dependency truth only.
- `/health`: shallow public liveness only. Its returned `metrics`,
  `knowledge`, and `persistence` URLs are internal `localhost` helper links and
  must not be treated as browser targets by external frontends.
- `/api/agents/overview`: runtime worker/service truth surface. Prefer
  `serviceAvailable`, `serviceInstalled`, and `serviceRunning`; the legacy
  `serviceImplementation` and `serviceOperational` fields remain as
  compatibility aliases. `serviceRunning=false` is now valid host truth when a
  unit is absent or inactive; `null` should be reserved for probe-unavailable
  cases only.
- `/system-health`: not a backend route; if present in a UI, it is a frontend
  page path that should consume the routes above.

External operator-console frontends must also persist the bearer token across
preview/auth-bridge redirects. In-memory-only token storage is not a reliable
protected-route strategy when the hosting shell can redirect before protected
fetches complete.

## Auth + RBAC Runtime Truth

- Protected APIs still require bearer authentication.
- Server-side RBAC is now enforced on protected routes with role context:
  - `viewer`: read-only operator visibility
  - `operator`: task submission + approval decisions
  - `admin`: export-heavy privileged routes
- Route authorization is deny-by-default unless explicitly role-annotated.
- Governed skills remain frontend read-only: no direct skill invocation
  endpoint is exposed to the UI. Skill execution remains task/approval-flow
  governed.
- Audit logging now includes actor, role, request ID, action, and outcome for
  protected route activity.

## CORS + API Base URL Runtime Truth

- CORS is enforced directly by the orchestrator backend with a strict
  deny-by-default origin allowlist.
- Wildcard CORS (`*`) is not used.
- Disallowed cross-origin requests are rejected by policy (`403`).
- CORS preflight is validated for requested method and headers before route
  handlers run.
- Bearer-auth frontend calls are supported via explicit
  `Authorization` allow-header.
- Default allowed methods are `GET, POST` (plus `OPTIONS` for preflight).
- Default allowed request headers are `Authorization, Content-Type`.
- Default exposed response headers are `X-Request-Id, X-API-Key-Expires,
  ratelimit-limit, ratelimit-remaining, ratelimit-reset, Retry-After`.
- Credentials mode defaults to disabled (`corsAllowCredentials=false`) because
  the operator API is bearer-token based.

Configuration surface (config file and env overrides):

- `corsAllowedOrigins` / `ORCHESTRATOR_CORS_ALLOWED_ORIGINS`
  comma-separated exact origins (for example:
  `https://ops.example.com,https://staging-ops.example.com,http://localhost:5173`).
- `corsAllowedMethods` / `ORCHESTRATOR_CORS_ALLOWED_METHODS`
- `corsAllowedHeaders` / `ORCHESTRATOR_CORS_ALLOWED_HEADERS`
- `corsExposedHeaders` / `ORCHESTRATOR_CORS_EXPOSED_HEADERS`
- `corsAllowCredentials` / `ORCHESTRATOR_CORS_ALLOW_CREDENTIALS`
- `corsMaxAgeSeconds` / `ORCHESTRATOR_CORS_MAX_AGE_SECONDS`

Integration note:

- External frontends (including Lovable-hosted frontends) should call the
  orchestrator API directly at the deployed orchestrator base URL
  (for example `https://orchestrator.example.com`), and that exact frontend
  origin must be in the backend CORS allowlist.

## Rate Limiting Policy (Public vs Protected)

- **Public monitoring routes stay separate and lenient:**
  - `/health`: `1000 requests / 60s / IP`
  - `/api/persistence/health`: `1000 requests / 60s / IP`
- **Public lightweight read routes:**
  - `/api/knowledge/summary`, `/api/openapi.json`: `30 requests / 60s / IP`
- **Protected pre-auth abuse control:**
  - protected routes enforce a coarse pre-auth limiter of
    `300 requests / 60s / IP`
- **Protected bucket A — viewer-read (`120 / 60s`):**
  - Global bucket across authenticated read routes (`GET` operator visibility
    endpoints), keyed by authenticated actor/API key label.
  - Includes Lovable polling surfaces such as `/api/skills/audit`,
    `/api/health/extended`, `/api/persistence/summary`,
    `/api/tasks/runs`, `/api/tasks/runs/:runId`, `/api/dashboard/overview`.
- **Protected bucket B — operator-write (`30 / 60s`):**
  - Global bucket across authenticated mutation routes, keyed by authenticated
    actor/API key label.
  - Routes: `POST /api/tasks/trigger`,
    `POST /api/approvals/:id/decision`, `POST /api/knowledge/query`.
- **Protected bucket C — admin-export (`10 / 60s`):**
  - Global bucket across admin export routes, keyed by authenticated actor/API
    key label.
  - Routes: `GET /api/knowledge/export`, `GET /api/persistence/export`.
- **Keying model for authenticated buckets:**
  - Primary key: `req.auth.actor`
  - Fallback: `req.auth.apiKeyLabel[:version]`
  - Last-resort fallback (unexpected unauth context): client IP

429 handling contract:

- Protected and public limiters return `ratelimit-limit`,
  `ratelimit-remaining`, `ratelimit-reset`.
- `Retry-After` is explicitly returned on 429 responses.
- Operator clients must back off immediately on 429, respect `Retry-After`
  when present, otherwise wait until `ratelimit-reset` before retry.
- Normal operator-console polling is supported by the viewer-read bucket; UI
  polling should still be staggered/jittered instead of firing synchronized
  bursts across all panels.
