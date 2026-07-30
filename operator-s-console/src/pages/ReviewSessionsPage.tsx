import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowLeft, Download, Link2, NotebookText, Play, Square } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  useReviewSessionBucket,
  useReviewSessionDetail,
  useReviewSessionExport,
  useReviewSessionLinkRun,
  useReviewSessionNote,
  useReviewSessionStop,
  useReviewSessions,
} from "@/hooks/use-console-api";
import { SummaryCard } from "@/components/console/SummaryCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import type {
  ReviewSessionBucket,
  ReviewSessionCumulativeWorkloadSummary,
  ReviewSessionRecord,
  ReviewSessionWorkloadSummary,
  ReviewTelemetrySample,
} from "@/types/console";

const BUCKET_OPTIONS: Array<{ value: ReviewSessionBucket; label: string; description: string }> = [
  {
    value: "baseline_idle",
    label: "Baseline Idle",
    description: "Machine before OpenClaw stack startup.",
  },
  {
    value: "startup_cost",
    label: "Startup Cost",
    description: "Boot and handoff cost while the stack comes alive.",
  },
  {
    value: "steady_state_running_cost",
    label: "Steady State",
    description: "Normal running cost after startup stabilizes.",
  },
  {
    value: "burst_workload",
    label: "Burst Workload",
    description: "Short, intentional load spikes and queue pressure.",
  },
  {
    value: "user_experience_evidence",
    label: "User Experience",
    description: "Operator-facing responsiveness and qualitative evidence.",
  },
];

function formatBucket(bucket: ReviewSessionBucket) {
  return BUCKET_OPTIONS.find((option) => option.value === bucket)?.label ?? bucket;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDurationSeconds(value: number | null | undefined) {
  if (typeof value !== "number" || value <= 0) return "0s";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatMb(value: number | null | undefined) {
  if (typeof value !== "number") return "n/a";
  return `${value.toFixed(1)} MB`;
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number") return "n/a";
  return `${value.toFixed(2)}%`;
}

function formatDurationHours(value: number | null | undefined) {
  if (typeof value !== "number" || value <= 0) return "n/a";
  if (value < 24) return `${value}h`;
  const days = Math.floor(value / 24);
  const hours = value % 24;
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

function formatSamplingInterval(value: number | null | undefined) {
  if (typeof value !== "number" || value <= 0) return "n/a";
  if (value < 1000) return `${value}ms`;
  if (value < 60000) return `${Math.round(value / 1000)}s`;
  return `${Math.round(value / 60000)}m`;
}

function formatCapturePlanTarget(targetTaskCount: number | null | undefined) {
  if (targetTaskCount === null) {
    return "capacity discovery";
  }
  if (typeof targetTaskCount !== "number" || targetTaskCount <= 0) {
    return "n/a";
  }
  return `${targetTaskCount.toLocaleString()} tasks`;
}

type DisplayedCumulativeWorkloadSummary = ReviewSessionCumulativeWorkloadSummary & {
  isLegacyFallback: boolean;
};

function resolveDisplayedCumulativeWorkloadSummary(
  workload: ReviewSessionWorkloadSummary | null | undefined,
): DisplayedCumulativeWorkloadSummary {
  const cumulative = workload?.cumulative;
  if (cumulative) {
    return {
      ...cumulative,
      isLegacyFallback: false,
    };
  }

  return {
    acceptedRuns: workload?.consideredRuns ?? 0,
    completedRuns: workload?.completedRuns ?? 0,
    successfulRuns: workload?.successfulRuns ?? 0,
    failedRuns: workload?.failedRuns ?? 0,
    retriedRuns: workload?.retryingRuns ?? 0,
    pendingRuns: workload?.pendingRuns ?? 0,
    totalCostUsd: workload?.totalCostUsd ?? 0,
    averageLatencyMs: workload?.averageLatencyMs ?? null,
    peakLatencyMs: null,
    lastAcceptedAt: workload?.windowEndedAt ?? null,
    lastCompletedAt: workload && workload.completedRuns > 0 ? workload.windowEndedAt : null,
    topTaskTypes: Array.isArray(workload?.topTaskTypes) ? workload.topTaskTypes : [],
    isLegacyFallback: Boolean(workload),
  };
}

function downloadPayload(filename: string, content: string, contentType: string) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function latestSample(samples: ReviewTelemetrySample[]) {
  return samples.length > 0 ? samples[samples.length - 1] : null;
}

type GuidanceTone = "good" | "warn" | "todo";

type GuidanceItem = {
  title: string;
  detail: string;
  tone: GuidanceTone;
};

function toneClasses(tone: GuidanceTone) {
  switch (tone) {
    case "good":
      return "text-status-ok";
    case "warn":
      return "text-status-error";
    default:
      return "text-status-warning";
  }
}

function buildReviewChecks(
  session: ReviewSessionRecord | null,
  samples: ReviewTelemetrySample[],
  noteCount: number,
): GuidanceItem[] {
  if (!session) {
    return [] as GuidanceItem[];
  }

  const steadyStateSamples = session.summary?.bucketStats?.steady_state_running_cost?.sampleCount ?? 0;
  const consideredRuns = session.summary?.workload.consideredRuns ?? 0;
  const evidenceRecorded = noteCount > 0 || session.linkedRunIds.length > 0;
  const isCapacitySoak = session.capturePlan.profile === "soak-24h" && session.capturePlan.targetTaskCount === null;

  return [
    {
      title: "Profile is correct",
      detail:
        session.capturePlan.profile === "soak-24h"
          ? isCapacitySoak
            ? "This session is running in the 24-hour max-capacity soak profile."
            : "This session is running in the 24-hour representative soak profile."
          : "This session is not using the soak profile, so it will not match the day-long endurance plan.",
      tone: session.capturePlan.profile === "soak-24h" ? "good" : "warn",
    },
    {
      title: "Bootstrap handoff completed",
      detail: session.handoffReceivedAt
        ? `Baseline and startup handoff finished at ${formatDate(session.handoffReceivedAt)}.`
        : "The session has not completed handoff yet, so you are still waiting on startup ownership.",
      tone: session.handoffReceivedAt ? "good" : session.state === "handoff_failed" ? "warn" : "todo",
    },
    {
      title: "Post-handoff sampling is live",
      detail:
        steadyStateSamples > 0
          ? `${steadyStateSamples} steady-state sample(s) already landed after handoff.`
          : "You only have bootstrap/baseline evidence so far. Let the runtime run longer after handoff.",
      tone: steadyStateSamples > 0 ? "good" : "todo",
    },
    {
      title: "Workload actually hit the session window",
      detail:
        consideredRuns > 0
          ? `${consideredRuns} task execution(s) are already inside the session window.`
          : isCapacitySoak
            ? "The max-capacity soak is active, but no task executions have landed in the review window yet. Start the continuous 24h:max feeder."
            : "The representative soak is active, but no task executions have landed in the review window yet. Start the paced 24h workload.",
      tone: consideredRuns > 0 ? "good" : "todo",
    },
    {
      title: "Human evidence is being captured",
      detail:
        evidenceRecorded
          ? `This session already has ${noteCount} note(s) and ${session.linkedRunIds.length} linked run(s).`
          : "Add notes when responsiveness changes, and link representative runs when spikes, failures, or latency matter.",
      tone: evidenceRecorded ? "good" : "todo",
    },
    {
      title: "Session is sealed for export",
      detail:
        session.state === "completed"
          ? "The session is closed, so Markdown and JSON exports are final."
          : "When the day-long run is over, press Stop to seal the summary before exporting.",
      tone: session.state === "completed" ? "good" : "todo",
    },
  ];
}

function getHandoffStatus(session: ReviewSessionRecord) {
  switch (session.state) {
    case "pending_handoff":
      return { label: "Pending", subtitle: "handoff pending", terminal: false };
    case "handoff_failed":
      return { label: "Failed", subtitle: "handoff failed", terminal: true };
    case "active":
      return { label: "Complete", subtitle: "handoff complete", terminal: false };
    case "completed":
      return { label: "Complete", subtitle: "handoff complete", terminal: true };
    default:
      return { label: "Unknown", subtitle: "handoff unknown", terminal: true };
  }
}

function sessionSubtitle(session: ReviewSessionRecord) {
  const baselineCaptured = session.baselineSummary ? "baseline captured" : "baseline missing";
  const handoff = getHandoffStatus(session);
  const profile = session.capturePlan?.profile === "soak-24h"
    ? session.capturePlan.targetTaskCount === null
      ? "24h max soak"
      : "24h soak"
    : "standard";
  return `${profile} · ${baselineCaptured} · ${handoff.subtitle}`;
}

export default function ReviewSessionsPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useReviewSessions();
  const sessions = data?.sessions ?? [];
  const activeSession = data?.activeSession ?? null;
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [nextBucket, setNextBucket] = useState<ReviewSessionBucket>("steady_state_running_cost");
  const [bucketNote, setBucketNote] = useState("");
  const [noteBucket, setNoteBucket] = useState<ReviewSessionBucket>("steady_state_running_cost");
  const [noteText, setNoteText] = useState("");
  const [runId, setRunId] = useState("");

  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }
    const preferredId = activeSession?.id ?? sessions[0]?.id ?? null;
    const stillExists = selectedSessionId ? sessions.some((session) => session.id === selectedSessionId) : false;
    if (!stillExists && preferredId) {
      setSelectedSessionId(preferredId);
    }
  }, [activeSession?.id, selectedSessionId, sessions]);

  const detailQuery = useReviewSessionDetail(selectedSessionId);
  const session = detailQuery.data?.session ?? null;
  const samples = detailQuery.data?.samples ?? [];
  const sample = latestSample(samples);
  const handoff = session ? getHandoffStatus(session) : null;
  const activeSessionIsSelected = Boolean(activeSession?.id && selectedSessionId === activeSession.id);
  const workloadSummary = session?.summary?.workload ?? null;
  const displayedCumulativeWorkload = useMemo(
    () => resolveDisplayedCumulativeWorkloadSummary(workloadSummary),
    [workloadSummary],
  );

  useEffect(() => {
    if (!session) return;
    setNextBucket(session.activeBucket);
    setNoteBucket(session.activeBucket);
  }, [session?.activeBucket, session?.id]);

  const bucketMutation = useReviewSessionBucket();
  const noteMutation = useReviewSessionNote();
  const linkRunMutation = useReviewSessionLinkRun();
  const stopMutation = useReviewSessionStop();
  const exportMutation = useReviewSessionExport();

  const bucketTimeline = useMemo(() => [...(session?.bucketTimeline ?? [])].sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt)), [session?.bucketTimeline]);
  const scenarioNotes = useMemo(() => [...(session?.scenarioNotes ?? [])].sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt)), [session?.scenarioNotes]);
  const recentSamples = useMemo(() => [...samples].slice(-6).reverse(), [samples]);
  const reviewChecks = useMemo(
    () => buildReviewChecks(session, samples, scenarioNotes.length),
    [samples, scenarioNotes.length, session],
  );

  async function handleBucketSwitch() {
    if (!session) return;
    try {
      await bucketMutation.mutateAsync({
        id: session.id,
        bucket: nextBucket,
        note: bucketNote.trim() || undefined,
      });
      setBucketNote("");
      toast({ title: "Bucket updated", description: `Active bucket is now ${formatBucket(nextBucket)}.` });
    } catch (mutationError) {
      toast({
        title: "Bucket update failed",
        description: mutationError instanceof Error ? mutationError.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function handleAddNote() {
    if (!session || noteText.trim().length === 0) return;
    try {
      await noteMutation.mutateAsync({ id: session.id, bucket: noteBucket, text: noteText.trim() });
      setNoteText("");
      toast({ title: "Note added", description: "Scenario evidence recorded." });
    } catch (mutationError) {
      toast({
        title: "Failed to add note",
        description: mutationError instanceof Error ? mutationError.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function handleLinkRun() {
    if (!session || runId.trim().length === 0) return;
    try {
      await linkRunMutation.mutateAsync({ id: session.id, runId: runId.trim() });
      setRunId("");
      toast({ title: "Run linked", description: "Execution evidence attached to this review session." });
    } catch (mutationError) {
      toast({
        title: "Failed to link run",
        description: mutationError instanceof Error ? mutationError.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function handleStop() {
    if (!session) return;
    try {
      await stopMutation.mutateAsync(session.id);
      toast({ title: "Session completed", description: "Review session is now closed." });
    } catch (mutationError) {
      toast({
        title: "Failed to stop session",
        description: mutationError instanceof Error ? mutationError.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function handleExport(format: "json" | "markdown") {
    if (!session) return;
    try {
      const payload = await exportMutation.mutateAsync({ id: session.id, format });
      if (format === "markdown") {
        downloadPayload(`${session.id}.md`, payload, "text/markdown;charset=utf-8");
      } else {
        downloadPayload(`${session.id}.json`, payload, "application/json;charset=utf-8");
      }
      toast({ title: "Export ready", description: `${format.toUpperCase()} export downloaded.` });
    } catch (mutationError) {
      toast({
        title: "Export failed",
        description: mutationError instanceof Error ? mutationError.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="page-title">Review Sessions</h2>
      </div>

      <div className="console-inset p-3">
        <p className="text-[11px] text-muted-foreground font-mono tracking-wide">
          <Activity className="w-3 h-3 inline mr-1.5 text-primary" />
          Honest review capture is bootstrap-led. Free port `3312`, then choose the lane that matches your question: `npm run review-session:run:24h` for a realistic representative soak, or `npm run review-session:run:24h:max` for a ceiling-seeking capacity soak. You can leave this page open first: the new active soak session will appear and auto-select after bootstrap handoff completes.
        </p>
      </div>

      <div className="grid xl:grid-cols-[1.15fr_0.85fr] gap-3">
        <SummaryCard title="How This Page Works" icon={<NotebookText className="w-4 h-4" />}>
          <div className="space-y-3 text-sm">
            <div className="console-inset p-3 rounded-sm">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Layer 1 · Session Ledger</p>
              <p className="text-xs text-muted-foreground mt-2">
                Pick the review session you want to inspect. If you opened this page before starting the run, that is fine: the new active `soak-24h` session will appear here and auto-select once bootstrap handoff completes.
              </p>
            </div>
            <div className="console-inset p-3 rounded-sm">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Layer 2 · Factual Capture</p>
              <p className="text-xs text-muted-foreground mt-2">
                `Capture Truth`, `Baseline Summary`, `Recent Samples`, and `Derived Summary` are the machine facts: baseline, handoff timing, queue pressure, incidents, latency, memory, and run counts.
              </p>
            </div>
            <div className="console-inset p-3 rounded-sm">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Layer 3 · Manual Evidence</p>
              <p className="text-xs text-muted-foreground mt-2">
                `Bucket Controls` and `Evidence Actions` are now mostly for extra human proof. Both automated soak lanes keep the session in the right bucket, link a representative run, and record progress notes for you.
              </p>
            </div>
            <div className="console-inset p-3 rounded-sm">
              <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Recommended Soak Workflow</p>
              <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                <p>1. Free port `3312`, then run `npm run review-session:run:24h` for realistic endurance or `npm run review-session:run:24h:max` for capacity discovery.</p>
                <p>2. If this page was already open, wait for the new `soak-24h` session to appear and auto-select after bootstrap handoff.</p>
                <p>3. Confirm `State + Profile` shows `active` and `Capture Truth` shows handoff complete.</p>
                <p>4. The representative lane spreads a fixed 5,000-task plan across the day. The max lane keeps topping up work against queue pressure so you can discover the machine's 24-hour ceiling.</p>
                <p>5. Add notes only for operator-visible behavior telemetry cannot know by itself, like lag, fan noise, or surprising responsiveness.</p>
                <p>6. When the review window is over, press `Stop`, then export Markdown and JSON for the post.</p>
              </div>
            </div>
          </div>
        </SummaryCard>

        <SummaryCard title="Know You Ran It Well" icon={<AlertTriangle className="w-4 h-4" />}>
          {!session ? (
            <p className="text-sm text-muted-foreground">Select a session to see the soak-run checklist.</p>
          ) : (
            <div className="space-y-2">
              {reviewChecks.map((item) => (
                <div key={item.title} className="console-inset p-3 rounded-sm">
                  <p className={`text-[10px] font-mono uppercase tracking-wider ${toneClasses(item.tone)}`}>{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-2">{item.detail}</p>
                </div>
              ))}
            </div>
          )}
        </SummaryCard>
      </div>

      {isError && (
        <div className="warning-banner">
          <AlertTriangle className="w-4 h-4 text-status-error shrink-0" />
          <div>
            <p className="text-[11px] font-mono font-semibold text-status-error uppercase tracking-wider">Failed to load review sessions</p>
            <p className="text-xs text-muted-foreground mt-1">{(error as Error)?.message || "Unknown error"}</p>
          </div>
        </div>
      )}

      <div className="grid xl:grid-cols-[0.8fr_1.2fr] gap-3">
        <SummaryCard title="Session Ledger" icon={<NotebookText className="w-4 h-4" />}>
          <div className="console-inset p-3 rounded-sm mb-3">
            {activeSession ? (
              activeSessionIsSelected ? (
                <p className="text-xs text-muted-foreground">
                  Active review session detected. This page is already following the current soak run.
                </p>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    A newer active review session is running. Jump to it if you want to watch the current automated soak run.
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setSelectedSessionId(activeSession.id)}>
                    Follow Active
                  </Button>
                </div>
              )
            ) : (
              <p className="text-xs text-muted-foreground">
                Nothing is active yet. You can open this page first, then start the one-command review run in your terminal. The new soak session will appear here automatically.
              </p>
            )}
          </div>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((item) => (
                <div key={item} className="console-inset h-16 animate-pulse" style={{ opacity: 0.3 }} />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-foreground">No review sessions recorded.</p>
              <p className="text-xs text-muted-foreground font-mono leading-relaxed">
                Start one with `npm run review-session:run:24h` for the realistic lane or `npm run review-session:run:24h:max` for the capacity lane. The page will auto-refresh and auto-select the new active soak session after bootstrap. Running only `npm run dev` boots the stack but skips the pre-stack baseline capture by design, and port `3312` must be free before bootstrap starts.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((item) => {
                const isSelected = item.id === selectedSessionId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedSessionId(item.id)}
                    className={`w-full text-left console-inset rounded-sm p-3 transition-colors ${isSelected ? "border border-primary/30 bg-primary/5" : "hover:bg-panel-highlight/20"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{item.title}</p>
                        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mt-1">{sessionSubtitle(item)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{item.state}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{formatDate(item.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </SummaryCard>

        <SummaryCard
          title="Session Detail"
          icon={<Play className="w-4 h-4" />}
          headerAction={
            session ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void handleExport("markdown")} disabled={exportMutation.isPending}>
                  <Download className="w-4 h-4" />
                  Markdown
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleExport("json")} disabled={exportMutation.isPending}>
                  <Download className="w-4 h-4" />
                  JSON
                </Button>
              </div>
            ) : null
          }
        >
          {!selectedSessionId ? (
            <p className="text-sm text-muted-foreground">Select a review session to inspect it.</p>
          ) : detailQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className="console-inset h-20 animate-pulse" style={{ opacity: 0.3 }} />
              ))}
            </div>
          ) : detailQuery.isError || !session ? (
            <div className="warning-banner">
              <AlertTriangle className="w-4 h-4 text-status-error shrink-0" />
              <div>
                <p className="text-[11px] font-mono font-semibold text-status-error uppercase tracking-wider">Failed to load review session detail</p>
                <p className="text-xs text-muted-foreground mt-1">{(detailQuery.error as Error)?.message || "Unknown error"}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-2">
                <div className="console-inset p-3 rounded-sm">
                  <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">State + Profile</p>
                  <p className="metric-value text-2xl mt-2">{session.state}</p>
                  <p className="text-[10px] font-mono text-muted-foreground mt-2">
                    {session.capturePlan.profile} · current bucket {formatBucket(session.activeBucket)}
                  </p>
                </div>
                <div className="console-inset p-3 rounded-sm">
                  <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Samples + Cadence</p>
                  <p className="metric-value text-2xl mt-2">{samples.length}</p>
                  <p className="text-[10px] font-mono text-muted-foreground mt-2">
                    Every {formatSamplingInterval(session.capturePlan.sampleIntervalMs)} · cap {session.capturePlan.maxSamples}
                  </p>
                </div>
                <div className="console-inset p-3 rounded-sm">
                  <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Cumulative Soak</p>
                  <p className="metric-value text-2xl mt-2">{displayedCumulativeWorkload.completedRuns}</p>
                  <p className="text-[10px] font-mono text-muted-foreground mt-2">
                    completed of {displayedCumulativeWorkload.acceptedRuns} accepted runs
                  </p>
                  <p className="text-[10px] font-mono text-muted-foreground mt-1">
                    failed {displayedCumulativeWorkload.failedRuns} · pending {displayedCumulativeWorkload.pendingRuns}
                  </p>
                  <p className="text-[10px] font-mono text-muted-foreground mt-1">
                    {displayedCumulativeWorkload.isLegacyFallback
                      ? "legacy session fallback: showing retained window totals until cumulative soak metrics are available"
                      : "cumulative soak totals from the full review session window"}
                  </p>
                </div>
                <div className="console-inset p-3 rounded-sm">
                  <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Pressure Peak</p>
                  <p className="metric-value text-2xl mt-2">{session.summary?.telemetry.queueDepthPeak ?? sample?.activity.queueDepth ?? 0}</p>
                  <p className="text-[10px] font-mono text-muted-foreground mt-2">
                    queue peak · incidents peak {session.summary?.telemetry.openIncidentsPeak ?? session.summary?.observedIncidentCount ?? sample?.activity.openIncidents ?? 0}
                  </p>
                </div>
              </div>

              <div className="grid xl:grid-cols-[1.05fr_0.95fr] gap-3">
                <SummaryCard title="Capture Truth" icon={<Activity className="w-4 h-4" />} variant="inset">
                  <div className="space-y-3 text-sm">
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="console-inset p-3 rounded-sm">
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Baseline</p>
                        <p className="text-sm text-foreground mt-2">
                          {session.baselineSummary ? "Captured before stack startup" : "Missing"}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-2">
                          {formatDate(session.baselineStartedAt)} to {formatDate(session.baselineEndedAt)}
                        </p>
                      </div>
                      <div className="console-inset p-3 rounded-sm">
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Startup Handoff</p>
                        <p className="text-sm text-foreground mt-2">
                          {handoff?.label ?? "Unknown"}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-2">
                          {session.handoffReceivedAt
                            ? `Received ${formatDate(session.handoffReceivedAt)}`
                            : `Startup began ${formatDate(session.startupStartedAt)}`}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-2">
                          Startup to handoff {formatDurationSeconds(session.summary?.startupHandoffSeconds ?? null)}
                        </p>
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="console-inset p-3 rounded-sm">
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Machine</p>
                        <p className="text-[11px] font-mono text-foreground mt-2 leading-relaxed">
                          {session.machine.hostname} · {session.machine.platform}/{session.machine.arch}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-2">
                          {session.machine.cpuModel} · {session.machine.cpuCores} cores · {session.machine.memoryTotalMb} MB
                        </p>
                      </div>
                      <div className="console-inset p-3 rounded-sm">
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Capture Plan</p>
                        <p className="text-[11px] font-mono text-foreground mt-2 leading-relaxed">
                          {session.capturePlan.profile} · every {formatSamplingInterval(session.capturePlan.sampleIntervalMs)}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-2">
                          retention {session.capturePlan.maxSamples} · target {formatCapturePlanTarget(session.capturePlan.targetTaskCount)} · plan {formatDurationHours(session.capturePlan.intendedDurationHours)}
                        </p>
                      </div>
                    </div>
                  </div>
                </SummaryCard>

                <SummaryCard title="Baseline Summary" icon={<NotebookText className="w-4 h-4" />} variant="inset">
                  {session.baselineSummary ? (
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="console-inset p-3 rounded-sm">
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">CPU</p>
                        <p className="text-sm text-foreground mt-2">Avg {formatPercent(session.baselineSummary.cpuPercentAvg)}</p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-2">Peak {formatPercent(session.baselineSummary.cpuPercentPeak)}</p>
                      </div>
                      <div className="console-inset p-3 rounded-sm">
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Memory</p>
                        <p className="text-sm text-foreground mt-2">Avg {formatMb(session.baselineSummary.memoryUsedMbAvg)}</p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-2">Peak {formatMb(session.baselineSummary.memoryUsedMbPeak)}</p>
                      </div>
                      <div className="console-inset p-3 rounded-sm sm:col-span-2">
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Load Average</p>
                        <p className="text-sm text-foreground mt-2">{session.baselineSummary.loadAvg1m.toFixed(2)}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No baseline summary is present for this session.</p>
                  )}
                </SummaryCard>
              </div>

              <div className="grid xl:grid-cols-[1fr_1fr] gap-3">
                <SummaryCard title="Bucket Controls" icon={<Activity className="w-4 h-4" />}>
                  <div className="space-y-3">
                    <div className="console-inset p-3 rounded-sm">
                      <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">What this is for</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Use bucket switches to label manual phases or unusual situations. The one-command review workload already flips to `Burst Workload` at the start of the push and back to `Steady State` when the run finishes.
                      </p>
                    </div>
                    <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end">
                      <div className="space-y-2">
                        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Switch bucket</p>
                        <Select value={nextBucket} onValueChange={(value) => setNextBucket(value as ReviewSessionBucket)}>
                          <SelectTrigger className="bg-panel-inset border-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {BUCKET_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[10px] text-muted-foreground">{BUCKET_OPTIONS.find((option) => option.value === nextBucket)?.description}</p>
                      </div>
                      <Button onClick={() => void handleBucketSwitch()} disabled={bucketMutation.isPending || session.state !== "active"}>
                        <Play className="w-4 h-4" />
                        Switch
                      </Button>
                    </div>
                    <Textarea
                      value={bucketNote}
                      onChange={(event) => setBucketNote(event.target.value)}
                      placeholder="Optional note for the bucket transition"
                      className="min-h-[88px]"
                    />
                    <div className="console-inset p-3 rounded-sm">
                      <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Timeline</p>
                      <div className="mt-3 space-y-2 max-h-[220px] overflow-auto pr-1">
                        {bucketTimeline.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No bucket transitions recorded yet.</p>
                        ) : (
                          bucketTimeline.map((entry, index) => (
                            <div key={`${entry.capturedAt}-${index}`} className="border border-border/50 rounded-sm p-2">
                              <p className="text-[11px] font-mono text-foreground uppercase tracking-wide">{formatBucket(entry.bucket)}</p>
                              <p className="text-[10px] text-muted-foreground mt-1">{formatDate(entry.capturedAt)}</p>
                              {entry.note ? <p className="text-xs text-muted-foreground mt-2">{entry.note}</p> : null}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </SummaryCard>

                <SummaryCard title="Evidence Actions" icon={<Link2 className="w-4 h-4" />}>
                  <div className="space-y-4">
                    <div className="console-inset p-3 rounded-sm">
                      <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">What belongs here</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Telemetry already captures CPU, memory, queue, incidents, and latency. The automated review workload also records its own linked run and summary note. Use these controls for extra proof telemetry cannot know by itself: what you felt, what changed, and any special run you want to highlight.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Add scenario note</p>
                      <Select value={noteBucket} onValueChange={(value) => setNoteBucket(value as ReviewSessionBucket)}>
                        <SelectTrigger className="bg-panel-inset border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BUCKET_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Textarea
                        value={noteText}
                        onChange={(event) => setNoteText(event.target.value)}
                        placeholder="Capture what the operator observed"
                        className="min-h-[110px]"
                      />
                      <Button onClick={() => void handleAddNote()} disabled={noteMutation.isPending || noteText.trim().length === 0}>
                        <NotebookText className="w-4 h-4" />
                        Add Note
                      </Button>
                      <p className="text-[10px] text-muted-foreground">
                        Good note examples: “operator page took 4-5s to react during queue spike” or “machine stayed responsive while 500 tasks were still queued”.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Link task run</p>
                      <div className="flex gap-2">
                        <Input value={runId} onChange={(event) => setRunId(event.target.value)} placeholder="run id or task id" />
                        <Button variant="outline" onClick={() => void handleLinkRun()} disabled={linkRunMutation.isPending || runId.trim().length === 0}>
                          <Link2 className="w-4 h-4" />
                          Link
                        </Button>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Use this when a run provides proof for burst behavior, latency, or operator experience.</p>
                    </div>
                    <div className="flex items-center justify-between gap-3 console-inset p-3 rounded-sm">
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Complete session</p>
                        <p className="text-xs text-muted-foreground mt-1">Stops sampling and seals the export state.</p>
                      </div>
                      <Button variant="destructive" onClick={() => void handleStop()} disabled={stopMutation.isPending || session.state !== "active"}>
                        <Square className="w-4 h-4" />
                        Stop
                      </Button>
                    </div>
                  </div>
                </SummaryCard>
              </div>

              <div className="grid xl:grid-cols-[1fr_1fr] gap-3">
                <SummaryCard title="Scenario Notes" icon={<NotebookText className="w-4 h-4" />} variant="inset">
                  <div className="space-y-2 max-h-[260px] overflow-auto pr-1">
                    {scenarioNotes.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No scenario notes recorded yet.</p>
                    ) : (
                      scenarioNotes.map((entry, index) => (
                        <div key={`${entry.capturedAt}-${index}`} className="console-inset p-3 rounded-sm">
                          <p className="text-[11px] font-mono text-foreground uppercase tracking-wide">{formatBucket(entry.bucket)}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">{formatDate(entry.capturedAt)}</p>
                          <p className="text-sm text-foreground mt-2 whitespace-pre-wrap">{entry.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                </SummaryCard>

                <SummaryCard title="Recent Samples" icon={<Activity className="w-4 h-4" />} variant="inset">
                  <div className="space-y-2 max-h-[260px] overflow-auto pr-1">
                    {recentSamples.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No telemetry samples captured yet.</p>
                    ) : (
                      recentSamples.map((entry, index) => (
                        <div key={`${entry.capturedAt}-${index}`} className="console-inset p-3 rounded-sm">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[11px] font-mono text-foreground uppercase tracking-wide">{formatBucket(entry.bucket)}</p>
                            <p className="text-[10px] text-muted-foreground">{formatDate(entry.capturedAt)}</p>
                          </div>
                          <p className="text-[10px] font-mono text-muted-foreground mt-2">
                            CPU {formatPercent(entry.host.cpuPercent)} · Load {entry.host.load1.toFixed(2)} · Queue {entry.activity.queueDepth} · Runs {entry.activity.activeRuns}
                          </p>
                          <p className="text-[10px] font-mono text-muted-foreground mt-1">
                            Memory {formatMb(entry.host.memoryUsedBytes / (1024 * 1024))} · Process RSS {formatMb(entry.process.rssBytes ? entry.process.rssBytes / (1024 * 1024) : null)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </SummaryCard>
              </div>

                <SummaryCard title="Derived Summary" icon={<NotebookText className="w-4 h-4" />} variant="inset">
                {session.summary ? (
                  <div className="space-y-3">
                    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
                      <div className="console-inset p-3 rounded-sm">
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Session Duration</p>
                        <p className="text-sm text-foreground mt-2">{formatDurationSeconds(session.summary.durationSeconds)}</p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-2">
                          {session.summary.telemetry.totalSampleCount} retained samples
                        </p>
                      </div>
                      <div className="console-inset p-3 rounded-sm">
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Run Outcomes</p>
                        <p className="text-sm text-foreground mt-2">
                          {displayedCumulativeWorkload.successfulRuns} ok / {displayedCumulativeWorkload.failedRuns} failed
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-2">
                          accepted {displayedCumulativeWorkload.acceptedRuns} · retrying {displayedCumulativeWorkload.retriedRuns} · pending {displayedCumulativeWorkload.pendingRuns}
                        </p>
                      </div>
                      <div className="console-inset p-3 rounded-sm">
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Latency</p>
                        <p className="text-sm text-foreground mt-2">
                          cumulative avg {displayedCumulativeWorkload.averageLatencyMs ?? "n/a"} ms
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-2">
                          cumulative peak {displayedCumulativeWorkload.peakLatencyMs ?? "n/a"} ms · window p95 {workloadSummary?.p95LatencyMs ?? "n/a"} ms
                        </p>
                      </div>
                      <div className="console-inset p-3 rounded-sm">
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Resource Pressure</p>
                        <p className="text-sm text-foreground mt-2">
                          CPU peak {formatPercent(session.summary.telemetry.cpuPercentPeak)}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-2">
                          queue peak {session.summary.telemetry.queueDepthPeak ?? "n/a"} · RSS peak {formatMb(session.summary.telemetry.processRssMbPeak)}
                        </p>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {BUCKET_OPTIONS.map((option) => {
                        const stats = session.summary?.bucketStats?.[option.value];
                        return (
                          <div key={option.value} className="console-inset p-3 rounded-sm">
                            <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">{option.label}</p>
                            <p className="text-sm text-foreground mt-2">{formatDurationSeconds(stats?.durationSeconds ?? 0)}</p>
                            <p className="text-[10px] font-mono text-muted-foreground mt-2">
                              {stats?.sampleCount ?? 0} samples · avg {formatPercent(stats?.cpuPercentAvg)} · peak {formatPercent(stats?.cpuPercentPeak)}
                            </p>
                          </div>
                        );
                      })}
                    </div>

                    <div className="grid xl:grid-cols-[1fr_1fr] gap-3">
                      <div className="console-inset p-3 rounded-sm">
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Retained Window Slice</p>
                        <p className="text-[11px] font-mono text-foreground mt-2">
                          {formatDate(workloadSummary?.windowStartedAt)}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-2">
                          to {formatDate(workloadSummary?.windowEndedAt)}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground mt-2">
                          retained {workloadSummary?.consideredRuns ?? 0} runs · completed {workloadSummary?.completedRuns ?? 0} · total cost ${((workloadSummary?.totalCostUsd ?? 0)).toFixed(4)}
                        </p>
                      </div>
                      <div className="console-inset p-3 rounded-sm">
                        <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Cumulative Top Task Types</p>
                        <div className="mt-2 space-y-1">
                          {displayedCumulativeWorkload.topTaskTypes.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No accepted task mix has been recorded for this soak yet.</p>
                          ) : (
                            displayedCumulativeWorkload.topTaskTypes.map((item) => (
                              <p key={item.type} className="text-[11px] font-mono text-foreground">
                                {item.type} · {item.count}
                              </p>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Derived summary will appear after the orchestrator has enough session data to calculate it.</p>
                )}
              </SummaryCard>
            </div>
          )}
        </SummaryCard>
      </div>
    </div>
  );
}
