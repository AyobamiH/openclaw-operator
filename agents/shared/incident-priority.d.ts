// Generated from orchestrator/src/incident-priority.ts; run npm run agents:runtime-evidence:sync.
/** Structural read contract shared by persisted ledgers and partial agent evidence. */
export interface IncidentPriorityInput {
    incidentId?: string;
    classification?: string;
    severity?: string;
    status?: string;
    owner?: string | null;
    summary?: string;
    recommendedSteps?: string[];
    affectedSurfaces?: string[];
    linkedServiceIds?: string[];
    policy?: {
        preferredOwner?: string;
        remediationTaskType?: string;
    };
    escalation?: {
        level?: string;
    };
    verification?: {
        status?: string;
    };
    remediation?: {
        nextAction?: string;
        blockers?: string[];
    };
    remediationTasks?: Array<{
        status?: string;
        blockers?: string[];
    }>;
}
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
export declare function buildIncidentPriorityQueue(incidents: IncidentPriorityInput[]): IncidentPriorityRecord[];
