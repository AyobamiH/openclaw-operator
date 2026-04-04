---
title: "Adding Custom Tasks"
summary: "Create and register new task handlers."
---

# Adding Custom Tasks

Extend the orchestrator with custom task handlers for your specific needs.

---

## Task Structure

Every task has:

```json
{
  "type": "task-name",
  "status": "pending|completed|error",
  "timestamp": "2025-01-10T14:32:48.123Z",
  "durationMs": 5234,
  "result": { /* task-specific */ },
  "error": "error message (if status=error)"
}
```

---

## Step 1: Create Handler Function

Edit `orchestrator/src/taskHandlers.ts` and add:

```typescript
export async function myTaskHandler(
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<TaskResult> {
  const startTime = Date.now();
  
  try {
    // Validate config if needed
    if (!config.myField) {
      throw new Error('Config missing: myField');
    }
    
    // Do the work
    const itemsProcessed = 0;
    const success = true;
    
    // Optional: spawn an agent
    // const agentResult = await spawnAgent('my-agent', {...});
    
    // Return result
    const result = {
      itemsProcessed,
      success
      // ... any task-specific output
    };
    
    return {
      status: 'completed',
      result,
      durationMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      status: 'error',
      error: String(error),
      durationMs: Date.now() - startTime
    };
  }
}
```

---

## Step 2: Register Handler

Add to the `handlers` map in `taskHandlers.ts`:

```typescript
export const handlers: Record<string, TaskHandler> = {
  startup: startupHandler,
  'doc-sync': docSyncHandler,
  'doc-change': docChangeHandler,
  'drift-repair': driftRepairHandler,
  'reddit-response': redditResponseHandler,
  'rss-sweep': rssSweepHandler,
  'heartbeat': heartbeatHandler,
  'agent-deploy': agentDeployHandler,
  'my-task': myTaskHandler,  // ← New handler
};
```

---

## Step 3: Schedule (Optional)

If you want it to run periodically, add a scheduler in `orchestrator/src/index.ts`:

```typescript
// In bootstrap() function, after setupSchedulers()

// Run every 5 minutes
setInterval(async () => {
  queue.add({
    type: 'my-task',
    priority: 'normal'
  });
}, 1000 * 60 * 5);

console.log('[Scheduler] my-task scheduled: every 5 minutes');
```

---

## Step 4: Build & Test

```bash
cd orchestrator
npm run build
npm start
```

Check logs:

```bash
tail -f logs/orchestrator.log | grep "my-task"
```

View in state:

```bash
curl -fsS -H "Authorization: Bearer $API_KEY" \
  "http://127.0.0.1:3312/api/tasks/runs?limit=20&type=my-task" | jq '.runs'
```

---

## Spawning Agents from Tasks

If your task needs an agent:

```typescript
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

export async function myTaskHandler(
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<TaskResult> {
  const startTime = Date.now();
  
  try {
    // Create payload file
    const payloadFile = `/tmp/payload-my-task-${Date.now()}.json`;
    const payload = {
      type: 'my-task',
      input: 'some data',
      config: { /* ... */ }
    };
    await fs.writeFile(payloadFile, JSON.stringify(payload));
    
    // Spawn agent
    const agentDir = 'agents/my-agent';
    const result = spawn('tsx', [
      'src/index.ts',
      '--payload', payloadFile
    ], {
      cwd: agentDir,
      stdio: ['pipe', 'pipe', 'inherit']
    });
    
    // Collect output
    return new Promise((resolve) => {
      const chunks = [];
      result.stdout.on('data', chunk => chunks.push(chunk));
      
      result.on('close', (code) => {
        try {
          const output = Buffer.concat(chunks).toString();
          const agentResult = JSON.parse(output);
          
          // Cleanup
          fs.unlink(payloadFile).catch(() => {});
          
          resolve({
            status: 'completed',
            result: {
              agentResult,
              durationMs: Date.now() - startTime
            }
          });
        } catch (error) {
          resolve({
            status: 'error',
            error: String(error)
          });
        }
      });
    });
  } catch (error) {
    return {
      status: 'error',
      error: String(error),
      durationMs: Date.now() - startTime
    };
  }
}
```

---

## Example: Slack Notification Task

```typescript
export async function slackNotifyHandler(
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<TaskResult> {
  const startTime = Date.now();
  
  try {
    // Get last 5 tasks
    const recent = state.taskHistory.slice(-5);
    const errors = recent.filter(t => t.status === 'error');
    
    if (errors.length === 0) {
      return {
        status: 'completed',
        result: { notificationsSent: 0, reason: 'no errors' }
      };
    }
    
    // Build notification
    const message = `🚨 Orchestrator Errors (${errors.length})\n${
      errors.map(e => `• ${e.type}: ${e.error}`).join('\n')
    }`;
    
    // Send to Slack
    const webhookUrl = process.env.SLACK_WEBHOOK;
    if (webhookUrl) {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        body: JSON.stringify({ text: message })
      });
      
      if (!response.ok) {
        throw new Error(`Slack API error: ${response.status}`);
      }
    }
    
    return {
      status: 'completed',
      result: {
        notificationsSent: 1,
        errorCount: errors.length
      },
      durationMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      status: 'error',
      error: String(error),
      durationMs: Date.now() - startTime
    };
  }
}
```

Then register and schedule:

```typescript
// In taskHandlers.ts
export const handlers = {
  // ... other handlers
  'slack-notify': slackNotifyHandler
};

// In index.ts
setInterval(async () => {
  queue.add({ type: 'slack-notify', priority: 'normal' });
}, 1000 * 60 * 60); // Every hour
```

---

## Example: Database Cleanup Task

```typescript
export async function dbCleanupHandler(
  state: OrchestratorState,
  config: OrchestratorConfig
): Promise<TaskResult> {
  const startTime = Date.now();
  
  try {
    // Prune old state records (keep last 30 days)
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    const task = (t: TaskRecord) => new Date(t.timestamp).getTime() > cutoff;
    const reddit = (r: RedditRecord) => new Date(r.timestamp).getTime() > cutoff;
    const rss = (r: RSSRecord) => new Date(r.timestamp).getTime() > cutoff;
    
    state.taskHistory = state.taskHistory.filter(task);
    state.redditResponses = state.redditResponses.filter(reddit);
    state.rssDrafts = state.rssDrafts.filter(rss);
    
    return {
      status: 'completed',
      result: {
        tasksRetained: state.taskHistory.length,
        redditRetained: state.redditResponses.length,
        rssRetained: state.rssDrafts.length
      },
      durationMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      status: 'error',
      error: String(error),
      durationMs: Date.now() - startTime
    };
  }
}
```

---

## Testing Your Task

### Manual Test

```bash
# Start orchestrator
npm start

# Trigger task via code (add temp test)
# or wait for scheduled time

# Check runs
curl -fsS -H "Authorization: Bearer $API_KEY" \
  "http://127.0.0.1:3312/api/tasks/runs?limit=20&type=my-task" | jq '.runs'
```

### Unit Test

```typescript
// In orchestrator/src/__tests__/myTask.test.ts

import { myTaskHandler } from '../taskHandlers';

describe('myTaskHandler', () => {
  it('completes successfully', async () => {
    const state = {
      taskHistory: [],
      docsIndexed: [],
      redditResponses: [],
      rssDrafts: [],
      deployedAgents: []
    };
    
    const config = {
      docsPath: './docs',
      logsDir: './logs',
      stateFile: './logs/state.json',
      myField: 'value'
    };
    
    const result = await myTaskHandler(state, config);
    
    expect(result.status).toBe('completed');
    expect(result.result).toHaveProperty('itemsProcessed');
  });
});
```

Run:

```bash
npm test  # if vitest configured
```

---

## Monitoring Your Task

Add logs:

```typescript
console.log(`[${taskType}] Starting at ${new Date().toISOString()}`);
console.log(`[${taskType}] Processed ${count} items`);
console.log(`[${taskType}] Completed in ${duration}ms`);
```

Watch logs:

```bash
tail -f logs/orchestrator.log | grep "\[my-task\]"
```

---

## Best Practices

1. **Always wrap in try-catch** — Errors shouldn't crash orchestrator
2. **Return consistent structure** — status, result, durationMs, error
3. **Log important events** — Use console.log, timestamps saved to logs
4. **Handle missing config** — Check `config.myField` exists
5. **Clean up resources** — Delete temp files, close connections
6. **Set reasonable intervals** — Don't run too frequently
7. **Update state** — Add to `state.taskHistory` if tracking needed
8. **Document in this guide** — Add example and usage notes

---

See [API Reference](../reference/api.md) for complete handler interface.
