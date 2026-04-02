import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchDashboardOverview,
  fetchHealth,
  fetchPersistenceHealth,
  fetchExtendedHealth,
  fetchPersistenceSummary,
  fetchTaskCatalog,
  triggerTask,
  fetchTaskRuns,
  fetchTaskRunDetail,
  fetchPendingApprovals,
  submitApprovalDecision,
  acknowledgeIncident,
  assignIncidentOwner,
  fetchIncidents,
  fetchIncidentDetail,
  remediateIncident,
  fetchAgentsOverview,
  fetchKnowledgeSummary,
  fetchSkillsPolicy,
  fetchSkillsRegistry,
  fetchSkillsTelemetry,
  fetchSkillsAudit,
  fetchMemoryRecall,
  submitKnowledgeQuery,
} from "@/lib/api";
import type { KnowledgeQueryRequest } from "@/types/console";
import { jitteredInterval, nextProtectedPollInterval } from "@/lib/polling";

export function useDashboardOverview() {
  return useQuery({
    queryKey: ["dashboard-overview"],
    queryFn: fetchDashboardOverview,
    refetchInterval: (query) => nextProtectedPollInterval(30000, query.state.error as { status?: number } | null),
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: () => jitteredInterval(15000),
  });
}

export function usePersistenceHealth() {
  return useQuery({
    queryKey: ["persistence-health"],
    queryFn: fetchPersistenceHealth,
    refetchInterval: () => jitteredInterval(30000),
  });
}

export function useExtendedHealth() {
  return useQuery({
    queryKey: ["health-extended"],
    queryFn: fetchExtendedHealth,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
}

export function usePersistenceSummary() {
  return useQuery({
    queryKey: ["persistence-summary"],
    queryFn: fetchPersistenceSummary,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
}

export function useTaskCatalog() {
  return useQuery({
    queryKey: ["tasks-catalog"],
    queryFn: fetchTaskCatalog,
  });
}

export function useTriggerTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, payload }: { type: string; payload?: Record<string, unknown> }) =>
      triggerTask(type, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard-overview"] });
      qc.invalidateQueries({ queryKey: ["tasks-runs"] });
    },
  });
}

export function useTaskRuns(params?: {
  type?: string;
  status?: string;
  includeInternal?: boolean;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ["tasks-runs", params],
    queryFn: () => fetchTaskRuns(params),
    refetchInterval: (query) => nextProtectedPollInterval(15000, query.state.error as { status?: number } | null),
  });
}

export function useTaskRunDetail(runId: string | null) {
  return useQuery({
    queryKey: ["tasks-run-detail", runId],
    queryFn: () => fetchTaskRunDetail(runId!),
    enabled: !!runId,
  });
}

export function usePendingApprovals() {
  return useQuery({
    queryKey: ["approvals-pending"],
    queryFn: fetchPendingApprovals,
    refetchInterval: (query) => nextProtectedPollInterval(15000, query.state.error as { status?: number } | null),
  });
}

export function useApprovalDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, actor, note }: { id: string; decision: "approved" | "rejected"; actor?: string; note?: string }) =>
      submitApprovalDecision(id, decision, actor, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals-pending"] });
      qc.invalidateQueries({ queryKey: ["dashboard-overview"] });
    },
  });
}

export function useIncidentAcknowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, actor, note }: { id: string; actor?: string; note?: string }) =>
      acknowledgeIncident(id, actor, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard-overview"] });
      qc.invalidateQueries({ queryKey: ["health-extended"] });
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["incident-detail"] });
    },
  });
}

export function useIncidentOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      owner,
      actor,
      note,
    }: {
      id: string;
      owner: string;
      actor?: string;
      note?: string;
    }) => assignIncidentOwner(id, { owner, actor, note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard-overview"] });
      qc.invalidateQueries({ queryKey: ["health-extended"] });
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["incident-detail"] });
    },
  });
}

export function useIncidents(params?: {
  status?: string;
  classification?: string;
  includeResolved?: boolean;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ["incidents", params],
    queryFn: () => fetchIncidents(params),
    refetchInterval: (query) => nextProtectedPollInterval(30000, query.state.error as { status?: number } | null),
  });
}

export function useIncidentDetail(id: string | null) {
  return useQuery({
    queryKey: ["incident-detail", id],
    queryFn: () => fetchIncidentDetail(id!),
    enabled: !!id,
    refetchOnWindowFocus: false,
  });
}

export function useIncidentRemediate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      actor,
      note,
      taskType,
    }: {
      id: string;
      actor?: string;
      note?: string;
      taskType?: "build-refactor" | "drift-repair" | "qa-verification" | "system-monitor";
    }) => remediateIncident(id, { actor, note, taskType }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard-overview"] });
      qc.invalidateQueries({ queryKey: ["health-extended"] });
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["incident-detail"] });
      qc.invalidateQueries({ queryKey: ["tasks-runs"] });
    },
  });
}

export function useAgentsOverview() {
  return useQuery({
    queryKey: ["agents-overview"],
    queryFn: fetchAgentsOverview,
  });
}

export function useKnowledgeSummary() {
  return useQuery({
    queryKey: ["knowledge-summary"],
    queryFn: fetchKnowledgeSummary,
  });
}

export function useSkillsPolicy() {
  return useQuery({
    queryKey: ["skills-policy"],
    queryFn: fetchSkillsPolicy,
  });
}

export function useSkillsRegistry() {
  return useQuery({
    queryKey: ["skills-registry"],
    queryFn: fetchSkillsRegistry,
  });
}

export function useSkillsTelemetry() {
  return useQuery({
    queryKey: ["skills-telemetry"],
    queryFn: fetchSkillsTelemetry,
  });
}

export function useSkillsAudit(params?: { limit?: number; offset?: number; deniedOnly?: boolean }) {
  return useQuery({
    queryKey: ["skills-audit", params],
    queryFn: () => fetchSkillsAudit(params),
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
}

export function useMemoryRecall(params?: {
  agentId?: string;
  limit?: number;
  offset?: number;
  includeErrors?: boolean;
  includeSensitive?: boolean;
}) {
  return useQuery({
    queryKey: ["memory-recall", params],
    queryFn: () => fetchMemoryRecall(params),
    refetchOnWindowFocus: false,
  });
}

export function useKnowledgeQuery() {
  return useMutation({
    mutationFn: (body: KnowledgeQueryRequest) => submitKnowledgeQuery(body),
  });
}
