import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useIncidents, usePendingApprovals, useTaskRunDetail } from "@/hooks/use-console-api";
import { SummaryCard } from "@/components/console/SummaryCard";
import { TaskRunDetailContent } from "@/components/console/TaskRunDetailContent";
import { AlertTriangle, ArrowLeft, History } from "lucide-react";
import { buildRunDetail } from "@/lib/task-runs";
import { buildRunHandoffContext } from "@/lib/run-handoff";

export default function TaskRunDetailPage() {
  const navigate = useNavigate();
  const { runId } = useParams<{ runId: string }>();
  const decodedRunId = runId ? decodeURIComponent(runId) : null;

  const { data, isLoading, isError, error } = useTaskRunDetail(decodedRunId);
  const { data: approvalsData } = usePendingApprovals();
  const { data: incidentsData } = useIncidents({
    includeResolved: true,
    limit: 100,
  });
  const run = useMemo(() => buildRunDetail(data), [data]);
  const handoffContext = useMemo(
    () =>
      buildRunHandoffContext({
        run,
        runResult: data?.run?.result,
        pendingApprovals: approvalsData?.pending ?? [],
        incidents: incidentsData?.incidents ?? [],
      }),
    [approvalsData?.pending, data?.run?.result, incidentsData?.incidents, run],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/task-runs")} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="page-title">Run Detail</h2>
      </div>

      <div className="console-inset p-3">
        <p className="text-[11px] text-muted-foreground font-mono tracking-wide">
          <History className="w-3 h-3 inline mr-1.5 text-primary" />
          Dedicated replay surface for a single run. Built entirely from the existing run-detail contract.
        </p>
      </div>

      {isError && (
        <div className="warning-banner">
          <AlertTriangle className="w-4 h-4 text-status-error shrink-0" />
          <div>
            <p className="text-[11px] font-mono font-semibold text-status-error uppercase tracking-wider">Failed to load run detail</p>
            <p className="text-xs text-muted-foreground mt-1">{(error as Error)?.message || "Unknown error"}</p>
          </div>
        </div>
      )}

      <SummaryCard title="Replay Detail" icon={<History className="w-4 h-4" />}>
        <TaskRunDetailContent
          run={run}
          runResult={data?.run?.result}
          handoffContext={handoffContext}
          isLoading={isLoading}
        />
      </SummaryCard>
    </div>
  );
}
