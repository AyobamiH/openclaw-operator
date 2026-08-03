import { describe, expect, it } from "vitest";
import { auditFullGraphMultiAgentRuntime } from "../src/graph/full-runtime-audit.js";

describe("full graph multi-agent runtime audit", () => {
  it("proves structural safety while reporting incomplete runtime capabilities honestly", async () => {
    const report = await auditFullGraphMultiAgentRuntime();
    expect(report.verdict).toBe("partial");
    expect(report.graphDefinitions).toBe(7);
    expect(report.graphFamilies).toBe(3);
    expect(report.productionAdapters).toBe(7);
    expect(report.registeredAgents).toBe(19);
    expect(report.governedTaskBindings).toBe(20);
    expect(report.findings.find((finding) => finding.id === "graph-definition-registration")?.status).toBe("passed");
    expect(report.findings.find((finding) => finding.id === "agent-manifest-validation")?.status).toBe("passed");
    expect(report.findings.find((finding) => finding.id === "task-agent-skill-bindings")?.status).toBe("passed");
    expect(report.findings.find((finding) => finding.id === "multi-agent-execution-receipts")?.status).toBe("warning");
    expect(report.findings.some((finding) => finding.status === "failed")).toBe(false);
  });
});
