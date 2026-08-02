import { Counter, Gauge, Histogram } from "prom-client";
import { metricsRegister } from "../metrics/prometheus.js";

function existingOrCreate<T>(name: string, create: () => T): T {
  return (metricsRegister.getSingleMetric(name) as T | undefined) ?? create();
}

export const graphRunsTotal = existingOrCreate("openclaw_graph_runs_total", () => new Counter({ name: "openclaw_graph_runs_total", help: "Graph runs by graph, version and terminal status", labelNames: ["graph", "version", "status"], registers: [metricsRegister] }));
export const graphRunsActive = existingOrCreate("openclaw_graph_runs_active", () => new Gauge({ name: "openclaw_graph_runs_active", help: "Active graph runs by graph and version", labelNames: ["graph", "version"], registers: [metricsRegister] }));
export const graphRunDuration = existingOrCreate("openclaw_graph_run_duration_seconds", () => new Histogram({ name: "openclaw_graph_run_duration_seconds", help: "Graph run duration", labelNames: ["graph", "version", "status"], registers: [metricsRegister] }));
export const graphNodeAttempts = existingOrCreate("openclaw_graph_node_attempts_total", () => new Counter({ name: "openclaw_graph_node_attempts_total", help: "Graph node attempts", labelNames: ["graph", "version", "node", "outcome"], registers: [metricsRegister] }));
export const graphNodeFailures = existingOrCreate("openclaw_graph_node_failures_total", () => new Counter({ name: "openclaw_graph_node_failures_total", help: "Graph node failures", labelNames: ["graph", "version", "node", "category"], registers: [metricsRegister] }));
export const graphTransitions = existingOrCreate("openclaw_graph_transitions_total", () => new Counter({ name: "openclaw_graph_transitions_total", help: "Graph transitions", labelNames: ["graph", "version", "outcome"], registers: [metricsRegister] }));
export const graphLoopIterations = existingOrCreate("openclaw_graph_loop_iterations_total", () => new Counter({ name: "openclaw_graph_loop_iterations_total", help: "Bounded graph loop iterations", labelNames: ["graph", "version", "loop"], registers: [metricsRegister] }));
export const graphApprovalsWaiting = existingOrCreate("openclaw_graph_approvals_waiting", () => new Gauge({ name: "openclaw_graph_approvals_waiting", help: "Graph approvals currently waiting", labelNames: ["graph", "version"], registers: [metricsRegister] }));
export const graphBudgetExhaustions = existingOrCreate("openclaw_graph_budget_exhaustions_total", () => new Counter({ name: "openclaw_graph_budget_exhaustions_total", help: "Graph budget exhaustions", labelNames: ["graph", "version", "budget"], registers: [metricsRegister] }));
export const graphAmbiguousEffects = existingOrCreate("openclaw_graph_external_effects_ambiguous", () => new Gauge({ name: "openclaw_graph_external_effects_ambiguous", help: "External effects awaiting reconciliation", labelNames: ["graph", "version", "operation"], registers: [metricsRegister] }));
export const graphRecoveries = existingOrCreate("openclaw_graph_recoveries_total", () => new Counter({ name: "openclaw_graph_recoveries_total", help: "Graph recovery decisions", labelNames: ["decision"], registers: [metricsRegister] }));
export const graphSchedulerOwnership = existingOrCreate("openclaw_graph_scheduler_ownership", () => new Gauge({ name: "openclaw_graph_scheduler_ownership", help: "Scheduler ownership by migration and owner", labelNames: ["migration", "owner"], registers: [metricsRegister] }));
export const graphSchedulerTriggers = existingOrCreate("openclaw_graph_scheduler_triggers", () => new Gauge({ name: "openclaw_graph_scheduler_triggers", help: "Durable scheduler triggers by migration and status", labelNames: ["migration", "status"], registers: [metricsRegister] }));
export const graphSchedulerLastSuccess = existingOrCreate("openclaw_graph_scheduler_last_success_timestamp_seconds", () => new Gauge({ name: "openclaw_graph_scheduler_last_success_timestamp_seconds", help: "Unix timestamp of the last completed graph-owned scheduler trigger", labelNames: ["migration"], registers: [metricsRegister] }));
