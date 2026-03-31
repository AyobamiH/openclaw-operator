// OpenClaw Operator Console Types
// Aligned to Integration Contract V1

// ── Dashboard Overview ──
export interface DashboardOverview {
  generatedAt: string;
  health: { status: string; fastStartMode?: boolean };
  persistence: { status: string; database?: string; collections?: unknown };
  memory: Record<string, unknown>;
  accounting?: {
    totalCostUsd?: number;
    meteredRunCount?: number;
    unmeteredRunCount?: number;
    pricedRunCount?: number;
    unpricedRunCount?: number;
    averageLatencyMs?: number | null;
    totalTokens?: number;
    byModel?: Record<string, { runs?: number; costUsd?: number; tokens?: number }>;
    currentBudget?: {
      status?: string;
      reason?: string | null;
      llmCallsToday?: number | null;
      tokensToday?: number | null;
      maxLlmCallsPerDay?: number | null;
      maxTokensPerDay?: number | null;
      remainingLlmCalls?: number | null;
      remainingTokens?: number | null;
      resetTimeZone?: string | null;
      budgetDate?: string | null;
    } | null;
  };
  queue: {
    queued: number;
    processing: number;
    pressure?: DashboardQueuePressureItem[];
  };
  approvals: { pendingCount: number; pending: PendingApprovalItem[] };
  governance: {
    approvals: number;
    taskRetryRecoveries: number;
    governedSkills?: GovernedSkillsSummary;
  };
  truthLayers?: RuntimeTruthLayers;
  topology?: AgentTopology;
  incidents?: RuntimeIncidentModel & {
    topClassifications?: DashboardIncidentClassificationItem[];
  };
  recentTasks: RecentTask[];
}

export interface DashboardQueuePressureItem {
  type: string;
  label: string;
  source: string;
  queuedCount: number;
  processingCount: number;
  totalCount: number;
  oldestCreatedAt?: string | null;
  newestCreatedAt?: string | null;
}

export interface DashboardIncidentClassificationItem {
  classification:
    | "runtime-mode"
    | "persistence"
    | "proof-delivery"
    | "repair"
    | "retry-recovery"
    | "knowledge"
    | "service-runtime"
    | "approval-backlog";
  label: string;
  count: number;
  activeCount: number;
  watchingCount: number;
  highestSeverity: "info" | "warning" | "critical";
}

export interface GovernedSkillsSummary {
  total?: number;
  pendingReview?: number;
  approved?: number;
  restartSafe?: number;
  restartSafeApproved?: number;
  metadataOnly?: number;
  metadataOnlyApproved?: number;
}

export interface RecentTask {
  id?: string;
  taskId?: string;
  type: string;
  label?: string;
  message?: string;
  status: string;
  result?: string;
  agent?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt?: string;
  handledAt?: string;
  repeatCount?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
}

// ── Health ──
export interface HealthResponse {
  status: string;
  timestamp?: string;
  metrics?: Record<string, unknown>;
  knowledge?: Record<string, unknown>;
  persistence?: Record<string, unknown>;
}

// ── Persistence Health ──
export interface PersistenceHealth {
  status: string;
  database?: string;
  collections?: unknown;
  coordination?: {
    status?: string;
    store?: "redis" | "memory";
    redisConfigured?: boolean;
    redisReachable?: boolean;
    detail?: string;
    checkedAt?: string;
    disabledUntil?: string | null;
  };
}

// ── Extended Health ──
export interface ExtendedHealth {
  generatedAt: string;
  status: string;
  controlPlane?: {
    routing?: string;
    queue?: { queued?: number; processing?: number } | string;
  };
  workers?: {
    declaredAgents?: number;
    spawnedWorkerCapableCount?: number;
    serviceAvailableCount?: number;
    serviceInstalledCount?: number;
    serviceRunningCount?: number;
    serviceOperationalCount?: number;
  };
  repairs?: {
    activeCount?: number;
    verifiedCount?: number;
    failedCount?: number;
    lastDetectedAt?: string;
    lastVerifiedAt?: string;
  };
  dependencies?: {
    persistence?: { status?: string; database?: boolean; collections?: number } | string;
    knowledge?: { indexedEntries?: number; conceptCount?: number } | string;
    github?: {
      status?: string;
      summary?: string;
      repository?: string | null;
      branch?: string | null;
      lastCheckedAt?: string | null;
      latestRun?: {
        workflowName?: string | null;
        conclusion?: string | null;
        url?: string | null;
      } | null;
    } | string;
  };
  truthLayers?: RuntimeTruthLayers;
  topology?: Pick<AgentTopology, "status" | "counts" | "hotspots" | "relationshipHistory">;
  incidents?: RuntimeIncidentModel;
}

// ── Persistence Summary ──
export interface PersistenceSummary {
  generatedAt: string;
  status: string;
  persistenceAvailable?: boolean;
  storage?: Record<string, unknown>;
  collections?: Record<string, unknown>;
  indicators?: Record<string, unknown>;
  retention?: Record<string, unknown>;
}

// ── Task Catalog ──
export interface CatalogTask {
  type: string;
  label: string;
  purpose?: string;
  internalOnly?: boolean;
  publicTriggerable?: boolean;
  approvalGated?: boolean;
  operationalStatus?: string;
  dependencyClass?: string;
  baselineConfidence?: number;
  dependencyRequirements?: string[];
  exposeInV1?: boolean;
  caveats?: string[];
  telemetryOverlay?: {
    totalRuns?: number;
    successRate?: number;
    failureRate?: number;
    retryingCount?: number;
    latencyVarianceMs?: number;
    driftSignals?: unknown;
  };
}

export interface TaskCatalogResponse {
  generatedAt: string;
  tasks: CatalogTask[];
}

// ── Task Trigger ──
export interface TaskTriggerResponse {
  status: "queued";
  taskId: string;
  type: string;
  createdAt: string;
}

// ── Task Runs ──
export interface TaskRun {
  id?: string;
  runId?: string;
  taskId?: string;
  type: string;
  status: string;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  model?: string | null;
  cost?: number | null;
  latency?: number | null;
  usage?: {
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
  } | null;
  budget?: {
    status?: string;
    reason?: string | null;
    llmCallsToday?: number | null;
    tokensToday?: number | null;
    maxLlmCallsPerDay?: number | null;
    maxTokensPerDay?: number | null;
    remainingLlmCalls?: number | null;
    remainingTokens?: number | null;
    resetTimeZone?: string | null;
    budgetDate?: string | null;
  } | null;
  accounting?: {
    provider?: string | null;
    model?: string | null;
    metered?: boolean;
    pricingSource?: string;
    latencyMs?: number | null;
    costUsd?: number;
    note?: string | null;
    usage?: {
      promptTokens?: number | null;
      completionTokens?: number | null;
      totalTokens?: number | null;
    } | null;
    budget?: {
      status?: string;
      reason?: string | null;
      remainingLlmCalls?: number | null;
      remainingTokens?: number | null;
    } | null;
  } | null;
  error?: string;
  lastHandledAt?: string;
  lastError?: string;
  attempt?: number;
  maxRetries?: number;
  workflow?: {
    stage?: string;
    graphStatus?: string | null;
    currentStage?: string | null;
    blockedStage?: string | null;
    stopReason?: string | null;
    stopClassification?: string | null;
    awaitingApproval?: boolean;
    retryScheduled?: boolean;
    nextRetryAt?: string | null;
    repairStatus?: string | null;
    eventCount?: number;
    latestEventAt?: string | null;
    stageDurations?: Record<string, number>;
    timingBreakdown?: Record<string, {
      startedAt?: string | null;
      completedAt?: string | null;
      durationMs?: number | null;
      eventCount?: number;
    }>;
    nodeCount?: number;
    edgeCount?: number;
  };
  approval?: {
    required?: boolean;
    status?: string | null;
    requestedAt?: string | null;
    decidedAt?: string | null;
    decidedBy?: string | null;
    note?: string | null;
  };
  events?: Array<{
    id?: string;
    stage?: string;
    state?: string;
    source?: string;
    timestamp?: string | null;
    message?: string;
    evidence?: string[];
    actor?: string | null;
    parentEventId?: string | null;
    relatedRunId?: string | null;
    dependencyRunIds?: string[];
    toolId?: string | null;
    proofTransport?: string | null;
    classification?: string | null;
  }>;
  workflowGraph?: {
    graphStatus?: string;
    currentStage?: string | null;
    blockedStage?: string | null;
    stopReason?: string | null;
    stopClassification?: string | null;
    stageDurations?: Record<string, number>;
    timingBreakdown?: Record<string, {
      startedAt?: string | null;
      completedAt?: string | null;
      durationMs?: number | null;
      eventCount?: number;
    }>;
    nodeCount?: number;
    edgeCount?: number;
    nodes?: Array<{
      id?: string;
      kind?: "stage" | "agent" | "proof" | "event" | "tool" | "dependency" | "verification" | string;
      stage?: string;
      label?: string;
      status?: string;
      timestamp?: string | null;
      detail?: string;
      evidence?: string[];
    }>;
    edges?: Array<{
      id?: string;
      from?: string;
      to?: string;
      status?: string;
      detail?: string;
      relationship?: string | null;
    }>;
    events?: Array<{
      eventId?: string;
      runId?: string;
      taskId?: string;
      type?: string;
      stage?: string;
      state?: string;
      timestamp?: string | null;
      source?: string;
      actor?: string | null;
      nodeId?: string;
      detail?: string;
      evidence?: string[];
      parentEventId?: string | null;
      relatedRunId?: string | null;
      dependencyRunIds?: string[];
      toolId?: string | null;
      proofTransport?: string | null;
      classification?: string | null;
    }>;
    causalLinks?: Array<{
      id?: string;
      from?: string;
      to?: string;
      relationship?: string | null;
      detail?: string;
      classification?: string | null;
      lastObservedAt?: string | null;
      count?: number;
    }>;
    proofLinks?: Array<{
      id?: string;
      type?: string;
      status?: string;
      summary?: string;
      target?: string | null;
      lastAttemptAt?: string | null;
    }>;
  };
  proofLinks?: Array<{
    id?: string;
    type?: string;
    status?: string;
    summary?: string;
    target?: string | null;
    lastAttemptAt?: string | null;
  }>;
  history?: Array<{
    id?: string;
    type?: string;
    handledAt?: string;
    result?: string;
    message?: string;
  }>;
  repair?: {
    repairId: string;
    classification?: string | null;
    status?: string | null;
    trigger?: string | null;
    verificationMode?: string | null;
    verificationSummary?: string | null;
  } | null;
  result?: unknown;
}

export interface TaskRunsResponse {
  generatedAt: string;
  query: Record<string, unknown>;
  total: number;
  page: { returned: number; offset: number; limit: number; hasMore: boolean };
  runs: TaskRun[];
}

// ── Approvals ──
export interface PendingApprovalItem {
  taskId: string;
  type: string;
  payload?: Record<string, unknown>;
  requestedAt: string;
  status: string;
  impact?: {
    riskLevel?: string;
    approvalReason?: string;
    dependencyClass?: string;
    purpose?: string;
    operationalStatus?: string;
    affectedSurfaces?: string[];
    dependencyRequirements?: string[];
    caveats?: string[];
    replayBehavior?: string;
    internalOnly?: boolean;
    publicTriggerable?: boolean;
  };
  payloadPreview?: {
    keyCount?: number;
    keys?: string[];
    internalKeyCount?: number;
  };
}

export interface PendingApprovalsResponse {
  count: number;
  pending: PendingApprovalItem[];
}

export interface ApprovalDecisionResponse {
  status: "ok";
  approval: unknown;
  replayTaskId?: string;
}

export interface IncidentActionResponse {
  status: "ok";
  incident: RuntimeIncident;
}

export interface IncidentRemediationResponse extends IncidentActionResponse {
  remediationTask?: IncidentRemediationTaskRecord;
}

export interface IncidentsResponse {
  generatedAt: string;
  query: Record<string, unknown>;
  total: number;
  page: { returned: number; offset: number; limit: number; hasMore: boolean };
  incidents: RuntimeIncident[];
}

export interface IncidentDetailResponse {
  generatedAt: string;
  incident: RuntimeIncident;
}

// ── Agents ──
export interface AgentOverviewItem {
  id: string;
  name: string;
  description?: string;
  orchestratorTask?: string;
  modelTier?: string | null;
  allowedSkills?: string[];
  declared?: boolean;
  spawnedWorkerCapable?: boolean;
  workerValidationStatus?: string;
  serviceAvailable?: boolean;
  serviceInstalled?: boolean | null;
  serviceRunning?: boolean | null;
  serviceUnitState?: string | null;
  serviceUnitSubState?: string | null;
  serviceUnitFileState?: string | null;
  serviceImplementation?: string;
  serviceOperational?: boolean;
  dependencySensitivity?: string;
  frontendExposure?: string;
  runtimeProof?: {
    serviceHeartbeat?: {
      checkedAt?: string | null;
      status?: string | null;
      errorSummary?: string | null;
      source?: string | null;
      staleAgeMs?: number | null;
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
    distinctions?: {
      serviceAlive?: boolean;
      serviceHeartbeatHealthy?: boolean;
      serviceAvailable?: boolean;
      serviceInstalled?: boolean | null;
      workerInvocable?: boolean;
      taskObserved?: boolean;
      taskSucceeded?: boolean;
      toolExecutionProved?: boolean;
      verifierOrRepairEvidence?: boolean;
    };
  };
  memory?: Record<string, unknown>;
  notes?: string[];
  // Evidence fields from live runtime
  lastEvidenceAt?: string;
  evidenceSources?: string[];
  lastSuccessfulRunId?: string;
  lastSuccessfulTaskId?: string;
  capability?: {
    role?: string;
    spine?: "truth" | "execution" | "trust" | "communication" | "ingestion" | "code";
    currentReadiness?: "declared" | "foundation" | "operational" | "advanced";
    targetCapabilities?: string[];
    evidence?: string[];
    presentCapabilities?: string[];
    missingCapabilities?: string[];
    evidenceProfiles?: AgentCapabilityEvidenceProfile[];
    ultraGapSummary?: string;
  };
}

export interface AgentCapabilityEvidenceProfile {
  area: string;
  status: "strong" | "partial" | "missing";
  summary: string;
  evidence: string[];
  missing: string[];
}

export interface AgentsOverviewResponse {
  generatedAt: string;
  count: number;
  agents: AgentOverviewItem[];
  topology?: AgentTopology;
  relationshipHistory?: RelationshipHistory;
}

export interface TruthEvidenceItem {
  id: string;
  label: string;
  status: string;
  detail: string;
  route?: string | null;
  value?: string | number | boolean | null;
}

export interface TruthSignal {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
  relatedRoutes?: string[];
}

export interface RuntimeTruthLayers {
  claimed: {
    status: string;
    summary?: string;
    controlPlane?: string;
    privateOperatorSurface?: string;
    authoritativeHealthRoute?: string;
    aggregateOverviewRoute?: string;
    publicProofBoundary?: string;
    declaredAgents?: number;
    allowlistedTaskTypes?: number;
    approvalGatedTaskTypes?: string[];
    evidence?: TruthEvidenceItem[];
    signals?: TruthSignal[];
  };
  configured: {
    status: string;
    summary?: string;
    fastStartMode?: boolean;
    docsConfigured?: boolean;
    cookbookConfigured?: boolean;
    stateFileConfigured?: boolean;
    milestoneIngestConfigured?: boolean;
    milestoneFeedConfigured?: boolean;
    demandSummaryIngestConfigured?: boolean;
    signingSecretConfigured?: boolean;
    proofTransportsConfigured?: number;
    evidence?: TruthEvidenceItem[];
    signals?: TruthSignal[];
  };
  observed: {
    status: string;
    summary?: string;
    queue?: { queued?: number; processing?: number };
    approvals?: { pendingCount?: number };
    repairs?: {
      activeCount?: number;
      verifiedCount?: number;
      failedCount?: number;
      lastDetectedAt?: string | null;
    };
    retryRecoveries?: { count?: number; nextRetryAt?: string | null };
    recentTasks?: { count?: number; lastHandledAt?: string | null };
    persistenceStatus?: string;
    knowledgeIndexedEntries?: number;
    lastMilestoneDeliveryAt?: string | null;
    lastDemandSummaryDeliveryAt?: string | null;
    evidence?: TruthEvidenceItem[];
    signals?: TruthSignal[];
  };
  public: {
    status: string;
    summary?: string;
    boundary?: string;
    milestoneStatus?: string;
    demandSummaryStatus?: string;
    lastMilestoneDeliveryAt?: string | null;
    lastDemandSummaryDeliveryAt?: string | null;
    deadLetterCount?: number;
    evidence?: TruthEvidenceItem[];
    signals?: TruthSignal[];
  };
}

export interface ProofDelivery {
  boundary?: {
    surface?: string;
    model?: string;
  };
  signingSecretConfigured?: boolean;
  overallStatus?: string;
  milestone?: {
    latestMilestoneId?: string | null;
    deliveryStatus?: string;
    targetConfigured?: boolean;
    targetReady?: boolean;
    targetUrl?: string | null;
    feedConfigured?: boolean;
    feedReady?: boolean;
    feedPath?: string | null;
    gitPushEnabled?: boolean;
    lastDeliveredAt?: string | null;
    ledger?: {
      pendingCount?: number;
      retryingCount?: number;
      deadLetterCount?: number;
      deliveredCount?: number;
      duplicateCount?: number;
      rejectedCount?: number;
      lastAttemptAt?: string | null;
      lastDeliveredAt?: string | null;
      oldestPendingAt?: string | null;
      latestQueuedAt?: string | null;
      lastError?: string | null;
    };
  };
  demandSummary?: {
    latestSummaryId?: string | null;
    deliveryStatus?: string;
    targetConfigured?: boolean;
    targetReady?: boolean;
    targetUrl?: string | null;
    lastDeliveredAt?: string | null;
    ledger?: {
      pendingCount?: number;
      retryingCount?: number;
      deadLetterCount?: number;
      deliveredCount?: number;
      duplicateCount?: number;
      rejectedCount?: number;
      lastAttemptAt?: string | null;
      lastDeliveredAt?: string | null;
      oldestPendingAt?: string | null;
      latestQueuedAt?: string | null;
      lastError?: string | null;
    };
  };
}

export interface AgentTopologyNode {
  id: string;
  kind: "control-plane" | "task" | "agent" | "skill" | "surface";
  label: string;
  status: "declared" | "live" | "warning" | "degraded";
  detail: string;
  route?: string | null;
}

export interface AgentTopologyEdge {
  id: string;
  from: string;
  to: string;
  relationship:
    | "dispatches-task"
    | "routes-to-agent"
    | "uses-skill"
    | "publishes-proof"
    | "feeds-agent"
    | "verifies-agent"
    | "monitors-agent"
    | "audits-agent"
    | "coordinates-agent";
  status: "declared" | "live" | "warning" | "degraded";
  detail: string;
  evidence: string[];
  observedCount?: number;
  lastObservedAt?: string | null;
  sources?: string[];
}

export interface RelationshipHistoryBucket {
  bucketStart: string;
  total: number;
  byRelationship?: Partial<
    Record<
      AgentTopologyEdge["relationship"],
      number
    >
  >;
  byStatus?: Partial<Record<"observed" | "warning" | "degraded", number>>;
}

export interface RelationshipHistory {
  generatedAt: string;
  windowHours: number;
  totalObservations: number;
  lastObservedAt?: string | null;
  byRelationship?: Partial<
    Record<
      AgentTopologyEdge["relationship"],
      number
    >
  >;
  byStatus?: Partial<Record<"observed" | "warning" | "degraded", number>>;
  timeline?: RelationshipHistoryBucket[];
  recent?: Array<{
    observationId?: string;
    timestamp?: string | null;
    from?: string;
    to?: string;
    relationship?: AgentTopologyEdge["relationship"];
    status?: "observed" | "warning" | "degraded" | string;
    source?: string;
    taskId?: string | null;
    runId?: string | null;
    detail?: string;
    evidence?: string[];
  }>;
  windows?: {
    short?: {
      windowHours?: number;
      totalObservations?: number;
      lastObservedAt?: string | null;
      firstObservedAt?: string | null;
      byRelationship?: Partial<Record<AgentTopologyEdge["relationship"], number>>;
      byStatus?: Partial<Record<"observed" | "warning" | "degraded", number>>;
    };
    long?: {
      windowHours?: number;
      totalObservations?: number;
      lastObservedAt?: string | null;
      firstObservedAt?: string | null;
      byRelationship?: Partial<Record<AgentTopologyEdge["relationship"], number>>;
      byStatus?: Partial<Record<"observed" | "warning" | "degraded", number>>;
    };
  };
  graph?: {
    totalNodes?: number;
    totalEdges?: number;
    nodes?: Array<{
      id?: string;
      label?: string;
      kind?: "agent" | "task" | "skill" | "surface" | "run" | "tool" | "unknown" | string;
      count?: number;
      lastObservedAt?: string | null;
    }>;
    edges?: Array<{
      id?: string;
      from?: string;
      to?: string;
      relationship?: string;
      count?: number;
      lastObservedAt?: string | null;
      classification?: string | null;
    }>;
  };
}

export interface AgentTopology {
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
    observedEdges?: number;
    totalEdges: number;
  };
  hotspots: string[];
  relationshipHistory?: {
    totalObservations?: number;
    lastObservedAt?: string | null;
    byRelationship?: RelationshipHistory["byRelationship"];
    byStatus?: RelationshipHistory["byStatus"];
    timeline?: RelationshipHistoryBucket[];
    windows?: RelationshipHistory["windows"];
    graph?: RelationshipHistory["graph"];
  };
  nodes: AgentTopologyNode[];
  edges: AgentTopologyEdge[];
}

export interface RuntimeIncident {
  id: string;
  fingerprint?: string;
  title: string;
  classification:
    | "runtime-mode"
    | "persistence"
    | "proof-delivery"
    | "repair"
    | "retry-recovery"
    | "knowledge"
    | "service-runtime"
    | "approval-backlog";
  severity: "info" | "warning" | "critical";
  status: "active" | "watching" | "resolved";
  truthLayer: "configured" | "observed" | "public";
  summary: string;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  resolvedAt?: string | null;
  detectedAt: string | null;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  acknowledgementNote?: string | null;
  owner?: string | null;
  affectedSurfaces: string[];
  linkedServiceIds?: string[];
  linkedTaskIds?: string[];
  linkedRunIds?: string[];
  linkedRepairIds?: string[];
  linkedProofDeliveries?: string[];
  evidence: string[];
  recommendedSteps?: string[];
  policy?: {
    policyId?: string;
    preferredOwner?: string;
    autoAssignOwner?: boolean;
    autoRemediateOnCreate?: boolean;
    remediationTaskType?: string | null;
    verifierTaskType?: string | null;
    targetSlaMinutes?: number;
    escalationMinutes?: number;
  };
  escalation?: {
    level?: string;
    status?: string;
    dueAt?: string | null;
    escalateAt?: string | null;
    escalatedAt?: string | null;
    breachedAt?: string | null;
    summary?: string;
  };
  remediation: {
    owner: "auto" | "operator" | "mixed";
    status: "ready" | "in-progress" | "blocked" | "watching" | "resolved";
    summary: string;
    nextAction: string;
    blockers: string[];
  };
  remediationPlan?: Array<{
    stepId?: string;
    title?: string;
    kind?: string;
    owner?: string;
    status?: string;
    description?: string;
    taskType?: string | null;
    dependsOn?: string[];
    startedAt?: string | null;
    completedAt?: string | null;
    evidence?: string[];
  }>;
  verification?: {
    required?: boolean;
    agentId?: string | null;
    status?: string;
    summary?: string;
    verificationTaskId?: string | null;
    verificationRunId?: string | null;
    verifiedAt?: string | null;
  };
  history?: IncidentHistoryEvent[];
  acknowledgements?: IncidentAcknowledgementRecord[];
  ownershipHistory?: IncidentOwnershipRecord[];
  remediationTasks?: IncidentRemediationTaskRecord[];
}

export interface IncidentHistoryEvent {
  eventId?: string;
  timestamp?: string | null;
  type?: string;
  actor?: string | null;
  summary?: string;
  detail?: string;
  evidence?: string[];
}

export interface IncidentAcknowledgementRecord {
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  note?: string | null;
}

export interface IncidentOwnershipRecord {
  actor?: string | null;
  owner?: string | null;
  assignedAt?: string | null;
  note?: string | null;
}

export interface IncidentRemediationTaskRecord {
  remediationId?: string;
  createdAt?: string | null;
  createdBy?: string | null;
  assignedTo?: string | null;
  assignedAt?: string | null;
  taskType?: string;
  taskId?: string;
  runId?: string;
  status?: string;
  reason?: string;
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

export interface RuntimeIncidentModel {
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
}

// ── Skills / Governance ──
export interface SkillsPolicyResponse {
  generatedAt: string;
  policy: {
    totalCount: number;
    pendingReviewCount: number;
    approvedCount: number;
    restartSafeCount: number;
    restartSafeApprovedCount: number;
    metadataOnlyCount: number;
    metadataOnlyApprovedCount: number;
  };
}

export interface SkillRegistryItem {
  skillId: string;
  name: string;
  description?: string;
  trustStatus?: string;
  intakeSource?: string;
  persistenceMode?: string;
  auditedAt?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewedNote?: string;
}

export interface SkillsRegistryResponse {
  generatedAt: string;
  total: number;
  skills: SkillRegistryItem[];
}

export interface SkillsTelemetryResponse {
  generatedAt: string;
  telemetry: {
    totalInvocations: number;
    allowedCount: number;
    deniedCount: number;
  };
}

// ── Knowledge ──
export interface KnowledgeSummary {
  lastUpdated?: string;
  stats?: Record<string, unknown>;
  networkStats?: Record<string, unknown>;
  topIssues?: unknown[];
  recentLearnings?: unknown[];
  diagnostics?: {
    freshness?: {
      status?: string;
      staleAfterHours?: number;
      latestEntryUpdatedAt?: string | null;
      oldestEntryUpdatedAt?: string | null;
      staleEntries?: number;
      freshEntries?: number;
      ageHours?: number | null;
    };
    provenance?: {
      totalEntries?: number;
      unknownProvenanceCount?: number;
      bySourceType?: Record<string, number>;
      bySourceModel?: Record<string, number>;
      derivedFrom?: Record<string, number>;
    };
    contradictionSignals?: Array<{
      id?: string;
      title?: string;
      severity?: string;
      kinds?: string[];
      message?: string;
      entryIds?: string[];
    }>;
    graphs?: KnowledgeGraphs;
  };
  runtime?: {
    index?: {
      indexedDocs?: number;
      docIndexVersion?: number;
      docsConfigured?: boolean;
      cookbookConfigured?: boolean;
    };
    coverage?: {
      entryCount?: number;
      indexedDocCount?: number;
      entryToDocRatio?: number | null;
    };
    freshness?: {
      status?: string;
      lastUpdated?: string | null;
      latestEntryUpdatedAt?: string | null;
      lastDriftRepairAt?: string | null;
      stateUpdatedAt?: string | null;
      staleAfterHours?: number | null;
    };
    signals?: {
      coverage?: Array<{ id?: string; severity?: string; message?: string }>;
      staleness?: Array<{ id?: string; severity?: string; message?: string }>;
      repair?: Array<{ id?: string; severity?: string; message?: string }>;
      contradictions?: Array<{
        id?: string;
        title?: string;
        severity?: string;
        kinds?: string[];
        message?: string;
        entryIds?: string[];
      }>;
    };
    graphs?: KnowledgeGraphs;
    repairLoop?: {
      status?: string;
      recommendedTaskType?: string;
      contradictionCount?: number;
      contradictionEntryIds?: string[];
      unknownProvenanceCount?: number;
      freshnessStatus?: string;
      openKnowledgeIncidents?: number;
      focusAreas?: string[];
      nextActions?: string[];
      lastDriftRepairAt?: string | null;
    };
  };
}

export interface KnowledgeGraphs {
  provenance?: {
    generatedAt?: string;
    totalNodes?: number;
    totalEdges?: number;
    hotspots?: string[];
    nodes?: Array<{
      id?: string;
      label?: string;
      kind?: "source-type" | "source-model" | "derivation" | "entry" | string;
      count?: number;
      status?: "known" | "unknown" | string;
    }>;
    edges?: Array<{
      id?: string;
      from?: string;
      to?: string;
      weight?: number;
      label?: string;
    }>;
  };
  contradictions?: {
    generatedAt?: string;
    contradictionCount?: number;
    hotspots?: string[];
    nodes?: Array<{
      id?: string;
      label?: string;
      kind?: "contradiction" | "entry" | string;
      severity?: string;
    }>;
    edges?: Array<{
      id?: string;
      from?: string;
      to?: string;
      kind?: string;
    }>;
  };
  freshness?: {
    generatedAt?: string;
    score?: number;
    status?: string;
    hotspots?: string[];
    bands?: Record<string, number>;
    nodes?: Array<{
      id?: string;
      label?: string;
      kind?: "band" | "entry" | string;
      band?: string;
      ageHours?: number | null;
      count?: number;
    }>;
    edges?: Array<{
      id?: string;
      from?: string;
      to?: string;
      kind?: string;
    }>;
  };
}

// ── Skills Audit ──
export interface SkillsAuditRecord {
  skillId: string;
  action: string;
  result: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface SkillsAuditResponse {
  generatedAt: string;
  query: Record<string, unknown>;
  total: number;
  page: { returned: number; offset: number; limit: number; hasMore: boolean };
  records: SkillsAuditRecord[];
}

// ── Memory Recall ──
export interface MemoryRecallResponse {
  generatedAt: string;
  query?: {
    agentId?: string | null;
    limit?: number;
    offset?: number;
    includeErrors?: boolean;
    includeSensitive?: boolean;
  };
  totalAgents?: number;
  totalRuns?: number;
  page?: {
    returned?: number;
    offset?: number;
    limit?: number;
    hasMore?: boolean;
  };
  items: Array<Record<string, unknown>>;
}

// ── Knowledge Query ──
export interface KnowledgeQueryRequest {
  query: string;
  limit?: number;
  filter?: Record<string, unknown>;
}

export interface KnowledgeQueryResponse {
  success: boolean;
  results: unknown[];
  sources?: string[];
  meta?: {
    matchedEntries?: number;
    freshness?: {
      status?: string;
      staleAfterHours?: number;
      latestEntryUpdatedAt?: string | null;
    };
    provenance?: {
      totalEntries?: number;
      unknownProvenanceCount?: number;
      bySourceType?: Record<string, number>;
    };
    contradictionSignals?: Array<{
      id?: string;
      title?: string;
      severity?: string;
      kinds?: string[];
      message?: string;
      entryIds?: string[];
    }>;
    repairLoop?: {
      status?: string;
      recommendedTaskType?: string;
      contradictionCount?: number;
      contradictionEntryIds?: string[];
      unknownProvenanceCount?: number;
      freshnessStatus?: string;
      focusAreas?: string[];
      nextActions?: string[];
    };
    graphs?: KnowledgeGraphs;
  };
  runtime?: KnowledgeSummary["runtime"];
}

// ── Public Proof / Command Center ──

export type MilestoneEvidenceType =
  | "doc" | "commit" | "issue" | "pr" | "runbook" | "metric" | "log";

export type MilestoneRiskStatus =
  | "on-track" | "at-risk" | "blocked" | "completed";

export type MilestoneSource =
  | "orchestrator" | "agent" | "operator";

export interface MilestoneEvidence {
  type: MilestoneEvidenceType;
  path: string;
  summary: string;
  ref?: string;
}

export interface MilestoneEvent {
  milestoneId: string;
  timestampUtc: string;
  scope: string;
  claim: string;
  evidence: MilestoneEvidence[];
  riskStatus: MilestoneRiskStatus;
  nextAction: string;
  source?: MilestoneSource;
}

export interface MilestoneFeedResponse {
  ok: true;
  items: MilestoneEvent[];
}

export type ProofNodeId =
  | "emit" | "verify" | "store" | "canon" | "broadcast" | "surface";

export type ProofNodeState =
  | "live" | "warning" | "idle";

export interface ProofNode {
  id: ProofNodeId;
  label: string;
  state: ProofNodeState;
  detail: string;
}

export interface CommandCenterOverviewResponse {
  ok: true;
  latest: MilestoneEvent | null;
  stale: boolean;
  visibleFeedCount: number;
  evidenceCount: number;
  activeLaneCount: number;
  activeLanes: string[];
  riskCounts: {
    onTrack: number;
    atRisk: number;
    blocked: number;
    completed: number;
  };
  deadLetterCount: number;
  lastPollAt: string | null;
  realtimeChannel: string;
  proofNodes: ProofNode[];
}

export type EngineTier =
  | "cheap" | "balanced" | "heavy" | "strategic" | "service-native";

export type NetworkMode =
  | "local" | "allowlisted" | "service-native";

export type ApprovalClass =
  | "approval-gated" | "bounded" | "service-native";

export interface CommandCenterEngine {
  id: string;
  name: string;
  task: string;
  model: string;
  tier: EngineTier;
  allowedSkills: string[];
  networkMode: NetworkMode;
  timeoutLabel: string;
  approvalClass: ApprovalClass;
}

export interface CommandCenterCluster {
  id: string;
  label: string;
  engines: CommandCenterEngine[];
}

export interface CommandCenterControlResponse {
  ok: true;
  clusters: CommandCenterCluster[];
}

export type DemandSegmentState =
  | "hot" | "warm" | "idle";

export interface CommandCenterDemandSegment {
  id: string;
  label: string;
  clusterLabels: string[];
  staticWeight: number;
  liveSignalCount: number;
  state: DemandSegmentState;
}

export type DemandSummarySource =
  | "live" | "stale" | "fallback";

export interface CommandCenterDemandSummary {
  totalSegments: number;
  hotSegments: number;
  demandNarrative: string;
  topSegmentLabel: string | null;
  topPillarLabel: string | null;
  stale: boolean;
  source: DemandSummarySource;
  snapshotGeneratedAt: string | null;
  queueTotal: number;
  draftTotal: number;
  selectedForDraftTotal: number;
}

export interface CommandCenterDemandResponse {
  ok: true;
  segments: CommandCenterDemandSegment[];
  summary: CommandCenterDemandSummary;
}

// ── Dead Letter Milestones ──
export interface MilestoneDeadLetterResponse {
  ok: true;
  items: MilestoneEvent[];
}

// Legacy compat aliases
export type HealthStatus = "healthy" | "degraded" | "down";
export type ApprovalDecision = "approved" | "rejected";
