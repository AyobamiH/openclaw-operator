export type KnowledgeRouteKind =
  | "repository"
  | "worktree"
  | "component"
  | "service"
  | "agent"
  | "skill"
  | "plugin"
  | "tool"
  | "config"
  | "api"
  | "documentation"
  | "document-index"
  | "memory"
  | "database"
  | "state-store"
  | "cron-job"
  | "evidence-store"
  | "verification-source"
  | "decision-source"
  | "incident-source";

export type KnowledgeSourceType =
  | "file"
  | "directory"
  | "git"
  | "sqlite"
  | "systemd"
  | "http"
  | "openapi"
  | "openclaw-config"
  | "registry"
  | "memory"
  | "generated";

export type AuthorityClass =
  | "authoritative"
  | "derived"
  | "historical"
  | "advisory"
  | "runtime"
  | "unknown";

export type FreshnessMode =
  | "live"
  | "on-demand"
  | "watch"
  | "scheduled"
  | "static"
  | "historical";

export type KnowledgeRelationship =
  | "depends_on"
  | "implemented_by"
  | "handled_by"
  | "configured_by"
  | "runs_as"
  | "uses"
  | "reads"
  | "writes"
  | "documented_by"
  | "hosts"
  | "supersedes"
  | "verified_by"
  | "observed_by"
  | "owned_by"
  | "triggered_by"
  | "produces"
  | "stores_state_in"
  | "retrieved_by"
  | "requires_approval"
  | "exposes";

export interface KnowledgeRouteSource {
  type: KnowledgeSourceType;
  locator: string;
  resolver: "file" | "directory" | "git" | "sqlite-schema" | "systemctl" | "http" | "openapi" | "openclaw-config" | "registry" | "generated";
}

export interface KnowledgeRouteAuthority {
  class: AuthorityClass;
  priority: number;
  reason: string;
}

export interface KnowledgeRouteFreshness {
  mode: FreshnessMode;
  maxAgeSeconds?: number;
  checkedAt?: string;
}

export interface KnowledgeRouteVerification {
  method: "exists" | "git" | "http" | "sqlite-schema" | "systemctl" | "config-read" | "manual-review";
  target: string;
}

export interface KnowledgeRouteProvenance {
  discoveredBy: string;
  sourceHash?: string;
  generatedAt: string;
}

export interface KnowledgeRouteManagement {
  generated: boolean;
  humanReviewRequired: boolean;
  stale?: boolean;
  staleReasons?: string[];
  semanticStage?: "deterministic" | "ai-proposed" | "reviewed";
}

export interface KnowledgeRouteNode {
  id: string;
  kind: KnowledgeRouteKind;
  domain: string;
  description: string;
  answers: string[];
  aliases?: string[];
  taskIntents?: string[];
  source: KnowledgeRouteSource;
  authority: KnowledgeRouteAuthority;
  freshness: KnowledgeRouteFreshness;
  loadPolicy: string[];
  verification: KnowledgeRouteVerification;
  provenance: KnowledgeRouteProvenance;
  management: KnowledgeRouteManagement;
}

export interface KnowledgeRouteEdge {
  id: string;
  from: string;
  to: string;
  relationship: KnowledgeRelationship;
  evidence: string[];
  generated: boolean;
  verified: boolean;
  confidence: "deterministic" | "ai-proposed" | "reviewed";
  stale?: boolean;
  staleReasons?: string[];
}

export interface KnowledgeRoutingGraph {
  schemaVersion: 1;
  generatedAt: string;
  nodes: KnowledgeRouteNode[];
  edges: KnowledgeRouteEdge[];
  stats: KnowledgeRoutingStats;
  semanticAudit?: KnowledgeRoutingSemanticAudit;
}

export interface KnowledgeRoutingStats {
  nodes: number;
  edges: number;
  sourceTypes: Record<string, number>;
  domains: Record<string, number>;
  generatedNodes: number;
  aiClassifiedNodes: number;
  acceptedAiRelationships: number;
  rejectedSemanticProposals: number;
  verifiedRelationships: number;
  unresolvedRelationships: number;
  staleRoutes: number;
}

export interface KnowledgeRoutingSemanticAudit {
  generatedAt: string;
  proposedRelationships: number;
  acceptedRelationships: number;
  rejectedRelationships: Array<{
    from: string;
    to: string;
    relationship: string;
    reason: string;
    evidence: string[];
  }>;
}

export interface KnowledgeRouteResult {
  query: string;
  generatedAt: string;
  recommendedNodes: KnowledgeRouteNode[];
  authoritativeSources: KnowledgeRouteSource[];
  relationshipPath: KnowledgeRouteEdge[];
  freshnessRequirement: string;
  retrievalMethods: KnowledgeRouteSource[];
  verificationSources: KnowledgeRouteVerification[];
  warnings: string[];
}

export interface KnowledgeRoutingMapViews {
  systemMap: string;
  telegramExecutionMap: string;
  runtimeMap: string;
  knowledgeSourceMap: string;
  repositoryMap: string;
  agentCapabilityMap: string;
  skillMap: string;
  pluginMap: string;
  stateStoreMap: string;
  verificationMap: string;
  incidentDecisionMap: string;
}

export type KnowledgeRouteEvaluationClassification =
  | "CORRECT"
  | "PARTIAL"
  | "WRONG SOURCE"
  | "STALE SOURCE"
  | "NO ROUTE"
  | "AMBIGUOUS";

export interface KnowledgeRouteEvaluationCase {
  id: string;
  query: string;
  expectedNodeIds: string[];
  expectedAuthorityClasses?: AuthorityClass[];
  expectedSourceResolvers?: KnowledgeRouteSource["resolver"][];
  expectedVerificationMethods?: KnowledgeRouteVerification["method"][];
}

export interface KnowledgeRouteEvaluationResult {
  id: string;
  query: string;
  selectedNode: string | null;
  relationshipPath: string[];
  authoritativeSources: KnowledgeRouteSource[];
  retrievalMethods: KnowledgeRouteSource[];
  verificationSources: KnowledgeRouteVerification[];
  fallbackUsed: boolean;
  classification: KnowledgeRouteEvaluationClassification;
  authorityCorrect: boolean;
  routingCorrect: boolean;
  warnings: string[];
}

export interface KnowledgeRouteEvaluationSummary {
  generatedAt: string;
  totalQueries: number;
  correct: number;
  partial: number;
  wrongSource: number;
  staleSource: number;
  noRoute: number;
  ambiguous: number;
  routingAccuracy: number;
  authorityAccuracy: number;
}

export interface KnowledgeRouteEvaluationReport {
  summary: KnowledgeRouteEvaluationSummary;
  results: KnowledgeRouteEvaluationResult[];
}

export interface KnowledgeRoutingShadowComparison {
  generatedAt: string;
  informationNeedHash: string;
  informationNeedPreview: string;
  graphRoute: {
    selectedNode: string | null;
    relationshipPath: string[];
    proposedSources: KnowledgeRouteSource[];
    verificationSources: KnowledgeRouteVerification[];
    warnings: string[];
  };
  existingSourceUsed?: string;
  agreement: "agree" | "disagree" | "unknown";
}
