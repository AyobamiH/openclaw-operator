import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useAgentsOverview, useDashboardOverview, useTaskCatalog } from "@/hooks/use-console-api";
import { useCommandCenterOverview } from "@/hooks/use-public-surface-api";
import { ActivityModuleRow } from "@/components/console/ActivityModuleRow";
import { ActivityPagination } from "@/components/console/ActivityPagination";
import { MetricModule, SummaryCard } from "@/components/console/SummaryCard";
import { StatusBadge } from "@/components/console/StatusBadge";
import { TaskBentoCard } from "@/components/console/TaskBentoCard";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  Globe,
  ListTodo,
  Milestone,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { bool, num, str, toArray, toNullableString } from "@/lib/safe-render";
import type {
  DashboardIncidentClassificationItem,
  DashboardQueuePressureItem,
  RecentTask,
} from "@/types/console";

interface OverviewVM {
  healthStatus: string;
  fastStartMode: boolean;
  persistenceStatus: string;
  persistenceDatabase: string | null;
  meteredSpend: number;
  budgetStatus: string;
  remainingBudgetCalls: number | null;
  queued: number;
  processing: number;
  queuePressure: QueuePressureVM[];
  pendingApprovals: number;
  retryRecoveries: number;
  openIncidents: number;
  watchingIncidents: number;
  incidentClassifications: IncidentClassificationVM[];
  recentTasks: RecentTask[];
}

interface ProofWidgetVM {
  onTrack: number;
  atRisk: number;
  blocked: number;
  completed: number;
  latestClaim: string | null;
  latestScope: string | null;
  latestTimestamp: string | null;
  stale: boolean;
  evidenceCount: number;
  activeLaneCount: number;
  statusLabel: string;
  badgeLabel: string;
  detail: string;
  tone: "healthy" | "warning" | "info" | "neutral";
}

interface AgentSignalVM {
  declaredCount: number;
  serviceAvailableCount: number;
  serviceExpectedCount: number;
  serviceRunningCount: number;
}

interface QueuePressureVM {
  type: string;
  label: string;
  source: string;
  queuedCount: number;
  processingCount: number;
  totalCount: number;
}

interface IncidentClassificationVM {
  classification: DashboardIncidentClassificationItem["classification"];
  label: string;
  count: number;
  activeCount: number;
  watchingCount: number;
  highestSeverity: DashboardIncidentClassificationItem["highestSeverity"];
}

interface ActionTaskVM {
  type: string;
  label: string;
  purpose: string;
  operationalStatus: string;
  approvalGated: boolean;
  availabilityLabel: string;
  caveats: string[];
  totalRuns: number;
  successRate: string;
}

interface AttentionItemVM {
  id: string;
  title: string;
  detail: string;
  route: string;
  tone: "warning" | "healthy" | "info";
}

function buildQueuePressureVM(queue: any): QueuePressureVM[] {
  return toArray<DashboardQueuePressureItem>(queue?.pressure)
    .map((item) => ({
      type: str(item?.type, "unknown"),
      label: str(item?.label, "Unknown Task"),
      source: str(item?.source, "System"),
      queuedCount: num(item?.queuedCount),
      processingCount: num(item?.processingCount),
      totalCount: num(item?.totalCount),
    }))
    .filter((item) => item.totalCount > 0);
}

function buildIncidentClassificationVM(incidents: any): IncidentClassificationVM[] {
  return toArray<DashboardIncidentClassificationItem>(incidents?.topClassifications)
    .map((item) => ({
      classification: str(item?.classification, "knowledge") as IncidentClassificationVM["classification"],
      label: str(item?.label, "Unknown"),
      count: num(item?.count),
      activeCount: num(item?.activeCount),
      watchingCount: num(item?.watchingCount),
      highestSeverity: str(item?.highestSeverity, "info") as IncidentClassificationVM["highestSeverity"],
    }))
    .filter((item) => item.count > 0);
}

function collapseRepeatedRecentTasks(tasks: RecentTask[]) {
  const collapsed: RecentTask[] = [];

  for (const task of tasks) {
    const previous = collapsed.at(-1);
    const signature = [
      str(task.type, "unknown"),
      str(task.status, "unknown"),
      str(task.label ?? task.message ?? "", ""),
      str(task.result ?? "", ""),
      str(task.agent ?? "", ""),
    ].join("|");
    const previousSignature = previous
      ? [
          str(previous.type, "unknown"),
          str(previous.status, "unknown"),
          str(previous.label ?? previous.message ?? "", ""),
          str(previous.result ?? "", ""),
          str(previous.agent ?? "", ""),
        ].join("|")
      : null;

    if (previous && previousSignature === signature) {
      previous.repeatCount = (previous.repeatCount ?? 1) + 1;
      previous.firstSeenAt =
        previous.firstSeenAt ??
        previous.handledAt ??
        previous.completedAt ??
        previous.startedAt ??
        previous.createdAt;
      previous.lastSeenAt =
        task.handledAt ??
        task.completedAt ??
        task.startedAt ??
        task.createdAt ??
        previous.lastSeenAt;
      continue;
    }

    collapsed.push({
      ...task,
      repeatCount: task.repeatCount ?? 1,
      firstSeenAt:
        task.handledAt ??
        task.completedAt ??
        task.startedAt ??
        task.createdAt,
      lastSeenAt:
        task.handledAt ??
        task.completedAt ??
        task.startedAt ??
        task.createdAt,
    });
  }

  return collapsed;
}

function isTimeoutLikeError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : str((error as { message?: string } | null | undefined)?.message, "").toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("abort") ||
    message.includes("failed to fetch")
  );
}

function buildQueuePressureSummary(queuePressure: QueuePressureVM[]) {
  if (queuePressure.length === 0) {
    return "No queue hotspot is currently dominating the execution ledger.";
  }

  return queuePressure
    .slice(0, 2)
    .map((item) => {
      const parts: string[] = [];
      if (item.queuedCount > 0) {
        parts.push(`${item.queuedCount} queued`);
      }
      if (item.processingCount > 0) {
        parts.push(`${item.processingCount} processing`);
      }
      return `${item.label} (${item.source}) ${parts.join(" · ")}`;
    })
    .join(" · ");
}

function buildOverviewVM(dashboard: any): OverviewVM {
  const health = dashboard?.health ?? {};
  const persistence = dashboard?.persistence ?? {};
  const accounting = dashboard?.accounting ?? {};
  const queue = dashboard?.queue ?? {};
  const approvals = dashboard?.approvals ?? {};
  const governance = dashboard?.governance ?? {};
  const incidents = dashboard?.incidents ?? {};
  const rawTasks = toArray(dashboard?.recentTasks);
  const budget = accounting?.currentBudget ?? {};

  return {
    healthStatus: str(health?.status, "unknown"),
    fastStartMode: bool(health?.fastStartMode),
    persistenceStatus: str(persistence?.status, "unknown"),
    persistenceDatabase: toNullableString(persistence?.database),
    meteredSpend: num(accounting?.totalCostUsd),
    budgetStatus: str(budget?.status, "unknown"),
    remainingBudgetCalls:
      typeof budget?.remainingLlmCalls === "number" ? budget.remainingLlmCalls : null,
    queued: num(queue?.queued),
    processing: num(queue?.processing),
    queuePressure: buildQueuePressureVM(queue),
    pendingApprovals: num(approvals?.pendingCount),
    retryRecoveries: num(governance?.taskRetryRecoveries),
    openIncidents: num(incidents?.openCount),
    watchingIncidents: num(incidents?.watchingCount),
    incidentClassifications: buildIncidentClassificationVM(incidents),
    recentTasks: collapseRepeatedRecentTasks(
      rawTasks.map((task: any) => {
        const rawStatus = str(task?.result ?? task?.status, "unknown");
        const normalizedStatus =
          rawStatus === "ok" ? "success" : rawStatus === "error" ? "failed" : rawStatus;

        return {
          id: str(task?.id ?? task?.taskId, ""),
          taskId: str(task?.taskId ?? task?.id, ""),
          type: str(task?.type, "unknown"),
          label: str(task?.message ?? task?.label ?? task?.type, "unknown"),
          message: toNullableString(task?.message) ?? undefined,
          status: normalizedStatus,
          result: toNullableString(task?.result) ?? undefined,
          agent: str(task?.agent ?? "system", "system"),
          startedAt: toNullableString(task?.startedAt ?? task?.handledAt) ?? undefined,
          completedAt: toNullableString(task?.completedAt ?? task?.handledAt) ?? undefined,
          createdAt: toNullableString(task?.createdAt) ?? undefined,
          handledAt: toNullableString(task?.handledAt) ?? undefined,
        };
      }),
    ),
  };
}

function buildProofWidgetVM(args: {
  proof: any;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}): ProofWidgetVM {
  const { proof, isLoading, isError, error } = args;
  if (!proof) {
    if (isLoading) {
      return {
        onTrack: 0,
        atRisk: 0,
        blocked: 0,
        completed: 0,
        latestClaim: null,
        latestScope: null,
        latestTimestamp: null,
        stale: false,
        evidenceCount: 0,
        activeLaneCount: 0,
        statusLabel: "Polling",
        badgeLabel: "pending",
        detail: "The public proof surface is still polling for its first fresh runtime snapshot.",
        tone: "info",
      };
    }
    return {
      onTrack: 0,
      atRisk: 0,
      blocked: 0,
      completed: 0,
      latestClaim: null,
      latestScope: null,
      latestTimestamp: null,
      stale: false,
      evidenceCount: 0,
      activeLaneCount: 0,
      statusLabel: isError && isTimeoutLikeError(error) ? "Timed Out" : "Unavailable",
      badgeLabel: "warning",
      detail:
        isError && isTimeoutLikeError(error)
          ? "The public proof route is timing out, so private operator truth may be ahead."
          : "The public evidence surface is not reporting yet.",
      tone: "warning",
    };
  }

  const risk = proof?.riskCounts ?? {};
  const latest = proof?.latest;
  const evidenceCount = num(proof?.evidenceCount);
  const activeLaneCount = num(proof?.activeLaneCount);
  const stale = bool(proof?.stale);
  const emptyButHealthy = evidenceCount === 0 && activeLaneCount === 0 && !latest && !stale;

  return {
    onTrack: num(risk?.onTrack),
    atRisk: num(risk?.atRisk),
    blocked: num(risk?.blocked),
    completed: num(risk?.completed),
    latestClaim: toNullableString(latest?.claim),
    latestScope: toNullableString(latest?.scope),
    latestTimestamp: toNullableString(latest?.timestampUtc),
    stale,
    evidenceCount,
    activeLaneCount,
    statusLabel: stale ? "Stale" : emptyButHealthy ? "Empty but live" : "Publishing",
    badgeLabel: stale ? "catching-up" : emptyButHealthy ? "live" : "publishing",
    detail: stale
      ? "Public proof is up, but its visible evidence window is behind the active runtime."
      : emptyButHealthy
        ? "Public proof is healthy, but no publishable evidence has been emitted into the feed yet."
        : `${evidenceCount} evidence entr${evidenceCount === 1 ? "y" : "ies"} across ${activeLaneCount} live lane${activeLaneCount === 1 ? "" : "s"}.`,
    tone: stale ? "warning" : emptyButHealthy ? "healthy" : "info",
  };
}

function buildAgentSignalVM(agentsData: any): AgentSignalVM {
  const agents = toArray(agentsData?.agents);

  return {
    declaredCount: agents.length,
    serviceAvailableCount: agents.filter((agent: any) => bool(agent?.serviceAvailable ?? agent?.serviceOperational)).length,
    serviceExpectedCount: agents.filter((agent: any) => bool(agent?.serviceExpected)).length,
    serviceRunningCount: agents.filter((agent: any) => agent?.serviceRunning === true).length,
  };
}

function classifyActionTask(task: any): string {
  const status = str(task?.operationalStatus, "unknown").toLowerCase();
  const dependencyClass = str(task?.dependencyClass, "").toLowerCase();
  const caveats = toArray<string>(task?.caveats).map((item) => str(item, "").toLowerCase());

  if (!["active", "healthy", "running", "stable", "available"].includes(status)) {
    return "Partially Available";
  }

  if (bool(task?.approvalGated)) {
    return "Requires Approval";
  }

  if (
    dependencyClass.includes("external") ||
    dependencyClass.includes("provider") ||
    dependencyClass.includes("network") ||
    dependencyClass.includes("service") ||
    caveats.some((caveat) =>
      caveat.includes("provider") ||
      caveat.includes("quota") ||
      caveat.includes("network") ||
      caveat.includes("external"),
    )
  ) {
    return "Externally Dependent";
  }

  return "Available Now";
}

function buildActionTasks(catalog: any): ActionTaskVM[] {
  const priority: Record<string, number> = {
    heartbeat: 1,
    "system-monitor": 2,
    "doc-sync": 3,
    "drift-repair": 4,
    "qa-verification": 5,
    "nightly-batch": 6,
    "build-refactor": 7,
    "market-research": 8,
    "reddit-response": 9,
  };

  return toArray(catalog?.tasks)
    .filter((task: any) => task?.exposeInV1 !== false && !task?.internalOnly)
    .map((task: any) => {
      const telemetry = task?.telemetryOverlay;
      return {
        type: str(task?.type, "unknown"),
        label: str(task?.label, "Unknown Task"),
        purpose: str(task?.purpose, "—"),
        operationalStatus: str(task?.operationalStatus, "unknown"),
        approvalGated: bool(task?.approvalGated),
        availabilityLabel: classifyActionTask(task),
        caveats: toArray<string>(task?.caveats).map((item) => str(item, "")),
        totalRuns: num(telemetry?.totalRuns),
        successRate: telemetry?.successRate != null ? `${(num(telemetry.successRate) * 100).toFixed(0)}%` : "—",
      };
    })
    .sort((left, right) => {
      const byPriority = (priority[left.type] ?? 999) - (priority[right.type] ?? 999);
      if (byPriority !== 0) return byPriority;
      return left.label.localeCompare(right.label);
    });
}

function buildAttentionItems(vm: OverviewVM, proofVM: ProofWidgetVM): AttentionItemVM[] {
  const items: AttentionItemVM[] = [];

  if (vm.pendingApprovals > 0) {
    items.push({
      id: "approvals",
      title: `${vm.pendingApprovals} approval${vm.pendingApprovals === 1 ? "" : "s"} waiting`,
      detail: "Review gated work before it can continue.",
      route: "/approvals",
      tone: "warning",
    });
  }

  if (vm.openIncidents > 0) {
    items.push({
      id: "incidents",
      title: `${vm.openIncidents} active incident${vm.openIncidents === 1 ? "" : "s"}`,
      detail: "Ownership, remediation, and verification are still in flight.",
      route: "/incidents",
      tone: "warning",
    });
  }

  if (vm.persistenceStatus !== "healthy") {
    items.push({
      id: "persistence",
      title: "Persistence is partially available",
      detail: "Durability and replay confidence are reduced until storage recovers.",
      route: "/system-health",
      tone: "warning",
    });
  }

  if (vm.retryRecoveries > 0) {
    items.push({
      id: "retries",
      title: `${vm.retryRecoveries} retry recovery${vm.retryRecoveries === 1 ? "" : "ies"} pending`,
      detail: "Execution truth is live, but some failed work is still replaying.",
      route: "/task-runs",
      tone: "info",
    });
  }

  if (vm.fastStartMode) {
    items.push({
      id: "fast-start",
      title: "Fast-start mode is active",
      detail: "The console is live, but some background services may still be warming up.",
      route: "/system-health",
      tone: "info",
    });
  }

  if (proofVM?.statusLabel === "Timed Out") {
    items.push({
      id: "proof-timeout",
      title: "Public proof polling timed out",
      detail: "The public evidence route is reachable enough to matter, but not completing cleanly.",
      route: "/public-proof",
      tone: "warning",
    });
  } else if (proofVM?.stale) {
    items.push({
      id: "proof",
      title: "Public proof is stale",
      detail: "Internal runtime may be ahead of what the public evidence surface can prove.",
      route: "/public-proof",
      tone: "warning",
    });
  }

  return items;
}

function AttentionRailItem({
  item,
  onOpen,
}: {
  item: AttentionItemVM;
  onOpen: () => void;
}) {
  const toneClass =
    item.tone === "warning"
      ? "text-status-warning border-status-warning/20"
      : item.tone === "healthy"
        ? "text-status-healthy border-status-healthy/20"
        : "text-status-info border-status-info/20";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="console-inset p-3 rounded-sm text-left transition-colors hover:border-primary/20 hover:bg-panel-highlight/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={toneClass}>
            {item.tone === "warning" ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          </span>
          <p className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-foreground">
            {item.title}
          </p>
        </div>
        <ArrowRight className="w-3 h-3 text-muted-foreground" />
      </div>
      <p className="mt-3 text-[10px] font-mono text-muted-foreground leading-relaxed">
        {item.detail}
      </p>
    </button>
  );
}

function SnapshotStage({
  title,
  value,
  detail,
  routeLabel,
  icon,
  tone = "neutral",
  onOpen,
}: {
  title: string;
  value: string;
  detail: string;
  routeLabel: string;
  icon: React.ReactNode;
  tone?: "healthy" | "warning" | "info" | "neutral";
  onOpen: () => void;
}) {
  const toneClass =
    tone === "healthy"
      ? "text-status-healthy border-status-healthy/20"
      : tone === "warning"
        ? "text-status-warning border-status-warning/20"
        : tone === "info"
          ? "text-status-info border-status-info/20"
          : "text-foreground border-border/60";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="console-inset p-3 rounded-sm text-left transition-colors hover:border-primary/20 hover:bg-panel-highlight/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={toneClass}>{icon}</span>
          <span className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-muted-foreground">{title}</span>
        </div>
        <ArrowRight className="w-3 h-3 text-muted-foreground" />
      </div>
      <p className={`mt-3 text-[16px] font-mono font-black uppercase tracking-[0.08em] ${toneClass.split(" ")[0]}`}>
        {value}
      </p>
      <p className="mt-2 text-[10px] font-mono text-muted-foreground leading-relaxed">{detail}</p>
      <p className="mt-3 text-[9px] font-mono uppercase tracking-wider text-primary">{routeLabel}</p>
    </button>
  );
}

export default function OverviewPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const isOperator = hasRole("operator");
  const { data: dashboard, isLoading, isError, error } = useDashboardOverview();
  const { data: agentsData } = useAgentsOverview();
  const { data: catalog } = useTaskCatalog();
  const {
    data: proof,
    isLoading: proofLoading,
    isError: proofError,
    error: proofRouteError,
  } = useCommandCenterOverview();

  const vm = useMemo(() => buildOverviewVM(dashboard), [dashboard]);
  const proofVM = useMemo(
    () => buildProofWidgetVM({
      proof,
      isLoading: proofLoading,
      isError: proofError,
      error: proofRouteError,
    }),
    [proof, proofError, proofLoading, proofRouteError],
  );
  const agentSignal = useMemo(() => buildAgentSignalVM(agentsData), [agentsData]);
  const actionTasks = useMemo(() => buildActionTasks(catalog).slice(0, 4), [catalog]);
  const attentionItems = useMemo(() => buildAttentionItems(vm, proofVM), [proofVM, vm]);

  const openTaskShortcut = (taskType: string) => {
    const params = new URLSearchParams();
    params.set("openTask", taskType);
    navigate({ pathname: "/tasks", search: `?${params.toString()}` });
  };

  if (isLoading && !dashboard) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, index) => (
            <div key={index} className="console-panel h-28 animate-pulse" style={{ opacity: 0.3 }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {isError && !dashboard && (
        <div className="warning-banner">
          <AlertTriangle className="w-4 h-4 text-status-warning mt-0.5 shrink-0" />
          <div>
            <p className="text-[11px] font-mono font-semibold text-status-warning uppercase tracking-wider">
              Overview Aggregate Unavailable
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {(error as Error | undefined)?.message || "The overview aggregate did not load. Showing partial operator truth from the remaining live sources."}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="page-title">Operator Overview</h2>
        <div className="console-inset p-3 rounded-sm flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">
              Live control-plane truth, governed work, and safe next actions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge label={vm.healthStatus} size="sm" />
            <StatusBadge label={vm.persistenceStatus} size="sm" />
            {vm.fastStartMode && <StatusBadge label="fast-start" size="sm" />}
            {(proofVM.stale || proofVM.statusLabel === "Timed Out") && <StatusBadge label="proof stale" size="sm" />}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <MetricModule
          title="System"
          icon={<CheckCircle2 className="w-4 h-4" />}
          value={vm.healthStatus.toUpperCase()}
          subtitle={vm.fastStartMode ? "fast-start active" : "control plane"}
          glow={vm.healthStatus !== "healthy" || vm.fastStartMode}
          onClick={() => navigate("/system-health")}
        />
        <MetricModule
          title="Persistence"
          icon={<Wrench className="w-4 h-4" />}
          value={vm.persistenceStatus.toUpperCase()}
          subtitle={vm.persistenceDatabase ?? "durability posture"}
          glow={vm.persistenceStatus !== "healthy"}
          onClick={() => navigate("/system-health")}
        />
        <MetricModule
          title="Approvals"
          icon={<ShieldCheck className="w-4 h-4" />}
          value={vm.pendingApprovals}
          subtitle={vm.pendingApprovals === 0 ? "nothing waiting" : "gated work paused"}
          glow={vm.pendingApprovals > 0}
          onClick={() => navigate("/approvals")}
        />
        <MetricModule
          title="Incidents"
          icon={<AlertTriangle className="w-4 h-4" />}
          value={vm.openIncidents}
          subtitle={vm.openIncidents === 0 ? "no active pressure" : `${vm.watchingIncidents} watching`}
          glow={vm.openIncidents > 0}
          onClick={() => navigate("/incidents")}
        />
        <MetricModule
          title="Metered Spend"
          icon={<Clock className="w-4 h-4" />}
          value={`$${vm.meteredSpend.toFixed(4)}`}
          subtitle={
            vm.remainingBudgetCalls !== null
              ? `${vm.budgetStatus} · ${vm.remainingBudgetCalls} calls left`
              : vm.budgetStatus
          }
          glow={vm.budgetStatus === "exhausted"}
          onClick={() => navigate("/task-runs")}
        />
      </div>

      <SummaryCard
        title="Needs Attention"
        icon={<AlertTriangle className="w-4 h-4" />}
        headerAction={(
          <button
            type="button"
            onClick={() => navigate("/incidents")}
            className="text-[9px] font-mono uppercase tracking-wider text-primary hover:text-primary/80 transition-colors"
          >
            Open Incidents
          </button>
        )}
      >
        <div className="space-y-3">
          {attentionItems.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {attentionItems.map((item) => (
                <AttentionRailItem
                  key={item.id}
                  item={item}
                  onOpen={() => navigate(item.route)}
                />
              ))}
            </div>
          ) : (
            <div className="console-inset p-4 rounded-sm flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 text-status-healthy shrink-0" />
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.12em] text-status-healthy">
                  No immediate operator action required
                </p>
                <p className="mt-1 text-[10px] font-mono text-muted-foreground">
                  Queue, approvals, incidents, persistence, and public proof are not currently signaling urgent intervention.
                </p>
              </div>
            </div>
          )}

          {vm.incidentClassifications.length > 0 && (
            <div className="console-inset p-3 rounded-sm space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                  Top Incident Classifications
                </p>
                <button
                  type="button"
                  onClick={() => navigate("/incidents")}
                  className="text-[9px] font-mono uppercase tracking-wider text-primary hover:text-primary/80 transition-colors"
                >
                  Review Queue
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {vm.incidentClassifications.map((item) => (
                  <div
                    key={item.classification}
                    className="rounded-sm border border-border/60 bg-panel-highlight/10 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.08em] text-foreground">
                        {item.label}
                      </p>
                      <StatusBadge label={item.highestSeverity} size="sm" />
                    </div>
                    <p className="mt-2 text-[10px] font-mono text-muted-foreground">
                      {item.count} open · {item.activeCount} active · {item.watchingCount} watching
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SummaryCard>

      <SummaryCard
        title="Execution Snapshot"
        icon={<ListTodo className="w-4 h-4" />}
        headerAction={(
          <button
            type="button"
            onClick={() => navigate("/task-runs")}
            className="text-[9px] font-mono uppercase tracking-wider text-primary hover:text-primary/80 transition-colors"
          >
            Open Runs
          </button>
        )}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
          <SnapshotStage
            title="Queue"
            icon={<ListTodo className="w-4 h-4" />}
            value={`${vm.queued} queued`}
            detail={`${vm.processing} processing now. ${buildQueuePressureSummary(vm.queuePressure)}`}
            routeLabel="Tasks + Runs"
            tone={vm.queued > 0 || vm.processing > 0 ? "info" : "neutral"}
            onOpen={() => navigate("/task-runs")}
          />
          <SnapshotStage
            title="Approvals"
            icon={<ShieldCheck className="w-4 h-4" />}
            value={vm.pendingApprovals === 0 ? "Clear" : `${vm.pendingApprovals} pending`}
            detail={vm.pendingApprovals === 0 ? "No gated work is waiting on operator action." : "Approval-gated work is paused until review."}
            routeLabel="Approval Inbox"
            tone={vm.pendingApprovals > 0 ? "warning" : "healthy"}
            onOpen={() => navigate("/approvals")}
          />
          <SnapshotStage
            title="Agents"
            icon={<Bot className="w-4 h-4" />}
            value={`${agentSignal.declaredCount} declared`}
            detail={`${agentSignal.serviceRunningCount} host-running · ${agentSignal.serviceAvailableCount} entrypoints available · ${agentSignal.serviceExpectedCount} service-expected.`}
            routeLabel="Agents"
            tone={agentSignal.serviceRunningCount > 0 ? "healthy" : "neutral"}
            onOpen={() => navigate("/agents")}
          />
          <SnapshotStage
            title="Public Proof"
            icon={<Globe className="w-4 h-4" />}
            value={proofVM.statusLabel}
            detail={proofVM.detail}
            routeLabel="Public Proof"
            tone={proofVM.tone}
            onOpen={() => navigate("/public-proof")}
          />
        </div>

        {vm.queuePressure.length > 0 && (
          <div className="console-inset mt-3 p-3 rounded-sm space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                Queue Pressure Sources
              </p>
              <button
                type="button"
                onClick={() => navigate("/task-runs")}
                className="text-[9px] font-mono uppercase tracking-wider text-primary hover:text-primary/80 transition-colors"
              >
                Open Runs
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {vm.queuePressure.slice(0, 4).map((item) => (
                <div
                  key={`${item.type}:${item.source}`}
                  className="rounded-sm border border-border/60 bg-panel-highlight/10 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.08em] text-foreground">
                      {item.label}
                    </p>
                    <span className="text-[9px] font-mono uppercase tracking-wider text-primary">
                      {item.source}
                    </span>
                  </div>
                  <p className="mt-2 text-[10px] font-mono text-muted-foreground">
                    {item.queuedCount} queued · {item.processingCount} processing · {item.totalCount} total pressure
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </SummaryCard>

      <SummaryCard
        title="Safe Next Actions"
        icon={<ShieldCheck className="w-4 h-4" />}
        headerAction={(
          <button
            type="button"
            onClick={() => navigate("/tasks")}
            className="text-[9px] font-mono uppercase tracking-wider text-primary hover:text-primary/80 transition-colors"
          >
            Open Catalog
          </button>
        )}
      >
        <div className="space-y-3">
          <div className="console-inset p-3 rounded-sm">
            <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
              Only bounded V1 tasks are shown here. Status labels stay honest: available now, requires approval,
              partially available, or externally dependent.
            </p>
          </div>

          {actionTasks.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {actionTasks.map((task) => (
                <TaskBentoCard
                  key={task.type}
                  task={task}
                  isOperator={isOperator}
                  isPending={false}
                  onRun={() => openTaskShortcut(task.type)}
                />
              ))}
            </div>
          ) : (
            <div className="console-inset p-4 rounded-sm">
              <p className="text-[10px] font-mono text-muted-foreground">
                No operator-safe task shortcuts are currently exposed by the backend catalog.
              </p>
            </div>
          )}
        </div>
      </SummaryCard>

      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_0.7fr] gap-3">
        <RecentActivitySection tasks={vm.recentTasks} onOpenRuns={() => navigate("/task-runs")} />

        <SummaryCard
          title="Proof + Trust"
          icon={<Globe className="w-4 h-4" />}
          headerAction={(
            <button
              type="button"
              onClick={() => navigate("/public-proof")}
              className="text-[9px] font-mono uppercase tracking-wider text-primary hover:text-primary/80 transition-colors"
            >
              Open Proof
            </button>
          )}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <StatusBadge label={proofVM.badgeLabel} size="sm" />
              <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                {proofVM.statusLabel}
              </span>
            </div>

            <div className="console-inset p-3 rounded-sm space-y-2">
              <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                Public Proof State
              </p>
              <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                {proofVM.detail}
              </p>
            </div>

            <div className="console-inset p-3 rounded-sm space-y-2">
              <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                Latest Public Claim
              </p>
              {proofVM.latestClaim ? (
                <>
                  <div className="flex items-start gap-2">
                    <Milestone className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                    <p className="text-[11px] font-mono text-foreground leading-relaxed">{proofVM.latestClaim}</p>
                  </div>
                  <p className="text-[9px] font-mono text-muted-foreground">
                    {proofVM.latestScope ?? "public-proof"} · {proofVM.latestTimestamp
                      ? formatDistanceToNow(new Date(proofVM.latestTimestamp), { addSuffix: true })
                      : "no timestamp"}
                  </p>
                </>
              ) : (
                <p className="text-[10px] font-mono text-muted-foreground">
                  No public milestone has been emitted yet.
                </p>
              )}
            </div>

            <div className="console-inset p-3 rounded-sm">
              <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                Public proof is intentionally separate from private operator certainty. It proves publishable evidence,
                not every internal runtime state transition.
              </p>
            </div>
          </div>
        </SummaryCard>
      </div>
    </div>
  );
}

function RecentActivitySection({
  tasks,
  onOpenRuns,
}: {
  tasks: RecentTask[];
  onOpenRuns: () => void;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [slideKey, setSlideKey] = useState(0);
  const [slideDir, setSlideDir] = useState<"down" | "up">("down");

  const totalPages = Math.max(1, Math.ceil(tasks.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const paged = tasks.slice((page - 1) * pageSize, page * pageSize);

  const handlePageChange = (newPage: number) => {
    setSlideDir(newPage > currentPage ? "down" : "up");
    setCurrentPage(newPage);
    setSlideKey((current) => current + 1);
  };

  const handlePageSizeChange = (size: number) => {
    setSlideDir("down");
    setPageSize(size);
    setCurrentPage(1);
    setSlideKey((current) => current + 1);
  };

  const listHeight = 5 * 52;

  return (
    <SummaryCard
      title="Recent Activity"
      icon={<Clock className="w-4 h-4" />}
      headerAction={(
        <button
          type="button"
          onClick={onOpenRuns}
          className="text-[9px] font-mono uppercase tracking-wider text-primary hover:text-primary/80 transition-colors"
        >
          Open Runs
        </button>
      )}
    >
      {tasks.length === 0 ? (
        <div className="console-inset p-4 rounded-sm">
          <p className="text-[10px] font-mono text-muted-foreground">
            No recent governed runs are visible yet. The next task execution will appear here with status and timestamps.
          </p>
        </div>
      ) : (
        <>
          <div style={{ height: listHeight, position: "relative", overflow: "hidden" }}>
            <ScrollArea className="h-full">
              <div
                key={slideKey}
                className={slideDir === "down" ? "animate-activity-slide-down" : "animate-activity-slide-up"}
              >
                <div className="space-y-2 pr-2">
                  {paged.map((task, index) => (
                    <ActivityModuleRow key={task.id || task.taskId || index} task={task} />
                  ))}
                </div>
              </div>
            </ScrollArea>
          </div>

          <div className="mt-3">
            <ActivityPagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              pageSize={pageSize}
              onPageSizeChange={handlePageSizeChange}
            />
          </div>
        </>
      )}
    </SummaryCard>
  );
}
