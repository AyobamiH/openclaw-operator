# OpenClaw Operator Deployment Guide

This guide is for host-style deployment after you have already validated a
local boot from the repo root. OpenClaw Operator ships one control plane and
one operator UI entrypoint: the orchestrator serves the built
`operator-s-console` bundle at `/operator`.

> **Two Docker Compose files exist — use the right one:**
> - `./docker-compose.yml` — **Official public quickstart**. Root localhost-only demo stack with orchestrator + MongoDB + Redis.
> - `./orchestrator/docker-compose.yml` — Advanced observability stack with Prometheus, Grafana, and Alertmanager. Run from `./orchestrator/`.

## Quick Start (user-level systemd)

### Prerequisites
- Node.js 22.x installed
- systemd user services available (Linux systems)

### Installation

1. **Build the operator workspace:**
```bash
cd openclaw-operator
npm install
cp orchestrator/.env.example orchestrator/.env
# fill in orchestrator/.env
npm run build
```

2. **Install the user service:**
```bash
mkdir -p ~/.config/systemd/user
install -m 0644 systemd/orchestrator.service ~/.config/systemd/user/orchestrator.service
systemctl --user daemon-reload
```

3. **Start the service:**
```bash
systemctl --user enable --now orchestrator
```

4. **Monitor:**
```bash
# Check status
systemctl --user status orchestrator

# View logs
journalctl --user -u orchestrator -f

# Check if running
systemctl --user is-active orchestrator
```

The tracked unit expects the repo at `~/openclaw-operator`, uses
`tsx + src/index.ts`, serves the built operator UI from
`~/openclaw-operator/operator-s-console/dist`, and binds the always-on control
plane to `3312`.

---

## Docker Deployment (Official Public Path)

Uses `./docker-compose.yml`. Brings up orchestrator + MongoDB + Redis.
The operator console is served by that same orchestrator process at `/operator`;
there is no second UI server to deploy.

### Prerequisites

The official public Docker path ships with demo-local auth/database/cache
credentials already in `./docker-compose.yml`, so you do not need to
create `orchestrator/.env` for a first localhost run.

If you want real keys, different ports, or non-demo credentials:

```bash
cp docker-compose.override.example.yml docker-compose.override.yml
# edit docker-compose.override.yml
```

### Build and Start

```bash
cd openclaw-operator
docker compose up -d --build
```

### Run with Docker Compose

```bash
# Start all services
docker compose up -d

# View orchestrator logs
docker compose logs -f orchestrator

# Check health
docker ps
curl http://127.0.0.1:4300/health
```

### Advanced Observability Path

```bash
cd openclaw-operator/orchestrator
cp .env.example .env
docker compose up -d --build
docker compose ps
curl http://localhost:3000/health
```

Use this only when you intentionally need Prometheus, Grafana, and
Alertmanager in addition to the core control plane services.

### Build a standalone image (without compose)

Only use this when you already have external MongoDB and Redis targets
available. The official first-run Docker path is still `docker compose up` from
the repo root.

```bash
cd openclaw-operator
docker build -f Dockerfile -t openclaw-operator:latest .

docker run -d \
  --name openclaw-operator \
  -p 127.0.0.1:4300:3000 \
  -e API_KEY_ROTATION='[{"key":"demo-operator-key-local-only","label":"operator-key","roles":["operator"],"expiresAt":"2030-01-01T00:00:00.000Z"}]' \
  -e WEBHOOK_SECRET=demo-local-only-webhook-secret \
  -e MONGO_USERNAME=demo-orchestrator \
  -e MONGO_PASSWORD=demo-local-only-mongo-password \
  -e DATABASE_URL='mongodb://demo-orchestrator:demo-local-only-mongo-password@host.docker.internal:27017/orchestrator?authSource=admin' \
  -e REDIS_PASSWORD=demo-local-only-redis-password \
  -e REDIS_URL='redis://:demo-local-only-redis-password@host.docker.internal:6379/0' \
  openclaw-operator:latest
```

---

## systemd Service Management

### Common Commands

```bash
# Start
systemctl --user start orchestrator

# Stop
systemctl --user stop orchestrator

# Restart
systemctl --user restart orchestrator

# Reload (for config changes)
systemctl --user restart orchestrator

# Check status
systemctl --user status orchestrator

# View recent logs
systemctl --user status orchestrator -n 50

# Enable/disable on boot
systemctl --user enable orchestrator
systemctl --user disable orchestrator
```

### Logs

```bash
# Real-time logs
journalctl --user -u orchestrator -f

# Last 50 lines
journalctl --user -u orchestrator -n 50

# Since boot
journalctl --user -u orchestrator --since boot

# Time range
journalctl --user -u orchestrator --since "2 hours ago"
```

---

## Configuration

### Environment Variables

Edit `~/.config/systemd/user/orchestrator.service`:

```ini
[Service]
Environment="LOG_LEVEL=debug"
Environment="ALERTS_ENABLED=true"
Environment="SLACK_ERROR_WEBHOOK=https://hooks.slack.com/..."
```

Then reload:
```bash
systemctl --user daemon-reload
systemctl --user restart orchestrator
```

### Config Files

- **orchestrator_config.json** - Main configuration
  - docsPath: Path to OpenClaw documentation
  - cookbookPath: Path to OpenAI cookbook
  - knowledgePackDir: Where to save knowledge packs

- **rss_filter_config.json** - RSS feed configuration and scoring weights

- **stateFile target** - Runtime state target from `orchestrator_config.json`
  (current default: `mongo:orchestrator-runtime-state`)

---

## Health Checks

### systemd Health

```bash
# Is service running?
systemctl --user is-active orchestrator

# Check for restarts
systemctl --user status orchestrator | grep "Restart"
```

### Control-Plane Health

The orchestrator exposes runtime truth through its HTTP surfaces:
- `/health`: shallow liveness
- `/api/persistence/health`: persistence + coordination status
- `/api/runtime/facts`: effective config, heartbeat schedule, and service model
- `/api/tasks/runs?includeInternal=true`: visible task and maintenance history

```bash
curl -fsS http://127.0.0.1:3312/health | jq
```

### Manual Test

```bash
# Check if knowledge pack exists
ls -lh logs/knowledge-packs/

# Check if digests are being created
ls -lh logs/digests/ | tail -5

# Check recent activity
tail -20 logs/orchestrator.log 2>/dev/null || echo "No log file yet"
```

---

## Troubleshooting

### Service won't start

1. **Check syntax:**
```bash
systemd-analyze --user verify ~/.config/systemd/user/orchestrator.service
```

2. **Check permissions:**
```bash
ls -la orchestrator/dist/
```

3. **Check Node.js path:**
```bash
which node
node -v
```

4. **Check logs:**
```bash
journalctl --user -u orchestrator -n 100 --no-pager
```

### High memory usage

Check `systemd/orchestrator.service` memory limits:
```ini
MemoryLimit=1G
```

Increase or remove if needed, then:
```bash
systemctl --user daemon-reload
systemctl --user restart orchestrator
```

### Task failures

1. Check recent runs in `/api/tasks/runs?includeInternal=true`
2. View full logs: `journalctl --user -u orchestrator -f`
3. Validate config: `cat orchestrator_config.json | jq`

---

## Production Checklist

- [ ] systemd service file installed
- [ ] Knowledge packs generated: `logs/knowledge-packs/`
- [ ] Configuration files present: orchestrator_config.json, rss_filter_config.json
- [ ] Logs directory writable: `logs/`
- [ ] Documentation paths exist: openclaw-docs/, openai-cookbook/
- [ ] Service starts cleanly: `systemctl start orchestrator`
- [ ] Service auto-restarts: `systemctl --user is-active orchestrator`
- [ ] Logs are being written: `journalctl --user -u orchestrator | head`
- [ ] Tasks running on schedule: check `/api/runtime/facts` and `/api/tasks/runs?includeInternal=true`

---

## CI/CD Integration

GitHub Actions workflows automatically:
- **test.yml**: Builds and validates on PR
- **deploy.yml**: Creates deployment artifact on merge to main

To enable:
1. Push `.github/workflows/` to repository
2. GitHub Actions will run automatically on PRs and merges
3. Deployment artifacts available in Actions tab

---

## Monitoring & Alerts

The orchestrator includes built-in alerting:

1. **Error accumulation**: Task failures tracked across retries
2. **Critical alerts**: After 3 consecutive failures
3. **Email notifications**: Optional via environment variables
4. **Slack integration**: Optional webhook (see `docs/guides/monitoring.md`)

Configure alerts in `.service` file:
```ini
Environment="ALERTS_ENABLED=true"
Environment="ALERT_EMAIL_TO=ops@example.com"
```
