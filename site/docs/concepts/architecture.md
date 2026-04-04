---
title: "System Architecture"
summary: "Technical deep-dive into orchestrator design."
read_when:
  - Developing new features
  - Understanding task execution
  - Debugging system behavior
---

# System Architecture

(This is the technical version. For non-technical stakeholders, see [Architecture Overview](../start/architecture-overview.md))

## System Design

The orchestrator follows a layered architecture:

```
┌─────────────────────────────────────┐
│   Orchestrator (Node.js/TypeScript)  │
├────────────────┬────────────────────┤
│  Config Loader │ State Manager      │
├────────────────┼────────────────────┤
│  Doc Indexer   │ Task Queue         │
├────────────────┼────────────────────┤
│  Scheduler     │ Task Handlers      │
├────────────────┼────────────────────┤
│  Agent Spawner │ Logging            │
└────────────────┴────────────────────┘
         │
    ┌────┼────┬────────────┐
    │    │    │            │
    ▼    ▼    ▼            ▼
  Docs Logs Memory      Agents
```

## Core Components

### 1. Configuration Layer (`config.ts`)
- Loads `orchestrator_config.json`
- Validates required fields
- Environment override support

### 2. State Manager (`state.ts`)
- Persists to disk (JSON file)
- Tracks: task history, queues, deployments
- Auto-prunes old records (maintains limits)

### 3. Doc Indexer (`docIndexer.ts`)
- In-memory index of all docs
- File watcher (chokidar)
- Triggers on add/change/delete

### 4. Task Queue (`taskQueue.ts`)
- PQueue with fixed concurrency (default: 2)
- Accepts tasks with payload
- Converts to Task objects with UUID

### 5. Task Handlers (`taskHandlers.ts`)
- Router: type → handler function
- Handlers are async functions
- Modify state and call saveState

### 6. Scheduler (`index.ts`)
- Sets intervals for periodic tasks
- Enqueues based on time
- Manages bootstrap

## Task Execution Flow

```
Input: Task { id, type, payload, createdAt }
    │
    ▼
resolveTaskHandler(task.type)
    │
    ├─► startup
    ├─► doc-change
    ├─► doc-sync
    ├─► drift-repair ──► spawn doc-specialist agent
    ├─► reddit-response ──► spawn reddit-helper agent
    ├─► rss-sweep
    ├─► heartbeat
    ├─► agent-deploy ──► cp template to agents-deployed/
    └─► (fallback)

Each handler:
  1. Receives (task, context)
  2. Context = { config, state, saveState, logger }
  3. May spawn agents or modify state
  4. Returns string summary
  5. recordTaskResult(task, "ok" | "error", message)
  6. await saveState()
```

## Agent Spawning Pattern

When a handler needs to run an agent (e.g., doc-specialist):

```typescript
// 1. Create temp directory
tmpRoot = mkdtemp()

// 2. Write payload JSON
writeFile(payloadPath, { id, docPaths, targetAgents, ... })

// 3. Spawn Node process
spawn(execPath, [tsxPath, "src/index.ts", payloadPath], {
  cwd: agentRoot,
  env: { ...process.env, DOC_SPECIALIST_RESULT_FILE },
  timeout: 5 * 60 * 1000
})

// 4. Wait for completion
on('close', (code) => {
  if (code === 0) {
    result = JSON.parse(readFile(resultPath))
  }
})

// 5. Cleanup
rm(tmpRoot, { recursive: true })
```

## State Persistence

State is saved after every task. Structure:

```typescript
interface OrchestratorState {
  lastStartedAt: string | null
  updatedAt: string | null
  
  // Doc tracking
  indexedDocs: number
  docIndexVersion: number
  pendingDocChanges: string[]
  
  // Task history
  taskHistory: TaskRecord[]  // last 50
  
  // Queues and logging
  redditQueue: RedditQueueItem[]  // max 100
  redditResponses: RedditReplyRecord[]  // last 100
  rssDrafts: RssDraftRecord[]  // last 200
  rssSeenIds: string[]  // last 400
  
  // Deployments
  agentDeployments: AgentDeploymentRecord[]  // last 50
  
  // Drift repair history
  driftRepairs: DriftRepairRecord[]  // last 25
  
  // Timestamps
  lastDriftRepairAt: string | null
  lastRedditResponseAt: string | null
  lastAgentDeployAt: string | null
  lastRssSweepAt: string | null
}
```

## Scheduling: The Intervals

```typescript
// Every 60s: check if doc-sync needed
setInterval(() => {
  if (state.pendingDocChanges.length > 0) {
    queue.enqueue('doc-sync', { reason: 'interval' })
  }
}, DOC_SYNC_INTERVAL_MS)  // 60_000

// Every 5m: heartbeat
setInterval(() => {
  queue.enqueue('heartbeat', { reason: 'periodic' })
}, HEARTBEAT_INTERVAL_MS)  // 5 * 60_000

// Every 10m: Reddit sweep
setInterval(() => {
  queue.enqueue('reddit-response', {
    reason: 'reddit-queue-sweep',
    responder: 'reddit-helper'
  })
}, REDDIT_SWEEP_INTERVAL_MS)  // 10 * 60_000

// Every 15m: RSS sweep
setInterval(() => {
  queue.enqueue('rss-sweep', { reason: 'rss-monitor' })
}, RSS_SWEEP_INTERVAL_MS)  // 15 * 60_000
```

## Error Handling

```typescript
queue.onProcess(async (task) => {
  const handler = resolveTaskHandler(task)
  try {
    const message = await handler(task, handlerContext)
    recordTaskResult(task, 'ok', message)
  } catch (error) {
    console.error(`[task] failed ${task.type}:`, error)
    recordTaskResult(task, 'error', error.message)
  } finally {
    await flushState()
  }
})
```

- Errors are caught and recorded
- Task marked as failed but doesn't crash system
- State saved even on error
- Next task continues normally

## Agent Deployment

When `agent-deploy` handler runs:

```
1. Receives: { agentName, template, config, ... }
2. Copies template folder to agents-deployed/
3. Writes DEPLOYMENT.json with metadata
4. Records AgentDeploymentRecord in state
5. Returns deployment ID
```

Structure created:

```
agents-deployed/
├── my-agent-2025-02-21-14-30-00/
│   ├── DEPLOYMENT.json (metadata)
│   ├── src/
│   ├── agent.config.json
│   ├── package.json
│   └── README.md
```

## Observability

### Logs
- `logs/orchestrator.log` — stdout/stderr
- `stateFile` target from `orchestrator_config.json` — persisted runtime state
- `logs/redis-drafts.jsonl` — JSONL of all drafts
- `logs/knowledge-packs/` — generated knowledge packs

### Metrics
- Task count (history[:50])
- Success rate ( "ok" / total )
- Queue sizes (reddit, rss, pending)
- Timing (lastXxxAt timestamps)

### Health
- Heartbeat every 5m confirms liveness
- Missing heartbeat = system stuck
- Task record gaps = processing delay

## Concurrency & Limits

```typescript
// Task queue: process 2 tasks concurrently
const queue = new PQueue({ concurrency: 2 })

// State limits
- taskHistory: 50 entries max
- redditQueue: 100 entries max
- redditResponses: 100 entries max
- rssDrafts: 200 entries max
- rssSeenIds: 400 entries max
- driftRepairs: 25 entries max
- pendingDocChanges: 200 entries max

// Agent timeout
- 5 minutes per agent execution
```

Overflow handling: Auto-truncate old entries (FIFO).

---

See [Task Types](../reference/task-types.md) for all task implementations.
