import { buildIncidentDetail, type IncidentDetailVM } from "@/lib/incident-view";
import type { RunRowVM } from "@/lib/task-runs";
import { str } from "@/lib/safe-render";
import type { PendingApprovalItem, RuntimeIncident } from "@/types/console";

export interface RunApprovalHandoffVM {
  taskId: string;
  route: string;
  type: string;
  status: string;
  requestedAt: string | null;
  riskLevel: string;
  dependencyClass: string;
  approvalReason: string | null;
  purpose: string | null;
  replayBehavior: string | null;
  affectedSurfaces: string[];
  foundInQueue: boolean;
  summary: string;
}

export interface RunIncidentHandoffVM {
  incidentId: string;
  route: string;
  title: string;
  severity: string;
  status: string;
  remediationStatus: string;
  truthLayer: string;
  owner: string | null;
  nextAction: string;
  verificationStatus: string;
  linkedSignals: string[];
  remediationTaskType: string | null;
  remediationTaskId: string | null;
  remediationRunId: string | null;
  additionalCount: number;
  foundInLedger: boolean;
  summary: string;
}

export interface RunHandoffContextVM {
  approval: RunApprovalHandoffVM | null;
  incident: RunIncidentHandoffVM | null;
}

function buildApprovalsRoute(taskId: string, runId: string) {
  const params = new URLSearchParams();
  params.set("taskId", taskId);
  params.set("fromRunId", runId);
  return `/approvals?${params.toString()}`;
}

function buildIncidentsRoute(args: {
  incidentId?: string | null;
  taskId?: string | null;
  runId: string;
}) {
  const params = new URLSearchParams();
  params.set("runId", args.runId);
  if (args.incidentId) {
    params.set("incidentId", args.incidentId);
  }
  if (args.taskId) {
    params.set("taskId", args.taskId);
  }
  return `/incidents?${params.toString()}`;
}

function severityScore(value: string) {
  if (value === "critical") return 30;
  if (value === "warning") return 20;
  return 10;
}

function statusScore(value: string) {
  if (value === "active") return 20;
  if (value === "watching") return 10;
  return 0;
}

function buildApprovalHandoff(run: RunRowVM, approvals: PendingApprovalItem[]) {
  if (!run.taskId) {
    return null;
  }

  const approval = approvals.find((item) => item.taskId === run.taskId) ?? null;
  const route = buildApprovalsRoute(run.taskId, run.runId);

  if (!approval) {
    if (!run.approval.required) {
      return null;
    }

    return {
      taskId: run.taskId,
      route,
      type: run.type,
      status: run.approval.status ?? "pending",
      requestedAt: run.approval.requestedAt,
      riskLevel: "unknown",
      dependencyClass: "unknown",
      approvalReason: null,
      purpose: null,
      replayBehavior: null,
      affectedSurfaces: [],
      foundInQueue: false,
      summary:
        "This run is still approval-gated, but the pending approval record is no longer visible in the current inbox snapshot.",
    } satisfies RunApprovalHandoffVM;
  }

  return {
    taskId: approval.taskId,
    route,
    type: approval.type,
    status: approval.status,
    requestedAt: approval.requestedAt,
    riskLevel: str(approval.impact?.riskLevel, "medium"),
    dependencyClass: str(approval.impact?.dependencyClass, "worker"),
    approvalReason:
      typeof approval.impact?.approvalReason === "string" ? approval.impact.approvalReason : null,
    purpose: typeof approval.impact?.purpose === "string" ? approval.impact.purpose : null,
    replayBehavior:
      typeof approval.impact?.replayBehavior === "string" ? approval.impact.replayBehavior : null,
    affectedSurfaces: Array.isArray(approval.impact?.affectedSurfaces)
      ? approval.impact?.affectedSurfaces.filter((value): value is string => typeof value === "string")
      : [],
    foundInQueue: true,
    summary:
      typeof approval.impact?.purpose === "string" && approval.impact.purpose.length > 0
        ? approval.impact.purpose
        : `Approval is still pending for ${approval.type}. Review the exact request before resuming execution.`,
  };
}

function buildIncidentMatchSignal(args: {
  incident: IncidentDetailVM;
  run: RunRowVM;
  remediationTask: IncidentDetailVM["remediationTasks"][number] | null;
}) {
  const signals: string[] = [];
  const repairId = str(args.run.repair?.repairId, "");

  if (args.incident.linkedRunIds.includes(args.run.runId)) {
    signals.push("linked run");
  }
  if (args.run.taskId && args.incident.linkedTaskIds.includes(args.run.taskId)) {
    signals.push("linked task");
  }
  if (repairId && args.incident.linkedRepairIds.includes(repairId)) {
    signals.push("linked repair");
  }
  if (args.remediationTask) {
    signals.push("remediation ledger");
  }

  return signals;
}

function buildIncidentScore(args: {
  incident: IncidentDetailVM;
  run: RunRowVM;
  remediationTask: IncidentDetailVM["remediationTasks"][number] | null;
}) {
  let score = severityScore(args.incident.severity) + statusScore(args.incident.status);
  const repairId = str(args.run.repair?.repairId, "");

  if (args.incident.linkedRunIds.includes(args.run.runId)) score += 60;
  if (args.run.taskId && args.incident.linkedTaskIds.includes(args.run.taskId)) score += 45;
  if (repairId && args.incident.linkedRepairIds.includes(repairId)) {
    score += 35;
  }
  if (args.remediationTask?.runId === args.run.runId) score += 30;
  if (args.run.taskId && args.remediationTask?.taskId === args.run.taskId) score += 20;

  return score;
}

function buildIncidentHandoff(args: {
  run: RunRowVM;
  incidents: RuntimeIncident[];
  runResult?: unknown;
}) {
  const mappedIncidents = args.incidents
    .map((incident) => buildIncidentDetail(incident))
    .filter((incident): incident is IncidentDetailVM => incident !== null)
    .map((incident) => {
      const remediationTask =
        incident.remediationTasks.find(
          (task) =>
            task.runId === args.run.runId ||
            (args.run.taskId !== null && task.taskId === args.run.taskId),
        ) ?? null;
      const linkedSignals = buildIncidentMatchSignal({
        incident,
        run: args.run,
        remediationTask,
      });

      return {
        incident,
        remediationTask,
        linkedSignals,
        score: buildIncidentScore({
          incident,
          run: args.run,
          remediationTask,
        }),
      };
    })
    .filter((entry) => entry.linkedSignals.length > 0)
    .sort((left, right) => right.score - left.score);

  const closureContract =
    args.runResult && typeof args.runResult === "object"
      ? ((args.runResult as { closureContract?: unknown }).closureContract as
          | Record<string, unknown>
          | undefined)
      : undefined;
  const fallbackIncidentId =
    str(closureContract?.targetKind, "") === "incident"
      ? str(closureContract?.targetId, "")
      : "";

  const topMatch = mappedIncidents[0] ?? null;
  if (!topMatch) {
    if (!fallbackIncidentId) {
      return null;
    }

    return {
      incidentId: fallbackIncidentId,
      route: buildIncidentsRoute({
        incidentId: fallbackIncidentId,
        taskId: args.run.taskId,
        runId: args.run.runId,
      }),
      title: fallbackIncidentId,
      severity: "warning",
      status: "watching",
      remediationStatus: "watching",
      truthLayer: "observed",
      owner: null,
      nextAction: "Open the incident queue and confirm whether the linked incident is still open.",
      verificationStatus: "unknown",
      linkedSignals: ["contract target"],
      remediationTaskType: null,
      remediationTaskId: null,
      remediationRunId: null,
      additionalCount: 0,
      foundInLedger: false,
      summary:
        "The run result points at a linked incident, but that incident was not present in the current incident ledger snapshot.",
    } satisfies RunIncidentHandoffVM;
  }

  return {
    incidentId: topMatch.incident.id,
    route: buildIncidentsRoute({
      incidentId: topMatch.incident.id,
      taskId: args.run.taskId,
      runId: args.run.runId,
    }),
    title: topMatch.incident.title,
    severity: topMatch.incident.severity,
    status: topMatch.incident.status,
    remediationStatus: topMatch.incident.remediationStatus,
    truthLayer: topMatch.incident.truthLayer,
    owner: topMatch.incident.owner,
    nextAction: topMatch.incident.nextAction,
    verificationStatus: topMatch.incident.verification.status,
    linkedSignals: topMatch.linkedSignals,
    remediationTaskType: topMatch.remediationTask?.taskType ?? null,
    remediationTaskId: topMatch.remediationTask?.taskId ?? null,
    remediationRunId: topMatch.remediationTask?.runId ?? null,
    additionalCount: Math.max(0, mappedIncidents.length - 1),
    foundInLedger: true,
    summary:
      `${topMatch.incident.title} already links this run through ${topMatch.linkedSignals.join(", ")}.`,
  };
}

// This keeps the run-detail UI grounded in live cross-surface truth instead of
// treating approvals/incidents as generic destinations with no specific context.
export function buildRunHandoffContext(args: {
  run: RunRowVM | null;
  pendingApprovals?: PendingApprovalItem[] | null;
  incidents?: RuntimeIncident[] | null;
  runResult?: unknown;
}): RunHandoffContextVM | null {
  if (!args.run) {
    return null;
  }

  const approval = buildApprovalHandoff(args.run, args.pendingApprovals ?? []);
  const incident = buildIncidentHandoff({
    run: args.run,
    incidents: args.incidents ?? [],
    runResult: args.runResult,
  });

  if (!approval && !incident) {
    return null;
  }

  return {
    approval,
    incident,
  };
}
