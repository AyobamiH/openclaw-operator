import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { auditSkill, getSkillAuditGate } from '../src/skillAudit.js';
import { getToolGate, ToolGate } from '../src/toolGate.js';
import {
  createDefaultState,
  getRetryRecoveryDelayMs,
  reconcileTaskRetryRecoveryState,
  summarizeGovernanceVisibility,
} from '../src/state.js';
import {
  approveGovernedSkill,
  executeSkill as executeRegisteredSkill,
  hasSkill,
  initializeSkills,
  listGovernedSkillIntake,
  registerGovernedSkill,
  resetSkillRuntimeForTest,
  setGovernedSkillStateStoreForTest,
} from '../../skills/index.js';
import { setRuntimeStateMongoClientFactoryForTest } from '../../agents/shared/runtime-evidence.js';
import {
  clearDocRepairCooldown,
  clearDocRepairLock,
} from '../src/coordination/runtime-coordination.ts';
import { sourceFetchDefinition } from '../../skills/sourceFetch.js';
import { normalizerDefinition, executeNormalizer } from '../../skills/normalizer.js';
import type { ToolInvocation } from '../src/types.js';

async function runAgentEntryPointWithDeniedSkill(args: {
  agentId: string;
  resultEnvVar: string;
  deniedSkillId: string;
  payload: Record<string, unknown>;
}) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), `${args.agentId}-fixture-`));
  const sourceRoot = join(process.cwd(), '..', 'agents', args.agentId);
  const sharedSourceRoot = join(process.cwd(), '..', 'agents', 'shared');
  const stagedRoot = join(fixtureRoot, args.agentId);
  const stagedSharedRoot = join(fixtureRoot, 'shared');
  const stagedSiblingAgents = args.agentId === 'system-monitor-agent' ? ['reddit-helper'] : [];
  const payloadPath = join(fixtureRoot, 'payload.json');
  const resultPath = join(fixtureRoot, 'result.json');
  const configPath = join(stagedRoot, 'agent.config.json');
  const tsxLoaderPath = join(
    process.cwd(),
    '..',
    'node_modules',
    'tsx',
    'dist',
    'loader.mjs',
  );

  try {
    await cp(sourceRoot, stagedRoot, { recursive: true });
    await cp(sharedSourceRoot, stagedSharedRoot, { recursive: true });
    for (const siblingAgentId of stagedSiblingAgents) {
      await cp(
        join(process.cwd(), '..', 'agents', siblingAgentId),
        join(fixtureRoot, siblingAgentId),
        { recursive: true },
      );
    }
    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    config.permissions.skills[args.deniedSkillId].allowed = false;
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    await writeFile(payloadPath, JSON.stringify(args.payload, null, 2), 'utf-8');

    const execution = await new Promise<{
      exitCode: number | null;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', tsxLoaderPath, 'src/index.ts', payloadPath],
        {
          cwd: stagedRoot,
          env: {
            ...process.env,
            [args.resultEnvVar]: resultPath,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ exitCode: code, stdout, stderr }));
    });

    const resultExists = await readFile(resultPath, 'utf-8').catch(() => null);
    if (!resultExists) {
      throw new Error(
        `agent entrypoint did not write a result file (exit=${execution.exitCode})\n` +
          `stdout:\n${execution.stdout.trim() || '<empty>'}\n` +
          `stderr:\n${execution.stderr.trim() || '<empty>'}`,
      );
    }

    const result = JSON.parse(resultExists);
    return {
      exitCode: execution.exitCode,
      result,
    };
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function runIntegrationAgentFixture(args: {
  task: Record<string, unknown>;
  state?: Record<string, unknown>;
  serviceStates?: Record<string, Record<string, unknown>>;
  extraAgentConfigs?: Array<{
    dirName: string;
    config: Record<string, unknown>;
  }>;
}) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'integration-agent-fixture-'));
  const sourceRoot = join(process.cwd(), '..', 'agents', 'integration-agent');
  const sharedSourceRoot = join(process.cwd(), '..', 'agents', 'shared');
  const stagedAgentsRoot = join(fixtureRoot, 'agents');
  const stagedRoot = join(stagedAgentsRoot, 'integration-agent');
  const stagedSharedRoot = join(stagedAgentsRoot, 'shared');
  const logsRoot = join(fixtureRoot, 'logs');
  const statePath = join(fixtureRoot, 'orchestrator_state.json');
  const payloadPath = join(fixtureRoot, 'payload.json');
  const resultPath = join(fixtureRoot, 'result.json');
  const tsxLoaderPath = join(
    process.cwd(),
    '..',
    'node_modules',
    'tsx',
    'dist',
    'loader.mjs',
  );

  try {
    await mkdir(stagedAgentsRoot, { recursive: true });
    await cp(sourceRoot, stagedRoot, { recursive: true });
    await cp(sharedSourceRoot, stagedSharedRoot, { recursive: true });
    await mkdir(logsRoot, { recursive: true });

    for (const entry of args.extraAgentConfigs ?? []) {
      const targetDir = join(stagedAgentsRoot, entry.dirName);
      await mkdir(targetDir, { recursive: true });
      await writeFile(
        join(targetDir, 'agent.config.json'),
        JSON.stringify(entry.config, null, 2),
        'utf-8',
      );
    }

    await writeFile(
      statePath,
      JSON.stringify(
        args.state ?? {
          taskExecutions: [],
          incidentLedger: [],
          workflowEvents: [],
          relationshipObservations: [],
        },
        null,
        2,
      ),
      'utf-8',
    );

    for (const [agentId, serviceState] of Object.entries(args.serviceStates ?? {})) {
      await writeFile(
        join(logsRoot, `${agentId}-service.json`),
        JSON.stringify(serviceState, null, 2),
        'utf-8',
      );
    }

    await writeFile(payloadPath, JSON.stringify(args.task, null, 2), 'utf-8');

    const execution = await new Promise<{
      exitCode: number | null;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', tsxLoaderPath, 'src/index.ts', payloadPath],
        {
          cwd: stagedRoot,
          env: {
            ...process.env,
            INTEGRATION_AGENT_RESULT_FILE: resultPath,
            STATE_FILE: statePath,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ exitCode: code, stdout, stderr }));
    });

    const resultRaw = await readFile(resultPath, 'utf-8').catch(() => null);
    if (!resultRaw) {
      throw new Error(
        `integration-agent fixture did not write a result file (exit=${execution.exitCode})\n` +
          `stdout:\n${execution.stdout.trim() || '<empty>'}\n` +
          `stderr:\n${execution.stderr.trim() || '<empty>'}`,
      );
    }

    return JSON.parse(resultRaw);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

function buildIntegrationWorkerFixtureConfig(args: {
  id: string;
  taskType: string;
  skillIds: string[];
}) {
  return {
    id: args.id,
    name: args.id,
    description: `fixture for ${args.taskType}`,
    version: '1.0.0',
    model: {
      primary: 'gpt-4o-mini',
      fallback: 'gpt-4o-mini',
      tier: 'balanced',
    },
    orchestratorTask: args.taskType,
    serviceStatePath: `../../logs/${args.id}-service.json`,
    permissions: {
      skills: Object.fromEntries(
        args.skillIds.map((skillId) => [skillId, { allowed: true }]),
      ),
    },
    constraints: {
      timeout: 60000,
      maxRetries: 1,
    },
  };
}

async function loadOrchestratorIndexHelpers() {
  const previous = process.env.OPENCLAW_SKIP_BOOTSTRAP;
  process.env.OPENCLAW_SKIP_BOOTSTRAP = "true";
  try {
    return await import("../src/index.js");
  } finally {
    if (previous === undefined) {
      delete process.env.OPENCLAW_SKIP_BOOTSTRAP;
    } else {
      process.env.OPENCLAW_SKIP_BOOTSTRAP = previous;
    }
  }
}

async function runRedditHelperTaskFixture(args?: {
  serviceState?: Record<string, unknown>;
  env?: Record<string, string>;
  payload?: Record<string, unknown>;
  providerMock?: {
    replyText: string;
    totalTokens?: number;
  };
}) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'reddit-helper-fixture-'));
  const sourceRoot = join(process.cwd(), '..', 'agents', 'reddit-helper');
  const sharedSourceRoot = join(process.cwd(), '..', 'agents', 'shared');
  const stagedRoot = join(fixtureRoot, 'reddit-helper');
  const stagedSharedRoot = join(fixtureRoot, 'shared');
  const stagedOrchestratorRoot = join(fixtureRoot, 'orchestrator');
  const logsRoot = join(fixtureRoot, 'logs');
  const knowledgePackDir = join(logsRoot, 'knowledge-packs');
  const resultPath = join(fixtureRoot, 'result.json');
  const payloadPath = join(fixtureRoot, 'payload.json');
  const configPath = join(stagedRoot, 'agent.config.json');
  const serviceStatePath = join(logsRoot, 'reddit-helper-service.json');
  const draftLogPath = join(logsRoot, 'reddit-drafts.jsonl');
  const engagementOsPath = join(fixtureRoot, 'ENGAGEMENT_OS.md');
  const tsxLoaderPath = join(
    process.cwd(),
    '..',
    'node_modules',
    'tsx',
    'dist',
    'loader.mjs',
  );

  try {
    await cp(sourceRoot, stagedRoot, { recursive: true });
    await cp(sharedSourceRoot, stagedSharedRoot, { recursive: true });
    await mkdir(knowledgePackDir, { recursive: true });

    if (args?.providerMock) {
      const openAiPackageRoot = join(stagedOrchestratorRoot, 'node_modules', 'openai');
      await mkdir(openAiPackageRoot, { recursive: true });
      await writeFile(
        join(stagedOrchestratorRoot, 'package.json'),
        JSON.stringify(
          {
            name: 'openclaw-orchestrator-fixture',
            type: 'module',
          },
          null,
          2,
        ),
        'utf-8',
      );
      await writeFile(
        join(openAiPackageRoot, 'package.json'),
        JSON.stringify(
          {
            name: 'openai',
            type: 'module',
            exports: './index.js',
          },
          null,
          2,
        ),
        'utf-8',
      );
      await writeFile(
        join(openAiPackageRoot, 'index.js'),
        `export default class OpenAI {
  constructor() {
    this.chat = {
      completions: {
        create: async () => ({
          choices: [{ message: { content: ${JSON.stringify(args.providerMock.replyText)} } }],
          usage: { total_tokens: ${JSON.stringify(args.providerMock.totalTokens ?? 64)} },
        }),
      },
    };
  }
}
`,
        'utf-8',
      );
    }

    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    config.knowledgePackDir = '../logs/knowledge-packs';
    config.draftLogPath = '../logs/reddit-drafts.jsonl';
    config.devvitQueuePath = '../logs/devvit-submissions.jsonl';
    config.serviceStatePath = '../logs/reddit-helper-service.json';
    config.runtimeEngagementOsPath = '../ENGAGEMENT_OS.md';
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

    await writeFile(
      engagementOsPath,
      [
        'Ask qualifying questions before solutioning.',
        'Keep replies concise and authoritative.',
        'Use local documentation and doctrine before any model polish.',
      ].join('\n'),
      'utf-8',
    );

    await writeFile(
      join(knowledgePackDir, 'knowledge-pack-test.json'),
      JSON.stringify(
        {
          id: 'pack-test-1',
          generatedAt: '2026-03-08T12:00:00.000Z',
          docs: [
            {
              source: 'openclaw',
              path: 'docs/operators/reddit.md',
              summary:
                'OpenClaw operator replies should stay concise, ask qualifying questions, and avoid public implementation plans.',
              wordCount: 18,
              bytes: 156,
              firstHeading: 'Operator reply doctrine',
            },
            {
              source: 'openai',
              path: 'cookbook/examples/retrieval.md',
              summary:
                'Ground replies in retrieved local documentation before asking a model to polish final phrasing.',
              wordCount: 16,
              bytes: 148,
              firstHeading: 'Retrieval grounding',
            },
          ],
        },
        null,
        2,
      ),
      'utf-8',
    );

    if (args?.serviceState) {
      await writeFile(
        serviceStatePath,
        JSON.stringify(args.serviceState, null, 2),
        'utf-8',
      );
    }

    await writeFile(
      payloadPath,
      JSON.stringify(
        args?.payload ?? {
          queue: {
            id: 'queue-test-1',
            subreddit: 'openclaw',
            question: 'How should OpenClaw handle operator replies before proposing fixes?',
            matchedKeywords: ['openclaw', 'operator', 'reply'],
            selectedForDraft: true,
            score: 0.82,
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    const execution = await new Promise<{
      exitCode: number | null;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', tsxLoaderPath, 'src/index.ts', payloadPath],
        {
          cwd: stagedRoot,
          env: {
            ...process.env,
            ALLOW_ORCHESTRATOR_TASK_RUN: 'true',
            REDDIT_HELPER_RESULT_FILE: resultPath,
            NODE_PATH: join(process.cwd(), 'node_modules'),
            REDIS_URL: '',
            ...(args?.providerMock
              ? {
                  OPENCLAW_ORCHESTRATOR_PACKAGE_JSON: join(
                    stagedOrchestratorRoot,
                    'package.json',
                  ),
                }
              : {}),
            ...(args?.env ?? {}),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ exitCode: code, stdout, stderr }));
    });

    const resultRaw = await readFile(resultPath, 'utf-8').catch(() => null);
    if (!resultRaw) {
      throw new Error(
        `reddit-helper entrypoint did not write a result file (exit=${execution.exitCode})\n` +
          `stdout:\n${execution.stdout.trim() || '<empty>'}\n` +
          `stderr:\n${execution.stderr.trim() || '<empty>'}`,
      );
    }

    const result = JSON.parse(resultRaw);
    const persistedServiceState = JSON.parse(
      await readFile(serviceStatePath, 'utf-8'),
    );
    const draftLog = await readFile(draftLogPath, 'utf-8');

    return {
      ...execution,
      result,
      persistedServiceState,
      draftLog,
    };
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function runSystemMonitorFixture() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'system-monitor-fixture-'));
  const sourceAgentsRoot = join(process.cwd(), '..', 'agents');
  const stagedAgentsRoot = join(fixtureRoot, 'agents');
  const logsRoot = join(fixtureRoot, 'logs');
  const resultPath = join(fixtureRoot, 'result.json');
  const payloadPath = join(fixtureRoot, 'payload.json');
  const statePath = join(fixtureRoot, 'orchestrator_state.json');
  const tsxLoaderPath = join(
    process.cwd(),
    '..',
    'node_modules',
    'tsx',
    'dist',
    'loader.mjs',
  );

  try {
    await cp(join(sourceAgentsRoot, 'system-monitor-agent'), join(stagedAgentsRoot, 'system-monitor-agent'), { recursive: true });
    await cp(join(sourceAgentsRoot, 'security-agent'), join(stagedAgentsRoot, 'security-agent'), { recursive: true });
    await cp(join(sourceAgentsRoot, 'reddit-helper'), join(stagedAgentsRoot, 'reddit-helper'), { recursive: true });
    await cp(join(sourceAgentsRoot, 'shared'), join(stagedAgentsRoot, 'shared'), { recursive: true });
    await mkdir(logsRoot, { recursive: true });

    const systemMonitorConfigPath = join(stagedAgentsRoot, 'system-monitor-agent', 'agent.config.json');
    const securityConfigPath = join(stagedAgentsRoot, 'security-agent', 'agent.config.json');
    const systemMonitorConfig = JSON.parse(await readFile(systemMonitorConfigPath, 'utf-8'));
    systemMonitorConfig.orchestratorStatePath = '../../orchestrator_state.json';
    await writeFile(systemMonitorConfigPath, JSON.stringify(systemMonitorConfig, null, 2), 'utf-8');

    const securityConfig = JSON.parse(await readFile(securityConfigPath, 'utf-8'));
    securityConfig.orchestratorStatePath = '../../orchestrator_state.json';
    securityConfig.serviceStatePath = '../../logs/security-agent-service.json';
    await writeFile(securityConfigPath, JSON.stringify(securityConfig, null, 2), 'utf-8');

    await writeFile(
      join(logsRoot, 'security-agent-service.json'),
      JSON.stringify(
        {
          serviceHeartbeat: {
            status: 'ok',
            checkedAt: '2026-03-16T09:30:00.000Z',
          },
          taskPath: {
            totalRuns: 4,
            successfulRuns: 3,
            failedRuns: 1,
            activeRuns: 0,
            lastObservedAt: '2026-03-16T09:30:00.000Z',
            lastObservedStatus: 'success',
            lastSuccessfulAt: '2026-03-16T09:30:00.000Z',
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    await writeFile(
      statePath,
      JSON.stringify(
        {
          updatedAt: '2026-03-16T10:00:00.000Z',
          lastStartedAt: '2026-03-16T09:00:00.000Z',
          taskExecutions: [
            {
              taskId: 'integration-1',
              idempotencyKey: 'run-1',
              type: 'integration-workflow',
              status: 'failed',
              attempt: 1,
              maxRetries: 2,
              lastHandledAt: '2026-03-16T09:45:00.000Z',
              lastError: 'workflow blocked',
            },
          ],
          approvals: [],
          repairRecords: [
            {
              repairId: 'repair-1',
              classification: 'doc-drift',
              trigger: 'manual',
              repairTaskType: 'drift-repair',
              verificationMode: 'knowledge-pack',
              status: 'failed',
              detectedAt: '2026-03-16T09:00:00.000Z',
            },
          ],
          taskRetryRecoveries: [
            {
              taskId: 'retry-1',
              taskType: 'integration-workflow',
              idempotencyKey: 'retry-run-1',
              payload: {},
              attempt: 2,
              retryAt: '2026-03-16T11:00:00.000Z',
              createdAt: '2026-03-16T10:00:00.000Z',
              sourceRunId: 'run-1',
            },
          ],
          incidentLedger: [
            {
              incidentId: 'inc-proof-1',
              fingerprint: 'inc-proof-1',
              title: 'Proof delivery incident',
              classification: 'proof-delivery',
              severity: 'critical',
              truthLayer: 'public',
              firstSeenAt: '2026-03-16T09:30:00.000Z',
              lastSeenAt: '2026-03-16T09:45:00.000Z',
              status: 'active',
              owner: null,
              summary: 'Milestone public proof evidence is stuck in dead-letter.',
              affectedSurfaces: ['agent:security-agent', 'public-proof'],
              linkedServiceIds: ['security-agent'],
              linkedTaskIds: [],
              linkedRunIds: ['run-1'],
              linkedRepairIds: ['repair-1'],
              linkedProofDeliveries: ['proof-1'],
              evidence: ['dead-letter queue present', 'public proof replay timed out'],
              recommendedSteps: ['Replay the public proof surface.'],
              policy: {
                preferredOwner: 'integration-agent',
                remediationTaskType: 'system-monitor',
              },
              remediation: {
                owner: 'auto',
                status: 'blocked',
                summary: 'Waiting on replay.',
                nextAction: 'Replay the public proof surface.',
                blockers: ['dead-letter queue present'],
              },
              escalation: { level: 'breached' },
              verification: { status: 'pending' },
              history: [],
              policyExecutions: [],
              acknowledgements: [],
              ownershipHistory: [],
              remediationTasks: [],
            },
            {
              incidentId: 'inc-auth-2',
              fingerprint: 'inc-auth-2',
              title: 'Auth boundary regression',
              classification: 'service-runtime',
              severity: 'warning',
              truthLayer: 'observed',
              firstSeenAt: '2026-03-16T08:50:00.000Z',
              lastSeenAt: '2026-03-16T09:55:00.000Z',
              status: 'active',
              owner: 'security-agent',
              summary: 'Auth boundary drift is visible on the operator surface.',
              affectedSurfaces: ['agent:security-agent', 'auth-surface'],
              linkedServiceIds: ['security-agent'],
              linkedTaskIds: [],
              linkedRunIds: [],
              linkedRepairIds: [],
              linkedProofDeliveries: [],
              evidence: ['auth regression detected', 'cors origin wildcard remains visible'],
              recommendedSteps: ['Tighten auth and origin policy.'],
              policy: {
                preferredOwner: 'security-agent',
                remediationTaskType: 'security-audit',
              },
              remediation: {
                owner: 'auto',
                status: 'blocked',
                summary: 'Awaiting auth boundary repair.',
                nextAction: 'Contain auth boundary drift.',
                blockers: ['auth regression remains visible'],
              },
              escalation: { level: 'escalated' },
              verification: { status: 'pending' },
              history: [
                {
                  id: 'hist-auth-1',
                  timestamp: '2026-03-16T09:00:00.000Z',
                  type: 'detected',
                  actor: 'system-monitor-agent',
                  summary: 'Auth regression detected.',
                  evidence: ['auth regression'],
                },
                {
                  id: 'hist-auth-2',
                  timestamp: '2026-03-16T09:45:00.000Z',
                  type: 'status-changed',
                  actor: 'security-agent',
                  summary: 'CORS origin wildcard still present.',
                  evidence: ['cors origin wildcard'],
                },
              ],
              policyExecutions: [],
              acknowledgements: [],
              ownershipHistory: [],
              remediationTasks: [],
            },
          ],
          workflowEvents: [
            {
              eventId: 'evt-1',
              runId: 'run-1',
              stage: 'proof',
              state: 'blocked',
              timestamp: '2026-03-16T09:40:00.000Z',
              classification: 'delivery',
              stopCode: 'proof-timeout',
            },
          ],
          relationshipObservations: [],
        },
        null,
        2,
      ),
      'utf-8',
    );

    await writeFile(
      payloadPath,
      JSON.stringify({ id: 'system-monitor-1', type: 'health', agents: ['security-agent'] }, null, 2),
      'utf-8',
    );

    const execution = await new Promise<{ exitCode: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', tsxLoaderPath, 'src/index.ts', payloadPath],
        {
          cwd: join(stagedAgentsRoot, 'system-monitor-agent'),
          env: {
            ...process.env,
            ALLOW_ORCHESTRATOR_TASK_RUN: 'true',
            SYSTEM_MONITOR_AGENT_RESULT_FILE: resultPath,
          },
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      );

      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ exitCode: code, stderr }));
    });

    return {
      execution,
      result: JSON.parse(await readFile(resultPath, 'utf-8')),
    };
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function runSecurityFixture() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'security-agent-fixture-'));
  const sourceAgentsRoot = join(process.cwd(), '..', 'agents');
  const stagedAgentsRoot = join(fixtureRoot, 'agents');
  const resultPath = join(fixtureRoot, 'result.json');
  const payloadPath = join(fixtureRoot, 'payload.json');
  const statePath = join(fixtureRoot, 'orchestrator_state.json');
  const tsxLoaderPath = join(
    process.cwd(),
    '..',
    'node_modules',
    'tsx',
    'dist',
    'loader.mjs',
  );

  try {
    await cp(join(sourceAgentsRoot, 'security-agent'), join(stagedAgentsRoot, 'security-agent'), { recursive: true });
    await cp(join(sourceAgentsRoot, 'shared'), join(stagedAgentsRoot, 'shared'), { recursive: true });
    await mkdir(join(fixtureRoot, 'docs'), { recursive: true });

    const securityConfigPath = join(stagedAgentsRoot, 'security-agent', 'agent.config.json');
    const securityConfig = JSON.parse(await readFile(securityConfigPath, 'utf-8'));
    securityConfig.orchestratorStatePath = '../../orchestrator_state.json';
    await writeFile(securityConfigPath, JSON.stringify(securityConfig, null, 2), 'utf-8');

    await writeFile(
      join(fixtureRoot, 'orchestrator_config.json'),
      JSON.stringify({ corsAllowedOrigins: ['*'], corsAllowCredentials: true }, null, 2),
      'utf-8',
    );
    await writeFile(join(fixtureRoot, 'README.md'), '# Fixture\n', 'utf-8');
    await mkdir(join(fixtureRoot, 'orchestrator', 'src', 'middleware'), { recursive: true });
    await writeFile(
      join(fixtureRoot, 'orchestrator', 'src', 'middleware', 'auth.ts'),
      [
        "export function requireBearerToken(req, res, next) {",
        "  const provided = req.headers.authorization;",
        "  const expected = process.env.API_KEY;",
        "  if (provided === expected) next();",
        "}",
        "export function verifyWebhookSignature(req, res, next) {",
        "  const signature = req.headers['x-webhook-signature'];",
        "  const expected = 'fixture-signature';",
        "  if (signature === expected) next();",
        "}",
      ].join('\n'),
      'utf-8',
    );
    await writeFile(
      join(fixtureRoot, 'orchestrator', 'src', 'index.ts'),
      [
        "const app = { get() {}, post() {} };",
        "app.get('/api/admin-risk', (_req, res) => res.json({ ok: true }));",
        "app.get('/api/knowledge/summary', publicKnowledgeHandler);",
      ].join('\n'),
      'utf-8',
    );

    await writeFile(
      statePath,
      JSON.stringify(
        {
          incidentLedger: [
            {
              incidentId: 'inc-auth-1',
              classification: 'service-runtime',
              severity: 'critical',
              status: 'active',
              owner: 'system-monitor-agent',
              summary: 'Auth boundary drift is visible on the operator surface.',
              affectedSurfaces: ['agent:system-monitor-agent', 'auth-surface'],
              linkedServiceIds: ['system-monitor-agent'],
              evidence: ['auth regression detected', 'cors origin wildcard'],
              recommendedSteps: ['Tighten origin policy and verify signing config.'],
              remediation: {
                owner: 'auto',
                status: 'blocked',
                summary: 'Awaiting security review.',
                nextAction: 'Tighten auth boundary.',
                blockers: ['auth regression remains visible'],
              },
              escalation: { level: 'escalated' },
              policy: { preferredOwner: 'system-monitor-agent' },
              remediationTasks: [],
              history: [
                {
                  id: 'evt-1',
                  timestamp: '2026-03-16T09:00:00.000Z',
                  type: 'detected',
                  actor: 'system-monitor-agent',
                  summary: 'Auth regression detected.',
                  evidence: ['auth regression'],
                },
                {
                  id: 'evt-2',
                  timestamp: '2026-03-16T09:30:00.000Z',
                  type: 'status-changed',
                  actor: 'system-monitor-agent',
                  summary: 'CORS origin wildcard still present.',
                  evidence: ['cors origin wildcard'],
                },
              ],
            },
          ],
          relationshipObservations: [
            {
              observationId: 'obs-1',
              from: 'agent:doc-specialist',
              to: 'agent:system-monitor-agent',
              relationship: 'feeds-agent',
              timestamp: '2026-03-16T08:55:00.000Z',
              source: 'doc-specialist',
            },
          ],
          taskExecutions: [],
        },
        null,
        2,
      ),
      'utf-8',
    );

    await writeFile(
      payloadPath,
      JSON.stringify({ id: 'security-1', type: 'incident', scope: 'workspace' }, null, 2),
      'utf-8',
    );

    const execution = await new Promise<{ exitCode: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', tsxLoaderPath, 'src/index.ts', payloadPath],
        {
          cwd: join(stagedAgentsRoot, 'security-agent'),
          env: {
            ...process.env,
            ALLOW_ORCHESTRATOR_TASK_RUN: 'true',
            SECURITY_AGENT_RESULT_FILE: resultPath,
          },
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      );

      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ exitCode: code, stderr }));
    });

    return {
      execution,
      result: JSON.parse(await readFile(resultPath, 'utf-8')),
    };
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

describe('ToolGate runtime wiring', () => {
  const gate = new ToolGate();

  beforeAll(async () => {
    await gate.initialize();
  });

  it('allows configured task execution mapping', () => {
    const allowed = gate.canExecuteTask('market-research-agent', 'market-research');
    expect(allowed.allowed).toBe(true);
  });

  it('denies mismatched task execution mapping', () => {
    const denied = gate.canExecuteTask('market-research-agent', 'qa-verification');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain('not assigned');
  });

  it('allows permitted skill preflight from agent config', async () => {
    const result = await gate.preflightSkillAccess('market-research-agent', 'sourceFetch', {
      mode: 'test',
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      authorized: true,
      mode: 'preflight',
      skillId: 'sourceFetch',
    });
  });

  it('denies forbidden skill preflight from agent config', async () => {
    const result = await gate.preflightSkillAccess('market-research-agent', 'workspacePatch', {
      mode: 'test',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('allowlist');
  });

  it('keeps executeSkill as a backward-compatible preflight alias', async () => {
    const result = await gate.executeSkill('market-research-agent', 'sourceFetch', {
      mode: 'test',
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      authorized: true,
      mode: 'preflight',
      skillId: 'sourceFetch',
    });
  });
});

describe('Task retry recovery durability', () => {
  it('keeps retrying executions replayable when a persisted recovery record exists', () => {
    const state = createDefaultState();
    state.taskExecutions.push({
      taskId: 'task-retry-1',
      idempotencyKey: 'idem-retry-1',
      type: 'rss-sweep',
      status: 'retrying',
      attempt: 1,
      maxRetries: 2,
      lastHandledAt: new Date().toISOString(),
      lastError: 'transient failure',
    });
    state.taskRetryRecoveries.push({
      sourceTaskId: 'task-retry-1',
      idempotencyKey: 'idem-retry-1',
      type: 'rss-sweep',
      payload: {
        reason: 'scheduled',
        __attempt: 2,
        maxRetries: 2,
        idempotencyKey: 'idem-retry-1',
      },
      attempt: 2,
      maxRetries: 2,
      retryAt: new Date().toISOString(),
      scheduledAt: new Date().toISOString(),
    });

    const result = reconcileTaskRetryRecoveryState(state, '2026-03-02T12:00:00.000Z');

    expect(result).toMatchObject({
      recoveredRetryCount: 0,
      staleRecoveryCount: 0,
    });
    expect(state.taskExecutions[0]?.status).toBe('retrying');
    expect(state.taskRetryRecoveries).toHaveLength(1);
    expect(getRetryRecoveryDelayMs(state.taskRetryRecoveries[0]!, Date.now())).toBeGreaterThanOrEqual(0);
  });

  it('marks orphaned retrying executions failed when no persisted recovery record exists', () => {
    const state = createDefaultState();
    state.taskExecutions.push({
      taskId: 'task-retry-2',
      idempotencyKey: 'idem-retry-2',
      type: 'nightly-batch',
      status: 'retrying',
      attempt: 2,
      maxRetries: 2,
      lastHandledAt: new Date().toISOString(),
      lastError: 'retry interrupted before requeue',
    });

    const result = reconcileTaskRetryRecoveryState(state, '2026-03-02T12:00:00.000Z');

    expect(result).toMatchObject({
      recoveredRetryCount: 1,
      staleRecoveryCount: 0,
    });
    expect(state.taskExecutions[0]?.status).toBe('failed');
    expect(state.taskExecutions[0]?.lastError).toContain('orchestrator restarted before retry dispatch');
    expect(state.taskHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'task-retry-2',
          type: 'nightly-batch',
          result: 'error',
        }),
      ]),
    );
  });
});

describe('Operator governance visibility summary', () => {
  it('summarizes real governance state from orchestrator runtime state', () => {
    const state = createDefaultState();
    state.approvals.push({
      taskId: 'approval-1',
      type: 'build-refactor',
      payload: {},
      requestedAt: '2026-03-02T12:00:00.000Z',
      status: 'pending',
    });
    state.taskRetryRecoveries.push({
      sourceTaskId: 'task-retry-3',
      idempotencyKey: 'idem-retry-3',
      type: 'rss-sweep',
      payload: {
        __attempt: 2,
        maxRetries: 2,
        idempotencyKey: 'idem-retry-3',
      },
      attempt: 2,
      maxRetries: 2,
      retryAt: '2026-03-02T12:05:00.000Z',
      scheduledAt: '2026-03-02T12:00:00.000Z',
    });
    state.governedSkillState.push(
      {
        skillId: 'generated-safe-skill',
        definition: {
          ...sourceFetchDefinition,
          id: 'generated-safe-skill',
        },
        auditedAt: '2026-03-02T12:00:00.000Z',
        intakeSource: 'generated',
        registeredBy: 'operator',
        trustStatus: 'review-approved',
        reviewedBy: 'reviewer',
        reviewedAt: '2026-03-02T12:10:00.000Z',
        provenanceSnapshot: {
          author: 'operator',
          source: 'generated',
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
          ...sourceFetchDefinition,
          id: 'generated-pending-skill',
        },
        auditedAt: '2026-03-02T12:00:00.000Z',
        intakeSource: 'manual',
        registeredBy: 'operator',
        trustStatus: 'pending-review',
        provenanceSnapshot: {
          author: 'operator',
          source: 'manual',
          version: '1.0.0',
        },
        persistenceMode: 'metadata-only',
      },
    );
    state.repairRecords.push({
      repairId: 'repair-doc-drift-1',
      classification: 'doc-drift',
      trigger: 'pending-doc-threshold',
      sourceTaskId: 'doc-change-1',
      sourceTaskType: 'doc-change',
      repairTaskType: 'drift-repair',
      repairTaskId: 'drift-repair-1',
      verificationMode: 'knowledge-pack',
      status: 'verified',
      detectedAt: '2026-03-02T11:59:00.000Z',
      queuedAt: '2026-03-02T11:59:01.000Z',
      completedAt: '2026-03-02T12:01:00.000Z',
      verifiedAt: '2026-03-02T12:01:00.000Z',
      verificationSummary: 'knowledge pack verified',
      evidence: ['pack:workspace/logs/knowledge-packs/test.json'],
    });

    const summary = summarizeGovernanceVisibility(state);

    expect(summary).toMatchObject({
      approvals: {
        pendingCount: 1,
      },
      repairs: {
        totalCount: 1,
        activeCount: 0,
        verifiedCount: 1,
        failedCount: 0,
        lastDetectedAt: '2026-03-02T11:59:00.000Z',
        lastVerifiedAt: '2026-03-02T12:01:00.000Z',
        lastFailedAt: null,
      },
      taskRetryRecoveries: {
        count: 1,
        nextRetryAt: '2026-03-02T12:05:00.000Z',
      },
      governedSkills: {
        totalCount: 2,
        pendingReviewCount: 1,
        approvedCount: 1,
        restartSafeCount: 1,
        restartSafeApprovedCount: 1,
        metadataOnlyCount: 1,
        metadataOnlyApprovedCount: 0,
      },
    });
  });
});

describe('Spawned worker contract fixes', () => {
  it('runs skill-audit against the orchestrator payload shape', async () => {
    const { handleTask } = await import('../../agents/skill-audit-agent/src/index.ts');

    const result = await handleTask({
      id: 'skill-audit-task-1',
      skillIds: ['testRunner'],
      depth: 'standard',
      checks: ['schemas', 'provenance'],
    });

    expect(result.success).toBe(true);
    expect(result.skillsAudited).toBe(1);
    expect(result.trustPosture).toEqual(
      expect.objectContaining({
        status: expect.any(String),
        approvedCount: expect.any(Number),
        pendingReviewCount: expect.any(Number),
      }),
    );
    expect(result.policyHandoff).toEqual(
      expect.objectContaining({
        status: expect.any(String),
        pendingReviewSkills: expect.any(Array),
      }),
    );
    expect(result.telemetryHandoff).toEqual(
      expect.objectContaining({
        status: expect.any(String),
        riskySkillIds: expect.any(Array),
      }),
    );
    expect(result.intakeCoverage).toEqual(
      expect.objectContaining({
        passCount: expect.any(Number),
        auditedSkills: 1,
      }),
    );
    expect(result.restartSafetySummary).toEqual(
      expect.objectContaining({
        status: expect.stringMatching(/stable|watching|review-required/),
        restartSafeCount: expect.any(Number),
      }),
    );
    expect(result.verificationHarness).toMatchObject({
      mode: 'dry-run',
      ready: true,
    });
    expect(result.toolInvocations?.[0]).toMatchObject({
      toolId: 'testRunner',
      classification: 'governance-harness',
    });
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillId: 'testRunner',
          audited: true,
          restartSafety: expect.objectContaining({
            classification: expect.any(String),
          }),
          trustExplanation: expect.any(String),
        }),
      ]),
    );
    expect(result.operatorSummary).toBeTruthy();
    expect(result.recommendedNextActions?.length ?? 0).toBeGreaterThan(0);
    expect(result.specialistContract).toMatchObject({
      role: 'Automation Governance Architect',
      workflowStage: expect.stringMatching(/governance-(review|closure|escalation)/),
      status: expect.any(String),
    });
  });

  it('keeps qa-verification honest: dry-run must be explicit and invalid commands fail', async () => {
    const { handleTask } = await import('../../agents/qa-verification-agent/src/index.ts');
    const runtimeGate = await getToolGate();
    runtimeGate.clearLog();

    const dryRun = await handleTask({
      id: 'qa-dry-run-1',
      mode: 'dry-run',
      target: 'workspace',
    });
    expect(dryRun.success).toBe(true);
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.testsRun).toBe(0);
    expect(dryRun.outcomeKind).toBe('dry-run');
    expect(dryRun.executedCommand).toBe('build-verify');
    expect(dryRun.verificationAuthority).toMatchObject({
      authorityLevel: 'advisory',
      closureEligible: false,
    });
    expect(dryRun.closureContract).toMatchObject({
      targetKind: expect.any(String),
      closeAllowed: false,
      requiredFollowups: expect.any(Array),
    });
    expect(dryRun.operatorSummary).toContain('dry-run evidence cannot authorize closure');
    expect(dryRun.recommendedNextActions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Run execute mode'),
      ]),
    );
    expect(dryRun.specialistContract).toMatchObject({
      role: 'Reality Checker',
      workflowStage: 'verification-preflight',
      status: 'watching',
      refusalReason: null,
    });
    expect(dryRun.reproducibilityProfile).toMatchObject({
      reproducibility: 'unproven',
      evidenceQuality: 'minimal',
    });

    const dryRunLog = runtimeGate.getLogForAgent('qa-verification-agent');
    expect(dryRunLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillId: 'testRunner',
          mode: 'execute',
          allowed: true,
        }),
      ]),
    );

    const invalid = await handleTask({
      id: 'qa-invalid-1',
      constraints: {
        testCommand: 'echo qa-smoke',
      },
    });
    expect(invalid.success).toBe(false);
    expect(invalid.error).toContain('Command not whitelisted');
  });

  it('uses remediation payload runIds when evaluating workflow evidence', async () => {
    const previousStateFile = process.env.STATE_FILE;
    process.env.STATE_FILE = 'mongo:orchestrator-runtime-state';
    const encoded = gzipSync(
      Buffer.from(
        JSON.stringify({
          taskExecutions: [],
          repairRecords: [
            {
              repairId: 'repair-1',
              classification: 'task-retry-recovery',
              status: 'running',
              sourceTaskId: 'task-source-1',
              sourceRunId: 'run-source-1',
              repairRunId: 'run-repair-1',
              lastError: 'previous attempt failed before retry',
            },
          ],
          incidentLedger: [
            {
              incidentId: 'incident-1',
              classification: 'repair',
              severity: 'critical',
              status: 'active',
              owner: 'qa-verification-agent',
              summary: 'Repair verification is waiting on bounded QA.',
              affectedSurfaces: ['repair-runtime'],
              linkedServiceIds: ['build-refactor-agent'],
              linkedTaskIds: ['task-source-1'],
              linkedRunIds: ['run-source-1'],
              linkedRepairIds: ['repair-1'],
              remediation: {
                owner: 'auto',
                status: 'watching',
                summary: 'Verifier is pending.',
                nextAction: 'Run QA verification.',
                blockers: [],
              },
              verification: {
                required: true,
                agentId: 'qa-verification-agent',
                status: 'pending',
                summary: 'Verification pending.',
              },
              remediationTasks: [],
              escalation: {
                level: 'normal',
                status: 'on-track',
                summary: 'On track.',
              },
            },
          ],
          workflowEvents: [
            {
              runId: 'run-source-1',
              taskId: 'task-source-1',
              stage: 'agent',
              state: 'completed',
              timestamp: '2026-03-28T22:00:00.000Z',
            },
          ],
          relationshipObservations: [
            {
              runId: 'run-source-1',
              from: 'agent:build-refactor-agent',
              to: 'agent:qa-verification-agent',
              relationship: 'feeds-agent',
              timestamp: '2026-03-28T22:00:05.000Z',
            },
            {
              runId: 'run-source-1',
              from: 'agent:qa-verification-agent',
              to: 'agent:build-refactor-agent',
              relationship: 'verifies-agent',
              timestamp: '2026-03-28T22:00:10.000Z',
            },
          ],
        }),
        'utf-8',
      ),
    );
    const findOne = vi.fn().mockResolvedValue({
      encoding: 'gzip-json',
      payload: encoded,
      version: 1,
    });
    const collection = vi.fn(() => ({ findOne }));
    const db = vi.fn(() => ({ collection }));
    const connect = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    setRuntimeStateMongoClientFactoryForTest(async () => ({ connect, db, close }));

    try {
      const { handleTask } = await import('../../agents/qa-verification-agent/src/index.ts');
      const result = await handleTask({
        id: 'qa-payload-runids-1',
        mode: 'dry-run',
        payload: {
          incidentId: 'incident-1',
          repairIds: ['repair-1'],
          runIds: ['run-source-1'],
          serviceIds: ['build-refactor-agent'],
          affectedSurfaces: ['repair-runtime'],
          targetAgentId: 'build-refactor-agent',
        },
      });

      expect(result.success).toBe(true);
      expect(result.verificationSignals).not.toContain(
        'No workflow evidence matched the referenced run IDs.',
      );
      expect(result.verificationSignals).not.toContain(
        'One or more related repairs remain failed or error-marked.',
      );
      expect(result.verificationSignals).not.toContain(
        'A critical incident remains open in the verification context.',
      );
      expect(result.runtimeContext).toMatchObject({
        workflow: expect.objectContaining({
          totalEvents: 1,
        }),
        relationships: expect.objectContaining({
          total: 2,
          targetAgentId: 'build-refactor-agent',
        }),
      });
      expect(result.verificationTrace).toMatchObject({
        runIds: expect.arrayContaining(['run-source-1']),
        serviceIds: expect.arrayContaining(['build-refactor-agent']),
      });
      expect(collection).toHaveBeenCalledWith('system_state');
    } finally {
      if (previousStateFile === undefined) {
        delete process.env.STATE_FILE;
      } else {
        process.env.STATE_FILE = previousStateFile;
      }
    }
  });

  it('treats orphaned incident-linked verifier retries as reconciled after bounded execution', async () => {
    const previousStateFile = process.env.STATE_FILE;
    process.env.STATE_FILE = 'mongo:orchestrator-runtime-state';
    const encoded = gzipSync(
      Buffer.from(
        JSON.stringify({
          taskExecutions: [],
          repairRecords: [],
          incidentLedger: [],
          workflowEvents: [],
          relationshipObservations: [],
        }),
        'utf-8',
      ),
    );
    const findOne = vi.fn().mockResolvedValue({
      encoding: 'gzip-json',
      payload: encoded,
      version: 1,
    });
    const collection = vi.fn(() => ({ findOne }));
    const db = vi.fn(() => ({ collection }));
    const connect = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    setRuntimeStateMongoClientFactoryForTest(async () => ({ connect, db, close }));

    const { handleTask } = await import('../../agents/qa-verification-agent/src/index.ts');
    const originalChdir = process.chdir;
    const chdirMock = vi.fn();
    Object.defineProperty(process, 'chdir', {
      value: chdirMock,
      configurable: true,
      writable: true,
    });

    try {
      const result = await handleTask({
        id: 'qa-orphaned-incident-1',
        target: 'workspace',
        suite: 'smoke',
        dryRun: false,
        payload: {
          incidentId: 'incident-missing-1',
          runIds: ['retry-run-missing-1'],
          repairIds: ['retry:repair-missing-1'],
          affectedSurfaces: ['repair-runtime', 'task-queue'],
        },
      });

      expect(result.success).toBe(true);
      expect(result.verificationSignals).not.toContain(
        'No workflow evidence matched the referenced run IDs.',
      );
      expect(result.closureRecommendation).toMatchObject({
        allowClosure: true,
        decision: 'close-incident',
      });
      expect(result.closureRecommendation.summary).toContain(
        'referenced incident is already missing from runtime state',
      );
      expect(result.verificationTrace).toMatchObject({
        incidentId: 'incident-missing-1',
        allowClosure: true,
        evidence: expect.arrayContaining(['incident-context:resolved-or-missing']),
      });
      expect(chdirMock).toHaveBeenCalled();
      expect(collection).toHaveBeenCalledWith('system_state');
    } finally {
      Object.defineProperty(process, 'chdir', {
        value: originalChdir,
        configurable: true,
        writable: true,
      });
      if (previousStateFile === undefined) {
        delete process.env.STATE_FILE;
      } else {
        process.env.STATE_FILE = previousStateFile;
      }
    }
  }, 60000);

  it('applies qa verification closure and reopen outcomes to linked incidents and repairs', async () => {
    const { applyQaVerificationOutcome } = await import('../src/taskHandlers.ts');
    const state = createDefaultState();

    state.repairRecords.push({
      repairId: 'repair-1',
      classification: 'doc-drift',
      trigger: 'manual-drift-repair',
      repairTaskType: 'drift-repair',
      verificationMode: 'knowledge-pack',
      status: 'running',
      detectedAt: '2026-03-16T09:00:00.000Z',
      queuedAt: '2026-03-16T09:00:00.000Z',
    });
    state.incidentLedger.push({
      incidentId: 'incident-1',
      fingerprint: 'incident-1',
      title: 'Verifier-backed incident',
      classification: 'service-runtime',
      severity: 'warning',
      truthLayer: 'observed',
      firstSeenAt: '2026-03-16T09:00:00.000Z',
      lastSeenAt: '2026-03-16T09:00:00.000Z',
      resolvedAt: null,
      status: 'active',
      summary: 'The service needs verifier-backed closure.',
      affectedSurfaces: ['agent:doc-specialist'],
      linkedServiceIds: ['doc-specialist'],
      linkedTaskIds: [],
      linkedRunIds: [],
      linkedRepairIds: ['repair-1'],
      linkedProofDeliveries: [],
      evidence: [],
      recommendedSteps: ['Run qa-verification after repair.'],
      policy: {
        policyId: 'service-runtime',
        preferredOwner: 'qa-verification-agent',
        autoAssignOwner: true,
        autoRemediateOnCreate: false,
        autoRetryBlockedRemediation: true,
        maxAutoRemediationAttempts: 2,
        autoEscalateOnBreach: true,
        remediationTaskType: 'system-monitor',
        verifierTaskType: 'qa-verification',
        escalationTaskType: 'system-monitor',
        targetSlaMinutes: 60,
        escalationMinutes: 120,
      },
      escalation: {
        level: 'normal',
        status: 'on-track',
        dueAt: null,
        escalateAt: null,
        summary: 'On track.',
      },
      remediation: {
        owner: 'auto',
        status: 'watching',
        summary: 'Waiting for verifier.',
        nextAction: 'Run qa-verification.',
        blockers: [],
      },
      remediationPlan: [],
      verification: {
        required: true,
        agentId: 'qa-verification-agent',
        status: 'pending',
        summary: 'Verification pending.',
        verificationTaskId: null,
        verificationRunId: null,
        verifiedAt: null,
      },
      history: [],
      policyExecutions: [],
      acknowledgements: [],
      ownershipHistory: [],
      remediationTasks: [
        {
          remediationId: 'verification-1',
          lane: 'verification',
          createdAt: '2026-03-16T09:00:00.000Z',
          createdBy: 'system:auto-verification',
          taskType: 'qa-verification',
          taskId: 'qa-task-1',
          runId: 'run-1',
          status: 'running',
          reason: 'Verifier required.',
        },
      ],
    } as any);

    const closure = applyQaVerificationOutcome({
      state,
      incidentId: 'incident-1',
      repairIds: ['repair-1'],
      taskId: 'qa-task-1',
      runId: 'run-1',
      status: 'passed',
      summary: 'Verification passed with enough runtime evidence to support closure.',
      generatedAt: '2026-03-16T10:00:00.000Z',
      allowClosure: true,
      closureDecision: 'close-incident',
      evidence: ['correctness:verified'],
    });

    expect(closure.resolvedIncident).toBe(true);
    expect(state.incidentLedger[0]?.status).toBe('resolved');
    expect(state.incidentLedger[0]?.verification.status).toBe('passed');
    expect(state.repairRecords[0]?.status).toBe('verified');

    const reopened = applyQaVerificationOutcome({
      state,
      incidentId: 'incident-1',
      repairIds: ['repair-1'],
      taskId: 'qa-task-1',
      runId: 'run-1',
      status: 'failed',
      summary: 'Verification failed; incident closure is not permitted.',
      generatedAt: '2026-03-16T10:05:00.000Z',
      allowClosure: false,
      closureDecision: 'escalate',
      evidence: ['correctness:failed'],
    });

    expect(reopened.reopenedIncident).toBe(true);
    expect(state.incidentLedger[0]?.status).toBe('active');
    expect(state.incidentLedger[0]?.verification.status).toBe('failed');
    expect(state.repairRecords[0]?.status).toBe('failed');
  });

  it('emits explicit workflow stop causes for blocked integration runs', async () => {
    const { handleTask } = await import('../../agents/integration-agent/src/index.ts');

    const result = await handleTask({
      id: 'integration-stop-1',
      type: 'integration-workflow',
      steps: [
        {
          name: 'verify-remediation',
          agent: 'integration-agent',
          taskType: 'integration-workflow',
          dependsOn: ['repair-finished'],
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.stopClassification).toBe('dependency-blocked');
    expect(result.stopCause).toMatchObject({
      step: 'verify-remediation',
      classification: 'dependency-blocked',
      verifierRequired: true,
    });
    expect(result.stopCause?.dependencyBlockers).toEqual(
      expect.arrayContaining(['dependency repair-finished not satisfied']),
    );
    expect((result.recoveryPlan.workflowWatch as any).currentStop).toMatchObject({
      step: 'verify-remediation',
      classification: 'dependency-blocked',
    });
    expect(result.delegationPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: 'verify-remediation',
          mode: 'blocked',
        }),
      ]),
    );
    expect(result.replayContract).toMatchObject({
      durable: true,
      replayFromStep: 'verify-remediation',
    });
    expect(result.partialCompletion).toMatchObject({
      replayable: true,
      blockedStep: 'verify-remediation',
      remainingSteps: expect.arrayContaining(['verify-remediation']),
    });
    expect(result.plan.workflowProfile).toMatchObject({
      classification: 'verification',
      verifierRequired: true,
    });
    expect(result.handoffPackages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetAgentId: 'qa-verification-agent',
          payloadType: 'verification-review',
        }),
      ]),
    );
    expect(result.dependencyPlan).toMatchObject({
      totalDependencies: 1,
      blockedDependencyCount: 1,
      criticalSteps: expect.arrayContaining([
        expect.objectContaining({
          step: 'verify-remediation',
          dependsOn: expect.arrayContaining(['repair-finished']),
        }),
      ]),
    });
    expect(result.workflowMemory).toMatchObject({
      durable: true,
      resumeFromStep: 'verify-remediation',
      stopLedger: expect.arrayContaining([
        expect.objectContaining({
          step: 'verify-remediation',
          classification: 'dependency-blocked',
        }),
      ]),
    });
    expect(result.operatorSummary).toContain('Workflow blocked at verify-remediation');
    expect(result.recommendedNextActions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Replay from verify-remediation'),
      ]),
    );
    expect(result.specialistContract).toMatchObject({
      role: 'Workflow Architect',
      workflowStage: 'workflow-recovery',
      status: 'blocked',
      escalationReason: null,
    });
  });

  it('hydrates a bounded default integration workflow when no steps are supplied', async () => {
    const result = await runIntegrationAgentFixture({
      task: {
        id: 'integration-default-1',
        type: 'workflow',
        steps: [],
      },
      extraAgentConfigs: [
        {
          dirName: 'market-research-agent',
          config: buildIntegrationWorkerFixtureConfig({
            id: 'market-research-agent',
            taskType: 'market-research',
            skillIds: ['sourceFetch'],
          }),
        },
        {
          dirName: 'data-extraction-agent',
          config: buildIntegrationWorkerFixtureConfig({
            id: 'data-extraction-agent',
            taskType: 'data-extraction',
            skillIds: ['documentParser'],
          }),
        },
        {
          dirName: 'normalization-agent',
          config: buildIntegrationWorkerFixtureConfig({
            id: 'normalization-agent',
            taskType: 'normalize-data',
            skillIds: ['normalizer'],
          }),
        },
        {
          dirName: 'qa-verification-agent',
          config: buildIntegrationWorkerFixtureConfig({
            id: 'qa-verification-agent',
            taskType: 'qa-verification',
            skillIds: ['testRunner'],
          }),
        },
      ],
      serviceStates: {
        'market-research-agent': {
          taskPath: {
            taskType: 'market-research',
            lastObservedAt: '2026-03-20T10:00:00.000Z',
            lastObservedStatus: 'success',
            lastSuccessfulAt: '2026-03-20T10:00:00.000Z',
            totalRuns: 2,
            successfulRuns: 2,
          },
          serviceHeartbeat: { status: 'ok' },
          lastStatus: 'ok',
        },
        'data-extraction-agent': {
          taskPath: {
            taskType: 'data-extraction',
            lastObservedAt: '2026-03-20T10:01:00.000Z',
            lastObservedStatus: 'success',
            lastSuccessfulAt: '2026-03-20T10:01:00.000Z',
            totalRuns: 2,
            successfulRuns: 2,
          },
          serviceHeartbeat: { status: 'ok' },
          lastStatus: 'ok',
        },
        'normalization-agent': {
          taskPath: {
            taskType: 'normalize-data',
            lastObservedAt: '2026-03-20T10:02:00.000Z',
            lastObservedStatus: 'success',
            lastSuccessfulAt: '2026-03-20T10:02:00.000Z',
            totalRuns: 2,
            successfulRuns: 2,
          },
          serviceHeartbeat: { status: 'ok' },
          lastStatus: 'ok',
        },
        'qa-verification-agent': {
          taskPath: {
            taskType: 'qa-verification',
            lastObservedAt: '2026-03-20T10:03:00.000Z',
            lastObservedStatus: 'success',
            lastSuccessfulAt: '2026-03-20T10:03:00.000Z',
            totalRuns: 2,
            successfulRuns: 2,
          },
          serviceHeartbeat: { status: 'ok' },
          lastStatus: 'ok',
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'collect-market-signals',
          agent: 'market-research-agent',
          success: true,
        }),
        expect.objectContaining({
          name: 'verify-workflow-readiness',
          agent: 'qa-verification-agent',
          success: true,
        }),
      ]),
    );
    expect(result.toolInvocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolId: 'sourceFetch' }),
        expect.objectContaining({ toolId: 'documentParser' }),
        expect.objectContaining({ toolId: 'normalizer' }),
        expect.objectContaining({ toolId: 'testRunner' }),
      ]),
    );
    expect(result.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationship: 'coordinates-agent',
          to: 'agent:market-research-agent',
        }),
        expect.objectContaining({
          relationship: 'feeds-agent',
          to: 'agent:qa-verification-agent',
        }),
      ]),
    );
    expect(result.plan.workflowProfile).toMatchObject({
      criticalPath: expect.arrayContaining(['verify-workflow-readiness']),
    });
    expect(result.workflowMemory).toMatchObject({
      checkpointCount: 4,
    });
  });

  it('normalizes shorthand workflow descriptors into routable integration steps', async () => {
    const result = await runIntegrationAgentFixture({
      task: {
        id: 'integration-shorthand-1',
        type: 'workflow',
        steps: [
          {
            detail: 'market-research: operator console trends',
          },
          {
            detail: 'qa-verification: workflow closure',
          },
        ],
      },
      extraAgentConfigs: [
        {
          dirName: 'market-research-agent',
          config: buildIntegrationWorkerFixtureConfig({
            id: 'market-research-agent',
            taskType: 'market-research',
            skillIds: ['sourceFetch'],
          }),
        },
        {
          dirName: 'qa-verification-agent',
          config: buildIntegrationWorkerFixtureConfig({
            id: 'qa-verification-agent',
            taskType: 'qa-verification',
            skillIds: ['testRunner'],
          }),
        },
      ],
      serviceStates: {
        'market-research-agent': {
          taskPath: {
            taskType: 'market-research',
            lastObservedAt: '2026-03-20T11:00:00.000Z',
            lastObservedStatus: 'success',
            lastSuccessfulAt: '2026-03-20T11:00:00.000Z',
            totalRuns: 1,
            successfulRuns: 1,
          },
          serviceHeartbeat: { status: 'ok' },
          lastStatus: 'ok',
        },
        'qa-verification-agent': {
          taskPath: {
            taskType: 'qa-verification',
            lastObservedAt: '2026-03-20T11:01:00.000Z',
            lastObservedStatus: 'success',
            lastSuccessfulAt: '2026-03-20T11:01:00.000Z',
            totalRuns: 1,
            successfulRuns: 1,
          },
          serviceHeartbeat: { status: 'ok' },
          lastStatus: 'ok',
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'operator console trends',
          agent: 'market-research-agent',
        }),
        expect.objectContaining({
          name: 'workflow closure',
          agent: 'qa-verification-agent',
        }),
      ]),
    );
    expect(result.delegationPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: 'workflow closure',
          selectedAgent: 'qa-verification-agent',
        }),
      ]),
    );
    expect(result.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationship: 'feeds-agent',
          to: 'agent:qa-verification-agent',
        }),
      ]),
    );
  });

  it('prefers healthier candidates when incident-linked trust pressure lowers readiness', async () => {
    const baseBuildConfig = JSON.parse(
      await readFile(
        join(process.cwd(), '..', 'agents', 'build-refactor-agent', 'agent.config.json'),
        'utf-8',
      ),
    ) as Record<string, unknown>;

    const result = await runIntegrationAgentFixture({
      task: {
        id: 'integration-selection-1',
        type: 'integration-workflow',
        steps: [
          {
            name: 'apply-bounded-remediation',
            taskType: 'build-refactor',
            skillId: 'workspacePatch',
          },
        ],
      },
      state: {
        taskExecutions: [],
        workflowEvents: [],
        relationshipObservations: [],
        incidentLedger: [
          {
            incidentId: 'incident-selection-1',
            classification: 'repair',
            severity: 'critical',
            status: 'active',
            owner: 'build-refactor-agent',
            summary: 'Primary build-refactor lane is under active repair pressure.',
            linkedServiceIds: ['build-refactor-agent'],
            affectedSurfaces: ['agent:build-refactor-agent'],
            verification: {
              required: true,
              status: 'pending',
            },
            remediationTasks: [
              {
                remediationId: 'rem-selection-1',
                status: 'blocked',
              },
            ],
          },
        ],
      },
      serviceStates: {
        'build-refactor-agent': {
          taskPath: {
            taskType: 'build-refactor',
            lastObservedAt: '2026-03-19T10:00:00.000Z',
            lastObservedStatus: 'success',
            lastSuccessfulAt: '2026-03-19T10:00:00.000Z',
            totalRuns: 6,
            successfulRuns: 6,
            failedRuns: 0,
            activeRuns: 0,
          },
          serviceHeartbeat: {
            checkedAt: '2026-03-19T10:01:00.000Z',
            status: 'ok',
          },
        },
        'build-refactor-shadow-agent': {
          taskPath: {
            taskType: 'build-refactor',
            lastObservedAt: '2026-03-19T09:00:00.000Z',
            lastObservedStatus: 'success',
            lastSuccessfulAt: '2026-03-19T09:00:00.000Z',
            totalRuns: 4,
            successfulRuns: 4,
            failedRuns: 0,
            activeRuns: 0,
          },
        },
      },
      extraAgentConfigs: [
        {
          dirName: 'build-refactor-agent',
          config: {
            ...baseBuildConfig,
            id: 'build-refactor-agent',
            serviceStatePath: '../../logs/build-refactor-agent-service.json',
          },
        },
        {
          dirName: 'build-refactor-shadow-agent',
          config: {
            ...baseBuildConfig,
            id: 'build-refactor-shadow-agent',
            name: 'Build Refactor Shadow Agent',
            serviceStatePath: '../../logs/build-refactor-shadow-agent-service.json',
          },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'apply-bounded-remediation',
          agent: 'build-refactor-shadow-agent',
          success: true,
        }),
      ]),
    );
    expect(result.plan.selectedAgents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: 'apply-bounded-remediation',
          agentId: 'build-refactor-shadow-agent',
          operationalPosture: expect.objectContaining({
            status: 'strong',
          }),
        }),
      ]),
    );
    expect(result.delegationPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: 'apply-bounded-remediation',
          selectedAgent: 'build-refactor-shadow-agent',
          mode: 'primary',
          reason: expect.stringContaining('preferred over build-refactor-agent'),
          operationalPosture: expect.objectContaining({
            status: 'strong',
          }),
          evidence: expect.arrayContaining([
            'operational-posture:strong',
          ]),
        }),
      ]),
    );
    expect(result.delegationPlan[0]?.reason).toContain('degraded posture');
  });

  it('refuses execute-mode QA on doc surfaces without explicit evidence anchors', async () => {
    const { handleTask } = await import('../../agents/qa-verification-agent/src/index.ts');

    const result = await handleTask({
      id: 'qa-doc-refusal-1',
      mode: 'execute',
      targetAgentId: 'content-agent',
      surface: 'docs',
      testCommand: 'build-verify',
    });

    expect(result.success).toBe(false);
    expect(result.verificationSurface).toMatchObject({
      surface: 'docs',
      acceptanceMode: 'evidence-review',
    });
    expect(result.refusalProfile).toMatchObject({
      surface: 'docs',
      executeRequested: true,
      refused: true,
    });
    expect(result.acceptanceCoverage).toMatchObject({
      surface: 'docs',
      closureReadiness: 'needs-evidence',
    });
    expect(result.error).toContain('requires evidence anchors');
  });

  it('content-agent refuses speculative content without grounding', async () => {
    const { handleTask } = await import('../../agents/content-agent/src/index.ts');

    const result = await handleTask({
      id: 'content-speculative-1',
      type: 'blog_post',
      source: {
        title: 'Speculative roadmap',
        description: 'This likely changes everything.',
        claims: [{ text: 'Revenue will probably double next quarter.', grounded: false }],
      },
    });

    expect(result.success).toBe(false);
    expect(result.publicationPolicy).toMatchObject({
      status: 'speculative-refused',
    });
    expect(result.routingDecision).toMatchObject({
      documentMode: 'general',
      downstreamAgent: 'summarization-agent',
    });
    expect(result.operatorSummary).toContain('refused publication');
    expect(result.specialistContract).toMatchObject({
      role: 'Content Creator',
      workflowStage: 'publication-refusal',
      status: 'refused',
    });
  });

  it('content-agent emits a downstream handoff package for grounded proof content', async () => {
    const { handleTask } = await import('../../agents/content-agent/src/index.ts');

    const result = await handleTask({
      id: 'content-proof-1',
      type: 'proof_summary',
      source: {
        claim: 'The operator surface now reflects live runtime truth.',
        evidence: ['incident:inc-2', 'task:publish-1'],
        metadata: { topic: 'operator proof' },
      },
    });

    expect(result.success).toBe(true);
    expect(result.handoffPackage).toMatchObject({
      targetAgentId: 'reddit-helper',
      payloadType: 'proof-handoff',
    });
    expect(result.routingDecision).toMatchObject({
      audience: 'public',
      documentMode: 'proof',
      downstreamAgent: 'reddit-helper',
    });
    expect(result.evidenceSchema).toMatchObject({
      rails: expect.arrayContaining(['incident', 'task', 'topic']),
      evidenceAttached: true,
    });
    expect(result.content).toContain('## Evidence Rails');
    expect(result.operatorSummary).toContain('Generated proof_summary content');
    expect(result.specialistContract).toMatchObject({
      role: 'Content Creator',
      workflowStage: expect.stringMatching(/publication-(closure|review)/),
      status: expect.stringMatching(/completed|watching/),
    });
  });

  it('content-agent specializes operator notices with evidence-attached publishing metadata', async () => {
    const { handleTask } = await import('../../agents/content-agent/src/index.ts');

    const result = await handleTask({
      id: 'content-operator-1',
      type: 'operator_notice',
      source: {
        description: 'Incident review remains blocked on verification.',
        evidence: ['incident:inc-9', 'task:verify-2'],
        operatorNote: 'Do not broaden publication until QA closes the blocker.',
      },
    });

    expect(result.success).toBe(true);
    expect(result.documentSpecialization).toMatchObject({
      mode: 'operator-notice',
      audience: 'operator',
      riskLevel: 'high',
    });
    expect(result.evidenceSchema).toMatchObject({
      evidenceAttached: true,
    });
    expect(result.content).toContain('## Source Summary');
    expect(result.recommendedNextActions?.length).toBeGreaterThan(0);
    expect(result.specialistContract).toMatchObject({
      role: 'Content Creator',
    });
  });

  it('summarization-agent preserves evidence anchors in incident handoff mode', async () => {
    const { handleTask } = await import('../../agents/summarization-agent/src/index.ts');

    const result = await handleTask({
      id: 'summary-handoff-1',
      source: {
        type: 'report',
        content: 'incident:inc-1 requires review before repair:repair-1 can close. task:qa-1 remains pending.',
        metadata: { topic: 'operator incident' },
      },
      format: 'incident_handoff',
    });

    expect(result.success).toBe(true);
    expect(result.handoff).toMatchObject({
      mode: 'incident',
      readyForDelegation: true,
    });
    expect(result.evidencePreservation?.anchorsDetected).toBeGreaterThan(0);
    expect(result.handoffPackage).toMatchObject({
      targetAgentId: 'qa-verification-agent',
      payloadType: 'operator-handoff',
    });
    expect(result.operationalCompression).toMatchObject({
      mode: 'incident',
      downstreamTarget: 'qa-verification-agent',
      blockerSafe: true,
    });
    expect(result.actionCriticalDetails).toMatchObject({
      replayAnchors: expect.arrayContaining(['incident:inc-1', 'repair:repair-1', 'task:qa-1']),
    });
    expect(result.downstreamArtifact).toMatchObject({
      artifactType: 'incident-replay',
      targetAgentId: 'qa-verification-agent',
    });
    expect(result.toolInvocations?.[0]).toMatchObject({
      toolId: 'normalizer',
      classification: 'compression-handoff',
    });
    expect(result.operatorSummary).toContain('incident_handoff summary');
    expect(result.specialistContract).toMatchObject({
      role: 'Executive Summary Generator',
      workflowStage: expect.stringMatching(/summary-(closure|review)/),
      status: expect.stringMatching(/completed|watching/),
    });
  });

  it('data-extraction-agent carries provenance and normalization handoff metadata', async () => {
    const { handleTask } = await import('../../agents/data-extraction-agent/src/index.ts');

    const result = await handleTask({
      id: 'extract-inline-1',
      input: {
        source: {
          type: 'inline',
          content: 'name: OpenClaw\nstatus: active',
        },
        schema: {
          name: 'string',
          status: 'string',
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.results[0]).toMatchObject({
      provenance: expect.objectContaining({
        sourceType: 'inline',
      }),
      normalizationHandoff: expect.objectContaining({
        suggested: true,
      }),
    });
    expect(result.handoffPackages?.[0]).toMatchObject({
      targetAgentId: 'normalization-agent',
      payloadType: 'raw-extraction',
    });
    expect(result.artifactCoverage).toMatchObject({
      formats: expect.arrayContaining(['inline']),
      normalizationReadyCount: expect.any(Number),
    });
    expect(result.artifactRecords?.[0]).toMatchObject({
      artifactClass: 'inline',
      normalizationReady: true,
    });
    expect(result.toolInvocations).toEqual([]);
    expect(result.operatorSummary).toContain('Processed 1 source');
    expect(result.specialistContract).toMatchObject({
      role: 'Data Extraction Specialist',
      workflowStage: 'artifact-closure',
      status: 'completed',
    });
  });

  it('data-extraction-agent handles multiple artifact classes under one evidence model', async () => {
    const { handleTask } = await import('../../agents/data-extraction-agent/src/index.ts');

    const result = await handleTask({
      id: 'extract-artifacts-1',
      input: {
        artifacts: [
          {
            type: 'inline-note',
            format: 'inline',
            content: 'name: OpenClaw\nstatus: active',
          },
          {
            type: 'csv-snippet',
            format: 'csv',
            content: 'name,status\nOperator Console,blocked',
          },
        ],
        schema: {
          name: 'string',
          status: 'string',
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.artifactRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactClass: 'inline',
          adapterMode: 'inline',
        }),
        expect.objectContaining({
          artifactClass: 'structured',
          adapterMode: 'structured',
        }),
      ]),
    );
    expect(result.artifactCoverage).toMatchObject({
      formats: expect.arrayContaining(['inline', 'csv']),
      provenanceDepth: 'strong',
    });
    expect(result.recommendedNextActions?.length ?? 0).toBeGreaterThan(0);
    expect(result.specialistContract?.role).toBe('Data Extraction Specialist');
  });

  it('data-extraction-agent emits governed tool evidence for document parsing and normalization', async () => {
    const { handleTask } = await import('../../agents/data-extraction-agent/src/index.ts');

    const result = await handleTask({
      id: 'extract-files-1',
      input: {
        files: [
          {
            path: resolve(process.cwd(), 'package.json'),
            format: 'json',
          },
        ],
        schema: {
          name: 'string',
          version: 'string',
        },
        normalize: true,
      },
    });

    expect(result.success).toBe(true);
    expect(result.toolInvocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: 'documentParser',
          classification: 'artifact-extraction',
        }),
        expect.objectContaining({
          toolId: 'normalizer',
          classification: 'normalization-handoff',
        }),
      ]),
    );
    expect(result.specialistContract).toMatchObject({
      role: 'Data Extraction Specialist',
      workflowStage: expect.stringMatching(/artifact-(review|closure)/),
      status: expect.stringMatching(/watching|completed/),
    });
  });

  it('normalization-agent emits canonical records and uncertainty flags', async () => {
    const { handleTask } = await import('../../agents/normalization-agent/src/index.ts');

    const result = await handleTask({
      id: 'normalize-1',
      type: 'normalize',
      input: [{ name: 'OpenClaw', status: '' }],
      schema: {
        name: 'string',
        status: 'string',
      },
    });

    expect(result.success).toBe(true);
    expect(result.canonicalRecords?.[0]).toMatchObject({
      canonicalId: 'openclaw',
    });
    expect(result.uncertaintyFlags?.length).toBeGreaterThan(0);
    expect(result.handoffPackage).toMatchObject({
      payloadType: 'canonical-dataset',
    });
    expect(result.comparisonReadiness).toMatchObject({
      status: 'watching',
      uncertaintyCount: expect.any(Number),
      canonicalIdCount: expect.any(Number),
    });
    expect(result.dedupeDecisions?.[0]).toMatchObject({
      action: 'keep-distinct',
      rationale: expect.any(String),
    });
    expect(result.schemaMismatches?.[0]).toMatchObject({
      unexpectedFields: expect.any(Array),
      missingFields: expect.any(Array),
    });
    expect(result.toolInvocations?.[0]).toMatchObject({
      toolId: 'normalizer',
      classification: 'canonicalization',
    });
    expect(result.operatorSummary).toContain('Canonicalized 1 record');
    expect(result.specialistContract).toMatchObject({
      role: 'Data Consolidation Agent',
      workflowStage: 'canonicalization-review',
      status: 'watching',
    });
  });

  it('market-research-agent fetches allowlisted sources for query mode', async () => {
    const { handleTask } = await import('../../agents/market-research-agent/src/index.ts');

    const result = await handleTask({
      id: 'market-query-1',
      query: 'openai pricing changes',
      scope: 'pricing',
      __executeSkill: async (_skillId: string, input: { url: string }) => ({
        success: true,
        data: {
          statusCode: 200,
          content: `Fetched operator evidence from ${input.url}`,
          source: input.url,
          fetchedAt: '2026-03-28T10:00:00.000Z',
        },
      }),
    });

    expect(result.success).toBe(true);
    expect(result.sourcePlan?.length).toBeGreaterThan(0);
    expect(result.findings?.[0]).toMatchObject({
      url: expect.stringMatching(/^https?:\/\//),
      rationale: expect.any(String),
    });
    expect(result.changeIntelligence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: expect.any(String),
        }),
      ]),
    );
    expect(result.handoffSignals?.[0]).toMatchObject({
      target: 'integration-agent',
    });
    expect(result.handoffPackage).toMatchObject({
      targetAgentId: 'integration-agent',
      payloadType: 'market-change-pack',
      recommendedTaskType: 'integration-workflow',
    });
    expect(result.internalSignals?.[0]).toMatchObject({
      signalId: expect.any(String),
      surface: 'pricing',
    });
    expect(result.changePack).toMatchObject({
      surfaces: expect.arrayContaining(['pricing']),
      durableSignalCount: expect.any(Number),
      degradationResilient: true,
    });
    expect(result.deltaCapture).toMatchObject({
      status: 'fetched',
      substantiveCount: expect.any(Number),
    });
    expect(result.toolInvocations?.[0]).toMatchObject({
      toolId: 'sourceFetch',
      classification: 'signal-intake',
    });
    expect(result.operatorSummary).toContain('Researched');
    expect(result.specialistContract).toMatchObject({
      role: 'Trend Researcher',
      workflowStage: 'signal-closure',
      status: 'completed',
    });
  });

  it('market-research-agent returns degraded actionable output when all allowlisted fetches fail', async () => {
    const { handleTask } = await import('../../agents/market-research-agent/src/index.ts');

    const result = await handleTask({
      id: 'market-query-degraded-1',
      query: 'operator dashboard policy changes',
      scope: 'policy',
      __executeSkill: async (_skillId: string, input: { url: string }) => ({
        success: false,
        error: `fetch blocked for ${input.url}`,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.networkPosture).toBe('degraded');
    expect(result.warnings).toContain(
      'All allowlisted research fetches failed. Returning a degraded source plan and routing signals so operators can still act on the request.',
    );
    expect(result.deltaCapture).toMatchObject({
      status: 'degraded',
      unreachableCount: expect.any(Number),
    });
    expect(result.internalSignals?.[0]).toMatchObject({
      classification: 'unreachable',
      downstreamUse: 'workflow-watch',
    });
    expect(result.handoffPackage).toMatchObject({
      targetAgentId: 'integration-agent',
      recommendedTaskType: 'integration-workflow',
    });
    expect(result.recommendedNextActions?.length ?? 0).toBeGreaterThan(0);
    expect(result.specialistContract).toMatchObject({
      role: 'Trend Researcher',
      workflowStage: 'signal-review',
      status: 'watching',
    });
  });

  it('content-agent generates source-driven README content without placeholder filler', async () => {
    const { handleTask } = await import('../../agents/content-agent/src/index.ts');

    const result = await handleTask({
      id: 'content-readme-1',
      type: 'readme',
      source: {
        name: 'OpenClaw',
        packageName: '@openclaw/workspace',
        description: 'Agent orchestration workspace for operator-driven runtime control.',
        installation: ['npm install', 'npm run dev'],
        features: ['Operator console', 'Task queue', 'Incident-led remediation'],
        documentation: ['docs/reference/api.md', 'docs/reference/task-types.md'],
        license: 'MIT',
      },
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Operator console');
    expect(result.content).toContain('npm run dev');
    expect(result.content).not.toContain('Feature 1');
  });

  it('content-agent parses supplied grounding documents before publication output', async () => {
    const { handleTask } = await import('../../agents/content-agent/src/index.ts');

    const result = await handleTask({
      id: 'content-grounding-1',
      type: 'proof_summary',
      source: {
        claim: 'Grounded publication should cite parsed local evidence.',
        evidence: ['task:content-grounding-1'],
        documents: [
          {
            filePath: 'workspace/evidence/operator-state.json',
            format: 'json',
          },
        ],
      },
      __executeSkill: async (_skillId: string, input: { filePath: string; format: string }) => ({
        success: true,
        entities: [{ type: 'path', value: input.filePath }],
      }),
    } as any);

    expect(result.success).toBe(true);
    expect(result.toolInvocations?.[0]).toMatchObject({
      toolId: 'documentParser',
      classification: 'content-grounding',
    });
    expect(result.evidenceAnchors).toEqual(
      expect.arrayContaining(['doc:workspace/evidence/operator-state.json']),
    );
  });

  it('build-refactor-agent refuses low-confidence broad-scope work without bounds', async () => {
    const { handleTask } = await import('../../agents/build-refactor-agent/src/index.ts');

    const result = await handleTask({
      id: 'refactor-broad-1',
      type: 'refactor',
      scope: 'workspace',
    });

    expect(result.success).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.rollbackPlan?.[0]).toContain('narrower scope');
    expect(result.scopeContract).toEqual(
      expect.objectContaining({
        scopeType: 'broad',
        bounded: false,
      }),
    );
    expect(result.impactEnvelope).toEqual(
      expect.objectContaining({
        estimatedTouchedFiles: expect.any(Number),
        verificationDepth: expect.any(String),
      }),
    );
    expect(result.refusalProfile).toEqual(
      expect.objectContaining({
        refused: true,
        narrowScopeSuggested: true,
      }),
    );
    expect(result.surgeryProfile).toEqual(
      expect.objectContaining({
        changeType: 'refactor',
        operatorReviewReason: expect.any(String),
      }),
    );
    expect(result.verificationLoop).toEqual(
      expect.objectContaining({
        mode: 'standard',
        requiresVerifier: expect.any(Boolean),
        postEditSteps: expect.any(Array),
      }),
    );
    expect(result.operatorSummary).toContain('Refused');
    expect(result.specialistContract).toMatchObject({
      role: 'Software Architect',
      workflowStage: 'scope-refusal',
      status: 'refused',
    });
  });

  it('build-refactor-agent synthesizes and applies bounded autonomous patches from scope evidence', async () => {
    const { handleTask } = await import('../../agents/build-refactor-agent/src/index.ts');
    const workspaceRoot = join(process.cwd(), '..');
    const tempRoot = join(workspaceRoot, 'tmp');
    await mkdir(tempRoot, { recursive: true });
    const fixtureDir = await mkdtemp(join(tempRoot, 'build-refactor-autonomous-'));
    const fixturePath = join(fixtureDir, 'TasksScopeFixture.ts');
    const relativeScope = relative(workspaceRoot, fixturePath);

    await writeFile(
      fixturePath,
      `const payload = {
  scope: draft.buildScope.trim() || "src",
};
`,
      'utf-8',
    );

    try {
      const result = await handleTask({
        id: 'refactor-autonomous-1',
        type: 'refactor',
        scope: relativeScope,
        intent: 'repair build scope defaults in this bounded operator patch lane',
        constraints: {
          maxFilesChanged: 1,
        },
      });

      expect(result.success).toBe(true);
      expect(result.summary.improvementDescription).toContain('Autonomously synthesized');
      expect(result.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: relativeScope,
            diff: expect.stringContaining('orchestrator/src'),
          }),
        ]),
      );
      expect(result.operatorSummary).toContain('touched 1 file');
      expect(result.specialistContract).toMatchObject({
        role: 'Software Architect',
        workflowStage: 'bounded-surgery-review',
        status: 'watching',
      });

      const updated = await readFile(fixturePath, 'utf-8');
      expect(updated).toContain('orchestrator/src');
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it('build-refactor-agent emits Wave 3 surgery signals and verifier handoff for bounded repair-linked work', async () => {
    const { handleTask } = await import('../../agents/build-refactor-agent/src/index.ts');
    const workspaceRoot = join(process.cwd(), '..');
    const tempRoot = join(workspaceRoot, 'tmp');
    await mkdir(tempRoot, { recursive: true });
    const fixtureDir = await mkdtemp(join(tempRoot, 'build-refactor-linked-'));
    const fixturePath = join(fixtureDir, 'TasksScopeFixture.ts');
    const relativeScope = relative(workspaceRoot, fixturePath);

    await writeFile(
      fixturePath,
      `const payload = {
  scope: draft.buildScope.trim() || "src",
};
`,
      'utf-8',
    );

    try {
      const result = await handleTask({
        id: 'refactor-linked-1',
        type: 'refactor',
        scope: relativeScope,
        intent: 'repair build scope defaults with verifier-backed evidence',
        constraints: {
          maxFilesChanged: 1,
          linkedRepairId: 'repair-wave3-1',
          linkedIncidentId: 'incident-wave3-1',
          verificationMode: 'qa-verification',
        },
      });

      expect(result.success).toBe(true);
      expect(result.scopeContract).toEqual(
        expect.objectContaining({
          scopeType: 'bounded',
          bounded: true,
          requestedMaxFilesChanged: 1,
        }),
      );
      expect(result.surgeryProfile).toEqual(
        expect.objectContaining({
          changeType: 'refactor',
          qaVerificationRequired: true,
          repairLinked: true,
        }),
      );
      expect(result.verificationLoop).toEqual(
        expect.objectContaining({
          mode: 'repair-linked',
          linkedRepairId: 'repair-wave3-1',
          linkedIncidentId: 'incident-wave3-1',
          requiresVerifier: true,
        }),
      );
      expect(result.impactEnvelope).toEqual(
        expect.objectContaining({
          multiStepEdit: expect.any(Boolean),
          rollbackWindow: expect.stringMatching(/tight|standard/),
          verificationDepth: 'verifier-backed',
        }),
      );
      expect(result.refusalProfile).toEqual(
        expect.objectContaining({
          refused: false,
          suggestedMaxFilesChanged: 1,
        }),
      );
      expect(result.relationships).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            to: 'agent:qa-verification-agent',
            relationship: 'feeds-agent',
            classification: 'verification-handoff',
          }),
        ]),
      );
      expect(result.toolInvocations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolId: 'workspacePatch',
            classification: 'required',
          }),
          expect.objectContaining({
            toolId: 'testRunner',
          }),
        ]),
      );
      expect(result.recommendedNextActions?.length ?? 0).toBeGreaterThan(0);
      expect(result.specialistContract).toMatchObject({
        role: 'Software Architect',
        workflowStage: 'repair-review',
        status: 'watching',
      });
      const updated = await readFile(fixturePath, 'utf-8');
      expect(updated).toContain('orchestrator/src');
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it('build-refactor-agent treats proof-delivery remediation as satisfied when the demand-runtime guard already exists', async () => {
    const { handleTask } = await import('../../agents/build-refactor-agent/src/index.ts');
    const workspaceRoot = join(process.cwd(), '..');
    const tempRoot = join(workspaceRoot, 'tmp');
    await mkdir(tempRoot, { recursive: true });
    const fixtureDir = await mkdtemp(join(tempRoot, 'build-refactor-proof-'));
    const fixturePath = join(fixtureDir, 'orchestrator', 'src', 'index.ts');
    const relativeScope = relative(workspaceRoot, join(fixtureDir, 'orchestrator', 'src'));

    await mkdir(dirname(fixturePath), { recursive: true });
    await writeFile(
      fixturePath,
      `function prioritizePublicProofActiveLanes(lanes: string[], limit: number = 8) {
  return lanes.slice(0, limit);
}

function buildPublicProofOverview() {
  const activeLanes = prioritizePublicProofActiveLanes(
    ["demand-runtime", "repair", "runtime-truth"],
  );
  return activeLanes;
}
`,
      'utf-8',
    );

    try {
      const result = await handleTask({
        id: 'refactor-proof-1',
        type: 'refactor',
        scope: relativeScope,
        incidentClassification: 'proof-delivery',
        intent: 'Repair the bounded runtime issue linked to proof delivery.',
        constraints: {
          maxFilesChanged: 2,
          runTests: false,
        },
      });

      expect(result.success).toBe(true);
      expect(result.summary.filesChanged).toBe(0);
      expect(result.summary.improvementDescription).toContain('already present');
      expect(result.refusalProfile).toEqual(
        expect.objectContaining({
          refused: false,
        }),
      );
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it('auto-enqueues drift repair when pending doc drift crosses the threshold', async () => {
    const { resolveTaskHandler } = await import('../src/taskHandlers.ts');
    const state = createDefaultState();
    const queued: Array<{ type: string; payload: Record<string, unknown> }> = [];

    for (let index = 0; index < 24; index += 1) {
      state.pendingDocChanges.push(`nodes/doc-${index}.md`);
    }

    const affectedPaths = [
      ...state.pendingDocChanges,
      'nodes/trigger.md',
    ];
    await clearDocRepairCooldown(affectedPaths);
    await clearDocRepairLock(affectedPaths);

    const message = await resolveTaskHandler({
      id: 'doc-change-threshold-1',
      type: 'doc-change',
      payload: { path: 'nodes/trigger.md' },
      createdAt: Date.now(),
    })(
      {
        id: 'doc-change-threshold-1',
        type: 'doc-change',
        payload: { path: 'nodes/trigger.md' },
        createdAt: Date.now(),
      },
      {
        config: {} as any,
        state,
        saveState: async () => {},
        enqueueTask: (type, payload) => {
          queued.push({ type, payload });
          return {
            id: 'auto-drift-repair-task-1',
            type,
            payload,
            createdAt: Date.now(),
          };
        },
        logger: console,
      },
    );

    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: 'drift-repair',
    });
    expect(state.repairRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: 'doc-drift',
          repairTaskType: 'drift-repair',
          status: 'queued',
          verificationMode: 'knowledge-pack',
        }),
      ]),
    );
    expect(message).toContain('auto-enqueued drift repair');
  });

  it('blocks duplicate auto-enqueue for the same pending doc set during cooldown', async () => {
    const { resolveTaskHandler } = await import('../src/taskHandlers.ts');
    const state = createDefaultState();
    const queued: Array<{ type: string; payload: Record<string, unknown> }> = [];

    for (let index = 0; index < 24; index += 1) {
      state.pendingDocChanges.push(`nodes/doc-${index}.md`);
    }

    const handler = resolveTaskHandler({
      id: 'doc-change-threshold-cooldown-1',
      type: 'doc-change',
      payload: { path: 'nodes/trigger.md' },
      createdAt: Date.now(),
    });
    const affectedPaths = [
      ...state.pendingDocChanges,
      'nodes/trigger.md',
    ];
    await clearDocRepairCooldown(affectedPaths);
    await clearDocRepairLock(affectedPaths);

    await handler(
      {
        id: 'doc-change-threshold-cooldown-1',
        type: 'doc-change',
        payload: { path: 'nodes/trigger.md' },
        createdAt: Date.now(),
      },
      {
        config: {} as any,
        state,
        saveState: async () => {},
        enqueueTask: (type, payload) => {
          queued.push({ type, payload });
          return {
            id: 'auto-drift-repair-task-1',
            type,
            payload,
            createdAt: Date.now(),
          };
        },
        logger: console,
      },
    );

    const secondMessage = await handler(
      {
        id: 'doc-change-threshold-cooldown-2',
        type: 'doc-change',
        payload: { path: 'nodes/trigger.md' },
        createdAt: Date.now(),
      },
      {
        config: {} as any,
        state,
        saveState: async () => {},
        enqueueTask: (type, payload) => {
          queued.push({ type, payload });
          return {
            id: 'auto-drift-repair-task-2',
            type,
            payload,
            createdAt: Date.now(),
          };
        },
        logger: console,
      },
    );

    expect(queued).toHaveLength(1);
    expect(secondMessage).toContain('cooling down');
  });

  it('agent-deploy copies the selected template into the deployment directory and records deployment state', async () => {
    const { resolveTaskHandler } = await import('../src/taskHandlers.ts');
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'agent-deploy-handler-'));
    const templateDir = join(fixtureRoot, 'template');
    const deployBaseDir = join(fixtureRoot, 'deployments');
    const state = createDefaultState();
    let saveCalls = 0;

    try {
      await mkdir(templateDir, { recursive: true });
      await writeFile(join(templateDir, 'agent.config.json'), JSON.stringify({ id: 'template-agent' }, null, 2), 'utf-8');
      await writeFile(join(templateDir, 'README.md'), '# Template Agent\n', 'utf-8');

      const task = {
        id: 'agent-deploy-1',
        type: 'agent-deploy' as const,
        payload: {
          agentName: 'ops-agent',
          template: 'doc-specialist',
          templatePath: templateDir,
          notes: 'Deploy for runtime validation.',
        },
        createdAt: Date.now(),
      };

      const message = await resolveTaskHandler(task)(
        task,
        {
          config: { deployBaseDir } as any,
          state,
          saveState: async () => {
            saveCalls += 1;
          },
          enqueueTask: () => {
            throw new Error('enqueueTask should not be used by agent-deploy');
          },
          logger: console,
        },
      );

      expect(saveCalls).toBe(1);
      expect(state.agentDeployments).toHaveLength(1);
      expect(state.agentDeployments[0]).toMatchObject({
        agentName: 'ops-agent',
        template: 'doc-specialist',
        status: 'deployed',
      });

      const deploymentPath = state.agentDeployments[0]?.repoPath;
      expect(deploymentPath).toBeTruthy();
      const deploymentNotes = JSON.parse(await readFile(join(deploymentPath!, 'DEPLOYMENT.json'), 'utf-8')) as {
        agentName?: string;
        template?: string;
      };
      expect(deploymentNotes).toMatchObject({
        agentName: 'ops-agent',
        template: 'doc-specialist',
      });
      expect(message).toContain('deployed ops-agent');
    } finally {
      vi.restoreAllMocks();
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('derives reddit draft selection from priority routing tags only', async () => {
    const { shouldSelectQueueItemForDraft } = await import('../src/taskHandlers.ts');

    expect(shouldSelectQueueItemForDraft({ tag: 'priority' })).toBe(true);
    expect(shouldSelectQueueItemForDraft({ tag: 'draft' })).toBe(false);
    expect(shouldSelectQueueItemForDraft({ tag: 'manual-review' })).toBe(false);
    expect(shouldSelectQueueItemForDraft({})).toBe(false);
    expect(shouldSelectQueueItemForDraft(null)).toBe(false);
  });

  it('passes orchestrator node_modules to spawned child env', async () => {
    const { buildAllowlistedChildEnv } = await import('../src/taskHandlers.ts');

    const env = buildAllowlistedChildEnv({});

    expect(env.ALLOW_ORCHESTRATOR_TASK_RUN).toBe('true');
    expect(env.NODE_PATH).toContain(join(process.cwd(), 'node_modules'));
  });

  it('creates explicit approvals for manual-review leads during nightly batch', async () => {
    const { buildManualReviewApprovalTaskId, resolveTaskHandler } = await import('../src/taskHandlers.ts');
    const state = createDefaultState();
    const digestDir = await mkdtemp(join(tmpdir(), 'nightly-batch-digest-'));

    try {
      state.redditQueue.push(
        {
          id: 'priority-lead-1',
          subreddit: 'openclaw',
          question: 'Priority lead',
          queuedAt: '2026-03-08T12:00:00.000Z',
          tag: 'priority',
        },
        {
          id: 'manual-lead-1',
          subreddit: 'openclaw',
          question: 'Manual review lead',
          queuedAt: '2026-03-08T12:00:00.000Z',
          tag: 'manual-review',
          score: 9.4,
        },
      );

      const handler = resolveTaskHandler({
        id: 'nightly-batch-approval-test',
        type: 'nightly-batch',
        payload: {},
        createdAt: Date.now(),
      });

      const message = await handler(
        {
          id: 'nightly-batch-approval-test',
          type: 'nightly-batch',
          payload: {},
          createdAt: Date.now(),
        },
        {
          config: {
            digestDir,
          } as any,
          state,
          saveState: async () => {},
          enqueueTask: () => {
            throw new Error('nightly-batch should not enqueue tasks directly in this test');
          },
          logger: console,
        },
      );

      expect(message).toContain('requested 1 manual-review approvals');
      expect(state.redditQueue.find((item) => item.id === 'priority-lead-1')?.selectedForDraft).toBe(true);
      expect(state.redditQueue.find((item) => item.id === 'manual-lead-1')?.selectedForDraft).toBe(false);
      expect(state.approvals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            taskId: buildManualReviewApprovalTaskId('manual-lead-1'),
            type: 'reddit-response',
            status: 'pending',
            payload: expect.objectContaining({
              queue: expect.objectContaining({
                id: 'manual-lead-1',
                selectedForDraft: true,
                reviewSource: 'manual-review',
              }),
            }),
          }),
        ]),
      );
    } finally {
      await rm(digestDir, { recursive: true, force: true });
    }
  });

  it('consumes review-gated queue items when an approval decision is applied', async () => {
    const { consumeReviewQueueItemForApprovalDecision } = await import('../src/taskHandlers.ts');
    const redditQueue = [
      {
        id: 'manual-lead-2',
        subreddit: 'openclaw',
        question: 'Needs approval',
        queuedAt: '2026-03-08T12:00:00.000Z',
        tag: 'manual-review',
      },
    ];

    const removed = consumeReviewQueueItemForApprovalDecision(redditQueue as any, {
      taskId: 'reddit-manual-review:manual-lead-2',
      type: 'reddit-response',
      payload: {
        queue: {
          id: 'manual-lead-2',
          selectedForDraft: true,
          reviewSource: 'manual-review',
        },
      },
      requestedAt: '2026-03-08T12:00:00.000Z',
      status: 'approved',
    });

    expect(removed).toMatchObject({
      id: 'manual-lead-2',
      tag: 'manual-review',
    });
    expect(redditQueue).toHaveLength(0);
  });

  it('creates bounded draft-promotion approvals for top-scoring draft leads during nightly batch', async () => {
    const { buildDraftReviewApprovalTaskId, resolveTaskHandler } = await import('../src/taskHandlers.ts');
    const state = createDefaultState();
    const digestDir = await mkdtemp(join(tmpdir(), 'nightly-batch-draft-promotion-'));

    try {
      state.redditQueue.push(
        {
          id: 'draft-lead-a',
          subreddit: 'openclaw',
          question: 'Draft A',
          queuedAt: '2026-03-08T12:00:00.000Z',
          tag: 'draft',
          score: 8.1,
        },
        {
          id: 'draft-lead-b',
          subreddit: 'openclaw',
          question: 'Draft B',
          queuedAt: '2026-03-08T12:00:01.000Z',
          tag: 'draft',
          score: 7.4,
        },
        {
          id: 'draft-lead-c',
          subreddit: 'openclaw',
          question: 'Draft C',
          queuedAt: '2026-03-08T12:00:02.000Z',
          tag: 'draft',
          score: 7.2,
        },
        {
          id: 'draft-lead-d',
          subreddit: 'openclaw',
          question: 'Draft D',
          queuedAt: '2026-03-08T12:00:03.000Z',
          tag: 'draft',
          score: 6.9,
        },
        {
          id: 'draft-lead-e',
          subreddit: 'openclaw',
          question: 'Draft E',
          queuedAt: '2026-03-08T12:00:04.000Z',
          tag: 'draft',
          score: 6.8,
        },
        {
          id: 'draft-lead-f',
          subreddit: 'openclaw',
          question: 'Draft F',
          queuedAt: '2026-03-08T12:00:05.000Z',
          tag: 'draft',
          score: 6.7,
        },
        {
          id: 'draft-lead-g',
          subreddit: 'openclaw',
          question: 'Draft G',
          queuedAt: '2026-03-08T12:00:06.000Z',
          tag: 'draft',
          score: 6.6,
        },
        {
          id: 'draft-lead-h',
          subreddit: 'openclaw',
          question: 'Draft H',
          queuedAt: '2026-03-08T12:00:07.000Z',
          tag: 'draft',
          score: 6.5,
        },
        {
          id: 'draft-lead-i',
          subreddit: 'openclaw',
          question: 'Draft I',
          queuedAt: '2026-03-08T12:00:08.000Z',
          tag: 'draft',
          score: 6.4,
        },
        {
          id: 'draft-lead-j',
          subreddit: 'openclaw',
          question: 'Draft J',
          queuedAt: '2026-03-08T12:00:09.000Z',
          tag: 'draft',
          score: 6.3,
        },
        {
          id: 'draft-lead-k',
          subreddit: 'openclaw',
          question: 'Draft K',
          queuedAt: '2026-03-08T12:00:10.000Z',
          tag: 'draft',
          score: 6.2,
        },
        {
          id: 'draft-lead-l',
          subreddit: 'openclaw',
          question: 'Draft L',
          queuedAt: '2026-03-08T12:00:11.000Z',
          tag: 'draft',
          score: 6.1,
        },
        {
          id: 'draft-lead-m',
          subreddit: 'openclaw',
          question: 'Draft M',
          queuedAt: '2026-03-08T12:00:12.000Z',
          tag: 'draft',
          score: 6.0,
        },
        {
          id: 'draft-lead-n',
          subreddit: 'openclaw',
          question: 'Draft N',
          queuedAt: '2026-03-08T12:00:13.000Z',
          tag: 'draft',
          score: 5.9,
        },
      );

      const handler = resolveTaskHandler({
        id: 'nightly-batch-draft-promotion-test',
        type: 'nightly-batch',
        payload: {},
        createdAt: Date.now(),
      });

      const message = await handler(
        {
          id: 'nightly-batch-draft-promotion-test',
          type: 'nightly-batch',
          payload: {},
          createdAt: Date.now(),
        },
        {
          config: {
            digestDir,
          } as any,
          state,
          saveState: async () => {},
          enqueueTask: () => {
            throw new Error('nightly-batch should not enqueue tasks directly in this test');
          },
          logger: console,
        },
      );

      expect(message).toContain('requested 10 draft promotion approvals');
      expect(state.approvals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            taskId: buildDraftReviewApprovalTaskId('draft-lead-a'),
            payload: expect.objectContaining({
              queue: expect.objectContaining({
                id: 'draft-lead-a',
                selectedForDraft: true,
                reviewSource: 'draft-review',
              }),
            }),
          }),
          expect.objectContaining({
            taskId: buildDraftReviewApprovalTaskId('draft-lead-b'),
          }),
          expect.objectContaining({
            taskId: buildDraftReviewApprovalTaskId('draft-lead-c'),
          }),
          expect.objectContaining({
            taskId: buildDraftReviewApprovalTaskId('draft-lead-j'),
          }),
        ]),
      );
      expect(
        state.approvals.some(
          (approval) =>
            approval.taskId === buildDraftReviewApprovalTaskId('draft-lead-n'),
        ),
      ).toBe(false);
    } finally {
      await rm(digestDir, { recursive: true, force: true });
    }
  });

  it('consumes only selected reddit queue items for reddit-response', async () => {
    const { consumeNextSelectedQueueItem } = await import('../src/taskHandlers.ts');
    const redditQueue = [
      {
        id: 'draft-lead-1',
        subreddit: 'openclaw',
        question: 'Draft lead',
        queuedAt: '2026-03-08T12:00:00.000Z',
        tag: 'draft',
        selectedForDraft: false,
      },
      {
        id: 'manual-lead-3',
        subreddit: 'openclaw',
        question: 'Manual review lead',
        queuedAt: '2026-03-08T12:00:00.000Z',
        tag: 'manual-review',
        selectedForDraft: false,
      },
      {
        id: 'priority-lead-2',
        subreddit: 'openclaw',
        question: 'Priority lead',
        queuedAt: '2026-03-08T12:00:00.000Z',
        tag: 'priority',
        selectedForDraft: true,
      },
    ];

    const selected = consumeNextSelectedQueueItem(redditQueue as any);

    expect(selected).toMatchObject({
      id: 'priority-lead-2',
      selectedForDraft: true,
    });
    expect(redditQueue.map((item) => item.id)).toEqual([
      'draft-lead-1',
      'manual-lead-3',
    ]);
  });

  it('prefers an explicitly approved manual-review payload over selected backlog items', async () => {
    const { resolveRedditResponseQueueItem } = await import('../src/taskHandlers.ts');
    const redditQueue = [
      {
        id: 'priority-lead-live',
        subreddit: 'openclaw',
        question: 'Priority lead waiting in backlog',
        queuedAt: '2026-03-08T12:00:00.000Z',
        tag: 'priority',
        selectedForDraft: true,
      },
    ];

    const selected = resolveRedditResponseQueueItem(
      redditQueue as any,
      {
        id: 'manual-approval-live',
        subreddit: 'openclaw',
        question: 'Approved manual review lead',
        queuedAt: '2026-03-08T12:05:00.000Z',
        tag: 'manual-review',
        selectedForDraft: true,
        reviewSource: 'manual-review',
      },
      '2026-03-08T12:06:00.000Z',
    );

    expect(selected).toMatchObject({
      id: 'manual-approval-live',
      tag: 'manual-review',
      selectedForDraft: true,
    });
    expect(redditQueue).toHaveLength(1);
    expect(redditQueue[0]).toMatchObject({
      id: 'priority-lead-live',
      selectedForDraft: true,
    });
  });

  it('handler-side honesty guard rejects unsuccessful agent results after a green exit', async () => {
    const { assertSpawnedAgentReportedSuccess } = await import('../src/taskHandlers.ts');

    expect(() =>
      assertSpawnedAgentReportedSuccess(
        {
          success: false,
          warnings: ['permission denied'],
        },
        'summarization',
      ),
    ).toThrow(/reported unsuccessful result/);

    expect(() =>
      assertSpawnedAgentReportedSuccess({ success: true }, 'summarization'),
    ).not.toThrow();
  });

  it('security-agent entrypoint exits non-zero when the logical result is unsuccessful', async () => {
    const execution = await runAgentEntryPointWithDeniedSkill({
      agentId: 'security-agent',
      resultEnvVar: 'SECURITY_AGENT_RESULT_FILE',
      deniedSkillId: 'documentParser',
      payload: {
        id: 'security-negative-1',
        type: 'scan',
        scope: 'workspace',
      },
    });

    expect(execution.result.success).toBe(false);
    expect(execution.exitCode).toBe(1);
  });

  it('summarization-agent entrypoint exits non-zero when the logical result is unsuccessful', async () => {
    const execution = await runAgentEntryPointWithDeniedSkill({
      agentId: 'summarization-agent',
      resultEnvVar: 'SUMMARIZATION_AGENT_RESULT_FILE',
      deniedSkillId: 'documentParser',
      payload: {
        id: 'summarization-negative-1',
        source: {
          type: 'document',
          content: 'OpenClaw operator truth should stay aligned to runtime.',
        },
        format: 'executive_summary',
      },
    });

    expect(execution.result.success).toBe(false);
    expect(execution.exitCode).toBe(1);
  });

  it('system-monitor-agent entrypoint exits non-zero when the logical result is unsuccessful', async () => {
    const execution = await runAgentEntryPointWithDeniedSkill({
      agentId: 'system-monitor-agent',
      resultEnvVar: 'SYSTEM_MONITOR_AGENT_RESULT_FILE',
      deniedSkillId: 'documentParser',
      payload: {
        id: 'system-monitor-negative-1',
        type: 'health',
        agents: ['security-agent'],
      },
    });

    expect(execution.result.success).toBe(false);
    expect(execution.exitCode).toBe(1);
  });

  it('system-monitor emits incident causality and influence relationships from runtime evidence', async () => {
    const { execution, result } = await runSystemMonitorFixture();

    expect(execution.exitCode).toBe(0);
    expect(result.success).toBe(true);
    expect(result.incidentCausality).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          incidentId: 'inc-proof-1',
          diagnosisId: expect.any(String),
          affectedAgents: expect.arrayContaining(['security-agent']),
        }),
      ]),
    );
    expect(result.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationship: 'feeds-agent',
          to: 'agent:security-agent',
          classification: 'incident-causality',
        }),
      ]),
    );
    expect((result.metrics.systemMetrics as any).trustBoundaryPressure).toMatchObject({
      status: 'critical',
      authSurfaceCount: expect.any(Number),
      relevantIncidentCount: expect.any(Number),
    });
    expect(result.dependencyHealth).toMatchObject({
      status: expect.stringMatching(/watching|degraded|critical/),
      blockedWorkflowCount: expect.any(Number),
      proofFailureCount: expect.any(Number),
    });
    expect(result.queueBudgetFusion).toMatchObject({
      status: expect.stringMatching(/watching|degraded|critical/),
      failedExecutionCount: expect.any(Number),
      pendingApprovalCount: expect.any(Number),
      dependencyRiskScore: expect.any(Number),
      predictionConfidence: expect.stringMatching(/low|medium|high/),
    });
    expect(result.trendSummary).toMatchObject({
      status: expect.stringMatching(/stable|watching|critical/),
      recentHourSignals: expect.any(Number),
      trustBoundaryTrend: expect.stringMatching(/stable|rising/),
    });
    expect(result.operatorClosureEvidence).toMatchObject({
      status: expect.stringMatching(/ready|watching|blocked/),
      prioritizedActions: expect.any(Number),
      proofFreshness: expect.stringMatching(/fresh|aging|stale|empty/),
    });
    expect(result.operationalDiagnosis).toMatchObject({
      status: expect.stringMatching(/stable|watching|critical/),
      diagnosisCount: expect.any(Number),
      operatorActionCount: expect.any(Number),
      dependencyStatus: expect.stringMatching(/healthy|watching|degraded|critical/),
    });
    expect((result.metrics.systemMetrics as any).degradationWindows.recentSixHours.workflowStops).toBeGreaterThan(0);
    expect(result.diagnoses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'trust-boundary-pressure',
        }),
        expect.objectContaining({
          id: 'queue-budget-fusion',
        }),
        expect.objectContaining({
          id: 'proof-freshness',
        }),
      ]),
    );
    expect(result.earlyWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'trust-boundary-escalation',
        }),
      ]),
    );
    expect(result.operatorSummary).toBeTruthy();
    expect(result.recommendedNextActions.length).toBeGreaterThan(0);
    expect(result.specialistContract).toMatchObject({
      role: 'SRE Monitor',
      workflowStage: expect.stringMatching(/runtime-(watch|escalation|closure)/),
      status: expect.stringMatching(/watching|escalate|completed/),
    });
  });

  it('security-agent scores trust-boundary findings and carries historical evidence', async () => {
    const { execution, result } = await runSecurityFixture();

    expect(execution.exitCode).toBe(0);
    expect(result.success).toBe(true);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trustBoundary: 'cors',
          exploitabilityScore: expect.any(Number),
          blastRadiusScore: expect.any(Number),
        }),
        expect.objectContaining({
          trustBoundary: 'auth',
        }),
        expect.objectContaining({
          location: 'orchestrator/src/index.ts',
          trustBoundary: 'auth',
        }),
      ]),
    );
    expect(result.permissionDriftTimeline.length).toBeGreaterThan(0);
    expect(result.trustBoundaryHistory.length).toBeGreaterThan(0);
    expect(result.routeBoundaryWatch).toEqual(
      expect.objectContaining({
        authFindingCount: expect.any(Number),
        status: expect.stringMatching(/watching|critical/),
      }),
    );
    expect(result.remediationDepth).toEqual(
      expect.objectContaining({
        status: expect.any(String),
        rollbackSensitiveFixCount: expect.any(Number),
        trustBoundaryFixCount: expect.any(Number),
      }),
    );
    expect(result.exploitabilityRanking).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: expect.any(String),
          combinedScore: expect.any(Number),
        }),
      ]),
    );
    expect(result.remediationClosure).toEqual(
      expect.objectContaining({
        status: expect.stringMatching(/ready|verification-required|blocked/),
        verifierRecommended: expect.any(Boolean),
      }),
    );
    expect(result.regressionReview).toEqual(
      expect.objectContaining({
        status: expect.stringMatching(/clear|watching|regressing/),
        permissionDriftCount: expect.any(Number),
        recurringBoundaryCount: expect.any(Number),
      }),
    );
    expect(result.boundedFixes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trustBoundary: 'auth',
          containment: expect.any(String),
        }),
        expect.objectContaining({
          target: 'orchestrator/src/index.ts',
          trustBoundary: 'auth',
        }),
      ]),
    );
    expect(result.operatorSummary).toBeTruthy();
    expect(result.recommendedNextActions.length).toBeGreaterThan(0);
    expect(result.specialistContract).toMatchObject({
      role: 'Security Engineer',
      workflowStage: expect.stringMatching(/security-closure|trust-boundary-review|security-escalation/),
      status: expect.stringMatching(/completed|watching|escalate/),
    });
  });

  it('derives confirmed worker status from live evidence inputs', async () => {
    process.env.OPENCLAW_SKIP_BOOTSTRAP = 'true';
    const { deriveWorkerEvidenceSummary } = await import('../src/index.ts');

    const toolInvocations: ToolInvocation[] = [
      {
        id: 'tool-1',
        agentId: 'summarization-agent',
        skillId: 'documentParser',
        args: { mode: 'preflight', taskType: 'summarize-content' },
        timestamp: '2026-03-07T18:36:47.000Z',
        mode: 'preflight',
        taskType: 'summarize-content',
        allowed: true,
      },
      {
        id: 'tool-2',
        agentId: 'summarization-agent',
        skillId: 'documentParser',
        args: { mode: 'execute' },
        timestamp: '2026-03-07T18:36:48.000Z',
        mode: 'execute',
        allowed: true,
      },
    ];

    const summary = deriveWorkerEvidenceSummary({
      agentId: 'summarization-agent',
      spawnedWorkerCapable: true,
      orchestratorTask: 'summarize-content',
      memory: {
        lastRunAt: '2026-03-07T18:36:48.013Z',
        lastStatus: 'success',
        totalRuns: 1,
        successCount: 1,
        errorCount: 0,
      },
      taskExecutions: [
        {
          taskId: 'task-1',
          idempotencyKey: 'run-1',
          type: 'summarize-content',
          status: 'success',
          attempt: 1,
          maxRetries: 0,
          lastHandledAt: '2026-03-07T18:36:48.013Z',
        },
      ],
      toolInvocations,
    });

    expect(summary.workerValidationStatus).toBe('confirmed-worker');
    expect(summary.evidenceSources).toEqual(
      expect.arrayContaining([
        'task-run-success',
        'toolgate-preflight',
        'toolgate-execute',
      ]),
    );
    expect(
      summary.evidenceSources.includes('agent-memory-success') ||
        summary.evidenceSources.includes('task-path-success') ||
        summary.evidenceSources.includes('agent-memory'),
    ).toBe(true);
    expect(summary.lastSuccessfulRunId).toBe('run-1');
    expect(summary.lastEvidenceAt).toBe('2026-03-07T18:36:48.013Z');
  });
});

describe('SkillAudit contract wiring', () => {
  function createInMemoryGovernedSkillStateStore() {
    let records: any[] = [];

    return {
      store: {
        async load() {
          return JSON.parse(JSON.stringify(records));
        },
        async save(nextRecords: any[]) {
          records = JSON.parse(JSON.stringify(nextRecords));
        },
      },
      snapshot() {
        return JSON.parse(JSON.stringify(records));
      },
    };
  }

  beforeEach(() => {
    const persistence = createInMemoryGovernedSkillStateStore();
    setGovernedSkillStateStoreForTest(persistence.store);
    resetSkillRuntimeForTest();
    setRuntimeStateMongoClientFactoryForTest(null);
  });

  it('exposes a coherent named auditSkill bootstrap contract', () => {
    const result = auditSkill(sourceFetchDefinition);
    expect(result.passed).toBe(true);
    expect(result.runAt).toBeTypeOf('string');
    expect(result.checks.length).toBeGreaterThan(0);
  });

  it('keeps the singleton audit gate accessible for deferred bootstrap paths', () => {
    const gate = getSkillAuditGate();
    expect(gate.getAuditHistory().length).toBeGreaterThan(0);
  });

  it('keeps the explicit skill bootstrap path coherent without implying auto-wiring', async () => {
    await initializeSkills();
    expect(hasSkill('sourceFetch')).toBe(true);
  });

  it('lazily bootstraps the registry on first executeSkill call', async () => {
    resetSkillRuntimeForTest();

    const result = await executeRegisteredSkill(
      'normalizer',
      {
        data: { amount: '$ 1,234.56' },
        schema: {
          amount: { type: 'currency', currency: 'USD' },
        },
        strict: false,
      },
      'data-extraction-agent',
    );

    expect(hasSkill('normalizer')).toBe(true);
    expect(result.success).toBe(true);
  });

  it('enforces manifest file read paths on file-based skill calls', async () => {
    const result = await executeRegisteredSkill(
      'documentParser',
      {
        filePath: 'artifacts/private.csv',
        format: 'csv',
      },
      'data-extraction-agent',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('read allowlist');
  });

  it('does not execute generated skills on the normal path before governed registration', async () => {
    resetSkillRuntimeForTest();

    const result = await executeRegisteredSkill(
      'generatedTestSkill',
      {
        payload: { value: 1 },
      },
      'data-extraction-agent',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Skill not found');
  });

  it('requires explicit review approval before governed skills become executable', async () => {
    resetSkillRuntimeForTest();

    const registration = await registerGovernedSkill(
      {
        ...sourceFetchDefinition,
        id: 'generatedTestSkill',
        description: 'Generated test skill intake contract',
      },
      async (input: any) => ({
        success: true,
        echoed: input.payload ?? null,
      }),
      {
        intakeSource: 'generated',
        registeredBy: 'toolgate-runtime-test',
        reviewNote: 'awaiting runtime review',
      },
    );

    expect(registration.success).toBe(true);
    expect(registration.data).toMatchObject({
      skillId: 'generatedTestSkill',
      trustStatus: 'pending-review',
      executable: false,
    });
    expect(hasSkill('generatedTestSkill')).toBe(false);
    expect(listGovernedSkillIntake()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'generatedTestSkill',
          trustStatus: 'pending-review',
          executable: false,
          intakeSource: 'generated',
        }),
      ]),
    );

    const beforeApproval = await executeRegisteredSkill(
      'generatedTestSkill',
      {
        payload: { value: 7 },
      },
    );

    expect(beforeApproval.success).toBe(false);
    expect(beforeApproval.error).toContain('Skill not found');

    const approval = await approveGovernedSkill(
      'generatedTestSkill',
      'toolgate-runtime-reviewer',
      'approved for runtime test',
    );

    expect(approval.success).toBe(true);
    expect(approval.data).toMatchObject({
      skillId: 'generatedTestSkill',
      trustStatus: 'review-approved',
      executable: true,
    });
    expect(hasSkill('generatedTestSkill')).toBe(true);
    expect(listGovernedSkillIntake()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'generatedTestSkill',
          trustStatus: 'review-approved',
          executable: true,
          reviewedBy: 'toolgate-runtime-reviewer',
        }),
      ]),
    );

    const result = await executeRegisteredSkill(
      'generatedTestSkill',
      {
        payload: { value: 42 },
      },
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      success: true,
      echoed: { value: 42 },
    });
  });

  it('keeps pending-review governed skills non-executable after restart rehydration', async () => {
    const persistence = createInMemoryGovernedSkillStateStore();
    setGovernedSkillStateStoreForTest(persistence.store);

    try {
      resetSkillRuntimeForTest();

      const registration = await registerGovernedSkill(
        {
          ...normalizerDefinition,
          id: 'pendingDurableSkill',
          description: 'Pending governed skill restart test',
        },
        executeNormalizer,
        {
          intakeSource: 'generated',
          registeredBy: 'toolgate-runtime-test',
        },
      );

      expect(registration.success).toBe(true);
      expect(persistence.snapshot()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            skillId: 'pendingDurableSkill',
            trustStatus: 'pending-review',
            persistenceMode: 'restart-safe',
          }),
        ]),
      );

      resetSkillRuntimeForTest();

      const result = await executeRegisteredSkill(
        'pendingDurableSkill',
        {
          data: { amount: '$ 100.00' },
          schema: {
            amount: { type: 'currency', currency: 'USD' },
          },
          strict: false,
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Skill not found');
      expect(listGovernedSkillIntake()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'pendingDurableSkill',
            trustStatus: 'pending-review',
            executable: false,
            persistenceMode: 'restart-safe',
          }),
        ]),
      );
    } finally {
      setGovernedSkillStateStoreForTest(null);
      resetSkillRuntimeForTest();
    }
  });

  it('rehydrates approved restart-safe governed skills after restart', async () => {
    const persistence = createInMemoryGovernedSkillStateStore();
    setGovernedSkillStateStoreForTest(persistence.store);

    try {
      resetSkillRuntimeForTest();

      const registration = await registerGovernedSkill(
        {
          ...normalizerDefinition,
          id: 'durableGovernedSkill',
          description: 'Durable governed skill restart test',
        },
        executeNormalizer,
        {
          intakeSource: 'generated',
          registeredBy: 'toolgate-runtime-test',
        },
      );

      expect(registration.success).toBe(true);

      const approval = await approveGovernedSkill(
        'durableGovernedSkill',
        'toolgate-runtime-reviewer',
        'approved for durable restart test',
      );

      expect(approval.success).toBe(true);
      expect(persistence.snapshot()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            skillId: 'durableGovernedSkill',
            trustStatus: 'review-approved',
            persistenceMode: 'restart-safe',
            executorBinding: {
              type: 'builtin-skill',
              skillId: 'normalizer',
            },
          }),
        ]),
      );

      resetSkillRuntimeForTest();

      const result = await executeRegisteredSkill(
        'durableGovernedSkill',
        {
          data: { amount: '$ 250.50' },
          schema: {
            amount: { type: 'currency', currency: 'USD' },
          },
          strict: false,
        },
      );

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        success: true,
        normalized: {
          amount: {
            amount: 250.5,
          },
        },
      });
      expect(listGovernedSkillIntake()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'durableGovernedSkill',
            trustStatus: 'review-approved',
            executable: true,
            persistenceMode: 'restart-safe',
          }),
        ]),
      );
    } finally {
      setGovernedSkillStateStoreForTest(null);
      resetSkillRuntimeForTest();
    }
  });
});

describe('Local context wiring', () => {
  it('selects a broader dual-source knowledge context for reddit-helper', async () => {
    const { pickDocSnippets } = await import('../../agents/reddit-helper/src/index.ts');

    const snippets = pickDocSnippets(
      {
        id: 'knowledge-pack-context-1',
        generatedAt: '2026-03-08T10:00:00.000Z',
        docs: [
          {
            source: 'openclaw',
            path: 'docs/operators/reddit.md',
            summary: 'OpenClaw operator replies should stay concise, ask qualifying questions, and avoid implementation plans in public threads.',
            wordCount: 20,
            bytes: 180,
            firstHeading: 'Operator reply doctrine',
          },
          {
            source: 'openclaw',
            path: 'docs/runtime/knowledge-packs.md',
            summary: 'Knowledge packs are generated from local OpenClaw docs and mirrored cookbook sources for downstream responders.',
            wordCount: 18,
            bytes: 170,
            firstHeading: 'Knowledge packs',
          },
          {
            source: 'openclaw',
            path: 'docs/runtime/engagement-os.md',
            summary: 'The engagement doctrine tells responders to qualify first, scope second, and keep answers grounded in local context.',
            wordCount: 19,
            bytes: 176,
            firstHeading: 'Engagement OS',
          },
          {
            source: 'openai',
            path: 'cookbook/examples/retrieval.md',
            summary: 'Use retrieved local documentation to ground answers before asking a model to polish the final response.',
            wordCount: 18,
            bytes: 164,
            firstHeading: 'Retrieval grounding',
          },
          {
            source: 'openai',
            path: 'cookbook/examples/prompting.md',
            summary: 'Prompt construction should inject the most relevant local snippets instead of relying on generic answers.',
            wordCount: 17,
            bytes: 158,
            firstHeading: 'Prompt construction',
          },
          {
            source: 'openai',
            path: 'cookbook/examples/token-control.md',
            summary: 'Reduce model spend by ranking local context and limiting calls to the final synthesis step.',
            wordCount: 17,
            bytes: 152,
            firstHeading: 'Token control',
          },
        ],
      },
      {
        id: 'queue-1',
        subreddit: 'openclaw',
        question: 'How should reddit-helper use local docs and the cookbook before it drafts a reply?',
        matchedKeywords: ['knowledge', 'cookbook', 'reply'],
        selectedForDraft: true,
      },
    );

    expect(snippets.length).toBeGreaterThan(3);
    expect(snippets.some((entry) => entry.source === 'openclaw')).toBe(true);
    expect(snippets.some((entry) => entry.source === 'openai')).toBe(true);
    expect(
      snippets
        .filter((entry) => entry.source === 'openclaw')
        .map((entry) => entry.firstHeading),
    ).toEqual(
      expect.arrayContaining([
        'Operator reply doctrine',
        'Knowledge packs',
      ]),
    );
  });

  it('keeps targeted doc-specialist repairs dual-source', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'doc-specialist-pack-'));
    const sourceRoot = join(process.cwd(), '..', 'agents', 'doc-specialist');
    const sharedSourceRoot = join(process.cwd(), '..', 'agents', 'shared');
    const redditHelperConfigSourcePath = join(
      process.cwd(),
      '..',
      'agents',
      'reddit-helper',
      'agent.config.json',
    );
    const stagedRoot = join(fixtureRoot, 'doc-specialist');
    const stagedSharedRoot = join(fixtureRoot, 'shared');
    const stagedAgentsRoot = join(fixtureRoot, 'agents');
    const stagedRedditHelperRoot = join(stagedAgentsRoot, 'reddit-helper');
    const docsRoot = join(fixtureRoot, 'openclaw-docs');
    const cookbookRoot = join(fixtureRoot, 'openai-cookbook');
    const logsRoot = join(fixtureRoot, 'logs');
    const payloadPath = join(fixtureRoot, 'payload.json');
    const resultPath = join(fixtureRoot, 'result.json');
    const configPath = join(stagedRoot, 'agent.config.json');
    const tsxLoaderPath = join(
      process.cwd(),
      '..',
      'node_modules',
      'tsx',
      'dist',
      'loader.mjs',
    );

    try {
      await cp(sourceRoot, stagedRoot, { recursive: true });
      await cp(sharedSourceRoot, stagedSharedRoot, { recursive: true });
      await mkdir(stagedRedditHelperRoot, { recursive: true });
      await mkdir(docsRoot, { recursive: true });
      await mkdir(cookbookRoot, { recursive: true });
      await mkdir(logsRoot, { recursive: true });
      await copyFile(
        redditHelperConfigSourcePath,
        join(stagedRedditHelperRoot, 'agent.config.json'),
      );

      await writeFile(
        join(docsRoot, 'operators.md'),
        '# Operators\nOpenClaw operators use local docs to answer questions with grounded context.\n',
        'utf-8',
      );
      await writeFile(
        join(cookbookRoot, 'retrieval.md'),
        '# Retrieval\nThe cookbook mirror explains how to ground answers with local documentation before model synthesis.\n',
        'utf-8',
      );

      const config = JSON.parse(await readFile(configPath, 'utf-8'));
      config.docsPath = '../openclaw-docs';
      config.cookbookPath = '../openai-cookbook';
      config.knowledgePackDir = '../logs/knowledge-packs';
      config.agentsRootPath = '../agents';
      config.orchestratorConfigPath = '../orchestrator_config.json';
      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      await writeFile(
        payloadPath,
        JSON.stringify(
          {
            id: 'drift-repair-pack-1',
            docPaths: ['operators.md'],
            targetAgents: ['reddit-helper'],
            requestedBy: 'test',
          },
          null,
          2,
        ),
        'utf-8',
      );

      const execution = await new Promise<{ exitCode: number | null; stderr: string }>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['--import', tsxLoaderPath, 'src/index.ts', payloadPath],
          {
            cwd: stagedRoot,
            env: {
              ...process.env,
              ALLOW_ORCHESTRATOR_TASK_RUN: 'true',
              DOC_SPECIALIST_RESULT_FILE: resultPath,
            },
            stdio: ['ignore', 'ignore', 'pipe'],
          },
        );

        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => resolve({ exitCode: code, stderr }));
      });

      expect(execution.exitCode).toBe(0);

      const result = JSON.parse(await readFile(resultPath, 'utf-8'));
      const pack = JSON.parse(await readFile(result.packPath, 'utf-8'));
      expect(result.sourceBreakdown).toMatchObject({
        openclaw: 1,
        openai: 1,
      });
      expect(pack.taskShape.priorityContradictionIds).toBeTruthy();
      expect(pack.contradictionLedger[0]).toEqual(
        expect.objectContaining({
          entityId: expect.any(String),
          rankScore: expect.any(Number),
          freshnessWeight: expect.any(Number),
        }),
      );
      expect(pack.repairDrafts[0]).toEqual(
        expect.objectContaining({
          contradictionIds: expect.any(Array),
          sourceRails: expect.any(Array),
          verifierRequired: expect.any(Boolean),
          handoff: expect.objectContaining({
            recommendedTaskType: expect.any(String),
            payload: expect.objectContaining({
              targetAgentId: 'reddit-helper',
              contradictionIds: expect.any(Array),
            }),
          }),
        }),
      );
      expect(pack.taskSpecificKnowledge).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            targetAgentId: 'reddit-helper',
            primaryDocs: expect.arrayContaining([
              expect.stringContaining('operators.md'),
            ]),
            publicProofSignals: expect.any(Array),
            topologySignals: expect.arrayContaining([
              expect.stringMatching(/task-route:|service-state:|orchestrator-config:/),
            ]),
            freshnessSignals: expect.arrayContaining([
              expect.stringMatching(/config-audited:|doc:/),
            ]),
          }),
        ]),
      );
      expect(pack.topologyPacks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            targetAgentId: 'reddit-helper',
            routeTaskType: expect.any(String),
            environmentSignals: expect.arrayContaining([
              expect.stringMatching(/orchestrator-config:|state-file:|service-state:/),
            ]),
          }),
        ]),
      );
      expect(pack.targetBriefs[0]).toEqual(
        expect.objectContaining({
          knowledgeBundle: expect.objectContaining({
            primaryDocs: expect.any(Array),
            contradictionIds: expect.any(Array),
            topologySignals: expect.any(Array),
            freshnessSignals: expect.any(Array),
          }),
        }),
      );
      expect(pack.entityFreshnessLedger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entityId: expect.any(String),
            freshness: expect.stringMatching(/fresh|aging|stale|unknown/),
          }),
        ]),
      );
      expect(pack.contradictionGraph).toEqual(
        expect.objectContaining({
          entityCount: expect.any(Number),
          rankedContradictionCount: expect.any(Number),
        }),
      );
      expect(result.entityFreshnessLedger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entityId: expect.any(String),
          }),
        ]),
      );
      expect(result.contradictionGraph).toMatchObject({
        entityCount: expect.any(Number),
      });
      expect(result.operatorSummary).toContain('Knowledge pack');
      expect(result.recommendedNextActions).toEqual(
        expect.arrayContaining([expect.any(String)]),
      );
      expect(result.specialistContract).toMatchObject({
        role: 'Technical Writer',
        workflowStage: expect.stringMatching(/knowledge-pack-(watch|closure|escalation)/),
        status: expect.stringMatching(/watching|completed|escalate/),
      });
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe('Reddit helper token safety', () => {
  it('builds a scoped deterministic reddit draft without falling back to generic launch language', async () => {
    const { buildDeterministicDraft } = await import('../../agents/reddit-helper/src/index.ts');

    const draft = buildDeterministicDraft(
      {
        id: 'queue-draft-1',
        subreddit: 'openclaw',
        question: 'WSL keeps disconnecting while the orchestrator is healthy',
        matchedKeywords: ['wsl', 'orchestrator', 'disconnect'],
        selectedForDraft: true,
      },
      [
        {
          source: 'openclaw',
          path: 'docs/runtime/wsl.md',
          summary: 'WSL connection drops usually need the operator to isolate the failing runtime boundary before changing the whole stack.',
          wordCount: 18,
          bytes: 170,
          firstHeading: 'WSL runtime boundary',
        },
      ],
    );

    expect(draft).not.toMatch(/^Good question/i);
    expect(draft).toContain('WSL runtime boundary');
    expect(draft).toContain('Where do you see it first');
    expect(draft).not.toContain('live or pre-launch');
  });

  it('scores replies deterministically using doctrine and local context', async () => {
    const { scoreReplyQualityDeterministically } = await import(
      '../../agents/reddit-helper/src/index.ts'
    );

    const queue = {
      id: 'queue-score-1',
      subreddit: 'openclaw',
      question:
        'How should OpenClaw answer operator questions before proposing fixes?',
      matchedKeywords: ['operator', 'reply', 'openclaw'],
      selectedForDraft: true,
    };
    const docs = [
      {
        source: 'openclaw',
        path: 'docs/operators/reply.md',
        summary:
          'Ask a qualifying question, stay concise, and avoid implementation detail in public replies.',
        wordCount: 15,
        bytes: 120,
        firstHeading: 'Operator reply doctrine',
      },
      {
        source: 'openai',
        path: 'cookbook/examples/retrieval.md',
        summary:
          'Use retrieved local documentation before letting a model polish a response.',
        wordCount: 14,
        bytes: 112,
        firstHeading: 'Retrieval grounding',
      },
    ];
    const engagementOS = [
      'Ask a qualifying question before solutioning.',
      'Stay calm and authoritative.',
      'No more than 5 sentences.',
      'Do not solve or architect yet.',
    ].join(' ');

    const good = scoreReplyQualityDeterministically(
      'Good question. The main risk usually sits in operator reply doctrine. Is this live or pre-launch, and what do you control right now? Share that and I can narrow the cleanest path without guessing.',
      queue,
      docs,
      engagementOS,
    );
    const bad = scoreReplyQualityDeterministically(
      'You should implement a new orchestration layer, set up Redis immediately, then deploy this in several steps across the stack.',
      queue,
      docs,
      engagementOS,
    );

    expect(good.score).toBeGreaterThan(bad.score);
    expect(good.reasoning).toContain('asks qualifying question');
    expect(good.reasoning).toContain('uses local context');
    expect(bad.reasoning).toContain('premature solutioning');
  });

  it('clusters recurring confusion and flags internal-only reply boundaries', async () => {
    const {
      buildConfusionCluster,
      buildFaqCandidate,
      buildExplanationBoundary,
      buildReplyVerification,
      buildCommunitySignalRouting,
      buildProviderPosture,
    } = await import('../../agents/reddit-helper/src/index.ts');

    const queue = {
      id: 'queue-boundary-1',
      subreddit: 'openclaw',
      question: 'Should reddit-helper explain orchestrator_config.json and API_KEY handling in public?',
      matchedKeywords: ['orchestrator', 'api_key', 'public'],
      selectedForDraft: true,
    };
    const docs = [
      {
        source: 'openclaw',
        path: 'docs/operators/public-replies.md',
        summary: 'Public replies should stay grounded in docs and avoid exposing internal runtime detail.',
        wordCount: 14,
        bytes: 116,
        firstHeading: 'Public reply doctrine',
      },
      {
        source: 'openai',
        path: 'cookbook/examples/retrieval.md',
        summary: 'Ground public-facing responses in retrieved context and keep internal operational detail out of the final reply.',
        wordCount: 18,
        bytes: 150,
        firstHeading: 'Retrieved context',
      },
    ];
    const cluster = buildConfusionCluster(queue, docs);
    const faq = buildFaqCandidate({ cluster, queue, docs });
    const boundary = buildExplanationBoundary(
      'You should inspect orchestrator_config.json and rotate API_KEY values in the reply.',
    );
    const verification = buildReplyVerification({
      replyText:
        'Can you clarify whether you need a public explanation or internal operator guidance before we go further?',
      queue,
      docs,
      engagementOS:
        'Ask a qualifying question before solutioning. Stay concise. Keep answers grounded in local context.',
      explanationBoundary: boundary,
    });
    const providerPosture = buildProviderPosture({
      usedLlm: false,
      reasoning: 'provider unavailable or rate limited; using deterministic draft',
      explanationBoundary: boundary,
      serviceState: {
        consecutiveFailures: 2,
        backoffUntil: '2026-03-16T10:30:00.000Z',
      },
    });

    expect(cluster).toEqual(
      expect.objectContaining({
        clusterId: expect.stringContaining('openclaw:'),
        matchedTerms: expect.arrayContaining(['orchestrator', 'api_key']),
      }),
    );
    expect(faq).toEqual(
      expect.objectContaining({
        targetAgentId: 'doc-specialist',
      }),
    );
    expect(boundary).toEqual(
      expect.objectContaining({
        status: 'internal-only-review',
      }),
    );
    expect(verification).toEqual(
      expect.objectContaining({
        requiresReview: true,
        doctrineApplied: expect.arrayContaining(['qualifying-question', 'local-context-grounded']),
      }),
    );
    expect(providerPosture).toEqual(
      expect.objectContaining({
        mode: 'provider-backoff-fallback',
        reviewRecommended: true,
        queuePressureStatus: 'provider-backoff',
        consecutiveFailures: 2,
      }),
    );
    const communitySignalRouting = buildCommunitySignalRouting({
      cluster,
      faqCandidate: faq,
      replyVerification: verification,
      providerPosture,
    });
    expect(communitySignalRouting).toEqual(
      expect.objectContaining({
        systematic: true,
        handoffs: expect.arrayContaining([
          expect.objectContaining({
            targetAgentId: 'doc-specialist',
            surface: 'docs',
          }),
          expect.objectContaining({
            surface: 'faq',
          }),
          expect.objectContaining({
            targetAgentId: 'content-agent',
            surface: 'proof',
          }),
        ]),
      }),
    );
  });

  it('flags reddit knowledge freshness when docs are newer than the latest pack', async () => {
    const { inspectKnowledgeFreshness, buildRedditSpecialistFields } = await import(
      '../../agents/reddit-helper/src/index.ts'
    );
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'reddit-freshness-'));
    const docsRoot = join(fixtureRoot, 'openclaw-docs');
    const packPath = join(fixtureRoot, 'knowledge-pack.json');

    await mkdir(docsRoot, { recursive: true });
    await writeFile(join(docsRoot, 'memory.md'), '# updated docs mirror\n', 'utf-8');
    await writeFile(
      packPath,
      JSON.stringify({
        id: 'pack-1',
        generatedAt: '2026-03-11T08:00:00.000Z',
        docs: [],
      }),
      'utf-8',
    );

    const freshness = await inspectKnowledgeFreshness({
      pack: {
        id: 'pack-1',
        generatedAt: '2026-03-11T08:00:00.000Z',
        docs: [],
      },
      packPath,
      docsPath: docsRoot,
      now: new Date('2026-03-11T10:00:00.000Z'),
    });

    const specialist = buildRedditSpecialistFields({
      queue: {
        id: 'queue-freshness-1',
        subreddit: 'openclaw',
        question: 'How should reddit-helper explain docs drift safely?',
        selectedForDraft: true,
      },
      draftMode: 'local-only',
      confidence: 0.72,
      replyVerification: {
        doctrineApplied: ['local-context-grounded'],
        anchorCount: 1,
        requiresReview: false,
        reasoning: 'Grounded in local docs',
      },
      providerPosture: {
        mode: 'local-only',
        reason: 'Using deterministic local draft',
        llmEligible: false,
        reviewRecommended: false,
        fallbackIntegrity: 'retained-local-doctrine',
        queuePressureStatus: 'nominal',
        backoffUntil: null,
        consecutiveFailures: 0,
      },
      explanationBoundary: {
        status: 'public-safe',
        reasons: [],
      },
      communitySignalRouting: {
        handoffs: [],
        systematic: false,
      },
      knowledgeFreshness: freshness,
    });

    expect(freshness).toEqual(
      expect.objectContaining({
        status: 'docs-ahead-of-pack',
        reviewRecommended: true,
      }),
    );
    expect(freshness.warnings[0]).toMatch(/Run drift-repair/i);
    expect(specialist.specialistContract?.status).toBe('watching');
    expect(specialist.recommendedNextActions).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Refresh the managed knowledge mirror through drift-repair/i),
      ]),
    );
  });

  it('dedupes processed drafts and enforces max jobs per cycle', async () => {
    const { selectEligibleDrafts } = await import(
      '../../agents/reddit-helper/src/service.ts'
    );

    const eligible = selectEligibleDrafts(
      [
        {
          draftId: 'draft-1',
          queuedAt: '2026-03-08T10:00:00.000Z',
        },
        {
          draftId: 'draft-2',
          queuedAt: '2026-03-08T10:05:00.000Z',
        },
        {
          draftId: 'draft-3',
          queuedAt: '2026-03-08T10:10:00.000Z',
        },
        {
          draftId: 'draft-4',
          queuedAt: '2026-03-08T10:15:00.000Z',
        },
      ] as any,
      {
        processedIds: ['draft-2'],
      },
      2,
    );

    expect(eligible.map((draft: { draftId: string }) => draft.draftId)).toEqual([
      'draft-1',
      'draft-3',
    ]);
  });

  it('falls back locally when the llm budget is exhausted before provider access', async () => {
    const budgetDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const execution = await runRedditHelperTaskFixture({
      serviceState: {
        budgetDate,
        llmCallsToday: 1,
        tokensToday: 0,
        processedIds: [],
      },
      env: {
        REDDIT_HELPER_MAX_LLM_CALLS_PER_DAY: '1',
        REDDIT_HELPER_MAX_TOKENS_PER_DAY: '12000',
        REDDIT_HELPER_BUDGET_RESET_TZ: 'UTC',
        OPENAI_API_KEY: '',
      },
    });

    expect(execution.exitCode).toBe(0);
    expect(execution.result.draftMode).toBe('local-only');
    expect(execution.result.reasoning).toContain('daily llm call budget exhausted');
    expect(execution.result.qualityScore).toBeGreaterThan(0);
    expect(execution.result.communitySignalRouting).toMatchObject({
      systematic: true,
    });
    expect(execution.result.operatorSummary).toContain('local-only reddit draft');
    expect(execution.result.specialistContract).toMatchObject({
      role: 'Reddit Community Builder',
      workflowStage: 'community-review',
      status: 'watching',
    });
    expect(execution.persistedServiceState.budgetStatus).toBe('exhausted');
    expect(execution.persistedServiceState.llmCallsToday).toBe(1);
    expect(execution.draftLog).toContain('"stage":"agent-local-fallback"');
  });

  it('uses the hybrid-polished provider branch when the LLM path succeeds', async () => {
    const execution = await runRedditHelperTaskFixture({
      env: {
        OPENAI_API_KEY: 'test-openai-key',
      },
      providerMock: {
        replyText:
          'Good question. OpenClaw Operator keeps the first reply bounded and grounded in local docs before it goes broader. Is this for a live operator lane or a pre-launch workflow, and what part do you control right now? Share that and I can narrow the cleanest next step without guessing.',
        totalTokens: 92,
      },
    });

    expect(execution.exitCode).toBe(0);
    expect(execution.result.draftMode).toBe('hybrid-polished');
    expect(execution.result.reasoning).toContain(
      'draft polished with local-context-guided LLM pass',
    );
    expect(execution.result.providerPosture).toMatchObject({
      mode: 'hybrid-polished',
      llmEligible: true,
      reviewRecommended: false,
      fallbackIntegrity: 'retained-local-doctrine',
      queuePressureStatus: 'nominal',
    });
    expect(execution.result.replyVerification).toMatchObject({
      requiresReview: false,
    });
    expect(execution.result.recommendedNextActions?.length).toBeGreaterThan(0);
    expect(execution.result.specialistContract).toMatchObject({
      role: 'Reddit Community Builder',
      workflowStage: 'community-review',
      status: 'watching',
    });
    expect(execution.persistedServiceState.llmCallsToday).toBe(1);
    expect(execution.persistedServiceState.tokensToday).toBe(92);
    expect(execution.draftLog).toContain('"stage":"agent-hybrid-polished"');
  });

  it('parses host systemd unit states for installed and missing services', async () => {
    const {
      buildHostSystemctlShowArgs,
      parseSystemctlShowOutput,
      resolveServiceInstalledState,
      resolveServiceRunningState,
    } = await loadOrchestratorIndexHelpers();

    expect(buildHostSystemctlShowArgs(['reddit-helper.service'])).toEqual([
      '--user',
      'show',
      'reddit-helper.service',
      '--property=Id,LoadState,ActiveState,SubState,UnitFileState',
      '--no-pager',
    ]);

    const states = parseSystemctlShowOutput(
      [
        'Id=doc-specialist.service',
        'LoadState=not-found',
        'ActiveState=inactive',
        'SubState=dead',
        'UnitFileState=',
        '',
        'Id=reddit-helper.service',
        'LoadState=loaded',
        'ActiveState=active',
        'SubState=running',
        'UnitFileState=enabled',
      ].join('\n'),
    );

    const missingState = states.get('doc-specialist.service');
    const activeState = states.get('reddit-helper.service');

    expect(resolveServiceInstalledState(missingState)).toBe(false);
    expect(resolveServiceRunningState(missingState)).toBe(false);
    expect(resolveServiceInstalledState(activeState)).toBe(true);
    expect(resolveServiceRunningState(activeState)).toBe(true);
  });

  it('treats only explicit persistent agents as requiring service mode', async () => {
    const { isServiceModeExpected } = await loadOrchestratorIndexHelpers();

    expect(isServiceModeExpected('doc-specialist')).toBe(true);
    expect(isServiceModeExpected('reddit-helper')).toBe(true);
    expect(isServiceModeExpected('build-refactor-agent')).toBe(false);
    expect(isServiceModeExpected('system-monitor-agent')).toBe(false);
  });

  it('derives explicit lifecycle mode and host service status for operators', async () => {
    const { resolveAgentLifecycleMode, resolveHostServiceStatus } =
      await loadOrchestratorIndexHelpers();

    expect(resolveAgentLifecycleMode('doc-specialist')).toBe('service-expected');
    expect(resolveAgentLifecycleMode('build-refactor-agent')).toBe('worker-first');

    expect(
      resolveHostServiceStatus({
        serviceExpected: true,
        serviceAvailable: true,
        serviceInstalled: true,
        serviceRunning: true,
      }),
    ).toBe('running');
    expect(
      resolveHostServiceStatus({
        serviceExpected: true,
        serviceAvailable: true,
        serviceInstalled: true,
        serviceRunning: false,
      }),
    ).toBe('installed-stopped');
    expect(
      resolveHostServiceStatus({
        serviceExpected: true,
        serviceAvailable: true,
        serviceInstalled: false,
        serviceRunning: false,
      }),
    ).toBe('not-installed');
    expect(
      resolveHostServiceStatus({
        serviceExpected: true,
        serviceAvailable: false,
        serviceInstalled: null,
        serviceRunning: null,
      }),
    ).toBe('missing-entrypoint');
    expect(
      resolveHostServiceStatus({
        serviceExpected: true,
        serviceAvailable: true,
        serviceInstalled: null,
        serviceRunning: null,
      }),
    ).toBe('probe-unavailable');
    expect(
      resolveHostServiceStatus({
        serviceExpected: false,
        serviceAvailable: true,
        serviceInstalled: null,
        serviceRunning: null,
      }),
    ).toBe('not-applicable');
  });

  it('uses real public proof evidence for system-monitor readiness', async () => {
    const { buildAgentCapabilityReadiness } = await loadOrchestratorIndexHelpers();
    const state = createDefaultState();

    state.taskExecutions.push({
      taskId: 'task-monitor-1',
      idempotencyKey: 'run-monitor-1',
      type: 'system-monitor',
      status: 'success',
      lastHandledAt: '2026-03-16T08:03:00.000Z',
    });
    state.workflowEvents.push({
      eventId: 'evt-proof-1',
      runId: 'run-monitor-1',
      stage: 'proof',
      state: 'success',
      timestamp: '2026-03-16T08:01:00.000Z',
      proofTransport: 'milestone',
    });
    state.taskRetryRecoveries.push({
      idempotencyKey: 'retry-monitor-1',
      retryAt: '2026-03-16T09:00:00.000Z',
    });
    state.relationshipObservations.push({
      observationId: 'obs-monitor-1',
      timestamp: '2026-03-16T08:02:00.000Z',
      from: 'agent:system-monitor-agent',
      to: 'agent:security-agent',
      relationship: 'monitors-agent',
      status: 'observed',
      source: 'test',
    });
    state.relationshipObservations.push({
      observationId: 'obs-proof-1',
      timestamp: '2026-03-16T08:02:30.000Z',
      from: 'task:system-monitor',
      to: 'workflow-proof:milestone',
      relationship: 'publishes-proof',
      status: 'observed',
      source: 'test',
      proofTransport: 'milestone',
    });

    const capability = buildAgentCapabilityReadiness({
      agent: {
        id: 'system-monitor-agent',
        model: { tier: 'balanced' },
        permissions: { skills: { documentParser: { allowed: true } } },
      },
      orchestratorTask: 'system-monitor',
      spawnedWorkerCapable: true,
      serviceAvailable: true,
      serviceExpected: false,
      serviceInstalled: null,
      serviceRunning: null,
      memory: {
        lastRunAt: '2026-03-16T08:03:00.000Z',
        totalRuns: 1,
        successCount: 1,
      },
      workerEvidence: {
        workerValidationStatus: 'confirmed-worker',
        lastEvidenceAt: '2026-03-16T08:03:00.000Z',
        evidenceSources: ['task-run-success', 'toolgate-execute'],
        lastSuccessfulRunId: 'run-monitor-1',
        lastSuccessfulTaskId: 'task-monitor-1',
        lastToolGateMode: 'execute',
        lastToolGateSkillId: 'documentParser',
        lastToolGateAt: '2026-03-16T08:03:00.000Z',
      },
      state,
      support: {
        latestExecutionByType: new Map([['system-monitor', state.taskExecutions[0]!]]),
        successfulExecutionCountByType: new Map([['system-monitor', 1]]),
        latestSuccessfulExecutionByType: new Map([['system-monitor', state.taskExecutions[0]!]]),
        latestToolInvocationByAgent: new Map(),
        latestAllowedPreflightByAgent: new Map(),
        latestAllowedExecuteByAgent: new Map(),
        relationshipCountByAgentAndType: new Map([
          ['agent:system-monitor-agent|monitors-agent', 1],
        ]),
        verifiedRepairCountByTaskType: new Map(),
        proofSignalCount: 2,
        integrationWorkflowAgentStageCount: 0,
        governedSkillCounts: {
          total: 0,
          pendingReview: 0,
          restartSafe: 0,
          metadataOnly: 0,
        },
      },
      runtimeProof: {
        serviceHeartbeat: {
          checkedAt: '2026-03-16T08:03:00.000Z',
          status: 'ok',
          errorSummary: null,
          source: 'task-runner',
          staleAgeMs: 0,
        },
        taskPath: {
          taskType: 'system-monitor',
          lastObservedAt: '2026-03-16T08:03:00.000Z',
          lastObservedStatus: 'success',
          lastSuccessfulAt: '2026-03-16T08:03:00.000Z',
          totalRuns: 1,
          successfulRuns: 1,
          failedRuns: 0,
          activeRuns: 0,
          lastError: null,
        },
        distinctions: {
          serviceAlive: false,
          serviceHeartbeatHealthy: true,
          serviceAvailable: true,
          serviceExpected: false,
          serviceInstalled: null,
          workerInvocable: true,
          taskObserved: true,
          taskSucceeded: true,
          toolExecutionProved: true,
          verifierOrRepairEvidence: false,
        },
      },
    });

    const profile = capability.evidenceProfiles.find(
      (entry) => entry.area === 'trust-spine-depth',
    );

    expect(profile?.status).toBe('strong');
    expect(profile?.evidence).toContain('public-proof evidence records: 2');
  });

  it('promotes durable task-path and relationship evidence into readiness when ledger success is stale', async () => {
    const { buildAgentCapabilityReadiness } = await loadOrchestratorIndexHelpers();
    const state = createDefaultState();

    state.relationshipObservations.push({
      observationId: 'obs-build-tool-1',
      timestamp: '2026-03-20T08:00:00.000Z',
      from: 'agent:build-refactor-agent',
      to: 'tool:workspacePatch',
      relationship: 'invokes-tool',
      status: 'observed',
      source: 'test',
    });
    state.relationshipObservations.push({
      observationId: 'obs-build-feed-1',
      timestamp: '2026-03-20T08:01:00.000Z',
      from: 'agent:build-refactor-agent',
      to: 'agent:qa-verification-agent',
      relationship: 'feeds-agent',
      status: 'observed',
      source: 'test',
    });

    const capability = buildAgentCapabilityReadiness({
      agent: {
        id: 'build-refactor-agent',
        model: { tier: 'balanced' },
        permissions: { skills: { workspacePatch: { allowed: true } } },
      },
      orchestratorTask: 'build-refactor',
      spawnedWorkerCapable: true,
      serviceAvailable: false,
      serviceExpected: false,
      serviceInstalled: null,
      serviceRunning: null,
      memory: {
        lastRunAt: '2026-03-20T08:02:00.000Z',
        totalRuns: 1,
        successCount: 1,
        taskPath: {
          taskType: 'build-refactor',
          lastObservedAt: '2026-03-20T08:02:00.000Z',
          lastObservedStatus: 'success',
          lastSuccessfulAt: '2026-03-20T08:02:00.000Z',
          totalRuns: 1,
          successfulRuns: 1,
          failedRuns: 0,
          activeRuns: 0,
        },
      },
      workerEvidence: {
        workerValidationStatus: 'confirmed-worker',
        lastEvidenceAt: '2026-03-20T08:02:00.000Z',
        evidenceSources: ['task-path-success', 'agent-memory-success'],
        lastSuccessfulRunId: null,
        lastSuccessfulTaskId: null,
        lastToolGateMode: null,
        lastToolGateSkillId: null,
        lastToolGateAt: null,
      },
      state,
      support: {
        latestExecutionByType: new Map(),
        successfulExecutionCountByType: new Map([['build-refactor', 1]]),
        latestSuccessfulExecutionByType: new Map(),
        latestToolInvocationByAgent: new Map(),
        latestAllowedPreflightByAgent: new Map(),
        latestAllowedExecuteByAgent: new Map(),
        relationshipCountByAgentAndType: new Map([
          ['agent:build-refactor-agent|invokes-tool', 1],
          ['agent:build-refactor-agent|feeds-agent', 1],
        ]),
        verifiedRepairCountByTaskType: new Map(),
        proofSignalCount: 0,
        integrationWorkflowAgentStageCount: 0,
        governedSkillCounts: {
          total: 0,
          pendingReview: 0,
          restartSafe: 0,
          metadataOnly: 0,
        },
      },
      runtimeProof: {
        serviceHeartbeat: {
          checkedAt: '2026-03-20T08:02:00.000Z',
          status: 'success',
          errorSummary: null,
          source: 'task-runner',
          staleAgeMs: 0,
        },
        taskPath: {
          taskType: 'build-refactor',
          lastObservedAt: '2026-03-20T08:02:00.000Z',
          lastObservedStatus: 'success',
          lastSuccessfulAt: '2026-03-20T08:02:00.000Z',
          totalRuns: 1,
          successfulRuns: 1,
          failedRuns: 0,
          activeRuns: 0,
          lastError: null,
        },
        distinctions: {
          serviceAlive: false,
          serviceHeartbeatHealthy: false,
          serviceAvailable: false,
          serviceExpected: false,
          serviceInstalled: null,
          workerInvocable: true,
          taskObserved: true,
          taskSucceeded: true,
          toolExecutionProved: false,
          verifierOrRepairEvidence: false,
        },
      },
      runtimeEvidence: {
        latestSuccessfulRunId: null,
        latestSuccessfulTaskId: null,
        latestHandledAt: null,
        highlightKeys: [],
        signals: [],
      },
    });

    expect(capability.currentReadiness).toBe('advanced');
    expect(capability.presentCapabilities).toContain('successful runtime evidence');
    expect(capability.presentCapabilities).toContain('tool execution evidence');
    expect(capability.presentCapabilities).toContain('verification or repair evidence');
    expect(capability.evidence).toContain('successful task-path proof exists in runtime memory');
    expect(capability.evidence).toContain('1 observed tool invocation relationship(s) recorded');
    expect(capability.evidence).toContain('1 downstream handoff relationship(s) observed');
  });

  it('promotes security-agent runtime memory highlights when execution summaries only exist in agent memory', async () => {
    const {
      buildAgentCapabilityReadiness,
      buildAgentCapabilityRuntimeEvidence,
    } = await loadOrchestratorIndexHelpers();
    const state = createDefaultState();

    const memory = {
      lastRunAt: '2026-03-29T10:39:00.296Z',
      lastStatus: 'ok',
      lastTaskId: 'task-security-memory-1',
      totalRuns: 3,
      successCount: 3,
      taskPath: {
        taskType: 'security-audit',
        lastObservedAt: '2026-03-29T10:39:00.296Z',
        lastObservedStatus: 'success',
        lastSuccessfulAt: '2026-03-29T10:39:00.296Z',
        totalRuns: 3,
        successfulRuns: 3,
        failedRuns: 0,
        activeRuns: 0,
      },
      taskTimeline: [
        {
          taskId: 'task-security-memory-1',
          taskType: 'security-audit',
          status: 'success',
          startedAt: '2026-03-29T10:38:58.122Z',
          completedAt: '2026-03-29T10:39:00.296Z',
          resultSummary: {
            success: true,
            keys: [
              'regressionReview',
              'trustBoundaryHistory',
              'permissionDriftTimeline',
              'routeBoundaryWatch',
              'remediationDepth',
              'exploitabilityRanking',
              'remediationClosure',
            ],
            highlights: {
              regressionReview: {
                status: 'watching',
                permissionDriftCount: 2,
                recurringBoundaryCount: 1,
                rollbackReadyFixCount: 1,
              },
              trustBoundaryHistory: {
                count: 1,
                sample: [
                  {
                    incidentId: 'incident-security-1',
                    severity: 'high',
                    status: 'recurring',
                    owner: 'security-agent',
                    summary: 'Route-boundary regression detected.',
                    lastSeenAt: '2026-03-29T10:37:00.000Z',
                  },
                ],
              },
              permissionDriftTimeline: {
                count: 1,
                sample: [
                  {
                    timestamp: '2026-03-29T10:36:00.000Z',
                    summary: 'Permission drift detected in auth surface.',
                    status: 'watching',
                    evidence: {
                      count: 2,
                      sample: ['route:/api/auth/me', 'policy:auth'],
                    },
                  },
                ],
              },
              routeBoundaryWatch: {
                unprotectedRouteCount: 1,
                authFindingCount: 1,
                recurringAuthIncidents: 1,
                status: 'watching',
              },
              remediationDepth: {
                status: 'rollback-sensitive',
                ownerlessPriorityCount: 0,
                rollbackSensitiveFixCount: 1,
                trustBoundaryFixCount: 1,
                criticalPriorityCount: 1,
              },
              exploitabilityRanking: {
                count: 1,
                sample: [
                  {
                    location: 'orchestrator/src/index.ts',
                    combinedScore: 9.1,
                  },
                ],
              },
              remediationClosure: {
                status: 'verification-required',
                highRiskCount: 1,
                ownerlessPriorityCount: 0,
                verifierRecommended: true,
              },
            },
          },
        },
      ],
      lastResultSummary: {
        success: true,
        keys: ['regressionReview', 'remediationClosure'],
        highlights: {
          regressionReview: {
            status: 'watching',
            permissionDriftCount: 2,
            recurringBoundaryCount: 1,
            rollbackReadyFixCount: 1,
          },
          remediationClosure: {
            status: 'verification-required',
            highRiskCount: 1,
            ownerlessPriorityCount: 0,
            verifierRecommended: true,
          },
        },
      },
    };

    const support = {
      latestExecutionByType: new Map(),
      successfulExecutionCountByType: new Map(),
      latestSuccessfulExecutionByType: new Map(),
      latestToolInvocationByAgent: new Map(),
      latestAllowedPreflightByAgent: new Map(),
      latestAllowedExecuteByAgent: new Map(),
      relationshipCountByAgentAndType: new Map([
        ['agent:security-agent|invokes-tool', 1],
        ['agent:security-agent|audits-agent', 1],
      ]),
      verifiedRepairCountByTaskType: new Map(),
      proofSignalCount: 0,
      integrationWorkflowAgentStageCount: 0,
      governedSkillCounts: {
        total: 0,
        pendingReview: 0,
        restartSafe: 0,
        metadataOnly: 0,
      },
    };

    const runtimeEvidence = buildAgentCapabilityRuntimeEvidence({
      agentId: 'security-agent',
      orchestratorTask: 'security-audit',
      support,
      memory,
    });

    const capability = buildAgentCapabilityReadiness({
      agent: {
        id: 'security-agent',
        model: { tier: 'balanced' },
        permissions: { skills: { documentParser: { allowed: true } } },
      },
      orchestratorTask: 'security-audit',
      spawnedWorkerCapable: true,
      serviceAvailable: true,
      serviceExpected: false,
      serviceInstalled: null,
      serviceRunning: null,
      memory,
      workerEvidence: {
        workerValidationStatus: 'confirmed-worker',
        lastEvidenceAt: '2026-03-29T10:39:00.296Z',
        evidenceSources: ['task-path-success', 'agent-memory-success'],
        lastSuccessfulRunId: null,
        lastSuccessfulTaskId: null,
        lastToolGateMode: null,
        lastToolGateSkillId: null,
        lastToolGateAt: null,
      },
      state,
      support,
      runtimeProof: {
        serviceHeartbeat: {
          checkedAt: '2026-03-29T10:39:00.296Z',
          status: 'ok',
          errorSummary: null,
          source: 'service-loop',
          staleAgeMs: 0,
        },
        taskPath: {
          taskType: 'security-audit',
          lastObservedAt: '2026-03-29T10:39:00.296Z',
          lastObservedStatus: 'success',
          lastSuccessfulAt: '2026-03-29T10:39:00.296Z',
          totalRuns: 3,
          successfulRuns: 3,
          failedRuns: 0,
          activeRuns: 0,
          lastError: null,
        },
        distinctions: {
          serviceAlive: false,
          serviceHeartbeatHealthy: true,
          serviceAvailable: true,
          serviceExpected: false,
          serviceInstalled: null,
          workerInvocable: true,
          taskObserved: true,
          taskSucceeded: true,
          toolExecutionProved: false,
          verifierOrRepairEvidence: false,
        },
      },
      runtimeEvidence,
    });

    expect(runtimeEvidence.latestSuccessfulRunId).toBe('task-security-memory-1');
    expect(runtimeEvidence.latestSuccessfulTaskId).toBe('task-security-memory-1');
    expect(runtimeEvidence.highlightKeys).toContain('regressionReview');
    expect(runtimeEvidence.highlightKeys).toContain('remediationClosure');
    expect(
      runtimeEvidence.signals.find((signal) => signal.key === 'regressionReview')?.summary,
    ).toBeTruthy();
    expect(capability.presentCapabilities).toContain('verification or repair evidence');
    expect(capability.presentCapabilities).toContain('promoted runtime readiness evidence');
    expect(capability.missingCapabilities).not.toContain('verification or repair evidence');
    expect(capability.missingCapabilities).not.toContain('promoted runtime readiness evidence');
  });
});
