/**
 * Prometheus Metrics Registry
 *
 * Central metrics setup for the orchestrator.
 * Exports metrics on port 9100 at /metrics endpoint.
 * Prometheus scrapes at 15-second intervals.
 *
 * Metrics exported:
 * - Agent task counters (started, completed, failed)
 * - Agent active task gauges
 * - Agent task duration histograms
 * - Agent daily cost gauges
 * - Skill access counters (allowed, denied)
 * - Permission escalation counters
 * - Active permissions gauges
 * - Audit violation counters
 * - Task approval counters
 * - Approval response time histograms
 * - Pending approvals gauges
 * - Approval auto-escalation counters
 */

import {
  register as defaultRegister,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
} from "prom-client";
import express, { Express, Request, Response } from "express";
import { createServer } from "http";
import { Server } from "http";

// Use default register
export const metricsRegister = defaultRegister;

// Collect default metrics
collectDefaultMetrics({ register: metricsRegister });

// ============================================================================
// AGENT METRICS
// ============================================================================

export const agentTasksStarted = new Counter({
  name: "agent_tasks_started_total",
  help: "Total number of tasks started by agents",
  labelNames: ["agent", "model"],
});

export const agentTasksCompleted = new Counter({
  name: "agent_tasks_completed_total",
  help: "Total number of tasks completed successfully by agents",
  labelNames: ["agent", "model"],
});

export const agentTasksFailed = new Counter({
  name: "agent_tasks_failed_total",
  help: "Total number of tasks failed by agents",
  labelNames: ["agent", "error_type"],
});

export const agentActiveTasks = new Gauge({
  name: "agent_active_tasks",
  help: "Number of currently active tasks per agent",
  labelNames: ["agent"],
});

export const agentTaskDuration = new Histogram({
  name: "agent_task_duration_seconds",
  help: "Task execution duration in seconds",
  labelNames: ["agent", "task_type"],
  buckets: [0.5, 1, 2.5, 5, 10, 30, 60],
});

export const agentCostPerDay = new Gauge({
  name: "agent_cost_per_day_usd",
  help: "Estimated daily cost per agent in USD",
  labelNames: ["agent", "model"],
});

export const agentTotalCostPerDay = new Gauge({
  name: "agent_total_cost_per_day_usd",
  help: "Total estimated daily cost across all agents in USD",
});

// ============================================================================
// SECURITY & PERMISSION METRICS
// ============================================================================

export const skillAccessAllowed = new Counter({
  name: "skill_access_allowed_total",
  help: "Number of allowed skill access attempts",
  labelNames: ["skill", "agent"],
});

export const skillAccessDenied = new Counter({
  name: "skill_access_denied_total",
  help: "Number of denied skill access attempts",
  labelNames: ["skill", "agent", "reason"],
});

export const permissionEscalationRequests = new Counter({
  name: "permission_escalation_requests_total",
  help: "Total number of permission escalation requests",
  labelNames: ["agent", "requested_permission"],
});

export const activePermissionsGranted = new Gauge({
  name: "active_permissions_granted",
  help: "Number of currently active permissions per agent",
  labelNames: ["agent"],
});

export const auditViolationsLogged = new Counter({
  name: "audit_violations_logged_total",
  help: "Total number of security violations logged",
  labelNames: ["violation_type"],
});

// ============================================================================
// APPROVAL GATE METRICS
// ============================================================================

export const taskApprovalRequests = new Counter({
  name: "task_approval_requests_total",
  help: "Total number of tasks requiring approval",
  labelNames: ["task_type"],
});

export const approvalResponseTime = new Histogram({
  name: "approval_response_time_seconds",
  help: "Time taken to approve/reject a task (SLA: <60 seconds)",
  labelNames: ["approval_result"],
  buckets: [5, 10, 20, 30, 60, 120, 300],
});

export const pendingApprovalsCount = new Gauge({
  name: "pending_approvals_count",
  help: "Number of tasks currently pending approval",
});

export const approvalAutoEscalated = new Counter({
  name: "approval_auto_escalated_total",
  help: "Number of approvals auto-escalated (timeout or SLA breach)",
  labelNames: ["escalation_reason"],
});

// ============================================================================
// HTTP METRICS ENDPOINT
// ============================================================================

let app: Express | null = null;
let server: Server | null = null;

/**
 * Start the Prometheus metrics HTTP server on port 9100
 * Endpoint: GET /metrics
 */
export async function startMetricsServer(): Promise<void> {
  try {
    app = express();
    const metricsPort = Number.parseInt(process.env.PROMETHEUS_PORT || "9100", 10);
    const metricsHost = process.env.PROMETHEUS_HOST || "127.0.0.1";

    // Health check endpoint
    app.get("/health", (_req: Request, res: Response) => {
      res.status(200).json({ status: "healthy", timestamp: new Date() });
    });

    // Metrics endpoint
    app.get("/metrics", async (_req: Request, res: Response) => {
      res.set("Content-Type", metricsRegister.contentType);
      res.end(await metricsRegister.metrics());
    });

    const localServer = createServer(app);
    server = localServer;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        localServer.off("error", onError);
        reject(error);
      };

      localServer.once("error", onError);
      localServer.listen(metricsPort, metricsHost, () => {
        localServer.off("error", onError);
        console.log(
          `✓ Prometheus metrics available at http://${metricsHost}:${metricsPort}/metrics`,
        );
        console.log(`✓ Health check at http://${metricsHost}:${metricsPort}/health`);
        resolve();
      });
    });
  } catch (error) {
    console.error("Failed to start metrics server:", error);
    throw error;
  }
}

/**
 * Stop the metrics HTTP server gracefully
 */
export async function stopMetricsServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        console.log("✓ Prometheus metrics server stopped");
        resolve();
      });
    } else {
      resolve();
    }
  });
}

/**
 * Helper: Record a task completion
 */
export function recordTaskCompletion(
  agent: string,
  model: string,
  taskType: string,
  durationSeconds: number
): void {
  agentTasksCompleted.labels(agent, model).inc();
  agentTaskDuration.labels(agent, taskType).observe(durationSeconds);
}

/**
 * Helper: Record a task failure
 */
export function recordTaskFailure(
  agent: string,
  errorType: string = "unknown"
): void {
  agentTasksFailed.labels(agent, errorType).inc();
}

/**
 * Helper: Update agent daily cost
 */
export function updateAgentCost(
  agent: string,
  model: string,
  costDelta: number
): void {
  agentCostPerDay.labels(agent, model).set(costDelta);
}

/**
 * Helper: Update total cost
 */
export function updateTotalCost(totalCost: number): void {
  agentTotalCostPerDay.set(totalCost);
}

/**
 * Helper: Record skill access
 */
export function recordSkillAccess(
  skill: string,
  agent: string,
  allowed: boolean,
  reason?: string
): void {
  if (allowed) {
    skillAccessAllowed.labels(skill, agent).inc();
  } else {
    skillAccessDenied.labels(skill, agent, reason || "denied").inc();
  }
}

/**
 * Helper: Record audit violation
 */
export function recordAuditViolation(violationType: string): void {
  auditViolationsLogged.labels(violationType).inc();
}

/**
 * Helper: Record approval request
 */
export function recordApprovalRequest(taskType: string): void {
  taskApprovalRequests.labels(taskType).inc();
}

/**
 * Helper: Record approval response
 */
export function recordApprovalResponse(
  responseTimeSec: number,
  result: string
): void {
  approvalResponseTime.labels(result).observe(responseTimeSec);
}
