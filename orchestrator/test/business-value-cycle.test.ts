import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultState } from "../src/state.js";
import { runBusinessValueCycle } from "../src/business/valueLoop.js";
import type { OrchestratorConfig, Task } from "../src/types.js";

const fixtureRoot = join(process.cwd(), "test", ".tmp", "business-value-cycle");
const registryPath = join(fixtureRoot, "business", "registry.json");
const generatedEvidenceRoot = join(fixtureRoot, "artifacts", "business-value");

async function writeRegistry() {
  await mkdir(join(fixtureRoot, "business"), { recursive: true });
  await writeFile(
    registryPath,
    JSON.stringify(
      {
        businessId: "tail-wagging-website-design-factory",
        businessName: "Tail Wagging Website Design Factory Northampton",
        mission: "Test registry for recovered business-value cycles.",
        registryVersion: "test",
        updatedAt: "2026-07-10T00:00:00.000Z",
        kpis: [
          {
            id: "projects-nearing-commercial-readiness",
            label: "Projects nearing commercial readiness",
            outcome: "commercial-readiness",
            measurement: "count",
            confidence: "estimated"
          }
        ],
        kpiSnapshots: [],
        projects: [
          {
            id: "demo-project",
            name: "Demo Project",
            status: "active",
            repositories: [
              {
                id: "demo-repo",
                path: "projects/demo-project",
                evidence: ["projects/demo-project/package.json"]
              }
            ],
            commercialOutcome: "A recovered operator can choose work from durable business evidence.",
            targetCustomer: "internal operator",
            relevantKpis: ["projects-nearing-commercial-readiness"],
            acceptanceCriteria: [
              { id: "tests", label: "Tests pass", status: "missing", evidence: [] }
            ],
            currentBlockers: [],
            knownRisks: [],
            approvalBoundaries: [],
            evidenceLocations: ["test/business-value-cycle.test.ts"],
            nextSafeAction: "Run a bounded verification task."
          }
        ]
      },
      null,
      2
    )
  );
}

async function writeFounderRescueArtifacts() {
  const operatorArtifactRoot = join(fixtureRoot, "artifacts", "system", "operator");
  await mkdir(operatorArtifactRoot, { recursive: true });
  await Promise.all([
    writeFile(
      join(operatorArtifactRoot, "vibe-coded-mvp-rescue-audit-offer-2026-07-13.md"),
      "# Offer\n\nInternal offer packet.",
      "utf8",
    ),
    writeFile(
      join(operatorArtifactRoot, "vibe-coded-mvp-rescue-first-three-verification-2026-07-13.md"),
      "# Verification\n\nRead-only prospect verification.",
      "utf8",
    ),
    writeFile(
      join(operatorArtifactRoot, "vibe-coded-mvp-rescue-contact-route-verification-2026-07-13.md"),
      "# Contact Routes\n\nPublic contact routes verified.",
      "utf8",
    ),
    writeFile(
      join(operatorArtifactRoot, "vibe-coded-mvp-rescue-internal-outreach-drafts-2026-07-13.md"),
      "# Drafts\n\nInternal unsent drafts.",
      "utf8",
    ),
  ]);
}

function makeConfig(): OrchestratorConfig {
  return {
    docsPath: join(fixtureRoot, "docs"),
    logsDir: join(fixtureRoot, "logs"),
    stateFile: join(fixtureRoot, "state.json"),
    businessRegistryPath: registryPath,
    businessEvidenceDir: generatedEvidenceRoot
  };
}

describe("business-value cycle", () => {
  beforeEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
    await writeRegistry();
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(generatedEvidenceRoot, { recursive: true, force: true });
  });

  it("persists a scored cycle and enqueues one bounded allowlisted task", async () => {
    const state = createDefaultState();
    const enqueued: Array<{ type: string; payload: Record<string, unknown> }> = [];

    const result = await runBusinessValueCycle({
      config: makeConfig(),
      state,
      isTaskTypeAllowed: (type) => type === "qa-verification",
      enqueueTask: (type, payload) => {
        enqueued.push({ type, payload });
        return {
          id: `task-${enqueued.length}`,
          type,
          payload,
          createdAt: Date.now(),
          idempotencyKey: String(payload.idempotencyKey ?? type)
        } satisfies Task;
      },
      logger: { log() {}, warn() {}, error() {} }
    });

    expect(result.cycle.status).toBe("completed");
    expect(result.cycle.selectedTask?.taskType).toBe("qa-verification");
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].type).toBe("qa-verification");
    expect(enqueued[0].payload.__businessTraceability).toMatchObject({
      businessId: "tail-wagging-website-design-factory",
      originatingCycleId: result.cycle.cycleId,
      parentCandidateId: result.cycle.selectedTask?.candidateId,
      selectedWorkerOrCapability: "qa-verification"
    });
    expect(state.businessValue?.lastSuccessfulCycleId).toBe(result.cycle.cycleId);
    expect(state.businessValue?.cycles.at(-1)?.evidence.length).toBeGreaterThan(0);
    const evidencePath = result.cycle.evidence.at(-1)?.path;
    expect(evidencePath).toBeTruthy();
    const evidence = JSON.parse(await readFile(evidencePath!, "utf8"));
    expect(evidence.cycleId).toBe(result.cycle.cycleId);
  });

  it("does not enqueue a duplicate cycle while another cycle is active", async () => {
    const state = createDefaultState();
    state.businessValue = {
      ...state.businessValue!,
      activeCycleId: "business-cycle-existing"
    };
    let enqueueCount = 0;

    const result = await runBusinessValueCycle({
      config: makeConfig(),
      state,
      isTaskTypeAllowed: () => true,
      enqueueTask: (type, payload) => {
        enqueueCount += 1;
        return {
          id: `task-${enqueueCount}`,
          type,
          payload,
          createdAt: Date.now()
        } satisfies Task;
      },
      logger: { log() {}, warn() {}, error() {} }
    });

    expect(result.cycle.status).toBe("blocked");
    expect(result.cycle.nextSafeAction).toContain("active cycle");
    expect(result.cycle.unsupportedCandidates[0]?.evidence).toContain("business-cycle-existing");
    expect(enqueueCount).toBe(0);
  });

  it("preserves approval-gated work while selecting unrelated safe work", async () => {
    const state = createDefaultState();
    state.approvals.push({
      taskId: "approval-task-1",
      type: "build-refactor",
      payload: { target: "projects/demo-project" },
      requestedAt: "2026-07-11T08:00:00.000Z",
      status: "pending",
    });
    const enqueued: Task[] = [];

    const result = await runBusinessValueCycle({
      config: makeConfig(),
      state,
      isTaskTypeAllowed: (type) => type === "qa-verification",
      enqueueTask: (type, payload) => {
        const task = {
          id: `task-${enqueued.length + 1}`,
          type,
          payload,
          createdAt: Date.now(),
          idempotencyKey: String(payload.idempotencyKey ?? type),
        } satisfies Task;
        enqueued.push(task);
        return task;
      },
      logger: { log() {}, warn() {}, error() {} },
    });

    expect(result.cycle.selectedTask?.taskType).toBe("qa-verification");
    expect(result.cycle.approvalGatedCandidates).toEqual([
      expect.objectContaining({ candidateId: "approval:approval-task-1" }),
    ]);
    expect(enqueued).toHaveLength(1);
  });

  it("promotes founder-rescue outreach readiness when internal revenue-loop artifacts exist", async () => {
    await writeFounderRescueArtifacts();
    const state = createDefaultState();
    const enqueued: Task[] = [];

    const result = await runBusinessValueCycle({
      config: makeConfig(),
      state,
      isTaskTypeAllowed: (type) => type === "qa-verification",
      enqueueTask: (type, payload) => {
        const task = {
          id: `task-${enqueued.length + 1}`,
          type,
          payload,
          createdAt: Date.now(),
          idempotencyKey: String(payload.idempotencyKey ?? type),
        } satisfies Task;
        enqueued.push(task);
        return task;
      },
      logger: { log() {}, warn() {}, error() {} },
    });

    expect(result.cycle.selectedTask).toMatchObject({
      candidateId: "revenue-loop:founder-vibe-coded-rescue-readiness",
      taskType: "qa-verification",
      title: "Verify founder/vibe-coded rescue outreach readiness",
    });
    expect(enqueued[0].payload).toMatchObject({
      target: "artifacts/system/operator/vibe-coded-mvp-rescue-internal-outreach-drafts-2026-07-13.md",
      dryRun: true,
      __businessCandidateId: "revenue-loop:founder-vibe-coded-rescue-readiness",
    });
  });

  it("keeps community discovery aligned to John's active social platforms", async () => {
    const state = createDefaultState();

    const result = await runBusinessValueCycle({
      config: makeConfig(),
      state,
      isTaskTypeAllowed: (type) => type === "market-research",
      enqueueTask: (type, payload) => ({
        id: "community-task-1",
        type,
        payload,
        createdAt: Date.now(),
        idempotencyKey: String(payload.idempotencyKey ?? type),
      }) satisfies Task,
      logger: { log() {}, warn() {}, error() {} },
    });

    expect(result.cycle.selectedTask).toMatchObject({
      candidateId: expect.stringMatching(/^community-presence:daily-scan:/),
      taskType: "market-research",
      title: "Discover community participation opportunities",
    });
    expect(result.cycle.selectedTask?.evidence).toContain("skills/business-value-operating-loop/SKILL.md");
    const selectedCandidate = result.cycle.candidates.find(
      (candidate) => candidate.id === result.cycle.selectedTask?.candidateId,
    );
    expect(selectedCandidate?.taskPayload.sources).toEqual([
      "X",
      "LinkedIn",
      "Threads",
      "Reddit",
      "Facebook",
      "Instagram",
      "GitHub Discussions",
      "engineering blogs",
      "AI communities",
      "SaaS communities",
    ]);
    expect(selectedCandidate?.taskPayload.activeOwnedPlatforms).toEqual([
      "X",
      "LinkedIn",
      "Threads",
      "Reddit",
      "Facebook",
      "Instagram",
    ]);
    expect(selectedCandidate?.taskPayload.constraints).toMatchObject({
      dryRun: true,
      publicReadOnly: true,
      noPosting: true,
      noReplies: true,
      noDirectMessages: true,
      noFollows: true,
      noReactions: true,
      approvalRequiredForPublicAction: true,
    });
  });
});
