// Real API layer for OpenClaw Operator Console
// Calls live backend endpoints per Integration Contract V1

import { apiFetch, apiFetchText } from "@/lib/api-client";
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
  BusinessOverviewResponse,
  BusinessCyclesResponse,
  BusinessControlResponse,
  BusinessCycle,
  ReviewSessionDetailResponse,
  ReviewSessionsOverviewResponse,
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

// ── Business Value Operations ──
export const fetchBusinessOverview = () =>
  apiFetch<BusinessOverviewResponse>("/api/business/overview");

export const fetchBusinessCycles = () =>
  apiFetch<BusinessCyclesResponse>("/api/business/cycles");

export const fetchBusinessCycle = (cycleId: string) =>
  apiFetch<{ generatedAt: string; cycle: BusinessCycle }>(
    `/api/business/cycles/${encodeURIComponent(cycleId)}`,
  );

export const triggerBusinessCycle = () =>
  apiFetch<BusinessControlResponse>("/api/business/cycle/trigger", {
    method: "POST",
    body: JSON.stringify({}),
  });

export const updateBusinessScheduler = (
  action: "pause" | "resume" | "disable" | "enable",
) =>
  apiFetch<BusinessControlResponse>("/api/business/scheduler", {
    method: "POST",
    body: JSON.stringify({ action }),
  });

export const retryBusinessCycle = (cycleId: string) =>
  apiFetch<BusinessControlResponse>(
    `/api/business/cycles/${encodeURIComponent(cycleId)}/retry`,
    { method: "POST", body: JSON.stringify({}) },
  );

// ── Task Runs (viewer) ──
export const fetchTaskRuns = (params?: { type?: string; status?: string; limit?: number; offset?: number }) => {
  const qs = new URLSearchParams();
  if (params?.type) qs.set("type", params.type);
  if (params?.status) qs.set("status", params.status);
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

export const fetchReviewSessions = () =>
  apiFetch<ReviewSessionsOverviewResponse>("/api/review-sessions");

export const fetchReviewSessionDetail = (id: string) =>
  apiFetch<ReviewSessionDetailResponse>(
    `/api/review-sessions/${encodeURIComponent(id)}`,
  );

export const updateReviewSessionBucket = (
  id: string,
  body: { bucket: string; note?: string },
) =>
  apiFetch<{ status: "ok"; session: ReviewSessionDetailResponse["session"] }>(
    `/api/review-sessions/${encodeURIComponent(id)}/bucket`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const addReviewSessionNote = (
  id: string,
  body: { bucket: string; text: string },
) =>
  apiFetch<{ status: "ok"; session: ReviewSessionDetailResponse["session"] }>(
    `/api/review-sessions/${encodeURIComponent(id)}/note`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

export const linkReviewSessionRun = (id: string, runId: string) =>
  apiFetch<{ status: "ok"; session: ReviewSessionDetailResponse["session"] }>(
    `/api/review-sessions/${encodeURIComponent(id)}/link-run`,
    {
      method: "POST",
      body: JSON.stringify({ runId }),
    },
  );

export const stopReviewSession = (id: string) =>
  apiFetch<{ status: "ok"; session: ReviewSessionDetailResponse["session"] }>(
    `/api/review-sessions/${encodeURIComponent(id)}/stop`,
    {
      method: "POST",
    },
  );

export const exportReviewSession = async (
  id: string,
  format: "json" | "markdown",
): Promise<string> => {
  const path = `/api/review-sessions/${encodeURIComponent(id)}/export?format=${format}`;
  if (format === "markdown") {
    return apiFetchText(path);
  }
  const payload = await apiFetch<ReviewSessionDetailResponse>(path);
  return JSON.stringify(payload, null, 2);
};
