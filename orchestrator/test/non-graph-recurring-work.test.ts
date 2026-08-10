import { describe, expect, it } from "vitest";
import {
  NON_GRAPH_RECURRING_WORK_REGISTRY,
  validateNonGraphRecurringWorkRegistry,
} from "../src/nonGraphRecurringWork.js";

describe("non-Graph recurring work registry", () => {
  it("registers every required recurring and event-driven capability exactly once", () => {
    const required = [
      "orchestrator-heartbeat",
      "openclaw-agent-heartbeats",
      "business-value-cadence",
      "business-day-pulse",
      "nightly-batch",
      "document-watching",
      "doc-specialist-service-heartbeat",
      "missed-heartbeat-detection",
      "alert-retention-cleanup",
      "alert-deduplication-cleanup",
      "startup-recovery",
      "task-retry-recovery",
      "review-session-sampling",
      "github-workflow-monitor",
      "knowledge-integration-startup",
      "agent-overview-cache-warm",
      "reddit-helper-service-loop",
      "legacy-send-digest-cron",
    ];

    expect(
      NON_GRAPH_RECURRING_WORK_REGISTRY.map((entry) => entry.capability).sort(),
    ).toEqual(required.sort());
    expect(validateNonGraphRecurringWorkRegistry()).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("leaves no active second owner for digest or document drift repair", () => {
    const digest = NON_GRAPH_RECURRING_WORK_REGISTRY.find(
      (entry) => entry.capability === "legacy-send-digest-cron",
    );
    const docService = NON_GRAPH_RECURRING_WORK_REGISTRY.find(
      (entry) => entry.capability === "doc-specialist-service-heartbeat",
    );

    expect(digest).toMatchObject({ state: "disabled", disposition: "DISABLE" });
    expect(docService?.effects).toBe(
      "Writes only doc-specialist service-health state.",
    );
    expect(docService?.externalAuthority).toContain(
      "direct orchestrator-state and knowledge-pack mutation is forbidden",
    );
  });

  it("keeps external authority explicit for every registration", () => {
    for (const registration of NON_GRAPH_RECURRING_WORK_REGISTRY) {
      expect(registration.externalAuthority.trim().length).toBeGreaterThan(0);
      expect(registration.verification.trim().length).toBeGreaterThan(0);
      expect(registration.reporting.trim().length).toBeGreaterThan(0);
      expect(registration.recovery.trim().length).toBeGreaterThan(0);
    }
  });
});
