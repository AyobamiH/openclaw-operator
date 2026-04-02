import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSpecialistOperatorFields,
  loadRuntimeState,
  summarizeProofSurface,
  type RuntimeIncidentLedgerRecord,
  type RuntimeStateSubset,
  type RuntimeTaskExecution,
} from "../../shared/runtime-evidence.js";

interface AgentConfig {
  id: string;
  name: string;
  orchestratorStatePath: string;
  permissions: {
    skills?: Record<string, { allowed?: boolean }>;
  };
}

interface Task {
  id: string;
  type: string;
  releaseTarget?: string;
}

interface RuntimeState extends RuntimeStateSubset {}

interface Result {
  success: boolean;
  releaseReadiness: {
    decision: "go" | "hold" | "block";
    releaseTarget: string | null;
    summary: string;
    blockers: string[];
    followups: string[];
    evidenceWindow: {
      openIncidents: number;
      openCriticalIncidents: number;
      pendingApprovals: number;
      proofFreshness: {
        milestone: "fresh" | "aging" | "stale" | "empty";
        demandSummary: "fresh" | "aging" | "stale" | "empty";
      };
      latestRuns: Array<{
        type: string;
        status: string;
        lastHandledAt: string | null;
      }>;
    };
  };
  operatorSummary: string;
  recommendedNextActions: string[];
  specialistContract: {
    role: string;
    workflowStage: string;
    deliverable: string;
    status: "completed" | "watching" | "blocked" | "escalate" | "refused";
    operatorSummary: string;
    recommendedNextActions: string[];
    refusalReason: string | null;
    escalationReason: string | null;
  };
  executionTime: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = resolve(__dirname, "../agent.config.json");

function loadConfig(): AgentConfig {
  return JSON.parse(readFileSync(configPath, "utf-8")) as AgentConfig;
}

function canUseSkill(skillId: string): boolean {
  const config = loadConfig();
  return config.permissions.skills?.[skillId]?.allowed === true;
}

function resolveProofFreshness(
  lastTimestamp: string | null | undefined,
): "fresh" | "aging" | "stale" | "empty" {
  if (!lastTimestamp) return "empty";
  const ageMs = Date.now() - Date.parse(lastTimestamp);
  if (!Number.isFinite(ageMs) || ageMs < 0) return "fresh";
  if (ageMs > 24 * 60 * 60 * 1000) return "stale";
  if (ageMs > 6 * 60 * 60 * 1000) return "aging";
  return "fresh";
}

function sortExecutions(executions: RuntimeTaskExecution[]) {
  return executions
    .slice()
    .sort((left, right) => {
      const leftTime = Date.parse(left.lastHandledAt ?? "");
      const rightTime = Date.parse(right.lastHandledAt ?? "");
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    });
}

function latestExecutionForType(
  executions: RuntimeTaskExecution[],
  type: string,
): RuntimeTaskExecution | null {
  return sortExecutions(executions).find((execution) => execution.type === type) ?? null;
}

function buildOpenIncidentSummary(incidents: RuntimeIncidentLedgerRecord[]) {
  const openIncidents = incidents.filter((incident) => incident.status !== "resolved");
  return {
    openIncidents,
    openIncidentCount: openIncidents.length,
    openCriticalIncidentCount: openIncidents.filter((incident) => incident.severity === "critical").length,
  };
}

async function handleTask(task: Task): Promise<Result> {
  const startedAt = Date.now();

  if (!canUseSkill("documentParser")) {
    const specialistFields = buildSpecialistOperatorFields({
      role: "Release Manager",
      workflowStage: "release-refusal",
      deliverable: "bounded release readiness posture",
      status: "refused",
      operatorSummary:
        "Release-readiness synthesis was refused because documentParser access is unavailable to release-manager-agent.",
      recommendedNextActions: [
        "Restore documentParser access for release-manager-agent before retrying.",
      ],
      refusalReason:
        "Refused release-readiness synthesis because documentParser skill access is not allowed for release-manager-agent.",
    });

    return {
      success: false,
      releaseReadiness: {
        decision: "block",
        releaseTarget:
          typeof task.releaseTarget === "string" && task.releaseTarget.trim().length > 0
            ? task.releaseTarget.trim()
            : null,
        summary: "Release posture could not be assembled.",
        blockers: ["documentParser unavailable"],
        followups: ["Restore release-manager-agent governed access."],
        evidenceWindow: {
          openIncidents: 0,
          openCriticalIncidents: 0,
          pendingApprovals: 0,
          proofFreshness: {
            milestone: "empty",
            demandSummary: "empty",
          },
          latestRuns: [],
        },
      },
      ...specialistFields,
      executionTime: Date.now() - startedAt,
    };
  }

  const config = loadConfig();
  const state = await loadRuntimeState<RuntimeState>(configPath, config.orchestratorStatePath);
  const executions = state.taskExecutions ?? [];
  const incidentSummary = buildOpenIncidentSummary(state.incidentLedger ?? []);
  const pendingApprovals = (state.approvals ?? []).filter(
    (entry) => entry.status === "pending",
  ).length;
  const milestoneProof = summarizeProofSurface(
    {
      workflowEvents: state.workflowEvents ?? [],
      relationshipObservations: state.relationshipObservations ?? [],
    },
    "milestone",
  );
  const demandProof = summarizeProofSurface(
    {
      workflowEvents: state.workflowEvents ?? [],
      relationshipObservations: state.relationshipObservations ?? [],
    },
    "demandSummary",
  );
  const proofFreshness = {
    milestone: resolveProofFreshness(milestoneProof.latestDeliveredAt),
    demandSummary: resolveProofFreshness(demandProof.latestDeliveredAt),
  };
  const latestRuns = [
    latestExecutionForType(executions, "qa-verification"),
    latestExecutionForType(executions, "security-audit"),
    latestExecutionForType(executions, "system-monitor"),
    latestExecutionForType(executions, "build-refactor"),
  ]
    .filter((entry): entry is RuntimeTaskExecution => entry !== null)
    .map((entry) => ({
      type: entry.type ?? "unknown",
      status: entry.status ?? "unknown",
      lastHandledAt: entry.lastHandledAt ?? null,
    }));

  const blockers: string[] = [];
  const followups: string[] = [];
  const latestVerification = latestRuns.find((run) => run.type === "qa-verification") ?? null;
  const latestSecurity = latestRuns.find((run) => run.type === "security-audit") ?? null;
  const latestMonitor = latestRuns.find((run) => run.type === "system-monitor") ?? null;

  let decision: "go" | "hold" | "block" = "go";

  if (incidentSummary.openCriticalIncidentCount > 0) {
    decision = "block";
    blockers.push(
      `${incidentSummary.openCriticalIncidentCount} critical incident(s) remain unresolved.`,
    );
  }

  if (latestMonitor?.status === "failed") {
    decision = "block";
    blockers.push("Latest system-monitor run failed.");
  }

  if (latestSecurity?.status === "failed") {
    decision = "block";
    blockers.push("Latest security-audit run failed.");
  }

  if (proofFreshness.milestone === "stale" || proofFreshness.demandSummary === "stale") {
    decision = "block";
    blockers.push("Public proof freshness is stale.");
  }

  if (decision !== "block") {
    if (pendingApprovals > 0) {
      decision = "hold";
      followups.push("Clear pending approvals before treating the release posture as ready.");
    }

    if (!latestVerification || latestVerification.status !== "success") {
      decision = "hold";
      followups.push("Run qa-verification successfully before release cutover.");
    }

    if (incidentSummary.openIncidentCount > 0) {
      decision = "hold";
      followups.push("Resolve or consciously accept the remaining non-critical incidents.");
    }
  }

  if (latestSecurity?.status === "success") {
    followups.push("Review the latest security-audit findings and confirm there are no unresolved high-risk issues.");
  }
  if (latestMonitor?.status === "success") {
    followups.push("Confirm the latest system-monitor posture still matches the live runtime before release.");
  }

  const summary =
    decision === "go"
      ? "Release posture is go: no critical incident, approval, or stale-proof condition is currently blocking bounded release work."
      : decision === "hold"
        ? "Release posture is hold: the runtime is not blocked outright, but verification, approvals, or unresolved watch items still need operator closure."
        : "Release posture is block: critical runtime, monitoring, security, or proof conditions are still blocking safe release posture.";

  const specialistFields = buildSpecialistOperatorFields({
    role: "Release Manager",
    workflowStage:
      decision === "go"
        ? "release-closure"
        : decision === "hold"
          ? "release-watch"
          : "release-block",
    deliverable: "bounded release posture with blockers and follow-up actions",
    status:
      decision === "go"
        ? "completed"
        : decision === "hold"
          ? "watching"
          : "blocked",
    operatorSummary: summary,
    recommendedNextActions: [
      ...(blockers.length > 0 ? blockers : []),
      ...followups,
    ].slice(0, 5),
    escalationReason:
      decision === "block"
        ? "Escalate because critical runtime, proof, or governance conditions still block safe release posture."
        : null,
  });

  return {
    success: decision !== "block",
    releaseReadiness: {
      decision,
      releaseTarget:
        typeof task.releaseTarget === "string" && task.releaseTarget.trim().length > 0
          ? task.releaseTarget.trim()
          : null,
      summary,
      blockers,
      followups: [...new Set(followups)].slice(0, 6),
      evidenceWindow: {
        openIncidents: incidentSummary.openIncidentCount,
        openCriticalIncidents: incidentSummary.openCriticalIncidentCount,
        pendingApprovals: pendingApprovals,
        proofFreshness,
        latestRuns,
      },
    },
    ...specialistFields,
    executionTime: Date.now() - startedAt,
  };
}

export { handleTask, loadConfig, canUseSkill };

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) return;

  const raw = await readFile(payloadPath, "utf-8");
  const payload = JSON.parse(raw) as Task;
  const result = await handleTask(payload);

  const resultFile = process.env.RELEASE_MANAGER_AGENT_RESULT_FILE;
  if (resultFile) {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(dirname(resultFile), { recursive: true });
    await writeFile(resultFile, JSON.stringify(result, null, 2), "utf-8");
  } else {
    process.stdout.write(JSON.stringify(result));
  }

  if (result.success !== true) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
