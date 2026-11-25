/** Operator read-side mode, shared with the operations analyst. */
export function buildCompanionControlPlaneMode(args: {
  openIncidentCount: number;
  criticalIncidentCount: number;
  pendingApprovalsCount: number;
  queueQueued: number;
  queueProcessing: number;
  proofStatus: "healthy" | "watching" | "degraded";
  dominantClassification: string | null;
}): { label: string; route: string; tone: "warning" | "info" | "healthy"; detail: string } {
  if (args.criticalIncidentCount > 0 || args.openIncidentCount >= 5) {
    return {
      label: "Incident Storm",
      route: "/incidents",
      tone: "warning" as const,
      detail: args.dominantClassification
        ? `${args.dominantClassification} is dominating the runtime, so incident ownership, remediation, and verification outrank smaller backlog concerns.`
        : "Incident pressure is dominating the runtime, so incident ownership, remediation, and verification outrank smaller backlog concerns.",
    };
  }

  if (args.pendingApprovalsCount > 0) {
    return {
      label: "Review-Gated",
      route: "/approvals",
      tone: "info" as const,
      detail:
        "Execution truth is live, but the next bounded work is paused behind operator review.",
    };
  }

  if (args.proofStatus !== "healthy") {
    return {
      label: "Proof Lag",
      route: "/public-proof",
      tone: "info" as const,
      detail:
        "Internal runtime truth is ahead of the public evidence surface, so proof reconciliation outranks external claims.",
    };
  }

  if (args.queueQueued > 0 || args.queueProcessing > 0) {
    return {
      label: "Active Queue",
      route: "/task-runs",
      tone: "healthy" as const,
      detail:
        "The control plane is actively processing bounded work without a stronger failure mode outranking the run ledger.",
    };
  }

  return {
    label: "Steady State",
    route: "/tasks",
    tone: "healthy" as const,
    detail:
      "No dominant operator intervention is currently outranking routine bounded work.",
  };
}
