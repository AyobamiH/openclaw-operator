/**
 * Runtime Integration Tests (Gap 9)
 *
 * Boots a real orchestrator process and validates the live middleware chain:
 * auth, validation, task allowlist behavior, and webhook HMAC verification.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { computeWebhookSignature } from '../src/middleware/auth.js';
import { createDefaultState } from '../src/state.js';

const TEST_API_KEY = 'integration-test-api-key';
const TEST_WEBHOOK_SECRET = 'integration-test-webhook-secret';
const GOVERNED_SKILL_FIXTURE_DEFINITION = {
  id: 'governed-skill-fixture',
  version: '1.0.0',
  description: 'Governed skill fixture for integration coverage.',
  inputs: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Fixture URL' },
    },
    required: ['url'],
  },
  outputs: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
    },
  },
  permissions: {
    networkAllowed: ['example.com'],
    fileWrite: ['artifacts'],
  },
  provenance: {
    author: 'integration-suite',
    source: 'generated-fixture',
    version: '1.0.0',
    license: 'Apache-2.0',
  },
  audit: {
    passed: true,
    runAt: '2026-03-17T10:00:00.000Z',
    checks: [],
    riskFlags: [],
  },
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

async function waitForHealthy(baseUrl: string, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        const body = await response.json() as { status?: string };
        if (body.status === 'healthy') {
          return;
        }
      }
    } catch {
      // keep retrying until timeout
    }
    await sleep(500);
  }
  throw new Error('Orchestrator failed health check before timeout');
}

describe('Runtime Integration: Live Middleware Chain', () => {
  let serverProcess: ChildProcessWithoutNullStreams | null = null;
  let baseUrl = '';
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let stateFilePath = '';
  let digestDirPath = '';
  let configFilePath = '';
  let runtimeRootDir = '';
  let operatorDistDir = '';

  const triggerTask = async (type: string, payload: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/api/tasks/trigger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify({ type, payload }),
    });

    const body = await response.json() as { status: string; type: string; taskId: string };
    expect(response.status).toBe(202);
    expect(body.status).toBe('queued');
    return body.taskId;
  };

  const fetchProtected = async <T>(path: string): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
    });

    expect(response.status).toBe(200);
    return (await response.json()) as T;
  };

  const fetchPublic = async <T>(path: string): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(200);
    return (await response.json()) as T;
  };

  const waitForPendingApproval = async (taskId: string, timeoutMs = 45000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const payload = await fetchProtected<{
        pending?: Array<{ taskId?: string; type?: string }>;
      }>('/api/approvals/pending');
      const found = (payload.pending ?? []).find((approval) => approval.taskId === taskId);
      if (found) {
        return found;
      }
      await sleep(250);
    }

    throw new Error(`Pending approval not found for taskId=${taskId}`);
  };

  const decideApproval = async (
    taskId: string,
    decision: 'approved' | 'rejected' = 'approved',
  ) => {
    const response = await fetch(`${baseUrl}/api/approvals/${taskId}/decision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify({
        decision,
        actor: 'integration-suite',
        note: `integration ${decision}`,
      }),
    });

    expect(response.status).toBe(200);
    return (await response.json()) as {
      replayTaskId?: string | null;
      approval?: { taskId?: string; status?: string };
    };
  };

  const waitForTaskHistoryRecord = async (taskId: string, timeoutMs = 90000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const raw = await readFile(stateFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as {
          taskHistory?: Array<{ id?: string; type?: string; result?: 'ok' | 'error'; message?: string }>;
        };
        const found = parsed.taskHistory?.find((entry) => entry?.id === taskId);
        if (found) {
          return found;
        }
      } catch {
        // retry until timeout
      }
      await sleep(250);
    }

    throw new Error(`Task history record not found for taskId=${taskId}`);
  };

  const waitForTaskRun = async (taskId: string, timeoutMs = 90000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const payload = await fetchProtected<{
        runs: Array<{ taskId?: string; runId?: string }>;
      }>('/api/tasks/runs?limit=100');
      const found = payload.runs.find((run) => run.taskId === taskId);
      if (found?.runId) {
        return found;
      }
      await sleep(250);
    }

    throw new Error(`Task run not found for taskId=${taskId}`);
  };

  const waitForRunWorkflowGraph = async (
    runId: string,
    predicate: (graph: {
      crossRunLinks?: Array<{ relationship?: string }>;
      relatedRuns?: Array<{ runId?: string }>;
      dependencySummary?: {
        dependencyLinkCount?: number;
        handoffLinkCount?: number;
      };
    } | null | undefined) => boolean,
    timeoutMs = 30000,
  ) => {
    const deadline = Date.now() + timeoutMs;
    let latestPayload: {
      run?: {
        workflowGraph?: {
          crossRunLinks?: Array<{ relationship?: string }>;
          relatedRuns?: Array<{ runId?: string }>;
          dependencySummary?: {
            dependencyLinkCount?: number;
            handoffLinkCount?: number;
          };
        };
      };
    } | null = null;

    while (Date.now() < deadline) {
      latestPayload = await fetchProtected<{
        run?: {
          workflowGraph?: {
            crossRunLinks?: Array<{ relationship?: string }>;
            relatedRuns?: Array<{ runId?: string }>;
            dependencySummary?: {
              dependencyLinkCount?: number;
              handoffLinkCount?: number;
            };
          };
        };
      }>(`/api/tasks/runs/${encodeURIComponent(runId)}`);

      if (predicate(latestPayload.run?.workflowGraph)) {
        return latestPayload;
      }

      await sleep(250);
    }

    return latestPayload;
  };

  beforeAll(async () => {
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const tsxCliPath = resolve(process.cwd(), '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const configPath = resolve(process.cwd(), '..', 'orchestrator_config.json');
    const configRaw = await readFile(configPath, 'utf-8');
    const config = JSON.parse(configRaw) as { stateFile: string; digestDir?: string };
    runtimeRootDir = await mkdtemp(join(tmpdir(), 'openclaw-int-'));
    configFilePath = join(runtimeRootDir, 'orchestrator_config.test.json');
    stateFilePath = join(runtimeRootDir, 'orchestrator_state.json');
    digestDirPath = join(runtimeRootDir, 'logs', 'digests');
    operatorDistDir = join(runtimeRootDir, 'operator-s-console-dist-fixture');

    await mkdir(join(operatorDistDir, 'assets'), { recursive: true });
    await writeFile(
      join(operatorDistDir, 'index.html'),
      [
        '<!doctype html>',
        '<html lang="en">',
        '  <head>',
        '    <meta charset="UTF-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '    <title>OpenClaw Operator Console Test Fixture</title>',
        '    <link rel="stylesheet" crossorigin href="/operator/assets/index-test.css" />',
        '  </head>',
        '  <body>',
        '    <div id="root">operator console fixture</div>',
        '    <script type="module" crossorigin src="/operator/assets/index-test.js"></script>',
        '  </body>',
        '</html>',
      ].join('\n'),
      'utf-8',
    );
    await writeFile(
      join(operatorDistDir, 'assets', 'index-test.js'),
      'window.__operatorBundleLoaded = true;\n',
      'utf-8',
    );
    await writeFile(
      join(operatorDistDir, 'assets', 'index-test.css'),
      ':root { color-scheme: light; }\n',
      'utf-8',
    );

    const testConfig = {
      ...config,
      docsPath: resolve(process.cwd(), '..', 'openclaw-docs'),
      cookbookPath: resolve(process.cwd(), '..', 'openai-cookbook'),
      logsDir: join(runtimeRootDir, 'logs'),
      stateFile: stateFilePath,
      deployBaseDir: join(runtimeRootDir, 'agents-deployed'),
      rssConfigPath: resolve(process.cwd(), '..', 'rss_filter_config.json'),
      redditDraftsPath: join(runtimeRootDir, 'logs', 'reddit-drafts.jsonl'),
      knowledgePackDir: join(runtimeRootDir, 'logs', 'knowledge-packs'),
      runtimeEngagementOsPath: resolve(process.cwd(), '..', 'RUNTIME_ENGAGEMENT_OS.md'),
      digestDir: digestDirPath,
    };
    const seededState = createDefaultState();
    const seedDemandTimestamp = new Date().toISOString();
    seededState.governedSkillState.push(
      {
        skillId: 'generated-safe-skill',
        definition: {
          ...GOVERNED_SKILL_FIXTURE_DEFINITION,
          id: 'generated-safe-skill',
        },
        auditedAt: '2026-03-17T10:00:00.000Z',
        intakeSource: 'generated',
        registeredBy: 'integration-suite',
        trustStatus: 'review-approved',
        reviewedBy: 'integration-reviewer',
        reviewedAt: '2026-03-17T10:05:00.000Z',
        reviewNote: 'restart-safe governed skill fixture',
        provenanceSnapshot: {
          author: 'integration-suite',
          source: 'generated-fixture',
          version: '1.0.0',
        },
        persistenceMode: 'restart-safe',
        executorBinding: {
          type: 'builtin-skill',
          skillId: 'sourceFetch',
        },
      },
      {
        skillId: 'generated-pending-skill',
        definition: {
          ...GOVERNED_SKILL_FIXTURE_DEFINITION,
          id: 'generated-pending-skill',
        },
        auditedAt: '2026-03-17T10:00:00.000Z',
        intakeSource: 'manual',
        registeredBy: 'integration-suite',
        trustStatus: 'pending-review',
        provenanceSnapshot: {
          author: 'integration-suite',
          source: 'manual-fixture',
          version: '1.0.0',
        },
        persistenceMode: 'metadata-only',
      },
    );
    seededState.rssDrafts.push({
      draftId: 'seed-demand-draft-1',
      pillar: 'operator-proof',
      feedId: 'seed-feed-1',
      subreddit: 'OpenClawOps',
      title: 'Need grounded operator proof for the current delivery lane',
      content: 'Looking for the safest way to present downstream proof without overselling runtime maturity.',
      link: 'https://reddit.com/r/OpenClawOps/comments/seed-demand-draft-1',
      author: 'seed-operator',
      matchedKeywords: ['operator', 'proof', 'delivery'],
      scoreBreakdown: {
        operator: 4,
        proof: 5,
      },
      totalScore: 9.1,
      suggestedReply: 'Share the exact delivery blocker and I can narrow the cleanest proof path.',
      ctaVariant: 'Share the exact delivery blocker and I can narrow the cleanest proof path.',
      tag: 'priority',
      queuedAt: seedDemandTimestamp,
    });
    seededState.redditQueue.push({
      id: 'seed-demand-draft-1',
      subreddit: 'OpenClawOps',
      question: 'How should OpenClaw Operator show downstream proof without overselling?',
      link: 'https://reddit.com/r/OpenClawOps/comments/seed-demand-draft-1',
      queuedAt: seedDemandTimestamp,
      selectedForDraft: true,
      tag: 'priority',
      pillar: 'operator-proof',
      feedId: 'seed-feed-1',
      entryContent:
        'Need grounded public proof while keeping current runtime caveats visible for operators.',
      author: 'seed-operator',
      ctaVariant: 'Share the exact delivery blocker and I can narrow the cleanest proof path.',
      matchedKeywords: ['operator', 'proof', 'delivery'],
      score: 9.1,
      draftRecordId: 'seed-demand-draft-1',
      suggestedReply:
        'Share the exact delivery blocker and I can narrow the cleanest proof path.',
    });
    seededState.taskExecutions.push({
      taskId: 'seed-proof-task',
      idempotencyKey: 'seed-proof-run',
      type: 'system-monitor',
      status: 'failed',
      attempt: 1,
      maxRetries: 2,
      lastHandledAt: '2026-03-17T10:06:00.000Z',
      lastError: 'milestone delivery timed out before confirmation',
    });
    seededState.workflowEvents.push(
      {
        eventId: 'seed-proof-ingress',
        runId: 'seed-proof-run',
        taskId: 'seed-proof-task',
        type: 'system-monitor',
        stage: 'ingress',
        state: 'accepted',
        timestamp: '2026-03-17T10:00:00.000Z',
        source: 'integration-seed',
        actor: 'orchestrator',
        nodeId: 'ingress:seed-proof-task',
        detail: 'Seeded proof-delivery task accepted.',
        evidence: ['seed-proof-task', 'seed-proof-run'],
      },
      {
        eventId: 'seed-proof-proof',
        runId: 'seed-proof-run',
        taskId: 'seed-proof-task',
        type: 'system-monitor',
        stage: 'proof',
        state: 'blocked',
        timestamp: '2026-03-17T10:05:00.000Z',
        source: 'integration-seed',
        actor: 'system-monitor-agent',
        nodeId: 'proof:milestone',
        detail: 'Milestone public proof surface degraded after timeout.',
        evidence: ['seed-proof-1'],
        stopCode: 'proof-timeout',
        proofTransport: 'milestone',
        classification: 'proof-delivery',
      },
      {
        eventId: 'seed-proof-result',
        runId: 'seed-proof-run',
        taskId: 'seed-proof-task',
        type: 'system-monitor',
        stage: 'result',
        state: 'failed',
        timestamp: '2026-03-17T10:06:00.000Z',
        source: 'integration-seed',
        actor: 'orchestrator',
        nodeId: 'result:seed-proof-task',
        detail: 'Run closed with public proof failure.',
        evidence: ['seed-proof-task', 'seed-proof-run'],
      },
    );
    seededState.relationshipObservations.push({
      observationId: 'seed-proof-observation',
      timestamp: '2026-03-17T10:05:30.000Z',
      from: 'agent:system-monitor-agent',
      to: 'surface:milestone',
      relationship: 'publishes-proof',
      status: 'degraded',
      source: 'integration-seed',
      detail: 'Milestone public proof surface degraded for seed-proof-run.',
      taskId: 'seed-proof-task',
      runId: 'seed-proof-run',
      proofTransport: 'milestone',
      classification: 'proof-delivery',
      evidence: ['seed-proof-1'],
    });
    seededState.incidentLedger.push({
      incidentId: 'seed-proof-incident',
      fingerprint: 'seed-proof-incident',
      title: 'Seeded public proof incident',
      classification: 'proof-delivery',
      severity: 'warning',
      truthLayer: 'observed',
      firstSeenAt: '2026-03-17T10:04:00.000Z',
      lastSeenAt: '2026-03-17T10:06:00.000Z',
      status: 'active',
      owner: 'system-monitor-agent',
      summary: 'Milestone public proof evidence for the seeded run degraded before acknowledgement.',
      affectedSurfaces: ['agent:system-monitor-agent', 'surface:milestone'],
      linkedServiceIds: ['system-monitor-agent'],
      linkedTaskIds: ['seed-proof-task'],
      linkedRunIds: ['seed-proof-run'],
      linkedRepairIds: [],
      linkedProofDeliveries: ['seed-proof-1'],
      evidence: ['proof-timeout', 'dead-letter milestone delivery'],
      recommendedSteps: ['Retry public proof replay after incident review.'],
      policy: {
        policyId: 'proof-delivery',
        preferredOwner: 'system-monitor-agent',
        autoAssignOwner: true,
        autoRemediateOnCreate: true,
        autoRetryBlockedRemediation: true,
        maxAutoRemediationAttempts: 3,
        autoEscalateOnBreach: true,
        remediationTaskType: 'system-monitor',
        verifierTaskType: 'qa-verification',
        escalationTaskType: 'system-monitor',
        targetSlaMinutes: 60,
        escalationMinutes: 180,
      },
      escalation: {
        level: 'warning',
        status: 'watching',
        dueAt: '2026-03-17T11:04:00.000Z',
        escalateAt: '2026-03-17T13:04:00.000Z',
        summary: 'Public proof remains within the warning window.',
      },
      remediation: {
        owner: 'auto',
        status: 'ready',
        summary: 'Remediation is ready for operator or auto replay.',
        nextAction: 'Queue a system-monitor remediation run.',
        blockers: [],
      },
      remediationPlan: [],
      verification: {
        required: true,
        agentId: 'qa-verification-agent',
        status: 'pending',
        summary: 'Verification required after public proof replay.',
      },
      history: [
        {
          id: 'seed-proof-history-1',
          timestamp: '2026-03-17T10:04:00.000Z',
          type: 'detected',
          actor: 'system-monitor-agent',
          summary: 'Public proof incident detected.',
          evidence: ['seed-proof-1'],
        },
      ],
      policyExecutions: [],
      acknowledgements: [],
      ownershipHistory: [],
      remediationTasks: [],
    });
    await writeFile(stateFilePath, JSON.stringify(seededState), 'utf-8');
    await writeFile(configFilePath, JSON.stringify(testConfig), 'utf-8');

    serverProcess = spawn(process.execPath, [tsxCliPath, 'src/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(port),
        API_KEY: TEST_API_KEY,
        WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
        MONGO_PASSWORD: process.env.MONGO_PASSWORD ?? 'test-mongo-password',
        REDIS_PASSWORD: process.env.REDIS_PASSWORD ?? 'test-redis-password',
        MONGO_USERNAME: process.env.MONGO_USERNAME ?? 'test-mongo-user',
        DATABASE_URL:
          process.env.DATABASE_URL ??
          'mongodb://127.0.0.1:1/orchestrator?serverSelectionTimeoutMS=1000&connectTimeoutMS=1000',
        DB_NAME: process.env.DB_NAME ?? 'orchestrator',
        ALERTS_ENABLED: 'false',
        ORCHESTRATOR_FAST_START: 'true',
        ORCHESTRATOR_CONFIG: configFilePath,
        OPERATOR_UI_DIST_DIR: operatorDistDir,
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

    try {
      await waitForHealthy(baseUrl);
    } catch (error) {
      if (serverProcess.exitCode !== null) {
        throw new Error(
          `Orchestrator exited before readiness (code=${serverProcess.exitCode}).\nSTDOUT:\n${stdoutBuffer}\nSTDERR:\n${stderrBuffer}`,
        );
      }
      throw new Error(
        `Orchestrator failed health check before timeout.\nSTDOUT:\n${stdoutBuffer}\nSTDERR:\n${stderrBuffer}`,
      );
    }
  }, 45000);

  afterAll(async () => {
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill('SIGTERM');
      await new Promise<void>((resolveExit) => {
        const timeout = setTimeout(() => {
          if (serverProcess && serverProcess.exitCode === null) {
            serverProcess.kill('SIGKILL');
          }
        }, 5000);

        serverProcess?.once('exit', () => {
          clearTimeout(timeout);
          resolveExit();
        });
      });
    }

    if (runtimeRootDir) {
      await rm(runtimeRootDir, { recursive: true, force: true });
    }

    if (operatorDistDir) {
      await rm(operatorDistDir, { recursive: true, force: true });
    }
  });

  it('serves public health endpoint from live process', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    const body = await response.json() as { status: string };
    expect(body.status).toBe('healthy');
  });

  it('serves /operator from the dist bundle instead of legacy shell assets', async () => {
    const response = await fetch(`${baseUrl}/operator/`);
    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain('/operator/assets/index-test.js');
    expect(html).toContain('/operator/assets/index-test.css');
    expect(html).not.toContain('/operator/assets/app.js');
    expect(html).not.toContain('/operator/assets/styles.css');

    const scriptResponse = await fetch(`${baseUrl}/operator/assets/index-test.js`);
    expect(scriptResponse.status).toBe(200);
    expect(await scriptResponse.text()).toContain('window.__operatorBundleLoaded = true;');
  });

  it('rejects protected endpoint without bearer token', async () => {
    const response = await fetch(`${baseUrl}/api/tasks/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'heartbeat', payload: {} }),
    });

    expect(response.status).toBe(401);
  });

  it('accepts protected endpoint with valid bearer token', async () => {
    const response = await fetch(`${baseUrl}/api/tasks/trigger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify({ type: 'heartbeat', payload: { reason: 'integration-test' } }),
    });

    expect(response.status).toBe(202);
    const body = await response.json() as { status: string; type: string };
    expect(body.status).toBe('queued');
    expect(body.type).toBe('heartbeat');
  });

  it('serves bounded companion read surfaces with protected runtime truth', async () => {
    const [overview, catalog, incidents, runs, approvals] = await Promise.all([
      fetchProtected<any>('/api/companion/overview'),
      fetchProtected<any>('/api/companion/catalog'),
      fetchProtected<any>('/api/companion/incidents'),
      fetchProtected<any>('/api/companion/runs'),
      fetchProtected<any>('/api/companion/approvals'),
    ]);

    expect(overview.controlPlaneMode).toBeTruthy();
    expect(overview.primaryOperatorMove).toBeTruthy();
    expect(overview.pressureStory).toBeTruthy();
    expect(overview.publicProof).toBeTruthy();

    expect(Array.isArray(catalog.tasks)).toBe(true);
    expect(
      catalog.tasks.some((task: any) => task.type === 'control-plane-brief'),
    ).toBe(true);
    expect(
      catalog.tasks.some((task: any) => task.type === 'incident-triage'),
    ).toBe(true);
    expect(
      catalog.tasks.some((task: any) => task.type === 'release-readiness'),
    ).toBe(true);

    expect(incidents.summary).toBeTruthy();
    expect(Array.isArray(incidents.topClassifications)).toBe(true);
    expect(Array.isArray(incidents.topQueue)).toBe(true);

    expect(typeof runs.total).toBe('number');
    expect(Array.isArray(runs.runs)).toBe(true);

    expect(typeof approvals.count).toBe('number');
    expect(Array.isArray(approvals.dominantLanes)).toBe(true);
    expect(Array.isArray(approvals.items)).toBe(true);
  });

  it('exposes governed skill policy, registry, telemetry, and audit surfaces with live runtime truth', { timeout: 45000 }, async () => {
    const registryPayload = await fetchProtected<{
      total?: number;
      skills?: Array<{
        skillId?: string;
        trustStatus?: string;
        persistenceMode?: string;
        executable?: boolean;
        executorBinding?: { type?: string; skillId?: string } | null;
        provenanceSnapshot?: { author?: string; source?: string; version?: string };
      }>;
    }>('/api/skills/registry');

    expect(registryPayload.total).toBeGreaterThanOrEqual(2);

    const registryById = new Map(
      (registryPayload.skills ?? [])
        .filter((skill): skill is NonNullable<typeof skill> & { skillId: string } => typeof skill.skillId === 'string')
        .map((skill) => [skill.skillId, skill]),
    );

    expect(registryById.get('generated-safe-skill')).toMatchObject({
      trustStatus: 'review-approved',
      persistenceMode: 'restart-safe',
      executable: true,
      executorBinding: {
        type: 'builtin-skill',
        skillId: 'sourceFetch',
      },
      provenanceSnapshot: {
        author: 'integration-suite',
        source: 'generated-fixture',
        version: '1.0.0',
      },
    });
    expect(registryById.get('generated-pending-skill')).toMatchObject({
      trustStatus: 'pending-review',
      persistenceMode: 'metadata-only',
      executable: false,
      executorBinding: null,
      provenanceSnapshot: {
        author: 'integration-suite',
        source: 'manual-fixture',
        version: '1.0.0',
      },
    });

    const policyPayload = await fetchProtected<{
      policy?: {
        totalCount?: number;
        pendingReviewCount?: number;
        approvedCount?: number;
        restartSafeCount?: number;
        restartSafeApprovedCount?: number;
        metadataOnlyCount?: number;
        metadataOnlyApprovedCount?: number;
      };
    }>('/api/skills/policy');

    expect(policyPayload.policy).toMatchObject({
      totalCount: 2,
      pendingReviewCount: 1,
      approvedCount: 1,
      restartSafeCount: 1,
      restartSafeApprovedCount: 1,
      metadataOnlyCount: 1,
      metadataOnlyApprovedCount: 0,
    });

    const systemMonitorTaskId = await triggerTask('system-monitor', {
      type: 'health',
      agents: ['security-agent'],
    });
    await waitForTaskHistoryRecord(systemMonitorTaskId);
    await waitForTaskRun(systemMonitorTaskId);

    const telemetryPayload = await fetchProtected<{
      telemetry?: {
        totalInvocations?: number;
        allowedCount?: number;
        deniedCount?: number;
      };
    }>('/api/skills/telemetry');

    expect(telemetryPayload.telemetry?.totalInvocations).toBeGreaterThan(0);
    expect(telemetryPayload.telemetry?.allowedCount).toBeGreaterThan(0);

    const auditPayload = await fetchProtected<{
      total?: number;
      page?: { returned?: number; hasMore?: boolean };
      records?: Array<{
        agentId?: string;
        skillId?: string;
        allowed?: boolean;
        timestamp?: string;
      }>;
    }>('/api/skills/audit?limit=20');

    expect(auditPayload.total).toBeGreaterThan(0);
    expect(auditPayload.page?.returned).toBeGreaterThan(0);
    expect(auditPayload.records?.some(
      (record) => record.agentId === 'system-monitor-agent' && record.skillId === 'documentParser' && record.allowed === true,
    )).toBe(true);
  });

  it('records success as ok and handler exceptions as error in task history', async () => {
    const runNonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const successTaskId = await triggerTask('heartbeat', {
      reason: 'result-semantics-success',
      runNonce,
    });
    const successRecord = await waitForTaskHistoryRecord(successTaskId);
    expect(successRecord.result).toBe('ok');
    expect(successRecord.message).toContain('heartbeat');

    const backupDigestDir = `${digestDirPath}.vitest-bak-${Date.now()}`;
    let movedDigestDir = false;

    try {
      try {
        await access(digestDirPath);
        await rename(digestDirPath, backupDigestDir);
        movedDigestDir = true;
      } catch {
        movedDigestDir = false;
      }

      const failingTaskId = await triggerTask('send-digest', {
        reason: 'result-semantics-failure',
        runNonce,
      });
      const failingRecord = await waitForTaskHistoryRecord(failingTaskId);
      expect(failingRecord.result).toBe('error');
      expect(failingRecord.message ?? '').toContain('send-digest failed:');
    } finally {
      if (movedDigestDir) {
        await rename(backupDigestDir, digestDirPath);
      }
    }
  });

  it('records integration-workflow success:false as error', async () => {
    const failingTaskId = await triggerTask('integration-workflow', {
      type: 'workflow',
      steps: [
        {
          name: 'force-failure',
          agent: 'integration-agent',
          optional: false,
          simulateFailure: true,
        },
      ],
    });

    const failingRecord = await waitForTaskHistoryRecord(failingTaskId);
    expect(failingRecord.result).toBe('error');
    expect(failingRecord.message ?? '').toContain('integration workflow failed:');
  });

  it('rejects invalid task type through validation middleware', async () => {
    const response = await fetch(`${baseUrl}/api/tasks/trigger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify({ type: 'invalid-task-type', payload: {} }),
    });

    expect(response.status).toBe(400);
  });

  it('rejects webhook requests with missing signature', async () => {
    const payload = {
      alerts: [
        {
          status: 'firing',
          labels: { alertname: 'CPUHigh', severity: 'warning' },
          annotations: { summary: 'CPU is high' },
        },
      ],
    };

    const response = await fetch(`${baseUrl}/webhook/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(401);
  });

  it('accepts canonical webhook signature across key-order variations', async () => {
    const orderedPayload = {
      alerts: [
        {
          status: 'firing',
          labels: { alertname: 'DiskFull', severity: 'critical', agent: 'system-monitor-agent' },
          annotations: { description: 'Disk > 95%', summary: 'Disk pressure high' },
        },
      ],
      groupLabels: { service: 'orchestrator' },
    };

    const reorderedPayload = {
      groupLabels: { service: 'orchestrator' },
      alerts: [
        {
          annotations: { summary: 'Disk pressure high', description: 'Disk > 95%' },
          labels: { severity: 'critical', agent: 'system-monitor-agent', alertname: 'DiskFull' },
          status: 'firing',
        },
      ],
    };

    const signature = computeWebhookSignature(orderedPayload, TEST_WEBHOOK_SECRET);

    const response = await fetch(`${baseUrl}/webhook/alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
      },
      body: JSON.stringify(reorderedPayload),
    });

    expect(response.status).toBe(200);
  });

  it('rejects webhook requests with invalid signature', async () => {
    const payload = {
      alerts: [
        {
          status: 'firing',
          labels: { alertname: 'MemoryHigh', severity: 'warning' },
          annotations: { summary: 'Memory high' },
        },
      ],
    };

    const response = await fetch(`${baseUrl}/webhook/alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': 'deadbeef',
      },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(401);
  });

  it('surfaces service-mode expectation truth through health and truth layers', async () => {
    const healthPayload = await fetchProtected<{
      workers?: {
        declaredAgents?: number;
        serviceExpectedCount?: number;
        serviceAvailableCount?: number;
        serviceInstalledCount?: number;
        serviceRunningCount?: number;
        serviceExpectedGapCount?: number;
      };
      truthLayers?: {
        observed?: {
          serviceMode?: {
            expectedCount?: number;
            entrypointCount?: number;
            installedCount?: number;
            runningCount?: number;
            gapCount?: number;
          };
        };
      };
    }>('/api/health/extended');

    expect(healthPayload.workers?.declaredAgents ?? 0).toBeGreaterThan(0);
    expect(healthPayload.workers?.serviceExpectedCount).toBe(2);
    expect(healthPayload.workers?.serviceAvailableCount ?? 0).toBeGreaterThanOrEqual(2);
    expect(healthPayload.workers?.serviceExpectedGapCount ?? 0).toBeGreaterThanOrEqual(0);
    expect(healthPayload.workers?.serviceExpectedGapCount ?? 0).toBeLessThanOrEqual(
      healthPayload.workers?.serviceExpectedCount ?? 0,
    );
    expect(healthPayload.truthLayers?.observed?.serviceMode?.expectedCount).toBe(
      healthPayload.workers?.serviceExpectedCount,
    );
    expect(healthPayload.truthLayers?.observed?.serviceMode?.entrypointCount).toBe(
      healthPayload.workers?.serviceAvailableCount,
    );
    expect(healthPayload.truthLayers?.observed?.serviceMode?.installedCount).toBeLessThanOrEqual(
      healthPayload.truthLayers?.observed?.serviceMode?.expectedCount ?? 0,
    );
    expect(healthPayload.truthLayers?.observed?.serviceMode?.runningCount).toBeLessThanOrEqual(
      healthPayload.truthLayers?.observed?.serviceMode?.expectedCount ?? 0,
    );
    expect(healthPayload.truthLayers?.observed?.serviceMode?.gapCount).toBe(
      healthPayload.workers?.serviceExpectedGapCount,
    );
  });

  it('exposes explicit agent lifecycle mode through agent overview', async () => {
    const agentsPayload = await fetchProtected<{
      agents?: Array<{
        id?: string;
        serviceExpected?: boolean;
        lifecycleMode?: string;
        hostServiceStatus?: string;
        serviceUnitName?: string | null;
      }>;
    }>('/api/agents/overview');

    const agentsById = new Map(
      (agentsPayload.agents ?? [])
        .filter((agent): agent is NonNullable<typeof agent> & { id: string } => typeof agent.id === 'string')
        .map((agent) => [agent.id, agent]),
    );

    const docSpecialist = agentsById.get('doc-specialist');
    expect(docSpecialist?.serviceExpected).toBe(true);
    expect(docSpecialist?.lifecycleMode).toBe('service-expected');
    expect(docSpecialist?.serviceUnitName).toBe('doc-specialist.service');
    expect([
      'running',
      'installed-stopped',
      'not-installed',
      'probe-unavailable',
      'missing-entrypoint',
    ]).toContain(docSpecialist?.hostServiceStatus);

    const buildRefactor = agentsById.get('build-refactor-agent');
    expect(buildRefactor?.serviceExpected).toBe(false);
    expect(buildRefactor?.lifecycleMode).toBe('worker-first');
    expect(buildRefactor?.hostServiceStatus).toBe('not-applicable');
  });

  it('exposes enriched incidents and persists acknowledgement and owner updates', async () => {
    const overview = await fetchProtected<{
      queue?: {
        pressure?: Array<{
          type?: string;
          source?: string;
          queuedCount?: number;
          processingCount?: number;
        }>;
      };
      incidents?: {
        openCount?: number;
        topClassifications?: Array<{
          classification?: string;
          label?: string;
          count?: number;
          highestSeverity?: string;
        }>;
      };
    }>('/api/dashboard/overview');

    expect(overview.incidents?.openCount ?? 0).toBeGreaterThan(0);
    expect(Array.isArray(overview.queue?.pressure)).toBe(true);
    expect(Array.isArray(overview.incidents?.topClassifications)).toBe(true);
    expect((overview.incidents?.topClassifications ?? []).length).toBeGreaterThan(0);
    expect(overview.incidents?.topClassifications?.[0]?.classification).toBeTruthy();
    expect(overview.incidents?.topClassifications?.[0]?.label).toBeTruthy();
    expect(overview.incidents?.topClassifications?.[0]?.count ?? 0).toBeGreaterThan(0);
    expect(overview.incidents?.topClassifications?.[0]?.highestSeverity).toBeTruthy();
    const listPayload = await fetchProtected<{
      incidents?: Array<{
        id?: string;
        firstSeenAt?: string | null;
        lastSeenAt?: string | null;
        remediation?: { nextAction?: string | null };
      }>;
    }>('/api/incidents?limit=20');
    const incident = listPayload.incidents?.[0];
    expect(incident?.id).toBeTruthy();
    expect(incident?.firstSeenAt).toBeTruthy();
    expect(incident?.lastSeenAt).toBeTruthy();
    expect(incident?.remediation?.nextAction).toBeTruthy();

    const acknowledgeResponse = await fetch(
      `${baseUrl}/api/incidents/${encodeURIComponent(String(incident?.id))}/acknowledge`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          actor: 'integration-test-operator',
          note: 'Acknowledged by integration test',
        }),
      },
    );
    expect(acknowledgeResponse.status).toBe(200);
    const acknowledged = await acknowledgeResponse.json() as {
      incident?: { acknowledgedAt?: string | null; acknowledgedBy?: string | null };
    };
    expect(acknowledged.incident?.acknowledgedAt).toBeTruthy();
    expect(acknowledged.incident?.acknowledgedBy).toBe('integration-test-operator');

    const ownerResponse = await fetch(
      `${baseUrl}/api/incidents/${encodeURIComponent(String(incident?.id))}/owner`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({ owner: 'integration-test-operator' }),
      },
    );
    expect(ownerResponse.status).toBe(200);
    const owned = await ownerResponse.json() as {
      incident?: { owner?: string | null };
    };
    expect(owned.incident?.owner).toBe('integration-test-operator');
  });

  it('exposes incident history views and linked remediation task creation', { timeout: 60000 }, async () => {
    const overview = await fetchProtected<{
      incidents?: Array<{ id?: string; linkedRunIds?: string[] }>;
    }>('/api/incidents?includeResolved=true&limit=20');
    const linkedIncident = overview.incidents?.find(
      (incident) => (incident.linkedRunIds ?? []).length > 0,
    );
    const incidentId =
      linkedIncident?.id ?? overview.incidents?.[0]?.id;
    expect(incidentId).toBeTruthy();

    const listPayload = await fetchProtected<{
      incidents?: Array<{ id?: string }>;
    }>('/api/incidents?includeResolved=true&limit=20');
    expect((listPayload.incidents ?? []).some((incident) => incident.id === incidentId)).toBe(
      true,
    );

    const remediationResponse = await fetch(
      `${baseUrl}/api/incidents/${encodeURIComponent(String(incidentId))}/remediate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          actor: 'integration-test-operator',
          note: 'Create remediation task from integration test',
          taskType: 'system-monitor',
        }),
      },
    );
    expect(remediationResponse.status).toBe(200);
    const remediationPayload = await remediationResponse.json() as {
      remediationTask?: { taskId?: string | null };
      incident?: {
        remediationTasks?: Array<{ taskId?: string | null }>;
        history?: Array<{ type?: string }>;
      };
    };
    expect(remediationPayload.remediationTask?.taskId).toBeTruthy();
    expect((remediationPayload.incident?.remediationTasks ?? []).length).toBeGreaterThan(0);
    expect(
      (remediationPayload.incident?.history ?? []).some(
        (event) => event.type === 'remediation-task-created',
      ),
    ).toBe(true);

    const detailPayload = await fetchProtected<{
      incident?: {
        policyExecutions?: Array<{ action?: string; result?: string; taskId?: string | null }>;
        acknowledgements?: unknown[];
        ownershipHistory?: unknown[];
        remediationTasks?: Array<{ taskId?: string | null }>;
        history?: Array<{ type?: string }>;
      };
    }>(`/api/incidents/${encodeURIComponent(String(incidentId))}`);
    expect(Array.isArray(detailPayload.incident?.policyExecutions)).toBe(true);
    expect(Array.isArray(detailPayload.incident?.acknowledgements)).toBe(true);
    expect(Array.isArray(detailPayload.incident?.ownershipHistory)).toBe(true);
    expect((detailPayload.incident?.remediationTasks ?? []).length).toBeGreaterThan(0);
    expect((detailPayload.incident?.history ?? []).length).toBeGreaterThan(0);

    await waitForTaskHistoryRecord(String(remediationPayload.remediationTask?.taskId));
    const remediationRun = await waitForTaskRun(String(remediationPayload.remediationTask?.taskId));
    const historyPayload = await fetchProtected<{
      remediationTasks?: Array<{
        taskId?: string | null;
        status?: string | null;
        assignedAt?: string | null;
        executionStartedAt?: string | null;
        lastUpdatedAt?: string | null;
      }>;
    }>(`/api/incidents/${encodeURIComponent(String(incidentId))}/history`);
    const remediationHistory = historyPayload.remediationTasks?.find(
      (task) => task.taskId === remediationPayload.remediationTask?.taskId,
    );
    expect(remediationHistory?.assignedAt).toBeTruthy();
    expect(remediationHistory?.lastUpdatedAt).toBeTruthy();
    expect(remediationHistory?.status).toBeTruthy();

    const remediationRunDetail = await waitForRunWorkflowGraph(
      String(remediationRun.runId),
      (graph) =>
        Array.isArray(graph?.crossRunLinks) &&
        Array.isArray(graph?.relatedRuns) &&
        Boolean(graph?.dependencySummary),
    );
    expect(Array.isArray(remediationRunDetail.run?.workflowGraph?.crossRunLinks)).toBe(true);
    expect(Array.isArray(remediationRunDetail.run?.workflowGraph?.relatedRuns)).toBe(true);
    expect(remediationRunDetail.run?.workflowGraph?.dependencySummary).toBeTruthy();
  });

  it('returns workflow summaries, workflow graph detail, and agent capability surfaces', { timeout: 60000 }, async () => {
    const taskId = await triggerTask('heartbeat', {
      reason: 'workflow-graph-validation',
    });

    await waitForTaskHistoryRecord(taskId);
    const run = await waitForTaskRun(taskId);

    const runsPayload = await fetchProtected<{
      runs: Array<{
        taskId?: string;
        workflow?: {
          graphStatus?: string;
          stopClassification?: string | null;
          nodeCount?: number;
          edgeCount?: number;
          stageDurations?: Record<string, number>;
          timingBreakdown?: Record<string, { eventCount?: number }>;
        };
      }>;
    }>('/api/tasks/runs?limit=100');

    const runSummary = runsPayload.runs.find((item) => item.taskId === taskId);
    expect(runSummary?.workflow?.graphStatus).toBeTruthy();
    expect(runSummary?.workflow?.stopClassification).toBeTruthy();
    expect(runSummary?.workflow?.nodeCount ?? 0).toBeGreaterThan(0);
    expect(runSummary?.workflow?.edgeCount ?? 0).toBeGreaterThan(0);
    expect(runSummary?.workflow?.stageDurations).toBeTruthy();
    expect(runSummary?.workflow?.timingBreakdown).toBeTruthy();

    const detailPayload = await fetchProtected<{
      run?: {
        workflowGraph?: {
          stopClassification?: string | null;
          timingBreakdown?: Record<string, { eventCount?: number }>;
          nodes?: unknown[];
          edges?: unknown[];
          events?: unknown[];
          crossRunLinks?: unknown[];
          relatedRuns?: unknown[];
          dependencySummary?: {
            dependencyLinkCount?: number;
            handoffLinkCount?: number;
          };
        };
      };
    }>(`/api/tasks/runs/${encodeURIComponent(String(run.runId))}`);
    expect(detailPayload.run?.workflowGraph?.stopClassification).toBeTruthy();
    expect(detailPayload.run?.workflowGraph?.timingBreakdown).toBeTruthy();
    expect((detailPayload.run?.workflowGraph?.nodes ?? []).length).toBeGreaterThan(0);
    expect((detailPayload.run?.workflowGraph?.edges ?? []).length).toBeGreaterThan(0);
    expect((detailPayload.run?.workflowGraph?.events ?? []).length).toBeGreaterThan(0);
    expect(Array.isArray(detailPayload.run?.workflowGraph?.crossRunLinks)).toBe(true);
    expect(Array.isArray(detailPayload.run?.workflowGraph?.relatedRuns)).toBe(true);
    expect(detailPayload.run?.workflowGraph?.dependencySummary).toBeTruthy();

    const agentsPayload = await fetchProtected<{
      topology?: {
        counts?: { relationshipEdges?: number };
        edges?: Array<{ relationship?: string }>;
      };
      relationshipHistory?: {
        totalObservations?: number;
        recent?: Array<{ relationship?: string; source?: string }>;
        timeline?: Array<{ total?: number }>;
      };
      agents?: Array<{
        id?: string;
        capability?: {
          currentReadiness?: string;
          evidence?: string[];
          targetCapabilities?: string[];
          evidenceProfiles?: Array<{ area?: string; status?: string }>;
          ultraGapSummary?: string;
        };
      }>;
    }>('/api/agents/overview');

    expect((agentsPayload.agents ?? []).length).toBeGreaterThan(0);
    for (const agent of agentsPayload.agents ?? []) {
      expect(agent.capability?.currentReadiness).toBeTruthy();
      expect(Array.isArray(agent.capability?.evidence)).toBe(true);
      expect(Array.isArray(agent.capability?.targetCapabilities)).toBe(true);
      expect(Array.isArray(agent.capability?.evidenceProfiles)).toBe(true);
      expect(agent.capability?.ultraGapSummary).toBeTruthy();
    }
    expect(agentsPayload.topology?.counts?.relationshipEdges ?? 0).toBeGreaterThan(0);
    expect(
      (agentsPayload.topology?.edges ?? []).some(
        (edge) => edge.relationship === 'feeds-agent' || edge.relationship === 'coordinates-agent',
      ),
    ).toBe(true);
    expect(agentsPayload.relationshipHistory?.totalObservations ?? 0).toBeGreaterThan(0);
    expect((agentsPayload.relationshipHistory?.recent ?? []).length).toBeGreaterThan(0);
    expect(Array.isArray(agentsPayload.relationshipHistory?.timeline)).toBe(true);
  });

  it('surfaces Wave 1 runtime readiness signals through agent overview', { timeout: 90000 }, async () => {
    const docTaskId = await triggerTask('drift-repair', {
      requestedBy: 'integration-wave1-readiness',
      paths: [resolve(process.cwd(), '..', 'README.md')],
      targets: ['doc-specialist'],
    });
    await waitForTaskHistoryRecord(docTaskId);
    await waitForTaskRun(docTaskId);

    const integrationTaskId = await triggerTask('integration-workflow', {
      type: 'wave1-readiness',
      steps: [
        {
          name: 'collect-runtime-proof',
          agent: 'doc-specialist',
          surface: 'docs',
        },
        {
          name: 'verify-workflow-closure',
          agent: 'qa-verification-agent',
          surface: 'workflow',
        },
      ],
    });
    await waitForTaskHistoryRecord(integrationTaskId);
    await waitForTaskRun(integrationTaskId);

    const systemMonitorTaskId = await triggerTask('system-monitor', {
      type: 'health',
      agents: ['security-agent', 'qa-verification-agent'],
    });
    await waitForTaskHistoryRecord(systemMonitorTaskId);
    await waitForTaskRun(systemMonitorTaskId);

    const securityTaskId = await triggerTask('security-audit', {
      type: 'scan',
      scope: 'workspace',
    });
    await waitForTaskHistoryRecord(securityTaskId);
    await waitForTaskRun(securityTaskId);

    const qaTaskId = await triggerTask('qa-verification', {
      target: 'workflow',
      targetAgentId: 'integration-agent',
      suite: 'smoke',
      mode: 'dry-run',
      dryRun: true,
      runIds: ['wave1-readiness-run'],
      affectedSurfaces: ['workflow'],
    });
    await waitForTaskHistoryRecord(qaTaskId);
    await waitForTaskRun(qaTaskId);

    const agentsPayload = await fetchProtected<{
      agents?: Array<{
        id?: string;
        capability?: {
          runtimeEvidence?: {
            latestSuccessfulRunId?: string | null;
            latestSuccessfulTaskId?: string | null;
            latestHandledAt?: string | null;
            highlightKeys?: string[];
            signals?: Array<{
              key?: string;
              summary?: string;
              observedAt?: string | null;
              runId?: string | null;
              taskId?: string | null;
              evidence?: string[];
            }>;
          };
        };
      }>;
    }>('/api/agents/overview');

    const agentsById = new Map(
      (agentsPayload.agents ?? [])
        .filter((agent): agent is NonNullable<typeof agent> & { id: string } => typeof agent.id === 'string')
        .map((agent) => [agent.id, agent]),
    );

    const expectRuntimeSignal = (agentId: string, key: string) => {
      const runtimeEvidence = agentsById.get(agentId)?.capability?.runtimeEvidence;
      expect(runtimeEvidence?.latestSuccessfulRunId).toBeTruthy();
      expect(runtimeEvidence?.latestSuccessfulTaskId).toBeTruthy();
      expect(runtimeEvidence?.latestHandledAt).toBeTruthy();
      expect(runtimeEvidence?.highlightKeys).toContain(key);

      const signal = runtimeEvidence?.signals?.find((entry) => entry.key === key);
      expect(signal?.summary).toBeTruthy();
      expect(signal?.observedAt).toBeTruthy();
      expect(signal?.runId).toBeTruthy();
      expect(signal?.taskId).toBeTruthy();
      expect(Array.isArray(signal?.evidence)).toBe(true);
      expect((signal?.evidence ?? []).length).toBeGreaterThan(0);
    };

    expectRuntimeSignal('doc-specialist', 'taskSpecificKnowledge');
    expectRuntimeSignal('doc-specialist', 'evidenceRails');
    expectRuntimeSignal('doc-specialist', 'topologyPacks');
    expectRuntimeSignal('doc-specialist', 'contradictionLedger');
    expectRuntimeSignal('doc-specialist', 'repairDrafts');
    expectRuntimeSignal('doc-specialist', 'freshnessSignals');
    expectRuntimeSignal('doc-specialist', 'entityFreshnessLedger');
    expectRuntimeSignal('doc-specialist', 'contradictionGraph');
    expectRuntimeSignal('integration-agent', 'partialCompletion');
    expectRuntimeSignal('integration-agent', 'workflowProfile');
    expectRuntimeSignal('integration-agent', 'delegationPlan');
    expectRuntimeSignal('integration-agent', 'replayContract');
    expectRuntimeSignal('integration-agent', 'handoffPackages');
    expectRuntimeSignal('integration-agent', 'dependencyPlan');
    expectRuntimeSignal('integration-agent', 'workflowMemory');
    expectRuntimeSignal('system-monitor-agent', 'operationalDiagnosis');
    expectRuntimeSignal('system-monitor-agent', 'queueBudgetFusion');
    expectRuntimeSignal('system-monitor-agent', 'dependencyHealth');
    expectRuntimeSignal('system-monitor-agent', 'earlyWarnings');
    expectRuntimeSignal('system-monitor-agent', 'operatorClosureEvidence');
    expectRuntimeSignal('system-monitor-agent', 'trendSummary');
    expectRuntimeSignal('security-agent', 'regressionReview');
    expectRuntimeSignal('security-agent', 'trustBoundaryHistory');
    expectRuntimeSignal('security-agent', 'permissionDriftTimeline');
    expectRuntimeSignal('security-agent', 'routeBoundaryWatch');
    expectRuntimeSignal('security-agent', 'remediationDepth');
    expectRuntimeSignal('security-agent', 'exploitabilityRanking');
    expectRuntimeSignal('security-agent', 'remediationClosure');
    expectRuntimeSignal('qa-verification-agent', 'acceptanceCoverage');
    expectRuntimeSignal('qa-verification-agent', 'verificationAuthority');
    expectRuntimeSignal('qa-verification-agent', 'verificationTrace');
    expectRuntimeSignal('qa-verification-agent', 'verificationSurface');
    expectRuntimeSignal('qa-verification-agent', 'refusalProfile');
    expectRuntimeSignal('qa-verification-agent', 'closureContract');
    expectRuntimeSignal('qa-verification-agent', 'reproducibilityProfile');
  });

  it('surfaces Wave 2 runtime readiness signals through agent overview', { timeout: 90000 }, async () => {
    const redditTaskId = await triggerTask('reddit-response', {
      responder: 'reddit-helper',
      queue: {
        id: 'wave2-reddit-1',
        subreddit: 'OpenClawOps',
        question: 'How should reddit-helper handle provider trouble without losing doctrine?',
        link: 'https://reddit.com/r/OpenClawOps/comments/wave2-reddit-1',
        tag: 'priority',
        pillar: 'operator-proof',
        entryContent: 'Need a grounded explanation of fallback posture and doc-gap routing.',
        matchedKeywords: ['provider', 'fallback', 'doctrine'],
        score: 0.91,
        selectedForDraft: true,
      },
    });
    await waitForTaskHistoryRecord(redditTaskId);
    await waitForTaskRun(redditTaskId);

    const contentTaskId = await triggerTask('content-generate', {
      type: 'proof_summary',
      source: {
        name: 'Wave 2 Capability Proof',
        description: 'Summarize grounded communication proof for operator review.',
        evidence: ['incident:wave2-proof', 'proof:operator-readiness'],
        metadata: { topic: 'wave2-proof' },
      },
    });
    await waitForTaskHistoryRecord(contentTaskId);
    await waitForTaskRun(contentTaskId);

    const summaryTaskId = await triggerTask('summarize-content', {
      sourceType: 'report',
      content:
        'incident:wave2-proof requires operator review before proof:wave2-release can close. task:wave2-summary remains pending for qa follow-through.',
      format: 'incident_handoff',
      metadata: { topic: 'wave2-incident-handoff' },
    });
    await waitForTaskHistoryRecord(summaryTaskId);
    await waitForTaskRun(summaryTaskId);

    const extractionTaskId = await triggerTask('data-extraction', {
      input: {
        source: {
          type: 'inline',
          content: 'name: Wave2\nstatus: active\nmode: readiness',
        },
        schema: {
          name: 'string',
          status: 'string',
          mode: 'string',
        },
      },
    });
    await waitForTaskHistoryRecord(extractionTaskId);
    await waitForTaskRun(extractionTaskId);

    const normalizationTaskId = await triggerTask('normalize-data', {
      type: 'normalize',
      input: [{ name: 'Wave2', status: '', mode: 'readiness' }],
      schema: {
        name: 'string',
        status: 'string',
        mode: 'string',
      },
    });
    await waitForTaskHistoryRecord(normalizationTaskId);
    await waitForTaskRun(normalizationTaskId);

    const marketTaskId = await triggerTask('market-research', {
      query: 'operator dashboard policy changes',
      scope: 'policy',
    });
    await waitForTaskHistoryRecord(marketTaskId);
    await waitForTaskRun(marketTaskId);

    const agentsPayload = await fetchProtected<{
      agents?: Array<{
        id?: string;
        capability?: {
          runtimeEvidence?: {
            latestSuccessfulRunId?: string | null;
            latestSuccessfulTaskId?: string | null;
            latestHandledAt?: string | null;
            highlightKeys?: string[];
            signals?: Array<{
              key?: string;
              summary?: string;
              observedAt?: string | null;
              runId?: string | null;
              taskId?: string | null;
              evidence?: string[];
            }>;
          };
        };
      }>;
    }>('/api/agents/overview');

    const agentsById = new Map(
      (agentsPayload.agents ?? [])
        .filter((agent): agent is NonNullable<typeof agent> & { id: string } => typeof agent.id === 'string')
        .map((agent) => [agent.id, agent]),
    );

    const expectRuntimeSignal = (agentId: string, key: string) => {
      const runtimeEvidence = agentsById.get(agentId)?.capability?.runtimeEvidence;
      expect(runtimeEvidence?.latestSuccessfulRunId).toBeTruthy();
      expect(runtimeEvidence?.latestSuccessfulTaskId).toBeTruthy();
      expect(runtimeEvidence?.latestHandledAt).toBeTruthy();
      expect(runtimeEvidence?.highlightKeys).toContain(key);

      const signal = runtimeEvidence?.signals?.find((entry) => entry.key === key);
      expect(signal?.summary).toBeTruthy();
      expect(signal?.observedAt).toBeTruthy();
      expect(signal?.runId).toBeTruthy();
      expect(signal?.taskId).toBeTruthy();
      expect(Array.isArray(signal?.evidence)).toBe(true);
      expect((signal?.evidence ?? []).length).toBeGreaterThan(0);
    };

    expectRuntimeSignal('reddit-helper', 'providerPosture');
    expectRuntimeSignal('content-agent', 'publicationPolicy');
    expectRuntimeSignal('summarization-agent', 'operationalCompression');
    expectRuntimeSignal('data-extraction-agent', 'artifactCoverage');
    expectRuntimeSignal('normalization-agent', 'comparisonReadiness');
    expectRuntimeSignal('market-research-agent', 'deltaCapture');
  });

  it('surfaces Wave 3 runtime readiness signals through agent overview', { timeout: 90000 }, async () => {
    const remediationResponse = await fetch(`${baseUrl}/api/incidents/seed-proof-incident/remediate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify({
        taskType: 'build-refactor',
        actor: 'integration-suite',
        note: 'Queue bounded code remediation for Wave 3 readiness proof.',
      }),
    });

    expect(remediationResponse.status).toBe(200);
    const remediationPayload = await remediationResponse.json() as {
      remediationTask?: {
        taskId?: string;
        taskType?: string;
      };
      incident?: {
        remediationTasks?: Array<{
          taskType?: string;
          lane?: string;
        }>;
      };
    };
    expect(remediationPayload.remediationTask?.taskType).toBe('build-refactor');
    expect(
      (remediationPayload.incident?.remediationTasks ?? []).some(
        (task) => task.taskType === 'build-refactor' && task.lane === 'primary',
      ),
    ).toBe(true);

    const buildRefactorApproval = await waitForPendingApproval(
      String(remediationPayload.remediationTask?.taskId),
    );
    expect(buildRefactorApproval.type).toBe('build-refactor');
    const buildRefactorDecision = await decideApproval(
      String(remediationPayload.remediationTask?.taskId),
      'approved',
    );
    expect(buildRefactorDecision.replayTaskId).toBeTruthy();
    await waitForTaskHistoryRecord(String(buildRefactorDecision.replayTaskId));
    await waitForTaskRun(String(buildRefactorDecision.replayTaskId));

    const skillAuditTaskId = await triggerTask('skill-audit', {
      skillIds: ['sourceFetch', 'generated-safe-skill', 'generated-pending-skill'],
      depth: 'standard',
      checks: ['schemas', 'provenance', 'permissions'],
    });

    await waitForTaskHistoryRecord(skillAuditTaskId);
    await waitForTaskRun(skillAuditTaskId);

    const agentsPayload = await fetchProtected<{
      agents?: Array<{
        id?: string;
        capability?: {
          runtimeEvidence?: {
            latestSuccessfulRunId?: string | null;
            highlightKeys?: string[];
            signals?: Array<{
              key?: string;
              summary?: string;
              evidence?: string[];
            }>;
          };
          evidenceProfiles?: Array<{
            area?: string;
            status?: string;
            summary?: string;
            evidence?: string[];
          }>;
        };
      }>;
    }>('/api/agents/overview');

    const buildRefactorAgent = (agentsPayload.agents ?? []).find(
      (agent) => agent.id === 'build-refactor-agent',
    );
    const buildRuntimeEvidence = buildRefactorAgent?.capability?.runtimeEvidence;
    expect(buildRuntimeEvidence?.latestSuccessfulRunId).toBeTruthy();
    expect(buildRuntimeEvidence?.highlightKeys).toContain('scopeContract');
    expect(buildRuntimeEvidence?.highlightKeys).toContain('surgeryProfile');
    expect(buildRuntimeEvidence?.highlightKeys).toContain('verificationLoop');
    expect(buildRuntimeEvidence?.highlightKeys).toContain('impactEnvelope');
    expect(buildRuntimeEvidence?.highlightKeys).toContain('refusalProfile');
    expect(
      (buildRuntimeEvidence?.signals ?? []).find((signal) => signal.key === 'scopeContract')?.summary,
    ).toBeTruthy();
    expect(
      (buildRuntimeEvidence?.signals ?? []).find((signal) => signal.key === 'surgeryProfile')?.summary,
    ).toBeTruthy();
    expect(
      (buildRuntimeEvidence?.signals ?? []).find((signal) => signal.key === 'verificationLoop')?.summary,
    ).toBeTruthy();
    expect(
      (buildRuntimeEvidence?.signals ?? []).find((signal) => signal.key === 'impactEnvelope')?.summary,
    ).toBeTruthy();
    expect(
      (buildRuntimeEvidence?.signals ?? []).find((signal) => signal.key === 'refusalProfile')?.summary,
    ).toBeTruthy();

    const buildGovernanceProfile = (buildRefactorAgent?.capability?.evidenceProfiles ?? []).find(
      (profile) => profile.area === 'code-governance-depth',
    );
    expect(buildGovernanceProfile?.status).toBeTruthy();
    expect(buildGovernanceProfile?.summary).toBeTruthy();
    expect((buildGovernanceProfile?.evidence ?? []).length).toBeGreaterThan(0);

    const skillAuditAgent = (agentsPayload.agents ?? []).find(
      (agent) => agent.id === 'skill-audit-agent',
    );
    const runtimeEvidence = skillAuditAgent?.capability?.runtimeEvidence;
    expect(runtimeEvidence?.latestSuccessfulRunId).toBeTruthy();
    expect(runtimeEvidence?.highlightKeys).toContain('trustPosture');
    expect(runtimeEvidence?.highlightKeys).toContain('policyHandoff');
    expect(runtimeEvidence?.highlightKeys).toContain('telemetryHandoff');
    expect(runtimeEvidence?.highlightKeys).toContain('intakeCoverage');
    expect(runtimeEvidence?.highlightKeys).toContain('restartSafetySummary');
    expect(
      (runtimeEvidence?.signals ?? []).find((signal) => signal.key === 'trustPosture')?.summary,
    ).toBeTruthy();
    expect(
      (runtimeEvidence?.signals ?? []).find((signal) => signal.key === 'policyHandoff')?.summary,
    ).toBeTruthy();
    expect(
      (runtimeEvidence?.signals ?? []).find((signal) => signal.key === 'telemetryHandoff')?.summary,
    ).toBeTruthy();
    expect(
      (runtimeEvidence?.signals ?? []).find((signal) => signal.key === 'intakeCoverage')?.summary,
    ).toBeTruthy();
    expect(
      (runtimeEvidence?.signals ?? []).find((signal) => signal.key === 'restartSafetySummary')?.summary,
    ).toBeTruthy();

    const governanceProfile = (skillAuditAgent?.capability?.evidenceProfiles ?? []).find(
      (profile) => profile.area === 'governance-depth',
    );
    expect(governanceProfile?.status).toBeTruthy();
    expect(governanceProfile?.summary).toBeTruthy();
    expect((governanceProfile?.evidence ?? []).length).toBeGreaterThan(0);
  });

  it('closes public proof linkage across incident, remediation, and run workflow detail', async () => {
    const seededIncident = await fetchProtected<{
      incident?: {
        id?: string;
        linkedProofDeliveries?: string[];
        linkedRunIds?: string[];
      };
    }>('/api/incidents/seed-proof-incident');

    expect(seededIncident.incident?.id).toBe('seed-proof-incident');
    expect(seededIncident.incident?.linkedProofDeliveries).toContain('seed-proof-1');
    expect(seededIncident.incident?.linkedRunIds).toContain('seed-proof-run');

    const remediationResponse = await fetch(
      `${baseUrl}/api/incidents/seed-proof-incident/remediate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify({
          actor: 'integration-test-operator',
          note: 'Replay the seeded public proof surface.',
          taskType: 'system-monitor',
        }),
      },
    );
    expect(remediationResponse.status).toBe(200);
    const remediationPayload = await remediationResponse.json() as {
      remediationTask?: { taskId?: string | null };
    };
    expect(remediationPayload.remediationTask?.taskId).toBeTruthy();

    await waitForTaskHistoryRecord(String(remediationPayload.remediationTask?.taskId));
    const remediationRun = await waitForTaskRun(String(remediationPayload.remediationTask?.taskId));

    const seededRunDetail = await fetchProtected<{
      run?: {
        workflowGraph?: {
          stopClassification?: string | null;
          proofLinks?: Array<{
            id?: string;
            type?: string;
            status?: string;
            summary?: string;
            target?: string | null;
          }>;
        };
      };
    }>('/api/tasks/runs/seed-proof-run');

    expect(seededRunDetail.run?.workflowGraph?.stopClassification).toBe('proof-degraded');
    expect(seededRunDetail.run?.workflowGraph?.proofLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'seed-proof-1',
          type: 'milestone',
          status: 'degraded',
        }),
      ]),
    );
    expect(
      (seededRunDetail.run?.workflowGraph?.proofLinks ?? []).find(
        (link) => link.id === 'seed-proof-1',
      )?.summary,
    ).toBeTruthy();

    const incidentHistory = await fetchProtected<{
      remediationTasks?: Array<{ taskId?: string | null; runId?: string | null }>;
    }>('/api/incidents/seed-proof-incident/history');
    expect(
      (incidentHistory.remediationTasks ?? []).some(
        (task) => task.taskId === remediationPayload.remediationTask?.taskId,
      ),
    ).toBe(true);

    const remediationRunDetail = await fetchProtected<{
      run?: {
        workflowGraph?: {
          relatedRuns?: Array<{ runId?: string }>;
          crossRunLinks?: Array<{ relationship?: string }>;
        };
      };
    }>(`/api/tasks/runs/${encodeURIComponent(String(remediationRun.runId))}`);
    expect((remediationRunDetail.run?.workflowGraph?.crossRunLinks ?? []).length).toBeGreaterThan(0);
    expect((remediationRunDetail.run?.workflowGraph?.relatedRuns ?? []).length).toBeGreaterThan(0);
  });

  it('serves orchestrator-owned milestone and demand proof routes directly from runtime state', async () => {
    const overview = await fetchPublic<{
      ok?: boolean;
      activeLanes?: string[];
      deadLetterCount?: number;
      proofNodes?: Array<{ id?: string; state?: string }>;
    }>('/api/command-center/overview');
    expect(overview.ok).toBe(true);
    expect(overview.activeLanes).toContain('demand-runtime');
    expect(overview.deadLetterCount ?? 0).toBeGreaterThan(0);
    expect((overview.proofNodes ?? []).length).toBeGreaterThan(0);

    const demand = await fetchPublic<{
      ok?: boolean;
      segments?: Array<{ label?: string; state?: string }>;
      summary?: {
        queueTotal?: number;
        draftTotal?: number;
        selectedForDraftTotal?: number;
        topSegmentLabel?: string | null;
        source?: string;
        stale?: boolean;
      };
    }>('/api/command-center/demand');
    expect(demand.ok).toBe(true);
    expect(demand.summary?.draftTotal ?? 0).toBeGreaterThan(0);
    expect(demand.summary?.selectedForDraftTotal ?? 0).toBeGreaterThan(0);
    expect(demand.summary?.topSegmentLabel).toBe('operator-proof');
    expect((demand.segments ?? []).length).toBeGreaterThan(0);
    expect((demand.segments ?? []).some((segment) => segment.label === 'operator-proof')).toBe(
      true,
    );

    const demandLive = await fetchPublic<{
      ok?: boolean;
      summary?: {
        queueTotal?: number;
        draftTotal?: number;
        selectedForDraftTotal?: number;
        source?: string;
        stale?: boolean;
      };
    }>('/api/command-center/demand-live');
    expect(demandLive.ok).toBe(true);
    expect(demandLive.summary?.draftTotal).toBe(demand.summary?.draftTotal);
    expect(demandLive.summary?.selectedForDraftTotal).toBe(
      demand.summary?.selectedForDraftTotal,
    );
    expect(demandLive.summary?.source).toBe('live');
    expect(demandLive.summary?.stale).toBe(false);

    const latestMilestones = await fetchPublic<{
      ok?: boolean;
      items?: Array<{ milestoneId?: string; scope?: string }>;
    }>('/api/milestones/latest?limit=50');
    expect(latestMilestones.ok).toBe(true);
    expect(
      (latestMilestones.items ?? []).some((item) => item.milestoneId === 'demand:runtime-summary'),
    ).toBe(true);
    expect(
      (latestMilestones.items ?? []).some(
        (item) =>
          typeof item.milestoneId === 'string' &&
          item.milestoneId.startsWith('incident:'),
      ),
    ).toBe(true);

    const deadLetter = await fetchPublic<{
      ok?: boolean;
      items?: Array<{ milestoneId?: string; riskStatus?: string }>;
    }>('/api/milestones/dead-letter');
    expect(deadLetter.ok).toBe(true);
    expect((deadLetter.items ?? []).length).toBeGreaterThan(0);
    expect(
      (deadLetter.items ?? []).every(
        (item) => item.riskStatus === 'blocked' || item.riskStatus === 'at-risk',
      ),
    ).toBe(true);
  });

  it('surfaces bounded agent result highlights through task run APIs', { timeout: 60000 }, async () => {
    const systemMonitorTaskId = await triggerTask('system-monitor', {
      type: 'health',
      agents: ['security-agent'],
    });

    await waitForTaskHistoryRecord(systemMonitorTaskId);
    const systemMonitorRun = await waitForTaskRun(systemMonitorTaskId);

    const contentTaskId = await triggerTask('content-generate', {
      type: 'proof_summary',
      source: {
        name: 'Capability Promotion',
        description: 'Summarize grounded operator proof for promotion review.',
        evidence: ['incident:capability-uplift', 'proof:operator-surface'],
        metadata: {
          topic: 'capability-promotion',
        },
      },
    });

    await waitForTaskHistoryRecord(contentTaskId);
    const contentRun = await waitForTaskRun(contentTaskId);

    const runsPayload = await fetchProtected<{
      runs: Array<{
        taskId?: string;
        cost?: number;
        latency?: number | null;
        accounting?: {
          metered?: boolean;
          pricingSource?: string;
        } | null;
        resultSummary?: {
          success?: boolean;
          keys?: string[];
          highlights?: {
            operatorSummary?: string;
            recommendedNextActions?: {
              count?: number;
              sample?: string[];
            };
            specialistContract?: {
              role?: string;
              status?: string;
              workflowStage?: string;
            };
            queueBudgetFusion?: {
              dependencyRiskScore?: number;
              predictionConfidence?: string;
            };
            routingDecision?: {
              documentMode?: string;
              downstreamAgent?: string;
            };
          };
        };
      }>;
    }>('/api/tasks/runs?limit=100');

    const systemMonitorSummary = runsPayload.runs.find((item) => item.taskId === systemMonitorTaskId);
    expect(systemMonitorSummary?.resultSummary?.keys).toContain('specialistContract');
    expect(systemMonitorSummary?.resultSummary?.keys).toContain('operatorSummary');
    expect(systemMonitorSummary?.resultSummary?.keys).toContain('recommendedNextActions');
    expect(systemMonitorSummary?.resultSummary?.keys).toContain('queueBudgetFusion');
    expect(systemMonitorSummary?.cost).toBe(0);
    expect(systemMonitorSummary?.latency).not.toBeNull();
    expect(systemMonitorSummary?.latency ?? -1).toBeGreaterThanOrEqual(0);
    expect(systemMonitorSummary?.accounting?.metered).toBe(false);
    expect(systemMonitorSummary?.resultSummary?.highlights?.operatorSummary).toBeTruthy();
    expect(systemMonitorSummary?.resultSummary?.highlights?.specialistContract?.role).toBe(
      'SRE Monitor',
    );
    expect(systemMonitorSummary?.resultSummary?.highlights?.specialistContract?.status).toBeTruthy();
    expect(systemMonitorSummary?.resultSummary?.highlights?.recommendedNextActions?.count ?? 0).toBeGreaterThan(0);
    expect(
      typeof systemMonitorSummary?.resultSummary?.highlights?.queueBudgetFusion?.dependencyRiskScore,
    ).toBe('number');
    expect(
      systemMonitorSummary?.resultSummary?.highlights?.queueBudgetFusion?.predictionConfidence,
    ).toBeTruthy();

    const contentSummary = runsPayload.runs.find((item) => item.taskId === contentTaskId);
    expect(contentSummary?.resultSummary?.keys).toContain('specialistContract');
    expect(contentSummary?.resultSummary?.keys).toContain('operatorSummary');
    expect(contentSummary?.resultSummary?.keys).toContain('routingDecision');
    expect(contentSummary?.resultSummary?.highlights?.specialistContract?.role).toBe(
      'Content Creator',
    );
    expect(contentSummary?.resultSummary?.highlights?.operatorSummary).toBeTruthy();
    expect(contentSummary?.resultSummary?.highlights?.routingDecision?.documentMode).toBe('proof');
    expect(contentSummary?.resultSummary?.highlights?.routingDecision?.downstreamAgent).toBe(
      'reddit-helper',
    );

    const systemMonitorDetail = await fetchProtected<{
      run?: {
        cost?: number;
        latency?: number | null;
        accounting?: {
          note?: string | null;
          metered?: boolean;
        } | null;
        resultSummary?: {
          keys?: string[];
          highlights?: {
            operatorSummary?: string;
            recommendedNextActions?: {
              count?: number;
              sample?: string[];
            };
            specialistContract?: {
              role?: string;
              status?: string;
              workflowStage?: string;
            };
            queueBudgetFusion?: {
              dependencyRiskScore?: number;
              predictionConfidence?: string;
            };
          };
        };
      };
    }>(`/api/tasks/runs/${encodeURIComponent(String(systemMonitorRun.runId))}`);
    expect(systemMonitorDetail.run?.resultSummary?.keys).toContain('specialistContract');
    expect(systemMonitorDetail.run?.resultSummary?.keys).toContain('operatorSummary');
    expect(systemMonitorDetail.run?.resultSummary?.keys).toContain('queueBudgetFusion');
    expect(systemMonitorDetail.run?.cost).toBe(0);
    expect(systemMonitorDetail.run?.latency).not.toBeNull();
    expect(systemMonitorDetail.run?.latency ?? -1).toBeGreaterThanOrEqual(0);
    expect(systemMonitorDetail.run?.accounting?.metered).toBe(false);
    expect(systemMonitorDetail.run?.accounting?.note).toBeTruthy();
    expect(systemMonitorDetail.run?.resultSummary?.highlights?.operatorSummary).toBeTruthy();
    expect(systemMonitorDetail.run?.resultSummary?.highlights?.specialistContract?.role).toBe(
      'SRE Monitor',
    );
    expect(systemMonitorDetail.run?.resultSummary?.highlights?.recommendedNextActions?.count ?? 0).toBeGreaterThan(0);
    expect(
      typeof systemMonitorDetail.run?.resultSummary?.highlights?.queueBudgetFusion?.dependencyRiskScore,
    ).toBe('number');

    const contentDetail = await fetchProtected<{
      run?: {
        resultSummary?: {
          keys?: string[];
          highlights?: {
            specialistContract?: {
              role?: string;
              status?: string;
              workflowStage?: string;
            };
            routingDecision?: {
              documentMode?: string;
              downstreamAgent?: string;
            };
            handoffPackage?: {
              targetAgentId?: string;
            };
          };
        };
      };
    }>(`/api/tasks/runs/${encodeURIComponent(String(contentRun.runId))}`);
    expect(contentDetail.run?.resultSummary?.keys).toContain('specialistContract');
    expect(contentDetail.run?.resultSummary?.keys).toContain('routingDecision');
    expect(contentDetail.run?.resultSummary?.highlights?.specialistContract?.role).toBe(
      'Content Creator',
    );
    expect(contentDetail.run?.resultSummary?.highlights?.routingDecision?.documentMode).toBe('proof');
    expect(contentDetail.run?.resultSummary?.highlights?.routingDecision?.downstreamAgent).toBe(
      'reddit-helper',
    );
    expect(contentDetail.run?.resultSummary?.highlights?.handoffPackage?.targetAgentId).toBe(
      'reddit-helper',
    );
  });

  it('exposes knowledge provenance, contradiction, and freshness graphs', async () => {
    const response = await fetch(`${baseUrl}/api/knowledge/summary`);
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      diagnostics?: {
        graphs?: {
          provenance?: { nodes?: unknown[]; edges?: unknown[] };
          contradictions?: { nodes?: unknown[]; edges?: unknown[] };
          freshness?: { nodes?: unknown[]; edges?: unknown[]; score?: number | null };
        };
      };
      runtime?: {
        graphs?: {
          provenance?: unknown;
          contradictions?: unknown;
          freshness?: { score?: number | null } | null;
        };
      };
    };

    expect(payload.diagnostics?.graphs?.provenance).toBeTruthy();
    expect(Array.isArray(payload.diagnostics?.graphs?.provenance?.nodes)).toBe(true);
    expect(Array.isArray(payload.diagnostics?.graphs?.provenance?.edges)).toBe(true);
    expect(payload.diagnostics?.graphs?.contradictions).toBeTruthy();
    expect(Array.isArray(payload.diagnostics?.graphs?.contradictions?.nodes)).toBe(true);
    expect(Array.isArray(payload.diagnostics?.graphs?.freshness?.nodes)).toBe(true);
    expect(Array.isArray(payload.diagnostics?.graphs?.freshness?.edges)).toBe(true);
    expect(payload.runtime?.graphs?.freshness).toBeTruthy();
  });

  it('keeps process alive during middleware assertions', () => {
    expect(serverProcess).not.toBeNull();
    expect(serverProcess?.exitCode).toBeNull();
    expect(stdoutBuffer.length + stderrBuffer.length).toBeGreaterThanOrEqual(0);
  });
});
