import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSpecialistOperatorFields,
  buildAgentRelationshipWindow,
  buildIncidentPriorityQueue,
  buildWorkflowBlockerSummary,
  loadRuntimeState,
  readJsonFile,
  summarizeTaskExecutions,
  type RuntimeAgentServiceState,
  type RuntimeIncidentLedgerRecord,
  type RuntimeStateSubset,
} from "../../shared/runtime-evidence.js";

type WorkflowSurface = "code" | "docs" | "public-proof" | "data" | "runtime";

interface WorkflowStep {
  name?: string;
  agent?: string;
  taskType?: string;
  skillId?: string;
  stage?: string;
  surface?: WorkflowSurface;
  dependsOn?: string[];
  optional?: boolean;
  simulateFailure?: boolean;
}

interface RawWorkflowStep extends WorkflowStep {
  id?: string;
  detail?: string;
  dependsOn?: string[] | string;
}

interface Task {
  id: string;
  type: string;
  steps: RawWorkflowStep[];
}

interface AgentConfigRecord {
  id?: string;
  name?: string;
  orchestratorTask?: string;
  orchestratorStatePath?: string;
  serviceStatePath?: string;
  permissions?: {
    skills?: Record<string, { allowed?: boolean }>;
  };
}

interface RuntimeState extends RuntimeStateSubset {}

interface StepResult {
  name: string;
  agent: string | null;
  success: boolean;
  duration: number;
  output: string;
  status: "ready" | "blocked" | "skipped";
  blockers: string[];
}

interface RelationshipOutput {
  from: string;
  to: string;
  relationship:
    | "coordinates-agent"
    | "feeds-agent"
    | "delegates-task"
    | "depends-on-run"
    | "cross-run-handoff";
  detail: string;
  evidence: string[];
  targetTaskId?: string;
  targetRunId?: string;
}

interface ToolInvocationOutput {
  toolId: string;
  detail: string;
  evidence: string[];
  classification: "required" | "optional";
}

interface WorkflowGraphOutput {
  nodes: Array<{
    id: string;
    kind: "step" | "agent" | "dependency" | "tool";
    label: string;
    status: "ready" | "rerouted" | "blocked" | "skipped";
    detail: string;
  }>;
  edges: Array<{
    id: string;
    from: string;
    to: string;
    relationship: string;
    status: "ready" | "blocked" | "rerouted";
    detail: string;
  }>;
}

interface WorkflowPlan {
  objective: string;
  totalSteps: number;
  readySteps: number;
  blockedSteps: number;
  reroutedSteps: number;
  fallbackDecisions: string[];
  resumePath: string[];
  resumeState: {
    durable: boolean;
    resumeFromStep: string | null;
    resumeCandidates: Array<{
      step: string;
      reason: string;
      blockedBy: string[];
    }>;
    priorBlockedRuns: string[];
  };
  selectedAgents: Array<{
    step: string;
    agentId: string;
    reason: string;
    readinessScore: number;
    taskObserved: boolean;
    taskSucceeded: boolean;
    serviceHeartbeatHealthy: boolean;
    operationalPosture: AgentOperationalPosture;
    relationshipWindow: {
      recentSixHours: number;
      recentTwentyFourHours: number;
      total: number;
    };
  }>;
  executionLanes: Array<{
    agentId: string;
    steps: string[];
    status: "ready" | "blocked" | "rerouted";
    evidence: string[];
  }>;
  workflowProfile: {
    classification: "verification" | "repair" | "publication" | "ingestion" | "mixed";
    dominantSurface: "code" | "docs" | "public-proof" | "data" | "runtime" | "mixed";
    criticalPath: string[];
    coordinationRisks: string[];
    verifierRequired: boolean;
  };
}

interface AgentOperationalPosture {
  status: "strong" | "watching" | "degraded";
  activeIncidents: number;
  criticalIncidents: number;
  blockedRemediations: number;
  pendingVerification: number;
  recentFailures: number;
  summary: string;
}

interface AgentCandidateComparison {
  agentId: string;
  score: number;
  operationalPosture: AgentOperationalPosture;
}

interface AgentCandidateScore {
  agentId: string;
  configRecord: AgentConfigRecord;
  score: number;
  taskObserved: boolean;
  taskSucceeded: boolean;
  serviceHeartbeatHealthy: boolean;
  skillReady: boolean;
  reason: string;
  operationalPosture: AgentOperationalPosture;
  relationshipWindow: ReturnType<typeof buildAgentRelationshipWindow>;
  displacedCandidate: AgentCandidateComparison | null;
}

interface DelegationDecision {
  step: string;
  requestedAgent: string | null;
  selectedAgent: string | null;
  mode: "primary" | "reroute" | "blocked";
  readinessScore: number | null;
  reason: string;
  blockers: string[];
  evidence: string[];
  operationalPosture: AgentOperationalPosture | null;
}

interface ReplayContract {
  durable: boolean;
  replayFromStep: string | null;
  blockedDependencies: string[];
  checkpoints: Array<{
    step: string;
    status: "ready" | "blocked" | "skipped";
    agentId: string | null;
    blockers: string[];
  }>;
  requiredDelegations: Array<{
    step: string;
    agentId: string;
    mode: "primary" | "reroute";
  }>;
}

interface Result {
  success: boolean;
  steps: StepResult[];
  totalTime: number;
  executionTime: number;
  relationships: RelationshipOutput[];
  toolInvocations: ToolInvocationOutput[];
  workflowGraph: WorkflowGraphOutput;
  plan: WorkflowPlan;
  delegationPlan: DelegationDecision[];
  replayContract: ReplayContract;
  handoffPackages: Array<{
    targetAgentId: string;
    payloadType: "workflow-replay" | "verification-review" | "doc-handoff" | "publication-handoff";
    steps: string[];
    reason: string;
  }>;
  operatorSummary: string;
  recommendedNextActions: string[];
  specialistContract: {
    role: string;
    workflowStage: string;
    deliverable: string;
    status: "completed" | "watching" | "blocked" | "escalate" | "refused";
    operatorSummary: string;
    recommendedNextActions: string[];
    refusalReason: string | null;
    escalationReason: string | null;
  };
  dependencyPlan: {
    totalDependencies: number;
    sharedDependencyCount: number;
    blockedDependencyCount: number;
    criticalSteps: Array<{
      step: string;
      dependsOn: string[];
      dependencyCount: number;
      selectedAgent: string | null;
      surface: "code" | "docs" | "public-proof" | "data" | "runtime";
      blockers: string[];
    }>;
  };
  workflowMemory: {
    durable: boolean;
    resumeFromStep: string | null;
    priorBlockedRuns: string[];
    recentStopSignals: number;
    proofStopSignals: number;
    rerouteCount: number;
    checkpointCount: number;
    relationshipWindows: Array<{
      agentId: string;
      recentSixHours: number;
      recentTwentyFourHours: number;
      total: number;
    }>;
    stopLedger: Array<{
      step: string;
      classification: string;
      blockedBy: string[];
      suggestedNextAction: string | null;
    }>;
  };
  reroutes: Array<{ step: string; from: string; to: string; reason: string }>;
  partialCompletion: {
    replayable: boolean;
    completedSteps: string[];
    remainingSteps: string[];
    blockedStep: string | null;
    rerouteCount: number;
  };
  stopClassification: "dependency-blocked" | "agent-missing" | "skill-mismatch" | "simulated-failure" | "complete";
  stopReason: string | null;
  stopCause: {
    step: string;
    classification: "dependency-blocked" | "agent-missing" | "skill-mismatch" | "simulated-failure";
    blockers: string[];
    dependencyBlockers: string[];
    reroutesTried: number;
    resumeStep: string | null;
    verifierRequired: boolean;
    suggestedNextAction: string;
  } | null;
  recoveryPlan: {
    priorityIncidents: Array<{
      incidentId: string;
      severity: string;
      summary: string;
      nextAction: string;
      owner: string | null;
      recommendedOwner: string | null;
      remediationTaskType: string | null;
    }>;
    workflowWatch: ReturnType<typeof buildWorkflowBlockerSummary>;
    verificationHandoff: {
      required: boolean;
      agentId: string;
      reason: string;
    };
    relationshipWindows: Array<{
      agentId: string;
      recentSixHours: number;
      recentTwentyFourHours: number;
      total: number;
    }>;
    resumeCandidates: Array<{
      step: string;
      reason: string;
      blockedBy: string[];
    }>;
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, "../agent.config.json");
const workspaceRoot = resolve(__dirname, "../../..");
const agentsRoot = resolve(workspaceRoot, "agents");

const WORKFLOW_STEP_TEMPLATES: Record<
  string,
  {
    taskType: string;
    skillId?: string;
    surface: WorkflowSurface;
    defaultName: string;
    aliases: string[];
  }
> = {
  "market-research": {
    taskType: "market-research",
    skillId: "sourceFetch",
    surface: "data",
    defaultName: "collect-market-signals",
    aliases: ["market", "research", "web-research"],
  },
  "data-extraction": {
    taskType: "data-extraction",
    skillId: "documentParser",
    surface: "data",
    defaultName: "extract-structured-signal",
    aliases: ["extract", "data-extract", "parse"],
  },
  "normalize-data": {
    taskType: "normalize-data",
    skillId: "normalizer",
    surface: "data",
    defaultName: "normalize-signal-pack",
    aliases: ["normalize", "normalise", "etl"],
  },
  "summarize-content": {
    taskType: "summarize-content",
    skillId: "documentParser",
    surface: "docs",
    defaultName: "compress-findings",
    aliases: ["summarize", "summary", "compress"],
  },
  "content-generate": {
    taskType: "content-generate",
    skillId: "documentParser",
    surface: "docs",
    defaultName: "draft-operator-brief",
    aliases: ["content", "generate", "publish", "docs"],
  },
  "qa-verification": {
    taskType: "qa-verification",
    skillId: "testRunner",
    surface: "code",
    defaultName: "verify-workflow-readiness",
    aliases: ["qa", "verify", "verification", "test"],
  },
  "build-refactor": {
    taskType: "build-refactor",
    skillId: "workspacePatch",
    surface: "code",
    defaultName: "apply-bounded-remediation",
    aliases: ["build", "refactor", "repair", "patch"],
  },
  "security-audit": {
    taskType: "security-audit",
    skillId: "documentParser",
    surface: "runtime",
    defaultName: "audit-trust-boundaries",
    aliases: ["security", "audit"],
  },
  "doc-sync": {
    taskType: "doc-sync",
    skillId: "documentParser",
    surface: "docs",
    defaultName: "sync-knowledge-surface",
    aliases: ["doc-sync", "sync-docs"],
  },
  "drift-repair": {
    taskType: "drift-repair",
    skillId: "documentParser",
    surface: "docs",
    defaultName: "repair-doc-drift",
    aliases: ["drift-repair", "doc-repair"],
  },
};

const WORKFLOW_STEP_TEMPLATE_BY_ALIAS = new Map<string, (typeof WORKFLOW_STEP_TEMPLATES)[string]>();
for (const template of Object.values(WORKFLOW_STEP_TEMPLATES)) {
  WORKFLOW_STEP_TEMPLATE_BY_ALIAS.set(template.taskType, template);
  template.aliases.forEach((alias) => {
    WORKFLOW_STEP_TEMPLATE_BY_ALIAS.set(alias, template);
  });
}

function loadConfig(): AgentConfigRecord {
  return JSON.parse(readFileSync(configPath, "utf-8")) as AgentConfigRecord;
}

function canUseSkill(skillId: string): boolean {
  const config = loadConfig();
  return config.permissions?.skills?.[skillId]?.allowed === true;
}

async function listAgentConfigs() {
  const entries = await readdir(agentsRoot, { withFileTypes: true });
  const configs = new Map<string, AgentConfigRecord>();

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "shared") {
      continue;
    }
    const agentConfigPath = resolve(agentsRoot, entry.name, "agent.config.json");
    try {
      const raw = await readFile(agentConfigPath, "utf-8");
      const parsed = JSON.parse(raw) as AgentConfigRecord;
      if (parsed.id) {
        configs.set(parsed.id, parsed);
      }
    } catch {
      continue;
    }
  }

  return configs;
}

async function loadAgentServiceState(
  agentId: string,
  configRecord: AgentConfigRecord | null,
) {
  if (!configRecord?.serviceStatePath) {
    return null;
  }
  const targetPath = resolve(agentsRoot, agentId, configRecord.serviceStatePath);
  return readJsonFile<RuntimeAgentServiceState | null>(targetPath, null);
}

function normalizeWorkflowToken(value: string) {
  return value.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function parseWorkflowStepDescriptor(value: string | null) {
  if (!value) {
    return {
      template: null,
      label: null,
    };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return {
      template: null,
      label: null,
    };
  }

  const match = trimmed.match(/^([a-z0-9_-]+)\s*(?::|\|)\s*(.+)$/i);
  if (match) {
    const template = WORKFLOW_STEP_TEMPLATE_BY_ALIAS.get(
      normalizeWorkflowToken(match[1]),
    ) ?? null;
    if (template) {
      return {
        template,
        label: match[2].trim() || null,
      };
    }
  }

  const template = WORKFLOW_STEP_TEMPLATE_BY_ALIAS.get(
    normalizeWorkflowToken(trimmed),
  ) ?? null;
  return {
    template,
    label: trimmed,
  };
}

function inferWorkflowTemplate(args: {
  taskType?: string | null;
  name?: string | null;
  detail?: string | null;
}) {
  const explicitTaskType =
    typeof args.taskType === "string" && args.taskType.trim().length > 0
      ? WORKFLOW_STEP_TEMPLATE_BY_ALIAS.get(normalizeWorkflowToken(args.taskType))
      : null;
  if (explicitTaskType) {
    return {
      template: explicitTaskType,
      inferredLabel:
        typeof args.name === "string" && args.name.trim().length > 0
          ? args.name.trim()
          : typeof args.detail === "string" && args.detail.trim().length > 0
            ? args.detail.trim()
            : explicitTaskType.defaultName,
    };
  }

  const fromName = parseWorkflowStepDescriptor(args.name ?? null);
  if (fromName.template) {
    return {
      template: fromName.template,
      inferredLabel: fromName.label ?? fromName.template.defaultName,
    };
  }

  const fromDetail = parseWorkflowStepDescriptor(args.detail ?? null);
  if (fromDetail.template) {
    return {
      template: fromDetail.template,
      inferredLabel: fromDetail.label ?? fromDetail.template.defaultName,
    };
  }

  return {
    template: null,
    inferredLabel:
      typeof args.name === "string" && args.name.trim().length > 0
        ? args.name.trim()
        : typeof args.detail === "string" && args.detail.trim().length > 0
          ? args.detail.trim()
          : null,
  };
}

function buildDefaultWorkflowSteps(workflowType: string) {
  const normalizedType = normalizeWorkflowToken(workflowType || "workflow");

  if (normalizedType.includes("publish") || normalizedType.includes("content")) {
    return [
      {
        name: "collect-market-signals",
        taskType: "market-research",
        skillId: "sourceFetch",
        surface: "data" as WorkflowSurface,
      },
      {
        name: "draft-source-grounded-brief",
        taskType: "content-generate",
        skillId: "documentParser",
        surface: "docs" as WorkflowSurface,
        dependsOn: ["collect-market-signals"],
      },
      {
        name: "verify-publication-readiness",
        taskType: "qa-verification",
        skillId: "testRunner",
        surface: "code" as WorkflowSurface,
        dependsOn: ["draft-source-grounded-brief"],
      },
    ];
  }

  return [
    {
      name: "collect-market-signals",
      taskType: "market-research",
      skillId: "sourceFetch",
      surface: "data" as WorkflowSurface,
    },
    {
      name: "extract-structured-signal",
      taskType: "data-extraction",
      skillId: "documentParser",
      surface: "data" as WorkflowSurface,
      dependsOn: ["collect-market-signals"],
    },
    {
      name: "normalize-signal-pack",
      taskType: "normalize-data",
      skillId: "normalizer",
      surface: "data" as WorkflowSurface,
      dependsOn: ["extract-structured-signal"],
    },
    {
      name: "verify-workflow-readiness",
      taskType: "qa-verification",
      skillId: "testRunner",
      surface: "code" as WorkflowSurface,
      dependsOn: ["normalize-signal-pack"],
    },
  ];
}

function normalizeWorkflowStep(rawStep: RawWorkflowStep, index: number): WorkflowStep {
  const rawId =
    typeof rawStep.id === "string" && rawStep.id.trim().length > 0
      ? rawStep.id.trim()
      : null;
  const rawName =
    typeof rawStep.name === "string" && rawStep.name.trim().length > 0
      ? rawStep.name.trim()
      : null;
  const rawDetail =
    typeof rawStep.detail === "string" && rawStep.detail.trim().length > 0
      ? rawStep.detail.trim()
      : null;
  const inferred = inferWorkflowTemplate({
    taskType: rawStep.taskType ?? null,
    name: rawName ?? rawId,
    detail: rawDetail,
  });
  const autoGeneratedId = rawId !== null && /^step-\d+$/i.test(rawId);
  const normalizedName =
    rawName ??
    (rawId && !autoGeneratedId ? rawId : null) ??
    inferred.inferredLabel ??
    inferred.template?.defaultName ??
    `step-${index + 1}`;
  const normalizedTaskType =
    typeof rawStep.taskType === "string" && rawStep.taskType.trim().length > 0
      ? rawStep.taskType.trim()
      : inferred.template?.taskType;
  const normalizedSkillId =
    typeof rawStep.skillId === "string" && rawStep.skillId.trim().length > 0
      ? rawStep.skillId.trim()
      : inferred.template?.skillId;
  const normalizedSurface =
    rawStep.surface ??
    inferred.template?.surface;
  const dependsOn =
    Array.isArray(rawStep.dependsOn)
      ? rawStep.dependsOn.filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0,
        )
      : typeof rawStep.dependsOn === "string" && rawStep.dependsOn.trim().length > 0
        ? [rawStep.dependsOn.trim()]
        : [];

  return {
    name: normalizedName,
    agent:
      typeof rawStep.agent === "string" && rawStep.agent.trim().length > 0
        ? rawStep.agent.trim()
        : undefined,
    taskType: normalizedTaskType,
    skillId: normalizedSkillId,
    stage:
      typeof rawStep.stage === "string" && rawStep.stage.trim().length > 0
        ? rawStep.stage.trim()
        : undefined,
    surface: normalizedSurface,
    dependsOn,
    optional: rawStep.optional === true,
    simulateFailure: rawStep.simulateFailure === true,
  };
}

function normalizeWorkflowSteps(task: Task) {
  const rawSteps = Array.isArray(task.steps) ? task.steps : [];
  const seededSteps =
    rawSteps.length > 0 ? rawSteps : buildDefaultWorkflowSteps(task.type);
  return seededSteps.map((step, index) => normalizeWorkflowStep(step, index));
}

function resolveDependencyIds(step: WorkflowStep) {
  return Array.isArray(step.dependsOn)
    ? step.dependsOn.filter((value): value is string => typeof value === "string")
    : [];
}

function inferStepSurface(step: WorkflowStep): "code" | "docs" | "public-proof" | "data" | "runtime" {
  if (step.surface) return step.surface;
  const hint = `${step.taskType ?? ""} ${step.skillId ?? ""} ${step.name ?? ""}`.toLowerCase();
  if (hint.includes("doc") || hint.includes("summary") || hint.includes("content")) return "docs";
  if (hint.includes("reddit") || hint.includes("publish") || hint.includes("notice") || hint.includes("proof")) return "public-proof";
  if (hint.includes("extract") || hint.includes("normalize") || hint.includes("market")) return "data";
  if (hint.includes("build") || hint.includes("refactor") || hint.includes("verify") || hint.includes("qa")) return "code";
  return "runtime";
}

function inferWorkflowClassification(steps: WorkflowStep[]): WorkflowPlan["workflowProfile"]["classification"] {
  const taskTypes = steps.map((step) => `${step.taskType ?? ""} ${step.name ?? ""}`.toLowerCase()).join(" ");
  if (taskTypes.includes("verify") || taskTypes.includes("qa")) return "verification";
  if (taskTypes.includes("repair") || taskTypes.includes("remediation")) return "repair";
  if (taskTypes.includes("publish") || taskTypes.includes("content") || taskTypes.includes("reddit")) return "publication";
  if (taskTypes.includes("extract") || taskTypes.includes("normalize") || taskTypes.includes("market")) return "ingestion";
  return "mixed";
}

function incidentTargetsAgent(
  incident: RuntimeIncidentLedgerRecord,
  agentId: string,
) {
  const owners = [
    typeof incident.owner === "string" ? incident.owner : null,
    typeof incident.policy?.preferredOwner === "string"
      ? incident.policy.preferredOwner
      : null,
  ];
  const linkedServices = Array.isArray(incident.linkedServiceIds)
    ? incident.linkedServiceIds
    : [];
  const affectedSurfaces = Array.isArray(incident.affectedSurfaces)
    ? incident.affectedSurfaces
    : [];

  return [...owners, ...linkedServices, ...affectedSurfaces].some(
    (value) => typeof value === "string" && value.includes(agentId),
  );
}

function buildAgentOperationalPosture(args: {
  agentId: string;
  incidents: RuntimeIncidentLedgerRecord[];
  serviceState: RuntimeAgentServiceState | null;
}): AgentOperationalPosture {
  const relevantIncidents = args.incidents.filter((incident) => {
    if (incident.status === "resolved") return false;
    if (incident.classification === "service-runtime") return false;
    return incidentTargetsAgent(incident, args.agentId);
  });
  const criticalIncidents = relevantIncidents.filter(
    (incident) => incident.severity === "critical",
  ).length;
  const blockedRemediations = relevantIncidents.filter((incident) => {
    if (incident.remediation?.status === "blocked") {
      return true;
    }
    return (incident.remediationTasks ?? []).some(
      (task) => task.status === "blocked" || task.status === "failed",
    );
  }).length;
  const pendingVerification = relevantIncidents.filter(
    (incident) =>
      incident.verification?.required === true &&
      incident.verification?.status !== "passed",
  ).length;
  const recentFailures = Number(args.serviceState?.taskPath?.failedRuns ?? 0);
  const lastObservedFailed = args.serviceState?.taskPath?.lastObservedStatus === "failed";

  let status: AgentOperationalPosture["status"] = "strong";
  if (criticalIncidents > 0 || blockedRemediations > 0 || lastObservedFailed) {
    status = "degraded";
  } else if (relevantIncidents.length > 0 || pendingVerification > 0) {
    status = "watching";
  }

  return {
    status,
    activeIncidents: relevantIncidents.length,
    criticalIncidents,
    blockedRemediations,
    pendingVerification,
    recentFailures,
    summary: `${status} posture with ${relevantIncidents.length} active incident(s), ${criticalIncidents} critical, ${blockedRemediations} blocked remediation(s), and ${pendingVerification} pending verification lane(s).`,
  };
}

function hasActiveIncidentPressure(
  incidents: RuntimeIncidentLedgerRecord[],
  agentId: string,
) {
  return incidents.some(
    (incident) =>
      incident.status !== "resolved" &&
      incidentTargetsAgent(incident, agentId),
  );
}

function buildCandidateSelectionReason(
  prefix: string,
  candidate: AgentCandidateScore,
) {
  const comparison =
    candidate.displacedCandidate && candidate.score > candidate.displacedCandidate.score
      ? `; preferred over ${candidate.displacedCandidate.agentId} by ${candidate.score - candidate.displacedCandidate.score} readiness point(s) because that alternative is in ${candidate.displacedCandidate.operationalPosture.status} posture`
      : "";
  return `${prefix}; ${candidate.reason}${comparison}`;
}

function scoreAgentCandidate(args: {
  step: WorkflowStep;
  agentId: string;
  configRecord: AgentConfigRecord;
  serviceState: RuntimeAgentServiceState | null;
  incidents: RuntimeIncidentLedgerRecord[];
  relationshipObservations: RuntimeState["relationshipObservations"];
  runtimeWorkflowWatch: ReturnType<typeof buildWorkflowBlockerSummary>;
}): AgentCandidateScore {
  const { step, agentId, configRecord, serviceState } = args;
  const taskPath = serviceState?.taskPath ?? null;
  const taskObserved =
    Boolean(taskPath?.lastObservedAt) || Number(taskPath?.totalRuns ?? 0) > 0;
  const taskSucceeded =
    Boolean(taskPath?.lastSuccessfulAt) || Number(taskPath?.successfulRuns ?? 0) > 0;
  const serviceHeartbeatHealthy =
    serviceState?.serviceHeartbeat?.status === "ok" ||
    serviceState?.lastStatus === "ok";
  const skillReady =
    typeof step.skillId !== "string" ||
    configRecord.permissions?.skills?.[step.skillId]?.allowed === true;
  const operationalPosture = buildAgentOperationalPosture({
    agentId,
    incidents: args.incidents,
    serviceState,
  });
  const relationshipWindow = buildAgentRelationshipWindow(
    args.relationshipObservations ?? [],
    agentId,
  );
  const stepSurface = inferStepSurface(step);

  let score = 0;
  if (configRecord.orchestratorTask === step.taskType) score += 40;
  if (taskObserved) score += 20;
  if (taskSucceeded) score += 30;
  if (serviceHeartbeatHealthy) score += 10;
  if (skillReady) score += 15;
  if (agentId === step.agent) score += 5;
  if (relationshipWindow.total > 0) score += 4;
  if (relationshipWindow.recentSixHours > 0) score += 6;
  if (relationshipWindow.total === 0 && taskObserved) score -= 4;
  if (operationalPosture.status === "strong") score += 10;
  if (operationalPosture.status === "watching") {
    score -= Math.min(
      10,
      operationalPosture.activeIncidents * 2 + operationalPosture.pendingVerification * 3,
    );
  }
  if (operationalPosture.status === "degraded") score -= 25;
  score -= Math.min(
    20,
    operationalPosture.criticalIncidents * 8 +
      operationalPosture.blockedRemediations * 6,
  );
  if (
    args.runtimeWorkflowWatch.totalStopSignals > 0 &&
    operationalPosture.status !== "strong"
  ) {
    score -= Math.min(10, args.runtimeWorkflowWatch.totalStopSignals);
  }
  if (
    args.runtimeWorkflowWatch.proofStopSignals > 0 &&
    stepSurface === "public-proof"
  ) {
    score -= Math.min(8, args.runtimeWorkflowWatch.proofStopSignals * 2);
  }

  const reasons = [
    configRecord.orchestratorTask === step.taskType
      ? `routes ${step.taskType ?? "workflow work"}`
      : `routes ${configRecord.orchestratorTask ?? "unknown"}`,
    taskSucceeded
      ? "recent task-path success exists"
      : taskObserved
        ? "task-path evidence exists but is not yet green"
        : "no task-path evidence yet",
    serviceHeartbeatHealthy
      ? "service heartbeat is healthy"
      : "service heartbeat is missing or degraded",
    relationshipWindow.recentSixHours > 0
      ? `recent coordination evidence exists (${relationshipWindow.recentSixHours} in the last 6h)`
      : relationshipWindow.total > 0
        ? `historical coordination evidence exists (${relationshipWindow.total} total)`
        : "no observed coordination history yet",
    skillReady
      ? typeof step.skillId === "string"
        ? `allows skill ${step.skillId}`
        : "no specific skill constraint"
      : `does not allow required skill ${step.skillId}`,
    operationalPosture.summary,
    args.runtimeWorkflowWatch.totalStopSignals > 0
      ? `workflow pressure shows ${args.runtimeWorkflowWatch.totalStopSignals} stop signal(s) and ${args.runtimeWorkflowWatch.proofStopSignals} proof stop(s)`
      : "workflow pressure is currently clear",
  ];

  return {
    agentId,
    configRecord,
    score,
    taskObserved,
    taskSucceeded,
    serviceHeartbeatHealthy,
    skillReady,
    reason: reasons.join("; "),
    operationalPosture,
    relationshipWindow,
    displacedCandidate: null,
  };
}

function findBestAgentCandidate(args: {
  step: WorkflowStep;
  agentConfigs: Map<string, AgentConfigRecord>;
  serviceStates: Map<string, RuntimeAgentServiceState | null>;
  incidents: RuntimeIncidentLedgerRecord[];
  relationshipObservations: RuntimeState["relationshipObservations"];
  runtimeWorkflowWatch: ReturnType<typeof buildWorkflowBlockerSummary>;
  excludeAgentId?: string | null;
}) {
  const {
    step,
    agentConfigs,
    serviceStates,
    incidents,
    relationshipObservations,
    runtimeWorkflowWatch,
    excludeAgentId,
  } = args;
  if (!step.taskType) return null;

  const candidates = [...agentConfigs.entries()]
    .filter(([agentId, configRecord]) => {
      if (excludeAgentId && agentId === excludeAgentId) return false;
      return configRecord.orchestratorTask === step.taskType;
    })
    .map(([agentId, configRecord]) =>
      scoreAgentCandidate({
        step,
        agentId,
        configRecord,
        serviceState: serviceStates.get(agentId) ?? null,
        incidents,
        relationshipObservations,
        runtimeWorkflowWatch,
      }),
    )
    .filter((candidate) => candidate.skillReady)
    .sort((left, right) => {
      const postureRank: Record<AgentOperationalPosture["status"], number> = {
        strong: 2,
        watching: 1,
        degraded: 0,
      };
      const postureDelta =
        postureRank[right.operationalPosture.status] -
        postureRank[left.operationalPosture.status];
      if (postureDelta !== 0 && Math.abs(right.score - left.score) <= 50) {
        return postureDelta;
      }
      return right.score - left.score;
    });

  const selected = candidates[0] ?? null;
  if (!selected) {
    return null;
  }

  selected.displacedCandidate =
    candidates[1]
      ? {
          agentId: candidates[1].agentId,
          score: candidates[1].score,
          operationalPosture: candidates[1].operationalPosture,
        }
      : null;

  return selected;
}

async function handleTask(task: Task): Promise<Result> {
  const startTime = Date.now();
  const workflowSteps = normalizeWorkflowSteps(task);
  const executedSteps: StepResult[] = [];
  const relationships: RelationshipOutput[] = [];
  const toolInvocations: ToolInvocationOutput[] = [];
  const workflowNodes: WorkflowGraphOutput["nodes"] = [];
  const workflowEdges: WorkflowGraphOutput["edges"] = [];
  const reroutes: Result["reroutes"] = [];
  const completedSteps = new Set<string>();
  const taskDurations: number[] = [];
  let stopReason: string | null = null;
  let stopClassification: Result["stopClassification"] = "complete";
  let stopStepName: string | null = null;
  let stopBlockers: string[] = [];
  const selectedAgents: WorkflowPlan["selectedAgents"] = [];
  const delegationPlan: DelegationDecision[] = [];
  const resumeCandidates: WorkflowPlan["resumeState"]["resumeCandidates"] = [];

  const config = loadConfig();
  const state = await loadRuntimeState<RuntimeState>(
    configPath,
    process.env.INTEGRATION_AGENT_STATE_FILE ?? config.orchestratorStatePath,
  );
  const agentConfigs = await listAgentConfigs();
  const serviceStates = new Map(
    await Promise.all(
      [...agentConfigs.entries()].map(async ([agentId, configRecord]) => [
        agentId,
        await loadAgentServiceState(agentId, configRecord),
      ]),
    ),
  );
  const incidentQueue = buildIncidentPriorityQueue(state.incidentLedger ?? []);
  const runtimeWorkflowWatch = buildWorkflowBlockerSummary(state.workflowEvents ?? []);

  const integrationRuns = summarizeTaskExecutions(
    state.taskExecutions ?? [],
    ["integration-workflow"],
  );

  for (const [index, step] of workflowSteps.entries()) {
    const stepStartedAt = Date.now();
    const name = step.name ?? `step-${index + 1}`;
    const blockers: string[] = [];
    const requestedAgent = typeof step.agent === "string" ? step.agent : null;
    let agentId = typeof step.agent === "string" ? step.agent : null;
    let configRecord = agentId ? agentConfigs.get(agentId) ?? null : null;
    let selectedReason = "no candidate selected";
    let selectedReadinessScore: number | null = null;
    let selectedOperationalPosture: AgentOperationalPosture | null = null;

    if (!agentId) {
      let selectedCandidate = findBestAgentCandidate({
        step,
        agentConfigs,
        serviceStates,
        incidents: state.incidentLedger ?? [],
        relationshipObservations: state.relationshipObservations ?? [],
        runtimeWorkflowWatch,
      });
      if (
        selectedCandidate &&
        hasActiveIncidentPressure(
          state.incidentLedger ?? [],
          selectedCandidate.agentId,
        )
      ) {
        const alternate = findBestAgentCandidate({
          step,
          agentConfigs,
          serviceStates,
          incidents: state.incidentLedger ?? [],
          relationshipObservations: state.relationshipObservations ?? [],
          runtimeWorkflowWatch,
          excludeAgentId: selectedCandidate.agentId,
        });
        if (
          alternate &&
          alternate.operationalPosture.status === "strong" &&
          selectedCandidate.operationalPosture.status !== "strong"
        ) {
          alternate.displacedCandidate = {
            agentId: selectedCandidate.agentId,
            score: selectedCandidate.score,
            operationalPosture: selectedCandidate.operationalPosture,
          };
          selectedCandidate = alternate;
        }
      }
      if (selectedCandidate) {
        agentId = selectedCandidate.agentId;
        configRecord = selectedCandidate.configRecord;
        selectedReason = buildCandidateSelectionReason(
          `auto-selected ${agentId}`,
          selectedCandidate,
        );
        selectedReadinessScore = selectedCandidate.score;
        selectedOperationalPosture = selectedCandidate.operationalPosture;
        selectedAgents.push({
          step: name,
          agentId,
          reason: selectedReason,
          readinessScore: selectedCandidate.score,
          taskObserved: selectedCandidate.taskObserved,
          taskSucceeded: selectedCandidate.taskSucceeded,
          serviceHeartbeatHealthy: selectedCandidate.serviceHeartbeatHealthy,
          operationalPosture: selectedCandidate.operationalPosture,
          relationshipWindow: {
            recentSixHours: selectedCandidate.relationshipWindow.recentSixHours,
            recentTwentyFourHours: selectedCandidate.relationshipWindow.recentTwentyFourHours,
            total: selectedCandidate.relationshipWindow.total,
          },
        });
      } else {
        blockers.push("missing agent");
      }
    } else if (!configRecord) {
      blockers.push(`unknown agent ${agentId}`);
      selectedReason = `requested ${agentId}, but no manifest was found`;
    } else {
      const selectedCandidate = scoreAgentCandidate({
        step,
        agentId,
        configRecord,
        serviceState: serviceStates.get(agentId) ?? null,
        incidents: state.incidentLedger ?? [],
        relationshipObservations: state.relationshipObservations ?? [],
        runtimeWorkflowWatch,
      });
      selectedReason = buildCandidateSelectionReason(
        `selected ${agentId}`,
        selectedCandidate,
      );
      selectedReadinessScore = selectedCandidate.score;
      selectedOperationalPosture = selectedCandidate.operationalPosture;
      selectedAgents.push({
        step: name,
        agentId,
        reason: selectedReason,
        readinessScore: selectedCandidate.score,
        taskObserved: selectedCandidate.taskObserved,
        taskSucceeded: selectedCandidate.taskSucceeded,
        serviceHeartbeatHealthy: selectedCandidate.serviceHeartbeatHealthy,
        operationalPosture: selectedCandidate.operationalPosture,
        relationshipWindow: {
          recentSixHours: selectedCandidate.relationshipWindow.recentSixHours,
          recentTwentyFourHours: selectedCandidate.relationshipWindow.recentTwentyFourHours,
          total: selectedCandidate.relationshipWindow.total,
        },
      });
    }

    if (step.simulateFailure === true) {
      blockers.push(`simulated failure requested for ${name}`);
    }

    const dependencyIds = resolveDependencyIds(step);
    for (const dependencyId of dependencyIds) {
      if (!completedSteps.has(dependencyId)) {
        blockers.push(`dependency ${dependencyId} not satisfied`);
      }
    }

    if (configRecord && step.taskType && configRecord.orchestratorTask !== step.taskType) {
      blockers.push(
        `${agentId} routes ${configRecord.orchestratorTask ?? "no-task"} instead of ${step.taskType}`,
      );
    }

    if (
      configRecord &&
      typeof step.skillId === "string" &&
      configRecord.permissions?.skills?.[step.skillId]?.allowed !== true
    ) {
      blockers.push(`${agentId} manifest does not allow skill ${step.skillId}`);
    }

    let rerouted = false;
    if (blockers.length > 0 && step.optional !== true) {
      const recoverable =
        blockers.some((blocker) => blocker.startsWith("unknown agent")) ||
        blockers.some((blocker) => blocker.includes("routes")) ||
        blockers.some((blocker) => blocker.includes("manifest does not allow skill"));
      if (recoverable) {
        const fallback = findBestAgentCandidate({
          step,
          agentConfigs,
          serviceStates,
          incidents: state.incidentLedger ?? [],
          relationshipObservations: state.relationshipObservations ?? [],
          runtimeWorkflowWatch,
          excludeAgentId: agentId,
        });
        if (fallback) {
          const previousAgent = agentId ?? "unknown-agent";
          agentId = fallback.agentId;
          configRecord = fallback.configRecord;
          blockers.length = 0;
          rerouted = true;
          selectedReason = buildCandidateSelectionReason(
            `rerouted from ${previousAgent}`,
            fallback,
          );
          selectedReadinessScore = fallback.score;
          selectedOperationalPosture = fallback.operationalPosture;
          reroutes.push({
            step: name,
            from: previousAgent,
            to: fallback.agentId,
            reason: `${previousAgent} could not satisfy ${step.taskType ?? "workflow work"}; rerouted to ${fallback.agentId}. ${fallback.reason}`,
          });
          selectedAgents.push({
            step: name,
            agentId: fallback.agentId,
            reason: selectedReason,
            readinessScore: fallback.score,
            taskObserved: fallback.taskObserved,
            taskSucceeded: fallback.taskSucceeded,
            serviceHeartbeatHealthy: fallback.serviceHeartbeatHealthy,
            operationalPosture: fallback.operationalPosture,
            relationshipWindow: {
              recentSixHours: fallback.relationshipWindow.recentSixHours,
              recentTwentyFourHours: fallback.relationshipWindow.recentTwentyFourHours,
              total: fallback.relationshipWindow.total,
            },
          });
          relationships.push({
            from: "agent:integration-agent",
            to: `agent:${fallback.agentId}`,
            relationship: "delegates-task",
            detail: `integration-agent rerouted ${name} from ${previousAgent} to ${fallback.agentId}.`,
            evidence: [
              `taskType:${step.taskType ?? "unknown"}`,
              `fallback-from:${previousAgent}`,
              `reason:${fallback.reason}`,
            ],
          });
        }
      }
    }

    if (typeof step.skillId === "string") {
      toolInvocations.push({
        toolId: step.skillId,
        detail: `${name} requires ${step.skillId}${rerouted ? ` after reroute to ${agentId}` : ""}.`,
        evidence: [
          `step:${name}`,
          `taskType:${step.taskType ?? configRecord?.orchestratorTask ?? "unknown"}`,
          `agent:${agentId ?? "unknown"}`,
        ],
        classification: step.optional === true ? "optional" : "required",
      });
    }

    const success = blockers.length === 0;
    const status =
      success
        ? "ready"
        : step.optional === true
          ? "skipped"
          : "blocked";
    const output = success
      ? `${agentId ?? "unknown-agent"} is ready for ${
          step.taskType ?? configRecord?.orchestratorTask ?? "workflow work"
        }`
      : blockers.join("; ");
    const duration = Date.now() - stepStartedAt;
    taskDurations.push(duration);

    executedSteps.push({
      name,
      agent: agentId,
      success,
      duration,
      output,
      status,
      blockers,
    });
    delegationPlan.push({
      step: name,
      requestedAgent,
      selectedAgent: agentId,
      mode: success ? (rerouted ? "reroute" : "primary") : "blocked",
      readinessScore: selectedReadinessScore,
      reason: selectedReason,
      blockers: [...blockers],
      evidence: [
        `taskType:${step.taskType ?? configRecord?.orchestratorTask ?? "unknown"}`,
        `skill:${step.skillId ?? "none"}`,
        `dependencies:${dependencyIds.length}`,
        ...(selectedOperationalPosture
          ? [
              `operational-posture:${selectedOperationalPosture.status}`,
              `active-incidents:${selectedOperationalPosture.activeIncidents}`,
              `critical-incidents:${selectedOperationalPosture.criticalIncidents}`,
            ]
          : []),
      ],
      operationalPosture: selectedOperationalPosture,
    });

    workflowNodes.push({
      id: `step:${name}`,
      kind: "step",
      label: name,
      status: success ? (rerouted ? "rerouted" : "ready") : status,
      detail: output,
    });
    if (agentId) {
      workflowNodes.push({
        id: `agent:${agentId}`,
        kind: "agent",
        label: agentId,
        status: success ? (rerouted ? "rerouted" : "ready") : status,
        detail: step.taskType ?? configRecord?.orchestratorTask ?? "workflow work",
      });
      workflowEdges.push({
        id: `edge:step:${name}:agent:${agentId}`,
        from: `step:${name}`,
        to: `agent:${agentId}`,
        relationship: rerouted ? "rerouted-to" : "assigned-to",
        status: success ? (rerouted ? "rerouted" : "ready") : "blocked",
        detail: `${name} ${rerouted ? "rerouted to" : "assigned to"} ${agentId}.`,
      });
    }

    if (success) {
      completedSteps.add(name);
      if (agentId) {
        relationships.push({
          from: "agent:integration-agent",
          to: `agent:${agentId}`,
          relationship: "coordinates-agent",
          detail: `integration-agent validated ${agentId} for ${name}.`,
          evidence: [
            `taskType:${step.taskType ?? configRecord?.orchestratorTask ?? "unknown"}`,
            `integration-runs:${integrationRuns.success}`,
          ],
        });
        if (agentId === "qa-verification-agent" || step.taskType === "qa-verification") {
          relationships.push({
            from: "agent:integration-agent",
            to: `agent:${agentId}`,
            relationship: "feeds-agent",
            detail: `integration-agent hands ${name} to ${agentId} for workflow acceptance proof.`,
            evidence: [
              `step:${name}`,
              `taskType:${step.taskType ?? "unknown"}`,
              `skill:${step.skillId ?? "none"}`,
            ],
          });
        }
      }
    }

    const previousSuccessfulAgent = [...executedSteps]
      .slice(0, -1)
      .reverse()
      .find((entry) => entry.success && entry.agent && entry.agent !== agentId);
    if (success && previousSuccessfulAgent?.agent && agentId) {
      relationships.push({
        from: `agent:${previousSuccessfulAgent.agent}`,
        to: `agent:${agentId}`,
        relationship: "cross-run-handoff",
        detail: `${previousSuccessfulAgent.agent} hands workflow context to ${agentId}.`,
        evidence: [`from-step:${previousSuccessfulAgent.name}`, `to-step:${name}`],
      });
      workflowEdges.push({
        id: `edge:handoff:${previousSuccessfulAgent.name}:${name}`,
        from: `agent:${previousSuccessfulAgent.agent}`,
        to: `agent:${agentId}`,
        relationship: "context-handoff",
        status: "ready",
        detail: `${previousSuccessfulAgent.agent} hands context to ${agentId}.`,
      });
    }

    for (const dependencyId of dependencyIds) {
      workflowNodes.push({
        id: `dependency:${name}:${dependencyId}`,
        kind: "dependency",
        label: dependencyId,
        status: completedSteps.has(dependencyId) ? "ready" : "blocked",
        detail: `${name} depends on ${dependencyId}.`,
      });
      workflowEdges.push({
        id: `edge:dependency:${dependencyId}:${name}`,
        from: `step:${dependencyId}`,
        to: `step:${name}`,
        relationship: "depends-on",
        status: completedSteps.has(dependencyId) ? "ready" : "blocked",
        detail: `${name} depends on ${dependencyId}.`,
      });
      relationships.push({
        from: `step:${name}`,
        to: `step:${dependencyId}`,
        relationship: "depends-on-run",
        detail: `${name} depends on ${dependencyId} before execution can continue.`,
        evidence: [`step:${name}`, `dependsOn:${dependencyId}`],
      });
    }

    if (!success && step.optional !== true) {
      resumeCandidates.push({
        step: name,
        reason: output,
        blockedBy: blockers,
      });
      stopReason = `workflow blocked at ${name}: ${output}`;
      stopStepName = name;
      stopBlockers = [...blockers];
      stopClassification = blockers.some((blocker) => blocker.includes("dependency"))
        ? "dependency-blocked"
        : blockers.some((blocker) => blocker.includes("unknown agent"))
          ? "agent-missing"
          : blockers.some((blocker) => blocker.includes("skill"))
            ? "skill-mismatch"
            : blockers.some((blocker) => blocker.includes("simulated failure"))
              ? "simulated-failure"
              : "dependency-blocked";
      break;
    }
  }

  const readySteps = executedSteps.filter((step) => step.status === "ready").length;
  const blockedSteps = executedSteps.filter((step) => step.status === "blocked").length;
  const reroutedSteps = reroutes.length;
  const selectedAgentIds = Array.from(
    new Set(
      executedSteps
        .map((step) => step.agent)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );
  const relationshipWindows = selectedAgentIds.map((agentId) =>
    buildAgentRelationshipWindow(state.relationshipObservations ?? [], agentId),
  );
  const executionLanes = delegationPlan.reduce<WorkflowPlan["executionLanes"]>((lanes, decision) => {
    if (!decision.selectedAgent) {
      return lanes;
    }

    const existingLane = lanes.find((lane) => lane.agentId === decision.selectedAgent);
    const laneStatus =
      decision.mode === "blocked"
        ? "blocked"
        : decision.mode === "reroute"
          ? "rerouted"
          : "ready";

    if (existingLane) {
      existingLane.steps.push(decision.step);
      existingLane.status =
        existingLane.status === "blocked" || laneStatus === "blocked"
          ? "blocked"
          : existingLane.status === "rerouted" || laneStatus === "rerouted"
            ? "rerouted"
            : "ready";
      existingLane.evidence = Array.from(new Set([...existingLane.evidence, ...decision.evidence]));
      return lanes;
    }

    lanes.push({
      agentId: decision.selectedAgent,
      steps: [decision.step],
      status: laneStatus,
      evidence: [...decision.evidence],
    });
    return lanes;
  }, []);
  const priorBlockedRuns = Array.from(new Set(runtimeWorkflowWatch.blockedRunIds)).slice(0, 8);
  const verificationHandoffRequired =
    stopReason !== null ||
    reroutedSteps > 0 ||
    incidentQueue.some((incident) => incident.verificationStatus !== "passed");
  const stepSurfaces = workflowSteps.map((step) => inferStepSurface(step));
  const dominantSurface = stepSurfaces.every((surface) => surface === stepSurfaces[0])
    ? stepSurfaces[0] ?? "runtime"
    : "mixed";
  const criticalPath = workflowSteps
    .map((step, index) => ({
      name: step.name ?? `step-${index + 1}`,
      dependencyCount: resolveDependencyIds(step).length,
      optional: step.optional === true,
    }))
    .filter((step) => !step.optional)
    .sort((left, right) => right.dependencyCount - left.dependencyCount)
    .slice(0, Math.max(1, Math.min(3, workflowSteps.length)))
    .map((step) => step.name);
  const coordinationRisks = Array.from(new Set([
    ...(reroutedSteps > 0 ? ['reroute-required'] : []),
    ...(stopReason !== null ? ['blocked-critical-path'] : []),
    ...(dominantSurface === 'mixed' ? ['cross-surface-handoff'] : []),
    ...(selectedAgentIds.length > 2 ? ['multi-agent-coordination'] : []),
    ...(selectedAgents.some((entry) => entry.operationalPosture.status !== "strong")
      ? ['trust-pressure']
      : []),
  ]));
  const stopCause =
    stopReason !== null && stopStepName !== null
      ? {
          step: stopStepName,
          classification: stopClassification,
          blockers: stopBlockers,
          dependencyBlockers: stopBlockers.filter((blocker) => blocker.includes("dependency")),
          reroutesTried: reroutes.filter((reroute) => reroute.step === stopStepName).length,
          resumeStep: resumeCandidates[0]?.step ?? null,
          verifierRequired: verificationHandoffRequired,
          suggestedNextAction:
            stopClassification === "dependency-blocked"
              ? "Unblock the missing dependency or rerun from the first blocked step."
              : stopClassification === "skill-mismatch"
                ? "Reroute to an agent with the required governed skill or widen the manifest deliberately."
                : stopClassification === "agent-missing"
                  ? "Register or select a valid workflow agent before replaying the plan."
                  : "Inspect the failing simulation path and rerun the workflow after repair.",
        }
      : null;
  const workflowWatchByClassification = {
    ...runtimeWorkflowWatch.byClassification,
    ...(stopCause
      ? {
          [stopCause.classification]:
            (runtimeWorkflowWatch.byClassification[stopCause.classification] ?? 0) + 1,
        }
      : {}),
  };
  const workflowWatchByStopCode = {
    ...runtimeWorkflowWatch.byStopCode,
    ...(stopCause
      ? {
          [stopCause.classification]:
            (runtimeWorkflowWatch.byStopCode[stopCause.classification] ?? 0) + 1,
        }
      : {}),
  };
  const workflowClassification = inferWorkflowClassification(workflowSteps);
  const handoffPackages = [
    ...(stopReason !== null || reroutedSteps > 0
      ? [{
          targetAgentId: "qa-verification-agent",
          payloadType: "verification-review" as const,
          steps: criticalPath,
          reason: "Workflow stopped or rerouted and needs verifier review before closure.",
        }]
      : []),
    ...(dominantSurface === "docs" || dominantSurface === "mixed"
      ? [{
          targetAgentId: "doc-specialist",
          payloadType: "doc-handoff" as const,
          steps: workflowSteps.map((step, index) => step.name ?? `step-${index + 1}`),
          reason: "Workflow crosses documentation or knowledge surfaces and should preserve truth-pack context.",
        }]
      : []),
    ...(dominantSurface === "public-proof"
      ? [{
          targetAgentId: "content-agent",
          payloadType: "publication-handoff" as const,
          steps: workflowSteps.map((step, index) => step.name ?? `step-${index + 1}`),
          reason: "Workflow ends in a public-proof surface and should carry publishing context forward.",
        }]
      : []),
  ];
  const dependencyDetails = workflowSteps.map((step, index) => {
    const stepName = step.name ?? `step-${index + 1}`;
    const executedStep = executedSteps.find((entry) => entry.name === stepName);
    return {
      step: stepName,
      dependsOn: resolveDependencyIds(step),
      dependencyCount: resolveDependencyIds(step).length,
      selectedAgent: executedStep?.agent ?? null,
      surface: inferStepSurface(step),
      blockers: executedStep?.blockers ?? [],
    };
  });
  const dependencyPlan: Result["dependencyPlan"] = {
    totalDependencies: dependencyDetails.reduce(
      (sum, detail) => sum + detail.dependencyCount,
      0,
    ),
    sharedDependencyCount: Object.values(
      dependencyDetails.reduce<Record<string, string[]>>((acc, detail) => {
        for (const dependencyId of detail.dependsOn) {
          acc[dependencyId] = [...(acc[dependencyId] ?? []), detail.step];
        }
        return acc;
      }, {}),
    ).filter((requiredBy) => requiredBy.length > 1).length,
    blockedDependencyCount: dependencyDetails.filter(
      (detail) => detail.blockers.some((blocker) => blocker.includes("dependency")),
    ).length,
    criticalSteps: dependencyDetails
      .filter((detail) => detail.dependencyCount > 0 || detail.blockers.length > 0)
      .sort((left, right) => right.dependencyCount - left.dependencyCount)
      .slice(0, 5),
  };
  const workflowMemory: Result["workflowMemory"] = {
    durable: true,
    resumeFromStep: resumeCandidates[0]?.step ?? null,
    priorBlockedRuns,
    recentStopSignals: runtimeWorkflowWatch.totalStopSignals,
    proofStopSignals: runtimeWorkflowWatch.proofStopSignals,
    rerouteCount: reroutes.length,
    checkpointCount: executedSteps.length,
    relationshipWindows: relationshipWindows.map((window) => ({
      agentId: window.agentId,
      recentSixHours: window.recentSixHours,
      recentTwentyFourHours: window.recentTwentyFourHours,
      total: window.total,
    })),
    stopLedger:
      stopCause !== null
        ? [
            {
              step: stopCause.step,
              classification: stopCause.classification,
              blockedBy: [...stopCause.blockers],
              suggestedNextAction: stopCause.suggestedNextAction,
            },
          ]
      : [],
  };

  const integrationSpecialistFields = buildSpecialistOperatorFields({
    role: "Workflow Architect",
    workflowStage:
      stopReason !== null
        ? "workflow-recovery"
        : verificationHandoffRequired || reroutedSteps > 0
          ? "workflow-handoff"
          : "workflow-closure",
    deliverable:
      "bounded workflow plan with delegation evidence, replay contract, and downstream handoff guidance",
    status:
      stopReason !== null
        ? stopClassification === "skill-mismatch" || stopClassification === "agent-missing"
          ? "escalate"
          : "blocked"
        : verificationHandoffRequired || reroutedSteps > 0 || incidentQueue.length > 0
          ? "watching"
          : "completed",
    operatorSummary:
      stopReason !== null
        ? `Workflow blocked at ${stopStepName ?? "the current step"} after ${completedSteps.size}/${workflowSteps.length} completed step(s); ${stopReason}.`
        : `Workflow completed across ${workflowSteps.length} step(s) with ${selectedAgentIds.length} participating agent lane(s) and ${reroutedSteps} reroute(s).`,
    recommendedNextActions:
      stopReason !== null
        ? [
            stopCause?.suggestedNextAction ?? null,
            resumeCandidates[0]
              ? `Replay from ${resumeCandidates[0].step} after ${resumeCandidates[0].blockedBy[0] ?? "the blocker is cleared"}.`
              : null,
            verificationHandoffRequired
              ? recoveryPlanLabel({
                  verificationRequired: verificationHandoffRequired,
                  incidentCount: incidentQueue.length,
                })
              : null,
          ]
        : [
            handoffPackages[0]?.reason ?? null,
            verificationHandoffRequired
              ? "Route the completed workflow through qa-verification before treating it as closed."
              : "Advance the next governed downstream task or close the workflow in Runs.",
            selectedAgents.some((entry) => entry.operationalPosture.status !== "strong")
              ? "Review the participating agent posture before widening this workflow pattern."
              : null,
          ],
    escalationReason:
      stopReason !== null &&
      (stopClassification === "skill-mismatch" || stopClassification === "agent-missing")
        ? stopClassification === "skill-mismatch"
          ? "Escalate because the workflow needs governed skill access or a permitted alternate lane before replay can continue."
          : "Escalate because the requested workflow step does not map to a live agent contract."
        : null,
  });

  return {
    success: stopReason === null,
    steps: executedSteps,
    totalTime: taskDurations.reduce((sum, value) => sum + value, 0),
    executionTime: Date.now() - startTime,
    relationships,
    toolInvocations,
    workflowGraph: {
      nodes: workflowNodes,
      edges: workflowEdges,
    },
    plan: {
      objective: `Coordinate ${workflowSteps.length} workflow step(s) for ${task.type}.`,
      totalSteps: workflowSteps.length,
      readySteps,
      blockedSteps,
      reroutedSteps,
      fallbackDecisions: reroutes.map((reroute) => reroute.reason),
      resumePath: workflowSteps
        .map((step, index) => ({ step, index }))
        .filter(({ step, index }) => {
          const stepName = step.name ?? `step-${index + 1}`;
          return !completedSteps.has(stepName);
        })
        .map(({ step, index }) => step.name ?? `step-${index + 1}`),
      resumeState: {
        durable: true,
        resumeFromStep: resumeCandidates[0]?.step ?? null,
        resumeCandidates,
        priorBlockedRuns,
      },
      selectedAgents,
      executionLanes,
      workflowProfile: {
        classification: workflowClassification,
        dominantSurface,
        criticalPath,
        coordinationRisks,
        verifierRequired: verificationHandoffRequired,
      },
    },
    delegationPlan,
    ...integrationSpecialistFields,
    replayContract: {
      durable: true,
      replayFromStep: resumeCandidates[0]?.step ?? workflowSteps.find((step, index) => {
        const stepName = step.name ?? `step-${index + 1}`;
        return !completedSteps.has(stepName);
      })?.name ?? null,
      blockedDependencies: stopBlockers.filter((blocker) => blocker.includes("dependency")),
      checkpoints: executedSteps.map((step) => ({
        step: step.name,
        status: step.status,
        agentId: step.agent,
        blockers: [...step.blockers],
      })),
      requiredDelegations: delegationPlan
        .filter((decision) => decision.selectedAgent && decision.mode !== "blocked")
        .map((decision) => ({
          step: decision.step,
          agentId: decision.selectedAgent as string,
          mode: decision.mode,
        })),
    },
    handoffPackages,
    dependencyPlan,
    workflowMemory,
    reroutes,
    partialCompletion: {
      replayable: true,
      completedSteps: [...completedSteps],
      remainingSteps: workflowSteps
        .map((step, index) => step.name ?? `step-${index + 1}`)
        .filter((stepName) => !completedSteps.has(stepName)),
      blockedStep: stopStepName,
      rerouteCount: reroutes.length,
    },
    stopClassification,
    stopReason,
    stopCause,
    recoveryPlan: {
      priorityIncidents: incidentQueue.slice(0, 5).map((incident) => ({
        incidentId: incident.incidentId,
        severity: incident.severity,
        summary: incident.summary,
        nextAction: incident.nextAction,
        owner: incident.owner,
        recommendedOwner: incident.recommendedOwner,
        remediationTaskType: incident.remediationTaskType,
      })),
      workflowWatch: {
        totalStopSignals:
          runtimeWorkflowWatch.totalStopSignals + (stopReason !== null ? 1 : 0),
        latestStopAt: runtimeWorkflowWatch.latestStopAt,
        latestStopCode:
          runtimeWorkflowWatch.latestStopCode ??
          (stopClassification !== "complete" ? stopClassification : null),
        byStage: runtimeWorkflowWatch.byStage,
        byClassification: workflowWatchByClassification,
        byStopCode: workflowWatchByStopCode,
        blockedRunIds: Array.from(
          new Set([
            ...runtimeWorkflowWatch.blockedRunIds,
            ...(stopReason !== null ? [task.id] : []),
          ]),
        ),
        proofStopSignals: runtimeWorkflowWatch.proofStopSignals,
        currentStop: stopCause,
      },
      verificationHandoff: {
        required: verificationHandoffRequired,
        agentId: "qa-verification-agent",
        reason:
          verificationHandoffRequired
            ? stopReason !== null
              ? "Workflow stopped or rerouted and needs verifier review before closure."
              : "Runtime incidents still require verifier-backed closure."
            : "Workflow can complete without immediate verifier handoff.",
      },
      relationshipWindows: relationshipWindows.map((window) => ({
        agentId: window.agentId,
        recentSixHours: window.recentSixHours,
        recentTwentyFourHours: window.recentTwentyFourHours,
        total: window.total,
      })),
      resumeCandidates,
    },
  };
}

function recoveryPlanLabel(args: {
  verificationRequired: boolean;
  incidentCount: number;
}) {
  if (args.verificationRequired) {
    return "Prepare verifier review before closing the workflow or replaying the blocked step.";
  }
  if (args.incidentCount > 0) {
    return "Review the linked incident queue before widening this workflow path.";
  }
  return null;
}

async function main(): Promise<void> {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    return;
  }

  try {
    const payloadRaw = await readFile(payloadPath, "utf-8");
    const taskInput = JSON.parse(payloadRaw) as Task;
    if (!process.env.INTEGRATION_AGENT_STATE_FILE) {
      const siblingStatePath = resolve(
        dirname(payloadPath),
        "orchestrator_state.json",
      );
      try {
        await readFile(siblingStatePath, "utf-8");
        process.env.INTEGRATION_AGENT_STATE_FILE = siblingStatePath;
      } catch {
        // Optional CLI fixture state; normal runtime uses agent config.
      }
    }
    const result = await handleTask(taskInput);

    const resultFile = process.env.INTEGRATION_AGENT_RESULT_FILE;
    if (resultFile) {
      await mkdir(dirname(resultFile), { recursive: true });
      await writeFile(resultFile, JSON.stringify(result, null, 2), "utf-8");
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

export { handleTask, loadConfig, canUseSkill };
