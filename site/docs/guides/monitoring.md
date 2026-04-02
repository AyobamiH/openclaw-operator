---
title: "Monitoring & Observability"
summary: "Check system health and observe what the orchestrator is doing."
---

# Monitoring & Observability

Use this guide for runtime health, scheduled-task visibility, and alerting. This
is the canonical monitoring document; the old root `MONITORING.md` and
`ERROR_ALERTS.md` surfaces are absorbed here.

## Canonical Paths

The default configured paths are:

- legacy state file artifact: `orchestrator_state.json`
- logs directory: `logs/`
- digest output: `logs/digests/`
- runtime state target: `mongo:orchestrator-runtime-state`

When local configuration changes those paths, follow `orchestrator_config.json`.

## Live Logs

```bash
tail -f logs/orchestrator.log
grep "heartbeat" logs/orchestrator.log | tail -10
grep "error\\|ERROR" logs/orchestrator.log
```

## State Checks

The orchestrator persists current runtime state to the configured
`mongo:orchestrator-runtime-state` target in Mongo `system_state`.

```bash
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:3312/api/dashboard/overview | jq
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:3312/api/tasks/catalog | jq '.tasks | length'
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:3312/api/health/extended | jq '.truthLayer'
```

Useful fields to watch:

- `lastStartedAt`
- `taskHistory`
- `redditResponses`
- `rssDrafts`
- `driftRepairs`
- `deployedAgents`

## Heartbeat Health

The control-plane heartbeat is expected every 5 minutes.

It is an internal maintenance scheduler, not a normal operator task lane.
Healthy heartbeat activity is intentionally quiet in normal operator views.

```bash
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:3312/api/dashboard/overview | jq '.maintenance.checks'
```

What the heartbeat owns:

- `system-monitor` maintenance every `5m`
- `security-audit` posture maintenance every `15m`
- `qa-verification` readiness maintenance every `30m`, plus startup preflight

If heartbeat coverage looks stale, treat it as a runtime health warning and
check process liveness immediately.

## Scheduled Task Monitoring

The default recurring tasks are:

- `nightly-batch`
- `send-digest`
- internal `heartbeat`

Watch the relevant events:

```bash
grep -E "nightly-batch|send-digest|heartbeat" logs/orchestrator.log | tail -20
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:3312/api/dashboard/overview | jq '.recentTasks[:10]'
curl -fsS -H "Authorization: Bearer $API_KEY" "http://127.0.0.1:3312/api/tasks/runs?includeInternal=true&limit=20" | jq '.runs[] | {type, visibility, maintenanceCheckId, status, lastHandledAt}'
ls -lah logs/digests/digest-*.json
```

When `nightly-batch` runs, verify:

- a digest file was created in `logs/digests/`
- the task appears in `taskHistory`
- the next `send-digest` task completed or logged a clear failure

## Task And Agent Visibility

```bash
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:3312/api/dashboard/overview | jq '.recentTasks[] | select(.status=="error")'
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:3312/api/agents/overview | jq '.agents[] | {id, lifecycleMode, hostServiceStatus}'
```

This gives you recent failures, agent-heavy task flows, and the current
deployment memory tracked by the runtime. Normal task/run views exclude
internal maintenance by default; add `includeInternal=true` only when you are
doing diagnostics.

## GitHub Push Monitoring

The orchestrator can watch the latest GitHub Actions result for the checked-out
repository, so a failed push shows up in `System Health` even if you never open
GitHub manually.

What it needs:

- a working `gh` CLI in the orchestrator runtime environment
- `gh auth status` already authenticated for the target repository
- the default repo remote, or an explicit override through
  `GITHUB_ACTIONS_MONITOR_REPO`

What it exposes:

- `dependencies.github` in `GET /api/health/extended`
- a runtime note on the `System Health` page when the latest workflow is
  failed, still running, or otherwise warning
- an observed-truth signal and incident when the latest workflow conclusion is
  failed

Quick check:

```bash
gh auth status
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:3312/api/health/extended | jq '.dependencies.github'
```

When the latest workflow fails, treat the pushed repo state as degraded until
the workflow is green again.

## Service Lifecycle Visibility

The current runtime distinguishes worker-first agents from service-expected
agents. Do not infer this from `src/service.ts` alone.

Check the operator surfaces first:

```bash
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:3312/api/agents/overview | jq '.agents[] | {id, lifecycleMode, hostServiceStatus, serviceUnitName, serviceInstalled, serviceRunning}'
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:3312/api/health/extended | jq '.workers'
```

What to look for:

- `lifecycleMode=="service-expected"` means host unit coverage is part of the
  runtime contract
- `hostServiceStatus` tells you whether the unit is running, installed but
  stopped, not installed, probe-unavailable, or not applicable
- `workers.serviceExpectedGapCount` should stay visible during host/service
  troubleshooting

On Linux hosts, confirm the unit state directly:

```bash
systemctl show doc-specialist.service reddit-helper.service --property=Id,LoadState,ActiveState,SubState,UnitFileState --no-pager
```

## Alerts

The orchestrator supports built-in alerting for failure accumulation and
critical runtime problems.

Common environment variables:

```bash
export ALERTS_ENABLED=true
export ALERT_SEVERITY_THRESHOLD=error
export SLACK_ERROR_WEBHOOK=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
export ALERT_EMAIL_TO=ops@example.com
export EMAIL_API_URL=https://your-email-service/send
export EMAIL_API_KEY=your-api-key
```

Alert behavior to expect:

- repeated task failures escalate in severity
- missed heartbeat windows should be treated as critical
- notification delivery failures should still appear in logs even when the
  external channel fails

## Quick Health Pass

```bash
ps aux | grep "node\\|tsx" | grep -v grep
ls -la logs/
curl -fsS http://127.0.0.1:3312/health | jq
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:3312/api/dashboard/overview | jq '.maintenance.checks'
```

## Common Failure Patterns

- No heartbeat for more than 10-15 minutes:
  check if the orchestrator process is down or hung.
- Missing digest file after `nightly-batch`:
  check `logs/orchestrator.log` and `/api/dashboard/overview` for batch errors.
- Notification expected but nothing arrived:
  verify webhook/email configuration and look for notifier errors in the log.
- State or log growth looks abnormal:
  inspect Mongo `system_state`, queue-related arrays, and artifact retention.

## Escalation Rule

When runtime health looks wrong:

1. Check process liveness.
2. Check the maintenance cadence status from `/api/dashboard/overview`.
3. Check the most recent failing task record.
4. Inspect notifier errors if alerts did not arrive.
5. Use [Common Issues](../troubleshooting/common-issues.md) and
   [Debugging](../troubleshooting/debugging.md) for deeper recovery.
