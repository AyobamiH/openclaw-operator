import type { IncidentLedgerRecord } from "./types.js";

export interface IncidentPriorityRecord {
  incidentId: string;
  classification: string | null;
  severity: string;
  status: string;
  owner: string | null;
  recommendedOwner: string | null;
  escalationLevel: string | null;
  verificationStatus: string | null;
  priorityScore: number;
  summary: string;
  nextAction: string;
  blockers: string[];
  remediationTaskType: string | null;
  affectedSurfaces: string[];
  linkedServiceIds: string[];
}

function severityRank(severity: string | undefined | null) {
  switch ((severity ?? "").toLowerCase()) {
    case "critical":
      return 40;
    case "warning":
      return 20;
    case "info":
      return 10;
    default:
      return 5;
  }
}

function escalationRank(level: string | undefined | null) {
  switch ((level ?? "").toLowerCase()) {
    case "breached":
      return 30;
    case "escalated":
      return 20;
    case "warning":
      return 10;
    default:
      return 0;
  }
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)),
  );
}

export function buildIncidentPriorityQueue(
  incidents: IncidentLedgerRecord[],
): IncidentPriorityRecord[] {
  return incidents
    .filter((incident) => incident.status !== "resolved")
    .map((incident) => {
      const severity = typeof incident.severity === "string" ? incident.severity : "warning";
      const escalationLevel =
        typeof incident.escalation?.level === "string" ? incident.escalation.level : null;
      const owner =
        typeof incident.owner === "string" && incident.owner.length > 0 ? incident.owner : null;
      const recommendedOwner =
        typeof incident.policy?.preferredOwner === "string" &&
        incident.policy.preferredOwner.length > 0
          ? incident.policy.preferredOwner
          : owner;
      const blockers = uniqueStrings([
        ...(Array.isArray(incident.remediation?.blockers) ? incident.remediation.blockers : []),
        ...(incident.remediationTasks ?? []).flatMap((task) =>
          Array.isArray(task.blockers) ? task.blockers : [],
        ),
      ]);
      const summary =
        typeof incident.summary === "string" && incident.summary.length > 0
          ? incident.summary
          : `Open ${incident.classification ?? "runtime"} incident`;
      const nextAction =
        typeof incident.remediation?.nextAction === "string" &&
        incident.remediation.nextAction.length > 0
          ? incident.remediation.nextAction
          : Array.isArray(incident.recommendedSteps) && incident.recommendedSteps.length > 0
            ? incident.recommendedSteps[0]
            : "Inspect incident evidence and drive remediation to closure.";

      let priorityScore = severityRank(severity) + escalationRank(escalationLevel);
      if (!owner) priorityScore += 8;
      if (
        (incident.remediationTasks ?? []).some(
          (task) => task.status === "blocked" || task.status === "failed",
        )
      ) {
        priorityScore += 6;
      }
      if (blockers.length > 0) priorityScore += 4;

      return {
        incidentId: incident.incidentId ?? "unknown-incident",
        classification:
          typeof incident.classification === "string" ? incident.classification : null,
        severity,
        status: typeof incident.status === "string" ? incident.status : "active",
        owner,
        recommendedOwner,
        escalationLevel,
        verificationStatus:
          typeof incident.verification?.status === "string"
            ? incident.verification.status
            : null,
        priorityScore,
        summary,
        nextAction,
        blockers,
        remediationTaskType:
          typeof incident.policy?.remediationTaskType === "string"
            ? incident.policy.remediationTaskType
            : null,
        affectedSurfaces: uniqueStrings(
          Array.isArray(incident.affectedSurfaces) ? incident.affectedSurfaces : [],
        ),
        linkedServiceIds: uniqueStrings(
          Array.isArray(incident.linkedServiceIds) ? incident.linkedServiceIds : [],
        ),
      };
    })
    .sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      return left.incidentId.localeCompare(right.incidentId);
    });
}
