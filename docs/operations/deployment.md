---
title: "Deployment Checklist"
summary: "Production deployment steps and verification."
---

# Deployment Checklist

This runbook is configuration-driven. Do not hardcode state/log locations in operator commands.

## Runtime Prerequisites

- Node.js 20+ (22.x recommended)
- npm
- `orchestrator_config.json` present and valid JSON

## Resolve Runtime Paths First

Run from the repo root:

```bash
STATE_FILE=$(jq -r '.stateFile' orchestrator_config.json)
LOGS_DIR=$(jq -r '.logsDir' orchestrator_config.json)
DOCS_PATH=$(jq -r '.docsPath' orchestrator_config.json)
COOKBOOK_PATH=$(jq -r '.cookbookPath' orchestrator_config.json)

echo "STATE_FILE=$STATE_FILE"
echo "LOGS_DIR=$LOGS_DIR"
echo "DOCS_PATH=$DOCS_PATH"
echo "COOKBOOK_PATH=$COOKBOOK_PATH"
```

## Choose Deployment Mode (Non-Interchangeable)

### Mode A: Official Public Docker Demo

Use the repo-root `docker-compose.yml` when you want the supported public
container path:

```bash
docker compose -f docker-compose.yml config --services
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps
bash scripts/docker-demo-smoke.sh
```

Operational truth for Mode A:

- brings up `orchestrator`, `mongo`, and `redis`
- serves the canonical `/operator` console on `127.0.0.1:4300`
- ships demo-local auth/database/cache credentials directly in compose so a
  new user can boot without creating `orchestrator/.env`
- keeps host exposure localhost-only by default
- should be treated as a try-it path, not a production credential posture
- has a dedicated smoke path in `scripts/docker-demo-smoke.sh` and the
  `Docker Demo Smoke` GitHub Actions workflow

Before any shared or non-local deployment:

```bash
cp docker-compose.override.example.yml docker-compose.override.yml
# edit docker-compose.override.yml with real keys, passwords, and ports
docker compose -f docker-compose.yml up -d --build
```

### Mode B: Advanced Observability Compose

Use `orchestrator/docker-compose.yml` only when you intentionally need the
heavier stack with Prometheus, Grafana, and Alertmanager:

```bash
cp orchestrator/.env.example orchestrator/.env
docker compose -f orchestrator/docker-compose.yml config --services
docker compose -f orchestrator/docker-compose.yml up -d --build
docker compose -f orchestrator/docker-compose.yml ps
```

Operational truth for Mode B:

- the orchestrator container is forced onto the local `mongo` service even if
  the host `.env` used outside Docker points at an external database
- MongoDB and Redis image versions must stay compatible with any existing named
  volumes on the host
- this is the advanced stack, not the first-run public path

Do not run both modes simultaneously on the same host without port planning.
If you already have named Docker volumes from newer MongoDB or Redis images,
do not silently downgrade the images in compose. Keep the image versions
compatible with the stored data or reset those volumes intentionally.

## Pre-Deployment Checklist

- [ ] `npm --prefix orchestrator run build`
- [ ] `npm --prefix orchestrator run test:integration`
- [ ] `bash scripts/check-doc-drift.sh`
- [ ] `jq . orchestrator_config.json >/dev/null`
- [ ] Required env vars prepared for the selected mode:
  - Mode A: override file created if you are replacing the built-in demo-local
    credentials or provider keys
  - Mode B: `API_KEY_ROTATION` or `API_KEY`
  - Mode B: `WEBHOOK_SECRET`
  - Mode B: `MONGO_USERNAME`
  - Mode B: `MONGO_PASSWORD`
  - Mode B: `REDIS_PASSWORD`
  - `OPENCLAW_MODEL_PRICING_JSON` if you want to override the built-in model pricing catalog for runtime cost accounting

## Post-Deployment Verification

- [ ] API health:
  ```bash
  curl -fsS http://127.0.0.1:4300/health
  # or for Mode B:
  # curl -fsS http://localhost:3000/health
  ```
- [ ] State file exists at config path:
  ```bash
  test -f "$STATE_FILE" && echo "state file present"
  ```
- [ ] Last task entry readable:
  ```bash
  jq '.taskHistory[-1]' "$STATE_FILE"
  ```
- [ ] Logs directory exists:
  ```bash
  test -d "$LOGS_DIR" && ls -la "$LOGS_DIR" | head
  ```

## Release-Proof Gaps

Keep this list visible during release work. These are not hypothetical risks;
they are the main still-unproven surfaces after the current release-hardening
passes.

- [ ] `reddit-response` provider-success branch is proven live
  Bounded fixture coverage now proves the `hybrid-polished` branch and the
  fallback branches, but the latest live runtime evidence is still a `429
  quota exceeded` fallback rather than a successful provider-polished draft.
- [x] Agent `serviceRunning` is host-proven where claimed (`2026-03-09`; current host truth is `serviceInstalledCount=0`, `serviceRunningCount=0`)
  `serviceAvailable` is not the same thing as a running service process.
- [x] Canonical non-fast-start launch is proven on port `3312`
  Proven on `2026-03-09`: non-fast-start boot now reaches Mongo-backed
  persistence, KnowledgeIntegration, and `HTTP server listening on port 3312`.
  The synthetic orchestrator-local memory scheduler was removed on `2026-03-21`;
  crash-safe continuity now lives in the workspace root memory files instead of
  a local snapshot/consolidation side path.
- [x] Public milestone and demand proof are orchestrator-owned and
  integration-proven
  The active runtime no longer depends on retired external ingest endpoints;
  direct integration coverage now exercises the public proof routes against
  seeded runtime state.
- [x] Redis / Valkey first-slice coordination is real
  The current runtime now uses shared coordination for queue execution claims,
  doc-repair locks/cooldowns, and reddit-helper shared budgets when `REDIS_URL`
  is reachable; `/api/persistence/health` exposes explicit degraded truth when
  coordination falls back to memory.

## systemd Host Service Path

Use this when the host/runtime contract requires persistent service coverage.
In the current runtime slice, that expectation is explicit for
`doc-specialist` and `reddit-helper`; other agents remain worker-first unless
the orchestrator truth changes.

- Unit examples are in `systemd/`.
- Keep `WorkingDirectory` and file paths consistent with your deployed checkout.
- Prefer `journalctl -u orchestrator -f` for first-line diagnostics.
- Verify runtime truth through `/api/agents/overview` and `/api/health/extended`
  before treating a unit file as required service coverage.

## Safe Rollback Plan

If deployment fails:

1. Stop service/stack:
   ```bash
   docker compose -f docker-compose.yml down
   # or for advanced mode:
   # docker compose -f orchestrator/docker-compose.yml down
   ```
2. Checkout a known-good tag or commit (non-destructive):
   ```bash
   git fetch --tags
   git checkout <known-good-tag-or-sha>
   ```
3. Restore state from backup to configured state path:
   ```bash
   cp /backup/orchestrator-state-latest.json "$STATE_FILE"
   ```
4. Rebuild and start selected mode again.
5. Re-run post-deploy verification checks.

## Operational Notes

- Use [RUNBOOK_BOUNDARIES.md](../../operations/RUNBOOK_BOUNDARIES.md) to keep mode decisions consistent.
- Use [backup-recovery.md](./backup-recovery.md) for state/config backup policy.
- The official public compose path is the repo-root demo stack on `4300`.
- The advanced observability stack lives under `orchestrator/docker-compose.yml`.
- Docker Compose in this repo is orchestrator-only. The retired
  `openclawdbot` package is not part of either compose mode.
- If docs and code conflict, code/config is canonical and docs must be updated in the same change set.
