// Generated from orchestrator/src/companion-mode.ts; run npm run agents:runtime-evidence:sync.
/** Operator read-side mode, shared with the operations analyst. */
export function buildCompanionControlPlaneMode(args) {
    if (args.criticalIncidentCount > 0 || args.openIncidentCount >= 5) {
        return {
            label: "Incident Storm",
            route: "/incidents",
            tone: "warning",
            detail: args.dominantClassification
                ? `${args.dominantClassification} is dominating the runtime, so incident ownership, remediation, and verification outrank smaller backlog concerns.`
                : "Incident pressure is dominating the runtime, so incident ownership, remediation, and verification outrank smaller backlog concerns.",
        };
    }
    if (args.pendingApprovalsCount > 0) {
        return {
            label: "Review-Gated",
            route: "/approvals",
            tone: "info",
            detail: "Execution truth is live, but the next bounded work is paused behind operator review.",
        };
    }
    if (args.proofStatus !== "healthy") {
        return {
            label: "Proof Lag",
            route: "/public-proof",
            tone: "info",
            detail: "Internal runtime truth is ahead of the public evidence surface, so proof reconciliation outranks external claims.",
        };
    }
    if (args.queueQueued > 0 || args.queueProcessing > 0) {
        return {
            label: "Active Queue",
            route: "/task-runs",
            tone: "healthy",
            detail: "The control plane is actively processing bounded work without a stronger failure mode outranking the run ledger.",
        };
    }
    return {
        label: "Steady State",
        route: "/tasks",
        tone: "healthy",
        detail: "No dominant operator intervention is currently outranking routine bounded work.",
    };
}
