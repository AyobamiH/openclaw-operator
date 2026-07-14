export type BusinessValueConfidence = "verified" | "estimated" | "unknown";

export type BusinessOutcome =
  | "qualified-leads"
  | "paying-clients"
  | "increased-revenue"
  | "recurring-revenue"
  | "faster-delivery"
  | "customer-satisfaction"
  | "search-visibility"
  | "community-value"
  | "commercial-readiness"
  | "product-quality"
  | "risk-reduction"
  | "manual-work-reduction"
  | "reusable-ip"
  | "operational-efficiency";

export interface BusinessMission {
  businessId: string;
  businessName: string;
  mission: string;
  supportedOutcomes: BusinessOutcome[];
  runtimeAuthority: string;
  approvalBoundarySummary: string;
}

export interface BusinessKpiDefinition {
  id: string;
  label: string;
  outcome: BusinessOutcome;
  measurement: string;
  confidence: BusinessValueConfidence;
}

export interface BusinessKpiSnapshot {
  kpiId: string;
  value: string | number | null;
  capturedAt: string;
  confidence: BusinessValueConfidence;
  source: string;
  notes?: string;
}

export type ProjectStatus =
  | "active"
  | "paused"
  | "blocked"
  | "marketable"
  | "commercially-ready"
  | "unknown";

export interface BusinessRepository {
  id: string;
  path: string;
  remote?: string | null;
  branch?: string | null;
  evidence: string[];
}

export interface CommercialReadinessCriterion {
  id: string;
  label: string;
  status: "met" | "missing" | "unknown";
  evidence: string[];
}

export interface BusinessProject {
  id: string;
  name: string;
  status: ProjectStatus;
  repositories: BusinessRepository[];
  commercialOutcome: string;
  targetCustomer: string | null;
  relevantKpis: string[];
  acceptanceCriteria: CommercialReadinessCriterion[];
  currentBlockers: string[];
  knownRisks: string[];
  approvalBoundaries: string[];
  evidenceLocations: string[];
  nextSafeAction: string | null;
}

export interface BusinessRegistry {
  businessId: string;
  businessName: string;
  mission: string;
  registryVersion: string;
  updatedAt: string;
  sourcePath: string;
  kpis: BusinessKpiDefinition[];
  kpiSnapshots: BusinessKpiSnapshot[];
  projects: BusinessProject[];
}

export type ApprovalClassification =
  | "safe-autonomous"
  | "approval-required"
  | "unsupported"
  | "blocked";

export interface VerificationRequirement {
  method: "deterministic" | "worker" | "manual-approval" | "unsupported";
  description: string;
  expectedEvidence: string[];
}

export interface BusinessValueScoreComponents {
  expectedBusinessImpact: number;
  confidence: number;
  urgency: number;
  effort: number;
  operationalRisk: number;
  dependencyLoad: number;
  commercialReadinessImpact: number;
  reversibility: number;
  approvalFriction: number;
  evidenceQuality: number;
}

export interface PriorityScore {
  value: number;
  formula: string;
  components: BusinessValueScoreComponents;
  rationale: string[];
}

export type CandidateKind =
  | "project"
  | "lead"
  | "content"
  | "marketing"
  | "operational-improvement"
  | "risk"
  | "approval"
  | "unsupported";

export interface CandidateWorkItem {
  id: string;
  kind: CandidateKind;
  title: string;
  businessId: string;
  projectId?: string | null;
  businessFunction?: string | null;
  objective: string;
  expectedOutcome: BusinessOutcome;
  kpiId: string;
  evidence: string[];
  taskType: string | null;
  taskPayload: Record<string, unknown>;
  approval: ApprovalClassification;
  approvalReason?: string | null;
  verification: VerificationRequirement;
  dependencies: string[];
  acceptanceCriteria: string[];
  risk: string;
  effort: "low" | "medium" | "high";
  opportunity?: {
    type: "lead" | "content" | "marketing" | "community" | "operations" | "product";
    description: string;
  };
  score?: PriorityScore;
}

export interface TaskTraceabilityMetadata {
  businessId: string;
  projectId?: string | null;
  businessFunction?: string | null;
  businessObjective: string;
  expectedBusinessOutcome: BusinessOutcome;
  kpiId: string;
  kpiBaseline?: string | number | null;
  expectedKpiEffect: string;
  candidateEvidence: string[];
  score: number;
  scoreComponents: BusinessValueScoreComponents;
  urgency: number;
  effort: number;
  risk: number;
  dependencies: string[];
  acceptanceCriteria: string[];
  verificationMethod: VerificationRequirement;
  evidencePath: string;
  approvalClassification: ApprovalClassification;
  originatingCycleId: string;
  parentCandidateId: string;
  selectedWorkerOrCapability: string;
  completionOutcome?: string | null;
}

export interface BlockedBusinessTask {
  candidateId: string;
  title: string;
  reason: string;
  approval: ApprovalClassification;
  evidence: string[];
}

export interface CycleEvidence {
  path: string;
  summary: string;
  createdAt: string;
}

export interface NextSelectedTask {
  candidateId: string;
  taskType: string;
  taskId?: string | null;
  idempotencyKey: string;
  title: string;
  score: number;
  evidence: string[];
  worker: string | null;
  model: string | null;
  executionStatus: "queued" | "running" | "success" | "failed" | "retrying" | "unknown";
  verificationStatus: VerificationStatus;
}

export type BusinessValueSchedulerMode = "enabled" | "paused" | "disabled";

export type BusinessValueTriggerSource =
  | "operator"
  | "scheduler"
  | "startup-recovery"
  | "retry";

export interface BusinessValueSchedulerState {
  mode: BusinessValueSchedulerMode;
  cadenceMinutes: number;
  lastTriggeredAt: string | null;
  lastTriggerSource: BusinessValueTriggerSource | null;
  lastTriggerReason: string | null;
  nextRunAt: string | null;
  lastProgressAt: string | null;
  consecutiveFailures: number;
  backoffUntil: string | null;
  activeTaskId: string | null;
  activeTaskEnqueuedAt: string | null;
  lastChangeFingerprint: string | null;
  lastSkippedAt: string | null;
  lastSkipReason: string | null;
}

export type VerificationStatus =
  | "passed"
  | "failed"
  | "skipped"
  | "not-verified"
  | "approval-required"
  | "unsupported"
  | "interrupted";

export interface BusinessValueCycle {
  cycleId: string;
  triggerSource: BusinessValueTriggerSource | "unknown";
  triggerReason: string;
  status: "active" | "completed" | "failed" | "blocked" | "idle";
  startedAt: string;
  completedAt?: string | null;
  missionLoaded: boolean;
  registrySource: string;
  candidates: CandidateWorkItem[];
  selectedTask?: NextSelectedTask | null;
  approvalGatedCandidates: BlockedBusinessTask[];
  unsupportedCandidates: BlockedBusinessTask[];
  verificationStatus: VerificationStatus;
  evidence: CycleEvidence[];
  nextSafeAction?: string | null;
  failureReason?: string | null;
}

export interface BusinessValueCycleResult {
  cycle: BusinessValueCycle;
  registry: BusinessRegistry;
  mission: BusinessMission;
}

export interface BusinessValueState {
  registry: BusinessRegistry | null;
  cycles: BusinessValueCycle[];
  candidates: CandidateWorkItem[];
  approvalGatedCandidates: BlockedBusinessTask[];
  unsupportedCandidates: BlockedBusinessTask[];
  lastSuccessfulCycleId: string | null;
  lastFailedCycleId: string | null;
  activeCycleId: string | null;
  nextSelectedTask: NextSelectedTask | null;
  lastRunAt: string | null;
  scheduler: BusinessValueSchedulerState;
}
