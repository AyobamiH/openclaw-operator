import { getExecuteSkill } from "../../shared/governed-readers.js";
import * as fs from 'fs';
import * as path from 'path';
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { buildSpecialistOperatorFields } from '../../shared/runtime-evidence.js';

/**
 * BUILD & REFACTOR AGENT
 *
 * Two modes exist today:
 * - explicit patch execution: real bounded file edits via workspacePatch, plus
 *   optional real whitelisted verification via testRunner
 * - autonomous synthesis: bounded repository codemods synthesized from real
 *   scope evidence for approval/remediation lanes
 */

interface AgentConfig {
  id: string;
  name: string;
  model: string;
  permissions: {
    skills: Record<string, { allowed: boolean }>;
    network: { allowed: boolean };
  };
}

type ExecuteSkillFn = (
  skillId: string,
  input: any,
  requestingAgent?: string,
) => Promise<any>;

type WorkspacePatchChangeType = 'replace' | 'append' | 'prepend' | 'delete';

interface RefactoringChange {
  file: string;
  operation: WorkspacePatchChangeType;
  oldText?: string;
  newText?: string;
  rationale?: string;
  testsAffected?: number;
  metrics?: Record<string, any>;
}

interface RefactoringTask {
  id: string;
  type: 'refactor' | 'scan_security' | 'optimize_performance' | 'deduplicate' | 'modernize';
  scope: string;
  intent?: string;
  incidentClassification?: string;
  affectedSurfaces?: string[];
  changes?: RefactoringChange[];
  testCommand?: string;
  constraints?: {
    maxFilesChanged?: number;
    requiresApproval?: boolean;
    runTests?: boolean;
    linkedRepairId?: string;
    linkedIncidentId?: string;
    verificationMode?: 'advisory' | 'qa-verification';
  };
}

interface RefactoringResult {
  success: boolean;
  task: string;
  changes: Array<{
    file: string;
    type: string;
    diff?: string;
    rationale?: string;
    metrics?: Record<string, any>;
    testsAffected?: number;
    rollbackPlan?: string;
    verificationPlan?: string;
  }>;
  summary: {
    filesChanged: number;
    linesChanged: number;
    improvementDescription: string;
    testsPass: boolean;
    confidence: number;
  };
  requiresApproval: boolean;
  dryRunUrl?: string;
  rollbackPlan?: string[];
  verificationPlan?: string[];
  scopeContract?: {
    scopeType: 'broad' | 'bounded';
    bounded: boolean;
    estimatedTouchedFiles: number;
    requestedMaxFilesChanged: number | null;
    refusalReasons: string[];
  };
  surgeryProfile?: {
    changeType: RefactoringTask['type'];
    affectedSurfaces: string[];
    qaVerificationRequired: boolean;
    rollbackSensitive: boolean;
    repairLinked: boolean;
    operatorReviewReason: string;
  };
  verificationLoop?: {
    mode: 'standard' | 'repair-linked';
    linkedRepairId: string | null;
    linkedIncidentId: string | null;
    requiresVerifier: boolean;
    postEditSteps: string[];
  };
  impactEnvelope?: {
    estimatedTouchedFiles: number;
    multiStepEdit: boolean;
    runtimeSensitivePaths: string[];
    rollbackWindow: 'tight' | 'standard';
    verificationDepth: 'verifier-backed' | 'targeted' | 'advisory';
    incidentFamilies: string[];
  };
  refusalProfile?: {
    refused: boolean;
    confidence: number;
    reasons: string[];
    approvalRequired: boolean;
    narrowScopeSuggested: boolean;
    suggestedMaxFilesChanged: number | null;
  };
  relationships?: Array<{
    from: string;
    to: string;
    relationship: 'feeds-agent';
    detail: string;
    evidence: string[];
    classification: 'verification-handoff';
  }>;
  toolInvocations?: Array<{
    toolId: 'workspacePatch' | 'testRunner';
    detail: string;
    evidence: string[];
    classification: 'required' | 'optional';
  }>;
  operatorSummary?: string;
  recommendedNextActions?: string[];
  specialistContract?: {
    role: string;
    workflowStage: string;
    deliverable: string;
    status: 'completed' | 'watching' | 'blocked' | 'escalate' | 'refused';
    operatorSummary: string;
    recommendedNextActions: string[];
    refusalReason: string | null;
    escalationReason: string | null;
  };
  executionTime: number;
}

type ExplicitExecutionResult = {
  appliedChanges: RefactoringResult['changes'];
  filesChanged: number;
  linesChanged: number;
  testsPass: boolean;
  confidence: number;
  improvementDescription: string;
  executedTestCommand: string | null;
  failureReason: string | null;
};

type ScopeFile = {
  relativePath: string;
  absolutePath: string;
  content: string;
};

type AutonomousCandidate = {
  id: string;
  title: string;
  description: string;
  confidence: number;
  evidence: string[];
  changes: RefactoringChange[];
};

type AutonomousSynthesisResult = {
  changes: RefactoringChange[];
  improvementDescription: string;
  confidence: number;
  evidence: string[];
  failureReason: string | null;
  satisfiedWithoutChanges?: boolean;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../..');
const DEFAULT_TEST_COMMAND = 'build-verify';
const AUTONOMOUS_TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
]);
const AUTONOMOUS_SCAN_LIMIT = 48;
const AUTONOMOUS_PATCH_LIMIT = 12;

const PUBLIC_PROOF_ACTIVE_LANES_LEGACY_SNIPPET = `  const activeLanes = dedupeStrings(
    milestones
      .filter((event) => event.riskStatus !== "completed")
      .map((event) => event.scope),
  ).slice(0, 8);`;

const PUBLIC_PROOF_ACTIVE_LANES_HELPER = `function prioritizePublicProofActiveLanes(lanes: string[], limit: number = 8) {
  const deduped = dedupeStrings(lanes, Math.max(limit * 4, 16));
  const priorityLanes = ["demand-runtime"];
  return [
    ...priorityLanes.filter((lane) => deduped.includes(lane)),
    ...deduped.filter((lane) => !priorityLanes.includes(lane)),
  ].slice(0, limit);
}`;

const PUBLIC_PROOF_ACTIVE_LANES_NEXT_SNIPPET = `  const activeLanes = prioritizePublicProofActiveLanes(
    milestones
      .filter((event) => event.riskStatus !== "completed")
      .map((event) => event.scope),
  );`;

function isBroadScope(scope: string) {
  const normalized = String(scope ?? '').trim();
  return normalized === 'workspace' || normalized === '.' || normalized === './';
}

function normalizeRelativePath(targetPath: string) {
  const normalized = targetPath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .trim();
  if (!normalized || normalized.includes('..')) {
    throw new Error(`Refusing unsafe workspace path "${targetPath}"`);
  }
  return normalized;
}

function pathWithinScope(scope: string, filePath: string) {
  if (isBroadScope(scope)) {
    return true;
  }

  const normalizedScope = normalizeRelativePath(String(scope ?? 'src'));
  const normalizedFile = normalizeRelativePath(filePath);
  if (normalizedScope === normalizedFile) {
    return true;
  }

  const scopeLooksFile = /\.[A-Za-z0-9]+$/.test(path.posix.basename(normalizedScope));
  if (scopeLooksFile) {
    return false;
  }

  return normalizedFile.startsWith(`${normalizedScope}/`);
}

function countChangedLines(diff: string | undefined) {
  if (!diff) return 0;
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') || line.startsWith('-'))
    .filter((line) => !line.startsWith('+++') && !line.startsWith('---'))
    .length;
}

function buildScopeContract(task: RefactoringTask, estimatedTouchedFiles: number) {
  const scopeBroad = isBroadScope(task.scope);
  const refusalReasons: string[] = [];
  if (scopeBroad && !task.constraints?.maxFilesChanged && !(task.changes?.length)) {
    refusalReasons.push('broad scope requires explicit maxFilesChanged bound');
  }
  return {
    scopeType: scopeBroad ? 'broad' as const : 'bounded' as const,
    bounded:
      !scopeBroad ||
      typeof task.constraints?.maxFilesChanged === 'number' ||
      Boolean(task.changes?.length),
    estimatedTouchedFiles,
    requestedMaxFilesChanged: task.constraints?.maxFilesChanged ?? null,
    refusalReasons,
  };
}

function buildSurgeryProfile(
  task: RefactoringTask,
  changes: Array<{ file: string; testsAffected?: number }>,
) {
  const affectedSurfaces = Array.from(
    new Set(
      changes.map((change) => {
        if (change.file.includes('test') || change.file.includes('spec')) return 'tests';
        if (change.file.includes('api') || change.file.includes('endpoint')) return 'runtime';
        if (change.file.endsWith('.tsx') || change.file.includes('components')) return 'ui';
        return 'code';
      }),
    ),
  );
  const qaVerificationRequired = changes.some((change) => (change.testsAffected ?? 0) > 0);
  const rollbackSensitive = changes.some((change) =>
    change.file.includes('api') ||
    change.file.includes('database') ||
    change.file.includes('endpoint'),
  );
  return {
    changeType: task.type,
    affectedSurfaces,
    qaVerificationRequired,
    rollbackSensitive,
    repairLinked:
      typeof task.constraints?.linkedRepairId === 'string' ||
      typeof task.constraints?.linkedIncidentId === 'string',
    operatorReviewReason: rollbackSensitive
      ? 'Touches runtime-sensitive paths and requires bounded review before cutover.'
      : 'Bounded refactor still requires reviewed diff and verification evidence.',
  };
}

function buildVerificationLoop(
  task: RefactoringTask,
  surgeryProfile: NonNullable<RefactoringResult['surgeryProfile']>,
) {
  const linkedRepairId = task.constraints?.linkedRepairId ?? null;
  const linkedIncidentId = task.constraints?.linkedIncidentId ?? null;
  const requiresVerifier =
    task.constraints?.verificationMode === 'qa-verification' || surgeryProfile.qaVerificationRequired;
  return {
    mode: linkedRepairId || linkedIncidentId ? 'repair-linked' as const : 'standard' as const,
    linkedRepairId,
    linkedIncidentId,
    requiresVerifier,
    postEditSteps: [
      'Review the bounded diff before cutover.',
      requiresVerifier
        ? 'Run verifier-backed checks and attach the result to the repair lane.'
        : 'Run targeted verification and capture the result in the task output.',
      linkedIncidentId
        ? `Confirm incident ${linkedIncidentId} no longer reproduces after the change.`
        : 'Confirm the originally targeted symptom no longer reproduces after the change.',
    ],
  };
}

function buildToolInvocations(args: {
  task: RefactoringTask;
  changes: Array<{ file: string; testsAffected?: number }>;
  verificationLoop: NonNullable<RefactoringResult['verificationLoop']>;
  patchExecutionMode: 'planned' | 'applied' | 'no-op';
  executedTestCommand?: string | null;
}) {
  const totalTestsAffected = args.changes.reduce(
    (sum, change) => sum + Number(change.testsAffected ?? 0),
    0,
  );
  const toolInvocations: NonNullable<RefactoringResult['toolInvocations']> = [
    {
      toolId: 'workspacePatch',
      detail:
        args.patchExecutionMode === 'applied'
          ? 'build-refactor-agent applied bounded workspace patches and recorded rollback guidance.'
          : args.patchExecutionMode === 'no-op'
            ? 'build-refactor-agent verified that the targeted remediation was already present and did not need a new patch.'
          : 'build-refactor-agent prepared a bounded patch plan with rollback guidance.',
      evidence: [
        `scope:${args.task.scope}`,
        `change-type:${args.task.type}`,
        `planned-files:${new Set(args.changes.map((change) => change.file)).size}`,
        `patch-mode:${args.patchExecutionMode}`,
      ],
      classification: 'required',
    },
  ];

  if (args.task.constraints?.runTests || args.verificationLoop.requiresVerifier) {
    toolInvocations.push({
      toolId: 'testRunner',
      detail:
        args.verificationLoop.requiresVerifier
          ? 'Verifier-backed test coverage is required before the refactor can be treated as closed.'
          : 'Targeted test coverage should be run before the refactor is treated as closed.',
      evidence: [
        `tests-affected:${totalTestsAffected}`,
        `verification-mode:${args.verificationLoop.mode}`,
        ...(args.executedTestCommand ? [`command:${args.executedTestCommand}`] : []),
      ],
      classification: args.verificationLoop.requiresVerifier ? 'required' : 'optional',
    });
  }

  return toolInvocations;
}

function buildRelationships(args: {
  verificationLoop: NonNullable<RefactoringResult['verificationLoop']>;
}) {
  const relationships: NonNullable<RefactoringResult['relationships']> = [];
  if (!args.verificationLoop.requiresVerifier) {
    return relationships;
  }

  relationships.push({
    from: 'agent:build-refactor-agent',
    to: 'agent:qa-verification-agent',
    relationship: 'feeds-agent',
    detail:
      args.verificationLoop.mode === 'repair-linked'
        ? 'build-refactor-agent prepared a repair-linked verifier handoff after bounded code surgery.'
        : 'build-refactor-agent prepared a verifier handoff after bounded code surgery.',
    evidence: [
      `verification-mode:${args.verificationLoop.mode}`,
      ...(args.verificationLoop.linkedIncidentId
        ? [`incident:${args.verificationLoop.linkedIncidentId}`]
        : []),
      ...(args.verificationLoop.linkedRepairId
        ? [`repair:${args.verificationLoop.linkedRepairId}`]
        : []),
    ],
    classification: 'verification-handoff',
  });

  return relationships;
}

function buildImpactEnvelope(args: {
  task: RefactoringTask;
  changes: Array<{ file: string }>;
  scopeContract: NonNullable<RefactoringResult['scopeContract']>;
  surgeryProfile: NonNullable<RefactoringResult['surgeryProfile']>;
  verificationLoop: NonNullable<RefactoringResult['verificationLoop']>;
}) {
  const runtimeSensitivePaths = Array.from(
    new Set(
      args.changes
        .map((change) => change.file)
        .filter((file) =>
          file.includes('api') ||
          file.includes('endpoint') ||
          file.includes('database') ||
          file.includes('orchestrator'),
        ),
    ),
  ).slice(0, 6);
  const incidentFamilies = Array.from(
    new Set([
      args.task.constraints?.linkedIncidentId ? 'incident-linked' : 'standalone',
      args.task.constraints?.linkedRepairId ? 'repair-linked' : 'non-repair',
      args.surgeryProfile.rollbackSensitive ? 'runtime-sensitive' : 'repo-local',
      args.verificationLoop.requiresVerifier ? 'verifier-required' : 'targeted-verification',
    ]),
  );

  return {
    estimatedTouchedFiles: args.scopeContract.estimatedTouchedFiles,
    multiStepEdit: args.changes.length > 1 || args.scopeContract.estimatedTouchedFiles > 1,
    runtimeSensitivePaths,
    rollbackWindow:
      args.surgeryProfile.rollbackSensitive || runtimeSensitivePaths.length > 0
        ? 'tight' as const
        : 'standard' as const,
    verificationDepth:
      args.verificationLoop.requiresVerifier
        ? 'verifier-backed' as const
        : args.task.constraints?.runTests
          ? 'targeted' as const
          : 'advisory' as const,
    incidentFamilies,
  };
}

function buildRefusalProfile(args: {
  confidence: number;
  refused: boolean;
  task: RefactoringTask;
  scopeContract: NonNullable<RefactoringResult['scopeContract']>;
  reasons: string[];
}) {
  return {
    refused: args.refused,
    confidence: Number(args.confidence.toFixed(2)),
    reasons: Array.from(new Set(args.reasons)).filter(Boolean),
    approvalRequired: args.task.constraints?.requiresApproval ?? true,
    narrowScopeSuggested:
      args.refused ||
      args.scopeContract.scopeType === 'broad' ||
      args.scopeContract.estimatedTouchedFiles > 3,
    suggestedMaxFilesChanged:
      args.task.constraints?.maxFilesChanged ??
      (args.scopeContract.scopeType === 'broad' ? 3 : args.scopeContract.estimatedTouchedFiles),
  };
}

function shouldRunLocalVerification(task: RefactoringTask) {
  if (typeof task.testCommand === 'string' && task.testCommand.trim().length > 0) {
    return true;
  }

  if (task.constraints?.verificationMode === 'qa-verification') {
    return false;
  }

  return task.constraints?.runTests === true;
}

function resolveVerificationCommand(task: RefactoringTask) {
  if (!shouldRunLocalVerification(task)) {
    return null;
  }

  return typeof task.testCommand === 'string' && task.testCommand.trim().length > 0
    ? task.testCommand.trim()
    : DEFAULT_TEST_COMMAND;
}

function isSupportedAutonomousFile(relativePath: string) {
  return AUTONOMOUS_TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

async function collectScopeFiles(scope: string): Promise<ScopeFile[]> {
  if (isBroadScope(scope)) {
    return [];
  }

  const normalizedScope = normalizeRelativePath(String(scope ?? 'orchestrator/src'));
  const absoluteScope = path.join(workspaceRoot, normalizedScope);
  const queue = [absoluteScope];
  const files: ScopeFile[] = [];

  while (queue.length > 0 && files.length < AUTONOMOUS_SCAN_LIMIT) {
    const currentPath = queue.shift() as string;
    const currentStats = await stat(currentPath);

    if (currentStats.isDirectory()) {
      const entries = await readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) {
          continue;
        }
        queue.push(path.join(currentPath, entry.name));
      }
      continue;
    }

    const relativePath = normalizeRelativePath(path.relative(workspaceRoot, currentPath));
    if (!isSupportedAutonomousFile(relativePath)) {
      continue;
    }

    files.push({
      relativePath,
      absolutePath: currentPath,
      content: await readFile(currentPath, 'utf-8'),
    });
  }

  return files;
}

async function readScopedTargetFile(
  scope: string,
  targetRelativePath: string,
): Promise<ScopeFile | null> {
  const normalizedTarget = normalizeRelativePath(targetRelativePath);
  if (!pathWithinScope(scope, normalizedTarget)) {
    return null;
  }

  const absoluteTarget = path.join(workspaceRoot, normalizedTarget);
  try {
    const targetStats = await stat(absoluteTarget);
    if (!targetStats.isFile() || !isSupportedAutonomousFile(normalizedTarget)) {
      return null;
    }
    return {
      relativePath: normalizedTarget,
      absolutePath: absoluteTarget,
      content: await readFile(absoluteTarget, 'utf-8'),
    };
  } catch {
    return null;
  }
}

function buildScopeDefaultCandidate(file: ScopeFile): AutonomousCandidate | null {
  const replacements = [
    {
      oldText: 'buildScope: "src"',
      newText: 'buildScope: "orchestrator/src"',
      rationale:
        'Keep the operator build-refactor default scope aligned with the real orchestrator source tree.',
    },
    {
      oldText: 'scope: draft.buildScope.trim() || "src"',
      newText: 'scope: draft.buildScope.trim() || "orchestrator/src"',
      rationale:
        'Default operator-launched build-refactor runs to the real orchestrator scope instead of a phantom src root.',
    },
    {
      oldText: 'scope: String(task.payload.scope ?? "src")',
      newText: 'scope: String(task.payload.scope ?? "orchestrator/src")',
      rationale:
        'Keep backend build-refactor defaults aligned with the orchestrator workspace structure.',
    },
  ].filter((item) => file.content.includes(item.oldText));

  if (replacements.length === 0) {
    return null;
  }

  return {
    id: 'build-scope-defaults',
    title: 'Repair Build Scope Defaults',
    description:
      'Synthesizes bounded scope-default fixes so operator-launched refactors point at the real orchestrator source tree.',
    confidence: 0.91,
    evidence: [
      `file:${file.relativePath}`,
      'pattern:build-scope-default',
      `replacements:${replacements.length}`,
    ],
    changes: replacements.map((replacement) => ({
      file: file.relativePath,
      operation: 'replace',
      oldText: replacement.oldText,
      newText: replacement.newText,
      rationale: replacement.rationale,
      testsAffected: 1,
      metrics: {
        transform: 'build-scope-default',
      },
    })),
  };
}

function buildConfigCacheCandidate(file: ScopeFile): AutonomousCandidate | null {
  const oldText = `function loadConfig(): any {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../agent.config.json'), 'utf-8'));
}`;
  if (!file.content.includes(oldText)) {
    return null;
  }

  const newText = `let cachedConfig: any | null = null;

function loadConfig(): any {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../agent.config.json'), 'utf-8'));
  return cachedConfig;
}`;

  return {
    id: 'cache-sync-config',
    title: 'Cache Synchronous Agent Config Reads',
    description:
      'Synthesizes a bounded performance patch by caching repeated synchronous agent config loads inside the worker process.',
    confidence: 0.89,
    evidence: [
      `file:${file.relativePath}`,
      'pattern:sync-config-cache',
    ],
    changes: [
      {
        file: file.relativePath,
        operation: 'replace',
        oldText,
        newText,
        rationale:
          'Avoid repeated synchronous config disk reads on every capability check inside a hot agent path.',
        testsAffected: 1,
        metrics: {
          transform: 'cache-sync-config',
        },
      },
    ],
  };
}

function isProofDeliveryRemediation(task: RefactoringTask) {
  if (task.incidentClassification === 'proof-delivery') {
    return true;
  }

  const normalizedIntent = String(task.intent ?? '').toLowerCase();
  return (
    normalizedIntent.includes('proof') ||
    normalizedIntent.includes('demand-runtime') ||
    normalizedIntent.includes('milestone')
  );
}

function isOrchestratorIndexScopeFile(file: ScopeFile) {
  return (
    file.relativePath === 'orchestrator/src/index.ts' ||
    file.relativePath.endsWith('/orchestrator/src/index.ts')
  );
}

function isDemandRuntimePriorityGuardPresent(file: ScopeFile) {
  return (
    isOrchestratorIndexScopeFile(file) &&
    file.content.includes('function prioritizePublicProofActiveLanes(') &&
    file.content.includes('const activeLanes = prioritizePublicProofActiveLanes(')
  );
}

function buildDemandRuntimePriorityCandidate(
  file: ScopeFile,
): AutonomousCandidate | null {
  if (!isOrchestratorIndexScopeFile(file)) {
    return null;
  }

  if (!file.content.includes(PUBLIC_PROOF_ACTIVE_LANES_LEGACY_SNIPPET)) {
    return null;
  }

  const changes: RefactoringChange[] = [];

  if (!file.content.includes('function prioritizePublicProofActiveLanes(')) {
    changes.push({
      file: file.relativePath,
      operation: 'replace',
      oldText: 'function buildPublicProofOverview(args: {',
      newText: `${PUBLIC_PROOF_ACTIVE_LANES_HELPER}\n\nfunction buildPublicProofOverview(args: {`,
      rationale:
        'Keep demand-runtime visible in the public proof lane list even when newer milestones crowd the feed.',
      testsAffected: 1,
      metrics: {
        transform: 'public-proof-active-lane-helper',
      },
    });
  }

  changes.push({
    file: file.relativePath,
    operation: 'replace',
    oldText: PUBLIC_PROOF_ACTIVE_LANES_LEGACY_SNIPPET,
    newText: PUBLIC_PROOF_ACTIVE_LANES_NEXT_SNIPPET,
    rationale:
      'Pin the demand-runtime lane in the public proof summary so operators do not lose sight of demand backlog during noisy repair or incident periods.',
    testsAffected: 1,
    metrics: {
      transform: 'public-proof-demand-runtime-priority',
    },
  });

  return {
    id: 'public-proof-demand-runtime-priority',
    title: 'Prioritize Demand Runtime In Public Proof',
    description:
      'Synthesizes a bounded public-proof runtime patch so demand backlog remains visible in the command-center overview.',
    confidence: 0.94,
    evidence: [
      `file:${file.relativePath}`,
      'classification:proof-delivery',
      'pattern:public-proof-active-lanes',
    ],
    changes,
  };
}

function scoreAutonomousCandidate(
  task: RefactoringTask,
  candidate: AutonomousCandidate,
) {
  const normalizedIntent = String(task.intent ?? '').toLowerCase();
  let score = Math.round(candidate.confidence * 100);

  if (task.type === 'optimize_performance' && candidate.id === 'cache-sync-config') {
    score += 30;
  }
  if (task.type === 'modernize' && candidate.id === 'build-scope-defaults') {
    score += 15;
  }
  if (task.type === 'refactor') {
    score += 10;
  }
  if (normalizedIntent.includes('scope') && candidate.id === 'build-scope-defaults') {
    score += 25;
  }
  if (
    (normalizedIntent.includes('performance') ||
      normalizedIntent.includes('cache') ||
      normalizedIntent.includes('config')) &&
    candidate.id === 'cache-sync-config'
  ) {
    score += 25;
  }

  return score;
}

async function synthesizeAutonomousRefactor(
  task: RefactoringTask,
): Promise<AutonomousSynthesisResult> {
  const targetedRuntimeFile = isProofDeliveryRemediation(task)
    ? await readScopedTargetFile(task.scope, 'orchestrator/src/index.ts')
    : null;
  const scopeFiles = await collectScopeFiles(task.scope);
  const analysisFiles = targetedRuntimeFile
    ? [
        targetedRuntimeFile,
        ...scopeFiles.filter(
          (file) => file.relativePath !== targetedRuntimeFile.relativePath,
        ),
      ]
    : scopeFiles;
  if (isProofDeliveryRemediation(task)) {
    const runtimeFile = analysisFiles.find((file) => isOrchestratorIndexScopeFile(file));
    if (runtimeFile && isDemandRuntimePriorityGuardPresent(runtimeFile)) {
      return {
        changes: [],
        improvementDescription:
          'No patch was required: the demand-runtime public-proof guard is already present in orchestrator/src/index.ts.',
        confidence: 0.96,
        evidence: [
          `file:${runtimeFile.relativePath}`,
          'classification:proof-delivery',
          'guard:demand-runtime-priority-present',
        ],
        failureReason: null,
        satisfiedWithoutChanges: true,
      };
    }
  }
  const candidates = analysisFiles.flatMap((file) =>
    [
      isProofDeliveryRemediation(task) ? buildDemandRuntimePriorityCandidate(file) : null,
      buildScopeDefaultCandidate(file),
      buildConfigCacheCandidate(file),
    ].filter((candidate): candidate is AutonomousCandidate => candidate !== null),
  );

  if (candidates.length === 0) {
    return {
      changes: [],
      improvementDescription: '',
      confidence: 0.38,
      evidence: [`scope:${task.scope}`],
      failureReason:
        `No supported autonomous patch synthesis candidates were found inside ${task.scope}. ` +
        'Resubmit with explicit changes[] or narrow the scope to a supported repository pattern.',
    };
  }

  const selected: AutonomousCandidate[] = [];
  const selectedFiles = new Set<string>();
  const maxFilesChanged = task.constraints?.maxFilesChanged ?? 10;

  for (const candidate of candidates.sort(
    (left, right) => scoreAutonomousCandidate(task, right) - scoreAutonomousCandidate(task, left),
  )) {
    const candidateFiles = new Set(candidate.changes.map((change) => change.file));
    const nextUniqueFiles = new Set([...selectedFiles, ...candidateFiles]);
    if (nextUniqueFiles.size > maxFilesChanged) {
      continue;
    }
    selected.push(candidate);
    for (const file of candidateFiles) {
      selectedFiles.add(file);
    }
    if (selected.length >= AUTONOMOUS_PATCH_LIMIT) {
      break;
    }
  }

  const changes = selected.flatMap((candidate) => candidate.changes);
  if (changes.length === 0) {
    return {
      changes: [],
      improvementDescription: '',
      confidence: 0.42,
      evidence: [`scope:${task.scope}`],
      failureReason:
        `Autonomous synthesis found candidate transforms inside ${task.scope}, but all of them exceeded the current file budget. ` +
        'Increase maxFilesChanged or narrow the scope.',
    };
  }

  const confidence =
    selected.reduce((sum, candidate) => sum + candidate.confidence, 0) / selected.length;
  const titles = Array.from(new Set(selected.map((candidate) => candidate.title)));

  return {
    changes,
    improvementDescription:
      `Autonomously synthesized ${changes.length} bounded change(s) across ${selectedFiles.size} file(s): ${titles.join(', ')}.`,
    confidence,
    evidence: selected.flatMap((candidate) => candidate.evidence),
    failureReason: null,
  };
}

async function executeVerificationOnly(args: {
  task: RefactoringTask;
  executeSkill: ExecuteSkillFn;
}): Promise<{
  testsPass: boolean;
  executedTestCommand: string | null;
  failureReason: string | null;
} | null> {
  const executedTestCommand = resolveVerificationCommand(args.task);
  if (!executedTestCommand) {
    return null;
  }

  const testResult = await args.executeSkill(
    'testRunner',
    {
      command: executedTestCommand,
      mode: 'execute',
    },
    'build-refactor-agent',
  );
  const testData = testResult?.data ?? {};
  const testsPass = testResult?.success === true && testData.passed === true;

  return {
    testsPass,
    executedTestCommand,
    failureReason: testsPass
      ? null
      : `No-op remediation verification failed for ${executedTestCommand}.`,
  };
}

function loadConfig(): AgentConfig {
  const configPath = path.join(__dirname, '../agent.config.json');
  const configContent = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(configContent);
}

function canUseSkill(skillId: string): boolean {
  const config = loadConfig();
  const skillPerms = config.permissions.skills[skillId];
  return skillPerms?.allowed === true;
}

function validateExplicitChange(change: RefactoringChange) {
  if (!change || typeof change !== 'object') {
    throw new Error('Explicit build-refactor changes must be objects.');
  }
  if (typeof change.file !== 'string' || change.file.trim().length === 0) {
    throw new Error('Each explicit build-refactor change needs a file path.');
  }
  if (
    change.operation !== 'replace' &&
    change.operation !== 'append' &&
    change.operation !== 'prepend' &&
    change.operation !== 'delete'
  ) {
    throw new Error(
      `Unsupported build-refactor operation "${String((change as any).operation)}".`,
    );
  }
  if (
    (change.operation === 'replace' || change.operation === 'delete') &&
    typeof change.oldText !== 'string'
  ) {
    throw new Error(`Operation "${change.operation}" requires oldText.`);
  }
  if (
    (change.operation === 'replace' ||
      change.operation === 'append' ||
      change.operation === 'prepend') &&
    typeof change.newText !== 'string'
  ) {
    throw new Error(`Operation "${change.operation}" requires newText.`);
  }
}

async function executeExplicitRefactor(args: {
  task: RefactoringTask;
  executeSkill: ExecuteSkillFn;
  patchChanges?: RefactoringChange[];
  improvementDescription?: string;
  confidence?: number;
}): Promise<ExplicitExecutionResult | null> {
  const explicitChanges = Array.isArray(args.patchChanges)
    ? args.patchChanges
    : Array.isArray(args.task.changes)
      ? args.task.changes
      : [];
  if (explicitChanges.length === 0) {
    return null;
  }

  const previews: Array<{
    file: string;
    diff: string;
    riskFlags: string[];
    rationale?: string;
    testsAffected?: number;
    metrics?: Record<string, any>;
    operation: WorkspacePatchChangeType;
  }> = [];
  const uniqueFiles = new Set<string>();

  for (const change of explicitChanges) {
    validateExplicitChange(change);
    const normalizedFile = normalizeRelativePath(change.file);
    if (!pathWithinScope(args.task.scope, normalizedFile)) {
      throw new Error(
        `Explicit build-refactor change "${normalizedFile}" falls outside declared scope "${args.task.scope}".`,
      );
    }
    uniqueFiles.add(normalizedFile);
  }

  if (
    typeof args.task.constraints?.maxFilesChanged === 'number' &&
    uniqueFiles.size > args.task.constraints.maxFilesChanged
  ) {
    throw new Error(
      `Explicit refactor touches ${uniqueFiles.size} files which exceeds maxFilesChanged=${args.task.constraints.maxFilesChanged}.`,
    );
  }

  for (const change of explicitChanges) {
    const normalizedFile = normalizeRelativePath(change.file);
    const previewResult = await args.executeSkill(
      'workspacePatch',
      {
        filePath: path.join(workspaceRoot, normalizedFile),
        changes: {
          type: change.operation,
          oldText: change.oldText,
          newText: change.newText,
        },
        dryRun: true,
        addLineNumbers: true,
      },
      'build-refactor-agent',
    );

    if (!previewResult?.success) {
      throw new Error(
        `workspacePatch dry-run failed for ${normalizedFile}: ${previewResult?.error ?? 'unknown error'}`,
      );
    }
    const previewData = previewResult.data ?? {};

    if (
      (change.operation === 'replace' || change.operation === 'delete') &&
      String(previewData.diff ?? '').trim().length === 0
    ) {
      throw new Error(`No diff was produced for ${normalizedFile}; oldText was not matched.`);
    }

    previews.push({
      file: normalizedFile,
      diff: String(previewData.diff ?? ''),
      riskFlags: Array.isArray(previewData.riskFlags) ? previewData.riskFlags : [],
      rationale: change.rationale,
      testsAffected: change.testsAffected,
      metrics: change.metrics,
      operation: change.operation,
    });
  }

  for (const change of explicitChanges) {
    const normalizedFile = normalizeRelativePath(change.file);
    const applyResult = await args.executeSkill(
      'workspacePatch',
      {
        filePath: path.join(workspaceRoot, normalizedFile),
        changes: {
          type: change.operation,
          oldText: change.oldText,
          newText: change.newText,
        },
        dryRun: false,
        addLineNumbers: true,
      },
      'build-refactor-agent',
    );

    if (!applyResult?.success) {
      throw new Error(
        `workspacePatch apply failed for ${normalizedFile}: ${applyResult?.error ?? 'unknown error'}`,
      );
    }
  }

  const executedTestCommand = resolveVerificationCommand(args.task);

  let testsPass = true;
  let failureReason: string | null = null;
  if (executedTestCommand) {
    const testResult = await args.executeSkill(
      'testRunner',
      {
        command: executedTestCommand,
        mode: 'execute',
      },
      'build-refactor-agent',
    );
    const testData = testResult?.data ?? {};
    testsPass = testResult?.success === true && testData.passed === true;
    if (!testsPass) {
      failureReason = `Applied bounded refactor changes, but verification command ${executedTestCommand} failed.`;
    }
  }

  const appliedChanges: RefactoringResult['changes'] = previews.map((preview) => ({
    file: preview.file,
    type: preview.operation,
    diff: preview.diff,
    rationale:
      preview.rationale ??
      `Applied bounded ${preview.operation} change in ${preview.file}.`,
    metrics: {
      ...(preview.metrics ?? {}),
      riskFlags: preview.riskFlags,
    },
    testsAffected: preview.testsAffected ?? 0,
    rollbackPlan: `Use version control or a reviewed reverse patch to revert ${preview.file} if post-change verification fails.`,
    verificationPlan: executedTestCommand
      ? `Run ${executedTestCommand} and inspect the reviewed diff for ${preview.file}.`
      : `Inspect the reviewed diff for ${preview.file} and run targeted verification before cutover.`,
  }));

  return {
    appliedChanges,
    filesChanged: uniqueFiles.size,
    linesChanged: previews.reduce((sum, preview) => sum + countChangedLines(preview.diff), 0),
    testsPass,
    confidence: testsPass
      ? Number((args.confidence ?? 0.96).toFixed(2))
      : Math.min(Number((args.confidence ?? 0.96).toFixed(2)), 0.58),
    improvementDescription:
      (args.improvementDescription ??
        `Applied ${explicitChanges.length} bounded workspace change(s) across ${uniqueFiles.size} file(s).`) +
      (executedTestCommand ? ` Verification command: ${executedTestCommand}.` : ' No verification command was requested.'),
    executedTestCommand,
    failureReason,
  };
}

async function handleTask(task: RefactoringTask): Promise<RefactoringResult> {
  const startTime = Date.now();

  try {
    if (!canUseSkill('workspacePatch')) {
      const summary = {
        filesChanged: 0,
        linesChanged: 0,
        improvementDescription: 'Permission denied',
        testsPass: false,
        confidence: 0,
      };
      return {
        success: false,
        task: task.type,
        changes: [],
        summary,
        requiresApproval: false,
        ...buildBuildRefactorSpecialistFields({
          task,
          success: false,
          requiresApproval: false,
          summary,
          statusOverride: 'refused',
          refusalReason:
            'workspacePatch permission is required before bounded refactor execution can begin.',
        }),
        executionTime: Date.now() - startTime,
      };
    }

    if (!canUseSkill('testRunner') && (task.constraints?.runTests || typeof task.testCommand === 'string')) {
      const summary = {
        filesChanged: 0,
        linesChanged: 0,
        improvementDescription: 'Cannot run tests (testRunner permission denied)',
        testsPass: false,
        confidence: 0,
      };
      return {
        success: false,
        task: task.type,
        changes: [],
        summary,
        requiresApproval: false,
        ...buildBuildRefactorSpecialistFields({
          task,
          success: false,
          requiresApproval: false,
          summary,
          statusOverride: 'refused',
          refusalReason:
            'Requested verification needs testRunner permission before this refactor can proceed honestly.',
        }),
        executionTime: Date.now() - startTime,
      };
    }

    const executeSkill = await getExecuteSkill();
    let changes: Array<any> = [];
    let improvementDesc = '';
    let testsPass = true;
    let confidence = 0.85;
    let explicitFailureReason: string | null = null;
    let patchExecutionMode: 'planned' | 'applied' | 'no-op' = 'planned';
    let executedTestCommand: string | null = null;

    const explicitExecution = await executeExplicitRefactor({
      task,
      executeSkill,
    });

    if (explicitExecution) {
      changes = explicitExecution.appliedChanges;
      improvementDesc = explicitExecution.improvementDescription;
      testsPass = explicitExecution.testsPass;
      confidence = explicitExecution.confidence;
      explicitFailureReason = explicitExecution.failureReason;
      patchExecutionMode = 'applied';
      executedTestCommand = explicitExecution.executedTestCommand;
    } else {
      if (isBroadScope(task.scope) && !task.constraints?.maxFilesChanged) {
        explicitFailureReason =
          'Refusing low-confidence refactor: scope is too broad without a bounded file limit.';
      } else {
        const synthesized = await synthesizeAutonomousRefactor(task);
        if (synthesized.changes.length > 0) {
          const synthesizedExecution = await executeExplicitRefactor({
            task,
            executeSkill,
            patchChanges: synthesized.changes,
            improvementDescription: synthesized.improvementDescription,
            confidence: synthesized.confidence,
          });

          if (synthesizedExecution) {
            changes = synthesizedExecution.appliedChanges;
            improvementDesc = synthesizedExecution.improvementDescription;
            testsPass = synthesizedExecution.testsPass;
            confidence = synthesizedExecution.confidence;
            explicitFailureReason = synthesizedExecution.failureReason;
            patchExecutionMode = 'applied';
            executedTestCommand = synthesizedExecution.executedTestCommand;
          }
        } else if (synthesized.satisfiedWithoutChanges) {
          improvementDesc = synthesized.improvementDescription;
          confidence = synthesized.confidence;
          patchExecutionMode = 'no-op';
          explicitFailureReason = null;
          const verificationOnly = await executeVerificationOnly({
            task,
            executeSkill,
          });
          if (verificationOnly) {
            testsPass = verificationOnly.testsPass;
            executedTestCommand = verificationOnly.executedTestCommand;
            explicitFailureReason = verificationOnly.failureReason;
            if (!verificationOnly.testsPass) {
              confidence = Math.min(confidence, 0.58);
            }
          }
        } else {
          confidence = synthesized.confidence;
          explicitFailureReason = synthesized.failureReason;
          improvementDesc = synthesized.failureReason ?? '';
          changes = [];
        }
      }
    }

    if (task.constraints?.maxFilesChanged) {
      const uniqueFiles = new Set(changes.map((change) => change.file)).size;
      if (uniqueFiles > task.constraints.maxFilesChanged) {
        const summary = {
          filesChanged: uniqueFiles,
          linesChanged: 0,
          improvementDescription: `Too many files affected (${uniqueFiles} > ${task.constraints.maxFilesChanged} limit)`,
          testsPass: false,
          confidence: 0,
        };
        return {
          success: false,
          task: task.type,
          changes: [],
          summary,
          requiresApproval: true,
          ...buildBuildRefactorSpecialistFields({
            task,
            success: false,
            requiresApproval: true,
            summary,
            statusOverride: 'refused',
            refusalReason:
              'The synthesized change set exceeded the declared maxFilesChanged safety bound.',
          }),
          executionTime: Date.now() - startTime,
        };
      }
    }

    const totalLinesChanged = changes.reduce((sum, change) => sum + (change.linesChanged || countChangedLines(change.diff)), 0);
    const estimatedTouchedFiles = new Set(changes.map((change) => change.file)).size;
    const scopeContract = buildScopeContract(task, estimatedTouchedFiles);
    const surgeryProfile = buildSurgeryProfile(task, changes);
    const verificationLoop = buildVerificationLoop(task, surgeryProfile);
    const toolInvocations = buildToolInvocations({
      task,
      changes,
      verificationLoop,
      patchExecutionMode,
      executedTestCommand,
    });
    const relationships = buildRelationships({ verificationLoop });
    if (totalLinesChanged > 500) confidence -= 0.1;
    if (verificationLoop.requiresVerifier) confidence -= 0.05;
    const impactEnvelope = buildImpactEnvelope({
      task,
      changes,
      scopeContract,
      surgeryProfile,
      verificationLoop,
    });

    if (isBroadScope(task.scope) && !task.constraints?.maxFilesChanged && !explicitExecution) {
      const refusalProfile = buildRefusalProfile({
        confidence: 0.45,
        refused: true,
        task,
        scopeContract,
        reasons: [
          'broad scope is not bounded by maxFilesChanged',
          'low-confidence workspace-wide refactor was refused before cutover',
        ],
      });
      const summary = {
        filesChanged: new Set(changes.map((change) => change.file)).size,
        linesChanged: totalLinesChanged,
        improvementDescription: 'Refusing low-confidence refactor: scope is too broad without a bounded file limit.',
        testsPass: false,
        confidence: 0.45,
      };
      return {
        success: false,
        task: task.type,
        changes: [],
        summary,
        requiresApproval: true,
        rollbackPlan: ['Resubmit with a narrower scope or explicit maxFilesChanged constraint.'],
        verificationPlan: ['Require a bounded dry-run diff before approval.'],
        scopeContract,
        surgeryProfile,
        verificationLoop,
        impactEnvelope,
        refusalProfile,
        relationships,
        toolInvocations,
        ...buildBuildRefactorSpecialistFields({
          task,
          success: false,
          requiresApproval: true,
          summary,
          scopeContract,
          verificationLoop,
          refusalProfile,
          impactEnvelope,
          statusOverride: 'refused',
          refusalReason:
            'Low-confidence workspace-wide refactors are refused until the scope is narrowed.',
        }),
        executionTime: Date.now() - startTime,
      };
    }

    const enrichedChanges = changes.slice(0, 10).map((change) => ({
      ...change,
      rollbackPlan:
        change.rollbackPlan ??
        `Revert ${change.file} to the previous reviewed revision if post-change verification fails.`,
      verificationPlan:
        change.verificationPlan ??
        `Run affected tests (${change.testsAffected ?? 0}) and inspect the targeted diff for ${change.file}.`,
    }));

    if (explicitFailureReason) {
      const summary = {
        filesChanged: new Set(changes.map((change) => change.file)).size,
        linesChanged: totalLinesChanged,
        improvementDescription: explicitFailureReason,
        testsPass: false,
        confidence,
      };
      const refusalProfile = buildRefusalProfile({
        confidence,
        refused: true,
        task,
        scopeContract,
        reasons: [explicitFailureReason],
      });
      return {
        success: false,
        task: task.type,
        changes: enrichedChanges,
        summary,
        requiresApproval: task.constraints?.requiresApproval ?? true,
        rollbackPlan: enrichedChanges.map((change) => change.rollbackPlan as string),
        verificationPlan: enrichedChanges.map((change) => change.verificationPlan as string),
        scopeContract,
        surgeryProfile,
        verificationLoop,
        impactEnvelope,
        refusalProfile,
        relationships,
        toolInvocations,
        ...buildBuildRefactorSpecialistFields({
          task,
          success: false,
          requiresApproval: task.constraints?.requiresApproval ?? true,
          summary,
          scopeContract,
          verificationLoop,
          refusalProfile,
          impactEnvelope,
          escalationReason:
            verificationLoop.linkedIncidentId || verificationLoop.linkedRepairId
              ? explicitFailureReason
              : null,
        }),
        executionTime: Date.now() - startTime,
      };
    }

    const summary = {
      filesChanged: new Set(changes.map((change) => change.file)).size,
      linesChanged: totalLinesChanged,
      improvementDescription: improvementDesc,
      testsPass,
      confidence,
    };
    const refusalProfile = buildRefusalProfile({
      confidence,
      refused: false,
      task,
      scopeContract,
      reasons:
        scopeContract.refusalReasons.length > 0
          ? scopeContract.refusalReasons
          : ['bounded refactor remained within the declared scope contract'],
    });
    return {
      success: true,
      task: task.type,
      changes: enrichedChanges,
      summary,
      requiresApproval: task.constraints?.requiresApproval ?? true,
      rollbackPlan: enrichedChanges.map((change) => change.rollbackPlan as string),
      verificationPlan: enrichedChanges.map((change) => change.verificationPlan as string),
      scopeContract,
      surgeryProfile,
      verificationLoop,
      impactEnvelope,
      refusalProfile,
      relationships,
      toolInvocations,
      ...buildBuildRefactorSpecialistFields({
        task,
        success: true,
        requiresApproval: task.constraints?.requiresApproval ?? true,
        summary,
        scopeContract,
        verificationLoop,
        refusalProfile,
        impactEnvelope,
      }),
      executionTime: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const summary = {
      filesChanged: 0,
      linesChanged: 0,
      improvementDescription: `Error: ${errorMessage}`,
      testsPass: false,
      confidence: 0,
    };
    const scopeContract = {
      scopeType: 'bounded' as const,
      bounded: false,
      estimatedTouchedFiles: 0,
      requestedMaxFilesChanged: task.constraints?.maxFilesChanged ?? null,
      refusalReasons: ['build-refactor execution failed before scope could be confirmed'],
    };
    const surgeryProfile = {
      changeType: task.type,
      affectedSurfaces: [],
      qaVerificationRequired: false,
      rollbackSensitive: false,
      repairLinked: false,
      operatorReviewReason: 'Execution failed before bounded surgery evidence could be produced.',
    };
    const verificationLoop = {
      mode: 'standard' as const,
      linkedRepairId: task.constraints?.linkedRepairId ?? null,
      linkedIncidentId: task.constraints?.linkedIncidentId ?? null,
      requiresVerifier: false,
      postEditSteps: ['Retry after the execution failure is resolved.'],
    };
    const impactEnvelope = {
      estimatedTouchedFiles: 0,
      multiStepEdit: false,
      runtimeSensitivePaths: [],
      rollbackWindow: 'standard' as const,
      verificationDepth: 'advisory' as const,
      incidentFamilies: ['execution-failed'],
    };
    const refusalProfile = {
      refused: true,
      confidence: 0,
      reasons: ['build-refactor execution failed before bounded surgery could be produced'],
      approvalRequired: false,
      narrowScopeSuggested: true,
      suggestedMaxFilesChanged: task.constraints?.maxFilesChanged ?? 1,
    };
    return {
      success: false,
      task: task.type,
      changes: [],
      summary,
      requiresApproval: false,
      scopeContract,
      surgeryProfile,
      verificationLoop,
      impactEnvelope,
      refusalProfile,
      relationships: [],
      toolInvocations: [],
      ...buildBuildRefactorSpecialistFields({
        task,
        success: false,
        requiresApproval: false,
        summary,
        scopeContract,
        verificationLoop,
        refusalProfile,
        impactEnvelope,
        statusOverride: 'blocked',
      }),
      executionTime: Date.now() - startTime,
    };
  }
}

function buildBuildRefactorSpecialistFields(args: {
  task: RefactoringTask;
  success: boolean;
  requiresApproval: boolean;
  summary: RefactoringResult['summary'];
  scopeContract?: RefactoringResult['scopeContract'];
  verificationLoop?: RefactoringResult['verificationLoop'];
  refusalProfile?: RefactoringResult['refusalProfile'];
  impactEnvelope?: RefactoringResult['impactEnvelope'];
  statusOverride?: 'completed' | 'watching' | 'blocked' | 'escalate' | 'refused';
  refusalReason?: string | null;
  escalationReason?: string | null;
}) {
  const status =
    args.statusOverride ??
    (args.refusalProfile?.refused
      ? 'refused'
      : !args.success
        ? args.verificationLoop?.linkedIncidentId || args.verificationLoop?.linkedRepairId
          ? 'escalate'
          : 'blocked'
        : args.requiresApproval || args.verificationLoop?.requiresVerifier
          ? 'watching'
          : 'completed');

  const filesChanged = args.summary.filesChanged ?? 0;
  const linesChanged = args.summary.linesChanged ?? 0;
  const bounded = args.scopeContract?.bounded === true;
  const workflowStage =
    status === 'refused'
      ? 'scope-refusal'
      : status === 'blocked'
        ? 'verification-blocked'
        : status === 'escalate'
          ? 'repair-escalation'
          : args.verificationLoop?.mode === 'repair-linked'
            ? status === 'completed'
              ? 'repair-closure'
              : 'repair-review'
            : filesChanged === 0
              ? status === 'completed'
                ? 'bounded-noop-closure'
                : 'bounded-noop-review'
              : status === 'completed'
                ? 'bounded-surgery-closure'
                : 'bounded-surgery-review';

  const verificationNarrative =
    args.summary.testsPass === true
      ? 'Verification stayed green.'
      : 'Verification did not complete successfully.';
  const operatorSummary =
    status === 'refused'
      ? `Refused ${args.task.type} for scope "${args.task.scope}" because the requested surgery was not bounded enough for governed execution.`
      : status === 'blocked' || status === 'escalate'
        ? `${args.task.type} for scope "${args.task.scope}" did not reach safe closure after ${filesChanged} file(s) and ${linesChanged} changed line(s). ${args.summary.improvementDescription}`
        : `${args.task.type} ${filesChanged === 0 ? 'validated the bounded scope without edits' : `touched ${filesChanged} file(s) and ${linesChanged} changed line(s)`}. ${verificationNarrative}`;

  return buildSpecialistOperatorFields({
    role: 'Software Architect',
    workflowStage,
    deliverable: 'bounded refactor patch set with rollback, verification, and operator handoff guidance',
    status,
    operatorSummary,
    recommendedNextActions: [
      status === 'refused'
        ? 'Resubmit the refactor with a narrower scope or a stricter maxFilesChanged limit.'
        : null,
      args.requiresApproval
        ? 'Review the bounded diff, risk posture, and rollback plan before approving execution or cutover.'
        : null,
      args.verificationLoop?.requiresVerifier
        ? 'Run or review qa-verification before treating the patch as closure evidence.'
        : null,
      args.impactEnvelope?.rollbackWindow === 'tight'
        ? 'Keep a rollback window ready during cutover because the touched path is runtime-sensitive.'
        : null,
      !bounded
        ? 'Confirm the scope contract is bounded before reusing this task as a remediation template.'
        : null,
    ],
    refusalReason: args.refusalReason ?? (status === 'refused' ? args.summary.improvementDescription : null),
    escalationReason:
      args.escalationReason ??
      (status === 'escalate'
        ? 'Repair-linked refactor did not reach a safe closure and should be escalated with verifier context.'
        : null),
  });
}

function performSecurityScan(_scope: string): Array<any> {
  return [
    {
      file: 'src/database.ts',
      type: 'security',
      rationale: 'Remove SQL injection vulnerability (parameterized queries)',
      linesChanged: 6,
      testsAffected: 12,
      metrics: { severity: 'HIGH', cwe: 'CWE-89' },
    },
    {
      file: 'src/api/endpoints.ts',
      type: 'security',
      rationale: 'Add input validation for user parameters',
      linesChanged: 8,
      testsAffected: 8,
      metrics: { severity: 'MEDIUM', cwe: 'CWE-20' },
    },
  ];
}

function analyzePerformance(_scope: string): Array<any> {
  return [
    {
      file: 'src/components/ProductList.tsx',
      type: 'performance',
      rationale: 'Memoize components to prevent unnecessary re-renders',
      linesChanged: 4,
      testsAffected: 6,
      metrics: { estimatedSpeedup: '40%', priority: 'HIGH' },
    },
    {
      file: 'src/hooks/useSearch.ts',
      type: 'performance',
      rationale: 'Add debouncing to prevent excessive API calls',
      linesChanged: 12,
      testsAffected: 8,
      metrics: { estimatedSpeedup: '15%', priority: 'MEDIUM' },
    },
  ];
}

function detectDuplication(_scope: string): Array<any> {
  return [
    {
      file: 'src/validators/userValidator.ts',
      type: 'deduplication',
      rationale: 'Extract shared validation to separate function',
      affectedFiles: 2,
      linesChanged: -25,
      testsAffected: 8,
      metrics: { similarity: '91%', consolidation: 'HIGH' },
    },
  ];
}

function modernizePatterns(_scope: string): Array<any> {
  return [
    {
      file: 'src/api/handlers.js',
      type: 'modernize',
      rationale: 'Convert callbacks to async/await syntax',
      linesChanged: 15,
      testsAffected: 10,
      metrics: { improvement: 'readability', dateAdded: 'async/await' },
    },
  ];
}

function generalRefactor(_scope: string): Array<any> {
  return [
    {
      file: 'src/utils/helpers.ts',
      type: 'refactor',
      rationale: 'Improve type safety and reduce complexity',
      linesChanged: 8,
      testsAffected: 5,
      metrics: { complexity: '-2', typeErrors: '-3' },
    },
  ];
}

async function main(): Promise<void> {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    return;
  }

  try {
    let taskInput: RefactoringTask;
    try {
      const payloadRaw = await readFile(payloadPath, 'utf-8');
      taskInput = JSON.parse(payloadRaw) as RefactoringTask;
    } catch {
      taskInput = JSON.parse(payloadPath) as RefactoringTask;
    }
    const result = await handleTask(taskInput);

    const resultFile = process.env.BUILD_REFACTOR_AGENT_RESULT_FILE;
    if (resultFile) {
      await mkdir(path.dirname(resultFile), { recursive: true });
      await writeFile(resultFile, JSON.stringify(result, null, 2), 'utf-8');
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});

export { handleTask, loadConfig, canUseSkill, AgentConfig, RefactoringTask, RefactoringResult };
