import { access, readdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { OrchestratorConfig, OrchestratorState } from "../types.js";
import { loadBusinessMission } from "./mission.js";
import type {
  BusinessKpiDefinition,
  BusinessKpiSnapshot,
  BusinessProject,
  BusinessRegistry,
  CandidateWorkItem,
  CommercialReadinessCriterion,
} from "./types.js";

const DEFAULT_REGISTRY_URL = new URL(
  "../../../business/registry.json",
  import.meta.url,
);

const ACTIVE_COMMUNITY_PLATFORMS = [
  "X",
  "LinkedIn",
  "Threads",
  "Reddit",
  "Facebook",
  "Instagram",
] as const;

const COMMUNITY_DISCOVERY_SOURCES = [
  ...ACTIVE_COMMUNITY_PLATFORMS,
  "GitHub Discussions",
  "engineering blogs",
  "AI communities",
  "SaaS communities",
] as const;

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asReadinessCriteria(value: unknown): CommercialReadinessCriterion[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: asString(item.id, "criterion"),
      label: asString(item.label, "Commercial readiness criterion"),
      status:
        item.status === "met" || item.status === "missing" || item.status === "unknown"
          ? item.status
          : "unknown",
      evidence: asStringArray(item.evidence),
    }));
}

function normalizeRegistry(raw: unknown, sourcePath: string): BusinessRegistry {
  const mission = loadBusinessMission();
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const projects = Array.isArray(input.projects) ? input.projects : [];
  const kpis = Array.isArray(input.kpis) ? input.kpis : [];
  const snapshots = Array.isArray(input.kpiSnapshots) ? input.kpiSnapshots : [];

  return {
    businessId: asString(input.businessId, mission.businessId),
    businessName: asString(input.businessName, mission.businessName),
    mission: asString(input.mission, mission.mission),
    registryVersion: asString(input.registryVersion, "1"),
    updatedAt: asString(input.updatedAt, new Date(0).toISOString()),
    sourcePath,
    kpis: kpis
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        id: asString(item.id, "unknown-kpi"),
        label: asString(item.label, "Unknown KPI"),
        outcome: (typeof item.outcome === "string" ? item.outcome : "commercial-readiness") as BusinessKpiDefinition["outcome"],
        measurement: asString(item.measurement, "unknown"),
        confidence:
          item.confidence === "verified" || item.confidence === "estimated" || item.confidence === "unknown"
            ? item.confidence
            : "unknown",
      })),
    kpiSnapshots: snapshots
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        kpiId: asString(item.kpiId, "unknown-kpi"),
        value:
          typeof item.value === "string" || typeof item.value === "number"
            ? item.value
            : null,
        capturedAt: asString(item.capturedAt, new Date(0).toISOString()),
        confidence:
          item.confidence === "verified" || item.confidence === "estimated" || item.confidence === "unknown"
            ? item.confidence
            : "unknown",
        source: asString(item.source, sourcePath),
        notes: typeof item.notes === "string" ? item.notes : undefined,
      })) as BusinessKpiSnapshot[],
    projects: projects
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item): BusinessProject => ({
        id: asString(item.id, "unknown-project"),
        name: asString(item.name, "Unknown Project"),
        status:
          item.status === "active" ||
          item.status === "paused" ||
          item.status === "blocked" ||
          item.status === "marketable" ||
          item.status === "commercially-ready" ||
          item.status === "unknown"
            ? item.status
            : "unknown",
        repositories: Array.isArray(item.repositories)
          ? item.repositories
              .filter((repo): repo is Record<string, unknown> => Boolean(repo) && typeof repo === "object")
              .map((repo) => ({
                id: asString(repo.id, "unknown-repo"),
                path: asString(repo.path, ""),
                remote: typeof repo.remote === "string" ? repo.remote : null,
                branch: typeof repo.branch === "string" ? repo.branch : null,
                evidence: asStringArray(repo.evidence),
              }))
          : [],
        commercialOutcome: asString(item.commercialOutcome, "unknown"),
        targetCustomer: typeof item.targetCustomer === "string" ? item.targetCustomer : null,
        relevantKpis: asStringArray(item.relevantKpis),
        acceptanceCriteria: asReadinessCriteria(item.acceptanceCriteria),
        currentBlockers: asStringArray(item.currentBlockers),
        knownRisks: asStringArray(item.knownRisks),
        approvalBoundaries: asStringArray(item.approvalBoundaries),
        evidenceLocations: asStringArray(item.evidenceLocations),
        nextSafeAction: typeof item.nextSafeAction === "string" ? item.nextSafeAction : null,
      })),
  };
}

export function resolveBusinessRegistryPath(config: OrchestratorConfig): string {
  if (config.businessRegistryPath) {
    return resolve(config.businessRegistryPath);
  }
  return fileURLToPath(DEFAULT_REGISTRY_URL);
}

export async function loadBusinessRegistry(config: OrchestratorConfig): Promise<BusinessRegistry> {
  const registryPath = resolveBusinessRegistryPath(config);
  const raw = await readFile(registryPath, "utf-8");
  return normalizeRegistry(JSON.parse(raw), registryPath);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function discoverUnregisteredProjectRepos(registry: BusinessRegistry) {
  const workspaceRoot = resolve(process.cwd(), "..");
  const projectsRoot = join(workspaceRoot, "projects");
  const registeredPaths = new Set(
    registry.projects.flatMap((project) =>
      project.repositories.map((repo) => resolve(workspaceRoot, repo.path)),
    ),
  );

  if (!(await pathExists(projectsRoot))) {
    return [] as string[];
  }

  const entries = await readdir(projectsRoot, { withFileTypes: true });
  const missing: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const repoPath = join(projectsRoot, entry.name);
    try {
      const git = await stat(join(repoPath, ".git"));
      if (git.isDirectory() && !registeredPaths.has(resolve(repoPath))) {
        missing.push(`projects/${entry.name}`);
      }
    } catch {
      // Not a git repo.
    }
  }
  return missing;
}

function projectReadinessCandidate(
  registry: BusinessRegistry,
  project: BusinessProject,
  missingCriteria: CommercialReadinessCriterion[],
): CandidateWorkItem {
  const evidence = [
    ...project.evidenceLocations,
    ...missingCriteria.flatMap((criterion) => criterion.evidence),
    registry.sourcePath,
  ].filter((item, index, values) => item.length > 0 && values.indexOf(item) === index);

  return {
    id: `commercial-readiness:${project.id}`,
    kind: "project",
    title: `Verify commercial readiness gaps for ${project.name}`,
    businessId: registry.businessId,
    projectId: project.id,
    objective: `Move ${project.name} toward demonstrable commercial readiness.`,
    expectedOutcome: "commercial-readiness",
    kpiId: project.relevantKpis[0] ?? "projects-nearing-commercial-readiness",
    evidence,
    taskType: "qa-verification",
    taskPayload: {
      target: project.repositories[0]?.path ?? project.id,
      suite: "business-readiness",
      mode: "dry-run",
      dryRun: true,
      constraints: {
        dryRun: true,
        businessReadiness: true,
        projectId: project.id,
      },
    },
    approval: "safe-autonomous",
    verification: {
      method: "worker",
      description:
        "QA verifier dry-run confirms the readiness review target and records follow-up evidence without production side effects.",
      expectedEvidence: ["qa-verification run", "task execution record"],
    },
    dependencies: project.repositories.length > 0 ? [] : ["project repository path unknown"],
    acceptanceCriteria: missingCriteria.map((criterion) => criterion.label),
    risk: "low: read-only readiness verification",
    effort: "low",
    opportunity: {
      type: "product",
      description: project.commercialOutcome,
    },
  };
}

function communityPresenceCandidate(registry: BusinessRegistry): CandidateWorkItem {
  const day = new Date().toISOString().slice(0, 10);
  return {
    id: `community-presence:daily-scan:${day}`,
    kind: "marketing",
    title: "Discover community participation opportunities",
    businessId: registry.businessId,
    businessFunction: "community-presence",
    objective:
      "Find relevant technical/community discussions where Tail Wagging expertise or completed work can help without posting publicly.",
    expectedOutcome: "community-value",
    kpiId: "community-value",
    evidence: [
      registry.sourcePath,
      "skills/business-value-operating-loop/SKILL.md",
      "artifacts/system/operator/business-value-candidate-pool-broadened-2026-07-14.md",
    ],
    taskType: "market-research",
    taskPayload: {
      target: "approved public communities",
      scope: "community-presence-opportunity-discovery",
      dryRun: true,
      sources: [...COMMUNITY_DISCOVERY_SOURCES],
      activeOwnedPlatforms: [...ACTIVE_COMMUNITY_PLATFORMS],
      constraints: {
        dryRun: true,
        publicReadOnly: true,
        draftOnly: true,
        noPosting: true,
        noReplies: true,
        noDirectMessages: true,
        noFollows: true,
        noReactions: true,
        approvalRequiredForPublicAction: true,
      },
    },
    approval: "safe-autonomous",
    verification: {
      method: "worker",
      description:
        "Market research identifies high-quality public discussions and prepares evidence-backed draft opportunities without public interaction.",
      expectedEvidence: [
        "source URLs or discussion identifiers",
        "relevance and business-value score",
        "draft-only participation recommendations",
        "approval boundary confirmation",
      ],
    },
    dependencies: [],
    acceptanceCriteria: [
      "Discovered discussions are relevant to current business goals or active projects.",
      "Active owned platforms are considered first: X, LinkedIn, Threads, Reddit, Facebook, and Instagram.",
      "Draft recommendations are useful and evidence-backed rather than promotional.",
      "All public interactions remain approval-gated.",
      "Outcomes can be measured through visibility, authority, engagement, or commercial signal.",
    ],
    risk: "low: public read-only research and internal drafting only",
    effort: "low",
    opportunity: {
      type: "community",
      description:
        "Build visibility, authority, and commercial reach through genuine helpful participation in relevant communities.",
    },
  };
}

async function discoverFounderRescueReadinessCandidate(
  registry: BusinessRegistry,
): Promise<CandidateWorkItem | null> {
  const workspaceRoot = resolve(dirname(registry.sourcePath), "..");
  const artifactPaths = [
    "artifacts/system/operator/vibe-coded-mvp-rescue-audit-offer-2026-07-13.md",
    "artifacts/system/operator/vibe-coded-mvp-rescue-first-three-verification-2026-07-13.md",
    "artifacts/system/operator/vibe-coded-mvp-rescue-contact-route-verification-2026-07-13.md",
    "artifacts/system/operator/vibe-coded-mvp-rescue-internal-outreach-drafts-2026-07-13.md",
  ];
  const existingArtifacts: string[] = [];

  for (const artifactPath of artifactPaths) {
    if (await pathExists(join(workspaceRoot, artifactPath))) {
      existingArtifacts.push(artifactPath);
    }
  }

  if (existingArtifacts.length < 2) {
    return null;
  }

  return {
    id: "revenue-loop:founder-vibe-coded-rescue-readiness",
    kind: "lead",
    title: "Verify founder/vibe-coded rescue outreach readiness",
    businessId: registry.businessId,
    businessFunction: "sales",
    objective:
      "Move the founder/vibe-coded project rescue lane toward approved, claim-safe outreach without sending or creating Gmail drafts.",
    expectedOutcome: "commercial-readiness",
    kpiId: "qualified-leads",
    evidence: [registry.sourcePath, ...existingArtifacts],
    taskType: "qa-verification",
    taskPayload: {
      target: "artifacts/system/operator/vibe-coded-mvp-rescue-internal-outreach-drafts-2026-07-13.md",
      suite: "business-readiness",
      mode: "dry-run",
      dryRun: true,
      constraints: {
        dryRun: true,
        businessReadiness: true,
        revenueLoop: true,
        approvalGatedExternalActions: true,
        lane: "founder-vibe-coded-project-rescue",
      },
    },
    approval: "safe-autonomous",
    verification: {
      method: "worker",
      description:
        "QA verifier reviews the internal founder-rescue outreach assets for claim safety and approval readiness without contacting leads.",
      expectedEvidence: ["qa-verification run", "claim-safety review", "approval boundary confirmation"],
    },
    dependencies: [],
    acceptanceCriteria: [
      "Founder-rescue offer and lead evidence remain claim-safe.",
      "Contact-route evidence is separated from permission to contact.",
      "Gmail draft creation and sending remain approval-gated.",
    ],
    risk: "low: local read-only artifact review; no external action",
    effort: "low",
    opportunity: {
      type: "lead",
      description:
        "Founder and vibe-coded project rescue opportunities broaden revenue work beyond Wagging Web Wins.",
    },
  };
}

export async function discoverBusinessCandidates(
  registry: BusinessRegistry,
  state: OrchestratorState,
): Promise<CandidateWorkItem[]> {
  const candidates: CandidateWorkItem[] = [];

  candidates.push(communityPresenceCandidate(registry));

  const founderRescueCandidate = await discoverFounderRescueReadinessCandidate(registry);
  if (founderRescueCandidate) {
    candidates.push(founderRescueCandidate);
  }

  for (const project of registry.projects) {
    const missingCriteria = project.acceptanceCriteria.filter(
      (criterion) => criterion.status === "missing" || criterion.status === "unknown",
    );
    if (
      missingCriteria.length > 0 &&
      project.status !== "paused" &&
      project.status !== "commercially-ready"
    ) {
      candidates.push(projectReadinessCandidate(registry, project, missingCriteria));
    }

    if (project.knownRisks.length > 0) {
      candidates.push({
        id: `risk-review:${project.id}`,
        kind: "risk",
        title: `Review unresolved risk for ${project.name}`,
        businessId: registry.businessId,
        projectId: project.id,
        objective: `Reduce operational or customer-facing risk before ${project.name} is promoted.`,
        expectedOutcome: "risk-reduction",
        kpiId: "customer-facing-risks",
        evidence: [...project.knownRisks, ...project.evidenceLocations, registry.sourcePath],
        taskType: "system-monitor",
        taskPayload: {
          target: project.repositories[0]?.path ?? project.id,
          scope: "business-risk",
          dryRun: true,
        },
        approval: "safe-autonomous",
        verification: {
          method: "worker",
          description: "System monitor worker records risk posture and recommended safe follow-up.",
          expectedEvidence: ["system-monitor run", "risk findings"],
        },
        dependencies: [],
        acceptanceCriteria: ["Risk is classified with evidence and next safe action."],
        risk: "low: local risk review",
        effort: "low",
        opportunity: {
          type: "operations",
          description: project.knownRisks.join("; "),
        },
      });
    }
  }

  const unregisteredRepos = await discoverUnregisteredProjectRepos(registry);
  if (unregisteredRepos.length > 0) {
    candidates.push({
      id: "registry:unregistered-project-repos",
      kind: "operational-improvement",
      title: "Register discovered workspace project repositories",
      businessId: registry.businessId,
      businessFunction: "operations",
      objective: "Keep project registry complete so business-value planning uses real workspace inventory.",
      expectedOutcome: "operational-efficiency",
      kpiId: "active-client-projects",
      evidence: [registry.sourcePath, ...unregisteredRepos],
      taskType: null,
      taskPayload: {},
      approval: "unsupported",
      approvalReason:
        "Registry mutation requires a bounded implementation task because planner discovery must not rewrite project facts automatically.",
      verification: {
        method: "unsupported",
        description: "Requires registry update and review.",
        expectedEvidence: ["updated registry", "project evidence paths"],
      },
      dependencies: unregisteredRepos,
      acceptanceCriteria: ["Every active project repo is represented or explicitly excluded."],
      risk: "medium: registry source-of-truth change",
      effort: "medium",
      opportunity: {
        type: "operations",
        description: "Improve planner inventory coverage.",
      },
    });
  }

  const recentFailures = state.taskExecutions
    .filter((execution) => execution.status === "failed" || execution.status === "retrying")
    .slice(-5);
  if (recentFailures.length > 0) {
    candidates.push({
      id: "runtime:recent-task-failures",
      kind: "risk",
      title: "Verify recent failed or retrying task executions",
      businessId: registry.businessId,
      businessFunction: "operations",
      objective: "Reduce delivery and automation risk caused by failed runtime work.",
      expectedOutcome: "risk-reduction",
      kpiId: "verification-failures",
      evidence: recentFailures.map((execution) => `${execution.type}:${execution.idempotencyKey}`),
      taskType: "qa-verification",
      taskPayload: {
        target: "orchestrator-runtime",
        suite: "recent-failure-review",
        mode: "dry-run",
        dryRun: true,
        runIds: recentFailures.map((execution) => execution.idempotencyKey),
      },
      approval: "safe-autonomous",
      verification: {
        method: "worker",
        description: "QA verifier reviews failed runtime tasks without mutating production state.",
        expectedEvidence: ["qa-verification run", "failure review"],
      },
      dependencies: [],
      acceptanceCriteria: ["Recent failure pattern is classified with next safe action."],
      risk: "low: read-only failure review",
      effort: "low",
      opportunity: {
        type: "operations",
        description: "Improve runtime reliability.",
      },
    });
  }

  for (const approval of state.approvals.filter((item) => item.status === "pending").slice(-10)) {
    candidates.push({
      id: `approval:${approval.taskId}`,
      kind: "approval",
      title: `Approval required for ${approval.type}`,
      businessId: registry.businessId,
      businessFunction: "governance",
      objective: "Preserve approval-gated work without blocking unrelated safe work.",
      expectedOutcome: "risk-reduction",
      kpiId: "approval-gated-actions",
      evidence: [approval.taskId, approval.type, approval.requestedAt],
      taskType: null,
      taskPayload: approval.payload,
      approval: "approval-required",
      approvalReason: "Existing approval gate is waiting for an operator decision.",
      verification: {
        method: "manual-approval",
        description: "Operator approval or rejection is required.",
        expectedEvidence: ["approval decision"],
      },
      dependencies: [approval.taskId],
      acceptanceCriteria: ["Approval is decided or remains preserved without blocking safe work."],
      risk: "high: approval boundary",
      effort: "low",
    });
  }

  return candidates;
}
