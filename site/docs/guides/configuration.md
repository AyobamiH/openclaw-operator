---
title: "Configuration"
summary: "Configure orchestrator_config.json and environment settings."
---

# Configuration

The runtime source of truth is:

- `orchestrator_config.json` at the workspace root
- agent-specific `agent.config.json` files under `agents/*/`
- environment variables used by the orchestrator process

If this guide conflicts with code or config, code and config win.

## Main Config File

The primary runtime config is:

```text
workspace/orchestrator_config.json
```

You can override that path with:

```bash
export ORCHESTRATOR_CONFIG=/path/to/alternate-config.json
```

## Core Required Fields

These fields define the minimum runtime surface:

```json
{
  "docsPath": "./openclaw-docs",
  "logsDir": "./logs",
  "stateFile": "mongo:orchestrator-runtime-state"
}
```

`stateFile` is a runtime target, not only a filesystem path. In the live host
posture it now points at a Mongo-backed state key.

## Common Operational Fields

These are frequently used in the current workspace:

```json
{
  "cookbookPath": "./openai-cookbook",
  "knowledgePackDir": "./logs/knowledge-packs",
  "redditDraftsPath": "./logs/reddit-drafts.jsonl",
  "rssConfigPath": "./rss_filter_config.json",
  "digestDir": "./logs/digests",
  "deployBaseDir": "./agents-deployed"
}
```

`cookbookPath` is optional. If it is omitted, the orchestrator should continue
with `docsPath` indexing only. If it is present, it should point at a local
OpenAI Cookbook mirror; the default sync is a curated text-and-clues baseline,
and a broader full sync is an explicit operator choice.

`docsPath` should be treated as a managed local knowledge mirror. It is not the
same thing as first-party product docs under `docs/`, and it should not be
mixed into routine feature commits. The recommended pattern is:

- sync `openclaw-docs/` intentionally
- regenerate knowledge packs through `drift-repair`
- if you commit the mirror refresh at all, do it in a dedicated commit such as
  `docs(openclaw-docs): sync upstream mirror`

For grounded drafting lanes like `reddit-response`, the serving layer is the
latest knowledge pack in `knowledgePackDir`. If `docsPath` is newer than that
pack, operators should refresh `drift-repair` before treating the draft as
current.

## Environment Variables

Important orchestrator runtime variables include:

```bash
API_KEY=...
WEBHOOK_SECRET=...
MONGO_USERNAME=...
MONGO_PASSWORD=...
REDIS_PASSWORD=...
ORCHESTRATOR_FAST_START=true|false
```

## OpenClaw Gateway Companion Config

The workspace also ships a local OpenClaw bridge plugin at:

```text
workspace/.openclaw/extensions/orchestrator-bridge/
```

This is not part of `orchestrator_config.json`; it is enabled from the main
OpenClaw config (`~/.openclaw/openclaw.json`) because it runs on the gateway
side and forwards a narrow allowlisted task set into the orchestrator.

Minimal enablement example:

```json
{
  "plugins": {
    "allow": ["orchestrator-bridge", "memory-core", "telegram"],
    "entries": {
      "orchestrator-bridge": {
        "enabled": true,
        "config": {
          "baseUrl": "http://127.0.0.1:3312",
          "allowedViews": [
            "status",
            "tasks",
            "incidents",
            "runs",
            "approvals"
          ],
          "allowedTasks": [
            "control-plane-brief",
            "incident-triage",
            "release-readiness",
            "drift-repair",
            "reddit-response",
            "security-audit",
            "summarize-content",
            "system-monitor",
            "build-refactor",
            "content-generate",
            "integration-workflow",
            "normalize-data",
            "market-research",
            "data-extraction",
            "qa-verification",
            "skill-audit",
            "rss-sweep",
            "nightly-batch",
            "send-digest",
            "agent-deploy",
            "doc-sync"
          ]
        }
      }
    }
  }
}
```

Read-first bridge behavior:

- `allowedViews` controls which bounded companion read surfaces the bridge may
  expose through `/orch status`, `/orch tasks`, `/orch incidents`,
  `/orch runs`, and `/orch approvals`
- `allowedTasks` controls which explicit write-side task dispatches remain
  available through `/orch run <task-type>` or `/orch <task-type>`
- the bridge should use `/api/companion/*` for reads and keep
  `POST /api/tasks/trigger` as the only write path

If you set `plugins.allow`, remember it is global. Include every plugin id you
still expect to load, including stock plugins such as `telegram` or
`memory-core`, not just the workspace bridge.

On current OpenClaw builds, `plugins.allow` hardens discovery but does not by
itself provide provenance for workspace-local plugins. To suppress the
"untracked local code" warning, also record the bridge under `plugins.installs`
or register it with `openclaw plugins install --link`.

By default the bridge tries to resolve an operator bearer token from
`workspace/orchestrator/.env`. You can override that with plugin config fields
such as `apiKey`, `apiKeyEnv`, or `envFilePath` if the local runtime layout
changes.

## Agent-Level Config

Each agent may extend the runtime surface with its own config file:

```text
workspace/agents/<agent-id>/agent.config.json
```

Those files define:

- model selection
- allowed skills
- service state paths
- orchestrator state path
- agent-specific runtime limits

## Where To Look Next

- [../reference/api.md](../reference/api.md): config-adjacent interfaces and
  runtime behavior
- [../reference/state-schema.md](../reference/state-schema.md): state file
  summary
- [../../OPENCLAW_CONTEXT_ANCHOR.md](../../OPENCLAW_CONTEXT_ANCHOR.md): current
  canonical runtime orientation
