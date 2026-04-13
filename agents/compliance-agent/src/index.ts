import { readFileSync } from "node:fs";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSpecialistOperatorFields,
  loadRuntimeState,
  type RuntimeStateSubset,
  type RuntimeTaskExecution,
} from "../../shared/runtime-evidence.js";

interface AgentConfig {
  id: string;
  name: string;
  orchestratorStatePath: string;
  permissions: {
    skills?: Record<string, { allowed?: boolean }>;
    fileSystem?: {
      readPaths?: string[];
    };
  };
}

type ComplianceDecision = "clear" | "watching" | "blocked";

type ComplianceStatus = "strong" | "partial" | "missing";

type RiskStatus = "clear" | "watching" | "blocked";

interface Task {
  id: string;
  type: string;
  target?: string;
  focusAreas?: string[] | string;
}

interface RuntimeState extends RuntimeStateSubset {}

interface Result {
  success: boolean;
  compliance: {
    decision: ComplianceDecision;
    target: string;
    summary: string;
    blockers: string[];
    followups: string[];
    focus: {
      requestedAreas: string[];
      matchedAreas: string[];
      missingAreas: string[];
    };
    policyCoverage: {
      status: ComplianceStatus;
      requiredDocs: string[];
      presentDocs: string[];
      missingDocs: string[];
    };
    dependencyReview: {
      status: ComplianceStatus;
      manifestCount: number;
      dependencyCount: number;
      lockfilesFound: string[];
      licenseIndicators: string[];
    };
    releaseRisk: {
      status: RiskStatus;
      latestReleaseStatus: string | null;
      latestSecurityStatus: string | null;
      latestTestStatus: string | null;
      signals: string[];
    };
    evidenceWindow: {
      since: string;
      recentRunCount: number;
      latestHandledAt: string | null;
      observedTaskTypes: string[];
    };
    evidenceSources: string[];
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
const repoRoot = resolve(__dirname, "../../..");

const EVIDENCE_WINDOW_HOURS = 96;
const DEFAULT_FOCUS_AREAS = ["policies", "dependencies", "release"] as const;
const ALLOWED_FOCUS_AREAS = [
  "policies",
  "dependencies",
  "release",
  "security",
  "approvals",
] as const;

const REQUIRED_POLICY_DOCS = ["LICENSE", "SECURITY.md"] as const;
const OPTIONAL_POLICY_DOCS = [
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "README.md",
  "docs/operations/public-release.md",
  "docs/operations/deployment.md",
  "docs/operations/backup-recovery.md",
] as const;

const MANIFEST_PATHS = [
  "package.json",
  "orchestrator/package.json",
  "operator-s-console/package.json",
] as const;

const LOCKFILE_PATHS = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "orchestrator/package-lock.json",
  "operator-s-console/package-lock.json",
] as const;

const RELEASE_TASK_TYPES = [
  "release-readiness",
  "security-audit",
  "test-intelligence",
] as const;

function loadConfig(): AgentConfig {
  return JSON.parse(readFileSync(configPath, "utf-8")) as AgentConfig;
}

function canUseSkill(skillId: string): boolean {
  const config = loadConfig();
  return config.permissions.skills?.[skillId]?.allowed === true;
}

function normalizeTarget(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "workspace";
}

function normalizeFocusAreas(value: unknown) {
  const raw =
    typeof value === "string"
      ? value
          .split(/\r?\n|,/)
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean)
      : Array.isArray(value)
        ? value
            .map((entry) =>
              typeof entry === "string" ? entry.trim().toLowerCase() : "",
            )
            .filter(Boolean)
        : [];

  const unique = [...new Set(raw)];
  if (unique.length === 0) {
    return [...DEFAULT_FOCUS_AREAS];
  }
  return unique.slice(0, 8);
}

function resolveAbsoluteRepoPath(relativePath: string) {
  return resolve(repoRoot, relativePath);
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(targetPath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(targetPath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toTimestamp(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function selectLatestExecution(
  executions: RuntimeTaskExecution[],
  taskType: string,
): RuntimeTaskExecution | null {
  return (
    executions
      .filter((execution) => execution.type === taskType)
      .sort((left, right) => toTimestamp(right.lastHandledAt) - toTimestamp(left.lastHandledAt))[0] ??
    null
  );
}

async function handleTask(task: Task): Promise<Result> {
  const startedAt = Date.now();
  const target = normalizeTarget(task.target);
  const requestedAreas = normalizeFocusAreas(task.focusAreas);
  const matchedAreas = requestedAreas.filter((area) =>
    ALLOWED_FOCUS_AREAS.includes(area as (typeof ALLOWED_FOCUS_AREAS)[number]),
  );
  const missingAreas = requestedAreas.filter((area) => !matchedAreas.includes(area));

  if (!canUseSkill("documentParser")) {
    const specialistFields = buildSpecialistOperatorFields({
      role: "Compliance Review",
      workflowStage: "compliance-refusal",
      deliverable: "bounded compliance posture across policies and dependency evidence",
      status: "refused",
      operatorSummary:
        "Compliance review was refused because documentParser access is unavailable to compliance-agent.",
      recommendedNextActions: [
        "Restore documentParser access for compliance-agent before retrying.",
      ],
      refusalReason:
        "Refused compliance review because documentParser skill access is not allowed for compliance-agent.",
    });

    return {
      success: false,
      compliance: {
        decision: "blocked",
        target,
        summary: "Compliance posture could not be assembled.",
        blockers: ["documentParser unavailable"],
        followups: ["Restore compliance-agent governed access."],
        focus: {
          requestedAreas,
          matchedAreas: [],
          missingAreas: requestedAreas,
        },
        policyCoverage: {
          status: "missing",
          requiredDocs: [...REQUIRED_POLICY_DOCS],
          presentDocs: [],
          missingDocs: [...REQUIRED_POLICY_DOCS],
        },
        dependencyReview: {
          status: "missing",
          manifestCount: 0,
          dependencyCount: 0,
          lockfilesFound: [],
          licenseIndicators: [],
        },
        releaseRisk: {
          status: "blocked",
          latestReleaseStatus: null,
          latestSecurityStatus: null,
          latestTestStatus: null,
          signals: [
            "Compliance review was refused before release-facing governance evidence could be inspected.",
          ],
        },
        evidenceWindow: {
          since: new Date(
            Date.now() - EVIDENCE_WINDOW_HOURS * 60 * 60 * 1000,
          ).toISOString(),
          recentRunCount: 0,
          latestHandledAt: null,
          observedTaskTypes: [],
        },
        evidenceSources: [],
      },
      handoffPackage: null,
      toolInvocations: [],
      ...specialistFields,
      executionTime: Date.now() - startedAt,
    };
  }

  const config = loadConfig();
  const policyDocs = [...REQUIRED_POLICY_DOCS, ...OPTIONAL_POLICY_DOCS];
  const policyChecks = await Promise.all(
    policyDocs.map(async (doc) => ({
      path: doc,
      exists: await pathExists(resolveAbsoluteRepoPath(doc)),
    })),
  );
  const presentDocs = policyChecks.filter((doc) => doc.exists).map((doc) => doc.path);
  const missingDocs = policyChecks.filter((doc) => !doc.exists).map((doc) => doc.path);
  const requiredMissing = REQUIRED_POLICY_DOCS.filter(
    (doc) => !presentDocs.includes(doc),
  );

  const policyStatus: ComplianceStatus =
    requiredMissing.length > 0
      ? "missing"
      : missingDocs.length > 0
        ? "partial"
        : "strong";

  const manifestReports = await Promise.all(
    MANIFEST_PATHS.map(async (entry) => {
      const absolutePath = resolveAbsoluteRepoPath(entry);
      if (!(await pathExists(absolutePath))) {
        return { path: entry, exists: false, dependencyCount: 0, license: null };
      }
      const manifest = await readJsonFile<Record<string, unknown>>(absolutePath, {});
      const dependencyCount =
        Object.keys((manifest.dependencies as Record<string, unknown>) ?? {}).length +
        Object.keys((manifest.devDependencies as Record<string, unknown>) ?? {}).length +
        Object.keys((manifest.optionalDependencies as Record<string, unknown>) ?? {}).length +
        Object.keys((manifest.peerDependencies as Record<string, unknown>) ?? {}).length;
      const license =
        typeof manifest.license === "string" && manifest.license.trim().length > 0
          ? manifest.license.trim()
          : null;
      return { path: entry, exists: true, dependencyCount, license };
    }),
  );

  const manifestCount = manifestReports.filter((report) => report.exists).length;
  const dependencyCount = manifestReports.reduce(
    (total, report) => total + report.dependencyCount,
    0,
  );
  const licenseIndicators = Array.from(
    new Set(
      manifestReports
        .map((report) => report.license)
        .filter((value): value is string => typeof value === "string"),
    ),
  );

  if (presentDocs.includes("LICENSE") && !licenseIndicators.includes("LICENSE")) {
    licenseIndicators.push("LICENSE");
  }

  const lockfilesFound = (
    await Promise.all(
      LOCKFILE_PATHS.map(async (entry) =>
        (await pathExists(resolveAbsoluteRepoPath(entry))) ? entry : null,
      ),
    )
  ).filter((entry): entry is string => typeof entry === "string");

  const dependencyStatus: ComplianceStatus =
    manifestCount === 0
      ? "missing"
      : lockfilesFound.length > 0 && licenseIndicators.length > 0
        ? "strong"
        : "partial";

  const runtimeState = await loadRuntimeState<RuntimeState>(
    configPath,
    config.orchestratorStatePath,
  );

  const evidenceCutoffMs = Date.now() - EVIDENCE_WINDOW_HOURS * 60 * 60 * 1000;
  const executions = (runtimeState.taskExecutions ?? [])
    .filter((entry) =>
      RELEASE_TASK_TYPES.includes(entry.type as (typeof RELEASE_TASK_TYPES)[number]),
    )
    .filter((entry) => toTimestamp(entry.lastHandledAt) >= evidenceCutoffMs);

  const latestRelease = selectLatestExecution(executions, "release-readiness");
  const latestSecurity = selectLatestExecution(executions, "security-audit");
  const latestTest = selectLatestExecution(executions, "test-intelligence");

  const releaseSignals: string[] = [];
  const latestReleaseStatus = latestRelease?.status ?? null;
  const latestSecurityStatus = latestSecurity?.status ?? null;
  const latestTestStatus = latestTest?.status ?? null;

  if (latestReleaseStatus) releaseSignals.push(`release:${latestReleaseStatus}`);
  if (latestSecurityStatus) releaseSignals.push(`security:${latestSecurityStatus}`);
  if (latestTestStatus) releaseSignals.push(`test:${latestTestStatus}`);

  const releaseRiskStatus: RiskStatus =
    [latestReleaseStatus, latestSecurityStatus, latestTestStatus].some(
      (status) => status && status !== "success",
    )
      ? "blocked"
      : [latestRelease, latestSecurity, latestTest].some((entry) => !entry)
        ? "watching"
        : "clear";

  const blockers: string[] = [];
  const followups: string[] = [];

  if (requiredMissing.length > 0) {
    followups.push(`Missing policy document(s): ${requiredMissing.join(", ")}.`);
  }
  if (dependencyStatus === "missing") {
    blockers.push("No dependency manifests were discovered in bounded read paths.");
  }
  if (dependencyStatus === "partial" && lockfilesFound.length === 0) {
    followups.push("No lockfile was detected; add a lockfile to stabilize dependency posture.");
  }
  if (licenseIndicators.length === 0) {
    followups.push("No license identifier was detected in manifests or LICENSE file.");
  }
  if (releaseRiskStatus === "blocked") {
    blockers.push("Release-facing governance evidence reports blocked posture.");
  }
  if (releaseRiskStatus === "watching") {
    followups.push("Run or review release-readiness, security-audit, and test-intelligence evidence.");
  }
  if (policyStatus === "partial" && requiredMissing.length === 0) {
    followups.push("Fill missing optional governance docs to strengthen compliance coverage.");
  }

  const decision: ComplianceDecision =
    blockers.length > 0
      ? "blocked"
      : policyStatus === "strong" &&
          dependencyStatus === "strong" &&
          releaseRiskStatus === "clear"
        ? "clear"
        : "watching";

  const summary =
    decision === "clear"
      ? "Compliance posture is clear: required policy docs and dependency evidence are present, and release-facing governance signals are healthy."
      : decision === "watching"
        ? "Compliance posture is watching: bounded evidence exists, but policy or dependency coverage still needs operator review."
        : "Compliance posture is blocked: required policy or governance evidence is missing or release-facing signals are blocked.";

  const specialistFields = buildSpecialistOperatorFields({
    role: "Compliance Review",
    workflowStage:
      decision === "clear"
        ? "compliance-clear"
        : decision === "watching"
          ? "compliance-watch"
          : "compliance-block",
    deliverable: "bounded compliance posture across policies, dependencies, and release governance",
    status:
      decision === "clear"
        ? "completed"
        : decision === "watching"
          ? "watching"
          : "blocked",
    operatorSummary: summary,
    recommendedNextActions: [...blockers, ...followups].slice(0, 5),
    escalationReason:
      decision === "blocked"
        ? "Escalate because required policy or release-facing governance evidence is missing or blocked."
        : null,
  });

  const handoffPackage =
    decision === "clear"
      ? null
      : {
          targetAgentId: "security-agent",
          payloadType: "compliance-review",
          reason: summary,
          recommendedTaskType: "security-audit",
          evidenceAnchors: [
            `decision:${decision}`,
            `policy-status:${policyStatus}`,
            `dependency-status:${dependencyStatus}`,
            `release-risk:${releaseRiskStatus}`,
          ],
        };

  const toolInvocations = [
    {
      toolId: "documentParser",
      detail:
        "compliance-agent parsed bounded policy documents, manifest metadata, and runtime governance evidence to synthesize compliance posture.",
      evidence: [
        `decision:${decision}`,
        `policy-status:${policyStatus}`,
        `manifest-count:${manifestCount}`,
        `dependency-count:${dependencyCount}`,
        `release-risk:${releaseRiskStatus}`,
      ],
      classification: "required",
    },
  ];

  const evidenceWindowLatest = executions
    .map((entry) => entry.lastHandledAt ?? null)
    .sort((left, right) => toTimestamp(right) - toTimestamp(left))[0] ?? null;

  return {
    success: decision !== "blocked",
    compliance: {
      decision,
      target,
      summary,
      blockers,
      followups: [...new Set(followups)].slice(0, 6),
      focus: {
        requestedAreas,
        matchedAreas,
        missingAreas,
      },
      policyCoverage: {
        status: policyStatus,
        requiredDocs: [...REQUIRED_POLICY_DOCS],
        presentDocs,
        missingDocs,
      },
      dependencyReview: {
        status: dependencyStatus,
        manifestCount,
        dependencyCount,
        lockfilesFound,
        licenseIndicators,
      },
      releaseRisk: {
        status: releaseRiskStatus,
        latestReleaseStatus,
        latestSecurityStatus,
        latestTestStatus,
        signals: releaseSignals,
      },
      evidenceWindow: {
        since: new Date(evidenceCutoffMs).toISOString(),
        recentRunCount: executions.length,
        latestHandledAt: evidenceWindowLatest,
        observedTaskTypes: [
          ...new Set(executions.map((entry) => entry.type ?? "unknown")),
        ].slice(0, 8),
      },
      evidenceSources: [
        ...presentDocs.map((doc) => `policy:${doc}`),
        ...manifestReports.map((report) => `manifest:${report.path}`),
        ...lockfilesFound.map((lockfile) => `lockfile:${lockfile}`),
        ...(latestReleaseStatus ? [`runtime:release-readiness:${latestReleaseStatus}`] : []),
        ...(latestSecurityStatus ? [`runtime:security-audit:${latestSecurityStatus}`] : []),
        ...(latestTestStatus ? [`runtime:test-intelligence:${latestTestStatus}`] : []),
      ],
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

  const resultFile = process.env.COMPLIANCE_AGENT_RESULT_FILE;
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
