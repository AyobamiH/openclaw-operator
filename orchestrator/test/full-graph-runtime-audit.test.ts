import { describe, expect, it } from "vitest";
import { auditFullGraphMultiAgentRuntime } from "../src/graph/full-runtime-audit.js";

describe("full graph multi-agent runtime audit", () => {
  it("proves complete governed runtime capabilities across graphs, ToolGate and child receipts", async () => {
    const report = await auditFullGraphMultiAgentRuntime();
    expect(report.verdict).toBe("passed");
    expect(report.graphDefinitions).toBe(8);
    expect(report.graphFamilies).toBe(3);
    expect(report.productionAdapters).toBe(8);
    expect(report.registeredAgents).toBe(19);
    expect(report.governedTaskBindings).toBe(20);
    expect(report.findings.find((finding) => finding.id === "graph-definition-registration")?.status).toBe("passed");
    expect(report.findings.find((finding) => finding.id === "agent-manifest-validation")?.status).toBe("passed");
    expect(report.findings.find((finding) => finding.id === "task-agent-skill-bindings")?.status).toBe("passed");
    expect(report.findings.find((finding) => finding.id === "multi-agent-execution-receipts")?.status).toBe("passed");
    expect(report.findings.every((finding) => finding.status === "passed")).toBe(true);
  });
});
