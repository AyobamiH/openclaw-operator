import { readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildIncidentPriorityQueue,
  buildSpecialistOperatorFields,
  loadRuntimeState,
  readJsonFile,
  summarizeProofSurface,
  type RuntimeAgentServiceState,
  type RuntimeIncidentLedgerRecord,
  type RuntimeStateSubset,
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
  focus?: string;
  queueSnapshot?: {
    queued?: Array<Record<string, unknown>>;
    processing?: Array<Record<string, unknown>>;
  };
  pendingApprovalsCount?: number;
}

interface RuntimeState extends RuntimeStateSubset {}

interface AgentDescriptor {
  id: string;
  name: string;
  serviceStatePath?: string;
}

interface Result {
  success: boolean;
  controlPlaneBrief: {
    mode: {
      label: string;
      route: string;
      tone: "healthy" | "info" | "warning";
      detail: string;
    };
    primaryOperatorMove: {
      title: string;
      detail: string;
      route: string;
      tone: "healthy" | "info" | "warning";
      supportingSignals: string[];
    };
    pressureStory: {
      headline: string;
      detail: string;
      signals: string[];
    };
    queue: {
      queued: number;
      processing: number;
      dominantTypes: Array<{
        type: string;
        count: number;
      }>;
    };
    approvals: {
      pendingCount: number;
    };
    incidents: {
      openCount: number;
      criticalCount: number;
      dominantClassification: string | null;
      topQueue: Array<{
        incidentId: string;
        priorityScore: number;
        severity: string;
        nextAction: string;
      }>;
    };
    publicProof: {
      status: "healthy" | "watching" | "degraded";
      milestoneFreshness: "fresh" | "aging" | "stale" | "empty";
      demandFreshness: "fresh" | "aging" | "stale" | "empty";
      latestDeliveredAt: string | null;
    };
    services: {
      declaredCount: number;
      healthyCount: number;
      degradedCount: number;
      missingHeartbeatCount: number;
    };
    generatedAt: string;
    focus: string | null;
  };
  handoffPackage: {
    targetAgentId: string;
    payloadType: string;
    reason: string;
    recommendedTaskType: string;
    evidenceAnchors: string[];
  } | null;
  toolInvocations: Array<{
    toolId: string;
    detail: string;
    evidence: string[];
    classification: string;
  }>;
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
const agentsRoot = resolve(__dirname, "../../");

function loadConfig(): AgentConfig {
  return JSON.parse(readFileSync(configPath, "utf-8")) as AgentConfig;
}

function canUseSkill(skillId: string): boolean {
  const config = loadConfig();
  return config.permissions.skills?.[skillId]?.allowed === true;
}

async function listAgentDescriptors(): Promise<AgentDescriptor[]> {
  const entries = await readdir(agentsRoot, { withFileTypes: true });
  const descriptors: AgentDescriptor[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "shared" || entry.name === "AGENT_TEMPLATE" || entry.name.startsWith(".")) {
      continue;
    }
    const agentConfigPath = resolve(agentsRoot, entry.name, "agent.config.json");
    try {
      const parsed = JSON.parse(await readFile(agentConfigPath, "utf-8")) as {
        id?: string;
        name?: string;
        serviceStatePath?: string;
      };
      if (!parsed.id) continue;
      descriptors.push({
        id: parsed.id,
        name: parsed.name ?? parsed.id,
        serviceStatePath: parsed.serviceStatePath,
      });
    } catch {
      continue;
    }
  }

  return descriptors.sort((left, right) => left.id.localeCompare(right.id));
}

async function loadServiceState(
  descriptor: AgentDescriptor,
): Promise<RuntimeAgentServiceState | null> {
  if (!descriptor.serviceStatePath) return null;
  const targetPath = resolve(agentsRoot, descriptor.id, descriptor.serviceStatePath);
  return readJsonFile<RuntimeAgentServiceState | null>(targetPath, null);
}

async function isServiceStateMissingOrStale(
  descriptor: AgentDescriptor,
  maxAgeMs: number,
): Promise<boolean> {
  if (!descriptor.serviceStatePath) return true;
  const targetPath = resolve(agentsRoot, descriptor.id, descriptor.serviceStatePath);
  try {
    const fileStat = await stat(targetPath);
    return Date.now() - fileStat.mtimeMs > maxAgeMs;
  } catch {
    return true;
  }
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

function getOpenIncidents(incidents: RuntimeIncidentLedgerRecord[]) {
  return incidents.filter((incident) => incident.status !== "resolved");
}

function buildQueueSummary(task: Task) {
  const queued = Array.isArray(task.queueSnapshot?.queued) ? task.queueSnapshot.queued : [];
  const processing = Array.isArray(task.queueSnapshot?.processing)
    ? task.queueSnapshot.processing
    : [];
  const grouped = new Map<string, number>();

  for (const item of [...queued, ...processing]) {
    const type = typeof item.type === "string" ? item.type : "unknown";
    grouped.set(type, (grouped.get(type) ?? 0) + 1);
  }

  const dominantTypes = [...grouped.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 4)
    .map(([type, count]) => ({ type, count }));

  return {
    queued: queued.length,
    processing: processing.length,
    dominantTypes,
  };
}

function buildServiceSummary(
  states: Array<{ descriptor: AgentDescriptor; serviceState: RuntimeAgentServiceState | null; stale: boolean }>,
) {
  let healthyCount = 0;
  let degradedCount = 0;
  let missingHeartbeatCount = 0;

  for (const entry of states) {
    const status =
      entry.serviceState?.serviceHeartbeat?.status ??
      entry.serviceState?.lastStatus ??
      null;
    if (entry.stale || !status) {
      missingHeartbeatCount += 1;
      continue;
    }
    if (status === "ok" || status === "success") {
      healthyCount += 1;
      continue;
    }
    degradedCount += 1;
  }

  return {
    declaredCount: states.length,
    healthyCount,
    degradedCount,
    missingHeartbeatCount,
  };
}

function buildMode(args: {
  openIncidentCount: number;
  criticalIncidentCount: number;
  pendingApprovalsCount: number;
  queueQueued: number;
  queueProcessing: number;
  proofStatus: "healthy" | "watching" | "degraded";
  dominantClassification: string | null;
}) {
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
      detail: "Execution truth is live, but the next bounded work is paused behind operator review.",
    };
  }

  if (args.proofStatus !== "healthy") {
    return {
      label: "Proof Lag",
      route: "/public-proof",
      tone: "info" as const,
      detail: "Internal runtime truth is ahead of the public evidence surface, so proof reconciliation outranks external claims.",
    };
  }

  if (args.queueQueued > 0 || args.queueProcessing > 0) {
    return {
      label: "Active Queue",
      route: "/task-runs",
      tone: "healthy" as const,
      detail: "The control plane is actively processing bounded work without a stronger failure mode outranking the run ledger.",
    };
  }

  return {
    label: "Steady State",
    route: "/tasks",
    tone: "healthy" as const,
    detail: "No dominant operator intervention is currently outranking routine bounded work.",
  };
}

function buildPrimaryMove(args: {
  mode: string;
  openIncidentCount: number;
  criticalIncidentCount: number;
  pendingApprovalsCount: number;
  topIncident: ReturnType<typeof buildIncidentPriorityQueue>[number] | null;
  queueSummary: ReturnType<typeof buildQueueSummary>;
}) {
  if (args.mode === "Incident Storm") {
    return {
      title: "Stabilize the incident queue first",
      detail: args.topIncident
        ? `${args.topIncident.severity} incident ${args.topIncident.incidentId} is currently outranking the rest of the control plane.`
        : "Incidents are currently dominating the control plane, so clear ownership and remediation before treating smaller backlog as the main story.",
      route: "/incidents",
      tone: "warning" as const,
      supportingSignals: [
        `${args.openIncidentCount} open incident${args.openIncidentCount === 1 ? "" : "s"}`,
        `${args.criticalIncidentCount} critical`,
      ],
    };
  }

  if (args.mode === "Review-Gated") {
    return {
      title: "Clear the approval inbox first",
      detail: `${args.pendingApprovalsCount} approval decision(s) are pausing work that is already ready to continue once reviewed.`,
      route: "/approvals",
      tone: "warning" as const,
      supportingSignals: [
        `${args.pendingApprovalsCount} pending approval${args.pendingApprovalsCount === 1 ? "" : "s"}`,
        `${args.queueSummary.queued + args.queueSummary.processing} queued or processing`,
      ],
    };
  }

  if (args.mode === "Proof Lag") {
    return {
      title: "Reconcile public proof before external claims",
      detail: "Internal runtime truth is ahead of the public evidence surface, so confirm proof freshness before you rely on outward-facing status.",
      route: "/public-proof",
      tone: "info" as const,
      supportingSignals: [
        `${args.openIncidentCount} open incident${args.openIncidentCount === 1 ? "" : "s"}`,
        `${args.queueSummary.queued + args.queueSummary.processing} active queue item${args.queueSummary.queued + args.queueSummary.processing === 1 ? "" : "s"}`,
      ],
    };
  }

  if (args.mode === "Active Queue") {
    return {
      title: "Work the run ledger",
      detail: "The control plane is live and the queue is the best next read surface for bounded progress and failure signals.",
      route: "/task-runs",
      tone: "healthy" as const,
      supportingSignals: [
        `${args.queueSummary.queued} queued`,
        `${args.queueSummary.processing} processing`,
      ],
    };
  }

  return {
    title: "Launch the next bounded task",
    detail: "No stronger interruption is currently outranking routine bounded work, so the task catalog is the best next control surface.",
    route: "/tasks",
    tone: "healthy" as const,
    supportingSignals: ["Queue is quiet", "No dominant incident or approval pressure"],
  };
}

async function handleTask(task: Task): Promise<Result> {
  const startedAt = Date.now();

  if (!canUseSkill("documentParser")) {
    const specialistFields = buildSpecialistOperatorFields({
      role: "Operations Analyst",
      workflowStage: "brief-refusal",
      deliverable: "bounded control-plane brief",
      status: "refused",
      operatorSummary:
        "Control-plane brief generation was refused because documentParser access is unavailable to operations-analyst-agent.",
      recommendedNextActions: [
        "Restore documentParser access for operations-analyst-agent before retrying.",
      ],
      refusalReason:
        "Refused control-plane synthesis because documentParser skill access is not allowed for operations-analyst-agent.",
    });

    return {
      success: false,
      controlPlaneBrief: {
        mode: {
          label: "Unavailable",
          route: "/system-health",
          tone: "warning",
          detail: "The bounded control-plane brief could not be assembled.",
        },
        primaryOperatorMove: {
          title: "Restore the briefing lane",
          detail: "The control-plane synthesis lane is currently missing required governed access.",
          route: "/system-health",
          tone: "warning",
          supportingSignals: ["documentParser unavailable"],
        },
        pressureStory: {
          headline: "Control-plane brief unavailable",
          detail: "The operations analyst lane is blocked before it can assemble trustworthy runtime evidence.",
          signals: ["documentParser unavailable"],
        },
        queue: {
          queued: 0,
          processing: 0,
          dominantTypes: [],
        },
        approvals: {
          pendingCount: 0,
        },
        incidents: {
          openCount: 0,
          criticalCount: 0,
          dominantClassification: null,
          topQueue: [],
        },
        publicProof: {
          status: "degraded",
          milestoneFreshness: "empty",
          demandFreshness: "empty",
          latestDeliveredAt: null,
        },
        services: {
          declaredCount: 0,
          healthyCount: 0,
          degradedCount: 0,
          missingHeartbeatCount: 0,
        },
        generatedAt: new Date().toISOString(),
        focus: typeof task.focus === "string" && task.focus.trim().length > 0 ? task.focus.trim() : null,
      },
      handoffPackage: null,
      toolInvocations: [],
      ...specialistFields,
      executionTime: Date.now() - startedAt,
    };
  }

  const config = loadConfig();
  const state = await loadRuntimeState<RuntimeState>(configPath, config.orchestratorStatePath);
  const descriptors = await listAgentDescriptors();
  const serviceStates = await Promise.all(
    descriptors.map(async (descriptor) => ({
      descriptor,
      serviceState: await loadServiceState(descriptor),
      stale: await isServiceStateMissingOrStale(descriptor, 2 * 60 * 60 * 1000),
    })),
  );

  const queueSummary = buildQueueSummary(task);
  const pendingApprovalsCount =
    typeof task.pendingApprovalsCount === "number" ? task.pendingApprovalsCount : 0;
  const openIncidents = getOpenIncidents(state.incidentLedger ?? []);
  const incidentQueue = buildIncidentPriorityQueue(state.incidentLedger ?? []);
  const topIncident = incidentQueue[0] ?? null;
  const dominantClassification = topIncident?.classification ?? null;
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
  const milestoneFreshness = resolveProofFreshness(milestoneProof.latestDeliveredAt);
  const demandFreshness = resolveProofFreshness(demandProof.latestDeliveredAt);
  const publicProofStatus =
    milestoneProof.deadLetter > 0 ||
    demandProof.deadLetter > 0 ||
    milestoneFreshness === "stale" ||
    demandFreshness === "stale"
      ? "degraded"
      : milestoneFreshness === "aging" || demandFreshness === "aging"
        ? "watching"
        : "healthy";
  const serviceSummary = buildServiceSummary(serviceStates);
  const mode = buildMode({
    openIncidentCount: openIncidents.length,
    criticalIncidentCount: openIncidents.filter((incident) => incident.severity === "critical").length,
    pendingApprovalsCount,
    queueQueued: queueSummary.queued,
    queueProcessing: queueSummary.processing,
    proofStatus: publicProofStatus,
    dominantClassification,
  });
  const primaryMove = buildPrimaryMove({
    mode: mode.label,
    openIncidentCount: openIncidents.length,
    criticalIncidentCount: openIncidents.filter((incident) => incident.severity === "critical").length,
    pendingApprovalsCount,
    topIncident,
    queueSummary,
  });

  const pressureSignals = [
    `${openIncidents.length} open incident${openIncidents.length === 1 ? "" : "s"}`,
    `${pendingApprovalsCount} pending approval${pendingApprovalsCount === 1 ? "" : "s"}`,
    `${queueSummary.queued} queued`,
    `${queueSummary.processing} processing`,
    `proof:${publicProofStatus}`,
  ];

  const pressureStory = {
    headline:
      mode.label === "Incident Storm"
        ? "Incident pressure is carrying the control plane."
        : mode.label === "Review-Gated"
          ? "Operator review is the main source of paused throughput."
          : mode.label === "Proof Lag"
            ? "Public proof posture is lagging internal runtime truth."
            : mode.label === "Active Queue"
              ? "The queue is the main active control surface right now."
              : "The control plane is in a calm bounded posture.",
    detail: `${primaryMove.detail} ${mode.detail}`,
    signals: pressureSignals,
  };

  const specialistFields = buildSpecialistOperatorFields({
    role: "Operations Analyst",
    workflowStage:
      mode.label === "Steady State"
        ? "control-plane-closure"
        : mode.label === "Active Queue"
          ? "control-plane-watch"
          : "control-plane-escalation",
    deliverable:
      "bounded control-plane brief with dominant pressure, primary move, and proof posture",
    status:
      mode.label === "Steady State"
        ? "completed"
        : mode.label === "Active Queue"
          ? "watching"
          : "escalate",
    operatorSummary: `${primaryMove.title}. ${mode.detail}`,
    recommendedNextActions: [
      primaryMove.title,
      topIncident?.nextAction ?? null,
      publicProofStatus !== "healthy"
        ? "Inspect the public proof surface before making external claims."
        : null,
    ],
    escalationReason:
      mode.label === "Steady State" || mode.label === "Active Queue"
        ? null
        : "Escalate because the control-plane brief found a stronger runtime or review pressure source that outranks routine bounded work.",
  });
  const handoffTargetAgentId =
    mode.label === "Incident Storm"
      ? "system-monitor-agent"
      : mode.label === "Review-Gated"
        ? "release-manager-agent"
        : mode.label === "Proof Lag"
          ? "doc-specialist"
          : queueSummary.queued > 0 || queueSummary.processing > 0
            ? "integration-agent"
            : null;
  const handoffPackage = handoffTargetAgentId
    ? {
        targetAgentId: handoffTargetAgentId,
        payloadType: "control-plane-brief",
        reason: `${primaryMove.title}. ${mode.detail}`,
        recommendedTaskType:
          mode.label === "Incident Storm"
            ? "system-monitor"
            : mode.label === "Review-Gated"
              ? "release-readiness"
              : mode.label === "Proof Lag"
                ? "drift-repair"
                : "integration-workflow",
        evidenceAnchors: [
          `mode:${mode.label}`,
          `open-incidents:${openIncidents.length}`,
          `pending-approvals:${pendingApprovalsCount}`,
          `queued:${queueSummary.queued}`,
        ],
      }
    : null;
  const toolInvocations = [
    {
      toolId: "documentParser",
      detail:
        "operations-analyst-agent parsed runtime state, service-state files, and proof freshness evidence to assemble the bounded control-plane brief.",
      evidence: [
        `open-incidents:${openIncidents.length}`,
        `pending-approvals:${pendingApprovalsCount}`,
        `queued:${queueSummary.queued}`,
        `processing:${queueSummary.processing}`,
      ],
      classification: "required",
    },
  ];

  return {
    success: true,
    controlPlaneBrief: {
      mode,
      primaryOperatorMove: primaryMove,
      pressureStory,
      queue: queueSummary,
      approvals: {
        pendingCount: pendingApprovalsCount,
      },
      incidents: {
        openCount: openIncidents.length,
        criticalCount: openIncidents.filter((incident) => incident.severity === "critical").length,
        dominantClassification,
        topQueue: incidentQueue.slice(0, 5).map((incident) => ({
          incidentId: incident.incidentId,
          priorityScore: incident.priorityScore,
          severity: incident.severity,
          nextAction: incident.nextAction,
        })),
      },
      publicProof: {
        status: publicProofStatus,
        milestoneFreshness,
        demandFreshness,
        latestDeliveredAt:
          [milestoneProof.latestDeliveredAt, demandProof.latestDeliveredAt]
            .filter((value): value is string => typeof value === "string" && value.length > 0)
            .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null,
      },
      services: serviceSummary,
      generatedAt: new Date().toISOString(),
      focus: typeof task.focus === "string" && task.focus.trim().length > 0 ? task.focus.trim() : null,
    },
    handoffPackage,
    toolInvocations,
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

  const resultFile = process.env.OPERATIONS_ANALYST_AGENT_RESULT_FILE;
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
