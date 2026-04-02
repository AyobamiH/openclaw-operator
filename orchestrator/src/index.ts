import { loadConfig } from "./config.js";
import { DocIndexer } from "./docIndexer.js";
import { TaskQueue } from "./taskQueue.js";
import {
  appendRelationshipObservationRecord,
  appendWorkflowEventRecord,
  getRetryRecoveryDelayMs,
  isMongoStateTarget,
  loadState,
  reconcileInFlightTaskExecutionState,
  reconcileTaskRetryRecoveryState,
  saveStateWithOptions as persistState,
  summarizeGovernanceVisibility,
  updateRepairRecord,
  upsertRepairRecord,
} from "./state.js";
import {
  ALLOWED_TASK_TYPES,
  consumeReviewQueueItemForApprovalDecision,
  resolveTaskHandler,
} from "./taskHandlers.js";
import {
  AlertManager,
  TaskFailureTracker,
  buildAlertConfig,
} from "./alerter.js";
import {
  ApprovalRecord,
  IncidentAcknowledgementRecord,
  IncidentEscalationState,
  IncidentHistoryEvent,
  IncidentLedgerRecord,
  IncidentLedgerStatus,
  IncidentLedgerClassification,
  IncidentLedgerSeverity,
  IncidentLedgerTruthLayer,
  IncidentOwnershipRecord,
  IncidentPolicyExecutionRecord,
  IncidentRemediationOwner,
  IncidentRemediationPlanStep,
  IncidentRemediationPolicy,
  IncidentRemediationStatus,
  IncidentRemediationTaskRecord,
  IncidentRemediationTaskStatus,
  IncidentVerificationState,
  MaintenanceCheckId,
  MaintenanceCheckRecord,
  OrchestratorState,
  RelationshipObservationRecord,
  RelationshipObservationStatus,
  RelationshipObservationType,
  Task,
  TaskExecutionVisibility,
  TaskRetryRecoveryRecord,
  ToolInvocation,
  WorkflowEventRecord,
  WorkflowEventStage,
} from "./types.js";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import cron from "node-cron";
import { startMetricsServer } from "./metrics/index.js";
import { onApprovalCompleted, onApprovalRequested } from "./metrics/index.js";
import { alertHandler } from "./alerts/alert-handler.js";
import {
  finalizeTaskExecutionAccounting,
  summarizeExecutionAccounting,
} from "./accounting/cost-accounting.js";
import { knowledgeIntegration } from "./knowledge/integration.js";
import { PersistenceIntegration } from "./persistence/index.js";
import { getAgentRegistry } from "./agentRegistry.js";
import { getToolGate } from "./toolGate.js";
import { buildIncidentPriorityQueue } from "./incident-priority.js";
import {
  assertApprovalIfRequired,
  decideApproval,
  listPendingApprovals,
} from "./approvalGate.js";
import { buildOpenApiSpec } from "./openapi.js";
import express from "express";
import {
  requireBearerToken,
  requireRole,
  auditProtectedAction,
  verifyWebhookSignature,
  logSecurityEvent,
  verifyKeyRotationPolicy,
} from "./middleware/auth.js";
import type { AuthenticatedRequest } from "./middleware/auth.js";
import {
  createValidationMiddleware,
  validateContentLength,
  AlertManagerWebhookSchema,
  ApprovalDecisionSchema,
  IncidentDetailParamsSchema,
  KBQuerySchema,
  IncidentAcknowledgeSchema,
  IncidentListQuerySchema,
  IncidentOwnerSchema,
  IncidentRemediationSchema,
  PersistenceHistoricalSchema,
  SkillsAuditQuerySchema,
  TaskRunsQuerySchema,
  TaskTriggerSchema,
} from "./middleware/validation.js";
import {
  webhookLimiter,
  apiLimiter,
  adminExportLimiter,
  healthLimiter,
  authLimiter,
  viewerReadLimiter,
  operatorWriteLimiter,
} from "./middleware/rate-limit.js";
import {
  getCachedJson,
  invalidateResponseCacheTags,
} from "./cache/response-cache.js";
import {
  collectGitHubWorkflowMonitorState,
  type GitHubWorkflowMonitorState,
} from "./githubWorkflowMonitor.js";
import {
  claimTaskExecutionLease,
  releaseTaskExecutionLease,
} from "./coordination/runtime-coordination.js";

/**
 * Security Posture Verification
 * Ensures critical security requirements are met before startup
 */
function verifySecurityPosture() {
  const requiredEnvVars = [
    "WEBHOOK_SECRET",
    "MONGO_PASSWORD",
    "REDIS_PASSWORD",
    "MONGO_USERNAME",
  ];

  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `[SECURITY] Critical environment variables missing: ${missing.join(", ")}. Refusing to start.`,
    );
  }

  const hasRotationKeys = Boolean(process.env.API_KEY_ROTATION?.trim());
  const hasPrimaryKey = Boolean(process.env.API_KEY?.trim());
  if (!hasRotationKeys && !hasPrimaryKey) {
    throw new Error(
      "[SECURITY] Missing auth credentials: set API_KEY_ROTATION (preferred) or API_KEY.",
    );
  }
  if (hasRotationKeys && hasPrimaryKey) {
    console.warn(
      "[SECURITY] Both API_KEY_ROTATION and API_KEY are set; using rotation list as primary credential source.",
    );
  }

  // Verify key rotation policy
  const keyStatus = verifyKeyRotationPolicy();
  if (!keyStatus.valid) {
    throw new Error(
      `[SECURITY] API Key rotation policy violation: ${keyStatus.warnings.join("; ")}`,
    );
  }

  keyStatus.warnings.forEach((w) => {
    console.warn(`[SECURITY] ⚠️ ${w}`);
  });

  console.log(
    "[SECURITY] ✅ Posture verification: PASS (all required credentials configured)",
  );
  console.log("[SECURITY] ✅ Key rotation policy: PASS");
}

type AgentMemoryState = {
  memoryVersion?: number;
  runtimeProofVersion?: number;
  agentId?: string;
  orchestratorStatePath?: string | null;
  lastRunAt?: string | null;
  lastStatus?: string | null;
  lastTaskId?: string | null;
  lastTaskType?: string | null;
  lastError?: string | null;
  successCount?: number;
  errorCount?: number;
  totalRuns?: number;
  initializedAt?: string;
  taskTimeline?: Array<{
    taskId?: string | null;
    taskType?: string | null;
    status?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    durationMs?: number | null;
    error?: string | null;
    resultSummary?: {
      success?: boolean;
      keys?: string[];
      highlights?: Record<string, unknown>;
    };
  }>;
  serviceHeartbeat?: {
    checkedAt?: string | null;
    status?: string | null;
    errorSummary?: string | null;
    source?: string | null;
  };
  taskPath?: {
    taskType?: string | null;
    lastObservedAt?: string | null;
    lastObservedStatus?: string | null;
    lastSuccessfulAt?: string | null;
    totalRuns?: number;
    successfulRuns?: number;
    failedRuns?: number;
    activeRuns?: number;
    lastError?: string | null;
  };
  summary?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  posture?: Record<string, unknown>;
  lastVerification?: Record<string, unknown>;
  lastResultSummary?: {
    success?: boolean;
    keys?: string[];
    highlights?: Record<string, unknown>;
  };
};

type AgentStatusValidation = "confirmed-worker" | "partial-worker" | "not-yet-verified";
type AgentFrontendExposure = "usable-now" | "partial" | "backend-only";
type AgentDependencySensitivity = "low" | "medium" | "high";
type AgentWorkerEvidenceSummary = {
  workerValidationStatus: AgentStatusValidation;
  lastEvidenceAt: string | null;
  evidenceSources: string[];
  lastSuccessfulRunId: string | null;
  lastSuccessfulTaskId: string | null;
  lastToolGateMode: string | null;
  lastToolGateSkillId: string | null;
  lastToolGateAt: string | null;
};

type ClaimedTruthLayer = {
  status: "declared";
  summary: string;
  controlPlane: "orchestrator";
  privateOperatorSurface: string;
  authoritativeHealthRoute: string;
  aggregateOverviewRoute: string;
  declaredAgents: number;
  allowlistedTaskTypes: number;
  approvalGatedTaskTypes: string[];
  evidence: TruthEvidenceItem[];
  signals: TruthSignal[];
};

type TruthEvidenceSeverity = "info" | "warning" | "critical";

type TruthEvidenceItem = {
  id: string;
  label: string;
  status: string;
  detail: string;
  route?: string | null;
  value?: string | number | boolean | null;
};

type TruthSignal = {
  id: string;
  severity: TruthEvidenceSeverity;
  message: string;
  relatedRoutes?: string[];
};

type RuntimeTruthLayers = {
  claimed: ClaimedTruthLayer;
  configured: {
    status: "configured" | "partial" | "local-only";
    summary: string;
    fastStartMode: boolean;
    docsConfigured: boolean;
    cookbookConfigured: boolean;
    stateFileConfigured: boolean;
    evidence: TruthEvidenceItem[];
    signals: TruthSignal[];
  };
  observed: {
    status: "stable" | "warning" | "degraded";
    summary: string;
    queue: {
      queued: number;
      processing: number;
    };
    approvals: {
      pendingCount: number;
    };
    repairs: {
      activeCount: number;
      verifiedCount: number;
      failedCount: number;
      lastDetectedAt: string | null;
    };
    retryRecoveries: {
      count: number;
      nextRetryAt: string | null;
    };
    recentTasks: {
      count: number;
      lastHandledAt: string | null;
    };
    serviceMode: {
      expectedCount: number;
      entrypointCount: number;
      installedCount: number;
      runningCount: number;
      missingEntrypointCount: number;
      gapCount: number;
    };
    persistenceStatus: string;
    knowledgeIndexedEntries: number;
    evidence: TruthEvidenceItem[];
    signals: TruthSignal[];
  };
};

type PublicMilestoneRiskStatus =
  | "on-track"
  | "at-risk"
  | "blocked"
  | "completed";

type PublicMilestoneSource = "orchestrator" | "agent" | "operator";

type PublicMilestoneEvent = {
  milestoneId: string;
  timestampUtc: string;
  scope: string;
  claim: string;
  evidence: Array<{
    type: "doc" | "commit" | "issue" | "pr" | "runbook" | "metric" | "log";
    path: string;
    summary: string;
    ref?: string;
  }>;
  riskStatus: PublicMilestoneRiskStatus;
  nextAction: string;
  source?: PublicMilestoneSource;
};

type TopologyNodeKind = "control-plane" | "task" | "agent" | "skill" | "surface";
type TopologyNodeStatus = "declared" | "live" | "warning" | "degraded";
type TopologyEdgeRelationship = RelationshipObservationType;
type TopologyEdgeStatus = "declared" | "live" | "warning" | "degraded";

type AgentTopologyNode = {
  id: string;
  kind: TopologyNodeKind;
  label: string;
  status: TopologyNodeStatus;
  detail: string;
  route?: string | null;
};

type AgentTopologyEdge = {
  id: string;
  from: string;
  to: string;
  relationship: TopologyEdgeRelationship;
  status: TopologyEdgeStatus;
  detail: string;
  evidence: string[];
  observedCount?: number;
  lastObservedAt?: string | null;
  sources?: string[];
};

type AgentTopology = {
  generatedAt: string;
  status: "stable" | "warning" | "degraded";
  counts: {
    controlPlaneNodes: number;
    taskNodes: number;
    agentNodes: number;
    skillNodes: number;
    surfaceNodes: number;
    totalNodes: number;
    dispatchEdges: number;
    routeEdges: number;
    skillEdges: number;
    proofEdges: number;
    relationshipEdges: number;
    observedEdges: number;
    totalEdges: number;
  };
  hotspots: string[];
  nodes: AgentTopologyNode[];
  edges: AgentTopologyEdge[];
};

type RelationshipHistoryBucket = {
  bucketStart: string;
  total: number;
  byRelationship: Partial<Record<RelationshipObservationType, number>>;
  byStatus: Partial<Record<RelationshipObservationStatus, number>>;
};

type RelationshipHistoryWindowSummary = {
  windowHours: number;
  totalObservations: number;
  lastObservedAt: string | null;
  firstObservedAt: string | null;
  byRelationship: Partial<Record<RelationshipObservationType, number>>;
  byStatus: Partial<Record<RelationshipObservationStatus, number>>;
};

type RelationshipHistoryGraph = {
  totalNodes: number;
  totalEdges: number;
  nodes: Array<{
    id: string;
    label: string;
    kind: "agent" | "task" | "skill" | "surface" | "run" | "tool" | "unknown";
    count: number;
    lastObservedAt: string | null;
  }>;
  edges: Array<{
    id: string;
    from: string;
    to: string;
    relationship: RelationshipObservationType;
    count: number;
    lastObservedAt: string | null;
    classification: string | null;
  }>;
};

type RelationshipHistory = {
  generatedAt: string;
  windowHours: number;
  totalObservations: number;
  lastObservedAt: string | null;
  byRelationship: Partial<Record<RelationshipObservationType, number>>;
  byStatus: Partial<Record<RelationshipObservationStatus, number>>;
  timeline: RelationshipHistoryBucket[];
  recent: RelationshipObservationRecord[];
  windows: {
    short: RelationshipHistoryWindowSummary;
    long: RelationshipHistoryWindowSummary;
  };
  graph: RelationshipHistoryGraph;
};

type RuntimeIncident = {
  id: string;
  fingerprint: string;
  title: string;
  classification: IncidentLedgerClassification;
  severity: IncidentLedgerSeverity;
  status: IncidentLedgerStatus;
  truthLayer: IncidentLedgerTruthLayer;
  summary: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  detectedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  acknowledgementNote: string | null;
  owner: string | null;
  affectedSurfaces: string[];
  linkedServiceIds: string[];
  linkedTaskIds: string[];
  linkedRunIds: string[];
  linkedRepairIds: string[];
  linkedProofDeliveries: string[];
  evidence: string[];
  recommendedSteps: string[];
  policy: IncidentRemediationPolicy;
  escalation: IncidentEscalationState;
  remediation: {
    owner: IncidentRemediationOwner;
    status: IncidentRemediationStatus;
    summary: string;
    nextAction: string;
    blockers: string[];
  };
  remediationPlan: IncidentRemediationPlanStep[];
  verification: IncidentVerificationState;
  history: IncidentHistoryEvent[];
  policyExecutions: IncidentPolicyExecutionRecord[];
  acknowledgements: IncidentAcknowledgementRecord[];
  ownershipHistory: IncidentOwnershipRecord[];
  remediationTasks: IncidentRemediationTaskRecord[];
};

type RuntimeIncidentModel = {
  generatedAt: string;
  overallStatus: "stable" | "warning" | "critical";
  openCount: number;
  activeCount: number;
  watchingCount: number;
  bySeverity: {
    critical: number;
    warning: number;
    info: number;
  };
  incidents: RuntimeIncident[];
};

function buildRuntimeIncidentSummaryModel(
  candidates: IncidentCandidate[],
): RuntimeIncidentModel {
  const generatedAt = new Date().toISOString();
  const openCandidates = [...candidates].sort((left, right) => {
    const severityRank: Record<IncidentLedgerSeverity, number> = {
      critical: 3,
      warning: 2,
      info: 1,
    };
    const severityDiff = severityRank[right.severity] - severityRank[left.severity];
    if (severityDiff !== 0) return severityDiff;
    return Date.parse(right.detectedAt ?? generatedAt) - Date.parse(left.detectedAt ?? generatedAt);
  });

  const bySeverity = {
    critical: openCandidates.filter((candidate) => candidate.severity === "critical").length,
    warning: openCandidates.filter((candidate) => candidate.severity === "warning").length,
    info: openCandidates.filter((candidate) => candidate.severity === "info").length,
  };

  return {
    generatedAt,
    overallStatus:
      bySeverity.critical > 0
        ? "critical"
        : bySeverity.warning > 0
          ? "warning"
          : "stable",
    openCount: openCandidates.length,
    activeCount: openCandidates.filter((candidate) => candidate.status === "active").length,
    watchingCount: openCandidates.filter((candidate) => candidate.status === "watching").length,
    bySeverity,
    incidents: [],
  };
}

type RunWorkflowStage =
  | "queued"
  | "awaiting-approval"
  | "executing"
  | "retry-scheduled"
  | "completed"
  | "failed";

type RunWorkflowEvent = {
  id: string;
  stage:
    | "queue"
    | "approval"
    | "execution"
    | "retry"
    | "repair"
    | "history"
    | "status";
  state: string;
  source: "execution" | "approval" | "retry-recovery" | "repair" | "history";
  timestamp: string | null;
  message: string;
  evidence: string[];
};

type WorkflowGraphNodeStatus =
  | "pending"
  | "active"
  | "completed"
  | "blocked"
  | "warning";

type WorkflowGraphNode = {
  id: string;
  kind: "stage" | "agent" | "proof" | "event" | "tool" | "dependency" | "verification";
  stage: WorkflowEventStage;
  label: string;
  status: WorkflowGraphNodeStatus;
  timestamp: string | null;
  detail: string;
  evidence: string[];
};

type WorkflowGraphEdge = {
  id: string;
  from: string;
  to: string;
  status: "declared" | "active" | "completed" | "blocked";
  detail: string;
  relationship?: string;
};

type WorkflowGraph = {
  graphStatus: "stable" | "warning" | "blocked" | "completed";
  currentStage: WorkflowEventStage | null;
  blockedStage: WorkflowEventStage | null;
  stopReason: string | null;
  stopClassification:
    | "completed"
    | "awaiting-approval"
    | "approval-rejected"
    | "retry-scheduled"
    | "repair-failed"
    | "execution-failed"
    | "proof-degraded"
    | "proof-misconfigured"
    | "in-flight"
    | "unknown";
  stageDurations: Partial<Record<WorkflowEventStage, number>>;
  timingBreakdown: Partial<
    Record<
      WorkflowEventStage,
      {
        startedAt: string | null;
        completedAt: string | null;
        durationMs: number | null;
        eventCount: number;
      }
    >
  >;
  nodeCount: number;
  edgeCount: number;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  events: WorkflowEventRecord[];
  causalLinks: Array<{
    id: string;
    from: string;
    to: string;
    relationship: string;
    detail: string;
    evidence: string[];
  }>;
  crossRunLinks: Array<{
    id: string;
    fromRunId: string;
    toRunId: string;
    relationship: "depends-on-run" | "cross-run-handoff";
    source: "workflow-event" | "relationship-observation";
    detail: string;
    timestamp: string | null;
    evidence: string[];
  }>;
  relatedRuns: Array<{
    runId: string;
    direction: "upstream" | "downstream";
    relationship: "depends-on-run" | "cross-run-handoff";
    sources: Array<"workflow-event" | "relationship-observation">;
    count: number;
    lastObservedAt: string | null;
  }>;
  dependencySummary: {
    upstreamRunCount: number;
    downstreamRunCount: number;
    dependencyLinkCount: number;
    handoffLinkCount: number;
  };
  proofLinks: Array<{
    id: string;
    type: "milestone" | "demandSummary";
    status: string;
    summary: string;
    target: string | null;
    lastAttemptAt: string | null;
  }>;
};

type AgentCapabilitySpine =
  | "truth"
  | "execution"
  | "trust"
  | "communication"
  | "ingestion"
  | "code";

type AgentCapabilityReadiness =
  | "declared"
  | "foundation"
  | "operational"
  | "advanced";

type AgentCapabilityEvidenceProfile = {
  area: string;
  status: "missing" | "partial" | "strong";
  summary: string;
  evidence: string[];
  missing: string[];
};

type AgentCapabilityRuntimeSignal = {
  key: string;
  summary: string;
  evidence: string[];
  observedAt: string | null;
  runId: string | null;
  taskId: string | null;
  value: Record<string, unknown> | null;
};

type AgentCapabilityRuntimeEvidence = {
  latestSuccessfulRunId: string | null;
  latestSuccessfulTaskId: string | null;
  latestHandledAt: string | null;
  highlightKeys: string[];
  signals: AgentCapabilityRuntimeSignal[];
};

type ApprovalImpactMetadata = {
  riskLevel: "low" | "medium" | "high";
  approvalReason:
    | "policy-task-type"
    | "payload-requires-approval"
    | "policy-and-payload";
  dependencyClass: "control-plane" | "worker" | "external";
  purpose: string;
  operationalStatus:
    | "confirmed-working"
    | "partially-operational"
    | "externally-dependent"
    | "unconfirmed";
  affectedSurfaces: string[];
  dependencyRequirements: string[];
  caveats: string[];
  replayBehavior: "approval-requeues-same-payload";
  internalOnly: boolean;
  publicTriggerable: boolean;
};

type OperatorTaskProfile = {
  type: string;
  label: string;
  purpose: string;
  internalOnly: boolean;
  publicTriggerable: boolean;
  approvalGated: boolean;
  operationalStatus:
    | "confirmed-working"
    | "partially-operational"
    | "externally-dependent"
    | "unconfirmed";
  dependencyClass: "control-plane" | "worker" | "external";
  baselineConfidence: "high" | "medium" | "low";
  dependencyRequirements: string[];
  exposeInV1: boolean;
  caveats: string[];
};

const INTERNAL_TASK_TYPES = new Set(["startup", "doc-change", "heartbeat"]);
const INTERNAL_VISIBILITY_PAYLOAD_KEY = "__visibility";
const INTERNAL_MAINTENANCE_CHECK_PAYLOAD_KEY = "__maintenanceCheck";

function isInternalTaskType(type: string) {
  return INTERNAL_TASK_TYPES.has(type);
}

function resolveTaskVisibility(
  payload: Record<string, unknown> | undefined,
  taskType: string,
): TaskExecutionVisibility {
  if (payload?.[INTERNAL_VISIBILITY_PAYLOAD_KEY] === "internal") {
    return "internal";
  }
  return isInternalTaskType(taskType) ? "internal" : "operator";
}

function resolveMaintenanceCheckId(
  payload: Record<string, unknown> | undefined,
): MaintenanceCheckId | null {
  const value = payload?.[INTERNAL_MAINTENANCE_CHECK_PAYLOAD_KEY];
  if (
    value === "system-monitor" ||
    value === "security-posture" ||
    value === "qa-readiness"
  ) {
    return value;
  }
  return null;
}

function isInternalTaskHistoryEntry(
  entry: Pick<OrchestratorState["taskHistory"][number], "type" | "visibility">,
) {
  return entry.visibility === "internal" || isInternalTaskType(entry.type);
}

function isInternalTaskExecution(
  execution: Pick<OrchestratorState["taskExecutions"][number], "type" | "visibility">,
) {
  return execution.visibility === "internal" || isInternalTaskType(execution.type);
}

function filterVisibleTaskHistory(
  history: OrchestratorState["taskHistory"],
  includeInternal: boolean = false,
) {
  return includeInternal ? history : history.filter((entry) => !isInternalTaskHistoryEntry(entry));
}

function filterVisibleTaskExecutions(
  executions: OrchestratorState["taskExecutions"],
  includeInternal: boolean = false,
) {
  return includeInternal
    ? executions
    : executions.filter((execution) => !isInternalTaskExecution(execution));
}

const OPERATOR_TASK_PROFILES: OperatorTaskProfile[] = [
  {
    type: "heartbeat",
    label: "Heartbeat",
    purpose: "Internal 5-minute maintenance scheduler for control-plane health and conditional downstream checks.",
    internalOnly: true,
    publicTriggerable: false,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "control-plane",
    baselineConfidence: "high",
    dependencyRequirements: ["task queue"],
    exposeInV1: false,
    caveats: [
      "Internal-only maintenance task. Not operator-runnable through the public task trigger surface.",
    ],
  },
  {
    type: "build-refactor",
    label: "Build Refactor",
    purpose: "Run bounded code surgery with scope-contract, rollback, and verification guidance through the spawned worker path.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: true,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "medium",
    dependencyRequirements: ["spawned worker", "tool permissions", "approval gate"],
    exposeInV1: true,
    caveats: [
      "Approval required before execution.",
      "Read the returned specialist status and next actions before treating the patch as cutover-ready.",
      "Queue acceptance does not imply downstream completion certainty.",
    ],
  },
  {
    type: "market-research",
    label: "Market Research",
    purpose: "Run allowlisted market research with source planning, signal classification, and degraded-actionable delta capture.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "external",
    baselineConfidence: "medium",
    dependencyRequirements: ["spawned worker", "allowlisted source fetch", "network reachability"],
    exposeInV1: true,
    caveats: [
      "Provide explicit urls or source hints when you need deterministic source selection.",
      "Use the returned signal review guidance when fetches are degraded instead of treating the run as a dead end.",
      "Live fetch success still depends on allowed-domain network reachability.",
    ],
  },
  {
    type: "doc-sync",
    label: "Doc Sync",
    purpose: "Drain pending doc-change buffer into synchronized state.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "control-plane",
    baselineConfidence: "medium",
    dependencyRequirements: ["doc change queue"],
    exposeInV1: true,
    caveats: ["Most useful when pending doc changes exist."],
  },
  {
    type: "nightly-batch",
    label: "Nightly Batch",
    purpose: "Run nightly coordination batch across docs and demand queue.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "partially-operational",
    dependencyClass: "worker",
    baselineConfidence: "low",
    dependencyRequirements: ["scheduler", "rss sweep", "worker queue"],
    exposeInV1: true,
    caveats: ["Also executed by schedule; avoid duplicate manual triggering while scheduled work is active."],
  },
  {
    type: "drift-repair",
    label: "Drift Repair",
    purpose: "Regenerate a knowledge pack with contradiction review, repair drafts, and downstream handoff guidance.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "medium",
    dependencyRequirements: ["doc-specialist worker", "knowledge pack write"],
    exposeInV1: true,
    caveats: [
      "Best used when pending drift exists or explicit paths are supplied.",
      "Knowledge-pack generation still depends on doc-specialist service health.",
      "Read the returned repair loop and next-action guidance before treating the refreshed pack as closure proof.",
    ],
  },
  {
    type: "deployment-ops",
    label: "Deployment Ops",
    purpose: "Produce a bounded deployment posture across rollout surfaces, rollback readiness, pipeline evidence, and docs parity.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "medium",
    dependencyRequirements: [
      "deployment-ops worker",
      "deployment surface files",
      "release and verification evidence",
    ],
    exposeInV1: true,
    caveats: [
      "This lane summarizes deployment posture; it does not deploy, restart, or mutate the runtime directly.",
      "Treat watch or blocked output as rollout guidance, not as a background advisory.",
    ],
  },
  {
    type: "reddit-response",
    label: "Reddit Response",
    purpose: "Draft community-safe responses with doctrine checks, provider posture, and downstream follow-up guidance.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "medium",
    dependencyRequirements: ["reddit-helper pipeline", "knowledge pack", "optional model provider"],
    exposeInV1: true,
    caveats: [
      "Uses the next selected queue item unless a manual queue payload is supplied.",
      "Grounding depends on the managed openclaw-docs mirror and the latest generated knowledge pack, not the raw docs tree directly.",
      "Deterministic local drafting is live; provider polish remains optional and dependency-sensitive.",
      "If the docs mirror changed after the latest pack was generated, refresh drift-repair before treating the draft as current or broadly reusable.",
      "Drafts that require review or cross the public-safe boundary should be treated as bounded review work, not ready-to-post output.",
    ],
  },
  {
    type: "security-audit",
    label: "Security Audit",
    purpose: "Run a trust-boundary audit that returns prioritized findings, containment guidance, and operator next actions.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "medium",
    dependencyRequirements: ["security-agent worker", "tool permissions"],
    exposeInV1: true,
    caveats: [
      "Findings quality depends on current repo and runtime evidence.",
      "Treat high-risk or blocked closure output as escalation guidance, not background noise.",
    ],
  },
  {
    type: "summarize-content",
    label: "Summarize Content",
    purpose: "Condense provided content into a structured summary with evidence-retention and handoff guidance.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "medium",
    dependencyRequirements: ["summarization worker", "document parser"],
    exposeInV1: true,
    caveats: [
      "Inline content works best until broader source ingestion is hardened.",
      "Use the retention and next-action guidance to decide whether the summary is ready for delegation or still needs review.",
    ],
  },
  {
    type: "system-monitor",
    label: "System Monitor",
    purpose: "Run a targeted monitor pass that returns runtime diagnosis, early warnings, and prioritized operator actions.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "medium",
    dependencyRequirements: ["system-monitor worker", "runtime evidence"],
    exposeInV1: true,
    caveats: [
      "Useful for targeted checks and action queues; it does not replace continuous monitoring by itself.",
    ],
  },
  {
    type: "control-plane-brief",
    label: "Control Plane Brief",
    purpose: "Produce a bounded control-plane summary with dominant pressure, primary operator move, and proof posture.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "medium",
    dependencyRequirements: [
      "operations-analyst worker",
      "dashboard truth",
      "incident ledger",
      "public proof posture",
    ],
    exposeInV1: true,
    caveats: [
      "This lane synthesizes current control-plane truth; it does not replace the live overview.",
      "Use it when you need a portable operator brief for downstream clients or channel surfaces.",
    ],
  },
  {
    type: "incident-triage",
    label: "Incident Triage",
    purpose: "Cluster incident pressure into a ranked operator queue with ownership, acknowledgement, remediation, and verification priorities.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "medium",
    dependencyRequirements: [
      "system-monitor worker",
      "incident ledger",
      "workflow evidence",
    ],
    exposeInV1: true,
    caveats: [
      "This lane clusters current incident pressure; it does not acknowledge or remediate incidents by itself.",
      "Use the ranked queue as an operator ordering surface, not as automatic closure proof.",
    ],
  },
  {
    type: "release-readiness",
    label: "Release Readiness",
    purpose: "Produce a bounded go, hold, or block release posture from verification, security, monitor, and build evidence.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "medium",
    dependencyRequirements: [
      "release-manager worker",
      "verification evidence",
      "security evidence",
      "system health evidence",
    ],
    exposeInV1: true,
    caveats: [
      "This lane summarizes current release posture; it does not cut a release or override blocked evidence.",
      "Treat hold or block output as operator guidance, not a background advisory.",
    ],
  },
  {
    type: "send-digest",
    label: "Send Digest",
    purpose: "Send digest notifications for queued lead work.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "externally-dependent",
    dependencyClass: "external",
    baselineConfidence: "medium",
    dependencyRequirements: ["notification channel config", "network"],
    exposeInV1: true,
    caveats: ["Notification path depends on external channel configuration."],
  },
  {
    type: "rss-sweep",
    label: "RSS Sweep",
    purpose: "Ingest and score RSS feed entries for demand queue drafting.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "externally-dependent",
    dependencyClass: "external",
    baselineConfidence: "low",
    dependencyRequirements: ["rss config", "network"],
    exposeInV1: true,
    caveats: ["Requires valid feed config and external network availability."],
  },
  {
    type: "content-generate",
    label: "Content Generate",
    purpose: "Generate grounded content drafts with publication policy, audience routing, and evidence appendix guidance.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "medium",
    dependencyRequirements: ["content-agent worker", "document parser"],
    exposeInV1: true,
    caveats: [
      "Source fields should be supplied explicitly for the strongest grounded output.",
      "Speculative claims are refused unless explicitly allowed and labeled.",
    ],
  },
  {
    type: "integration-workflow",
    label: "Integration Workflow",
    purpose: "Run multi-step workflow orchestration with explicit delegation, replay guidance, and downstream handoff context.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "medium",
    dependencyRequirements: ["integration-agent worker", "step payload"],
    exposeInV1: true,
    caveats: [
      "Blank submissions fall back to a bounded default workflow plan.",
      "Shorthand steps like `market-research: operator console trends` are normalized automatically.",
      "Blocked or rerouted workflows should be read with their replay guidance, not as fire-and-forget automation.",
    ],
  },
  {
    type: "normalize-data",
    label: "Normalize Data",
    purpose: "Normalize records into a canonical schema with uncertainty, dedupe, and downstream handoff guidance.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "medium",
    dependencyRequirements: ["normalization worker", "schema payload"],
    exposeInV1: true,
    caveats: [
      "Provide structured input and schema for deterministic normalization.",
      "Review duplicate and uncertainty guidance before treating the dataset as comparison-ready.",
    ],
  },
  {
    type: "data-extraction",
    label: "Data Extraction",
    purpose: "Extract structured artifacts with provenance, confidence, and normalization-handoff guidance.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "medium",
    dependencyRequirements: ["data-extraction worker", "document parser"],
    exposeInV1: true,
    caveats: [
      "Parser-backed extraction quality still depends on source format coverage.",
      "Use the returned handoff guidance to decide whether normalization or documentation work should run next.",
    ],
  },
  {
    type: "qa-verification",
    label: "QA Verification",
    purpose: "Run bounded verification with closure guidance, refusal rules, and explicit next-step recommendations.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "medium",
    dependencyRequirements: ["qa-verification worker", "test runner"],
    exposeInV1: true,
    caveats: [
      "Use dry-run for preflight; execute mode is only authoritative when it records real bounded checks.",
      "A passed run can still recommend keep-open or escalate when runtime evidence is weak.",
    ],
  },
  {
    type: "skill-audit",
    label: "Skill Audit",
    purpose: "Audit governed skills with trust posture, policy handoff, restart safety, and operator next actions.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: false,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "medium",
    dependencyRequirements: ["skill-audit worker", "document parser"],
    exposeInV1: true,
    caveats: [
      "Target specific skill IDs for the clearest audit results.",
      "Treat review-required or escalation status as governance work still in flight, not a quiet pass.",
    ],
  },
  {
    type: "agent-deploy",
    label: "Agent Deploy",
    purpose: "Deploy agent template instances to runtime deployment directory.",
    internalOnly: false,
    publicTriggerable: true,
    approvalGated: true,
    operationalStatus: "confirmed-working",
    dependencyClass: "worker",
    baselineConfidence: "low",
    dependencyRequirements: ["approval gate", "filesystem write"],
    exposeInV1: true,
    caveats: ["Approval required before execution.", "Deployment copies the selected template into the runtime deployment directory."],
  },
  {
    type: "startup",
    label: "Startup",
    purpose: "Internal boot task used by orchestrator runtime initialization.",
    internalOnly: true,
    publicTriggerable: false,
    approvalGated: false,
    operationalStatus: "unconfirmed",
    dependencyClass: "control-plane",
    baselineConfidence: "low",
    dependencyRequirements: ["orchestrator startup path"],
    exposeInV1: false,
    caveats: ["Internal-only task. Must not be exposed as user-runnable."],
  },
  {
    type: "doc-change",
    label: "Doc Change",
    purpose: "Internal watcher signal for document delta tracking.",
    internalOnly: true,
    publicTriggerable: false,
    approvalGated: false,
    operationalStatus: "unconfirmed",
    dependencyClass: "control-plane",
    baselineConfidence: "low",
    dependencyRequirements: ["doc watcher"],
    exposeInV1: false,
    caveats: ["Internal-only task. Must not be exposed as user-runnable."],
  },
];

const AGENT_CAPABILITY_RUNTIME_SIGNAL_KEYS: Partial<Record<string, string[]>> = {
  "doc-specialist": [
    "evidenceRails",
    "topologyPacks",
    "taskSpecificKnowledge",
    "contradictionLedger",
    "repairDrafts",
    "freshnessSignals",
    "entityFreshnessLedger",
    "contradictionGraph",
  ],
  "integration-agent": [
    "partialCompletion",
    "workflowProfile",
    "delegationPlan",
    "replayContract",
    "handoffPackages",
    "dependencyPlan",
    "workflowMemory",
  ],
  "system-monitor-agent": [
    "operationalDiagnosis",
    "queueBudgetFusion",
    "dependencyHealth",
    "earlyWarnings",
    "operatorClosureEvidence",
    "trendSummary",
  ],
  "security-agent": [
    "regressionReview",
    "trustBoundaryHistory",
    "permissionDriftTimeline",
    "routeBoundaryWatch",
    "remediationDepth",
    "exploitabilityRanking",
    "remediationClosure",
  ],
  "qa-verification-agent": [
    "acceptanceCoverage",
    "verificationAuthority",
    "verificationTrace",
    "verificationSurface",
    "refusalProfile",
    "closureContract",
    "reproducibilityProfile",
  ],
  "build-refactor-agent": [
    "scopeContract",
    "surgeryProfile",
    "verificationLoop",
    "impactEnvelope",
    "refusalProfile",
  ],
  "skill-audit-agent": [
    "trustPosture",
    "policyHandoff",
    "telemetryHandoff",
    "intakeCoverage",
    "restartSafetySummary",
  ],
  "reddit-helper": ["providerPosture"],
  "content-agent": ["publicationPolicy"],
  "summarization-agent": ["operationalCompression"],
  "data-extraction-agent": ["artifactCoverage"],
  "normalization-agent": ["comparisonReadiness"],
  "market-research-agent": ["deltaCapture"],
  "deployment-ops-agent": ["deploymentOps"],
  "operations-analyst-agent": ["controlPlaneBrief"],
  "release-manager-agent": ["releaseReadiness"],
};

const TASK_AGENT_SKILL_REQUIREMENTS: Record<
  string,
  { agentId: string; skillId: string }
> = {
  "security-audit": { agentId: "security-agent", skillId: "documentParser" },
  "summarize-content": {
    agentId: "summarization-agent",
    skillId: "documentParser",
  },
  "system-monitor": {
    agentId: "system-monitor-agent",
    skillId: "documentParser",
  },
  "build-refactor": {
    agentId: "build-refactor-agent",
    skillId: "workspacePatch",
  },
  "deployment-ops": {
    agentId: "deployment-ops-agent",
    skillId: "documentParser",
  },
  "content-generate": { agentId: "content-agent", skillId: "documentParser" },
  "integration-workflow": {
    agentId: "integration-agent",
    skillId: "documentParser",
  },
  "normalize-data": {
    agentId: "normalization-agent",
    skillId: "normalizer",
  },
  "market-research": {
    agentId: "market-research-agent",
    skillId: "sourceFetch",
  },
  "data-extraction": {
    agentId: "data-extraction-agent",
    skillId: "documentParser",
  },
  "qa-verification": {
    agentId: "qa-verification-agent",
    skillId: "testRunner",
  },
  "skill-audit": { agentId: "skill-audit-agent", skillId: "documentParser" },
  "control-plane-brief": {
    agentId: "operations-analyst-agent",
    skillId: "documentParser",
  },
  "incident-triage": {
    agentId: "system-monitor-agent",
    skillId: "documentParser",
  },
  "release-readiness": {
    agentId: "release-manager-agent",
    skillId: "documentParser",
  },
};

const TASK_IMPACT_SURFACES: Record<string, string[]> = {
  heartbeat: ["control-plane", "task-queue"],
  "build-refactor": ["workspace", "worker-runtime", "tool-permissions"],
  "market-research": ["external-network", "research-artifacts"],
  "doc-sync": ["document-index", "knowledge-packs", "orchestrator-state"],
  "nightly-batch": ["document-index", "demand-queue", "scheduled-workflows"],
  "drift-repair": ["document-index", "knowledge-packs", "repair-queue"],
  "reddit-response": ["demand-queue", "community-drafts", "model-provider"],
  "send-digest": ["digest-artifacts", "notification-channel", "external-network"],
  "rss-sweep": ["rss-feeds", "demand-queue", "draft-scoring"],
  "agent-deploy": ["agent-runtime", "deployment-filesystem", "worker-templates"],
  "deployment-ops": [
    "deployment-filesystem",
    "release-posture",
    "service-runtime",
    "docs-parity",
  ],
  "control-plane-brief": ["dashboard-overview", "incident-ledger", "public-proof"],
  "incident-triage": ["incident-ledger", "workflow-evidence", "repair-queue"],
  "release-readiness": [
    "verification-evidence",
    "security-evidence",
    "system-health",
    "release-posture",
  ],
  startup: ["control-plane"],
  "doc-change": ["document-watchers", "pending-doc-buffer"],
};

const CONFIRMED_WORKER_AGENTS = new Set([
  "build-refactor-agent",
  "deployment-ops-agent",
  "market-research-agent",
  "reddit-helper",
]);
const PARTIAL_WORKER_AGENTS = new Set(["doc-specialist"]);

const AGENT_CAPABILITY_TARGETS: Record<
  string,
  {
    role: string;
    spine: AgentCapabilitySpine;
    targetCapabilities: string[];
  }
> = {
  "doc-specialist": {
    role: "Repository intelligence engine",
    spine: "truth",
    targetCapabilities: [
      "knowledge indexing",
      "drift detection",
      "pack generation",
      "runtime evidence grounding",
      "doc repair drafting",
    ],
  },
  "integration-agent": {
    role: "Workflow conductor",
    spine: "execution",
    targetCapabilities: [
      "workflow planning",
      "delegation routing",
      "fallback routing",
      "blocked-state explanation",
      "workflow evidence emission",
    ],
  },
  "system-monitor-agent": {
    role: "Operational fusion monitor",
    spine: "trust",
    targetCapabilities: [
      "service telemetry fusion",
      "queue telemetry fusion",
      "incident detection",
      "proof freshness monitoring",
      "budget posture awareness",
    ],
  },
  "security-agent": {
    role: "Trust-boundary auditor",
    spine: "trust",
    targetCapabilities: [
      "policy auditing",
      "secret posture review",
      "permission drift detection",
      "route-boundary review",
      "bounded remediation guidance",
    ],
  },
  "qa-verification-agent": {
    role: "Final verifier",
    spine: "trust",
    targetCapabilities: [
      "output verification",
      "reproducibility checks",
      "policy alignment review",
      "regression checks",
      "acceptance gating",
    ],
  },
  "reddit-helper": {
    role: "Community strategist",
    spine: "communication",
    targetCapabilities: [
      "knowledge-grounded drafting",
      "queue triage",
      "signal routing",
      "public communication feedback",
      "reply verification",
    ],
  },
  "content-agent": {
    role: "Evidence-based publisher",
    spine: "communication",
    targetCapabilities: [
      "documentation drafting",
      "release-note drafting",
      "proof narrative drafting",
      "repo-grounded publishing",
      "operator summary writing",
    ],
  },
  "summarization-agent": {
    role: "Compression layer",
    spine: "communication",
    targetCapabilities: [
      "log summarization",
      "run summarization",
      "audit summarization",
      "pack compression",
      "context reduction",
    ],
  },
  "data-extraction-agent": {
    role: "External artifact ingestor",
    spine: "ingestion",
    targetCapabilities: [
      "document parsing",
      "artifact extraction",
      "source normalization handoff",
      "structured evidence capture",
      "external artifact triage",
    ],
  },
  "normalization-agent": {
    role: "Schema and ETL normalizer",
    spine: "ingestion",
    targetCapabilities: [
      "schema normalization",
      "ETL cleanup",
      "validation mapping",
      "typed output shaping",
      "ingestion standardization",
    ],
  },
  "build-refactor-agent": {
    role: "Governed code surgeon",
    spine: "code",
    targetCapabilities: [
      "bounded patching",
      "build validation",
      "test execution",
      "rollback-aware refactoring",
      "repair-safe edits",
    ],
  },
  "market-research-agent": {
    role: "External signal intake",
    spine: "ingestion",
    targetCapabilities: [
      "web research",
      "competitive signal tracking",
      "external change detection",
      "signal-to-pack handoff",
      "source evidence capture",
    ],
  },
  "deployment-ops-agent": {
    role: "Deployment posture synthesizer",
    spine: "trust",
    targetCapabilities: [
      "deploy-readiness synthesis",
      "rollback posture review",
      "deployment surface parity",
      "pipeline evidence review",
      "bounded rollout follow-up guidance",
    ],
  },
  "operations-analyst-agent": {
    role: "Control-plane synthesizer",
    spine: "truth",
    targetCapabilities: [
      "control-plane mode synthesis",
      "pressure-story summarization",
      "operator move ranking",
      "proof posture briefings",
      "portable runtime brief generation",
    ],
  },
  "release-manager-agent": {
    role: "Release posture synthesizer",
    spine: "trust",
    targetCapabilities: [
      "release gating synthesis",
      "verification posture review",
      "security posture review",
      "proof freshness release checks",
      "bounded release follow-up guidance",
    ],
  },
  "skill-audit-agent": {
    role: "Governed skill auditor",
    spine: "trust",
    targetCapabilities: [
      "skill review",
      "permission review",
      "governance evidence capture",
      "supply-chain visibility",
      "audit summarization",
    ],
  },
};

const AGENT_RELATIONSHIP_DECLARATIONS: Array<{
  from: string;
  to: string;
  relationship: TopologyEdgeRelationship;
  detail: string;
  evidence: string[];
}> = [
  {
    from: "doc-specialist",
    to: "reddit-helper",
    relationship: "feeds-agent",
    detail:
      "doc-specialist refreshes repository knowledge that reddit-helper consumes for grounded drafting.",
    evidence: ["knowledge-pack generation", "reddit-helper knowledge-grounded drafting"],
  },
  {
    from: "doc-specialist",
    to: "content-agent",
    relationship: "feeds-agent",
    detail:
      "doc-specialist supplies repository-grounded knowledge that content-agent can publish outward.",
    evidence: ["knowledge-pack generation", "evidence-based publisher role"],
  },
  {
    from: "integration-agent",
    to: "build-refactor-agent",
    relationship: "coordinates-agent",
    detail:
      "integration-agent is the declared workflow conductor and build-refactor-agent is a delegated code execution surface.",
    evidence: ["workflow conductor role", "governed code surgeon role"],
  },
  {
    from: "integration-agent",
    to: "qa-verification-agent",
    relationship: "coordinates-agent",
    detail:
      "integration-agent should hand completed workflows to qa-verification-agent for acceptance checks.",
    evidence: ["workflow conductor role", "final verifier role"],
  },
  {
    from: "system-monitor-agent",
    to: "security-agent",
    relationship: "monitors-agent",
    detail:
      "system-monitor-agent provides trust-spine operational visibility that security-agent audits for boundary regressions.",
    evidence: ["operational fusion monitor role", "trust-boundary auditor role"],
  },
  {
    from: "security-agent",
    to: "build-refactor-agent",
    relationship: "audits-agent",
    detail:
      "security-agent reviews the safety posture of build-refactor-agent code and permission changes.",
    evidence: ["trust-boundary auditor role", "governed code surgeon role"],
  },
  {
    from: "qa-verification-agent",
    to: "build-refactor-agent",
    relationship: "verifies-agent",
    detail:
      "qa-verification-agent validates build-refactor-agent outputs before they should be trusted as complete.",
    evidence: ["final verifier role", "bounded patching role"],
  },
  {
    from: "qa-verification-agent",
    to: "content-agent",
    relationship: "verifies-agent",
    detail:
      "qa-verification-agent is the acceptance gate for outward-facing generated content and docs.",
    evidence: ["final verifier role", "evidence-based publisher role"],
  },
];
const DEFAULT_CORS_METHODS = ["GET", "POST"];
const DEFAULT_CORS_HEADERS = ["Authorization", "Content-Type"];
const DEFAULT_CORS_EXPOSED_HEADERS = [
  "X-Request-Id",
  "X-API-Key-Expires",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
  "Retry-After",
];

type RuntimeCorsPolicy = {
  allowedOrigins: Set<string>;
  allowedMethods: string[];
  allowedHeaders: string[];
  allowedHeadersLower: Set<string>;
  exposedHeaders: string[];
  allowCredentials: boolean;
  maxAgeSeconds: number;
};

function parseBoundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const floored = Math.floor(parsed);
  return Math.max(min, Math.min(max, floored));
}

function getOperatorTaskProfile(taskType: string): OperatorTaskProfile | null {
  return OPERATOR_TASK_PROFILES.find((profile) => profile.type === taskType) ?? null;
}

type DashboardQueuePressureSummary = {
  type: string;
  label: string;
  source: string;
  queuedCount: number;
  processingCount: number;
  totalCount: number;
  oldestCreatedAt: string | null;
  newestCreatedAt: string | null;
};

type DashboardIncidentClassificationSummary = {
  classification: IncidentLedgerClassification;
  label: string;
  count: number;
  activeCount: number;
  watchingCount: number;
  highestSeverity: IncidentLedgerSeverity;
};

const INCIDENT_CLASSIFICATION_LABELS: Record<IncidentLedgerClassification, string> = {
  "runtime-mode": "Runtime Mode",
  persistence: "Persistence",
  "proof-delivery": "Proof Delivery",
  repair: "Repair",
  "retry-recovery": "Retry Recovery",
  knowledge: "Knowledge",
  "service-runtime": "Service Runtime",
  "approval-backlog": "Approval Backlog",
};

function humanizeHyphenLabel(value: string) {
  return value
    .split("-")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function classifyDashboardQueueSource(task: Task) {
  const payload = task.payload ?? {};

  if (task.type === "doc-change") {
    return "Doc Watch";
  }
  if (payload.approvedFromTaskId) {
    return "Approval Replay";
  }
  if (payload.__remediationId) {
    return "Incident Remediation";
  }
  if (Number(payload.__attempt ?? task.attempt ?? 1) > 1) {
    return "Retry Recovery";
  }
  if (typeof payload.reason === "string") {
    if (payload.reason === "scheduled") {
      return "Scheduler";
    }
    if (payload.reason === "periodic") {
      return "Heartbeat";
    }
    return humanizeHyphenLabel(payload.reason);
  }
  if (typeof payload.__role === "string" && payload.__role === "operator") {
    return "Operator Trigger";
  }
  if (task.type === "startup") {
    return "Runtime Boot";
  }
  return "System";
}

function buildDashboardQueuePressure(args: {
  queued: Task[];
  processing: Task[];
}) {
  const grouped = new Map<string, DashboardQueuePressureSummary>();
  const severitySort = (value: DashboardQueuePressureSummary) =>
    value.totalCount * 10_000 + value.processingCount * 100;

  const ingest = (
    tasks: Task[],
    status: "queued" | "processing",
  ) => {
    for (const task of tasks) {
      const type = typeof task.type === "string" ? task.type : "unknown";
      const label =
        getOperatorTaskProfile(type)?.label ??
        humanizeHyphenLabel(type);
      const source = classifyDashboardQueueSource(task);
      const key = `${type}:${source}`;
      const createdAtIso =
        Number.isFinite(task.createdAt) && task.createdAt > 0
          ? new Date(task.createdAt).toISOString()
          : null;
      const current = grouped.get(key) ?? {
        type,
        label,
        source,
        queuedCount: 0,
        processingCount: 0,
        totalCount: 0,
        oldestCreatedAt: createdAtIso,
        newestCreatedAt: createdAtIso,
      };
      if (status === "queued") {
        current.queuedCount += 1;
      } else {
        current.processingCount += 1;
      }
      current.totalCount += 1;
      if (createdAtIso) {
        current.oldestCreatedAt =
          !current.oldestCreatedAt || createdAtIso.localeCompare(current.oldestCreatedAt) < 0
            ? createdAtIso
            : current.oldestCreatedAt;
        current.newestCreatedAt =
          !current.newestCreatedAt || createdAtIso.localeCompare(current.newestCreatedAt) > 0
            ? createdAtIso
            : current.newestCreatedAt;
      }
      grouped.set(key, current);
    }
  };

  ingest(args.queued, "queued");
  ingest(args.processing, "processing");

  return [...grouped.values()]
    .sort((left, right) => {
      const byPressure = severitySort(right) - severitySort(left);
      if (byPressure !== 0) return byPressure;
      return left.label.localeCompare(right.label);
    })
    .slice(0, 6);
}

function buildDashboardIncidentClassifications(
  records: IncidentLedgerRecord[],
  limit: number = 4,
) {
  const grouped = new Map<IncidentLedgerClassification, DashboardIncidentClassificationSummary>();
  const severityRank: Record<IncidentLedgerSeverity, number> = {
    critical: 3,
    warning: 2,
    info: 1,
  };

  for (const record of records) {
    if (record.status === "resolved") {
      continue;
    }
    const current = grouped.get(record.classification) ?? {
      classification: record.classification,
      label: INCIDENT_CLASSIFICATION_LABELS[record.classification],
      count: 0,
      activeCount: 0,
      watchingCount: 0,
      highestSeverity: record.severity,
    };
    current.count += 1;
    if (record.status === "active") current.activeCount += 1;
    if (record.status === "watching") current.watchingCount += 1;
    if (severityRank[record.severity] > severityRank[current.highestSeverity]) {
      current.highestSeverity = record.severity;
    }
    grouped.set(record.classification, current);
  }

  return [...grouped.values()]
    .sort((left, right) => {
      const byCount = right.count - left.count;
      if (byCount !== 0) return byCount;
      const bySeverity = severityRank[right.highestSeverity] - severityRank[left.highestSeverity];
      if (bySeverity !== 0) return bySeverity;
      return left.label.localeCompare(right.label);
    })
    .slice(0, limit);
}

function summarizePayloadPreview(payload: Record<string, unknown>) {
  const keys = Object.keys(payload).filter((key) => key !== "__raw");
  const internalKeys = keys.filter((key) => key.startsWith("__"));
  const visibleKeys = keys.filter((key) => !key.startsWith("__"));

  return {
    keyCount: keys.length,
    keys: visibleKeys,
    internalKeyCount: internalKeys.length,
  };
}

function deriveApprovalReason(
  approval: ApprovalRecord,
  config: Awaited<ReturnType<typeof loadConfig>>,
): ApprovalImpactMetadata["approvalReason"] {
  const explicit = approval.payload.requiresApproval === true;
  const policyRequiredTaskTypes = new Set(
    (config.approvalRequiredTaskTypes ?? ["agent-deploy", "build-refactor"]).map(
      (item) => String(item),
    ),
  );
  const policy = policyRequiredTaskTypes.has(approval.type);

  if (policy && explicit) return "policy-and-payload";
  if (explicit) return "payload-requires-approval";
  return "policy-task-type";
}

function deriveApprovalRiskLevel(profile: OperatorTaskProfile | null): ApprovalImpactMetadata["riskLevel"] {
  if (!profile) return "medium";
  if (profile.type === "agent-deploy" || profile.type === "build-refactor") return "high";
  if (profile.dependencyClass === "external") return "medium";
  if (profile.dependencyClass === "control-plane") return "low";
  return "medium";
}

function buildApprovalImpactMetadata(
  approval: ApprovalRecord,
  config: Awaited<ReturnType<typeof loadConfig>>,
): ApprovalImpactMetadata {
  const profile = getOperatorTaskProfile(approval.type);

  return {
    riskLevel: deriveApprovalRiskLevel(profile),
    approvalReason: deriveApprovalReason(approval, config),
    dependencyClass: profile?.dependencyClass ?? "worker",
    purpose: profile?.purpose ?? "Runtime allowlisted task pending approval.",
    operationalStatus: profile?.operationalStatus ?? "unconfirmed",
    affectedSurfaces:
      TASK_IMPACT_SURFACES[approval.type] ??
      [profile?.dependencyClass === "external" ? "external-network" : "worker-runtime"],
    dependencyRequirements: profile?.dependencyRequirements ?? [],
    caveats: profile?.caveats ?? [],
    replayBehavior: "approval-requeues-same-payload",
    internalOnly: profile?.internalOnly ?? isInternalTaskType(approval.type),
    publicTriggerable: profile?.publicTriggerable ?? false,
  };
}

function parseBoolean(value: unknown, fallback: boolean) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeCorsOrigin(rawOrigin: string): string {
  if (rawOrigin === "null") {
    throw new Error("CORS origin 'null' is not supported");
  }
  const parsed = new URL(rawOrigin);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(
      `CORS origin must use http/https protocol: ${rawOrigin}`,
    );
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(
      `CORS origin must not include path/query/fragment: ${rawOrigin}`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new Error(
      `CORS origin must not include credentials: ${rawOrigin}`,
    );
  }
  return `${parsed.protocol}//${parsed.host}`.toLowerCase();
}

function normalizeCorsMethod(rawMethod: string): string {
  const method = rawMethod.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(method)) {
    throw new Error(`Invalid CORS method token: ${rawMethod}`);
  }
  return method;
}

function normalizeCorsHeader(rawHeader: string): string {
  const header = rawHeader.trim();
  if (!/^[A-Za-z0-9-]+$/.test(header)) {
    throw new Error(`Invalid CORS header token: ${rawHeader}`);
  }
  return header;
}

function normalizeCorsList(
  rawValues: string[] | undefined,
  fallback: string[],
  normalizer: (value: string) => string,
) {
  const input = rawValues && rawValues.length > 0 ? rawValues : fallback;
  const normalizedValues = input.map((value) => normalizer(String(value)));
  return Array.from(new Set(normalizedValues));
}

function buildCorsPolicy(
  config: Awaited<ReturnType<typeof loadConfig>>,
): RuntimeCorsPolicy {
  const allowedOrigins = new Set(
    (config.corsAllowedOrigins ?? []).map((origin) =>
      normalizeCorsOrigin(String(origin)),
    ),
  );
  const configuredMethods = normalizeCorsList(
    config.corsAllowedMethods,
    DEFAULT_CORS_METHODS,
    normalizeCorsMethod,
  );
  const allowedMethods = Array.from(
    new Set([...configuredMethods, "OPTIONS"]),
  );
  const allowedHeaders = normalizeCorsList(
    config.corsAllowedHeaders,
    DEFAULT_CORS_HEADERS,
    normalizeCorsHeader,
  );
  const allowedHeadersLower = new Set(
    allowedHeaders.map((header) => header.toLowerCase()),
  );
  const exposedHeaders = normalizeCorsList(
    config.corsExposedHeaders,
    DEFAULT_CORS_EXPOSED_HEADERS,
    normalizeCorsHeader,
  );
  const allowCredentials = config.corsAllowCredentials === true;
  const maxAgeSeconds = Number.isFinite(config.corsMaxAgeSeconds)
    ? Math.max(
        0,
        Math.min(86400, Math.floor(config.corsMaxAgeSeconds as number)),
      )
    : 600;

  return {
    allowedOrigins,
    allowedMethods,
    allowedHeaders,
    allowedHeadersLower,
    exposedHeaders,
    allowCredentials,
    maxAgeSeconds,
  };
}

function requestOriginFromHost(req: express.Request): string | null {
  const host = req.get("host");
  if (!host) return null;
  return `${req.protocol}://${host}`.toLowerCase();
}

function buildPublicMetricsUrl(req: express.Request): string {
  const metricsPort = Number.parseInt(process.env.PROMETHEUS_PORT || "9100", 10);
  const origin = requestOriginFromHost(req);
  if (!origin) {
    return `http://localhost:${metricsPort}/metrics`;
  }

  const url = new URL(origin);
  url.protocol = "http:";
  url.port = String(metricsPort);
  url.pathname = "/metrics";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function isCorsOriginAllowed(
  req: express.Request,
  corsPolicy: RuntimeCorsPolicy,
  rawOrigin: string,
): boolean {
  let normalizedOrigin: string;
  try {
    normalizedOrigin = normalizeCorsOrigin(rawOrigin);
  } catch {
    return false;
  }

  if (corsPolicy.allowedOrigins.has(normalizedOrigin)) {
    return true;
  }

  const sameOrigin = requestOriginFromHost(req);
  return sameOrigin === normalizedOrigin;
}

function redactMemoryState(
  state: AgentMemoryState,
  includeSensitive: boolean,
): AgentMemoryState {
  if (includeSensitive) return state;
  return {
    ...state,
    lastError: state.lastError ? "[redacted]" : null,
    serviceHeartbeat: state.serviceHeartbeat
      ? {
          ...state.serviceHeartbeat,
          errorSummary: state.serviceHeartbeat.errorSummary ? "[redacted]" : null,
        }
      : undefined,
    taskPath: state.taskPath
      ? {
          ...state.taskPath,
          lastError: state.taskPath.lastError ? "[redacted]" : null,
        }
      : undefined,
    taskTimeline: (state.taskTimeline ?? []).map((entry) => ({
      ...entry,
      error: entry.error ? "[redacted]" : null,
      resultSummary: entry.resultSummary
        ? {
            success: entry.resultSummary.success,
          }
        : undefined,
    })),
  };
}

async function loadAgentMemoryState(
  agentId: string,
  resolvedServiceStatePath?: string | null,
): Promise<AgentMemoryState | null> {
  if (resolvedServiceStatePath) {
    try {
      const stateRaw = await readFile(resolvedServiceStatePath, "utf-8");
      return JSON.parse(stateRaw) as AgentMemoryState;
    } catch {
      return null;
    }
  }
  const agentConfigPath = join(
    process.cwd(),
    "..",
    "agents",
    agentId,
    "agent.config.json",
  );
  try {
    const configRaw = await readFile(agentConfigPath, "utf-8");
    const config = JSON.parse(configRaw) as { serviceStatePath?: string };
    if (!config.serviceStatePath) return null;

    const serviceStatePath = resolve(
      dirname(agentConfigPath),
      config.serviceStatePath,
    );
    const stateRaw = await readFile(serviceStatePath, "utf-8");
    return JSON.parse(stateRaw) as AgentMemoryState;
  } catch {
    return null;
  }
}

async function pathExists(pathToCheck: string): Promise<boolean> {
  const now = Date.now();
  const cached = cachedPathExists.get(pathToCheck);
  if (cached && cached.expiresAt > now) {
    return cached.exists;
  }
  try {
    await stat(pathToCheck);
    cachedPathExists.set(pathToCheck, {
      exists: true,
      expiresAt: now + PATH_EXISTS_CACHE_TTL_MS,
    });
    return true;
  } catch {
    cachedPathExists.set(pathToCheck, {
      exists: false,
      expiresAt: now + PATH_EXISTS_CACHE_TTL_MS,
    });
    return false;
  }
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveToolInvocationMode(invocation: ToolInvocation): string | null {
  if (typeof invocation.mode === "string" && invocation.mode.length > 0) {
    return invocation.mode;
  }
  const argsMode =
    invocation.args &&
    typeof invocation.args === "object" &&
    typeof invocation.args.mode === "string"
      ? invocation.args.mode
      : null;
  return argsMode && argsMode.length > 0 ? argsMode : null;
}

export function deriveWorkerEvidenceSummary(args: {
  agentId: string;
  spawnedWorkerCapable: boolean;
  orchestratorTask?: string | null;
  memory: AgentMemoryState | null;
  support: AgentOperationalOverviewSupport;
}): AgentWorkerEvidenceSummary {
  const {
    agentId,
    spawnedWorkerCapable,
    orchestratorTask,
    memory,
    support,
  } = args;

  const latestObservedExecution = orchestratorTask
    ? support.latestExecutionByType.get(orchestratorTask) ?? null
    : null;
  const latestSuccessfulExecution = orchestratorTask
    ? support.latestSuccessfulExecutionByType.get(orchestratorTask) ?? null
    : null;
  const latestAllowedPreflight =
    support.latestAllowedPreflightByAgent.get(agentId) ?? null;
  const latestAllowedExecute =
    support.latestAllowedExecuteByAgent.get(agentId) ?? null;
  const latestToolInvocation =
    support.latestToolInvocationByAgent.get(agentId) ?? null;
  const latestSuccessfulMemoryEntry = (memory?.taskTimeline ?? [])
    .filter((entry) => {
      const summarySuccess = entry.resultSummary?.success === true;
      return entry.status === "success" || summarySuccess;
    })
    .sort((left, right) => {
      const leftTs = toTimestamp(left.completedAt ?? left.startedAt ?? "");
      const rightTs = toTimestamp(right.completedAt ?? right.startedAt ?? "");
      return rightTs - leftTs;
    })[0] ?? null;
  const memoryTaskPath = memory?.taskPath ?? null;
  const memoryTaskObserved =
    Boolean(memoryTaskPath?.lastObservedAt) ||
    Number(memoryTaskPath?.totalRuns ?? 0) > 0;
  const memoryTaskSuccess =
    Boolean(memoryTaskPath?.lastSuccessfulAt) ||
    Number(memoryTaskPath?.successfulRuns ?? 0) > 0;

  const memoryHasRun =
    memoryTaskObserved ||
    Boolean(memory?.lastRunAt) ||
    Number(memory?.totalRuns ?? 0) > 0;
  const memorySuccess =
    memoryTaskSuccess ||
    memory?.lastStatus === "success" ||
    Number(memory?.successCount ?? 0) > 0;
  const liveConfirmedEvidence =
    spawnedWorkerCapable &&
    Boolean(
      (latestSuccessfulExecution && memorySuccess) ||
        (latestSuccessfulExecution && latestAllowedExecute) ||
        (memorySuccess && latestAllowedExecute),
    );
  const observedEvidence =
    spawnedWorkerCapable &&
    Boolean(
      latestObservedExecution || memoryHasRun || latestAllowedPreflight || latestAllowedExecute,
    );

  const evidenceSources = new Set<string>();
  if (latestSuccessfulExecution) {
    evidenceSources.add("task-run-success");
  } else if (latestObservedExecution) {
    evidenceSources.add(`task-run-${latestObservedExecution.status}`);
  } else if (
    typeof memoryTaskPath?.lastObservedStatus === "string" &&
    memoryTaskPath.lastObservedStatus.length > 0
  ) {
    evidenceSources.add(`task-path-${memoryTaskPath.lastObservedStatus}`);
  }
  if (memoryTaskObserved) {
    evidenceSources.add(memoryTaskSuccess ? "task-path-success" : "task-path-observed");
  }
  if (memoryHasRun) {
    evidenceSources.add(memorySuccess ? "agent-memory-success" : "agent-memory");
  }
  if (latestAllowedPreflight) {
    evidenceSources.add("toolgate-preflight");
  }
  if (latestAllowedExecute) {
    evidenceSources.add("toolgate-execute");
  }

  let workerValidationStatus: AgentStatusValidation;
  if (liveConfirmedEvidence || CONFIRMED_WORKER_AGENTS.has(agentId)) {
    workerValidationStatus = "confirmed-worker";
    if (!liveConfirmedEvidence && CONFIRMED_WORKER_AGENTS.has(agentId)) {
      evidenceSources.add("validation-sweep-baseline");
    }
  } else if (PARTIAL_WORKER_AGENTS.has(agentId) || observedEvidence) {
    workerValidationStatus = "partial-worker";
    if (!observedEvidence && PARTIAL_WORKER_AGENTS.has(agentId)) {
      evidenceSources.add("validation-sweep-baseline");
    }
  } else {
    workerValidationStatus = "not-yet-verified";
  }

  const lastEvidenceAtCandidates = [
    latestSuccessfulExecution?.lastHandledAt ?? null,
    latestObservedExecution?.lastHandledAt ?? null,
    latestSuccessfulMemoryEntry?.completedAt ?? latestSuccessfulMemoryEntry?.startedAt ?? null,
    memoryTaskPath?.lastObservedAt ?? null,
    memoryTaskPath?.lastSuccessfulAt ?? null,
    memory?.serviceHeartbeat?.checkedAt ?? null,
    memory?.lastRunAt ?? null,
    latestToolInvocation?.timestamp ?? null,
  ].filter((value): value is string => Boolean(value));

  const lastEvidenceAt =
    lastEvidenceAtCandidates.length > 0
      ? [...lastEvidenceAtCandidates].sort(
          (a, b) => toTimestamp(b) - toTimestamp(a),
        )[0]
      : null;

  return {
    workerValidationStatus,
    lastEvidenceAt,
    evidenceSources: Array.from(evidenceSources.values()),
    lastSuccessfulRunId:
      latestSuccessfulExecution?.idempotencyKey ??
      latestSuccessfulMemoryEntry?.taskId ??
      (memory?.lastStatus === "success" ? memory.lastTaskId ?? null : null),
    lastSuccessfulTaskId:
      latestSuccessfulExecution?.taskId ??
      latestSuccessfulMemoryEntry?.taskId ??
      (memory?.lastStatus === "success" ? memory.lastTaskId ?? null : null),
    lastToolGateMode: latestToolInvocation
      ? resolveToolInvocationMode(latestToolInvocation)
      : null,
    lastToolGateSkillId: latestToolInvocation?.skillId ?? null,
    lastToolGateAt: latestToolInvocation?.timestamp ?? null,
  };
}

function resolveDependencySensitivity(agentId: string): AgentDependencySensitivity {
  if (agentId === "market-research-agent" || agentId === "reddit-helper") {
    return "high";
  }
  if (agentId === "doc-specialist") {
    return "medium";
  }
  return "low";
}

function resolveAgentFrontendExposure(
  workerValidationStatus: AgentStatusValidation,
  serviceImplementation: boolean,
  spawnedWorkerCapable: boolean,
): AgentFrontendExposure {
  if (workerValidationStatus === "confirmed-worker") {
    return "usable-now";
  }
  if (serviceImplementation || spawnedWorkerCapable) {
    return "partial";
  }
  return "backend-only";
}

function buildAgentRuntimeProofSummary(args: {
  orchestratorTask: string | null;
  spawnedWorkerCapable: boolean;
  serviceAvailable: boolean;
  serviceExpected: boolean;
  serviceInstalled: boolean | null;
  serviceRunning: boolean | null;
  memory: AgentMemoryState | null;
  workerEvidence: AgentWorkerEvidenceSummary;
  verifiedRepairCount: number;
}) {
  const {
    orchestratorTask,
    spawnedWorkerCapable,
    serviceAvailable,
    serviceExpected,
    serviceInstalled,
    serviceRunning,
    memory,
    workerEvidence,
    verifiedRepairCount,
  } = args;
  const checkedAt = serviceExpected
    ? memory?.serviceHeartbeat?.checkedAt ?? null
    : null;
  const checkedAtTs = checkedAt ? toTimestamp(checkedAt) : 0;
  const staleAgeMs = checkedAtTs > 0 ? Math.max(0, Date.now() - checkedAtTs) : null;
  const taskPath = memory?.taskPath ?? null;
  const taskObserved =
    Boolean(taskPath?.lastObservedAt) || Number(taskPath?.totalRuns ?? 0) > 0;
  const taskSucceeded =
    Boolean(taskPath?.lastSuccessfulAt) || Number(taskPath?.successfulRuns ?? 0) > 0;

  return {
    serviceHeartbeat: {
      checkedAt,
      status: serviceExpected
        ? memory?.serviceHeartbeat?.status ?? memory?.lastStatus ?? null
        : null,
      errorSummary: serviceExpected
        ? memory?.serviceHeartbeat?.errorSummary ?? memory?.lastError ?? null
        : null,
      source: serviceExpected ? memory?.serviceHeartbeat?.source ?? null : null,
      staleAgeMs,
    },
    taskPath: {
      taskType: taskPath?.taskType ?? orchestratorTask,
      lastObservedAt: taskPath?.lastObservedAt ?? null,
      lastObservedStatus: taskPath?.lastObservedStatus ?? null,
      lastSuccessfulAt: taskPath?.lastSuccessfulAt ?? null,
      totalRuns: Number(taskPath?.totalRuns ?? memory?.totalRuns ?? 0),
      successfulRuns: Number(taskPath?.successfulRuns ?? memory?.successCount ?? 0),
      failedRuns: Number(taskPath?.failedRuns ?? memory?.errorCount ?? 0),
      activeRuns: Number(taskPath?.activeRuns ?? 0),
      lastError: taskPath?.lastError ?? null,
    },
    distinctions: {
      serviceAlive: serviceRunning === true,
      serviceHeartbeatHealthy:
        serviceExpected && memory?.serviceHeartbeat?.status === "ok",
      serviceAvailable,
      serviceExpected,
      serviceInstalled,
      workerInvocable: spawnedWorkerCapable,
      taskObserved,
      taskSucceeded,
      toolExecutionProved: workerEvidence.lastToolGateMode === "execute",
      verifierOrRepairEvidence: verifiedRepairCount > 0,
    },
  };
}

function toRuntimeSignalRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function toRuntimeSignalCount(value: unknown) {
  const record = toRuntimeSignalRecord(value);
  if (record && typeof record.count === "number" && Number.isFinite(record.count)) {
    return record.count;
  }
  return null;
}

function summarizeAgentCapabilityRuntimeSignal(args: {
  agentId: string;
  key: string;
  value: unknown;
  observedAt: string | null;
  runId: string | null;
  taskId: string | null;
}): AgentCapabilityRuntimeSignal {
  const { agentId, key, value, observedAt, runId, taskId } = args;
  const record = toRuntimeSignalRecord(value);
  let summary = `${key} observed in latest successful runtime result.`;
  let evidence: string[] = [];

  if (agentId === "doc-specialist" && key === "taskSpecificKnowledge") {
    const bundleCount = toRuntimeSignalCount(value);
    summary =
      typeof bundleCount === "number"
        ? `${bundleCount} task-specific knowledge bundle(s) were captured for downstream agent consumption.`
        : "task-specific knowledge bundles were captured for downstream agent consumption.";
    evidence = [
      ...(typeof bundleCount === "number" ? [`bundle-count:${bundleCount}`] : []),
    ];
  } else if (agentId === "doc-specialist" && key === "evidenceRails") {
    const codeCount = toRuntimeSignalCount(record?.code) ?? 0;
    const configCount = toRuntimeSignalCount(record?.config) ?? 0;
    const runtimeCount = toRuntimeSignalCount(record?.runtime) ?? 0;
    const publicProofCount = toRuntimeSignalCount(record?.publicProof) ?? 0;
    summary = `Evidence rails carry ${codeCount} code, ${configCount} config, ${runtimeCount} runtime, and ${publicProofCount} public-proof signal(s) in the latest truth pack.`;
    evidence = [
      `code:${codeCount}`,
      `config:${configCount}`,
      `runtime:${runtimeCount}`,
      `public-proof:${publicProofCount}`,
    ];
  } else if (agentId === "doc-specialist" && key === "topologyPacks") {
    const packCount = toRuntimeSignalCount(value);
    const firstPack = Array.isArray(record?.sample) ? toRuntimeSignalRecord(record.sample[0]) : null;
    const targetAgentId = typeof firstPack?.targetAgentId === "string" ? firstPack.targetAgentId : null;
    const routeTaskType = typeof firstPack?.routeTaskType === "string" ? firstPack.routeTaskType : null;
    summary =
      typeof packCount === "number"
        ? `${packCount} topology pack(s) were emitted with route, service, and environment wiring.`
        : "Topology packs were emitted with route, service, and environment wiring.";
    evidence = [
      ...(typeof packCount === "number" ? [`topology-pack-count:${packCount}`] : []),
      ...(targetAgentId ? [`target-agent:${targetAgentId}`] : []),
      ...(routeTaskType ? [`route-task:${routeTaskType}`] : []),
    ];
  } else if (agentId === "doc-specialist" && key === "contradictionLedger") {
    const contradictionCount = toRuntimeSignalCount(value);
    const topEntry = Array.isArray(record?.sample) ? toRuntimeSignalRecord(record.sample[0]) : null;
    const topEntityId = typeof topEntry?.entityId === "string" ? topEntry.entityId : null;
    const topRankScore =
      typeof topEntry?.rankScore === "number" ? topEntry.rankScore : null;
    summary =
      typeof contradictionCount === "number"
        ? `${contradictionCount} contradiction ledger entr${contradictionCount === 1 ? "y" : "ies"} were ranked across knowledge rails.`
        : "Contradiction ledger entries were ranked across knowledge rails.";
    evidence = [
      ...(typeof contradictionCount === "number"
        ? [`contradiction-count:${contradictionCount}`]
        : []),
      ...(topEntityId ? [`top-entity:${topEntityId}`] : []),
      ...(topRankScore !== null ? [`top-rank-score:${topRankScore}`] : []),
    ];
  } else if (agentId === "doc-specialist" && key === "repairDrafts") {
    const repairDraftCount = toRuntimeSignalCount(value);
    const firstDraft = Array.isArray(record?.sample) ? toRuntimeSignalRecord(record.sample[0]) : null;
    const targetAgentId =
      typeof firstDraft?.targetAgentId === "string" ? firstDraft.targetAgentId : null;
    const verifierRequired = firstDraft?.verifierRequired === true;
    summary =
      typeof repairDraftCount === "number"
        ? `${repairDraftCount} structured repair draft(s) were emitted for downstream execution.`
        : "Structured repair drafts were emitted for downstream execution.";
    evidence = [
      ...(typeof repairDraftCount === "number"
        ? [`repair-draft-count:${repairDraftCount}`]
        : []),
      ...(targetAgentId ? [`target-agent:${targetAgentId}`] : []),
      `verifier-required:${verifierRequired}`,
    ];
  } else if (agentId === "doc-specialist" && key === "freshnessSignals") {
    const signalCount = toRuntimeSignalCount(value);
    summary =
      typeof signalCount === "number"
        ? `${signalCount} freshness signal(s) were emitted in the latest truth pack.`
        : "freshness signals were emitted in the latest truth pack.";
    evidence = [
      ...(typeof signalCount === "number" ? [`freshness-signal-count:${signalCount}`] : []),
    ];
  } else if (agentId === "doc-specialist" && key === "entityFreshnessLedger") {
    const entryCount = toRuntimeSignalCount(value);
    const firstEntry = Array.isArray(record?.sample)
      ? toRuntimeSignalRecord(record.sample[0])
      : null;
    const entityId = typeof firstEntry?.entityId === "string" ? firstEntry.entityId : null;
    const freshness =
      typeof firstEntry?.freshness === "string" ? firstEntry.freshness : null;
    summary =
      typeof entryCount === "number"
        ? `${entryCount} entity-level freshness ledger entr${entryCount === 1 ? "y" : "ies"} were emitted for contradiction-aware truth review.`
        : "Entity-level freshness ledger entries were emitted for contradiction-aware truth review.";
    evidence = [
      ...(typeof entryCount === "number" ? [`entry-count:${entryCount}`] : []),
      ...(entityId ? [`entity:${entityId}`] : []),
      ...(freshness ? [`freshness:${freshness}`] : []),
    ];
  } else if (agentId === "doc-specialist" && key === "contradictionGraph") {
    const entityCount = Number(record?.entityCount ?? 0);
    const rankedContradictionCount = Number(record?.rankedContradictionCount ?? 0);
    const railCount = toRuntimeSignalCount(record?.byRail) ?? 0;
    summary = `Contradiction graph spans ${entityCount} entit${entityCount === 1 ? "y" : "ies"} with ${rankedContradictionCount} ranked contradiction(s) across ${railCount} rail summary node(s).`;
    evidence = [
      `entity-count:${entityCount}`,
      `ranked-contradictions:${rankedContradictionCount}`,
      `rail-count:${railCount}`,
    ];
  } else if (agentId === "integration-agent" && key === "partialCompletion") {
    const completedSteps = Number(record?.completedSteps ?? 0);
    const remainingSteps = Number(record?.remainingSteps ?? 0);
    const rerouteCount = Number(record?.rerouteCount ?? 0);
    const blockedStep =
      typeof record?.blockedStep === "string" ? record.blockedStep : null;
    const replayable = record?.replayable === true;
    summary = `Workflow partial-completion evidence shows ${completedSteps} completed step(s), ${remainingSteps} remaining step(s), ${rerouteCount} reroute(s), and replayable=${replayable}.`;
    evidence = [
      `completed-steps:${completedSteps}`,
      `remaining-steps:${remainingSteps}`,
      `reroute-count:${rerouteCount}`,
      `replayable:${replayable}`,
      ...(blockedStep ? [`blocked-step:${blockedStep}`] : []),
    ];
  } else if (agentId === "integration-agent" && key === "workflowProfile") {
    const classification =
      typeof record?.classification === "string" ? record.classification : "unknown";
    const dominantSurface =
      typeof record?.dominantSurface === "string" ? record.dominantSurface : "unknown";
    const verifierRequired = record?.verifierRequired === true;
    const riskCount = Array.isArray(record?.coordinationRisks)
      ? record.coordinationRisks.length
      : toRuntimeSignalCount(record?.coordinationRisks) ?? 0;
    summary = `Workflow profile is ${classification} on ${dominantSurface} with ${riskCount} coordination risk(s) and verifierRequired=${verifierRequired}.`;
    evidence = [
      `classification:${classification}`,
      `dominant-surface:${dominantSurface}`,
      `coordination-risk-count:${riskCount}`,
      `verifier-required:${verifierRequired}`,
    ];
  } else if (agentId === "integration-agent" && key === "delegationPlan") {
    const decisionCount = toRuntimeSignalCount(value);
    const firstDecision = Array.isArray(record?.sample) ? toRuntimeSignalRecord(record.sample[0]) : null;
    const mode = typeof firstDecision?.mode === "string" ? firstDecision.mode : "unknown";
    const selectedAgent = typeof firstDecision?.selectedAgent === "string" ? firstDecision.selectedAgent : null;
    summary =
      typeof decisionCount === "number"
        ? `${decisionCount} delegation decision(s) were preserved with readiness and routing rationale.`
        : "Delegation decisions were preserved with readiness and routing rationale.";
    evidence = [
      ...(typeof decisionCount === "number" ? [`decision-count:${decisionCount}`] : []),
      `mode:${mode}`,
      ...(selectedAgent ? [`selected-agent:${selectedAgent}`] : []),
    ];
  } else if (agentId === "integration-agent" && key === "replayContract") {
    const durable = record?.durable === true;
    const replayFromStep =
      typeof record?.replayFromStep === "string" ? record.replayFromStep : null;
    const blockedDependencies = toRuntimeSignalCount(record?.blockedDependencies) ?? 0;
    const checkpointCount = toRuntimeSignalCount(record?.checkpoints) ?? 0;
    summary = `Replay contract is durable=${durable} with ${blockedDependencies} blocked dependenc${blockedDependencies === 1 ? "y" : "ies"} and ${checkpointCount} checkpoint(s).`;
    evidence = [
      `durable:${durable}`,
      `blocked-dependencies:${blockedDependencies}`,
      `checkpoints:${checkpointCount}`,
      ...(replayFromStep ? [`replay-from:${replayFromStep}`] : []),
    ];
  } else if (agentId === "integration-agent" && key === "handoffPackages") {
    const handoffCount = toRuntimeSignalCount(value);
    const firstHandoff = Array.isArray(record?.sample) ? toRuntimeSignalRecord(record.sample[0]) : null;
    const targetAgentId =
      typeof firstHandoff?.targetAgentId === "string" ? firstHandoff.targetAgentId : null;
    const payloadType =
      typeof firstHandoff?.payloadType === "string" ? firstHandoff.payloadType : null;
    summary =
      typeof handoffCount === "number"
        ? `${handoffCount} cross-agent handoff package(s) were preserved in the workflow result.`
        : "Cross-agent handoff packages were preserved in the workflow result.";
    evidence = [
      ...(typeof handoffCount === "number" ? [`handoff-count:${handoffCount}`] : []),
      ...(targetAgentId ? [`target-agent:${targetAgentId}`] : []),
      ...(payloadType ? [`payload-type:${payloadType}`] : []),
    ];
  } else if (agentId === "integration-agent" && key === "dependencyPlan") {
    const totalDependencies = Number(record?.totalDependencies ?? 0);
    const sharedDependencyCount = Number(record?.sharedDependencyCount ?? 0);
    const blockedDependencyCount = Number(record?.blockedDependencyCount ?? 0);
    const criticalStepCount = toRuntimeSignalCount(record?.criticalSteps) ?? 0;
    summary = `Dependency plan tracks ${totalDependencies} declared dependenc${totalDependencies === 1 ? "y" : "ies"}, ${sharedDependencyCount} shared dependency, and ${blockedDependencyCount} blocked dependency lane(s).`;
    evidence = [
      `total-dependencies:${totalDependencies}`,
      `shared-dependencies:${sharedDependencyCount}`,
      `blocked-dependencies:${blockedDependencyCount}`,
      `critical-step-count:${criticalStepCount}`,
    ];
  } else if (agentId === "integration-agent" && key === "workflowMemory") {
    const durable = record?.durable === true;
    const resumeFromStep =
      typeof record?.resumeFromStep === "string" ? record.resumeFromStep : null;
    const recentStopSignals = Number(record?.recentStopSignals ?? 0);
    const proofStopSignals = Number(record?.proofStopSignals ?? 0);
    const checkpointCount = Number(record?.checkpointCount ?? 0);
    summary = `Workflow memory is durable=${durable} with ${recentStopSignals} stop signal(s), ${proofStopSignals} proof stop(s), and ${checkpointCount} checkpoint(s) preserved.`;
    evidence = [
      `durable:${durable}`,
      `recent-stop-signals:${recentStopSignals}`,
      `proof-stop-signals:${proofStopSignals}`,
      `checkpoint-count:${checkpointCount}`,
      ...(resumeFromStep ? [`resume-from:${resumeFromStep}`] : []),
    ];
  } else if (agentId === "system-monitor-agent" && key === "queueBudgetFusion") {
    const status = typeof record?.status === "string" ? record.status : "unknown";
    const budgetStatus =
      typeof record?.budgetStatus === "string" ? record.budgetStatus : "unknown";
    const dependencyRiskScore =
      typeof record?.dependencyRiskScore === "number"
        ? record.dependencyRiskScore
        : null;
    const predictionConfidence =
      typeof record?.predictionConfidence === "string"
        ? record.predictionConfidence
        : null;
    summary = `Queue and budget fusion is ${status} with budget posture ${budgetStatus}${dependencyRiskScore !== null ? ` and dependency risk ${dependencyRiskScore}` : ""}.`;
    evidence = [
      `status:${status}`,
      `budget-status:${budgetStatus}`,
      ...(dependencyRiskScore !== null
        ? [`dependency-risk-score:${dependencyRiskScore}`]
        : []),
      ...(predictionConfidence ? [`prediction-confidence:${predictionConfidence}`] : []),
    ];
  } else if (agentId === "system-monitor-agent" && key === "operationalDiagnosis") {
    const status = typeof record?.status === "string" ? record.status : "unknown";
    const dominantRisk =
      typeof record?.dominantRisk === "string" ? record.dominantRisk : null;
    const diagnosisCount = Number(record?.diagnosisCount ?? 0);
    const operatorActionCount = Number(record?.operatorActionCount ?? 0);
    summary = `Operational diagnosis is ${status} with ${diagnosisCount} diagnosis item(s) and ${operatorActionCount} operator action(s).`;
    evidence = [
      `status:${status}`,
      `diagnosis-count:${diagnosisCount}`,
      `operator-action-count:${operatorActionCount}`,
      ...(dominantRisk ? [`dominant-risk:${dominantRisk}`] : []),
    ];
  } else if (agentId === "system-monitor-agent" && key === "dependencyHealth") {
    const status = typeof record?.status === "string" ? record.status : "unknown";
    const blockedWorkflowCount = Number(record?.blockedWorkflowCount ?? 0);
    const proofFailureCount = Number(record?.proofFailureCount ?? 0);
    const staleAgentCount = Number(record?.staleAgentCount ?? 0);
    const retryRecoveryCount = Number(record?.retryRecoveryCount ?? 0);
    summary = `Dependency health is ${status} with ${blockedWorkflowCount} blocked workflow(s), ${proofFailureCount} proof failure(s), and ${retryRecoveryCount} retry recovery signal(s).`;
    evidence = [
      `status:${status}`,
      `blocked-workflows:${blockedWorkflowCount}`,
      `proof-failures:${proofFailureCount}`,
      `stale-agents:${staleAgentCount}`,
      `retry-recoveries:${retryRecoveryCount}`,
    ];
  } else if (agentId === "system-monitor-agent" && key === "earlyWarnings") {
    const warningCount = toRuntimeSignalCount(value);
    const firstWarning = Array.isArray(record?.sample) ? toRuntimeSignalRecord(record.sample[0]) : null;
    const severity = typeof firstWarning?.severity === "string" ? firstWarning.severity : null;
    const warningId = typeof firstWarning?.id === "string" ? firstWarning.id : null;
    summary =
      typeof warningCount === "number"
        ? `${warningCount} early warning signal(s) were emitted before operator escalation.`
        : "Early warning signals were emitted before operator escalation.";
    evidence = [
      ...(typeof warningCount === "number" ? [`warning-count:${warningCount}`] : []),
      ...(warningId ? [`warning-id:${warningId}`] : []),
      ...(severity ? [`severity:${severity}`] : []),
    ];
  } else if (agentId === "system-monitor-agent" && key === "operatorClosureEvidence") {
    const status = typeof record?.status === "string" ? record.status : "unknown";
    const openCriticalIncidents = Number(record?.openCriticalIncidents ?? 0);
    const prioritizedActions = Number(record?.prioritizedActions ?? 0);
    const verifierSensitiveIncidents = Number(record?.verifierSensitiveIncidents ?? 0);
    const proofFreshness =
      typeof record?.proofFreshness === "string" ? record.proofFreshness : "unknown";
    summary = `Operator closure evidence is ${status} with ${openCriticalIncidents} critical incident(s), ${prioritizedActions} action(s), and proof freshness ${proofFreshness}.`;
    evidence = [
      `status:${status}`,
      `critical-incidents:${openCriticalIncidents}`,
      `prioritized-actions:${prioritizedActions}`,
      `verifier-sensitive-incidents:${verifierSensitiveIncidents}`,
      `proof-freshness:${proofFreshness}`,
    ];
  } else if (agentId === "system-monitor-agent" && key === "trendSummary") {
    const status = typeof record?.status === "string" ? record.status : "unknown";
    const recentHourSignals = Number(record?.recentHourSignals ?? 0);
    const recentTwentyFourHourSignals = Number(record?.recentTwentyFourHourSignals ?? 0);
    const trustBoundaryTrend =
      typeof record?.trustBoundaryTrend === "string"
        ? record.trustBoundaryTrend
        : "unknown";
    summary = `Trend summary is ${status} with ${recentHourSignals} recent-hour signal(s), ${recentTwentyFourHourSignals} 24h signal(s), and trust-boundary trend ${trustBoundaryTrend}.`;
    evidence = [
      `status:${status}`,
      `recent-hour-signals:${recentHourSignals}`,
      `recent-24h-signals:${recentTwentyFourHourSignals}`,
      `trust-boundary-trend:${trustBoundaryTrend}`,
    ];
  } else if (agentId === "security-agent" && key === "regressionReview") {
    const status = typeof record?.status === "string" ? record.status : "unknown";
    const permissionDriftCount = Number(record?.permissionDriftCount ?? 0);
    const recurringBoundaryCount = Number(record?.recurringBoundaryCount ?? 0);
    const rollbackReadyFixCount = Number(record?.rollbackReadyFixCount ?? 0);
    summary = `Regression review is ${status} with ${permissionDriftCount} permission-drift signal(s), ${recurringBoundaryCount} recurring boundary signal(s), and ${rollbackReadyFixCount} rollback-ready fix candidate(s).`;
    evidence = [
      `status:${status}`,
      `permission-drift-count:${permissionDriftCount}`,
      `recurring-boundary-count:${recurringBoundaryCount}`,
      `rollback-ready-fix-count:${rollbackReadyFixCount}`,
    ];
  } else if (agentId === "security-agent" && key === "trustBoundaryHistory") {
    const historyCount = toRuntimeSignalCount(value);
    const recurringCount = Array.isArray(record?.sample)
      ? record.sample.filter((entry) => {
          const sampleRecord = toRuntimeSignalRecord(entry);
          return sampleRecord?.status === "recurring" || sampleRecord?.status === "persisting";
        }).length
      : 0;
    summary =
      typeof historyCount === "number"
        ? `${historyCount} trust-boundary history record(s) preserve recurring or persisting boundary pressure.`
        : "Trust-boundary history preserves recurring or persisting boundary pressure.";
    evidence = [
      ...(typeof historyCount === "number" ? [`history-count:${historyCount}`] : []),
      `recurring-or-persisting:${recurringCount}`,
    ];
  } else if (agentId === "security-agent" && key === "permissionDriftTimeline") {
    const timelineCount = toRuntimeSignalCount(value);
    const firstEntry = Array.isArray(record?.sample) ? toRuntimeSignalRecord(record.sample[0]) : null;
    const latestTimestamp =
      typeof firstEntry?.timestamp === "string" ? firstEntry.timestamp : null;
    summary =
      typeof timelineCount === "number"
        ? `${timelineCount} permission-drift timeline entr${timelineCount === 1 ? "y" : "ies"} were preserved for regression review.`
        : "Permission-drift timeline entries were preserved for regression review.";
    evidence = [
      ...(typeof timelineCount === "number" ? [`timeline-count:${timelineCount}`] : []),
      ...(latestTimestamp ? [`latest-timestamp:${latestTimestamp}`] : []),
    ];
  } else if (agentId === "security-agent" && key === "routeBoundaryWatch") {
    const status = typeof record?.status === "string" ? record.status : "unknown";
    const unprotectedRouteCount = Number(record?.unprotectedRouteCount ?? 0);
    const authFindingCount = Number(record?.authFindingCount ?? 0);
    const recurringAuthIncidents = Number(record?.recurringAuthIncidents ?? 0);
    summary = `Route boundary watch is ${status} with ${authFindingCount} auth finding(s), ${unprotectedRouteCount} unprotected route(s), and ${recurringAuthIncidents} recurring auth incident(s).`;
    evidence = [
      `status:${status}`,
      `unprotected-routes:${unprotectedRouteCount}`,
      `auth-findings:${authFindingCount}`,
      `recurring-auth-incidents:${recurringAuthIncidents}`,
    ];
  } else if (agentId === "security-agent" && key === "remediationDepth") {
    const status = typeof record?.status === "string" ? record.status : "unknown";
    const rollbackSensitiveFixCount = Number(record?.rollbackSensitiveFixCount ?? 0);
    const trustBoundaryFixCount = Number(record?.trustBoundaryFixCount ?? 0);
    const criticalPriorityCount = Number(record?.criticalPriorityCount ?? 0);
    summary = `Remediation depth is ${status} with ${trustBoundaryFixCount} trust-boundary fix(es) and ${criticalPriorityCount} critical priority item(s).`;
    evidence = [
      `status:${status}`,
      `rollback-sensitive-fixes:${rollbackSensitiveFixCount}`,
      `trust-boundary-fixes:${trustBoundaryFixCount}`,
      `critical-priorities:${criticalPriorityCount}`,
    ];
  } else if (agentId === "security-agent" && key === "exploitabilityRanking") {
    const rankingCount = toRuntimeSignalCount(value);
    const topEntry = Array.isArray(record?.sample)
      ? toRuntimeSignalRecord(record.sample[0])
      : null;
    const location = typeof topEntry?.location === "string" ? topEntry.location : null;
    const combinedScore =
      typeof topEntry?.combinedScore === "number" ? topEntry.combinedScore : null;
    summary =
      typeof rankingCount === "number"
        ? `${rankingCount} exploitability-ranked finding(s) were preserved for remediation prioritization.`
        : "Exploitability-ranked findings were preserved for remediation prioritization.";
    evidence = [
      ...(typeof rankingCount === "number" ? [`ranking-count:${rankingCount}`] : []),
      ...(location ? [`top-location:${location}`] : []),
      ...(combinedScore !== null ? [`top-score:${combinedScore}`] : []),
    ];
  } else if (agentId === "security-agent" && key === "remediationClosure") {
    const status = typeof record?.status === "string" ? record.status : "unknown";
    const highRiskCount = Number(record?.highRiskCount ?? 0);
    const ownerlessPriorityCount = Number(record?.ownerlessPriorityCount ?? 0);
    const verifierRecommended = record?.verifierRecommended === true;
    summary = `Remediation closure is ${status} with ${highRiskCount} high-risk fix(es), ${ownerlessPriorityCount} ownerless priority item(s), and verifierRecommended=${verifierRecommended}.`;
    evidence = [
      `status:${status}`,
      `high-risk-count:${highRiskCount}`,
      `ownerless-priority-count:${ownerlessPriorityCount}`,
      `verifier-recommended:${verifierRecommended}`,
    ];
  } else if (agentId === "build-refactor-agent" && key === "scopeContract") {
    const scopeType =
      typeof record?.scopeType === "string" ? record.scopeType : "unknown";
    const bounded = record?.bounded === true;
    const estimatedTouchedFiles = Number(record?.estimatedTouchedFiles ?? 0);
    const requestedMaxFilesChanged =
      typeof record?.requestedMaxFilesChanged === "number"
        ? record.requestedMaxFilesChanged
        : null;
    const refusalReasonCount = toRuntimeSignalCount(record?.refusalReasons) ?? 0;
    summary = `Scope contract is ${scopeType} with bounded=${bounded}, ${estimatedTouchedFiles} estimated touched file(s), and ${refusalReasonCount} refusal reason(s).`;
    evidence = [
      `scope-type:${scopeType}`,
      `bounded:${bounded}`,
      `estimated-touched-files:${estimatedTouchedFiles}`,
      ...(requestedMaxFilesChanged !== null
        ? [`requested-max-files:${requestedMaxFilesChanged}`]
        : []),
      `refusal-reasons:${refusalReasonCount}`,
    ];
  } else if (agentId === "build-refactor-agent" && key === "surgeryProfile") {
    const changeType =
      typeof record?.changeType === "string" ? record.changeType : "unknown";
    const affectedSurfaces = toRuntimeSignalCount(record?.affectedSurfaces) ?? 0;
    const qaVerificationRequired = record?.qaVerificationRequired === true;
    const rollbackSensitive = record?.rollbackSensitive === true;
    const repairLinked = record?.repairLinked === true;
    summary = `Surgery profile is ${changeType} across ${affectedSurfaces} affected surface(s) with qaVerificationRequired=${qaVerificationRequired}, rollbackSensitive=${rollbackSensitive}, and repairLinked=${repairLinked}.`;
    evidence = [
      `change-type:${changeType}`,
      `affected-surfaces:${affectedSurfaces}`,
      `qa-verification-required:${qaVerificationRequired}`,
      `rollback-sensitive:${rollbackSensitive}`,
      `repair-linked:${repairLinked}`,
    ];
  } else if (agentId === "build-refactor-agent" && key === "verificationLoop") {
    const mode = typeof record?.mode === "string" ? record.mode : "unknown";
    const requiresVerifier = record?.requiresVerifier === true;
    const postEditSteps = toRuntimeSignalCount(record?.postEditSteps) ?? 0;
    const linkedRepairId =
      typeof record?.linkedRepairId === "string" ? record.linkedRepairId : null;
    const linkedIncidentId =
      typeof record?.linkedIncidentId === "string" ? record.linkedIncidentId : null;
    summary = `Verification loop runs in ${mode} mode with requiresVerifier=${requiresVerifier} and ${postEditSteps} post-edit step(s).`;
    evidence = [
      `mode:${mode}`,
      `requires-verifier:${requiresVerifier}`,
      `post-edit-steps:${postEditSteps}`,
      ...(linkedRepairId ? [`linked-repair:${linkedRepairId}`] : []),
      ...(linkedIncidentId ? [`linked-incident:${linkedIncidentId}`] : []),
    ];
  } else if (agentId === "build-refactor-agent" && key === "impactEnvelope") {
    const estimatedTouchedFiles = Number(record?.estimatedTouchedFiles ?? 0);
    const multiStepEdit = record?.multiStepEdit === true;
    const rollbackWindow =
      typeof record?.rollbackWindow === "string" ? record.rollbackWindow : "unknown";
    const verificationDepth =
      typeof record?.verificationDepth === "string" ? record.verificationDepth : "unknown";
    summary = `Impact envelope covers ${estimatedTouchedFiles} touched file(s) with multiStepEdit=${multiStepEdit}, rollbackWindow=${rollbackWindow}, and verificationDepth=${verificationDepth}.`;
    evidence = [
      `estimated-touched-files:${estimatedTouchedFiles}`,
      `multi-step-edit:${multiStepEdit}`,
      `rollback-window:${rollbackWindow}`,
      `verification-depth:${verificationDepth}`,
    ];
  } else if (agentId === "build-refactor-agent" && key === "refusalProfile") {
    const refused = record?.refused === true;
    const confidence =
      typeof record?.confidence === "number" ? record.confidence : null;
    const narrowScopeSuggested = record?.narrowScopeSuggested === true;
    const suggestedMaxFilesChanged =
      typeof record?.suggestedMaxFilesChanged === "number"
        ? record.suggestedMaxFilesChanged
        : null;
    summary = `Refusal profile has refused=${refused} with narrowScopeSuggested=${narrowScopeSuggested}${confidence !== null ? ` and confidence ${confidence}` : ""}.`;
    evidence = [
      `refused:${refused}`,
      `narrow-scope-suggested:${narrowScopeSuggested}`,
      ...(confidence !== null ? [`confidence:${confidence}`] : []),
      ...(suggestedMaxFilesChanged !== null
        ? [`suggested-max-files:${suggestedMaxFilesChanged}`]
        : []),
    ];
  } else if (agentId === "skill-audit-agent" && key === "trustPosture") {
    const status = typeof record?.status === "string" ? record.status : "unknown";
    const approvedCount = Number(record?.approvedCount ?? 0);
    const pendingReviewCount = Number(record?.pendingReviewCount ?? 0);
    const restartSafeApprovedCount = Number(record?.restartSafeApprovedCount ?? 0);
    const metadataOnlyCount = Number(record?.metadataOnlyCount ?? 0);
    const missingRegistryCount = Number(record?.missingRegistryCount ?? 0);
    summary = `Trust posture is ${status} with ${approvedCount} approved skill(s), ${pendingReviewCount} pending review, and ${restartSafeApprovedCount} restart-safe approval(s).`;
    evidence = [
      `status:${status}`,
      `approved-count:${approvedCount}`,
      `pending-review-count:${pendingReviewCount}`,
      `restart-safe-approved-count:${restartSafeApprovedCount}`,
      `metadata-only-count:${metadataOnlyCount}`,
      `missing-registry-count:${missingRegistryCount}`,
    ];
  } else if (agentId === "skill-audit-agent" && key === "policyHandoff") {
    const status = typeof record?.status === "string" ? record.status : "unknown";
    const pendingReviewSkills = Array.isArray(record?.pendingReviewSkills)
      ? record.pendingReviewSkills.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    const metadataOnlySkills = Array.isArray(record?.metadataOnlySkills)
      ? record.metadataOnlySkills.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    summary = `Policy handoff is ${status} with ${pendingReviewSkills.length} pending-review skill(s) and ${metadataOnlySkills.length} metadata-only skill(s).`;
    evidence = [
      `status:${status}`,
      `pending-review-skills:${pendingReviewSkills.length}`,
      `metadata-only-skills:${metadataOnlySkills.length}`,
      ...pendingReviewSkills.slice(0, 3).map((skillId) => `pending:${skillId}`),
      ...metadataOnlySkills.slice(0, 3).map((skillId) => `metadata-only:${skillId}`),
    ];
  } else if (agentId === "skill-audit-agent" && key === "telemetryHandoff") {
    const status = typeof record?.status === "string" ? record.status : "unknown";
    const riskySkillIds = Array.isArray(record?.riskySkillIds)
      ? record.riskySkillIds.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    const missingSkillIds = Array.isArray(record?.missingSkillIds)
      ? record.missingSkillIds.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    summary = `Telemetry handoff is ${status} with ${riskySkillIds.length} risky skill(s) and ${missingSkillIds.length} missing or unaudited skill(s).`;
    evidence = [
      `status:${status}`,
      `risky-skill-count:${riskySkillIds.length}`,
      `missing-skill-count:${missingSkillIds.length}`,
      ...riskySkillIds.slice(0, 3).map((skillId) => `risky:${skillId}`),
      ...missingSkillIds.slice(0, 3).map((skillId) => `missing:${skillId}`),
    ];
  } else if (agentId === "skill-audit-agent" && key === "intakeCoverage") {
    const passCount = Number(record?.passCount ?? 0);
    const warnCount = Number(record?.warnCount ?? 0);
    const failCount = Number(record?.failCount ?? 0);
    const auditedSkills = Number(record?.auditedSkills ?? 0);
    summary = `Intake coverage preserves ${passCount} pass, ${warnCount} warn, and ${failCount} fail checklist signal(s) across ${auditedSkills} audited skill(s).`;
    evidence = [
      `pass-count:${passCount}`,
      `warn-count:${warnCount}`,
      `fail-count:${failCount}`,
      `audited-skills:${auditedSkills}`,
    ];
  } else if (agentId === "skill-audit-agent" && key === "restartSafetySummary") {
    const status = typeof record?.status === "string" ? record.status : "unknown";
    const restartSafeCount = Number(record?.restartSafeCount ?? 0);
    const metadataOnlyCount = Number(record?.metadataOnlyCount ?? 0);
    const needsReviewCount = Number(record?.needsReviewCount ?? 0);
    summary = `Restart safety summary is ${status} with ${restartSafeCount} restart-safe skill(s), ${metadataOnlyCount} metadata-only, and ${needsReviewCount} needing review.`;
    evidence = [
      `status:${status}`,
      `restart-safe-count:${restartSafeCount}`,
      `metadata-only-count:${metadataOnlyCount}`,
      `needs-review-count:${needsReviewCount}`,
    ];
  } else if (agentId === "qa-verification-agent" && key === "acceptanceCoverage") {
    const surface = typeof record?.surface === "string" ? record.surface : "unknown";
    const acceptanceMode =
      typeof record?.acceptanceMode === "string"
        ? record.acceptanceMode
        : "unknown";
    const closureReadiness =
      typeof record?.closureReadiness === "string"
        ? record.closureReadiness
        : "unknown";
    const evidenceAnchorsSupplied = Number(record?.evidenceAnchorsSupplied ?? 0);
    const runtimeSignals = Number(record?.runtimeSignals ?? 0);
    summary = `Acceptance coverage for ${surface} runs in ${acceptanceMode} mode with closure readiness ${closureReadiness}.`;
    evidence = [
      `surface:${surface}`,
      `acceptance-mode:${acceptanceMode}`,
      `closure-readiness:${closureReadiness}`,
      `evidence-anchors:${evidenceAnchorsSupplied}`,
      `runtime-signals:${runtimeSignals}`,
    ];
  } else if (agentId === "qa-verification-agent" && key === "verificationSurface") {
    const surface = typeof record?.surface === "string" ? record.surface : "unknown";
    const acceptanceMode =
      typeof record?.acceptanceMode === "string"
        ? record.acceptanceMode
        : "unknown";
    const blockerCount = toRuntimeSignalCount(record?.blockers) ?? 0;
    const refusalReason =
      typeof record?.refusalReason === "string" ? record.refusalReason : null;
    summary = `Verification surface is ${surface} with ${acceptanceMode} acceptance mode and ${blockerCount} blocker(s).`;
    evidence = [
      `surface:${surface}`,
      `acceptance-mode:${acceptanceMode}`,
      `blocker-count:${blockerCount}`,
      ...(refusalReason ? [`refusal:${refusalReason}`] : []),
    ];
  } else if (agentId === "qa-verification-agent" && key === "verificationAuthority") {
    const targetKind = typeof record?.targetKind === "string" ? record.targetKind : "unknown";
    const authorityLevel =
      typeof record?.authorityLevel === "string" ? record.authorityLevel : "unknown";
    const closureEligible = record?.closureEligible === true;
    const escalationRequired = record?.escalationRequired === true;
    summary = `Verification authority for ${targetKind} is ${authorityLevel} with closureEligible=${closureEligible} and escalationRequired=${escalationRequired}.`;
    evidence = [
      `target-kind:${targetKind}`,
      `authority-level:${authorityLevel}`,
      `closure-eligible:${closureEligible}`,
      `escalation-required:${escalationRequired}`,
    ];
  } else if (agentId === "qa-verification-agent" && key === "verificationTrace") {
    const executionMode =
      typeof record?.executionMode === "string" ? record.executionMode : "unknown";
    const reproducibility =
      typeof record?.reproducibility === "string" ? record.reproducibility : "unknown";
    const evidenceQuality =
      typeof record?.evidenceQuality === "string" ? record.evidenceQuality : "unknown";
    const allowClosure = record?.allowClosure === true;
    summary = `Verification trace ran in ${executionMode} mode with reproducibility ${reproducibility}, evidence quality ${evidenceQuality}, and allowClosure=${allowClosure}.`;
    evidence = [
      `execution-mode:${executionMode}`,
      `reproducibility:${reproducibility}`,
      `evidence-quality:${evidenceQuality}`,
      `allow-closure:${allowClosure}`,
    ];
  } else if (agentId === "qa-verification-agent" && key === "refusalProfile") {
    const surface = typeof record?.surface === "string" ? record.surface : "unknown";
    const executeRequested = record?.executeRequested === true;
    const refused = record?.refused === true;
    const blockerCount = Number(record?.blockerCount ?? 0);
    const reason = typeof record?.reason === "string" ? record.reason : null;
    summary = `Refusal profile for ${surface} has refused=${refused} with ${blockerCount} blocker(s) and executeRequested=${executeRequested}.`;
    evidence = [
      `surface:${surface}`,
      `refused:${refused}`,
      `execute-requested:${executeRequested}`,
      `blocker-count:${blockerCount}`,
      ...(reason ? [`reason:${reason}`] : []),
    ];
  } else if (agentId === "qa-verification-agent" && key === "closureContract") {
    const targetKind = typeof record?.targetKind === "string" ? record.targetKind : "unknown";
    const closeAllowed = record?.closeAllowed === true;
    const reopenOnFailure = record?.reopenOnFailure === true;
    const unresolvedSignals = Number(record?.unresolvedSignals ?? 0);
    summary = `Closure contract for ${targetKind} has closeAllowed=${closeAllowed}, reopenOnFailure=${reopenOnFailure}, and ${unresolvedSignals} unresolved verification signal(s).`;
    evidence = [
      `target-kind:${targetKind}`,
      `close-allowed:${closeAllowed}`,
      `reopen-on-failure:${reopenOnFailure}`,
      `unresolved-signals:${unresolvedSignals}`,
    ];
  } else if (agentId === "qa-verification-agent" && key === "reproducibilityProfile") {
    const reproducibility =
      typeof record?.reproducibility === "string" ? record.reproducibility : "unknown";
    const evidenceQuality =
      typeof record?.evidenceQuality === "string" ? record.evidenceQuality : "unknown";
    const regressionRisk =
      typeof record?.regressionRisk === "string" ? record.regressionRisk : "unknown";
    const workflowStopSignals = Number(record?.workflowStopSignals ?? 0);
    summary = `Reproducibility profile is ${reproducibility} with evidence quality ${evidenceQuality}, regression risk ${regressionRisk}, and ${workflowStopSignals} workflow stop signal(s).`;
    evidence = [
      `reproducibility:${reproducibility}`,
      `evidence-quality:${evidenceQuality}`,
      `regression-risk:${regressionRisk}`,
      `workflow-stop-signals:${workflowStopSignals}`,
    ];
  } else if (agentId === "reddit-helper" && key === "providerPosture") {
    const mode = typeof record?.mode === "string" ? record.mode : "unknown";
    const queuePressureStatus =
      typeof record?.queuePressureStatus === "string"
        ? record.queuePressureStatus
        : "unknown";
    const fallbackIntegrity =
      typeof record?.fallbackIntegrity === "string"
        ? record.fallbackIntegrity
        : "unknown";
    const reviewRecommended = record?.reviewRecommended === true;
    summary = `Provider posture is ${mode} with queue pressure ${queuePressureStatus} and fallback integrity ${fallbackIntegrity}.`;
    evidence = [
      `mode:${mode}`,
      `queue-pressure:${queuePressureStatus}`,
      `fallback-integrity:${fallbackIntegrity}`,
      `review-recommended:${reviewRecommended}`,
    ];
  } else if (agentId === "content-agent" && key === "publicationPolicy") {
    const status = typeof record?.status === "string" ? record.status : "unknown";
    const rationale =
      typeof record?.rationale === "string" ? record.rationale : null;
    summary = `Publication policy is ${status} for the latest bounded content run.`;
    evidence = [
      `status:${status}`,
      ...(rationale ? [`rationale:${rationale}`] : []),
    ];
  } else if (agentId === "summarization-agent" && key === "operationalCompression") {
    const mode = typeof record?.mode === "string" ? record.mode : "unknown";
    const downstreamTarget =
      typeof record?.downstreamTarget === "string"
        ? record.downstreamTarget
        : "unknown";
    const anchorRetentionRatio =
      typeof record?.anchorRetentionRatio === "number"
        ? record.anchorRetentionRatio
        : null;
    const blockerSafe = record?.blockerSafe === true;
    summary = `Operational compression ran in ${mode} mode for ${downstreamTarget} with blocker-safe=${blockerSafe}.`;
    evidence = [
      `mode:${mode}`,
      `downstream-target:${downstreamTarget}`,
      `blocker-safe:${blockerSafe}`,
      ...(anchorRetentionRatio !== null
        ? [`anchor-retention-ratio:${anchorRetentionRatio.toFixed(2)}`]
        : []),
    ];
  } else if (agentId === "data-extraction-agent" && key === "artifactCoverage") {
    const normalizationReadyCount = Number(record?.normalizationReadyCount ?? 0);
    const provenanceDepth =
      typeof record?.provenanceDepth === "string"
        ? record.provenanceDepth
        : "unknown";
    const formats = Array.isArray(record?.formats)
      ? record.formats.filter((entry): entry is string => typeof entry === "string")
      : [];
    summary = `Artifact coverage spans ${formats.length} format(s) with ${normalizationReadyCount} normalization-ready artifact(s).`;
    evidence = [
      `formats:${formats.length}`,
      `normalization-ready-count:${normalizationReadyCount}`,
      `provenance-depth:${provenanceDepth}`,
      ...formats.slice(0, 3).map((format) => `format:${format}`),
    ];
  } else if (agentId === "normalization-agent" && key === "comparisonReadiness") {
    const status = typeof record?.status === "string" ? record.status : "unknown";
    const duplicateKeyCount = Number(record?.duplicateKeyCount ?? 0);
    const uncertaintyCount = Number(record?.uncertaintyCount ?? 0);
    const canonicalIdCount = Number(record?.canonicalIdCount ?? 0);
    summary = `Comparison readiness is ${status} with ${canonicalIdCount} canonical id(s), ${duplicateKeyCount} duplicate key(s), and ${uncertaintyCount} uncertainty flag(s).`;
    evidence = [
      `status:${status}`,
      `canonical-id-count:${canonicalIdCount}`,
      `duplicate-key-count:${duplicateKeyCount}`,
      `uncertainty-count:${uncertaintyCount}`,
    ];
  } else if (agentId === "market-research-agent" && key === "deltaCapture") {
    const status = typeof record?.status === "string" ? record.status : "unknown";
    const substantiveCount = Number(record?.substantiveCount ?? 0);
    const degradedCount = Number(record?.degradedCount ?? 0);
    const unreachableCount = Number(record?.unreachableCount ?? 0);
    summary = `Delta capture is ${status} with ${substantiveCount} substantive signal(s), ${degradedCount} degraded signal(s), and ${unreachableCount} unreachable signal(s).`;
    evidence = [
      `status:${status}`,
      `substantive-count:${substantiveCount}`,
      `degraded-count:${degradedCount}`,
      `unreachable-count:${unreachableCount}`,
    ];
  } else if (agentId === "deployment-ops-agent" && key === "deploymentOps") {
    const deploymentOps = record as Record<string, any>;
    const decision =
      typeof deploymentOps?.decision === "string" ? deploymentOps.decision : "unknown";
    const target =
      typeof deploymentOps?.target === "string"
        ? deploymentOps.target
        : "public-runtime";
    const rolloutMode =
      typeof deploymentOps?.rolloutMode === "string"
        ? deploymentOps.rolloutMode
        : "service";
    const rollbackStatus =
      typeof deploymentOps?.rollbackReadiness?.status === "string"
        ? deploymentOps.rollbackReadiness.status
        : "unknown";
    const driftStatus =
      typeof deploymentOps?.environmentDrift?.status === "string"
        ? deploymentOps.environmentDrift.status
        : "unknown";
    summary = `Deployment ops is ${decision} for ${target} (${rolloutMode}) with rollback ${rollbackStatus} and drift ${driftStatus}.`;
    evidence = [
      `decision:${decision}`,
      `target:${target}`,
      `rollout-mode:${rolloutMode}`,
      `rollback-status:${rollbackStatus}`,
      `drift-status:${driftStatus}`,
    ];
  } else if (agentId === "operations-analyst-agent" && key === "controlPlaneBrief") {
    const brief = record as Record<string, any>;
    const mode =
      typeof brief?.mode?.label === "string" ? brief.mode.label : "unknown";
    const primaryMove =
      typeof brief?.primaryOperatorMove?.title === "string"
        ? brief.primaryOperatorMove.title
        : "unknown";
    const queueQueued = Number(brief?.queue?.queued ?? 0);
    const openIncidents = Number(brief?.incidents?.openCount ?? 0);
    const pendingApprovals = Number(brief?.approvals?.pendingCount ?? 0);
    summary = `Control-plane brief reports ${mode} mode with primary move "${primaryMove}", ${openIncidents} open incident(s), ${pendingApprovals} pending approval(s), and ${queueQueued} queued task(s).`;
    evidence = [
      `mode:${mode}`,
      `primary-move:${primaryMove}`,
      `open-incidents:${openIncidents}`,
      `pending-approvals:${pendingApprovals}`,
      `queued:${queueQueued}`,
    ];
  } else if (agentId === "release-manager-agent" && key === "releaseReadiness") {
    const readiness = record as Record<string, any>;
    const decision =
      typeof readiness?.decision === "string" ? readiness.decision : "unknown";
    const target =
      typeof readiness?.releaseTarget === "string"
        ? readiness.releaseTarget
        : "workspace";
    const openIncidents = Number(readiness?.evidenceWindow?.openIncidents ?? 0);
    const pendingApprovals = Number(readiness?.evidenceWindow?.pendingApprovals ?? 0);
    const summaryLine =
      typeof readiness?.summary === "string"
        ? readiness.summary
        : "No release summary recorded.";
    summary = `Release readiness is ${decision} for ${target}. ${summaryLine}`;
    evidence = [
      `decision:${decision}`,
      `release-target:${target}`,
      `open-incidents:${openIncidents}`,
      `pending-approvals:${pendingApprovals}`,
    ];
  } else if (record) {
    evidence = Object.entries(record)
      .slice(0, 5)
      .map(([entryKey, entryValue]) => `${entryKey}:${String(entryValue)}`);
  }

  return {
    key,
    summary,
    evidence,
    observedAt,
    runId,
    taskId,
    value: record,
  };
}

export function buildAgentCapabilityRuntimeEvidence(args: {
  agentId: string;
  orchestratorTask: string | null;
  support: AgentOperationalOverviewSupport;
  memory: AgentMemoryState | null;
}): AgentCapabilityRuntimeEvidence {
  const { agentId, orchestratorTask, support, memory } = args;
  const latestSuccessfulExecution = orchestratorTask
    ? support.latestSuccessfulExecutionByType.get(orchestratorTask) ?? null
    : null;
  const latestSuccessfulMemoryEntry = (memory?.taskTimeline ?? [])
    .filter((entry) => {
      if (
        orchestratorTask &&
        typeof entry.taskType === "string" &&
        entry.taskType.length > 0 &&
        entry.taskType !== orchestratorTask
      ) {
        return false;
      }
      return entry.status === "success" || entry.resultSummary?.success === true;
    })
    .sort((left, right) => {
      const leftTs = toTimestamp(left.completedAt ?? left.startedAt ?? "");
      const rightTs = toTimestamp(right.completedAt ?? right.startedAt ?? "");
      return rightTs - leftTs;
    })[0] ?? null;
  const memoryHighlights =
    latestSuccessfulMemoryEntry?.resultSummary?.highlights &&
    typeof latestSuccessfulMemoryEntry.resultSummary.highlights === "object"
      ? latestSuccessfulMemoryEntry.resultSummary.highlights
      : memory?.lastResultSummary?.highlights &&
          typeof memory.lastResultSummary.highlights === "object"
        ? memory.lastResultSummary.highlights
        : {};
  const highlights =
    latestSuccessfulExecution?.resultSummary?.highlights &&
    typeof latestSuccessfulExecution.resultSummary.highlights === "object"
      ? (latestSuccessfulExecution.resultSummary.highlights as Record<string, unknown>)
      : memoryHighlights;
  const highlightKeys = Object.keys(highlights);
  const preferredKeys = AGENT_CAPABILITY_RUNTIME_SIGNAL_KEYS[agentId] ?? [];
  const selectedKeys = preferredKeys.filter((key) => key in highlights);
  const latestHandledAt =
    latestSuccessfulExecution?.lastHandledAt ??
    latestSuccessfulMemoryEntry?.completedAt ??
    latestSuccessfulMemoryEntry?.startedAt ??
    memory?.taskPath?.lastSuccessfulAt ??
    null;
  const latestTaskId =
    latestSuccessfulExecution?.taskId ??
    latestSuccessfulMemoryEntry?.taskId ??
    (memory?.lastStatus === "success" ? memory.lastTaskId ?? null : null);

  return {
    latestSuccessfulRunId:
      latestSuccessfulExecution?.idempotencyKey ?? latestTaskId ?? null,
    latestSuccessfulTaskId: latestTaskId ?? null,
    latestHandledAt,
    highlightKeys,
    signals: selectedKeys.map((key) =>
      summarizeAgentCapabilityRuntimeSignal({
        agentId,
        key,
        value: highlights[key],
        observedAt: latestHandledAt,
        runId: latestSuccessfulExecution?.idempotencyKey ?? latestTaskId ?? null,
        taskId: latestTaskId ?? null,
      }),
    ),
  };
}

export function buildAgentCapabilityReadiness(args: {
  agent: {
    id: string;
    model?: { tier?: string | null };
    permissions?: { skills?: Record<string, { allowed: boolean }> };
  };
  orchestratorTask: string | null;
  spawnedWorkerCapable: boolean;
  serviceAvailable: boolean;
  serviceExpected: boolean;
  serviceInstalled: boolean | null;
  serviceRunning: boolean | null;
  memory: AgentMemoryState | null;
  workerEvidence: AgentWorkerEvidenceSummary;
  state: OrchestratorState;
  support: AgentOperationalOverviewSupport;
  runtimeProof: ReturnType<typeof buildAgentRuntimeProofSummary>;
  runtimeEvidence: AgentCapabilityRuntimeEvidence;
}) {
  const {
    agent,
    orchestratorTask,
    spawnedWorkerCapable,
    serviceAvailable,
    serviceExpected,
    serviceInstalled,
    serviceRunning,
    memory,
    workerEvidence,
    state,
    support,
    runtimeProof,
    runtimeEvidence,
  } = args;

  const target = AGENT_CAPABILITY_TARGETS[agent.id] ?? {
    role: "Specialized agent",
    spine: "execution" as AgentCapabilitySpine,
    targetCapabilities: ["runtime execution", "evidence grounding"],
  };
  const modelTier =
    typeof agent.model?.tier === "string" && agent.model.tier.length > 0
      ? agent.model.tier
      : null;
  const allowedSkills = Object.entries(agent.permissions?.skills ?? {})
    .filter(([, permission]) => permission.allowed)
    .map(([skillId]) => skillId);
  const memoryHasRun =
    runtimeProof.distinctions.taskObserved ||
    Boolean(memory?.lastRunAt) ||
    Number(memory?.totalRuns ?? 0) > 0;
  const verifiedRepairCount = orchestratorTask
    ? support.verifiedRepairCountByTaskType.get(orchestratorTask) ?? 0
    : 0;

  const evidence: string[] = [];
  const presentCapabilities: string[] = [];
  const missingCapabilities: string[] = [];
  const evidenceProfiles: AgentCapabilityEvidenceProfile[] = [];
  const preferredRuntimeSignalKeys = AGENT_CAPABILITY_RUNTIME_SIGNAL_KEYS[agent.id] ?? [];
  const runtimeSignals = Array.isArray(runtimeEvidence?.signals) ? runtimeEvidence.signals : [];
  const runtimeSignalSummaries = runtimeSignals.map((signal) => signal.summary);

  const countSuccessfulExecutionsForTypes = (taskTypes: string[]) =>
    taskTypes.reduce(
      (sum, taskType) =>
        sum + (support.successfulExecutionCountByType.get(taskType) ?? 0),
      0,
    );
  const countObservedRelationships = (
    fromAgentId: string,
    relationship: RelationshipObservationType,
  ) =>
    support.relationshipCountByAgentAndType.get(
      `agent:${fromAgentId}|${relationship}`,
    ) ?? 0;

  const observedToolExecutionCount = countObservedRelationships(
    agent.id,
    "invokes-tool",
  );
  const verificationRelationshipCount = countObservedRelationships(
    agent.id,
    "verifies-agent",
  );
  const verifierHandoffCount = countObservedRelationships(agent.id, "feeds-agent");
  const successfulTaskRuns = orchestratorTask
    ? countSuccessfulExecutionsForTypes([orchestratorTask])
    : 0;
  const effectiveSuccessfulTaskRuns = Math.max(
    successfulTaskRuns,
    Number(runtimeProof.taskPath.successfulRuns ?? 0),
  );
  const hasSuccessfulRuntimeEvidence =
    Boolean(workerEvidence.lastSuccessfulRunId) || runtimeProof.distinctions.taskSucceeded;
  const hasToolExecutionEvidence =
    workerEvidence.lastToolGateMode === "execute" || observedToolExecutionCount > 0;
  const hasVerificationOrRepairEvidence =
    verifiedRepairCount > 0 ||
    (agent.id === "qa-verification-agent" && verificationRelationshipCount > 0) ||
    (
      (
        agent.id === "build-refactor-agent" ||
        agent.id === "integration-agent" ||
        agent.id === "reddit-helper" ||
        agent.id === "content-agent" ||
        agent.id === "summarization-agent" ||
        agent.id === "data-extraction-agent" ||
        agent.id === "normalization-agent" ||
        agent.id === "market-research-agent"
      ) &&
      verifierHandoffCount > 0
    ) ||
      (
        (
          agent.id === "skill-audit-agent" ||
          agent.id === "security-agent" ||
          agent.id === "system-monitor-agent"
        ) &&
      effectiveSuccessfulTaskRuns > 0
    );

  const pushEvidenceProfile = (profile: AgentCapabilityEvidenceProfile) => {
    evidenceProfiles.push({
      ...profile,
      evidence: [...new Set(profile.evidence.filter(Boolean))],
      missing: [...new Set(profile.missing.filter(Boolean))],
    });
  };

  if (modelTier) {
    evidence.push(`model tier declared: ${modelTier}`);
    presentCapabilities.push("tiered model declaration");
  } else {
    missingCapabilities.push("tiered model declaration");
  }

  if (allowedSkills.length > 0) {
    evidence.push(`allowed skills: ${allowedSkills.join(", ")}`);
    presentCapabilities.push("governed skill access");
  } else {
    missingCapabilities.push("governed skill access");
  }

  if (spawnedWorkerCapable) {
    evidence.push("spawned worker entrypoint detected");
    presentCapabilities.push("spawned worker path");
  }
  if (serviceExpected && serviceAvailable) {
    evidence.push("service entrypoint detected");
    presentCapabilities.push("service entrypoint");
  }
  if (!spawnedWorkerCapable && !(serviceExpected && serviceAvailable)) {
    missingCapabilities.push("runtime execution path");
  }

  if (serviceInstalled === true) {
    evidence.push("service unit installed on host");
    presentCapabilities.push("host-installed service");
  }
  if (serviceRunning === true) {
    evidence.push("service unit running on host");
    presentCapabilities.push("live service coverage");
  } else if (serviceExpected) {
    missingCapabilities.push("live service coverage");
  }
  if (serviceExpected && runtimeProof.distinctions.serviceHeartbeatHealthy) {
    evidence.push("service heartbeat indicates healthy loop");
  } else if (serviceExpected && runtimeProof.serviceHeartbeat.checkedAt) {
    evidence.push(
      `service heartbeat indicates ${runtimeProof.serviceHeartbeat.status ?? "unknown"} loop`,
    );
  }

  if (hasSuccessfulRuntimeEvidence) {
    evidence.push(
      workerEvidence.lastSuccessfulRunId
        ? `successful run evidence: ${workerEvidence.lastSuccessfulRunId}`
        : "successful task-path proof exists in runtime memory",
    );
    presentCapabilities.push("successful runtime evidence");
  } else {
    missingCapabilities.push("successful runtime evidence");
  }

  if (hasToolExecutionEvidence) {
    evidence.push(
      workerEvidence.lastToolGateMode === "execute"
        ? "tool execution evidence observed"
        : `${observedToolExecutionCount} observed tool invocation relationship(s) recorded`,
    );
    presentCapabilities.push("tool execution evidence");
  } else if (workerEvidence.lastToolGateMode === "preflight") {
    evidence.push("tool preflight evidence observed");
    missingCapabilities.push("tool execution evidence");
  } else {
    missingCapabilities.push("tool execution evidence");
  }

  if (memoryHasRun) {
    evidence.push("agent memory has run history");
    presentCapabilities.push("memory-backed operational evidence");
  } else {
    missingCapabilities.push("memory-backed operational evidence");
  }

  if (hasVerificationOrRepairEvidence) {
    evidence.push(
      verifiedRepairCount > 0
        ? `${verifiedRepairCount} verified repair-linked run(s) observed`
        : agent.id === "qa-verification-agent"
          ? `${verificationRelationshipCount} verifier relationship(s) observed`
          : agent.id === "skill-audit-agent"
            ? `${successfulTaskRuns} successful governance verification run(s) observed`
            : agent.id === "security-agent"
              ? `${effectiveSuccessfulTaskRuns} successful trust-boundary verification run(s) observed`
              : agent.id === "system-monitor-agent"
                ? `${effectiveSuccessfulTaskRuns} successful monitoring closure run(s) observed`
                : `${verifierHandoffCount} downstream handoff relationship(s) observed`,
    );
    presentCapabilities.push("verification or repair evidence");
  } else {
    missingCapabilities.push("verification or repair evidence");
  }

  if (preferredRuntimeSignalKeys.length > 0 && runtimeSignals.length > 0) {
    evidence.push(
      `runtime readiness signals: ${runtimeSignals.map((signal) => signal.key).join(", ")}`,
    );
    presentCapabilities.push("promoted runtime readiness evidence");
  } else if (preferredRuntimeSignalKeys.length > 0) {
    missingCapabilities.push("promoted runtime readiness evidence");
  }

  const readiness =
    hasSuccessfulRuntimeEvidence &&
    allowedSkills.length > 0 &&
    (serviceRunning === true || memoryHasRun) &&
    hasToolExecutionEvidence
      ? ("advanced" as AgentCapabilityReadiness)
      : hasSuccessfulRuntimeEvidence &&
          allowedSkills.length > 0 &&
          (spawnedWorkerCapable || serviceAvailable)
        ? ("operational" as AgentCapabilityReadiness)
        : (modelTier || allowedSkills.length > 0) &&
            (spawnedWorkerCapable || serviceAvailable)
          ? ("foundation" as AgentCapabilityReadiness)
          : ("declared" as AgentCapabilityReadiness);

  const uniqueMissing = [...new Set(missingCapabilities)];

  if (agent.id === "doc-specialist") {
    const docRepairCount = state.repairRecords.filter(
      (record) =>
        record.classification === "doc-drift" && record.status === "verified",
    ).length;
    const docSpecialistRuns = countSuccessfulExecutionsForTypes([
      "drift-repair",
      "doc-sync",
    ]);
    const feedSignals = countObservedRelationships("doc-specialist", "feeds-agent");
    pushEvidenceProfile({
      area: "truth-spine-depth",
      status:
        docRepairCount > 0 && docSpecialistRuns > 0 && memoryHasRun && feedSignals > 0
          ? "strong"
          : docSpecialistRuns > 0 || memoryHasRun || feedSignals > 0
            ? "partial"
            : "missing",
      summary:
        docRepairCount > 0 || feedSignals > 0
          ? `${docRepairCount} verified doc-drift repair(s), ${docSpecialistRuns} successful doc-specialist aligned run(s), and ${feedSignals} observed knowledge hand-off(s) are recorded.`
          : "doc-specialist has limited verified truth-spine evidence so far.",
      evidence: [
        `verified doc-drift repairs: ${docRepairCount}`,
        `successful doc-specialist aligned runs: ${docSpecialistRuns}`,
        `observed feed relationships: ${feedSignals}`,
        memoryHasRun ? "memory-backed doc-specialist runs present" : "",
        ...runtimeSignalSummaries,
      ],
      missing:
        docRepairCount > 0 && feedSignals > 0 && runtimeSignals.length > 0
          ? []
          : [
              ...(docRepairCount > 0 ? [] : ["verified doc-drift repairs"]),
              ...(feedSignals > 0 ? [] : ["observed knowledge hand-off relationships"]),
              ...(runtimeSignals.length > 0
                ? []
                : ["promoted runtime readiness signals in readiness output"]),
            ],
    });
  }

  if (agent.id === "system-monitor-agent") {
    const systemMonitorRuns = Math.max(
      countSuccessfulExecutionsForTypes(["system-monitor"]),
      Number(runtimeProof.taskPath.successfulRuns ?? 0),
    );
    const proofSignals = support.proofSignalCount;
    const retrySignals = state.taskRetryRecoveries.length;
    const monitorSignals = countObservedRelationships(
      "system-monitor-agent",
      "monitors-agent",
    );
    pushEvidenceProfile({
      area: "trust-spine-depth",
      status:
        systemMonitorRuns > 0 && proofSignals > 0 && monitorSignals > 0
          ? "strong"
          : systemMonitorRuns > 0 || retrySignals > 0 || monitorSignals > 0
            ? "partial"
            : "missing",
      summary:
        proofSignals > 0 || monitorSignals > 0
          ? `system-monitor sees ${proofSignals} public-proof evidence record(s), ${retrySignals} retry recovery record(s), and ${monitorSignals} observed monitoring relationship(s).`
          : "system-monitor has only shallow trust-spine evidence right now.",
      evidence: [
        `successful monitoring runs: ${systemMonitorRuns}`,
        `public-proof evidence records: ${proofSignals}`,
        `retry recovery records: ${retrySignals}`,
        `observed monitoring relationships: ${monitorSignals}`,
        ...runtimeSignalSummaries,
      ],
      missing:
        proofSignals > 0 && monitorSignals > 0 && runtimeSignals.length > 0
          ? []
          : [
              ...(proofSignals > 0 ? [] : ["public-proof visibility"]),
              ...(monitorSignals > 0 ? [] : ["observed monitoring relationships"]),
              ...(runtimeSignals.length > 0
                ? []
                : ["promoted runtime readiness signals in readiness output"]),
            ],
    });
  }

  if (agent.id === "security-agent") {
    const securityRuns = Math.max(
      countSuccessfulExecutionsForTypes(["security-audit"]),
      Number(runtimeProof.taskPath.successfulRuns ?? 0),
    );
    const auditSignals = countObservedRelationships("security-agent", "audits-agent");
    pushEvidenceProfile({
      area: "operational-maturity",
      status:
        securityRuns > 0 &&
        workerEvidence.lastToolGateMode === "execute" &&
        auditSignals > 0
          ? "strong"
          : securityRuns > 0 || allowedSkills.length > 0 || auditSignals > 0
            ? "partial"
            : "missing",
      summary:
        securityRuns > 0 || auditSignals > 0
          ? `${securityRuns} successful security audit run(s), governed skill evidence, and ${auditSignals} observed audit relationship(s) are present.`
          : "security-agent has declared policy posture but limited successful audit evidence.",
      evidence: [
        `successful security runs: ${securityRuns}`,
        `observed audit relationships: ${auditSignals}`,
        workerEvidence.lastToolGateMode
          ? `latest tool gate mode: ${workerEvidence.lastToolGateMode}`
          : "",
        ...runtimeSignalSummaries,
      ],
      missing:
        securityRuns > 0 && auditSignals > 0 && runtimeSignals.length > 0
          ? []
          : [
              ...(securityRuns > 0
                ? []
                : ["successful security-audit execution evidence"]),
              ...(auditSignals > 0 ? [] : ["observed audit relationships"]),
              ...(runtimeSignals.length > 0
                ? []
                : ["promoted runtime readiness signals in readiness output"]),
            ],
    });
  }

  if (agent.id === "skill-audit-agent") {
    const governanceRuns = Math.max(
      countSuccessfulExecutionsForTypes(["skill-audit"]),
      Number(runtimeProof.taskPath.successfulRuns ?? 0),
    );
    const governedSkillCount = support.governedSkillCounts.total;
    const pendingReviewCount = support.governedSkillCounts.pendingReview;
    const restartSafeCount = support.governedSkillCounts.restartSafe;
    const metadataOnlyCount = support.governedSkillCounts.metadataOnly;
    pushEvidenceProfile({
      area: "governance-depth",
      status:
        governanceRuns > 0 && governedSkillCount > 0 && runtimeSignals.length >= 3
          ? "strong"
          : governanceRuns > 0 || governedSkillCount > 0 || runtimeSignals.length > 0
            ? "partial"
            : "missing",
      summary:
        governedSkillCount > 0 || governanceRuns > 0
          ? `skill-audit records ${governanceRuns} successful governance run(s), ${governedSkillCount} governed skill record(s), ${pendingReviewCount} pending review, and ${restartSafeCount} restart-safe registration(s).`
          : "skill-audit has not yet produced durable governance-depth evidence.",
      evidence: [
        `successful governance runs: ${governanceRuns}`,
        `governed skill records: ${governedSkillCount}`,
        `pending review records: ${pendingReviewCount}`,
        `restart-safe records: ${restartSafeCount}`,
        `metadata-only records: ${metadataOnlyCount}`,
        ...runtimeSignalSummaries,
      ],
      missing:
        governanceRuns > 0 && governedSkillCount > 0 && runtimeSignals.length >= 3
          ? []
          : [
              ...(governanceRuns > 0 ? [] : ["successful skill-audit runs"]),
              ...(governedSkillCount > 0 ? [] : ["governed skill state records"]),
              ...(runtimeSignals.length >= 3
                ? []
                : ["promoted trust posture, policy handoff, and telemetry handoff"]),
            ],
    });
  }

  if (agent.id === "deployment-ops-agent") {
    const deploymentOpsRuns = countSuccessfulExecutionsForTypes(["deployment-ops"]);
    pushEvidenceProfile({
      area: "deployment-governance-depth",
      status:
        deploymentOpsRuns > 0 && runtimeSignals.length >= 1
          ? "strong"
          : deploymentOpsRuns > 0 || runtimeSignals.length > 0
            ? "partial"
            : "missing",
      summary:
        deploymentOpsRuns > 0 || runtimeSignals.length > 0
          ? `${deploymentOpsRuns} successful deployment-ops run(s) and ${runtimeSignals.length} promoted deployment posture signal(s) support deployment-governance depth.`
          : "deployment-ops has not yet produced promoted deployment-governance evidence.",
      evidence: [
        `successful deployment-ops runs: ${deploymentOpsRuns}`,
        ...runtimeSignalSummaries,
      ],
      missing:
        deploymentOpsRuns > 0 && runtimeSignals.length >= 1
          ? []
          : [
              ...(deploymentOpsRuns > 0 ? [] : ["successful deployment-ops runs"]),
              ...(runtimeSignals.length >= 1
                ? []
                : ["promoted deployment posture, rollback posture, and drift guidance"]),
            ],
    });
  }

  if (agent.id === "build-refactor-agent") {
    const buildRefactorRuns = countSuccessfulExecutionsForTypes(["build-refactor"]);
    const toolSignals = countObservedRelationships(
      "build-refactor-agent",
      "invokes-tool",
    );
    const verifierHandoffs = countObservedRelationships(
      "build-refactor-agent",
      "feeds-agent",
    );
    pushEvidenceProfile({
      area: "code-governance-depth",
      status:
        buildRefactorRuns > 0 && toolSignals > 0 && runtimeSignals.length >= 3
          ? "strong"
          : buildRefactorRuns > 0 || toolSignals > 0 || runtimeSignals.length > 0
            ? "partial"
            : "missing",
      summary:
        buildRefactorRuns > 0 || verifierHandoffs > 0
          ? `${buildRefactorRuns} successful build-refactor run(s), ${toolSignals} observed tool invocation(s), and ${verifierHandoffs} verifier handoff relationship(s) support build-refactor governance depth.`
          : "build-refactor has not yet produced promoted code-governance evidence.",
      evidence: [
        `successful build-refactor runs: ${buildRefactorRuns}`,
        `observed tool invocations: ${toolSignals}`,
        `observed verifier handoffs: ${verifierHandoffs}`,
        ...runtimeSignalSummaries,
      ],
      missing:
        buildRefactorRuns > 0 && toolSignals > 0 && runtimeSignals.length >= 3
          ? []
          : [
              ...(buildRefactorRuns > 0
                ? []
                : ["successful build-refactor execution evidence"]),
              ...(toolSignals > 0 ? [] : ["observed code-surgery tool invocations"]),
              ...(runtimeSignals.length >= 3
                ? []
                : ["promoted scope contract, surgery profile, and verification loop"]),
            ],
    });
  }

  if (agent.id === "qa-verification-agent") {
    const qaRuns = countSuccessfulExecutionsForTypes(["qa-verification"]);
    const verificationSignals = countObservedRelationships(
      "qa-verification-agent",
      "verifies-agent",
    );
    pushEvidenceProfile({
      area: "operational-maturity",
      status:
        qaRuns > 0 && verificationSignals > 0 && runtimeSignals.length > 0
          ? "strong"
          : qaRuns > 0 || verifiedRepairCount > 0 || verificationSignals > 0
            ? "partial"
            : "missing",
      summary:
        qaRuns > 0 || verificationSignals > 0 || verifiedRepairCount > 0
          ? `${qaRuns} successful qa-verification run(s), ${verificationSignals} observed verification relationship(s), and ${verifiedRepairCount} repair-linked verification record(s) support qa-verification maturity.`
          : "qa-verification has limited repair-linked evidence so far.",
      evidence: [
        `successful qa-verification runs: ${qaRuns}`,
        `verified repair-linked runs: ${verifiedRepairCount}`,
        `observed verification relationships: ${verificationSignals}`,
        ...runtimeSignalSummaries,
      ],
      missing:
        qaRuns > 0 && verificationSignals > 0 && runtimeSignals.length > 0
          ? []
          : [
              ...(qaRuns > 0 ? [] : ["successful qa-verification runs"]),
              ...(verificationSignals > 0
                ? []
                : ["observed verification relationships"]),
              ...(runtimeSignals.length > 0
                ? []
                : ["promoted runtime readiness signals in readiness output"]),
            ],
    });
  }

  if (agent.id === "integration-agent") {
    const integrationRuns = countSuccessfulExecutionsForTypes([
      "integration-workflow",
    ]);
    const coordinationSignals = support.integrationWorkflowAgentStageCount;
    const coordinationEdges = countObservedRelationships(
      "integration-agent",
      "coordinates-agent",
    );
    pushEvidenceProfile({
      area: "operational-maturity",
      status:
        integrationRuns > 0 && coordinationSignals > 0 && coordinationEdges > 0
          ? "strong"
          : integrationRuns > 0 || coordinationSignals > 0 || coordinationEdges > 0
            ? "partial"
            : "missing",
      summary:
        coordinationSignals > 0 || coordinationEdges > 0
          ? `${coordinationSignals} workflow coordination signal(s) and ${coordinationEdges} observed coordination relationship(s) were emitted for integration-workflow runs.`
          : "integration-agent is still light on observed workflow-conductor evidence.",
      evidence: [
        `successful integration-workflow runs: ${integrationRuns}`,
        `workflow coordination signals: ${coordinationSignals}`,
        `observed coordination relationships: ${coordinationEdges}`,
        ...runtimeSignalSummaries,
      ],
      missing:
        coordinationSignals > 0 && coordinationEdges > 0 && runtimeSignals.length > 0
          ? []
          : [
              ...(coordinationSignals > 0
                ? []
                : ["observed workflow coordination signals"]),
              ...(coordinationEdges > 0
                ? []
                : ["observed coordination relationships"]),
              ...(runtimeSignals.length > 0
                ? []
                : ["promoted runtime readiness signals in readiness output"]),
            ],
    });
  }

  return {
    role: target.role,
    spine: target.spine,
    currentReadiness: readiness,
    targetCapabilities: target.targetCapabilities,
    evidence,
    presentCapabilities: [...new Set(presentCapabilities)],
    missingCapabilities: uniqueMissing,
    evidenceProfiles,
    runtimeEvidence,
    ultraGapSummary:
      uniqueMissing.length > 0
        ? `${uniqueMissing.length} capability gap${uniqueMissing.length === 1 ? "" : "s"} remain before this agent can be treated as ultra-capable in-role.`
        : "Runtime evidence covers the current ultra-agent target checks exposed by the control plane.",
  };
}

type HostServiceUnitState = {
  id: string;
  loadState: string | null;
  activeState: string | null;
  subState: string | null;
  unitFileState: string | null;
};

type CachedHostServiceStates = {
  expiresAt: number;
  states: Map<string, HostServiceUnitState>;
};

type AgentOperationalOverviewSupport = {
  latestExecutionByType: Map<string, OrchestratorState["taskExecutions"][number]>;
  successfulExecutionCountByType: Map<string, number>;
  latestSuccessfulExecutionByType: Map<
    string,
    OrchestratorState["taskExecutions"][number]
  >;
  latestToolInvocationByAgent: Map<string, ToolInvocation>;
  latestAllowedPreflightByAgent: Map<string, ToolInvocation>;
  latestAllowedExecuteByAgent: Map<string, ToolInvocation>;
  relationshipCountByAgentAndType: Map<string, number>;
  verifiedRepairCountByTaskType: Map<string, number>;
  proofSignalCount: number;
  integrationWorkflowAgentStageCount: number;
  governedSkillCounts: {
    total: number;
    pendingReview: number;
    restartSafe: number;
    metadataOnly: number;
  };
};

type AgentOperationalOverviewItem = {
  id: string;
  name: string;
  description: string | null;
  orchestratorTask: string | null;
  modelTier: string | null;
  allowedSkills: string[];
  declared: boolean;
  spawnedWorkerCapable: boolean;
  workerValidationStatus: AgentWorkerEvidenceSummary["workerValidationStatus"];
  lastEvidenceAt: string | null;
  evidenceSources: string[];
  lastSuccessfulRunId: string | null;
  lastSuccessfulTaskId: string | null;
  lastToolGateMode: string | null;
  lastToolGateSkillId: string | null;
  serviceAvailable: boolean;
  serviceExpected: boolean;
  lifecycleMode: AgentLifecycleMode;
  hostServiceStatus: HostServiceStatus;
  serviceUnitName: string | null;
  serviceInstalled: boolean | null;
  serviceRunning: boolean | null;
  serviceUnitState: string | null;
  serviceUnitSubState: string | null;
  serviceUnitFileState: string | null;
  serviceImplementation: boolean;
  serviceOperational: boolean;
  dependencySensitivity: AgentDependencySensitivity;
  frontendExposure: AgentFrontendExposure;
  runtimeProof: ReturnType<typeof buildAgentRuntimeProofSummary>;
  capability: ReturnType<typeof buildAgentCapabilityReadiness>;
  memory: {
    lastRunAt: string | null;
    lastStatus: string | null;
    totalRuns: number;
    successCount: number;
    errorCount: number;
  } | null;
  notes: string[];
};

type CachedAgentOperationalOverview = {
  expiresAt: number;
  key: string;
  value: AgentOperationalOverviewItem[];
};

type PendingAgentOperationalOverview = {
  key: string;
  promise: Promise<AgentOperationalOverviewItem[]>;
};

type CachedPathExists = {
  exists: boolean;
  expiresAt: number;
};

const SERVICE_STATE_PROBE_TTL_MS = 60_000;
const AGENT_OVERVIEW_TTL_MS = 60_000;
const PATH_EXISTS_CACHE_TTL_MS = 60_000;
let cachedHostServiceStates: CachedHostServiceStates | null = null;
let cachedAgentOperationalOverview: CachedAgentOperationalOverview | null = null;
let pendingAgentOperationalOverview: PendingAgentOperationalOverview | null = null;
let agentOperationalOverviewWarmTimer: NodeJS.Timeout | null = null;
const cachedPathExists = new Map<string, CachedPathExists>();

function getAgentServiceUnitName(agentId: string) {
  return `${agentId}.service`;
}

const REQUIRED_SERVICE_AGENT_IDS = new Set([
  "doc-specialist",
  "reddit-helper",
]);

export type AgentLifecycleMode = "service-expected" | "worker-first";

export type HostServiceStatus =
  | "running"
  | "installed-stopped"
  | "not-installed"
  | "probe-unavailable"
  | "missing-entrypoint"
  | "not-applicable";

export function isServiceModeExpected(agentId: string) {
  return REQUIRED_SERVICE_AGENT_IDS.has(agentId);
}

export function resolveAgentLifecycleMode(agentId: string): AgentLifecycleMode {
  return isServiceModeExpected(agentId) ? "service-expected" : "worker-first";
}

export function resolveHostServiceStatus(args: {
  serviceExpected: boolean;
  serviceAvailable: boolean;
  serviceInstalled: boolean | null;
  serviceRunning: boolean | null;
}): HostServiceStatus {
  const { serviceExpected, serviceAvailable, serviceInstalled, serviceRunning } = args;

  if (!serviceExpected) {
    return "not-applicable";
  }
  if (!serviceAvailable) {
    return "missing-entrypoint";
  }
  if (serviceRunning === true) {
    return "running";
  }
  if (serviceInstalled === true) {
    return "installed-stopped";
  }
  if (serviceInstalled === false) {
    return "not-installed";
  }
  return "probe-unavailable";
}

export function parseSystemctlShowOutput(raw: string) {
  const states = new Map<string, HostServiceUnitState>();
  const blocks = raw
    .trim()
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const record: HostServiceUnitState = {
      id: "",
      loadState: null,
      activeState: null,
      subState: null,
      unitFileState: null,
    };

    for (const line of block.split(/\r?\n/)) {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex);
      const value = line.slice(separatorIndex + 1) || null;

      switch (key) {
        case "Id":
          record.id = value ?? "";
          break;
        case "LoadState":
          record.loadState = value;
          break;
        case "ActiveState":
          record.activeState = value;
          break;
        case "SubState":
          record.subState = value;
          break;
        case "UnitFileState":
          record.unitFileState = value;
          break;
        default:
          break;
      }
    }

    if (record.id) {
      states.set(record.id, record);
    }
  }

  return states;
}

export function resolveServiceInstalledState(
  unitState: HostServiceUnitState | null | undefined,
) {
  if (!unitState) {
    return null as boolean | null;
  }
  if (unitState.loadState === "not-found") {
    return false;
  }
  if (unitState.loadState) {
    return true;
  }
  return null as boolean | null;
}

export function resolveServiceRunningState(
  unitState: HostServiceUnitState | null | undefined,
) {
  if (!unitState) {
    return null as boolean | null;
  }
  if (unitState.loadState === "not-found") {
    return false;
  }
  if (unitState.activeState === "active") {
    return true;
  }
  if (unitState.activeState) {
    return false;
  }
  return null as boolean | null;
}

function getHostServiceStates(agentIds: string[]) {
  const now = Date.now();
  if (cachedHostServiceStates && cachedHostServiceStates.expiresAt > now) {
    return cachedHostServiceStates.states;
  }

  if (process.platform !== "linux") {
    return null as Map<string, HostServiceUnitState> | null;
  }

  const unitNames = agentIds.map((agentId) => getAgentServiceUnitName(agentId));
  try {
    const systemctlArgs = buildHostSystemctlShowArgs(unitNames);
    const raw = execFileSync(
      "systemctl",
      systemctlArgs,
      {
        encoding: "utf-8",
        timeout: 1500,
        maxBuffer: 1024 * 1024,
      },
    );
    const states = parseSystemctlShowOutput(raw);
    cachedHostServiceStates = {
      expiresAt: now + SERVICE_STATE_PROBE_TTL_MS,
      states,
    };
    return states;
  } catch (error) {
    const raw =
      error && typeof error === "object" && "stdout" in error
        ? String((error as { stdout?: string }).stdout ?? "")
        : "";
    if (!raw.trim()) {
      return null as Map<string, HostServiceUnitState> | null;
    }
    const states = parseSystemctlShowOutput(raw);
    cachedHostServiceStates = {
      expiresAt: now + SERVICE_STATE_PROBE_TTL_MS,
      states,
    };
    return states;
  }
}

export function buildHostSystemctlShowArgs(unitNames: string[]) {
  return [
    "--user",
    "show",
    ...unitNames,
    "--property=Id,LoadState,ActiveState,SubState,UnitFileState",
    "--no-pager",
  ];
}

function buildAgentOperationalOverviewSupport(
  state: OrchestratorState,
  toolInvocations: ToolInvocation[],
): AgentOperationalOverviewSupport {
  const latestExecutionByType = new Map<
    string,
    OrchestratorState["taskExecutions"][number]
  >();
  const successfulExecutionCountByType = new Map<string, number>();
  const latestSuccessfulExecutionByType = new Map<
    string,
    OrchestratorState["taskExecutions"][number]
  >();
  for (const execution of state.taskExecutions) {
    const latestExecution = latestExecutionByType.get(execution.type);
    if (
      !latestExecution ||
      execution.lastHandledAt.localeCompare(latestExecution.lastHandledAt) > 0
    ) {
      latestExecutionByType.set(execution.type, execution);
    }

    if (execution.status === "success") {
      successfulExecutionCountByType.set(
        execution.type,
        (successfulExecutionCountByType.get(execution.type) ?? 0) + 1,
      );
      const latest = latestSuccessfulExecutionByType.get(execution.type);
      if (!latest || execution.lastHandledAt.localeCompare(latest.lastHandledAt) > 0) {
        latestSuccessfulExecutionByType.set(execution.type, execution);
      }
    }
  }

  const latestToolInvocationByAgent = new Map<string, ToolInvocation>();
  const latestAllowedPreflightByAgent = new Map<string, ToolInvocation>();
  const latestAllowedExecuteByAgent = new Map<string, ToolInvocation>();
  for (const invocation of toolInvocations) {
    const latestInvocation = latestToolInvocationByAgent.get(invocation.agentId);
    if (
      !latestInvocation ||
      invocation.timestamp.localeCompare(latestInvocation.timestamp) > 0
    ) {
      latestToolInvocationByAgent.set(invocation.agentId, invocation);
    }

    if (!invocation.allowed) {
      continue;
    }
    const mode = resolveToolInvocationMode(invocation);
    if (mode === "preflight") {
      const latestPreflight = latestAllowedPreflightByAgent.get(invocation.agentId);
      if (
        !latestPreflight ||
        invocation.timestamp.localeCompare(latestPreflight.timestamp) > 0
      ) {
        latestAllowedPreflightByAgent.set(invocation.agentId, invocation);
      }
    }
    if (mode === "execute") {
      const latestExecute = latestAllowedExecuteByAgent.get(invocation.agentId);
      if (
        !latestExecute ||
        invocation.timestamp.localeCompare(latestExecute.timestamp) > 0
      ) {
        latestAllowedExecuteByAgent.set(invocation.agentId, invocation);
      }
    }
  }

  const relationshipCountByAgentAndType = new Map<string, number>();
  let proofSignalCount = 0;
  for (const observation of state.relationshipObservations ?? []) {
    const key = `${observation.from}|${observation.relationship}`;
    relationshipCountByAgentAndType.set(
      key,
      (relationshipCountByAgentAndType.get(key) ?? 0) + 1,
    );
    if (
      observation.proofTransport === "milestone" ||
      observation.proofTransport === "demandSummary" ||
      observation.relationship === "publishes-proof" ||
      observation.relationship === "transitions-proof"
    ) {
      proofSignalCount += 1;
    }
  }

  let integrationWorkflowAgentStageCount = 0;
  for (const event of state.workflowEvents) {
    if (
      event.stage === "proof" ||
      event.proofTransport === "milestone" ||
      event.proofTransport === "demandSummary"
    ) {
      proofSignalCount += 1;
    }
    if (event.stage === "agent" && event.type === "integration-workflow") {
      integrationWorkflowAgentStageCount += 1;
    }
  }

  const verifiedRepairCountByTaskType = new Map<string, number>();
  const incrementVerifiedRepair = (taskType: string | null | undefined) => {
    if (!taskType) return;
    verifiedRepairCountByTaskType.set(
      taskType,
      (verifiedRepairCountByTaskType.get(taskType) ?? 0) + 1,
    );
  };
  for (const record of state.repairRecords) {
    if (record.status !== "verified") continue;
    incrementVerifiedRepair(record.repairTaskType);
    if (record.sourceTaskType !== record.repairTaskType) {
      incrementVerifiedRepair(record.sourceTaskType);
    }
  }

  let pendingReview = 0;
  let restartSafe = 0;
  let metadataOnly = 0;
  for (const skill of state.governedSkillState) {
    if (skill.trustStatus === "pending-review") pendingReview += 1;
    if (skill.persistenceMode === "restart-safe") restartSafe += 1;
    if (skill.persistenceMode === "metadata-only") metadataOnly += 1;
  }

  return {
    latestExecutionByType,
    successfulExecutionCountByType,
    latestSuccessfulExecutionByType,
    latestToolInvocationByAgent,
    latestAllowedPreflightByAgent,
    latestAllowedExecuteByAgent,
    relationshipCountByAgentAndType,
    verifiedRepairCountByTaskType,
    proofSignalCount,
    integrationWorkflowAgentStageCount,
    governedSkillCounts: {
      total: state.governedSkillState.length,
      pendingReview,
      restartSafe,
      metadataOnly,
    },
  };
}

function buildAgentOperationalOverviewCacheKey(
  state: OrchestratorState,
  toolInvocationCount: number,
) {
  return [
    state.updatedAt ?? "never",
    state.taskExecutions.length,
    state.repairRecords.length,
    state.relationshipObservations.length,
    state.workflowEvents.length,
    state.governedSkillState.length,
    toolInvocationCount,
  ].join("|");
}

export async function buildAgentOperationalOverview(
  state: OrchestratorState,
): Promise<AgentOperationalOverviewItem[]> {
  const registry = await getAgentRegistry();
  const gate = await getToolGate();
  const toolInvocations = gate.getLog().invocations;
  const cacheKey = buildAgentOperationalOverviewCacheKey(
    state,
    toolInvocations.length,
  );
  const now = Date.now();
  if (
    cachedAgentOperationalOverview &&
    cachedAgentOperationalOverview.expiresAt > now &&
    cachedAgentOperationalOverview.key === cacheKey
  ) {
    return cachedAgentOperationalOverview.value;
  }

  if (pendingAgentOperationalOverview?.key === cacheKey) {
    return pendingAgentOperationalOverview.promise;
  }

  const overviewPromise = (async () => {
    const support = buildAgentOperationalOverviewSupport(state, toolInvocations);
    const agents = registry.listAgents();
    const baseAgentsPath = join(process.cwd(), "..", "agents");
    const hostServiceStates = getHostServiceStates(agents.map((agent) => agent.id));

    const overview = await Promise.all(
      agents.map(async (agent) => {
        const typedAgent = agent as typeof agent & {
          orchestratorTask?: string;
          serviceStatePath?: string;
        };
        const agentRoot = join(baseAgentsPath, typedAgent.id);
        const indexEntryPath = join(agentRoot, "src", "index.ts");
        const serviceEntryPath = join(agentRoot, "src", "service.ts");
        const resolvedServiceStatePath =
          typeof typedAgent.serviceStatePath === "string" &&
          typedAgent.serviceStatePath.length > 0
            ? resolve(agentRoot, typedAgent.serviceStatePath)
            : null;

        const [spawnedWorkerCapable, serviceImplementation, memory] = await Promise.all([
          pathExists(indexEntryPath),
          pathExists(serviceEntryPath),
          loadAgentMemoryState(typedAgent.id, resolvedServiceStatePath),
        ]);

        const workerEvidence = deriveWorkerEvidenceSummary({
          agentId: typedAgent.id,
          spawnedWorkerCapable,
          orchestratorTask:
            typeof typedAgent.orchestratorTask === "string"
              ? typedAgent.orchestratorTask
              : null,
          memory,
          support,
        });
        const serviceAvailable = serviceImplementation;
        const serviceExpected = isServiceModeExpected(typedAgent.id);
        const lifecycleMode = resolveAgentLifecycleMode(typedAgent.id);
        const unitName = getAgentServiceUnitName(typedAgent.id);
        const hostUnitState = hostServiceStates?.get(unitName) ?? null;
        const serviceInstalled = resolveServiceInstalledState(hostUnitState);
        const serviceRunning = resolveServiceRunningState(hostUnitState);
        const hostServiceStatus = resolveHostServiceStatus({
          serviceExpected,
          serviceAvailable,
          serviceInstalled,
          serviceRunning,
        });
        const serviceOperational = serviceRunning === true;
        const serviceUnitName = serviceExpected || serviceAvailable ? unitName : null;
        const allowedSkills = registry.getAllowedSkills(typedAgent.id);
        const dependencySensitivity = resolveDependencySensitivity(typedAgent.id);
        const frontendExposure = resolveAgentFrontendExposure(
          workerEvidence.workerValidationStatus,
          serviceAvailable,
          spawnedWorkerCapable,
        );
        const orchestratorTask =
          typeof typedAgent.orchestratorTask === "string"
            ? typedAgent.orchestratorTask
            : null;
        const verifiedRepairCount = orchestratorTask
          ? support.verifiedRepairCountByTaskType.get(orchestratorTask) ?? 0
          : 0;
        const runtimeProof = buildAgentRuntimeProofSummary({
          orchestratorTask,
          spawnedWorkerCapable,
          serviceAvailable,
          serviceExpected,
          serviceInstalled,
          serviceRunning,
          memory,
          workerEvidence,
          verifiedRepairCount,
        });
        const runtimeEvidence = buildAgentCapabilityRuntimeEvidence({
          agentId: typedAgent.id,
          orchestratorTask,
          support,
          memory,
        });
        const capability = buildAgentCapabilityReadiness({
          agent: typedAgent,
          orchestratorTask,
          spawnedWorkerCapable,
          serviceAvailable,
          serviceExpected,
          serviceInstalled,
          serviceRunning,
          memory,
          workerEvidence,
          state,
          support,
          runtimeProof,
          runtimeEvidence,
        });

        const notes: string[] = [];
        if (serviceExpected && !serviceAvailable) {
          notes.push("Expected long-running service implementation is missing (src/service.ts not found).");
        }
        if (!serviceExpected && spawnedWorkerCapable) {
          notes.push("Worker-first lane runs on demand through the orchestrator; host service installation is not required.");
        }
        if (serviceExpected && serviceInstalled === false) {
          notes.push("Service entrypoint exists, but no installed systemd unit was found on this host.");
        }
        if (serviceExpected && serviceInstalled === true && serviceRunning !== true) {
          const stateLabel = [hostUnitState?.activeState, hostUnitState?.subState]
            .filter((value): value is string => typeof value === "string" && value.length > 0)
            .join("/");
          notes.push(
            `Service unit is installed but not running${stateLabel ? ` (${stateLabel})` : ""}.`,
          );
        }
        if (serviceExpected && serviceInstalled === null && serviceRunning !== true) {
          notes.push("Service entrypoint exists, but running state is not host-proven by the orchestrator.");
        }
        if (!spawnedWorkerCapable) {
          notes.push("Spawned worker entrypoint missing (src/index.ts not found).");
        }
        if (workerEvidence.workerValidationStatus === "not-yet-verified") {
          notes.push("Spawned-worker path is declared but not yet verified in latest validation sweep.");
        }
        if (workerEvidence.workerValidationStatus === "partial-worker") {
          notes.push("Worker path exists but is currently partial/degraded.");
        }
        if (
          runtimeProof.distinctions.serviceHeartbeatHealthy &&
          !runtimeProof.distinctions.taskObserved
        ) {
          notes.push("Service heartbeat is healthy, but no orchestrated task-path evidence exists yet.");
        }
        if (
          runtimeProof.distinctions.serviceHeartbeatHealthy &&
          !runtimeProof.distinctions.taskSucceeded &&
          runtimeProof.distinctions.taskObserved
        ) {
          notes.push("Service heartbeat is healthy, but recent orchestrated task-path evidence is failing or incomplete.");
        }

        return {
          id: typedAgent.id,
          name: typedAgent.name,
          description:
            typeof typedAgent.description === "string"
              ? typedAgent.description
              : null,
          orchestratorTask:
            typeof typedAgent.orchestratorTask === "string"
              ? typedAgent.orchestratorTask
              : null,
          modelTier:
            typeof typedAgent.model?.tier === "string" ? typedAgent.model.tier : null,
          allowedSkills,
          declared: true,
          spawnedWorkerCapable,
          workerValidationStatus: workerEvidence.workerValidationStatus,
          lastEvidenceAt: workerEvidence.lastEvidenceAt,
          evidenceSources: workerEvidence.evidenceSources,
          lastSuccessfulRunId: workerEvidence.lastSuccessfulRunId,
          lastSuccessfulTaskId: workerEvidence.lastSuccessfulTaskId,
          lastToolGateMode: workerEvidence.lastToolGateMode,
          lastToolGateSkillId: workerEvidence.lastToolGateSkillId,
          serviceAvailable,
          serviceExpected,
          lifecycleMode,
          hostServiceStatus,
          serviceUnitName,
          serviceInstalled,
          serviceRunning,
          serviceUnitState: hostUnitState?.activeState ?? null,
          serviceUnitSubState: hostUnitState?.subState ?? null,
          serviceUnitFileState: hostUnitState?.unitFileState ?? null,
          serviceImplementation,
          serviceOperational,
          dependencySensitivity,
          frontendExposure,
          runtimeProof,
          capability,
          memory: memory
            ? {
                lastRunAt: memory.lastRunAt ?? null,
                lastStatus: memory.lastStatus ?? null,
                totalRuns: Number(memory.totalRuns ?? 0),
                successCount: Number(memory.successCount ?? 0),
                errorCount: Number(memory.errorCount ?? 0),
              }
            : null,
          notes,
        };
      }),
    );

    cachedAgentOperationalOverview = {
      expiresAt: now + AGENT_OVERVIEW_TTL_MS,
      key: cacheKey,
      value: overview,
    };

    return overview;
  })();

  pendingAgentOperationalOverview = {
    key: cacheKey,
    promise: overviewPromise,
  };

  try {
    return await overviewPromise;
  } finally {
    if (pendingAgentOperationalOverview?.key === cacheKey) {
      pendingAgentOperationalOverview = null;
    }
  }
}

function scheduleAgentOperationalOverviewWarm(
  state: OrchestratorState,
  delayMs: number = 250,
) {
  if (agentOperationalOverviewWarmTimer) {
    clearTimeout(agentOperationalOverviewWarmTimer);
  }
  agentOperationalOverviewWarmTimer = setTimeout(() => {
    agentOperationalOverviewWarmTimer = null;
    void buildAgentOperationalOverview(state).catch((error) => {
      console.warn(
        `[orchestrator] failed to warm agent operational overview cache: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }, delayMs);
  agentOperationalOverviewWarmTimer.unref?.();
}

function buildTaskTelemetryOverlay(state: OrchestratorState, taskType: string) {
  const executions = state.taskExecutions.filter((item) => item.type === taskType);
  const total = executions.length;
  const success = executions.filter((item) => item.status === "success").length;
  const failed = executions.filter((item) => item.status === "failed").length;
  const retrying = executions.filter((item) => item.status === "retrying").length;

  return {
    totalRuns: total,
    successRate: total > 0 ? Number((success / total).toFixed(4)) : null,
    failureRate: total > 0 ? Number((failed / total).toFixed(4)) : null,
    retryingCount: retrying,
    latencyVarianceMs: null,
    driftSignals: retrying > 0 || failed > 0,
  };
}

function buildOperatorTaskCatalog(
  config: Awaited<ReturnType<typeof loadConfig>>,
  state: OrchestratorState,
) {
  const approvalRequired = new Set(
    (config.approvalRequiredTaskTypes ?? ["agent-deploy", "build-refactor"]).map(
      (taskType) => String(taskType),
    ),
  );
  const profileByType = new Map(
    OPERATOR_TASK_PROFILES.map((profile) => [profile.type, profile]),
  );

  return ALLOWED_TASK_TYPES.map((taskType) => {
    const profile = profileByType.get(taskType);
    if (!profile) {
      const internalOnly = isInternalTaskType(taskType);
      return {
        type: taskType,
        label: taskType,
        purpose: internalOnly
          ? "Internal runtime maintenance task."
          : "Runtime allowlisted task pending explicit operator classification.",
        internalOnly,
        publicTriggerable: false,
        approvalGated: approvalRequired.has(taskType),
        operationalStatus: internalOnly ? ("confirmed-working" as const) : ("unconfirmed" as const),
        dependencyClass: internalOnly ? ("control-plane" as const) : ("worker" as const),
        baselineConfidence: "low" as const,
        dependencyRequirements: [],
        exposeInV1: false,
        caveats: [
          internalOnly
            ? "Internal-only task. Keep it out of normal operator launch surfaces."
            : "No operator-facing classification recorded yet. Add an explicit task profile before exposing it publicly.",
        ],
        telemetryOverlay: buildTaskTelemetryOverlay(state, taskType),
      };
    }

    return {
      ...profile,
      approvalGated: profile.approvalGated || approvalRequired.has(taskType),
      telemetryOverlay: buildTaskTelemetryOverlay(state, taskType),
    };
  });
}

function buildDashboardMaintenanceChecks(state: OrchestratorState) {
  return [...(state.maintenanceChecks ?? [])]
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((record) => ({
      id: record.id,
      label: record.label,
      taskType: record.taskType,
      intervalMinutes: record.intervalMinutes,
      lastCheckedAt: record.lastCheckedAt ?? null,
      lastActionQueuedAt: record.lastActionQueuedAt ?? null,
      nextDueAt: record.nextDueAt ?? null,
      status: record.status,
      summary: record.summary,
      actionQueued: record.actionQueued === true,
      lastTaskId: record.lastTaskId ?? null,
      lastRunId: record.lastRunId ?? null,
      latestObservedRunAt: record.latestObservedRunAt ?? null,
      latestObservedRunStatus: record.latestObservedRunStatus ?? null,
    }));
}

function buildCompanionControlPlaneMode(args: {
  openIncidentCount: number;
  criticalIncidentCount: number;
  pendingApprovalsCount: number;
  queueQueued: number;
  queueProcessing: number;
  proofStatus: "healthy" | "watching" | "degraded";
  dominantClassification: string | null;
}) {
  if (args.criticalIncidentCount > 0 || args.openIncidentCount >= 5) {
    return {
      label: "Incident Storm",
      route: "/incidents",
      tone: "warning" as const,
      detail: args.dominantClassification
        ? `${args.dominantClassification} is dominating the runtime, so incident ownership, remediation, and verification outrank smaller backlog concerns.`
        : "Incident pressure is dominating the runtime, so incident ownership, remediation, and verification outrank smaller backlog concerns.",
    };
  }

  if (args.pendingApprovalsCount > 0) {
    return {
      label: "Review-Gated",
      route: "/approvals",
      tone: "info" as const,
      detail:
        "Execution truth is live, but the next bounded work is paused behind operator review.",
    };
  }

  if (args.proofStatus !== "healthy") {
    return {
      label: "Proof Lag",
      route: "/public-proof",
      tone: "info" as const,
      detail:
        "Internal runtime truth is ahead of the public evidence surface, so proof reconciliation outranks external claims.",
    };
  }

  if (args.queueQueued > 0 || args.queueProcessing > 0) {
    return {
      label: "Active Queue",
      route: "/task-runs",
      tone: "healthy" as const,
      detail:
        "The control plane is actively processing bounded work without a stronger failure mode outranking the run ledger.",
    };
  }

  return {
    label: "Steady State",
    route: "/tasks",
    tone: "healthy" as const,
    detail:
      "No dominant operator intervention is currently outranking routine bounded work.",
  };
}

function buildCompanionPrimaryMove(args: {
  mode: string;
  openIncidentCount: number;
  criticalIncidentCount: number;
  pendingApprovalsCount: number;
  topIncident: ReturnType<typeof buildIncidentPriorityQueue>[number] | null;
  queuePressure: ReturnType<typeof buildDashboardQueuePressure>;
  queueQueued: number;
  queueProcessing: number;
}) {
  if (args.mode === "Incident Storm") {
    return {
      title: "Stabilize the incident queue first",
      detail: args.topIncident
        ? `${args.topIncident.severity} incident ${args.topIncident.incidentId} is currently outranking the rest of the control plane.`
        : "Incidents are currently dominating the control plane, so clear ownership and remediation before treating smaller backlog as the main story.",
      route: "/incidents",
      tone: "warning" as const,
      supportingSignals: [
        `${args.openIncidentCount} open incident${args.openIncidentCount === 1 ? "" : "s"}`,
        `${args.criticalIncidentCount} critical`,
      ],
    };
  }

  if (args.mode === "Review-Gated") {
    return {
      title: "Clear the approval inbox first",
      detail: `${args.pendingApprovalsCount} approval decision(s) are pausing work that is already ready to continue once reviewed.`,
      route: "/approvals",
      tone: "warning" as const,
      supportingSignals: [
        `${args.pendingApprovalsCount} pending approval${args.pendingApprovalsCount === 1 ? "" : "s"}`,
        `${args.queueQueued + args.queueProcessing} queued or processing`,
      ],
    };
  }

  if (args.mode === "Proof Lag") {
    return {
      title: "Reconcile public proof before external claims",
      detail:
        "Internal runtime truth is ahead of the public evidence surface, so confirm proof freshness before you rely on outward-facing status.",
      route: "/public-proof",
      tone: "info" as const,
      supportingSignals: [
        `${args.openIncidentCount} open incident${args.openIncidentCount === 1 ? "" : "s"}`,
        `${args.queueQueued + args.queueProcessing} active queue item${args.queueQueued + args.queueProcessing === 1 ? "" : "s"}`,
      ],
    };
  }

  if (args.mode === "Active Queue") {
    return {
      title: "Work the run ledger",
      detail:
        "The control plane is live and the queue is the best next read surface for bounded progress and failure signals.",
      route: "/task-runs",
      tone: "healthy" as const,
      supportingSignals: [`${args.queueQueued} queued`, `${args.queueProcessing} processing`],
    };
  }

  const hottestQueue = args.queuePressure[0] ?? null;
  return {
    title: hottestQueue ? `Check ${hottestQueue.label} pressure` : "Launch the next bounded task",
    detail: hottestQueue
      ? `${hottestQueue.source} is the hottest queue source right now, so confirm whether it is normal churn or the start of backlog growth.`
      : "No stronger interruption is currently outranking routine bounded work, so the task catalog is the best next control surface.",
    route: hottestQueue ? "/task-runs" : "/tasks",
    tone: hottestQueue ? ("info" as const) : ("healthy" as const),
    supportingSignals: hottestQueue
      ? [`${hottestQueue.queuedCount} queued`, `${hottestQueue.processingCount} processing`]
      : ["Queue is quiet", "No dominant incident or approval pressure"],
  };
}

function buildCompanionPressureStory(args: {
  queuePressure: ReturnType<typeof buildDashboardQueuePressure>;
  classifications: ReturnType<typeof buildDashboardIncidentClassifications>;
  pendingApprovalsCount: number;
  proofStatus: "healthy" | "watching" | "degraded";
}) {
  const topClassification = args.classifications[0] ?? null;
  const hottestQueue = args.queuePressure[0] ?? null;
  const signals: string[] = [];

  if (topClassification) {
    signals.push(
      `${topClassification.count} ${topClassification.label.toLowerCase()} incident${topClassification.count === 1 ? "" : "s"}`,
    );
  }
  if (args.pendingApprovalsCount > 0) {
    signals.push(
      `${args.pendingApprovalsCount} pending approval${args.pendingApprovalsCount === 1 ? "" : "s"}`,
    );
  }
  if (hottestQueue) {
    signals.push(
      `${hottestQueue.label} owns ${hottestQueue.totalCount} queued or processing item${hottestQueue.totalCount === 1 ? "" : "s"}`,
    );
  }
  if (args.proofStatus !== "healthy") {
    signals.push(`public proof is ${args.proofStatus}`);
  }

  return {
    headline: topClassification
      ? `${topClassification.label} is currently shaping the control-plane story.`
      : hottestQueue
        ? `${hottestQueue.label} is the hottest bounded queue lane right now.`
        : args.pendingApprovalsCount > 0
          ? "Approvals are pausing otherwise ready work."
          : "No single interruption is dominating the control plane right now.",
    detail: [
      topClassification
        ? `${topClassification.label} is currently the leading incident class.`
        : null,
      hottestQueue
        ? `${hottestQueue.source} is the hottest queue source.`
        : null,
      args.pendingApprovalsCount > 0
        ? "Approval backlog is real operator work, not background noise."
        : null,
      args.proofStatus !== "healthy"
        ? "Public proof posture still needs reconciliation before external claims."
        : null,
    ]
      .filter((entry): entry is string => typeof entry === "string")
      .join(" "),
    signals,
  };
}

function buildCompanionCatalogPayload(
  config: Awaited<ReturnType<typeof loadConfig>>,
  state: OrchestratorState,
) {
  const tasks = buildOperatorTaskCatalog(config, state)
    .filter(
      (task) =>
        task.exposeInV1 !== false &&
        !task.internalOnly &&
        task.publicTriggerable !== false,
    )
    .map((task) => ({
      type: task.type,
      label: task.label,
      purpose: task.purpose,
      operationalStatus: task.operationalStatus,
      approvalGated: task.approvalGated,
      dependencyClass: task.dependencyClass,
      dependencyRequirements: task.dependencyRequirements,
      baselineConfidence: task.baselineConfidence,
      caveats: task.caveats,
      telemetryOverlay: task.telemetryOverlay,
    }));

  return {
    generatedAt: new Date().toISOString(),
    total: tasks.length,
    tasks,
  };
}

function buildCompanionApprovalsPayload(
  state: OrchestratorState,
  config: Awaited<ReturnType<typeof loadConfig>>,
  limit: number = 8,
) {
  const pending = listPendingApprovals(state)
    .slice()
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
  const grouped = new Map<string, number>();
  for (const approval of pending) {
    grouped.set(approval.type, (grouped.get(approval.type) ?? 0) + 1);
  }
  const dominantLanes = [...grouped.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([type, count]) => ({
      type,
      label: getOperatorTaskProfile(type)?.label ?? humanizeHyphenLabel(type),
      count,
    }));
  const oldest = pending[0] ?? null;

  return {
    generatedAt: new Date().toISOString(),
    count: pending.length,
    dominantLanes,
    oldestWaiting: oldest
      ? {
          taskId: oldest.taskId,
          type: oldest.type,
          label: getOperatorTaskProfile(oldest.type)?.label ?? humanizeHyphenLabel(oldest.type),
          requestedAt: oldest.requestedAt,
        }
      : null,
    items: pending.slice(0, limit).map((approval) => ({
      ...approval,
      impact: buildApprovalImpactMetadata(approval, config),
      payloadPreview: summarizePayloadPreview(approval.payload),
    })),
  };
}

function buildCompanionIncidentsPayload(
  state: OrchestratorState,
  limit: number = 8,
) {
  const open = state.incidentLedger.filter((record) => record.status !== "resolved");
  const classifications = buildDashboardIncidentClassifications(state.incidentLedger, 5);
  const triageQueue = buildIncidentPriorityQueue(state.incidentLedger)
    .slice(0, limit)
    .map((incident) => ({
      incidentId: incident.incidentId,
      priorityScore: incident.priorityScore,
      severity: incident.severity,
      owner: incident.owner,
      recommendedOwner: incident.recommendedOwner,
      nextAction: incident.nextAction,
      remediationTaskType: incident.remediationTaskType,
      blockers: incident.blockers,
    }));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      openCount: open.length,
      criticalCount: open.filter((record) => record.severity === "critical").length,
      unownedCount: open.filter((record) => !record.owner).length,
      ackPendingCount: open.filter((record) => !record.acknowledgedAt).length,
      remediationCount: open.filter((record) => record.remediation.status !== "resolved").length,
      verificationCount: open.filter((record) => record.verification.status !== "not-required").length,
    },
    topClassifications: classifications,
    topQueue: triageQueue,
  };
}

function buildCompanionRunsPayload(
  state: OrchestratorState,
  config: Awaited<ReturnType<typeof loadConfig>>,
  limit: number = 10,
) {
  const runs = [...filterVisibleTaskExecutions(state.taskExecutions)]
    .sort((left, right) => right.lastHandledAt.localeCompare(left.lastHandledAt))
    .slice(0, limit)
    .map((execution) => {
      const run = buildRunRecord(execution, state, config);
      const result =
        run.result && typeof run.result === "object"
          ? (run.result as Record<string, unknown>)
          : null;
      const specialistContract =
        result?.specialistContract && typeof result.specialistContract === "object"
          ? (result.specialistContract as Record<string, unknown>)
          : null;
      const knowledgeFreshness =
        result?.knowledgeFreshness && typeof result.knowledgeFreshness === "object"
          ? (result.knowledgeFreshness as Record<string, unknown>)
          : null;
      const recommendedNextActions = Array.isArray(
        specialistContract?.recommendedNextActions ?? result?.recommendedNextActions,
      )
        ? (
            (specialistContract?.recommendedNextActions ??
              result?.recommendedNextActions) as unknown[]
          )
            .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
            .slice(0, 3)
        : [];

      return {
        runId: run.runId,
        taskId: run.taskId,
        type: run.type,
        status: run.status,
        lastHandledAt: run.lastHandledAt ?? null,
        operatorSummary:
          (typeof specialistContract?.operatorSummary === "string"
            ? specialistContract.operatorSummary
            : null) ??
          (typeof result?.operatorSummary === "string" ? result.operatorSummary : null) ??
          run.resultSummary?.keys?.join(", ") ??
          null,
        recommendedNextActions,
        freshnessStatus:
          typeof knowledgeFreshness?.status === "string" ? knowledgeFreshness.status : null,
        reviewRecommended: knowledgeFreshness?.reviewRecommended === true,
        workflowStage:
          typeof specialistContract?.workflowStage === "string"
            ? specialistContract.workflowStage
            : null,
      };
    });

  return {
    generatedAt: new Date().toISOString(),
    total: runs.length,
    runs,
  };
}

function normalizeIsoTimestamp(value?: string | null) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

const WORKFLOW_STAGE_ORDER: WorkflowEventStage[] = [
  "ingress",
  "queue",
  "approval",
  "agent",
  "repair",
  "result",
  "proof",
];

function summarizeEvidence(evidence: string[], limit: number = 6) {
  return [...new Set(evidence.filter(Boolean))].slice(0, limit);
}

function buildWorkflowEventId(
  runId: string,
  stage: WorkflowEventStage,
  state: string,
  timestamp: string,
  nodeId: string,
  detail: string,
) {
  const digest = createHash("sha1")
    .update([runId, stage, state, timestamp, nodeId, detail].join("|"))
    .digest("hex")
    .slice(0, 12);
  return `workflow:${stage}:${digest}`;
}

function appendWorkflowEvent(args: {
  state: OrchestratorState;
  runId: string;
  taskId: string;
  type: string;
  stage: WorkflowEventStage;
  stateLabel: string;
  source: string;
  actor?: string | null;
  nodeId: string;
  detail: string;
  evidence?: string[];
  timestamp?: string;
  attempt?: number;
  relatedNodeIds?: string[];
  stopCode?: string | null;
  parentEventId?: string | null;
  relatedRunId?: string | null;
  dependencyRunIds?: string[];
  toolId?: string | null;
  proofTransport?: "milestone" | "demandSummary" | null;
  classification?: string | null;
}) {
  const timestamp = normalizeIsoTimestamp(args.timestamp) ?? new Date().toISOString();
  const detail = args.detail.trim();
  const event: WorkflowEventRecord = {
    eventId: buildWorkflowEventId(
      args.runId,
      args.stage,
      args.stateLabel,
      timestamp,
      args.nodeId,
      detail,
    ),
    runId: args.runId,
    taskId: args.taskId,
    type: args.type,
    stage: args.stage,
    state: args.stateLabel,
    timestamp,
    source: args.source,
    actor:
      typeof args.actor === "string" && args.actor.trim().length > 0
        ? args.actor.trim()
        : "system",
    nodeId: args.nodeId,
    detail,
    evidence: summarizeEvidence(args.evidence ?? []),
    attempt: Number.isFinite(args.attempt) ? Number(args.attempt) : undefined,
    relatedNodeIds: args.relatedNodeIds?.filter(Boolean),
    stopCode:
      typeof args.stopCode === "string" && args.stopCode.length > 0
        ? args.stopCode
        : null,
    parentEventId:
      typeof args.parentEventId === "string" && args.parentEventId.length > 0
        ? args.parentEventId
        : null,
    relatedRunId:
      typeof args.relatedRunId === "string" && args.relatedRunId.length > 0
        ? args.relatedRunId
        : null,
    dependencyRunIds: args.dependencyRunIds?.filter(Boolean),
    toolId:
      typeof args.toolId === "string" && args.toolId.length > 0
        ? args.toolId
        : null,
    proofTransport:
      args.proofTransport === "milestone" || args.proofTransport === "demandSummary"
        ? args.proofTransport
        : null,
    classification:
      typeof args.classification === "string" && args.classification.length > 0
        ? args.classification
        : null,
  };

  const existing = args.state.workflowEvents.find(
    (record) => record.eventId === event.eventId,
  );
  if (existing) return existing;

  appendWorkflowEventRecord(args.state, event);
  return event;
}

function mapWorkflowEventStageToLegacy(
  stage: WorkflowEventStage,
): RunWorkflowEvent["stage"] {
  if (stage === "ingress" || stage === "queue") return "queue";
  if (stage === "approval") return "approval";
  if (stage === "agent") return "execution";
  if (stage === "result") return "status";
  if (stage === "proof") return "status";
  return "repair";
}

function buildRunWorkflowEventsFromLedger(events: WorkflowEventRecord[]) {
  return sortTimelineEvents(
    events.map((event) => ({
      id: event.eventId,
      stage: mapWorkflowEventStageToLegacy(event.stage),
      state: event.state,
      source: [
        "approval",
        "repair",
        "history",
        "retry-recovery",
      ].includes(event.source)
        ? (event.source as RunWorkflowEvent["source"])
        : "execution",
      timestamp: normalizeIsoTimestamp(event.timestamp),
      message: event.detail,
      evidence: summarizeEvidence(event.evidence),
    })),
  );
}

function deriveWorkflowStageTimestamps(events: WorkflowEventRecord[]) {
  const timestamps: Partial<Record<WorkflowEventStage, number>> = {};
  for (const stage of WORKFLOW_STAGE_ORDER) {
    const stageEvents = events
      .filter((event) => event.stage === stage)
      .map((event) => Date.parse(event.timestamp))
      .filter((value) => Number.isFinite(value));
    if (stageEvents.length > 0) {
      timestamps[stage] = Math.min(...stageEvents);
    }
  }
  return timestamps;
}

function buildWorkflowStageDurations(events: WorkflowEventRecord[]) {
  const breakdown = buildWorkflowTimingBreakdown(events);
  const durations: Partial<Record<WorkflowEventStage, number>> = {};
  for (const stage of WORKFLOW_STAGE_ORDER) {
    const duration = breakdown[stage]?.durationMs;
    if (typeof duration === "number" && Number.isFinite(duration)) {
      durations[stage] = duration;
    }
  }
  return durations;
}

function buildWorkflowTimingBreakdown(events: WorkflowEventRecord[]) {
  const breakdown: WorkflowGraph["timingBreakdown"] = {};

  for (let index = 0; index < WORKFLOW_STAGE_ORDER.length; index += 1) {
    const stage = WORKFLOW_STAGE_ORDER[index];
    const stageEvents = sortWorkflowEventRecords(
      events.filter((event) => event.stage === stage),
    );
    if (stageEvents.length === 0) {
      continue;
    }

    const startedAt = normalizeIsoTimestamp(stageEvents[0]?.timestamp) ?? null;
    const completedAt =
      normalizeIsoTimestamp(stageEvents.at(-1)?.timestamp) ?? startedAt;
    const nextStage = WORKFLOW_STAGE_ORDER[index + 1];
    const nextStageStartedAt = nextStage
      ? normalizeIsoTimestamp(
          sortWorkflowEventRecords(
            events.filter((event) => event.stage === nextStage),
          )[0]?.timestamp,
        ) ?? null
      : null;

    let durationMs: number | null = null;
    if (startedAt && nextStageStartedAt) {
      const startMs = Date.parse(startedAt);
      const nextMs = Date.parse(nextStageStartedAt);
      if (Number.isFinite(startMs) && Number.isFinite(nextMs) && nextMs >= startMs) {
        durationMs = nextMs - startMs;
      }
    } else if (startedAt && completedAt) {
      const startMs = Date.parse(startedAt);
      const endMs = Date.parse(completedAt);
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
        durationMs = endMs - startMs;
      }
    }

    breakdown[stage] = {
      startedAt,
      completedAt,
      durationMs,
      eventCount: stageEvents.length,
    };
  }

  return breakdown;
}

function classifyWorkflowStopCause(args: {
  execution: OrchestratorState["taskExecutions"][number];
  approval: ApprovalRecord | null;
  repair: OrchestratorState["repairRecords"][number] | null;
  proofLinks: WorkflowGraph["proofLinks"];
}) {
  const { execution, approval, repair, proofLinks } = args;

  if (approval?.status === "pending") {
    return {
      blockedStage: "approval" as WorkflowEventStage,
      stopClassification: "awaiting-approval" as WorkflowGraph["stopClassification"],
      stopReason: "Awaiting operator approval.",
    };
  }
  if (approval?.status === "rejected") {
    return {
      blockedStage: "approval" as WorkflowEventStage,
      stopClassification: "approval-rejected" as WorkflowGraph["stopClassification"],
      stopReason: approval.note ?? "Approval was rejected by an operator.",
    };
  }
  if (repair?.status === "failed") {
    return {
      blockedStage: "repair" as WorkflowEventStage,
      stopClassification: "repair-failed" as WorkflowGraph["stopClassification"],
      stopReason: repair.lastError ?? repair.verificationSummary ?? "Repair flow failed.",
    };
  }
  if (execution.status === "retrying") {
    return {
      blockedStage: "result" as WorkflowEventStage,
      stopClassification: "retry-scheduled" as WorkflowGraph["stopClassification"],
      stopReason: execution.lastError ?? "Execution failed and a retry is scheduled.",
    };
  }
  if (
    proofLinks.some((link) => ["dead-letter", "rejected", "degraded", "blocked", "failed"].includes(link.status))
  ) {
    return {
      blockedStage: "proof" as WorkflowEventStage,
      stopClassification: "proof-degraded" as WorkflowGraph["stopClassification"],
      stopReason: "Public proof evidence is degraded or blocked.",
    };
  }
  if (proofLinks.some((link) => link.status === "retrying")) {
    return {
      blockedStage: "proof" as WorkflowEventStage,
      stopClassification: "proof-degraded" as WorkflowGraph["stopClassification"],
      stopReason: "Proof delivery is retrying.",
    };
  }
  if (execution.status === "failed") {
    return {
      blockedStage: "result" as WorkflowEventStage,
      stopClassification: "execution-failed" as WorkflowGraph["stopClassification"],
      stopReason: execution.lastError ?? "Execution failed.",
    };
  }
  if (
    proofLinks.length === 0 &&
    (execution.status === "running" || execution.status === "pending")
  ) {
    return {
      blockedStage: null,
      stopClassification: "in-flight" as WorkflowGraph["stopClassification"],
      stopReason: null,
    };
  }
  if (execution.status === "success") {
    return {
      blockedStage: null,
      stopClassification: "completed" as WorkflowGraph["stopClassification"],
      stopReason: null,
    };
  }

  return {
    blockedStage: null,
    stopClassification: "unknown" as WorkflowGraph["stopClassification"],
    stopReason: execution.lastError ?? null,
  };
}

function sortWorkflowEventRecords(events: WorkflowEventRecord[]) {
  return [...events].sort((left, right) => {
    const leftTs = Date.parse(left.timestamp);
    const rightTs = Date.parse(right.timestamp);
    if (!Number.isFinite(leftTs) && !Number.isFinite(rightTs)) {
      return left.eventId.localeCompare(right.eventId);
    }
    if (!Number.isFinite(leftTs)) return 1;
    if (!Number.isFinite(rightTs)) return -1;
    if (leftTs === rightTs) {
      return left.eventId.localeCompare(right.eventId);
    }
    return leftTs - rightTs;
  });
}

function sortTimelineEvents(events: RunWorkflowEvent[]) {
  return [...events].sort((left, right) => {
    if (!left.timestamp && !right.timestamp) return left.id.localeCompare(right.id);
    if (!left.timestamp) return 1;
    if (!right.timestamp) return -1;
    return left.timestamp.localeCompare(right.timestamp);
  });
}

function buildProofLinksForRun(
  state: OrchestratorState,
  execution: OrchestratorState["taskExecutions"][number],
) {
  const runId = execution.idempotencyKey;
  const taskId = execution.taskId;
  const incidents = state.incidentLedger.filter(
    (record) =>
      record.linkedRunIds.includes(runId) ||
      record.linkedTaskIds.includes(taskId) ||
      record.remediationTasks.some(
        (task) => task.runId === runId || task.taskId === taskId,
      ),
  );
  const proofEvents = state.workflowEvents.filter(
    (event) =>
      event.runId === runId &&
      (event.stage === "proof" ||
        event.proofTransport === "milestone" ||
        event.proofTransport === "demandSummary"),
  );
  const proofRelationships = state.relationshipObservations.filter(
    (record) =>
      (record.runId === runId ||
        record.targetRunId === runId ||
        record.taskId === taskId ||
        record.targetTaskId === taskId) &&
      (record.proofTransport === "milestone" ||
        record.proofTransport === "demandSummary" ||
        record.relationship === "publishes-proof" ||
        record.relationship === "transitions-proof"),
  );
  const linkedProofIds = new Set(
    incidents.flatMap((record) => record.linkedProofDeliveries ?? []),
  );
  const inferProofType = (
    value: string | null | undefined,
  ): "milestone" | "demandSummary" | null => {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (normalized.includes("milestone")) return "milestone";
    if (normalized.includes("demand")) return "demandSummary";
    return null;
  };
  const normalizeProofStatus = (value: string | null | undefined) => {
    const normalized = value?.trim().toLowerCase() ?? "unknown";
    if (
      normalized === "degraded" ||
      normalized === "blocked" ||
      normalized === "failed" ||
      normalized === "dead-letter"
    ) {
      return "degraded";
    }
    if (normalized === "retrying") return "retrying";
    if (normalized === "rejected") return "rejected";
    if (
      normalized === "observed" ||
      normalized === "completed" ||
      normalized === "success" ||
      normalized === "delivered"
    ) {
      return "delivered";
    }
    return normalized;
  };
  const statusPriority = (value: string) => {
    switch (value) {
      case "rejected":
        return 5;
      case "degraded":
        return 4;
      case "retrying":
        return 3;
      case "pending":
        return 2;
      case "delivered":
        return 1;
      default:
        return 0;
    }
  };
  const fallbackProofId =
    linkedProofIds.size === 1 ? Array.from(linkedProofIds)[0] ?? null : null;
  const linkMap = new Map<string, WorkflowGraph["proofLinks"][number]>();
  const ensureLink = (
    id: string,
    type: "milestone" | "demandSummary",
    source: {
      status?: string | null;
      summary?: string | null;
      target?: string | null;
      lastAttemptAt?: string | null;
    },
  ) => {
    const nextStatus = normalizeProofStatus(source.status);
    const existing = linkMap.get(id);
    const nextTimestamp = source.lastAttemptAt ? Date.parse(source.lastAttemptAt) : Number.NaN;
    const existingTimestamp = existing?.lastAttemptAt ? Date.parse(existing.lastAttemptAt) : Number.NaN;
    const preferNext =
      !existing ||
      (Number.isFinite(nextTimestamp) &&
        (!Number.isFinite(existingTimestamp) || nextTimestamp >= existingTimestamp)) ||
      statusPriority(nextStatus) > statusPriority(existing.status);

    linkMap.set(id, {
      id,
      type,
      status:
        existing && !preferNext && statusPriority(existing.status) >= statusPriority(nextStatus)
          ? existing.status
          : nextStatus,
      summary:
        (preferNext ? source.summary : existing?.summary) ??
        existing?.summary ??
        source.summary ??
        `${type} public proof surface was observed for this run.`,
      target:
        (preferNext ? source.target : existing?.target) ??
        existing?.target ??
        source.target ??
        null,
      lastAttemptAt:
        (preferNext ? source.lastAttemptAt : existing?.lastAttemptAt) ??
        existing?.lastAttemptAt ??
        source.lastAttemptAt ??
        null,
    });
  };
  const resolveProofIds = (values: string[]) => {
    const matched = values.filter((value) => linkedProofIds.has(value));
    if (matched.length > 0) return matched;
    return fallbackProofId ? [fallbackProofId] : [];
  };

  for (const incident of incidents) {
    for (const proofId of incident.linkedProofDeliveries ?? []) {
      const inferredType =
        proofEvents.find((event) => resolveProofIds(event.evidence ?? []).includes(proofId))
          ?.proofTransport ??
        proofRelationships.find((record) =>
          resolveProofIds(record.evidence ?? []).includes(proofId),
        )?.proofTransport ??
        inferProofType(incident.affectedSurfaces[0] ?? null) ??
        "milestone";
      ensureLink(proofId, inferredType, {
        status: incident.status === "resolved" ? "delivered" : "degraded",
        summary: incident.summary ?? incident.title ?? `${inferredType} public proof issue observed.`,
        target: incident.title ?? null,
        lastAttemptAt: incident.lastSeenAt ?? incident.firstSeenAt ?? null,
      });
    }
  }

  for (const event of proofEvents) {
    const type = inferProofType(event.proofTransport ?? event.nodeId ?? event.detail);
    if (!type) continue;
    const proofIds = resolveProofIds(event.evidence ?? []);
    const targetIds =
      proofIds.length > 0 ? proofIds : [`surface:${type}:${runId}`];
    for (const proofId of targetIds) {
      ensureLink(proofId, type, {
        status: event.state,
        summary: event.detail || event.stopCode || `${type} public proof surface updated.`,
        target: null,
        lastAttemptAt: event.timestamp,
      });
    }
  }

  for (const relationship of proofRelationships) {
    const type = inferProofType(
      relationship.proofTransport ?? relationship.to ?? relationship.from,
    );
    if (!type) continue;
    const proofIds = resolveProofIds(relationship.evidence ?? []);
    const targetIds =
      proofIds.length > 0 ? proofIds : [`surface:${type}:${runId}`];
    for (const proofId of targetIds) {
      ensureLink(proofId, type, {
        status: relationship.status,
        summary: relationship.detail || `${type} public proof surface was observed.`,
        target: relationship.to ?? null,
        lastAttemptAt: relationship.timestamp,
      });
    }
  }

  return [...linkMap.values()].sort((left, right) => {
    const leftTs = left.lastAttemptAt ? Date.parse(left.lastAttemptAt) : Number.NaN;
    const rightTs = right.lastAttemptAt ? Date.parse(right.lastAttemptAt) : Number.NaN;
    if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) {
      return rightTs - leftTs;
    }
    if (left.type !== right.type) return left.type.localeCompare(right.type);
    return left.id.localeCompare(right.id);
  });
}

function buildWorkflowGraph(args: {
  execution: OrchestratorState["taskExecutions"][number];
  approval: ApprovalRecord | null;
  repair: OrchestratorState["repairRecords"][number] | null;
  workflowEvents: WorkflowEventRecord[];
  relatedRelationships: RelationshipObservationRecord[];
  proofLinks: WorkflowGraph["proofLinks"];
}) {
  const {
    execution,
    approval,
    repair,
    workflowEvents,
    relatedRelationships,
    proofLinks,
  } = args;
  const timingBreakdown = buildWorkflowTimingBreakdown(workflowEvents);
  const stageDurations = buildWorkflowStageDurations(workflowEvents);
  const requirement = TASK_AGENT_SKILL_REQUIREMENTS[execution.type];
  const hasApprovalStage =
    Boolean(approval) || workflowEvents.some((event) => event.stage === "approval");
  const hasRepairStage =
    Boolean(repair) || workflowEvents.some((event) => event.stage === "repair");
  const hasProofStage =
    proofLinks.length > 0 || workflowEvents.some((event) => event.stage === "proof");

  const currentStage: WorkflowEventStage | null =
    approval?.status === "pending"
      ? "approval"
      : repair?.status === "running"
        ? "repair"
        : execution.status === "running"
          ? "agent"
          : execution.status === "retrying"
            ? "result"
            : hasProofStage &&
                proofLinks.some((link) =>
                  [
                    "pending",
                    "retrying",
                    "dead-letter",
                    "rejected",
                    "degraded",
                    "blocked",
                    "failed",
                  ].includes(link.status),
                )
              ? "proof"
              : execution.status === "success" || execution.status === "failed"
                ? "result"
                : workflowEvents.at(-1)?.stage ?? null;

  const {
    blockedStage,
    stopClassification,
    stopReason,
  } = classifyWorkflowStopCause({
    execution,
    approval,
    repair,
    proofLinks,
  });

  const graphStatus: WorkflowGraph["graphStatus"] =
    blockedStage === "approval" || blockedStage === "repair" || blockedStage === "result"
      ? "blocked"
      : hasProofStage &&
          proofLinks.some((link) =>
            ["dead-letter", "rejected", "retrying", "degraded", "blocked", "failed"].includes(
              link.status,
            ),
          )
        ? "warning"
        : execution.status === "success" &&
            (!hasProofStage || proofLinks.every((link) => link.status === "delivered"))
          ? "completed"
          : execution.status === "pending"
            ? "stable"
          : execution.status === "running"
            ? "stable"
            : "warning";

  const stageLabels: Record<WorkflowEventStage, string> = {
    ingress: "Ingress",
    queue: "Queue",
    approval: "Approval",
    agent: requirement?.agentId ?? "Agent",
    result: "Result",
    proof: "Proof",
    repair: "Repair",
  };

  const stageNodes = WORKFLOW_STAGE_ORDER.filter((stage) => {
    if (stage === "approval") return hasApprovalStage;
    if (stage === "repair") return hasRepairStage;
    if (stage === "proof") return hasProofStage;
    return true;
  }).map<WorkflowGraphNode>((stage) => {
    const stageEvents = workflowEvents.filter((event) => event.stage === stage);
    const latest = stageEvents.at(-1) ?? null;
    const status: WorkflowGraphNodeStatus =
      blockedStage === stage
        ? "blocked"
        : currentStage === stage && graphStatus !== "completed"
          ? "active"
          : latest
            ? "completed"
            : "pending";

    return {
      id: `workflow-node:${stage}`,
      kind: stage === "agent" ? "agent" : stage === "proof" ? "proof" : "stage",
      stage,
      label: stageLabels[stage],
      status,
      timestamp: latest?.timestamp ?? null,
      detail:
        latest?.detail ??
        (stage === "approval"
          ? "Approval gate state is derived from the orchestrator approval ledger."
          : stage === "proof"
            ? "Proof-delivery state is derived from milestone and demand transport ledgers."
            : `${stageLabels[stage]} stage declared for this run.`),
      evidence: summarizeEvidence(latest?.evidence ?? []),
    };
  });

  const eventNodes = workflowEvents.map<WorkflowGraphNode>((event) => ({
    id: `workflow-event:${event.eventId}`,
    kind: "event",
    stage: event.stage,
    label: event.state,
    status:
      stopClassification === "completed"
        ? "completed"
        : event === workflowEvents.at(-1) && blockedStage === event.stage
          ? "blocked"
          : event === workflowEvents.at(-1)
            ? "active"
            : "completed",
    timestamp: event.timestamp,
    detail: event.detail,
    evidence: summarizeEvidence(event.evidence),
  }));

  const stageEdges = stageNodes.slice(0, -1).map<WorkflowGraphEdge>((node, index) => {
    const next = stageNodes[index + 1];
    const blocked = blockedStage === node.stage || blockedStage === next.stage;
    return {
      id: `workflow-edge:${node.id}:${next.id}`,
      from: node.id,
      to: next.id,
      status: blocked
        ? "blocked"
        : node.status === "completed" && next.status !== "pending"
          ? "completed"
          : currentStage === next.stage
            ? "active"
            : "declared",
      detail: `${node.label} -> ${next.label}`,
    };
  });

  const eventEdges = eventNodes.slice(0, -1).map<WorkflowGraphEdge>((node, index) => {
    const next = eventNodes[index + 1];
    return {
      id: `workflow-edge:${node.id}:${next.id}`,
      from: node.id,
      to: next.id,
      status:
        next.status === "blocked"
          ? "blocked"
          : next.status === "active"
            ? "active"
            : "completed",
      detail: `${node.label} -> ${next.label}`,
    };
  });

  const stageToEventEdges = workflowEvents.map<WorkflowGraphEdge>((event) => ({
    id: `workflow-edge:stage:${event.stage}:${event.eventId}`,
    from: `workflow-node:${event.stage}`,
    to: `workflow-event:${event.eventId}`,
    status:
      blockedStage === event.stage
        ? "blocked"
        : currentStage === event.stage
          ? "active"
          : "completed",
    detail: `${event.stage} emitted ${event.state}.`,
  }));

  const supplementalNodes = new Map<string, WorkflowGraphNode>();
  const supplementalEdges: WorkflowGraphEdge[] = [];
  const causalLinks: WorkflowGraph["causalLinks"] = [];
  const crossRunLinks: WorkflowGraph["crossRunLinks"] = [];
  const relatedRuns = new Map<
    string,
    WorkflowGraph["relatedRuns"][number] & { sourceSet: Set<"workflow-event" | "relationship-observation"> }
  >();
  const sortedRelationships = [...relatedRelationships].sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
  const currentRunId = execution.idempotencyKey;

  const ensureSupplementalNode = (node: WorkflowGraphNode) => {
    if (!supplementalNodes.has(node.id)) {
      supplementalNodes.set(node.id, node);
    }
    return supplementalNodes.get(node.id)!;
  };

  const registerCrossRunLink = (args: {
    fromRunId: string;
    toRunId: string;
    relationship: "depends-on-run" | "cross-run-handoff";
    source: "workflow-event" | "relationship-observation";
    detail: string;
    timestamp: string | null;
    evidence: string[];
  }) => {
    if (!args.fromRunId || !args.toRunId || args.fromRunId === args.toRunId) {
      return;
    }
    const id = createHash("sha1")
      .update(
        [
          args.fromRunId,
          args.toRunId,
          args.relationship,
          args.source,
          args.detail,
          args.timestamp ?? "no-ts",
        ].join("|"),
      )
      .digest("hex")
      .slice(0, 12);
    if (!crossRunLinks.some((link) => link.id === `cross-run:${id}`)) {
      crossRunLinks.push({
        id: `cross-run:${id}`,
        fromRunId: args.fromRunId,
        toRunId: args.toRunId,
        relationship: args.relationship,
        source: args.source,
        detail: args.detail,
        timestamp: args.timestamp,
        evidence: summarizeEvidence(args.evidence),
      });
    }

    const relatedRunId =
      args.fromRunId === currentRunId ? args.toRunId : args.fromRunId;
    const direction =
      args.toRunId === currentRunId ? "upstream" : "downstream";
    const existing = relatedRuns.get(relatedRunId);
    if (!existing) {
      relatedRuns.set(relatedRunId, {
        runId: relatedRunId,
        direction,
        relationship: args.relationship,
        sources: [args.source],
        sourceSet: new Set([args.source]),
        count: 1,
        lastObservedAt: args.timestamp,
      });
      return;
    }

    existing.count += 1;
    existing.relationship =
      existing.relationship === "cross-run-handoff" || args.relationship === "cross-run-handoff"
        ? "cross-run-handoff"
        : "depends-on-run";
    existing.direction = direction;
    existing.sourceSet.add(args.source);
    existing.sources = [...existing.sourceSet];
    if (
      args.timestamp &&
      (!existing.lastObservedAt || args.timestamp > existing.lastObservedAt)
    ) {
      existing.lastObservedAt = args.timestamp;
    }
  };

  const registerEventDependency = (
    upstreamRunId: string,
    relationship: "depends-on-run" | "cross-run-handoff",
    event: WorkflowEventRecord,
  ) => {
    if (!upstreamRunId || upstreamRunId === currentRunId) return;
    const dependencyNodeId = `workflow-dependency:${upstreamRunId}`;
    ensureSupplementalNode({
      id: dependencyNodeId,
      kind: "dependency",
      stage: event.stage,
      label: upstreamRunId,
      status: relationship === "cross-run-handoff" ? "active" : "completed",
      timestamp: event.timestamp,
      detail: event.detail,
      evidence: summarizeEvidence(event.evidence ?? []),
    });
    const targetNodeId = `workflow-event:${event.eventId}`;
    supplementalEdges.push({
      id: `workflow-edge:${dependencyNodeId}:${targetNodeId}:${relationship}:${event.eventId}`,
      from: dependencyNodeId,
      to: targetNodeId,
      status:
        blockedStage === event.stage
          ? "blocked"
          : currentStage === event.stage
            ? "active"
            : "completed",
      detail: event.detail,
      relationship,
    });
    causalLinks.push({
      id: `causal:event:${event.eventId}:${upstreamRunId}:${relationship}`,
      from: dependencyNodeId,
      to: targetNodeId,
      relationship,
      detail: event.detail,
      evidence: summarizeEvidence(event.evidence ?? []),
    });
    registerCrossRunLink({
      fromRunId: upstreamRunId,
      toRunId: currentRunId,
      relationship,
      source: "workflow-event",
      detail: event.detail,
      timestamp: event.timestamp,
      evidence: event.evidence ?? [],
    });
  };

  for (const event of workflowEvents) {
    for (const dependencyRunId of event.dependencyRunIds ?? []) {
      registerEventDependency(dependencyRunId, "depends-on-run", event);
    }
    if (event.relatedRunId) {
      registerEventDependency(
        event.relatedRunId,
        event.classification === "incident-remediation" ||
          event.state.includes("handoff")
          ? "cross-run-handoff"
          : "depends-on-run",
        event,
      );
    }
  }

  for (const relationship of sortedRelationships) {
    let targetNodeId: string | null = null;
    let targetNode: WorkflowGraphNode | null = null;

    if (relationship.toolId) {
      targetNodeId = `workflow-tool:${relationship.toolId}`;
      targetNode = ensureSupplementalNode({
        id: targetNodeId,
        kind: "tool",
        stage: "agent",
        label: relationship.toolId,
        status: relationship.status === "degraded" ? "warning" : "completed",
        timestamp: relationship.timestamp,
        detail: relationship.detail,
        evidence: summarizeEvidence(relationship.evidence ?? []),
      });
    } else if (
      relationship.relationship === "depends-on-run" ||
      relationship.relationship === "cross-run-handoff" ||
      relationship.targetRunId
    ) {
      const dependencyLabel =
        relationship.targetRunId ??
        relationship.targetTaskId ??
        relationship.to ??
        "dependency";
      targetNodeId = `workflow-dependency:${dependencyLabel}`;
      targetNode = ensureSupplementalNode({
        id: targetNodeId,
        kind: "dependency",
        stage: "agent",
        label: dependencyLabel,
        status: relationship.status === "degraded" ? "blocked" : "completed",
        timestamp: relationship.timestamp,
        detail: relationship.detail,
        evidence: summarizeEvidence(relationship.evidence ?? []),
      });
    } else if (relationship.proofTransport) {
      targetNodeId = `workflow-proof:${relationship.proofTransport}`;
      targetNode = ensureSupplementalNode({
        id: targetNodeId,
        kind: "proof",
        stage: "proof",
        label: relationship.proofTransport,
        status: relationship.status === "degraded" ? "blocked" : "completed",
        timestamp: relationship.timestamp,
        detail: relationship.detail,
        evidence: summarizeEvidence(relationship.evidence ?? []),
      });
    } else if (
      relationship.relationship === "verifies-agent" ||
      relationship.classification === "verification"
    ) {
      targetNodeId = `workflow-verification:${relationship.to}`;
      targetNode = ensureSupplementalNode({
        id: targetNodeId,
        kind: "verification",
        stage: "repair",
        label: relationship.to.replace(/^agent:/, ""),
        status: relationship.status === "degraded" ? "blocked" : "completed",
        timestamp: relationship.timestamp,
        detail: relationship.detail,
        evidence: summarizeEvidence(relationship.evidence ?? []),
      });
    }

    if (!targetNodeId || !targetNode) {
      continue;
    }

    let sourceNodeId =
      relationship.relationship === "transitions-proof"
        ? "workflow-node:proof"
        : relationship.relationship === "verifies-agent"
          ? "workflow-node:repair"
          : "workflow-node:agent";
    let destinationNodeId = targetNodeId;

    if (
      (relationship.relationship === "depends-on-run" ||
        relationship.relationship === "cross-run-handoff") &&
      relationship.targetRunId &&
      relationship.runId
    ) {
      registerCrossRunLink({
        fromRunId: relationship.runId,
        toRunId: relationship.targetRunId,
        relationship: relationship.relationship,
        source: "relationship-observation",
        detail: relationship.detail,
        timestamp: relationship.timestamp,
        evidence: relationship.evidence ?? [],
      });

      if (relationship.targetRunId === currentRunId) {
        sourceNodeId = targetNodeId;
        destinationNodeId =
          relationship.relationship === "cross-run-handoff"
            ? "workflow-node:repair"
            : "workflow-node:agent";
      } else if (relationship.runId === currentRunId) {
        sourceNodeId =
          relationship.relationship === "cross-run-handoff"
            ? "workflow-node:result"
            : "workflow-node:agent";
        destinationNodeId = targetNodeId;
      }
    }

    supplementalEdges.push({
      id: `workflow-edge:${sourceNodeId}:${destinationNodeId}:${relationship.relationship}`,
      from: sourceNodeId,
      to: destinationNodeId,
      status:
        relationship.status === "degraded"
          ? "blocked"
          : relationship.status === "warning"
            ? "active"
            : "completed",
      detail: relationship.detail,
      relationship: relationship.relationship,
    });
    causalLinks.push({
      id:
        relationship.observationId ??
        `causal:${relationship.relationship}:${sourceNodeId}:${destinationNodeId}`,
      from: sourceNodeId,
      to: destinationNodeId,
      relationship: relationship.relationship,
      detail: relationship.detail,
      evidence: summarizeEvidence(relationship.evidence ?? []),
    });
  }

  const allNodes = [...stageNodes, ...eventNodes, ...supplementalNodes.values()];
  const allEdges = [
    ...stageEdges,
    ...eventEdges,
    ...stageToEventEdges,
    ...supplementalEdges,
  ];

  return {
    graphStatus,
    currentStage,
    blockedStage,
    stopReason,
    stopClassification,
    stageDurations,
    timingBreakdown,
    nodeCount: allNodes.length,
    edgeCount: allEdges.length,
    nodes: allNodes,
    edges: allEdges,
    events: workflowEvents,
    causalLinks,
    crossRunLinks,
    relatedRuns: [...relatedRuns.values()]
      .map(({ sourceSet, ...entry }) => entry)
      .sort((left, right) => {
        const leftTs = left.lastObservedAt ?? "";
        const rightTs = right.lastObservedAt ?? "";
        return rightTs.localeCompare(leftTs);
      }),
    dependencySummary: {
      upstreamRunCount: [...relatedRuns.values()].filter(
        (entry) => entry.direction === "upstream",
      ).length,
      downstreamRunCount: [...relatedRuns.values()].filter(
        (entry) => entry.direction === "downstream",
      ).length,
      dependencyLinkCount: crossRunLinks.filter(
        (link) => link.relationship === "depends-on-run",
      ).length,
      handoffLinkCount: crossRunLinks.filter(
        (link) => link.relationship === "cross-run-handoff",
      ).length,
    },
    proofLinks,
  };
}

function buildRunWorkflowEvents({
  execution,
  history,
  approval,
  retryRecovery,
  repair,
  workflowEvents,
}: {
  execution: OrchestratorState["taskExecutions"][number];
  history: OrchestratorState["taskHistory"];
  approval: ApprovalRecord | null;
  retryRecovery: OrchestratorState["taskRetryRecoveries"][number] | null;
  repair: OrchestratorState["repairRecords"][number] | null;
  workflowEvents: WorkflowEventRecord[];
}) {
  if (workflowEvents.length > 0) {
    return buildRunWorkflowEventsFromLedger(workflowEvents);
  }

  const events: RunWorkflowEvent[] = [];
  const queueTimestamp =
    normalizeIsoTimestamp(approval?.requestedAt) ??
    normalizeIsoTimestamp(history[0]?.handledAt) ??
    normalizeIsoTimestamp(retryRecovery?.scheduledAt) ??
    normalizeIsoTimestamp(execution.lastHandledAt);

  events.push({
    id: `queue:${execution.idempotencyKey}`,
    stage: "queue",
    state: "queued",
    source: "execution",
    timestamp: queueTimestamp,
    message: `${execution.type} entered orchestrator tracking.`,
    evidence: [execution.taskId, execution.idempotencyKey],
  });

  if (approval) {
    events.push({
      id: `approval-requested:${approval.taskId}`,
      stage: "approval",
      state: approval.status,
      source: "approval",
      timestamp: normalizeIsoTimestamp(approval.requestedAt),
      message: `Approval requested for ${approval.type}.`,
      evidence: Object.keys(approval.payload ?? {}).filter((key) => key !== "__raw"),
    });

    if (approval.decidedAt) {
      events.push({
        id: `approval-decided:${approval.taskId}`,
        stage: "approval",
        state: approval.status,
        source: "approval",
        timestamp: normalizeIsoTimestamp(approval.decidedAt),
        message:
          approval.status === "approved"
            ? `Approval granted${approval.decidedBy ? ` by ${approval.decidedBy}` : ""}.`
            : `Approval rejected${approval.decidedBy ? ` by ${approval.decidedBy}` : ""}.`,
        evidence: [approval.note ?? "no-operator-note"],
      });
    }
  }

  for (const [index, entry] of history.entries()) {
    events.push({
      id: `history:${execution.idempotencyKey}:${index}`,
      stage: "history",
      state: entry.result,
      source: "history",
      timestamp: normalizeIsoTimestamp(entry.handledAt),
      message: entry.message ?? `Task recorded outcome ${entry.result}.`,
      evidence: [entry.type, entry.id],
    });
  }

  if (retryRecovery) {
    events.push({
      id: `retry-scheduled:${retryRecovery.idempotencyKey}`,
      stage: "retry",
      state: "scheduled",
      source: "retry-recovery",
      timestamp: normalizeIsoTimestamp(retryRecovery.scheduledAt),
      message: `Retry ${retryRecovery.attempt} scheduled for ${retryRecovery.type}.`,
      evidence: [retryRecovery.retryAt, String(retryRecovery.maxRetries)],
    });
    events.push({
      id: `retry-due:${retryRecovery.idempotencyKey}`,
      stage: "retry",
      state: "due",
      source: "retry-recovery",
      timestamp: normalizeIsoTimestamp(retryRecovery.retryAt),
      message: `Retry becomes eligible for requeue.`,
      evidence: [retryRecovery.sourceTaskId, retryRecovery.idempotencyKey],
    });
  }

  if (repair) {
    events.push({
      id: `repair-detected:${repair.repairId}`,
      stage: "repair",
      state: repair.status,
      source: "repair",
      timestamp: normalizeIsoTimestamp(repair.detectedAt),
      message: `Repair record ${repair.repairId} detected (${repair.classification}).`,
      evidence: repair.evidence ?? [],
    });

    if (repair.startedAt) {
      events.push({
        id: `repair-started:${repair.repairId}`,
        stage: "repair",
        state: "running",
        source: "repair",
        timestamp: normalizeIsoTimestamp(repair.startedAt),
        message: `Repair execution started.`,
        evidence: repair.evidence ?? [],
      });
    }

    const repairTerminalAt =
      normalizeIsoTimestamp(repair.verifiedAt) ??
      normalizeIsoTimestamp(repair.completedAt);
    if (repairTerminalAt) {
      events.push({
        id: `repair-terminal:${repair.repairId}`,
        stage: "repair",
        state: repair.status,
        source: "repair",
        timestamp: repairTerminalAt,
        message:
          repair.status === "verified"
            ? repair.verificationSummary ?? "Repair verified successfully."
            : repair.lastError ?? repair.verificationSummary ?? "Repair reached a terminal state.",
        evidence: repair.evidence ?? [],
      });
    }
  }

  events.push({
    id: `status:${execution.idempotencyKey}`,
    stage: "status",
    state: execution.status,
    source: "execution",
    timestamp: normalizeIsoTimestamp(execution.lastHandledAt),
    message:
      execution.lastError && execution.lastError.trim().length > 0
        ? execution.lastError
        : `Run is currently ${execution.status}.`,
    evidence: [execution.taskId, execution.type],
  });

  return sortTimelineEvents(events);
}

function deriveRunWorkflowStage(
  execution: OrchestratorState["taskExecutions"][number],
  approval: ApprovalRecord | null,
) {
  if (approval?.status === "pending" && execution.status === "pending") {
    return "awaiting-approval" as RunWorkflowStage;
  }
  if (execution.status === "running") return "executing" as RunWorkflowStage;
  if (execution.status === "retrying") return "retry-scheduled" as RunWorkflowStage;
  if (execution.status === "success") return "completed" as RunWorkflowStage;
  if (execution.status === "failed") return "failed" as RunWorkflowStage;
  return "queued" as RunWorkflowStage;
}

function buildRunRecord(
  execution: OrchestratorState["taskExecutions"][number],
  state: OrchestratorState,
  config: Awaited<ReturnType<typeof loadConfig>>,
) {
  const resultHighlights =
    execution.resultSummary?.highlights &&
    typeof execution.resultSummary.highlights === "object"
      ? (execution.resultSummary.highlights as Record<string, unknown>)
      : null;
  const relatedHistory = state.taskHistory.filter((entry) => entry.id === execution.taskId);
  const sortedHistory = [...relatedHistory].sort((a, b) =>
    a.handledAt.localeCompare(b.handledAt),
  );
  const firstSeenAt = sortedHistory[0]?.handledAt ?? execution.lastHandledAt;
  const requirement = TASK_AGENT_SKILL_REQUIREMENTS[execution.type];
  const relatedRepair =
    state.repairRecords.find(
      (record) =>
        record.repairRunId === execution.idempotencyKey ||
        record.repairTaskId === execution.taskId ||
        record.sourceRunId === execution.idempotencyKey,
    ) ?? null;
  const relatedApproval =
    state.approvals.find((record) => record.taskId === execution.taskId) ?? null;
  const relatedRetryRecovery =
    state.taskRetryRecoveries.find(
      (record) => record.idempotencyKey === execution.idempotencyKey,
    ) ?? null;
  const relatedWorkflowEvents = sortWorkflowEventRecords(
    state.workflowEvents.filter(
      (record) =>
        record.runId === execution.idempotencyKey ||
        (record.taskId === execution.taskId &&
          record.runId === execution.idempotencyKey),
    ),
  );
  const relatedRelationships = (state.relationshipObservations ?? []).filter(
    (record) =>
      record.runId === execution.idempotencyKey ||
      record.targetRunId === execution.idempotencyKey ||
      record.taskId === execution.taskId ||
      record.targetTaskId === execution.taskId,
  );
  const proofLinks = buildProofLinksForRun(state, execution);
  const workflowEvents = buildRunWorkflowEvents({
    execution,
    history: sortedHistory,
    approval: relatedApproval,
    retryRecovery: relatedRetryRecovery,
    repair: relatedRepair,
    workflowEvents: relatedWorkflowEvents,
  });
  const workflowGraph = buildWorkflowGraph({
    execution,
    approval: relatedApproval,
    repair: relatedRepair,
    workflowEvents: relatedWorkflowEvents,
    relatedRelationships,
    proofLinks,
  });
  const createdAt =
    workflowEvents[0]?.timestamp ?? normalizeIsoTimestamp(firstSeenAt) ?? null;
  const startedAt = normalizeIsoTimestamp(execution.startedAt ?? null);
  const completedAt =
    normalizeIsoTimestamp(execution.completedAt ?? null) ??
    (execution.status === "success" || execution.status === "failed"
      ? normalizeIsoTimestamp(execution.lastHandledAt)
      : null);
  const latestEventAt = workflowEvents.at(-1)?.timestamp ?? null;
  const accounting = finalizeTaskExecutionAccounting({
    existing: execution.accounting ?? null,
    startedAt,
    completedAt,
  });

  return {
    run_id: execution.idempotencyKey,
    task_id: execution.taskId,
    created_at: firstSeenAt,
    runId: execution.idempotencyKey,
    taskId: execution.taskId,
    visibility:
      execution.visibility ??
      (isInternalTaskType(execution.type) ? "internal" : "operator"),
    internalOnly: isInternalTaskExecution(execution),
    maintenanceCheckId: execution.maintenanceCheckId ?? null,
    createdAt,
    startedAt,
    completedAt,
    status: execution.status,
    actor: "unknown",
    agent_id: requirement?.agentId ?? null,
    skill_id: requirement?.skillId ?? null,
    agentId: requirement?.agentId ?? null,
    skillId: requirement?.skillId ?? null,
    model: accounting.model,
    cost: accounting.costUsd,
    latency: accounting.latencyMs,
    usage: accounting.usage ?? null,
    budget: accounting.budget ?? null,
    accounting,
    logs_ref: config.logsDir,
    logsRef: config.logsDir,
    artifact_refs: [] as string[],
    artifactRefs: [] as string[],
    type: execution.type,
    attempt: execution.attempt,
    maxRetries: execution.maxRetries,
    lastHandledAt: execution.lastHandledAt,
    lastError: execution.lastError ?? null,
    result_summary: execution.resultSummary ?? null,
    resultSummary: execution.resultSummary ?? null,
    result: resultHighlights,
    history: sortedHistory,
    approval: relatedApproval
      ? {
          required: true,
          status: relatedApproval.status,
          requestedAt: relatedApproval.requestedAt,
          decidedAt: relatedApproval.decidedAt ?? null,
          decidedBy: relatedApproval.decidedBy ?? null,
          note: relatedApproval.note ?? null,
        }
      : {
          required: false,
          status: null,
          requestedAt: null,
          decidedAt: null,
          decidedBy: null,
          note: null,
        },
    workflow: {
      stage: deriveRunWorkflowStage(execution, relatedApproval),
      graphStatus: workflowGraph.graphStatus,
      currentStage: workflowGraph.currentStage,
      blockedStage: workflowGraph.blockedStage,
      stopReason: workflowGraph.stopReason,
      stopClassification: workflowGraph.stopClassification,
      awaitingApproval:
        relatedApproval?.status === "pending" && execution.status === "pending",
      retryScheduled: execution.status === "retrying",
      nextRetryAt: relatedRetryRecovery?.retryAt ?? null,
      repairStatus: relatedRepair?.status ?? null,
      eventCount: workflowEvents.length,
      latestEventAt,
      stageDurations: workflowGraph.stageDurations,
      timingBreakdown: workflowGraph.timingBreakdown,
      nodeCount: workflowGraph.nodeCount,
      edgeCount: workflowGraph.edgeCount,
    },
    events: workflowEvents,
    workflowGraph,
    proofLinks,
    repair: relatedRepair
      ? {
          repairId: relatedRepair.repairId,
          classification: relatedRepair.classification,
          status: relatedRepair.status,
          trigger: relatedRepair.trigger,
          verificationMode: relatedRepair.verificationMode,
          verificationSummary: relatedRepair.verificationSummary ?? null,
          detectedAt: relatedRepair.detectedAt,
          startedAt: relatedRepair.startedAt ?? null,
          completedAt: relatedRepair.completedAt ?? null,
          verifiedAt: relatedRepair.verifiedAt ?? null,
          lastError: relatedRepair.lastError ?? null,
          evidence: relatedRepair.evidence ?? [],
        }
      : null,
  };
}

async function buildMemoryOverviewSummary(staleAfterHours: number = 24) {
  const registry = await getAgentRegistry();
  const agentIds = registry.listAgents().map((agent) => agent.id);
  const staleCutoff = Date.now() - staleAfterHours * 60 * 60 * 1000;

  let missingCount = 0;
  let staleCount = 0;
  let errorStateCount = 0;
  let totalRuns = 0;

  const samples: Array<{
    agentId: string;
    reason: string;
    lastRunAt?: string | null;
  }> = [];

  const loadedMemory = await Promise.all(
    agentIds.map(async (agentId) => ({
      agentId,
      memory: await loadAgentMemoryState(agentId),
    })),
  );

  for (const { agentId, memory } of loadedMemory) {
    if (!memory) {
      missingCount += 1;
      if (samples.length < 10) samples.push({ agentId, reason: "missing" });
      continue;
    }

    totalRuns += Number(memory.totalRuns ?? 0);

    const lastRunAt = memory.lastRunAt ?? null;
    const lastStatus = memory.lastStatus ?? null;

    if (!lastRunAt) {
      staleCount += 1;
      if (samples.length < 10)
        samples.push({ agentId, reason: "never-run", lastRunAt });
    } else {
      const ts = new Date(lastRunAt).getTime();
      if (!Number.isFinite(ts) || ts < staleCutoff) {
        staleCount += 1;
        if (samples.length < 10)
          samples.push({ agentId, reason: "stale", lastRunAt });
      }
    }

    if (lastStatus === "error") {
      errorStateCount += 1;
      if (samples.length < 10)
        samples.push({ agentId, reason: "error", lastRunAt });
    }
  }

  return {
    staleAfterHours,
    totalAgents: agentIds.length,
    agentsWithMemoryFile: agentIds.length - missingCount,
    agentsMissingMemoryFile: missingCount,
    staleAgents: staleCount,
    agentsLastStatusError: errorStateCount,
    totalRuns,
    sample: samples,
  };
}

function buildKnowledgeRuntimeSignals({
  summary,
  config,
  state,
}: {
  summary: any;
  config: Awaited<ReturnType<typeof loadConfig>>;
  state: OrchestratorState;
}) {
  const totalEntries = Number(summary?.stats?.total ?? 0);
  const totalConcepts = Number(summary?.networkStats?.totalConcepts ?? 0);
  const freshness = summary?.diagnostics?.freshness ?? null;
  const contradictionSignals = Array.isArray(summary?.diagnostics?.contradictionSignals)
    ? summary.diagnostics.contradictionSignals
    : [];
  const knowledgeGraphs = summary?.diagnostics?.graphs ?? null;
  const repairLoop = summary?.diagnostics?.repairLoop ?? null;
  const coverageSignals: Array<{
    id: string;
    severity: "info" | "warning";
    message: string;
  }> = [];
  const stalenessSignals: Array<{
    id: string;
    severity: "info" | "warning";
    message: string;
  }> = [];
  const openKnowledgeIncidents = (state.incidentLedger ?? []).filter(
    (incident) =>
      incident.status !== "resolved" && incident.classification === "knowledge",
  ).length;
  const repairSignals: Array<{
    id: string;
    severity: "info" | "warning";
    message: string;
  }> = [];

  if (state.indexedDocs > 0 && totalEntries === 0) {
    coverageSignals.push({
      id: "knowledge-coverage-gap",
      severity: "warning",
      message:
        "Document roots are indexed, but the knowledge base has no persisted entries yet.",
    });
  }

  if (totalEntries > 0 && totalConcepts === 0) {
    coverageSignals.push({
      id: "knowledge-concept-gap",
      severity: "info",
      message:
        "Knowledge entries exist, but the concept graph is still empty or unlinked.",
    });
  }

  if (freshness?.status === "stale") {
    stalenessSignals.push({
      id: "knowledge-stale",
      severity: "warning",
      message: "All current knowledge entries are older than the configured freshness window.",
    });
  } else if (freshness?.status === "aging") {
    stalenessSignals.push({
      id: "knowledge-aging",
      severity: "info",
      message:
        "The knowledge base contains a mix of fresh and stale entries and needs refresh attention.",
    });
  }

  if (
    state.lastDriftRepairAt &&
    freshness?.latestEntryUpdatedAt &&
    Date.parse(state.lastDriftRepairAt) >
      Date.parse(freshness.latestEntryUpdatedAt)
  ) {
    stalenessSignals.push({
      id: "knowledge-behind-drift-repair",
      severity: "warning",
      message:
        "A newer drift repair completed after the latest knowledge entry update.",
    });
  }

  if (repairLoop?.status === "repair-needed") {
    repairSignals.push({
      id: "knowledge-repair-needed",
      severity: "warning",
      message:
        "Knowledge diagnostics require an explicit repair loop before downstream agents should treat them as stable.",
    });
  } else if (repairLoop?.status === "watching") {
    repairSignals.push({
      id: "knowledge-repair-watching",
      severity: "info",
      message:
        "Knowledge diagnostics are aging or partially contradictory and should stay on operator watch.",
    });
  }

  if (openKnowledgeIncidents > 0) {
    repairSignals.push({
      id: "knowledge-open-incidents",
      severity: "warning",
      message: `${openKnowledgeIncidents} open incident(s) are currently linked to the knowledge truth layer.`,
    });
  }

  return {
    index: {
      indexedDocs: state.indexedDocs,
      docIndexVersion: state.docIndexVersion,
      docsConfigured: Boolean(config.docsPath),
      cookbookConfigured: Boolean(config.cookbookPath),
    },
    coverage: {
      entryCount: totalEntries,
      indexedDocCount: state.indexedDocs,
      entryToDocRatio:
        state.indexedDocs > 0
          ? Number((totalEntries / state.indexedDocs).toFixed(4))
          : null,
    },
    freshness: {
      status: freshness?.status ?? "empty",
      lastUpdated: summary?.lastUpdated ?? null,
      latestEntryUpdatedAt: freshness?.latestEntryUpdatedAt ?? null,
      lastDriftRepairAt: state.lastDriftRepairAt ?? null,
      stateUpdatedAt: state.updatedAt ?? null,
      staleAfterHours: freshness?.staleAfterHours ?? null,
    },
    signals: {
      coverage: coverageSignals,
      staleness: stalenessSignals,
      contradictions: contradictionSignals,
      repair: repairSignals,
    },
    graphs: {
      provenance: knowledgeGraphs?.provenance ?? null,
      contradictions: knowledgeGraphs?.contradictions ?? null,
      freshness: knowledgeGraphs?.freshness ?? null,
    },
    repairLoop: {
      status: repairLoop?.status ?? "clear",
      recommendedTaskType: repairLoop?.recommendedTaskType ?? "drift-repair",
      contradictionCount: Number(repairLoop?.contradictionCount ?? contradictionSignals.length),
      contradictionEntryIds: Array.isArray(repairLoop?.contradictionEntryIds)
        ? repairLoop.contradictionEntryIds
        : [],
      unknownProvenanceCount: Number(
        repairLoop?.unknownProvenanceCount ??
          summary?.diagnostics?.provenance?.unknownProvenanceCount ??
          0,
      ),
      freshnessStatus: repairLoop?.freshnessStatus ?? freshness?.status ?? "empty",
      openKnowledgeIncidents,
      focusAreas: Array.isArray(repairLoop?.focusAreas) ? repairLoop.focusAreas : [],
      nextActions: Array.isArray(repairLoop?.nextActions) ? repairLoop.nextActions : [],
      lastDriftRepairAt: state.lastDriftRepairAt ?? null,
    },
  };
}

function buildClaimedTruthLayer(
  config: Awaited<ReturnType<typeof loadConfig>>,
  declaredAgents: number,
): ClaimedTruthLayer {
  const approvalGatedTaskTypes = Array.from(
    new Set(
      (config.approvalRequiredTaskTypes ?? ["agent-deploy", "build-refactor"]).map(
        (taskType) => String(taskType),
      ),
    ),
  ).sort();

  return {
    status: "declared",
    summary: `${declaredAgents} declared agents and ${ALLOWED_TASK_TYPES.length} allowlisted task types are exposed through the orchestrator control plane.`,
    controlPlane: "orchestrator",
    privateOperatorSurface: "/operator",
    authoritativeHealthRoute: "/api/health/extended",
    aggregateOverviewRoute: "/api/dashboard/overview",
    declaredAgents,
    allowlistedTaskTypes: ALLOWED_TASK_TYPES.length,
    approvalGatedTaskTypes,
    evidence: [
      {
        id: "claimed-control-plane",
        label: "Control Plane",
        status: "declared",
        detail: "Orchestrator owns private operator APIs, queueing, approvals, and runtime state.",
        route: "/operator",
        value: "orchestrator",
      },
      {
        id: "claimed-health-route",
        label: "Authoritative Health Route",
        status: "declared",
        detail: "Extended health is the protected runtime truth surface.",
        route: "/api/health/extended",
      },
      {
        id: "claimed-overview-route",
        label: "Aggregate Overview Route",
        status: "declared",
        detail: "Dashboard overview is an operator aggregation, not stronger than its source routes.",
        route: "/api/dashboard/overview",
      },
      {
        id: "claimed-agent-catalog",
        label: "Declared Agents",
        status: "declared",
        detail: "Agent catalog discovered from manifests and runtime registry.",
        value: declaredAgents,
      },
    ],
    signals:
      approvalGatedTaskTypes.length > 0
        ? [
            {
              id: "claimed-approval-policy",
              severity: "info",
              message: `${approvalGatedTaskTypes.length} task type(s) are approval-gated by declared policy.`,
              relatedRoutes: ["/api/approvals/pending"],
            },
          ]
        : [],
  };
}

function buildRuntimeTruthLayers({
  claimed,
  config,
  state,
  fastStartMode,
  persistenceStatus,
  knowledgeRuntime,
  queueQueued,
  queueProcessing,
  pendingApprovalsCount,
  repairs,
  retryRecoveries,
  agents,
  githubWorkflowMonitor,
}: {
  claimed: ClaimedTruthLayer;
  config: Awaited<ReturnType<typeof loadConfig>>;
  state: OrchestratorState;
  fastStartMode: boolean;
  persistenceStatus: string;
  knowledgeRuntime: ReturnType<typeof buildKnowledgeRuntimeSignals>;
  queueQueued: number;
  queueProcessing: number;
  pendingApprovalsCount: number;
  repairs: {
    activeCount: number;
    verifiedCount: number;
    failedCount: number;
    lastDetectedAt: string | null;
  };
  retryRecoveries: {
    count: number;
    nextRetryAt: string | null;
  };
  agents: Awaited<ReturnType<typeof buildAgentOperationalOverview>>;
  githubWorkflowMonitor: GitHubWorkflowMonitorState;
}): RuntimeTruthLayers {
  const configuredStatus =
    config.stateFile && config.docsPath ? "configured" : "partial";
  const publicProofRoutesExposed = 6;

  const lastTaskHandledAt =
    [...state.taskHistory]
      .map((task) => task.handledAt)
      .filter((handledAt) => Number.isFinite(Date.parse(handledAt)))
      .sort()
      .at(-1) ?? null;

  const githubWorkflowFailed = githubWorkflowMonitor.status === "failed";
  const githubWorkflowWarning = githubWorkflowMonitor.status === "warning";
  const observedStatus =
    persistenceStatus !== "healthy" ||
    repairs.failedCount > 0 ||
    githubWorkflowFailed
      ? "degraded"
      : fastStartMode ||
          queueProcessing > 0 ||
          queueQueued > 0 ||
          pendingApprovalsCount > 0 ||
          retryRecoveries.count > 0 ||
          repairs.activeCount > 0 ||
          githubWorkflowWarning
        ? "warning"
        : "stable";

  const serviceAvailableCount = agents.filter((agent) => agent.serviceAvailable).length;
  const serviceExpectedCount = agents.filter((agent) => agent.serviceExpected).length;
  const serviceInstalledCount = agents.filter(
    (agent) => agent.serviceInstalled === true,
  ).length;
  const serviceRunningCount = agents.filter(
    (agent) => agent.serviceRunning === true,
  ).length;
  const serviceExpectedInstalledCount = agents.filter(
    (agent) => agent.serviceExpected && agent.serviceInstalled === true,
  ).length;
  const serviceExpectedRunningCount = agents.filter(
    (agent) => agent.serviceExpected && agent.serviceRunning === true,
  ).length;
  const missingServiceEntrypointCount = agents.filter(
    (agent) => agent.serviceExpected && !agent.serviceAvailable,
  ).length;
  const serviceExpectedGapCount = agents.filter(
    (agent) =>
      agent.serviceExpected &&
      (!agent.serviceAvailable || agent.serviceInstalled !== true || agent.serviceRunning !== true),
  ).length;
  const knowledgeIndexedEntries = Number(knowledgeRuntime.coverage.entryCount ?? 0);

  const configuredSignals: TruthSignal[] = [];
  if (!config.docsPath) {
    configuredSignals.push({
      id: "configured-docs-missing",
      severity: "warning",
      message: "docsPath is not configured; repository knowledge intake is reduced.",
    });
  }
  if (!config.stateFile) {
    configuredSignals.push({
      id: "configured-state-file-missing",
      severity: "critical",
      message: "stateFile is not configured; durable orchestrator state is undefined.",
    });
  }

  const observedSignals: TruthSignal[] = [];
  if (persistenceStatus !== "healthy") {
    observedSignals.push({
      id: "observed-persistence-degraded",
      severity: "critical",
      message: `Persistence is currently ${persistenceStatus}.`,
      relatedRoutes: ["/api/persistence/health", "/api/health/extended"],
    });
  }
  if (queueQueued > 0 || queueProcessing > 0) {
    observedSignals.push({
      id: "observed-queue-pressure",
      severity: queueQueued > 10 ? "warning" : "info",
      message: `${queueQueued} queued and ${queueProcessing} processing tasks are currently in flight.`,
      relatedRoutes: ["/api/tasks/runs"],
    });
  }
  if (pendingApprovalsCount > 0) {
    observedSignals.push({
      id: "observed-approval-backlog",
      severity: pendingApprovalsCount > 3 ? "warning" : "info",
      message: `${pendingApprovalsCount} approval-gated task(s) are waiting on operator review.`,
      relatedRoutes: ["/api/approvals/pending"],
    });
  }
  if (repairs.failedCount > 0 || repairs.activeCount > 0) {
    observedSignals.push({
      id: "observed-repairs-active",
      severity: repairs.failedCount > 0 ? "critical" : "warning",
      message:
        repairs.failedCount > 0
          ? `${repairs.failedCount} repair flow(s) have failed verification.`
          : `${repairs.activeCount} repair flow(s) are actively running.`,
      relatedRoutes: ["/api/dashboard/overview", "/api/health/extended"],
    });
  }
  if (retryRecoveries.count > 0) {
    observedSignals.push({
      id: "observed-retry-recovery",
      severity: "warning",
      message: `${retryRecoveries.count} persisted retry recovery task(s) are awaiting replay.`,
      relatedRoutes: ["/api/tasks/runs"],
    });
  }
  if (serviceExpectedGapCount > 0) {
    observedSignals.push({
      id: "observed-service-gaps",
      severity: "warning",
      message: `${serviceExpectedRunningCount}/${serviceExpectedCount} service-expected agent(s) are currently running; ${serviceExpectedGapCount} still have unmet host or implementation requirements.`,
      relatedRoutes: ["/api/agents/overview"],
    });
  }
  if (
    githubWorkflowMonitor.enabled &&
    (githubWorkflowMonitor.status === "failed" ||
      githubWorkflowMonitor.status === "warning")
  ) {
    observedSignals.push({
      id: "observed-github-actions",
      severity:
        githubWorkflowMonitor.status === "failed" ? "warning" : "info",
      message: githubWorkflowMonitor.summary,
      relatedRoutes: ["/api/health/extended", "/api/dashboard/overview"],
    });
  }
  if ((knowledgeRuntime.signals.staleness?.length ?? 0) > 0) {
    observedSignals.push({
      id: "observed-knowledge-staleness",
      severity: "warning",
      message: `${knowledgeRuntime.signals.staleness.length} knowledge freshness signal(s) are active.`,
      relatedRoutes: ["/api/knowledge/summary"],
    });
  }
  if ((knowledgeRuntime.signals.contradictions?.length ?? 0) > 0) {
    observedSignals.push({
      id: "observed-knowledge-contradictions",
      severity: "warning",
      message: `${knowledgeRuntime.signals.contradictions.length} knowledge contradiction signal(s) were detected.`,
      relatedRoutes: ["/api/knowledge/summary"],
    });
  }

  return {
    claimed,
    configured: {
      status: configuredStatus,
      summary:
        configuredStatus === "partial"
          ? "Some control-plane prerequisites are still missing."
          : "Runtime configuration is present for the control plane.",
      fastStartMode,
      docsConfigured: Boolean(config.docsPath),
      cookbookConfigured: Boolean(config.cookbookPath),
      stateFileConfigured: Boolean(config.stateFile),
      evidence: [
        {
          id: "configured-docs-path",
          label: "Docs Root",
          status: config.docsPath ? "configured" : "missing",
          detail: config.docsPath
            ? "Primary repository docs root is configured."
            : "Primary docs root is not configured.",
          value: config.docsPath ?? null,
        },
        {
          id: "configured-cookbook-path",
          label: "Cookbook Root",
          status: config.cookbookPath ? "configured" : "optional",
          detail: config.cookbookPath
            ? "Cookbook clue root is configured."
            : "Cookbook clue root is not configured.",
          value: config.cookbookPath ?? null,
        },
        {
          id: "configured-state-file",
          label: "State File",
          status: config.stateFile ? "configured" : "missing",
          detail: config.stateFile
            ? "Durable orchestrator state file is configured."
            : "No durable state file is configured.",
          value: config.stateFile ?? null,
        },
        {
          id: "configured-public-proof",
          label: "Public Proof Routes",
          status: configuredStatus,
          detail: `${publicProofRoutesExposed} orchestrator-owned public proof route(s) are served directly without an external delivery transport.`,
          value: publicProofRoutesExposed,
        },
      ],
      signals: configuredSignals,
    },
    observed: {
      status: observedStatus,
      summary:
        observedStatus === "degraded"
          ? "Runtime evidence shows degraded persistence, repairs, CI, or proof delivery."
          : observedStatus === "warning"
            ? "Runtime evidence shows queue, approval, retry, freshness, or workflow pressure."
            : "Runtime evidence is stable across queue, approvals, services, and proof delivery.",
      queue: {
        queued: queueQueued,
        processing: queueProcessing,
      },
      approvals: {
        pendingCount: pendingApprovalsCount,
      },
      repairs,
      retryRecoveries,
      recentTasks: {
        count: state.taskHistory.length,
        lastHandledAt: lastTaskHandledAt,
      },
      serviceMode: {
        expectedCount: serviceExpectedCount,
        entrypointCount: serviceAvailableCount,
        installedCount: serviceExpectedInstalledCount,
        runningCount: serviceExpectedRunningCount,
        missingEntrypointCount: missingServiceEntrypointCount,
        gapCount: serviceExpectedGapCount,
      },
      persistenceStatus,
      knowledgeIndexedEntries,
      evidence: [
        {
          id: "observed-queue",
          label: "Queue Runtime",
          status: queueQueued > 0 || queueProcessing > 0 ? "active" : "idle",
          detail: `${queueQueued} queued, ${queueProcessing} processing.`,
        },
        {
          id: "observed-approvals",
          label: "Approval Runtime",
          status: pendingApprovalsCount > 0 ? "waiting" : "clear",
          detail: `${pendingApprovalsCount} approval-gated task(s) are pending.`,
        },
        {
          id: "observed-repairs",
          label: "Repair Runtime",
          status:
            repairs.failedCount > 0
              ? "degraded"
              : repairs.activeCount > 0
                ? "active"
                : "stable",
          detail: `${repairs.activeCount} active, ${repairs.verifiedCount} verified, ${repairs.failedCount} failed.`,
        },
        {
          id: "observed-services",
          label: "Agent Services",
          status:
            serviceExpectedGapCount > 0 ? "warning" : "stable",
          detail: `${serviceExpectedRunningCount}/${serviceExpectedCount} service-expected agents running, ${serviceExpectedInstalledCount}/${serviceExpectedCount} installed, ${serviceAvailableCount} entrypoints present.`,
        },
        {
          id: "observed-knowledge",
          label: "Knowledge Runtime",
          status: String(knowledgeRuntime.freshness.status ?? "empty"),
          detail: `${knowledgeIndexedEntries} entries, ${knowledgeRuntime.signals.contradictions.length} contradiction signal(s).`,
        },
        ...(githubWorkflowMonitor.enabled
          ? [
              {
                id: "observed-github-actions",
                label: "GitHub Actions",
                status: githubWorkflowMonitor.status,
                detail: githubWorkflowMonitor.summary,
                route: githubWorkflowMonitor.latestRun?.url ?? null,
                value: githubWorkflowMonitor.repository,
              },
            ]
          : []),
      ],
      signals: observedSignals,
    },
  };
}

function sortPublicMilestones(events: PublicMilestoneEvent[]) {
  return [...events].sort((left, right) => {
    const leftTs = Date.parse(left.timestampUtc);
    const rightTs = Date.parse(right.timestampUtc);
    if (!Number.isFinite(leftTs) && !Number.isFinite(rightTs)) {
      return left.milestoneId.localeCompare(right.milestoneId);
    }
    if (!Number.isFinite(leftTs)) return 1;
    if (!Number.isFinite(rightTs)) return -1;
    if (leftTs === rightTs) {
      return left.milestoneId.localeCompare(right.milestoneId);
    }
    return rightTs - leftTs;
  });
}

function limitPublicMilestoneEvidence(
  evidence: PublicMilestoneEvent["evidence"],
  limit: number = 4,
) {
  return evidence.slice(0, limit);
}

function mapIncidentRiskStatus(
  incident: RuntimeIncident,
): PublicMilestoneRiskStatus {
  if (incident.status === "resolved") return "completed";
  if (incident.severity === "critical") return "blocked";
  if (incident.severity === "warning") return "at-risk";
  return "on-track";
}

function mapRepairRiskStatus(
  record: OrchestratorState["repairRecords"][number],
): PublicMilestoneRiskStatus {
  if (record.status === "verified") return "completed";
  if (record.status === "failed") return "blocked";
  if (record.status === "running" || record.status === "queued") return "on-track";
  return "at-risk";
}

function mapTaskRiskStatus(
  record: OrchestratorState["taskHistory"][number],
): PublicMilestoneRiskStatus {
  return record.result === "ok" ? "completed" : "at-risk";
}

function buildPublicProofMilestones(args: {
  state: OrchestratorState;
  incidents: RuntimeIncidentModel;
  truthLayers: RuntimeTruthLayers;
  queueQueued: number;
  queueProcessing: number;
}): PublicMilestoneEvent[] {
  const { state, incidents, truthLayers, queueQueued, queueProcessing } = args;
  const events: PublicMilestoneEvent[] = [];

  for (const incident of incidents.incidents.slice(0, 8)) {
    events.push({
      milestoneId: `incident:${incident.id}`,
      timestampUtc:
        incident.lastSeenAt ??
        incident.detectedAt ??
        incident.firstSeenAt ??
        new Date().toISOString(),
      scope: incident.classification,
      claim: incident.title,
      evidence: limitPublicMilestoneEvidence(
        dedupeStrings([
          ...incident.evidence,
          ...incident.linkedProofDeliveries,
          ...incident.affectedSurfaces,
        ]).map((summary) => ({
          type: "metric" as const,
          path: "/api/health/extended",
          summary,
          ref: incident.id,
        })),
      ),
      riskStatus: mapIncidentRiskStatus(incident),
      nextAction:
        incident.remediation.nextAction ||
        incident.recommendedSteps[0] ||
        "Review extended runtime health and linked evidence.",
      source: incident.owner ? "operator" : "orchestrator",
    });
  }

  for (const record of [...state.repairRecords]
    .sort((left, right) =>
      String(
        right.verifiedAt ??
          right.completedAt ??
          right.startedAt ??
          right.queuedAt ??
          right.detectedAt,
      ).localeCompare(
        String(
          left.verifiedAt ??
            left.completedAt ??
            left.startedAt ??
            left.queuedAt ??
            left.detectedAt,
        ),
      ),
    )
    .slice(0, 6)) {
    events.push({
      milestoneId: `repair:${record.repairId}`,
      timestampUtc:
        record.verifiedAt ??
        record.completedAt ??
        record.startedAt ??
        record.queuedAt ??
        record.detectedAt,
      scope: record.classification,
      claim:
        record.status === "verified"
          ? `Repair ${record.repairId} verified successfully.`
          : record.status === "failed"
            ? `Repair ${record.repairId} failed verification.`
            : `Repair ${record.repairId} is ${record.status}.`,
      evidence: limitPublicMilestoneEvidence(
        dedupeStrings([
          ...(record.evidence ?? []),
          ...(record.affectedPaths ?? []),
          record.verificationSummary,
          record.lastError,
        ]).map((summary) => ({
          type: "log" as const,
          path: "/api/dashboard/overview",
          summary,
          ref: record.repairId,
        })),
      ),
      riskStatus: mapRepairRiskStatus(record),
      nextAction:
        record.status === "verified"
          ? "Monitor the repaired lane for further drift signals."
          : record.status === "failed"
            ? "Review failed verification evidence before retrying."
            : "Allow the active repair lane to complete and verify.",
      source: "agent",
    });
  }

  for (const record of [...state.taskHistory]
    .sort((left, right) => right.handledAt.localeCompare(left.handledAt))
    .slice(0, 8)) {
    events.push({
      milestoneId: `task:${record.id}`,
      timestampUtc: record.handledAt,
      scope: record.type,
      claim:
        typeof record.message === "string" && record.message.trim().length > 0
          ? record.message
          : `${record.type} ${record.result === "ok" ? "completed" : "reported an error"}.`,
      evidence: limitPublicMilestoneEvidence([
        {
          type: "log",
          path: "/api/tasks/runs",
          summary: `task ${record.id} handled as ${record.result}`,
          ref: record.id,
        },
      ]),
      riskStatus: mapTaskRiskStatus(record),
      nextAction:
        record.result === "ok"
          ? `Monitor the next ${record.type} cycle.`
          : `Inspect recent task runs for ${record.type}.`,
      source: "orchestrator",
    });
  }

  if (queueQueued > 0 || queueProcessing > 0 || state.rssDrafts.length > 0) {
    const latestDemandAt =
      [...state.redditQueue].map((item) => item.queuedAt).sort().at(-1) ??
      [...state.rssDrafts].map((item) => item.queuedAt).sort().at(-1) ??
      state.updatedAt ??
      new Date().toISOString();
    events.push({
      milestoneId: "demand:runtime-summary",
      timestampUtc: latestDemandAt,
      scope: "demand-runtime",
      claim: `Demand runtime currently holds ${queueQueued} queued lead(s), ${queueProcessing} active task(s), and ${state.rssDrafts.length} draft candidate(s).`,
      evidence: limitPublicMilestoneEvidence([
        {
          type: "metric",
          path: "/api/command-center/demand-live",
          summary: `${queueQueued} queued lead(s) remain in the demand queue.`,
        },
        {
          type: "metric",
          path: "/api/command-center/demand-live",
          summary: `${state.rssDrafts.length} scored RSS draft(s) are available for drafting.`,
        },
      ]),
      riskStatus: queueQueued > 12 ? "at-risk" : "on-track",
      nextAction:
        queueQueued > 0
          ? "Route the next demand items through the drafting lane."
          : "Watch for the next demand intake pulse.",
      source: "orchestrator",
    });
  }

  events.push({
    milestoneId: "truth:observed-runtime",
    timestampUtc: state.updatedAt ?? new Date().toISOString(),
    scope: "runtime-truth",
    claim: truthLayers.observed.summary,
    evidence: limitPublicMilestoneEvidence(
      truthLayers.observed.evidence.map((item) => ({
        type: "metric" as const,
        path: item.route ?? "/api/health/extended",
        summary: `${item.label}: ${item.detail}`,
        ref: item.id,
      })),
    ),
    riskStatus:
      truthLayers.observed.status === "degraded"
        ? "blocked"
        : truthLayers.observed.status === "warning"
          ? "at-risk"
          : "on-track",
    nextAction:
      truthLayers.observed.signals[0]?.message ??
      "Review live runtime health for the latest operational truth.",
    source: "orchestrator",
  });

  const deduped = new Map<string, PublicMilestoneEvent>();
  for (const event of sortPublicMilestones(events)) {
    if (!deduped.has(event.milestoneId)) {
      deduped.set(event.milestoneId, event);
    }
  }
  return [...deduped.values()];
}

function buildPublicProofDeadLetter(
  milestones: PublicMilestoneEvent[],
): PublicMilestoneEvent[] {
  return milestones.filter((item) =>
    item.riskStatus === "blocked" || item.riskStatus === "at-risk",
  );
}

function buildPublicProofNodes(args: {
  truthLayers: RuntimeTruthLayers;
  incidents: RuntimeIncidentModel;
  queueQueued: number;
  queueProcessing: number;
  milestones: PublicMilestoneEvent[];
  deadLetter: PublicMilestoneEvent[];
}): Array<{
  id: "emit" | "verify" | "store" | "canon" | "broadcast" | "surface";
  label: string;
  state: "live" | "warning" | "idle";
  detail: string;
}> {
  const { truthLayers, incidents, queueQueued, queueProcessing, milestones, deadLetter } =
    args;
  return [
    {
      id: "emit",
      label: "Emit",
      state:
        queueQueued > 0 || queueProcessing > 0 || milestones.length > 0 ? "live" : "idle",
      detail: `${queueQueued} queued, ${queueProcessing} processing.`,
    },
    {
      id: "verify",
      label: "Verify",
      state: deadLetter.length > 0 ? "warning" : "live",
      detail:
        deadLetter.length > 0
          ? `${deadLetter.length} proof-risk item(s) require review.`
          : "No degraded public-proof items are currently active.",
    },
    {
      id: "store",
      label: "Store",
      state:
        truthLayers.observed.persistenceStatus === "healthy" ? "live" : "warning",
      detail: `Persistence is ${truthLayers.observed.persistenceStatus}.`,
    },
    {
      id: "canon",
      label: "Canon",
      state:
        truthLayers.observed.status === "stable"
          ? "live"
          : truthLayers.observed.status === "warning"
            ? "warning"
            : "idle",
      detail: truthLayers.observed.summary,
    },
    {
      id: "broadcast",
      label: "Broadcast",
      state: milestones.length > 0 ? (deadLetter.length > 0 ? "warning" : "live") : "idle",
      detail: `${milestones.length} milestone(s) currently visible on the public feed.`,
    },
    {
      id: "surface",
      label: "Surface",
      state: incidents.overallStatus === "critical" ? "warning" : "live",
      detail:
        incidents.overallStatus === "critical"
          ? "Public proof is up, but the runtime is under critical incident pressure."
          : "Public proof is being served directly by the orchestrator.",
    },
  ];
}

function prioritizePublicProofActiveLanes(lanes: string[], limit: number = 8) {
  const deduped = dedupeStrings(lanes, Math.max(limit * 4, 16));
  const priorityLanes = ["demand-runtime"];
  return [
    ...priorityLanes.filter((lane) => deduped.includes(lane)),
    ...deduped.filter((lane) => !priorityLanes.includes(lane)),
  ].slice(0, limit);
}

function buildPublicProofOverview(args: {
  milestones: PublicMilestoneEvent[];
  deadLetter: PublicMilestoneEvent[];
  proofNodes: Array<{
    id: "emit" | "verify" | "store" | "canon" | "broadcast" | "surface";
    label: string;
    state: "live" | "warning" | "idle";
    detail: string;
  }>;
  generatedAt: string;
  stateUpdatedAt: string | null;
}) {
  const { milestones, deadLetter, proofNodes, generatedAt, stateUpdatedAt } = args;
  const latest = milestones[0] ?? null;
  const riskCounts = milestones.reduce(
    (acc, event) => {
      if (event.riskStatus === "on-track") acc.onTrack += 1;
      if (event.riskStatus === "at-risk") acc.atRisk += 1;
      if (event.riskStatus === "blocked") acc.blocked += 1;
      if (event.riskStatus === "completed") acc.completed += 1;
      return acc;
    },
    { onTrack: 0, atRisk: 0, blocked: 0, completed: 0 },
  );
  const activeLanes = prioritizePublicProofActiveLanes(
    milestones
      .filter((event) => event.riskStatus !== "completed")
      .map((event) => event.scope),
  );
  const evidenceCount = milestones.reduce(
    (acc, event) => acc + event.evidence.length,
    0,
  );
  const freshnessSource = latest?.timestampUtc ?? stateUpdatedAt;
  const stale = !freshnessSource
    ? true
    : Date.now() - Date.parse(freshnessSource) > 1000 * 60 * 90;

  return {
    ok: true,
    latest,
    stale,
    visibleFeedCount: milestones.length,
    evidenceCount,
    activeLaneCount: activeLanes.length,
    activeLanes,
    riskCounts,
    deadLetterCount: deadLetter.length,
    lastPollAt: generatedAt,
    realtimeChannel: "/api/command-center/overview",
    proofNodes,
  };
}

function buildPublicProofControl(args: {
  agents: Awaited<ReturnType<typeof buildAgentOperationalOverview>>;
  approvalRequiredTaskTypes: string[];
}) {
  const approvalRequired = new Set(args.approvalRequiredTaskTypes);
  const clusters = new Map(
    [
      ["services", { id: "services", label: "Persistent Services", engines: [] as any[] }],
      [
        "approval-gated",
        { id: "approval-gated", label: "Approval-Gated Workers", engines: [] as any[] },
      ],
      ["workers", { id: "workers", label: "Bounded Workers", engines: [] as any[] }],
    ] as const,
  );

  for (const agent of args.agents) {
    const bucket = agent.serviceExpected
      ? "services"
      : agent.orchestratorTask && approvalRequired.has(agent.orchestratorTask)
        ? "approval-gated"
        : "workers";
    const cluster = clusters.get(bucket);
    if (!cluster) continue;
    cluster.engines.push({
      id: agent.id,
      name: agent.name,
      task: agent.orchestratorTask ?? "service-runtime",
      model: agent.modelTier ?? "unspecified",
      tier:
        agent.modelTier === "cheap" ||
        agent.modelTier === "balanced" ||
        agent.modelTier === "heavy" ||
        agent.modelTier === "strategic" ||
        agent.modelTier === "service-native"
          ? agent.modelTier
          : "balanced",
      allowedSkills: agent.allowedSkills ?? [],
      networkMode: agent.serviceExpected
        ? "service-native"
        : (agent.allowedSkills ?? []).includes("sourceFetch")
          ? "allowlisted"
          : "local",
      timeoutLabel: agent.serviceExpected ? "service-managed" : "runtime-bounded",
      approvalClass: agent.serviceExpected
        ? "service-native"
        : agent.orchestratorTask && approvalRequired.has(agent.orchestratorTask)
          ? "approval-gated"
          : "bounded",
    });
  }

  return {
    ok: true,
    clusters: [...clusters.values()].filter((cluster) => cluster.engines.length > 0),
  };
}

function buildPublicProofDemand(args: {
  state: OrchestratorState;
  queueQueued: number;
  queueProcessing: number;
  mode: "snapshot" | "live";
}) {
  const { state, queueQueued, queueProcessing, mode } = args;
  const segmentMap = new Map<
    string,
    {
      id: string;
      label: string;
      clusterLabels: string[];
      staticWeight: number;
      liveSignalCount: number;
      state: "hot" | "warm" | "idle";
    }
  >();

  const upsertSegment = (label: string, clusterLabel: string, weight: number) => {
    const key = label.toLowerCase();
    const existing = segmentMap.get(key) ?? {
      id: key.replace(/[^a-z0-9]+/g, "-") || "unclassified",
      label,
      clusterLabels: [],
      staticWeight: 0,
      liveSignalCount: 0,
      state: "idle" as const,
    };
    existing.staticWeight += weight;
    existing.liveSignalCount += 1;
    if (!existing.clusterLabels.includes(clusterLabel)) {
      existing.clusterLabels.push(clusterLabel);
    }
    existing.state =
      existing.liveSignalCount >= 6 || existing.staticWeight >= 12
        ? "hot"
        : existing.liveSignalCount >= 2 || existing.staticWeight >= 4
          ? "warm"
          : "idle";
    segmentMap.set(key, existing);
  };

  for (const item of state.redditQueue) {
    upsertSegment(item.pillar ?? item.subreddit ?? "community", item.tag ?? "queue", 1);
  }
  for (const draft of state.rssDrafts) {
    upsertSegment(draft.pillar ?? draft.subreddit ?? "draft", draft.tag, Math.max(1, Math.round(draft.totalScore || 1)));
  }

  const segments = [...segmentMap.values()]
    .sort((left, right) => {
      if (right.liveSignalCount !== left.liveSignalCount) {
        return right.liveSignalCount - left.liveSignalCount;
      }
      return right.staticWeight - left.staticWeight;
    })
    .slice(0, 10);

  const latestTimestamp =
    [...state.redditQueue].map((item) => item.queuedAt).sort().at(-1) ??
    [...state.rssDrafts].map((item) => item.queuedAt).sort().at(-1) ??
    state.updatedAt ??
    null;
  const stale = !latestTimestamp
    ? true
    : Date.now() - Date.parse(latestTimestamp) > 1000 * 60 * 90;
  const topSegment = segments[0] ?? null;
  const hotSegments = segments.filter((segment) => segment.state === "hot").length;
  const selectedForDraftTotal = state.redditQueue.filter(
    (item) => item.selectedForDraft === true,
  ).length;
  const draftTotal = state.rssDrafts.length;

  return {
    ok: true,
    segments,
    summary: {
      totalSegments: segments.length,
      hotSegments,
      demandNarrative:
        topSegment
          ? `${topSegment.label} is currently the highest-signal demand lane with ${topSegment.liveSignalCount} live signal(s).`
          : "No active demand segments are currently visible.",
      topSegmentLabel: topSegment?.label ?? null,
      topPillarLabel: topSegment?.label ?? null,
      stale,
      source: stale ? (mode === "live" ? "stale" : "fallback") : "live",
      snapshotGeneratedAt: latestTimestamp,
      queueTotal: queueQueued,
      draftTotal,
      selectedForDraftTotal,
    },
  };
}

async function buildAgentTopology({
  agents,
  state,
}: {
  agents: Awaited<ReturnType<typeof buildAgentOperationalOverview>>;
  state: OrchestratorState;
}): Promise<AgentTopology> {
  const registry = await getAgentRegistry();
  const nodes = new Map<string, AgentTopologyNode>();
  const edges = new Map<string, AgentTopologyEdge>();
  const edgeSeverityRank: Record<TopologyEdgeStatus, number> = {
    declared: 0,
    live: 1,
    warning: 2,
    degraded: 3,
  };

  const addNode = (node: AgentTopologyNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };

  const addEdge = (edge: AgentTopologyEdge) => {
    const existing = edges.get(edge.id);
    if (!existing) {
      edges.set(edge.id, edge);
      return;
    }

    const mergedEvidence = dedupeStrings(
      [...existing.evidence, ...edge.evidence],
      25,
    );
    const mergedSources = dedupeStrings(
      [...(existing.sources ?? []), ...(edge.sources ?? [])],
      12,
    );
    const status =
      edgeSeverityRank[edge.status] >= edgeSeverityRank[existing.status]
        ? edge.status
        : existing.status;
    const detail =
      typeof edge.observedCount === "number" && edge.observedCount > 0
        ? edge.detail
        : existing.detail;
    const observedCount =
      (existing.observedCount ?? 0) + (edge.observedCount ?? 0) || undefined;
    const lastObservedAt = [existing.lastObservedAt, edge.lastObservedAt]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .sort((left, right) => Date.parse(right) - Date.parse(left))
      .at(0) ?? null;

    edges.set(edge.id, {
      ...existing,
      ...edge,
      status,
      detail,
      evidence: mergedEvidence,
      observedCount,
      lastObservedAt,
      sources: mergedSources,
    });
  };

  const ensureObservedNode = (nodeId: string) => {
    if (nodes.has(nodeId)) return;
    if (nodeId.startsWith("agent:")) {
      addNode({
        id: nodeId,
        kind: "agent",
        label: nodeId.slice("agent:".length),
        status: "warning",
        detail: "Observed runtime relationship node.",
        route: "/api/agents/overview",
      });
      return;
    }
    if (nodeId.startsWith("task:")) {
      addNode({
        id: nodeId,
        kind: "task",
        label: nodeId.slice("task:".length),
        status: "warning",
        detail: "Observed runtime task node.",
        route: "/api/tasks/catalog",
      });
      return;
    }
    if (nodeId.startsWith("skill:")) {
      addNode({
        id: nodeId,
        kind: "skill",
        label: nodeId.slice("skill:".length),
        status: "warning",
        detail: "Observed runtime skill node.",
      });
      return;
    }
    if (nodeId.startsWith("surface:")) {
      addNode({
        id: nodeId,
        kind: nodeId === "surface:orchestrator" ? "control-plane" : "surface",
        label: nodeId.slice("surface:".length),
        status: "warning",
        detail: "Observed runtime surface node.",
      });
    }
  };

  addNode({
    id: "surface:orchestrator",
    kind: "control-plane",
    label: "orchestrator",
    status: "live",
    detail:
      "Private control plane for queueing, approvals, runtime truth, and task dispatch.",
    route: "/api/dashboard/overview",
  });

  const taskProfileByType = new Map(
    OPERATOR_TASK_PROFILES.map((profile) => [profile.type, profile]),
  );

  for (const agent of agents) {
    const agentStatus: TopologyNodeStatus =
      agent.serviceExpected &&
      (agent.serviceInstalled === false || agent.serviceRunning === false)
        ? "warning"
        : agent.workerValidationStatus === "not-yet-verified" ||
            agent.workerValidationStatus === "partial-worker"
          ? "warning"
          : agent.spawnedWorkerCapable || agent.serviceAvailable
            ? "live"
            : "degraded";

    addNode({
      id: `agent:${agent.id}`,
      kind: "agent",
      label: agent.name,
      status: agentStatus,
      detail:
        agent.description ??
        agent.notes?.[0] ??
        "Registered agent runtime surface.",
      route: "/api/agents/overview",
    });

    const allowedSkills = registry.getAllowedSkills(agent.id);
    for (const skillId of allowedSkills) {
      addNode({
        id: `skill:${skillId}`,
        kind: "skill",
        label: skillId,
        status: agentStatus === "degraded" ? "warning" : "declared",
        detail: "Skill permission declared in the agent manifest.",
      });

      addEdge({
        id: `edge:agent:${agent.id}:skill:${skillId}`,
        from: `agent:${agent.id}`,
        to: `skill:${skillId}`,
        relationship: "uses-skill",
        status: agentStatus === "degraded" ? "warning" : "declared",
        detail: `${agent.name} is permitted to invoke ${skillId}.`,
        evidence: [`manifest skill permission: ${skillId}`],
      });
    }

    if (agent.orchestratorTask) {
      const profile = taskProfileByType.get(agent.orchestratorTask) ?? null;
      addNode({
        id: `task:${agent.orchestratorTask}`,
        kind: "task",
        label: profile?.label ?? agent.orchestratorTask,
        status: agentStatus === "degraded" ? "warning" : "declared",
        detail: profile?.purpose ?? "Manifest-routed runtime task.",
        route: "/api/tasks/catalog",
      });

      addEdge({
        id: `edge:orchestrator:task:${agent.orchestratorTask}`,
        from: "surface:orchestrator",
        to: `task:${agent.orchestratorTask}`,
        relationship: "dispatches-task",
        status: "declared",
        detail: `Orchestrator accepts ${agent.orchestratorTask} into the runtime queue.`,
        evidence: [`allowlisted task: ${agent.orchestratorTask}`],
      });

      addEdge({
        id: `edge:task:${agent.orchestratorTask}:agent:${agent.id}`,
        from: `task:${agent.orchestratorTask}`,
        to: `agent:${agent.id}`,
        relationship: "routes-to-agent",
        status: agentStatus === "degraded" ? "warning" : "live",
        detail: `${agent.orchestratorTask} routes to ${agent.name}.`,
        evidence: [`agent manifest orchestratorTask: ${agent.orchestratorTask}`],
      });
    }
  }

  for (const [taskType, requirement] of Object.entries(TASK_AGENT_SKILL_REQUIREMENTS)) {
    const agent = agents.find((item) => item.id === requirement.agentId) ?? null;
    const agentName = agent?.name ?? requirement.agentId;
    const taskProfile = taskProfileByType.get(taskType) ?? null;
    const taskNodeId = `task:${taskType}`;
    const agentNodeId = `agent:${requirement.agentId}`;
    const skillNodeId = `skill:${requirement.skillId}`;

    addNode({
      id: taskNodeId,
      kind: "task",
      label: taskProfile?.label ?? taskType,
      status: agent ? "declared" : "warning",
      detail: taskProfile?.purpose ?? "Runtime task with explicit agent/skill requirement.",
      route: "/api/tasks/catalog",
    });
    addNode({
      id: skillNodeId,
      kind: "skill",
      label: requirement.skillId,
      status: agent ? "declared" : "warning",
      detail: "Skill required by a routed task contract.",
    });

    addEdge({
      id: `edge:orchestrator:task:${taskType}`,
      from: "surface:orchestrator",
      to: taskNodeId,
      relationship: "dispatches-task",
      status: "declared",
      detail: `Orchestrator can dispatch ${taskType}.`,
      evidence: [`task requirement: ${taskType}`],
    });
    addEdge({
      id: `edge:task:${taskType}:agent:${requirement.agentId}`,
      from: taskNodeId,
      to: agentNodeId,
      relationship: "routes-to-agent",
      status: agent ? "live" : "warning",
      detail: `${taskType} routes to ${agentName}.`,
      evidence: [`task requirement agent: ${requirement.agentId}`],
    });
    addEdge({
      id: `edge:agent:${requirement.agentId}:skill:${requirement.skillId}`,
      from: agentNodeId,
      to: skillNodeId,
      relationship: "uses-skill",
      status: agent ? "declared" : "warning",
      detail: `${agentName} uses ${requirement.skillId} for ${taskType}.`,
      evidence: [`task requirement skill: ${requirement.skillId}`],
    });
  }

  for (const declaration of AGENT_RELATIONSHIP_DECLARATIONS) {
    const sourceAgent = agents.find((agent) => agent.id === declaration.from) ?? null;
    const targetAgent = agents.find((agent) => agent.id === declaration.to) ?? null;
    if (!sourceAgent || !targetAgent) continue;

    const relationshipStatus: TopologyEdgeStatus =
      sourceAgent.capability.currentReadiness === "advanced" &&
      ["operational", "advanced"].includes(targetAgent.capability.currentReadiness)
        ? "live"
        : sourceAgent.capability.currentReadiness === "declared" ||
            targetAgent.capability.currentReadiness === "declared"
          ? "warning"
          : "declared";

    addEdge({
      id: `edge:agent:${declaration.from}:agent:${declaration.to}:${declaration.relationship}`,
      from: `agent:${declaration.from}`,
      to: `agent:${declaration.to}`,
      relationship: declaration.relationship,
      status: relationshipStatus,
      detail: declaration.detail,
      evidence: [
        ...declaration.evidence,
        `source readiness: ${sourceAgent.capability.currentReadiness}`,
        `target readiness: ${targetAgent.capability.currentReadiness}`,
      ],
    });
  }

  const observationGroups = new Map<string, RelationshipObservationRecord[]>();
  for (const observation of state.relationshipObservations ?? []) {
    const key = `${observation.from}|${observation.to}|${observation.relationship}`;
    const existing = observationGroups.get(key) ?? [];
    existing.push(observation);
    observationGroups.set(key, existing);
  }

  for (const [key, observations] of observationGroups.entries()) {
    const latest = [...observations]
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
      .at(0);
    if (!latest) continue;

    ensureObservedNode(latest.from);
    ensureObservedNode(latest.to);
    const topologyStatus: TopologyEdgeStatus =
      latest.status === "degraded"
        ? "degraded"
        : latest.status === "warning"
          ? "warning"
          : "live";
    addEdge({
      id: `edge:${latest.from}:${latest.to}:${latest.relationship}`,
      from: latest.from,
      to: latest.to,
      relationship: latest.relationship,
      status: topologyStatus,
      detail: `${latest.detail} (${observations.length} observed event${observations.length === 1 ? "" : "s"})`,
      evidence: dedupeStrings(
        observations.flatMap((observation) => observation.evidence ?? []),
        25,
      ),
      observedCount: observations.length,
      lastObservedAt: latest.timestamp,
      sources: dedupeStrings(
        observations.map((observation) => observation.source),
        12,
      ),
    });
  }

  const nodeList = Array.from(nodes.values());
  const edgeList = Array.from(edges.values());
  const hotspots: string[] = [];
  const serviceGapCount = agents.filter(
    (agent) =>
      agent.serviceExpected &&
      (agent.serviceInstalled === false || agent.serviceRunning === false),
  ).length;

  if (serviceGapCount > 0) {
    hotspots.push(`${serviceGapCount} agent service path(s) are declared but not fully running.`);
  }
  if (
    agents.some(
      (agent) =>
        agent.workerValidationStatus === "partial-worker" ||
        agent.workerValidationStatus === "not-yet-verified",
    )
  ) {
    hotspots.push("One or more worker paths remain partial or not yet verified.");
  }
  if ((state.relationshipObservations ?? []).length === 0) {
    hotspots.push("Runtime relationship observations have not accumulated yet.");
  }

  const status =
    hotspots.length > 0 ? "warning" : "stable";

  return {
    generatedAt: new Date().toISOString(),
    status,
    counts: {
      controlPlaneNodes: nodeList.filter((node) => node.kind === "control-plane").length,
      taskNodes: nodeList.filter((node) => node.kind === "task").length,
      agentNodes: nodeList.filter((node) => node.kind === "agent").length,
      skillNodes: nodeList.filter((node) => node.kind === "skill").length,
      surfaceNodes: nodeList.filter((node) => node.kind === "surface").length,
      totalNodes: nodeList.length,
      dispatchEdges: edgeList.filter((edge) => edge.relationship === "dispatches-task").length,
      routeEdges: edgeList.filter((edge) => edge.relationship === "routes-to-agent").length,
      skillEdges: edgeList.filter((edge) => edge.relationship === "uses-skill").length,
      proofEdges: edgeList.filter((edge) => edge.relationship === "publishes-proof").length,
      relationshipEdges: edgeList.filter((edge) =>
        [
          "feeds-agent",
          "verifies-agent",
          "monitors-agent",
          "audits-agent",
          "coordinates-agent",
        ].includes(edge.relationship),
      ).length,
      observedEdges: edgeList.filter((edge) => (edge.observedCount ?? 0) > 0).length,
      totalEdges: edgeList.length,
    },
    hotspots,
    nodes: nodeList,
    edges: edgeList,
  };
}

function buildRelationshipHistory(
  state: OrchestratorState,
  options: { windowHours?: number; recentLimit?: number } = {},
): RelationshipHistory {
  const windowHours =
    Number.isFinite(options.windowHours) && Number(options.windowHours) > 0
      ? Math.floor(Number(options.windowHours))
      : 24;
  const recentLimit =
    Number.isFinite(options.recentLimit) && Number(options.recentLimit) > 0
      ? Math.floor(Number(options.recentLimit))
      : 60;
  const observations = [...(state.relationshipObservations ?? [])].sort(
    (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp),
  );
  const byRelationship: Partial<Record<RelationshipObservationType, number>> = {};
  const byStatus: Partial<Record<RelationshipObservationStatus, number>> = {};
  const shortWindowHours = Math.max(6, Math.min(24, windowHours));
  const longWindowHours = Math.max(windowHours, 24 * 7);
  const now = Date.now();
  const windowStart = now - windowHours * 60 * 60 * 1000;
  const shortWindowStart = now - shortWindowHours * 60 * 60 * 1000;
  const longWindowStart = now - longWindowHours * 60 * 60 * 1000;
  const bucketMap = new Map<string, RelationshipHistoryBucket>();
  const graphNodeMap = new Map<
    string,
    {
      id: string;
      label: string;
      kind:
        | "agent"
        | "task"
        | "skill"
        | "surface"
        | "run"
        | "tool"
        | "unknown";
      count: number;
      lastObservedAt: string | null;
    }
  >();
  const graphEdgeMap = new Map<
    string,
    {
      id: string;
      from: string;
      to: string;
      relationship: RelationshipObservationType;
      count: number;
      lastObservedAt: string | null;
      classification: string | null;
    }
  >();

  const summarizeWindow = (hours: number): RelationshipHistoryWindowSummary => {
    const scoped = observations.filter((observation) => {
      const timestamp = Date.parse(observation.timestamp);
      return Number.isFinite(timestamp) && timestamp >= now - hours * 60 * 60 * 1000;
    });
    const scopedByRelationship: Partial<Record<RelationshipObservationType, number>> = {};
    const scopedByStatus: Partial<Record<RelationshipObservationStatus, number>> = {};
    for (const observation of scoped) {
      scopedByRelationship[observation.relationship] =
        (scopedByRelationship[observation.relationship] ?? 0) + 1;
      scopedByStatus[observation.status] = (scopedByStatus[observation.status] ?? 0) + 1;
    }
    const ordered = [...scoped]
      .map((item) => item.timestamp)
      .filter((value) => typeof value === "string" && value.length > 0)
      .sort();
    return {
      windowHours: hours,
      totalObservations: scoped.length,
      lastObservedAt: ordered.at(-1) ?? null,
      firstObservedAt: ordered[0] ?? null,
      byRelationship: scopedByRelationship,
      byStatus: scopedByStatus,
    };
  };

  const inferGraphNode = (raw: string | null | undefined) => {
    const value =
      typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "unknown";
    if (value.startsWith("agent:")) {
      const label = value.slice(6);
      return { id: value, label, kind: "agent" as const };
    }
    if (value.endsWith("-agent")) {
      return { id: `agent:${value}`, label: value, kind: "agent" as const };
    }
    if (value.startsWith("task:")) {
      return { id: `task:${value.slice(5)}`, label: value.slice(5), kind: "task" as const };
    }
    if (value.startsWith("run:")) {
      return { id: `run:${value.slice(4)}`, label: value.slice(4), kind: "run" as const };
    }
    if (value.startsWith("skill:")) {
      return { id: `skill:${value.slice(6)}`, label: value.slice(6), kind: "skill" as const };
    }
    if (value.startsWith("surface:")) {
      const label = value.slice(8);
      return { id: value, label, kind: "surface" as const };
    }
    if (
      value.includes(".service") ||
      value.includes("/api/") ||
      value.includes("proof") ||
      value.includes("surface")
    ) {
      return { id: `surface:${value}`, label: value, kind: "surface" as const };
    }
    if (value.includes("-") && !value.includes(" ")) {
      return { id: `tool:${value}`, label: value, kind: "tool" as const };
    }
    return { id: `unknown:${value}`, label: value, kind: "unknown" as const };
  };

  const upsertGraphNode = (nodeId: string, label: string, kind: RelationshipHistoryGraph["nodes"][number]["kind"], timestamp: string) => {
    const existing = graphNodeMap.get(nodeId) ?? {
      id: nodeId,
      label,
      kind,
      count: 0,
      lastObservedAt: null,
    };
    existing.count += 1;
    if (!existing.lastObservedAt || timestamp > existing.lastObservedAt) {
      existing.lastObservedAt = timestamp;
    }
    graphNodeMap.set(nodeId, existing);
  };

  for (const observation of observations) {
    byRelationship[observation.relationship] =
      (byRelationship[observation.relationship] ?? 0) + 1;
    byStatus[observation.status] = (byStatus[observation.status] ?? 0) + 1;

    const timestamp = Date.parse(observation.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < windowStart) {
      continue;
    }

    const bucketDate = new Date(timestamp);
    bucketDate.setMinutes(0, 0, 0);
    const bucketStart = bucketDate.toISOString();
    const existing = bucketMap.get(bucketStart) ?? {
      bucketStart,
      total: 0,
      byRelationship: {},
      byStatus: {},
    };
    existing.total += 1;
    existing.byRelationship[observation.relationship] =
      (existing.byRelationship[observation.relationship] ?? 0) + 1;
    existing.byStatus[observation.status] =
      (existing.byStatus[observation.status] ?? 0) + 1;
    bucketMap.set(bucketStart, existing);

    if (timestamp >= longWindowStart) {
      const fromNode = inferGraphNode(observation.from);
      const toNode = inferGraphNode(
        observation.toolId ??
          observation.targetRunId ??
          observation.targetTaskId ??
          observation.proofTransport ??
          observation.to,
      );
      upsertGraphNode(fromNode.id, fromNode.label, fromNode.kind, observation.timestamp);
      upsertGraphNode(toNode.id, toNode.label, toNode.kind, observation.timestamp);

      const edgeId = [
        fromNode.id,
        toNode.id,
        observation.relationship,
        observation.classification ?? "unclassified",
      ].join("::");
      const existingEdge = graphEdgeMap.get(edgeId) ?? {
        id: edgeId,
        from: fromNode.id,
        to: toNode.id,
        relationship: observation.relationship,
        count: 0,
        lastObservedAt: null,
        classification: observation.classification ?? null,
      };
      existingEdge.count += 1;
      if (!existingEdge.lastObservedAt || observation.timestamp > existingEdge.lastObservedAt) {
        existingEdge.lastObservedAt = observation.timestamp;
      }
      graphEdgeMap.set(edgeId, existingEdge);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    windowHours,
    totalObservations: observations.length,
    lastObservedAt: observations[0]?.timestamp ?? null,
    byRelationship,
    byStatus,
    timeline: Array.from(bucketMap.values()).sort((left, right) =>
      left.bucketStart.localeCompare(right.bucketStart),
    ),
    recent: observations.slice(0, recentLimit),
    windows: {
      short: summarizeWindow(shortWindowHours),
      long: summarizeWindow(longWindowHours),
    },
    graph: {
      totalNodes: graphNodeMap.size,
      totalEdges: graphEdgeMap.size,
      nodes: Array.from(graphNodeMap.values()).sort(
        (left, right) =>
          (right.lastObservedAt ?? "").localeCompare(left.lastObservedAt ?? "") ||
          right.count - left.count ||
          left.label.localeCompare(right.label),
      ),
      edges: Array.from(graphEdgeMap.values()).sort(
        (left, right) =>
          (right.lastObservedAt ?? "").localeCompare(left.lastObservedAt ?? "") ||
          right.count - left.count ||
          left.id.localeCompare(right.id),
      ),
    },
  };
}

type IncidentCandidate = {
  fingerprint: string;
  title: string;
  classification: IncidentLedgerClassification;
  severity: IncidentLedgerSeverity;
  status: Extract<IncidentLedgerStatus, "active" | "watching">;
  truthLayer: IncidentLedgerTruthLayer;
  summary: string;
  detectedAt: string | null;
  affectedSurfaces: string[];
  linkedServiceIds: string[];
  linkedTaskIds: string[];
  linkedRunIds: string[];
  linkedRepairIds: string[];
  linkedProofDeliveries: string[];
  evidence: string[];
  recommendedSteps: string[];
  remediation: {
    owner: IncidentRemediationOwner;
    status: Exclude<IncidentRemediationStatus, "resolved">;
    summary: string;
    nextAction: string;
    blockers: string[];
  };
};

function buildIncidentFingerprint(
  classification: IncidentLedgerClassification,
  scope: string,
) {
  const digest = createHash("sha1").update(`${classification}:${scope}`).digest("hex");
  return `incident:${classification}:${digest.slice(0, 14)}`;
}

function dedupeStrings(values: Array<string | null | undefined>, limit: number = 12) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))].slice(0, limit);
}

function recordsEqual(left: IncidentLedgerRecord, right: IncidentLedgerRecord) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildIncidentHistoryEventId(
  incidentId: string,
  type: IncidentHistoryEvent["type"],
  timestamp: string,
  summary: string,
) {
  const digest = createHash("sha1")
    .update([incidentId, type, timestamp, summary].join("|"))
    .digest("hex")
    .slice(0, 12);
  return `incident-history:${digest}`;
}

function appendIncidentHistoryEvent(
  record: IncidentLedgerRecord,
  event: Omit<IncidentHistoryEvent, "id" | "evidence"> & {
    evidence?: string[];
  },
) {
  const normalized: IncidentHistoryEvent = {
    id: buildIncidentHistoryEventId(
      record.incidentId,
      event.type,
      event.timestamp,
      event.summary,
    ),
    timestamp: event.timestamp,
    type: event.type,
    actor:
      typeof event.actor === "string" && event.actor.trim().length > 0
        ? event.actor.trim()
        : null,
    summary: event.summary,
    detail:
      typeof event.detail === "string" && event.detail.trim().length > 0
        ? event.detail.trim()
        : null,
    evidence: dedupeStrings(event.evidence ?? [], 25),
  };
  if (record.history.some((item) => item.id === normalized.id)) {
    return normalized;
  }
  record.history.push(normalized);
  record.history = record.history
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .slice(-100);
  return normalized;
}

function appendIncidentPolicyExecution(
  record: IncidentLedgerRecord,
  execution: Omit<IncidentPolicyExecutionRecord, "executionId" | "evidence"> & {
    evidence?: string[];
  },
) {
  const normalized: IncidentPolicyExecutionRecord = {
    executionId: randomUUID(),
    executedAt: execution.executedAt,
    actor: execution.actor,
    policyId: execution.policyId,
    trigger: execution.trigger,
    action: execution.action,
    result: execution.result,
    summary: execution.summary,
    detail:
      typeof execution.detail === "string" && execution.detail.trim().length > 0
        ? execution.detail.trim()
        : null,
    remediationId:
      typeof execution.remediationId === "string" &&
      execution.remediationId.length > 0
        ? execution.remediationId
        : null,
    taskId:
      typeof execution.taskId === "string" && execution.taskId.length > 0
        ? execution.taskId
        : null,
    runId:
      typeof execution.runId === "string" && execution.runId.length > 0
        ? execution.runId
        : null,
    evidence: dedupeStrings(execution.evidence ?? [], 25),
  };
  record.policyExecutions = [...(record.policyExecutions ?? []), normalized].slice(-100);
  appendIncidentHistoryEvent(record, {
    timestamp: normalized.executedAt,
    type: "policy-executed",
    actor: normalized.actor,
    summary: normalized.summary,
    detail:
      normalized.detail ??
      `${normalized.action} ${normalized.result} via ${normalized.policyId}.`,
    evidence: dedupeStrings(
      [
        normalized.policyId,
        normalized.action,
        normalized.result,
        normalized.taskId,
        normalized.runId,
        normalized.remediationId,
        ...normalized.evidence,
      ],
      25,
    ),
  });
  return normalized;
}

function addMinutesIso(baseIso: string, minutes: number) {
  const base = Date.parse(baseIso);
  if (!Number.isFinite(base)) return null;
  return new Date(base + minutes * 60 * 1000).toISOString();
}

function resolveIncidentRemediationPolicy(
  classification: IncidentLedgerClassification,
  severity: IncidentLedgerSeverity,
): IncidentRemediationPolicy {
  const base = (
    {
      knowledge: {
        policyId: "knowledge-truth",
        preferredOwner: "doc-specialist",
        autoAssignOwner: true,
        autoRemediateOnCreate: true,
        autoRetryBlockedRemediation: true,
        maxAutoRemediationAttempts: 2,
        autoEscalateOnBreach: true,
        remediationTaskType: "drift-repair",
        verifierTaskType: "qa-verification",
        escalationTaskType: "system-monitor",
        targetSlaMinutes: 180,
        escalationMinutes: 360,
      },
      repair: {
        policyId: "repair-verification",
        preferredOwner: "qa-verification-agent",
        autoAssignOwner: true,
        autoRemediateOnCreate: false,
        autoRetryBlockedRemediation: true,
        maxAutoRemediationAttempts: 2,
        autoEscalateOnBreach: true,
        remediationTaskType: "qa-verification",
        verifierTaskType: "qa-verification",
        escalationTaskType: "qa-verification",
        targetSlaMinutes: 90,
        escalationMinutes: 180,
      },
      "retry-recovery": {
        policyId: "retry-recovery",
        preferredOwner: "integration-agent",
        autoAssignOwner: true,
        autoRemediateOnCreate: true,
        autoRetryBlockedRemediation: true,
        maxAutoRemediationAttempts: 3,
        autoEscalateOnBreach: true,
        remediationTaskType: "qa-verification",
        verifierTaskType: "qa-verification",
        escalationTaskType: "system-monitor",
        targetSlaMinutes: 60,
        escalationMinutes: 120,
      },
      "runtime-mode": {
        policyId: "runtime-mode",
        preferredOwner: "operator",
        autoAssignOwner: true,
        autoRemediateOnCreate: false,
        autoRetryBlockedRemediation: false,
        maxAutoRemediationAttempts: 1,
        autoEscalateOnBreach: true,
        remediationTaskType: "system-monitor",
        verifierTaskType: "qa-verification",
        escalationTaskType: "system-monitor",
        targetSlaMinutes: 120,
        escalationMinutes: 240,
      },
      persistence: {
        policyId: "persistence",
        preferredOwner: "system-monitor-agent",
        autoAssignOwner: true,
        autoRemediateOnCreate: true,
        autoRetryBlockedRemediation: true,
        maxAutoRemediationAttempts: 3,
        autoEscalateOnBreach: true,
        remediationTaskType: "system-monitor",
        verifierTaskType: "qa-verification",
        escalationTaskType: "system-monitor",
        targetSlaMinutes: 45,
        escalationMinutes: 90,
      },
      "proof-delivery": {
        policyId: "proof-delivery",
        preferredOwner: "system-monitor-agent",
        autoAssignOwner: true,
        autoRemediateOnCreate: true,
        autoRetryBlockedRemediation: true,
        maxAutoRemediationAttempts: 3,
        autoEscalateOnBreach: true,
        remediationTaskType: "system-monitor",
        verifierTaskType: "qa-verification",
        escalationTaskType: "system-monitor",
        targetSlaMinutes: 60,
        escalationMinutes: 180,
      },
      "service-runtime": {
        policyId: "service-runtime",
        preferredOwner: "system-monitor-agent",
        autoAssignOwner: true,
        autoRemediateOnCreate: true,
        autoRetryBlockedRemediation: true,
        maxAutoRemediationAttempts: 2,
        autoEscalateOnBreach: true,
        remediationTaskType: "system-monitor",
        verifierTaskType: "qa-verification",
        escalationTaskType: "system-monitor",
        targetSlaMinutes: 120,
        escalationMinutes: 240,
      },
      "approval-backlog": {
        policyId: "approval-backlog",
        preferredOwner: "operator",
        autoAssignOwner: true,
        autoRemediateOnCreate: false,
        autoRetryBlockedRemediation: false,
        maxAutoRemediationAttempts: 1,
        autoEscalateOnBreach: true,
        remediationTaskType: "system-monitor",
        verifierTaskType: null,
        escalationTaskType: "system-monitor",
        targetSlaMinutes: 240,
        escalationMinutes: 480,
      },
    } satisfies Record<IncidentLedgerClassification, IncidentRemediationPolicy>
  )[classification];

  if (severity === "critical") {
    return {
      ...base,
      targetSlaMinutes: Math.max(15, Math.floor(base.targetSlaMinutes / 2)),
      escalationMinutes: Math.max(30, Math.floor(base.escalationMinutes / 2)),
    };
  }

  return base;
}

function buildIncidentVerificationState(
  record: IncidentLedgerRecord,
  policy: IncidentRemediationPolicy,
): IncidentVerificationState {
  if (!policy.verifierTaskType) {
    return {
      required: false,
      agentId: null,
      status: "not-required",
      summary: "No verifier task is required for this remediation policy.",
      verificationTaskId: null,
      verificationRunId: null,
      verifiedAt: null,
    };
  }

  const verificationTask =
    [...(record.remediationTasks ?? [])]
      .filter(
        (task) =>
          task.lane === "verification" || task.taskType === policy.verifierTaskType,
      )
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ??
    null;

  if (!verificationTask) {
    return {
      required: true,
      agentId: "qa-verification-agent",
      status: "pending",
      summary: "Verification is required before this incident can be treated as fully closed.",
      verificationTaskId: null,
      verificationRunId: null,
      verifiedAt: null,
    };
  }

  if (verificationTask.status === "running" || verificationTask.status === "verifying") {
    return {
      required: true,
      agentId: "qa-verification-agent",
      status: "running",
      summary: "Verification is currently executing against the remediation outcome.",
      verificationTaskId: verificationTask.taskId,
      verificationRunId: verificationTask.runId ?? null,
      verifiedAt: verificationTask.verifiedAt ?? null,
    };
  }

  if (verificationTask.status === "resolved" || verificationTask.status === "verified") {
    return {
      required: true,
      agentId: "qa-verification-agent",
      status: "passed",
      summary:
        verificationTask.resolutionSummary ??
        verificationTask.verificationSummary ??
        "Verification passed for the remediation outcome.",
      verificationTaskId: verificationTask.taskId,
      verificationRunId: verificationTask.runId ?? null,
      verifiedAt:
        verificationTask.resolvedAt ??
        verificationTask.verifiedAt ??
        verificationTask.verificationCompletedAt ??
        null,
    };
  }

  if (verificationTask.status === "failed" || verificationTask.status === "blocked") {
    return {
      required: true,
      agentId: "qa-verification-agent",
      status: "failed",
      summary:
        verificationTask.verificationSummary ??
        verificationTask.resolutionSummary ??
        "Verification failed or was blocked.",
      verificationTaskId: verificationTask.taskId,
      verificationRunId: verificationTask.runId ?? null,
      verifiedAt: null,
    };
  }

  return {
    required: true,
    agentId: "qa-verification-agent",
    status: "pending",
    summary: "Verification task exists but has not yet produced a closure verdict.",
    verificationTaskId: verificationTask.taskId,
    verificationRunId: verificationTask.runId ?? null,
    verifiedAt: null,
  };
}

function buildIncidentEscalationState(
  record: IncidentLedgerRecord,
  policy: IncidentRemediationPolicy,
  nowIso: string,
): IncidentEscalationState {
  if (record.status === "resolved") {
    return {
      level: "normal",
      status: "on-track",
      dueAt: null,
      escalateAt: null,
      escalatedAt: record.resolvedAt ?? null,
      breachedAt: null,
      summary: "Incident is resolved and no longer on an escalation clock.",
    };
  }

  const dueAt = addMinutesIso(record.firstSeenAt, policy.targetSlaMinutes);
  const escalateAt = addMinutesIso(record.firstSeenAt, policy.escalationMinutes);
  const now = Date.parse(nowIso);
  const due = dueAt ? Date.parse(dueAt) : Number.NaN;
  const escalate = escalateAt ? Date.parse(escalateAt) : Number.NaN;

  if (Number.isFinite(escalate) && now >= escalate) {
    return {
      level: "breached",
      status: "breached",
      dueAt,
      escalateAt,
      escalatedAt: escalateAt,
      breachedAt: nowIso,
      summary: "The incident has exceeded its escalation window and should be treated as breached.",
    };
  }

  if (Number.isFinite(due) && now >= due) {
    return {
      level: "escalated",
      status: "escalated",
      dueAt,
      escalateAt,
      escalatedAt: nowIso,
      breachedAt: null,
      summary: "The incident exceeded its target response window and is now escalated.",
    };
  }

  if (record.severity === "critical" || record.status === "active") {
    return {
      level: "warning",
      status: "watching",
      dueAt,
      escalateAt,
      escalatedAt: null,
      breachedAt: null,
      summary: "The incident is within SLA but requires active operator attention.",
    };
  }

  return {
    level: "normal",
    status: "on-track",
    dueAt,
    escalateAt,
    escalatedAt: null,
    breachedAt: null,
    summary: "The incident remains within its response window.",
  };
}

function buildIncidentRemediationPlan(
  record: IncidentLedgerRecord,
  policy: IncidentRemediationPolicy,
  verification: IncidentVerificationState,
): IncidentRemediationPlanStep[] {
  const remediationTasks = record.remediationTasks ?? [];
  const primaryTasks = remediationTasks.filter(
    (task) => task.lane !== "verification" && task.lane !== "escalation",
  );
  const latestPrimary = primaryTasks.sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  )[0];
  const latestVerification = remediationTasks
    .filter((task) => task.lane === "verification")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];

  const diagnoseStatus: IncidentRemediationPlanStep["status"] =
    record.acknowledgedAt || record.owner ? "completed" : "active";
  const executeStatus: IncidentRemediationPlanStep["status"] =
    record.status === "resolved"
      ? "completed"
      : latestPrimary?.status === "failed" || latestPrimary?.status === "blocked"
        ? "blocked"
        : latestPrimary?.status === "running" ||
            latestPrimary?.status === "assigned" ||
            latestPrimary?.status === "queued" ||
            latestPrimary?.status === "verifying"
          ? "active"
          : latestPrimary
            ? "completed"
            : "pending";
  const verifyStatus: IncidentRemediationPlanStep["status"] =
    verification.required !== true
      ? "skipped"
      : verification.status === "passed"
        ? "completed"
        : verification.status === "failed"
          ? "blocked"
          : verification.status === "running"
            ? "active"
            : "pending";
  const closeStatus: IncidentRemediationPlanStep["status"] =
    record.status === "resolved" ? "completed" : verification.status === "failed" ? "blocked" : "pending";

  return [
    {
      stepId: "diagnose",
      title: "Diagnose",
      kind: "diagnose",
      owner: record.owner ?? policy.preferredOwner,
      status: diagnoseStatus,
      description: "Triage the incident, confirm ownership, and capture operator context.",
      taskType: null,
      dependsOn: [],
      startedAt: record.firstSeenAt,
      completedAt: record.acknowledgedAt ?? null,
      evidence: dedupeStrings([record.summary, record.owner ?? null], 6),
    },
    {
      stepId: "execute",
      title: "Execute",
      kind: "execute",
      owner: policy.preferredOwner,
      status: executeStatus,
      description: `Run the primary remediation lane using ${policy.remediationTaskType}.`,
      taskType: policy.remediationTaskType,
      dependsOn: ["diagnose"],
      startedAt: latestPrimary?.executionStartedAt ?? latestPrimary?.assignedAt ?? null,
      completedAt:
        latestPrimary?.executionCompletedAt ??
        latestPrimary?.resolvedAt ??
        latestPrimary?.verifiedAt ??
        null,
      evidence: dedupeStrings(
        [
          latestPrimary?.taskId ?? null,
          latestPrimary?.verificationSummary ?? null,
          latestPrimary?.resolutionSummary ?? null,
        ],
        8,
      ),
    },
    {
      stepId: "verify",
      title: "Verify",
      kind: "verify",
      owner: verification.agentId ?? "qa-verification-agent",
      status: verifyStatus,
      description:
        verification.required === true
          ? "Run verifier-led closure checks against the remediation outcome."
          : "Verification is not required for this incident policy.",
      taskType: policy.verifierTaskType,
      dependsOn: ["execute"],
      startedAt: latestVerification?.verificationStartedAt ?? latestVerification?.assignedAt ?? null,
      completedAt:
        verification.verifiedAt ??
        latestVerification?.verificationCompletedAt ??
        latestVerification?.resolvedAt ??
        null,
      evidence: dedupeStrings(
        [verification.summary, latestVerification?.taskId ?? null],
        6,
      ),
    },
    {
      stepId: "close",
      title: "Close",
      kind: "close",
      owner: "operator",
      status: closeStatus,
      description: "Confirm the incident is resolved and preserve closure evidence.",
      taskType: null,
      dependsOn: ["verify"],
      startedAt: record.resolvedAt ?? null,
      completedAt: record.resolvedAt ?? null,
      evidence: dedupeStrings([record.resolvedAt, record.summary], 4),
    },
  ];
}

function findIncidentRemediationTask(
  state: OrchestratorState,
  incidentId: string,
  remediationId: string,
) {
  const incident = state.incidentLedger.find((record) => record.incidentId === incidentId);
  if (!incident) {
    return { incident: null, remediationTask: null };
  }

  const remediationTask =
    incident.remediationTasks?.find((item) => item.remediationId === remediationId) ?? null;
  return { incident, remediationTask };
}

function deriveIncidentRemediationTaskStatus(
  state: OrchestratorState,
  remediationTask: IncidentRemediationTaskRecord,
): IncidentRemediationTaskStatus {
  if (remediationTask.resolvedAt) return "resolved";
  if (remediationTask.verifiedAt) return "verified";
  if (remediationTask.verificationStartedAt && !remediationTask.verificationCompletedAt) {
    return "verifying";
  }
  if (remediationTask.executionStartedAt && !remediationTask.executionCompletedAt) {
    return "running";
  }
  if (remediationTask.assignedAt && remediationTask.status === "assigned") {
    return "assigned";
  }

  const execution =
    state.taskExecutions.find(
      (record) =>
        record.taskId === remediationTask.taskId ||
        (remediationTask.runId ? record.idempotencyKey === remediationTask.runId : false),
    ) ?? null;
  if (!execution) {
    return remediationTask.status ?? "unknown";
  }
  if (execution.status === "pending" || execution.status === "retrying") return "queued";
  if (execution.status === "running") return "running";
  if (execution.status === "success") return "completed";
  if (execution.status === "failed") return "failed";
  return "unknown";
}

function materializeIncident(
  record: IncidentLedgerRecord,
  state: OrchestratorState,
): RuntimeIncident {
  return {
    id: record.incidentId,
    fingerprint: record.fingerprint,
    title: record.title,
    classification: record.classification,
    severity: record.severity,
    status: record.status,
    truthLayer: record.truthLayer,
    summary: record.summary,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    resolvedAt: record.resolvedAt ?? null,
    detectedAt: record.lastSeenAt,
    acknowledgedAt: record.acknowledgedAt ?? null,
    acknowledgedBy: record.acknowledgedBy ?? null,
    acknowledgementNote: record.acknowledgementNote ?? null,
    owner: record.owner ?? null,
    affectedSurfaces: record.affectedSurfaces,
    linkedServiceIds: record.linkedServiceIds,
    linkedTaskIds: record.linkedTaskIds,
    linkedRunIds: record.linkedRunIds,
    linkedRepairIds: record.linkedRepairIds,
  linkedProofDeliveries: record.linkedProofDeliveries,
  evidence: record.evidence,
  recommendedSteps: record.recommendedSteps,
  policy: record.policy,
  escalation: record.escalation,
  remediation: {
    owner: record.remediation.owner,
    status: record.remediation.status,
    summary: record.remediation.summary,
    nextAction: record.remediation.nextAction,
    blockers: record.remediation.blockers,
  },
  remediationPlan: record.remediationPlan ?? [],
  verification: record.verification,
  history: record.history ?? [],
  policyExecutions: record.policyExecutions ?? [],
  acknowledgements: record.acknowledgements ?? [],
  ownershipHistory: record.ownershipHistory ?? [],
    remediationTasks: (record.remediationTasks ?? []).map((item) => ({
      ...item,
      status: deriveIncidentRemediationTaskStatus(state, item),
    })),
  };
}

function acknowledgeIncidentRecord(
  state: OrchestratorState,
  incidentId: string,
  actor: string,
  note?: string,
) {
  const target = state.incidentLedger.find((record) => record.incidentId === incidentId);
  if (!target) {
    throw new Error(`Incident not found: ${incidentId}`);
  }

  const acknowledgedAt = new Date().toISOString();
  target.acknowledgedAt = acknowledgedAt;
  target.acknowledgedBy = actor;
  target.acknowledgementNote = note ?? null;
  target.acknowledgements = [
    ...(target.acknowledgements ?? []),
    {
      acknowledgedAt,
      acknowledgedBy: actor,
      note: note ?? null,
    },
  ].slice(-50);
  appendIncidentHistoryEvent(target, {
    timestamp: acknowledgedAt,
    type: "acknowledged",
    actor,
    summary: "Incident acknowledged.",
    detail: note ?? "Acknowledgement recorded without operator note.",
    evidence: [target.title, note ?? "no-operator-note"],
  });
  return target;
}

function assignIncidentOwner(
  state: OrchestratorState,
  incidentId: string,
  owner: string,
  actor: string,
  note?: string,
) {
  const target = state.incidentLedger.find((record) => record.incidentId === incidentId);
  if (!target) {
    throw new Error(`Incident not found: ${incidentId}`);
  }

  const changedAt = new Date().toISOString();
  const previousOwner = target.owner ?? null;
  target.owner = owner;
  target.ownershipHistory = [
    ...(target.ownershipHistory ?? []),
    {
      changedAt,
      changedBy: actor,
      previousOwner,
      nextOwner: owner,
      note: note ?? null,
    },
  ].slice(-50);
  appendIncidentHistoryEvent(target, {
    timestamp: changedAt,
    type: "owner-changed",
    actor,
    summary:
      previousOwner && previousOwner !== owner
        ? `Incident ownership moved from ${previousOwner} to ${owner}.`
        : `Incident owner set to ${owner}.`,
    detail: note ?? "Ownership change recorded without operator note.",
    evidence: [previousOwner ?? "unowned", owner],
  });
  return target;
}

function resolveIncidentRemediationTaskSpec(
  incident: IncidentLedgerRecord,
  actor: string,
  note?: string,
  overrideTaskType?: "drift-repair" | "build-refactor" | "qa-verification" | "system-monitor",
) {
  const taskType = overrideTaskType ?? incident.policy.remediationTaskType;

  const payload: Record<string, unknown> = {
    incidentId: incident.incidentId,
    incidentFingerprint: incident.fingerprint,
    incidentClassification: incident.classification,
    incidentSeverity: incident.severity,
    reason: "incident-remediation",
    __actor: actor,
    __incidentId: incident.incidentId,
  };

  if (note) {
    payload.note = note;
  }
  if (incident.linkedRepairIds.length > 0) {
    payload.repairIds = incident.linkedRepairIds;
  }
  if (incident.linkedRunIds.length > 0) {
    payload.runIds = incident.linkedRunIds;
  }
  if (incident.linkedServiceIds.length > 0) {
    payload.serviceIds = incident.linkedServiceIds;
  }
  if (incident.linkedProofDeliveries.length > 0) {
    payload.proofDeliveries = incident.linkedProofDeliveries;
  }
  if (incident.affectedSurfaces.length > 0) {
    payload.affectedSurfaces = incident.affectedSurfaces;
  }
  if (taskType === "build-refactor") {
    const docsFocused = incident.affectedSurfaces.some((surface) =>
      /doc|knowledge/i.test(surface),
    );
    const operatorSurfaceFocused = incident.affectedSurfaces.some((surface) =>
      /operator|ui|console/i.test(surface),
    );
    payload.type = "refactor";
    payload.scope = docsFocused
      ? "docs"
      : operatorSurfaceFocused
        ? "operator-s-console/src"
        : "orchestrator/src";
    payload.intent = docsFocused
      ? `Repair documentation or knowledge drift linked to incident ${incident.incidentId}.`
      : operatorSurfaceFocused
        ? `Repair operator guidance or console workflow clarity linked to incident ${incident.incidentId}.`
        : `Repair the bounded runtime issue linked to incident ${incident.incidentId}.`;
    payload.constraints = {
      maxFilesChanged: incident.severity === "critical" ? 2 : 4,
      requiresApproval: true,
      runTests: true,
      linkedIncidentId: incident.incidentId,
      linkedRepairId: incident.linkedRepairIds[0] ?? undefined,
      verificationMode: "qa-verification",
    };
  }

  return {
    taskType,
    payload,
    reason: `Remediation task ${taskType} created for ${incident.classification}.`,
  };
}

function refreshIncidentOperationalMetadata(
  record: IncidentLedgerRecord,
  nowIso: string,
) {
  const previousEscalationLevel = record.escalation?.level ?? "normal";
  const previousVerificationStatus = record.verification?.status ?? "not-required";
  const previousPlanSignature = JSON.stringify(
    (record.remediationPlan ?? []).map((step) => ({
      stepId: step.stepId,
      status: step.status,
    })),
  );

  record.policy = resolveIncidentRemediationPolicy(
    record.classification,
    record.severity,
  );
  if (record.owner == null && record.policy.autoAssignOwner) {
    record.owner = record.policy.preferredOwner;
    record.ownershipHistory = [
      ...(record.ownershipHistory ?? []),
      {
        changedAt: nowIso,
        changedBy: "system",
        previousOwner: null,
        nextOwner: record.policy.preferredOwner,
        note: "Owner assigned automatically from remediation policy.",
      },
    ].slice(-50);
    appendIncidentPolicyExecution(record, {
      executedAt: nowIso,
      actor: "system:auto-owner",
      policyId: record.policy.policyId,
      trigger: "reconcile",
      action: "auto-owner-assigned",
      result: "executed",
      summary: `Policy ${record.policy.policyId} assigned incident ownership to ${record.policy.preferredOwner}.`,
      detail: "Owner assigned automatically from remediation policy.",
      evidence: [record.incidentId, record.policy.preferredOwner],
    });
  }
  record.verification = buildIncidentVerificationState(record, record.policy);
  record.escalation = buildIncidentEscalationState(record, record.policy, nowIso);
  record.remediationPlan = buildIncidentRemediationPlan(
    record,
    record.policy,
    record.verification,
  );

  const nextPlanSignature = JSON.stringify(
    (record.remediationPlan ?? []).map((step) => ({
      stepId: step.stepId,
      status: step.status,
    })),
  );

  if (previousEscalationLevel !== record.escalation.level) {
    appendIncidentHistoryEvent(record, {
      timestamp: nowIso,
      type: "escalated",
      actor: "system",
      summary: `Incident escalation moved to ${record.escalation.level}.`,
      detail: record.escalation.summary,
      evidence: [previousEscalationLevel, record.escalation.level],
    });
  }

  if (previousVerificationStatus !== record.verification.status) {
    appendIncidentHistoryEvent(record, {
      timestamp: nowIso,
      type:
        record.verification.status === "passed"
          ? "verification-passed"
          : record.verification.status === "failed"
            ? "verification-failed"
            : "verification-required",
      actor: "system",
      summary: `Incident verification moved to ${record.verification.status}.`,
      detail: record.verification.summary,
      evidence: [
        previousVerificationStatus,
        record.verification.status,
        record.verification.agentId ?? "no-agent",
      ],
    });
  }

  if (previousPlanSignature !== nextPlanSignature) {
    appendIncidentHistoryEvent(record, {
      timestamp: nowIso,
      type: "remediation-plan-updated",
      actor: "system",
      summary: "Remediation plan status was refreshed from runtime evidence.",
      detail: record.remediationPlan
        .map((step) => `${step.title}:${step.status}`)
        .join(", "),
      evidence: record.remediationPlan.map((step) => `${step.stepId}:${step.status}`),
    });
  }
}

function reconcileRuntimeIncidentLedger(
  state: OrchestratorState,
  candidates: IncidentCandidate[],
  options: {
    includeIncidentDetails?: boolean;
  } = {},
): { changed: boolean; model: RuntimeIncidentModel } {
  const includeIncidentDetails = options.includeIncidentDetails !== false;
  const now = new Date().toISOString();
  const ledgerByFingerprint = new Map(
    state.incidentLedger.map((record) => [record.fingerprint, record]),
  );
  const seenFingerprints = new Set<string>();
  let changed = false;

  for (const candidate of candidates) {
    seenFingerprints.add(candidate.fingerprint);
    const detectedAt = candidate.detectedAt ?? now;
    const existing = ledgerByFingerprint.get(candidate.fingerprint);

    if (!existing) {
      const created: IncidentLedgerRecord = {
        incidentId: randomUUID(),
        fingerprint: candidate.fingerprint,
        title: candidate.title,
        classification: candidate.classification,
        severity: candidate.severity,
        truthLayer: candidate.truthLayer,
        firstSeenAt: detectedAt,
        lastSeenAt: detectedAt,
        resolvedAt: null,
        status: candidate.status,
        acknowledgedAt: null,
        acknowledgedBy: null,
        acknowledgementNote: null,
        owner: null,
        summary: candidate.summary,
        affectedSurfaces: dedupeStrings(candidate.affectedSurfaces),
        linkedServiceIds: dedupeStrings(candidate.linkedServiceIds),
        linkedTaskIds: dedupeStrings(candidate.linkedTaskIds),
        linkedRunIds: dedupeStrings(candidate.linkedRunIds),
        linkedRepairIds: dedupeStrings(candidate.linkedRepairIds),
        linkedProofDeliveries: dedupeStrings(candidate.linkedProofDeliveries),
        evidence: dedupeStrings(candidate.evidence),
        recommendedSteps: dedupeStrings(candidate.recommendedSteps),
        policy: resolveIncidentRemediationPolicy(
          candidate.classification,
          candidate.severity,
        ),
        escalation: {
          level: "normal",
          status: "on-track",
          dueAt: null,
          escalateAt: null,
          escalatedAt: null,
          breachedAt: null,
          summary: "Escalation will be derived after reconciliation.",
        },
        remediation: {
          owner: candidate.remediation.owner,
          status: candidate.remediation.status,
          summary: candidate.remediation.summary,
          nextAction: candidate.remediation.nextAction,
          blockers: dedupeStrings(candidate.remediation.blockers),
        },
        remediationPlan: [],
        verification: {
          required: false,
          agentId: null,
          status: "not-required",
          summary: "Verification state will be derived after reconciliation.",
          verificationTaskId: null,
          verificationRunId: null,
          verifiedAt: null,
        },
        history: [],
        policyExecutions: [],
        acknowledgements: [],
        ownershipHistory: [],
        remediationTasks: [],
      };
      appendIncidentHistoryEvent(created, {
        timestamp: detectedAt,
        type: "detected",
        summary: `${candidate.title} detected.`,
        detail: candidate.summary,
        evidence: [
          candidate.classification,
          candidate.severity,
          candidate.truthLayer,
        ],
      });
      refreshIncidentOperationalMetadata(created, detectedAt);
      state.incidentLedger.push(created);
      changed = true;
      continue;
    }

    existing.history = existing.history ?? [];
    existing.policyExecutions = existing.policyExecutions ?? [];
    existing.acknowledgements = existing.acknowledgements ?? [];
    existing.ownershipHistory = existing.ownershipHistory ?? [];
    existing.remediationTasks = existing.remediationTasks ?? [];

    const previousStatus = existing.status;
    const previousSeverity = existing.severity;
    const previousSummary = existing.summary;
    const previousRemediationStatus = existing.remediation.status;
    const wasResolved = existing.status === "resolved";

    const updated: IncidentLedgerRecord = {
      ...existing,
      title: candidate.title,
      classification: candidate.classification,
      severity: candidate.severity,
      truthLayer: candidate.truthLayer,
      lastSeenAt: detectedAt,
      resolvedAt: null,
      status: candidate.status,
      summary: candidate.summary,
      affectedSurfaces: dedupeStrings(candidate.affectedSurfaces),
      linkedServiceIds: dedupeStrings(candidate.linkedServiceIds),
      linkedTaskIds: dedupeStrings(candidate.linkedTaskIds),
      linkedRunIds: dedupeStrings(candidate.linkedRunIds),
      linkedRepairIds: dedupeStrings(candidate.linkedRepairIds),
      linkedProofDeliveries: dedupeStrings(candidate.linkedProofDeliveries),
      evidence: dedupeStrings(candidate.evidence),
      recommendedSteps: dedupeStrings(candidate.recommendedSteps),
      policy: existing.policy,
      escalation: existing.escalation,
      remediation: {
        owner: candidate.remediation.owner,
        status: candidate.remediation.status,
        summary: candidate.remediation.summary,
        nextAction: candidate.remediation.nextAction,
        blockers: dedupeStrings(candidate.remediation.blockers),
      },
      remediationPlan: existing.remediationPlan,
      verification: existing.verification,
      history: existing.history,
      policyExecutions: existing.policyExecutions,
      acknowledgements: existing.acknowledgements,
      ownershipHistory: existing.ownershipHistory,
      remediationTasks: existing.remediationTasks,
    };

    if (!recordsEqual(existing, updated)) {
      Object.assign(existing, updated);
      if (wasResolved) {
        appendIncidentHistoryEvent(existing, {
          timestamp: detectedAt,
          type: "status-changed",
          summary: `${candidate.title} reopened.`,
          detail: candidate.summary,
          evidence: [previousStatus, candidate.status],
        });
      } else if (previousStatus !== candidate.status) {
        appendIncidentHistoryEvent(existing, {
          timestamp: detectedAt,
          type: "status-changed",
          summary: `${candidate.title} moved to ${candidate.status}.`,
          detail: candidate.summary,
          evidence: [previousStatus, candidate.status],
        });
      }

      if (previousSeverity !== candidate.severity) {
        appendIncidentHistoryEvent(existing, {
          timestamp: detectedAt,
          type: "severity-changed",
          summary: `${candidate.title} severity changed from ${previousSeverity} to ${candidate.severity}.`,
          detail: candidate.summary,
          evidence: [previousSeverity, candidate.severity],
        });
      }

      if (previousSummary !== candidate.summary) {
        appendIncidentHistoryEvent(existing, {
          timestamp: detectedAt,
          type: "summary-updated",
          summary: `${candidate.title} summary refreshed.`,
          detail: candidate.summary,
          evidence: dedupeStrings(candidate.evidence, 6),
        });
      }

      if (previousRemediationStatus !== candidate.remediation.status) {
        appendIncidentHistoryEvent(existing, {
          timestamp: detectedAt,
          type: "remediation-status-changed",
          summary: `${candidate.title} remediation moved to ${candidate.remediation.status}.`,
          detail: candidate.remediation.summary,
          evidence: [previousRemediationStatus, candidate.remediation.status],
        });
      }
      refreshIncidentOperationalMetadata(existing, detectedAt);
      changed = true;
    }
  }

  for (const record of state.incidentLedger) {
    if (seenFingerprints.has(record.fingerprint)) continue;
    if (record.status === "resolved") continue;
    record.status = "resolved";
    record.resolvedAt = now;
    record.remediation.status = "resolved";
    refreshIncidentOperationalMetadata(record, now);
    appendIncidentHistoryEvent(record, {
      timestamp: now,
      type: "resolved",
      summary: `${record.title} resolved.`,
      detail: "The runtime candidate no longer appears in the latest reconciliation pass.",
      evidence: [record.classification, record.truthLayer],
    });
    changed = true;
  }

  for (const record of state.incidentLedger) {
    const before = JSON.stringify({
      owner: record.owner,
      policy: record.policy,
      escalation: record.escalation,
      remediationPlan: record.remediationPlan,
      verification: record.verification,
    });
    refreshIncidentOperationalMetadata(record, now);
    const after = JSON.stringify({
      owner: record.owner,
      policy: record.policy,
      escalation: record.escalation,
      remediationPlan: record.remediationPlan,
      verification: record.verification,
    });
    if (before !== after) {
      changed = true;
    }
  }

  const openIncidents = [...state.incidentLedger]
    .filter((record) => record.status !== "resolved")
    .sort((left, right) => {
      const severityRank: Record<IncidentLedgerSeverity, number> = {
        critical: 3,
        warning: 2,
        info: 1,
      };
      const severityDiff = severityRank[right.severity] - severityRank[left.severity];
      if (severityDiff !== 0) return severityDiff;
      return Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt);
    });

  const bySeverity = {
    critical: openIncidents.filter((record) => record.severity === "critical").length,
    warning: openIncidents.filter((record) => record.severity === "warning").length,
      info: openIncidents.filter((record) => record.severity === "info").length,
    };

  return {
    changed,
    model: {
      generatedAt: now,
      overallStatus:
        bySeverity.critical > 0
          ? "critical"
          : bySeverity.warning > 0
            ? "warning"
            : "stable",
      openCount: openIncidents.length,
      activeCount: openIncidents.filter((record) => record.status === "active").length,
      watchingCount: openIncidents.filter((record) => record.status === "watching").length,
      bySeverity,
      incidents: includeIncidentDetails
        ? openIncidents.map((record) => materializeIncident(record, state))
        : [],
    },
  };
}

function buildRuntimeIncidentModel({
  config,
  state,
  fastStartMode,
  persistence,
  agents,
  governance,
  pendingApprovalsCount,
  knowledgeRuntime,
  githubWorkflowMonitor,
  includeIncidentDetails = true,
  reconcileLedger = true,
}: {
  config: Awaited<ReturnType<typeof loadConfig>>;
  state: OrchestratorState;
  fastStartMode: boolean;
  persistence: Awaited<ReturnType<typeof PersistenceIntegration.healthCheck>>;
  agents: Awaited<ReturnType<typeof buildAgentOperationalOverview>>;
  governance: ReturnType<typeof summarizeGovernanceVisibility>;
  pendingApprovalsCount: number;
  knowledgeRuntime: ReturnType<typeof buildKnowledgeRuntimeSignals>;
  githubWorkflowMonitor: GitHubWorkflowMonitorState;
  includeIncidentDetails?: boolean;
  reconcileLedger?: boolean;
}): { changed: boolean; model: RuntimeIncidentModel } {
  const candidates: IncidentCandidate[] = [];

  const addIncident = (incident: IncidentCandidate) => {
    candidates.push(incident);
  };

  if (fastStartMode) {
    addIncident({
      fingerprint: buildIncidentFingerprint("runtime-mode", "fast-start"),
      title: "Fast-start mode active",
      classification: "runtime-mode",
      severity: "warning",
      status: "watching",
      truthLayer: "configured",
      summary:
        "The orchestrator is running in fast-start mode, so some deep integrations may be intentionally reduced.",
      detectedAt: state.lastStartedAt ?? state.updatedAt ?? null,
      affectedSurfaces: ["control-plane", "knowledge", "persistence"],
      linkedServiceIds: ["orchestrator.service"],
      linkedTaskIds: [],
      linkedRunIds: [],
      linkedRepairIds: [],
      linkedProofDeliveries: [],
      evidence: ["ORCHESTRATOR_FAST_START=true"],
      recommendedSteps: [
        "Restart the orchestrator without ORCHESTRATOR_FAST_START=true.",
      ],
      remediation: {
        owner: "operator",
        status: "ready",
        summary: "Exit fast-start mode to regain the full boot path.",
        nextAction: "Restart the orchestrator without ORCHESTRATOR_FAST_START=true.",
        blockers: [],
      },
    });
  }

  if (persistence.status !== "healthy") {
    addIncident({
      fingerprint: buildIncidentFingerprint("persistence", "primary"),
      title: "Persistence degraded",
      classification: "persistence",
      severity: "critical",
      status: "active",
      truthLayer: "observed",
      summary: `Persistence health is currently ${String(persistence.status)}.`,
      detectedAt: state.updatedAt ?? null,
      affectedSurfaces: ["persistence", "knowledge", "control-plane"],
      linkedServiceIds: ["mongodb", "orchestrator.service"],
      linkedTaskIds: [],
      linkedRunIds: [],
      linkedRepairIds: [],
      linkedProofDeliveries: [],
      evidence: [
        `persistence status: ${String(persistence.status)}`,
        `database connected: ${String((persistence as any).database ?? false)}`,
      ],
      recommendedSteps: [
        "Inspect /api/persistence/health for the precise failure mode.",
        "Verify database credentials and connectivity from the host.",
      ],
      remediation: {
        owner: "operator",
        status: "ready",
        summary: "Restore database connectivity and re-run health checks.",
        nextAction: "Inspect /api/persistence/health and backing database credentials or connectivity.",
        blockers: [],
      },
    });
  }

  const activeRepairRecords = state.repairRecords.filter((record) =>
    ["detected", "queued", "running", "failed"].includes(record.status),
  );
  for (const record of activeRepairRecords) {
    addIncident({
      fingerprint: buildIncidentFingerprint("repair", record.repairId),
      title: `Repair ${record.repairId} requires attention`,
      classification: "repair",
      severity: record.status === "failed" ? "critical" : "warning",
      status: record.status === "failed" ? "active" : "watching",
      truthLayer: "observed",
      summary:
        record.status === "failed"
          ? `Repair ${record.repairId} failed verification.`
          : `Repair ${record.repairId} is ${record.status}.`,
      detectedAt:
        record.completedAt ??
        record.startedAt ??
        record.queuedAt ??
        record.detectedAt,
      affectedSurfaces: dedupeStrings([
        "repair-runtime",
        "knowledge",
        "task-queue",
        ...(record.affectedPaths ?? []),
      ]),
      linkedServiceIds: [],
      linkedTaskIds: dedupeStrings([
        record.sourceTaskId,
        record.repairTaskId,
      ]),
      linkedRunIds: dedupeStrings([
        record.sourceRunId,
        record.repairRunId,
      ]),
      linkedRepairIds: [record.repairId],
      linkedProofDeliveries: [],
      evidence: dedupeStrings([
        ...(record.evidence ?? []),
        record.verificationSummary,
        record.lastError,
      ]),
      recommendedSteps: [
        record.status === "failed"
          ? "Inspect repair evidence and decide whether to rerun or verify manually."
          : "Allow the active repair flow to finish and verify the output.",
      ],
      remediation: {
        owner: record.status === "failed" ? "mixed" : "auto",
        status: record.status === "failed" ? "ready" : "in-progress",
        summary:
          record.status === "failed"
            ? "Repair flow needs operator review."
            : "Repair flow is currently progressing through auto-remediation.",
        nextAction:
          record.status === "failed"
            ? "Inspect repair evidence and decide whether to rerun or verify manually."
            : "Allow the active repair flow to finish and verify the output.",
        blockers: [],
      },
    });
  }

  if (governance.taskRetryRecoveries.count > 0) {
    for (const record of state.taskRetryRecoveries) {
      addIncident({
        fingerprint: buildIncidentFingerprint("retry-recovery", record.idempotencyKey),
        title: `Retry recovery waiting for ${record.type}`,
        classification: "retry-recovery",
        severity: "warning",
        status: "watching",
        truthLayer: "observed",
        summary: `Retry recovery for ${record.type} is queued for replay.`,
        detectedAt: record.retryAt,
        affectedSurfaces: ["task-queue", "worker-runtime"],
        linkedServiceIds: [],
        linkedTaskIds: [record.sourceTaskId],
        linkedRunIds: [record.idempotencyKey],
        linkedRepairIds: [],
        linkedProofDeliveries: [],
        evidence: [
          `retry at: ${record.retryAt}`,
          `attempt: ${record.attempt}`,
          `max retries: ${record.maxRetries}`,
        ],
        recommendedSteps: ["Monitor task runs until persisted retries clear."],
        remediation: {
          owner: "auto",
          status: "in-progress",
          summary: "Persisted retry recoveries are replayed by the orchestrator on schedule.",
          nextAction: "Monitor task runs until persisted retries clear.",
          blockers: [],
        },
      });
    }
  }

  const contradictionSignals = knowledgeRuntime.signals.contradictions ?? [];
  const stalenessSignals = knowledgeRuntime.signals.staleness ?? [];
  if (contradictionSignals.length > 0 || stalenessSignals.length > 0) {
    addIncident({
      fingerprint: buildIncidentFingerprint("knowledge", "runtime-signals"),
      title: "Knowledge runtime drift signals active",
      classification: "knowledge",
      severity: contradictionSignals.length > 0 ? "warning" : "info",
      status: contradictionSignals.length > 0 ? "active" : "watching",
      truthLayer: "observed",
      summary:
        contradictionSignals.length > 0
          ? `${contradictionSignals.length} contradiction signal(s) and ${stalenessSignals.length} freshness signal(s) are active.`
          : `${stalenessSignals.length} knowledge freshness signal(s) are active.`,
      detectedAt:
        knowledgeRuntime.freshness.latestEntryUpdatedAt ??
        knowledgeRuntime.freshness.lastDriftRepairAt ??
        null,
      affectedSurfaces: ["knowledge-base", "doc-index", "agent-context"],
      linkedServiceIds: [],
      linkedTaskIds: [],
      linkedRunIds: [],
      linkedRepairIds: state.repairRecords
        .filter((record) => record.classification === "doc-drift")
        .map((record) => record.repairId)
        .slice(0, 10),
      linkedProofDeliveries: [],
      evidence: [
        ...stalenessSignals.map((signal) => signal.message),
        ...contradictionSignals.slice(0, 5).map((signal: any) => signal.message ?? signal.title),
      ].slice(0, 10),
      recommendedSteps: [
        contradictionSignals.length > 0
          ? "Run drift repair or reconcile conflicting knowledge entries."
          : "Refresh indexed docs and regenerate knowledge packs if aging persists.",
      ],
      remediation: {
        owner: "mixed",
        status: contradictionSignals.length > 0 ? "ready" : "watching",
        summary:
          contradictionSignals.length > 0
            ? "Review contradictions and refresh knowledge packs."
            : "Knowledge aging should be monitored and refreshed as drift repair progresses.",
        nextAction:
          contradictionSignals.length > 0
            ? "Run drift repair or reconcile conflicting knowledge entries."
            : "Refresh indexed docs and regenerate knowledge packs if aging persists.",
        blockers: [],
      },
    });
  }

  const serviceGapAgents = agents.filter(
    (agent) =>
      agent.serviceExpected &&
      (agent.serviceInstalled === false || agent.serviceRunning === false),
  );
  for (const agent of serviceGapAgents) {
    const runtime = [agent.serviceUnitState, agent.serviceUnitSubState]
      .filter(Boolean)
      .join("/");

    addIncident({
      fingerprint: buildIncidentFingerprint("service-runtime", agent.id),
      title: `${agent.id} service coverage is incomplete`,
      classification: "service-runtime",
      severity: "warning",
      status: "active",
      truthLayer: "observed",
      summary: `${agent.id} is expected to run in service mode but is not fully installed or running on this host.`,
      detectedAt: agent.lastEvidenceAt ?? state.updatedAt ?? null,
      affectedSurfaces: [agent.id],
      linkedServiceIds: [getAgentServiceUnitName(agent.id)],
      linkedTaskIds: dedupeStrings([agent.lastSuccessfulTaskId]),
      linkedRunIds: dedupeStrings([agent.lastSuccessfulRunId]),
      linkedRepairIds: [],
      linkedProofDeliveries: [],
      evidence: [
        `${agent.id}: installed=${String(agent.serviceInstalled)}, running=${String(agent.serviceRunning)}${runtime ? ` (${runtime})` : ""}`,
      ],
      recommendedSteps: [
        "Inspect agent systemd unit state and bring the required service up.",
      ],
      remediation: {
        owner: "operator",
        status: "ready",
        summary: "Install or restart the missing agent service unit if it is intended to be live.",
        nextAction: "Inspect agent systemd unit state and bring required services up.",
        blockers: [],
      },
    });
  }

  if (githubWorkflowMonitor.status === "failed") {
    addIncident({
      fingerprint: buildIncidentFingerprint("service-runtime", "github-actions"),
      title: "Latest GitHub Actions run failed",
      classification: "service-runtime",
      severity: "warning",
      status: "active",
      truthLayer: "observed",
      summary: githubWorkflowMonitor.summary,
      detectedAt:
        githubWorkflowMonitor.latestRun?.updatedAt ??
        githubWorkflowMonitor.lastCheckedAt ??
        state.updatedAt ??
        null,
      affectedSurfaces: dedupeStrings([
        "github-actions",
        ...(githubWorkflowMonitor.repository
          ? [`repo:${githubWorkflowMonitor.repository}`]
          : []),
      ]),
      linkedServiceIds: ["github-actions"],
      linkedTaskIds: [],
      linkedRunIds: [],
      linkedRepairIds: [],
      linkedProofDeliveries: [],
      evidence: dedupeStrings([
        githubWorkflowMonitor.summary,
        ...(githubWorkflowMonitor.latestRun?.workflowName
          ? [`workflow:${githubWorkflowMonitor.latestRun.workflowName}`]
          : []),
        ...(githubWorkflowMonitor.latestRun?.headBranch
          ? [`branch:${githubWorkflowMonitor.latestRun.headBranch}`]
          : []),
        ...(githubWorkflowMonitor.latestRun?.conclusion
          ? [`conclusion:${githubWorkflowMonitor.latestRun.conclusion}`]
          : []),
        ...(githubWorkflowMonitor.latestRun?.url
          ? [githubWorkflowMonitor.latestRun.url]
          : []),
      ]),
      recommendedSteps: [
        githubWorkflowMonitor.latestRun?.url
          ? `Open ${githubWorkflowMonitor.latestRun.url} and repair the failed workflow before treating the push as healthy.`
          : "Inspect the latest GitHub Actions workflow and repair the failed checks before treating the push as healthy.",
      ],
      remediation: {
        owner: "operator",
        status: "ready",
        summary:
          "Repair the failing GitHub Actions workflow or revert the bad push before treating the repo as healthy.",
        nextAction:
          githubWorkflowMonitor.latestRun?.url
            ? `Open ${githubWorkflowMonitor.latestRun.url} and inspect the failing job logs.`
            : "Inspect the latest GitHub Actions workflow logs and repair the failing job.",
        blockers: [],
      },
    });
  }

  if (pendingApprovalsCount > 0) {
    const pendingApprovals = listPendingApprovals(state);
    addIncident({
      fingerprint: buildIncidentFingerprint("approval-backlog", "pending"),
      title: "Approval backlog waiting on operator action",
      classification: "approval-backlog",
      severity: pendingApprovalsCount > 3 ? "warning" : "info",
      status: "watching",
      truthLayer: "observed",
      summary: `${pendingApprovalsCount} approval-gated task(s) are paused pending operator review.`,
      detectedAt:
        pendingApprovals
          .map((approval) => approval.requestedAt)
          .sort()
          .at(0) ?? null,
      affectedSurfaces: ["approval-gate", "task-queue"],
      linkedServiceIds: ["orchestrator.service"],
      linkedTaskIds: pendingApprovals
        .map((approval) => approval.taskId)
        .slice(0, 10),
      linkedRunIds: pendingApprovals
        .map(
          (approval) =>
            state.taskExecutions.find((execution) => execution.taskId === approval.taskId)
              ?.idempotencyKey ?? null,
        )
        .filter((value): value is string => Boolean(value))
        .slice(0, 10),
      linkedRepairIds: [],
      linkedProofDeliveries: [],
      evidence: pendingApprovals
        .slice(0, 10)
        .map((approval) => `${approval.type} requested at ${approval.requestedAt}`),
      recommendedSteps: [
        "Review pending approvals and decide whether to approve or reject them.",
      ],
      remediation: {
        owner: "operator",
        status: "ready",
        summary: "Operator review is required before the queued work can resume.",
        nextAction: "Review pending approvals and decide whether to approve or reject them.",
        blockers: [],
      },
    });
  }

  if (!reconcileLedger) {
    return {
      changed: false,
      model: buildRuntimeIncidentSummaryModel(candidates),
    };
  }

  return reconcileRuntimeIncidentLedger(state, candidates, {
    includeIncidentDetails,
  });
}

async function bootstrap() {
  // Verify security posture FIRST
  verifySecurityPosture();
  const fastStartMode = process.env.ORCHESTRATOR_FAST_START === "true";

  const config = await loadConfig();
  await mkdir(config.logsDir, { recursive: true });
  if (!isMongoStateTarget(config.stateFile)) {
    await mkdir(dirname(config.stateFile), { recursive: true });
  }

  console.log("[orchestrator] config loaded", config);
  if (fastStartMode) {
    console.warn(
      "[orchestrator] ⚠️ Fast-start mode enabled: skipping heavy boot stages",
    );
  }

  try {
    const registry = await getAgentRegistry();
    const discoveredAgents = registry.listAgents().map((agent) => agent.id);
    console.log(
      `[orchestrator] agent registry initialized (${discoveredAgents.length} agents)`,
    );
    if (discoveredAgents.length > 0) {
      console.log(`[orchestrator] agents: ${discoveredAgents.join(", ")}`);
    }
  } catch (error) {
    console.warn("[orchestrator] agent registry initialization failed:", error);
  }

  let claimedTruthLayer = buildClaimedTruthLayer(config, 0);
  try {
    const registry = await getAgentRegistry();
    claimedTruthLayer = buildClaimedTruthLayer(
      config,
      registry.listAgents().length,
    );
  } catch {
    claimedTruthLayer = buildClaimedTruthLayer(config, 0);
  }

  // Initialize alerting
  const alertConfig = buildAlertConfig();
  const alertManager = new AlertManager(alertConfig, console);
  const failureTracker = new TaskFailureTracker(alertManager, 3);

  console.log(`[orchestrator] alerts enabled: ${alertConfig.enabled}`);
  if (alertConfig.slackWebhook)
    console.log("[orchestrator] Slack alerting configured");

  // Initialize Prometheus metrics server
  try {
    await startMetricsServer();
  } catch (error) {
    console.error("[orchestrator] failed to start metrics server:", error);
    // Don't fail bootstrap if metrics server fails
  }

  // ============================================================
  // Phase 6: Metrics Persistence Layer (MongoDB)
  // ============================================================

  if (!fastStartMode) {
    try {
      await PersistenceIntegration.initialize();
    } catch (error) {
      console.error(
        "[orchestrator] failed to initialize persistence layer:",
        error,
      );
      const strictPersistence =
        config.strictPersistence === true ||
        process.env.STRICT_PERSISTENCE === "true";
      if (strictPersistence) {
        throw new Error(
          "strict persistence enabled and persistence layer failed to initialize",
        );
      }
      console.error(
        "[orchestrator] ⚠️ DEGRADED MODE: persistence unavailable, continuing without Mongo-backed persistence",
      );
    }
  } else {
    console.log(
      "[orchestrator] fast-start: skipping persistence initialization",
    );
  }

  let indexers: DocIndexer[] = [];
  let indexedDocCount = 0;
  const indexRoots = [config.docsPath, config.cookbookPath].filter(
    (value): value is string => Boolean(value),
  );
  if (indexRoots.length > 0) {
    for (const root of indexRoots) {
      try {
        const rootStat = await stat(root);
        if (!rootStat.isDirectory()) {
          throw new Error("configured path is not a directory");
        }

        const indexer = new DocIndexer(root);
        if (!fastStartMode) {
          await indexer.buildInitialIndex();
          indexedDocCount += indexer.getIndex().size;
        }
        indexers.push(indexer);
      } catch (error) {
        console.warn(
          `[orchestrator] document indexing disabled for ${root}: ${(error as Error).message}`,
        );
      }
    }

    if (indexers.length === 0) {
      console.warn(
        "[orchestrator] no readable document roots available for indexing; continuing without doc watchers",
      );
      indexedDocCount = 0;
    } else if (fastStartMode) {
      console.log(
        "[orchestrator] fast-start: deferring initial document index build until after HTTP startup",
      );
    } else {
      console.log(
        `[orchestrator] indexed ${indexedDocCount} docs across ${indexers.length} source(s)`,
      );
    }
  } else {
    console.log("[orchestrator] no document roots configured for indexing");
  }

  const state = await loadState(config.stateFile, {
    taskHistoryLimit: config.taskHistoryLimit,
  });
  const githubActionsMonitorEnabled =
    process.env.NODE_ENV === "test"
      ? process.env.GITHUB_ACTIONS_MONITOR_ENABLED === "true"
      : process.env.GITHUB_ACTIONS_MONITOR_ENABLED !== "false";
  const githubMonitorRepo =
    typeof process.env.GITHUB_ACTIONS_MONITOR_REPO === "string" &&
    process.env.GITHUB_ACTIONS_MONITOR_REPO.trim().length > 0
      ? process.env.GITHUB_ACTIONS_MONITOR_REPO.trim()
      : undefined;
  const githubMonitorBranch =
    typeof process.env.GITHUB_ACTIONS_MONITOR_BRANCH === "string" &&
    process.env.GITHUB_ACTIONS_MONITOR_BRANCH.trim().length > 0
      ? process.env.GITHUB_ACTIONS_MONITOR_BRANCH.trim()
      : undefined;
  const githubMonitorGhBin =
    typeof process.env.GITHUB_ACTIONS_MONITOR_GH_BIN === "string" &&
    process.env.GITHUB_ACTIONS_MONITOR_GH_BIN.trim().length > 0
      ? process.env.GITHUB_ACTIONS_MONITOR_GH_BIN.trim()
      : undefined;
  let githubWorkflowMonitor: GitHubWorkflowMonitorState = {
    enabled: githubActionsMonitorEnabled,
    available: false,
    status: githubActionsMonitorEnabled ? "unavailable" : "disabled",
    summary: githubActionsMonitorEnabled
      ? "GitHub workflow monitor has not checked the latest push yet."
      : "GitHub workflow monitor is disabled.",
    repository: githubMonitorRepo ?? null,
    branch: githubMonitorBranch ?? null,
    lastCheckedAt: null,
    error: null,
    source: githubActionsMonitorEnabled ? "unavailable" : "disabled",
    latestRun: null,
  };
  state.indexedDocs = indexedDocCount;
  state.docIndexVersion += 1;
  const { recoveredRetryCount, staleRecoveryCount } =
    reconcileTaskRetryRecoveryState(state);
  const {
    recoveredSuccessCount,
    recoveredFailureCount,
    interruptedCount,
    awaitingApprovalCount,
  } = reconcileInFlightTaskExecutionState(state);

  if (
    recoveredRetryCount > 0 ||
    staleRecoveryCount > 0 ||
    recoveredSuccessCount > 0 ||
    recoveredFailureCount > 0 ||
    interruptedCount > 0
  ) {
    console.log(
      `[orchestrator] reconciled startup state: retries recovered=${recoveredRetryCount}, stale retry records removed=${staleRecoveryCount}, executions recovered success=${recoveredSuccessCount}, executions recovered failure=${recoveredFailureCount}, interrupted executions failed=${interruptedCount}, awaiting approval preserved=${awaitingApprovalCount}`,
    );
  }

  const flushState = async (tags: string[] = ["runtime-state"]) => {
    await persistState(config.stateFile, state, {
      taskHistoryLimit: config.taskHistoryLimit,
    });
    await invalidateResponseCacheTags(tags);
    scheduleAgentOperationalOverviewWarm(state);
  };

  const readCacheTtls = {
    knowledgeSummary: 300,
    knowledgeQuery: 300,
    tasksCatalog: 300,
    openApi: 300,
    persistenceHealth: 20,
    persistenceSummary: 60,
    approvalsPending: 15,
    incidents: 30,
    dashboardOverview: 20,
    agentsOverview: 30,
    memoryRecall: 45,
    skillsRegistry: 120,
    skillsPolicy: 120,
    skillsTelemetry: 30,
    skillsAudit: 30,
    taskRuns: 20,
    taskRunDetail: 30,
    healthExtended: 15,
  } as const;

  const refreshGitHubWorkflowMonitor = async () => {
    const nextState = await collectGitHubWorkflowMonitorState({
      enabled: githubActionsMonitorEnabled,
      cwd: process.cwd(),
      repo: githubMonitorRepo,
      branch: githubMonitorBranch,
      ghBin: githubMonitorGhBin,
    });
    const statusChanged =
      githubWorkflowMonitor.status !== nextState.status ||
      githubWorkflowMonitor.latestRun?.databaseId !==
        nextState.latestRun?.databaseId ||
      githubWorkflowMonitor.summary !== nextState.summary;
    githubWorkflowMonitor = nextState;
    if (statusChanged) {
      console.log(
        `[orchestrator] GitHub workflow monitor: ${nextState.status} (${nextState.summary})`,
      );
    }
    await invalidateResponseCacheTags(["runtime-state"]);
  };

  if (githubActionsMonitorEnabled) {
    void refreshGitHubWorkflowMonitor().catch((error) => {
      console.warn(
        `[orchestrator] GitHub workflow monitor startup check failed: ${(error as Error).message}`,
      );
    });
    setInterval(() => {
      void refreshGitHubWorkflowMonitor().catch((error) => {
        console.warn(
          `[orchestrator] GitHub workflow monitor poll failed: ${(error as Error).message}`,
        );
      });
    }, 5 * 60 * 1000);
  }

  const respondWithCachedJson = async <T>(
    req: express.Request,
    res: express.Response,
    options: {
      namespace: string;
      ttlSeconds: number;
      tags: string[];
      scope: "public" | "protected";
      keyData?: unknown;
      compute: () => Promise<T> | T;
    },
  ) => {
    const auth = (req as AuthenticatedRequest).auth;
    const cached = await getCachedJson({
      namespace: options.namespace,
      ttlSeconds: options.ttlSeconds,
      tags: options.tags,
      keyData: {
        scope: options.scope,
        actor: options.scope === "protected" ? auth?.actor ?? null : null,
        role: options.scope === "protected" ? auth?.role ?? null : null,
        query: req.query,
        params: req.params,
        body: req.method === "POST" ? req.body ?? null : null,
        extra: options.keyData ?? null,
      },
      compute: options.compute,
    });

    res.setHeader("X-OpenClaw-Cache", cached.meta.status);
    res.setHeader("X-OpenClaw-Cache-Store", cached.meta.store);
    res.setHeader(
      "Cache-Control",
      `${options.scope === "public" ? "public" : "private"}, max-age=${options.ttlSeconds}`,
    );
    if (options.scope === "protected") {
      res.setHeader("Vary", "Authorization");
    }
    res.json(cached.value);
  };

  const warmDocumentIndexInBackground = async () => {
    if (!fastStartMode || indexers.length === 0) {
      return;
    }

    try {
      let warmCount = 0;
      let readyCount = 0;

      for (const indexer of indexers) {
        try {
          await indexer.buildInitialIndex();
          warmCount += indexer.getIndex().size;
          readyCount += 1;
        } catch (error) {
          console.warn(
            `[orchestrator] skipped document warm-up for one source: ${(error as Error).message}`,
          );
        }
      }

      indexedDocCount = warmCount;
      state.indexedDocs = indexedDocCount;
      state.docIndexVersion += 1;
      await flushState(["runtime-state", "knowledge-state"]);
      console.log(
        `[orchestrator] indexed ${indexedDocCount} docs across ${readyCount} source(s)`,
      );
      console.log(
        "[orchestrator] fast-start: document index warm-up complete; watch hooks remain enabled for freshness",
      );
    } catch (error) {
      console.error(
        "[orchestrator] failed to warm document index in fast-start mode:",
        error,
      );
    }
  };

  let startupTasksInitialized = false;
  const completeDeferredStartup = async () => {
    if (startupTasksInitialized) {
      return;
    }
    startupTasksInitialized = true;

    await flushState(["runtime-state", "knowledge-state"]);
    if (recoveredRetryCount > 0) {
      console.warn(
        `[orchestrator] recovered ${recoveredRetryCount} interrupted retry task(s) as failed after restart`,
      );
    }
    if (staleRecoveryCount > 0) {
      console.warn(
        `[orchestrator] dropped ${staleRecoveryCount} stale persisted retry recovery record(s) during startup reconciliation`,
      );
    }

    if (state.taskRetryRecoveries.length > 0) {
      for (const recovery of state.taskRetryRecoveries) {
        scheduleRetryRecovery(recovery);
      }
      console.log(
        `[orchestrator] scheduled ${state.taskRetryRecoveries.length} persisted retry recovery task(s) after startup`,
      );
    }

    for (const indexer of indexers) {
      indexer.watch((doc) => {
        queue.enqueue("doc-change", {
          path: doc.path,
          lastModified: doc.lastModified,
        });
      });
    }

    // CRON SCHEDULING (replaces setInterval)

    // 11:00 PM UTC: Nightly batch (doc-sync + mark high-confidence items for drafting)
    cron.schedule(config.nightlyBatchSchedule || "0 23 * * *", () => {
      console.log("[cron] nightly-batch triggered");
      queue.enqueue("nightly-batch", { reason: "scheduled" });
    });

    // 6:00 AM UTC: Send morning digest notification
    cron.schedule(config.morningNotificationSchedule || "0 6 * * *", () => {
      console.log("[cron] send-digest triggered");
      queue.enqueue("send-digest", { reason: "scheduled" });
    });

    // 5-minute heartbeat for health checks (keeps background monitoring)
    let lastHeartbeatTime = Date.now();
    cron.schedule("*/5 * * * *", () => {
      lastHeartbeatTime = Date.now();
      queue.enqueue("heartbeat", { reason: "periodic" });
    });

    // Monitor heartbeat failures (detect if orchestrator is hung)
    setInterval(
      () => {
        const timeSinceLastHeartbeat = Date.now() - lastHeartbeatTime;
        const heartbeatThreshold = 15 * 60 * 1000; // 15 minutes

        if (timeSinceLastHeartbeat > heartbeatThreshold) {
          alertManager.critical(
            "orchestrator",
            "Heartbeat missed - orchestrator may be hung",
            {
              timeSinceLastHeartbeatMs: timeSinceLastHeartbeat,
            },
          );
        }
      },
      10 * 60 * 1000,
    ); // Check every 10 minutes

    // Cleanup old alerts periodically
    setInterval(
      () => {
        alertManager.cleanup(48); // Keep alerts for 48 hours
      },
      6 * 60 * 60 * 1000,
    ); // Clean up every 6 hours

    console.log("[orchestrator] 🔔 Alerts configured and monitoring started");
    console.log(
      "[orchestrator] Scheduled 3 cron jobs: nightly-batch (11pm), send-digest (6am), heartbeat (5min)",
    );

    // ============================================================
    // Phase 5: Knowledge Base Automation
    // ============================================================

    if (!fastStartMode) {
      await knowledgeIntegration.start();
    } else {
      console.log(
        "[orchestrator] fast-start: skipping knowledge integration startup",
      );
    }

    queue.enqueue("startup", { reason: "orchestrator boot" });
  };

  const taskHistoryLimit = Number.isFinite(config.taskHistoryLimit)
    ? Math.max(
        1,
        Math.min(10000, Math.floor(config.taskHistoryLimit as number)),
      )
    : 50;
  const retryMaxAttempts = Number.isFinite(config.retryMaxAttempts)
    ? Math.max(0, Math.floor(config.retryMaxAttempts as number))
    : 2;
  const retryBackoffMs = Number.isFinite(config.retryBackoffMs)
    ? Math.max(0, Math.floor(config.retryBackoffMs as number))
    : 500;

  const ensureExecutionRecord = (task: Task) => {
    const idempotencyKey =
      typeof task.idempotencyKey === "string" &&
      task.idempotencyKey.trim().length > 0
        ? task.idempotencyKey
        : task.id;
    const existing = state.taskExecutions.find(
      (item) => item.idempotencyKey === idempotencyKey,
    );
    if (existing) {
      existing.visibility =
        existing.visibility ?? resolveTaskVisibility(task.payload, task.type);
      existing.maintenanceCheckId =
        existing.maintenanceCheckId ?? resolveMaintenanceCheckId(task.payload);
      return { existing, idempotencyKey };
    }

    const created = {
      taskId: task.id,
      idempotencyKey,
      type: task.type,
      visibility: resolveTaskVisibility(task.payload, task.type),
      maintenanceCheckId: resolveMaintenanceCheckId(task.payload),
      status: "pending" as const,
      attempt: task.attempt ?? 1,
      maxRetries: Number.isFinite(task.maxRetries)
        ? Number(task.maxRetries)
        : retryMaxAttempts,
      startedAt: null,
      completedAt: null,
      lastHandledAt: new Date().toISOString(),
      lastError: undefined as string | undefined,
      resultSummary: undefined as
        | {
            success?: boolean;
            keys: string[];
            highlights?: Record<string, unknown>;
          }
        | undefined,
      accounting: null,
    };
    state.taskExecutions.push(created);
    return { existing: created, idempotencyKey };
  };

  const resolveTaskActor = (task: Task) =>
    typeof task.payload.__actor === "string" && task.payload.__actor.trim().length > 0
      ? task.payload.__actor.trim()
      : "system";

  const findExecutionByTaskId = (taskId: string) =>
    state.taskExecutions.find((item) => item.taskId === taskId) ?? null;

  const appendTaskWorkflowEvent = (
    task: Task,
    stage: WorkflowEventStage,
    stateLabel: string,
    detail: string,
    options?: {
      source?: string;
      actor?: string | null;
      nodeId?: string;
      evidence?: string[];
      timestamp?: string;
      attempt?: number;
      relatedNodeIds?: string[];
      stopCode?: string | null;
      parentEventId?: string | null;
      relatedRunId?: string | null;
      dependencyRunIds?: string[];
      toolId?: string | null;
      proofTransport?: "milestone" | "demandSummary" | null;
      classification?: string | null;
    },
  ) => {
    const { idempotencyKey } = ensureExecutionRecord(task);
    return appendWorkflowEvent({
      state,
      runId: idempotencyKey,
      taskId: task.id,
      type: task.type,
      stage,
      stateLabel,
      source: options?.source ?? "queue",
      actor: options?.actor ?? resolveTaskActor(task),
      nodeId: options?.nodeId ?? `${stage}:${task.type}`,
      detail,
      evidence: options?.evidence ?? [],
      timestamp: options?.timestamp,
      attempt: options?.attempt,
      relatedNodeIds: options?.relatedNodeIds,
      stopCode: options?.stopCode,
      parentEventId: options?.parentEventId,
      relatedRunId: options?.relatedRunId,
      dependencyRunIds: options?.dependencyRunIds,
      toolId: options?.toolId,
      proofTransport: options?.proofTransport,
      classification: options?.classification,
    });
  };

  const appendTaskRelationshipObservation = (
    task: Task,
    from: string,
    to: string,
    relationship: RelationshipObservationType,
    detail: string,
    options?: {
      source?: string;
      status?: RelationshipObservationRecord["status"];
      evidence?: string[];
      timestamp?: string;
    },
  ) => {
    appendRelationshipObservationRecord(state, {
      observationId: randomUUID(),
      timestamp: options?.timestamp ?? new Date().toISOString(),
      from,
      to,
      relationship,
      status: options?.status ?? "observed",
      source: options?.source ?? "queue",
      detail,
      taskId: task.id,
      runId: task.idempotencyKey ?? task.id,
      evidence: dedupeStrings(options?.evidence ?? [], 12),
    });
  };

  const appendCrossRunRelationshipObservation = (args: {
    fromRunId: string;
    toRunId: string;
    relationship: "depends-on-run" | "cross-run-handoff";
    detail: string;
    source: string;
    taskId?: string | null;
    targetTaskId?: string | null;
    classification?: string | null;
    timestamp?: string;
    evidence?: string[];
  }) => {
    if (!args.fromRunId || !args.toRunId || args.fromRunId === args.toRunId) {
      return null;
    }
    const timestamp = args.timestamp ?? new Date().toISOString();
    const observation: RelationshipObservationRecord = {
      observationId: randomUUID(),
      timestamp,
      from: `run:${args.fromRunId}`,
      to: `run:${args.toRunId}`,
      relationship: args.relationship,
      status: "observed",
      source: args.source,
      detail: args.detail,
      taskId: args.taskId ?? null,
      runId: args.fromRunId,
      targetTaskId: args.targetTaskId ?? null,
      targetRunId: args.toRunId,
      classification: args.classification ?? null,
      evidence: dedupeStrings(args.evidence ?? [], 12),
    };
    appendRelationshipObservationRecord(state, observation);
    return observation;
  };

  const countRemediationAttempts = (
    incident: IncidentLedgerRecord,
    lane: IncidentRemediationTaskRecord["lane"],
  ) =>
    (incident.remediationTasks ?? []).filter((task) => task.lane === lane).length;

  const recordTaskResult = (
    task: Task,
    result: "ok" | "error",
    message?: string,
  ) => {
    const visibility = resolveTaskVisibility(task.payload, task.type);
    const maintenanceCheckId = resolveMaintenanceCheckId(task.payload);
    state.taskHistory.push({
      id: task.id,
      type: task.type,
      handledAt: new Date().toISOString(),
      result,
      message,
      visibility,
      maintenanceCheckId,
    });
    if (state.taskHistory.length > taskHistoryLimit) {
      state.taskHistory.shift();
    }
  };

  const queue = new TaskQueue();
  const handlerContext = {
    config,
    state,
    saveState: flushState,
    enqueueTask: (type: string, payload: Record<string, unknown>) =>
      queue.enqueue(type, payload),
    getQueueSnapshot: () => queue.getSnapshot(),
    logger: console,
    appendIncidentHistoryEvent: (
      incidentId: string,
      event: Omit<IncidentHistoryEvent, "id" | "evidence"> & {
        evidence?: string[];
      },
    ) => {
      const incident =
        state.incidentLedger.find((record) => record.incidentId === incidentId) ?? null;
      if (!incident) {
        return;
      }
      appendIncidentHistoryEvent(incident, event);
    },
    appendTaskWorkflowEvent,
  };
  const retryRecoveryTimers = new Map<string, NodeJS.Timeout>();

  const clearRetryRecoveryTimer = (idempotencyKey: string) => {
    const timer = retryRecoveryTimers.get(idempotencyKey);
    if (!timer) return;
    clearTimeout(timer);
    retryRecoveryTimers.delete(idempotencyKey);
  };

  const findRetryRecovery = (idempotencyKey: string) =>
    state.taskRetryRecoveries.find(
      (record) => record.idempotencyKey === idempotencyKey,
    );

  const findRepairRecordById = (repairId: string) =>
    state.repairRecords.find((record) => record.repairId === repairId) ?? null;

  const createIncidentRemediationTask = (
    incident: IncidentLedgerRecord,
    options: {
      actor: string;
      note?: string;
      overrideTaskType?:
        | "drift-repair"
        | "build-refactor"
        | "qa-verification"
        | "system-monitor";
      trigger:
        | "manual"
        | "policy-create"
        | "policy-retry"
        | "policy-verification"
        | "policy-escalation";
    },
  ) => {
    const actor = options.actor.trim().length > 0 ? options.actor.trim() : "system";
    const remediationSpec = resolveIncidentRemediationTaskSpec(
      incident,
      actor,
      options.note,
      options.overrideTaskType,
    );
    const lane: IncidentRemediationTaskRecord["lane"] =
      options.trigger === "policy-verification"
        ? "verification"
        : options.trigger === "policy-escalation"
          ? "escalation"
          : "primary";
    const existingOpenTask = (incident.remediationTasks ?? []).find((item) => {
      if (item.taskType !== remediationSpec.taskType || item.lane !== lane) {
        return false;
      }
      const status = deriveIncidentRemediationTaskStatus(state, item);
      return !["resolved", "failed", "blocked"].includes(status);
    });
    if (existingOpenTask) {
      return {
        created: false as const,
        remediationTask: existingOpenTask,
        queuedTaskId: existingOpenTask.taskId,
      };
    }

    const remediationId = randomUUID();
    const queuedTask = queue.enqueue(remediationSpec.taskType, {
      ...remediationSpec.payload,
      __remediationId: remediationId,
      __role: options.trigger === "manual" ? "operator" : "system",
      __requestId: null,
    });
    const createdAt = new Date().toISOString();
    const assignedTo =
      options.trigger === "manual" ? actor : incident.policy.preferredOwner;
    const remediationTask: IncidentRemediationTaskRecord = {
      remediationId,
      lane,
      createdAt,
      createdBy: actor,
      assignedTo,
      assignedAt: createdAt,
      taskType: remediationSpec.taskType,
      taskId: queuedTask.id,
      runId: queuedTask.idempotencyKey ?? queuedTask.id,
      status: "assigned",
      reason: remediationSpec.reason,
      note: options.note ?? null,
      lastUpdatedAt: createdAt,
      blockers: [],
    };

    if (!incident.owner) {
      assignIncidentOwner(
        state,
        incident.incidentId,
        assignedTo,
        actor,
        options.trigger === "manual"
          ? "Owner set automatically when remediation was assigned."
          : `Owner assigned automatically from ${incident.policy.policyId}.`,
      );
    }

    incident.remediationTasks = [
      ...(incident.remediationTasks ?? []),
      remediationTask,
    ].slice(-50);
    incident.linkedTaskIds = dedupeStrings(
      [...incident.linkedTaskIds, queuedTask.id],
      50,
    );
    incident.linkedRunIds = dedupeStrings(
      [...incident.linkedRunIds, queuedTask.idempotencyKey ?? queuedTask.id],
      50,
    );
    const upstreamRunIds = dedupeStrings(
      incident.linkedRunIds.filter(
        (runId) => runId !== (queuedTask.idempotencyKey ?? queuedTask.id),
      ),
      25,
    );
    incident.remediation.status = "in-progress";
    incident.remediation.summary =
      options.trigger === "policy-verification"
        ? `Verifier lane ${remediationSpec.taskType} queued automatically.`
        : options.trigger === "policy-escalation"
          ? `Escalation lane ${remediationSpec.taskType} queued automatically.`
        : remediationSpec.reason;
    incident.remediation.owner = incident.owner ? "operator" : incident.remediation.owner;
    incident.remediation.nextAction = `Track assignment, execution, verification, and resolution for remediation task ${queuedTask.id}.`;
    incident.remediation.blockers = [];
    appendIncidentHistoryEvent(incident, {
      timestamp: createdAt,
      type: "remediation-task-created",
      actor,
      summary: remediationSpec.reason,
      detail:
        options.note ??
        `Queued remediation task ${queuedTask.id} using ${remediationSpec.taskType}.`,
      evidence: [
        queuedTask.id,
        queuedTask.idempotencyKey ?? queuedTask.id,
        remediationSpec.taskType,
      ],
    });
    appendIncidentHistoryEvent(incident, {
      timestamp: createdAt,
      type: "remediation-assigned",
      actor,
      summary: `Remediation ${remediationId} assigned to ${assignedTo}.`,
      detail:
        options.note ??
        `${options.trigger === "manual" ? "Operator" : "Policy"} assigned remediation task ${queuedTask.id} (${remediationSpec.taskType}).`,
      evidence: [remediationId, queuedTask.id, assignedTo],
    });
    if (upstreamRunIds.length > 0) {
      appendWorkflowEvent({
        state,
        runId: queuedTask.idempotencyKey ?? queuedTask.id,
        taskId: queuedTask.id,
        type: queuedTask.type,
        stage: lane === "verification" || lane === "escalation" ? "repair" : "agent",
        stateLabel:
          lane === "verification"
            ? "verification-handoff"
            : lane === "escalation"
              ? "escalation-handoff"
              : "dependency-linked",
        source: "repair",
        actor,
        nodeId: remediationId,
        detail: `Remediation run linked to ${upstreamRunIds.length} upstream run(s).`,
        evidence: [incident.incidentId, remediationId, queuedTask.id],
        timestamp: createdAt,
        relatedRunId: upstreamRunIds[0] ?? null,
        dependencyRunIds: upstreamRunIds,
        classification: "incident-remediation",
      });
      for (const sourceRunId of upstreamRunIds) {
        appendCrossRunRelationshipObservation({
          fromRunId: sourceRunId,
          toRunId: queuedTask.idempotencyKey ?? queuedTask.id,
          relationship: "cross-run-handoff",
          detail: `Incident ${incident.incidentId} handed off ${sourceRunId} into remediation run ${queuedTask.idempotencyKey ?? queuedTask.id}.`,
          source: "repair",
          taskId: incident.linkedTaskIds[0] ?? null,
          targetTaskId: queuedTask.id,
          classification: "incident-remediation",
          timestamp: createdAt,
          evidence: [incident.incidentId, remediationId, queuedTask.id],
        });
      }
    }
    if (options.trigger !== "manual") {
      const action =
        options.trigger === "policy-create"
          ? "auto-remediation-created"
          : options.trigger === "policy-retry"
            ? "auto-remediation-retried"
            : options.trigger === "policy-verification"
              ? "auto-verification-created"
              : "auto-escalation-created";
      appendIncidentPolicyExecution(incident, {
        executedAt: createdAt,
        actor,
        policyId: incident.policy.policyId,
        trigger: options.trigger,
        action,
        result: "executed",
        summary:
          options.trigger === "policy-retry"
            ? `Policy ${incident.policy.policyId} retried remediation automatically.`
            : options.trigger === "policy-verification"
              ? `Policy ${incident.policy.policyId} queued a verifier lane automatically.`
              : options.trigger === "policy-escalation"
                ? `Policy ${incident.policy.policyId} escalated the incident automatically.`
                : `Policy ${incident.policy.policyId} queued an automatic remediation lane.`,
        detail:
          options.note ??
          `${queuedTask.id} queued as ${lane} remediation using ${remediationSpec.taskType}.`,
        remediationId,
        taskId: queuedTask.id,
        runId: queuedTask.idempotencyKey ?? queuedTask.id,
        evidence: [queuedTask.id, remediationSpec.taskType, assignedTo],
      });
    }

    return { created: true as const, remediationTask, queuedTaskId: queuedTask.id };
  };

  const ensureIncidentPolicyAutomation = () => {
    let created = 0;
    for (const incident of state.incidentLedger) {
      if (incident.status === "resolved") continue;

      const primaryTaskType = incident.policy.remediationTaskType;
      const latestPrimary = [...(incident.remediationTasks ?? [])]
        .filter((item) => item.lane === "primary" && item.taskType === primaryTaskType)
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
      const latestPrimaryStatus = latestPrimary
        ? deriveIncidentRemediationTaskStatus(state, latestPrimary)
        : null;
      const primaryAttemptCount = countRemediationAttempts(incident, "primary");

      if (incident.policy.autoRemediateOnCreate && !latestPrimary) {
        const result = createIncidentRemediationTask(incident, {
          actor: "system:auto-remediation",
          trigger: "policy-create",
        });
        if (result.created) created += 1;
        continue;
      }

      if (
        incident.policy.autoRetryBlockedRemediation &&
        latestPrimaryStatus &&
        ["failed", "blocked"].includes(latestPrimaryStatus) &&
        primaryAttemptCount < incident.policy.maxAutoRemediationAttempts
      ) {
        const result = createIncidentRemediationTask(incident, {
          actor: "system:auto-remediation",
          note: `Retrying blocked remediation automatically after ${latestPrimaryStatus} status.`,
          overrideTaskType: primaryTaskType,
          trigger: "policy-retry",
        });
        if (result.created) {
          created += 1;
          continue;
        }
      }

      const verifierTaskType = incident.policy.verifierTaskType;
      if (
        verifierTaskType &&
        verifierTaskType !== primaryTaskType &&
        latestPrimaryStatus &&
        ["completed", "verified", "resolved"].includes(latestPrimaryStatus) &&
        incident.verification.status === "pending"
      ) {
        const result = createIncidentRemediationTask(incident, {
          actor: "system:auto-verification",
          note: "Verifier queued automatically after primary remediation completed.",
          overrideTaskType: verifierTaskType,
          trigger: "policy-verification",
        });
        if (result.created) created += 1;
      }

      const latestEscalation = [...(incident.remediationTasks ?? [])]
        .filter((item) => item.lane === "escalation")
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
      const latestEscalationStatus = latestEscalation
        ? deriveIncidentRemediationTaskStatus(state, latestEscalation)
        : null;
      if (
        incident.policy.autoEscalateOnBreach &&
        incident.policy.escalationTaskType &&
        incident.escalation.level === "breached" &&
        !latestEscalationStatus
      ) {
        const result = createIncidentRemediationTask(incident, {
          actor: "system:auto-escalation",
          note: "Escalation lane queued automatically after SLA breach.",
          overrideTaskType: incident.policy.escalationTaskType,
          trigger: "policy-escalation",
        });
        if (result.created) {
          created += 1;
          continue;
        }
      }
    }
    return created;
  };

  const refreshRuntimeIncidents = async (options: {
    includeIncidentDetails?: boolean;
    precomputed?: {
      persistence: Awaited<ReturnType<typeof PersistenceIntegration.healthCheck>>;
      agents: Awaited<ReturnType<typeof buildAgentOperationalOverview>>;
      governance: ReturnType<typeof summarizeGovernanceVisibility>;
      knowledgeRuntime: ReturnType<typeof buildKnowledgeRuntimeSignals>;
      pendingApprovalsCount: number;
    };
  } = {}) => {
    const precomputed = options.precomputed;
    const persistence =
      precomputed?.persistence ?? (await PersistenceIntegration.healthCheck());
    const agents = precomputed?.agents ?? (await buildAgentOperationalOverview(state));
    const governance = precomputed?.governance ?? summarizeGovernanceVisibility(state);
    const knowledgeRuntime =
      precomputed?.knowledgeRuntime ??
      buildKnowledgeRuntimeSignals({
        summary: knowledgeIntegration.getSummary(),
        config,
        state,
      });
    const pendingApprovalsCount =
      precomputed?.pendingApprovalsCount ?? listPendingApprovals(state).length;
    const incidentState = buildRuntimeIncidentModel({
      config,
      state,
      fastStartMode,
      persistence,
      agents,
      governance,
      pendingApprovalsCount,
      knowledgeRuntime,
      githubWorkflowMonitor,
      includeIncidentDetails: options.includeIncidentDetails,
    });
    const autoCreated = ensureIncidentPolicyAutomation();
    if (autoCreated === 0) {
      return incidentState;
    }
    const refreshed = buildRuntimeIncidentModel({
      config,
      state,
      fastStartMode,
      persistence,
      agents,
      governance,
      pendingApprovalsCount,
      knowledgeRuntime,
      githubWorkflowMonitor,
      includeIncidentDetails: options.includeIncidentDetails,
    });
    return {
      changed: incidentState.changed || autoCreated > 0 || refreshed.changed,
      model: refreshed.model,
    };
  };

  const syncIncidentRemediationOnTaskStart = (
    task: Task,
    idempotencyKey: string,
  ) => {
    const incidentId =
      typeof task.payload.__incidentId === "string" ? task.payload.__incidentId : null;
    const remediationId =
      typeof task.payload.__remediationId === "string"
        ? task.payload.__remediationId
        : null;
    if (!incidentId || !remediationId) {
      return;
    }

    const { incident, remediationTask } = findIncidentRemediationTask(
      state,
      incidentId,
      remediationId,
    );
    if (!incident || !remediationTask) {
      return;
    }

    const startedAt = new Date().toISOString();
    const actor = resolveTaskActor(task);
    remediationTask.runId = idempotencyKey;
    remediationTask.status = "running";
    remediationTask.assignedTo = remediationTask.assignedTo ?? actor;
    remediationTask.assignedAt = remediationTask.assignedAt ?? startedAt;
    remediationTask.executionStartedAt =
      remediationTask.executionStartedAt ?? startedAt;
    remediationTask.lastUpdatedAt = startedAt;
    remediationTask.blockers = [];

    incident.remediation.status = "in-progress";
    incident.remediation.owner = incident.owner ? "operator" : incident.remediation.owner;
    incident.remediation.summary = `${remediationTask.taskType} remediation is executing.`;
    incident.remediation.nextAction = `Wait for remediation task ${remediationTask.taskId} to complete.`;
    incident.remediation.blockers = [];

    appendIncidentHistoryEvent(incident, {
      timestamp: startedAt,
      type: "remediation-executing",
      actor,
      summary: `Remediation task ${remediationTask.taskType} started.`,
      detail: `Remediation ${remediationTask.remediationId} is running under ${actor}.`,
      evidence: [
        remediationTask.remediationId,
        remediationTask.taskId,
        remediationTask.taskType,
      ],
    });
  };

  const syncIncidentRemediationOnTaskSuccess = async (
    task: Task,
    idempotencyKey: string,
    message?: string,
  ) => {
    const incidentId =
      typeof task.payload.__incidentId === "string" ? task.payload.__incidentId : null;
    const remediationId =
      typeof task.payload.__remediationId === "string"
        ? task.payload.__remediationId
        : null;
    if (!incidentId || !remediationId) {
      return;
    }

    const initial = findIncidentRemediationTask(state, incidentId, remediationId);
    if (!initial.incident || !initial.remediationTask) {
      return;
    }

    const verifyingAt = new Date().toISOString();
    initial.remediationTask.runId = idempotencyKey;
    initial.remediationTask.status = "verifying";
    initial.remediationTask.executionCompletedAt = verifyingAt;
    initial.remediationTask.verificationStartedAt = verifyingAt;
    initial.remediationTask.lastUpdatedAt = verifyingAt;
    initial.remediationTask.verificationSummary =
      message ?? `Remediation task ${task.type} completed successfully.`;
    initial.remediationTask.blockers = [];

    initial.incident.remediation.status = "watching";
    initial.incident.remediation.summary =
      message ?? `Remediation task ${task.type} completed; verifying incident state.`;
    initial.incident.remediation.nextAction =
      "Reconcile runtime truth and confirm the incident condition cleared.";
    initial.incident.remediation.blockers = [];

    const incidentState = await refreshRuntimeIncidents();
    if (incidentState.changed) {
      await flushState();
    }

    const current = findIncidentRemediationTask(state, incidentId, remediationId);
    if (!current.incident || !current.remediationTask) {
      return;
    }

    const verifiedAt = new Date().toISOString();
    current.remediationTask.verificationCompletedAt = verifiedAt;
    current.remediationTask.lastUpdatedAt = verifiedAt;
    const verifierTaskType = current.incident.policy.verifierTaskType;
    const requiresSeparateVerifier =
      Boolean(verifierTaskType) && verifierTaskType !== current.remediationTask.taskType;

    if (requiresSeparateVerifier) {
      current.remediationTask.status = "verified";
      current.remediationTask.verifiedAt = verifiedAt;
      current.remediationTask.verificationSummary =
        message ??
        `Primary remediation ${current.remediationTask.taskType} completed; verifier lane required before closure.`;
      current.remediationTask.blockers = [];
      const autoVerifier = createIncidentRemediationTask(current.incident, {
        actor: "system:auto-verification",
        note: "Verifier queued automatically after primary remediation completed.",
        overrideTaskType: verifierTaskType ?? undefined,
        trigger: "policy-verification",
      });
      current.incident.remediation.status = autoVerifier.created ? "watching" : "in-progress";
      current.incident.remediation.summary = autoVerifier.created
        ? "Primary remediation completed; verifier lane is now queued."
        : "Primary remediation completed; verifier lane is already active.";
      current.incident.remediation.nextAction = autoVerifier.created
        ? `Wait for verifier task ${autoVerifier.queuedTaskId} to produce a closure verdict.`
        : "Track the existing verifier task to completion.";
      current.incident.remediation.blockers = [];
      appendIncidentHistoryEvent(current.incident, {
        timestamp: verifiedAt,
        type: "remediation-verified",
        actor: resolveTaskActor(task),
        summary: `Primary remediation ${current.remediationTask.remediationId} completed.`,
        detail:
          message ??
          `Task ${task.type} completed; a verifier task is required before incident closure.`,
        evidence: [
          current.remediationTask.remediationId,
          current.remediationTask.taskId,
          verifierTaskType ?? "no-verifier",
        ],
      });
      return;
    }

    if (current.incident.status === "resolved") {
      current.remediationTask.status = "resolved";
      current.remediationTask.verifiedAt = verifiedAt;
      current.remediationTask.resolvedAt = verifiedAt;
      current.remediationTask.resolutionSummary =
        "Runtime reconciliation no longer reports the incident candidate.";
      current.remediationTask.blockers = [];
      current.incident.remediation.status = "resolved";
      current.incident.remediation.summary =
        "Remediation completed and the incident condition cleared.";
      current.incident.remediation.nextAction =
        "Keep watching runtime truth in case the condition reappears.";
      current.incident.remediation.blockers = [];
      appendIncidentHistoryEvent(current.incident, {
        timestamp: verifiedAt,
        type: "remediation-verified",
        actor: resolveTaskActor(task),
        summary: `Remediation ${current.remediationTask.remediationId} resolved the incident.`,
        detail:
          message ??
          `Task ${task.type} completed and runtime reconciliation marked the incident resolved.`,
        evidence: [
          current.remediationTask.remediationId,
          current.remediationTask.taskId,
          current.incident.incidentId,
        ],
      });
      return;
    }

    const blockers = dedupeStrings(
      [
        current.incident.summary,
        ...current.incident.recommendedSteps,
        ...current.incident.evidence,
      ],
      8,
    );
    current.remediationTask.status = "blocked";
    current.remediationTask.verificationSummary =
      message ??
      "Remediation task completed but the incident condition is still present in runtime truth.";
    current.remediationTask.blockers = blockers;
    current.incident.remediation.status = "blocked";
    current.incident.remediation.summary =
      "Remediation task completed, but runtime truth still reports this incident.";
    current.incident.remediation.nextAction =
      current.incident.recommendedSteps[0] ??
      "Review the incident evidence and escalate to the appropriate operator.";
    current.incident.remediation.blockers = blockers;

    appendIncidentHistoryEvent(current.incident, {
      timestamp: verifiedAt,
      type: "remediation-status-changed",
      actor: resolveTaskActor(task),
      summary: `Remediation ${current.remediationTask.remediationId} is blocked pending follow-up.`,
      detail:
        message ??
        "The remediation task succeeded, but runtime reconciliation still reports the incident condition.",
      evidence: blockers,
    });
  };

  const syncIncidentRemediationOnTaskFailure = (
    task: Task,
    idempotencyKey: string,
    err: Error,
  ) => {
    const incidentId =
      typeof task.payload.__incidentId === "string" ? task.payload.__incidentId : null;
    const remediationId =
      typeof task.payload.__remediationId === "string"
        ? task.payload.__remediationId
        : null;
    if (!incidentId || !remediationId) {
      return;
    }

    const { incident, remediationTask } = findIncidentRemediationTask(
      state,
      incidentId,
      remediationId,
    );
    if (!incident || !remediationTask) {
      return;
    }

    const failedAt = new Date().toISOString();
    remediationTask.runId = idempotencyKey;
    remediationTask.status = "failed";
    remediationTask.executionCompletedAt = failedAt;
    remediationTask.lastUpdatedAt = failedAt;
    remediationTask.verificationSummary = err.message;
    remediationTask.blockers = dedupeStrings([err.message], 6);

    incident.remediation.status = "blocked";
    incident.remediation.summary = `Remediation task ${task.type} failed.`;
    incident.remediation.nextAction =
      incident.recommendedSteps[0] ??
      "Inspect the remediation task failure and decide whether to retry or escalate.";
    incident.remediation.blockers = dedupeStrings([err.message], 6);

    appendIncidentHistoryEvent(incident, {
      timestamp: failedAt,
      type: "remediation-status-changed",
      actor: resolveTaskActor(task),
      summary: `Remediation task ${task.type} failed.`,
      detail: err.message,
      evidence: [remediationTask.remediationId, remediationTask.taskId, err.message],
    });
  };

  const syncRepairRecordOnTaskStart = (task: Task, idempotencyKey: string) => {
    const repairId =
      typeof task.payload.__repairId === "string" ? task.payload.__repairId : null;
    if (repairId) {
      updateRepairRecord(state, repairId, (record) => ({
        ...record,
        status: "running",
        startedAt: new Date().toISOString(),
        repairTaskId: task.id,
        repairRunId: idempotencyKey,
        lastError: undefined,
      }));
      appendTaskWorkflowEvent(
        task,
        "repair",
        "running",
        `Repair ${repairId} started for ${task.type}.`,
        {
          source: "repair",
          nodeId: repairId,
          evidence: [repairId, task.type],
        },
      );
    }

    const retryRepairId = `retry:${idempotencyKey}`;
    if (findRepairRecordById(retryRepairId)?.status === "queued") {
      updateRepairRecord(state, retryRepairId, (record) => ({
        ...record,
        status: "running",
        startedAt: new Date().toISOString(),
        repairTaskId: task.id,
        repairRunId: idempotencyKey,
        lastError: undefined,
      }));
      appendTaskWorkflowEvent(
        task,
        "repair",
        "running",
        `Retry recovery repair ${retryRepairId} started for ${task.type}.`,
        {
          source: "repair",
          nodeId: retryRepairId,
          evidence: [retryRepairId, task.type],
        },
      );
    }
  };

  const syncRepairRecordOnTaskSuccess = (
    task: Task,
    idempotencyKey: string,
    message?: string,
  ) => {
    const completedAt = new Date().toISOString();
    const repairId =
      typeof task.payload.__repairId === "string" ? task.payload.__repairId : null;
    if (repairId) {
      updateRepairRecord(state, repairId, (record) => ({
        ...record,
        status: "verified",
        repairTaskId: task.id,
        repairRunId: idempotencyKey,
        completedAt,
        verifiedAt: completedAt,
        verificationSummary:
          message ?? record.verificationSummary ?? "repair task completed successfully",
        evidence: [
          ...(record.evidence ?? []),
          `task-success:${task.type}`,
        ].slice(-10),
        lastError: undefined,
      }));
      appendTaskWorkflowEvent(
        task,
        "repair",
        "verified",
        message ?? `Repair ${repairId} verified successfully.`,
        {
          source: "repair",
          nodeId: repairId,
          evidence: [repairId, task.type],
          timestamp: completedAt,
        },
      );
    }

    const retryRepairId = `retry:${idempotencyKey}`;
    if (findRepairRecordById(retryRepairId)) {
      updateRepairRecord(state, retryRepairId, (record) => ({
        ...record,
        status: "verified",
        repairTaskId: task.id,
        repairRunId: idempotencyKey,
        completedAt,
        verifiedAt: completedAt,
        verificationSummary:
          message ?? record.verificationSummary ?? "retry recovery completed successfully",
        evidence: [
          ...(record.evidence ?? []),
          `task-success:${task.type}`,
        ].slice(-10),
        lastError: undefined,
      }));
      appendTaskWorkflowEvent(
        task,
        "repair",
        "verified",
        message ?? `Retry recovery ${retryRepairId} completed successfully.`,
        {
          source: "repair",
          nodeId: retryRepairId,
          evidence: [retryRepairId, task.type],
          timestamp: completedAt,
        },
      );
    }
  };

  const syncRepairRecordOnTaskFailure = (
    task: Task,
    idempotencyKey: string,
    err: Error,
    retryScheduled: boolean,
    attempt: number,
    maxRetries: number,
  ) => {
    const completedAt = new Date().toISOString();
    const repairId =
      typeof task.payload.__repairId === "string" ? task.payload.__repairId : null;

    if (repairId && !retryScheduled) {
      updateRepairRecord(state, repairId, (record) => ({
        ...record,
        status: "failed",
        repairTaskId: task.id,
        repairRunId: idempotencyKey,
        completedAt,
        lastError: err.message,
        evidence: [
          ...(record.evidence ?? []),
          `task-failure:${task.type}`,
        ].slice(-10),
      }));
      appendTaskWorkflowEvent(
        task,
        "repair",
        "failed",
        `Repair ${repairId} failed: ${err.message}`,
        {
          source: "repair",
          nodeId: repairId,
          evidence: [repairId, task.type],
          timestamp: completedAt,
        },
      );
    }

    const retryRepairId = `retry:${idempotencyKey}`;
    if (retryScheduled) {
      upsertRepairRecord(state, {
        repairId: retryRepairId,
        classification: "task-retry-recovery",
        trigger: "automatic-retry",
        sourceTaskId: task.id,
        sourceTaskType: task.type,
        sourceRunId: idempotencyKey,
        repairTaskType: task.type,
        repairTaskId: task.id,
        repairRunId: idempotencyKey,
        verificationMode: "task-success",
        status: "queued",
        detectedAt: completedAt,
        queuedAt: completedAt,
        verificationSummary: `retry scheduled after attempt ${attempt} of ${maxRetries + 1}`,
        evidence: [
          `attempt:${attempt}`,
          `maxRetries:${maxRetries}`,
        ],
        lastError: err.message,
      });
      appendTaskWorkflowEvent(
        task,
        "repair",
        "queued",
        `Automatic retry repair ${retryRepairId} queued after failure.`,
        {
          source: "repair",
          nodeId: retryRepairId,
          evidence: [retryRepairId, task.type],
          timestamp: completedAt,
        },
      );
      return;
    }

    if (findRepairRecordById(retryRepairId)) {
      updateRepairRecord(state, retryRepairId, (record) => ({
        ...record,
        status: "failed",
        repairTaskId: task.id,
        repairRunId: idempotencyKey,
        completedAt,
        lastError: err.message,
        evidence: [
          ...(record.evidence ?? []),
          `task-failure:${task.type}`,
        ].slice(-10),
      }));
      appendTaskWorkflowEvent(
        task,
        "repair",
        "failed",
        `Retry recovery ${retryRepairId} failed: ${err.message}`,
        {
          source: "repair",
          nodeId: retryRepairId,
          evidence: [retryRepairId, task.type],
          timestamp: completedAt,
        },
      );
    }
  };

  const upsertRetryRecovery = (record: TaskRetryRecoveryRecord) => {
    const existingIndex = state.taskRetryRecoveries.findIndex(
      (item) => item.idempotencyKey === record.idempotencyKey,
    );
    if (existingIndex >= 0) {
      state.taskRetryRecoveries[existingIndex] = record;
      return;
    }
    state.taskRetryRecoveries.push(record);
  };

  const removeRetryRecovery = (idempotencyKey: string) => {
    const nextRecords = state.taskRetryRecoveries.filter(
      (record) => record.idempotencyKey !== idempotencyKey,
    );
    if (nextRecords.length === state.taskRetryRecoveries.length) return;
    state.taskRetryRecoveries = nextRecords;
    clearRetryRecoveryTimer(idempotencyKey);
  };

  const dispatchRetryRecovery = async (idempotencyKey: string) => {
    retryRecoveryTimers.delete(idempotencyKey);
    const recovery = findRetryRecovery(idempotencyKey);
    if (!recovery) return;

    try {
      queue.enqueue(recovery.type, recovery.payload);
    } catch (error) {
      console.warn(
        `[orchestrator] failed to requeue persisted retry ${recovery.type}: ${(error as Error).message}`,
      );
    }
  };

  const scheduleRetryRecovery = (record: TaskRetryRecoveryRecord) => {
    clearRetryRecoveryTimer(record.idempotencyKey);
    const delay = getRetryRecoveryDelayMs(record);
    const timer = setTimeout(() => {
      dispatchRetryRecovery(record.idempotencyKey).catch((error) => {
        console.warn(
          `[orchestrator] retry recovery dispatch error for ${record.type}: ${(error as Error).message}`,
        );
      });
    }, delay);
    retryRecoveryTimers.set(record.idempotencyKey, timer);
  };

  queue.onEnqueue((task) => {
    void invalidateResponseCacheTags(
      task.type === "doc-change"
        ? ["runtime-state", "knowledge-state"]
        : ["runtime-state"],
    );
    const { idempotencyKey } = ensureExecutionRecord(task);
    appendTaskWorkflowEvent(
      task,
      "ingress",
      "accepted",
      `${task.type} accepted into the orchestrator control plane.`,
      {
        source: "queue",
        nodeId: `ingress:${task.type}`,
        evidence: [task.id, idempotencyKey],
        timestamp: new Date(task.createdAt).toISOString(),
      },
    );
    appendTaskWorkflowEvent(
      task,
      "queue",
      "queued",
      `${task.type} queued for processing.`,
      {
        source: "queue",
        nodeId: `queue:${task.type}`,
        evidence: [task.id, idempotencyKey],
        timestamp: new Date(task.createdAt).toISOString(),
      },
    );
    appendTaskRelationshipObservation(
      task,
      "surface:orchestrator",
      `task:${task.type}`,
      "dispatches-task",
      `Orchestrator accepted ${task.type} into the queue.`,
      {
        source: "queue",
        evidence: [task.id, idempotencyKey, task.type],
        timestamp: new Date(task.createdAt).toISOString(),
      },
    );
  });

  queue.onProcess(async (task) => {
    void invalidateResponseCacheTags(["runtime-state"]);
    const { existing: execution, idempotencyKey } = ensureExecutionRecord(task);

    if (execution.status === "retrying" && findRetryRecovery(idempotencyKey)) {
      removeRetryRecovery(idempotencyKey);
    }

    if (execution.status === "success") {
      console.log(
        `[orchestrator] ♻️ Skipping duplicate task ${task.type} (${idempotencyKey})`,
      );
      return;
    }
    const coordinationOwner = `task:${task.id}`;
    const coordinationClaim = await claimTaskExecutionLease(
      idempotencyKey,
      coordinationOwner,
    );
    if (!coordinationClaim.acquired) {
      const claimDetail =
        coordinationClaim.existingOwner
          ? `${task.type} skipped because coordination lease is already held by ${coordinationClaim.existingOwner}.`
          : `${task.type} skipped because coordination lease is already active.`;
      appendTaskWorkflowEvent(
        task,
        "queue",
        "coordination-claimed",
        claimDetail,
        {
          source: "coordination",
          nodeId: `coordination:${idempotencyKey}`,
          evidence: [
            idempotencyKey,
            `coordination-store:${coordinationClaim.store}`,
            ...(coordinationClaim.existingOwner
              ? [`existing-owner:${coordinationClaim.existingOwner}`]
              : []),
          ],
          timestamp: new Date().toISOString(),
          stopCode: "coordination-lease-active",
        },
      );
      console.log(
        `[orchestrator] 🔒 Skipping claimed task ${task.type} (${idempotencyKey}) via ${coordinationClaim.store} coordination`,
      );
      return;
    }

    try {
      execution.status = "running";
      execution.attempt = task.attempt ?? execution.attempt ?? 1;
      execution.maxRetries = Number.isFinite(task.maxRetries)
        ? Number(task.maxRetries)
        : execution.maxRetries;
      execution.startedAt = new Date().toISOString();
      execution.completedAt = null;
      execution.resultSummary = undefined;
      execution.accounting = null;
      execution.lastHandledAt = new Date().toISOString();
      const taskRequirement = TASK_AGENT_SKILL_REQUIREMENTS[task.type];
      if (taskRequirement) {
        appendTaskWorkflowEvent(
          task,
          "agent",
          "selected",
          `${taskRequirement.agentId} selected for ${task.type}.`,
          {
            source: "execution",
            nodeId: taskRequirement.agentId,
            evidence: [taskRequirement.agentId, taskRequirement.skillId],
            timestamp: execution.lastHandledAt,
          },
        );
        appendTaskWorkflowEvent(
          task,
          "agent",
          "worker-dispatched",
          `${taskRequirement.agentId} worker dispatched through ${taskRequirement.skillId}.`,
          {
            source: "execution",
            nodeId: taskRequirement.agentId,
            evidence: [taskRequirement.skillId],
            timestamp: execution.lastHandledAt,
          },
        );
        appendTaskRelationshipObservation(
          task,
          `task:${task.type}`,
          `agent:${taskRequirement.agentId}`,
          "routes-to-agent",
          `${task.type} routed to ${taskRequirement.agentId}.`,
          {
            source: "execution",
            evidence: [taskRequirement.agentId, taskRequirement.skillId],
            timestamp: execution.lastHandledAt,
          },
        );
        appendTaskRelationshipObservation(
          task,
          `agent:${taskRequirement.agentId}`,
          `skill:${taskRequirement.skillId}`,
          "uses-skill",
          `${taskRequirement.agentId} used ${taskRequirement.skillId} for ${task.type}.`,
          {
            source: "execution",
            evidence: [taskRequirement.skillId, task.type],
            timestamp: execution.lastHandledAt,
          },
        );
      }
      appendTaskWorkflowEvent(
        task,
        "agent",
        "executing",
        `${task.type} execution started.`,
        {
          source: "execution",
          nodeId: taskRequirement?.agentId ?? `task:${task.type}`,
          evidence: [
            idempotencyKey,
            String(task.attempt ?? execution.attempt ?? 1),
            `coordination-store:${coordinationClaim.store}`,
          ],
          timestamp: execution.lastHandledAt,
        },
      );
      syncRepairRecordOnTaskStart(task, idempotencyKey);
      syncIncidentRemediationOnTaskStart(task, idempotencyKey);

      const approval = assertApprovalIfRequired(task, state, config);
      if (!approval.allowed) {
        onApprovalRequested(task.id, task.type);
        execution.status = "pending";
        appendTaskWorkflowEvent(
          task,
          "approval",
          "requested",
          approval.reason ?? `Approval requested for ${task.type}.`,
          {
            source: "approval",
            nodeId: `approval:${task.id}`,
            evidence: [task.id, task.type],
            stopCode: "awaiting-approval",
          },
        );
        recordTaskResult(task, "ok", approval.reason ?? "awaiting approval");
        await flushState();
        console.warn(
          `[orchestrator] ⏸️ ${task.type}: ${approval.reason ?? "awaiting approval"}`,
        );
        return;
      }

      const handler = resolveTaskHandler(task);
      console.log(`[orchestrator] Processing task: ${task.type}`);
      const message = await handler(task, handlerContext);
      execution.status = "success";
      execution.completedAt = new Date().toISOString();
      execution.lastError = undefined;
      execution.lastHandledAt = execution.completedAt;
      execution.accounting = finalizeTaskExecutionAccounting({
        existing: execution.accounting ?? null,
        startedAt: execution.startedAt ?? null,
        completedAt: execution.completedAt,
      });
      appendTaskWorkflowEvent(
        task,
        "result",
        "success",
        typeof message === "string" ? message : `${task.type} completed successfully.`,
        {
          source: "execution",
          nodeId: `result:${task.type}`,
          evidence: [idempotencyKey],
          timestamp: execution.lastHandledAt,
        },
      );
      recordTaskResult(
        task,
        "ok",
        typeof message === "string" ? message : undefined,
      );
      failureTracker.track(task.type, message);
      syncRepairRecordOnTaskSuccess(
        task,
        idempotencyKey,
        typeof message === "string" ? message : undefined,
      );
      await syncIncidentRemediationOnTaskSuccess(
        task,
        idempotencyKey,
        typeof message === "string" ? message : undefined,
      );
      console.log(`[orchestrator] ✅ ${task.type}: ${message}`);
    } catch (error) {
      const err = error as Error;
      console.error(`[task] ❌ failed ${task.type}:`, err);
      execution.lastError = err.message;
      execution.completedAt = new Date().toISOString();
      execution.lastHandledAt = execution.completedAt;
      execution.accounting = finalizeTaskExecutionAccounting({
        existing: execution.accounting ?? null,
        startedAt: execution.startedAt ?? null,
        completedAt: execution.completedAt,
      });

      const maxRetries = Number.isFinite(execution.maxRetries)
        ? execution.maxRetries
        : retryMaxAttempts;
      const attempt = Number.isFinite(execution.attempt)
        ? execution.attempt
        : 1;

      if (attempt <= maxRetries) {
        execution.status = "retrying";
        const nextAttempt = attempt + 1;
        const retryPayload = {
          ...task.payload,
          __attempt: nextAttempt,
          maxRetries,
          idempotencyKey,
        };
        const retryRecord: TaskRetryRecoveryRecord = {
          sourceTaskId: task.id,
          idempotencyKey,
          type: task.type,
          payload: retryPayload,
          attempt: nextAttempt,
          maxRetries,
          retryAt: new Date(Date.now() + retryBackoffMs).toISOString(),
          scheduledAt: new Date().toISOString(),
        };
        upsertRetryRecovery(retryRecord);
        scheduleRetryRecovery(retryRecord);
        appendTaskWorkflowEvent(
          task,
          "result",
          "retry-scheduled",
          `Retry ${nextAttempt} scheduled for ${task.type}.`,
          {
            source: "retry-recovery",
            nodeId: `retry:${idempotencyKey}`,
            evidence: [retryRecord.retryAt, String(maxRetries)],
            timestamp: retryRecord.scheduledAt,
            attempt: nextAttempt,
            stopCode: "retry-scheduled",
          },
        );
      } else {
        execution.status = "failed";
        removeRetryRecovery(idempotencyKey);
      }

      appendTaskWorkflowEvent(
        task,
        "result",
        execution.status === "retrying" ? "warning" : "failed",
        execution.status === "retrying"
          ? `Execution failed and will retry: ${err.message}`
          : `Execution failed: ${err.message}`,
        {
          source: "execution",
          nodeId: `result:${task.type}`,
          evidence: [idempotencyKey],
          timestamp: execution.lastHandledAt,
          attempt,
          stopCode:
            execution.status === "retrying"
              ? "retry-scheduled"
              : "execution-failed",
        },
      );

      syncRepairRecordOnTaskFailure(
        task,
        idempotencyKey,
        err,
        attempt <= maxRetries,
        attempt,
        maxRetries,
      );
      syncIncidentRemediationOnTaskFailure(task, idempotencyKey, err);

      recordTaskResult(task, "error", err.message);
      failureTracker.track(task.type, undefined, err);
      alertManager.error(`task-${task.type}`, `Task failed: ${err.message}`, {
        taskId: task.id,
        error: err.message,
        stack: err.stack,
      });
    } finally {
      await releaseTaskExecutionLease(idempotencyKey, coordinationOwner);
      await flushState();
    }
  });

  // ============================================================
  // Setup HTTP Server for Metrics & Alert Webhooks (Phase 2, 3, 5)
  // ============================================================

  const app = express();
  const PORT = process.env.PORT || 3000;
  let isShuttingDown = false;
  let forceShutdownTimer: NodeJS.Timeout | null = null;

  // Security Middleware Setup
  app.use(validateContentLength(1024 * 1024)); // 1MB limit
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb" }));
  app.use(logSecurityEvent);
  app.set("trust proxy", 1);

  const corsPolicy = buildCorsPolicy(config);
  const configuredOrigins = Array.from(corsPolicy.allowedOrigins.values());
  if (configuredOrigins.length > 0) {
    console.log(
      `[cors] allowlist active for ${configuredOrigins.length} origin(s): ${configuredOrigins.join(
        ", ",
      )}`,
    );
  } else {
    console.log(
      "[cors] allowlist is empty (deny-by-default for cross-origin browser requests)",
    );
  }
  console.log(
    `[cors] methods=${corsPolicy.allowedMethods.join(",")} headers=${corsPolicy.allowedHeaders.join(
      ",",
    )} credentials=${corsPolicy.allowCredentials ? "enabled" : "disabled"} maxAge=${corsPolicy.maxAgeSeconds}s`,
  );

  app.use((req, res, next) => {
    const rawOrigin = req.headers.origin;
    if (typeof rawOrigin !== "string" || rawOrigin.trim().length === 0) {
      return next();
    }

    const origin = rawOrigin.trim();
    const originAllowed = isCorsOriginAllowed(req, corsPolicy, origin);
    res.vary("Origin");

    if (!originAllowed) {
      return res.status(403).json({ error: "CORS origin denied" });
    }

    let normalizedOrigin: string;
    try {
      normalizedOrigin = normalizeCorsOrigin(origin);
    } catch {
      return res.status(403).json({ error: "CORS origin denied" });
    }

    res.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
    if (corsPolicy.allowCredentials) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (corsPolicy.exposedHeaders.length > 0) {
      res.setHeader(
        "Access-Control-Expose-Headers",
        corsPolicy.exposedHeaders.join(", "),
      );
    }

    if (req.method.toUpperCase() !== "OPTIONS") {
      return next();
    }

    res.vary("Access-Control-Request-Method");
    res.vary("Access-Control-Request-Headers");

    const requestedMethodRaw = req.headers["access-control-request-method"];
    let requestedMethod: string | null = null;
    if (typeof requestedMethodRaw === "string") {
      try {
        requestedMethod = normalizeCorsMethod(requestedMethodRaw);
      } catch {
        requestedMethod = null;
      }
    }
    if (!requestedMethod || !corsPolicy.allowedMethods.includes(requestedMethod)) {
      return res.status(405).json({ error: "CORS preflight method denied" });
    }

    const requestedHeadersRaw = req.headers["access-control-request-headers"];
    const requestedHeaders =
      typeof requestedHeadersRaw === "string"
        ? requestedHeadersRaw
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
        : [];

    const deniedHeaders = requestedHeaders.filter((header) => {
      try {
        const normalized = normalizeCorsHeader(header).toLowerCase();
        return !corsPolicy.allowedHeadersLower.has(normalized);
      } catch {
        return true;
      }
    });
    if (deniedHeaders.length > 0) {
      return res.status(400).json({
        error: "CORS preflight header denied",
        deniedHeaders,
      });
    }

    res.setHeader(
      "Access-Control-Allow-Methods",
      corsPolicy.allowedMethods.join(", "),
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      corsPolicy.allowedHeaders.join(", "),
    );
    res.setHeader("Access-Control-Max-Age", String(corsPolicy.maxAgeSeconds));

    return res.status(204).send();
  });

  const operatorStationDistDir = process.env.OPERATOR_UI_DIST_DIR
    ? resolve(process.env.OPERATOR_UI_DIST_DIR)
    : resolve(
        process.cwd(),
        "..",
        "operator-s-console",
        "dist",
      );
  const operatorStationIndex = await stat(
    join(operatorStationDistDir, "index.html"),
  ).catch(() => null);
  if (!operatorStationIndex?.isFile()) {
    throw new Error(
      `[operator-ui] operator-s-console dist is required at ${operatorStationDistDir}. Build operator-s-console before starting orchestrator.`,
    );
  }
  console.log(
    `[operator-ui] Serving operator-s-console dist from ${operatorStationDistDir}`,
  );

  app.use("/operator", express.static(operatorStationDistDir, { index: false }));
  app.get("/operator", (_req, res) => {
    res.sendFile(join(operatorStationDistDir, "index.html"));
  });
  app.get("/operator/*", (_req, res) => {
    res.sendFile(join(operatorStationDistDir, "index.html"));
  });

  // ============================================================
  // Public Endpoints (No Authentication Required)
  // ============================================================

  // Health check endpoint - allow monitoring
  app.get("/health", healthLimiter, (req, res) => {
    const publicBaseUrl = requestOriginFromHost(req) ?? `http://localhost:${PORT}`;
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      metrics: buildPublicMetricsUrl(req),
      knowledge: `${publicBaseUrl}/api/knowledge/summary`,
      persistence: `${publicBaseUrl}/api/persistence/health`,
    });
  });

  // Knowledge Base summary endpoint (Phase 5) - Public for dashboards
  app.get("/api/knowledge/summary", apiLimiter, (req, res) => {
    try {
      void respondWithCachedJson(req, res, {
        namespace: "knowledge.summary",
        ttlSeconds: readCacheTtls.knowledgeSummary,
        tags: ["knowledge-state"],
        scope: "public",
        keyData: {
          docIndexVersion: state.docIndexVersion,
          indexedDocs: state.indexedDocs,
        },
        compute: () => {
          const summary = knowledgeIntegration.getSummary();
          return {
            ...summary,
            runtime: buildKnowledgeRuntimeSignals({
              summary,
              config,
              state,
            }),
          };
        },
      });
    } catch (error: any) {
      console.error("[api/knowledge/summary] Error", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/openapi.json", apiLimiter, (_req, res) => {
    void respondWithCachedJson(_req, res, {
      namespace: "openapi.spec",
      ttlSeconds: readCacheTtls.openApi,
      tags: [],
      scope: "public",
      keyData: { port: PORT },
      compute: () => buildOpenApiSpec(PORT),
    });
  });

  // Persistence health endpoint - Public for monitoring
  app.get("/api/persistence/health", healthLimiter, async (req, res) => {
    try {
      await respondWithCachedJson(req, res, {
        namespace: "persistence.health",
        ttlSeconds: readCacheTtls.persistenceHealth,
        tags: [],
        scope: "public",
        compute: () => PersistenceIntegration.healthCheck(),
      });
    } catch (error: any) {
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  const buildPublicProofSnapshot = async () => {
    const generatedAt = new Date().toISOString();
    const persistence = await PersistenceIntegration.healthCheck();
    const agents = await buildAgentOperationalOverview(state);
    const governance = summarizeGovernanceVisibility(state);
    const knowledgeRuntime = buildKnowledgeRuntimeSignals({
      summary: knowledgeIntegration.getSummary(),
      config,
      state,
    });
    const queueQueued = queue.getQueuedCount();
    const queueProcessing = queue.getPendingCount();
    const pendingApprovalsCount = listPendingApprovals(state).length;
    const truthLayers = buildRuntimeTruthLayers({
      claimed: claimedTruthLayer,
      config,
      state,
      fastStartMode,
      persistenceStatus:
        typeof persistence.status === "string" ? persistence.status : "unknown",
      knowledgeRuntime,
      queueQueued,
      queueProcessing,
      pendingApprovalsCount,
      repairs: governance.repairs,
      retryRecoveries: governance.taskRetryRecoveries,
      agents,
      githubWorkflowMonitor,
    });
    const incidentState = await refreshRuntimeIncidents();
    if (incidentState.changed) {
      await flushState();
    }

    const milestones = buildPublicProofMilestones({
      state,
      incidents: incidentState.model,
      truthLayers,
      queueQueued,
      queueProcessing,
    });
    const deadLetter = buildPublicProofDeadLetter(milestones);
    const proofNodes = buildPublicProofNodes({
      truthLayers,
      incidents: incidentState.model,
      queueQueued,
      queueProcessing,
      milestones,
      deadLetter,
    });

    return {
      generatedAt,
      stateUpdatedAt: state.updatedAt ?? null,
      agents,
      milestones,
      deadLetter,
      overview: buildPublicProofOverview({
        milestones,
        deadLetter,
        proofNodes,
        generatedAt,
        stateUpdatedAt: state.updatedAt ?? null,
      }),
      control: buildPublicProofControl({
        agents,
        approvalRequiredTaskTypes:
          config.approvalRequiredTaskTypes ?? ["agent-deploy", "build-refactor"],
      }),
      demand: buildPublicProofDemand({
        state,
        queueQueued,
        queueProcessing,
        mode: "snapshot",
      }),
      demandLive: buildPublicProofDemand({
        state,
        queueQueued,
        queueProcessing,
        mode: "live",
      }),
    };
  };

  app.get("/api/command-center/overview", apiLimiter, async (req, res) => {
    try {
      await respondWithCachedJson(req, res, {
        namespace: "proof.overview",
        ttlSeconds: 20,
        tags: ["runtime-state"],
        scope: "public",
        keyData: {
          docIndexVersion: state.docIndexVersion,
          indexedDocs: state.indexedDocs,
        },
        compute: async () => {
          const snapshot = await buildPublicProofSnapshot();
          return snapshot.overview;
        },
      });
    } catch (error: any) {
      console.error("[api/command-center/overview] Error", {
        error: error.message,
      });
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/command-center/control", apiLimiter, async (req, res) => {
    try {
      await respondWithCachedJson(req, res, {
        namespace: "proof.control",
        ttlSeconds: 120,
        tags: ["runtime-state"],
        scope: "public",
        keyData: {
          approvalRequiredTaskTypes: config.approvalRequiredTaskTypes ?? [],
        },
        compute: async () => {
          const snapshot = await buildPublicProofSnapshot();
          return snapshot.control;
        },
      });
    } catch (error: any) {
      console.error("[api/command-center/control] Error", {
        error: error.message,
      });
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/command-center/demand", apiLimiter, async (req, res) => {
    try {
      await respondWithCachedJson(req, res, {
        namespace: "proof.demand",
        ttlSeconds: 20,
        tags: ["runtime-state"],
        scope: "public",
        compute: async () => {
          const snapshot = await buildPublicProofSnapshot();
          return snapshot.demand;
        },
      });
    } catch (error: any) {
      console.error("[api/command-center/demand] Error", {
        error: error.message,
      });
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/command-center/demand-live", apiLimiter, async (req, res) => {
    try {
      await respondWithCachedJson(req, res, {
        namespace: "proof.demand-live",
        ttlSeconds: 20,
        tags: ["runtime-state"],
        scope: "public",
        compute: async () => {
          const snapshot = await buildPublicProofSnapshot();
          return snapshot.demandLive;
        },
      });
    } catch (error: any) {
      console.error("[api/command-center/demand-live] Error", {
        error: error.message,
      });
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/milestones/latest", apiLimiter, async (req, res) => {
    try {
      const requestedLimit = Number.parseInt(String(req.query.limit ?? "20"), 10);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), 50)
        : 20;

      await respondWithCachedJson(req, res, {
        namespace: "proof.milestones.latest",
        ttlSeconds: 20,
        tags: ["runtime-state"],
        scope: "public",
        keyData: { limit },
        compute: async () => {
          const snapshot = await buildPublicProofSnapshot();
          return {
            ok: true,
            items: snapshot.milestones.slice(0, limit),
          };
        },
      });
    } catch (error: any) {
      console.error("[api/milestones/latest] Error", {
        error: error.message,
      });
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/milestones/dead-letter", apiLimiter, async (req, res) => {
    try {
      await respondWithCachedJson(req, res, {
        namespace: "proof.milestones.dead-letter",
        ttlSeconds: 20,
        tags: ["runtime-state"],
        scope: "public",
        compute: async () => {
          const snapshot = await buildPublicProofSnapshot();
          return {
            ok: true,
            items: snapshot.deadLetter,
          };
        },
      });
    } catch (error: any) {
      console.error("[api/milestones/dead-letter] Error", {
        error: error.message,
      });
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================
  // Protected Endpoints (Authentication Required)
  // ============================================================

  app.get(
    "/api/auth/me",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("auth.me.read"),
    async (req, res) => {
      const auth = (req as AuthenticatedRequest).auth;
      res.json({
        requestId: auth?.requestId ?? null,
        actor: auth?.actor ?? null,
        role: auth?.role ?? null,
        roles: auth?.roles ?? [],
        apiKeyVersion: auth?.apiKeyVersion ?? null,
        apiKeyLabel: auth?.apiKeyLabel ?? null,
        apiKeyExpiresAt: auth?.apiKeyExpiresAt ?? null,
      });
    },
  );

  app.get(
    "/api/tasks/catalog",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("tasks.catalog.read"),
    async (req, res) => {
      try {
        await respondWithCachedJson(req, res, {
          namespace: "tasks.catalog",
          ttlSeconds: readCacheTtls.tasksCatalog,
          tags: [],
          scope: "protected",
          keyData: {
            approvalRequiredTaskTypes: config.approvalRequiredTaskTypes ?? [],
          },
          compute: () => ({
            generatedAt: new Date().toISOString(),
            tasks: buildOperatorTaskCatalog(config, state).filter(
              (task) => !task.internalOnly && task.publicTriggerable !== false,
            ),
          }),
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/companion/overview",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("companion.overview.read"),
    async (req, res) => {
      try {
        await respondWithCachedJson(req, res, {
          namespace: "companion.overview",
          ttlSeconds: readCacheTtls.dashboardOverview,
          tags: ["runtime-state"],
          scope: "protected",
          keyData: { docIndexVersion: state.docIndexVersion },
          compute: async () => {
            const pendingApprovals = listPendingApprovals(state);
            const governance = summarizeGovernanceVisibility(state);
            const queueSnapshot = queue.getSnapshot();
            const queueQueued = queue.getQueuedCount();
            const queueProcessing = queue.getPendingCount();
            const queuePressure = buildDashboardQueuePressure(queueSnapshot);
            const knowledgeRuntime = buildKnowledgeRuntimeSignals({
              summary: knowledgeIntegration.getSummary(),
              config,
              state,
            });
            const [persistence, agents] = await Promise.all([
              PersistenceIntegration.healthCheck(),
              buildAgentOperationalOverview(state),
            ]);
            const incidents = buildRuntimeIncidentModel({
              config,
              state,
              fastStartMode,
              persistence,
              agents,
              governance,
              pendingApprovalsCount: pendingApprovals.length,
              knowledgeRuntime,
              githubWorkflowMonitor,
              includeIncidentDetails: false,
              reconcileLedger: false,
            }).model;
            const truthLayers = buildRuntimeTruthLayers({
              claimed: claimedTruthLayer,
              config,
              state,
              fastStartMode,
              persistenceStatus:
                typeof persistence.status === "string" ? persistence.status : "unknown",
              knowledgeRuntime,
              queueQueued,
              queueProcessing,
              pendingApprovalsCount: pendingApprovals.length,
              repairs: governance.repairs,
              retryRecoveries: governance.taskRetryRecoveries,
              agents,
              githubWorkflowMonitor,
            });
            const proofMilestones = buildPublicProofMilestones({
              state,
              incidents,
              truthLayers,
              queueQueued,
              queueProcessing,
            });
            const proofDeadLetter = buildPublicProofDeadLetter(proofMilestones);
            const proofNodes = buildPublicProofNodes({
              truthLayers,
              incidents,
              queueQueued,
              queueProcessing,
              milestones: proofMilestones,
              deadLetter: proofDeadLetter,
            });
            const proofOverview = buildPublicProofOverview({
              milestones: proofMilestones,
              deadLetter: proofDeadLetter,
              proofNodes,
              generatedAt: new Date().toISOString(),
              stateUpdatedAt: state.updatedAt ?? null,
            });
            const classifications = buildDashboardIncidentClassifications(
              state.incidentLedger,
              5,
            );
            const dominantClassification = classifications[0]?.label ?? null;
            const proofStatus =
              proofDeadLetter.length > 0 || proofOverview.riskCounts.blocked > 0
                ? "degraded"
                : proofOverview.stale || proofOverview.riskCounts.atRisk > 0
                  ? "watching"
                  : "healthy";
            const generatedAt = new Date().toISOString();
            const mode = buildCompanionControlPlaneMode({
              openIncidentCount: incidents.openCount,
              criticalIncidentCount: incidents.bySeverity.critical,
              pendingApprovalsCount: pendingApprovals.length,
              queueQueued,
              queueProcessing,
              proofStatus,
              dominantClassification,
            });
            const primaryOperatorMove = buildCompanionPrimaryMove({
              mode: mode.label,
              openIncidentCount: incidents.openCount,
              criticalIncidentCount: incidents.bySeverity.critical,
              pendingApprovalsCount: pendingApprovals.length,
              topIncident: buildIncidentPriorityQueue(state.incidentLedger)[0] ?? null,
              queuePressure,
              queueQueued,
              queueProcessing,
            });
            return {
              generatedAt,
              controlPlaneMode: mode,
              primaryOperatorMove,
              pressureStory: buildCompanionPressureStory({
                queuePressure,
                classifications,
                pendingApprovalsCount: pendingApprovals.length,
                proofStatus,
              }),
              queue: {
                queued: queueQueued,
                processing: queueProcessing,
                pressure: queuePressure,
              },
              approvals: {
                pendingCount: pendingApprovals.length,
              },
              incidents: {
                openCount: incidents.openCount,
                criticalCount: incidents.bySeverity.critical,
                topClassifications: classifications,
              },
              publicProof: {
                status: proofStatus,
                stale: proofOverview.stale,
                latestTimestamp: proofOverview.latest?.timestampUtc ?? null,
                deadLetterCount: proofDeadLetter.length,
                blockedCount: proofOverview.riskCounts.blocked,
                atRiskCount: proofOverview.riskCounts.atRisk,
              },
              services: {
                declaredCount: agents.length,
                serviceExpectedCount: agents.filter((agent) => agent.serviceExpected).length,
                serviceRunningCount: agents.filter((agent) => agent.serviceRunning === true).length,
                serviceAvailableCount: agents.filter((agent) => agent.serviceAvailable).length,
              },
              freshnessTimestamp:
                proofOverview.latest?.timestampUtc ??
                state.updatedAt ??
                generatedAt,
            };
          },
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/companion/catalog",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("companion.catalog.read"),
    async (req, res) => {
      try {
        await respondWithCachedJson(req, res, {
          namespace: "companion.catalog",
          ttlSeconds: readCacheTtls.tasksCatalog,
          tags: ["runtime-state"],
          scope: "protected",
          keyData: {
            approvalRequiredTaskTypes: config.approvalRequiredTaskTypes ?? [],
          },
          compute: () => buildCompanionCatalogPayload(config, state),
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/companion/incidents",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("companion.incidents.read"),
    async (req, res) => {
      try {
        const requestedLimit = Number.parseInt(String(req.query.limit ?? "8"), 10);
        const limit = Number.isFinite(requestedLimit)
          ? Math.min(Math.max(requestedLimit, 1), 20)
          : 8;
        await respondWithCachedJson(req, res, {
          namespace: "companion.incidents",
          ttlSeconds: readCacheTtls.incidents,
          tags: ["runtime-state"],
          scope: "protected",
          keyData: { limit },
          compute: () => buildCompanionIncidentsPayload(state, limit),
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/companion/runs",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("companion.runs.read"),
    async (req, res) => {
      try {
        const requestedLimit = Number.parseInt(String(req.query.limit ?? "10"), 10);
        const limit = Number.isFinite(requestedLimit)
          ? Math.min(Math.max(requestedLimit, 1), 25)
          : 10;
        await respondWithCachedJson(req, res, {
          namespace: "companion.runs",
          ttlSeconds: readCacheTtls.taskRuns,
          tags: ["runtime-state"],
          scope: "protected",
          keyData: { limit },
          compute: () => buildCompanionRunsPayload(state, config, limit),
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/companion/approvals",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("operator"),
    auditProtectedAction("companion.approvals.read"),
    async (req, res) => {
      try {
        const requestedLimit = Number.parseInt(String(req.query.limit ?? "8"), 10);
        const limit = Number.isFinite(requestedLimit)
          ? Math.min(Math.max(requestedLimit, 1), 20)
          : 8;
        await respondWithCachedJson(req, res, {
          namespace: "companion.approvals",
          ttlSeconds: readCacheTtls.approvalsPending,
          tags: ["runtime-state"],
          scope: "protected",
          keyData: { limit },
          compute: () => buildCompanionApprovalsPayload(state, config, limit),
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  // Manual task trigger endpoint
  app.post(
    "/api/tasks/trigger",
    authLimiter,
    requireBearerToken,
    operatorWriteLimiter,
    requireRole("operator"),
    auditProtectedAction("tasks.trigger.create"),
    createValidationMiddleware(TaskTriggerSchema, "body"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const type = String(req.body.type);
        const payload =
          typeof req.body.payload === "object" && req.body.payload !== null
            ? (req.body.payload as Record<string, unknown>)
            : {};

        const enrichedPayload = {
          ...payload,
          __actor: req.auth?.actor ?? "unknown",
          __role: req.auth?.role ?? "viewer",
          __requestId: req.auth?.requestId ?? null,
        };

        const task = queue.enqueue(type, enrichedPayload);
        await invalidateResponseCacheTags(["runtime-state"]);
        res.status(202).json({
          status: "queued",
          taskId: task.id,
          type: task.type,
          createdAt: task.createdAt,
        });
      } catch (error: any) {
        console.error("[api/tasks/trigger] Error", { error: error.message });
        res.status(500).json({ error: error.message });
      }
    },
  );

  // AlertManager webhook endpoint (Phase 3)
  // Uses webhook signature verification instead of bearer token
  app.post(
    "/webhook/alerts",
    webhookLimiter,
    authLimiter,
    verifyWebhookSignature,
    createValidationMiddleware(AlertManagerWebhookSchema, "body"),
    async (req, res) => {
      try {
        console.log("[webhook/alerts] Received alert from AlertManager");
        await alertHandler.handleAlertManagerWebhook(req.body);
        res.json({ status: "ok" });
      } catch (error: any) {
        console.error("[webhook/alerts] Error processing alert", {
          error: error.message,
        });
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/approvals/pending",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("operator"),
    auditProtectedAction("approvals.pending.read"),
    async (req, res) => {
      try {
        await respondWithCachedJson(req, res, {
          namespace: "approvals.pending",
          ttlSeconds: readCacheTtls.approvalsPending,
          tags: ["runtime-state"],
          scope: "protected",
          compute: () => {
            const pending = listPendingApprovals(state);
            return {
              count: pending.length,
              pending: pending.map((approval) => ({
                ...approval,
                impact: buildApprovalImpactMetadata(approval, config),
                payloadPreview: summarizePayloadPreview(approval.payload),
              })),
            };
          },
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.post(
    "/api/approvals/:id/decision",
    authLimiter,
    requireBearerToken,
    operatorWriteLimiter,
    requireRole("operator"),
    auditProtectedAction("approvals.decision.write"),
    createValidationMiddleware(ApprovalDecisionSchema, "body"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const taskId = String(req.params.id);
        const decision = req.body.decision as "approved" | "rejected";
        const actor =
          typeof req.body.actor === "string" ? req.body.actor : "api-user";
        const note =
          typeof req.body.note === "string" ? req.body.note : undefined;
        const approval = decideApproval(state, taskId, decision, actor, note);
        const approvalExecution = findExecutionByTaskId(taskId);

        onApprovalCompleted(
          taskId,
          decision === "approved" ? "approved" : "rejected",
        );

        const consumedQueueItem = consumeReviewQueueItemForApprovalDecision(
          state.redditQueue,
          approval,
        );

        let replayTaskId: string | null = null;
        if (decision === "approved") {
          const replay = queue.enqueue(approval.type, {
            ...approval.payload,
            approvedFromTaskId: approval.taskId,
            __actor: req.auth?.actor ?? actor,
            __role: req.auth?.role ?? "operator",
            __requestId: req.auth?.requestId ?? null,
          });
          replayTaskId = replay.id;
        }

        if (approvalExecution) {
          appendWorkflowEvent({
            state,
            runId: approvalExecution.idempotencyKey,
            taskId: approval.taskId,
            type: approval.type,
            stage: "approval",
            stateLabel: decision,
            source: "approval",
            actor: req.auth?.actor ?? actor,
            nodeId: `approval:${approval.taskId}`,
            detail:
              decision === "approved"
                ? `Approval granted for ${approval.type}.`
                : `Approval rejected for ${approval.type}.`,
            evidence: [
              approval.note ?? "no-operator-note",
              replayTaskId ?? "no-replay-task",
            ],
            stopCode: decision === "approved" ? null : "approval-rejected",
          });
        }

        await flushState();

        res.json({
          status: "ok",
          approval,
          replayTaskId,
        });
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    },
  );

  app.post(
    "/api/incidents/:id/acknowledge",
    authLimiter,
    requireBearerToken,
    operatorWriteLimiter,
    requireRole("operator"),
    auditProtectedAction("incidents.acknowledge.write"),
    createValidationMiddleware(IncidentAcknowledgeSchema, "body"),
    async (req: AuthenticatedRequest, res) => {
      try {
        IncidentDetailParamsSchema.parse(req.params);
        const incident = acknowledgeIncidentRecord(
          state,
          String(req.params.id),
          typeof req.body.actor === "string"
            ? req.body.actor
            : req.auth?.actor ?? "api-user",
          typeof req.body.note === "string" ? req.body.note : undefined,
        );
        await flushState();
        res.json({ status: "ok", incident });
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/incidents",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("incidents.read"),
    createValidationMiddleware(IncidentListQuerySchema, "query"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const status =
          typeof req.query.status === "string" ? req.query.status : undefined;
        const classification =
          typeof req.query.classification === "string"
            ? req.query.classification
            : undefined;
        const includeResolved = parseBoolean(req.query.includeResolved, false);
        const limit = Number(req.query.limit ?? 50);
        const offset = Number(req.query.offset ?? 0);

        await respondWithCachedJson(req, res, {
          namespace: "incidents.list",
          ttlSeconds: readCacheTtls.incidents,
          tags: ["runtime-state"],
          scope: "protected",
          keyData: { status, classification, includeResolved, limit, offset },
          compute: () => {
            const filtered = state.incidentLedger
              .filter((record) =>
                includeResolved ? true : record.status !== "resolved",
              )
              .filter((record) => (status ? record.status === status : true))
              .filter((record) =>
                classification ? record.classification === classification : true,
              )
              .sort(
                (left, right) =>
                  Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt),
              );

            const page = filtered.slice(offset, offset + limit);

            return {
              generatedAt: new Date().toISOString(),
              query: {
                status: status ?? null,
                classification: classification ?? null,
                includeResolved,
                limit,
                offset,
              },
              total: filtered.length,
              page: {
                returned: page.length,
                offset,
                limit,
                hasMore: offset + page.length < filtered.length,
              },
              incidents: page.map((record) => materializeIncident(record, state)),
            };
          },
        });
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/incidents/:id",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("incident.read"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const { id } = IncidentDetailParamsSchema.parse(req.params);
        const incident = state.incidentLedger.find(
          (record) => record.incidentId === id,
        );
        if (!incident) {
          return res.status(404).json({ error: `Incident not found: ${id}` });
        }

        await respondWithCachedJson(req, res, {
          namespace: "incidents.detail",
          ttlSeconds: readCacheTtls.incidents,
          tags: ["runtime-state"],
          scope: "protected",
          keyData: { incidentId: id },
          compute: () => ({
            generatedAt: new Date().toISOString(),
            incident: materializeIncident(incident, state),
          }),
        });
      } catch (error: any) {
        return res.status(400).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/incidents/:id/history",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("incident.history.read"),
    async (_req: AuthenticatedRequest, res) => {
      try {
        const { id } = IncidentDetailParamsSchema.parse(_req.params);
        const incident = state.incidentLedger.find(
          (record) => record.incidentId === id,
        );
        if (!incident) {
          return res.status(404).json({ error: `Incident not found: ${id}` });
        }

        await respondWithCachedJson(_req, res, {
          namespace: "incidents.history",
          ttlSeconds: readCacheTtls.incidents,
          tags: ["runtime-state"],
          scope: "protected",
          keyData: { incidentId: id },
          compute: () => ({
            generatedAt: new Date().toISOString(),
            incidentId: id,
            history: incident.history ?? [],
            acknowledgements: incident.acknowledgements ?? [],
            ownershipHistory: incident.ownershipHistory ?? [],
            remediationTasks: (incident.remediationTasks ?? []).map((item) => ({
              ...item,
              status: deriveIncidentRemediationTaskStatus(state, item),
            })),
          }),
        });
      } catch (error: any) {
        return res.status(400).json({ error: error.message });
      }
    },
  );

  app.post(
    "/api/incidents/:id/owner",
    authLimiter,
    requireBearerToken,
    operatorWriteLimiter,
    requireRole("operator"),
    auditProtectedAction("incidents.owner.write"),
    createValidationMiddleware(IncidentOwnerSchema, "body"),
    async (req: AuthenticatedRequest, res) => {
      try {
        IncidentDetailParamsSchema.parse(req.params);
        const incident = assignIncidentOwner(
          state,
          String(req.params.id),
          String(req.body.owner),
          typeof req.body.actor === "string"
            ? req.body.actor
            : req.auth?.actor ?? "api-user",
          typeof req.body.note === "string" ? req.body.note : undefined,
        );
        await flushState();
        res.json({ status: "ok", incident });
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    },
  );

  app.post(
    "/api/incidents/:id/remediate",
    authLimiter,
    requireBearerToken,
    operatorWriteLimiter,
    requireRole("operator"),
    auditProtectedAction("incidents.remediate.write"),
    createValidationMiddleware(IncidentRemediationSchema, "body"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const { id } = IncidentDetailParamsSchema.parse(req.params);
        const incident = state.incidentLedger.find((record) => record.incidentId === id);
        if (!incident) {
          return res.status(404).json({ error: `Incident not found: ${id}` });
        }

        const actor =
          typeof req.body.actor === "string"
            ? req.body.actor
            : req.auth?.actor ?? "api-user";
        const note =
          typeof req.body.note === "string" ? req.body.note : undefined;
        const overrideTaskType =
          typeof req.body.taskType === "string"
            ? (req.body.taskType as
                | "drift-repair"
                | "build-refactor"
                | "qa-verification"
                | "system-monitor")
            : undefined;

        const result = createIncidentRemediationTask(incident, {
          actor,
          note,
          overrideTaskType,
          trigger: "manual",
        });

        await flushState();
        return res.json({
          status: "ok",
          remediationTask: result.remediationTask,
          incident: materializeIncident(incident, state),
        });
      } catch (error: any) {
        return res.status(400).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/dashboard/overview",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("dashboard.overview.read"),
    async (req, res) => {
      try {
        await respondWithCachedJson(req, res, {
          namespace: "dashboard.overview",
          ttlSeconds: readCacheTtls.dashboardOverview,
          tags: ["runtime-state"],
          scope: "protected",
          keyData: {
            docIndexVersion: state.docIndexVersion,
          },
          compute: async () => {
            const pendingApprovals = listPendingApprovals(state);
            const governance = summarizeGovernanceVisibility(state);
            const accounting = summarizeExecutionAccounting(state.taskExecutions);
            const latestBudgetExecution =
              [...state.taskExecutions]
                .filter((execution) => execution.type === "reddit-response")
                .sort((a, b) => b.lastHandledAt.localeCompare(a.lastHandledAt))
                .find((execution) => execution.accounting?.budget) ?? null;
            const selfHealing = governance.repairs;
            const queueQueued = queue.getQueuedCount();
            const queueProcessing = queue.getPendingCount();
            const queueSnapshot = queue.getSnapshot();
            const knowledge = knowledgeIntegration.getSummary();
            const knowledgeRuntime = buildKnowledgeRuntimeSignals({
              summary: knowledge,
              config,
              state,
            });
            const [persistence, agents] = await Promise.all([
              PersistenceIntegration.healthCheck(),
              buildAgentOperationalOverview(state),
            ]);
            const incidents = buildRuntimeIncidentModel({
              config,
              state,
              fastStartMode,
              persistence,
              agents,
              governance,
              pendingApprovalsCount: pendingApprovals.length,
              knowledgeRuntime,
              githubWorkflowMonitor,
              includeIncidentDetails: false,
              reconcileLedger: false,
            }).model;
            const overviewHealthStatus =
              incidents.overallStatus === "critical" || persistence.status !== "healthy"
                ? "degraded"
                : incidents.overallStatus === "warning"
                  ? "warning"
                  : "healthy";

            return {
              generatedAt: new Date().toISOString(),
              health: {
                status: overviewHealthStatus,
                fastStartMode,
              },
              persistence,
              accounting: {
                ...accounting,
                currentBudget: latestBudgetExecution?.accounting?.budget ?? null,
              },
              queue: {
                queued: queueQueued,
                processing: queueProcessing,
                pressure: buildDashboardQueuePressure(queueSnapshot),
              },
              approvals: {
                pendingCount: pendingApprovals.length,
                pending: [],
              },
              maintenance: {
                checks: buildDashboardMaintenanceChecks(state),
              },
              selfHealing: {
                model: "partial-runtime",
                autoPolicies: ["doc-drift", "task-retry-recovery"],
                summary: selfHealing,
              },
              governance,
              incidents: {
                ...incidents,
                topClassifications: buildDashboardIncidentClassifications(
                  state.incidentLedger,
                ),
              },
              recentTasks: filterVisibleTaskHistory(state.taskHistory).slice(-20),
            };
          },
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/agents/overview",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("agents.overview.read"),
    async (req, res) => {
      try {
        await respondWithCachedJson(req, res, {
          namespace: "agents.overview",
          ttlSeconds: readCacheTtls.agentsOverview,
          tags: ["runtime-state"],
          scope: "protected",
          compute: async () => {
            const agents = await buildAgentOperationalOverview(state);
            const topology = await buildAgentTopology({
              agents,
              state,
            });
            const relationshipHistory = buildRelationshipHistory(state, {
              windowHours: 48,
              recentLimit: 80,
            });
            return {
              generatedAt: new Date().toISOString(),
              count: agents.length,
              agents,
              topology,
              relationshipHistory,
            };
          },
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/memory/recall",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("memory.recall.read"),
    async (req, res) => {
      try {
        const limit = parseBoundedInt(req.query.limit, 20, 1, 100);
        const offset = parseBoundedInt(req.query.offset, 0, 0, 100000);
        const includeSensitive = parseBoolean(
          req.query.includeSensitive,
          false,
        );
        const includeErrors = parseBoolean(req.query.includeErrors, true);
        const agentIdFilter =
          typeof req.query.agentId === "string" &&
          req.query.agentId.trim().length > 0
            ? req.query.agentId.trim()
            : null;

        await respondWithCachedJson(req, res, {
          namespace: "memory.recall",
          ttlSeconds: readCacheTtls.memoryRecall,
          tags: ["runtime-state"],
          scope: "protected",
          keyData: {
            agentIdFilter,
            limit,
            offset,
            includeErrors,
            includeSensitive,
          },
          compute: async () => {
            const registry = await getAgentRegistry();
            const agentIds = registry
              .listAgents()
              .map((agent) => agent.id)
              .filter((id) => (agentIdFilter ? id === agentIdFilter : true));

            const loaded = await Promise.all(
              agentIds.map(async (agentId) => {
                const memory = await loadAgentMemoryState(agentId);
                if (!memory) return null;
                const timeline = includeErrors
                  ? (memory.taskTimeline ?? [])
                  : (memory.taskTimeline ?? []).filter(
                      (entry) => entry.status !== "error",
                    );
                const normalized: AgentMemoryState = {
                  ...memory,
                  agentId,
                  taskTimeline: timeline,
                };
                return redactMemoryState(normalized, includeSensitive);
              }),
            );

            const items = loaded
              .filter((item): item is AgentMemoryState => item !== null)
              .sort((a, b) => {
                const ta = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0;
                const tb = b.lastRunAt ? new Date(b.lastRunAt).getTime() : 0;
                return tb - ta;
              });

            const page = items.slice(offset, offset + limit);
            const totalRuns = items.reduce(
              (sum, item) => sum + Number(item.totalRuns ?? 0),
              0,
            );

            return {
              generatedAt: new Date().toISOString(),
              query: {
                agentId: agentIdFilter,
                limit,
                offset,
                includeErrors,
                includeSensitive,
              },
              totalAgents: items.length,
              totalRuns,
              page: {
                returned: page.length,
                offset,
                limit,
                hasMore: offset + page.length < items.length,
              },
              items: page,
            };
          },
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  // Knowledge Base Query endpoint (Phase 5)
  app.post(
    "/api/knowledge/query",
    authLimiter,
    requireBearerToken,
    operatorWriteLimiter,
    requireRole("operator"),
    auditProtectedAction("knowledge.query.read"),
    createValidationMiddleware(KBQuerySchema, "body"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const { query } = req.body;
        await respondWithCachedJson(req, res, {
          namespace: "knowledge.query",
          ttlSeconds: readCacheTtls.knowledgeQuery,
          tags: ["knowledge-state"],
          scope: "protected",
          keyData: {
            query,
            docIndexVersion: state.docIndexVersion,
          },
          compute: async () => {
            const results = await knowledgeIntegration.queryAPI(query);
            const summary = knowledgeIntegration.getSummary();
            return {
              ...results,
              runtime: buildKnowledgeRuntimeSignals({
                summary,
                config,
                state,
              }),
            };
          },
        });
      } catch (error: any) {
        console.error("[api/knowledge/query] Error", { error: error.message });
        res.status(500).json({ error: error.message });
      }
    },
  );

  // Knowledge Base export endpoint (Phase 5)
  app.get(
    "/api/knowledge/export",
    authLimiter,
    requireBearerToken,
    adminExportLimiter,
    requireRole("admin"),
    auditProtectedAction("knowledge.export.read"),
    (req, res) => {
      try {
        const format = (req.query.format as string) || "markdown";
        const kb = knowledgeIntegration.export(format as "markdown" | "json");

        if (format === "markdown") {
          res.type("text/markdown").send(kb);
        } else {
          res.json(JSON.parse(kb));
        }
      } catch (error: any) {
        console.error("[api/knowledge/export] Error", { error: error.message });
        res.status(500).json({ error: error.message });
      }
    },
  );

  // Persistence historical data endpoint
  app.get(
    "/api/persistence/historical",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("persistence.historical.read"),
    createValidationMiddleware(PersistenceHistoricalSchema, "query"),
    async (req, res) => {
      try {
        const days = parseInt((req.query.days as string) || "30", 10);
        const data = await PersistenceIntegration.getHistoricalData(days);
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  // Persistence export endpoint
  app.get(
    "/api/persistence/export",
    authLimiter,
    requireBearerToken,
    adminExportLimiter,
    requireRole("admin"),
    auditProtectedAction("persistence.export.read"),
    async (req, res) => {
      try {
        const exportData = await PersistenceIntegration.exportAllData();
        res.json(exportData);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/tasks/runs",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("tasks.runs.read"),
    createValidationMiddleware(TaskRunsQuerySchema, "query"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const type = typeof req.query.type === "string" ? req.query.type : undefined;
        const status =
          typeof req.query.status === "string" ? req.query.status : undefined;
        const includeInternalQuery = String(req.query.includeInternal ?? "").toLowerCase();
        const includeInternal =
          includeInternalQuery === "true" || includeInternalQuery === "1";
        const limit = Number(req.query.limit ?? 50);
        const offset = Number(req.query.offset ?? 0);
        await respondWithCachedJson(req, res, {
          namespace: "tasks.runs",
          ttlSeconds: readCacheTtls.taskRuns,
          tags: ["runtime-state"],
          scope: "protected",
          keyData: { type, status, includeInternal, limit, offset },
          compute: () => {
            const filtered = filterVisibleTaskExecutions(
              state.taskExecutions,
              includeInternal,
            ).filter((execution) => {
              if (type && execution.type !== type) return false;
              if (status && execution.status !== status) return false;
              return true;
            });

            const sorted = [...filtered].sort((a, b) =>
              b.lastHandledAt.localeCompare(a.lastHandledAt),
            );
            const page = sorted.slice(offset, offset + limit);

            return {
              generatedAt: new Date().toISOString(),
              query: {
                type: type ?? null,
                status: status ?? null,
                includeInternal,
                limit,
                offset,
              },
              total: filtered.length,
              page: {
                returned: page.length,
                offset,
                limit,
                hasMore: offset + page.length < filtered.length,
              },
              runs: page.map((execution) => buildRunRecord(execution, state, config)),
            };
          },
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/tasks/runs/:runId",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("tasks.run.read"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const runId = String(req.params.runId);
        const execution = state.taskExecutions.find(
          (item) => item.idempotencyKey === runId,
        );

        if (!execution) {
          return res.status(404).json({ error: `Run not found: ${runId}` });
        }

        return await respondWithCachedJson(req, res, {
          namespace: "tasks.run.detail",
          ttlSeconds: readCacheTtls.taskRunDetail,
          tags: ["runtime-state"],
          scope: "protected",
          keyData: { runId },
          compute: () => ({
            generatedAt: new Date().toISOString(),
            run: buildRunRecord(execution, state, config),
          }),
        });
      } catch (error: any) {
        return res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/skills/registry",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("skills.registry.read"),
    async (req: AuthenticatedRequest, res) => {
      await respondWithCachedJson(req, res, {
        namespace: "skills.registry",
        ttlSeconds: readCacheTtls.skillsRegistry,
        tags: ["runtime-state"],
        scope: "protected",
        compute: () => ({
          generatedAt: new Date().toISOString(),
          total: state.governedSkillState.length,
          skills: state.governedSkillState.map((skill) => ({
            skillId: skill.skillId,
            name: skill.definition.id,
            description: skill.definition.description,
            trustStatus: skill.trustStatus,
            intakeSource: skill.intakeSource,
            persistenceMode: skill.persistenceMode,
            auditedAt: skill.auditedAt,
            reviewedBy: skill.reviewedBy ?? null,
            reviewedAt: skill.reviewedAt ?? null,
            reviewNote: skill.reviewNote ?? null,
            executable:
              skill.trustStatus === "review-approved" && Boolean(skill.executorBinding),
            executorBinding: skill.executorBinding ?? null,
            provenanceSnapshot: skill.provenanceSnapshot,
          })),
        }),
      });
    },
  );

  app.get(
    "/api/skills/policy",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("skills.policy.read"),
    async (req: AuthenticatedRequest, res) => {
      await respondWithCachedJson(req, res, {
        namespace: "skills.policy",
        ttlSeconds: readCacheTtls.skillsPolicy,
        tags: ["runtime-state"],
        scope: "protected",
        compute: () => ({
          generatedAt: new Date().toISOString(),
          policy: summarizeGovernanceVisibility(state).governedSkills,
        }),
      });
    },
  );

  app.get(
    "/api/skills/telemetry",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("skills.telemetry.read"),
    async (req: AuthenticatedRequest, res) => {
      try {
        await respondWithCachedJson(req, res, {
          namespace: "skills.telemetry",
          ttlSeconds: readCacheTtls.skillsTelemetry,
          tags: ["runtime-state"],
          scope: "protected",
          compute: async () => {
            const gate = await getToolGate();
            const toolLog = gate.getLog();
            return {
              generatedAt: new Date().toISOString(),
              telemetry: {
                totalInvocations: toolLog.invocations.length,
                allowedCount: toolLog.allowedCount,
                deniedCount: toolLog.deniedCount,
              },
            };
          },
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/skills/audit",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("skills.audit.read"),
    createValidationMiddleware(SkillsAuditQuerySchema, "query"),
    async (req: AuthenticatedRequest, res) => {
      try {
        const limit = Number(req.query.limit ?? 100);
        const offset = Number(req.query.offset ?? 0);
        const deniedOnly = parseBoolean(req.query.deniedOnly, false);
        await respondWithCachedJson(req, res, {
          namespace: "skills.audit",
          ttlSeconds: readCacheTtls.skillsAudit,
          tags: ["runtime-state"],
          scope: "protected",
          keyData: { limit, offset, deniedOnly },
          compute: async () => {
            const gate = await getToolGate();
            const log = deniedOnly
              ? gate.getDeniedInvocations()
              : gate.getLog().invocations;
            const sorted = [...log].sort((a, b) =>
              b.timestamp.localeCompare(a.timestamp),
            );
            const items = sorted.slice(offset, offset + limit);

            return {
              generatedAt: new Date().toISOString(),
              query: { limit, offset, deniedOnly },
              total: log.length,
              page: {
                returned: items.length,
                offset,
                limit,
                hasMore: offset + items.length < log.length,
              },
              records: items,
            };
          },
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/health/extended",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("health.extended.read"),
    async (req: AuthenticatedRequest, res) => {
      try {
        await respondWithCachedJson(req, res, {
          namespace: "health.extended",
          ttlSeconds: readCacheTtls.healthExtended,
          tags: ["runtime-state"],
          scope: "protected",
          compute: async () => {
            const governance = summarizeGovernanceVisibility(state);
            const queueQueued = queue.getQueuedCount();
            const queueProcessing = queue.getPendingCount();
            const pendingApprovalsCount = listPendingApprovals(state).length;
            const knowledge = knowledgeIntegration.getSummary();
            const knowledgeRuntime = buildKnowledgeRuntimeSignals({
              summary: knowledge,
              config,
              state,
            });
            const [persistence, agents] = await Promise.all([
              PersistenceIntegration.healthCheck(),
              buildAgentOperationalOverview(state),
            ]);

            const serviceAvailableCount = agents.filter(
              (agent) => agent.serviceAvailable,
            ).length;
            const serviceExpectedCount = agents.filter(
              (agent) => agent.serviceExpected,
            ).length;
            const serviceInstalledCount = agents.filter(
              (agent) => agent.serviceInstalled === true,
            ).length;
            const serviceRunningCount = agents.filter(
              (agent) => agent.serviceRunning === true,
            ).length;
            const serviceExpectedGapCount = agents.filter(
              (agent) =>
                agent.serviceExpected &&
                (!agent.serviceAvailable || agent.serviceInstalled !== true || agent.serviceRunning !== true),
            ).length;
            const serviceOperationalCount = serviceRunningCount;
            const spawnedWorkerCapableCount = agents.filter(
              (agent) => agent.spawnedWorkerCapable,
            ).length;

            const controlPlaneHealthy = queueProcessing >= 0;
            const dependencyStatus =
              persistence.status === "healthy" ? "healthy" : "degraded";
            const repairSummary = governance.repairs;
            const truthLayers = buildRuntimeTruthLayers({
              claimed: claimedTruthLayer,
              config,
              state,
              fastStartMode,
              persistenceStatus:
                typeof persistence.status === "string"
                  ? persistence.status
                  : "unknown",
              knowledgeRuntime,
              queueQueued,
              queueProcessing,
              pendingApprovalsCount,
              repairs: repairSummary,
              retryRecoveries: governance.taskRetryRecoveries,
              agents,
              githubWorkflowMonitor,
            });
            const incidents = buildRuntimeIncidentModel({
              config,
              state,
              fastStartMode,
              persistence,
              agents,
              governance,
              pendingApprovalsCount,
              knowledgeRuntime,
              githubWorkflowMonitor,
              includeIncidentDetails: false,
              reconcileLedger: false,
            }).model;
            const healthStatus =
              controlPlaneHealthy &&
              dependencyStatus === "healthy" &&
              incidents.overallStatus === "stable"
                ? "healthy"
                : incidents.overallStatus === "critical" ||
                    dependencyStatus !== "healthy"
                  ? "degraded"
                  : "warning";

            return {
              generatedAt: new Date().toISOString(),
              status: healthStatus,
              controlPlane: {
                routing:
                  incidents.overallStatus === "critical"
                    ? "degraded"
                    : controlPlaneHealthy
                      ? incidents.overallStatus === "warning"
                        ? "warning"
                        : "healthy"
                      : "degraded",
                queue: {
                  queued: queueQueued,
                  processing: queueProcessing,
                },
              },
              workers: {
                declaredAgents: agents.length,
                spawnedWorkerCapableCount,
                serviceExpectedCount,
                serviceAvailableCount,
                serviceInstalledCount,
                serviceRunningCount,
                serviceExpectedGapCount,
                serviceOperationalCount,
              },
              repairs: {
                model: "partial-runtime",
                activeCount: repairSummary.activeCount,
                verifiedCount: repairSummary.verifiedCount,
                failedCount: repairSummary.failedCount,
                lastDetectedAt: repairSummary.lastDetectedAt,
                lastVerifiedAt: repairSummary.lastVerifiedAt,
                lastFailedAt: repairSummary.lastFailedAt,
              },
              dependencies: {
                persistence,
                knowledge: {
                  indexedEntries: knowledge.stats?.total ?? 0,
                  conceptCount: knowledge.networkStats?.totalConcepts ?? 0,
                },
                github: githubWorkflowMonitor,
              },
              truthLayers,
              incidents,
            };
          },
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.get(
    "/api/persistence/summary",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("persistence.summary.read"),
    async (req: AuthenticatedRequest, res) => {
      try {
        await respondWithCachedJson(req, res, {
          namespace: "persistence.summary",
          ttlSeconds: readCacheTtls.persistenceSummary,
          tags: ["runtime-state"],
          scope: "protected",
          compute: async () => PersistenceIntegration.getOperatorSummary(state),
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    },
  );

  const server = app.listen(PORT, () => {
    console.log(`[orchestrator] HTTP server listening on port ${PORT}`);
    void warmDocumentIndexInBackground();
    scheduleAgentOperationalOverviewWarm(state, 1000);
    void completeDeferredStartup().catch((error) => {
      console.error("[orchestrator] deferred startup failed:", error);
    });
    console.log(
      `[orchestrator] ⚠️  AUTHENTICATION ENABLED - API key required for protected endpoints`,
    );
    console.log(`[orchestrator] Metrics: http://localhost:9100/metrics`);
    console.log(
      `[orchestrator] Alert webhook: POST http://localhost:${PORT}/webhook/alerts (signature required)`,
    );
    console.log(
      `[orchestrator] Knowledge query: POST http://localhost:${PORT}/api/knowledge/query (auth required)`,
    );
    console.log(
      `[orchestrator] Knowledge summary: http://localhost:${PORT}/api/knowledge/summary (public)`,
    );
    console.log(
      `[orchestrator] Persistence health: http://localhost:${PORT}/api/persistence/health (public)`,
    );
    console.log(
      `[orchestrator] Health check: http://localhost:${PORT}/health (public)`,
    );
  });

  // ============================================================
  // Graceful Shutdown Handler (Day 10)
  // ============================================================

  process.on("SIGTERM", async () => {
    if (isShuttingDown) {
      console.log(
        "[orchestrator] SIGTERM received during shutdown, ignoring duplicate signal",
      );
      return;
    }
    isShuttingDown = true;

    console.log(
      "[orchestrator] Received SIGTERM, starting graceful shutdown...",
    );
    server.close(async () => {
      console.log("[orchestrator] HTTP server closed");
      try {
        await PersistenceIntegration.close();
        console.log("[orchestrator] Database connections closed");
      } catch (err) {
        console.error("[orchestrator] Error closing database:", err);
      }
      if (forceShutdownTimer) {
        clearTimeout(forceShutdownTimer);
      }
      console.log("[orchestrator] ✅ Graceful shutdown complete");
      process.exit(0);
    });

    // Force kill after 30 seconds if shutdown hasn't completed
    forceShutdownTimer = setTimeout(() => {
      console.error("[orchestrator] Shutdown timeout, forcing exit");
      process.exit(1);
    }, 30000);
  });

  // Handle SIGINT (Ctrl+C)
  process.on("SIGINT", () => {
    console.log("[orchestrator] Received SIGINT, initiating shutdown...");
    process.emit("SIGTERM");
  });
}

if (process.env.OPENCLAW_SKIP_BOOTSTRAP !== "true") {
  bootstrap().catch((err) => {
    console.error("[orchestrator] fatal", err);
    process.exit(1);
  });
}
