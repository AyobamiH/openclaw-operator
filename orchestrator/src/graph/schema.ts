import { z } from "zod";
import {
  AUTHORITY_CLASSES,
  FAILURE_CATEGORIES,
  GRAPH_RUN_STATUSES,
  NODE_OUTCOMES,
  NODE_TYPES,
  type GraphDefinition,
} from "./types.js";

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

const identifier = z.string().regex(/^[a-z][a-z0-9._-]{1,119}$/);
const authority = z.enum(AUTHORITY_CLASSES);
const outcome = z.enum(NODE_OUTCOMES);
const graphApprovalId = z.string().regex(/^gap_(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/);

export const GraphDefinitionSchema = z.object({
  graphId: identifier,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1).max(2000),
  inputSchema: z.record(JsonValueSchema),
  stateSchema: z.record(JsonValueSchema),
  nodes: z.array(z.object({
    id: identifier,
    type: z.enum(NODE_TYPES),
    handler: identifier,
    purpose: z.string().min(1).max(1000),
    inputProjection: z.array(z.string().min(1).max(240)).max(100),
    outputContract: z.string().min(1).max(240),
    permittedStateMutations: z.array(z.string().min(1).max(240)).max(100),
    requiredCapabilities: z.array(identifier).max(100),
    sideEffectClass: authority,
    authority,
    timeoutMs: z.number().int().min(1).max(24 * 60 * 60 * 1000),
    retryEligible: z.boolean(),
    maxAttempts: z.number().int().min(1).max(100),
    idempotencyStrategy: z.enum(["run_node_payload", "external_operation", "none"]),
    evidenceEmitted: z.array(identifier).max(100),
    errorTaxonomy: z.array(z.enum(FAILURE_CATEGORIES)).min(1),
    possibleOutcomes: z.array(outcome).min(1),
    loopId: identifier.optional(),
    subgraphId: identifier.optional(),
    subgraphVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  })).min(1).max(500),
  edges: z.array(z.object({
    from: identifier,
    to: identifier,
    on: outcome,
    guards: z.array(z.object({
      path: z.string().min(1).max(240),
      operator: z.enum(["eq", "neq", "exists", "not_exists", "in", "lt", "lte", "gt", "gte"]),
      value: JsonValueSchema.optional(),
    })).max(20).optional(),
    priority: z.number().int().min(-1000).max(1000).optional(),
    loopId: identifier.optional(),
  })).max(2000),
  entryNodeId: identifier,
  terminalNodeIds: z.array(identifier).min(1),
  timeoutPolicy: z.object({
    wallClockMs: z.number().int().min(1),
    nodeDefaultMs: z.number().int().min(1),
  }),
  retryPolicy: z.object({
    defaultMaxAttempts: z.number().int().min(1).max(100),
    retryableFailures: z.array(z.enum(FAILURE_CATEGORIES)),
  }),
  loopBudgets: z.object({
    maxNodeAttempts: z.number().int().min(1),
    maxTransitions: z.number().int().min(1),
    maxLoopIterations: z.number().int().min(0),
    wallClockMs: z.number().int().min(1),
    tokenBudget: z.number().int().min(0).optional(),
    toolCallBudget: z.number().int().min(0).optional(),
    externalRequestBudget: z.number().int().min(0).optional(),
    costBudgetUsd: z.number().min(0).optional(),
    repeatedErrorThreshold: z.number().int().min(1),
    noProgressThreshold: z.number().int().min(1),
  }),
  authorityRequirements: z.object({
    maximum: authority,
    approvalsRequiredAtOrAbove: authority,
  }),
  evidenceRequirements: z.array(z.object({
    assertionId: identifier,
    claim: z.string().min(1).max(2000),
    method: identifier,
    requiredEvidenceKinds: z.array(identifier).min(1),
  })),
  compensation: z.object({
    strategy: z.enum(["none", "node"]),
    nodeId: identifier.optional(),
  }),
  concurrency: z.object({
    maxRuns: z.number().int().min(1).max(1000),
    resourceKeys: z.array(z.string().min(1).max(240)).max(100),
    leaseMs: z.number().int().min(1000),
    priority: z.number().int().min(-1000).max(1000),
  }),
  ownership: z.object({
    owner: z.string().min(1).max(240),
    repository: z.string().min(1).max(500),
    runtime: z.string().min(1).max(500),
  }),
  migrationCompatibility: z.object({
    replaces: z.array(z.string().min(1).max(240)),
    compatibleFromVersions: z.array(z.string().regex(/^\d+\.\d+\.\d+$/)),
  }),
}).strict();

export const StartGraphRunSchema = z.object({
  graphId: identifier,
  version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  objective: z.string().min(1).max(10_000),
  input: z.record(JsonValueSchema).default({}),
  correlationId: z.string().min(1).max(255).optional(),
  parentRunId: z.string().min(1).max(255).optional(),
  authority: z.object({
    maximum: authority,
    grantedBy: z.string().min(1).max(240),
    expiresAt: z.string().datetime().optional(),
  }),
});

export const GraphRunIdParamsSchema = z.object({ runId: z.string().min(1).max(255) });

export const GraphApprovalDecisionSchema = z.object({
  decision: z.enum(["granted", "denied"]),
  action: z.string().min(1).max(500),
  target: z.string().min(1).max(1000),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.string().datetime(),
  note: z.string().max(2000).optional(),
});

export const IssueOneRunLiveCapabilitySchema = z.object({
  approvalId: graphApprovalId,
  notBefore: z.string().datetime().optional(),
  expiresAt: z.string().datetime(),
}).strict();

export const RevokeOneRunLiveCapabilitySchema = z.object({
  reason: z.string().min(1).max(1000),
}).strict();

export const GraphReconcileEffectSchema = z.object({
  effectId: z.string().min(1).max(255),
  observedState: z.enum([
    "effect_observed",
    "effect_verified",
    "confirmed_absent",
    "ambiguous",
    "compensated",
  ]),
  providerOperationId: z.string().max(500).optional(),
  evidenceRefs: z.array(z.string().min(1).max(500)).min(1).max(50),
});

export const GraphRunListQuerySchema = z.object({
  status: z.enum(GRAPH_RUN_STATUSES).optional(),
  graphId: identifier.optional(),
  limit: z.coerce.number().int().min(1).max(250).default(50),
});

const GraphFailureSchema = z.object({
  category: z.enum(FAILURE_CATEGORIES),
  message: z.string().min(1),
  retryable: z.boolean(),
  repairable: z.boolean(),
  replanWorthy: z.boolean(),
  approvalDependent: z.boolean(),
  terminal: z.boolean(),
  compensatable: z.boolean(),
  details: z.record(JsonValueSchema).optional(),
}).strict();

export const NodeExecutionResultSchema = z.object({
  outcome,
  output: z.record(JsonValueSchema),
  patches: z.array(z.object({
    op: z.enum(["set", "append", "increment"]),
    path: z.string().min(1).max(240),
    value: JsonValueSchema,
  }).strict()).optional(),
  evidence: z.array(z.object({
    kind: identifier,
    uri: z.string().min(1).max(4000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    summary: z.string().min(1).max(4000),
    checker: identifier.optional(),
  }).strict()).optional(),
  assertions: z.array(z.object({
    assertionId: identifier,
    claim: z.string().min(1).max(4000),
    method: identifier,
    status: z.enum(["passed", "failed", "unknown"]),
    evidenceRefs: z.array(z.string().min(1).max(500)),
    checker: identifier,
  }).strict()).optional(),
  failure: GraphFailureSchema.optional(),
  externalEffect: z.object({
    idempotencyKey: z.string().min(1).max(500),
    operationType: identifier,
    target: z.string().min(1).max(2000),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(["not_requested", "request_prepared", "request_sent", "provider_accepted", "effect_observed", "effect_verified", "confirmed_absent", "ambiguous", "compensated"]),
    providerOperationId: z.string().max(500).optional(),
    lastObservedAt: z.string().datetime().optional(),
    evidenceRefs: z.array(z.string().min(1).max(500)).optional(),
  }).strict().optional(),
  progressFingerprint: z.string().min(1).max(1000).optional(),
  waitUntil: z.string().datetime().optional(),
}).strict();

export function validateGraphDefinition(value: unknown): GraphDefinition {
  const definition = GraphDefinitionSchema.parse(value) as GraphDefinition;
  const nodeIds = new Set(definition.nodes.map((node) => node.id));
  if (nodeIds.size !== definition.nodes.length) throw new Error("graph_definition_duplicate_node_id");
  if (!nodeIds.has(definition.entryNodeId)) throw new Error("graph_definition_entry_node_missing");
  for (const terminal of definition.terminalNodeIds) {
    if (!nodeIds.has(terminal)) throw new Error(`graph_definition_terminal_node_missing:${terminal}`);
  }
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(`graph_definition_edge_node_missing:${edge.from}->${edge.to}`);
    }
    const source = definition.nodes.find((node) => node.id === edge.from)!;
    if (!source.possibleOutcomes.includes(edge.on)) {
      throw new Error(`graph_definition_edge_outcome_not_declared:${edge.from}:${edge.on}`);
    }
  }
  for (const node of definition.nodes) {
    if (node.type === "subgraph" && (!node.subgraphId || !node.subgraphVersion)) {
      throw new Error(`graph_definition_subgraph_target_required:${node.id}`);
    }
    if (node.type !== "terminal" && !definition.edges.some((edge) => edge.from === node.id)) {
      throw new Error(`graph_definition_nonterminal_without_edge:${node.id}`);
    }
    if (node.type === "terminal" && !definition.terminalNodeIds.includes(node.id)) {
      throw new Error(`graph_definition_unregistered_terminal:${node.id}`);
    }
  }
  if (definition.compensation.strategy === "node" && !definition.compensation.nodeId) {
    throw new Error("graph_definition_compensation_node_required");
  }
  return definition;
}
