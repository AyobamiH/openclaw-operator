import type {
  AuthorityClass,
  CompletionAssertionDefinition,
  GraphDefinition,
  GraphEdgeDefinition,
  GraphNodeDefinition,
  NodeOutcome,
  NodeType,
} from "./types.js";

const ALL_FAILURES = [
  "validation_error", "missing_dependency", "authority_denied", "approval_required",
  "tool_unavailable", "tool_contract_error", "provider_rate_limited", "provider_auth_error",
  "provider_not_found", "provider_rejected", "network_transient", "timeout",
  "verification_failed", "no_progress", "budget_exhausted", "state_conflict",
  "idempotency_conflict", "invariant_violation", "unsafe_operation", "human_input_required", "unknown",
] as const;

function node(args: {
  id: string;
  type?: NodeType;
  handler?: string;
  purpose: string;
  mutations?: string[];
  evidence?: string[];
  authority?: AuthorityClass;
  sideEffect?: AuthorityClass;
  outcomes?: NodeOutcome[];
  retry?: boolean;
  maxAttempts?: number;
  loopId?: string;
}): GraphNodeDefinition {
  return {
    id: args.id,
    type: args.type ?? "deterministic",
    handler: args.handler ?? "graph.pass",
    purpose: args.purpose,
    inputProjection: ["objective", "input", "data"],
    outputContract: `${args.id}.v1`,
    permittedStateMutations: args.mutations ?? [],
    requiredCapabilities: [],
    sideEffectClass: args.sideEffect ?? "read_only",
    authority: args.authority ?? args.sideEffect ?? "read_only",
    timeoutMs: 60_000,
    retryEligible: args.retry ?? false,
    maxAttempts: args.maxAttempts ?? 1,
    idempotencyStrategy: (args.sideEffect && args.sideEffect !== "read_only") ? "external_operation" : "run_node_payload",
    evidenceEmitted: args.evidence ?? [],
    errorTaxonomy: [...ALL_FAILURES],
    possibleOutcomes: args.outcomes ?? ["succeeded", "failed_repairable", "failed_terminal", "blocked"],
    loopId: args.loopId,
  };
}

function edge(from: string, to: string, on: NodeOutcome = "succeeded", extras: Partial<GraphEdgeDefinition> = {}): GraphEdgeDefinition {
  return { from, to, on, ...extras };
}

function base(args: {
  graphId: string;
  description: string;
  nodes: GraphNodeDefinition[];
  edges: GraphEdgeDefinition[];
  entry: string;
  terminal: string;
  authority: AuthorityClass;
  evidence: CompletionAssertionDefinition[];
  replaces: string[];
}): GraphDefinition {
  return {
    graphId: args.graphId,
    version: "1.0.0",
    description: args.description,
    inputSchema: { type: "object" },
    stateSchema: { type: "object" },
    nodes: args.nodes,
    edges: args.edges,
    entryNodeId: args.entry,
    terminalNodeIds: [args.terminal],
    timeoutPolicy: { wallClockMs: 60 * 60 * 1000, nodeDefaultMs: 60_000 },
    retryPolicy: { defaultMaxAttempts: 2, retryableFailures: ["network_transient", "provider_rate_limited", "timeout", "state_conflict"] },
    loopBudgets: { maxNodeAttempts: 80, maxTransitions: 100, maxLoopIterations: 8, wallClockMs: 60 * 60 * 1000, tokenBudget: 100_000, toolCallBudget: 60, externalRequestBudget: 10, costBudgetUsd: 10, repeatedErrorThreshold: 2, noProgressThreshold: 2 },
    authorityRequirements: { maximum: args.authority, approvalsRequiredAtOrAbove: "external_reversible" },
    evidenceRequirements: args.evidence,
    compensation: { strategy: "none" },
    concurrency: { maxRuns: 4, resourceKeys: [], leaseMs: 120_000, priority: 50 },
    ownership: { owner: "openclaw-operator", repository: "projects/openclaw-operator", runtime: "orchestrator" },
    migrationCompatibility: { replaces: args.replaces, compatibleFromVersions: [] },
  };
}

export function codingChangeGraph(): GraphDefinition {
  const ids = ["intake", "repo_truth", "dirty_state", "objective_normalisation", "plan", "plan_review", "implement", "typecheck", "test", "lint", "build", "diff_review", "evidence_gate", "complete"];
  const nodes = ids.map((id) => node({
    id,
    type: id === "plan" ? "deterministic" : id === "evidence_gate" ? "verification" : id === "complete" ? "terminal" : id === "implement" || ["typecheck", "test", "lint", "build"].includes(id) ? "tool" : "deterministic",
    handler: id === "plan" ? "graph.plan" : id === "implement" || ["typecheck", "test", "lint", "build"].includes(id) ? "legacy.command" : id === "evidence_gate" ? "graph.evidence-gate" : id === "complete" ? "graph.terminal" : "graph.pass",
    purpose: `Coding workflow stage: ${id.replaceAll("_", " ")}`,
    mutations: id === "plan" ? ["plan", "planVersion"] : [],
    evidence: id === "repo_truth" ? ["repository-truth"] : id === "test" ? ["test-output"] : id === "build" ? ["build-output"] : id === "diff_review" ? ["git-diff"] : [],
    sideEffect: id === "implement" ? "local_reversible" : "read_only",
    outcomes: id === "complete" ? ["succeeded"] : ["succeeded", "failed_repairable", "failed_terminal", "needs_replan", "blocked"],
    retry: ["typecheck", "test", "lint", "build"].includes(id), maxAttempts: ["typecheck", "test", "lint", "build"].includes(id) ? 3 : 1,
  }));
  nodes.push(
    node({ id: "diagnose_failure", type: "deterministic", handler: "graph.pass", purpose: "Classify implementation versus environment failure", loopId: "repair-loop" }),
    node({ id: "repair", type: "tool", handler: "legacy.command", purpose: "Apply one bounded repair without overwriting unrelated work", sideEffect: "local_reversible", loopId: "repair-loop", retry: true, maxAttempts: 3 }),
  );
  const edges = ids.slice(0, -1).map((id, index) => edge(id, ids[index + 1]!));
  for (const id of ["typecheck", "test", "lint", "build"]) edges.push(edge(id, "diagnose_failure", "failed_repairable", { loopId: "repair-loop" }));
  edges.push(edge("diagnose_failure", "repair", "succeeded", { loopId: "repair-loop" }), edge("repair", "typecheck", "succeeded", { loopId: "repair-loop" }));
  for (const id of ids.filter((id) => id !== "complete")) edges.push(edge(id, "complete", "failed_terminal", { priority: -100 }));
  edges.push(edge("diagnose_failure", "complete", "failed_terminal"), edge("repair", "complete", "failed_terminal"));
  return base({
    graphId: "coding-change", description: "Evidence-gated repository change workflow with dirty-state protection and bounded repair.", nodes, edges, entry: "intake", terminal: "complete", authority: "local_reversible",
    evidence: [
      { assertionId: "coding-tests-passed", claim: "Authoritative tests passed", method: "test-runner", requiredEvidenceKinds: ["test-output"] },
      { assertionId: "coding-diff-reviewed", claim: "The scoped Git diff was reviewed", method: "git-diff-review", requiredEvidenceKinds: ["git-diff"] },
      { assertionId: "coding-build-passed", claim: "The project build passed", method: "build-runner", requiredEvidenceKinds: ["build-output"] },
    ],
    replaces: ["build-refactor", "ad-hoc-coding-session"],
  });
}

export function socialPublicationGraph(): GraphDefinition {
  const ids = ["schedule_trigger", "resolve_london_slot", "select_campaign_item", "duplicate_guard", "policy_guard", "authority_check", "prepare_payload", "payload_hash", "approval_check"];
  const nodes = ids.map((id) => node({ id, purpose: `Deterministic publication stage: ${id.replaceAll("_", " ")}` }));
  nodes.push(
    node({ id: "dry_run", type: "connector", handler: "graph.social-dry-run", purpose: "Exercise the canonical publication contract without provider writes", mutations: ["publication"], evidence: ["publication-dry-run"] }),
    node({ id: "create_external_container", type: "connector", handler: "graph.external-disabled", purpose: "Create one official provider container with durable idempotency", sideEffect: "external_public", authority: "external_public", outcomes: ["succeeded", "failed_repairable", "failed_terminal", "blocked"] }),
    node({ id: "reconcile_container", type: "verification", handler: "graph.external-disabled", purpose: "Reconcile container acceptance before any retry", sideEffect: "read_only" }),
    node({ id: "publish", type: "connector", handler: "graph.external-disabled", purpose: "Publish a previously reconciled provider container", sideEffect: "external_public", authority: "external_public" }),
    node({ id: "read_back", type: "verification", handler: "graph.pass", purpose: "Read provider-owned state" }),
    node({ id: "verify_visibility", type: "verification", handler: "graph.pass", purpose: "Verify exact provider visibility" }),
    node({ id: "record_metrics", type: "checkpoint", handler: "graph.pass", purpose: "Record deterministic publication metrics" }),
    node({ id: "diagnose", handler: "graph.pass", purpose: "Classify a provider or local defect", loopId: "publication-repair" }),
    node({ id: "repair", type: "tool", handler: "graph.pass", purpose: "Apply a bounded local-only repair", sideEffect: "local_reversible", loopId: "publication-repair" }),
    node({ id: "evidence_gate", type: "verification", handler: "graph.evidence-gate", purpose: "Require dry-run or official readback evidence before completion" }),
    node({ id: "complete", type: "terminal", handler: "graph.terminal", purpose: "Terminal publication state", outcomes: ["succeeded"] }),
  );
  const edges: GraphEdgeDefinition[] = ids.slice(0, -1).map((id, index) => edge(id, ids[index + 1]!));
  edges.push(
    edge("approval_check", "dry_run", "succeeded", { priority: 100, guards: [{ path: "input.dryRun", operator: "eq", value: true }] }),
    edge("approval_check", "create_external_container", "succeeded", { priority: 50, guards: [{ path: "input.dryRun", operator: "neq", value: true }] }),
    edge("dry_run", "evidence_gate"),
    edge("create_external_container", "reconcile_container"), edge("reconcile_container", "publish"), edge("publish", "read_back"), edge("read_back", "verify_visibility"), edge("verify_visibility", "record_metrics"), edge("record_metrics", "evidence_gate"), edge("evidence_gate", "complete"),
    edge("create_external_container", "diagnose", "failed_repairable", { loopId: "publication-repair" }), edge("publish", "diagnose", "failed_repairable", { loopId: "publication-repair" }), edge("diagnose", "repair", "succeeded", { loopId: "publication-repair" }), edge("repair", "reconcile_container", "succeeded", { loopId: "publication-repair" }),
  );
  for (const candidate of nodes.filter((item) => item.type !== "terminal")) edges.push(edge(candidate.id, "complete", "failed_terminal", { priority: -100 }));
  return base({
    graphId: "deterministic-social-publication", description: "Exactly-once official-provider publication workflow with dry-run proof and ambiguous-effect reconciliation.", nodes, edges, entry: "schedule_trigger", terminal: "complete", authority: "external_public",
    evidence: [{ assertionId: "social-publication-verified", claim: "Publication path is verified by provider readback or a zero-write dry run", method: "provider-readback", requiredEvidenceKinds: ["publication-dry-run"] }],
    replaces: ["threads-outbox-runner", "instagram-publisher-outbox-runner", "deterministic-self-identification-publisher"],
  });
}

export function researchToActionGraph(): GraphDefinition {
  const ids = ["define_question", "source_plan", "search", "fetch", "extract", "quality_check", "gap_analysis", "synthesise", "business_relevance", "action_recommendations", "evidence_gate", "complete"];
  const nodes = ids.map((id) => node({
    id,
    type: id === "evidence_gate" || id === "quality_check" ? "verification" : id === "complete" ? "terminal" : "deterministic",
    handler: id === "extract" ? "graph.research" : id === "evidence_gate" ? "graph.evidence-gate" : id === "complete" ? "graph.terminal" : "graph.pass",
    purpose: `Research-to-action stage: ${id.replaceAll("_", " ")}`,
    mutations: id === "extract" ? ["research"] : [],
    evidence: id === "extract" ? ["claim-source-ledger"] : id === "action_recommendations" ? ["action-recommendations"] : [],
    outcomes: id === "complete" ? ["succeeded"] : ["succeeded", "failed_repairable", "failed_terminal", "needs_replan", "blocked"],
  }));
  nodes.push(node({ id: "refine_search", purpose: "Refine sources only while material evidence gaps remain", loopId: "research-refinement" }));
  const edges = ids.slice(0, -1).map((id, index) => edge(id, ids[index + 1]!));
  edges.push(edge("gap_analysis", "refine_search", "needs_replan", { loopId: "research-refinement" }), edge("refine_search", "search", "succeeded", { loopId: "research-refinement" }));
  for (const candidate of nodes.filter((item) => item.type !== "terminal")) edges.push(edge(candidate.id, "complete", "failed_terminal", { priority: -100 }));
  return base({
    graphId: "research-to-action", description: "Claim/source-separated research workflow with bounded gap refinement and action relevance.", nodes, edges, entry: "define_question", terminal: "complete", authority: "read_only",
    evidence: [
      { assertionId: "research-claims-supported", claim: "Every material claim has source evidence", method: "claim-evidence-check", requiredEvidenceKinds: ["claim-source-ledger"] },
      { assertionId: "research-actions-produced", claim: "Evidence-backed action recommendations were produced", method: "business-relevance-check", requiredEvidenceKinds: ["action-recommendations"] },
    ],
    replaces: ["market-research", "prompt-driven-research"],
  });
}

export function representativeGraphDefinitions(): GraphDefinition[] {
  return [
    codingChangeGraph(), socialPublicationGraph(), researchToActionGraph(),
    boundCodingChangeGraph(), boundSocialPublicationGraph(), liveCapableSocialPublicationGraph(), boundResearchToActionGraph(),
  ];
}

function bindNode(definition: GraphDefinition, nodeId: string, handler: string, options: { localReversible?: boolean; mutation?: string } = {}): void {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`bound_graph_node_missing:${definition.graphId}:${nodeId}`);
  node.handler = handler;
  node.requiredCapabilities = [handler];
  node.timeoutMs = Math.min(node.timeoutMs, handler === "production.repo-command.v1" ? 10 * 60_000 : 60_000);
  if (options.localReversible) {
    node.sideEffectClass = "local_reversible";
    node.authority = "local_reversible";
  }
  if (options.mutation && !node.permittedStateMutations.includes(options.mutation)) node.permittedStateMutations.push(options.mutation);
}

export function boundCodingChangeGraph(): GraphDefinition {
  const definition = structuredClone(codingChangeGraph());
  definition.version = "1.1.0";
  definition.description = "Production-adapter-bound coding graph; implementation and repair remain explicit legacy adapters until the build-refactor transaction contract is extracted.";
  definition.migrationCompatibility.compatibleFromVersions = ["1.0.0"];
  for (const id of ["repo_truth", "dirty_state", "diff_review"]) bindNode(definition, id, "production.repo-inspect.v1");
  for (const id of ["typecheck", "test", "lint", "build"]) bindNode(definition, id, "production.repo-command.v1", { localReversible: true });
  return definition;
}

export function boundSocialPublicationGraph(): GraphDefinition {
  const definition = structuredClone(socialPublicationGraph());
  definition.version = "1.1.0";
  definition.description = "Production-adapter-bound zero-write publishing graph using the canonical deterministic publishing decision path.";
  definition.migrationCompatibility.compatibleFromVersions = ["1.0.0"];
  const shadowAdapterNodes = ["schedule_trigger", "resolve_london_slot", "select_campaign_item", "duplicate_guard", "policy_guard", "authority_check", "prepare_payload", "payload_hash", "approval_check", "dry_run"];
  for (const id of shadowAdapterNodes) {
    bindNode(definition, id, "production.publishing-shadow-decision.v1", { mutation: "publicationShadow" });
  }
  definition.nodes.push(node({ id: "shadow_blocked", type: "wait", handler: "graph.pass", purpose: "Durable controlled stop for an ineligible, unsafe, duplicate, or ambiguous shadow decision", outcomes: ["succeeded"], loopId: "shadow-blocked-wait" }));
  definition.edges.push(...shadowAdapterNodes.map((id) => edge(id, "shadow_blocked", "blocked", { priority: 200 })));
  definition.edges.push(edge("shadow_blocked", "shadow_blocked", "succeeded", { loopId: "shadow-blocked-wait" }));
  definition.evidenceRequirements = [{
    assertionId: "social-shadow-equivalent",
    claim: "The canonical publication decision was reproduced with an identical payload hash and zero provider writes",
    method: "shadow-equivalence",
    requiredEvidenceKinds: ["publication-shadow-decision", "payload-hash", "zero-provider-writes"],
  }];
  return definition;
}

export function liveCapableSocialPublicationGraph(): GraphDefinition {
  const stages = [
    "intake",
    "load_runtime_and_provider_state",
    "resolve_eligible_slot",
    "select_approved_candidate",
    "validate_campaign_and_policy",
    "duplicate_and_provider_existence_check",
    "acquire_durable_candidate_claim",
    "prepare_canonical_payload",
    "prepare_deterministic_media",
    "freeze_publication_envelope",
    "validate_envelope",
    "record_payload_bound_approval",
    "persist_external_effect_intent",
    "authority_recheck",
    "create_provider_container_if_required",
    "reconcile_container",
    "publish_provider_object",
    "reconcile_publication",
    "official_provider_readback",
    "verify_public_visibility",
    "verify_payload_and_media_identity",
    "commit_local_publication_state",
    "finalise_candidate_claim",
    "package_evidence",
    "complete",
  ];
  const nodes = stages.map((id) => node({
    id,
    type: id === "complete" ? "terminal"
      : id === "publish_provider_object" ? "connector"
        : ["validate_envelope", "reconcile_container", "reconcile_publication", "official_provider_readback", "verify_public_visibility", "verify_payload_and_media_identity", "commit_local_publication_state", "finalise_candidate_claim", "package_evidence"].includes(id) ? "verification"
          : id === "acquire_durable_candidate_claim" ? "tool"
            : "deterministic",
    handler: id === "acquire_durable_candidate_claim" ? "production.instagram-publication-prepare.v2"
      : id === "publish_provider_object" ? "production.instagram-publication-live.v2"
        : id === "official_provider_readback" ? "production.instagram-publication-readback.v2"
          : id === "package_evidence" ? "graph.evidence-gate"
            : id === "complete" ? "graph.terminal"
              : "graph.pass",
    purpose: `Live-capable deterministic publication stage: ${id.replaceAll("_", " ")}`,
    mutations: id === "acquire_durable_candidate_claim" ? ["publicationLive", "target"]
      : id === "publish_provider_object" || id === "official_provider_readback" ? ["publicationLive"] : [],
    evidence: id === "acquire_durable_candidate_claim" ? ["candidate-claim", "payload-hash", "media-hash", "frozen-envelope", "zero-provider-writes"]
      : id === "publish_provider_object" ? ["provider-publication", "official-provider-readback", "local-publication-state"]
        : id === "official_provider_readback" ? ["second-provider-readback", "payload-media-identity", "single-provider-object", "claim-finalised"] : [],
    authority: id === "publish_provider_object" ? "external_public" : id === "acquire_durable_candidate_claim" ? "local_persistent" : "read_only",
    sideEffect: id === "publish_provider_object" ? "external_public" : id === "acquire_durable_candidate_claim" ? "local_persistent" : "read_only",
    outcomes: id === "complete" ? ["succeeded"] : ["succeeded", "failed_repairable", "failed_terminal", "blocked"],
    retry: id === "acquire_durable_candidate_claim" || id === "official_provider_readback",
    maxAttempts: id === "acquire_durable_candidate_claim" || id === "official_provider_readback" ? 2 : 1,
  }));
  const edges = stages.slice(0, -1).map((id, index) => edge(id, stages[index + 1]!));
  for (const graphNode of nodes.filter((item) => item.handler.startsWith("production."))) {
    graphNode.requiredCapabilities = [graphNode.handler];
    if (graphNode.id === "acquire_durable_candidate_claim") {
      graphNode.idempotencyStrategy = "run_node_payload";
      graphNode.timeoutMs = 15 * 60_000;
    }
    if (graphNode.id === "publish_provider_object") graphNode.timeoutMs = 15 * 60_000;
    if (graphNode.id === "official_provider_readback") graphNode.timeoutMs = 5 * 60_000;
  }
  for (const candidate of nodes.filter((item) => item.type !== "terminal")) {
    edges.push(edge(candidate.id, "complete", "failed_terminal", { priority: -100 }));
  }
  const definition = base({
    graphId: "deterministic-social-publication",
    description: "Live-capable payload-bound official-provider publication graph with durable claim, pre-dispatch effect intent, reconciliation and second readback.",
    nodes,
    edges,
    entry: "intake",
    terminal: "complete",
    authority: "external_public",
    evidence: [
      { assertionId: "live-provider-publication-verified", claim: "Exactly one provider publication is verified", method: "official-provider-readback", requiredEvidenceKinds: ["provider-publication", "official-provider-readback", "second-provider-readback", "single-provider-object"] },
      { assertionId: "live-payload-media-identity-verified", claim: "The provider object matches the frozen payload and media", method: "payload-media-identity", requiredEvidenceKinds: ["frozen-envelope", "payload-hash", "media-hash", "payload-media-identity"] },
      { assertionId: "live-local-state-finalised", claim: "Canonical local state and candidate claim are finalised", method: "durable-state-verification", requiredEvidenceKinds: ["local-publication-state", "claim-finalised"] },
    ],
    replaces: ["deterministic-social-publication@1.1.0"],
  });
  definition.version = "2.0.0";
  definition.migrationCompatibility.compatibleFromVersions = [];
  definition.concurrency = { maxRuns: 1, resourceKeys: ["publication:instagram"], leaseMs: 15 * 60_000, priority: 100 };
  definition.loopBudgets.externalRequestBudget = 1;
  return definition;
}

export function boundResearchToActionGraph(): GraphDefinition {
  const definition = structuredClone(researchToActionGraph());
  definition.version = "1.1.0";
  definition.description = "Production evidence-adapter-bound research graph; governed source fetching remains the existing market-research task lane.";
  definition.migrationCompatibility.compatibleFromVersions = ["1.0.0"];
  for (const id of ["extract", "quality_check", "gap_analysis"]) bindNode(definition, id, "production.research-evidence.v1", { mutation: "research" });
  return definition;
}
