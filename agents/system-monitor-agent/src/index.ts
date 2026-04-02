import { readFileSync } from "node:fs";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSpecialistOperatorFields,
  buildIncidentPriorityQueue,
  buildWorkflowBlockerSummary,
  countByStatus,
  collectProofSurfaceObservations,
  loadRuntimeState,
  readJsonFile,
  summarizeProofSurface,
  summarizeTaskExecutions,
  type RuntimeAgentServiceState,
  type RuntimeIncidentLedgerRecord,
  type RuntimeStateSubset,
} from "../../shared/runtime-evidence.js";
import { loadSharedBudgetState } from "../../reddit-helper/src/coordination.ts";

interface Task {
  id: string;
  type: string;
  agents?: string[];
  classification?: string;
  limit?: number;
}

interface AgentConfig {
  id: string;
  name: string;
  orchestratorStatePath: string;
  permissions: {
    skills?: Record<string, { allowed?: boolean }>;
  };
}

interface AgentDescriptor {
  id: string;
  name: string;
  orchestratorTask?: string;
  serviceStatePath?: string;
}

interface AgentServiceState extends RuntimeAgentServiceState {}

interface RuntimeState extends RuntimeStateSubset {}

const DEFAULT_BUDGET_RESET_TZ = "UTC";

function resolveBudgetDate(at: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function summarizeRuntimeProofSurface(
  state: RuntimeState,
  surface: "milestone" | "demandSummary",
) {
  return summarizeProofSurface(
    {
      workflowEvents: state.workflowEvents ?? [],
      relationshipObservations: state.relationshipObservations ?? [],
    },
    surface,
  );
}

interface AgentHealthSnapshot {
  status: "OK" | "ACTIVE" | "DEGRADED" | "STALE" | "UNKNOWN";
  lastRunAt: string | null;
  lastStatus: string | null;
  totalRuns: number;
  successCount: number;
  errorCount: number;
  activeExecutions: number;
  failedExecutions: number;
  evidence: string[];
}

interface Result {
  success: boolean;
  metrics: {
    timestamp: string;
    agentHealth: Record<string, AgentHealthSnapshot>;
    systemMetrics: Record<string, unknown> & {
      proofFreshness?: {
        milestone: "fresh" | "aging" | "stale" | "empty";
        demandSummary: "fresh" | "aging" | "stale" | "empty";
      };
      budgetPosture?: {
        status: "healthy" | "watching" | "degraded" | "unknown";
        llmCallsToday: number | null;
        tokensToday: number | null;
        source: string | null;
      };
      degradationTrends?: {
        failingAgents: number;
        staleAgents: number;
        retryRecoveries: number;
        criticalIncidents: number;
      };
      degradationWindows?: {
        recentHour: {
          incidents: number;
          workflowStops: number;
          retryRecoveries: number;
          proofFailures: number;
        };
        recentSixHours: {
          incidents: number;
          workflowStops: number;
          retryRecoveries: number;
          proofFailures: number;
        };
        recentTwentyFourHours: {
          incidents: number;
          workflowStops: number;
          retryRecoveries: number;
          proofFailures: number;
        };
      };
      trustBoundaryPressure?: {
        status: "nominal" | "watching" | "elevated" | "critical";
        relevantIncidentCount: number;
        recurringCount: number;
        authSurfaceCount: number;
        proofBoundaryCount: number;
        degradedAgentCount: number;
        latestSeenAt: string | null;
      };
    };
    alerts: string[];
  };
  incidentTriage?: {
    summary: {
      openCount: number;
      criticalCount: number;
      unownedCount: number;
      ackPendingCount: number;
      remediationCount: number;
      verificationCount: number;
    };
    classificationBuckets: Array<{
      classification: string;
      count: number;
      activeCount: number;
      watchingCount: number;
      highestSeverity: string;
    }>;
    triageQueue: Array<{
      incidentId: string;
      priorityScore: number;
      severity: string;
      owner: string | null;
      recommendedOwner: string | null;
      nextAction: string;
      remediationTaskType: string | null;
      blockers: string[];
    }>;
  };
  relationships: Array<{
    from: string;
    to: string;
    relationship: "monitors-agent" | "feeds-agent";
    detail: string;
    evidence: string[];
    classification: string;
  }>;
  toolInvocations: Array<{
    toolId: string;
    detail: string;
    evidence: string[];
    classification: "required" | "optional";
  }>;
  diagnoses: Array<{
    id: string;
    severity: "info" | "warning" | "critical";
    summary: string;
    recommendedOwner: string;
    nextAction: string;
    evidence: string[];
  }>;
  proofTransitions: Array<{
    transport: "milestone" | "demandSummary";
    detail: string;
    evidence: string[];
    classification: string;
  }>;
  escalationWatch: Array<{
    incidentId: string;
    severity: string;
    owner: string | null;
    summary: string;
  }>;
  remediationQueue: Array<{
    incidentId: string;
    priorityScore: number;
    severity: string;
    owner: string | null;
    recommendedOwner: string | null;
    nextAction: string;
    remediationTaskType: string | null;
    blockers: string[];
  }>;
  incidentCausality: Array<{
    incidentId: string;
    diagnosisId: string | null;
    severity: string;
    recommendedOwner: string | null;
    affectedAgents: string[];
    reason: string;
    evidence: string[];
  }>;
  workflowWatch: ReturnType<typeof buildWorkflowBlockerSummary>;
  operatorActions: Array<{
    id: string;
    priority: "critical" | "high" | "medium";
    owner: string;
    summary: string;
    evidence: string[];
  }>;
  earlyWarnings: Array<{
    id: string;
    severity: "info" | "warning" | "critical";
    summary: string;
    predictedImpact: string;
    evidence: string[];
  }>;
  dependencyHealth: {
    status: "healthy" | "watching" | "degraded" | "critical";
    blockedWorkflowCount: number;
    proofFailureCount: number;
    staleAgentCount: number;
    retryRecoveryCount: number;
  };
  queueBudgetFusion: {
    status: "healthy" | "watching" | "degraded" | "critical";
    retryRecoveryCount: number;
    failedExecutionCount: number;
    pendingApprovalCount: number;
    ownerlessIncidentCount: number;
    budgetStatus: "healthy" | "watching" | "degraded" | "unknown";
    communicationLaneAtRisk: boolean;
    dependencyRiskScore: number;
    predictionConfidence: "low" | "medium" | "high";
  };
  operationalDiagnosis: {
    status: "stable" | "watching" | "critical";
    dominantRisk: string | null;
    diagnosisCount: number;
    operatorActionCount: number;
    remediationQueueDepth: number;
    dependencyStatus: "healthy" | "watching" | "degraded" | "critical";
    trustBoundaryStatus: "nominal" | "watching" | "elevated" | "critical";
    budgetStatus: "healthy" | "watching" | "degraded" | "unknown";
    proofFreshness: {
      milestone: "fresh" | "aging" | "stale" | "empty";
      demandSummary: "fresh" | "aging" | "stale" | "empty";
    };
  };
  trendSummary: {
    status: "stable" | "watching" | "critical";
    recentHourSignals: number;
    recentTwentyFourHourSignals: number;
    trustBoundaryTrend: "stable" | "rising";
    queuePressureTrend: "stable" | "rising";
  };
  operatorClosureEvidence: {
    status: "ready" | "watching" | "blocked";
    openCriticalIncidents: number;
    prioritizedActions: number;
    verifierSensitiveIncidents: number;
    ownerlessIncidents: number;
    proofFreshness: "fresh" | "aging" | "stale" | "empty";
  };
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
  executionTime: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, "../agent.config.json");
const workspaceRoot = resolve(__dirname, "../../..");
const agentsRoot = resolve(workspaceRoot, "agents");

function loadConfig(): AgentConfig {
  return JSON.parse(readFileSync(configPath, "utf-8")) as AgentConfig;
}

function canUseSkill(skillId: string): boolean {
  const config = loadConfig();
  return config.permissions.skills?.[skillId]?.allowed === true;
}

async function listAgentDescriptors(): Promise<AgentDescriptor[]> {
  const entries = await readdir(agentsRoot, { withFileTypes: true });
  const descriptors: AgentDescriptor[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "shared" || entry.name.startsWith(".")) continue;
    const agentConfigPath = resolve(agentsRoot, entry.name, "agent.config.json");
    try {
      const parsed = JSON.parse(await readFile(agentConfigPath, "utf-8")) as {
        id?: string;
        name?: string;
        orchestratorTask?: string;
        serviceStatePath?: string;
      };
      if (!parsed.id) continue;
      descriptors.push({
        id: parsed.id,
        name: parsed.name ?? parsed.id,
        orchestratorTask: parsed.orchestratorTask,
        serviceStatePath: parsed.serviceStatePath,
      });
    } catch {
      continue;
    }
  }

  return descriptors.sort((left, right) => left.id.localeCompare(right.id));
}

async function loadServiceState(
  descriptor: AgentDescriptor,
): Promise<AgentServiceState | null> {
  if (!descriptor.serviceStatePath) return null;
  const targetPath = resolve(agentsRoot, descriptor.id, descriptor.serviceStatePath);
  return readJsonFile<AgentServiceState | null>(targetPath, null);
}

async function isServiceStateStale(
  descriptor: AgentDescriptor,
  maxAgeMs: number,
): Promise<boolean> {
  if (!descriptor.serviceStatePath) return false;
  const targetPath = resolve(agentsRoot, descriptor.id, descriptor.serviceStatePath);
  try {
    const fileStat = await stat(targetPath);
    return Date.now() - fileStat.mtimeMs > maxAgeMs;
  } catch {
    return false;
  }
}

function summarizeIncidents(incidents: RuntimeIncidentLedgerRecord[]) {
  const open = incidents.filter((incident) => incident.status !== "resolved");
  return {
    openCount: open.length,
    criticalCount: open.filter((incident) => incident.severity === "critical").length,
    warningCount: open.filter((incident) => incident.severity === "warning").length,
    ownersAssigned: open.filter(
      (incident) => typeof incident.owner === "string" && incident.owner.length > 0,
    ).length,
  };
}

function resolveProofFreshnessStatus(lastTimestamp: string | null | undefined) {
  if (!lastTimestamp) return "empty" as const;
  const ageMs = Date.now() - Date.parse(lastTimestamp);
  if (!Number.isFinite(ageMs) || ageMs < 0) return "fresh" as const;
  if (ageMs > 24 * 60 * 60 * 1000) return "stale" as const;
  if (ageMs > 6 * 60 * 60 * 1000) return "aging" as const;
  return "fresh" as const;
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildIncidentSearchText(incident: RuntimeIncidentLedgerRecord) {
  return [
    incident.classification ?? "",
    incident.summary ?? "",
    ...(incident.evidence ?? []),
    ...(incident.affectedSurfaces ?? []),
    ...(incident.recommendedSteps ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function isTrustBoundaryRelevant(incident: RuntimeIncidentLedgerRecord) {
  if (
    incident.classification === "service-runtime" ||
    incident.classification === "proof-delivery" ||
    incident.classification === "persistence"
  ) {
    return true;
  }

  const searchable = buildIncidentSearchText(incident);
  return ["auth", "cors", "origin", "permission", "secret", "token", "signature", "webhook"].some(
    (token) => searchable.includes(token),
  );
}

function resolveRuntimeReferenceTimestamp(state: RuntimeState) {
  const candidates = [
    state.updatedAt,
    state.lastStartedAt,
    ...(state.incidentLedger ?? []).flatMap((incident) => [incident.lastSeenAt, incident.firstSeenAt]),
    ...(state.workflowEvents ?? []).map((event) => event.timestamp),
    ...(state.taskExecutions ?? []).map((execution) => execution.lastHandledAt),
    ...(state.taskRetryRecoveries ?? []).map((entry) => entry.retryAt),
    ...collectProofSurfaceObservations({
      workflowEvents: state.workflowEvents ?? [],
      relationshipObservations: state.relationshipObservations ?? [],
    }).map((entry) => entry.timestamp),
  ];
  const latestRuntimeTimestamp = Math.max(...candidates.map((value) => toTimestamp(value)));
  return latestRuntimeTimestamp > 0 ? latestRuntimeTimestamp : Date.now();
}

function buildDegradationWindows(state: RuntimeState, referenceTimestamp: number) {
  const windows = [
    ["recentHour", 60 * 60 * 1000],
    ["recentSixHours", 6 * 60 * 60 * 1000],
    ["recentTwentyFourHours", 24 * 60 * 60 * 1000],
  ] as const;

  return Object.fromEntries(
    windows.map(([label, durationMs]) => {
      const cutoff = referenceTimestamp - durationMs;
      const incidents = (state.incidentLedger ?? []).filter(
        (incident) => incident.status !== "resolved" && toTimestamp(incident.lastSeenAt ?? incident.firstSeenAt) >= cutoff,
      ).length;
      const workflowStops = (state.workflowEvents ?? []).filter((event) => {
        const stateToken = String(event.state ?? "").toLowerCase();
        return (
          (stateToken === "blocked" || stateToken === "failed" || Boolean(event.stopCode)) &&
          toTimestamp(event.timestamp) >= cutoff
        );
      }).length;
      const retryRecoveries = (state.taskRetryRecoveries ?? []).filter(
        (entry) => toTimestamp(entry.retryAt) >= cutoff,
      ).length;
      const proofFailures =
        collectProofSurfaceObservations({
          workflowEvents: state.workflowEvents ?? [],
          relationshipObservations: state.relationshipObservations ?? [],
        }).filter(
          (entry) =>
            ["blocked", "degraded", "failed", "retrying", "rejected"].includes(
              String(entry.status ?? "").toLowerCase(),
            ) && toTimestamp(entry.timestamp) >= cutoff,
        ).length;

      return [
        label,
        {
          incidents,
          workflowStops,
          retryRecoveries,
          proofFailures,
        },
      ];
    }),
  ) as Result["metrics"]["systemMetrics"]["degradationWindows"];
}

function buildTrustBoundaryPressure(args: {
  incidents: RuntimeIncidentLedgerRecord[];
  degradedAgentCount: number;
}) {
  const relevantIncidents = args.incidents.filter(
    (incident) => incident.status !== "resolved" && isTrustBoundaryRelevant(incident),
  );
  const recurringCount = relevantIncidents.filter((incident) => {
    const ageMs = toTimestamp(incident.lastSeenAt) - toTimestamp(incident.firstSeenAt);
    return (incident.history?.length ?? 0) >= 2 || ageMs >= 6 * 60 * 60 * 1000;
  }).length;
  const authSurfaceCount = relevantIncidents.filter((incident) => {
    const searchable = buildIncidentSearchText(incident);
    return ["auth", "cors", "origin", "signature", "webhook"].some((token) => searchable.includes(token));
  }).length;
  const proofBoundaryCount = relevantIncidents.filter(
    (incident) => incident.classification === "proof-delivery",
  ).length;
  const criticalRelevantCount = relevantIncidents.filter(
    (incident) => incident.severity === "critical",
  ).length;
  const latestSeenAt =
    relevantIncidents
      .map((incident) => incident.lastSeenAt ?? incident.firstSeenAt ?? null)
      .sort((left, right) => toTimestamp(right) - toTimestamp(left))[0] ?? null;

  let status: "nominal" | "watching" | "elevated" | "critical" = "nominal";
  if (relevantIncidents.length > 0) status = "watching";
  if (recurringCount > 0 || authSurfaceCount > 0 || args.degradedAgentCount > 0) status = "elevated";
  if (criticalRelevantCount > 0 || proofBoundaryCount > 0) status = "critical";

  return {
    status,
    relevantIncidentCount: relevantIncidents.length,
    recurringCount,
    authSurfaceCount,
    proofBoundaryCount,
    degradedAgentCount: args.degradedAgentCount,
    latestSeenAt,
  };
}

function buildEarlyWarnings(args: {
  proofMetrics: {
    milestone: ReturnType<typeof summarizeProofSurface>;
    demandSummary: ReturnType<typeof summarizeProofSurface>;
  };
  workflowWatch: ReturnType<typeof buildWorkflowBlockerSummary>;
  retryRecoveryCount: number;
  budgetPosture: {
    status: "healthy" | "watching" | "degraded" | "unknown";
  };
  trustBoundaryPressure: ReturnType<typeof buildTrustBoundaryPressure>;
  taskExecutionSummary: ReturnType<typeof summarizeTaskExecutions>;
}) {
  const warnings: Result["earlyWarnings"] = [];

  if (
    (args.proofMetrics.milestone.deadLetter > 0 || args.proofMetrics.demandSummary.deadLetter > 0) &&
    args.workflowWatch.proofStopSignals > 0 &&
    args.retryRecoveryCount > 0
  ) {
    warnings.push({
      id: "proof-lane-instability",
      severity: "critical",
      summary: "Public proof, workflow stops, and retry debt are converging on the same lane.",
      predictedImpact: "The public proof surface is likely to remain blocked until replay and workflow recovery are handled together.",
      evidence: [
        `milestone-dead-letter:${args.proofMetrics.milestone.deadLetter}`,
        `demand-dead-letter:${args.proofMetrics.demandSummary.deadLetter}`,
        `proof-stop-signals:${args.workflowWatch.proofStopSignals}`,
        `retry-recoveries:${args.retryRecoveryCount}`,
      ],
    });
  }

  if (
    args.trustBoundaryPressure.authSurfaceCount > 0 &&
    args.trustBoundaryPressure.recurringCount > 0
  ) {
    warnings.push({
      id: "trust-boundary-escalation",
      severity:
        args.trustBoundaryPressure.status === "critical" ? "critical" : "warning",
      summary: "Recurring auth or boundary regressions are likely to widen if left in watch mode.",
      predictedImpact: "Operator-facing or protected routes may drift into a broader incident if containment is delayed.",
      evidence: [
        `auth-surface:${args.trustBoundaryPressure.authSurfaceCount}`,
        `recurring:${args.trustBoundaryPressure.recurringCount}`,
        `status:${args.trustBoundaryPressure.status}`,
      ],
    });
  }

  if (
    args.budgetPosture.status !== "healthy" &&
    (args.taskExecutionSummary.failed ?? 0) > 0
  ) {
    warnings.push({
      id: "budget-backed-queue-pressure",
      severity: args.budgetPosture.status === "degraded" ? "warning" : "info",
      summary: "Budget posture and execution failures are starting to reinforce each other.",
      predictedImpact: "Communication or optional work lanes may degrade further unless budget and queue pressure are reduced together.",
      evidence: [
        `budget-status:${args.budgetPosture.status}`,
        `failed-executions:${args.taskExecutionSummary.failed ?? 0}`,
      ],
    });
  }

  return warnings;
}

function buildDependencyHealth(args: {
  workflowWatch: ReturnType<typeof buildWorkflowBlockerSummary>;
  degradationWindows: NonNullable<Result["metrics"]["systemMetrics"]["degradationWindows"]>;
  degradationTrends: NonNullable<Result["metrics"]["systemMetrics"]["degradationTrends"]>;
}) {
  const blockedWorkflowCount = args.workflowWatch.totalStopSignals;
  const proofFailureCount = args.degradationWindows.recentTwentyFourHours.proofFailures;
  const staleAgentCount = args.degradationTrends.staleAgents;
  const retryRecoveryCount = args.degradationTrends.retryRecoveries;
  let status: Result["dependencyHealth"]["status"] = "healthy";
  if (blockedWorkflowCount > 0 || retryRecoveryCount > 0) status = "watching";
  if (proofFailureCount > 0 || staleAgentCount > 0) status = "degraded";
  if (proofFailureCount > 1 || blockedWorkflowCount > 3) status = "critical";
  return {
    status,
    blockedWorkflowCount,
    proofFailureCount,
    staleAgentCount,
    retryRecoveryCount,
  };
}

function buildQueueBudgetFusion(args: {
  taskExecutionSummary: ReturnType<typeof summarizeTaskExecutions>;
  retryRecoveryCount: number;
  pendingApprovalCount: number;
  ownerlessIncidentCount: number;
  budgetPosture: {
    status: "healthy" | "watching" | "degraded" | "unknown";
  };
  dependencyHealth: Result["dependencyHealth"];
}) {
  const failedExecutionCount = args.taskExecutionSummary.failed ?? 0;
  const communicationLaneAtRisk =
    args.budgetPosture.status !== "healthy" &&
    (failedExecutionCount > 0 || args.retryRecoveryCount > 0);
  const dependencyRiskScore =
    args.retryRecoveryCount * 15 +
    failedExecutionCount * 20 +
    args.pendingApprovalCount * 5 +
    args.ownerlessIncidentCount * 10 +
    (args.dependencyHealth.proofFailureCount > 0 ? 20 : 0) +
    (args.dependencyHealth.blockedWorkflowCount > 0 ? 15 : 0);
  let status: Result["queueBudgetFusion"]["status"] = "healthy";
  if (
    args.retryRecoveryCount > 0 ||
    failedExecutionCount > 0 ||
    args.budgetPosture.status === "watching"
  ) {
    status = "watching";
  }
  if (
    args.pendingApprovalCount > 5 ||
    args.ownerlessIncidentCount > 0 ||
    args.budgetPosture.status === "degraded"
  ) {
    status = "degraded";
  }
  if (
    communicationLaneAtRisk &&
    (args.retryRecoveryCount > 0 || failedExecutionCount > 1)
  ) {
    status = "critical";
  }
  const predictionConfidence: Result["queueBudgetFusion"]["predictionConfidence"] =
    dependencyRiskScore >= 60 ? "high" : dependencyRiskScore >= 30 ? "medium" : "low";
  return {
    status,
    retryRecoveryCount: args.retryRecoveryCount,
    failedExecutionCount,
    pendingApprovalCount: args.pendingApprovalCount,
    ownerlessIncidentCount: args.ownerlessIncidentCount,
    budgetStatus: args.budgetPosture.status,
    communicationLaneAtRisk,
    dependencyRiskScore,
    predictionConfidence,
  };
}

function buildTrendSummary(args: {
  degradationWindows: NonNullable<Result["metrics"]["systemMetrics"]["degradationWindows"]>;
  trustBoundaryPressure: ReturnType<typeof buildTrustBoundaryPressure>;
  queueBudgetFusion: Result["queueBudgetFusion"];
}) {
  const recentHourSignals =
    args.degradationWindows.recentHour.incidents +
    args.degradationWindows.recentHour.workflowStops +
    args.degradationWindows.recentHour.retryRecoveries +
    args.degradationWindows.recentHour.proofFailures;
  const recentTwentyFourHourSignals =
    args.degradationWindows.recentTwentyFourHours.incidents +
    args.degradationWindows.recentTwentyFourHours.workflowStops +
    args.degradationWindows.recentTwentyFourHours.retryRecoveries +
    args.degradationWindows.recentTwentyFourHours.proofFailures;

  return {
    status:
      args.trustBoundaryPressure.status === "critical" ||
      args.queueBudgetFusion.status === "critical" ||
      recentTwentyFourHourSignals >= 8
        ? "critical" as const
        : args.trustBoundaryPressure.status !== "nominal" ||
            args.queueBudgetFusion.status !== "healthy" ||
            recentHourSignals > 0
          ? "watching" as const
          : "stable" as const,
    recentHourSignals,
    recentTwentyFourHourSignals,
    trustBoundaryTrend:
      args.trustBoundaryPressure.recurringCount > 0 ||
      args.trustBoundaryPressure.status === "critical"
        ? "rising" as const
        : "stable" as const,
    queuePressureTrend:
      args.queueBudgetFusion.retryRecoveryCount > 0 ||
      args.queueBudgetFusion.failedExecutionCount > 0 ||
      args.queueBudgetFusion.pendingApprovalCount > 0
        ? "rising" as const
        : "stable" as const,
  };
}

function buildOperatorClosureEvidence(args: {
  incidentSummary: { criticalCount: number };
  operatorActions: Result["operatorActions"];
  remediationQueue: Result["remediationQueue"];
  workflowWatch: ReturnType<typeof buildWorkflowBlockerSummary>;
  proofFreshness: NonNullable<Result["metrics"]["systemMetrics"]["proofFreshness"]>;
}) {
  const verifierSensitiveIncidents = args.remediationQueue.filter(
    (incident) =>
      incident.remediationTaskType === "qa-verification" ||
      incident.blockers.some((blocker) => /verify|verification/i.test(blocker)),
  ).length;
  const ownerlessIncidents = args.remediationQueue.filter(
    (incident) => incident.owner === null && incident.recommendedOwner === null,
  ).length;
  const proofFreshness =
    args.proofFreshness.milestone === "stale" || args.proofFreshness.demandSummary === "stale"
      ? "stale"
      : args.proofFreshness.milestone === "aging" || args.proofFreshness.demandSummary === "aging"
        ? "aging"
        : args.proofFreshness.milestone === "empty" && args.proofFreshness.demandSummary === "empty"
          ? "empty"
          : "fresh";

  return {
    status:
      args.incidentSummary.criticalCount > 0 ||
      args.workflowWatch.proofStopSignals > 0 ||
      ownerlessIncidents > 0
        ? "blocked" as const
        : args.operatorActions.length > 0 || verifierSensitiveIncidents > 0
          ? "watching" as const
          : "ready" as const,
    openCriticalIncidents: args.incidentSummary.criticalCount,
    prioritizedActions: args.operatorActions.length,
    verifierSensitiveIncidents,
    ownerlessIncidents,
    proofFreshness,
  };
}

function deriveIncidentAffectedAgents(incident: RuntimeIncidentLedgerRecord) {
  const fromSurfaces = (incident.affectedSurfaces ?? [])
    .flatMap((surface) => {
      if (surface.startsWith("agent:")) {
        return [surface.slice("agent:".length)];
      }
      const agentMatch = surface.match(/([a-z0-9-]+-agent)/i);
      return agentMatch ? [agentMatch[1]] : [];
    })
    .filter(Boolean);
  return Array.from(new Set([...(incident.linkedServiceIds ?? []), ...fromSurfaces]));
}

function deriveAgentHealthSnapshot(args: {
  descriptor: AgentDescriptor;
  state: RuntimeState;
  serviceState: AgentServiceState | null;
  stale: boolean;
}): AgentHealthSnapshot {
  const { descriptor, state, serviceState, stale } = args;
  const executionSummary = summarizeTaskExecutions(
    state.taskExecutions ?? [],
    descriptor.orchestratorTask ? [descriptor.orchestratorTask] : undefined,
  );
  const taskPath = serviceState?.taskPath ?? null;
  const taskObserved =
    Boolean(taskPath?.lastObservedAt) || Number(taskPath?.totalRuns ?? 0) > 0;
  const taskSucceeded =
    Boolean(taskPath?.lastSuccessfulAt) || Number(taskPath?.successfulRuns ?? 0) > 0;
  const heartbeatStatus = serviceState?.serviceHeartbeat?.status ?? serviceState?.lastStatus ?? null;

  const evidence = [
    descriptor.orchestratorTask
      ? `task-route:${descriptor.orchestratorTask}`
      : "task-route:unassigned",
    heartbeatStatus ? `service-heartbeat:${heartbeatStatus}` : "service-heartbeat:unknown",
    taskObserved
      ? `task-path:${taskSucceeded ? "success" : taskPath?.lastObservedStatus ?? "observed"}`
      : "task-path:none",
  ];

  let status: AgentHealthSnapshot["status"] = "UNKNOWN";
  if (stale) {
    status = "STALE";
    evidence.push("service-state:stale");
  } else if (executionSummary.running > 0 || executionSummary.retrying > 0 || Number(taskPath?.activeRuns ?? 0) > 0) {
    status = "ACTIVE";
  } else if (
    Number(taskPath?.failedRuns ?? 0) > 0 ||
    executionSummary.failed > 0 ||
    heartbeatStatus === "error" ||
    Number(serviceState?.errorCount ?? 0) > 0
  ) {
    status = "DEGRADED";
  } else if (
    taskSucceeded ||
    heartbeatStatus === "ok" ||
    Number(serviceState?.successCount ?? 0) > 0
  ) {
    status = "OK";
  }

  return {
    status,
    lastRunAt:
      taskPath?.lastObservedAt ??
      serviceState?.serviceHeartbeat?.checkedAt ??
      serviceState?.lastRunAt ??
      executionSummary.lastHandledAt,
    lastStatus: heartbeatStatus,
    totalRuns: Number(taskPath?.totalRuns ?? serviceState?.totalRuns ?? executionSummary.total ?? 0),
    successCount: Number(taskPath?.successfulRuns ?? serviceState?.successCount ?? executionSummary.success ?? 0),
    errorCount: Number(taskPath?.failedRuns ?? serviceState?.errorCount ?? executionSummary.failed ?? 0),
    activeExecutions:
      Number(taskPath?.activeRuns ?? 0) || executionSummary.running + executionSummary.retrying,
    failedExecutions: Number(taskPath?.failedRuns ?? executionSummary.failed ?? 0),
    evidence,
  };
}

function buildSystemMonitorSpecialistFields(args: {
  operationalDiagnosis: Result["operationalDiagnosis"];
  dependencyHealth: Result["dependencyHealth"];
  queueBudgetFusion: Result["queueBudgetFusion"];
  operatorActions: Result["operatorActions"];
  earlyWarnings: Result["earlyWarnings"];
}) {
  const status =
    args.operationalDiagnosis.status === "critical"
      ? "escalate"
      : args.operationalDiagnosis.status === "watching"
        ? "watching"
        : "completed";

  return buildSpecialistOperatorFields({
    role: "SRE Monitor",
    workflowStage:
      status === "completed"
        ? "runtime-closure"
        : status === "watching"
          ? "runtime-watch"
          : "runtime-escalation",
    deliverable:
      "runtime diagnosis with prioritized operator actions, dependency posture, and early-warning evidence",
    status,
    operatorSummary:
      status === "completed"
        ? `Runtime diagnosis is stable with ${args.operationalDiagnosis.diagnosisCount} active diagnosis item(s) and ${args.operatorActions.length} prioritized operator action(s).`
        : `Runtime diagnosis is ${args.operationalDiagnosis.status} with dependency health ${args.dependencyHealth.status}, queue-budget posture ${args.queueBudgetFusion.status}, and ${args.operatorActions.length} prioritized operator action(s).`,
    recommendedNextActions: [
      ...args.operatorActions.slice(0, 3).map((entry) => entry.summary),
      ...args.earlyWarnings.slice(0, 2).map((entry) => entry.predictedImpact),
    ],
    escalationReason:
      status === "escalate"
        ? "Escalate because runtime diagnosis is critical and the current dependency or queue posture can degrade more lanes if left unattended."
        : null,
  });
}

function buildIncidentTriageClassificationBuckets(
  incidents: RuntimeIncidentLedgerRecord[],
) {
  const grouped = new Map<
    string,
    {
      classification: string;
      count: number;
      activeCount: number;
      watchingCount: number;
      highestSeverity: "info" | "warning" | "critical";
    }
  >();
  const severityRank: Record<"info" | "warning" | "critical", number> = {
    info: 1,
    warning: 2,
    critical: 3,
  };

  for (const incident of incidents) {
    const current = grouped.get(incident.classification) ?? {
      classification: incident.classification,
      count: 0,
      activeCount: 0,
      watchingCount: 0,
      highestSeverity: incident.severity,
    };
    current.count += 1;
    if (incident.status === "active") current.activeCount += 1;
    if (incident.status === "watching") current.watchingCount += 1;
    if (severityRank[incident.severity] > severityRank[current.highestSeverity]) {
      current.highestSeverity = incident.severity;
    }
    grouped.set(incident.classification, current);
  }

  return [...grouped.values()].sort((left, right) => {
    const byCount = right.count - left.count;
    if (byCount !== 0) return byCount;
    return severityRank[right.highestSeverity] - severityRank[left.highestSeverity];
  });
}

function buildIncidentTriageSpecialistFields(args: {
  openCount: number;
  criticalCount: number;
  classificationLabel: string | null;
  triageQueue: Array<{ nextAction: string }>;
  summary: {
    unownedCount: number;
    ackPendingCount: number;
    remediationCount: number;
    verificationCount: number;
  };
}) {
  const status =
    args.criticalCount > 0
      ? "escalate"
      : args.summary.unownedCount > 0 || args.summary.ackPendingCount > 0
        ? "watching"
        : "completed";

  return buildSpecialistOperatorFields({
    role: "Incident Triage Analyst",
    workflowStage:
      status === "completed"
        ? "triage-ordered"
        : status === "watching"
          ? "triage-watch"
          : "triage-escalation",
    deliverable:
      "ranked incident queue with ownership, acknowledgement, remediation, and verification priorities",
    status,
    operatorSummary:
      args.classificationLabel
        ? `${args.classificationLabel} is currently the dominant incident class across ${args.openCount} open incident(s).`
        : `${args.openCount} open incident(s) were ranked into a bounded triage queue.`,
    recommendedNextActions: [
      ...args.triageQueue.slice(0, 3).map((entry) => entry.nextAction),
      ...(args.summary.unownedCount > 0
        ? [`Assign owners for ${args.summary.unownedCount} unowned prioritized incident(s).`]
        : []),
      ...(args.summary.ackPendingCount > 0
        ? [`Acknowledge ${args.summary.ackPendingCount} incident(s) that are still waiting on operator acknowledgement.`]
        : []),
    ].slice(0, 4),
    escalationReason:
      status === "escalate"
        ? "Escalate because critical incidents remain open in the triage queue."
        : null,
  });
}

async function handleTask(task: Task): Promise<Result> {
  const startTime = Date.now();

    if (!canUseSkill("documentParser")) {
      const specialistFields = buildSpecialistOperatorFields({
        role: "SRE Monitor",
        workflowStage: "monitor-refusal",
        deliverable:
          "runtime diagnosis with prioritized operator actions, dependency posture, and early-warning evidence",
        status: "refused",
        operatorSummary:
          "System monitoring was refused because the governed documentParser path is unavailable to this agent.",
        recommendedNextActions: [
          "Restore documentParser access for system-monitor-agent before retrying the monitor pass.",
          "Do not treat this lane as monitored until a bounded monitor run succeeds.",
        ],
        refusalReason:
          "Refused monitoring because documentParser skill access is not allowed for system-monitor-agent.",
      });
      return {
        success: false,
        metrics: {
          timestamp: new Date().toISOString(),
        agentHealth: {},
        systemMetrics: {},
        alerts: ["documentParser skill access is required"],
        },
        relationships: [],
        toolInvocations: [],
        diagnoses: [],
        proofTransitions: [],
        escalationWatch: [],
        remediationQueue: [],
        workflowWatch: buildWorkflowBlockerSummary([]),
        operatorActions: [],
        earlyWarnings: [],
        dependencyHealth: {
          status: "healthy",
          blockedWorkflowCount: 0,
          proofFailureCount: 0,
          staleAgentCount: 0,
          retryRecoveryCount: 0,
        },
        queueBudgetFusion: {
          status: "healthy",
          retryRecoveryCount: 0,
          failedExecutionCount: 0,
          pendingApprovalCount: 0,
          ownerlessIncidentCount: 0,
          budgetStatus: "unknown",
          communicationLaneAtRisk: false,
          dependencyRiskScore: 0,
          predictionConfidence: "low",
        },
        operationalDiagnosis: {
          status: "stable",
          dominantRisk: null,
          diagnosisCount: 0,
          operatorActionCount: 0,
          remediationQueueDepth: 0,
          dependencyStatus: "healthy",
          trustBoundaryStatus: "nominal",
          budgetStatus: "unknown",
          proofFreshness: {
            milestone: "empty",
            demandSummary: "empty",
          },
        },
        trendSummary: {
          status: "stable",
          recentHourSignals: 0,
          recentTwentyFourHourSignals: 0,
          trustBoundaryTrend: "stable",
          queuePressureTrend: "stable",
        },
        operatorClosureEvidence: {
          status: "blocked",
          openCriticalIncidents: 0,
          prioritizedActions: 0,
          verifierSensitiveIncidents: 0,
          ownerlessIncidents: 0,
          proofFreshness: "empty",
        },
        ...specialistFields,
        executionTime: Date.now() - startTime,
      };
    }

  try {
    const config = loadConfig();
    const state = await loadRuntimeState<RuntimeState>(
      configPath,
      config.orchestratorStatePath,
    );
    const descriptors = await listAgentDescriptors();
    const selectedAgents =
      Array.isArray(task.agents) && task.agents.length > 0
        ? descriptors.filter((descriptor) => task.agents?.includes(descriptor.id))
        : descriptors;

    const agentHealthEntries = await Promise.all(
      selectedAgents.map(async (descriptor) => {
        const [serviceState, stale] = await Promise.all([
          loadServiceState(descriptor),
          isServiceStateStale(descriptor, 2 * 60 * 60 * 1000),
        ]);
        return {
          descriptor,
          serviceState,
          stale,
          health: deriveAgentHealthSnapshot({
            descriptor,
            state,
            serviceState,
            stale,
          }),
        } as const;
      }),
    );

    const agentHealth = Object.fromEntries(
      agentHealthEntries.map((entry) => [entry.descriptor.id, entry.health]),
    );
    const agentServiceStates = new Map(
      agentHealthEntries.map((entry) => [entry.descriptor.id, entry.serviceState] as const),
    );
    const taskExecutionSummary = summarizeTaskExecutions(state.taskExecutions ?? []);
    const openIncidentRecords = (state.incidentLedger ?? []).filter(
      (incident) => incident.status !== "resolved",
    );
    const filteredIncidentRecords =
      typeof task.classification === "string" && task.classification.trim().length > 0
        ? openIncidentRecords.filter(
            (incident) => incident.classification === task.classification?.trim(),
          )
        : openIncidentRecords;
    const incidentSummary = summarizeIncidents(state.incidentLedger ?? []);
    const remediationQueue = buildIncidentPriorityQueue(filteredIncidentRecords).slice(
      0,
      Number.isFinite(task.limit) ? Math.max(1, Math.min(Number(task.limit), 12)) : 8,
    );
    const pendingApprovalCount = (state.approvals ?? []).filter(
      (entry) => entry.status === "pending",
    ).length;
    const workflowWatch = buildWorkflowBlockerSummary(state.workflowEvents ?? []);
    const proofMetrics = {
      milestone: summarizeRuntimeProofSurface(state, "milestone"),
      demandSummary: summarizeRuntimeProofSurface(state, "demandSummary"),
    };
    const proofFreshness = {
      milestone: resolveProofFreshnessStatus(proofMetrics.milestone.latestDeliveredAt),
      demandSummary: resolveProofFreshnessStatus(
        proofMetrics.demandSummary.latestDeliveredAt,
      ),
    };
    const repairSummary = countByStatus(state.repairRecords ?? []);
    const incidentCausality = (state.incidentLedger ?? [])
      .filter((incident) => incident.status !== "resolved")
      .slice(0, 8)
      .map((incident) => {
        const matchingPriority = remediationQueue.find(
          (candidate) => candidate.incidentId === incident.incidentId,
        );
        const diagnosisId =
          incident.classification === "proof-delivery"
            ? proofMetrics.milestone.deadLetter > 0 || proofMetrics.demandSummary.deadLetter > 0
              ? "proof-transport-dead-letter"
              : proofFreshness.milestone !== "fresh" || proofFreshness.demandSummary !== "fresh"
                ? "proof-freshness"
                : null
            : incident.classification === "service-runtime"
              ? workflowWatch.totalStopSignals > 0
                ? "workflow-stop-signals"
                : incident.severity === "critical"
                  ? "critical-incidents-open"
                  : "queue-pressure"
              : incident.severity === "critical"
                ? "critical-incidents-open"
                : null;

        return {
          incidentId: incident.incidentId,
          diagnosisId,
          severity: incident.severity,
          recommendedOwner: matchingPriority?.recommendedOwner ?? incident.owner ?? null,
          affectedAgents: deriveIncidentAffectedAgents(incident),
          reason:
            diagnosisId === "proof-transport-dead-letter"
              ? "Dead-letter public proof evidence is causally linked to this incident."
              : diagnosisId === "proof-freshness"
                ? "Proof freshness drift is causally linked to this incident."
                : diagnosisId === "workflow-stop-signals"
                  ? "Workflow stop pressure is causally linked to this incident."
                  : diagnosisId === "queue-pressure"
                    ? "Retry debt or failed executions are contributing to this incident."
                    : "Critical incident severity requires direct monitoring attention."
          ,
          evidence: [
            `classification:${incident.classification}`,
            `severity:${incident.severity}`,
            ...(diagnosisId ? [`diagnosis:${diagnosisId}`] : []),
            ...(matchingPriority ? [`priority-score:${matchingPriority.priorityScore}`] : []),
            ...deriveIncidentAffectedAgents(incident)
              .slice(0, 3)
              .map((agentId) => `affected-agent:${agentId}`),
          ],
        };
      });
    const redditBudgetDate = resolveBudgetDate(
      new Date(),
      process.env.REDDIT_HELPER_BUDGET_RESET_TZ?.trim() || DEFAULT_BUDGET_RESET_TZ,
    );
    const redditBudgetState = await loadSharedBudgetState(redditBudgetDate).catch(() => null);
    const budgetPosture = {
      status:
        redditBudgetState?.budgetStatus === "exhausted"
          ? "degraded"
          : typeof redditBudgetState?.tokensToday === "number" &&
              redditBudgetState.tokensToday > 0
            ? "watching"
            : redditBudgetState
              ? "healthy"
              : "unknown",
      llmCallsToday:
        typeof redditBudgetState?.llmCallsToday === "number"
          ? redditBudgetState.llmCallsToday
          : null,
      tokensToday:
        typeof redditBudgetState?.tokensToday === "number"
          ? redditBudgetState.tokensToday
          : null,
      source: redditBudgetState ? "redis-coordination-budget" : null,
    } as const;
    const degradationTrends = {
      failingAgents: Object.values(agentHealth).filter(
        (snapshot) => snapshot.status === "DEGRADED",
      ).length,
      staleAgents: Object.values(agentHealth).filter(
        (snapshot) => snapshot.status === "STALE",
      ).length,
      retryRecoveries: (state.taskRetryRecoveries ?? []).length,
      criticalIncidents: incidentSummary.criticalCount,
    };
    const referenceTimestamp = resolveRuntimeReferenceTimestamp(state);
    const degradationWindows = buildDegradationWindows(state, referenceTimestamp);
    const trustBoundaryPressure = buildTrustBoundaryPressure({
      incidents: state.incidentLedger ?? [],
      degradedAgentCount: degradationTrends.failingAgents + degradationTrends.staleAgents,
    });
    const earlyWarnings = buildEarlyWarnings({
      proofMetrics,
      workflowWatch,
      retryRecoveryCount: (state.taskRetryRecoveries ?? []).length,
      budgetPosture,
      trustBoundaryPressure,
      taskExecutionSummary,
    });
    const dependencyHealth = buildDependencyHealth({
      workflowWatch,
      degradationWindows,
      degradationTrends,
    });
    const queueBudgetFusion = buildQueueBudgetFusion({
      taskExecutionSummary,
      retryRecoveryCount: (state.taskRetryRecoveries ?? []).length,
      pendingApprovalCount,
      ownerlessIncidentCount: remediationQueue.filter((incident) => incident.owner === null).length,
      budgetPosture,
      dependencyHealth,
    });
    const alerts: string[] = [];

    if (incidentSummary.criticalCount > 0) {
      alerts.push(`${incidentSummary.criticalCount} critical incident(s) remain open`);
    }
    if ((proofMetrics.milestone.deadLetter ?? 0) > 0) {
      alerts.push(`${proofMetrics.milestone.deadLetter} milestone delivery dead-letter record(s)`);
    }
    if ((proofMetrics.demandSummary.deadLetter ?? 0) > 0) {
      alerts.push(
        `${proofMetrics.demandSummary.deadLetter} demand-summary dead-letter record(s)`,
      );
    }
    if ((taskExecutionSummary.failed ?? 0) > 0) {
      alerts.push(`${taskExecutionSummary.failed} failed task execution(s) recorded`);
    }
    if ((state.taskRetryRecoveries ?? []).length > 0) {
      alerts.push(`${state.taskRetryRecoveries?.length ?? 0} retry recovery item(s) queued`);
    }
    if (proofFreshness.milestone === "stale" || proofFreshness.demandSummary === "stale") {
      alerts.push("proof freshness is stale on one or more public proof surfaces");
    }
    if (budgetPosture.status === "degraded") {
      alerts.push("llm budget posture is degraded according to shared coordination state");
    }
    if (queueBudgetFusion.status === "degraded" || queueBudgetFusion.status === "critical") {
      alerts.push("queue and budget posture are reinforcing delivery pressure across runtime lanes");
    }
    if (trustBoundaryPressure.status === "elevated" || trustBoundaryPressure.status === "critical") {
      alerts.push(
        `${trustBoundaryPressure.status} trust-boundary pressure detected across runtime incidents`,
      );
    }
    for (const [agentId, snapshot] of Object.entries(agentHealth)) {
      if (snapshot.status === "DEGRADED" || snapshot.status === "STALE") {
        alerts.push(`${agentId} ${snapshot.status.toLowerCase()} according to runtime evidence`);
      }
    }

    const diagnoses: Result["diagnoses"] = [];
    if (incidentSummary.criticalCount > 0) {
      diagnoses.push({
        id: "critical-incidents-open",
        severity: "critical",
        summary: `${incidentSummary.criticalCount} critical incident(s) remain unresolved.`,
        recommendedOwner: "operator",
        nextAction: "Prioritize critical incident remediation and verifier closure.",
        evidence: [
          `open-incidents:${incidentSummary.openCount}`,
          `critical-incidents:${incidentSummary.criticalCount}`,
        ],
      });
    }
    if ((proofMetrics.milestone.deadLetter ?? 0) > 0 || (proofMetrics.demandSummary.deadLetter ?? 0) > 0) {
      diagnoses.push({
        id: "proof-transport-dead-letter",
        severity: "warning",
        summary: "Public proof dead-letter records are present.",
        recommendedOwner: "system-monitor-agent",
        nextAction: "Inspect public proof evidence and drive replay or escalation.",
        evidence: [
          `milestone-dead-letter:${proofMetrics.milestone.deadLetter ?? 0}`,
          `demand-dead-letter:${proofMetrics.demandSummary.deadLetter ?? 0}`,
        ],
      });
    }
    if (proofFreshness.milestone !== "fresh" || proofFreshness.demandSummary !== "fresh") {
      diagnoses.push({
        id: "proof-freshness",
        severity:
          proofFreshness.milestone === "stale" || proofFreshness.demandSummary === "stale"
            ? "warning"
            : "info",
        summary: "Public proof freshness is no longer fully fresh.",
        recommendedOwner: "system-monitor-agent",
        nextAction: "Check public proof cadence and confirm recent surfaces are still updating.",
        evidence: [
          `milestone:${proofFreshness.milestone}`,
          `demandSummary:${proofFreshness.demandSummary}`,
        ],
      });
    }
    if ((state.taskRetryRecoveries ?? []).length > 0 || (taskExecutionSummary.failed ?? 0) > 0) {
      diagnoses.push({
        id: "queue-pressure",
        severity: "warning",
        summary: "Queue pressure or retry debt is visible in runtime state.",
        recommendedOwner: "integration-agent",
        nextAction: "Reconcile retries, review blocked workflows, and confirm recovery paths.",
        evidence: [
          `retry-recoveries:${state.taskRetryRecoveries?.length ?? 0}`,
          `failed-executions:${taskExecutionSummary.failed ?? 0}`,
        ],
      });
    }
    if (budgetPosture.status !== "unknown" && budgetPosture.status !== "healthy") {
      diagnoses.push({
        id: "budget-posture",
        severity: budgetPosture.status === "degraded" ? "warning" : "info",
        summary:
          budgetPosture.status === "degraded"
            ? "LLM budget posture is degraded."
            : "LLM budget posture is under watch.",
        recommendedOwner: "reddit-helper",
        nextAction:
          budgetPosture.status === "degraded"
            ? "Reduce optional provider work or restore budget before communication lanes degrade further."
            : "Track token and LLM call consumption before the daily budget hardens into a block.",
        evidence: [
          `llmCallsToday:${budgetPosture.llmCallsToday ?? "unknown"}`,
          `tokensToday:${budgetPosture.tokensToday ?? "unknown"}`,
        ],
      });
    }
    if (trustBoundaryPressure.status !== "nominal") {
      diagnoses.push({
        id: "trust-boundary-pressure",
        severity:
          trustBoundaryPressure.status === "critical"
            ? "critical"
            : trustBoundaryPressure.status === "elevated"
              ? "warning"
              : "info",
        summary: `Trust-boundary pressure is ${trustBoundaryPressure.status} across monitored runtime evidence.`,
        recommendedOwner:
          trustBoundaryPressure.authSurfaceCount > 0 ? "security-agent" : "system-monitor-agent",
        nextAction:
          trustBoundaryPressure.authSurfaceCount > 0
            ? "Audit auth/cors boundary regressions and contain affected surfaces before widening execution."
            : "Review recurring trust-boundary incidents and stabilize the affected runtime lane.",
        evidence: [
          `relevant-incidents:${trustBoundaryPressure.relevantIncidentCount}`,
          `recurring:${trustBoundaryPressure.recurringCount}`,
          `auth-surface:${trustBoundaryPressure.authSurfaceCount}`,
          `proof-boundary:${trustBoundaryPressure.proofBoundaryCount}`,
        ],
      });
    }
    if (workflowWatch.totalStopSignals > 0) {
      diagnoses.push({
        id: "workflow-stop-signals",
        severity: workflowWatch.proofStopSignals > 0 ? "critical" : "warning",
        summary: `${workflowWatch.totalStopSignals} workflow stop signal(s) are present in runtime history.`,
        recommendedOwner: workflowWatch.proofStopSignals > 0 ? "integration-agent" : "system-monitor-agent",
        nextAction:
          workflowWatch.proofStopSignals > 0
            ? "Prioritize blocked proof/workflow paths and confirm verifier closure."
            : "Inspect recent workflow stop codes and route recovery through the owning agent.",
        evidence: [
          `latest-stop:${workflowWatch.latestStopCode ?? "none"}`,
          `blocked-runs:${workflowWatch.blockedRunIds.length}`,
          `proof-stop-signals:${workflowWatch.proofStopSignals}`,
        ],
      });
    }
    if (dependencyHealth.status === "degraded" || dependencyHealth.status === "critical") {
      diagnoses.push({
        id: "dependency-health",
        severity: dependencyHealth.status === "critical" ? "critical" : "warning",
        summary: `Dependency health is ${dependencyHealth.status} across workflow, proof, and retry evidence.`,
        recommendedOwner: "integration-agent",
        nextAction: "Reconcile blocked workflows, stale agent state, and proof failures before widening execution.",
        evidence: [
          `blocked-workflows:${dependencyHealth.blockedWorkflowCount}`,
          `proof-failures:${dependencyHealth.proofFailureCount}`,
          `stale-agents:${dependencyHealth.staleAgentCount}`,
          `retry-recoveries:${dependencyHealth.retryRecoveryCount}`,
        ],
      });
    }
    if (queueBudgetFusion.status === "degraded" || queueBudgetFusion.status === "critical") {
      diagnoses.push({
        id: "queue-budget-fusion",
        severity: queueBudgetFusion.status === "critical" ? "critical" : "warning",
        summary: `Queue and budget posture are ${queueBudgetFusion.status} across retry, failure, and approval evidence.`,
        recommendedOwner:
          queueBudgetFusion.budgetStatus === "degraded" ? "reddit-helper" : "integration-agent",
        nextAction:
          queueBudgetFusion.communicationLaneAtRisk
            ? "Reduce optional communication work and reconcile retries before more delivery lanes stall."
            : "Reconcile retries, pending approvals, and queue owners before backlog widens.",
        evidence: [
          `retry-recoveries:${queueBudgetFusion.retryRecoveryCount}`,
          `failed-executions:${queueBudgetFusion.failedExecutionCount}`,
          `pending-approvals:${queueBudgetFusion.pendingApprovalCount}`,
          `budget-status:${queueBudgetFusion.budgetStatus}`,
        ],
      });
    }
    if (remediationQueue.some((incident) => incident.owner === null)) {
      diagnoses.push({
        id: "unowned-incidents",
        severity: "warning",
        summary: `${remediationQueue.filter((incident) => incident.owner === null).length} prioritized incident(s) lack an explicit owner.`,
        recommendedOwner: "operator",
        nextAction: "Assign owners or confirm preferred-owner policy before remediation drifts further.",
        evidence: remediationQueue
          .filter((incident) => incident.owner === null)
          .slice(0, 4)
          .map((incident) => `incident:${incident.incidentId}:${incident.recommendedOwner ?? "no-policy-owner"}`),
      });
    }
    const escalationWatch = (state.incidentLedger ?? [])
      .filter((incident) => incident.status !== "resolved")
      .filter((incident) =>
        incident.escalation?.level === "escalated" ||
        incident.escalation?.level === "breached" ||
        incident.severity === "critical",
      )
      .slice(0, 8)
      .map((incident) => ({
        incidentId: incident.incidentId ?? "unknown-incident",
        severity: incident.severity ?? "warning",
        owner: typeof incident.owner === "string" ? incident.owner : null,
        summary: incident.summary ?? "No summary recorded.",
      }));
    const operatorActions: Result["operatorActions"] = [
      ...remediationQueue.slice(0, 4).map(
        (incident): Result["operatorActions"][number] => ({
          id: `remediate:${incident.incidentId}`,
          priority:
            incident.severity === "critical"
              ? "critical"
              : incident.priorityScore >= 30
                ? "high"
                : "medium",
          owner: incident.recommendedOwner ?? incident.owner ?? "operator",
          summary: incident.nextAction,
          evidence: [
            `incident:${incident.incidentId}`,
            `severity:${incident.severity}`,
            ...(incident.blockers.slice(0, 2).map((blocker) => `blocker:${blocker}`)),
          ],
        }),
      ),
      ...(workflowWatch.totalStopSignals > 0
        ? [
            {
              id: "workflow-watch",
              priority: workflowWatch.proofStopSignals > 0 ? "critical" : "high",
              owner: "integration-agent",
              summary:
                workflowWatch.proofStopSignals > 0
                  ? "Drive recovery for proof-linked workflow stop signals."
                  : "Reconcile recent workflow stop codes with recovery paths.",
              evidence: [
                `latest-stop:${workflowWatch.latestStopCode ?? "none"}`,
                `blocked-runs:${workflowWatch.blockedRunIds.length}`,
              ],
            } satisfies Result["operatorActions"][number],
          ]
        : []),
      ...(trustBoundaryPressure.status === "elevated" || trustBoundaryPressure.status === "critical"
        ? [
            {
              id: "trust-boundary-pressure",
              priority:
                trustBoundaryPressure.status === "critical" ? "critical" : "high",
              owner:
                trustBoundaryPressure.authSurfaceCount > 0
                  ? "security-agent"
                  : "system-monitor-agent",
              summary:
                trustBoundaryPressure.authSurfaceCount > 0
                  ? "Contain auth/cors trust-boundary pressure before the affected lane widens."
                  : "Stabilize recurring trust-boundary pressure before it becomes an operator-visible incident spike.",
              evidence: [
                `relevant-incidents:${trustBoundaryPressure.relevantIncidentCount}`,
                `recurring:${trustBoundaryPressure.recurringCount}`,
                `proof-boundary:${trustBoundaryPressure.proofBoundaryCount}`,
              ],
            } satisfies Result["operatorActions"][number],
          ]
        : []),
      ...(dependencyHealth.status === "degraded" || dependencyHealth.status === "critical"
        ? [
            {
              id: "dependency-health",
              priority: dependencyHealth.status === "critical" ? "critical" : "high",
              owner: "integration-agent",
              summary: "Stabilize dependency health before more workflow lanes stall.",
              evidence: [
                `blocked-workflows:${dependencyHealth.blockedWorkflowCount}`,
                `proof-failures:${dependencyHealth.proofFailureCount}`,
                `stale-agents:${dependencyHealth.staleAgentCount}`,
              ],
            } satisfies Result["operatorActions"][number],
          ]
        : []),
      ...(queueBudgetFusion.status === "degraded" || queueBudgetFusion.status === "critical"
        ? [
            {
              id: "queue-budget-fusion",
              priority: queueBudgetFusion.status === "critical" ? "critical" : "high",
              owner:
                queueBudgetFusion.budgetStatus === "degraded"
                  ? "reddit-helper"
                  : "integration-agent",
              summary: "Reduce queue pressure and budget-backed communication risk before more work is deferred.",
              evidence: [
                `retry-recoveries:${queueBudgetFusion.retryRecoveryCount}`,
                `failed-executions:${queueBudgetFusion.failedExecutionCount}`,
                `pending-approvals:${queueBudgetFusion.pendingApprovalCount}`,
              ],
            } satisfies Result["operatorActions"][number],
          ]
        : []),
    ].slice(0, 6);
    const operationalDiagnosis: Result["operationalDiagnosis"] = {
      status:
        diagnoses.some((diagnosis) => diagnosis.severity === "critical") ||
        dependencyHealth.status === "critical" ||
        trustBoundaryPressure.status === "critical" ||
        queueBudgetFusion.status === "critical"
          ? "critical"
          : diagnoses.length > 0 ||
              dependencyHealth.status !== "healthy" ||
              trustBoundaryPressure.status !== "nominal" ||
              queueBudgetFusion.status !== "healthy"
            ? "watching"
            : "stable",
      dominantRisk:
        diagnoses.find((diagnosis) => diagnosis.severity === "critical")?.id ??
        diagnoses[0]?.id ??
        null,
      diagnosisCount: diagnoses.length,
      operatorActionCount: operatorActions.length,
      remediationQueueDepth: remediationQueue.length,
      dependencyStatus: dependencyHealth.status,
      trustBoundaryStatus: trustBoundaryPressure.status,
      budgetStatus: budgetPosture.status,
      proofFreshness,
    };
    const trendSummary = buildTrendSummary({
      degradationWindows,
      trustBoundaryPressure,
      queueBudgetFusion,
    });
    const serializedRemediationQueue = remediationQueue.map((incident) => ({
      incidentId: incident.incidentId,
      priorityScore: incident.priorityScore,
      severity: incident.severity,
      owner: incident.owner,
      recommendedOwner: incident.recommendedOwner,
      nextAction: incident.nextAction,
      remediationTaskType: incident.remediationTaskType,
      blockers: incident.blockers,
    }));
    const incidentTriageSummary = {
      openCount: filteredIncidentRecords.length,
      criticalCount: filteredIncidentRecords.filter(
        (incident) => incident.severity === "critical",
      ).length,
      unownedCount: filteredIncidentRecords.filter((incident) => !incident.owner).length,
      ackPendingCount: filteredIncidentRecords.filter((incident) => !incident.acknowledgedAt)
        .length,
      remediationCount: filteredIncidentRecords.filter(
        (incident) => incident.remediation.status !== "resolved",
      ).length,
      verificationCount: filteredIncidentRecords.filter(
        (incident) => incident.verification.status !== "not-required",
      ).length,
    };
    const incidentTriage = {
      summary: incidentTriageSummary,
      classificationBuckets: buildIncidentTriageClassificationBuckets(filteredIncidentRecords),
      triageQueue: serializedRemediationQueue,
    };
    const operatorClosureEvidence = buildOperatorClosureEvidence({
      incidentSummary,
      operatorActions,
      remediationQueue: serializedRemediationQueue,
      workflowWatch,
      proofFreshness,
    });
    const specialistFields = buildSystemMonitorSpecialistFields({
      operationalDiagnosis,
      dependencyHealth,
      queueBudgetFusion,
      operatorActions,
      earlyWarnings,
    });
    const incidentTriageFields =
      task.type === "incident-triage"
        ? buildIncidentTriageSpecialistFields({
            openCount: incidentTriageSummary.openCount,
            criticalCount: incidentTriageSummary.criticalCount,
            classificationLabel: incidentTriage.classificationBuckets[0]?.classification ?? null,
            triageQueue: serializedRemediationQueue,
            summary: incidentTriageSummary,
          })
        : null;
    const proofTransitions: Result["proofTransitions"] = [
      {
        transport: "milestone",
        detail: `Milestone public proof surface is ${proofMetrics.milestone.deadLetter > 0 ? "degraded" : proofFreshness.milestone === "fresh" ? "fresh" : proofFreshness.milestone} in runtime monitoring.`,
        evidence: [
          `pending:${proofMetrics.milestone.pending}`,
          `retrying:${proofMetrics.milestone.retrying}`,
          `deadLetter:${proofMetrics.milestone.deadLetter}`,
          `freshness:${proofFreshness.milestone}`,
        ],
        classification: "proof-monitoring",
      },
      {
        transport: "demandSummary",
        detail: `Demand summary public proof surface is ${proofMetrics.demandSummary.deadLetter > 0 ? "degraded" : proofFreshness.demandSummary === "fresh" ? "fresh" : proofFreshness.demandSummary} in runtime monitoring.`,
        evidence: [
          `pending:${proofMetrics.demandSummary.pending}`,
          `retrying:${proofMetrics.demandSummary.retrying}`,
          `deadLetter:${proofMetrics.demandSummary.deadLetter}`,
          `freshness:${proofFreshness.demandSummary}`,
        ],
        classification: "proof-monitoring",
      },
    ];
    const monitorRelationships: Result["relationships"] = selectedAgents.map((descriptor) => ({
      from: "agent:system-monitor-agent",
      to: `agent:${descriptor.id}`,
      relationship: "monitors-agent",
      detail: `system-monitor-agent fused service-state and task-execution telemetry for ${descriptor.id}.`,
      evidence: [
        `health:${agentHealth[descriptor.id]?.status ?? "UNKNOWN"}`,
        descriptor.orchestratorTask
          ? `task-route:${descriptor.orchestratorTask}`
          : "task-route:unassigned",
      ],
      classification: "telemetry-fusion",
    }));
    const influenceRelationships: Result["relationships"] = incidentCausality
      .flatMap((entry) => {
        const targets = [
          ...(entry.recommendedOwner && entry.recommendedOwner.endsWith("-agent")
            ? [entry.recommendedOwner]
            : []),
          ...entry.affectedAgents,
        ];
        return Array.from(new Set(targets)).map((agentId) => ({
          from: "agent:system-monitor-agent",
          to: `agent:${agentId}`,
          relationship: "feeds-agent" as const,
          detail: `system-monitor-agent routed incident ${entry.incidentId} monitoring evidence toward ${agentId}.`,
          evidence: entry.evidence,
          classification: "incident-causality",
        }));
      })
      .slice(0, 12);
    const relationships: Result["relationships"] = [
      ...monitorRelationships,
      ...influenceRelationships,
    ];
    const toolInvocations: Result["toolInvocations"] = [
      {
        toolId: "documentParser",
        detail: "system-monitor-agent parsed runtime state, agent manifests, and service-state evidence.",
        evidence: [
          `agents:${selectedAgents.length}`,
          `incidents:${incidentSummary.openCount}`,
          `workflow-events:${(state.workflowEvents ?? []).length}`,
        ],
        classification: "required",
      },
    ];

    return {
      success: true,
      metrics: {
        timestamp: new Date().toISOString(),
        agentHealth,
        systemMetrics: {
          stateUpdatedAt: state.updatedAt ?? null,
          lastStartedAt: state.lastStartedAt ?? null,
          taskExecutions: taskExecutionSummary,
          pendingApprovalCount,
          repairSummary,
          openIncidentCount: incidentSummary.openCount,
          criticalIncidentCount: incidentSummary.criticalCount,
          retryRecoveryCount: (state.taskRetryRecoveries ?? []).length,
          proofDelivery: proofMetrics,
          proofFreshness,
          budgetPosture,
          degradationTrends,
          degradationWindows,
          trustBoundaryPressure,
          dependencyHealth,
          queueBudgetFusion,
          workflowEventCount: (state.workflowEvents ?? []).length,
          relationshipObservationCount: (state.relationshipObservations ?? []).length,
        },
        alerts,
      },
      ...(task.type === "incident-triage" ? { incidentTriage } : {}),
      relationships,
      toolInvocations,
      diagnoses,
      proofTransitions,
      escalationWatch,
      remediationQueue: serializedRemediationQueue,
      incidentCausality,
      workflowWatch,
      operatorActions,
      earlyWarnings,
      dependencyHealth,
      queueBudgetFusion,
      operationalDiagnosis,
      trendSummary,
      operatorClosureEvidence,
      ...(incidentTriageFields ?? specialistFields),
      executionTime: Date.now() - startTime,
    };
  } catch (error) {
    const specialistFields = buildSpecialistOperatorFields({
      role: "SRE Monitor",
      workflowStage: "monitor-failed",
      deliverable:
        "runtime diagnosis with prioritized operator actions, dependency posture, and early-warning evidence",
      status: "blocked",
      operatorSummary:
        "System monitoring failed before it could assemble a trustworthy runtime diagnosis.",
      recommendedNextActions: [
        "Inspect the monitor failure and restore the bounded runtime evidence path.",
        "Keep the affected lane on watch until a new monitor pass succeeds.",
      ],
    });
    return {
      success: false,
      metrics: {
        timestamp: new Date().toISOString(),
        agentHealth: {},
        systemMetrics: {},
        alerts: [(error as Error).message],
      },
      relationships: [],
      toolInvocations: [],
      diagnoses: [],
      proofTransitions: [],
      escalationWatch: [],
      remediationQueue: [],
      incidentCausality: [],
      workflowWatch: buildWorkflowBlockerSummary([]),
      operatorActions: [],
      earlyWarnings: [],
      dependencyHealth: {
        status: "healthy",
        blockedWorkflowCount: 0,
        proofFailureCount: 0,
        staleAgentCount: 0,
        retryRecoveryCount: 0,
      },
      queueBudgetFusion: {
        status: "healthy",
        retryRecoveryCount: 0,
        failedExecutionCount: 0,
        pendingApprovalCount: 0,
        ownerlessIncidentCount: 0,
        budgetStatus: "unknown",
        communicationLaneAtRisk: false,
        dependencyRiskScore: 0,
        predictionConfidence: "low",
      },
      operationalDiagnosis: {
        status: "stable",
        dominantRisk: null,
        diagnosisCount: 0,
        operatorActionCount: 0,
        remediationQueueDepth: 0,
        dependencyStatus: "healthy",
        trustBoundaryStatus: "nominal",
        budgetStatus: "unknown",
        proofFreshness: {
          milestone: "empty",
          demandSummary: "empty",
        },
      },
      trendSummary: {
        status: "stable",
        recentHourSignals: 0,
        recentTwentyFourHourSignals: 0,
        trustBoundaryTrend: "stable",
        queuePressureTrend: "stable",
      },
      operatorClosureEvidence: {
        status: "blocked",
        openCriticalIncidents: 0,
        prioritizedActions: 0,
        verifierSensitiveIncidents: 0,
        ownerlessIncidents: 0,
        proofFreshness: "empty",
      },
      ...specialistFields,
      executionTime: Date.now() - startTime,
    };
  }
}

export { handleTask, loadConfig, canUseSkill };

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    return;
  }

  const raw = await readFile(payloadPath, "utf-8");
  const payload = JSON.parse(raw) as Task;
  const result = await handleTask(payload);

  const resultFile = process.env.SYSTEM_MONITOR_AGENT_RESULT_FILE;
  if (resultFile) {
    await mkdir(dirname(resultFile), { recursive: true });
    await writeFile(resultFile, JSON.stringify(result, null, 2), "utf-8");
  } else {
    process.stdout.write(JSON.stringify(result));
  }

  if (result.success !== true) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
