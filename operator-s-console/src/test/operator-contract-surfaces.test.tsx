import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OverviewPage from "@/pages/OverviewPage";
import AgentsPage from "@/pages/AgentsPage";
import ApprovalsPage from "@/pages/ApprovalsPage";
import IncidentsPage from "@/pages/IncidentsPage";
import KnowledgePage from "@/pages/KnowledgePage";
import PublicProofPage from "@/pages/PublicProofPage";
import SystemHealthPage from "@/pages/SystemHealthPage";
import TasksPage from "@/pages/TasksPage";
import GovernancePage from "@/pages/GovernancePage";
import TaskRunsPage from "@/pages/TaskRunsPage";
import { TaskRunDetailContent } from "@/components/console/TaskRunDetailContent";
import * as consoleHooks from "@/hooks/use-console-api";
import * as publicSurfaceHooks from "@/hooks/use-public-surface-api";
import * as diagnosticsContext from "@/contexts/DiagnosticsContext";
import * as authContext from "@/contexts/AuthContext";

const navigateMock = vi.fn();
const acknowledgeMutate = vi.fn();
const ownerMutate = vi.fn();
const remediateMutate = vi.fn();
const triggerTaskMutate = vi.fn();
const approvalDecisionMutate = vi.fn();

function buildTaskRun(type: string, overrides: Record<string, unknown> = {}) {
  return {
    runId: `run-${type}`,
    type,
    status: "success",
    createdAt: "2026-03-11T10:00:00.000Z",
    startedAt: "2026-03-11T10:00:01.000Z",
    completedAt: "2026-03-11T10:00:05.000Z",
    model: "gpt-4.1-mini",
    cost: 0.01,
    latency: 600,
    usage: {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    },
    budget: null,
    accounting: null,
    error: null,
    lastHandledAt: "2026-03-11T10:00:05.000Z",
    repair: null,
    history: [],
    attempt: 1,
    maxRetries: 1,
    workflow: {
      stage: "completed",
      graphStatus: "completed",
      currentStage: "proof",
      blockedStage: null,
      stopReason: null,
      stopClassification: "completed",
      awaitingApproval: false,
      retryScheduled: false,
      nextRetryAt: null,
      repairStatus: null,
      eventCount: 2,
      latestEventAt: "2026-03-11T10:00:05.000Z",
      stageDurations: {},
      timingBreakdown: {},
      nodeCount: 3,
      edgeCount: 2,
    },
    approval: {
      required: false,
      status: null,
      requestedAt: null,
      decidedAt: null,
      decidedBy: null,
      note: null,
    },
    events: [],
    workflowGraph: null,
    proofLinks: [],
    ...overrides,
  };
}

function renderTaskRunDetail(
  type: string,
  runResult: Record<string, unknown>,
  runOverrides: Record<string, unknown> = {},
) {
  const view = render(
    <TaskRunDetailContent
      isLoading={false}
      run={buildTaskRun(type, runOverrides) as never}
      runResult={runResult}
    />,
  );

  return {
    ...view,
    rerenderFor(
      nextType: string,
      nextRunResult: Record<string, unknown>,
      nextRunOverrides: Record<string, unknown> = {},
    ) {
      view.rerender(
        <TaskRunDetailContent
          isLoading={false}
          run={buildTaskRun(nextType, nextRunOverrides) as never}
          runResult={nextRunResult}
        />,
      );
    },
  };
}

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/hooks/use-console-api");
vi.mock("@/hooks/use-public-surface-api");
vi.mock("@/contexts/DiagnosticsContext");
vi.mock("@/contexts/AuthContext");

describe("operator contract surfaces", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(authContext.useAuth).mockReturnValue({
      user: {
        actor: "AyobamiH",
        role: "operator",
        roles: ["operator"],
      },
      isAuthenticated: true,
      isLoading: false,
      error: null,
      apiKeyExpires: null,
      login: vi.fn(),
      testConnection: vi.fn(),
      logout: vi.fn(),
      hasRole: vi.fn(() => true),
    });

    vi.mocked(diagnosticsContext.useDiagSummary).mockReturnValue({
      summary: {
        pass: 5,
        fail: 1,
        lastRunAt: "2026-03-11T10:00:00.000Z",
      },
    } as unknown as ReturnType<typeof diagnosticsContext.useDiagSummary>);

    vi.mocked(consoleHooks.useIncidentAcknowledge).mockReturnValue({
      mutate: acknowledgeMutate,
      isPending: false,
    } as unknown as ReturnType<typeof consoleHooks.useIncidentAcknowledge>);

    vi.mocked(consoleHooks.useIncidentOwner).mockReturnValue({
      mutate: ownerMutate,
      isPending: false,
    } as unknown as ReturnType<typeof consoleHooks.useIncidentOwner>);

    vi.mocked(consoleHooks.useIncidentRemediate).mockReturnValue({
      mutate: remediateMutate,
      isPending: false,
    } as unknown as ReturnType<typeof consoleHooks.useIncidentRemediate>);

    vi.mocked(consoleHooks.useTriggerTask).mockReturnValue({
      mutate: triggerTaskMutate,
      isPending: false,
    } as unknown as ReturnType<typeof consoleHooks.useTriggerTask>);

    vi.mocked(consoleHooks.useApprovalDecision).mockReturnValue({
      mutate: approvalDecisionMutate,
      isPending: false,
    } as unknown as ReturnType<typeof consoleHooks.useApprovalDecision>);

    vi.mocked(consoleHooks.useTaskCatalog).mockReturnValue({
      data: { generatedAt: "2026-03-11T10:00:00.000Z", tasks: [] },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof consoleHooks.useTaskCatalog>);
  });

  it("renders the new overview attention rail and safe next actions", () => {
    vi.mocked(consoleHooks.useDashboardOverview).mockReturnValue({
      data: {
        health: { status: "warning", fastStartMode: true },
        persistence: { status: "warning", database: "mongo" },
        accounting: {
          totalCostUsd: 1.25,
          currentBudget: {
            status: "healthy",
            remainingLlmCalls: 12,
          },
        },
        queue: {
          queued: 2,
          processing: 1,
          pressure: [
            {
              type: "doc-change",
              label: "Doc Change",
              source: "Doc Watch",
              queuedCount: 2,
              processingCount: 0,
              totalCount: 2,
            },
          ],
        },
        approvals: { pendingCount: 1, pending: [] },
        governance: {
          approvals: 1,
          taskRetryRecoveries: 2,
        },
        incidents: {
          overallStatus: "warning",
          openCount: 1,
          activeCount: 1,
          watchingCount: 0,
          bySeverity: { critical: 0, warning: 1, info: 0 },
          topClassifications: [
            {
              classification: "knowledge",
              label: "Knowledge",
              count: 1,
              activeCount: 1,
              watchingCount: 0,
              highestSeverity: "warning",
            },
          ],
        },
        recentTasks: [
          {
            id: "task-system-monitor",
            taskId: "task-system-monitor",
            type: "system-monitor",
            message: "system monitor complete (0 alerts)",
            status: "success",
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof consoleHooks.useDashboardOverview>);

    vi.mocked(consoleHooks.useAgentsOverview).mockReturnValue({
      data: {
        count: 3,
        agents: [
          { id: "doc-specialist", serviceAvailable: true, serviceExpected: true, serviceRunning: true },
          { id: "reddit-helper", serviceAvailable: true, serviceExpected: true, serviceRunning: false },
          { id: "integration-agent", serviceAvailable: true, serviceExpected: false, serviceRunning: false },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof consoleHooks.useAgentsOverview>);

    vi.mocked(consoleHooks.useTaskCatalog).mockReturnValue({
      data: {
        generatedAt: "2026-03-11T10:00:00.000Z",
        tasks: [
          {
            type: "system-monitor",
            label: "System Monitor",
            purpose: "Inspect queue, service, and incident pressure through bounded checks.",
            operationalStatus: "active",
            approvalGated: false,
            exposeInV1: true,
            telemetryOverlay: { totalRuns: 3, successRate: 1 },
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof consoleHooks.useTaskCatalog>);

    vi.mocked(publicSurfaceHooks.useCommandCenterOverview).mockReturnValue({
      data: {
        riskCounts: { onTrack: 1, atRisk: 1, blocked: 0, completed: 1 },
        latest: {
          claim: "Proof transport active",
          scope: "orchestrator-public-proof",
          timestampUtc: "2026-03-11T10:10:00.000Z",
        },
        stale: true,
        evidenceCount: 3,
        activeLaneCount: 1,
      },
    } as unknown as ReturnType<typeof publicSurfaceHooks.useCommandCenterOverview>);

    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Operator Overview")).toBeInTheDocument();
    expect(screen.getByText("Control Plane Mode")).toBeInTheDocument();
    expect(screen.getAllByText("Durability Risk").length).toBeGreaterThan(0);
    expect(screen.getByText("Primary Operator Move")).toBeInTheDocument();
    expect(screen.getByText("Clear the approval inbox first")).toBeInTheDocument();
    expect(screen.getByText("Why This Outranks")).toBeInTheDocument();
    expect(screen.getByText("Pressure Story")).toBeInTheDocument();
    expect(screen.getByText("Review-gated work is the first operator choke point.")).toBeInTheDocument();
    expect(screen.getByText("Needs Attention")).toBeInTheDocument();
    expect(screen.getByText("Safe Next Actions")).toBeInTheDocument();
    expect(screen.getByText("Fast-start mode is active")).toBeInTheDocument();
    expect(screen.getAllByText("System Monitor").length).toBeGreaterThan(0);
    expect(screen.getByText("Top Incident Classifications")).toBeInTheDocument();
    expect(screen.getByText("Knowledge")).toBeInTheDocument();
    expect(screen.getByText("Queue Pressure Sources")).toBeInTheDocument();
    expect(screen.getByText("Doc Change")).toBeInTheDocument();
    expect(screen.getByText("3 declared")).toBeInTheDocument();
    expect(screen.getByText(/1 host-running/i)).toBeInTheDocument();
    expect(screen.getAllByText("Stale").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByText("System Monitor")[0]);
    expect(navigateMock).toHaveBeenCalledWith({
      pathname: "/tasks",
      search: "?openTask=system-monitor",
    });
  }, 15000);

  it("collapses repeated recent activity noise and shows timed-out public proof honestly", () => {
    vi.mocked(consoleHooks.useDashboardOverview).mockReturnValue({
      data: {
        health: { status: "degraded", fastStartMode: false },
        persistence: { status: "healthy", database: "mongo" },
        accounting: {
          totalCostUsd: 0,
          currentBudget: {
            status: "ok",
            remainingLlmCalls: 20,
          },
        },
        queue: { queued: 200, processing: 1, pressure: [] },
        approvals: { pendingCount: 0, pending: [] },
        governance: {
          approvals: 0,
          taskRetryRecoveries: 0,
        },
        incidents: {
          overallStatus: "warning",
          openCount: 0,
          activeCount: 0,
          watchingCount: 0,
          bySeverity: { critical: 0, warning: 0, info: 0 },
          topClassifications: [],
        },
        recentTasks: [
          {
            id: "task-1",
            taskId: "task-1",
            type: "system-monitor",
            message: "queued 200 doc changes (drift repair already active)",
            status: "success",
            handledAt: "2026-03-11T10:00:00.000Z",
          },
          {
            id: "task-2",
            taskId: "task-2",
            type: "system-monitor",
            message: "queued 200 doc changes (drift repair already active)",
            status: "success",
            handledAt: "2026-03-11T10:02:00.000Z",
          },
          {
            id: "task-3",
            taskId: "task-3",
            type: "system-monitor",
            message: "queued 200 doc changes (drift repair already active)",
            status: "success",
            handledAt: "2026-03-11T10:04:00.000Z",
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof consoleHooks.useDashboardOverview>);

    vi.mocked(consoleHooks.useAgentsOverview).mockReturnValue({
      data: { count: 0, agents: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof consoleHooks.useAgentsOverview>);

    vi.mocked(publicSurfaceHooks.useCommandCenterOverview).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("request timed out"),
    } as unknown as ReturnType<typeof publicSurfaceHooks.useCommandCenterOverview>);

    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getAllByText("Timed Out").length).toBeGreaterThan(0);
    expect(screen.getByText("Reconcile public proof lag")).toBeInTheDocument();
    expect(screen.getByText("x3")).toBeInTheDocument();
    expect(screen.getByText("queued 200 doc changes (drift repair already active)")).toBeInTheDocument();
  });

  it("lets a dominant incident storm outrank a smaller approval backlog", () => {
    vi.mocked(consoleHooks.useDashboardOverview).mockReturnValue({
      data: {
        health: { status: "degraded", fastStartMode: false },
        persistence: { status: "healthy", database: "mongo" },
        accounting: {
          totalCostUsd: 0,
          currentBudget: {
            status: "ok",
            remainingLlmCalls: 20,
          },
        },
        queue: {
          queued: 0,
          processing: 1,
          pressure: [
            {
              type: "system-monitor",
              label: "System Monitor",
              source: "System Monitor",
              queuedCount: 0,
              processingCount: 1,
              totalCount: 1,
            },
          ],
        },
        approvals: { pendingCount: 13, pending: [] },
        governance: {
          approvals: 13,
          taskRetryRecoveries: {
            count: 0,
            nextRetryAt: null,
          },
        },
        incidents: {
          overallStatus: "critical",
          openCount: 375,
          activeCount: 333,
          watchingCount: 42,
          bySeverity: { critical: 374, warning: 1, info: 0 },
          topClassifications: [
            {
              classification: "repair",
              label: "Repair",
              count: 374,
              activeCount: 333,
              watchingCount: 41,
              highestSeverity: "critical",
            },
            {
              classification: "approval-backlog",
              label: "Approval Backlog",
              count: 1,
              activeCount: 0,
              watchingCount: 1,
              highestSeverity: "warning",
            },
          ],
        },
        recentTasks: [
          {
            id: "task-system-monitor",
            taskId: "task-system-monitor",
            type: "system-monitor",
            status: "success",
            result: "success",
            message: "system monitor complete (0 alerts)",
            handledAt: "2026-03-11T10:14:00.000Z",
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof consoleHooks.useDashboardOverview>);

    vi.mocked(consoleHooks.useAgentsOverview).mockReturnValue({
      data: {
        agents: [
          { id: "system-monitor-agent", serviceAvailable: true, serviceExpected: true, serviceRunning: true },
          { id: "security-agent", serviceAvailable: true, serviceExpected: true, serviceRunning: true },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof consoleHooks.useAgentsOverview>);

    vi.mocked(consoleHooks.useTaskCatalog).mockReturnValue({
      data: { generatedAt: "2026-03-11T10:00:00.000Z", tasks: [] },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof consoleHooks.useTaskCatalog>);

    vi.mocked(publicSurfaceHooks.useCommandCenterOverview).mockReturnValue({
      data: {
        riskCounts: { onTrack: 0, atRisk: 0, blocked: 0, completed: 0 },
        latest: null,
        stale: false,
        evidenceCount: 0,
        activeLaneCount: 0,
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof publicSurfaceHooks.useCommandCenterOverview>);

    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getAllByText("Incident Storm").length).toBeGreaterThan(0);
    expect(screen.getByText("Stabilize the incident queue first")).toBeInTheDocument();
    expect(screen.getByText(/Repair is currently outranking approvals and queue pressure/i)).toBeInTheDocument();
    expect(screen.getByText(/Repair currently owns 374 open incident records at critical severity/i)).toBeInTheDocument();
    expect(screen.getByText(/13 approvals are waiting, but they are downstream of the larger incident story right now/i)).toBeInTheDocument();
  });

  it("renders agent capability readiness and gap evidence", () => {
    vi.mocked(consoleHooks.useAgentsOverview).mockReturnValue({
      data: {
        count: 1,
        agents: [
          {
            id: "doc-specialist",
            name: "Doc Specialist",
            description: "Repo intelligence engine",
            orchestratorTask: "drift-repair",
            modelTier: "high",
            allowedSkills: ["documentParser", "sourceFetch"],
            workerValidationStatus: "confirmed-worker",
            spawnedWorkerCapable: true,
            serviceAvailable: true,
            serviceExpected: true,
            serviceInstalled: true,
            serviceRunning: true,
            lifecycleMode: "service-expected",
            hostServiceStatus: "running",
            evidenceSources: ["memory", "toolgate"],
            capability: {
              role: "repository intelligence",
              spine: "truth",
              currentReadiness: "operational",
              evidence: ["successful run evidence", "tool execution evidence"],
              presentCapabilities: ["knowledge synthesis", "successful runtime evidence"],
              missingCapabilities: ["contradiction graphing"],
              ultraGapSummary:
                "1 capability gap remains before this agent can be treated as ultra-capable in-role.",
            },
          },
        ],
        topology: {
          status: "stable",
          counts: {
            totalNodes: 5,
            totalEdges: 4,
            routeEdges: 2,
            skillEdges: 1,
            proofEdges: 1,
          },
          hotspots: [],
        },
        relationshipHistory: {
          totalObservations: 6,
          lastObservedAt: "2026-03-11T10:20:00.000Z",
          byRelationship: {
            "feeds-agent": 2,
            "verifies-agent": 1,
          },
          byStatus: {
            observed: 5,
            warning: 1,
          },
          timeline: [
            { bucketStart: "2026-03-11T09:00:00.000Z", total: 2 },
            { bucketStart: "2026-03-11T10:00:00.000Z", total: 4 },
          ],
          recent: [
            {
              observationId: "obs-1",
              relationship: "feeds-agent",
              from: "agent:doc-specialist",
              to: "agent:reddit-helper",
              status: "observed",
              source: "doc-specialist",
              detail: "doc-specialist fed reddit-helper with a knowledge pack.",
              timestamp: "2026-03-11T10:20:00.000Z",
            },
          ],
        },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof consoleHooks.useAgentsOverview>);

    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Capability Readiness")).toBeInTheDocument();
    expect(
      screen.getByText(
        "1 capability gap remains before this agent can be treated as ultra-capable in-role.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Service-expected").length).toBeGreaterThan(0);
    expect(screen.getByText("Service Entry")).toBeInTheDocument();
    expect(screen.getAllByText("Host Running").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Resident posture: keep the host service installed and running for this lane."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Operator action: trigger a narrow bounded canary through Tasks to promote fresh task-path proof for this lane.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("contradiction graphing")).toBeInTheDocument();
    expect(screen.getByText("knowledge synthesis")).toBeInTheDocument();
    expect(screen.getByText("Relationship History")).toBeInTheDocument();
    expect(screen.getByText("doc-specialist fed reddit-helper with a knowledge pack.")).toBeInTheDocument();
  });

  it("renders worker-first agent action guidance without host-service debt language", () => {
    vi.mocked(consoleHooks.useAgentsOverview).mockReturnValue({
      data: {
        count: 1,
        agents: [
          {
            id: "integration-agent",
            name: "Integration Agent",
            description: "Workflow conductor",
            orchestratorTask: "integration-workflow",
            modelTier: "balanced",
            allowedSkills: ["documentParser", "normalizer"],
            workerValidationStatus: "partial-worker",
            spawnedWorkerCapable: true,
            serviceAvailable: true,
            serviceExpected: false,
            serviceInstalled: false,
            serviceRunning: false,
            lifecycleMode: "worker-first",
            hostServiceStatus: "not-applicable",
            evidenceSources: ["runtime"],
            capability: {
              role: "workflow conductor",
              spine: "execution",
              currentReadiness: "foundation",
              evidence: [],
              presentCapabilities: ["governed skill access", "spawned worker path"],
              missingCapabilities: ["successful runtime evidence"],
              ultraGapSummary:
                "1 capability gap remains before this agent can be treated as ultra-capable in-role.",
            },
            runtimeProof: {
              distinctions: {
                taskObserved: false,
                taskSucceeded: false,
              },
            },
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof consoleHooks.useAgentsOverview>);

    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        "Worker-first posture: trigger it on demand through orchestrator task paths; host service install is not required.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Operator action: run Integration Workflow with blank/default steps or shorthand workflow lines to promote a real coordination canary.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Host N/A").length).toBeGreaterThan(0);
  });

  it("renders workflow graph and proof links in run detail", () => {
    render(
      <TaskRunDetailContent
        isLoading={false}
        run={{
          runId: "run-1",
          type: "heartbeat",
          status: "success",
          createdAt: "2026-03-11T10:00:00.000Z",
          startedAt: "2026-03-11T10:00:01.000Z",
          completedAt: "2026-03-11T10:00:02.000Z",
          model: "gpt-4.1-mini",
          cost: 0.0123,
          latency: 1000,
          usage: {
            promptTokens: 120,
            completionTokens: 45,
            totalTokens: 165,
          },
          budget: {
            dailyCallLimit: 20,
            callsUsed: 4,
            callsRemaining: 16,
            exhausted: false,
          },
          accounting: {
            metered: true,
            priced: true,
            note: "Accounted against the bounded reply budget.",
          },
          error: null,
          lastHandledAt: "2026-03-11T10:00:02.000Z",
          repair: null,
          history: [],
          attempt: 1,
          maxRetries: 2,
          workflow: {
            stage: "completed",
            graphStatus: "completed",
            currentStage: "proof",
            blockedStage: null,
            stopReason: null,
            stopClassification: "completed",
            awaitingApproval: false,
            retryScheduled: false,
            nextRetryAt: null,
            repairStatus: null,
            eventCount: 4,
            latestEventAt: "2026-03-11T10:00:02.000Z",
            stageDurations: { ingress: 10, queue: 15, agent: 120 },
            timingBreakdown: {
              ingress: { startedAt: "2026-03-11T10:00:00.000Z", completedAt: "2026-03-11T10:00:00.010Z", durationMs: 10, eventCount: 1 },
              queue: { startedAt: "2026-03-11T10:00:00.010Z", completedAt: "2026-03-11T10:00:00.025Z", durationMs: 15, eventCount: 1 },
              agent: { startedAt: "2026-03-11T10:00:00.025Z", completedAt: "2026-03-11T10:00:00.145Z", durationMs: 120, eventCount: 1 },
            },
            nodeCount: 5,
            edgeCount: 4,
          },
          approval: {
            required: false,
            status: null,
            requestedAt: null,
            decidedAt: null,
            decidedBy: null,
            note: null,
          },
          events: [
            {
              id: "evt-1",
              stage: "queue",
              state: "queued",
              timestamp: "2026-03-11T10:00:00.000Z",
              message: "Queued",
            },
          ],
          workflowGraph: {
            graphStatus: "completed",
            stopClassification: "completed",
            nodes: [
              { id: "n-ingress", kind: "stage", stage: "ingress", label: "Ingress", status: "completed", detail: "Accepted." },
              { id: "n-proof", kind: "proof", stage: "proof", label: "Proof", status: "completed", detail: "Delivered." },
              { id: "e-proof", kind: "event", stage: "proof", label: "delivered", status: "completed", detail: "Proof delivered.", timestamp: "2026-03-11T10:00:02.000Z" },
            ],
            edges: [
              { id: "e-1", from: "n-ingress", to: "n-proof", status: "completed", detail: "Ingress -> Proof" },
            ],
            events: [
              { eventId: "evt-proof", stage: "proof", state: "delivered", timestamp: "2026-03-11T10:00:02.000Z", detail: "Proof delivered." },
            ],
          },
          proofLinks: [
            {
              id: "proof-1",
              type: "milestone",
              status: "delivered",
              summary: "Heartbeat proof published.",
              target: "orchestrator-public-proof",
              lastAttemptAt: "2026-03-11T10:00:02.000Z",
            },
          ],
          operatorPreview: null,
        }}
        runResult={{
          operatorSummary: "Prepared a local-only reddit draft with review posture because the knowledge pack is behind the docs mirror.",
          recommendedNextActions: [
            "Run drift-repair before broad reuse.",
          ],
          specialistContract: {
            role: "Reddit Community Builder",
            workflowStage: "community-review",
            status: "watching",
            operatorSummary: "Prepared a local-only reddit draft with review posture because the knowledge pack is behind the docs mirror.",
            recommendedNextActions: [
              "Run drift-repair before broad reuse.",
            ],
          },
          knowledgeFreshness: {
            status: "docs-ahead-of-pack",
            reviewRecommended: true,
            packGeneratedAt: "2026-03-11T08:00:00.000Z",
            packAgeHours: 2,
            docsLatestModifiedAt: "2026-03-11T09:30:00.000Z",
            warnings: [
              "The docs mirror changed after the latest knowledge pack was generated. Run drift-repair so reddit-helper drafts against the refreshed pack.",
            ],
          },
        }}
      />,
    );

    expect(screen.getByText("Operator Summary")).toBeInTheDocument();
    expect(screen.getByText("Knowledge Freshness")).toBeInTheDocument();
    expect(screen.getByText("Docs Ahead")).toBeInTheDocument();
    expect(
      screen.getAllByText(/Run drift-repair so reddit-helper drafts against the refreshed pack/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Workflow Graph")).toBeInTheDocument();
    expect(screen.getByText("Proof Links")).toBeInTheDocument();
    expect(screen.getByText("Heartbeat proof published.")).toBeInTheDocument();
    expect(screen.getByText("Ingress")).toBeInTheDocument();
    expect(screen.getByText("Stop Classification")).toBeInTheDocument();
  });

  it("renders verification control signals in run detail for qa-verification", () => {
    render(
      <TaskRunDetailContent
        isLoading={false}
        run={{
          runId: "run-qa-1",
          type: "qa-verification",
          status: "success",
          createdAt: "2026-03-11T10:00:00.000Z",
          startedAt: "2026-03-11T10:00:01.000Z",
          completedAt: "2026-03-11T10:00:08.000Z",
          model: "gpt-4.1-mini",
          cost: 0.01,
          latency: 700,
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
          budget: null,
          accounting: null,
          error: null,
          lastHandledAt: "2026-03-11T10:00:08.000Z",
          repair: null,
          history: [],
          attempt: 1,
          maxRetries: 1,
          workflow: {
            stage: "completed",
            graphStatus: "completed",
            currentStage: "proof",
            blockedStage: null,
            stopReason: null,
            stopClassification: "completed",
            awaitingApproval: false,
            retryScheduled: false,
            nextRetryAt: null,
            repairStatus: null,
            eventCount: 2,
            latestEventAt: "2026-03-11T10:00:08.000Z",
            stageDurations: {},
            timingBreakdown: {},
            nodeCount: 3,
            edgeCount: 2,
          },
          approval: {
            required: false,
            status: null,
            requestedAt: null,
            decidedAt: null,
            decidedBy: null,
            note: null,
          },
          events: [],
          workflowGraph: null,
          proofLinks: [],
          operatorPreview: null,
        }}
        runResult={{
          operatorSummary:
            "Verification can close the incident once the final verifier note is attached to the repair record.",
          recommendedNextActions: ["Attach the verifier note to the incident before closing it."],
          specialistContract: {
            role: "Reality Checker",
            workflowStage: "closure-review",
            status: "watching",
            operatorSummary:
              "Verification can close the incident once the final verifier note is attached to the repair record.",
            recommendedNextActions: ["Attach the verifier note to the incident before closing it."],
          },
          closureRecommendation: {
            decision: "keep-open",
            allowClosure: false,
            summary:
              "Verification passed the bounded checks, but the incident should stay open until the verifier note is attached.",
            nextActions: ["Attach verifier note", "Close incident once evidence is linked"],
          },
          acceptanceCoverage: {
            closureReadiness: "needs-evidence",
            acceptanceMode: "hybrid",
            evidenceAnchorsSupplied: 2,
            runtimeSignals: 4,
          },
          verificationAuthority: {
            authorityLevel: "conditional",
            targetKind: "incident",
            targetId: "inc-42",
            requiredEvidence: ["verifier note", "repair link"],
          },
          reproducibilityProfile: {
            reproducibility: "verified",
            evidenceQuality: "strong",
            regressionRisk: "low",
            workflowStopSignals: 0,
            repairCount: 1,
            relationshipCount: 2,
            priorityIncidentCount: 1,
          },
          closureContract: {
            targetKind: "incident",
            targetId: "inc-42",
            closeAllowed: false,
            reopenOnFailure: true,
            unresolvedSignals: 1,
            requiredFollowups: ["Attach verifier note"],
          },
        }}
      />,
    );

    expect(screen.getByText("Verification Control Deck")).toBeInTheDocument();
    expect(screen.getByText("Closure Decision")).toBeInTheDocument();
    expect(screen.getByText("Reproducibility")).toBeInTheDocument();
    expect(screen.getByText("Closure Contract")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Verification passed the bounded checks, but the incident should stay open until the verifier note is attached.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Evidence still expected: verifier note, repair link.")).toBeInTheDocument();
    expect(screen.getByText("Follow-ups: Attach verifier note.")).toBeInTheDocument();
  });

  it("renders workflow and bounded-surgery control decks for integration-workflow and build-refactor", () => {
    const view = renderTaskRunDetail("integration-workflow", {
      plan: {
        readySteps: 2,
        blockedSteps: 1,
        workflowProfile: {
          classification: "delivery",
          dominantSurface: "repo-and-runtime",
          verifierRequired: true,
          criticalPath: ["market-research", "build-refactor", "qa-verification"],
          coordinationRisks: ["shared approval queue", "stale verifier note"],
        },
      },
      dependencyPlan: {
        totalDependencies: 3,
        sharedDependencyCount: 1,
        blockedDependencyCount: 1,
        criticalSteps: [
          {
            step: "qa-verification",
            surface: "workspace",
            selectedAgent: "qa-verification-agent",
            dependsOn: ["build-refactor"],
            blockers: ["approval pending"],
          },
        ],
      },
      workflowMemory: {
        recentStopSignals: 1,
      },
      partialCompletion: {
        blockedStep: "qa-verification",
        replayable: true,
        remainingSteps: ["qa-verification"],
        rerouteCount: 1,
      },
      recoveryPlan: {
        verificationHandoff: {
          reason: "Verifier must close the workflow once the bounded refactor is merged.",
        },
      },
      handoffPackages: [
        {
          payloadType: "workflow-replay",
          targetAgentId: "qa-verification-agent",
        },
      ],
    });

    expect(screen.getByText("Workflow Coordination Deck")).toBeInTheDocument();
    expect(screen.getByText("Workflow Profile")).toBeInTheDocument();
    expect(screen.getByText("Dependency Plan")).toBeInTheDocument();
    expect(screen.getByText("Replay And Handoff")).toBeInTheDocument();
    expect(screen.getByText("Critical path: market-research -> build-refactor -> qa-verification.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Verifier handoff: Verifier must close the workflow once the bounded refactor is merged.",
      ),
    ).toBeInTheDocument();

    view.rerenderFor("build-refactor", {
      scopeContract: {
        scopeType: "bounded-runtime-fix",
        bounded: true,
        estimatedTouchedFiles: 2,
        requestedMaxFilesChanged: 3,
      },
      surgeryProfile: {
        changeType: "surgical-fix",
        affectedSurfaces: ["operator-ui", "orchestrator"],
        qaVerificationRequired: true,
        rollbackSensitive: true,
        operatorReviewReason: "Proof-linked runtime work still needs bounded human review before rollout.",
      },
      verificationLoop: {
        requiresVerifier: true,
        postEditSteps: ["npm run build", "npx vitest run"],
        mode: "repair-linked",
      },
      impactEnvelope: {
        verificationDepth: "deep",
        rollbackWindow: "tight",
      },
      refusalProfile: {
        refused: false,
      },
      summary: {
        testsPass: true,
        filesChanged: 2,
        linesChanged: 54,
      },
    });

    expect(screen.getByText("Refactor Control Deck")).toBeInTheDocument();
    expect(screen.getByText("Scope Contract")).toBeInTheDocument();
    expect(screen.getByText("Surgery Profile")).toBeInTheDocument();
    expect(screen.getByText("Verification And Rollback")).toBeInTheDocument();
    expect(screen.getByText("Proof-linked runtime work still needs bounded human review before rollout.")).toBeInTheDocument();
    expect(screen.getByText("Post-edit steps: npm run build, npx vitest run.")).toBeInTheDocument();
  });

  it("renders knowledge, publication, compression, and community decks for the remaining communication lanes", () => {
    const view = renderTaskRunDetail("drift-repair", {
      contradictionLedger: [
        {
          summary: "Task catalog docs still trail the runtime wording for the build-refactor lane.",
        },
      ],
      repairDrafts: [
        {
          targetAgentId: "doc-specialist",
          handoff: {
            recommendedTaskType: "qa-verification",
          },
        },
      ],
      topologyPacks: [
        {
          targetAgentId: "reddit-helper",
          routeTaskType: "reddit-response",
        },
      ],
      taskSpecificKnowledge: [
        {
          targetAgentId: "content-agent",
        },
      ],
      entityFreshnessLedger: [
        {
          freshness: "stale",
        },
      ],
      contradictionGraph: {
        entityCount: 3,
        rankedContradictionCount: 1,
      },
      repairLoop: {
        status: "repair-needed",
        recommendedTaskType: "qa-verification",
        nextActions: ["Regenerate the knowledge pack after the task wording refresh."],
        staleSignals: ["Docs mirror is ahead of the last repair pack."],
      },
    });

    expect(screen.getByText("Knowledge Repair Deck")).toBeInTheDocument();
    expect(screen.getByText("Contradiction Review")).toBeInTheDocument();
    expect(screen.getByText("Repair Loop")).toBeInTheDocument();
    expect(screen.getByText("Knowledge Coverage")).toBeInTheDocument();
    expect(screen.getByText("Task catalog docs still trail the runtime wording for the build-refactor lane.")).toBeInTheDocument();
    expect(screen.getByText("Regenerate the knowledge pack after the task wording refresh.")).toBeInTheDocument();

    view.rerenderFor("content-generate", {
      publicationPolicy: {
        status: "grounded",
        rationale: "Every claim now maps back to a bounded evidence anchor.",
      },
      claimDiscipline: {
        groundedClaims: 4,
        speculativeClaims: ["launch date"],
      },
      routingDecision: {
        audience: "operators",
        documentMode: "release-note",
        downstreamAgent: "summarization-agent",
        escalationRequired: true,
      },
      handoffPackage: {
        targetAgentId: "summarization-agent",
        payloadType: "publication-summary",
        reason: "Compress the release note into a shorter operational handoff.",
      },
      evidenceSchema: {
        evidenceAttached: true,
        rails: ["docs", "runtime"],
        sourceSummaryCount: 2,
      },
      documentSpecialization: {
        mode: "release-note",
        riskLevel: "medium",
      },
    });

    expect(screen.getByText("Publishing Control Deck")).toBeInTheDocument();
    expect(screen.getByText("Publication Policy")).toBeInTheDocument();
    expect(screen.getByText("Routing Decision")).toBeInTheDocument();
    expect(screen.getByText("Evidence And Handoff")).toBeInTheDocument();
    expect(screen.getByText("Speculative claims: launch date.")).toBeInTheDocument();
    expect(screen.getByText("Compress the release note into a shorter operational handoff.")).toBeInTheDocument();

    view.rerenderFor("summarize-content", {
      evidencePreservation: {
        status: "preserved",
        anchorsRetained: 4,
        anchorsDetected: 4,
      },
      handoff: {
        readyForDelegation: true,
        mode: "operator-handoff",
      },
      handoffPackage: {
        targetAgentId: "reddit-helper",
        payloadType: "operator-handoff",
      },
      operationalCompression: {
        mode: "action-summary",
        anchorRetentionRatio: "1.0",
        blockerSafe: true,
        downstreamTarget: "reddit-helper",
      },
      actionCriticalDetails: {
        nextActions: ["Review the outbound explanation before publishing it."],
        blockers: ["awaiting reviewer"],
      },
      downstreamArtifact: {
        artifactType: "handoff-summary",
        replayAnchorCount: 3,
      },
    });

    expect(screen.getByText("Compression Handoff Deck")).toBeInTheDocument();
    expect(screen.getByText("Evidence Preservation")).toBeInTheDocument();
    expect(screen.getByText("Handoff Readiness")).toBeInTheDocument();
    expect(screen.getByText("Action-Critical Details")).toBeInTheDocument();
    expect(screen.getByText("Review the outbound explanation before publishing it.")).toBeInTheDocument();
    expect(screen.getByText("Blockers: awaiting reviewer.")).toBeInTheDocument();

    view.rerenderFor("reddit-response", {
      replyVerification: {
        requiresReview: true,
        doctrineApplied: ["value-first", "no-spam"],
        anchorCount: 3,
        reasoning: "Draft stays practical and avoids overselling what the runtime can guarantee.",
      },
      explanationBoundary: {
        status: "internal-only-review",
      },
      providerPosture: {
        reviewRecommended: true,
        mode: "hybrid-polished",
        queuePressureStatus: "elevated",
        reason: "Provider queue pressure suggests holding this draft for review before broad reuse.",
        fallbackIntegrity: "retained-local-doctrine",
      },
      communitySignalRouting: {
        systematic: true,
        handoffs: [
          {
            surface: "docs",
            targetAgentId: "doc-specialist",
            reason: "Capture the explanation for future doctrine refreshes.",
          },
        ],
      },
    });

    expect(screen.getByText("Community Control Deck")).toBeInTheDocument();
    expect(screen.getByText("Reply Verification")).toBeInTheDocument();
    expect(screen.getByText("Provider Posture")).toBeInTheDocument();
    expect(screen.getByText("Boundary And Routing")).toBeInTheDocument();
    expect(screen.getByText("Draft stays practical and avoids overselling what the runtime can guarantee.")).toBeInTheDocument();
    expect(screen.getByText("Capture the explanation for future doctrine refreshes.")).toBeInTheDocument();
  });

  it("renders extraction, canonicalization, and research decks for the remaining ingestion lanes", () => {
    const view = renderTaskRunDetail("data-extraction", {
      artifactCoverage: {
        formats: ["pdf", "markdown"],
        normalizationReadyCount: 1,
        adapterModes: ["parser"],
        provenanceDepth: "strong",
      },
      provenanceSummary: [
        {
          sourceType: "document",
          format: "pdf",
          extractedAt: "2026-03-11T10:00:00.000Z",
        },
      ],
      handoffPackages: [
        {
          targetAgentId: "normalization-agent",
          payloadType: "raw-extraction",
          confidence: "high",
        },
      ],
      recordsExtracted: 12,
      entitiesFound: 5,
    });

    expect(screen.getByText("Extraction Handoff Deck")).toBeInTheDocument();
    expect(screen.getByText("Artifact Coverage")).toBeInTheDocument();
    expect(screen.getByText("Provenance Summary")).toBeInTheDocument();
    expect(screen.getByText("Normalization Handoff")).toBeInTheDocument();
    expect(screen.getByText("Adapter modes: parser.")).toBeInTheDocument();
    expect(screen.getByText("Confidence: high.")).toBeInTheDocument();

    view.rerenderFor("normalize-data", {
      comparisonReadiness: {
        status: "watching",
        canonicalIdCount: 4,
        duplicateKeyCount: 1,
        uncertaintyCount: 1,
      },
      dedupeSummary: {
        totalKeys: 4,
        duplicateKeys: ["acme-1"],
      },
      handoffPackage: {
        targetAgentId: "market-research-agent",
        comparisonReady: false,
        canonicalIds: ["canonical-1", "canonical-2"],
      },
      schemaMismatches: [
        {
          field: "pricing",
        },
      ],
      uncertaintyFlags: [
        {
          type: "alias",
        },
      ],
      dedupeDecisions: [
        {
          action: "merge-review",
          dedupeKey: "acme-1",
        },
      ],
    });

    expect(screen.getByText("Canonicalization Deck")).toBeInTheDocument();
    expect(screen.getByText("Comparison Readiness")).toBeInTheDocument();
    expect(screen.getByText("Dedupe And Uncertainty")).toBeInTheDocument();
    expect(screen.getByText("Canonical Handoff")).toBeInTheDocument();
    expect(screen.getByText("Top decision: merge-review for acme-1.")).toBeInTheDocument();
    expect(screen.getByText("1 schema mismatch record(s) still need review.")).toBeInTheDocument();

    view.rerenderFor("market-research", {
      deltaCapture: {
        status: "fetched",
        substantiveCount: 2,
        degradedCount: 1,
        unreachableCount: 0,
      },
      changePack: {
        surfaces: ["pricing", "positioning"],
        durableSignalCount: 3,
        degradationResilient: true,
      },
      handoffPackage: {
        targetAgentId: "content-agent",
        payloadType: "market-change-pack",
        recommendedTaskType: "content-generate",
      },
      warnings: ["One source degraded to cached evidence."],
      confidence: "high",
      networkPosture: "degraded",
    });

    expect(screen.getByText("Research Signal Deck")).toBeInTheDocument();
    expect(screen.getByText("Delta Capture")).toBeInTheDocument();
    expect(screen.getByText("Change Pack")).toBeInTheDocument();
    expect(screen.getByText("Handoff And Confidence")).toBeInTheDocument();
    expect(screen.getByText("One source degraded to cached evidence.")).toBeInTheDocument();
    expect(screen.getByText("Recommended task: content-generate.")).toBeInTheDocument();
  }, 30000);

  it("renders operator focus actions on the governance page", () => {
    vi.mocked(consoleHooks.useDashboardOverview).mockReturnValue({
      data: {
        governance: {
          approvals: 2,
          taskRetryRecoveries: 1,
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof consoleHooks.useDashboardOverview>);

    vi.mocked(consoleHooks.useSkillsPolicy).mockReturnValue({
      data: {
        policy: {
          totalCount: 5,
          pendingReviewCount: 2,
          approvedCount: 3,
          restartSafeCount: 2,
        },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof consoleHooks.useSkillsPolicy>);

    vi.mocked(consoleHooks.useSkillsTelemetry).mockReturnValue({
      data: {
        telemetry: {
          totalInvocations: 20,
          allowedCount: 17,
          deniedCount: 3,
        },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof consoleHooks.useSkillsTelemetry>);

    vi.mocked(consoleHooks.useSkillsRegistry).mockReturnValue({
      data: {
        total: 2,
        skills: [
          {
            skillId: "skill-a",
            name: "Skill A",
            trustStatus: "pending-review",
            intakeSource: "agent-config",
            persistenceMode: "metadata-only",
            description: "Needs review",
          },
          {
            skillId: "skill-b",
            name: "Skill B",
            trustStatus: "review-approved",
            intakeSource: "agent-config",
            persistenceMode: "restart-safe",
            description: "Approved",
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof consoleHooks.useSkillsRegistry>);

    vi.mocked(consoleHooks.useSkillsAudit).mockReturnValue({
      data: {
        records: [],
        total: 0,
        page: {
          hasMore: false,
          returned: 0,
        },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof consoleHooks.useSkillsAudit>);

    render(
      <MemoryRouter>
        <GovernancePage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Operator Focus")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Governed skill posture needs operator review before you broaden automation or treat the trust model as settled.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Review 2 governed skill\(s\) before widening automation access\./i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Inspect 3 denied skill invocation\(s\) to confirm policy blocks are intentional\./i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Decide whether Skill A should stay metadata-only or graduate to restart-safe execution\./i,
      ),
    ).toBeInTheDocument();
  }, 30000);

  it("renders build-refactor as an operator-usable bounded surgery lane", () => {
    vi.mocked(consoleHooks.useTaskCatalog).mockReturnValue({
      data: {
        generatedAt: "2026-03-11T10:00:00.000Z",
        tasks: [
          {
            type: "build-refactor",
            label: "Build Refactor",
            purpose: "Run bounded refactor/build workflow through the spawned worker path.",
            operationalStatus: "confirmed-working",
            approvalGated: true,
            exposeInV1: true,
            dependencyClass: "worker",
            dependencyRequirements: ["spawned worker", "tool permissions", "approval gate"],
            baselineConfidence: "medium",
            caveats: ["Approval required before execution."],
            telemetryOverlay: { totalRuns: 4, successRate: 0.75 },
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof consoleHooks.useTaskCatalog>);

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Build Refactor"));

    expect(
      screen.getByText(/Autonomous mode synthesizes bounded repo patches from real scope evidence/i),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("orchestrator/src")).toBeInTheDocument();
    expect(screen.getByText("What To Do Next")).toBeInTheDocument();
    expect(
      screen.getByText(/worker scans the declared scope for supported repository transforms/i),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(/Repair the bounded runtime\/operator issue inside this scope/i),
    ).toBeInTheDocument();
  }, 30000);

  it("renders adapted operator guidance directly in the execution ledger", () => {
    vi.mocked(consoleHooks.useTaskRuns).mockReturnValue({
      data: {
        generatedAt: "2026-03-11T10:00:00.000Z",
        query: {},
        total: 1,
        page: { returned: 1, offset: 0, limit: 20, hasMore: false },
        runs: [
          {
            runId: "run-reddit-1",
            type: "reddit-response",
            status: "success",
            createdAt: "2026-03-11T10:00:00.000Z",
            startedAt: "2026-03-11T10:00:01.000Z",
            completedAt: "2026-03-11T10:00:05.000Z",
            model: "gpt-4.1-mini",
            cost: 0.012,
            latency: 650,
            usage: { promptTokens: 120, completionTokens: 60, totalTokens: 180 },
            workflow: {
              stage: "completed",
              graphStatus: "completed",
              stopClassification: "completed",
              awaitingApproval: false,
              retryScheduled: false,
              eventCount: 2,
              nodeCount: 3,
              edgeCount: 2,
            },
            approval: { required: false, status: null },
            events: [],
            workflowGraph: null,
            proofLinks: [],
            result: {
              operatorSummary:
                "Prepared a review-postured draft because the knowledge pack is behind the latest docs mirror.",
              recommendedNextActions: [
                "Run drift-repair before reusing this draft broadly.",
              ],
              specialistContract: {
                role: "Reddit Community Builder",
                workflowStage: "community-review",
                status: "watching",
              },
              knowledgeFreshness: {
                status: "docs-ahead-of-pack",
                reviewRecommended: true,
                warnings: [
                  "The docs mirror changed after the latest knowledge pack was generated.",
                ],
              },
            },
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof consoleHooks.useTaskRuns>);

    render(
      <MemoryRouter>
        <TaskRunsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Execution Ledger")).toBeInTheDocument();
    expect(screen.getByText("Run Ledger")).toBeInTheDocument();
    expect(screen.getByText("1 visible run carries adapted operator guidance.")).toBeInTheDocument();
    expect(screen.getByText("1 need review or escalation · 1 carry freshness warnings · 1 expose explicit next actions.")).toBeInTheDocument();
    expect(screen.getAllByText("Operator Guidance").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Prepared a review-postured draft because the knowledge pack is behind the latest docs mirror.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Next: Run drift-repair before reusing this draft broadly.")).toBeInTheDocument();
    expect(
      screen.getByText("Freshness: The docs mirror changed after the latest knowledge pack was generated."),
    ).toBeInTheDocument();
    expect(screen.getByText("Docs Ahead")).toBeInTheDocument();
  });

  it("renders integration-workflow as a bounded default-or-shorthand workflow lane", () => {
    vi.mocked(consoleHooks.useTaskCatalog).mockReturnValue({
      data: {
        generatedAt: "2026-03-11T10:00:00.000Z",
        tasks: [
          {
            type: "integration-workflow",
            label: "Integration Workflow",
            purpose: "Run multi-step workflow orchestration through the integration agent.",
            operationalStatus: "confirmed-working",
            approvalGated: false,
            exposeInV1: true,
            dependencyClass: "worker",
            dependencyRequirements: ["integration-agent worker", "step payload"],
            baselineConfidence: "medium",
            caveats: [
              "Blank submissions fall back to a bounded default workflow plan.",
              "Shorthand steps like `market-research: operator console trends` are normalized automatically.",
            ],
            telemetryOverlay: { totalRuns: 3, successRate: 1 },
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof consoleHooks.useTaskCatalog>);

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Integration Workflow"));

    expect(
      screen.getByText(/Leave steps blank to run the bounded default research - extract - normalize - verify plan/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/normalizes shorthand or empty step payloads into a bounded workflow plan/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Leave steps blank for the bounded default plan, or provide shorthand lines/i),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/market-research: operator console trends/i),
    ).toBeInTheDocument();
  });

  it("renders the new companion-facing public lanes with bounded guidance", () => {
    vi.mocked(consoleHooks.useTaskCatalog).mockReturnValue({
      data: {
        generatedAt: "2026-04-02T10:00:00.000Z",
        tasks: [
          {
            type: "control-plane-brief",
            label: "Control Plane Brief",
            purpose: "Produce a bounded control-plane summary with dominant pressure, primary operator move, and proof posture.",
            operationalStatus: "confirmed-working",
            approvalGated: false,
            exposeInV1: true,
            dependencyClass: "worker",
            dependencyRequirements: ["operations-analyst worker", "dashboard truth"],
            baselineConfidence: "medium",
            caveats: ["Use it when you need a portable operator brief for downstream clients or channel surfaces."],
            telemetryOverlay: { totalRuns: 2, successRate: 1 },
          },
          {
            type: "incident-triage",
            label: "Incident Triage",
            purpose: "Cluster incident pressure into a ranked operator queue with ownership, acknowledgement, remediation, and verification priorities.",
            operationalStatus: "confirmed-working",
            approvalGated: false,
            exposeInV1: true,
            dependencyClass: "worker",
            dependencyRequirements: ["system-monitor worker", "incident ledger"],
            baselineConfidence: "medium",
            caveats: ["Use the ranked queue as an operator ordering surface, not as automatic closure proof."],
            telemetryOverlay: { totalRuns: 1, successRate: 1 },
          },
          {
            type: "release-readiness",
            label: "Release Readiness",
            purpose: "Produce a bounded go, hold, or block release posture from verification, security, monitor, and build evidence.",
            operationalStatus: "confirmed-working",
            approvalGated: false,
            exposeInV1: true,
            dependencyClass: "worker",
            dependencyRequirements: ["release-manager worker", "verification evidence"],
            baselineConfidence: "medium",
            caveats: ["Treat hold or block output as operator guidance, not a background advisory."],
            telemetryOverlay: { totalRuns: 1, successRate: 1 },
          },
          {
            type: "deployment-ops",
            label: "Deployment Ops",
            purpose: "Produce a bounded deployment posture across rollout surfaces, rollback readiness, pipeline evidence, and docs parity.",
            operationalStatus: "confirmed-working",
            approvalGated: false,
            exposeInV1: true,
            dependencyClass: "worker",
            dependencyRequirements: ["deployment-ops worker", "deployment surface files"],
            baselineConfidence: "medium",
            caveats: ["Treat watch or blocked output as rollout guidance, not as a background advisory."],
            telemetryOverlay: { totalRuns: 1, successRate: 1 },
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof consoleHooks.useTaskCatalog>);

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Control Plane Brief"));
    expect(
      screen.getByText(
        /bounded machine-readable and operator-readable control-plane brief/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/operations-analyst worker fuses dashboard, queue, incident, approval, service, and proof truth/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Incident Triage"));
    expect(
      screen.getByText(/ranked triage queue with acknowledgement, ownership, remediation, and verification posture/i),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("8")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Release Readiness"));
    expect(
      screen.getAllByText(/bounded go, hold, or block release posture/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("main")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Deployment Ops"));
    expect(
      screen.getByText(/bounded deployment posture across rollout surfaces, rollback readiness, pipeline evidence, and documentation parity/i),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("public-runtime")).toBeInTheDocument();
    expect(screen.getByText("Rollout Mode")).toBeInTheDocument();
  });

  it("renders reddit-response as a freshness-aware knowledge-pack lane", () => {
    vi.mocked(consoleHooks.useTaskCatalog).mockReturnValue({
      data: {
        generatedAt: "2026-03-11T10:00:00.000Z",
        tasks: [
          {
            type: "reddit-response",
            label: "Reddit Response",
            purpose: "Draft community-safe responses with doctrine checks, provider posture, and downstream follow-up guidance.",
            operationalStatus: "confirmed-working",
            approvalGated: false,
            exposeInV1: true,
            dependencyClass: "worker",
            dependencyRequirements: ["reddit-helper pipeline", "knowledge pack", "optional model provider"],
            baselineConfidence: "medium",
            caveats: [
              "Grounding depends on the managed openclaw-docs mirror and the latest generated knowledge pack, not the raw docs tree directly.",
              "If the docs mirror changed after the latest pack was generated, refresh drift-repair before treating the draft as current or broadly reusable.",
            ],
            telemetryOverlay: { totalRuns: 3, successRate: 1 },
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof consoleHooks.useTaskCatalog>);

    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Reddit Response"));

    expect(
      screen.getByText(/pulls the latest knowledge pack plus runtime doctrine/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/If the resulting run says the docs mirror is ahead of the latest pack, run Drift Repair before you reuse the reply broadly/i),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/managed openclaw-docs mirror and the latest generated knowledge pack/i).length,
    ).toBeGreaterThan(0);
  });

  it("prioritizes the approval inbox by live operator triage pressure", () => {
    vi.mocked(consoleHooks.useHealth).mockReturnValue({
      data: {
        status: "healthy",
        timestamp: "2026-03-11T10:15:00.000Z",
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof consoleHooks.useHealth>);

    vi.mocked(consoleHooks.usePersistenceHealth).mockReturnValue({
      data: {
        status: "healthy",
        database: "mongo",
        collections: 5,
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof consoleHooks.usePersistenceHealth>);

    vi.mocked(consoleHooks.usePersistenceSummary).mockReturnValue({
      data: {
        generatedAt: "2026-03-11T10:15:00.000Z",
        status: "healthy",
        persistenceAvailable: true,
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof consoleHooks.usePersistenceSummary>);

    vi.mocked(consoleHooks.usePendingApprovals).mockReturnValue({
      data: {
        count: 2,
        pending: [
          {
            taskId: "approval-build-refactor",
            type: "build-refactor",
            requestedAt: "2026-03-11T09:00:00.000Z",
            status: "pending-review",
            payload: { scope: "operator console", files: ["src/pages/OverviewPage.tsx"] },
            impact: {
              riskLevel: "high",
              dependencyClass: "external",
              publicTriggerable: true,
              internalOnly: false,
              approvalReason: "Requires explicit code-change approval.",
            },
            payloadPreview: { keyCount: 2, internalKeyCount: 1 },
          },
          {
            taskId: "approval-doc-sync",
            type: "doc-sync",
            requestedAt: "2026-03-11T10:00:00.000Z",
            status: "pending-review",
            payload: { reason: "refresh docs" },
            impact: {
              riskLevel: "low",
              dependencyClass: "worker",
              publicTriggerable: false,
              internalOnly: true,
            },
            payloadPreview: { keyCount: 1, internalKeyCount: 0 },
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof consoleHooks.usePendingApprovals>);

    render(
      <MemoryRouter>
        <ApprovalsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Approval Inbox")).toBeInTheDocument();
    expect(screen.getByText("Operator Focus")).toBeInTheDocument();
    expect(screen.getByText("Immediate Attention")).toBeInTheDocument();
    expect(screen.getByText("Oldest Waiting")).toBeInTheDocument();
    expect(screen.getByText(/Current triage reason: high risk/i)).toBeInTheDocument();
    expect(screen.getByText(/build-refactor is surfaced first because it carries high risk/i)).toBeInTheDocument();
  });

  it("surfaces incident triage pressure before remediation detail", () => {
    vi.mocked(consoleHooks.useExtendedHealth).mockReturnValue({
      data: {
        status: "warning",
        controlPlane: { routing: "healthy", queue: { queued: 1, processing: 1 } },
        workers: {
          declaredAgents: 3,
          spawnedWorkerCapableCount: 2,
          serviceAvailableCount: 2,
          serviceInstalledCount: 1,
          serviceRunningCount: 1,
          serviceOperationalCount: 1,
        },
        repairs: { activeCount: 1, verifiedCount: 1, failedCount: 0 },
        dependencies: {
          persistence: { status: "healthy", database: true, collections: 5 },
          knowledge: { indexedEntries: 12, conceptCount: 7 },
        },
        truthLayers: {
          claimed: { status: "stable", summary: "claimed", evidence: [{ label: "Control Plane", detail: "orchestrator", status: "declared" }], signals: [] },
          configured: { status: "warning", summary: "configured", evidence: [], signals: [{ severity: "warning", message: "cookbook optional" }] },
          observed: { status: "warning", summary: "observed", evidence: [{ label: "Queue", detail: "1 queued", status: "live" }], signals: [] },
          public: { status: "warning", summary: "public", evidence: [], signals: [{ severity: "warning", message: "demand transport degraded" }] },
        },
        incidents: {
          overallStatus: "warning",
          openCount: 1,
          activeCount: 1,
          watchingCount: 0,
          bySeverity: { critical: 0, warning: 1, info: 0 },
        },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof consoleHooks.useExtendedHealth>);

    vi.mocked(consoleHooks.useDashboardOverview).mockReturnValue({
      data: {
        health: { status: "warning", fastStartMode: false },
        approvals: { pendingCount: 1, pending: [] },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof consoleHooks.useDashboardOverview>);

    vi.mocked(consoleHooks.useIncidents).mockReturnValue({
      data: {
        incidents: [
          {
            id: "inc-1",
            title: "Demand summary degraded",
            classification: "proof-delivery",
            severity: "warning",
            status: "active",
            truthLayer: "public",
            summary: "Demand proof is retrying.",
            owner: null,
            acknowledgedAt: null,
            lastSeenAt: "2026-03-11T10:15:00.000Z",
            verification: { required: true, status: "pending" },
            remediationTasks: [
              {
                remediationId: "rem-1",
              },
            ],
            remediation: { status: "ready" },
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof consoleHooks.useIncidents>);

    vi.mocked(consoleHooks.useIncidentDetail).mockReturnValue({
      data: {
        incident: {
          id: "inc-1",
          title: "Demand summary degraded",
          classification: "proof-delivery",
          severity: "warning",
          status: "active",
          truthLayer: "public",
          summary: "Demand proof is retrying.",
          owner: null,
          acknowledgedAt: null,
          acknowledgedBy: null,
          acknowledgementNote: null,
          firstSeenAt: "2026-03-11T10:00:00.000Z",
          lastSeenAt: "2026-03-11T10:15:00.000Z",
          affectedSurfaces: ["proof", "public-proof"],
          linkedProofDeliveries: ["demand:delivery-1"],
          linkedTaskIds: ["task-1"],
          linkedRunIds: ["run-1"],
          linkedServiceIds: ["orchestrator"],
          linkedRepairIds: [],
          evidence: ["demand transport retrying"],
          recommendedSteps: ["Inspect demand delivery ledger"],
          policy: {
            policyId: "policy-build-refactor",
            preferredOwner: "operator",
            remediationTaskType: "build-refactor",
            verifierTaskType: "qa-verification",
            targetSlaMinutes: 30,
            escalationMinutes: 15,
          },
          remediation: {
            owner: "operator",
            status: "ready",
            nextAction: "Queue a remediation task.",
            blockers: ["transport retry backlog"],
          },
          verification: {
            required: true,
            status: "pending",
            summary: "Verification still required.",
          },
          history: [{ eventId: "h-1", type: "detected", summary: "Detected", detail: "Incident created." }],
          acknowledgements: [],
          ownershipHistory: [],
          remediationTasks: [
            {
              remediationId: "rem-1",
              taskType: "system-monitor",
              taskId: "task-1",
              runId: "run-1",
              status: "verifying",
              reason: "Validate the degraded demand transport.",
              assignedTo: "AyobamiH",
              assignedAt: "2026-03-11T10:16:00.000Z",
              executionStartedAt: "2026-03-11T10:17:00.000Z",
              verificationStartedAt: "2026-03-11T10:18:00.000Z",
              verificationSummary: "Runtime health check completed; waiting for proof retry outcome.",
              blockers: ["public proof retry backlog"],
            },
          ],
        },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof consoleHooks.useIncidentDetail>);

    render(
      <MemoryRouter>
        <IncidentsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Incident Posture")).toBeInTheDocument();
    expect(screen.getByText("Incident Command Deck")).toBeInTheDocument();
    expect(screen.getByText("Operator Focus")).toBeInTheDocument();
    expect(screen.getByText("Needs Verification")).toBeInTheDocument();
    expect(screen.getAllByText("Demand summary degraded").length).toBeGreaterThan(0);
    expect(screen.getByText("Inspect demand delivery ledger")).toBeInTheDocument();
    expect(screen.getAllByText(/ack pending/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Current triage reason:/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Runtime health check completed; waiting for proof retry outcome\./i),
    ).toBeInTheDocument();
    expect(screen.getByText(/public proof retry backlog/i)).toBeInTheDocument();
    expect(screen.getByText(/approval-gated code surgery/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /create remediation/i }));
    expect(remediateMutate).toHaveBeenCalledWith({
      id: "inc-1",
      actor: "AyobamiH",
      note: undefined,
      taskType: undefined,
    });
  }, 30000);

  it("keeps system health technical after the incident split", () => {
    vi.mocked(consoleHooks.useHealth).mockReturnValue({
      data: { status: "healthy", timestamp: "2026-03-11T10:00:00.000Z" },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof consoleHooks.useHealth>);

    vi.mocked(consoleHooks.usePersistenceHealth).mockReturnValue({
      data: {
        status: "healthy",
        database: "mongo",
        collections: 5,
        coordination: { status: "healthy", store: "redis" },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof consoleHooks.usePersistenceHealth>);

    vi.mocked(consoleHooks.usePersistenceSummary).mockReturnValue({
      data: {
        status: "healthy",
        persistenceAvailable: true,
        indicators: { writes: "ok" },
        retention: { logs: "14d" },
        storage: { driver: "mongo" },
        collections: { incidents: 1 },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof consoleHooks.usePersistenceSummary>);

    vi.mocked(consoleHooks.useExtendedHealth).mockReturnValue({
      data: {
        status: "warning",
        controlPlane: { routing: "healthy", queue: { queued: 1, processing: 1 } },
        workers: {
          declaredAgents: 3,
          spawnedWorkerCapableCount: 2,
          serviceAvailableCount: 2,
          serviceInstalledCount: 1,
          serviceRunningCount: 1,
          serviceOperationalCount: 1,
        },
        repairs: { activeCount: 1, verifiedCount: 1, failedCount: 0 },
        dependencies: {
          persistence: { status: "healthy", database: true, collections: 5 },
          knowledge: { indexedEntries: 12, conceptCount: 7 },
        },
        truthLayers: {
          claimed: { status: "stable", summary: "claimed", evidence: [], signals: [] },
          configured: { status: "warning", summary: "configured", evidence: [], signals: [] },
          observed: { status: "warning", summary: "observed", evidence: [], signals: [] },
          public: { status: "warning", summary: "public", evidence: [], signals: [] },
        },
        incidents: {
          overallStatus: "warning",
          openCount: 1,
          activeCount: 1,
          watchingCount: 0,
          bySeverity: { critical: 0, warning: 1, info: 0 },
        },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof consoleHooks.useExtendedHealth>);

    vi.mocked(consoleHooks.useDashboardOverview).mockReturnValue({
      data: {
        health: { status: "warning", fastStartMode: false },
        approvals: { pendingCount: 1, pending: [] },
        selfHealing: {
          summary: { totalCount: 2, activeCount: 1, verifiedCount: 1, failedCount: 0 },
        },
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof consoleHooks.useDashboardOverview>);

    render(
      <MemoryRouter>
        <SystemHealthPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Runtime Surfaces")).toBeInTheDocument();
    expect(screen.getByText("Truth Layers")).toBeInTheDocument();
    expect(screen.getByText("Control Plane Status")).toBeInTheDocument();
    expect(screen.getByText("Dependencies")).toBeInTheDocument();
    expect(screen.queryByText("Incident Command Deck")).not.toBeInTheDocument();
  });

  it("renders knowledge surfaces safely when sources contain objects", () => {
    vi.mocked(consoleHooks.useKnowledgeSummary).mockReturnValue({
      data: {
        lastUpdated: "2026-03-11T10:00:00.000Z",
        stats: {
          total: 4,
          criticalEntries: [],
          recentUpdates: [{ id: "recent-1" }],
        },
        networkStats: {
          totalConcepts: 7,
          totalLinks: 3,
          avgConnectivity: 1.5,
        },
        diagnostics: {
          provenance: {
            unknownProvenanceCount: 1,
            bySourceType: {
              markdown: 3,
              runtime: 1,
            },
          },
          contradictionSignals: [],
          graphs: {
            provenance: {
              totalNodes: 3,
              totalEdges: 2,
              hotspots: [],
              nodes: [{ id: "n1", label: "markdown", kind: "source-type" }],
              edges: [],
            },
            contradictions: {
              contradictionCount: 0,
              hotspots: [],
              nodes: [],
              edges: [],
            },
            freshness: {
              score: 92,
              status: "fresh",
              hotspots: [],
              bands: { fresh: 3, aging: 1, stale: 0 },
              nodes: [],
              edges: [],
            },
          },
        },
        runtime: {
          freshness: {
            status: "fresh",
            staleAfterHours: 24,
            latestEntryUpdatedAt: "2026-03-11T09:00:00.000Z",
          },
          index: {
            indexedDocs: 12,
            docIndexVersion: 3,
          },
          coverage: {
            entryToDocRatio: 0.25,
          },
          signals: {
            coverage: [],
            staleness: [],
            contradictions: [],
          },
          graphs: {
            provenance: {
              totalNodes: 3,
              totalEdges: 2,
              hotspots: [],
              nodes: [{ id: "n1", label: "markdown", kind: "source-type" }],
              edges: [],
            },
            contradictions: {
              contradictionCount: 0,
              hotspots: [],
              nodes: [],
              edges: [],
            },
            freshness: {
              score: 92,
              status: "fresh",
              hotspots: [],
              bands: { fresh: 3, aging: 1, stale: 0 },
              nodes: [],
              edges: [],
            },
          },
        },
        topIssues: [],
        recentLearnings: [],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof consoleHooks.useKnowledgeSummary>);

    vi.mocked(consoleHooks.useKnowledgeQuery).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      data: {
        success: true,
        sources: [
          { id: "kb:proof-pipeline", label: "proof-pipeline" },
          { sourceType: "runtime", path: "orchestrator_state.json" },
        ],
        meta: {
          matchedEntries: 2,
          freshness: { status: "fresh" },
          contradictionSignals: [],
        },
        results: [{ id: "entry-1", title: "Proof pipeline" }],
      },
    } as unknown as ReturnType<typeof consoleHooks.useKnowledgeQuery>);

    vi.mocked(consoleHooks.useMemoryRecall).mockReturnValue({
      data: {
        totalAgents: 1,
        totalRuns: 3,
        items: [
          {
            agentId: "doc-specialist",
            lastRunAt: "2026-03-11T09:45:00.000Z",
            lastStatus: "success",
            totalRuns: 3,
            errorCount: 0,
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof consoleHooks.useMemoryRecall>);

    vi.mocked(consoleHooks.useAgentsOverview).mockReturnValue({
      data: {
        agents: [{ id: "doc-specialist", name: "Doc Specialist" }],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof consoleHooks.useAgentsOverview>);

    render(
      <MemoryRouter>
        <KnowledgePage />
      </MemoryRouter>,
    );

    expect(screen.getByText("proof-pipeline")).toBeInTheDocument();
    expect(screen.getAllByText("runtime").length).toBeGreaterThan(0);
    expect(screen.getByText("markdown")).toBeInTheDocument();
    expect(screen.getByText("Knowledge Graphs")).toBeInTheDocument();
    expect(screen.getAllByText("Freshness").length).toBeGreaterThan(0);
  });

  it("renders public proof through orchestrator-owned public endpoints", () => {
    vi.mocked(publicSurfaceHooks.useCommandCenterOverview).mockReturnValue({
      data: {
        evidenceCount: 4,
        visibleFeedCount: 2,
        activeLaneCount: 1,
        activeLanes: ["proof"],
        deadLetterCount: 0,
        stale: false,
        lastPollAt: "2026-03-11T10:15:00.000Z",
        riskCounts: { onTrack: 2, atRisk: 1, blocked: 0, completed: 1 },
        proofNodes: [
          { id: "emit", label: "Emit", state: "live", detail: "Proof emission healthy." },
        ],
        latest: {
          milestoneId: "ms-1",
          timestampUtc: "2026-03-11T10:15:00.000Z",
          scope: "orchestrator-public-proof",
          claim: "Public proof transport active",
          riskStatus: "on-track",
          nextAction: "Keep monitoring demand freshness.",
          source: "orchestrator",
          evidence: [{ type: "log", path: "logs/proof.jsonl", summary: "Published milestone" }],
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof publicSurfaceHooks.useCommandCenterOverview>);

    vi.mocked(publicSurfaceHooks.useCommandCenterControl).mockReturnValue({
      data: {
        clusters: [
          {
            id: "cluster-1",
            label: "Control Plane",
            engines: [{ id: "engine-1", name: "orchestrator", tier: "balanced", approvalClass: "bounded" }],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof publicSurfaceHooks.useCommandCenterControl>);

    vi.mocked(publicSurfaceHooks.useCommandCenterDemand).mockReturnValue({
      data: {
        segments: [{ id: "seg-1", label: "Operator demand", state: "warm", staticWeight: 3, liveSignalCount: 2 }],
        summary: {
          totalSegments: 1,
          hotSegments: 0,
          queueTotal: 2,
          stale: false,
          demandNarrative: "Demand pulse healthy.",
          source: "live",
          snapshotGeneratedAt: "2026-03-11T10:10:00.000Z",
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof publicSurfaceHooks.useCommandCenterDemand>);

    vi.mocked(publicSurfaceHooks.useCommandCenterDemandLive).mockReturnValue({
      data: {
        segments: [{ id: "seg-live-1", label: "Live operator demand", state: "warm", staticWeight: 2, liveSignalCount: 1 }],
        summary: {
          totalSegments: 1,
          hotSegments: 0,
          queueTotal: 1,
          stale: false,
          demandNarrative: "Live signal steady.",
          source: "live",
          snapshotGeneratedAt: "2026-03-11T10:12:00.000Z",
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof publicSurfaceHooks.useCommandCenterDemandLive>);

    vi.mocked(publicSurfaceHooks.useMilestonesLatest).mockReturnValue({
      data: {
        items: [
          {
            milestoneId: "ms-1",
            timestampUtc: "2026-03-11T10:15:00.000Z",
            scope: "orchestrator-public-proof",
            claim: "Public proof transport active",
            riskStatus: "on-track",
            nextAction: "Keep monitoring demand freshness.",
            source: "orchestrator",
            evidence: [{ type: "log", path: "logs/proof.jsonl", summary: "Published milestone" }],
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof publicSurfaceHooks.useMilestonesLatest>);

    vi.mocked(publicSurfaceHooks.useMilestonesDeadLetter).mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof publicSurfaceHooks.useMilestonesDeadLetter>);

    render(
      <MemoryRouter>
        <PublicProofPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Public Proof")).toBeInTheDocument();
    expect(screen.getByText(/community confidence layer/i)).toBeInTheDocument();
    expect(screen.getByText("Proof Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Recent Milestones")).toBeInTheDocument();
    expect(screen.getByText("Demand pulse healthy.")).toBeInTheDocument();
    expect(screen.getByText("No dead-letter milestones")).toBeInTheDocument();
  }, 30000);
});
