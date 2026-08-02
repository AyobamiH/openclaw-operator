export const GRAPH_RUN_STATUSES = [
  "created",
  "running",
  "waiting",
  "waiting_for_approval",
  "paused",
  "blocked",
  "compensating",
  "completed",
  "failed",
  "cancelled",
] as const;

export type GraphRunStatus = (typeof GRAPH_RUN_STATUSES)[number];

export const NODE_OUTCOMES = [
  "succeeded",
  "failed_retryable",
  "failed_repairable",
  "failed_terminal",
  "needs_replan",
  "needs_approval",
  "blocked",
  "timed_out",
  "cancelled",
  "compensated",
] as const;

export type NodeOutcome = (typeof NODE_OUTCOMES)[number];

export const NODE_TYPES = [
  "deterministic",
  "llm",
  "tool",
  "connector",
  "verification",
  "approval",
  "human_input",
  "router",
  "subgraph",
  "checkpoint",
  "wait",
  "compensation",
  "terminal",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const AUTHORITY_CLASSES = [
  "read_only",
  "local_reversible",
  "local_persistent",
  "external_reversible",
  "external_public",
  "credential_sensitive",
  "financial",
  "legal",
  "destructive",
  "irreversible",
] as const;

export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number];

export const FAILURE_CATEGORIES = [
  "validation_error",
  "missing_dependency",
  "authority_denied",
  "approval_required",
  "tool_unavailable",
  "tool_contract_error",
  "provider_rate_limited",
  "provider_auth_error",
  "provider_not_found",
  "provider_rejected",
  "network_transient",
  "timeout",
  "verification_failed",
  "no_progress",
  "budget_exhausted",
  "state_conflict",
  "idempotency_conflict",
  "invariant_violation",
  "unsafe_operation",
  "human_input_required",
  "unknown",
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export type SideEffectState =
  | "not_requested"
  | "request_prepared"
  | "request_sent"
  | "provider_accepted"
  | "effect_observed"
  | "effect_verified"
  | "confirmed_absent"
  | "ambiguous"
  | "compensated";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface GraphBudgetPolicy {
  maxNodeAttempts: number;
  maxTransitions: number;
  maxLoopIterations: number;
  wallClockMs: number;
  tokenBudget?: number;
  toolCallBudget?: number;
  externalRequestBudget?: number;
  costBudgetUsd?: number;
  repeatedErrorThreshold: number;
  noProgressThreshold: number;
}

export interface GraphBudgetState extends GraphBudgetPolicy {
  nodeAttempts: number;
  transitions: number;
  loopIterations: number;
  tokensConsumed: number;
  toolCallsConsumed: number;
  externalRequestsConsumed: number;
  costConsumedUsd: number;
}

export type GuardOperator =
  | "eq"
  | "neq"
  | "exists"
  | "not_exists"
  | "in"
  | "lt"
  | "lte"
  | "gt"
  | "gte";

export interface EdgeGuard {
  path: string;
  operator: GuardOperator;
  value?: JsonValue;
}

export interface GraphEdgeDefinition {
  from: string;
  to: string;
  on: NodeOutcome;
  guards?: EdgeGuard[];
  priority?: number;
  loopId?: string;
}

export interface GraphNodeDefinition {
  id: string;
  type: NodeType;
  handler: string;
  purpose: string;
  inputProjection: string[];
  outputContract: string;
  permittedStateMutations: string[];
  requiredCapabilities: string[];
  sideEffectClass: AuthorityClass;
  authority: AuthorityClass;
  timeoutMs: number;
  retryEligible: boolean;
  maxAttempts: number;
  idempotencyStrategy: "run_node_payload" | "external_operation" | "none";
  evidenceEmitted: string[];
  errorTaxonomy: FailureCategory[];
  possibleOutcomes: NodeOutcome[];
  loopId?: string;
  subgraphId?: string;
  subgraphVersion?: string;
}

export interface CompletionAssertionDefinition {
  assertionId: string;
  claim: string;
  method: string;
  requiredEvidenceKinds: string[];
}

export interface GraphDefinition {
  graphId: string;
  version: string;
  description: string;
  inputSchema: Record<string, JsonValue>;
  stateSchema: Record<string, JsonValue>;
  nodes: GraphNodeDefinition[];
  edges: GraphEdgeDefinition[];
  entryNodeId: string;
  terminalNodeIds: string[];
  timeoutPolicy: { wallClockMs: number; nodeDefaultMs: number };
  retryPolicy: { defaultMaxAttempts: number; retryableFailures: FailureCategory[] };
  loopBudgets: GraphBudgetPolicy;
  authorityRequirements: { maximum: AuthorityClass; approvalsRequiredAtOrAbove: AuthorityClass };
  evidenceRequirements: CompletionAssertionDefinition[];
  compensation: { strategy: "none" | "node"; nodeId?: string };
  concurrency: { maxRuns: number; resourceKeys: string[]; leaseMs: number; priority: number };
  ownership: { owner: string; repository: string; runtime: string };
  migrationCompatibility: { replaces: string[]; compatibleFromVersions: string[] };
}

export interface AuthorityEnvelope {
  maximum: AuthorityClass;
  grantedBy: string;
  grantedAt: string;
  expiresAt?: string;
}

export interface EvidenceReference {
  evidenceId: string;
  kind: string;
  uri: string;
  sha256?: string;
  summary: string;
  createdAt: string;
  checker?: string;
}

export interface VerificationAssertion {
  assertionId: string;
  claim: string;
  method: string;
  status: "passed" | "failed" | "unknown";
  evidenceRefs: string[];
  checkedAt: string;
  checker: string;
}

export interface ExternalEffectRecord {
  effectId: string;
  runId: string;
  nodeId: string;
  idempotencyKey: string;
  operationType: string;
  target: string;
  payloadHash: string;
  state: SideEffectState;
  providerOperationId?: string;
  lastObservedAt?: string;
  evidenceRefs: string[];
}

export const ONE_RUN_LIVE_CAPABILITY_STATUSES = [
  "prepared",
  "active",
  "consumed",
  "revoked",
  "expired",
  "blocked",
] as const;

export type OneRunLiveCapabilityStatus = (typeof ONE_RUN_LIVE_CAPABILITY_STATUSES)[number];

export type OneRunLiveCapability = {
  capabilityId: string;
  status: OneRunLiveCapabilityStatus;
  graphId: string;
  graphVersion: string;
  graphDefinitionHash: string;
  graphRunId: string;
  claimId: string;
  approvalId: string;
  provider: string;
  accountId: string;
  operationType: string;
  candidateId: string;
  campaignId: string;
  sequenceId: string;
  slotId: string;
  payloadHash: string;
  mediaHash?: string;
  envelopeHash: string;
  idempotencyKeyFingerprint: string;
  maximumMutatingDispatches: number;
  maximumSuccessfulPublications: number;
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
  issuedBy: string;
  consumedAt?: string;
  revokedAt?: string;
  failureReason?: string;
};

export type LiveCapabilityDispatchState =
  | "prepared"
  | "reserved"
  | "succeeded"
  | "confirmed_absent"
  | "ambiguous"
  | "failed";

export type LiveCapabilityDispatch = {
  dispatchId: string;
  capabilityId: string;
  stepIndex: number;
  stepId: string;
  expectedOperation: string;
  predecessorStepId?: string;
  maximumDispatchCount: 1;
  dispatchCount: number;
  state: LiveCapabilityDispatchState;
  reservedAt?: string;
  completedAt?: string;
  providerOperationId?: string;
  failureReason?: string;
};

export interface GraphCheckpoint {
  checkpointId: string;
  runId: string;
  nodeId: string | null;
  reason: string;
  stateHash: string;
  createdAt: string;
}

export interface GraphRunState {
  runId: string;
  graphId: string;
  graphVersion: string;
  parentRunId: string | null;
  correlationId: string;
  objective: string;
  status: GraphRunStatus;
  currentNodeId: string | null;
  input: Record<string, JsonValue>;
  data: Record<string, JsonValue>;
  planVersion: number;
  authority: AuthorityEnvelope;
  budgets: GraphBudgetState;
  evidence: EvidenceReference[];
  assertions: VerificationAssertion[];
  externalEffects: ExternalEffectRecord[];
  checkpoints: GraphCheckpoint[];
  terminalOutcome: string | null;
  lastError: GraphFailure | null;
  lastProgressFingerprint: string | null;
  repeatedFingerprintCount: number;
  lastProgressAt: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface GraphFailure {
  category: FailureCategory;
  message: string;
  retryable: boolean;
  repairable: boolean;
  replanWorthy: boolean;
  approvalDependent: boolean;
  terminal: boolean;
  compensatable: boolean;
  details?: Record<string, JsonValue>;
}

export interface StatePatchOperation {
  op: "set" | "append" | "increment";
  path: string;
  value: JsonValue;
}

export interface NodeExecutionResult {
  outcome: NodeOutcome;
  output: Record<string, JsonValue>;
  patches?: StatePatchOperation[];
  evidence?: Omit<EvidenceReference, "evidenceId" | "createdAt">[];
  assertions?: Omit<VerificationAssertion, "checkedAt">[];
  failure?: GraphFailure;
  externalEffect?: Omit<ExternalEffectRecord, "effectId" | "runId" | "nodeId" | "evidenceRefs"> & {
    evidenceRefs?: string[];
  };
  progressFingerprint?: string;
  waitUntil?: string;
}

export interface NodeExecutionContext {
  definition: GraphDefinition;
  node: GraphNodeDefinition;
  run: GraphRunState;
  attemptId: string;
  attemptNumber: number;
  idempotencyKey: string;
  effectPayloadHash: string;
  approval?: {
    approvalId: string;
    payloadHash: string;
    expiresAt: string;
    approver: string;
  };
  liveCapability?: {
    capabilityId: string;
    envelopeHash: string;
  };
  signal: AbortSignal;
}

export type NodeExecutor = (context: NodeExecutionContext) => Promise<NodeExecutionResult>;

export interface GraphEvent {
  eventId: string;
  runId: string;
  sequence: number;
  timestamp: string;
  type: string;
  nodeId: string | null;
  attemptNumber: number | null;
  actor: string;
  payload: Record<string, JsonValue>;
  causationId: string | null;
  correlationId: string;
  previousHash: string | null;
  eventHash: string;
}
