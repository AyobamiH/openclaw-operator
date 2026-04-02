import net from 'node:net';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

type TaskHistoryRecord = {
  id?: string;
  type?: string;
  handledAt?: string;
  result?: 'ok' | 'error';
  message?: string;
};

type StateFile = {
  taskHistory?: TaskHistoryRecord[];
};

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        rejectPort(new Error('Unable to allocate a free port'));
        return;
      }
      const { port } = address;
      server.close(() => resolvePort(port));
    });
    server.on('error', rejectPort);
  });
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function waitForHealthy(baseUrl: string, timeoutMs = 90000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        const body = (await response.json()) as { status?: string };
        if (body.status === 'healthy') {
          return;
        }
      }
    } catch {
      // keep retrying
    }
    await sleep(500);
  }
  throw new Error('Orchestrator health check timed out');
}

async function waitForTaskHistory(
  stateFilePath: string,
  taskIds: string[],
  timeoutMs = 180000,
): Promise<Map<string, TaskHistoryRecord>> {
  const deadline = Date.now() + timeoutMs;
  const ids = new Set(taskIds);

  while (Date.now() < deadline) {
    try {
      const raw = await readFile(stateFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as StateFile;
      const history = parsed.taskHistory ?? [];
      const found = new Map<string, TaskHistoryRecord>();

      for (const entry of history) {
        if (entry.id && ids.has(entry.id)) {
          found.set(entry.id, entry);
        }
      }

      if (found.size === taskIds.length) {
        return found;
      }
    } catch {
      // keep retrying
    }

    await sleep(250);
  }

  const partial = new Map<string, TaskHistoryRecord>();
  try {
    const raw = await readFile(stateFilePath, 'utf-8');
    const parsed = JSON.parse(raw) as StateFile;
    for (const entry of parsed.taskHistory ?? []) {
      if (entry.id && ids.has(entry.id)) {
        partial.set(entry.id, entry);
      }
    }
  } catch {
    // no-op
  }

  return partial;
}

async function main() {
  const totalTasks = Number(process.env.LIVE_RATE_TOTAL_TASKS ?? '3000');
  const intervalMs = Number(process.env.LIVE_RATE_INTERVAL_MS ?? '25');
  const fastStart = process.env.ORCHESTRATOR_FAST_START ?? 'true';
  const forwardedIpPool = Number(process.env.LIVE_RATE_IP_POOL ?? '300');

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const apiKey = 'live-rate-shaped-api-key';
  const webhookSecret = 'live-rate-shaped-webhook-secret';
  const runId = `live-rate-${Date.now()}`;

  const tsxCliPath = resolve(process.cwd(), '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const configPath = resolve(process.cwd(), '..', 'orchestrator_config.json');
  const configRaw = await readFile(configPath, 'utf-8');
  const config = JSON.parse(configRaw) as { stateFile: string; logsDir?: string };
  const stateFilePath = config.stateFile;
  const runLogPath = process.env.LIVE_RATE_RUN_LOG
    ?? resolve(config.logsDir ?? resolve(process.cwd(), '..', 'logs'), 'live-dispatch-runs.jsonl');

  let serverProcess: ChildProcessWithoutNullStreams | null = null;
  let stdoutBuffer = '';
  let stderrBuffer = '';

  const latencies: number[] = [];
  const acceptedTaskIds: string[] = [];
  let accepted = 0;
  let throttled = 0;
  let unauthorized = 0;
  let otherErrors = 0;

  try {
    serverProcess = spawn(process.execPath, [tsxCliPath, 'src/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(port),
        API_KEY: apiKey,
        WEBHOOK_SECRET: webhookSecret,
        MONGO_PASSWORD: process.env.MONGO_PASSWORD ?? 'test-mongo-password',
        REDIS_PASSWORD: process.env.REDIS_PASSWORD ?? 'test-redis-password',
        MONGO_USERNAME: process.env.MONGO_USERNAME ?? 'test-mongo-user',
        DATABASE_URL:
          process.env.DATABASE_URL ??
          'mongodb://127.0.0.1:1/orchestrator?serverSelectionTimeoutMS=1000&connectTimeoutMS=1000',
        DB_NAME: process.env.DB_NAME ?? 'orchestrator',
        ALERTS_ENABLED: 'false',
        ORCHESTRATOR_FAST_START: fastStart,
      },
      stdio: 'pipe',
    });

    serverProcess.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
    });
    serverProcess.stderr.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    await new Promise<void>((resolveReady, rejectReady) => {
      serverProcess?.once('spawn', () => resolveReady());
      serverProcess?.once('error', (error) => rejectReady(error));
    });

    await waitForHealthy(baseUrl);

    console.log('============================================================');
    console.log('LIVE RATE-SHAPED DISPATCH PASS');
    console.log('============================================================');
    console.log(`Run ID: ${runId}`);
    console.log(`Fast-start mode: ${fastStart}`);
    console.log(`Target tasks: ${totalTasks}`);
    console.log(`Dispatch interval: ${intervalMs}ms (~${(60000 / intervalMs).toFixed(2)} req/min)`);
    console.log(`Forwarded IP pool: ${forwardedIpPool}`);
    console.log(`Run summary log: ${runLogPath}`);
    console.log('');

    const dispatchStart = Date.now();

    for (let i = 0; i < totalTasks; i++) {
      const requestStart = Date.now();
      const poolSize = Math.max(1, Math.min(65000, forwardedIpPool));
      const clientIndex = i % poolSize;
      const octet3 = Math.floor(clientIndex / 250) % 250;
      const octet4 = (clientIndex % 250) + 1;
      const clientIp = `10.20.${octet3}.${octet4}`;
      const response = await fetch(`${baseUrl}/api/tasks/trigger`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Forwarded-For': clientIp,
        },
        body: JSON.stringify({
          type: 'system-monitor',
          payload: {
            type: 'health',
            agents: ['security-agent'],
            reason: `${runId}-${i + 1}`,
            seq: i + 1,
          },
        }),
      });

      const elapsed = Date.now() - requestStart;
      latencies.push(elapsed);

      if (response.status === 202) {
        accepted += 1;
        const body = (await response.json()) as { taskId: string };
        acceptedTaskIds.push(body.taskId);
      } else if (response.status === 429) {
        throttled += 1;
      } else if (response.status === 401) {
        unauthorized += 1;
      } else {
        otherErrors += 1;
      }

      if ((i + 1) % 5 === 0 || i + 1 === totalTasks) {
        console.log(`Dispatched ${i + 1}/${totalTasks} (accepted=${accepted}, throttled=${throttled})`);
      }

      if (i + 1 < totalTasks) {
        await sleep(intervalMs);
      }
    }

    const dispatchDurationMs = Date.now() - dispatchStart;
    const completed = await waitForTaskHistory(stateFilePath, acceptedTaskIds, 10000);

    let completedOk = 0;
    let completedError = 0;
    let latestHandledAt = 0;

    for (const record of completed.values()) {
      if (record.result === 'ok') completedOk += 1;
      if (record.result === 'error') completedError += 1;
      if (record.handledAt) {
        const handledTs = Date.parse(record.handledAt);
        if (!Number.isNaN(handledTs)) {
          latestHandledAt = Math.max(latestHandledAt, handledTs);
        }
      }
    }

    const enqueueP50 = percentile(latencies, 50);
    const enqueueP95 = percentile(latencies, 95);
    const enqueueMax = latencies.length > 0 ? Math.max(...latencies) : 0;
    const dispatchRatePerMin = dispatchDurationMs > 0
      ? (accepted / (dispatchDurationMs / 60000))
      : 0;

    const completionCoverage = accepted > 0 ? (completed.size / accepted) * 100 : 0;
    const totalDrainSeconds = latestHandledAt > 0
      ? (latestHandledAt - dispatchStart) / 1000
      : 0;

    console.log('');
    console.log('---------------- SUMMARY ----------------');
    console.log(`Accepted: ${accepted}/${totalTasks}`);
    console.log(`Throttled (429): ${throttled}`);
    console.log(`Unauthorized (401): ${unauthorized}`);
    console.log(`Other errors: ${otherErrors}`);
    console.log(`Enqueue latency p50/p95/max: ${enqueueP50}ms / ${enqueueP95}ms / ${enqueueMax}ms`);
    console.log(`Effective dispatch rate: ${dispatchRatePerMin.toFixed(2)} req/min`);
    console.log(`Completions found in taskHistory (rolling sample): ${completed.size}/${accepted} (${completionCoverage.toFixed(1)}%)`);
    console.log(`Completion result split from state sample: ok=${completedOk}, error=${completedError}`);
    if (totalDrainSeconds > 0) {
      console.log(`Dispatch-to-last-completion: ${totalDrainSeconds.toFixed(1)}s`);
    }
    console.log('-----------------------------------------');
    console.log('');

    const summaryRecord = {
      runId,
      generatedAt: new Date().toISOString(),
      fastStart,
      totalTasks,
      accepted,
      throttled,
      unauthorized,
      otherErrors,
      enqueueLatencyMs: {
        p50: enqueueP50,
        p95: enqueueP95,
        max: enqueueMax,
      },
      effectiveDispatchRatePerMin: Number(dispatchRatePerMin.toFixed(2)),
      completionsObservedTaskHistory: completed.size,
      completionCoveragePct: Number(completionCoverage.toFixed(1)),
      completionResultSplitFromState: {
        ok: completedOk,
        error: completedError,
      },
      dispatchToLastCompletionSeconds: totalDrainSeconds > 0
        ? Number(totalDrainSeconds.toFixed(1))
        : null,
    };

    await mkdir(dirname(runLogPath), { recursive: true });
    await appendFile(runLogPath, `${JSON.stringify(summaryRecord)}\n`, 'utf-8');
    console.log(`Appended run summary to ${runLogPath}`);
  } catch (error) {
    console.error('Live rate-shaped dispatch pass failed:', error);
    if (stdoutBuffer) {
      console.error('\n[orchestrator stdout]\n', stdoutBuffer);
    }
    if (stderrBuffer) {
      console.error('\n[orchestrator stderr]\n', stderrBuffer);
    }
    process.exitCode = 1;
  } finally {
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill('SIGTERM');
      await new Promise<void>((resolveExit) => {
        const forceTimer = setTimeout(() => {
          if (serverProcess && serverProcess.exitCode === null) {
            serverProcess.kill('SIGKILL');
          }
        }, 5000);

        serverProcess?.once('exit', () => {
          clearTimeout(forceTimer);
          resolveExit();
        });
      });
    }
  }
}

main().catch((error) => {
  console.error('Fatal script error:', error);
  process.exit(1);
});
