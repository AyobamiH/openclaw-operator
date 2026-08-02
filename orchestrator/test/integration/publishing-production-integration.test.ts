import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  loadProductionIntegration,
  opportunityFor,
  resolveProductionOpportunity,
  rehearseProductionRollback,
} from "../../src/publishing/production-integration.js";
import { OpenClawOfficialApiWorkerClient } from "../../src/publishing/official-worker.js";
import { runProductionOpportunity } from "../../src/publishing/production-runner.js";
import { loadRegistryBundle } from "../../src/publishing/registry.js";

const projectRoot = resolve(import.meta.dirname, "../../..");
const registryPath = resolve(projectRoot, "config/publishing/registry.v1.json");
const integrationPath = resolve(
  projectRoot,
  "config/publishing/production-integration.v1.json",
);

describe("production publishing integration", () => {
  it("allocates exactly the five product opportunities and protects four legacy jobs", async () => {
    const registry = await loadRegistryBundle(registryPath);
    const integration = await loadProductionIntegration(integrationPath, registry);
    expect(integration.mode).toBe("shadow");
    expect(integration.schedulerLatenessToleranceMinutes).toBe(5);
    expect(integration.opportunities.map((item) => item.localTime).sort()).toEqual([
      "05:00",
      "07:00",
      "11:00",
      "15:00",
      "17:00",
    ]);
    expect(integration.protectedLegacyJobs).toHaveLength(4);
    expect(integration.protectedLegacyJobs.every(
      (job) => job.mutationPolicy === "untouched",
    )).toBe(true);
    expect(integration.protectedLegacyJobs).toContainEqual({
      id: "24afbb84-457c-41bb-92c9-24a19725e984",
      owner: "graph-runtime:phase-g-instagram-image-v1",
      mutationPolicy: "untouched",
    });
    expect(integration.opportunities.filter((item) => item.canaryEligible)).toEqual([
      expect.objectContaining({ id: "self-id-1500", platformId: "threads" }),
    ]);
  });

  it("canonicalizes a bounded late scheduler start to the immutable opportunity time", async () => {
    const registry = await loadRegistryBundle(registryPath);
    const integration = await loadProductionIntegration(integrationPath, registry);
    const resolution = resolveProductionOpportunity(
      integration,
      "auto",
      new Date("2026-07-30T15:03:29.450+01:00"),
    );
    expect(resolution.opportunity.id).toBe("self-id-1500");
    expect(resolution.scheduledFor.toISOString()).toBe("2026-07-30T14:00:00.000Z");
    expect(resolution.latenessMs).toBe(209_450);
    expect(() => resolveProductionOpportunity(
      integration,
      "auto",
      new Date("2026-07-30T15:06:00+01:00"),
    )).toThrow(/within the 5-minute scheduler tolerance/);
  });

  it("rejects a scheduler time that does not match the explicit opportunity", async () => {
    const registry = await loadRegistryBundle(registryPath);
    const integration = await loadProductionIntegration(integrationPath, registry);
    expect(() =>
      opportunityFor(
        integration,
        "self-id-1500",
        new Date("2026-07-30T15:01:00+01:00"),
      ),
    ).toThrow(/allocated at 15:00/);
  });

  it("exercises the production runner and connector contract with zero writes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "publishing-production-shadow-"));
    const calls: Array<Record<string, unknown>> = [];
    try {
      const result = await runProductionOpportunity({
        integrationPath,
        registryPath,
        databasePath: join(directory, "publishing.sqlite"),
        opportunityId: "auto",
        scheduledFor: new Date("2026-07-30T15:00:00+01:00"),
        mode: "shadow",
        toolInvoker: async (invocation) => {
          calls.push(invocation);
          expect(invocation.tool).toBe("relay_live_business_engagement_execute");
          expect(invocation.args).toMatchObject({
            platform: "threads",
            accountKey: "threads:owner",
            campaignLaneId: "self-identification-engine",
            opportunityId: "self-id-1500",
            dryRun: true,
            explicitWriteApproval: false,
          });
          return {
            namespace: "relay-live-business-engagement",
            outcome: "validated",
            dryRun: true,
            externalWritePerformed: false,
            accountAdmission: {
              admitted: true,
              shadow: true,
              reasons: ["shadow-admission-passed"],
            },
          };
        },
      });
      expect(result).toMatchObject({
        result: "shadow_verified",
        externalWrites: 0,
        llmCalls: 0,
        auditChainValid: true,
      });
      expect(calls).toHaveLength(1);

      const recovered = await runProductionOpportunity({
        integrationPath,
        registryPath,
        databasePath: join(directory, "publishing.sqlite"),
        opportunityId: "self-id-1500",
        scheduledFor: new Date("2026-07-30T15:00:00+01:00"),
        mode: "shadow",
        toolInvoker: async () => {
          throw new Error("restart recovery must not dispatch again");
        },
      });
      expect(recovered).toMatchObject({
        result: "shadow_verified",
        recovered: true,
        providerDispatchSuppressed: true,
        externalWrites: 0,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("records a zero-write shared-admission denial as an auditable policy skip", async () => {
    const directory = await mkdtemp(join(tmpdir(), "publishing-production-shadow-denied-"));
    let calls = 0;
    try {
      const databasePath = join(directory, "publishing.sqlite");
      const result = await runProductionOpportunity({
        integrationPath,
        registryPath,
        databasePath,
        opportunityId: "auto",
        scheduledFor: new Date("2026-07-30T17:00:20+01:00"),
        mode: "shadow",
        toolInvoker: async () => {
          calls += 1;
          return {
            namespace: "relay-live-business-engagement",
            outcome: "validated",
            dryRun: true,
            externalWritePerformed: false,
            accountAdmission: {
              admitted: false,
              shadow: true,
              reasons: ["exact-duplicate-risk"],
            },
          };
        },
      });
      expect(result).toMatchObject({
        result: "skipped_policy",
        scheduledFor: "2026-07-30T16:00:00.000Z",
        schedulerLatenessMs: 20_000,
        externalWrites: 0,
        auditChainValid: true,
      });
      expect(calls).toBe(1);

      const recovered = await runProductionOpportunity({
        integrationPath,
        registryPath,
        databasePath,
        opportunityId: "self-id-1700",
        scheduledFor: new Date("2026-07-30T17:04:59+01:00"),
        mode: "shadow",
        toolInvoker: async () => {
          throw new Error("terminal policy skip must not dispatch again");
        },
      });
      expect(recovered).toMatchObject({
        result: "skipped_policy",
        recovered: true,
        providerDispatchSuppressed: true,
        externalWrites: 0,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("resumes only a provably pre-dispatch reserved shadow after interruption", async () => {
    const directory = await mkdtemp(join(tmpdir(), "publishing-production-shadow-resume-"));
    let attempts = 0;
    try {
      const databasePath = join(directory, "publishing.sqlite");
      await expect(runProductionOpportunity({
        integrationPath,
        registryPath,
        databasePath,
        opportunityId: "self-id-1500",
        scheduledFor: new Date("2026-07-30T15:00:00+01:00"),
        mode: "shadow",
        toolInvoker: async () => {
          attempts += 1;
          throw new Error("simulated interruption before any provider-capable call");
        },
      })).rejects.toThrow(/simulated interruption/);

      const resumed = await runProductionOpportunity({
        integrationPath,
        registryPath,
        databasePath,
        opportunityId: "self-id-1500",
        scheduledFor: new Date("2026-07-30T15:02:00+01:00"),
        mode: "shadow",
        toolInvoker: async () => {
          attempts += 1;
          return {
            outcome: "validated",
            dryRun: true,
            externalWritePerformed: false,
            accountAdmission: {
              admitted: true,
              shadow: true,
              reasons: ["shadow-admission-passed"],
            },
          };
        },
      });
      expect(resumed).toMatchObject({
        result: "shadow_verified",
        recovered: true,
        scheduledFor: "2026-07-30T14:00:00.000Z",
        externalWrites: 0,
      });
      expect(attempts).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("cannot enter canary or live mode while the approved integration is shadow", async () => {
    const directory = await mkdtemp(join(tmpdir(), "publishing-production-mode-"));
    try {
      await expect(runProductionOpportunity({
        integrationPath,
        registryPath,
        databasePath: join(directory, "publishing.sqlite"),
        opportunityId: "self-id-1500",
        scheduledFor: new Date("2026-07-30T15:00:00+01:00"),
        mode: "canary",
        allowProviderWrite: true,
        toolInvoker: async () => {
          throw new Error("must not invoke connector");
        },
      })).rejects.toThrow(/does not match approved integration mode shadow/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("maps official Threads insights and reports unsupported Instagram metrics honestly", async () => {
    const registry = await loadRegistryBundle(registryPath);
    const integration = await loadProductionIntegration(integrationPath, registry);
    const threadsOpportunity = integration.opportunities.find(
      (item) => item.platformId === "threads",
    );
    const instagramOpportunity = integration.opportunities.find(
      (item) => item.platformId === "instagram",
    );
    expect(threadsOpportunity).toBeDefined();
    expect(instagramOpportunity).toBeDefined();

    const threadsClient = new OpenClawOfficialApiWorkerClient({
      connectorId: "official-api-worker",
      integration,
      opportunity: threadsOpportunity!,
      scheduledFor: new Date("2026-07-30T15:00:00+01:00"),
      mode: "shadow",
      allowProviderWrite: false,
      invoker: async (invocation) => {
        expect(invocation).toMatchObject({
          tool: "relay_live_business_engagement_discover",
          args: {
            platform: "threads",
            surface: "post_insights",
            targetId: "thread-provider-id",
          },
        });
        return {
          performed: true,
          results: {
            data: [
              { name: "views", values: [{ value: 100 }] },
              { name: "likes", values: [{ value: 5 }] },
              { name: "replies", values: [{ value: 2 }] },
              { name: "reposts", values: [{ value: 1 }] },
              { name: "quotes", values: [{ value: 1 }] },
              { name: "shares", values: [{ value: 1 }] },
            ],
          },
        };
      },
    });
    expect(await threadsClient.fetchMetrics("thread-provider-id")).toEqual([
      expect.objectContaining({
        metricDefinitionId: "metric-impressions",
        value: 100,
        availability: "available",
      }),
      expect.objectContaining({
        metricDefinitionId: "metric-engagement-rate",
        value: 0.1,
        availability: "available",
      }),
    ]);

    const instagramClient = new OpenClawOfficialApiWorkerClient({
      connectorId: "official-api-worker",
      integration,
      opportunity: instagramOpportunity!,
      scheduledFor: new Date("2026-07-30T11:00:00+01:00"),
      mode: "shadow",
      allowProviderWrite: false,
      invoker: async () => {
        throw new Error("unsupported Instagram metrics must not invoke a provider tool");
      },
    });
    expect(await instagramClient.fetchMetrics("instagram-provider-id")).toEqual([
      expect.objectContaining({
        metricDefinitionId: "metric-impressions",
        value: null,
        availability: "unavailable",
      }),
      expect.objectContaining({
        metricDefinitionId: "metric-engagement-rate",
        value: null,
        availability: "unavailable",
      }),
    ]);
  });

  it("rehearses rollback while preserving product and admission evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "publishing-rollback-"));
    const file = (name: string) => join(directory, name);
    try {
      await Promise.all([
        writeFile(file("installed-connector"), "connector-0.8.1\n"),
        writeFile(file("candidate-connector"), "connector-0.9.0\n"),
        writeFile(file("installed-config"), "legacy-config\n"),
        writeFile(file("candidate-config"), "shared-admission-config\n"),
        writeFile(file("product-state"), "immutable-product-evidence\n"),
        writeFile(file("admission-state"), "immutable-admission-evidence\n"),
      ]);
      const result = await rehearseProductionRollback({
        installedConnectorPath: file("installed-connector"),
        candidateConnectorPath: file("candidate-connector"),
        connectorConfigPath: file("installed-config"),
        candidateConfigPath: file("candidate-config"),
        productJobDeclarationPath: file("product-job"),
        productStatePath: file("product-state"),
        admissionStatePath: file("admission-state"),
        backupDirectory: file("backup"),
      });
      expect(result).toMatchObject({
        passed: true,
        previousConnectorRestored: true,
        previousConfigRestored: true,
        productJobRemoved: true,
        productStatePreserved: true,
        admissionStatePreserved: true,
        gatewayReloadPerformed: false,
        providerWrites: 0,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
