import { readFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSpecialistOperatorFields,
  loadRuntimeState,
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

type RolloutMode = "service" | "docker-demo" | "dual";
type DeploymentDecision = "ready" | "watch" | "blocked";

interface Task {
  id: string;
  type: string;
  target?: string;
  rolloutMode?: RolloutMode;
}

interface RuntimeState extends RuntimeStateSubset {}

interface SurfaceChecks {
  systemdService: boolean;
  dockerCompose: boolean;
  dockerfile: boolean;
  deployWorkflow: boolean;
  dockerDemoSmokeWorkflow: boolean;
  deploymentDocs: boolean;
  quickstartDocs: boolean;
}

interface Result {
  success: boolean;
  deploymentOps: {
    decision: DeploymentDecision;
    target: string | null;
    rolloutMode: RolloutMode;
    summary: string;
    blockers: string[];
    followups: string[];
    rollbackReadiness: {
      status: "ready" | "partial" | "missing";
      signals: string[];
    };
    environmentDrift: {
      status: "aligned" | "watching" | "drifting";
      signals: string[];
    };
    pipelinePosture: {
      status: "healthy" | "watching" | "blocked";
      latestRuns: Array<{
        type: string;
        status: string;
        lastHandledAt: string | null;
      }>;
    };
    surfaceChecks: SurfaceChecks;
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
const repoRoot = resolve(__dirname, "../../..");

function loadConfig(): AgentConfig {
  return JSON.parse(readFileSync(configPath, "utf-8")) as AgentConfig;
}

function canUseSkill(skillId: string): boolean {
  const config = loadConfig();
  return config.permissions.skills?.[skillId]?.allowed === true;
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(targetPath: string) {
  try {
    return await readFile(targetPath, "utf-8");
  } catch {
    return null;
  }
}

function normalizeRolloutMode(value: string | undefined): RolloutMode {
  if (value === "service" || value === "docker-demo" || value === "dual") {
    return value;
  }
  return "service";
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
    openIncidentCount: openIncidents.length,
    openCriticalIncidentCount: openIncidents.filter((incident) => incident.severity === "critical").length,
  };
}

function buildSurfaceBlockers(mode: RolloutMode, checks: SurfaceChecks) {
  const blockers: string[] = [];

  if ((mode === "service" || mode === "dual") && !checks.systemdService) {
    blockers.push("Canonical systemd service definition is missing.");
  }
  if ((mode === "docker-demo" || mode === "dual") && !checks.dockerCompose) {
    blockers.push("Public Docker compose surface is missing.");
  }
  if ((mode === "docker-demo" || mode === "dual") && !checks.dockerfile) {
    blockers.push("Public Docker image definition is missing.");
  }

  return blockers;
}

function buildRollbackReadiness(mode: RolloutMode, checks: SurfaceChecks) {
  const signals: string[] = [];
  const serviceRollbackReady = checks.systemdService;
  const dockerRollbackReady = checks.dockerCompose && checks.dockerfile;

  if (serviceRollbackReady) {
    signals.push("Service rollout has a canonical systemd unit file.");
  }
  if (dockerRollbackReady) {
    signals.push("Docker demo rollout has compose plus image definitions.");
  }
  if (checks.deploymentDocs) {
    signals.push("Deployment docs exist in both root and docs surfaces.");
  }

  const requiredModesReady =
    mode === "service"
      ? serviceRollbackReady
      : mode === "docker-demo"
        ? dockerRollbackReady
        : serviceRollbackReady && dockerRollbackReady;

  if (!requiredModesReady) {
    return {
      status: "missing" as const,
      signals: signals.length > 0 ? signals : ["Required rollback surfaces are missing for the selected rollout mode."],
    };
  }

  if (!checks.deploymentDocs) {
    return {
      status: "partial" as const,
      signals: [...signals, "Rollback posture exists, but deployment documentation parity is incomplete."],
    };
  }

  return {
    status: "ready" as const,
    signals,
  };
}

function buildEnvironmentDrift(checks: SurfaceChecks) {
  const signals: string[] = [];

  if (!checks.deploymentDocs) {
    signals.push("Deployment docs are missing from either the root or docs surface.");
  }
  if (!checks.quickstartDocs) {
    signals.push("Quickstart docs are missing from either the root or docs surface.");
  }
  if (!checks.deployWorkflow) {
    signals.push("Production deploy workflow file is missing.");
  }
  if (!checks.dockerDemoSmokeWorkflow) {
    signals.push("Docker demo smoke workflow file is missing.");
  }

  if (signals.length >= 3) {
    return {
      status: "drifting" as const,
      signals,
    };
  }

  if (signals.length > 0) {
    return {
      status: "watching" as const,
      signals,
    };
  }

  return {
    status: "aligned" as const,
    signals: [
      "Deployment files, workflows, and docs parity surfaces are present for the public repo.",
    ],
  };
}

function buildPipelinePosture(executions: RuntimeTaskExecution[]) {
  const latestRuns = [
    latestExecutionForType(executions, "release-readiness"),
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

  const blocked = latestRuns.some(
    (run) =>
      ["release-readiness", "qa-verification", "security-audit", "system-monitor"].includes(run.type) &&
      run.status === "failed",
  );

  if (blocked) {
    return {
      status: "blocked" as const,
      latestRuns,
    };
  }

  const watching = latestRuns.length < 4 || latestRuns.some((run) => run.status === "retrying");
  return {
    status: watching ? ("watching" as const) : ("healthy" as const),
    latestRuns,
  };
}

async function buildSurfaceChecks(): Promise<SurfaceChecks> {
  const servicePath = resolve(repoRoot, "systemd/orchestrator.service");
  const dockerComposePath = resolve(repoRoot, "docker-compose.yml");
  const dockerfilePath = resolve(repoRoot, "Dockerfile");
  const deployWorkflowPath = resolve(repoRoot, ".github/workflows/deploy.yml");
  const dockerDemoSmokeWorkflowPath = resolve(
    repoRoot,
    ".github/workflows/docker-demo-smoke.yml",
  );
  const deploymentRootDocPath = resolve(repoRoot, "DEPLOYMENT.md");
  const deploymentOpsDocPath = resolve(repoRoot, "docs/operations/deployment.md");
  const quickstartRootDocPath = resolve(repoRoot, "QUICKSTART.md");
  const quickstartDocPath = resolve(repoRoot, "docs/start/quickstart.md");

  const [
    systemdService,
    dockerCompose,
    dockerfile,
    deployWorkflow,
    dockerDemoSmokeWorkflow,
    deploymentRootDoc,
    deploymentOpsDoc,
    quickstartRootDoc,
    quickstartDoc,
  ] = await Promise.all([
    pathExists(servicePath),
    pathExists(dockerComposePath),
    pathExists(dockerfilePath),
    pathExists(deployWorkflowPath),
    pathExists(dockerDemoSmokeWorkflowPath),
    readTextIfExists(deploymentRootDocPath),
    readTextIfExists(deploymentOpsDocPath),
    readTextIfExists(quickstartRootDocPath),
    readTextIfExists(quickstartDocPath),
  ]);

  return {
    systemdService,
    dockerCompose,
    dockerfile,
    deployWorkflow,
    dockerDemoSmokeWorkflow,
    deploymentDocs:
      typeof deploymentRootDoc === "string" &&
      typeof deploymentOpsDoc === "string" &&
      deploymentRootDoc.length > 0 &&
      deploymentOpsDoc.length > 0,
    quickstartDocs:
      typeof quickstartRootDoc === "string" &&
      typeof quickstartDoc === "string" &&
      quickstartRootDoc.length > 0 &&
      quickstartDoc.length > 0,
  };
}

async function handleTask(task: Task): Promise<Result> {
  const startedAt = Date.now();
  const rolloutMode = normalizeRolloutMode(task.rolloutMode);
  const target =
    typeof task.target === "string" && task.target.trim().length > 0
      ? task.target.trim()
      : "public-runtime";

  if (!canUseSkill("documentParser")) {
    const specialistFields = buildSpecialistOperatorFields({
      role: "Deployment Ops",
      workflowStage: "deployment-refusal",
      deliverable: "bounded deployment posture",
      status: "refused",
      operatorSummary:
        "Deployment-ops synthesis was refused because documentParser access is unavailable to deployment-ops-agent.",
      recommendedNextActions: [
        "Restore documentParser access for deployment-ops-agent before retrying.",
      ],
      refusalReason:
        "Refused deployment-ops synthesis because documentParser skill access is not allowed for deployment-ops-agent.",
    });

    return {
      success: false,
      deploymentOps: {
        decision: "blocked",
        target,
        rolloutMode,
        summary: "Deployment posture could not be assembled.",
        blockers: ["documentParser unavailable"],
        followups: ["Restore deployment-ops-agent governed access."],
        rollbackReadiness: {
          status: "missing",
          signals: ["Deployment posture was refused before rollback checks could run."],
        },
        environmentDrift: {
          status: "drifting",
          signals: ["Deployment posture was refused before drift checks could run."],
        },
        pipelinePosture: {
          status: "blocked",
          latestRuns: [],
        },
        surfaceChecks: {
          systemdService: false,
          dockerCompose: false,
          dockerfile: false,
          deployWorkflow: false,
          dockerDemoSmokeWorkflow: false,
          deploymentDocs: false,
          quickstartDocs: false,
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
  const surfaceChecks = await buildSurfaceChecks();
  const surfaceBlockers = buildSurfaceBlockers(rolloutMode, surfaceChecks);
  const rollbackReadiness = buildRollbackReadiness(rolloutMode, surfaceChecks);
  const environmentDrift = buildEnvironmentDrift(surfaceChecks);
  const pipelinePosture = buildPipelinePosture(executions);

  const blockers: string[] = [];
  const followups: string[] = [];

  if (incidentSummary.openCriticalIncidentCount > 0) {
    blockers.push(
      `${incidentSummary.openCriticalIncidentCount} critical incident(s) remain unresolved.`,
    );
  }

  blockers.push(...surfaceBlockers);

  if (pipelinePosture.status === "blocked") {
    blockers.push("Core release, verification, security, or monitor evidence is currently blocked.");
  }

  let decision: DeploymentDecision = blockers.length > 0 ? "blocked" : "ready";

  if (decision !== "blocked") {
    if (pendingApprovals > 0) {
      decision = "watch";
      followups.push("Clear pending approvals before treating deployment posture as cutover-ready.");
    }

    if (incidentSummary.openIncidentCount > 0) {
      decision = "watch";
      followups.push("Resolve or consciously accept the remaining non-critical incidents.");
    }

    if (rollbackReadiness.status !== "ready") {
      decision = "watch";
      followups.push("Strengthen rollback posture before calling the rollout surface ready.");
    }

    if (environmentDrift.status !== "aligned") {
      decision = "watch";
      followups.push("Close deployment/docs/workflow drift before broad public rollout claims.");
    }

    if (pipelinePosture.status !== "healthy") {
      decision = "watch";
      followups.push("Refresh bounded release and verification evidence before cutover.");
    }
  }

  const summary =
    decision === "ready"
      ? "Deployment posture is ready: rollout surfaces, rollback posture, pipeline evidence, and docs parity are aligned for the selected bounded mode."
      : decision === "watch"
        ? "Deployment posture is watch: the rollout surface is not blocked outright, but approvals, drift, or incomplete evidence still need operator closure."
        : "Deployment posture is blocked: critical runtime, rollout-surface, or evidence conditions still block safe deployment posture.";

  const specialistFields = buildSpecialistOperatorFields({
    role: "Deployment Ops",
    workflowStage:
      decision === "ready"
        ? "deployment-ready"
        : decision === "watch"
          ? "deployment-watch"
          : "deployment-block",
    deliverable: "bounded deployment posture with rollback, drift, and pipeline guidance",
    status:
      decision === "ready"
        ? "completed"
        : decision === "watch"
          ? "watching"
          : "blocked",
    operatorSummary: summary,
    recommendedNextActions: [...blockers, ...followups].slice(0, 5),
    escalationReason:
      decision === "blocked"
        ? "Escalate because required rollout surfaces or critical runtime evidence still block safe deployment posture."
        : null,
  });

  return {
    success: decision !== "blocked",
    deploymentOps: {
      decision,
      target,
      rolloutMode,
      summary,
      blockers,
      followups: [...new Set(followups)].slice(0, 6),
      rollbackReadiness,
      environmentDrift,
      pipelinePosture,
      surfaceChecks,
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

  const resultFile = process.env.DEPLOYMENT_OPS_AGENT_RESULT_FILE;
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
