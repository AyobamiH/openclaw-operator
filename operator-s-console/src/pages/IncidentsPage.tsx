import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useExtendedHealth,
  useIncidentAcknowledge,
  useIncidentDetail,
  useIncidentOwner,
  useIncidentRemediate,
  useIncidents,
} from "@/hooks/use-console-api";
import { cn } from "@/lib/utils";
import { SummaryCard } from "@/components/console/SummaryCard";
import { StatusBadge } from "@/components/console/StatusBadge";
import { GuidanceList, GuidancePanel } from "@/components/console/GuidancePanel";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, GitBranchPlus, Loader2, ShieldCheck, Wrench } from "lucide-react";
import { toArray } from "@/lib/safe-render";
import { buildIncidentDetail, buildIncidentRow, buildIncidentSummary } from "@/lib/incident-view";

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isUnowned(owner: string | null | undefined): boolean {
  return !owner || owner === "unowned";
}

function incidentPriorityScore(incident: ReturnType<typeof buildIncidentRow>): number {
  let score = 0;

  if (incident.severity === "critical") score += 320;
  else if (incident.severity === "warning") score += 200;
  else score += 90;

  if (incident.status === "active") score += 90;
  else if (incident.status === "watching") score += 35;

  if (isUnowned(incident.owner)) score += 70;
  if (!incident.acknowledgedAt && incident.status !== "resolved") score += 45;
  if (incident.verificationRequired && incident.verificationStatus !== "verified") score += 55;
  if (!incident.hasRemediationTask && incident.status !== "resolved") score += 35;
  if (incident.escalationStatus === "breached" || incident.escalationStatus === "escalated") score += 70;

  const dueAt = parseTimestamp(incident.escalationDueAt);
  if (dueAt && dueAt <= Date.now() && incident.status !== "resolved") {
    score += 35;
  }

  return score;
}

function buildIncidentAttentionReason(incident: ReturnType<typeof buildIncidentRow>): string {
  const reasons: string[] = [];

  if (incident.severity === "critical") reasons.push("critical severity");
  if (isUnowned(incident.owner)) reasons.push("unowned");
  if (!incident.acknowledgedAt && incident.status !== "resolved") reasons.push("ack pending");
  if (incident.verificationRequired && incident.verificationStatus !== "verified") {
    reasons.push(`verify ${incident.verificationStatus}`);
  }
  if (!incident.hasRemediationTask && incident.status !== "resolved") reasons.push("no remediation yet");
  if (incident.escalationStatus === "breached" || incident.escalationStatus === "escalated") {
    reasons.push(incident.escalationStatus);
  }

  if (reasons.length) {
    return reasons.join(" · ");
  }

  return `${incident.classification} lane`;
}

type IncidentDetailView = NonNullable<ReturnType<typeof buildIncidentDetail>>;

function getRelevantRemediationTask(incident: IncidentDetailView) {
  return [...incident.remediationTasks].sort((left, right) => {
    const leftUpdated =
      parseTimestamp(left.lastUpdatedAt) ??
      parseTimestamp(left.executionCompletedAt) ??
      parseTimestamp(left.executionStartedAt) ??
      parseTimestamp(left.createdAt) ??
      0;
    const rightUpdated =
      parseTimestamp(right.lastUpdatedAt) ??
      parseTimestamp(right.executionCompletedAt) ??
      parseTimestamp(right.executionStartedAt) ??
      parseTimestamp(right.createdAt) ??
      0;
    return rightUpdated - leftUpdated;
  })[0] ?? null;
}

function buildIncidentActionPlaybook(
  incident: IncidentDetailView,
  currentActor: string | null | undefined,
) {
  const currentTask = getRelevantRemediationTask(incident);
  const recommendedLane = incident.policy.remediationTaskType ?? "system-monitor";
  const items: string[] = [];

  if (!incident.acknowledgedAt) {
    items.push("Click Acknowledge first so the incident shows real operator attention before anything else changes.");
  } else {
    items.push(
      `Acknowledgement is already recorded by ${incident.acknowledgedBy ?? "operator"}, so Acknowledge is not the next click anymore.`,
    );
  }

  if (isUnowned(incident.owner)) {
    items.push("Click Assign Me only if you are explicitly taking manual ownership of this incident.");
  } else if (currentActor && incident.owner === currentActor) {
    items.push("Ownership is already yours, so Assign Me is not the next move here.");
  } else {
    items.push(
      `Owner is already ${incident.owner}. Leave ownership alone unless you intentionally want to take it over from ${incident.owner}.`,
    );
  }

  if (!currentTask) {
    items.push(
      `Leave remediation on Auto and click Create Remediation. Auto maps to ${recommendedLane} for this incident.`,
    );
  } else if (currentTask.status === "failed" || currentTask.blockers.length > 0) {
    const blockerPreview =
      currentTask.blockers[0] && currentTask.blockers[0].length > 0
        ? ` Current blocker: ${currentTask.blockers[0]}.`
        : "";
    items.push(
      `A remediation task already exists (${currentTask.taskType}, ${currentTask.status}). Review its blocker or run record before queuing another remediation.${blockerPreview}`,
    );
  } else {
    items.push(
      `A remediation task is already in flight (${currentTask.taskType}, ${currentTask.status}). Wait for that lane to settle before creating another one unless you are deliberately escalating.`,
    );
  }

  if (incident.classification === "repair" && recommendedLane === "qa-verification") {
    items.push(
      "Do not jump to build-refactor by default. For repair incidents like this one, qa-verification is the intended first lane and code surgery should wait for stronger code-level evidence.",
    );
  }

  if (incident.verification.required && incident.verification.status !== "verified") {
    items.push("Acknowledgement and ownership do not close this incident. Verification still has to pass before closure is credible.");
  }

  return {
    currentTask,
    recommendedLane,
    items,
    tone:
      incident.escalation.status === "breached" ||
      incident.escalation.status === "escalated" ||
      currentTask?.status === "failed"
        ? "warning"
        : "tip",
  } as const;
}

export default function IncidentsPage() {
  const { user, hasRole } = useAuth();
  const isOperator = hasRole("operator");
  const acknowledgeIncident = useIncidentAcknowledge();
  const assignIncidentOwner = useIncidentOwner();
  const remediateIncident = useIncidentRemediate();

  const [incidentFilter, setIncidentFilter] = useState("active");
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [remediationTaskType, setRemediationTaskType] = useState("auto");
  const [remediationNote, setRemediationNote] = useState("");

  const { data: extended, isError: extError } = useExtendedHealth();
  const { data: incidentsData, isLoading: incidentsLoading } = useIncidents({
    includeResolved: true,
    limit: 24,
  });

  const incidentSummary = useMemo(
    () => buildIncidentSummary(extended?.incidents),
    [extended?.incidents],
  );

  const allIncidents = useMemo(
    () =>
      toArray(incidentsData?.incidents)
        .map(buildIncidentRow)
        .sort((left, right) => {
          const scoreDelta = incidentPriorityScore(right) - incidentPriorityScore(left);
          if (scoreDelta !== 0) return scoreDelta;
          const leftLastSeen = parseTimestamp(left.lastSeenAt) ?? 0;
          const rightLastSeen = parseTimestamp(right.lastSeenAt) ?? 0;
          if (rightLastSeen !== leftLastSeen) return rightLastSeen - leftLastSeen;
          return left.title.localeCompare(right.title);
        }),
    [incidentsData?.incidents],
  );

  const incidentFocus = useMemo(() => {
    const openIncidents = allIncidents.filter((incident) => incident.status !== "resolved");
    const classificationCounts = new Map<string, number>();

    for (const incident of openIncidents) {
      classificationCounts.set(incident.classification, (classificationCounts.get(incident.classification) ?? 0) + 1);
    }

    const [topClassification = null, topClassificationCount = 0] =
      [...classificationCounts.entries()].sort((left, right) => right[1] - left[1])[0] ?? [];

    return {
      unownedCount: openIncidents.filter((incident) => isUnowned(incident.owner)).length,
      unacknowledgedCount: openIncidents.filter((incident) => !incident.acknowledgedAt).length,
      verificationCount: openIncidents.filter(
        (incident) => incident.verificationRequired && incident.verificationStatus !== "verified",
      ).length,
      noRemediationCount: openIncidents.filter((incident) => !incident.hasRemediationTask).length,
      topClassification,
      topClassificationCount,
      primaryIncident: openIncidents[0] ?? null,
    };
  }, [allIncidents]);

  const filteredIncidents = useMemo(() => {
    return allIncidents.filter((incident) => {
      if (incidentFilter === "all") return true;
      if (incidentFilter === "resolved") return incident.status === "resolved";
      if (incidentFilter === "watching") return incident.status === "watching";
      if (incidentFilter === "critical") return incident.severity === "critical" && incident.status !== "resolved";
      if (incidentFilter === "unowned") return incident.status !== "resolved" && isUnowned(incident.owner);
      if (incidentFilter === "needs-verification") {
        return incident.status !== "resolved" && incident.verificationRequired && incident.verificationStatus !== "verified";
      }
      return incident.status === "active";
    });
  }, [allIncidents, incidentFilter]);

  useEffect(() => {
    if (!filteredIncidents.length) {
      setSelectedIncidentId(null);
      return;
    }

    if (!selectedIncidentId || !filteredIncidents.some((incident) => incident.id === selectedIncidentId)) {
      setSelectedIncidentId(filteredIncidents[0].id);
    }
  }, [filteredIncidents, selectedIncidentId]);

  const { data: incidentDetailData, isLoading: incidentDetailLoading } = useIncidentDetail(selectedIncidentId);

  const selectedIncident = useMemo(
    () => buildIncidentDetail(incidentDetailData?.incident),
    [incidentDetailData?.incident],
  );

  const queueLabel = incidentsLoading || incidentDetailLoading
    ? "Refreshing incident feeds..."
    : `${filteredIncidents.length} incident record${filteredIncidents.length === 1 ? "" : "s"}`;

  const actionPlaybook = useMemo(
    () => (selectedIncident ? buildIncidentActionPlaybook(selectedIncident, user?.actor) : null),
    [selectedIncident, user?.actor],
  );

  const effectiveRemediationTaskType =
    remediationTaskType === "auto"
      ? selectedIncident?.policy.remediationTaskType ?? null
      : remediationTaskType;

  const remediationHint = useMemo(() => {
    if (!selectedIncident) return "Auto remediation uses the incident policy default lane.";
    const lanePrefix =
      remediationTaskType === "auto"
        ? `Auto remediation uses the incident policy lane: ${selectedIncident.policy.remediationTaskType ?? "no default lane recorded"}.`
        : `Manual override will queue ${remediationTaskType} for this incident instead of the policy default.`;

    if (effectiveRemediationTaskType === "build-refactor") {
      return `${lanePrefix} Build-refactor is approval-gated code surgery: it queues a bounded remediation lane that synthesizes or applies scoped patches, then still needs verification before the incident can close.`;
    }
    if (effectiveRemediationTaskType === "qa-verification") {
      return `${lanePrefix} QA verification checks whether the incident still reproduces and whether a prior remediation lane can credibly close.`;
    }
    if (effectiveRemediationTaskType === "system-monitor") {
      return `${lanePrefix} System monitor gathers fresh runtime evidence and is the safest first move when you need a new diagnosis before touching code.`;
    }
    if (effectiveRemediationTaskType === "drift-repair") {
      return `${lanePrefix} Drift repair is best when the incident is really a truth-pack or documentation/runtime alignment problem.`;
    }
    return lanePrefix;
  }, [effectiveRemediationTaskType, remediationTaskType, selectedIncident]);

  const remediationRecommendation = useMemo(() => {
    if (!selectedIncident || !actionPlaybook) {
      return "Recommended right now: wait for incident detail to load before choosing a remediation lane.";
    }

    if (!actionPlaybook.currentTask) {
      return `Recommended right now: keep the selector on Auto so it queues ${actionPlaybook.recommendedLane}.`;
    }

    if (
      actionPlaybook.currentTask.status === "failed" ||
      actionPlaybook.currentTask.blockers.length > 0
    ) {
      return `Recommended right now: review the existing ${actionPlaybook.currentTask.taskType} blocker before queuing another remediation lane.`;
    }

    return `Recommended right now: wait on the existing ${actionPlaybook.currentTask.taskType} remediation before creating another task.`;
  }, [actionPlaybook, selectedIncident]);

  const ownerButtonLabel = useMemo(() => {
    if (!selectedIncident) return "Assign Me";
    if (user?.actor && selectedIncident.owner === user.actor) return "Owned by Me";
    if (!isUnowned(selectedIncident.owner)) return "Take Ownership";
    return "Assign Me";
  }, [selectedIncident, user?.actor]);

  const hasRemediationTasks = Boolean(selectedIncident?.remediationTasks.length);
  const hasHistory = Boolean(selectedIncident?.history.length);
  const hasAcknowledgements = Boolean(selectedIncident?.acknowledgements.length);
  const hasOwnershipHistory = Boolean(selectedIncident?.ownershipHistory.length);

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h2 className="page-title">Incidents</h2>
        <div className="console-inset p-3 rounded-sm">
          <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">
            Persistent runtime incidents, ownership, remediation, and verification. This is the operator trouble queue,
            separate from technical dependency health.
          </p>
        </div>
      </div>

      {extError && (
        <div className="warning-banner">
          <AlertTriangle className="w-4 h-4 text-status-warning mt-0.5 shrink-0" />
          <div>
            <p className="text-[11px] font-mono font-semibold text-status-warning uppercase tracking-wider">
              Incident Posture Partially Available
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Extended health did not load, so the posture summary may lag behind the incident ledger below.
            </p>
          </div>
        </div>
      )}

      <SummaryCard title="Incident Posture" icon={<AlertTriangle className="w-4 h-4" />} variant="highlight">
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
            <div className="console-inset p-3 rounded-sm text-center">
              <p className="metric-value text-xl">{incidentSummary.openCount}</p>
              <p className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Open</p>
            </div>
            <div className="console-inset p-3 rounded-sm text-center">
              <p className="metric-value text-xl">{incidentSummary.activeCount}</p>
              <p className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Active</p>
            </div>
            <div className="console-inset p-3 rounded-sm text-center">
              <p className="metric-value text-xl">{incidentSummary.watchingCount}</p>
              <p className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Watching</p>
            </div>
            <div className="console-inset p-3 rounded-sm text-center">
              <p className="metric-value text-xl">{incidentSummary.critical}</p>
              <p className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Critical</p>
            </div>
            <div className="console-inset p-3 rounded-sm text-center">
              <p className="metric-value text-xl">{incidentSummary.warning}</p>
              <p className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Warning</p>
            </div>
            <div className="console-inset p-3 rounded-sm text-center">
              <p className="metric-value text-xl">{incidentSummary.info}</p>
              <p className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Info</p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="console-inset p-3 rounded-sm text-center">
              <p className="metric-value text-xl">{incidentFocus.unownedCount}</p>
              <p className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Unowned</p>
            </div>
            <div className="console-inset p-3 rounded-sm text-center">
              <p className="metric-value text-xl">{incidentFocus.unacknowledgedCount}</p>
              <p className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Ack Pending</p>
            </div>
            <div className="console-inset p-3 rounded-sm text-center">
              <p className="metric-value text-xl">{incidentFocus.verificationCount}</p>
              <p className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Needs Verification</p>
            </div>
            <div className="console-inset p-3 rounded-sm text-center">
              <p className="metric-value text-xl">{incidentFocus.noRemediationCount}</p>
              <p className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider mt-1">No Remediation</p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-2">
            <GuidancePanel title="What this page is for" eyebrow="Operator Hint" tone="tip">
              <p>Use Incidents when the system has already detected trouble and you need to decide who owns it, whether remediation should be queued, and what still blocks closure.</p>
            </GuidancePanel>
            <GuidancePanel title="What acknowledgement does" eyebrow="Action Consequence">
              <p>Acknowledge records operator attention. It does not resolve the incident or queue work by itself.</p>
            </GuidancePanel>
            <GuidancePanel title="What remediation does" eyebrow="Action Consequence">
              <p>Create Remediation queues a bounded task lane for this incident. Verification and runtime truth still decide whether the incident can close.</p>
            </GuidancePanel>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-2">
            <GuidancePanel title="Start with the first queue item" eyebrow="Operator Focus" tone="tip">
              <p>
                {incidentFocus.primaryIncident
                  ? `${incidentFocus.primaryIncident.title} is surfaced first because it carries ${buildIncidentAttentionReason(incidentFocus.primaryIncident)}.`
                  : "No open incident currently needs operator triage."}
              </p>
            </GuidancePanel>
            <GuidancePanel title="Ownership and acknowledgement" eyebrow="Attention">
              <p>
                {incidentFocus.unownedCount || incidentFocus.unacknowledgedCount
                  ? `${incidentFocus.unownedCount} open incident${incidentFocus.unownedCount === 1 ? "" : "s"} are unowned and ${incidentFocus.unacknowledgedCount} still need acknowledgement. Clear those first if you want the queue to read like real operator work instead of passive telemetry.`
                  : "Ownership and acknowledgement are currently keeping up with the open incident queue."}
              </p>
            </GuidancePanel>
            <GuidancePanel title="Dominant incident cluster" eyebrow="Pattern">
              <p>
                {incidentFocus.topClassification
                  ? `${incidentFocus.topClassification} appears ${incidentFocus.topClassificationCount} time${incidentFocus.topClassificationCount === 1 ? "" : "s"} in the open queue. Repeated classifications usually mean one runtime surface is creating most of the operational drag.`
                  : "No single classification currently dominates the incident queue."}
              </p>
            </GuidancePanel>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_auto] gap-3 items-center">
            <div className="console-inset p-3 rounded-sm flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Queue Honesty
                </p>
                <p className="mt-2 text-[11px] font-mono text-foreground leading-relaxed">
                  {incidentSummary.openCount === 0
                    ? "No active runtime incidents are currently exposed by the backend contract."
                    : `${incidentSummary.openCount} incident${incidentSummary.openCount === 1 ? "" : "s"} remain open. Acknowledgement records ownership, but remediation and verification still need to clear the underlying signal.`}
                </p>
              </div>
              <StatusBadge label={incidentSummary.overallStatus} size="md" />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Filter</span>
              <Select value={incidentFilter} onValueChange={setIncidentFilter}>
                <SelectTrigger className="h-8 w-[150px] text-[10px] font-mono bg-panel-inset border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="unowned">Unowned</SelectItem>
                  <SelectItem value="needs-verification">Needs Verification</SelectItem>
                  <SelectItem value="watching">Watching</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </SummaryCard>

      <SummaryCard title="Incident Command Deck" icon={<AlertTriangle className="w-4 h-4" />}>
        <div className="space-y-3">
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
            {queueLabel}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)] gap-3 items-start">
            <div className="console-inset p-3 rounded-sm xl:sticky xl:top-4">
              <p className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-muted-foreground mb-3">
                Incident Queue
              </p>
              <ScrollArea className="h-[520px] pr-2">
                <div className="space-y-2">
                  {filteredIncidents.map((incident) => (
                    <button
                      key={incident.id}
                      type="button"
                      onClick={() => setSelectedIncidentId(incident.id)}
                      className={`w-full console-inset p-3 rounded-sm text-left transition-colors ${
                        incident.id === selectedIncidentId ? "ring-1 ring-primary/40" : "hover:border-primary/20 hover:bg-panel-highlight/10"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-foreground">
                          {incident.title}
                        </p>
                        <div className="flex items-center gap-2">
                          <StatusBadge label={incident.severity} size="sm" />
                          <StatusBadge label={incident.remediationStatus} size="sm" />
                        </div>
                      </div>
                      <p className="mt-2 text-[10px] font-mono text-muted-foreground leading-relaxed">
                        {incident.summary}
                      </p>
                      <p className="mt-2 text-[9px] font-mono uppercase tracking-wider text-foreground/80">
                        {buildIncidentAttentionReason(incident)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                        <span>{incident.classification}</span>
                        <span>{incident.truthLayer} truth</span>
                        <span>{incident.owner ?? "unowned"}</span>
                        {!incident.acknowledgedAt && incident.status !== "resolved" && <span>ack pending</span>}
                        {incident.verificationRequired && <span>verify:{incident.verificationStatus}</span>}
                        {!incident.hasRemediationTask && incident.status !== "resolved" && <span>no remediation</span>}
                        <span>{incident.lastSeenAt ? new Date(incident.lastSeenAt).toLocaleString() : "no timestamp"}</span>
                      </div>
                    </button>
                  ))}
                  {filteredIncidents.length === 0 && (
                    <div className="console-inset p-4 rounded-sm">
                      <p className="text-[10px] font-mono text-muted-foreground">
                        No incidents match the current filter.
                      </p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="console-inset p-3 rounded-sm">
              {selectedIncident ? (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        Incident Detail
                      </p>
                      <p className="mt-1 text-sm font-mono font-semibold text-foreground">{selectedIncident.title}</p>
                      <p className="mt-2 text-[10px] font-mono text-muted-foreground leading-relaxed">
                        {selectedIncident.summary}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge label={selectedIncident.severity} size="sm" />
                      <StatusBadge label={selectedIncident.status} size="sm" />
                      <StatusBadge label={selectedIncident.remediationStatus} size="sm" />
                      <StatusBadge label={selectedIncident.truthLayer} size="sm" />
                    </div>
                  </div>

                  <GuidancePanel
                    title="Recommended operator action"
                    eyebrow="Do This Next"
                    tone={actionPlaybook?.tone ?? "tip"}
                  >
                    <p>{selectedIncident.nextAction}</p>
                    <p className="pt-1 text-[10px] font-mono text-muted-foreground">
                      Current triage reason: {buildIncidentAttentionReason(selectedIncident)}.
                    </p>
                    <GuidanceList items={actionPlaybook?.items ?? []} className="pt-1" />
                  </GuidancePanel>

                  <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
                    <div className="activity-cell px-3 py-2">
                      <p className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground">First Seen</p>
                      <p className="mt-1 text-[10px] font-mono text-foreground">
                        {selectedIncident.firstSeenAt ? new Date(selectedIncident.firstSeenAt).toLocaleString() : "—"}
                      </p>
                    </div>
                    <div className="activity-cell px-3 py-2">
                      <p className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground">Last Seen</p>
                      <p className="mt-1 text-[10px] font-mono text-foreground">
                        {selectedIncident.lastSeenAt ? new Date(selectedIncident.lastSeenAt).toLocaleString() : "—"}
                      </p>
                    </div>
                    <div className="activity-cell px-3 py-2">
                      <p className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground">Owner</p>
                      <p className="mt-1 text-[10px] font-mono text-foreground">
                        {selectedIncident.owner ?? "unowned"}
                      </p>
                    </div>
                    <div className="activity-cell px-3 py-2">
                      <p className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground">Ack</p>
                      <p className="mt-1 text-[10px] font-mono text-foreground">
                        {selectedIncident.acknowledgedAt ? `${selectedIncident.acknowledgedBy ?? "operator"}` : "pending"}
                      </p>
                    </div>
                    <div className="activity-cell px-3 py-2">
                      <p className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground">Remediation</p>
                      <p className="mt-1 text-[10px] font-mono text-foreground">
                        {hasRemediationTasks ? `${selectedIncident.remediationTasks.length} queued` : "not queued"}
                      </p>
                    </div>
                    <div className="activity-cell px-3 py-2">
                      <p className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground">Verification</p>
                      <p className="mt-1 text-[10px] font-mono text-foreground">
                        {selectedIncident.verification.required ? selectedIncident.verification.status : "not required"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] gap-3 items-start">
                    <div className="space-y-3">
                      <div className="console-inset p-3 rounded-sm space-y-2">
                        <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Remediation Note</p>
                        <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                          Record why you are acknowledging, assigning, or queuing remediation so the next operator does not have to infer intent from state changes alone.
                        </p>
                        <Textarea
                          value={remediationNote}
                          onChange={(event) => setRemediationNote(event.target.value)}
                          placeholder="Record the operator reason for acknowledgement, assignment, or remediation..."
                          className="bg-panel-inset border-border font-mono text-sm"
                        />
                      </div>

                      <div className="console-inset p-3 rounded-sm space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Action Deck</p>
                          <StatusBadge label={selectedIncident.remediationStatus} size="sm" />
                        </div>
                        <GuidancePanel title="How these controls behave" eyebrow="Action Hint">
                          <p>Acknowledge records that an operator saw the incident. Assign Me records ownership. Create Remediation queues a bounded lane only. `build-refactor` still waits for approval and verification; `qa-verification` checks closure evidence; `system-monitor` refreshes diagnosis; `drift-repair` fixes truth drift.</p>
                        </GuidancePanel>
                        <div className="grid grid-cols-1 lg:grid-cols-[220px_repeat(3,minmax(0,1fr))] gap-2">
                          <div className="space-y-2">
                            <Select value={remediationTaskType} onValueChange={setRemediationTaskType}>
                              <SelectTrigger className="h-9 w-full text-[10px] font-mono bg-panel-inset border-border">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="auto">Auto remediation</SelectItem>
                                <SelectItem value="build-refactor">build-refactor</SelectItem>
                                <SelectItem value="system-monitor">system-monitor</SelectItem>
                                <SelectItem value="qa-verification">qa-verification</SelectItem>
                                <SelectItem value="drift-repair">drift-repair</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-[9px] font-mono text-muted-foreground leading-relaxed">
                              {remediationHint}
                            </p>
                            <p className="text-[9px] font-mono text-primary leading-relaxed">
                              {remediationRecommendation}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={Boolean(selectedIncident.acknowledgedAt) || acknowledgeIncident.isPending || !isOperator}
                            onClick={() =>
                              acknowledgeIncident.mutate({
                                id: selectedIncident.id,
                                actor: user?.actor ?? "operator",
                                note: remediationNote || "Acknowledged from incidents page",
                              })
                            }
                            className="h-10 font-mono text-[10px] uppercase tracking-wider"
                          >
                            {acknowledgeIncident.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ShieldCheck className="w-3 h-3 mr-1" />}
                            {selectedIncident.acknowledgedAt ? "Acknowledged" : "Acknowledge"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              assignIncidentOwner.isPending ||
                              !user?.actor ||
                              !isOperator ||
                              selectedIncident.owner === user?.actor
                            }
                            onClick={() =>
                              assignIncidentOwner.mutate({
                                id: selectedIncident.id,
                                owner: user?.actor ?? "operator",
                                actor: user?.actor ?? "operator",
                                note: remediationNote || "Assigned from incidents page",
                              })
                            }
                            className="h-10 font-mono text-[10px] uppercase tracking-wider"
                          >
                            {assignIncidentOwner.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Wrench className="w-3 h-3 mr-1" />}
                            {ownerButtonLabel}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={remediateIncident.isPending || !isOperator}
                            onClick={() =>
                              remediateIncident.mutate({
                                id: selectedIncident.id,
                                actor: user?.actor ?? "operator",
                                note: remediationNote || undefined,
                                taskType:
                                  remediationTaskType === "auto"
                                    ? undefined
                                    : remediationTaskType as "build-refactor" | "drift-repair" | "qa-verification" | "system-monitor",
                              })
                            }
                            className="h-10 font-mono text-[10px] uppercase tracking-wider"
                          >
                            {remediateIncident.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <GitBranchPlus className="w-3 h-3 mr-1" />}
                            Create Remediation
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      <div className="console-inset p-3 rounded-sm space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Policy</p>
                          <StatusBadge label={selectedIncident.policy.policyId ?? "policy"} size="sm" />
                        </div>
                        <p className="text-[10px] font-mono text-foreground">
                          owner: {selectedIncident.policy.preferredOwner ?? "operator"}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground">
                          lane: {selectedIncident.policy.remediationTaskType ?? "none"}
                          {selectedIncident.policy.verifierTaskType ? ` -> verify:${selectedIncident.policy.verifierTaskType}` : ""}
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground">
                          sla: {selectedIncident.policy.targetSlaMinutes || 0}m · escalate: {selectedIncident.policy.escalationMinutes || 0}m
                        </p>
                      </div>
                      <div className="console-inset p-3 rounded-sm space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Escalation</p>
                          <div className="flex gap-2">
                            <StatusBadge label={selectedIncident.escalation.level} size="sm" />
                            <StatusBadge label={selectedIncident.escalation.status} size="sm" />
                          </div>
                        </div>
                        <p className="text-[10px] font-mono text-foreground leading-relaxed">
                          {selectedIncident.escalation.summary}
                        </p>
                        <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                          due: {selectedIncident.escalation.dueAt ? new Date(selectedIncident.escalation.dueAt).toLocaleString() : "—"}
                        </p>
                        <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                          escalate: {selectedIncident.escalation.escalateAt ? new Date(selectedIncident.escalation.escalateAt).toLocaleString() : "—"}
                        </p>
                      </div>
                      <div className="console-inset p-3 rounded-sm space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Verification</p>
                          <StatusBadge label={selectedIncident.verification.status} size="sm" />
                        </div>
                        <p className="text-[10px] font-mono text-foreground leading-relaxed">
                          {selectedIncident.verification.summary}
                        </p>
                        <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                          {selectedIncident.verification.required
                            ? `agent: ${selectedIncident.verification.agentId ?? "qa-verification-agent"}`
                            : "verification not required"}
                        </p>
                        {(selectedIncident.verification.verificationTaskId || selectedIncident.verification.verificationRunId) && (
                          <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                            task:{selectedIncident.verification.verificationTaskId ?? "—"} · run:{selectedIncident.verification.verificationRunId ?? "—"}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                    <div className="console-inset p-3 rounded-sm space-y-2">
                      <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Next Action</p>
                      <p className="text-[10px] font-mono text-foreground leading-relaxed">
                        {selectedIncident.nextAction}
                      </p>
                      <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                        {selectedIncident.remediationOwner} remediation owner
                      </p>
                    </div>
                    <div className="console-inset p-3 rounded-sm space-y-2">
                      <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Recommended Steps</p>
                      {selectedIncident.recommendedSteps.length > 0 ? (
                        selectedIncident.recommendedSteps.map((step, index) => (
                          <p key={`${selectedIncident.id}-step-${index}`} className="text-[10px] font-mono text-foreground leading-relaxed">
                            {step}
                          </p>
                        ))
                      ) : (
                        <p className="text-[10px] font-mono text-muted-foreground">No recommended steps recorded.</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                    <div className="console-inset p-3 rounded-sm space-y-2">
                      <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Blast Radius</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedIncident.affectedSurfaces.map((surface) => (
                          <span key={`${selectedIncident.id}-surface-${surface}`} className="activity-cell px-2 py-1 text-[9px] font-mono uppercase tracking-wide text-muted-foreground">
                            {surface}
                          </span>
                        ))}
                        {selectedIncident.linkedProofDeliveries.map((delivery) => (
                          <span key={`${selectedIncident.id}-proof-${delivery}`} className="activity-cell px-2 py-1 text-[9px] font-mono uppercase tracking-wide text-status-warning">
                            {delivery}
                          </span>
                        ))}
                        {selectedIncident.blockers.map((blocker) => (
                          <span key={`${selectedIncident.id}-blocker-${blocker}`} className="activity-cell px-2 py-1 text-[9px] font-mono uppercase tracking-wide text-status-warning">
                            blocker:{blocker}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="console-inset p-3 rounded-sm space-y-2">
                      <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Linked Runtime</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedIncident.linkedTaskIds.map((item) => (
                          <span key={`${selectedIncident.id}-task-${item}`} className="activity-cell px-2 py-1 text-[9px] font-mono uppercase tracking-wide text-muted-foreground">
                            task:{item}
                          </span>
                        ))}
                        {selectedIncident.linkedRunIds.map((item) => (
                          <span key={`${selectedIncident.id}-run-${item}`} className="activity-cell px-2 py-1 text-[9px] font-mono uppercase tracking-wide text-muted-foreground">
                            run:{item}
                          </span>
                        ))}
                        {selectedIncident.linkedServiceIds.map((item) => (
                          <span key={`${selectedIncident.id}-service-${item}`} className="activity-cell px-2 py-1 text-[9px] font-mono uppercase tracking-wide text-muted-foreground">
                            svc:{item}
                          </span>
                        ))}
                        {selectedIncident.linkedRepairIds.map((item) => (
                          <span key={`${selectedIncident.id}-repair-${item}`} className="activity-cell px-2 py-1 text-[9px] font-mono uppercase tracking-wide text-muted-foreground">
                            repair:{item}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="console-inset p-3 rounded-sm space-y-2">
                    <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Remediation Plan</p>
                    {selectedIncident.remediationPlan.length > 0 ? (
                      <div className="space-y-2">
                        {selectedIncident.remediationPlan.map((step) => (
                          <div key={step.stepId} className="activity-cell px-3 py-2">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-[10px] font-mono font-semibold uppercase tracking-wide text-foreground">
                                {step.title}
                              </span>
                              <div className="flex gap-2">
                                <StatusBadge label={step.kind} size="sm" />
                                <StatusBadge label={step.status} size="sm" />
                              </div>
                            </div>
                            <p className="mt-1 text-[10px] font-mono text-muted-foreground leading-relaxed">
                              {step.description}
                            </p>
                            <p className="mt-2 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                              owner:{step.owner} {step.taskType ? `· task:${step.taskType}` : ""}
                            </p>
                            {(step.dependsOn.length > 0 || step.evidence.length > 0) && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {step.dependsOn.map((dependency) => (
                                  <span key={`${step.stepId}-dep-${dependency}`} className="activity-cell px-2 py-1 text-[8px] font-mono uppercase tracking-wide text-muted-foreground">
                                    dep:{dependency}
                                  </span>
                                ))}
                                {step.evidence.map((item, index) => (
                                  <span key={`${step.stepId}-evidence-${index}`} className="activity-cell px-2 py-1 text-[8px] font-mono uppercase tracking-wide text-muted-foreground">
                                    {item}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] font-mono text-muted-foreground">
                        No remediation plan steps are currently attached to this incident.
                      </p>
                    )}
                  </div>

                  <div
                    className={cn(
                      "grid grid-cols-1 gap-2",
                      hasHistory && hasRemediationTasks && "xl:grid-cols-2",
                    )}
                  >
                    {hasHistory && (
                      <div className="console-inset p-3 rounded-sm space-y-2">
                        <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">History</p>
                        <div className="space-y-2">
                          {selectedIncident.history.map((entry) => (
                            <div key={entry.eventId} className="activity-cell px-3 py-2">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="text-[10px] font-mono font-semibold uppercase tracking-wide text-foreground">
                                  {entry.type}
                                </span>
                                <span className="text-[9px] font-mono text-muted-foreground">
                                  {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "—"}
                                </span>
                              </div>
                              <p className="mt-1 text-[10px] font-mono text-foreground leading-relaxed">{entry.summary}</p>
                              <p className="mt-1 text-[10px] font-mono text-muted-foreground leading-relaxed">{entry.detail}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {hasRemediationTasks && (
                      <div className="console-inset p-3 rounded-sm space-y-2">
                        <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Remediation Ledger</p>
                        <div className="space-y-2">
                          {selectedIncident.remediationTasks.map((task) => (
                            <div key={task.remediationId} className="activity-cell px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-mono font-semibold uppercase tracking-wide text-foreground">
                                  {task.taskType}
                                </span>
                                <StatusBadge label={task.status} size="sm" />
                              </div>
                              <p className="mt-1 text-[10px] font-mono text-muted-foreground leading-relaxed">
                                {task.reason}
                              </p>
                              <p className="mt-1 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                                task:{task.taskId} · run:{task.runId}
                              </p>
                              <div className="mt-2 grid grid-cols-2 gap-1">
                                <div className="rounded-sm border border-border/70 bg-panel-inset px-2 py-1">
                                  <p className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground">Assigned</p>
                                  <p className="mt-1 text-[9px] font-mono text-foreground">
                                    {task.assignedTo ?? task.createdBy ?? "operator"}
                                  </p>
                                  <p className="text-[8px] font-mono text-muted-foreground">
                                    {task.assignedAt ? new Date(task.assignedAt).toLocaleString() : "—"}
                                  </p>
                                </div>
                                <div className="rounded-sm border border-border/70 bg-panel-inset px-2 py-1">
                                  <p className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground">Execution</p>
                                  <p className="mt-1 text-[9px] font-mono text-foreground">
                                    {task.executionStartedAt ? "started" : "not started"}
                                  </p>
                                  <p className="text-[8px] font-mono text-muted-foreground">
                                    {task.executionStartedAt ? new Date(task.executionStartedAt).toLocaleString() : "—"}
                                  </p>
                                </div>
                                <div className="rounded-sm border border-border/70 bg-panel-inset px-2 py-1">
                                  <p className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground">Verification</p>
                                  <p className="mt-1 text-[9px] font-mono text-foreground">
                                    {task.verifiedAt ? "verified" : task.verificationStartedAt ? "verifying" : "pending"}
                                  </p>
                                  <p className="text-[8px] font-mono text-muted-foreground">
                                    {task.verifiedAt
                                      ? new Date(task.verifiedAt).toLocaleString()
                                      : task.verificationStartedAt
                                        ? new Date(task.verificationStartedAt).toLocaleString()
                                        : "—"}
                                  </p>
                                </div>
                                <div className="rounded-sm border border-border/70 bg-panel-inset px-2 py-1">
                                  <p className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground">Resolution</p>
                                  <p className="mt-1 text-[9px] font-mono text-foreground">
                                    {task.resolvedAt ? "resolved" : task.status}
                                  </p>
                                  <p className="text-[8px] font-mono text-muted-foreground">
                                    {task.resolvedAt ? new Date(task.resolvedAt).toLocaleString() : "—"}
                                  </p>
                                </div>
                              </div>
                              {(task.verificationSummary || task.resolutionSummary || task.note) && (
                                <div className="mt-2 space-y-1">
                                  {task.verificationSummary && (
                                    <p className="text-[9px] font-mono text-muted-foreground">
                                      verification: {task.verificationSummary}
                                    </p>
                                  )}
                                  {task.resolutionSummary && (
                                    <p className="text-[9px] font-mono text-muted-foreground">
                                      resolution: {task.resolutionSummary}
                                    </p>
                                  )}
                                  {task.note && (
                                    <p className="text-[9px] font-mono text-muted-foreground">
                                      note: {task.note}
                                    </p>
                                  )}
                                </div>
                              )}
                              {task.blockers.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {task.blockers.map((blocker, index) => (
                                    <div
                                      key={`${task.remediationId}-blocker-${index}`}
                                      className="activity-cell px-2 py-1"
                                    >
                                      <span className="text-[8px] font-mono uppercase tracking-wide text-amber-300">
                                        blocker
                                      </span>
                                      <span className="ml-2 text-[8px] font-mono text-muted-foreground">
                                        {blocker}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {!hasRemediationTasks && (
                    <GuidancePanel title="No remediation queued yet" eyebrow="Empty State" tone="warning">
                      <p>This incident has no remediation task history yet. Choose Auto remediation to use the policy lane, or select a manual override if you want to force a specific bounded worker such as `build-refactor` for approval-gated code repair or `qa-verification` for closure checks.</p>
                    </GuidancePanel>
                  )}

                  {(hasAcknowledgements || hasOwnershipHistory) ? (
                    <div
                      className={cn(
                        "grid grid-cols-1 gap-2",
                        hasAcknowledgements && hasOwnershipHistory && "xl:grid-cols-2",
                      )}
                    >
                      {hasAcknowledgements && (
                        <div className="console-inset p-3 rounded-sm space-y-2">
                          <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Acknowledgements</p>
                          {selectedIncident.acknowledgements.map((entry, index) => (
                            <div key={`${selectedIncident.id}-ack-${index}`} className="activity-cell px-3 py-2">
                              <p className="text-[10px] font-mono text-foreground">
                                {entry.acknowledgedBy ?? "operator"} · {entry.acknowledgedAt ? new Date(entry.acknowledgedAt).toLocaleString() : "—"}
                              </p>
                              {entry.note && <p className="mt-1 text-[10px] font-mono text-muted-foreground">{entry.note}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                      {hasOwnershipHistory && (
                        <div className="console-inset p-3 rounded-sm space-y-2">
                          <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Ownership Lifecycle</p>
                          {selectedIncident.ownershipHistory.map((entry, index) => (
                            <div key={`${selectedIncident.id}-owner-${index}`} className="activity-cell px-3 py-2">
                              <p className="text-[10px] font-mono text-foreground">
                                {entry.actor ?? "operator"} assigned {entry.owner ?? "unowned"} · {entry.assignedAt ? new Date(entry.assignedAt).toLocaleString() : "—"}
                              </p>
                              {entry.note && <p className="mt-1 text-[10px] font-mono text-muted-foreground">{entry.note}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <GuidancePanel title="No operator trail recorded yet" eyebrow="Empty State">
                      <p>This incident has not been acknowledged or reassigned yet. The first acknowledgement or assignment will appear here as audit history.</p>
                    </GuidancePanel>
                  )}
                </div>
              ) : (
                <div className="console-inset p-4 rounded-sm">
                  <p className="text-[10px] font-mono text-muted-foreground">
                    {incidentDetailLoading
                      ? "Loading incident lifecycle, remediation history, and runtime links..."
                      : "Select an incident from the queue to inspect its lifecycle, remediation history, and runtime links."}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </SummaryCard>
    </div>
  );
}
