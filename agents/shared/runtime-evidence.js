import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
let runtimeStateMongoClientFactory = null;
export async function readJsonFile(targetPath, fallback) {
    try {
        const raw = await readFile(targetPath, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
function isMongoStateTarget(targetPath) {
    return targetPath.startsWith("mongo:");
}
function resolveMongoStateKey(targetPath) {
    const key = targetPath.slice("mongo:".length).trim();
    if (!key) {
        throw new Error("mongo runtime state target must include a key");
    }
    return key;
}
function normalizeMongoSystemStatePayload(payload) {
    if (payload instanceof Uint8Array || Buffer.isBuffer(payload)) {
        return payload;
    }
    if (payload && typeof payload === "object") {
        const binaryPayload = payload;
        if (binaryPayload.buffer instanceof Uint8Array) {
            return binaryPayload.buffer;
        }
        if (typeof binaryPayload.value === "function") {
            const value = binaryPayload.value(true);
            if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
                return value;
            }
        }
    }
    return null;
}
async function readMongoSystemState(targetPath, fallback) {
    try {
        const client = await createRuntimeStateMongoClient();
        await client.connect();
        try {
            const db = client.db(process.env.DB_NAME || "orchestrator");
            const doc = await db.collection("system_state").findOne({
                key: resolveMongoStateKey(targetPath),
            });
            if (doc?.encoding === "gzip-json") {
                const payload = normalizeMongoSystemStatePayload(doc.payload);
                if (payload) {
                    return JSON.parse(gunzipSync(payload).toString("utf-8"));
                }
            }
            return fallback;
        }
        finally {
            await client.close();
        }
    }
    catch {
        return fallback;
    }
}
async function writeMongoSystemState(targetPath, value) {
    const client = await createRuntimeStateMongoClient();
    await client.connect();
    try {
        const db = client.db(process.env.DB_NAME || "orchestrator");
        const payload = gzipSync(Buffer.from(JSON.stringify(value), "utf-8"));
        const key = resolveMongoStateKey(targetPath);
        const existing = await db.collection("system_state").findOne({ key });
        const version = typeof existing?.version === "number" ? existing.version + 1 : 1;
        await db.collection("system_state").updateOne({ key }, {
            $set: {
                encoding: "gzip-json",
                payload,
                payloadBytes: payload.byteLength,
                version,
                updatedAt: new Date(),
            },
        }, { upsert: true });
    }
    finally {
        await client.close();
    }
}
async function createRuntimeStateMongoClient() {
    const databaseUrl = process.env.DATABASE_URL || "mongodb://mongo:27017/orchestrator";
    if (runtimeStateMongoClientFactory) {
        return await runtimeStateMongoClientFactory(databaseUrl);
    }
    const { MongoClient } = await import("mongodb");
    return new MongoClient(databaseUrl);
}
export function setRuntimeStateMongoClientFactoryForTest(factory) {
    runtimeStateMongoClientFactory = factory;
}
export function resolveRuntimeStateTarget(agentConfigPath, orchestratorStatePath) {
    if (!orchestratorStatePath) {
        return undefined;
    }
    if (isMongoStateTarget(orchestratorStatePath)) {
        return orchestratorStatePath;
    }
    return resolve(dirname(agentConfigPath), orchestratorStatePath);
}
export async function loadRuntimeStateTarget(targetPath, fallback) {
    if (!targetPath) {
        return fallback;
    }
    if (isMongoStateTarget(targetPath)) {
        return readMongoSystemState(targetPath, fallback);
    }
    return readJsonFile(targetPath, fallback);
}
export async function saveRuntimeStateTarget(targetPath, value) {
    if (!targetPath) {
        return;
    }
    if (isMongoStateTarget(targetPath)) {
        await writeMongoSystemState(targetPath, value);
        return;
    }
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, JSON.stringify(value, null, 2), "utf-8");
}
export async function loadRuntimeState(agentConfigPath, orchestratorStatePath) {
    return loadRuntimeStateTarget(resolveRuntimeStateTarget(agentConfigPath, orchestratorStatePath), {});
}
export function sortIsoDescending(values) {
    return values
        .filter((value) => typeof value === "string" && value.length > 0)
        .sort((left, right) => Date.parse(right) - Date.parse(left));
}
function toTimestamp(value) {
    if (!value)
        return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
export function countByStatus(values) {
    return values.reduce((acc, value) => {
        const status = typeof value.status === "string" ? value.status : "unknown";
        acc[status] = (acc[status] ?? 0) + 1;
        return acc;
    }, {});
}
export function inferProofSurface(value) {
    if (!value)
        return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized)
        return null;
    if (normalized === "milestone" || normalized.includes("milestone")) {
        return "milestone";
    }
    if (normalized === "demandsummary" ||
        normalized === "demand-summary" ||
        normalized.includes("demand")) {
        return "demandSummary";
    }
    return null;
}
function normalizeProofObservationStatus(value) {
    const normalized = value?.trim().toLowerCase() ?? "unknown";
    if (normalized === "degraded" ||
        normalized === "blocked" ||
        normalized === "failed" ||
        normalized === "dead-letter") {
        return "deadLetter";
    }
    if (normalized === "retrying") {
        return "retrying";
    }
    if (normalized === "rejected") {
        return "rejected";
    }
    if (normalized === "pending" ||
        normalized === "running" ||
        normalized === "active" ||
        normalized === "watching") {
        return "pending";
    }
    if (normalized === "success" ||
        normalized === "completed" ||
        normalized === "delivered" ||
        normalized === "duplicate" ||
        normalized === "healthy" ||
        normalized === "observed") {
        return "delivered";
    }
    return "unknown";
}
export function collectProofSurfaceObservations(args) {
    const observations = [];
    for (const event of args.workflowEvents ?? []) {
        const surface = inferProofSurface(event.proofTransport);
        if (!surface)
            continue;
        observations.push({
            surface,
            status: typeof event.state === "string" ? event.state : "unknown",
            timestamp: event.timestamp ?? null,
        });
    }
    for (const observation of args.relationshipObservations ?? []) {
        const surface = inferProofSurface(observation.proofTransport ?? observation.to ?? observation.from);
        if (!surface)
            continue;
        if (observation.relationship &&
            observation.relationship !== "publishes-proof" &&
            observation.relationship !== "transitions-proof" &&
            !observation.proofTransport) {
            continue;
        }
        observations.push({
            surface,
            status: typeof observation.status === "string" ? observation.status : "unknown",
            timestamp: observation.timestamp ?? null,
        });
    }
    return observations;
}
export function summarizeProofSurface(args, surface) {
    const observations = collectProofSurfaceObservations(args).filter((entry) => entry.surface === surface);
    const deliveredObservations = observations.filter((entry) => normalizeProofObservationStatus(entry.status) === "delivered");
    const lastDeliveredAt = sortIsoDescending(deliveredObservations.map((entry) => entry.timestamp)).at(0) ?? null;
    const lastAttemptAt = sortIsoDescending(observations.map((entry) => entry.timestamp)).at(0) ?? null;
    return {
        pending: observations.filter((entry) => normalizeProofObservationStatus(entry.status) === "pending").length,
        retrying: observations.filter((entry) => normalizeProofObservationStatus(entry.status) === "retrying").length,
        delivered: deliveredObservations.length,
        deadLetter: observations.filter((entry) => normalizeProofObservationStatus(entry.status) === "deadLetter").length,
        rejected: observations.filter((entry) => normalizeProofObservationStatus(entry.status) === "rejected").length,
        lastDeliveredAt,
        latestDeliveredAt: lastDeliveredAt,
        lastAttemptAt,
        totalObservations: observations.length,
    };
}
export function summarizeTaskExecutions(executions, taskTypes) {
    const filtered = taskTypes?.length
        ? executions.filter((entry) => taskTypes.includes(entry.type ?? ""))
        : executions;
    return {
        total: filtered.length,
        pending: filtered.filter((entry) => entry.status === "pending").length,
        running: filtered.filter((entry) => entry.status === "running").length,
        retrying: filtered.filter((entry) => entry.status === "retrying").length,
        failed: filtered.filter((entry) => entry.status === "failed").length,
        success: filtered.filter((entry) => entry.status === "success").length,
        lastHandledAt: sortIsoDescending(filtered.map((entry) => entry.lastHandledAt)).at(0) ?? null,
    };
}
export function buildTaskPathProof(executions, taskType) {
    const filtered = taskType
        ? executions
            .filter((entry) => entry.type === taskType)
            .slice()
            .sort((left, right) => toTimestamp(right.lastHandledAt) - toTimestamp(left.lastHandledAt))
        : executions
            .slice()
            .sort((left, right) => toTimestamp(right.lastHandledAt) - toTimestamp(left.lastHandledAt));
    const latestObserved = filtered[0] ?? null;
    const latestSuccessful = filtered.find((entry) => entry.status === "success") ?? null;
    return {
        taskType: taskType ?? latestObserved?.type ?? null,
        lastObservedAt: latestObserved?.lastHandledAt ?? null,
        lastObservedStatus: latestObserved?.status ?? null,
        lastSuccessfulAt: latestSuccessful?.lastHandledAt ?? null,
        totalRuns: filtered.length,
        successfulRuns: filtered.filter((entry) => entry.status === "success").length,
        failedRuns: filtered.filter((entry) => entry.status === "failed").length,
        activeRuns: filtered.filter((entry) => entry.status === "pending" ||
            entry.status === "running" ||
            entry.status === "retrying").length,
        lastError: typeof latestObserved?.lastError === "string" && latestObserved.lastError.length > 0
            ? latestObserved.lastError
            : null,
    };
}
export function summarizeRelationshipObservations(observations) {
    const byRelationship = observations.reduce((acc, observation) => {
        const relationship = typeof observation.relationship === "string"
            ? observation.relationship
            : "unknown";
        acc[relationship] = (acc[relationship] ?? 0) + 1;
        return acc;
    }, {});
    return {
        total: observations.length,
        lastObservedAt: sortIsoDescending(observations.map((observation) => observation.timestamp)).at(0) ??
            null,
        byRelationship,
    };
}
export function normalizeAgentIdFromNode(nodeId) {
    if (typeof nodeId !== "string" || nodeId.length === 0)
        return null;
    return nodeId.startsWith("agent:") ? nodeId.slice("agent:".length) : null;
}
function severityRank(severity) {
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
function escalationRank(level) {
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
function uniqueStrings(values) {
    return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
}
export function buildIncidentPriorityQueue(incidents) {
    return incidents
        .filter((incident) => incident.status !== "resolved")
        .map((incident) => {
        const severity = typeof incident.severity === "string" ? incident.severity : "warning";
        const escalationLevel = typeof incident.escalation?.level === "string" ? incident.escalation.level : null;
        const owner = typeof incident.owner === "string" && incident.owner.length > 0 ? incident.owner : null;
        const recommendedOwner = typeof incident.policy?.preferredOwner === "string" && incident.policy.preferredOwner.length > 0
            ? incident.policy.preferredOwner
            : owner;
        const blockers = uniqueStrings([
            ...(Array.isArray(incident.remediation?.blockers) ? incident.remediation?.blockers : []),
            ...((incident.remediationTasks ?? [])
                .flatMap((task) => (Array.isArray(task.blockers) ? task.blockers : []))),
        ]);
        const summary = typeof incident.summary === "string" && incident.summary.length > 0
            ? incident.summary
            : `Open ${incident.classification ?? "runtime"} incident`;
        const nextAction = typeof incident.remediation?.nextAction === "string" && incident.remediation.nextAction.length > 0
            ? incident.remediation.nextAction
            : Array.isArray(incident.recommendedSteps) && incident.recommendedSteps.length > 0
                ? incident.recommendedSteps[0]
                : "Inspect incident evidence and drive remediation to closure.";
        let priorityScore = severityRank(severity) + escalationRank(escalationLevel);
        if (!owner)
            priorityScore += 8;
        if ((incident.remediationTasks ?? []).some((task) => task.status === "blocked" || task.status === "failed")) {
            priorityScore += 6;
        }
        if (blockers.length > 0)
            priorityScore += 4;
        return {
            incidentId: incident.incidentId ?? "unknown-incident",
            classification: typeof incident.classification === "string" ? incident.classification : null,
            severity,
            status: typeof incident.status === "string" ? incident.status : "active",
            owner,
            recommendedOwner,
            escalationLevel,
            verificationStatus: typeof incident.verification?.status === "string" ? incident.verification.status : null,
            priorityScore,
            summary,
            nextAction,
            blockers,
            remediationTaskType: typeof incident.policy?.remediationTaskType === "string"
                ? incident.policy.remediationTaskType
                : null,
            affectedSurfaces: uniqueStrings(Array.isArray(incident.affectedSurfaces) ? incident.affectedSurfaces : []),
            linkedServiceIds: uniqueStrings(Array.isArray(incident.linkedServiceIds) ? incident.linkedServiceIds : []),
        };
    })
        .sort((left, right) => {
        if (right.priorityScore !== left.priorityScore) {
            return right.priorityScore - left.priorityScore;
        }
        return left.incidentId.localeCompare(right.incidentId);
    });
}
export function buildWorkflowBlockerSummary(events) {
    const resolveRunKey = (event) => {
        if (typeof event.runId === "string" && event.runId.length > 0) {
            return event.runId;
        }
        if (typeof event.relatedRunId === "string" && event.relatedRunId.length > 0) {
            return event.relatedRunId;
        }
        return null;
    };
    const rawStopEvents = events.filter((event) => event.state === "blocked" ||
        event.state === "failed" ||
        (typeof event.stopCode === "string" && event.stopCode.length > 0));
    const stopEvents = rawStopEvents.filter((event) => {
        const runKey = resolveRunKey(event);
        const eventTimestamp = toTimestamp(event.timestamp);
        if (!runKey || eventTimestamp <= 0) {
            return true;
        }
        return !events.some((candidate) => {
            if (resolveRunKey(candidate) !== runKey) {
                return false;
            }
            if (toTimestamp(candidate.timestamp) <= eventTimestamp) {
                return false;
            }
            if (candidate.stage === "result" && candidate.state === "success") {
                return true;
            }
            return (candidate.stage === event.stage &&
                (candidate.state === "success" || candidate.state === "completed"));
        });
    });
    const byStage = stopEvents.reduce((acc, event) => {
        const stage = typeof event.stage === "string" ? event.stage : "unknown";
        acc[stage] = (acc[stage] ?? 0) + 1;
        return acc;
    }, {});
    const byClassification = stopEvents.reduce((acc, event) => {
        const classification = typeof event.classification === "string" && event.classification.length > 0
            ? event.classification
            : "unspecified";
        acc[classification] = (acc[classification] ?? 0) + 1;
        return acc;
    }, {});
    const byStopCode = stopEvents.reduce((acc, event) => {
        const stopCode = typeof event.stopCode === "string" && event.stopCode.length > 0
            ? event.stopCode
            : "unspecified";
        acc[stopCode] = (acc[stopCode] ?? 0) + 1;
        return acc;
    }, {});
    const latestStopAt = sortIsoDescending(stopEvents.map((event) => event.timestamp)).at(0) ?? null;
    const latestStopCode = stopEvents
        .slice()
        .sort((left, right) => Date.parse(right.timestamp ?? "1970-01-01T00:00:00.000Z") -
        Date.parse(left.timestamp ?? "1970-01-01T00:00:00.000Z"))
        .map((event) => event.stopCode)
        .find((value) => typeof value === "string" && value.length > 0) ??
        null;
    return {
        totalStopSignals: stopEvents.length,
        latestStopAt,
        latestStopCode,
        byStage,
        byClassification,
        byStopCode,
        blockedRunIds: uniqueStrings(stopEvents.flatMap((event) => [event.runId, event.relatedRunId])),
        proofStopSignals: stopEvents.filter((event) => event.stage === "proof").length,
    };
}
export function buildAgentRelationshipWindow(observations, agentId) {
    const now = Date.now();
    const sixHoursMs = 6 * 60 * 60 * 1000;
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    const relevant = observations.filter((observation) => {
        const fromAgent = normalizeAgentIdFromNode(observation.from ?? null);
        const toAgent = normalizeAgentIdFromNode(observation.to ?? null);
        return fromAgent === agentId || toAgent === agentId;
    });
    const recentEdges = relevant
        .slice()
        .sort((left, right) => Date.parse(right.timestamp ?? "1970-01-01T00:00:00.000Z") -
        Date.parse(left.timestamp ?? "1970-01-01T00:00:00.000Z"))
        .slice(0, 8)
        .map((observation) => ({
        from: observation.from ?? "unknown",
        to: observation.to ?? "unknown",
        relationship: observation.relationship ?? "unknown",
        timestamp: observation.timestamp ?? null,
        source: observation.source ?? null,
    }));
    const byRelationship = relevant.reduce((acc, observation) => {
        const relationship = typeof observation.relationship === "string" ? observation.relationship : "unknown";
        acc[relationship] = (acc[relationship] ?? 0) + 1;
        return acc;
    }, {});
    return {
        agentId,
        total: relevant.length,
        recentSixHours: relevant.filter((observation) => {
            const timestamp = Date.parse(observation.timestamp ?? "");
            return Number.isFinite(timestamp) && now - timestamp <= sixHoursMs;
        }).length,
        recentTwentyFourHours: relevant.filter((observation) => {
            const timestamp = Date.parse(observation.timestamp ?? "");
            return Number.isFinite(timestamp) && now - timestamp <= twentyFourHoursMs;
        }).length,
        lastObservedAt: sortIsoDescending(relevant.map((observation) => observation.timestamp)).at(0) ?? null,
        byRelationship,
        recentEdges,
    };
}
function normalizeSpecialistText(value) {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > 0 ? normalized : null;
}
function defaultNextActionForStatus(status) {
    switch (status) {
        case "completed":
            return "Review the delivered result and advance the next governed lane.";
        case "watching":
            return "Review the evidence and clear the highest-priority follow-up before treating this lane as closed.";
        case "blocked":
            return "Clear the blocking dependency and rerun the bounded task.";
        case "escalate":
            return "Escalate with the recorded evidence and assign the next owner before retrying.";
        case "refused":
            return "Refine the request so it stays inside the agent boundary, then rerun it.";
        default:
            return null;
    }
}
export function buildSpecialistOperatorFields(args) {
    const refusalReason = normalizeSpecialistText(args.refusalReason);
    const escalationReason = normalizeSpecialistText(args.escalationReason);
    const recommendedNextActions = uniqueStrings([
        ...(args.recommendedNextActions ?? []),
        defaultNextActionForStatus(args.status),
    ]).slice(0, 5);
    const operatorSummary = normalizeSpecialistText(args.operatorSummary) ??
        "Specialist result completed without a summary.";
    return {
        operatorSummary,
        recommendedNextActions,
        specialistContract: {
            role: args.role,
            workflowStage: args.workflowStage,
            deliverable: args.deliverable,
            status: args.status,
            operatorSummary,
            recommendedNextActions,
            refusalReason,
            escalationReason,
        },
    };
}
