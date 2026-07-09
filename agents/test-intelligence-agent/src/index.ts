import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSpecialistOperatorFields,
  type RuntimeStateSubset,
  type RuntimeTaskExecution,
} from "../../shared/runtime-evidence.js";
import {
  hasAllowedSkills,
  readRepoDirectoryWithSkill,
  readRepoJsonWithSkill,
  readRuntimeStateWithSkill,
  repoPathExistsWithSkill,
} from "../../shared/governed-readers.js";

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

type TestDecision = "ready" | "watching" | "blocked";
type CoverageStatus = "broad" | "focused" | "thin";
type RiskStatus = "clear" | "watching" | "blocked";

interface Task {
  id: string;
  type: string;
  target?: string;
  focusSuites?: string[] | string;
}

interface RuntimeState extends RuntimeStateSubset {}

interface SuiteDefinition {
  id: string;
  label: string;
  testRoots: string[];
  packageJsonPath?: string;
  configFiles: string[];
}

interface SuiteSurface {
  id: string;
  label: string;
  testRoots: string[];
  fileCount: number;
  sampleFiles: string[];
  scriptNames: string[];
  configSignals: string[];
}

interface Result {
  success: boolean;
  testIntelligence: {
    decision: TestDecision;
    target: string;
    summary: string;
    blockers: string[];
    followups: string[];
    focus: {
      requestedSuites: string[];
      matchedSuites: string[];
      missingSuites: string[];
    };
    suiteCoverage: {
      status: CoverageStatus;
      suiteCount: number;
      totalTestFiles: number;
      discoveredSuites: SuiteSurface[];
    };
    recentFailures: {
      status: RiskStatus;
      recentRunCount: number;
      failedRunCount: number;
      retryingRunCount: number;
      examples: string[];
    };
    flakySignals: {
      status: RiskStatus;
      retryRecoveryCount: number;
      multiAttemptRunCount: number;
      retryingRunCount: number;
      signals: string[];
    };
    releaseRisk: {
      status: RiskStatus;
      latestQaStatus: string | null;
      latestReleaseStatus: string | null;
      latestBuildStatus: string | null;
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
const REQUIRED_SKILLS = ["runtimeStateReader", "repoFileReader"] as const;
const EVIDENCE_WINDOW_HOURS = 96;
const MAX_SAMPLE_FILES = 4;
const MAX_RECENT_RUNS = 16;
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".turbo",
  ".next",
  "build",
]);
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx)$/i;
const DEFAULT_SUITE_IDS = ["orchestrator", "operator-ui", "agents"] as const;
const RELEVANT_TASK_TYPES = [
  "qa-verification",
  "build-refactor",
  "release-readiness",
  "deployment-ops",
  "code-index",
  "security-audit",
  "system-monitor",
] as const;
const SUITE_DEFINITIONS: SuiteDefinition[] = [
  {
    id: "orchestrator",
    label: "Orchestrator Runtime",
    testRoots: ["orchestrator/test"],
    packageJsonPath: "orchestrator/package.json",
    configFiles: ["orchestrator/vitest.config.ts"],
  },
  {
    id: "operator-ui",
    label: "Operator Console",
    testRoots: ["operator-s-console/src/test"],
    packageJsonPath: "operator-s-console/package.json",
    configFiles: [],
  },
  {
    id: "agents",
    label: "Agent Packages",
    testRoots: ["agents"],
    configFiles: [],
  },
];

function loadConfig(): AgentConfig {
  return JSON.parse(readFileSync(configPath, "utf-8")) as AgentConfig;
}

function canUseSkill(skillId: string): boolean {
  const config = loadConfig();
  return hasAllowedSkills(config, [skillId]);
}

function normalizeBoundaryPath(value: string) {
  const sanitizedValue = value.replace(/\\/g, "/").trim();
  if (!sanitizedValue) {
    return "";
  }

  const normalizedValue = posix.normalize(sanitizedValue)
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/$/, "");

  return normalizedValue === "." ? "" : normalizedValue;
}

function pathMatchesBoundary(targetPath: string, boundary: string) {
  const normalizedTarget = normalizeBoundaryPath(targetPath);
  const normalizedBoundary = normalizeBoundaryPath(boundary);

  if (!normalizedTarget || !normalizedBoundary) {
    return false;
  }

  return (
    normalizedTarget === normalizedBoundary ||
    normalizedTarget.startsWith(`${normalizedBoundary}/`) ||
    normalizedTarget.endsWith(`/${normalizedBoundary}`) ||
    normalizedTarget.includes(`/${normalizedBoundary}/`)
  );
}

function normalizeTarget(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "workspace";
}

function normalizeFocusSuites(value: unknown) {
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

  return [...new Set(raw)].slice(0, 8);
}

function resolveReadBoundaries(config: AgentConfig) {
  return (config.permissions.fileSystem?.readPaths ?? [])
    .map((entry) =>
      normalizeBoundaryPath(relative(repoRoot, resolve(dirname(configPath), entry))),
    )
    .filter(Boolean);
}

function isPathAllowed(relativePath: string, boundaries: string[]) {
  return boundaries.some((boundary) => pathMatchesBoundary(relativePath, boundary));
}

function toRepoSkillPath(relativePath: string) {
  return `../../${relativePath}`;
}

async function collectTestFiles(
  agentId: string,
  relativeRoot: string,
): Promise<string[]> {
  const directory = await readRepoDirectoryWithSkill(
    agentId,
    toRepoSkillPath(relativeRoot),
    relativeRoot,
    {
      recursive: true,
      maxEntries: 2000,
      extensions: [".ts", ".tsx", ".js", ".jsx"],
    },
  );
  if (!directory.exists) {
    return [];
  }

  return directory.entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => normalizeBoundaryPath(entry.path))
    .filter((entry) => !entry.split("/").some((segment) => IGNORED_DIRS.has(segment)))
    .filter((entry) => TEST_FILE_PATTERN.test(entry))
    .sort();
}

async function collectPackageScripts(
  agentId: string,
  packageJsonPath?: string,
) {
  if (!packageJsonPath) {
    return [];
  }

  const packageJson = await readRepoJsonWithSkill<{ scripts?: Record<string, string> }>(
    agentId,
    toRepoSkillPath(packageJsonPath),
    packageJsonPath,
  );
  if (!packageJson) {
    return [];
  }
  return Object.keys(packageJson.scripts ?? {})
    .filter(
      (name) =>
        name === "test" ||
        name.startsWith("test:") ||
        name === "verify" ||
        name.startsWith("verify:"),
    )
    .sort();
}

async function collectConfigSignals(
  agentId: string,
  configFiles: string[],
  boundaries: string[],
) {
  const signals = await Promise.all(
    configFiles.map(async (configPath) => {
      if (!isPathAllowed(configPath, boundaries)) {
        return null;
      }

      const exists = await repoPathExistsWithSkill(
        agentId,
        toRepoSkillPath(configPath),
        configPath,
      );
      return exists ? `config:${normalizeBoundaryPath(configPath)}` : null;
    }),
  );

  return signals.filter((value): value is string => Boolean(value));
}

/**
 * The suite surface intentionally combines file truth with later runtime truth:
 * local repo reads establish what test coverage exists, while runtime-state
 * evidence decides whether that coverage is healthy enough to trust.
 */
async function buildSuiteSurface(
  agentId: string,
  definition: SuiteDefinition,
  boundaries: string[],
): Promise<SuiteSurface | null> {
  const allowedRoots = definition.testRoots.filter((root) =>
    isPathAllowed(root, boundaries),
  );
  const packageScripts =
    definition.packageJsonPath && isPathAllowed(definition.packageJsonPath, boundaries)
      ? await collectPackageScripts(agentId, definition.packageJsonPath)
      : [];
  const configSignals = await collectConfigSignals(
    agentId,
    definition.configFiles,
    boundaries,
  );

  if (allowedRoots.length === 0 && packageScripts.length === 0 && configSignals.length === 0) {
    return null;
  }

  const fileLists = await Promise.all(
    allowedRoots.map((root) => collectTestFiles(agentId, root)),
  );
  const allFiles = fileLists.flat();

  return {
    id: definition.id,
    label: definition.label,
    testRoots: allowedRoots,
    fileCount: allFiles.length,
    sampleFiles: allFiles.slice(0, MAX_SAMPLE_FILES),
    scriptNames: packageScripts,
    configSignals,
  };
}

function buildCoverageStatus(totalTestFiles: number, suiteCount: number): CoverageStatus {
  if (totalTestFiles >= 40 && suiteCount >= 3) {
    return "broad";
  }
  if (totalTestFiles >= 10 && suiteCount >= 1) {
    return "focused";
  }
  return "thin";
}

function parseIsoMs(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function sortExecutions(executions: RuntimeTaskExecution[]) {
  return executions
    .slice()
    .sort((left, right) => {
      const leftTime = parseIsoMs(left.lastHandledAt) ?? 0;
      const rightTime = parseIsoMs(right.lastHandledAt) ?? 0;
      return rightTime - leftTime;
    });
}

function latestExecutionForType(
  executions: RuntimeTaskExecution[],
  type: string,
): RuntimeTaskExecution | null {
  return executions.find((execution) => execution.type === type) ?? null;
}

function summarizeRunExample(execution: RuntimeTaskExecution) {
  const errorSummary =
    typeof execution.lastError === "string" && execution.lastError.trim().length > 0
      ? ` (${execution.lastError.trim().slice(0, 90)})`
      : "";
  return `${execution.type ?? "unknown"}:${execution.status ?? "unknown"}${errorSummary}`;
}

/**
 * This lane is intentionally bounded to recent control-plane evidence. It is
 * meant to answer "can we trust the local test posture right now?" rather than
 * reconstructing the full historical CI story.
 */
async function handleTask(task: Task): Promise<Result> {
  const startedAt = Date.now();
  const target = normalizeTarget(task.target);
  const requestedSuites = normalizeFocusSuites(task.focusSuites);

  if (!hasAllowedSkills(loadConfig(), [...REQUIRED_SKILLS])) {
    const specialistFields = buildSpecialistOperatorFields({
      role: "Test Intelligence",
      workflowStage: "test-intelligence-refusal",
      deliverable: "bounded test-intelligence posture",
      status: "refused",
      operatorSummary:
        "Test-intelligence synthesis was refused because the required governed reader skills are unavailable to test-intelligence-agent.",
      recommendedNextActions: [
        "Restore runtimeStateReader and repoFileReader access for test-intelligence-agent before retrying.",
      ],
      refusalReason:
        "Refused test-intelligence synthesis because required governed reader skills are not allowed for test-intelligence-agent.",
    });

    return {
      success: false,
      testIntelligence: {
        decision: "blocked",
        target,
        summary: "Test-intelligence posture could not be assembled.",
        blockers: ["governed readers unavailable"],
        followups: ["Restore test-intelligence-agent governed access."],
        focus: {
          requestedSuites,
          matchedSuites: [],
          missingSuites: requestedSuites,
        },
        suiteCoverage: {
          status: "thin",
          suiteCount: 0,
          totalTestFiles: 0,
          discoveredSuites: [],
        },
        recentFailures: {
          status: "blocked",
          recentRunCount: 0,
          failedRunCount: 0,
          retryingRunCount: 0,
          examples: [
            "Test-intelligence posture was refused before runtime failure evidence could be inspected.",
          ],
        },
        flakySignals: {
          status: "blocked",
          retryRecoveryCount: 0,
          multiAttemptRunCount: 0,
          retryingRunCount: 0,
          signals: [
            "Test-intelligence posture was refused before retry signals could be inspected.",
          ],
        },
        releaseRisk: {
          status: "blocked",
          latestQaStatus: null,
          latestReleaseStatus: null,
          latestBuildStatus: null,
          signals: [
            "Test-intelligence posture was refused before release-facing verifier evidence could be inspected.",
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
  const boundaries = resolveReadBoundaries(config);
  const selectedSuiteIds =
    requestedSuites.length > 0 ? requestedSuites : [...DEFAULT_SUITE_IDS];
  const missingSuites = selectedSuiteIds.filter(
    (suiteId) => !SUITE_DEFINITIONS.some((entry) => entry.id === suiteId),
  );
  const selectedDefinitions = SUITE_DEFINITIONS.filter((entry) =>
    selectedSuiteIds.includes(entry.id),
  );

  const discoveredSuites = (
    await Promise.all(
      selectedDefinitions.map((definition) =>
        buildSuiteSurface(config.id, definition, boundaries),
      ),
    )
  ).filter((entry): entry is SuiteSurface => Boolean(entry));

  const matchedSuites = discoveredSuites.map((suite) => suite.id);
  const totalTestFiles = discoveredSuites.reduce(
    (sum, suite) => sum + suite.fileCount,
    0,
  );
  const coverageStatus = buildCoverageStatus(totalTestFiles, discoveredSuites.length);

  const { state: runtimeState } = await readRuntimeStateWithSkill<RuntimeState>(
    config.id,
    config.orchestratorStatePath,
  );
  const allRelevantRuns = sortExecutions(
    (runtimeState.taskExecutions ?? []).filter((execution) =>
      RELEVANT_TASK_TYPES.includes(
        (execution.type ?? "") as (typeof RELEVANT_TASK_TYPES)[number],
      ),
    ),
  );
  const evidenceCutoffMs = Date.now() - EVIDENCE_WINDOW_HOURS * 60 * 60 * 1000;
  const windowRuns = allRelevantRuns.filter((execution) => {
    const handledMs = parseIsoMs(execution.lastHandledAt);
    return handledMs !== null && handledMs >= evidenceCutoffMs;
  });
  const recentRuns =
    windowRuns.length > 0
      ? windowRuns.slice(0, MAX_RECENT_RUNS)
      : allRelevantRuns.slice(0, MAX_RECENT_RUNS);

  const failedRuns = recentRuns.filter((execution) => execution.status === "failed");
  const retryingRuns = recentRuns.filter((execution) => execution.status === "retrying");
  const multiAttemptRuns = recentRuns.filter((execution) => (execution.attempt ?? 1) > 1);
  const retryRecoveries = (runtimeState.taskRetryRecoveries ?? []).filter((entry) => {
    const retryMs = parseIsoMs(entry.retryAt);
    return retryMs !== null && retryMs >= evidenceCutoffMs;
  });

  const recentFailuresStatus: RiskStatus =
    failedRuns.length > 0
      ? "blocked"
      : retryingRuns.length > 0
        ? "watching"
        : "clear";
  const recentFailureExamples = [...failedRuns, ...retryingRuns]
    .slice(0, 4)
    .map((execution) => summarizeRunExample(execution));

  const flakySignals: string[] = [];
  if (retryRecoveries.length > 0) {
    flakySignals.push(
      `${retryRecoveries.length} retry recovery record(s) were scheduled in the current evidence window.`,
    );
  }
  if (multiAttemptRuns.length > 0) {
    flakySignals.push(`${multiAttemptRuns.length} recent run(s) needed multiple attempts.`);
  }
  if (retryingRuns.length > 0) {
    flakySignals.push(`${retryingRuns.length} recent run(s) remain in retrying status.`);
  }
  const flakyStatus: RiskStatus = flakySignals.length > 0 ? "watching" : "clear";

  const latestQa = latestExecutionForType(allRelevantRuns, "qa-verification");
  const latestRelease = latestExecutionForType(allRelevantRuns, "release-readiness");
  const latestBuild = latestExecutionForType(allRelevantRuns, "build-refactor");
  const releaseSignals: string[] = [];
  if (!latestQa) {
    releaseSignals.push("No recent qa-verification run is recorded in runtime state.");
  } else if (latestQa.status === "failed") {
    releaseSignals.push("Latest qa-verification run failed.");
  } else if (latestQa.status === "retrying") {
    releaseSignals.push("Latest qa-verification run is still retrying.");
  }
  if (latestRelease?.status === "failed") {
    releaseSignals.push("Latest release-readiness run failed.");
  }
  if (latestBuild?.status === "failed") {
    releaseSignals.push("Latest build-refactor run failed.");
  }
  if (failedRuns.length > 0) {
    releaseSignals.push(
      `${failedRuns.length} relevant runtime run(s) failed inside the evidence window.`,
    );
  }
  const releaseRiskStatus: RiskStatus =
    latestQa?.status === "failed" || latestRelease?.status === "failed"
      ? "blocked"
      : releaseSignals.length > 0
        ? "watching"
        : "clear";

  const blockers: string[] = [];
  const followups: string[] = [];

  if (selectedDefinitions.length === 0) {
    blockers.push(
      "No supported focus suites were requested for bounded test-intelligence review.",
    );
  }
  if (discoveredSuites.length === 0) {
    blockers.push("No bounded local test surfaces were available for test-intelligence review.");
  }
  if (totalTestFiles === 0) {
    blockers.push("No bounded test files were discovered across the selected suites.");
  }
  if (missingSuites.length > 0) {
    followups.push(`Remove or correct unsupported focus suites: ${missingSuites.join(", ")}.`);
  }
  if (coverageStatus !== "broad") {
    followups.push(
      "Broaden or refresh the bounded test surfaces before treating test posture as fully ready.",
    );
  }
  if (recentFailuresStatus !== "clear") {
    followups.push("Review the recent failed or retrying runs before treating test posture as stable.");
  }
  if (flakyStatus !== "clear") {
    followups.push(
      "Investigate retry recoveries or multi-attempt runs before promoting the current test posture.",
    );
  }
  if (releaseRiskStatus !== "clear") {
    followups.push(
      "Run or review qa-verification and release-readiness evidence before making strong release claims.",
    );
  }

  const decision: TestDecision =
    blockers.length > 0
      ? "blocked"
      : coverageStatus === "broad" &&
          recentFailuresStatus === "clear" &&
          flakyStatus === "clear" &&
          releaseRiskStatus === "clear"
        ? "ready"
        : "watching";

  const summary =
    decision === "ready"
      ? "Test-intelligence posture is ready: bounded test surfaces are broad, recent runtime failures are clear, and release-facing verifier evidence is healthy."
      : decision === "watching"
        ? "Test-intelligence posture is watching: bounded coverage exists, but recent failures, retry noise, or release-facing verifier evidence still need operator review."
        : "Test-intelligence posture is blocked: bounded test surfaces or governed access are insufficient for safe review.";

  const specialistFields = buildSpecialistOperatorFields({
    role: "Test Intelligence",
    workflowStage:
      decision === "ready"
        ? "test-intelligence-ready"
        : decision === "watching"
          ? "test-intelligence-watch"
          : "test-intelligence-block",
    deliverable: "bounded test posture with failure, retry, and release-risk guidance",
    status:
      decision === "ready"
        ? "completed"
        : decision === "watching"
          ? "watching"
          : "blocked",
    operatorSummary: summary,
    recommendedNextActions: [...blockers, ...followups].slice(0, 5),
    escalationReason:
      decision === "blocked"
        ? "Escalate because bounded test surfaces or governed read access still block safe test-intelligence review."
        : null,
  });

  const handoffPackage =
    decision === "ready"
      ? null
      : {
          targetAgentId: "qa-verification-agent",
          payloadType: "test-intelligence",
          reason: summary,
          recommendedTaskType: "qa-verification",
          evidenceAnchors: [
            `decision:${decision}`,
            `coverage:${coverageStatus}`,
            `failed-runs:${failedRuns.length}`,
            `retry-recoveries:${retryRecoveries.length}`,
            `release-risk:${releaseRiskStatus}`,
          ],
        };

  const toolInvocations = [
    {
      toolId: "repoFileReader",
      detail:
        "test-intelligence-agent read bounded package manifests and local test roots to synthesize test-surface coverage.",
      evidence: [
        `decision:${decision}`,
        `suite-count:${discoveredSuites.length}`,
        `total-test-files:${totalTestFiles}`,
        `recent-run-count:${recentRuns.length}`,
        `release-risk:${releaseRiskStatus}`,
      ],
      classification: "required",
    },
    {
      toolId: "runtimeStateReader",
      detail:
        "test-intelligence-agent read bounded runtime-state evidence to inspect recent failures, retries, and release-facing verifier posture.",
      evidence: [
        `failed-runs:${failedRuns.length}`,
        `retrying-runs:${retryingRuns.length}`,
        `retry-recoveries:${retryRecoveries.length}`,
      ],
      classification: "required",
    },
  ];

  return {
    success: decision !== "blocked",
    testIntelligence: {
      decision,
      target,
      summary,
      blockers,
      followups: [...new Set(followups)].slice(0, 6),
      focus: {
        requestedSuites: selectedSuiteIds,
        matchedSuites,
        missingSuites,
      },
      suiteCoverage: {
        status: coverageStatus,
        suiteCount: discoveredSuites.length,
        totalTestFiles,
        discoveredSuites,
      },
      recentFailures: {
        status: recentFailuresStatus,
        recentRunCount: recentRuns.length,
        failedRunCount: failedRuns.length,
        retryingRunCount: retryingRuns.length,
        examples: recentFailureExamples,
      },
      flakySignals: {
        status: flakyStatus,
        retryRecoveryCount: retryRecoveries.length,
        multiAttemptRunCount: multiAttemptRuns.length,
        retryingRunCount: retryingRuns.length,
        signals: flakySignals,
      },
      releaseRisk: {
        status: releaseRiskStatus,
        latestQaStatus: latestQa?.status ?? null,
        latestReleaseStatus: latestRelease?.status ?? null,
        latestBuildStatus: latestBuild?.status ?? null,
        signals: releaseSignals,
      },
      evidenceWindow: {
        since: new Date(evidenceCutoffMs).toISOString(),
        recentRunCount: recentRuns.length,
        latestHandledAt: recentRuns[0]?.lastHandledAt ?? null,
        observedTaskTypes: [...new Set(recentRuns.map((entry) => entry.type ?? "unknown"))].slice(
          0,
          8,
        ),
      },
      evidenceSources: [
        ...discoveredSuites.map((suite) => `suite:${suite.id}`),
        ...discoveredSuites.flatMap((suite) =>
          suite.testRoots.map((root) => `test-root:${root}`),
        ),
        ...(recentRuns.length > 0 ? [`runtime-runs:${recentRuns.length}`] : []),
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

  const resultFile = process.env.TEST_INTELLIGENCE_AGENT_RESULT_FILE;
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
