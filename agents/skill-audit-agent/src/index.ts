import { getExecuteSkill, resolveTaskExecuteSkill } from "../../shared/governed-readers.js";
import * as path from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { pathToFileURL } from 'url';
import { auditSkill } from '../../../orchestrator/src/skillAudit.ts';
import { buildSpecialistOperatorFields, loadRuntimeState } from '../../shared/runtime-evidence.js';

interface AgentConfig {
  orchestratorStatePath?: string;
  permissions?: {
    skills?: Record<string, { allowed?: boolean }>;
  };
}


interface Task {
  id: string;
  skillIds?: string[];
  depth?: string;
  checks?: string[];
}

interface SkillAuditRecord {
  skillId: string;
  audited: boolean;
  passed: boolean;
  failures: string[];
  warnings: string[];
  riskFlags: string[];
  recommendations: string[];
  intakeChecklist: Array<{ item: string; status: 'pass' | 'warn' | 'fail' }>;
  restartSafety: {
    classification: 'restart-safe' | 'metadata-only' | 'needs-review';
    rationale: string;
  };
  trustExplanation: string;
  governedRegistration?: {
    trustStatus: 'pending-review' | 'review-approved';
    persistenceMode: 'restart-safe' | 'metadata-only';
    reviewedBy: string | null;
    executable: boolean;
  };
}

interface Result {
  success: boolean;
  depth: string;
  checksRequested: string[];
  skillsAudited: number;
  issuesFound: number;
  missingSkills: number;
  verdict: 'APPROVED' | 'ATTENTION' | 'ERROR';
  trustPosture: {
    status: 'approved' | 'watching' | 'review-required';
    pendingReviewCount: number;
    approvedCount: number;
    restartSafeApprovedCount: number;
    metadataOnlyCount: number;
    missingRegistryCount: number;
  };
  policyHandoff: {
    status: 'clear' | 'review-required';
    pendingReviewSkills: string[];
    metadataOnlySkills: string[];
  };
  telemetryHandoff: {
    status: 'quiet' | 'watch' | 'alert';
    missingSkillIds: string[];
    riskySkillIds: string[];
  };
  intakeCoverage: {
    passCount: number;
    warnCount: number;
    failCount: number;
    auditedSkills: number;
    missingSkills: number;
    restartSafeReadyCount: number;
  };
  restartSafetySummary: {
    status: 'stable' | 'watching' | 'review-required';
    restartSafeCount: number;
    metadataOnlyCount: number;
    needsReviewCount: number;
    executableApprovedCount: number;
    pendingReviewCount: number;
  };
  verificationHarness?: {
    command: string;
    mode: 'dry-run';
    ready: boolean;
    outcomeSummary: string;
  };
  toolInvocations?: Array<{
    toolId: string;
    detail: string;
    evidence: string[];
    classification?: string;
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
  results: SkillAuditRecord[];
  executionTime: number;
  error?: string;
}

interface RuntimeState {
  governedSkillState?: Array<{
    skillId: string;
    trustStatus: 'pending-review' | 'review-approved';
    persistenceMode: 'restart-safe' | 'metadata-only';
    reviewedBy?: string;
  }>;
}

type SkillRuntimeModule = {
  initializeSkills: () => Promise<void>;
  getSkillDefinition: (skillId: string) => any;
  listSkills: () => Array<{ id: string }>;
};


function normalizeCheckName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

async function getSkillRuntime(): Promise<SkillRuntimeModule> {
  const runtime = await import('../../../skills/index.ts');
  return {
    initializeSkills: runtime.initializeSkills,
    getSkillDefinition: runtime.getSkillDefinition,
    listSkills: runtime.listSkills,
  };
}

async function loadAgentConfig(): Promise<AgentConfig> {
  const configPath = path.join(__dirname, '../agent.config.json');
  const raw = await readFile(configPath, 'utf-8');
  return JSON.parse(raw) as AgentConfig;
}

function selectVerificationHarnessCommand(task: Task): 'lint' | 'build-verify' | 'security-audit' {
  const checks = Array.isArray(task.checks)
    ? task.checks.map((value) => normalizeCheckName(String(value)))
    : [];
  if (checks.some((value) => value.includes('security') || value.includes('permission'))) {
    return 'security-audit';
  }
  if (typeof task.depth === 'string' && task.depth.trim().toLowerCase() === 'deep') {
    return 'build-verify';
  }
  return 'lint';
}

function buildTrustPosture(args: {
  governedSkillState: NonNullable<RuntimeState['governedSkillState']>;
  missingSkills: number;
}) {
  const pendingReviewCount = args.governedSkillState.filter(
    (entry) => entry.trustStatus === 'pending-review',
  ).length;
  const approvedCount = args.governedSkillState.filter(
    (entry) => entry.trustStatus === 'review-approved',
  ).length;
  const restartSafeApprovedCount = args.governedSkillState.filter(
    (entry) =>
      entry.trustStatus === 'review-approved' && entry.persistenceMode === 'restart-safe',
  ).length;
  const metadataOnlyCount = args.governedSkillState.filter(
    (entry) => entry.persistenceMode === 'metadata-only',
  ).length;
  let status: Result['trustPosture']['status'] = 'approved';
  if (pendingReviewCount > 0 || metadataOnlyCount > 0) status = 'watching';
  if (args.missingSkills > 0 || pendingReviewCount > approvedCount) status = 'review-required';
  return {
    status,
    pendingReviewCount,
    approvedCount,
    restartSafeApprovedCount,
    metadataOnlyCount,
    missingRegistryCount: args.missingSkills,
  };
}

function buildPolicyHandoff(results: SkillAuditRecord[]): Result['policyHandoff'] {
  const pendingReviewSkills = results
    .filter((entry) => entry.governedRegistration?.trustStatus === 'pending-review')
    .map((entry) => entry.skillId);
  const metadataOnlySkills = results
    .filter((entry) => entry.restartSafety.classification === 'metadata-only')
    .map((entry) => entry.skillId);
  return {
    status: pendingReviewSkills.length > 0 || metadataOnlySkills.length > 0 ? 'review-required' : 'clear',
    pendingReviewSkills,
    metadataOnlySkills,
  };
}

function buildTelemetryHandoff(args: {
  results: SkillAuditRecord[];
  missingSkills: number;
}): Result['telemetryHandoff'] {
  const riskySkillIds = args.results
    .filter((entry) => entry.failures.length > 0 || entry.riskFlags.length > 0)
    .map((entry) => entry.skillId);
  const missingSkillIds = args.results
    .filter((entry) => entry.audited === false)
    .map((entry) => entry.skillId);
  return {
    status:
      riskySkillIds.length > 0 || args.missingSkills > 0
        ? 'alert'
        : args.results.some((entry) => entry.restartSafety.classification !== 'restart-safe')
          ? 'watch'
          : 'quiet',
    missingSkillIds,
    riskySkillIds,
  };
}

function buildIntakeCoverage(args: {
  results: SkillAuditRecord[];
  missingSkills: number;
}): Result['intakeCoverage'] {
  const checklistEntries = args.results.flatMap((entry) => entry.intakeChecklist);
  return {
    passCount: checklistEntries.filter((entry) => entry.status === 'pass').length,
    warnCount: checklistEntries.filter((entry) => entry.status === 'warn').length,
    failCount: checklistEntries.filter((entry) => entry.status === 'fail').length,
    auditedSkills: args.results.filter((entry) => entry.audited).length,
    missingSkills: args.missingSkills,
    restartSafeReadyCount: args.results.filter(
      (entry) => entry.restartSafety.classification === 'restart-safe',
    ).length,
  };
}

function buildRestartSafetySummary(args: {
  results: SkillAuditRecord[];
}): Result['restartSafetySummary'] {
  const restartSafeCount = args.results.filter(
    (entry) => entry.restartSafety.classification === 'restart-safe',
  ).length;
  const metadataOnlyCount = args.results.filter(
    (entry) => entry.restartSafety.classification === 'metadata-only',
  ).length;
  const needsReviewCount = args.results.filter(
    (entry) => entry.restartSafety.classification === 'needs-review',
  ).length;
  const executableApprovedCount = args.results.filter(
    (entry) => entry.governedRegistration?.executable === true,
  ).length;
  const pendingReviewCount = args.results.filter(
    (entry) => entry.governedRegistration?.trustStatus === 'pending-review',
  ).length;

  return {
    status:
      needsReviewCount > 0
        ? 'review-required'
        : metadataOnlyCount > 0 || pendingReviewCount > 0
          ? 'watching'
          : 'stable',
    restartSafeCount,
    metadataOnlyCount,
    needsReviewCount,
    executableApprovedCount,
    pendingReviewCount,
  };
}

function buildSkillAuditSpecialistFields(args: {
  skillsAudited: number;
  issuesFound: number;
  missingSkills: number;
  verdict: Result['verdict'];
  trustPosture: Result['trustPosture'];
  policyHandoff?: Result['policyHandoff'];
  telemetryHandoff: Result['telemetryHandoff'];
  verificationHarness?: Result['verificationHarness'];
  statusOverride?: 'completed' | 'watching' | 'blocked' | 'escalate' | 'refused';
  refusalReason?: string | null;
}) {
  const status =
    args.statusOverride ??
    (args.verdict === 'ERROR'
      ? 'blocked'
      : args.missingSkills > 0 || args.trustPosture.status === 'review-required' || args.telemetryHandoff.status === 'alert'
        ? 'escalate'
        : args.issuesFound > 0 || args.policyHandoff?.status === 'review-required' || args.trustPosture.status === 'watching'
          ? 'watching'
          : 'completed');
  const workflowStage =
    status === 'refused'
      ? 'governance-refusal'
      : status === 'blocked'
        ? 'governance-blocked'
        : status === 'escalate'
          ? 'governance-escalation'
          : status === 'watching'
            ? 'governance-review'
            : 'governance-closure';
  return buildSpecialistOperatorFields({
    role: 'Automation Governance Architect',
    workflowStage,
    deliverable: 'governed skill audit with trust posture, policy handoff, and restart-safety guidance',
    status,
    operatorSummary:
      status === 'refused'
        ? 'Refused skill audit because no governed skill targets were available for review.'
        : status === 'blocked'
          ? 'Skill audit failed before a trustworthy governance summary could be emitted.'
          : `Audited ${args.skillsAudited} skill(s); ${args.issuesFound} issue(s) found, ${args.missingSkills} missing skill(s), trust posture ${args.trustPosture.status}, verification harness ${args.verificationHarness?.ready === true ? 'ready' : 'not-ready'}.`,
    recommendedNextActions: [
      status === 'refused'
        ? 'Supply concrete skill IDs or make sure governed skills are registered before retrying the audit.'
        : null,
      args.missingSkills > 0
        ? 'Resolve the missing skill registrations before treating this governance pass as complete.'
        : null,
      args.policyHandoff?.pendingReviewSkills?.length
        ? `Review the pending skills first: ${args.policyHandoff.pendingReviewSkills.slice(0, 3).join(', ')}.`
        : null,
      args.telemetryHandoff.riskySkillIds.length > 0
        ? 'Address the risky or failing skills before promoting them as restart-safe.'
        : null,
    ],
    refusalReason:
      args.refusalReason ??
      (status === 'refused' ? 'No governed skill targets were available for audit.' : null),
    escalationReason:
      status === 'escalate'
        ? 'The audit found missing or risky skills that still require governance attention before promotion.'
        : null,
  });
}

async function handleTask(task: Task): Promise<Result> {
  const startTime = Date.now();

  try {
    const agentConfig = await loadAgentConfig();
    const executeSkill = resolveTaskExecuteSkill(task) ?? await getExecuteSkill();
    const runtimeState = await loadRuntimeState<RuntimeState>(
      path.join(__dirname, '../agent.config.json'),
      agentConfig.orchestratorStatePath,
    );
    const governedSkillState = runtimeState.governedSkillState ?? [];
    const runtime = await getSkillRuntime();
    await runtime.initializeSkills();

    const requestedSkillIds = Array.isArray(task.skillIds) && task.skillIds.length > 0
      ? Array.from(new Set(task.skillIds.map((value) => String(value).trim()).filter(Boolean)))
      : runtime.listSkills().map((entry) => entry.id);
    const requestedChecks = Array.isArray(task.checks)
      ? Array.from(new Set(task.checks.map((value) => normalizeCheckName(String(value)))))
      : [];
    const depth = typeof task.depth === 'string' && task.depth.trim().length > 0
      ? task.depth.trim()
      : 'standard';
    const toolInvocations: NonNullable<Result['toolInvocations']> = [];
    let verificationHarness: Result['verificationHarness'];

    if (agentConfig.permissions?.skills?.testRunner?.allowed === true) {
      const harnessCommand = selectVerificationHarnessCommand(task);
      const harnessResult = await executeSkill('testRunner', {
        command: harnessCommand,
        mode: 'dry-run',
      }, 'skill-audit-agent');
      verificationHarness = {
        command: harnessCommand,
        mode: 'dry-run',
        ready: harnessResult?.success === true,
        outcomeSummary:
          typeof harnessResult?.outcomeSummary === 'string'
            ? harnessResult.outcomeSummary
            : harnessResult?.success === true
              ? `dry-run accepted for ${harnessCommand}`
              : `dry-run failed for ${harnessCommand}`,
      };
      toolInvocations.push({
        toolId: 'testRunner',
        detail: `Validated the governed verification harness with a ${harnessCommand} dry-run.`,
        evidence: [
          `command:${harnessCommand}`,
          `ready:${verificationHarness.ready}`,
          `depth:${depth}`,
        ],
        classification: 'governance-harness',
      });
    }

    if (requestedSkillIds.length === 0) {
      const trustPosture = buildTrustPosture({ governedSkillState, missingSkills: 0 });
      return {
        success: false,
        depth,
        checksRequested: requestedChecks,
        skillsAudited: 0,
        issuesFound: 1,
        missingSkills: 0,
        verdict: 'ERROR',
        trustPosture,
        verificationHarness,
        toolInvocations,
        results: [],
        ...buildSkillAuditSpecialistFields({
          skillsAudited: 0,
          issuesFound: 1,
          missingSkills: 0,
          verdict: 'ERROR',
          trustPosture,
          telemetryHandoff: {
            status: 'alert',
            missingSkillIds: [],
            riskySkillIds: [],
          },
          verificationHarness,
          statusOverride: 'refused',
          refusalReason: 'No governed skill IDs were supplied and the registry was empty.',
        }),
        executionTime: Date.now() - startTime,
        error: 'No skill ids supplied and no registered skills available to audit',
      };
    }

    const results: SkillAuditRecord[] = [];
    let issuesFound = 0;
    let missingSkills = 0;

    for (const skillId of requestedSkillIds) {
      const definition = runtime.getSkillDefinition(skillId);
      if (!definition) {
        const governedRecord = governedSkillState.find((entry) => entry.skillId === skillId);
        missingSkills += 1;
        issuesFound += 1;
        results.push({
          skillId,
          audited: false,
          passed: false,
          failures: [`Skill not found: ${skillId}`],
          warnings: [],
          riskFlags: [],
          recommendations: ['Check the requested skill id and retry the audit.'],
          intakeChecklist: [
            { item: 'skill-definition-present', status: 'fail' },
          ],
          restartSafety: {
            classification: 'needs-review',
            rationale: 'Missing skills cannot be classified for restart safety.',
          },
          trustExplanation: 'The requested skill was not found in the active registry.',
          governedRegistration: governedRecord
            ? {
                trustStatus: governedRecord.trustStatus,
                persistenceMode: governedRecord.persistenceMode,
                reviewedBy: governedRecord.reviewedBy ?? null,
                executable: governedRecord.trustStatus === 'review-approved',
              }
            : undefined,
        });
        continue;
      }

      const auditResult = auditSkill(definition);
      const relevantChecks = requestedChecks.length > 0
        ? auditResult.checks.filter((check) =>
            requestedChecks.includes(normalizeCheckName(check.name)),
          )
        : auditResult.checks;

      const failures = relevantChecks
        .filter((check) => check.status === 'fail')
        .map((check) => `${check.name}: ${check.message}`);
      const warnings = relevantChecks
        .filter((check) => check.status === 'warn')
        .map((check) => `${check.name}: ${check.message}`);
      const riskFlags = requestedChecks.length > 0
        ? auditResult.riskFlags.filter((flag) =>
            requestedChecks.some((checkName) => flag.includes(checkName)),
          )
        : auditResult.riskFlags;
      const intakeChecklist = [
        {
          item: 'provenance-present',
          status: auditResult.checks.some((check) => check.name === 'provenance' && check.status === 'fail') ? 'fail' : 'pass',
        },
        {
          item: 'permissions-bounded',
          status: riskFlags.some((flag) => flag.startsWith('unbounded-')) ? 'fail' : 'pass',
        },
        {
          item: 'runtime-safe',
          status: riskFlags.some((flag) => flag === 'eval-runtime' || flag === 'subprocess-spawning') ? 'fail' : 'pass',
        },
        {
          item: 'schema-defined',
          status: auditResult.checks.some((check) => check.name === 'schemas' && check.status === 'fail') ? 'fail' : 'pass',
        },
      ] as SkillAuditRecord['intakeChecklist'];
      const restartSafety = riskFlags.length === 0
        ? {
            classification: 'restart-safe' as const,
            rationale: 'No active risk flags were raised during audit.',
          }
        : riskFlags.every((flag) => flag === 'unknown-provenance')
          ? {
              classification: 'metadata-only' as const,
              rationale: 'Only metadata provenance questions remain before execution should be trusted.',
            }
          : {
              classification: 'needs-review' as const,
              rationale: 'Runtime or permission risk flags still require review.',
            };
      const governedRecord = governedSkillState.find((entry) => entry.skillId === skillId);

      issuesFound += failures.length + riskFlags.length;

      results.push({
        skillId,
        audited: true,
        passed: failures.length === 0 && riskFlags.length === 0,
        failures,
        warnings,
        riskFlags,
        recommendations: auditResult.recommendations.slice(0, 5),
        intakeChecklist,
        restartSafety,
        trustExplanation:
          failures.length === 0 && riskFlags.length === 0
            ? 'The skill passed the requested audit checks with bounded permissions and no active risk flags.'
            : `The skill remains constrained by ${[...failures, ...riskFlags].slice(0, 3).join(', ')}.`,
        governedRegistration: governedRecord
          ? {
              trustStatus: governedRecord.trustStatus,
              persistenceMode: governedRecord.persistenceMode,
              reviewedBy: governedRecord.reviewedBy ?? null,
              executable: governedRecord.trustStatus === 'review-approved',
            }
          : undefined,
      });
    }

    const skillsAudited = results.filter((entry) => entry.audited).length;
    const trustPosture = buildTrustPosture({ governedSkillState, missingSkills });
    const policyHandoff = buildPolicyHandoff(results);
    const telemetryHandoff = buildTelemetryHandoff({ results, missingSkills });
    const intakeCoverage = buildIntakeCoverage({ results, missingSkills });
    const restartSafetySummary = buildRestartSafetySummary({ results });

    const result = {
      success: skillsAudited > 0,
      depth,
      checksRequested: requestedChecks,
      skillsAudited,
      issuesFound,
      missingSkills,
      verdict: issuesFound === 0 && missingSkills === 0 ? 'APPROVED' : 'ATTENTION',
      trustPosture,
      policyHandoff,
      telemetryHandoff,
      intakeCoverage,
      restartSafetySummary,
      verificationHarness,
      toolInvocations,
      results,
      executionTime: Date.now() - startTime,
    };
    return {
      ...result,
      ...buildSkillAuditSpecialistFields({
        skillsAudited,
        issuesFound,
        missingSkills,
        verdict: result.verdict,
        trustPosture,
        policyHandoff,
        telemetryHandoff,
        verificationHarness,
      }),
    };
  } catch (error) {
    const trustPosture = {
      status: 'review-required' as const,
      pendingReviewCount: 0,
      approvedCount: 0,
      restartSafeApprovedCount: 0,
      metadataOnlyCount: 0,
      missingRegistryCount: 0,
    };
    const policyHandoff = {
      status: 'review-required' as const,
      pendingReviewSkills: [],
      metadataOnlySkills: [],
    };
    const telemetryHandoff = {
      status: 'alert' as const,
      missingSkillIds: [],
      riskySkillIds: [],
    };
    return {
      success: false,
      depth: typeof task.depth === 'string' ? task.depth : 'standard',
      checksRequested: Array.isArray(task.checks) ? task.checks : [],
      skillsAudited: 0,
      issuesFound: 1,
      missingSkills: 0,
      verdict: 'ERROR',
      trustPosture,
      policyHandoff,
      telemetryHandoff,
      intakeCoverage: {
        passCount: 0,
        warnCount: 0,
        failCount: 1,
        auditedSkills: 0,
        missingSkills: 0,
        restartSafeReadyCount: 0,
      },
      restartSafetySummary: {
        status: 'review-required',
        restartSafeCount: 0,
        metadataOnlyCount: 0,
        needsReviewCount: 0,
        executableApprovedCount: 0,
        pendingReviewCount: 0,
      },
      toolInvocations: [],
      results: [],
      ...buildSkillAuditSpecialistFields({
        skillsAudited: 0,
        issuesFound: 1,
        missingSkills: 0,
        verdict: 'ERROR',
        trustPosture,
        policyHandoff,
        telemetryHandoff,
        statusOverride: 'blocked',
      }),
      executionTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    return;
  }

  try {
    const payloadRaw = await readFile(payloadPath, 'utf-8');
    const taskInput = JSON.parse(payloadRaw) as Task;
    const result = await handleTask(taskInput);

    const resultFile = process.env.SKILL_AUDIT_AGENT_RESULT_FILE;
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

const directEntryHref = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (directEntryHref === import.meta.url) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}

export { handleTask };
