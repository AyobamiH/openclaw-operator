---
title: "Quick Start"
summary: "Minimal root-first checklist to boot OpenClaw Operator."
---

# Quick Start Checklist

Use this page when you want the shortest repo-truth path from clone to a
running specialist orchestrator sidecar. OpenClaw itself remains the preferred
front door; `/operator` is the repo-native specialist console.

## Local Root Path

```bash
# 1. Clone
git clone https://github.com/AyobamiH/openclaw-operator.git
cd openclaw-operator

# 2. Install workspace dependencies
npm install

# 3. Create backend env file
cp orchestrator/.env.example orchestrator/.env

# 4. Fill in orchestrator/.env
# - API_KEY_ROTATION or API_KEY
# - WEBHOOK_SECRET
# - OPENAI_API_KEY (usually)

# 5. Start the product
npm run dev
```

Open:

- `http://127.0.0.1:3000/operator`

If your OpenClaw workspace bridge is enabled, prefer OpenClaw plus `/orch`
after the boot succeeds and keep `/operator` for specialist runtime views.

This path is local-file-backed by default, so Mongo and Redis are optional
upgrades instead of first-boot requirements.

If you want the always-on user-service path after the first local boot:

```bash
mkdir -p ~/.config/systemd/user
install -m 0644 systemd/orchestrator.service ~/.config/systemd/user/orchestrator.service
systemctl --user daemon-reload
systemctl --user enable --now orchestrator
```

Then open:

- `http://127.0.0.1:3312/operator`

## Fast Verification

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/api/knowledge/summary
curl http://127.0.0.1:3312/health
curl http://127.0.0.1:4300/health
```

Then either use OpenClaw through `/orch`, or authenticate in `/operator` with
your bearer token for the local specialist console.

## Docker Demo Path

If you want the official public container path instead:

```bash
docker compose up -d --build
npm run docker:demo:smoke
```

Open:

- `http://127.0.0.1:4300/operator`

Demo bearer keys:

- viewer: `demo-viewer-key-local-only`
- operator: `demo-operator-key-local-only`
- admin: `demo-admin-key-local-only`

This path is localhost-only by default and already carries demo-local auth,
MongoDB, and Redis credentials so first boot does not require a private `.env`
file. `npm run docker:demo:smoke` is the local proof that the demo stack came
up healthy and served the built specialist console. Before any shared or
non-local deployment, copy
`docker-compose.override.example.yml` to `docker-compose.override.yml` and
replace the demo values.

If you intentionally want the heavier observability stack instead, use
`orchestrator/docker-compose.yml` plus `orchestrator/.env`.

## Important Notes

- `orchestrator_config.json` at the repo root is the local runtime source of
  truth and now resolves relative path fields from the config file location.
  The default repo-native `stateFile` is `./orchestrator/data/orchestrator-state.json`,
  so first boot is file-backed by default.
- `orchestrator/orchestrator_config.json` is the container-shaped config for
  Docker-based deployment.
- `systemd/orchestrator.service` is the canonical always-on user-service unit
  and assumes the repo lives at `~/openclaw-operator`. If you clone elsewhere,
  update the unit paths before enabling it.
- Root commands are the default command hub for this repo.

## Next

- [Getting Started](./getting-started.md)
- [Architecture Overview](./architecture-overview.md)
- [Configuration](../guides/configuration.md)
