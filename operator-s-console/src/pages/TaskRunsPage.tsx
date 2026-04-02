import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTaskCatalog, useTaskRuns } from "@/hooks/use-console-api";
import { SummaryCard } from "@/components/console/SummaryCard";
import { StatusBadge } from "@/components/console/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { History, Eye, ArrowLeft, ChevronLeft, ChevronRight, Clock, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { num, str, toArray } from "@/lib/safe-render";
import { buildRunMetrics, buildRunRows } from "@/lib/task-runs";

const PAGE_SIZE = 20;

export default function TaskRunsPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showInternal, setShowInternal] = useState(false);
  const [page, setPage] = useState(0);
  const { data: catalog } = useTaskCatalog();

  const { data, isLoading, isError, error } = useTaskRuns({
    type: typeFilter === "all" ? undefined : typeFilter,
    status: statusFilter === "all" ? undefined : statusFilter,
    includeInternal: showInternal,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const vm = useMemo(() => buildRunRows(data), [data]);
  const metrics = useMemo(() => buildRunMetrics(vm.runs), [vm.runs]);
  const availableTypes = useMemo(
    () =>
      Array.from(
        new Set(
          toArray(catalog?.tasks)
            .map((task: any) => str(task?.type, ""))
            .filter(Boolean),
        ),
      ),
    [catalog],
  );
  const ledgerSummary = useMemo(() => {
    const approvalWaitingCount = vm.runs.filter((run) => run.workflow.awaitingApproval || run.approval.status === "pending").length;
    const budgetConcernCount = vm.runs.filter((run) => {
      const status = str(run.budget?.status, "");
      return status === "at-risk" || status === "blocked" || status === "exhausted";
    }).length;
    const operatorGuidanceCount = vm.runs.filter((run) => run.operatorPreview !== null).length;
    const needsReviewCount = vm.runs.filter((run) => {
      const status = str(run.operatorPreview?.status, "");
      return (
        status === "watching" ||
        status === "blocked" ||
        status === "escalate" ||
        status === "refused" ||
        run.operatorPreview?.reviewRecommended === true
      );
    }).length;
    const freshnessWarningCount = vm.runs.filter(
      (run) => (run.operatorPreview?.knowledgeWarnings.length ?? 0) > 0,
    ).length;
    const nextActionCount = vm.runs.filter(
      (run) => (run.operatorPreview?.recommendedNextActions.length ?? 0) > 0,
    ).length;
    const localRunCount = vm.runs.filter((run) => run.accounting?.metered !== true).length;
    const meteredProviders = Array.from(
      new Set(
        vm.runs
          .map((run) => str(run.accounting?.provider, ""))
          .filter(Boolean),
      ),
    );
    const averageLatency = vm.runs.filter((run) => run.latency !== null);
    const avgLatencyMs =
      averageLatency.length > 0
        ? Math.round(averageLatency.reduce((sum, run) => sum + (run.latency ?? 0), 0) / averageLatency.length)
        : null;
    const statusCounts = vm.runs.reduce<Record<string, number>>((acc, run) => {
      const key = run.status || "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    return {
      approvalWaitingCount,
      budgetConcernCount,
      operatorGuidanceCount,
      needsReviewCount,
      freshnessWarningCount,
      nextActionCount,
      localRunCount,
      meteredProviders,
      avgLatencyMs,
      statusCounts,
      totalPromptTokens: vm.runs.reduce((sum, run) => sum + num(run.usage?.promptTokens), 0),
      totalCompletionTokens: vm.runs.reduce((sum, run) => sum + num(run.usage?.completionTokens), 0),
      budgetStates: vm.runs.reduce<Record<string, number>>((acc, run) => {
        const key = str(run.budget?.status, "");
        if (!key) return acc;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    };
  }, [vm.runs]);
  const totalPages = Math.max(1, Math.ceil(vm.total / PAGE_SIZE));

  if (isLoading && vm.runs.length === 0) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/tasks")} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="page-title">Execution Ledger</h2>
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="console-panel h-14 animate-pulse" style={{ opacity: 0.3 }} />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/tasks")} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="page-title">Execution Ledger</h2>
        </div>
        <div className="warning-banner">
          <AlertTriangle className="w-4 h-4 text-status-error shrink-0" />
          <div>
            <p className="text-[11px] font-mono font-semibold text-status-error uppercase tracking-wider">Failed to load task runs</p>
            <p className="text-xs text-muted-foreground mt-1">{(error as Error)?.message || "Unknown error"}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/tasks")} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="page-title">Execution Ledger</h2>
      </div>

      <div className="console-inset p-3">
        <p className="text-[11px] text-muted-foreground font-mono tracking-wide">
          <History className="w-3 h-3 inline mr-1.5 text-primary" />
          What actually happened. This ledger owns run truth, latency, metered spend, and budget posture for operator-safe work. Internal maintenance runs stay hidden unless you explicitly open diagnostics mode.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <div className="console-inset p-3 rounded-sm text-center">
          <p className="metric-value text-2xl">{vm.total}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Visible Total</p>
        </div>
        <div className="console-inset p-3 rounded-sm text-center">
          <p className="metric-value text-2xl">{metrics.activeCount}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Active</p>
        </div>
        <div className="console-inset p-3 rounded-sm text-center">
          <p className="metric-value text-2xl">{metrics.failedCount}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Failed</p>
        </div>
        <div className="console-inset p-3 rounded-sm text-center">
          <p className="metric-value text-2xl">{metrics.repairCount}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Repair Tagged</p>
        </div>
        <div className="console-inset p-3 rounded-sm text-center">
          <p className="metric-value text-2xl">${metrics.totalCost.toFixed(4)}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">
            Metered Spend · {metrics.meteredCount}
          </p>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Type:</span>
          <Select
            value={typeFilter}
            onValueChange={(value) => {
              setTypeFilter(value);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-[180px] h-8 text-xs font-mono bg-panel-inset border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All task types</SelectItem>
              {availableTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Status:</span>
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-[140px] h-8 text-xs font-mono bg-panel-inset border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="retrying">Retrying</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant={showInternal ? "default" : "outline"}
          size="sm"
          className="h-8 text-[10px] font-mono uppercase tracking-wider"
          onClick={() => {
            setShowInternal((current) => !current);
            setPage(0);
          }}
        >
          {showInternal ? "Hide Internal Maintenance" : "Show Internal Maintenance"}
        </Button>
      </div>

      <div className="grid xl:grid-cols-[1.05fr_0.95fr] gap-3">
        <SummaryCard title="Cost + Budget Summary" icon={<History className="w-4 h-4" />}>
          <div className="grid grid-cols-2 gap-2">
            <div className="console-inset p-3 rounded-sm">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-[0.12em]">Metered Spend</p>
              <p className="metric-value text-2xl mt-2">${metrics.totalCost.toFixed(4)}</p>
              <p className="text-[10px] font-mono text-muted-foreground mt-2">
                {metrics.meteredCount} metered run{metrics.meteredCount === 1 ? "" : "s"} · {ledgerSummary.localRunCount} unmetered local run{ledgerSummary.localRunCount === 1 ? "" : "s"}
              </p>
            </div>
            <div className="console-inset p-3 rounded-sm">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-[0.12em]">Budget Posture</p>
              <p className="metric-value text-2xl mt-2">{ledgerSummary.budgetConcernCount}</p>
              <p className="text-[10px] font-mono text-muted-foreground mt-2">
                {Object.keys(ledgerSummary.budgetStates).length > 0
                  ? Object.entries(ledgerSummary.budgetStates)
                      .map(([status, count]) => `${count} ${status}`)
                      .join(" · ")
                  : "No budget state emitted on visible runs."}
              </p>
            </div>
            <div className="console-inset p-3 rounded-sm">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-[0.12em]">Latency + Usage</p>
              <p className="text-[11px] font-mono text-foreground mt-2 leading-relaxed">
                {ledgerSummary.avgLatencyMs !== null ? `${ledgerSummary.avgLatencyMs}ms average visible latency.` : "No latency recorded on visible runs."}
              </p>
              <p className="text-[10px] font-mono text-muted-foreground mt-2">
                {ledgerSummary.totalPromptTokens + ledgerSummary.totalCompletionTokens > 0
                  ? `${ledgerSummary.totalPromptTokens} prompt · ${ledgerSummary.totalCompletionTokens} completion tokens`
                  : "No token accounting on visible runs."}
              </p>
            </div>
            <div className="console-inset p-3 rounded-sm">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-[0.12em]">Provider Mix</p>
              <p className="text-[11px] font-mono text-foreground mt-2 leading-relaxed">
                {ledgerSummary.meteredProviders.length > 0
                  ? ledgerSummary.meteredProviders.join(" · ")
                  : "No metered provider traffic in the visible slice."}
              </p>
              <p className="text-[10px] font-mono text-muted-foreground mt-2">
                Use run detail to confirm per-run provider, model, and pricing source.
              </p>
            </div>
          </div>
        </SummaryCard>

        <SummaryCard title="Status Breakdown" icon={<Clock className="w-4 h-4" />}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="console-inset p-3 rounded-sm text-center">
                <p className="metric-value text-2xl">{ledgerSummary.approvalWaitingCount}</p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Waiting For Approval</p>
              </div>
              <div className="console-inset p-3 rounded-sm text-center">
                <p className="metric-value text-2xl">{metrics.retriedCount}</p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Retried Runs</p>
              </div>
            </div>
            <div className="console-inset p-3 rounded-sm">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-[0.12em]">Operator Guidance</p>
              <p className="text-[11px] font-mono text-foreground mt-2 leading-relaxed">
                {ledgerSummary.operatorGuidanceCount > 0
                  ? `${ledgerSummary.operatorGuidanceCount} visible run${ledgerSummary.operatorGuidanceCount === 1 ? " carries" : "s carry"} adapted operator guidance.`
                  : "No visible run is carrying adapted operator guidance in the current filter."}
              </p>
              <p className="text-[10px] font-mono text-muted-foreground mt-2 leading-relaxed">
                {ledgerSummary.operatorGuidanceCount > 0
                  ? `${ledgerSummary.needsReviewCount} need review or escalation · ${ledgerSummary.freshnessWarningCount} carry freshness warnings · ${ledgerSummary.nextActionCount} expose explicit next actions.`
                  : "Open a run detail once a specialist lane emits summary, next actions, or freshness posture."}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(ledgerSummary.statusCounts).length > 0 ? (
                Object.entries(ledgerSummary.statusCounts).map(([status, count]) => (
                  <span
                    key={status}
                    className="activity-cell px-3 py-1.5 text-[9px] font-mono uppercase tracking-wide text-muted-foreground"
                  >
                    {count} {status}
                  </span>
                ))
              ) : (
                <span className="text-[10px] font-mono text-muted-foreground">No visible runs in the current filter.</span>
              )}
            </div>
            <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
              Filter this ledger by task type and status, then open a run for workflow graph, repair posture, approval history, proof links, and accounting detail.
            </p>
          </div>
        </SummaryCard>
      </div>

      <SummaryCard title="Run Ledger" icon={<History className="w-4 h-4" />} variant="inset">
        <div className="space-y-1">
          {vm.runs.map((run) => (
            <div
              key={run.runId}
              className="activity-module-row cursor-pointer hover:bg-panel-highlight/30 transition-colors"
              onClick={() => navigate(`/task-runs/${encodeURIComponent(run.runId)}`)}
            >
              <div className="flex items-center gap-1.5 p-1.5 relative z-10 flex-wrap">
                <div className="activity-cell flex items-center gap-2 px-3 py-2 min-w-[120px]">
                  <span className="font-mono text-[11px] font-bold text-foreground uppercase tracking-wide truncate">
                    {run.type}
                  </span>
                </div>
                <div className="activity-cell px-2.5 py-2 flex items-center">
                  <StatusBadge label={run.status} size="sm" />
                </div>
                {run.workflow.stage && (
                  <div className="activity-cell px-2.5 py-2 hidden md:flex items-center">
                    <StatusBadge label={run.workflow.stage} size="sm" />
                  </div>
                )}
                {run.workflow.graphStatus && (
                  <div className="activity-cell px-2.5 py-2 hidden md:flex items-center">
                    <StatusBadge label={run.workflow.graphStatus} size="sm" />
                  </div>
                )}
                {run.workflow.stopClassification && (
                  <div className="activity-cell px-2.5 py-2 hidden lg:flex items-center">
                    <StatusBadge label={run.workflow.stopClassification} size="sm" />
                  </div>
                )}
                <div className="activity-cell px-3 py-2 hidden sm:flex items-center">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
                    Attempt {Math.max(1, run.attempt)}
                    {run.maxRetries > 0 ? `/${run.maxRetries + 1}` : ""}
                  </span>
                </div>
                {(run.lastHandledAt || run.createdAt || run.startedAt) && (
                  <div className="activity-cell px-3 py-2 hidden sm:flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="text-foreground font-mono text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">
                      {(() => {
                        const ts = run.lastHandledAt || run.createdAt || run.startedAt;
                        try {
                          return formatDistanceToNow(new Date(ts!), { addSuffix: true });
                        } catch {
                          return ts;
                        }
                      })()}
                    </span>
                  </div>
                )}
                {run.repair && (
                  <div className="activity-cell px-2.5 py-2 hidden lg:flex items-center">
                    <StatusBadge label={str(run.repair.status, "warning")} size="sm" />
                  </div>
                )}
                {run.approval.required && (
                  <div className="activity-cell px-3 py-2 hidden lg:flex items-center">
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
                      Approval {run.approval.status ?? "required"}
                    </span>
                  </div>
                )}
                <div className="activity-cell px-3 py-2 hidden lg:flex items-center">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
                    {run.model ? `${run.model} · $${run.cost.toFixed(4)}` : run.accounting?.metered === true ? `$${run.cost.toFixed(4)} metered` : "local / unmetered"}
                  </span>
                </div>
                {run.latency !== null && (
                  <div className="activity-cell px-3 py-2 hidden xl:flex items-center">
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
                      {Math.round(run.latency)}ms
                    </span>
                  </div>
                )}
                {run.workflow.blockedStage && (
                  <div className="activity-cell px-3 py-2 hidden xl:flex items-center">
                    <span className="text-[10px] font-mono text-status-warning uppercase tracking-wide">
                      Blocked {run.workflow.blockedStage}
                    </span>
                  </div>
                )}
                {run.workflow.nextRetryAt && (
                  <div className="activity-cell px-3 py-2 hidden xl:flex items-center">
                    <span className="text-[10px] font-mono text-status-warning uppercase tracking-wide">
                      Retry queued
                    </span>
                  </div>
                )}
                {(run.workflow.nodeCount > 0 || run.workflow.edgeCount > 0) && (
                  <div className="activity-cell px-3 py-2 hidden xl:flex items-center">
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
                      {run.workflow.nodeCount} nodes · {run.workflow.edgeCount} edges
                    </span>
                  </div>
                )}
                {Object.keys(run.workflow.timingBreakdown).length > 0 && (
                  <div className="activity-cell px-3 py-2 hidden xl:flex items-center">
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
                      {Object.keys(run.workflow.timingBreakdown).length} timed stage
                      {Object.keys(run.workflow.timingBreakdown).length === 1 ? "" : "s"}
                    </span>
                  </div>
                )}
                {(run.workflow.eventCount > 0 || run.history.length > 0) && (
                  <div className="activity-cell px-3 py-2 hidden xl:flex items-center">
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">
                      {run.workflow.eventCount || run.history.length} workflow event
                      {(run.workflow.eventCount || run.history.length) !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}
                {run.error && (
                  <div className="activity-cell px-3 py-2 hidden md:flex items-center flex-1">
                    <AlertTriangle className="w-3 h-3 text-status-error shrink-0 mr-1.5" />
                    <span className="text-[10px] text-status-error font-mono truncate">{run.error}</span>
                  </div>
                )}
                {!run.error && run.workflow.stopReason && (
                  <div className="activity-cell px-3 py-2 hidden md:flex items-center flex-1">
                    <AlertTriangle className="w-3 h-3 text-status-warning shrink-0 mr-1.5" />
                    <span className="text-[10px] text-status-warning font-mono truncate">{run.workflow.stopReason}</span>
                  </div>
                )}
                <div className="activity-cell px-2.5 py-2 flex items-center">
                  <Eye className="w-3 h-3 text-muted-foreground" />
                </div>
              </div>
              {run.operatorPreview && (
                <div className="px-3 pb-3 pt-1 relative z-10">
                  <div className="console-inset p-3 rounded-sm space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-[0.12em]">
                        Operator Guidance
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge label={run.operatorPreview.status} size="sm" />
                        <StatusBadge label={run.operatorPreview.workflowStage} size="sm" />
                        {run.operatorPreview.knowledgeFreshnessStatus && (
                          <StatusBadge label={run.operatorPreview.knowledgeFreshnessStatus} size="sm" />
                        )}
                      </div>
                    </div>
                    <p className="text-[10px] font-mono text-foreground leading-relaxed">
                      {run.operatorPreview.operatorSummary || "No operator summary recorded for this run."}
                    </p>
                    {run.operatorPreview.recommendedNextActions.length > 0 && (
                      <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                        Next: {run.operatorPreview.recommendedNextActions[0]}
                      </p>
                    )}
                    {run.operatorPreview.knowledgeWarnings.length > 0 && (
                      <p className="text-[10px] font-mono text-status-warning leading-relaxed">
                        Freshness: {run.operatorPreview.knowledgeWarnings[0]}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          {vm.runs.length === 0 && (
            <div className="console-inset p-6 text-center">
              <p className="text-sm text-muted-foreground font-mono">No task runs found for this filter set.</p>
            </div>
          )}
        </div>
      </SummaryCard>

      {vm.total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-muted-foreground">
            Page {page + 1} of {totalPages} · {vm.total} total
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((current) => current - 1)}
              className="font-mono text-[10px]"
            >
              <ChevronLeft className="w-3 h-3 mr-1" /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!vm.hasMore}
              onClick={() => setPage((current) => current + 1)}
              className="font-mono text-[10px]"
            >
              Next <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
