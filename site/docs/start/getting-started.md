---
title: "Getting Started"
summary: "Install and run OpenClaw Operator from the repo root."
read_when:
  - First time setting up
  - Deploying locally
---

# Getting Started with OpenClaw Operator

Get OpenClaw Operator running locally from the repo root in under 10 minutes.
The recommended first run installs both the control plane and the canonical
operator console, then serves the UI at `/operator`.

## Prerequisites

- Node.js 22+ (latest LTS recommended)
- npm
- ~200MB free disk space for the default text-and-clues mirrors and logs
- `API_KEY_ROTATION` or `API_KEY`
- `WEBHOOK_SECRET`
- One model provider API key for the agent mix you plan to use

## Installation

### 1. Clone or Navigate to Workspace

```bash
git clone https://github.com/AyobamiH/openclaw-operator.git
cd openclaw-operator
```

### 2. Install Dependencies

```bash
npm install
```

This root install covers both `orchestrator/` and `operator-s-console/`.

### 3. Configure

```bash
cp orchestrator/.env.example orchestrator/.env
# edit orchestrator/.env with your real values
```

At minimum, set:

- `API_KEY_ROTATION` or `API_KEY`
- `WEBHOOK_SECRET`
- `DATABASE_URL`
- `MONGO_USERNAME`
- `MONGO_PASSWORD`
- `REDIS_PASSWORD`
- `OPENAI_API_KEY`

If you plan to enable Anthropic-backed paths, also set `ANTHROPIC_API_KEY`.

### 4. Check Runtime Paths

```json
{
  "docsPath": "./openclaw-docs",
  "logsDir": "./logs",
  "stateFile": "mongo:orchestrator-runtime-state",
  "rssConfigPath": "./rss_filter_config.json",
  "redditDraftsPath": "./logs/reddit-drafts.jsonl"
}
```

These values come from `orchestrator_config.json` in the repo root. Change them
only if your local layout differs from the default repo layout. Relative path
fields are resolved from the config file location.

### 5. Create a Place for Target Repos

If you want OpenClaw Operator to work on other projects, keep those repos
inside this workspace tree.

```bash
mkdir -p projects
```

Recommended layout:

```text
workspace/
  projects/
    my-client-site/
    another-client-app/
```

Use task scopes relative to the workspace root, for example:

- `projects/my-client-site`
- `projects/my-client-site/src`
- `projects/my-client-site/app/page.tsx`

This matters because the current worker permissions and bounded code-edit lanes
are scoped to `workspace`, not your whole machine.

### 6. Sync Official Docs (Optional)

```bash
./sync_docs_sources.sh
```

This keeps `openclaw-docs/` current and refreshes a small text-and-clues
`openai-cookbook/` mirror. That baseline includes curated markdown, code, and
config files that agents can mine for implementation clues. If you skip it, the
system will use whatever is already present locally.

Treat `openclaw-docs/` as a managed local knowledge mirror, not ordinary
feature code. In the runtime it feeds the doc index, `drift-repair`,
`logs/knowledge-packs/`, and grounded lanes such as `reddit-response`.

Recommended policy:

- refresh it intentionally
- do not mix mirror churn into normal feature commits
- if you want to version a refresh, use a dedicated commit such as
  `docs(openclaw-docs): sync upstream mirror`

If you explicitly want the broader upstream cookbook mirror for local
exploration, use:

```bash
./sync_docs_sources.sh --mode=full
```

That full mode is intended for local enrichment, not for expanding the
committed repository baseline.

When the mirror changes, run `drift-repair` before you treat the latest Reddit
or content draft as current. The serving layer for those agents is the latest
knowledge pack, not the raw docs tree.

### 7. Run

```bash
npm run dev
```

You should see output like:

```
[orchestrator] config loaded { docsPath: './openclaw-docs', ... }
[orchestrator] indexed 42 docs
[orchestrator] HTTP server listening on port 3000
```

## Verify It's Running

### Check Health and Knowledge Summary

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/api/knowledge/summary
```

### Open the Operator Console

```bash
xdg-open http://127.0.0.1:3000/operator
```

If you are on a headless machine, open that URL in your browser manually.

### Check Task History

```bash
curl -fsS -H "Authorization: Bearer <your-api-key>" \
  "http://127.0.0.1:3000/api/tasks/runs?limit=10" | jq '.runs'
```

## Where To Look For Output

Use this rule of thumb from day one:

1. `Tasks` launches work
2. `Runs` is the main output surface
3. `logs/` is only for lanes that write named artifacts

Common output locations:

- `/operator/runs` — summaries, findings, traces, workflow evidence,
  verification output
- `logs/knowledge-packs/` — `drift-repair` / `doc-specialist`
- `logs/reddit-drafts.jsonl` — `reddit-response` draft output
- `logs/devvit-submissions.jsonl` — Reddit/devvit dispatch payloads
- the scoped target repo itself — `build-refactor`
- `agents-deployed/` — `agent-deploy`

## Starter Service Recipes

Once the stack is up, use one of these concrete lanes first:

- **Client audit** — `security-audit` -> `system-monitor` -> optional
  `content-generate`
- **Scoped feature build** — `build-refactor` -> approval (if required) ->
  `qa-verification`
- **Handoff package** — `drift-repair` -> `summarize-content` ->
  `content-generate`

For the exact task flow, sample payloads, and expected output locations, see
[Running Agents](../guides/running-agents.md#service-recipes).

For a visual operator path through one real recipe, use
[Running Agents](../guides/running-agents.md#operator-walkthrough).

## First Steps

### 1. Understand the Config

Read [Configuration](../guides/configuration.md) to learn what each setting does.

### 2. Monitor the System

Watch the logs folder to see what's happening:

```bash
ls -la logs/

# Key files to watch:
tail -f logs/orchestrator.log           # Main activity log
curl -fsS -H "Authorization: Bearer <your-api-key>" \
  http://127.0.0.1:3000/api/runtime/facts | jq   # Effective runtime facts
head -20 logs/reddit-drafts.jsonl  # Latest Reddit drafts
```

Important note:

- most `logs/*-service.json` files are heartbeat and last-run memory for an
  agent, but only `doc-specialist` and `reddit-helper` should be treated as
  resident service-loop heartbeat sources
- if you want the real result of a task, check `/operator/runs` first

### 3. Run Your First Task

Trigger a drift repair to test agent execution:

```bash
curl -X POST http://127.0.0.1:3000/api/tasks/trigger \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"type":"drift-repair","payload":{"source":"docs"}}'
```

This will:
- enqueue a bounded task through the public trigger contract
- run the `doc-specialist` worker
- generate or refresh a knowledge pack
- write a first-class task run into orchestrator state

Check the output:

```bash
ls -la logs/knowledge-packs/
curl -fsS -H "Authorization: Bearer <your-api-key>" \
  "http://127.0.0.1:3000/api/tasks/runs?limit=1&type=drift-repair" | jq '.runs[0]'
```

Then look in the operator:

- `/operator/runs` for the run summary
- `/operator/agents` for agent readiness and lifecycle
- `/operator/incidents` if you are using repair or verification lanes

### 4. Read the Architecture

Now that it's running, read [Architecture Overview](../start/architecture-overview.md) to understand what you're looking at.

## Troubleshooting

### "Cannot find module @types/node"

```bash
# Reinstall dependencies
npm install
```

### "ENOENT: no such file or directory 'openclaw-docs'"

```bash
# Sync docs
./sync_docs_sources.sh

# Or create empty directory
mkdir openclaw-docs
touch openclaw-docs/README.md
```

### "Port already in use" or "EADDRINUSE"

The operator runtime binds to a network port. If you see this, check for
leftover Node processes:

```bash
ps aux | grep "[n]ode"
pkill -f "node.*orchestrator"
```

### "State file doesn't exist"

This is normal when the runtime is using the default Mongo-backed
`stateFile`. A local file only appears if you explicitly configure one:

```bash
# Check the effective configured target
cat orchestrator_config.json | jq '.stateFile'
```

## Next Steps

- **[Architecture Overview](../start/architecture-overview.md)** — Understand what's running
- **[Configuration](../guides/configuration.md)** — Customize settings
- **[Running Agents](../guides/running-agents.md)** — Deploy new agents
- **[Monitoring](../guides/monitoring.md)** — Set up continuous monitoring

## Need Help?

Check [Common Issues](../troubleshooting/common-issues.md) or review [Debugging](../troubleshooting/debugging.md).
