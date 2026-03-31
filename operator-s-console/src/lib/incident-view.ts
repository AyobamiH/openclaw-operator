import { num, str, toArray, toNullableString } from "@/lib/safe-render";
import type { RuntimeIncidentModel } from "@/types/console";

export interface IncidentSummaryVM {
  overallStatus: string;
  openCount: number;
  activeCount: number;
  watchingCount: number;
  critical: number;
  warning: number;
  info: number;
}

export interface IncidentListItemVM {
  id: string;
  title: string;
  classification: string;
  severity: string;
  status: string;
  truthLayer: string;
  summary: string;
  owner: string | null;
  acknowledgedAt: string | null;
  lastSeenAt: string | null;
  escalationStatus: string;
  escalationDueAt: string | null;
  verificationRequired: boolean;
  verificationStatus: string;
  hasRemediationTask: boolean;
  remediationStatus: string;
}

export interface IncidentDetailVM extends IncidentListItemVM {
  firstSeenAt: string | null;
  resolvedAt: string | null;
  acknowledgedBy: string | null;
  acknowledgementNote: string | null;
  recommendedSteps: string[];
  blockers: string[];
  affectedSurfaces: string[];
  linkedProofDeliveries: string[];
  linkedServiceIds: string[];
  linkedTaskIds: string[];
  linkedRunIds: string[];
  linkedRepairIds: string[];
  evidence: string[];
  nextAction: string;
  remediationOwner: string;
  policy: {
    policyId: string | null;
    preferredOwner: string | null;
    remediationTaskType: string | null;
    verifierTaskType: string | null;
    targetSlaMinutes: number;
    escalationMinutes: number;
  };
  escalation: {
    level: string;
    status: string;
    dueAt: string | null;
    escalateAt: string | null;
    escalatedAt: string | null;
    breachedAt: string | null;
    summary: string;
  };
  verification: {
    required: boolean;
    agentId: string | null;
    status: string;
    summary: string;
    verificationTaskId: string | null;
    verificationRunId: string | null;
    verifiedAt: string | null;
  };
  remediationPlan: Array<{
    stepId: string;
    title: string;
    kind: string;
    owner: string;
    status: string;
    description: string;
    taskType: string | null;
    dependsOn: string[];
    startedAt: string | null;
    completedAt: string | null;
    evidence: string[];
  }>;
  history: Array<{
    eventId: string;
    timestamp: string | null;
    type: string;
    actor: string | null;
    summary: string;
    detail: string;
    evidence: string[];
  }>;
  acknowledgements: Array<{
    acknowledgedAt: string | null;
    acknowledgedBy: string | null;
    note: string | null;
  }>;
  ownershipHistory: Array<{
    assignedAt: string | null;
    actor: string | null;
    owner: string | null;
    note: string | null;
  }>;
  remediationTasks: Array<{
    remediationId: string;
    createdAt: string | null;
    createdBy: string | null;
    assignedTo: string | null;
    assignedAt: string | null;
    taskType: string;
    taskId: string;
    runId: string;
    status: string;
    reason: string;
    note: string | null;
    executionStartedAt: string | null;
    executionCompletedAt: string | null;
    verificationStartedAt: string | null;
    verificationCompletedAt: string | null;
    verifiedAt: string | null;
    resolvedAt: string | null;
    lastUpdatedAt: string | null;
    verificationSummary: string | null;
    resolutionSummary: string | null;
    blockers: string[];
  }>;
}

export function buildIncidentSummary(incidents: RuntimeIncidentModel | null | undefined): IncidentSummaryVM {
  return {
    overallStatus: str(incidents?.overallStatus, "stable"),
    openCount: num(incidents?.openCount),
    activeCount: num(incidents?.activeCount),
    watchingCount: num(incidents?.watchingCount),
    critical: num(incidents?.bySeverity?.critical),
    warning: num(incidents?.bySeverity?.warning),
    info: num(incidents?.bySeverity?.info),
  };
}

export function buildIncidentRow(item: any): IncidentListItemVM {
  return {
    id: str(item?.id, ""),
    title: str(item?.title, "Untitled incident"),
    classification: str(item?.classification, "runtime-mode"),
    severity: str(item?.severity, "warning"),
    status: str(item?.status, "active"),
    truthLayer: str(item?.truthLayer, "observed"),
    summary: str(item?.summary, "No incident summary available."),
    owner: toNullableString(item?.owner),
    acknowledgedAt: toNullableString(item?.acknowledgedAt),
    lastSeenAt: toNullableString(item?.lastSeenAt),
    escalationStatus: str(item?.escalation?.status, "tracking"),
    escalationDueAt: toNullableString(item?.escalation?.dueAt),
    verificationRequired: item?.verification?.required === true,
    verificationStatus: str(item?.verification?.status, "not-required"),
    hasRemediationTask: toArray(item?.remediationTasks).length > 0,
    remediationStatus: str(item?.remediation?.status, "watching"),
  };
}

export function buildIncidentDetail(item: any): IncidentDetailVM | null {
  if (!item) return null;

  const base = buildIncidentRow(item);

  return {
    ...base,
    firstSeenAt: toNullableString(item?.firstSeenAt),
    resolvedAt: toNullableString(item?.resolvedAt),
    acknowledgedBy: toNullableString(item?.acknowledgedBy),
    acknowledgementNote: toNullableString(item?.acknowledgementNote),
    recommendedSteps: toArray<string>(item?.recommendedSteps).map((entry) => str(entry, "")),
    blockers: toArray<string>(item?.remediation?.blockers).map((entry) => str(entry, "")),
    affectedSurfaces: toArray<string>(item?.affectedSurfaces).map((entry) => str(entry, "")),
    linkedProofDeliveries: toArray<string>(item?.linkedProofDeliveries).map((entry) => str(entry, "")),
    linkedServiceIds: toArray<string>(item?.linkedServiceIds).map((entry) => str(entry, "")),
    linkedTaskIds: toArray<string>(item?.linkedTaskIds).map((entry) => str(entry, "")),
    linkedRunIds: toArray<string>(item?.linkedRunIds).map((entry) => str(entry, "")),
    linkedRepairIds: toArray<string>(item?.linkedRepairIds).map((entry) => str(entry, "")),
    evidence: toArray<string>(item?.evidence).map((entry) => str(entry, "")),
    nextAction: str(item?.remediation?.nextAction, "Review the incident and continue remediation."),
    remediationOwner: str(item?.remediation?.owner, "operator"),
    policy: {
      policyId: toNullableString(item?.policy?.policyId),
      preferredOwner: toNullableString(item?.policy?.preferredOwner),
      remediationTaskType: toNullableString(item?.policy?.remediationTaskType),
      verifierTaskType: toNullableString(item?.policy?.verifierTaskType),
      targetSlaMinutes: num(item?.policy?.targetSlaMinutes),
      escalationMinutes: num(item?.policy?.escalationMinutes),
    },
    escalation: {
      level: str(item?.escalation?.level, "normal"),
      status: str(item?.escalation?.status, "tracking"),
      dueAt: toNullableString(item?.escalation?.dueAt),
      escalateAt: toNullableString(item?.escalation?.escalateAt),
      escalatedAt: toNullableString(item?.escalation?.escalatedAt),
      breachedAt: toNullableString(item?.escalation?.breachedAt),
      summary: str(item?.escalation?.summary, "No escalation state recorded."),
    },
    verification: {
      required: item?.verification?.required === true,
      agentId: toNullableString(item?.verification?.agentId),
      status: str(item?.verification?.status, "not-required"),
      summary: str(item?.verification?.summary, "No verification state recorded."),
      verificationTaskId: toNullableString(item?.verification?.verificationTaskId),
      verificationRunId: toNullableString(item?.verification?.verificationRunId),
      verifiedAt: toNullableString(item?.verification?.verifiedAt),
    },
    remediationPlan: toArray(item?.remediationPlan).map((entry: any, index: number) => ({
      stepId: str(entry?.stepId, `${str(item?.id, "incident")}-plan-${index}`),
      title: str(entry?.title, `Step ${index + 1}`),
      kind: str(entry?.kind, "step"),
      owner: str(entry?.owner, "operator"),
      status: str(entry?.status, "pending"),
      description: str(entry?.description, "No step description recorded."),
      taskType: toNullableString(entry?.taskType),
      dependsOn: toArray<string>(entry?.dependsOn).map((value) => str(value, "")),
      startedAt: toNullableString(entry?.startedAt),
      completedAt: toNullableString(entry?.completedAt),
      evidence: toArray<string>(entry?.evidence).map((value) => str(value, "")),
    })),
    history: toArray(item?.history).map((entry: any, index: number) => ({
      eventId: str(entry?.eventId, `${str(item?.id, "incident")}-history-${index}`),
      timestamp: toNullableString(entry?.timestamp),
      type: str(entry?.type, "history"),
      actor: toNullableString(entry?.actor),
      summary: str(entry?.summary, "No summary recorded."),
      detail: str(entry?.detail, "No detail recorded."),
      evidence: toArray<string>(entry?.evidence).map((value) => str(value, "")),
    })),
    acknowledgements: toArray(item?.acknowledgements).map((entry: any) => ({
      acknowledgedAt: toNullableString(entry?.acknowledgedAt),
      acknowledgedBy: toNullableString(entry?.acknowledgedBy),
      note: toNullableString(entry?.note),
    })),
    ownershipHistory: toArray(item?.ownershipHistory).map((entry: any) => ({
      assignedAt: toNullableString(entry?.assignedAt),
      actor: toNullableString(entry?.actor),
      owner: toNullableString(entry?.owner),
      note: toNullableString(entry?.note),
    })),
    remediationTasks: toArray(item?.remediationTasks).map((entry: any) => ({
      remediationId: str(entry?.remediationId, ""),
      createdAt: toNullableString(entry?.createdAt),
      createdBy: toNullableString(entry?.createdBy),
      assignedTo: toNullableString(entry?.assignedTo),
      assignedAt: toNullableString(entry?.assignedAt),
      taskType: str(entry?.taskType, "unknown"),
      taskId: str(entry?.taskId, "unknown"),
      runId: str(entry?.runId, "unknown"),
      status: str(entry?.status, "queued"),
      reason: str(entry?.reason, "No remediation reason recorded."),
      note: toNullableString(entry?.note),
      executionStartedAt: toNullableString(entry?.executionStartedAt),
      executionCompletedAt: toNullableString(entry?.executionCompletedAt),
      verificationStartedAt: toNullableString(entry?.verificationStartedAt),
      verificationCompletedAt: toNullableString(entry?.verificationCompletedAt),
      verifiedAt: toNullableString(entry?.verifiedAt),
      resolvedAt: toNullableString(entry?.resolvedAt),
      lastUpdatedAt: toNullableString(entry?.lastUpdatedAt),
      verificationSummary: toNullableString(entry?.verificationSummary),
      resolutionSummary: toNullableString(entry?.resolutionSummary),
      blockers: toArray<string>(entry?.blockers).map((value) => str(value, "")),
    })),
  };
}
