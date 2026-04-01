# OpenClaw Operator — Quick Start

This is the fastest way to get the repo running as a self-hosted operator
workspace. The recommended first run is the root local-dev path, which starts
the orchestrator and serves the canonical operator console at `/operator`.

## Deployment Paths

### Path A: Recommended First Run (Root Local Dev)

```bash
cd openclaw-operator
npm install
cp orchestrator/.env.example orchestrator/.env
# fill in the required vars in orchestrator/.env
npm run dev
```

Open `http://127.0.0.1:3000/operator`.

Config: `./orchestrator_config.json` (repo-relative paths for local dev)

**Systemd service**: `./systemd/orchestrator.service`

If you want the always-on user-service path on `3312` after the first local
boot:

```bash
mkdir -p ~/.config/systemd/user
install -m 0644 systemd/orchestrator.service ~/.config/systemd/user/orchestrator.service
systemctl --user daemon-reload
systemctl --user enable --now orchestrator
```

Then open `http://127.0.0.1:3312/operator`. The tracked service assumes the
repo lives at `~/openclaw-operator`; if you clone elsewhere, update the unit
paths before enabling it.

---

### Path B: Official Docker Demo Stack

This is the supported public Docker path. It brings up the orchestrator,
MongoDB, and Redis from the repo root and serves the operator console on a
localhost-only port.

```bash
cd openclaw-operator
docker compose up -d --build
npm run docker:demo:smoke
```

Open `http://127.0.0.1:4300/operator`.

Demo bearer keys:

- viewer: `demo-viewer-key-local-only`
- operator: `demo-operator-key-local-only`
- admin: `demo-admin-key-local-only`

The Docker quickstart uses `./orchestrator/orchestrator_config.json`
inside the container image and keeps the default host exposure on
`127.0.0.1:4300` so it does not collide with the common repo-native dev port.

If you want real provider keys, different ports, or non-demo credentials:

```bash
cp docker-compose.override.example.yml docker-compose.override.yml
# edit docker-compose.override.yml
docker compose up -d --build
npm run docker:demo:smoke
```

### Path C: Advanced Observability Stack

Use `./orchestrator/docker-compose.yml` only when you intentionally
want the heavier stack with Prometheus, Grafana, and Alertmanager.

```bash
cd openclaw-operator/orchestrator
cp .env.example .env
# fill in all required vars (see below)
docker compose up -d --build
```

---

## Environment Variables

Local root dev vars live in `./orchestrator/.env`.

| Variable | Required | Notes |
|---|---|---|
| `API_KEY_ROTATION` or `API_KEY` | ✅ | Bearer auth for protected operator APIs |
| `WEBHOOK_SECRET` | ✅ | Security posture check — orchestrator refuses to start without it |
| `MONGO_USERNAME` | ✅ (Docker) | MongoDB auth |
| `MONGO_PASSWORD` | ✅ (Docker) | MongoDB auth |
| `REDIS_PASSWORD` | ✅ (Docker) | Redis auth |
| `DATABASE_URL` | ✅ | Full MongoDB connection URL |
| `REDIS_URL` | ✅ | Full Redis connection URL |
| `OPENAI_API_KEY` | Usually | Needed for the common agent mix |
| `ANTHROPIC_API_KEY` | Optional | Needed only for Anthropic-backed paths you enable |
| `SLACK_ERROR_WEBHOOK` | Optional | Alert delivery to Slack |

Docker demo note:

- the official root Docker path ships demo-local auth/database/cache
  credentials directly in `docker-compose.yml`
- that makes first boot easy, but those values are only for localhost try-outs
- replace them through `docker-compose.override.yml` before any shared or
  non-local deployment

---

## Verify OpenClaw Operator Is Running

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/api/knowledge/summary
curl http://127.0.0.1:3312/health
curl http://127.0.0.1:4300/health
```

Then open `http://127.0.0.1:3000/operator` for root local dev,
`http://127.0.0.1:3312/operator` for the user service, or
`http://127.0.0.1:4300/operator` for the Docker demo and confirm the console
loads.

---

## Scheduled Tasks (in-process)

| Schedule | Task | What |
|---|---|---|
| `0 23 * * *` (11pm UTC) | `nightly-batch` | Collect leads, mark high-confidence, create digest |
| `0 6 * * *` (6am UTC) | `send-digest` | Send digest notification |
| Every 5 min | `heartbeat` | Health check |

---

## Public Proof Surface

The public proof routes are now served directly by the orchestrator. No
separate proof app or ingest pipeline is required for the active local runtime.

Public read-only surfaces:

- `GET /api/command-center/overview`
- `GET /api/command-center/control`
- `GET /api/command-center/demand`
- `GET /api/command-center/demand-live`
- `GET /api/milestones/latest`
- `GET /api/milestones/dead-letter`

---

## Troubleshooting

**Operator won't start** — for root local dev, check `orchestrator/.env` for
`API_KEY_ROTATION` or `API_KEY`, `WEBHOOK_SECRET`, `DATABASE_URL`, and
`REDIS_URL`. For Docker demo, run `docker compose logs -f orchestrator`.

**Public proof looks stale** — check `/api/milestones/latest`, `/api/milestones/dead-letter`, and `/api/command-center/overview` before assuming a queue or UI problem.

**Slack alerts not arriving** — verify `SLACK_ERROR_WEBHOOK` is set and test with:
```bash
curl -X POST "$SLACK_ERROR_WEBHOOK" -d '{"text":"test"}'
```

---

## Deployment Checklist

- [ ] `.env` created with all required vars for Path A or Path C
- [ ] `npm install` run in the repo root (root `postinstall` installs orchestrator and operator console deps)
- [ ] `npm run dev` rebuilds the operator console bundle and starts the orchestrator from the repo root
- [ ] `http://127.0.0.1:3000/operator`, `http://127.0.0.1:3312/operator`, or `http://127.0.0.1:4300/operator` loads the canonical operator console
- [ ] `/operator` loads the built operator console instead of a fixture bundle
- [ ] Public proof routes respond from the orchestrator: `/api/milestones/latest` and `/api/command-center/overview`

## Root Command Hub

The root `package.json` is now the default command hub for the active
control plane:

```bash
cd openclaw-operator
npm run build
npm run typecheck
npm run test
npm run test:unit
npm run test:integration
npm run docs:drift
npm run docs:links
npm run clean:dry-run
```

`npm run clean` is intentionally conservative: it removes cache, coverage, and
TypeScript build-info artifacts only. Frontend `dist/` cleanup is opt-in via
`npm run clean:builds`.
