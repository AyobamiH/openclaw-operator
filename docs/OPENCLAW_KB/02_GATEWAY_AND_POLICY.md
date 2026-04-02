# Gateway, Auth, and Policy Enforcement

Last updated: 2026-03-02

## Verified Request Guard Layers

1. Content-length cap middleware (`1MB`) before JSON parsing.
2. Request logging for security events on `>=400` responses.
3. Route-level rate limiting (`webhookLimiter`, `apiLimiter`, `exportLimiter`, `authLimiter`, `healthLimiter`).
4. Authentication:
   - Bearer token for protected API endpoints
   - HMAC signature for webhook endpoint
5. Zod schema validation by body/query source.

## Verified Protection Matrix

| Endpoint | Auth | Validation | Rate Limit |
|---|---|---|---|
| `/health` | Public | None | healthLimiter |
| `/api/knowledge/summary` | Public | None | apiLimiter |
| `/api/persistence/health` | Public | None | healthLimiter |
| `/api/companion/overview` | Bearer | query parsing only | apiLimiter + authLimiter + viewerReadLimiter |
| `/api/companion/catalog` | Bearer | query parsing only | apiLimiter + authLimiter + viewerReadLimiter |
| `/api/companion/incidents` | Bearer | bounded `limit` query parsing | apiLimiter + authLimiter + viewerReadLimiter |
| `/api/companion/runs` | Bearer | bounded `limit` query parsing | apiLimiter + authLimiter + viewerReadLimiter |
| `/api/companion/approvals` | Bearer | bounded `limit` query parsing | apiLimiter + authLimiter + viewerReadLimiter |
| `/api/tasks/trigger` | Bearer | TaskTriggerSchema | apiLimiter + authLimiter |
| `/webhook/alerts` | HMAC | AlertManagerWebhookSchema | webhookLimiter + authLimiter |
| `/api/knowledge/query` | Bearer | KBQuerySchema | apiLimiter + authLimiter |
| `/api/knowledge/export` | Bearer | query format parsing | exportLimiter + authLimiter |
| `/api/persistence/historical` | Bearer | PersistenceHistoricalSchema | apiLimiter + authLimiter |
| `/api/persistence/export` | Bearer | None | exportLimiter + authLimiter |

## Policy Drift Risks

- Bearer token comparison is now constant-time, and key rotation metadata is
  enforced at startup. The remaining gap is operational rotation discipline, not
  absence of code support.
- Query validation regex for KB query is strict ASCII-only; may reject valid multilingual input.
- Signature verification uses recursively sorted canonical JSON, so drift risk
  now centers on caller contract alignment rather than raw `JSON.stringify`
  ordering.

## Governance Position

- **Verified good**: strong baseline middleware stack.
- **Partial runtime**: ToolGate and route-context protections now exist, but
  they are not a full universal governance boundary for every execution path.
- **Deferred / planned**: full manifest boundary enforcement, full skill audit
  wiring, and stronger sandboxing remain future governance work.
- **Needs policy formalization**: key rotation cadence, endpoint ownership
  review cadence, and continued clarity about which internal app routes are
  lifecycle-only versus interactive-user surfaces.

## Workspace Orchestrator Bridge

The workspace now includes a local OpenClaw plugin bridge at:

```text
workspace/.openclaw/extensions/orchestrator-bridge/index.ts
```

This bridge adds a guarded `/orch` command for channels such as Telegram, but it
is intentionally narrower than raw orchestrator API access.

Current boundary:

- The plugin is workspace-origin and therefore disabled by default until
  `plugins.entries.orchestrator-bridge.enabled: true` is set in the OpenClaw
  config.
- In hardened local installs, pin bridge trust with `plugins.allow`, but
  remember that allowlist is global and must also include any stock plugins you
  still expect to load.
- On current OpenClaw builds, provenance warnings for workspace plugins clear
  only when the bridge is also tracked under `plugins.installs` or a trusted
  `plugins.load.paths` entry.
- Task launch is limited by
  `plugins.entries.orchestrator-bridge.config.allowedTasks`, which is an exact
  bridge-local allowlist. The current local install now mirrors the full
  approved public task enum rather than a reduced starter subset, while still
  relying on orchestrator approval gates for sensitive lanes.
- Read surfaces are separately limited by
  `plugins.entries.orchestrator-bridge.config.allowedViews`, which gates the
  bounded companion read family.
- The bridge now uses read-first companion routes on `http://127.0.0.1:3312`
  (`/api/companion/*`) and keeps `POST /api/tasks/trigger` as the only write
  path.
- Auth defaults to a local operator-key discovery path from
  `workspace/orchestrator/.env`, with explicit `apiKey` or `apiKeyEnv` override
  support when needed.

Operational intent:

- Use `/orch status`, `/orch tasks`, `/orch incidents`, `/orch runs`, and
  `/orch approvals` for bounded read-first operational truth.
- Use `/orch <task-type> [json payload]` or
  `/orch run <task-type> [json payload]` for explicit task dispatch.
- Keep high-risk tasks approval-gated in orchestrator even when the bridge
  allowlist includes them.
