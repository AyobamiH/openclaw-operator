// Real API layer for OpenClaw Operator Console
// Calls live backend endpoints per Integration Contract V1

import { apiFetch } from "@/lib/api-client";
import type {
  DashboardOverview,
  HealthResponse,
  PersistenceHealth,
  ExtendedHealth,
  PersistenceSummary,
  TaskCatalogResponse,
  TaskTriggerResponse,
  TaskRunsResponse,
  TaskRun,
  PendingApprovalsResponse,
  ApprovalDecisionResponse,
  IncidentActionResponse,
  IncidentRemediationResponse,
  IncidentDetailResponse,
  IncidentsResponse,
  AgentsOverviewResponse,
  KnowledgeSummary,
  SkillsPolicyResponse,
  SkillsRegistryResponse,
  SkillsTelemetryResponse,
  SkillsAuditResponse,
  MemoryRecallResponse,
  KnowledgeQueryRequest,
  KnowledgeQueryResponse,
  CommandCenterOverviewResponse,
  CommandCenterControlResponse,
  CommandCenterDemandResponse,
  MilestoneFeedResponse,
  MilestoneDeadLetterResponse,
} from "@/types/console";

// ── Dashboard ──
export const fetchDashboardOverview = () =>
  apiFetch<DashboardOverview>("/api/dashboard/overview");

// ── Health (public) ──
export const fetchHealth = () =>
  apiFetch<HealthResponse>("/health");

// ── Persistence Health (public) ──
export const fetchPersistenceHealth = () =>
  apiFetch<PersistenceHealth>("/api/persistence/health");

// ── Extended Health (viewer) ──
export const fetchExtendedHealth = () =>
  apiFetch<ExtendedHealth>("/api/health/extended");

// ── Persistence Summary (viewer) ──
export const fetchPersistenceSummary = () =>
  apiFetch<PersistenceSummary>("/api/persistence/summary");

// ── Task Catalog (viewer) ──
export const fetchTaskCatalog = () =>
  apiFetch<TaskCatalogResponse>("/api/tasks/catalog");

// ── Task Trigger (operator) ──
export const triggerTask = (type: string, payload?: Record<string, unknown>) =>
  apiFetch<TaskTriggerResponse>("/api/tasks/trigger", {
    method: "POST",
    body: JSON.stringify({ type, payload }),
  });

// ── Task Runs (viewer) ──
export const fetchTaskRuns = (params?: {
  type?: string;
  status?: string;
  includeInternal?: boolean;
  limit?: number;
  offset?: number;
}) => {
  const qs = new URLSearchParams();
  if (params?.type) qs.set("type", params.type);
  if (params?.status) qs.set("status", params.status);
  if (params?.includeInternal) qs.set("includeInternal", "true");
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  const query = qs.toString();
  return apiFetch<TaskRunsResponse>(`/api/tasks/runs${query ? `?${query}` : ""}`);
};

// ── Task Run Detail (viewer) ──
export const fetchTaskRunDetail = (runId: string) =>
  apiFetch<{ generatedAt: string; run: TaskRun }>(`/api/tasks/runs/${encodeURIComponent(runId)}`);

// ── Approvals (operator) ──
export const fetchPendingApprovals = () =>
  apiFetch<PendingApprovalsResponse>("/api/approvals/pending");

export const submitApprovalDecision = (
  id: string,
  decision: "approved" | "rejected",
  actor?: string,
  note?: string,
) =>
  apiFetch<ApprovalDecisionResponse>(`/api/approvals/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, actor, note }),
  });

export const acknowledgeIncident = (
  id: string,
  actor?: string,
  note?: string,
) =>
  apiFetch<IncidentActionResponse>(`/api/incidents/${encodeURIComponent(id)}/acknowledge`, {
    method: "POST",
    body: JSON.stringify({ actor, note }),
  });

export const assignIncidentOwner = (
  id: string,
  body: { owner: string; actor?: string; note?: string },
) =>
  apiFetch<IncidentActionResponse>(`/api/incidents/${encodeURIComponent(id)}/owner`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const fetchIncidents = (params?: {
  status?: string;
  classification?: string;
  includeResolved?: boolean;
  limit?: number;
  offset?: number;
}) => {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.classification) qs.set("classification", params.classification);
  if (params?.includeResolved) qs.set("includeResolved", "true");
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  const query = qs.toString();
  return apiFetch<IncidentsResponse>(`/api/incidents${query ? `?${query}` : ""}`);
};

export const fetchIncidentDetail = (id: string) =>
  apiFetch<IncidentDetailResponse>(`/api/incidents/${encodeURIComponent(id)}`);

export const remediateIncident = (
  id: string,
  body?: { actor?: string; note?: string; taskType?: "build-refactor" | "drift-repair" | "qa-verification" | "system-monitor" },
) =>
  apiFetch<IncidentRemediationResponse>(`/api/incidents/${encodeURIComponent(id)}/remediate`, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });

// ── Agents (viewer) ──
export const fetchAgentsOverview = () =>
  apiFetch<AgentsOverviewResponse>("/api/agents/overview");

// ── Knowledge Summary (public) ──
export const fetchKnowledgeSummary = () =>
  apiFetch<KnowledgeSummary>("/api/knowledge/summary");

// ── Skills / Governance (viewer) ──
export const fetchSkillsPolicy = () =>
  apiFetch<SkillsPolicyResponse>("/api/skills/policy");

export const fetchSkillsRegistry = () =>
  apiFetch<SkillsRegistryResponse>("/api/skills/registry");

export const fetchSkillsTelemetry = () =>
  apiFetch<SkillsTelemetryResponse>("/api/skills/telemetry");

export const fetchSkillsAudit = (params?: { limit?: number; offset?: number; deniedOnly?: boolean }) => {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  if (params?.deniedOnly) qs.set("deniedOnly", "true");
  const query = qs.toString();
  return apiFetch<SkillsAuditResponse>(`/api/skills/audit${query ? `?${query}` : ""}`);
};

// ── Memory Recall (viewer) ──
export const fetchMemoryRecall = (params?: {
  agentId?: string;
  limit?: number;
  offset?: number;
  includeErrors?: boolean;
  includeSensitive?: boolean;
}) => {
  const qs = new URLSearchParams();
  if (params?.agentId) qs.set("agentId", params.agentId);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  if (params?.includeErrors === false) qs.set("includeErrors", "false");
  if (params?.includeSensitive === true) qs.set("includeSensitive", "true");
  const query = qs.toString();
  return apiFetch<MemoryRecallResponse>(`/api/memory/recall${query ? `?${query}` : ""}`);
};

// ── Knowledge Query (operator) ──
export const submitKnowledgeQuery = (body: KnowledgeQueryRequest) =>
  apiFetch<KnowledgeQueryResponse>("/api/knowledge/query", {
    method: "POST",
    body: JSON.stringify(body),
  });

// ── Public Proof / Command Center ──
// These routes are now served directly by the orchestrator public surface.

export const fetchCommandCenterOverview = () =>
  apiFetch<CommandCenterOverviewResponse>("/api/command-center/overview");

export const fetchCommandCenterControl = () =>
  apiFetch<CommandCenterControlResponse>("/api/command-center/control");

export const fetchCommandCenterDemand = () =>
  apiFetch<CommandCenterDemandResponse>("/api/command-center/demand");

export const fetchMilestonesLatest = (params?: { limit?: number }) => {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();
  return apiFetch<MilestoneFeedResponse>(`/api/milestones/latest${query ? `?${query}` : ""}`);
};

export const fetchCommandCenterDemandLive = () =>
  apiFetch<CommandCenterDemandResponse>("/api/command-center/demand-live");

export const fetchMilestonesDeadLetter = () =>
  apiFetch<MilestoneDeadLetterResponse>("/api/milestones/dead-letter");
