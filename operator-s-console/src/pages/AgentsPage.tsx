import { useMemo, useState } from "react";
import { useAgentsOverview } from "@/hooks/use-console-api";
import { SummaryCard } from "@/components/console/SummaryCard";
import { StatusBadge } from "@/components/console/StatusBadge";
import { TopologyRelationshipView } from "@/components/console/TopologyRelationshipView";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Clock, Search, Shield } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { num, str, bool, toArray, toNullableString } from "@/lib/safe-render";
import type { AgentTopology, RelationshipHistory } from "@/types/console";

interface AgentRowVM {
  id: string;
  name: string;
  orchestratorTask: string;
  modelTier: string | null;
  allowedSkills: string[];
  workerValidationStatus: string;
  spawnedWorkerCapable: boolean;
  serviceAvailable: boolean;
  serviceExpected: boolean;
  serviceInstalled: boolean | null;
  serviceRunning: boolean | null;
  lifecycleMode: string;
  hostServiceStatus: string;
  serviceUnitState: string | null;
  serviceUnitSubState: string | null;
  lastEvidenceAt: string | null;
  evidenceSources: string[];
  noteCount: number;
  description: string;
  capabilityReadiness: string;
  capabilityRole: string;
  capabilitySpine: string;
  capabilityEvidence: string[];
  serviceHeartbeatStatus: string | null;
  serviceHeartbeatCheckedAt: string | null;
  taskObserved: boolean;
  taskSucceeded: boolean;
  taskLastObservedStatus: string | null;
  taskLastObservedAt: string | null;
  taskLastSuccessfulAt: string | null;
  presentCapabilities: string[];
  missingCapabilities: string[];
  targetCapabilities: string[];
  evidenceProfiles: Array<{
    area: string;
    status: string;
    summary: string;
    evidence: string[];
    missing: string[];
  }>;
  ultraGapSummary: string;
}

function buildAgentRows(data: any): { agents: AgentRowVM[]; count: number } {
  const rawAgents = toArray(data?.agents);
  const agents = rawAgents.map((a: any) => ({
    id: str(a?.id, "—"),
    name: str(a?.name, "unnamed"),
    orchestratorTask: str(a?.orchestratorTask, "—"),
    modelTier: toNullableString(a?.modelTier),
    allowedSkills: toArray<string>(a?.allowedSkills).map((skill) => str(skill, "")),
    workerValidationStatus: str(a?.workerValidationStatus, "unknown"),
    spawnedWorkerCapable: bool(a?.spawnedWorkerCapable),
    serviceAvailable: bool(a?.serviceAvailable ?? a?.serviceOperational),
    serviceExpected: bool(a?.serviceExpected),
    serviceInstalled: a?.serviceInstalled === true ? true : a?.serviceInstalled === false ? false : null,
    serviceRunning: a?.serviceRunning === true ? true : a?.serviceRunning === false ? false : null,
    lifecycleMode: str(a?.lifecycleMode, "worker-first"),
    hostServiceStatus: str(a?.hostServiceStatus, "not-applicable"),
    serviceUnitState: toNullableString(a?.serviceUnitState),
    serviceUnitSubState: toNullableString(a?.serviceUnitSubState),
    lastEvidenceAt: toNullableString(a?.lastEvidenceAt),
    evidenceSources: toArray<string>(a?.evidenceSources).map((source) => str(source, "")),
    noteCount: toArray(a?.notes).length,
    description: str(a?.description, ""),
    capabilityReadiness: str(a?.capability?.currentReadiness, "declared"),
    capabilityRole: str(a?.capability?.role, "unassigned"),
    capabilitySpine: str(a?.capability?.spine, "execution"),
    capabilityEvidence: toArray<string>(a?.capability?.evidence).map((entry) => str(entry, "")),
    serviceHeartbeatStatus: toNullableString(a?.runtimeProof?.serviceHeartbeat?.status),
    serviceHeartbeatCheckedAt: toNullableString(a?.runtimeProof?.serviceHeartbeat?.checkedAt),
    taskObserved: bool(a?.runtimeProof?.distinctions?.taskObserved),
    taskSucceeded: bool(a?.runtimeProof?.distinctions?.taskSucceeded),
    taskLastObservedStatus: toNullableString(a?.runtimeProof?.taskPath?.lastObservedStatus),
    taskLastObservedAt: toNullableString(a?.runtimeProof?.taskPath?.lastObservedAt),
    taskLastSuccessfulAt: toNullableString(a?.runtimeProof?.taskPath?.lastSuccessfulAt),
    presentCapabilities: toArray<string>(a?.capability?.presentCapabilities).map((entry) => str(entry, "")),
    missingCapabilities: toArray<string>(a?.capability?.missingCapabilities).map((entry) => str(entry, "")),
    targetCapabilities: toArray<string>(a?.capability?.targetCapabilities).map((entry) => str(entry, "")),
    evidenceProfiles: toArray(a?.capability?.evidenceProfiles).map((profile: any) => ({
      area: str(profile?.area, "capability"),
      status: str(profile?.status, "missing"),
      summary: str(profile?.summary, "No evidence profile summary recorded."),
      evidence: toArray<string>(profile?.evidence).map((entry) => str(entry, "")),
      missing: toArray<string>(profile?.missing).map((entry) => str(entry, "")),
    })),
    ultraGapSummary: str(a?.capability?.ultraGapSummary, "Capability readiness has not been derived yet."),
  }));

  return { agents, count: num(data?.count) };
}

function lifecycleBadgeLabel(agent: AgentRowVM) {
  return agent.lifecycleMode === "service-expected" ? "Service-expected" : "Worker-first";
}

function executionPathBadgeLabel(agent: AgentRowVM) {
  if (agent.lifecycleMode === "service-expected") {
    return agent.serviceAvailable ? "Service Entry" : "Entry Missing";
  }

  return agent.spawnedWorkerCapable ? "Worker Ready" : "Worker Missing";
}

function hostCoverageBadgeLabel(agent: AgentRowVM) {
  switch (agent.hostServiceStatus) {
    case "running":
      return "Host Running";
    case "installed-stopped":
    case "not-installed":
      return "Host Stopped";
    case "probe-unavailable":
      return "Probe Unavailable";
    case "missing-entrypoint":
      return "Missing Entrypoint";
    case "not-applicable":
    default:
      return "Host N/A";
  }
}

function buildOperatorActionHint(agent: AgentRowVM) {
  if (agent.lifecycleMode === "service-expected" && agent.hostServiceStatus !== "running") {
    return "Operator action: restore the resident service first, then recheck heartbeat and task-path proof.";
  }

  if (!agent.taskObserved) {
    return agent.id === "integration-agent"
      ? "Operator action: run Integration Workflow with blank/default steps or shorthand workflow lines to promote a real coordination canary."
      : "Operator action: trigger a narrow bounded canary through Tasks to promote fresh task-path proof for this lane.";
  }

  if (!agent.taskLastSuccessfulAt) {
    return "Operator action: rerun a narrow green canary, then confirm the latest run turned green before trusting this lane operationally.";
  }

  if (agent.missingCapabilities.includes("tiered model declaration")) {
    return "Operator action: align this agent manifest with a declared model tier so readiness and operator trust stay explicit.";
  }

  if (agent.missingCapabilities.length > 0) {
    return "Operator action: use the Missing list as the closure checklist, then refresh this page after the next successful bounded run.";
  }

  return agent.lifecycleMode === "service-expected"
    ? "Operator action: keep the resident service healthy and use incidents plus runs to watch for regression."
    : "Operator action: this worker-first lane is ready; trigger it on demand and use Runs for closure evidence.";
}

function buildRelationshipHistoryVM(history: RelationshipHistory | null) {
  if (!history) return null;

  return {
    totalObservations: num(history.totalObservations),
    lastObservedAt: toNullableString(history.lastObservedAt),
    byRelationship: Object.entries(history.byRelationship ?? {})
      .map(([relationship, count]) => ({
        relationship,
        count: num(count),
      }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5),
    byStatus: Object.entries(history.byStatus ?? {})
      .map(([status, count]) => ({
        status,
        count: num(count),
      }))
      .sort((left, right) => right.count - left.count),
    timeline: toArray(history.timeline)
      .map((bucket: any) => ({
        bucketStart: str(bucket?.bucketStart, ""),
        total: num(bucket?.total),
      }))
      .filter((bucket) => bucket.bucketStart)
      .slice(-8),
    recent: toArray(history.recent).slice(0, 8).map((entry: any, index: number) => ({
      id: str(entry?.observationId, `relationship-${index}`),
      timestamp: toNullableString(entry?.timestamp),
      from: str(entry?.from, "unknown"),
      to: str(entry?.to, "unknown"),
      relationship: str(entry?.relationship, "unknown"),
      status: str(entry?.status, "observed"),
      source: str(entry?.source, "runtime"),
      detail: str(entry?.detail, "No relationship detail recorded."),
    })),
    windows: {
      short: {
        windowHours: num(history.windows?.short?.windowHours),
        totalObservations: num(history.windows?.short?.totalObservations),
        firstObservedAt: toNullableString(history.windows?.short?.firstObservedAt),
        lastObservedAt: toNullableString(history.windows?.short?.lastObservedAt),
      },
      long: {
        windowHours: num(history.windows?.long?.windowHours),
        totalObservations: num(history.windows?.long?.totalObservations),
        firstObservedAt: toNullableString(history.windows?.long?.firstObservedAt),
        lastObservedAt: toNullableString(history.windows?.long?.lastObservedAt),
      },
    },
    graph: {
      totalNodes: num(history.graph?.totalNodes),
      totalEdges: num(history.graph?.totalEdges),
      nodes: toArray(history.graph?.nodes).slice(0, 8).map((entry: any, index: number) => ({
        id: str(entry?.id, `relationship-node-${index}`),
        label: str(entry?.label, "unknown"),
        kind: str(entry?.kind, "unknown"),
        count: num(entry?.count),
        lastObservedAt: toNullableString(entry?.lastObservedAt),
      })),
      edges: toArray(history.graph?.edges).slice(0, 10).map((entry: any, index: number) => ({
        id: str(entry?.id, `relationship-edge-${index}`),
        from: str(entry?.from, "unknown"),
        to: str(entry?.to, "unknown"),
        relationship: str(entry?.relationship, "related"),
        count: num(entry?.count),
        classification: toNullableString(entry?.classification),
        lastObservedAt: toNullableString(entry?.lastObservedAt),
      })),
    },
  };
}

export default function AgentsPage() {
  const { data: agentsData, isLoading } = useAgentsOverview();
  const [search, setSearch] = useState("");
  const [runtimeFilter, setRuntimeFilter] = useState("all");
  const [sortKey, setSortKey] = useState("evidence");

  const vm = useMemo(() => buildAgentRows(agentsData), [agentsData]);
  const topology = useMemo(() => {
    const value = agentsData?.topology;
    return value && typeof value === "object" ? (value as AgentTopology) : null;
  }, [agentsData]);
  const relationshipHistory = useMemo(() => {
    const value = agentsData?.relationshipHistory;
    return value && typeof value === "object"
      ? buildRelationshipHistoryVM(value as RelationshipHistory)
      : null;
  }, [agentsData]);

  const filteredAgents = useMemo(() => {
    const needle = search.trim().toLowerCase();

    const filtered = vm.agents.filter((agent) => {
      const matchesSearch =
        !needle ||
        agent.name.toLowerCase().includes(needle) ||
        agent.id.toLowerCase().includes(needle) ||
        agent.orchestratorTask.toLowerCase().includes(needle) ||
        agent.description.toLowerCase().includes(needle);

      const matchesRuntime =
        runtimeFilter === "all" ||
        (runtimeFilter === "worker-first" && agent.lifecycleMode === "worker-first") ||
        (runtimeFilter === "service-expected" && agent.lifecycleMode === "service-expected") ||
        (runtimeFilter === "host-running" && agent.hostServiceStatus === "running") ||
        (runtimeFilter === "attention" &&
          ((agent.lifecycleMode === "service-expected" &&
            agent.hostServiceStatus !== "running") ||
            (agent.lifecycleMode === "worker-first" && !agent.spawnedWorkerCapable)));

      return matchesSearch && matchesRuntime;
    });

    return filtered.sort((left, right) => {
      if (sortKey === "name") {
        return left.name.localeCompare(right.name);
      }

      if (sortKey === "task") {
        return left.orchestratorTask.localeCompare(right.orchestratorTask);
      }

      const leftEvidence = left.lastEvidenceAt ? new Date(left.lastEvidenceAt).getTime() : 0;
      const rightEvidence = right.lastEvidenceAt ? new Date(right.lastEvidenceAt).getTime() : 0;
      return rightEvidence - leftEvidence;
    });
  }, [runtimeFilter, search, sortKey, vm.agents]);

  const summary = useMemo(() => ({
    workerFirst: filteredAgents.filter((agent) => agent.lifecycleMode === "worker-first").length,
    serviceExpected: filteredAgents.filter((agent) => agent.lifecycleMode === "service-expected").length,
    hostRunning: filteredAgents.filter((agent) => agent.hostServiceStatus === "running").length,
    advanced: filteredAgents.filter((agent) => agent.capabilityReadiness === "advanced").length,
    operational: filteredAgents.filter((agent) => agent.capabilityReadiness === "operational").length,
  }), [filteredAgents]);

  if (isLoading) {
    return (
      <div className="space-y-5">
        <h2 className="page-title">Agents</h2>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="console-panel h-20 animate-pulse" style={{ opacity: 0.3 }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h2 className="page-title">Agents</h2>

      <div className="console-inset p-3">
        <p className="text-[11px] text-muted-foreground font-mono tracking-wide">
          <Bot className="w-3 h-3 inline mr-1.5 text-primary" />
          Agent truth overview — separate worker capability from service availability, install state, and live runtime state.
          Count: {vm.count}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        <div className="console-inset p-3 rounded-sm text-center">
          <p className="metric-value text-2xl">{filteredAgents.length}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Visible</p>
        </div>
        <div className="console-inset p-3 rounded-sm text-center">
          <p className="metric-value text-2xl">{summary.workerFirst}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Worker-First</p>
        </div>
        <div className="console-inset p-3 rounded-sm text-center">
          <p className="metric-value text-2xl">{summary.serviceExpected}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Service-Expected</p>
        </div>
        <div className="console-inset p-3 rounded-sm text-center">
          <p className="metric-value text-2xl">{summary.hostRunning}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Host Running</p>
        </div>
        <div className="console-inset p-3 rounded-sm text-center">
          <p className="metric-value text-2xl">{summary.advanced + summary.operational}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">Ultra Track</p>
        </div>
      </div>

      <SummaryCard title="Topology Pulse" icon={<Shield className="w-4 h-4" />}>
        {topology ? (
          <TopologyRelationshipView topology={topology} />
        ) : (
          <div className="console-inset p-3 rounded-sm">
            <p className="text-[10px] font-mono text-muted-foreground">
              Agent topology data is not exposed by the backend yet for this surface.
            </p>
          </div>
        )}
      </SummaryCard>

      <SummaryCard title="Relationship History" icon={<Clock className="w-4 h-4" />}>
        {relationshipHistory ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <div className="console-inset p-3 rounded-sm">
                <p className="metric-value text-2xl">{relationshipHistory.totalObservations}</p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">
                  Observations
                </p>
              </div>
              <div className="console-inset p-3 rounded-sm">
                <p className="text-[10px] font-mono text-foreground">
                  {relationshipHistory.lastObservedAt
                    ? formatDistanceToNow(new Date(relationshipHistory.lastObservedAt), {
                        addSuffix: true,
                      })
                    : "No recent signal"}
                </p>
                <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider mt-1">
                  Last observed
                </p>
              </div>
              <div className="console-inset p-3 rounded-sm col-span-2">
                <div className="flex flex-wrap gap-1.5">
                  {relationshipHistory.byStatus.map((entry) => (
                    <div key={entry.status} className="activity-cell px-2.5 py-1.5">
                      <span className="text-[9px] font-mono uppercase tracking-wide text-muted-foreground">
                        {entry.status}
                      </span>
                      <span className="ml-2 text-[10px] font-mono font-bold text-foreground">
                        {entry.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid xl:grid-cols-[0.95fr_1.05fr] gap-3">
              <div className="console-inset p-3 rounded-sm space-y-2">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                  Dominant relationships
                </p>
                {relationshipHistory.byRelationship.map((entry) => (
                  <div key={entry.relationship} className="activity-cell px-3 py-2 flex items-center justify-between">
                    <span className="text-[10px] font-mono text-foreground uppercase tracking-wide">
                      {entry.relationship}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-primary">{entry.count}</span>
                  </div>
                ))}
                {relationshipHistory.byRelationship.length === 0 && (
                  <p className="text-[10px] font-mono text-muted-foreground">
                    No observed relationship classes have been recorded yet.
                  </p>
                )}
              </div>

              <div className="console-inset p-3 rounded-sm space-y-2">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                  Recent observed edges
                </p>
                <div className="space-y-2">
                  {relationshipHistory.recent.map((entry) => (
                    <div key={entry.id} className="activity-cell px-3 py-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[10px] font-mono font-semibold uppercase tracking-wide text-foreground">
                          {entry.relationship}
                        </span>
                        <StatusBadge label={entry.status} size="sm" />
                      </div>
                      <p className="mt-1 text-[10px] font-mono text-muted-foreground">
                        {entry.from} {" -> "} {entry.to}
                      </p>
                      <p className="mt-1 text-[10px] font-mono text-foreground leading-relaxed">
                        {entry.detail}
                      </p>
                      <p className="mt-1 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                        {entry.source} ·{" "}
                        {entry.timestamp
                          ? formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })
                          : "unknown time"}
                      </p>
                    </div>
                  ))}
                  {relationshipHistory.recent.length === 0 && (
                    <p className="text-[10px] font-mono text-muted-foreground">
                      No recent relationship observations are available yet.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {relationshipHistory.timeline.length > 0 && (
              <div className="console-inset p-3 rounded-sm">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                  Last eight buckets
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
                  {relationshipHistory.timeline.map((bucket) => (
                    <div key={bucket.bucketStart} className="activity-cell px-2.5 py-2">
                      <p className="text-[8px] font-mono uppercase tracking-wide text-muted-foreground">
                        {new Date(bucket.bucketStart).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="text-[12px] font-mono font-black text-foreground mt-1">
                        {bucket.total}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              <div className="console-inset p-3 rounded-sm space-y-3">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                  Observation Windows
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Short", value: relationshipHistory.windows.short },
                    { label: "Long", value: relationshipHistory.windows.long },
                  ].map((window) => (
                    <div key={window.label} className="activity-cell px-3 py-2 space-y-1">
                      <p className="text-[8px] font-mono uppercase tracking-wide text-muted-foreground">
                        {window.label} · {window.value.windowHours || 0}h
                      </p>
                      <p className="text-[12px] font-mono font-black text-foreground">
                        {window.value.totalObservations}
                      </p>
                      <p className="text-[9px] font-mono text-muted-foreground">
                        {window.value.lastObservedAt
                          ? formatDistanceToNow(new Date(window.value.lastObservedAt), {
                              addSuffix: true,
                            })
                          : "No signal"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="console-inset p-3 rounded-sm space-y-3">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                  Observed Relationship Graph
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="activity-cell px-3 py-2">
                    <p className="text-[8px] font-mono uppercase tracking-wide text-muted-foreground">Nodes</p>
                    <p className="mt-1 text-[12px] font-mono font-black text-foreground">
                      {relationshipHistory.graph.totalNodes}
                    </p>
                  </div>
                  <div className="activity-cell px-3 py-2">
                    <p className="text-[8px] font-mono uppercase tracking-wide text-muted-foreground">Edges</p>
                    <p className="mt-1 text-[12px] font-mono font-black text-foreground">
                      {relationshipHistory.graph.totalEdges}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {relationshipHistory.graph.nodes.map((node) => (
                    <span key={node.id} className="activity-cell px-2 py-1 text-[9px] font-mono uppercase tracking-wide text-muted-foreground">
                      {node.label}:{node.kind}
                    </span>
                  ))}
                </div>
                <div className="space-y-1.5">
                  {relationshipHistory.graph.edges.map((edge) => (
                    <div key={edge.id} className="activity-cell px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono text-foreground uppercase tracking-wide">
                          {edge.from} → {edge.to}
                        </span>
                        <span className="text-[9px] font-mono text-primary">{edge.count}</span>
                      </div>
                      <p className="mt-1 text-[9px] font-mono text-muted-foreground uppercase tracking-wide">
                        {edge.relationship}
                        {edge.classification ? ` · ${edge.classification}` : ""}
                      </p>
                    </div>
                  ))}
                  {relationshipHistory.graph.edges.length === 0 && (
                    <p className="text-[10px] font-mono text-muted-foreground">
                      No observed graph edges are available yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="console-inset p-3 rounded-sm">
            <p className="text-[10px] font-mono text-muted-foreground">
              Relationship observation history is not exposed by the backend yet for this surface.
            </p>
          </div>
        )}
      </SummaryCard>

      <div className="grid md:grid-cols-[1.3fr_0.9fr_0.9fr] gap-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, id, task, or description..."
            className="bg-panel-inset border-border font-mono text-sm pl-9"
          />
        </div>
        <Select value={runtimeFilter} onValueChange={setRuntimeFilter}>
          <SelectTrigger className="h-10 text-xs font-mono bg-panel-inset border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All runtime states</SelectItem>
            <SelectItem value="worker-first">Worker-first only</SelectItem>
            <SelectItem value="service-expected">Service-expected only</SelectItem>
            <SelectItem value="host-running">Host running only</SelectItem>
            <SelectItem value="attention">Needs host or worker attention</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortKey} onValueChange={setSortKey}>
          <SelectTrigger className="h-10 text-xs font-mono bg-panel-inset border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="evidence">Sort by evidence recency</SelectItem>
            <SelectItem value="name">Sort by name</SelectItem>
            <SelectItem value="task">Sort by task</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <SummaryCard title="Capability Readiness" icon={<Shield className="w-4 h-4" />}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {["declared", "foundation", "operational", "advanced"].map((readiness) => {
            const count = filteredAgents.filter((agent) => agent.capabilityReadiness === readiness).length;
            return (
              <div key={readiness} className="console-inset p-3 rounded-sm text-center">
                <StatusBadge label={readiness} size="sm" />
                <p className="metric-value text-xl mt-2">{count}</p>
                <p className="text-[8px] font-mono text-muted-foreground uppercase tracking-wider mt-1">
                  {readiness}
                </p>
              </div>
            );
          })}
        </div>
      </SummaryCard>

      <SummaryCard title="Agent Directory" icon={<Bot className="w-4 h-4" />} variant="inset">
        <div className="space-y-2">
          {filteredAgents.map((agent) => (
            <div key={agent.id} className="activity-module-row">
              <div className="flex items-center gap-1.5 p-1.5 relative z-10 flex-wrap">
                <div className="activity-cell flex items-center gap-2 px-3 py-2 min-w-[160px] flex-1">
                  <Bot className="w-3 h-3 text-primary shrink-0" />
                  <span className="font-mono text-[11px] font-bold text-foreground uppercase tracking-wide truncate">
                    {agent.name}
                  </span>
                </div>

                <div className="activity-cell px-3 py-2 hidden sm:flex items-center">
                  <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wide">
                    {agent.orchestratorTask}
                  </span>
                </div>

                <div className="activity-cell px-2.5 py-2 flex items-center">
                  <StatusBadge label={agent.workerValidationStatus} size="sm" />
                </div>

                <div className="activity-cell px-2.5 py-2 flex items-center">
                  <StatusBadge label={lifecycleBadgeLabel(agent)} size="sm" />
                </div>

                <div className="activity-cell px-2.5 py-2 flex items-center">
                  <StatusBadge label={executionPathBadgeLabel(agent)} size="sm" />
                </div>

                <div className="activity-cell px-2.5 py-2 flex items-center">
                  <StatusBadge label={hostCoverageBadgeLabel(agent)} size="sm" />
                </div>

                <div className="activity-cell px-2.5 py-2 flex items-center">
                  <StatusBadge label={agent.capabilityReadiness} size="sm" />
                </div>

                {agent.lastEvidenceAt && (
                  <div className="activity-cell px-3 py-2 hidden md:flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="text-foreground font-mono text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">
                      {(() => {
                        try {
                          return formatDistanceToNow(new Date(agent.lastEvidenceAt!)) + " ago";
                        } catch {
                          return agent.lastEvidenceAt;
                        }
                      })()}
                    </span>
                  </div>
                )}

                {agent.evidenceSources.length > 0 && (
                  <div className="activity-cell px-3 py-2 hidden lg:flex items-center gap-1.5">
                    <Shield className="w-3 h-3 text-status-healthy shrink-0" />
                    <span className="text-muted-foreground font-mono text-[9px] uppercase tracking-wide truncate">
                      {[agent.serviceUnitState, agent.serviceUnitSubState, ...agent.evidenceSources]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </div>
                )}

                <div className="activity-cell px-3 py-2 hidden xl:flex items-center flex-1">
                  <span className="text-[10px] text-muted-foreground truncate font-mono">
                    {agent.noteCount > 0 ? `${agent.noteCount} note${agent.noteCount !== 1 ? "s" : ""}` : (agent.description || "—")}
                  </span>
                </div>
              </div>

              <div className="px-3 pb-3 relative z-10">
                <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-2">
                  <div className="console-inset p-3 rounded-sm space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                        {agent.capabilityRole} · {agent.capabilitySpine} spine
                      </p>
                      {agent.modelTier && (
                        <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                          model {agent.modelTier}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] font-mono text-foreground leading-relaxed">
                      {agent.ultraGapSummary}
                    </p>
                    <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                      {agent.lifecycleMode === "service-expected"
                        ? "Resident posture: keep the host service installed and running for this lane."
                        : "Worker-first posture: trigger it on demand through orchestrator task paths; host service install is not required."}
                    </p>
                    <p className="text-[10px] font-mono text-status-info leading-relaxed">
                      {buildOperatorActionHint(agent)}
                    </p>
                    {agent.targetCapabilities.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {agent.targetCapabilities.map((capability) => (
                          <span
                            key={`${agent.id}-target-${capability}`}
                            className="activity-cell px-2 py-1 text-[9px] font-mono uppercase tracking-wide text-muted-foreground"
                          >
                            {capability}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                      {agent.allowedSkills.length > 0 ? (
                        <span>{agent.allowedSkills.length} skill{agent.allowedSkills.length === 1 ? "" : "s"}</span>
                      ) : (
                        <span>No allowed skills</span>
                      )}
                      <span>{agent.presentCapabilities.length} present</span>
                      <span>{agent.missingCapabilities.length} missing</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="console-inset p-3 rounded-sm md:col-span-2">
                      <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                        Runtime Proof
                      </p>
                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] font-mono">
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wider text-[8px]">
                            {agent.lifecycleMode === "service-expected"
                              ? "Resident heartbeat"
                              : "Resident loop"}
                          </p>
                          <p className="text-foreground mt-1">
                            {agent.lifecycleMode === "service-expected"
                              ? agent.serviceHeartbeatStatus ?? "unknown"
                              : "not required"}
                          </p>
                          <p className="text-muted-foreground mt-1 leading-relaxed">
                            {agent.lifecycleMode === "service-expected"
                              ? agent.serviceHeartbeatCheckedAt
                                ? formatDistanceToNow(new Date(agent.serviceHeartbeatCheckedAt)) + " ago"
                                : "no recent heartbeat"
                              : "worker-first lanes rely on task-path proof, not resident polling"}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wider text-[8px]">Task path</p>
                          <p className="text-foreground mt-1">
                            {agent.taskObserved
                              ? agent.taskSucceeded
                                ? "observed success"
                                : agent.taskLastObservedStatus ?? "observed"
                              : "no task-path evidence"}
                          </p>
                          <p className="text-muted-foreground mt-1 leading-relaxed">
                            {agent.taskLastObservedAt
                              ? `last observed ${formatDistanceToNow(new Date(agent.taskLastObservedAt))} ago`
                              : "no observed run"}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground uppercase tracking-wider text-[8px]">Latest green</p>
                          <p className="text-foreground mt-1">
                            {agent.taskLastSuccessfulAt ? "present" : "none"}
                          </p>
                          <p className="text-muted-foreground mt-1 leading-relaxed">
                            {agent.taskLastSuccessfulAt
                              ? formatDistanceToNow(new Date(agent.taskLastSuccessfulAt)) + " ago"
                              : "no successful task-path proof"}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="console-inset p-3 rounded-sm">
                      <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Present</p>
                      <div className="mt-2 space-y-1">
                        {agent.presentCapabilities.slice(0, 4).map((capability) => (
                          <p key={capability} className="text-[10px] font-mono text-status-healthy leading-relaxed">
                            {capability}
                          </p>
                        ))}
                        {agent.presentCapabilities.length === 0 && (
                          <p className="text-[10px] font-mono text-muted-foreground">No present runtime evidence yet.</p>
                        )}
                      </div>
                    </div>
                    <div className="console-inset p-3 rounded-sm">
                      <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Missing</p>
                      <div className="mt-2 space-y-1">
                        {agent.missingCapabilities.slice(0, 4).map((capability) => (
                          <p key={capability} className="text-[10px] font-mono text-status-warning leading-relaxed">
                            {capability}
                          </p>
                        ))}
                        {agent.missingCapabilities.length === 0 && (
                          <p className="text-[10px] font-mono text-muted-foreground">No exposed capability gaps.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {agent.evidenceProfiles.length > 0 && (
                  <div className="mt-2 grid grid-cols-1 xl:grid-cols-2 gap-2">
                    {agent.evidenceProfiles.map((profile) => (
                      <div key={`${agent.id}-${profile.area}`} className="console-inset p-3 rounded-sm space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                            {profile.area}
                          </p>
                          <StatusBadge label={profile.status} size="sm" />
                        </div>
                        <p className="text-[10px] font-mono text-foreground leading-relaxed">
                          {profile.summary}
                        </p>
                        {profile.evidence.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {profile.evidence.map((entry) => (
                              <span
                                key={`${agent.id}-${profile.area}-${entry}`}
                                className="activity-cell px-2 py-1 text-[9px] font-mono uppercase tracking-wide text-muted-foreground"
                              >
                                {entry}
                              </span>
                            ))}
                          </div>
                        )}
                        {profile.missing.length > 0 && (
                          <div className="space-y-1">
                            {profile.missing.map((entry) => (
                              <p
                                key={`${agent.id}-${profile.area}-missing-${entry}`}
                                className="text-[10px] font-mono text-status-warning leading-relaxed"
                              >
                                Missing: {entry}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {filteredAgents.length === 0 && (
            <div className="console-inset p-6 text-center">
              <p className="text-sm text-muted-foreground font-mono">No agents match the current filters.</p>
            </div>
          )}
        </div>
      </SummaryCard>

      <div className="console-inset p-4">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground font-mono text-[10px] uppercase tracking-wider">Legend:</strong>
          <span className="ml-2">"declared" = manifest exists.</span>
          <span className="ml-2">"spawnedWorkerCapable" = can be invoked as worker.</span>
          <span className="ml-2">"confirmed-worker" = validated in runtime.</span>
          <span className="ml-2">"available" = service entrypoint exists.</span>
          <span className="ml-2">"installed" = host unit exists.</span>
          <span className="ml-2">"running" = host unit is active.</span>
          <span className="ml-2">"lastEvidenceAt" = most recent runtime proof.</span>
          <span className="ml-2">"evidenceSources" = what produced the proof.</span>
        </p>
      </div>
    </div>
  );
}
