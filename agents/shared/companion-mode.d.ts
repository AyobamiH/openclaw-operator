// Generated from orchestrator/src/companion-mode.ts; run npm run agents:runtime-evidence:sync.
/** Operator read-side mode, shared with the operations analyst. */
export declare function buildCompanionControlPlaneMode(args: {
    openIncidentCount: number;
    criticalIncidentCount: number;
    pendingApprovalsCount: number;
    queueQueued: number;
    queueProcessing: number;
    proofStatus: "healthy" | "watching" | "degraded";
    dominantClassification: string | null;
}): {
    label: string;
    route: string;
    tone: "warning" | "info" | "healthy";
    detail: string;
};
