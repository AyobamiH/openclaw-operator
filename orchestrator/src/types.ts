import type { SkillDefinition as RuntimeSkillDefinition } from "./skills/types.js";

export interface OrchestratorConfig {
  docsPath: string;
  cookbookPath?: string;
  logsDir: string;
  stateFile: string;
  taskHistoryLimit?: number;
  strictPersistence?: boolean;
  retryMaxAttempts?: number;
  retryBackoffMs?: number;
  approvalRequiredTaskTypes?: string[];
  deployBaseDir?: string;
  rssConfigPath?: string;
  redditDraftsPath?: string;
  knowledgePackDir?: string;
  notes?: string;
  // LLM Integration
  runtimeEngagementOsPath?: string;
  openaiModel?: string;
  openaiMaxTokens?: number;
  openaiTemperature?: number;
  // Digest Settings
  digestDir?: string;
  digestNotificationChannel?: string;
  digestNotificationTarget?: string;
  digestTimeZone?: string;
  // Scheduling
  nightlyBatchSchedule?: string;
  morningNotificationSchedule?: string;
  // CORS (frontend integration)
  corsAllowedOrigins?: string[];
  corsAllowedMethods?: string[];
  corsAllowedHeaders?: string[];
  corsExposedHeaders?: string[];
  corsAllowCredentials?: boolean;
  corsMaxAgeSeconds?: number;
}

export interface DocRecord {
  path: string;
  content: string;
  lastModified: number;
}

export interface Task {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
  idempotencyKey?: string;
  attempt?: number;
  maxRetries?: number;
}

export interface TaskRecord {
  id: string;
  type: string;
  handledAt: string;
  result: "ok" | "error";
  message?: string;
}

export interface TaskExecutionUsage {
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}

export interface TaskExecutionBudget {
  status: "ok" | "exhausted" | "unknown";
  reason?: string | null;
  llmCallsToday?: number | null;
  tokensToday?: number | null;
  maxLlmCallsPerDay?: number | null;
  maxTokensPerDay?: number | null;
  remainingLlmCalls?: number | null;
  remainingTokens?: number | null;
  resetTimeZone?: string | null;
  budgetDate?: string | null;
}

export interface TaskExecutionAccounting {
  provider: string | null;
  model: string | null;
  metered: boolean;
  pricingSource: "catalog" | "override" | "unpriced" | "not-applicable";
  latencyMs: number | null;
  costUsd: number;
  usage?: TaskExecutionUsage | null;
  budget?: TaskExecutionBudget | null;
  note?: string | null;
}

export interface ApprovalRecord {
  taskId: string;
  type: string;
  payload: Record<string, unknown>;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  decidedAt?: string;
  decidedBy?: string;
  note?: string;
}

export type IncidentLedgerClassification =
  | "runtime-mode"
  | "persistence"
  | "proof-delivery"
  | "repair"
  | "retry-recovery"
  | "knowledge"
  | "service-runtime"
  | "approval-backlog";

export type IncidentLedgerSeverity = "info" | "warning" | "critical";
export type IncidentLedgerTruthLayer = "configured" | "observed" | "public";
export type IncidentLedgerStatus = "active" | "watching" | "resolved";
export type IncidentRemediationOwner = "auto" | "operator" | "mixed";
export type IncidentRemediationStatus =
  | "ready"
  | "in-progress"
  | "blocked"
  | "watching"
  | "resolved";

export type IncidentHistoryEventType =
  | "detected"
  | "status-changed"
  | "severity-changed"
  | "summary-updated"
  | "policy-executed"
  | "escalated"
  | "acknowledged"
  | "owner-changed"
  | "remediation-plan-updated"
  | "remediation-task-created"
  | "remediation-assigned"
  | "remediation-executing"
  | "remediation-verified"
  | "verification-required"
  | "verification-passed"
  | "verification-failed"
  | "remediation-status-changed"
  | "resolved";

export interface IncidentHistoryEvent {
  id: string;
  timestamp: string;
  type: IncidentHistoryEventType;
  actor?: string | null;
  summary: string;
  detail?: string | null;
  evidence: string[];
}

export interface IncidentAcknowledgementRecord {
  acknowledgedAt: string;
  acknowledgedBy: string;
  note?: string | null;
}

export interface IncidentOwnershipRecord {
  changedAt: string;
  changedBy: string;
  previousOwner?: string | null;
  nextOwner?: string | null;
  note?: string | null;
}

export type IncidentRemediationTaskStatus =
  | "assigned"
  | "queued"
  | "running"
  | "verifying"
  | "verified"
  | "resolved"
  | "blocked"
  | "completed"
  | "failed"
  | "unknown";

export type IncidentRemediationPlanStepStatus =
  | "pending"
  | "active"
  | "completed"
  | "blocked"
  | "skipped";

export interface IncidentRemediationPlanStep {
  stepId: string;
  title: string;
  kind: "diagnose" | "execute" | "verify" | "close";
  owner: string;
  status: IncidentRemediationPlanStepStatus;
  description: string;
  taskType?: string | null;
  dependsOn: string[];
  startedAt?: string | null;
  completedAt?: string | null;
  evidence: string[];
}

export interface IncidentRemediationPolicy {
  policyId: string;
  preferredOwner: string;
  autoAssignOwner: boolean;
  autoRemediateOnCreate: boolean;
  autoRetryBlockedRemediation: boolean;
  maxAutoRemediationAttempts: number;
  autoEscalateOnBreach: boolean;
  remediationTaskType: "drift-repair" | "qa-verification" | "system-monitor";
  verifierTaskType: "qa-verification" | null;
  escalationTaskType: "qa-verification" | "system-monitor" | null;
  targetSlaMinutes: number;
  escalationMinutes: number;
}

export type IncidentPolicyExecutionTrigger =
  | "reconcile"
  | "policy-create"
  | "policy-retry"
  | "policy-verification"
  | "policy-escalation";

export type IncidentPolicyExecutionAction =
  | "auto-owner-assigned"
  | "auto-remediation-created"
  | "auto-remediation-retried"
  | "auto-verification-created"
  | "auto-escalation-created";

export type IncidentPolicyExecutionResult = "executed" | "blocked" | "skipped";

export interface IncidentPolicyExecutionRecord {
  executionId: string;
  executedAt: string;
  actor: string;
  policyId: string;
  trigger: IncidentPolicyExecutionTrigger;
  action: IncidentPolicyExecutionAction;
  result: IncidentPolicyExecutionResult;
  summary: string;
  detail?: string | null;
  remediationId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  evidence: string[];
}

export interface IncidentEscalationState {
  level: "normal" | "warning" | "escalated" | "breached";
  status: "on-track" | "watching" | "escalated" | "breached";
  dueAt: string | null;
  escalateAt: string | null;
  escalatedAt?: string | null;
  breachedAt?: string | null;
  summary: string;
}

export interface IncidentVerificationState {
  required: boolean;
  agentId: string | null;
  status: "not-required" | "pending" | "running" | "passed" | "failed";
  summary: string;
  verificationTaskId?: string | null;
  verificationRunId?: string | null;
  verifiedAt?: string | null;
}

export interface IncidentRemediationTaskRecord {
  remediationId: string;
  lane: "primary" | "verification" | "escalation";
  createdAt: string;
  createdBy: string;
  assignedTo?: string | null;
  assignedAt?: string | null;
  taskType: string;
  taskId: string;
  runId?: string | null;
  status: IncidentRemediationTaskStatus;
  reason: string;
  note?: string | null;
  executionStartedAt?: string | null;
  executionCompletedAt?: string | null;
  verificationStartedAt?: string | null;
  verificationCompletedAt?: string | null;
  verifiedAt?: string | null;
  resolvedAt?: string | null;
  lastUpdatedAt?: string | null;
  verificationSummary?: string | null;
  resolutionSummary?: string | null;
  blockers?: string[];
}

export interface IncidentLedgerRecord {
  incidentId: string;
  fingerprint: string;
  title: string;
  classification: IncidentLedgerClassification;
  severity: IncidentLedgerSeverity;
  truthLayer: IncidentLedgerTruthLayer;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt?: string | null;
  status: IncidentLedgerStatus;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  acknowledgementNote?: string | null;
  owner?: string | null;
  summary: string;
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
}

export interface TaskExecutionRecord {
  taskId: string;
  idempotencyKey: string;
  type: string;
  status: "pending" | "running" | "success" | "failed" | "retrying";
  attempt: number;
  maxRetries: number;
  startedAt?: string | null;
  completedAt?: string | null;
  lastHandledAt: string;
  lastError?: string;
  resultSummary?: {
    success?: boolean;
    keys: string[];
    highlights?: Record<string, unknown>;
  };
  accounting?: TaskExecutionAccounting | null;
}

export type WorkflowEventStage =
  | "ingress"
  | "queue"
  | "approval"
  | "agent"
  | "result"
  | "proof"
  | "repair";

export type RelationshipObservationType =
  | "dispatches-task"
  | "routes-to-agent"
  | "delegates-task"
  | "uses-skill"
  | "invokes-tool"
  | "publishes-proof"
  | "transitions-proof"
  | "feeds-agent"
  | "verifies-agent"
  | "monitors-agent"
  | "audits-agent"
  | "coordinates-agent"
  | "depends-on-run"
  | "cross-run-handoff";

export type RelationshipObservationStatus =
  | "observed"
  | "warning"
  | "degraded";

export interface WorkflowEventRecord {
  eventId: string;
  runId: string;
  taskId: string;
  type: string;
  stage: WorkflowEventStage;
  state: string;
  timestamp: string;
  source: string;
  actor: string;
  nodeId: string;
  detail: string;
  evidence: string[];
  attempt?: number;
  relatedNodeIds?: string[];
  stopCode?: string | null;
  parentEventId?: string | null;
  relatedRunId?: string | null;
  dependencyRunIds?: string[];
  toolId?: string | null;
  proofTransport?: "milestone" | "demandSummary" | null;
  classification?: string | null;
}

export interface RelationshipObservationRecord {
  observationId: string;
  timestamp: string;
  from: string;
  to: string;
  relationship: RelationshipObservationType;
  status: RelationshipObservationStatus;
  source: string;
  detail: string;
  taskId?: string | null;
  runId?: string | null;
  targetTaskId?: string | null;
  targetRunId?: string | null;
  toolId?: string | null;
  proofTransport?: "milestone" | "demandSummary" | null;
  classification?: string | null;
  parentObservationId?: string | null;
  evidence: string[];
}

export interface TaskRetryRecoveryRecord {
  sourceTaskId: string;
  idempotencyKey: string;
  type: string;
  payload: Record<string, unknown>;
  attempt: number;
  maxRetries: number;
  retryAt: string;
  scheduledAt: string;
}

export type RepairClassification = "doc-drift" | "task-retry-recovery";

export type RepairStatus =
  | "detected"
  | "queued"
  | "running"
  | "verified"
  | "failed";

export type RepairVerificationMode = "knowledge-pack" | "task-success";

export interface RepairRecord {
  repairId: string;
  classification: RepairClassification;
  trigger: string;
  sourceTaskId?: string;
  sourceTaskType?: string;
  sourceRunId?: string;
  repairTaskType: string;
  repairTaskId?: string;
  repairRunId?: string;
  verificationMode: RepairVerificationMode;
  status: RepairStatus;
  detectedAt: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  verifiedAt?: string;
  affectedPaths?: string[];
  verificationSummary?: string;
  evidence?: string[];
  lastError?: string;
}

export interface DriftRepairRecord {
  runId: string;
  requestedBy: string;
  processedPaths: string[];
  generatedPackIds: string[];
  packPaths?: string[];
  docsProcessed?: number;
  updatedAgents: string[];
  durationMs: number;
  completedAt: string;
  notes?: string;
}

export interface RedditQueueItem {
  id: string;
  subreddit: string;
  question: string;
  link?: string;
  queuedAt: string;
  selectedForDraft?: boolean;
  tag?: string;
  pillar?: string;
  feedId?: string;
  entryContent?: string;
  author?: string;
  ctaVariant?: string;
  matchedKeywords?: string[];
  score?: number;
  draftRecordId?: string;
  suggestedReply?: string;
}

export interface RedditReplyRecord {
  queueId: string;
  subreddit: string;
  question: string;
  draftedResponse: string;
  responder: string;
  confidence: number;
  status: "drafted" | "posted" | "error";
  respondedAt: string;
  postedAt?: string;
  link?: string;
  notes?: string;
  rssDraftId?: string;
  devvitPayloadPath?: string;
  packId?: string;
  packPath?: string;
}

export interface AgentDeploymentRecord {
  deploymentId: string;
  agentName: string;
  template: string;
  repoPath: string;
  config: Record<string, unknown>;
  status: "planned" | "deploying" | "deployed" | "retired";
  deployedAt: string;
  notes?: string;
}

export interface RssDraftRecord {
  draftId: string;
  pillar: string;
  feedId: string;
  subreddit: string;
  title: string;
  content: string;
  link: string;
  author?: string;
  matchedKeywords: string[];
  scoreBreakdown: Record<string, number>;
  totalScore: number;
  suggestedReply: string;
  ctaVariant: string;
  tag: "draft" | "priority" | "manual-review";
  queuedAt: string;
}

export interface DemandSummaryTagCounts {
  draft: number;
  priority: number;
  manualReview: number;
}

export interface DemandSummaryTopItem {
  id: string;
  label: string;
  count: number;
}

export type DemandSegmentState = "hot" | "warm" | "idle";

export interface DemandSummarySegment {
  id: string;
  label: string;
  liveSignalCount: number;
  state: DemandSegmentState;
  staticWeight: number;
  clusterLabels: string[];
}

export interface DemandSummarySnapshot {
  summaryId: string;
  generatedAtUtc: string;
  source: "orchestrator";
  queueTotal: number;
  draftTotal: number;
  selectedForDraftTotal: number;
  tagCounts: DemandSummaryTagCounts;
  topPillars: DemandSummaryTopItem[];
  topKeywordClusters: DemandSummaryTopItem[];
  segments: DemandSummarySegment[];
}

export type GovernedSkillPersistenceMode = "restart-safe" | "metadata-only";

export interface GovernedSkillProvenanceSnapshot {
  author: string;
  source: string;
  version: string;
}

export interface PersistedGovernedSkillExecutorBinding {
  type: "builtin-skill";
  skillId: string;
}

export interface PersistedGovernedSkillRecord {
  skillId: string;
  definition: RuntimeSkillDefinition;
  auditedAt: string;
  intakeSource: "generated" | "imported" | "manual";
  registeredBy?: string;
  trustStatus: "pending-review" | "review-approved";
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  provenanceSnapshot: GovernedSkillProvenanceSnapshot;
  persistenceMode: GovernedSkillPersistenceMode;
  executorBinding?: PersistedGovernedSkillExecutorBinding;
}

export interface OrchestratorState {
  lastStartedAt: string | null;
  updatedAt: string | null;
  indexedDocs: number;
  docIndexVersion: number;
  pendingDocChanges: string[];
  taskHistory: TaskRecord[];
  taskExecutions: TaskExecutionRecord[];
  approvals: ApprovalRecord[];
  driftRepairs: DriftRepairRecord[];
  repairRecords: RepairRecord[];
  taskRetryRecoveries: TaskRetryRecoveryRecord[];
  redditQueue: RedditQueueItem[];
  redditResponses: RedditReplyRecord[];
  agentDeployments: AgentDeploymentRecord[];
  rssDrafts: RssDraftRecord[];
  rssSeenIds: string[];
  governedSkillState: PersistedGovernedSkillRecord[];
  incidentLedger: IncidentLedgerRecord[];
  workflowEvents: WorkflowEventRecord[];
  relationshipObservations: RelationshipObservationRecord[];
  lastDriftRepairAt: string | null;
  lastRedditResponseAt: string | null;
  lastAgentDeployAt: string | null;
  lastRssSweepAt: string | null;
  lastNightlyBatchAt?: string | null;
  lastDigestNotificationAt?: string | null;
}

export interface TaskHandlerContext {
  config: OrchestratorConfig;
  state: OrchestratorState;
  saveState: () => Promise<void>;
  enqueueTask: (type: string, payload: Record<string, unknown>) => Task;
  logger: Console;
  appendIncidentHistoryEvent?: (
    incidentId: string,
    event: Omit<IncidentHistoryEvent, "id" | "evidence"> & {
      evidence?: string[];
    },
  ) => void;
  appendTaskWorkflowEvent?: (
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
  ) => void;
}

export type TaskHandler = (
  task: Task,
  context: TaskHandlerContext,
) => Promise<string | void>;
// Skill and Permission Types
export interface SkillPermissions {
  fileRead?: boolean | string[];
  fileWrite?: boolean | string[];
  networkAllowed?: boolean | string[];
  execAllowed?: boolean | string[];
  eval?: boolean;
  spawn?: boolean;
  secrets?: boolean;
}

export interface SkillProvenance {
  source: string;
  version: string;
  license?: string;
  maintainedAt?: string;
}

export interface SkillSchema {
  type: string;
  properties: Record<string, any>;
  required?: string[];
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  provenance: SkillProvenance;
  permissions: SkillPermissions;
  inputs: SkillSchema;
  outputs: SkillSchema;
}

export interface SkillAuditCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  detail?: string;
}

export interface SkillAuditResults {
  passed: boolean;
  runAt: string;
  checks: SkillAuditCheck[];
  riskFlags: string[];
  recommendations: string[];
}

export interface ToolInvocation {
  id: string;
  agentId: string;
  skillId: string;
  args: Record<string, any>;
  timestamp: string;
  mode?: string;
  taskType?: string;
  allowed: boolean;
  reason?: string;
}

export interface ToolInvocationLog {
  success: boolean;
  invocations: ToolInvocation[];
  deniedCount: number;
  allowedCount: number;
}
