import { buildCompanionControlPlaneMode as operatorMode } from "../../src/companion-mode.js";
import { buildCompanionControlPlaneMode as agentMode } from "../../../agents/shared/companion-mode.js";
import { resolveTaskExecuteSkill } from "../../../agents/shared/governed-readers.js";
import { normalizeLogicalPath, logicalPathMatchesBoundary } from "../../../skills/readerUtils.js";
import { LEGACY_DEPLOYMENT_PATHS, resolveDeploymentPaths } from "../../src/deployment-paths.js";
import { describe, expect, it } from "vitest";
import { buildIncidentPriorityQueue as operatorRanking, type IncidentPriorityInput } from "../../src/incident-priority.js";
import { buildIncidentPriorityQueue as agentRanking } from "../../../agents/shared/runtime-evidence.js";
import { createEmptyCumulativeWorkload as runtimeDefaults } from "../../src/review-session-defaults.js";
import { createEmptyCumulativeWorkload as bootstrapDefaults } from "../../../scripts/review-session/workload-defaults.mjs";

describe("shared runtime contract distribution", () => {
  it("preserves partial incidents, ordering, deduplication, owner fallback and resolved filtering", () => {
    const incidents: IncidentPriorityInput[] = [
      { incidentId: "closed", status: "resolved", severity: "critical" },
      { incidentId: "b", severity: "info", owner: "owner" },
      { incidentId: "a", severity: "info", owner: "owner" },
      { incidentId: "priority", severity: "critical", escalation: { level: "breached" },
        policy: { preferredOwner: "qa", remediationTaskType: "qa-verification" },
        remediation: { blockers: ["same"] }, remediationTasks: [{ status: "blocked", blockers: ["same", "other"] }] },
      {},
    ];
    const result = operatorRanking(incidents);
    expect(agentRanking(incidents)).toEqual(result);
    expect(result.map(r => r.incidentId)).toEqual(["priority", "unknown-incident", "a", "b"]);
    expect(result[0]).toMatchObject({ priorityScore: 88, recommendedOwner: "qa", blockers: ["same", "other"] });
    expect(result[1]).toMatchObject({ severity: "warning", status: "active" });
  });

  it("gives runtime and standalone bootstrap identical fresh workload state", () => {
    expect(bootstrapDefaults()).toEqual(runtimeDefaults());
    const a = runtimeDefaults();
    const b = bootstrapDefaults();
    a.taskTypeCounts.heartbeat = 1;
    a.acceptedRuns = 1;
    expect(b.taskTypeCounts).toEqual({});
    expect(runtimeDefaults().acceptedRuns).toBe(0);
  });
});

describe("shared projection and deployment configuration", () => {
  it("keeps companion and analyst mode precedence identical", () => {
    const base = { openIncidentCount: 0, criticalIncidentCount: 0, pendingApprovalsCount: 0, queueQueued: 0, queueProcessing: 0, proofStatus: "healthy" as const, dominantClassification: null };
    const cases = [
      [base, "Steady State"],
      [{ ...base, queueQueued: 1 }, "Active Queue"],
      [{ ...base, queueQueued: 1, proofStatus: "degraded" as const }, "Proof Lag"],
      [{ ...base, pendingApprovalsCount: 1, proofStatus: "degraded" as const }, "Review-Gated"],
      [{ ...base, pendingApprovalsCount: 1, criticalIncidentCount: 1 }, "Incident Storm"],
    ] as const;
    for (const [input, expected] of cases) {
      expect(operatorMode(input).label).toBe(expected);
      expect(agentMode(input)).toEqual(operatorMode(input));
    }
  });
  it("retains the in-process skill injection precedence without treating JSON as executable", () => {
    const first = async () => ({ success: true });
    const second = async () => ({ success: false });
    expect(resolveTaskExecuteSkill({ __executeSkill: first, executeSkill: second })).toBe(first);
    expect(resolveTaskExecuteSkill({ executeSkill: second })).toBe(second);
    expect(resolveTaskExecuteSkill({ __executeSkill: "untrusted", executeSkill: second })).toBeNull();
    expect(resolveTaskExecuteSkill(JSON.parse('{"executeSkill":"not a function"}'))).toBeNull();
    expect(resolveTaskExecuteSkill(null)).toBeNull();
  });
  it("preserves existing logical evidence matching, including segment boundaries", () => {
    expect(normalizeLogicalPath(" ./repo/docs/../src/ ")).toBe("repo/src");
    expect(logicalPathMatchesBoundary("project/src/index.ts", "src")).toBe(true);
    expect(logicalPathMatchesBoundary("project/src-other/index.ts", "src")).toBe(false);
    expect(logicalPathMatchesBoundary("project/src/index.ts", "")).toBe(false);
  });
  it("keeps the legacy deployment profile but allows absolute trusted host configuration", () => {
    const legacy = resolveDeploymentPaths({});
    expect(legacy.workspaceRoot).toBe(LEGACY_DEPLOYMENT_PATHS.workspaceRoot);
    expect(legacy.operatorStateRoot).toBe(LEGACY_DEPLOYMENT_PATHS.operatorStateRoot);
    expect(legacy.openclawBin).toBe(LEGACY_DEPLOYMENT_PATHS.openclawBin);
    expect(legacy.operatorIntegrityRoot).not.toBe(LEGACY_DEPLOYMENT_PATHS.witnessStateRoot);
    const configured = resolveDeploymentPaths({ OPENCLAW_WORKSPACE_ROOT: "/srv/openclaw/workspace", OPENCLAW_OPERATOR_STATE_DIR: "/srv/state/operator", OPENCLAW_BIN: "/opt/bin/openclaw" });
    expect(configured).toMatchObject({ workspaceRoot: "/srv/openclaw/workspace", projectsRoot: "/srv/openclaw/workspace/projects", operatorStateRoot: "/srv/state/operator", operatorIntegrityRoot: "/srv/state/operator/worktree-integrity", openclawBin: "/opt/bin/openclaw" });
    expect(configured.mediaRenderer).toContain("/srv/openclaw/workspace/projects/");
    expect(() => resolveDeploymentPaths({ OPENCLAW_WORKSPACE_ROOT: "../other" })).toThrow("absolute path");
    expect(() => resolveDeploymentPaths({ OPENCLAW_OPERATOR_STATE_DIR: "../state" })).toThrow("absolute path");
  });
});
