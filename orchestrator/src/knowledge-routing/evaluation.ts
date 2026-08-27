import { resolveKnowledgeRoute } from "./resolver.js";
import type {
  AuthorityClass,
  KnowledgeRouteEvaluationCase,
  KnowledgeRouteEvaluationReport,
  KnowledgeRouteEvaluationResult,
  KnowledgeRoutingGraph,
} from "./types.js";

export const DEFAULT_KNOWLEDGE_ROUTING_EVALUATION: KnowledgeRouteEvaluationCase[] = [
  q("runtime-version", "What version of OpenClaw is actually running?", ["service:orchestrator.service", "component:operator.runtime"], ["runtime", "authoritative"], ["systemctl", "git"]),
  q("telegram-repo", "Which repository currently owns Telegram execution?", ["component:telegram.runtime", "repo:telegram-live-execution"], ["authoritative"], ["git"]),
  q("telegram-model", "What controls the current Telegram model?", ["component:model.routing", "component:telegram.runtime"], ["authoritative"], ["openclaw-config"]),
  q("telegram-repair-skill", "Which skill should be used for Telegram runtime repair?", ["component:skill.registry", "skill:openclaw-runtime-repair-closeout"], ["advisory"], ["file"]),
  q("cron-authority", "Where is cron state authoritative?", ["component:cron.runtime", "cron:openclaw-jobs"], ["authoritative"], ["file", "sqlite-schema"]),
  q("plugins-enabled", "Which plugins are enabled?", ["component:plugin.registry", "config:openclaw"], ["authoritative"], ["openclaw-config"]),
  q("operator-service", "Which service hosts the operator?", ["component:operator.runtime", "service:orchestrator.service"], ["runtime"], ["systemctl"]),
  q("operator-state", "Where is operator state persisted?", ["component:operator.state", "database:operator"], ["authoritative"], ["sqlite-schema"]),
  q("telegram-history", "Why was Telegram live execution changed?", ["component:incident.decision.history", "memory:current-index"], ["historical", "advisory"], ["file"]),
  q("deployment-proof", "Which evidence proves a deployment succeeded?", ["component:verification.evidence", "component:deployment.runtime"], ["runtime", "historical"], ["systemctl", "file"]),
  q("old-incident", "Where should I look for an old runtime incident?", ["component:incident.decision.history", "docs:failure-modes"], ["historical"], ["file"]),
  q("human-approval", "What still requires human approval?", ["component:approval.gates", "api:/api/approvals/pending"], ["authoritative", "derived"], ["openapi", "file"]),
  q("runtime-health", "Which source is authoritative for current runtime health?", ["component:runtime.health", "service:orchestrator.service"], ["runtime"], ["systemctl"]),
  q("operator-architecture", "Which source describes intended operator architecture?", ["docs:system-truth", "docs:operator-index"], ["authoritative"], ["file"]),
  q("repo-proof", "Which source proves repository state?", ["component:repository.state", "repo:openclaw-operator"], ["authoritative"], ["git"]),
  q("knowledge-route", "Where should an agent route an information need?", ["component:knowledge.routing", "api:/api/knowledge-routing/route"], ["derived"], ["openapi"]),
  q("api-route", "Which API route serves knowledge routing?", ["component:knowledge.routing", "api:/api/knowledge-routing/route"], ["derived"], ["openapi"]),
  q("graph-load-proof", "Where should graph-load proof route for the live knowledge-routing graph?", ["api:/api/knowledge-routing/summary", "component:knowledge.routing"], ["derived"], ["openapi"]),
  q("shadow-endpoint-proof", "Which protected endpoint records knowledge-routing shadow comparisons?", ["api:/api/knowledge-routing/shadow", "component:knowledge.routing"], ["derived"], ["openapi"]),
  q("memory-decisions", "Where are durable decisions recorded?", ["component:memory.system", "memory:current-index"], ["advisory"], ["file"]),
  q("agent-config", "Which agents are configured?", ["component:agent.runtime", "agent:main"], ["authoritative"], ["openclaw-config"]),
  q("agent-architecture", "Which source describes intended agent architecture?", ["component:agent.runtime", "docs:agent-capability-model"], ["advisory"], ["file"]),
  q("deployment-activation", "What controls production activation?", ["component:deployment.runtime", "component:approval.gates"], ["runtime", "authoritative"], ["file", "systemctl"]),
  q("gateway-health", "Which source verifies gateway health?", ["component:gateway.runtime", "service:openclaw-gateway.service"], ["runtime"], ["systemctl"]),
  q("operator-api", "Where are operator API routes documented?", ["component:operator.api", "api:/api/openapi.json"], ["derived"], ["openapi"]),
  q("state-health", "Which source verifies persistence health?", ["component:operator.state", "api:/api/persistence/health"], ["derived", "authoritative"], ["openapi", "sqlite-schema"]),
  q("shadow-routing", "Where is shadow graph routing recorded?", ["component:knowledge.routing"], ["derived"], ["file", "openapi"]),
  q("business-systems", "Where should business system routes start?", ["component:business.systems", "api:/api/business/overview"], ["derived"], ["openapi"]),
];

export function evaluateKnowledgeRoutingGraph(
  graph: KnowledgeRoutingGraph,
  cases = DEFAULT_KNOWLEDGE_ROUTING_EVALUATION,
): KnowledgeRouteEvaluationReport {
  const results = cases.map((item) => evaluateCase(graph, item));
  const summary = {
    generatedAt: new Date().toISOString(),
    totalQueries: results.length,
    correct: results.filter((item) => item.classification === "CORRECT").length,
    partial: results.filter((item) => item.classification === "PARTIAL").length,
    wrongSource: results.filter((item) => item.classification === "WRONG SOURCE").length,
    staleSource: results.filter((item) => item.classification === "STALE SOURCE").length,
    noRoute: results.filter((item) => item.classification === "NO ROUTE").length,
    ambiguous: results.filter((item) => item.classification === "AMBIGUOUS").length,
    routingAccuracy: ratio(results.filter((item) => item.routingCorrect).length, results.length),
    authorityAccuracy: ratio(results.filter((item) => item.authorityCorrect).length, results.length),
  };
  return { summary, results };
}

function evaluateCase(graph: KnowledgeRoutingGraph, item: KnowledgeRouteEvaluationCase): KnowledgeRouteEvaluationResult {
  const route = resolveKnowledgeRoute(graph, item.query, 6);
  const selectedNode = route.recommendedNodes[0] ?? null;
  const recommendedIds = route.recommendedNodes.map((node) => node.id);
  const expectedIdSet = new Set(item.expectedNodeIds);
  const routingCorrect = recommendedIds.slice(0, 3).some((id) => expectedIdSet.has(id));
  const selectedExpected = selectedNode ? expectedIdSet.has(selectedNode.id) : false;
  const stale = route.recommendedNodes.some((node) => node.management.stale);
  const authorityCorrect = isAuthorityCorrect(route, item.expectedAuthorityClasses, item.expectedSourceResolvers);
  const classification =
    route.recommendedNodes.length === 0
      ? "NO ROUTE"
      : stale
        ? "STALE SOURCE"
        : selectedExpected && authorityCorrect
          ? "CORRECT"
          : routingCorrect || authorityCorrect
            ? "PARTIAL"
            : "WRONG SOURCE";

  return {
    id: item.id,
    query: item.query,
    selectedNode: selectedNode?.id ?? null,
    relationshipPath: route.relationshipPath.map((edge) => `${edge.from} ${edge.relationship} ${edge.to}`),
    authoritativeSources: route.authoritativeSources,
    retrievalMethods: route.retrievalMethods,
    verificationSources: route.verificationSources,
    fallbackUsed: route.warnings.length > 0 || !routingCorrect,
    classification,
    authorityCorrect,
    routingCorrect,
    warnings: route.warnings,
  };
}

function q(
  id: string,
  query: string,
  expectedNodeIds: string[],
  expectedAuthorityClasses: AuthorityClass[],
  expectedSourceResolvers: KnowledgeRouteEvaluationCase["expectedSourceResolvers"],
): KnowledgeRouteEvaluationCase {
  return { id, query, expectedNodeIds, expectedAuthorityClasses, expectedSourceResolvers };
}

function isAuthorityCorrect(
  route: ReturnType<typeof resolveKnowledgeRoute>,
  classes: AuthorityClass[] = [],
  resolvers: KnowledgeRouteEvaluationCase["expectedSourceResolvers"] = [],
) {
  const routeSources = [...route.authoritativeSources, ...route.retrievalMethods];
  const sourceResolverMatch = resolvers.length === 0 || routeSources.some((source) => resolvers.includes(source.resolver));
  const nodeClassMatch =
    classes.length === 0 || route.recommendedNodes.some((node) => classes.includes(node.authority.class));
  return sourceResolverMatch || nodeClassMatch;
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}
