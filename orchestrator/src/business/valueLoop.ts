import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { OrchestratorConfig, OrchestratorState, Task } from "../types.js";
import { loadBusinessRegistry, discoverBusinessCandidates } from "./discovery.js";
import { loadBusinessMission } from "./mission.js";
import { scoreCandidates } from "./scoring.js";
import type {
  BlockedBusinessTask,
  BusinessValueCycle,
  BusinessValueCycleResult,
  BusinessValueState,
  CandidateWorkItem,
  NextSelectedTask,
  TaskTraceabilityMetadata,
} from "./types.js";

const CYCLE_RETENTION_LIMIT = 200;
const CANDIDATE_RETENTION_LIMIT = 500;

export function createDefaultBusinessValueState(): BusinessValueState {
  return {
    registry: null,
    cycles: [],
    candidates: [],
    approvalGatedCandidates: [],
    unsupportedCandidates: [],
    lastSuccessfulCycleId: null,
    lastFailedCycleId: null,
    activeCycleId: null,
    nextSelectedTask: null,
    lastRunAt: null,
  };
}

function ensureBusinessValueState(state: OrchestratorState): BusinessValueState {
  if (!state.businessValue) {
    state.businessValue = createDefaultBusinessValueState();
  }
  return state.businessValue;
}

function toBlocked(candidate: CandidateWorkItem, reason: string): BlockedBusinessTask {
  return {
    candidateId: candidate.id,
    title: candidate.title,
    reason,
    approval: candidate.approval,
    evidence: candidate.evidence,
  };
}

function getWorkspaceRoot() {
  return resolve(process.cwd(), "..");
}

function getCandidateBaseline(state: OrchestratorState, candidate: CandidateWorkItem) {
  const registry = state.businessValue?.registry;
  const snapshot = registry?.kpiSnapshots
    .filter((item) => item.kpiId === candidate.kpiId)
    .slice(-1)[0];
  return snapshot?.value ?? null;
}

function buildTraceability(
  state: OrchestratorState,
  candidate: CandidateWorkItem,
  cycleId: string,
  evidencePath: string,
): TaskTraceabilityMetadata {
  const score = candidate.score;
  if (!score) {
    throw new Error(`candidate ${candidate.id} has not been scored`);
  }
  return {
    businessId: candidate.businessId,
    projectId: candidate.projectId ?? null,
    businessFunction: candidate.businessFunction ?? null,
    businessObjective: candidate.objective,
    expectedBusinessOutcome: candidate.expectedOutcome,
    kpiId: candidate.kpiId,
    kpiBaseline: getCandidateBaseline(state, candidate),
    expectedKpiEffect: `Improve ${candidate.kpiId} through ${candidate.expectedOutcome}.`,
    candidateEvidence: candidate.evidence,
    score: score.value,
    scoreComponents: score.components,
    urgency: score.components.urgency,
    effort: score.components.effort,
    risk: score.components.operationalRisk,
    dependencies: candidate.dependencies,
    acceptanceCriteria: candidate.acceptanceCriteria,
    verificationMethod: candidate.verification,
    evidencePath,
    approvalClassification: candidate.approval,
    originatingCycleId: cycleId,
    parentCandidateId: candidate.id,
    selectedWorkerOrCapability: candidate.taskType ?? "unsupported",
    completionOutcome: null,
  };
}

function alreadyQueuedOrCompleted(state: OrchestratorState, idempotencyKey: string) {
  return state.taskExecutions.some(
    (execution) =>
      execution.idempotencyKey === idempotencyKey &&
      ["pending", "running", "success", "retrying"].includes(execution.status),
  );
}

async function persistCycleEvidence(cycle: BusinessValueCycle, config: OrchestratorConfig) {
  const workspaceRoot = getWorkspaceRoot();
  const dir = config.businessEvidenceDir
    ? resolve(config.businessEvidenceDir, "cycles")
    : join(workspaceRoot, "artifacts", "business-value", "cycles");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${cycle.cycleId}.json`);
  await writeFile(path, JSON.stringify(cycle, null, 2), "utf-8");
  return path;
}

function updateBusinessState(
  businessState: BusinessValueState,
  cycle: BusinessValueCycle,
  candidates: CandidateWorkItem[],
  approvalGated: BlockedBusinessTask[],
  unsupported: BlockedBusinessTask[],
) {
  businessState.cycles = [...businessState.cycles, cycle].slice(-CYCLE_RETENTION_LIMIT);
  businessState.candidates = candidates.slice(0, CANDIDATE_RETENTION_LIMIT);
  businessState.approvalGatedCandidates = approvalGated;
  businessState.unsupportedCandidates = unsupported;
  businessState.activeCycleId = null;
  businessState.lastRunAt = cycle.completedAt ?? cycle.startedAt;
  businessState.nextSelectedTask = cycle.selectedTask ?? null;
  if (cycle.status === "completed") {
    businessState.lastSuccessfulCycleId = cycle.cycleId;
  }
  if (cycle.status === "failed") {
    businessState.lastFailedCycleId = cycle.cycleId;
  }
}

export async function runBusinessValueCycle(args: {
  config: OrchestratorConfig;
  state: OrchestratorState;
  enqueueTask: (type: string, payload: Record<string, unknown>) => Task;
  isTaskTypeAllowed: (type: string) => boolean;
  logger?: Pick<Console, "log" | "warn" | "error">;
}): Promise<BusinessValueCycleResult> {
  const { config, state, enqueueTask, isTaskTypeAllowed, logger = console } = args;
  const businessState = ensureBusinessValueState(state);
  const mission = loadBusinessMission();
  const cycleId = `business-cycle-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();

  if (businessState.activeCycleId) {
    const registry = businessState.registry ?? (await loadBusinessRegistry(config));
    const blockedCycle: BusinessValueCycle = {
      cycleId,
      status: "blocked",
      startedAt,
      completedAt: new Date().toISOString(),
      missionLoaded: true,
      registrySource: registry.sourcePath,
      candidates: [],
      selectedTask: null,
      approvalGatedCandidates: [],
      unsupportedCandidates: [
        {
          candidateId: "business-cycle-active",
          title: "Business-value cycle already active",
          reason: `Active cycle ${businessState.activeCycleId} prevents duplicate cycle execution.`,
          approval: "blocked",
          evidence: [businessState.activeCycleId],
        },
      ],
      verificationStatus: "skipped",
      evidence: [],
      nextSafeAction: "Wait for active cycle to complete or recover interrupted state.",
    };
    const evidencePath = await persistCycleEvidence(blockedCycle, config);
    blockedCycle.evidence.push({
      path: evidencePath,
      summary: "Duplicate cycle prevented.",
      createdAt: new Date().toISOString(),
    });
    updateBusinessState(businessState, blockedCycle, [], [], blockedCycle.unsupportedCandidates);
    return { cycle: blockedCycle, registry, mission };
  }

  businessState.activeCycleId = cycleId;
  try {
    const registry = await loadBusinessRegistry(config);
    businessState.registry = registry;
    const discovered = await discoverBusinessCandidates(registry, state);
    const scored = scoreCandidates(discovered);
    const approvalGated = scored
      .filter((candidate) => candidate.approval === "approval-required")
      .map((candidate) => toBlocked(candidate, candidate.approvalReason ?? "Approval required."));
    const unsupported = scored
      .filter((candidate) => candidate.approval === "unsupported" || candidate.approval === "blocked")
      .map((candidate) =>
        toBlocked(
          candidate,
          candidate.approvalReason ??
            "Candidate cannot be executed through the current allowlisted task surface.",
        ),
      );

    let selectedTask: NextSelectedTask | null = null;
    const preliminaryCycle: BusinessValueCycle = {
      cycleId,
      status: "active",
      startedAt,
      completedAt: null,
      missionLoaded: true,
      registrySource: registry.sourcePath,
      candidates: scored,
      selectedTask: null,
      approvalGatedCandidates: approvalGated,
      unsupportedCandidates: unsupported,
      verificationStatus: "not-verified",
      evidence: [],
      nextSafeAction: null,
    };
    const evidencePath = await persistCycleEvidence(preliminaryCycle, config);

    for (const candidate of scored) {
      if (candidate.approval !== "safe-autonomous" || !candidate.taskType) {
        continue;
      }
      if (!isTaskTypeAllowed(candidate.taskType)) {
        unsupported.push(
          toBlocked(candidate, `Task type ${candidate.taskType} is not allowlisted.`),
        );
        continue;
      }
      const idempotencyKey = `business-value:${candidate.id}`;
      if (alreadyQueuedOrCompleted(state, idempotencyKey)) {
        continue;
      }

      const traceability = buildTraceability(state, candidate, cycleId, evidencePath);
      const task = enqueueTask(candidate.taskType, {
        ...candidate.taskPayload,
        idempotencyKey,
        __businessTraceability: traceability,
        __businessCandidateId: candidate.id,
        __businessCycleId: cycleId,
      });
      selectedTask = {
        candidateId: candidate.id,
        taskType: candidate.taskType,
        taskId: task.id,
        idempotencyKey,
        title: candidate.title,
        score: candidate.score?.value ?? 0,
        evidence: candidate.evidence,
      };
      logger.log(
        `[business-value] selected ${candidate.id} -> ${candidate.taskType} (${task.id})`,
      );
      break;
    }

    const completedAt = new Date().toISOString();
    const cycle: BusinessValueCycle = {
      ...preliminaryCycle,
      status: selectedTask ? "completed" : scored.length > 0 ? "blocked" : "idle",
      completedAt,
      selectedTask,
      approvalGatedCandidates: approvalGated,
      unsupportedCandidates: unsupported,
      verificationStatus: selectedTask ? "not-verified" : "skipped",
      nextSafeAction: selectedTask
        ? `Wait for ${selectedTask.taskType} ${selectedTask.taskId} to execute and verify.`
        : approvalGated.length > 0
          ? "Approval-gated work is preserved; continue when approval arrives or new safe evidence appears."
          : unsupported.length > 0
            ? "Implement or map unsupported candidate handlers before execution."
            : "No evidence-backed business candidate was discovered.",
    };
    const finalEvidencePath = await persistCycleEvidence(cycle, config);
    cycle.evidence.push({
      path: finalEvidencePath,
      summary: selectedTask
        ? `Selected ${selectedTask.title}.`
        : "No safe allowlisted candidate selected.",
      createdAt: new Date().toISOString(),
    });
    await persistCycleEvidence(cycle, config);
    updateBusinessState(businessState, cycle, scored, approvalGated, unsupported);
    return { cycle, registry, mission };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const failureCycle: BusinessValueCycle = {
      cycleId,
      status: "failed",
      startedAt,
      completedAt,
      missionLoaded: true,
      registrySource: businessState.registry?.sourcePath ?? "unavailable",
      candidates: [],
      selectedTask: null,
      approvalGatedCandidates: [],
      unsupportedCandidates: [],
      verificationStatus: "interrupted",
      evidence: [],
      nextSafeAction: "Fix the business-value cycle failure before retrying.",
      failureReason: error instanceof Error ? error.message : String(error),
    };
    const evidencePath = await persistCycleEvidence(failureCycle, config);
    failureCycle.evidence.push({
      path: evidencePath,
      summary: failureCycle.failureReason ?? "Business-value cycle failed.",
      createdAt: new Date().toISOString(),
    });
    await persistCycleEvidence(failureCycle, config);
    updateBusinessState(businessState, failureCycle, [], [], []);
    throw error;
  }
}
