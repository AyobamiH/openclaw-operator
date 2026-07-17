---
title: "State Schema"
summary: "Current summary of the orchestrator runtime state object."
---

# State Schema

The retained host orchestrator runtime state target is:

```text
sqlite:/home/oneclickwebsitedesignfactory/.openclaw/workspace/orchestrator/data/operator.sqlite
```

The public repo default remains `./orchestrator/data/orchestrator-state.json`
for local-first onboarding. Runtime truth comes from the workspace-root
`orchestrator_config.json`, not from the public default.

The canonical schema lives in:

```text
workspace/orchestrator/src/types.ts
```

This document is a current summary, not a replacement for the source type
definitions.

## Normalized SQLite Layout

SQLite schema `openclaw-operator-normalized` version 2 stores the runtime
object without a single JSON blob:

- `orchestrator_state_meta` stores aggregate version, timestamp, size, section
  count, and checksum metadata.
- `orchestrator_state_sections` stores one row per top-level state field.
- `orchestrator_state_array_items` stores each top-level array item separately,
  with stable ordinal and checksum evidence.
- typed historical tables cover metrics, alerts, knowledge, consolidations,
  snapshots, system state, audit logs, concepts, and concept links.
- migration tables retain per-run counts/checksums and a lossless canonical
  archive of each source Mongo document.

The database uses WAL, full synchronous writes, foreign keys, and atomic state
transactions. Mongo is not used or dual-written after a SQLite target is
selected; any retained Mongo database is rollback evidence only.

## Root Structure

```typescript
interface OrchestratorState {
  lastStartedAt: string | null;
  updatedAt: string | null;
  indexedDocs: number;
  docIndexVersion: number;
  pendingDocChanges: string[];
  taskHistory: TaskRecord[];
  taskExecutions: TaskExecutionRecord[];
  approvals: ApprovalRecord[];
  driftRepairs: DriftRepairRecord[];
  redditQueue: RedditQueueItem[];
  redditResponses: RedditReplyRecord[];
  agentDeployments: AgentDeploymentRecord[];
  rssDrafts: RssDraftRecord[];
  rssSeenIds: string[];
  governedSkillState: PersistedGovernedSkillRecord[];
  incidentLedger: IncidentLedgerRecord[];
  workflowEvents: WorkflowEventRecord[];
  relationshipObservations: RelationshipObservationRecord[];
  lastDriftRepairAt: string | null;
  lastRedditResponseAt: string | null;
  lastAgentDeployAt: string | null;
  lastRssSweepAt: string | null;
  lastNightlyBatchAt?: string | null;
  lastDigestNotificationAt?: string | null;
}
```

## Important Collections

| Field | Purpose |
|---|---|
| `pendingDocChanges` | buffered file paths waiting for sync/repair |
| `taskHistory` | recent task outcomes |
| `taskExecutions` | larger execution record set keyed by explicit idempotency key or task-id fallback |
| `approvals` | pending and completed approval records |
| `driftRepairs` | drift-repair run history |
| `redditQueue` | queued community work |
| `redditResponses` | completed Reddit helper outputs |
| `agentDeployments` | deployment record history |
| `rssDrafts` | scored RSS-derived content candidates |
| `rssSeenIds` | bounded dedupe set for RSS items |
| `governedSkillState` | persisted governed-skill intake and review state |
| `incidentLedger` | bounded incident history for runtime, repair, proof, and trust issues |
| `workflowEvents` | ordered workflow-stage evidence for runs, approvals, proof, and result flow |
| `relationshipObservations` | observed topology edges and proof-surface relationships |

Each `TaskExecutionRecord` may contain up to 25 durable `queueAttempts`.
Every admitted queue entry has its own task/attempt identity and lifecycle
status. Duplicate-suppressed requests are recorded as workflow evidence but do
not create queue attempts. Same-key retry attempts are admitted only when a
matching persisted retry-recovery record exists. During restart reconciliation,
any admitted or running attempt without a terminal outcome is closed as failed
or interrupted before recovery is considered.

## Retention Behavior

Retention is enforced in code, not just documentation. The current limits are
applied in:

```text
workspace/orchestrator/src/state.ts
```

Examples of bounded collections:

- `taskHistory`
- `taskExecutions`
- `approvals`
- `driftRepairs`
- `redditResponses`
- `agentDeployments`
- `rssDrafts`
- `rssSeenIds`

If you need the exact current limits, use `state.ts` as the source of truth.

## Important Rule

If this file conflicts with:

- `orchestrator_config.json`
- `orchestrator/src/types.ts`
- `orchestrator/src/state.ts`

then the code and config win.
