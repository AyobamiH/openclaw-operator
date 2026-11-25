#!/usr/bin/env node
import { getExecuteSkill } from "../../shared/governed-readers.js";

/**
 * QA Verification Agent - Entry Point
 *
 * Runs bounded QA checks, supports explicit dry-run mode, and refuses to
 * report a green execution unless a real whitelisted runner command executed.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  buildSpecialistOperatorFields,
  buildIncidentPriorityQueue,
  buildWorkflowBlockerSummary,
  countByStatus,
  loadRuntimeState,
  normalizeAgentIdFromNode,
  summarizeRelationshipObservations,
  type RuntimeIncidentLedgerRecord,
  type RuntimeRelationshipObservation,
  type RuntimeRepairRecord,
  type RuntimeStateSubset,
  type RuntimeWorkflowEvent,
} from '../../shared/runtime-evidence.js';

type ExecuteSkillFn = (
  skillId: string,
  input: any,
  requestingAgent?: string,
) => Promise<any>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '../agent.config.json');
const orchestratorWorkingDir = path.resolve(__dirname, '../../../orchestrator');
const DEFAULT_DRY_RUN_COMMAND = 'build-verify';

interface AgentConfig {
  id: string;
  name: string;
  orchestratorStatePath?: string;
  constraints?: {
    timeout?: number;
  };
  permissions: any;
}

interface QaRequest {
  mode: 'dry-run' | 'execute';
  testCommand?: string;
  timeout: number;
  collectCoverage: boolean;
}

interface RuntimeState extends RuntimeStateSubset {}

interface VerificationContext {
  incident: {
    incidentId: string;
    classification: string | null;
    severity: string | null;
    status: string | null;
    owner: string | null;
    remediationStatus: string | null;
    remediationTaskStatuses: Record<string, number>;
    summary: string | null;
  } | null;
  repairs: {
    total: number;
    byStatus: Record<string, number>;
    latestCompletedAt: string | null;
    latestVerifiedAt: string | null;
  };
  workflow: {
    totalEvents: number;
    latestEventAt: string | null;
    byStage: Record<string, number>;
    stopCodes: string[];
  };
  relationships: {
    total: number;
    lastObservedAt: string | null;
    byRelationship: Record<string, number>;
    targetAgentId: string | null;
  };
  affectedSurfaces: string[];
  serviceIds: string[];
  verificationSignals: string[];
  evidence: string[];
  priorityIncidents: Array<{
    incidentId: string;
    classification: string | null;
    severity: string | null;
    status: string | null;
    priorityScore: number;
    nextAction: string | null;
    blockers: string[];
  }>;
  workflowWatch: {
    totalStopSignals: number;
    latestStopAt: string | null;
    latestStopCode: string | null;
    byStage: Record<string, number>;
    byClassification: Record<string, number>;
    byStopCode: Record<string, number>;
    blockedRunIds: string[];
    proofStopSignals: number;
  };
}

interface VerificationRelationshipOutput {
  from: string;
  to: string;
  relationship: 'verifies-agent' | 'depends-on-run';
  detail: string;
  evidence: string[];
  targetRunId?: string;
}

interface VerificationToolInvocationOutput {
  toolId: string;
  detail: string;
  evidence: string[];
  classification: 'required' | 'optional';
}

interface ClosureRecommendation {
  decision: 'close-incident' | 'keep-open' | 'escalate';
  allowClosure: boolean;
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  nextActions: string[];
}

type VerificationCorrectness = 'verified' | 'provisional' | 'failed';
type VerificationRegressionRisk = 'low' | 'medium' | 'high';
type VerificationPolicyFit =
  | 'bounded-test-runner'
  | 'bounded-test-runner-dry-run'
  | 'bounded-test-runner-escalation';

interface VerificationAssessment {
  correctness: VerificationCorrectness;
  regressionRisk: VerificationRegressionRisk;
  policyFit: VerificationPolicyFit;
}

interface VerificationTrace {
  traceId: string;
  generatedAt: string;
  executionMode: 'dry-run' | 'execute';
  executedCommand: string | null;
  targetAgentId: string | null;
  incidentId: string | null;
  repairIds: string[];
  runIds: string[];
  serviceIds: string[];
  affectedSurfaces: string[];
  correctness: VerificationCorrectness;
  evidenceQuality: 'strong' | 'partial' | 'minimal';
  reproducibility: 'verified' | 'failed' | 'unproven';
  regressionRisk: VerificationRegressionRisk;
  policyFit: VerificationPolicyFit;
  closureDecision: ClosureRecommendation['decision'];
  allowClosure: boolean;
  summary: string;
  evidence: string[];
  workflowStopSignals: number;
  priorityIncidentCount: number;
  repairCount: number;
  relationshipCount: number;
}

interface VerificationAuthority {
  targetKind: 'incident' | 'repair' | 'agent' | 'workflow-run' | 'workspace';
  targetId: string | null;
  authorityLevel: 'advisory' | 'conditional' | 'closure-authorized' | 'escalation-required';
  closureEligible: boolean;
  escalationRequired: boolean;
  blockers: string[];
  requiredEvidence: string[];
}

interface VerificationSurfaceContract {
  surface: 'code' | 'docs' | 'public-proof' | 'workflow' | 'runtime';
  acceptanceMode: 'bounded-execute' | 'evidence-review' | 'hybrid';
  requiredEvidence: string[];
  blockers: string[];
  refusalReason: string | null;
}

interface AcceptanceCoverage {
  surface: VerificationSurfaceContract['surface'];
  acceptanceMode: VerificationSurfaceContract['acceptanceMode'];
  evidenceAnchorsSupplied: number;
  runtimeSignals: number;
  closureReadiness: 'ready' | 'needs-evidence' | 'escalate';
}

interface RefusalProfile {
  surface: VerificationSurfaceContract['surface'];
  acceptanceMode: VerificationSurfaceContract['acceptanceMode'];
  executeRequested: boolean;
  refused: boolean;
  reason: string | null;
  blockerCount: number;
}

interface ClosureContract {
  targetKind: VerificationAuthority['targetKind'];
  targetId: string | null;
  closeAllowed: boolean;
  reopenOnFailure: boolean;
  unresolvedSignals: number;
  requiredFollowups: string[];
  incidentStatus: string | null;
  repairStatus: string | null;
}

interface ReproducibilityProfile {
  reproducibility: VerificationTrace['reproducibility'];
  evidenceQuality: VerificationTrace['evidenceQuality'];
  regressionRisk: VerificationRegressionRisk;
  workflowStopSignals: number;
  repairCount: number;
  relationshipCount: number;
  priorityIncidentCount: number;
}

let agentConfig: AgentConfig;

async function loadConfig(): Promise<void> {
  const configContent = await fs.readFile(configPath, 'utf-8');
  agentConfig = JSON.parse(configContent);
}

function ensureConfigLoaded(): void {
  if (!agentConfig) {
    throw new Error('Agent config not loaded');
  }
}

function canUseSkill(skillId: string): boolean {
  ensureConfigLoaded();
  const skillPerms = agentConfig.permissions.skills[skillId];
  return skillPerms && skillPerms.allowed === true;
}

function normalizeMode(value: unknown): 'dry-run' | 'execute' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'dry-run' || normalized === 'dryrun') return 'dry-run';
  if (normalized === 'execute' || normalized === 'run') return 'execute';
  return null;
}

function mapSuiteToCommand(suite: unknown): string | undefined {
  if (typeof suite !== 'string') return undefined;
  switch (suite.trim().toLowerCase()) {
    case 'smoke':
    case 'build':
      return 'build-verify';
    case 'unit':
    case 'unit-tests':
      return 'unit-tests';
    case 'integration':
    case 'integration-tests':
      return 'integration-tests';
    case 'e2e':
    case 'e2e-tests':
      return 'e2e-tests';
    case 'lint':
      return 'lint';
    case 'type-check':
    case 'types':
      return 'type-check';
    case 'security':
    case 'security-audit':
      return 'security-audit';
    default:
      return undefined;
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupeStringArray(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function inferVerificationSurface(task: any, targetAgentId: string | null): VerificationSurfaceContract['surface'] {
  const explicitSurface = [task.surface, task.input?.surface, task.payload?.surface, task.constraints?.surface]
    .find((value) => typeof value === 'string' && value.trim().length > 0);
  if (typeof explicitSurface === 'string') {
    const normalized = explicitSurface.trim().toLowerCase();
    if (normalized === 'docs' || normalized === 'public-proof' || normalized === 'workflow' || normalized === 'runtime' || normalized === 'code') {
      return normalized as VerificationSurfaceContract['surface'];
    }
  }

  const targetHint = `${targetAgentId ?? ''} ${task.target ?? ''} ${task.type ?? ''}`.toLowerCase();
  if (targetHint.includes('doc') || targetHint.includes('content') || targetHint.includes('summary')) return 'docs';
  if (targetHint.includes('reddit') || targetHint.includes('proof') || targetHint.includes('public')) return 'public-proof';
  if (targetHint.includes('workflow') || targetHint.includes('integration')) return 'workflow';
  if (targetHint.includes('monitor') || targetHint.includes('security')) return 'runtime';
  return 'code';
}

function collectSurfaceEvidence(task: any): string[] {
  return dedupeStringArray([
    ...asStringArray(task.evidence),
    ...asStringArray(task.input?.evidence),
    ...asStringArray(task.payload?.evidence),
    ...asStringArray(task.references),
    ...asStringArray(task.input?.references),
    ...asStringArray(task.payload?.references),
  ]);
}

function resolveTargetAgentId(task: any): string | null {
  const input =
    task.input && typeof task.input === 'object' ? task.input : {};
  const payload =
    task.payload && typeof task.payload === 'object' ? task.payload : {};
  const constraints =
    task.constraints && typeof task.constraints === 'object'
      ? task.constraints
      : {};

  const explicitCandidate = [
    input.targetAgentId,
    payload.targetAgentId,
    task.targetAgentId,
    constraints.targetAgentId,
  ].find((value) => typeof value === 'string' && value.trim().length > 0);

  if (typeof explicitCandidate === 'string') {
    return explicitCandidate.trim();
  }

  const targetCandidate = [input.target, payload.target, task.target, constraints.target].find(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
  if (typeof targetCandidate === 'string' && targetCandidate.endsWith('-agent')) {
    return targetCandidate.trim();
  }

  return null;
}

function sortIsoDescending(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort((left, right) => Date.parse(right) - Date.parse(left));
}

function collectIncidentContext(
  task: any,
  state: RuntimeState,
): {
  incident: VerificationContext['incident'];
  repairIds: string[];
  runIds: string[];
  serviceIds: string[];
  affectedSurfaces: string[];
} {
  const payload =
    task.payload && typeof task.payload === 'object' ? task.payload : {};
  const incidentId =
    typeof task.incidentId === 'string'
      ? task.incidentId
      : typeof task.input?.incidentId === 'string'
        ? task.input.incidentId
        : typeof payload.incidentId === 'string'
          ? payload.incidentId
        : null;
  const repairIds = dedupeStringArray([
    ...asStringArray(task.repairIds),
    ...asStringArray(task.input?.repairIds),
    ...asStringArray(payload.repairIds),
  ]);
  const runIds = dedupeStringArray([
    ...asStringArray(task.runIds),
    ...asStringArray(task.input?.runIds),
    ...asStringArray(payload.runIds),
  ]);
  const serviceIds = dedupeStringArray([
    ...asStringArray(task.serviceIds),
    ...asStringArray(task.input?.serviceIds),
    ...asStringArray(payload.serviceIds),
  ]);
  const affectedSurfaces = dedupeStringArray([
    ...asStringArray(task.affectedSurfaces),
    ...asStringArray(task.input?.affectedSurfaces),
    ...asStringArray(payload.affectedSurfaces),
  ]);

  const incidentRecord =
    incidentId && Array.isArray(state.incidentLedger)
      ? state.incidentLedger.find((incident) => incident.incidentId === incidentId) ?? null
      : null;

  if (!incidentRecord) {
    return {
      incident: incidentId
        ? {
            incidentId,
            classification: null,
            severity: null,
            status: 'resolved-or-missing',
            owner: null,
            remediationStatus: null,
            remediationTaskStatuses: {},
            summary: 'Referenced incident is not currently active in runtime state.',
          }
        : null,
      repairIds,
      runIds,
      serviceIds,
      affectedSurfaces,
    };
  }

  const incidentRunIds = dedupeStringArray([
    ...runIds,
    ...asStringArray(incidentRecord.linkedRunIds),
    ...((incidentRecord.remediationTasks ?? [])
      .map((taskRecord) =>
        typeof taskRecord.runId === 'string' ? taskRecord.runId : null,
      )
      .filter((value): value is string => Boolean(value))),
  ]);
  const incidentRepairIds = dedupeStringArray([
    ...repairIds,
    ...asStringArray(incidentRecord.linkedRepairIds),
  ]);
  const incidentServiceIds = dedupeStringArray([
    ...serviceIds,
    ...asStringArray(incidentRecord.linkedServiceIds),
  ]);
  const incidentAffectedSurfaces = dedupeStringArray([
    ...affectedSurfaces,
    ...asStringArray(incidentRecord.affectedSurfaces),
  ]);

  const remediationTaskStatuses = countByStatus(
    (incidentRecord.remediationTasks ?? []).map((taskRecord) => ({
      status: taskRecord.status,
    })),
  );

  return {
    incident: {
      incidentId,
      classification:
        typeof incidentRecord.classification === 'string'
          ? incidentRecord.classification
          : null,
      severity:
        typeof incidentRecord.severity === 'string' ? incidentRecord.severity : null,
      status:
        typeof incidentRecord.status === 'string' ? incidentRecord.status : null,
      owner:
        typeof incidentRecord.owner === 'string' ? incidentRecord.owner : null,
      remediationStatus:
        typeof incidentRecord.remediation?.status === 'string'
          ? incidentRecord.remediation.status
          : null,
      remediationTaskStatuses,
      summary:
        typeof incidentRecord.summary === 'string' ? incidentRecord.summary : null,
    },
    repairIds: incidentRepairIds,
    runIds: incidentRunIds,
    serviceIds: incidentServiceIds,
    affectedSurfaces: incidentAffectedSurfaces,
  };
}

function buildVerificationContext(task: any, state: RuntimeState): VerificationContext {
  const targetAgentId = resolveTargetAgentId(task);
  const incidentContext = collectIncidentContext(task, state);
  const incidentContextMissing =
    incidentContext.incident?.status === 'resolved-or-missing';
  const relatedRepairs = (state.repairRecords ?? []).filter((repair) => {
    if (
      incidentContext.repairIds.length > 0 &&
      typeof repair.repairId === 'string' &&
      incidentContext.repairIds.includes(repair.repairId)
    ) {
      return true;
    }
    if (
      incidentContext.runIds.length > 0 &&
      typeof repair.repairRunId === 'string' &&
      incidentContext.runIds.includes(repair.repairRunId)
    ) {
      return true;
    }
    return false;
  });
  const relatedWorkflowEvents = (state.workflowEvents ?? []).filter((event) => {
    if (
      incidentContext.runIds.length > 0 &&
      typeof event.runId === 'string' &&
      incidentContext.runIds.includes(event.runId)
    ) {
      return true;
    }
    if (
      typeof task.id === 'string' &&
      typeof event.taskId === 'string' &&
      event.taskId === task.id
    ) {
      return true;
    }
    return false;
  });
  const relatedRelationships = (state.relationshipObservations ?? []).filter((observation) => {
    if (
      targetAgentId &&
      observation.relationship === 'verifies-agent' &&
      normalizeAgentIdFromNode(observation.to) === targetAgentId
    ) {
      return true;
    }
    if (
      incidentContext.runIds.length > 0 &&
      typeof observation.runId === 'string' &&
      incidentContext.runIds.includes(observation.runId)
    ) {
      return true;
    }
    return false;
  });

  const workflowByStage = relatedWorkflowEvents.reduce<Record<string, number>>(
    (acc, event) => {
      const stage = typeof event.stage === 'string' ? event.stage : 'unknown';
      acc[stage] = (acc[stage] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const stopCodes = Array.from(
    new Set(
      relatedWorkflowEvents
        .map((event) =>
          typeof event.stopCode === 'string' && event.stopCode.length > 0
            ? event.stopCode
            : null,
        )
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const relationshipSummary = summarizeRelationshipObservations(relatedRelationships);
  const runScopedRelationshipEvidence = relatedRelationships.filter((observation) => {
    if (
      incidentContext.runIds.length > 0 &&
      typeof observation.runId === 'string' &&
      incidentContext.runIds.includes(observation.runId)
    ) {
      return true;
    }
    if (
      incidentContext.runIds.length > 0 &&
      typeof observation.targetRunId === 'string' &&
      incidentContext.runIds.includes(observation.targetRunId)
    ) {
      return true;
    }
    return false;
  });
  const priorityIncidents = buildIncidentPriorityQueue(state.incidentLedger ?? [])
    .filter((incident) => {
      if (
        incidentContext.incident?.incidentId &&
        incident.incidentId === incidentContext.incident.incidentId
      ) {
        return true;
      }
      if (
        targetAgentId &&
        incident.linkedServiceIds.some((serviceId) => serviceId.includes(targetAgentId))
      ) {
        return true;
      }
      if (incidentContext.serviceIds.length > 0) {
        return incident.linkedServiceIds.some((serviceId) =>
          incidentContext.serviceIds.includes(serviceId),
        );
      }
      return false;
    })
    .slice(0, 5)
    .map((incident) => ({
      incidentId: incident.incidentId,
      classification: incident.classification,
      severity: incident.severity,
      status: incident.status,
      priorityScore: incident.priorityScore,
      nextAction: incident.nextAction,
      blockers: incident.blockers,
    }));
  const currentIncidentId = incidentContext.incident?.incidentId ?? null;
  const workflowWatchSource =
    relatedWorkflowEvents.length > 0
      ? relatedWorkflowEvents
      : incidentContext.runIds.length > 0 ||
          incidentContext.repairIds.length > 0 ||
          Boolean(currentIncidentId)
        ? []
        : state.workflowEvents ?? [];
  const workflowWatch = buildWorkflowBlockerSummary(
    workflowWatchSource,
  );
  const verificationSignals: string[] = [];
  const evidence: string[] = [];

  if ((relationshipSummary.total ?? 0) === 0 && targetAgentId) {
    verificationSignals.push(
      `No runtime verification relationship observed yet for ${targetAgentId}.`,
    );
  }
  if (
    relatedWorkflowEvents.length === 0 &&
    incidentContext.runIds.length > 0 &&
    runScopedRelationshipEvidence.length === 0 &&
    relatedRepairs.length === 0 &&
    !incidentContextMissing
  ) {
    verificationSignals.push('No workflow evidence matched the referenced run IDs.');
  }
  if (
    relatedRepairs.some((repair) => repair.status === 'failed')
  ) {
    verificationSignals.push('One or more related repairs remain failed or error-marked.');
  }
  if (workflowWatch.totalStopSignals > 0) {
    verificationSignals.push('Workflow stop signals are still present in runtime evidence.');
  }
  if (
    !incidentContextMissing &&
    priorityIncidents.some(
      (incident) => incident.severity === 'critical' && incident.incidentId !== currentIncidentId,
    )
  ) {
    verificationSignals.push('A critical incident remains open in the verification context.');
  }

  if (incidentContext.incident?.incidentId) {
    evidence.push(`incident:${incidentContext.incident.incidentId}`);
    if (incidentContextMissing) {
      evidence.push('incident-context:resolved-or-missing');
    }
  }
  if (targetAgentId) {
    evidence.push(`target-agent:${targetAgentId}`);
  }
  if (incidentContext.serviceIds.length > 0) {
    evidence.push(`services:${incidentContext.serviceIds.join(',')}`);
  }
  if (incidentContext.affectedSurfaces.length > 0) {
    evidence.push(`surfaces:${incidentContext.affectedSurfaces.join(',')}`);
  }
  if (stopCodes.length > 0) {
    evidence.push(`workflow-stop-codes:${stopCodes.join(',')}`);
  }

  return {
    incident: incidentContext.incident,
    repairs: {
      total: relatedRepairs.length,
      byStatus: countByStatus(relatedRepairs),
      latestCompletedAt:
        sortIsoDescending(relatedRepairs.map((repair) => repair.completedAt)).at(0) ?? null,
      latestVerifiedAt:
        sortIsoDescending(relatedRepairs.map((repair) => repair.verifiedAt)).at(0) ?? null,
    },
    workflow: {
      totalEvents: relatedWorkflowEvents.length,
      latestEventAt:
        sortIsoDescending(relatedWorkflowEvents.map((event) => event.timestamp)).at(0) ??
        null,
      byStage: workflowByStage,
      stopCodes,
    },
    relationships: {
      total: relationshipSummary.total,
      lastObservedAt: relationshipSummary.lastObservedAt,
      byRelationship: relationshipSummary.byRelationship,
      targetAgentId,
    },
    affectedSurfaces: incidentContext.affectedSurfaces,
    serviceIds: incidentContext.serviceIds,
    verificationSignals,
    evidence,
    priorityIncidents,
    workflowWatch,
  };
}

function buildRequest(task: any): QaRequest {
  const input =
    task.input && typeof task.input === 'object' ? task.input : {};
  const payload =
    task.payload && typeof task.payload === 'object' ? task.payload : {};
  const constraints =
    task.constraints && typeof task.constraints === 'object'
      ? task.constraints
      : {};

  const explicitMode =
    normalizeMode(input.mode) ??
    normalizeMode(payload.mode) ??
    normalizeMode(task.mode) ??
    normalizeMode(constraints.mode);
  const dryRun =
    explicitMode === 'dry-run' ||
    input.dryRun === true ||
    payload.dryRun === true ||
    task.dryRun === true ||
    constraints.dryRun === true;

  const requestedCommand =
    (typeof input.testCommand === 'string' && input.testCommand.trim()) ||
    (typeof payload.testCommand === 'string' && payload.testCommand.trim()) ||
    (typeof input.command === 'string' && input.command.trim()) ||
    (typeof payload.command === 'string' && payload.command.trim()) ||
    (typeof task.testCommand === 'string' && task.testCommand.trim()) ||
    (typeof constraints.testCommand === 'string' &&
      constraints.testCommand.trim()) ||
    mapSuiteToCommand(task.suite);

  return {
    mode: dryRun ? 'dry-run' : 'execute',
    testCommand: requestedCommand || (dryRun ? DEFAULT_DRY_RUN_COMMAND : undefined),
    timeout: Number(
      input.timeout ?? constraints.timeout ?? agentConfig?.constraints?.timeout,
    ) || 300000,
    collectCoverage: Boolean(
      input.collectCoverage ?? constraints.collectCoverage ?? false,
    ),
  };
}

async function withWorkingDirectory<T>(
  targetDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previousDir = process.cwd();
  process.chdir(targetDir);
  try {
    return await fn();
  } finally {
    process.chdir(previousDir);
  }
}

function buildDryRunResult(
  taskId: string,
  agentId: string,
  request: QaRequest,
  runnerData: Record<string, any> = {},
) {
  return {
    taskId,
    success: true,
    dryRun: true,
    executionMode: 'dry-run',
    outcomeKind: 'dry-run',
    outcomeSummary:
      typeof runnerData.outcomeSummary === 'string' && runnerData.outcomeSummary.length > 0
        ? runnerData.outcomeSummary
        : request.testCommand && request.testCommand.length > 0
          ? `dry-run accepted for ${request.testCommand}`
          : 'dry-run accepted with no runner command executed',
    executedCommand:
      typeof runnerData.command === 'string' && runnerData.command.length > 0
        ? runnerData.command
        : request.testCommand ?? null,
    testsRun: 0,
    testsPassed: 0,
    totalChecks: 0,
    passedChecks: 0,
    agentId,
    report: {
      timestamp: new Date().toISOString(),
      taskId,
      dryRun: true,
      verdict: 'DRY RUN',
      summary: {
        passed: 0,
        failed: 0,
        skipped: 0,
      },
      notes: [
        typeof runnerData.command === 'string' && runnerData.command.length > 0
          ? `testRunner validated ${runnerData.command} without executing it.`
          : 'No testRunner command executed in dry-run mode.',
      ],
    },
    results: [],
    completedAt: new Date().toISOString(),
  };
}

async function runTestRunner(
  executeSkill: ExecuteSkillFn,
  agentId: string,
  request: QaRequest,
) {
  const validationInput = {
    command: request.testCommand,
    timeout: request.timeout,
    collectCoverage: request.collectCoverage,
    mode: 'dry-run',
    dryRun: true,
  };

  const validationResult = await executeSkill(
    'testRunner',
    validationInput,
    agentId,
  );

  if (request.mode === 'dry-run' || !validationResult.success || !validationResult.data) {
    return validationResult;
  }

  const executionInput = {
    command: request.testCommand,
    timeout: request.timeout,
    collectCoverage: request.collectCoverage,
    mode: 'execute',
    dryRun: false,
  };

  return withWorkingDirectory(orchestratorWorkingDir, () =>
    executeSkill('testRunner', executionInput, agentId),
  );
}

function buildClosureRecommendation(args: {
  context: VerificationContext;
  passed: boolean;
  evidenceQuality: 'strong' | 'partial' | 'minimal';
  reproducibility: 'verified' | 'failed' | 'unproven';
  dryRun?: boolean;
}): ClosureRecommendation {
  const { context, passed, evidenceQuality, reproducibility, dryRun } = args;
  const incidentContextMissing =
    context.incident?.status === 'resolved-or-missing';

  if (dryRun) {
    return {
      decision: 'keep-open',
      allowClosure: false,
      confidence: 'low',
      summary: 'Dry-run validation cannot close an incident or certify a remediation outcome.',
      nextActions: [
        'Run execute mode for bounded verification.',
        'Capture runtime evidence after remediation completes.',
      ],
    };
  }

  if (!passed || reproducibility === 'failed') {
    return {
      decision: 'escalate',
      allowClosure: false,
      confidence: 'high',
      summary: 'Verification failed; incident closure is not permitted.',
      nextActions: [
        'Inspect the failing command output.',
        'Review remediation blockers and rerun verification after repair.',
      ],
    };
  }

  if (incidentContextMissing) {
    return {
      decision: 'close-incident',
      allowClosure: true,
      confidence: evidenceQuality === 'strong' ? 'high' : 'medium',
      summary:
        'Verification passed and the referenced incident is already missing from runtime state; treating the stale verifier context as reconciled.',
      nextActions: [
        'Confirm the incident remains absent from runtime truth.',
        'Keep the affected surfaces on watch for recurrence.',
      ],
    };
  }

  if (context.verificationSignals.length > 0 || evidenceQuality === 'minimal') {
    return {
      decision: 'keep-open',
      allowClosure: false,
      confidence: evidenceQuality === 'minimal' ? 'medium' : 'high',
      summary:
        context.verificationSignals[0] ??
        'Runtime evidence is still too weak to support closure.',
      nextActions: [
        'Reconcile runtime truth and relationship evidence.',
        'Run another verifier pass after missing evidence appears.',
      ],
    };
  }

  return {
    decision: 'close-incident',
    allowClosure: true,
    confidence: evidenceQuality === 'strong' ? 'high' : 'medium',
    summary: 'Verification passed with enough runtime evidence to support closure.',
    nextActions: [
      'Mark the incident resolved if runtime reconciliation also agrees.',
      'Keep the incident on watch for recurrence.',
    ],
  };
}

function buildVerificationAssessment(args: {
  context: VerificationContext;
  dryRun?: boolean;
  passed: boolean;
  evidenceQuality: 'strong' | 'partial' | 'minimal';
  reproducibility: 'verified' | 'failed' | 'unproven';
}): VerificationAssessment {
  const { context, dryRun, passed, evidenceQuality, reproducibility } = args;

  if (dryRun) {
    return {
      correctness: 'provisional',
      regressionRisk: 'medium',
      policyFit: 'bounded-test-runner-dry-run',
    };
  }

  if (!passed || reproducibility === 'failed') {
    return {
      correctness: 'failed',
      regressionRisk: 'high',
      policyFit: 'bounded-test-runner-escalation',
    };
  }

  const elevatedRisk =
    context.workflowWatch.totalStopSignals > 0 ||
    context.priorityIncidents.some((incident) => incident.severity === 'critical') ||
    Number(context.repairs.byStatus.failed ?? 0) > 0;

  return {
    correctness: evidenceQuality === 'strong' ? 'verified' : 'provisional',
    regressionRisk: elevatedRisk ? 'medium' : 'low',
    policyFit: 'bounded-test-runner',
  };
}

function buildVerificationTrace(args: {
  taskId: string;
  request: QaRequest;
  targetAgentId: string | null;
  context: VerificationContext;
  repairIds: string[];
  runIds: string[];
  closureRecommendation: ClosureRecommendation;
  evidenceQuality: 'strong' | 'partial' | 'minimal';
  reproducibility: 'verified' | 'failed' | 'unproven';
  assessment: VerificationAssessment;
}): VerificationTrace {
  const {
    taskId,
    request,
    targetAgentId,
    context,
    repairIds,
    runIds,
    closureRecommendation,
    evidenceQuality,
    reproducibility,
    assessment,
  } = args;

  return {
    traceId: `verification:${taskId}`,
    generatedAt: new Date().toISOString(),
    executionMode: request.mode,
    executedCommand:
      typeof request.testCommand === 'string' && request.testCommand.length > 0
        ? request.testCommand
        : null,
    targetAgentId,
    incidentId: context.incident?.incidentId ?? null,
    repairIds,
    runIds,
    serviceIds: context.serviceIds,
    affectedSurfaces: context.affectedSurfaces,
    correctness: assessment.correctness,
    evidenceQuality,
    reproducibility,
    regressionRisk: assessment.regressionRisk,
    policyFit: assessment.policyFit,
    closureDecision: closureRecommendation.decision,
    allowClosure: closureRecommendation.allowClosure,
    summary: closureRecommendation.summary,
    evidence: context.evidence,
    workflowStopSignals: context.workflowWatch.totalStopSignals,
    priorityIncidentCount: context.priorityIncidents.length,
    repairCount: context.repairs.total,
    relationshipCount: context.relationships.total,
  };
}

function buildVerificationAuthority(args: {
  task: any;
  context: VerificationContext;
  targetAgentId: string | null;
  repairIds: string[];
  runIds: string[];
  closureRecommendation: ClosureRecommendation;
  dryRun?: boolean;
}): VerificationAuthority {
  const {
    task,
    context,
    targetAgentId,
    repairIds,
    runIds,
    closureRecommendation,
    dryRun,
  } = args;

  const targetKind: VerificationAuthority['targetKind'] =
    context.incident?.incidentId
      ? 'incident'
      : repairIds.length > 0
        ? 'repair'
        : targetAgentId
          ? 'agent'
          : runIds.length > 0
            ? 'workflow-run'
            : 'workspace';
  const targetId =
    context.incident?.incidentId ??
    repairIds[0] ??
    targetAgentId ??
    runIds[0] ??
    (typeof task.target === 'string' ? task.target : null);
  const blockers = [
    ...(dryRun ? ['dry-run cannot authorize closure'] : []),
    ...context.verificationSignals,
  ];
  const requiredEvidence = [
    'bounded test execution',
    'runtime relationship evidence',
    'workflow stop reconciliation',
    ...(context.incident?.incidentId ? ['incident ledger state'] : []),
    ...(repairIds.length > 0 ? ['repair status reconciliation'] : []),
  ];

  let authorityLevel: VerificationAuthority['authorityLevel'] = 'conditional';
  if (dryRun) {
    authorityLevel = 'advisory';
  } else if (closureRecommendation.allowClosure) {
    authorityLevel = 'closure-authorized';
  } else if (closureRecommendation.decision === 'escalate') {
    authorityLevel = 'escalation-required';
  }

  return {
    targetKind,
    targetId,
    authorityLevel,
    closureEligible: closureRecommendation.allowClosure,
    escalationRequired: closureRecommendation.decision === 'escalate',
    blockers,
    requiredEvidence,
  };
}

function buildVerificationSurfaceContract(args: {
  task: any;
  request: QaRequest;
  targetAgentId: string | null;
}): VerificationSurfaceContract {
  const { task, request, targetAgentId } = args;
  const surface = inferVerificationSurface(task, targetAgentId);
  const evidence = collectSurfaceEvidence(task);
  const requiresAnchors = surface === 'docs' || surface === 'public-proof' || surface === 'workflow';
  const blockers = [
    ...(requiresAnchors && evidence.length === 0 ? [`${surface} verification requires evidence anchors or references`] : []),
    ...(surface === 'public-proof' && request.mode === 'execute' ? ['public-proof verification stays review-led even when bounded execution exists'] : []),
  ];

  return {
    surface,
    acceptanceMode:
      surface === 'code'
        ? 'bounded-execute'
        : surface === 'runtime'
          ? 'hybrid'
          : 'evidence-review',
    requiredEvidence:
      surface === 'code'
        ? ['bounded test execution']
        : surface === 'runtime'
          ? ['bounded test execution', 'runtime evidence anchors']
          : ['evidence anchors', 'references or linked artifacts'],
    blockers,
    refusalReason: blockers[0] ?? null,
  };
}

function buildAcceptanceCoverage(args: {
  surfaceContract: VerificationSurfaceContract;
  context: VerificationContext;
  closureRecommendation?: ClosureRecommendation;
  task: any;
}): AcceptanceCoverage {
  const evidenceAnchorsSupplied = collectSurfaceEvidence(args.task).length;
  let closureReadiness: AcceptanceCoverage['closureReadiness'] = 'ready';
  if (args.surfaceContract.refusalReason || evidenceAnchorsSupplied === 0 && args.surfaceContract.acceptanceMode === 'evidence-review') {
    closureReadiness = 'needs-evidence';
  }
  if (args.closureRecommendation?.decision === 'escalate') {
    closureReadiness = 'escalate';
  }
  return {
    surface: args.surfaceContract.surface,
    acceptanceMode: args.surfaceContract.acceptanceMode,
    evidenceAnchorsSupplied,
    runtimeSignals: args.context.verificationSignals.length,
    closureReadiness,
  };
}

function buildRefusalProfile(args: {
  surfaceContract: VerificationSurfaceContract;
  request: QaRequest;
}): RefusalProfile {
  const { surfaceContract, request } = args;
  const executeRequested = request.mode === 'execute';
  const refused =
    executeRequested &&
    surfaceContract.acceptanceMode !== 'bounded-execute' &&
    typeof surfaceContract.refusalReason === 'string';

  return {
    surface: surfaceContract.surface,
    acceptanceMode: surfaceContract.acceptanceMode,
    executeRequested,
    refused,
    reason: refused ? surfaceContract.refusalReason : null,
    blockerCount: surfaceContract.blockers.length,
  };
}

function buildClosureContract(args: {
  verificationAuthority: VerificationAuthority;
  closureRecommendation: ClosureRecommendation;
  context: VerificationContext;
}): ClosureContract {
  const primaryRepairStatus = Object.entries(args.context.repairs.byStatus)
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

  return {
    targetKind: args.verificationAuthority.targetKind,
    targetId: args.verificationAuthority.targetId,
    closeAllowed: args.closureRecommendation.allowClosure,
    reopenOnFailure: args.closureRecommendation.allowClosure,
    unresolvedSignals: args.context.verificationSignals.length,
    requiredFollowups: Array.from(
      new Set([
        ...args.closureRecommendation.nextActions,
        ...args.verificationAuthority.requiredEvidence,
      ]),
    ).slice(0, 6),
    incidentStatus: args.context.incident?.status ?? null,
    repairStatus: primaryRepairStatus,
  };
}

function buildReproducibilityProfile(args: {
  verificationTrace: VerificationTrace;
}): ReproducibilityProfile {
  return {
    reproducibility: args.verificationTrace.reproducibility,
    evidenceQuality: args.verificationTrace.evidenceQuality,
    regressionRisk: args.verificationTrace.regressionRisk,
    workflowStopSignals: args.verificationTrace.workflowStopSignals,
    repairCount: args.verificationTrace.repairCount,
    relationshipCount: args.verificationTrace.relationshipCount,
    priorityIncidentCount: args.verificationTrace.priorityIncidentCount,
  };
}

function buildQaSpecialistFields(args: {
  request: QaRequest;
  surfaceContract: VerificationSurfaceContract;
  status: 'completed' | 'watching' | 'blocked' | 'escalate' | 'refused';
  operatorSummary: string;
  recommendedNextActions?: Array<string | null | undefined>;
  refusalReason?: string | null;
  escalationReason?: string | null;
}) {
  return buildSpecialistOperatorFields({
    role: 'Reality Checker',
    workflowStage:
      args.status === 'refused'
        ? 'verification-refusal'
        : args.request.mode === 'dry-run'
          ? 'verification-preflight'
          : args.status === 'completed'
            ? 'verification-closure'
            : args.status === 'watching'
              ? 'verification-watch'
              : 'verification-escalation',
    deliverable:
      args.request.mode === 'dry-run'
        ? 'bounded verifier preflight with closure guidance and follow-up actions'
        : 'verification verdict with closure guidance, evidence trace, and follow-up actions',
    status: args.status,
    operatorSummary: args.operatorSummary,
    recommendedNextActions: args.recommendedNextActions,
    refusalReason: args.refusalReason,
    escalationReason:
      args.escalationReason ??
      (args.status === 'escalate'
        ? `Escalate because ${args.surfaceContract.surface} verification does not yet have enough safe evidence to authorize closure.`
        : null),
  });
}

async function handleTask(task: any): Promise<any> {
  if (!agentConfig) {
    await loadConfig();
  }

  const agentId = agentConfig.id;
  const taskId = task.id || 'unknown';
  const request = buildRequest(task);
  const runtimeState = await loadRuntimeState<RuntimeState>(
    configPath,
    agentConfig.orchestratorStatePath,
  );
  const initialVerificationContext = buildVerificationContext(task, runtimeState);
  const targetAgentId = resolveTargetAgentId(task);
  const surfaceContract = buildVerificationSurfaceContract({
    task,
    request,
    targetAgentId,
  });
  const repairIds = [
    ...asStringArray(task.repairIds),
    ...asStringArray(task.input?.repairIds),
    ...asStringArray(task.payload?.repairIds),
  ];
  const runIds = dedupeStringArray([
    ...asStringArray(task.runIds),
    ...asStringArray(task.input?.runIds),
    ...asStringArray(task.payload?.runIds),
  ]);

  console.log(`[${agentId}] Starting task: ${taskId}`);

  try {
    if (surfaceContract.refusalReason && request.mode === 'execute' && surfaceContract.acceptanceMode !== 'bounded-execute') {
      return {
        taskId,
        success: false,
        error: surfaceContract.refusalReason,
        agentId,
        ...buildQaSpecialistFields({
          request,
          surfaceContract,
          status: 'refused',
          operatorSummary: `Execute-mode verification was refused for the ${surfaceContract.surface} surface because bounded evidence review is required first.`,
          recommendedNextActions: [
            'Supply the evidence anchors or references required for this verification surface.',
            'Use dry-run or evidence-review mode before requesting execute-mode closure.',
          ],
          refusalReason: `Refused execute mode because ${surfaceContract.refusalReason}.`,
        }),
        verificationSurface: surfaceContract,
        refusalProfile: buildRefusalProfile({
          surfaceContract,
          request,
        }),
        acceptanceCoverage: buildAcceptanceCoverage({
          surfaceContract,
          context: initialVerificationContext,
          task,
        }),
      };
    }

    if (request.mode === 'dry-run') {
      if (!request.testCommand) {
        return {
          taskId,
          success: false,
          error:
            'No QA command resolved for dry-run validation; provide a supported suite or testCommand alias.',
          agentId,
          ...buildQaSpecialistFields({
            request,
            surfaceContract,
            status: 'blocked',
            operatorSummary:
              'Verification preflight could not start because no bounded QA command was resolved for the request.',
            recommendedNextActions: [
              'Provide a supported suite alias or explicit testCommand.',
              'Confirm the target maps to an allowed bounded verifier command before retrying.',
            ],
          }),
        };
      }
    }

    if (!canUseSkill('testRunner')) {
      return {
        taskId,
        success: false,
        error: 'testRunner skill not allowed',
        agentId,
        ...buildQaSpecialistFields({
          request,
          surfaceContract,
          status: 'refused',
          operatorSummary:
            'Verification was refused because the governed testRunner path is not available to this agent.',
          recommendedNextActions: [
            'Restore governed testRunner access for qa-verification-agent.',
            'Do not treat this target as verified until a bounded verifier run succeeds.',
          ],
          refusalReason:
            'Refused verification because testRunner skill access is not allowed for qa-verification-agent.',
        }),
      };
    }

    const executeSkill = await getExecuteSkill();
    const dryRunLabel = request.mode === 'dry-run' ? ' (dry-run)' : '';
    console.log(
      `[${agentId}] Running QA command: ${request.testCommand ?? 'none'}${dryRunLabel} in ${orchestratorWorkingDir}`,
    );

    const testResult = await runTestRunner(executeSkill, agentId, request);

    if (!testResult.success || !testResult.data) {
      return {
        taskId,
        success: false,
        error:
          testResult.error ||
          (testResult.data &&
          typeof testResult.data === 'object' &&
          typeof (testResult.data as Record<string, unknown>).error === 'string'
            ? ((testResult.data as Record<string, unknown>).error as string)
            : undefined) ||
          'testRunner execution failed',
        agentId,
        ...buildQaSpecialistFields({
          request,
          surfaceContract,
          status: 'blocked',
          operatorSummary:
            'Verification started but the bounded testRunner path failed before a trustworthy verdict could be produced.',
          recommendedNextActions: [
            'Inspect the runner error and fix the failing bounded command before retrying.',
            'Keep the target open until a bounded verifier pass produces real evidence.',
          ],
        }),
      };
    }

    const runnerData = testResult.data;
    if (runnerData.dryRun === true || request.mode === 'dry-run') {
      const assessment = buildVerificationAssessment({
        context: initialVerificationContext,
        passed: true,
        evidenceQuality: 'minimal',
        reproducibility: 'unproven',
        dryRun: true,
      });
      const closureRecommendation = buildClosureRecommendation({
        context: initialVerificationContext,
        passed: true,
        evidenceQuality: 'minimal',
        reproducibility: 'unproven',
        dryRun: true,
      });
      const verificationTrace = buildVerificationTrace({
        taskId,
        request,
        targetAgentId,
        context: initialVerificationContext,
        repairIds,
        runIds,
        closureRecommendation,
        evidenceQuality: 'minimal',
        reproducibility: 'unproven',
        assessment,
      });
      const verificationAuthority = buildVerificationAuthority({
        task,
        context: initialVerificationContext,
        targetAgentId,
        repairIds,
        runIds,
        closureRecommendation,
        dryRun: true,
      });
      const closureContract = buildClosureContract({
        verificationAuthority,
        closureRecommendation,
        context: initialVerificationContext,
      });
      const reproducibilityProfile = buildReproducibilityProfile({
        verificationTrace,
      });
      return {
        ...buildDryRunResult(taskId, agentId, request, runnerData),
        ...buildQaSpecialistFields({
          request,
          surfaceContract,
          status: 'watching',
          operatorSummary:
            'Verification preflight completed, but dry-run evidence cannot authorize closure or claim the target is proven safe.',
          recommendedNextActions: closureRecommendation.nextActions,
        }),
        runtimeContext: initialVerificationContext,
        verificationSignals: initialVerificationContext.verificationSignals,
        priorityIncidents: initialVerificationContext.priorityIncidents,
        workflowWatch: initialVerificationContext.workflowWatch,
        verification: {
          correctness: assessment.correctness,
          evidenceQuality: 'minimal',
          reproducibility: 'unproven',
          regressionRisk: assessment.regressionRisk,
          policyFit: assessment.policyFit,
        },
        verificationSurface: surfaceContract,
        refusalProfile: buildRefusalProfile({
          surfaceContract,
          request,
        }),
        acceptanceCoverage: buildAcceptanceCoverage({
          surfaceContract,
          context: initialVerificationContext,
          closureRecommendation,
          task,
        }),
        verificationAuthority,
        verificationTrace,
        closureContract,
        reproducibilityProfile,
        relationships:
          targetAgentId
            ? [
                {
                  from: 'agent:qa-verification-agent',
                  to: `agent:${targetAgentId}`,
                  relationship: 'verifies-agent',
                  detail: `qa-verification-agent prepared dry-run coverage for ${targetAgentId}.`,
                  evidence: initialVerificationContext.evidence,
                },
              ]
            : [],
        toolInvocations: [
          {
            toolId: 'testRunner',
            detail: `qa-verification-agent validated ${request.testCommand ?? 'qa alias'} in dry-run mode.`,
            evidence: initialVerificationContext.evidence,
            classification: 'required',
          },
        ],
        closureRecommendation,
        evidence: initialVerificationContext.evidence,
      };
    }

    const summary =
      runnerData.summary && typeof runnerData.summary === 'object'
        ? runnerData.summary
        : {};
    const summaryTotal =
      Number(summary.passed ?? 0) +
      Number(summary.failed ?? 0) +
      Number(summary.skipped ?? 0);
    const totalChecks = summaryTotal > 0 ? summaryTotal : 1;
    const passedChecks =
      summaryTotal > 0
        ? Number(summary.passed ?? 0)
        : runnerData.passed === true
          ? 1
          : 0;
    const outcomeKind = summaryTotal > 0 ? 'tests' : 'checks';

    if (totalChecks <= 0) {
      return {
        taskId,
        success: false,
        error: 'QA execution completed without any checks being recorded',
        agentId,
        ...buildQaSpecialistFields({
          request,
          surfaceContract,
          status: 'blocked',
          operatorSummary:
            'Verification execution finished without recording any checks, so there is no trustworthy acceptance evidence yet.',
          recommendedNextActions: [
            'Inspect the bounded command output and make sure the verifier records real checks.',
            'Rerun verification only after the runner produces observable checks or test results.',
          ],
        }),
      };
    }

    const postExecutionState = await loadRuntimeState<RuntimeState>(
      configPath,
      agentConfig.orchestratorStatePath,
    );
    const verificationContext = buildVerificationContext(task, postExecutionState);
    const evidenceQuality =
      verificationContext.workflow.totalEvents > 0 &&
      verificationContext.relationships.total > 0
        ? 'strong'
        : verificationContext.workflow.totalEvents > 0 ||
            verificationContext.repairs.total > 0
          ? 'partial'
          : 'minimal';
    const reproducibility =
      totalChecks > 0 && runnerData.passed === true
        ? 'verified'
        : totalChecks > 0
          ? 'failed'
          : 'unproven';
    const closureRecommendation = buildClosureRecommendation({
      context: verificationContext,
      passed: runnerData.passed === true,
      evidenceQuality,
      reproducibility,
    });
    const assessment = buildVerificationAssessment({
      context: verificationContext,
      passed: runnerData.passed === true,
      evidenceQuality,
      reproducibility,
    });
    const verificationTrace = buildVerificationTrace({
      taskId,
      request,
      targetAgentId,
      context: verificationContext,
      repairIds,
      runIds,
      closureRecommendation,
      evidenceQuality,
      reproducibility,
      assessment,
    });
    const verificationAuthority = buildVerificationAuthority({
      task,
      context: verificationContext,
      targetAgentId,
      repairIds,
      runIds,
      closureRecommendation,
    });
    const closureContract = buildClosureContract({
      verificationAuthority,
      closureRecommendation,
      context: verificationContext,
    });
    const reproducibilityProfile = buildReproducibilityProfile({
      verificationTrace,
    });
    const relationships: VerificationRelationshipOutput[] = [];
    if (targetAgentId) {
      relationships.push({
        from: 'agent:qa-verification-agent',
        to: `agent:${targetAgentId}`,
        relationship: 'verifies-agent',
        detail: `qa-verification-agent verified ${targetAgentId} with ${request.testCommand ?? 'bounded verification'}.`,
        evidence: verificationContext.evidence,
      });
    }
    for (const runId of runIds) {
      relationships.push({
        from: 'agent:qa-verification-agent',
        to: `task:${task.type}`,
        relationship: 'depends-on-run',
        detail: `qa-verification-agent relied on workflow evidence from ${runId}.`,
        evidence: [`run:${runId}`],
        targetRunId: runId,
      });
    }

    return {
      taskId,
      success: runnerData.passed === true,
      dryRun: false,
      executionMode: 'execute',
      outcomeKind,
      outcomeSummary:
        outcomeKind === 'tests'
          ? `${passedChecks}/${totalChecks} tests passed`
          : `${passedChecks}/${totalChecks} checks passed`,
      executedCommand: request.testCommand,
      testsRun: totalChecks,
      testsPassed: passedChecks,
      totalChecks,
      passedChecks,
      agentId,
      ...buildQaSpecialistFields({
        request,
        surfaceContract,
        status:
          closureRecommendation.decision === 'escalate'
            ? 'escalate'
            : closureRecommendation.allowClosure
              ? 'completed'
              : 'watching',
        operatorSummary:
          closureRecommendation.allowClosure
            ? 'Verification produced enough reproducible evidence to support closure if runtime reconciliation agrees.'
            : closureRecommendation.summary,
        recommendedNextActions: closureRecommendation.nextActions,
        refusalReason:
          buildRefusalProfile({
            surfaceContract,
            request,
          }).reason,
      }),
      runtimeContext: verificationContext,
      verificationSignals: verificationContext.verificationSignals,
      priorityIncidents: verificationContext.priorityIncidents,
      workflowWatch: verificationContext.workflowWatch,
      verification: {
        correctness: assessment.correctness,
        evidenceQuality,
        reproducibility,
        regressionRisk: assessment.regressionRisk,
        policyFit: assessment.policyFit,
      },
      verificationSurface: surfaceContract,
      refusalProfile: buildRefusalProfile({
        surfaceContract,
        request,
      }),
      acceptanceCoverage: buildAcceptanceCoverage({
        surfaceContract,
        context: verificationContext,
        closureRecommendation,
        task,
      }),
      verificationAuthority,
      verificationTrace,
      closureContract,
      reproducibilityProfile,
      relationships,
      toolInvocations: [
        {
          toolId: 'testRunner',
          detail: `qa-verification-agent executed ${request.testCommand ?? 'qa alias'} against the orchestrator workspace.`,
          evidence: [
            `checks:${totalChecks}`,
            `passed:${passedChecks}`,
            ...verificationContext.evidence.slice(0, 4),
          ],
          classification: 'required',
        },
      ],
      closureRecommendation,
      report: {
        timestamp: new Date().toISOString(),
        taskId,
        verdict: runnerData.passed === true ? 'PASS ✅' : 'FAIL ❌',
        summary: {
          passed: passedChecks,
          failed: totalChecks - passedChecks,
          skipped: Number(summary.skipped ?? 0),
        },
        outcomeKind,
        runtimeContext: {
          incidentStatus: verificationContext.incident?.status ?? null,
          repairCount: verificationContext.repairs.total,
          workflowEvents: verificationContext.workflow.totalEvents,
          relationshipEvents: verificationContext.relationships.total,
          workflowStopSignals: verificationContext.workflowWatch.totalStopSignals,
          priorityIncidents: verificationContext.priorityIncidents.length,
        },
        closureRecommendation,
      },
      results: [
        {
          command: request.testCommand,
          passed: runnerData.passed,
          exitCode: runnerData.exitCode,
          duration: runnerData.duration,
        },
      ],
      evidence: verificationContext.evidence,
      completedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error(`[${agentId}] Error in task ${taskId}:`, error.message);
    return {
      taskId,
      success: false,
      error: error.message,
      agentId,
      ...buildQaSpecialistFields({
        request,
        surfaceContract,
        status: 'blocked',
        operatorSummary:
          'Verification failed before a bounded closure verdict could be produced.',
        recommendedNextActions: [
          'Inspect the verifier error and repair the bounded QA path.',
          'Keep the target open until a new verifier run succeeds with real evidence.',
        ],
      }),
    };
  }
}

async function main(): Promise<void> {
  console.log('[qa-verification] Agent starting...');

  await loadConfig();
  console.log(`[${agentConfig.id}] Ready to accept tasks`);

  const taskArg = process.argv[2];
  if (!taskArg) {
    return;
  }

  try {
    let taskInput: any;
    try {
      const payloadRaw = await fs.readFile(taskArg, 'utf-8');
      taskInput = JSON.parse(payloadRaw);
    } catch {
      taskInput = JSON.parse(taskArg);
    }

    const result = await handleTask(taskInput);
    if (process.env.QA_VERIFICATION_AGENT_RESULT_FILE) {
      const resultDir = path.dirname(process.env.QA_VERIFICATION_AGENT_RESULT_FILE);
      await fs.mkdir(resultDir, { recursive: true });
      await fs.writeFile(
        process.env.QA_VERIFICATION_AGENT_RESULT_FILE,
        JSON.stringify(result, null, 2),
        'utf-8',
      );
    } else {
      console.log('Result:', JSON.stringify(result, null, 2));
    }

    process.exit(0);
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

const directEntryHref = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (directEntryHref === import.meta.url) {
  main().catch(console.error);
}

export { handleTask, loadConfig, canUseSkill };
