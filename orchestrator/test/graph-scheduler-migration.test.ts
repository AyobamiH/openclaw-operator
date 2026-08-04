import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  GraphSchedulerStore,
  PHASE_G_DECLARATION_KEY,
  PHASE_G_MIGRATION_ID,
  PHASE_G_SCHEDULE_ID,
} from "../src/graph/scheduler-store.js";
import { transferSchedulerOwnership } from "../src/graph/scheduler-cutover.js";
import { buildGovernedGraphJob, GOVERNED_SCHEDULER_PORTFOLIO } from "../src/graph/scheduler-portfolio.js";
import {
  executeGovernedSchedule,
  PRODUCTION_GRAPH_SCHEDULER_DATABASE_PATH,
  resolveGovernedSchedulerDatabasePath,
  resolveInputTemplate,
  resolveNaturalSlot,
} from "../scripts/trigger-governed-graph-schedule.js";

function jobs() {
  const schedule = { kind: "cron", expr: "0 5,7,9,11,13 * * *", tz: "Europe/London", staggerMs: 0 };
  const base = { id: PHASE_G_SCHEDULE_ID, declarationKey: PHASE_G_DECLARATION_KEY, enabled: true, schedule, sessionTarget: "isolated", delivery: { mode: "announce" } };
  return {
    legacyJob: { ...base, payload: { kind: "command", argv: ["node", "/workspace/scripts/instagram-publisher-outbox-runner.mjs", "--job-id", PHASE_G_SCHEDULE_ID, "--kind", "image"] } },
    graphJob: { ...base, payload: { kind: "command", argv: ["node", "--import", "tsx", "/workspace/orchestrator/scripts/trigger-graph-schedule.ts", "--migration-id", PHASE_G_MIGRATION_ID] } },
  };
}

function governedJobs(migrationId = "threads-readiness-v1") {
  const item = GOVERNED_SCHEDULER_PORTFOLIO.get(migrationId)!;
  const legacyJob = {
    id: item.declaration.scheduleId,
    declarationKey: item.declaration.declarationKey,
    enabled: true,
    schedule: { kind: "cron", expr: item.declaration.cronExpression, tz: item.declaration.timezone },
    payload: { kind: "command", argv: ["node", "/workspace/legacy.mjs"] },
  };
  const graphJob = buildGovernedGraphJob(legacyJob, migrationId, "/workspace/orchestrator/scripts/trigger-governed-graph-schedule.ts", "node");
  return { item, legacyJob, graphJob };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "graph-scheduler-"));
  const path = join(root, "graph-scheduler.sqlite");
  return { path, store: new GraphSchedulerStore(path) };
}

describe("graph scheduler migration registry", () => {
  it("binds the complete governed scheduler portfolio to exact immutable cron jobs", async () => {
    for (const item of GOVERNED_SCHEDULER_PORTFOLIO.values()) {
      const value = await fixture();
      const legacyJob = { id: item.declaration.scheduleId, declarationKey: item.declaration.declarationKey, enabled: true, schedule: { kind: "cron", expr: item.declaration.cronExpression, tz: item.declaration.timezone }, payload: { kind: "command", argv: ["node", "/workspace/legacy.mjs"] } };
      const graphJob = buildGovernedGraphJob(legacyJob, item.declaration.migrationId, "/workspace/orchestrator/scripts/trigger-governed-graph-schedule.ts", "node");
      expect(value.store.prepareBoundedMigration({ legacyJob, graphJob, declaration: item.declaration, actor: "test" })).toMatchObject({ migrationId: item.declaration.migrationId, scheduleId: item.declaration.scheduleId, status: "prepared" });
      expect(() => value.store.prepareBoundedMigration({ legacyJob: { ...legacyJob, id: "*" }, graphJob, declaration: item.declaration, actor: "test" })).toThrow();
      expect(value.store.eventChainValid(item.declaration.migrationId)).toBe(true);
      value.store.close();
    }
  });

  it("resolves injected clocks only inside exact portfolio cron windows", () => {
    expect(resolveNaturalSlot({ now: new Date("2026-08-04T04:07:00.000Z"), cronExpression: "0 5,7 * * *", timezone: "Europe/London", scheduleId: "job", provider: "threads", latenessToleranceMinutes: 10 })).toMatchObject({ slotId: "threads:2026-08-04:05:00:job", scheduledFor: "2026-08-04T04:00:00.000Z" });
    expect(() => resolveNaturalSlot({ now: new Date("2026-08-04T04:11:00.000Z"), cronExpression: "0 5,7 * * *", timezone: "Europe/London", scheduleId: "job", provider: "threads", latenessToleranceMinutes: 10 })).toThrow("graph_scheduler_trigger_outside_natural_slot_window");
    expect(resolveInputTemplate({ observedAt: "$scheduledAt", ingressId: "$slotId" }, { slotId: "slot-one", scheduledFor: "2026-08-04T04:00:00.000Z" })).toEqual({ observedAt: "2026-08-04T04:00:00.000Z", ingressId: "slot-one" });
  });

  it("pins cron execution to the production scheduler database outside the service environment", () => {
    expect(resolveGovernedSchedulerDatabasePath({})).toBe(PRODUCTION_GRAPH_SCHEDULER_DATABASE_PATH);
    expect(resolveGovernedSchedulerDatabasePath({ OPENCLAW_OPERATOR_STATE_DIR: "/state" })).toBe("/state/database/graph-scheduler.sqlite");
    expect(resolveGovernedSchedulerDatabasePath({ OPENCLAW_GRAPH_SCHEDULER_DATABASE_PATH: "/exact/scheduler.sqlite" })).toBe("/exact/scheduler.sqlite");
  });

  it("executes an injected-clock zero-write portfolio trigger through the graph API contract", async () => {
    const item = GOVERNED_SCHEDULER_PORTFOLIO.get("threads-readiness-v1")!;
    const value = await fixture();
    const legacyJob = { id: item.declaration.scheduleId, declarationKey: item.declaration.declarationKey, enabled: true, schedule: { kind: "cron", expr: item.declaration.cronExpression, tz: item.declaration.timezone }, payload: { kind: "command", argv: ["node", "/workspace/legacy.mjs"] } };
    const graphJob = buildGovernedGraphJob(legacyJob, item.declaration.migrationId, "/workspace/orchestrator/scripts/trigger-governed-graph-schedule.ts", "node");
    value.store.prepareBoundedMigration({ legacyJob, graphJob, declaration: item.declaration, actor: "test" });
    value.store.activateMigration(item.declaration.migrationId, "test");
    value.store.close();
    let runInput: any;
    const result = await executeGovernedSchedule({ migrationId: item.declaration.migrationId, now: new Date("2026-08-04T03:30:00.000Z"), schedulerPath: value.path, request: async (route, init) => {
      if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
      if (route === "/api/graphs/runs" && init?.method === "POST") { runInput = JSON.parse(String(init.body)); return { run: { runId: "run-readiness", status: "completed" } }; }
      if (route === "/api/graphs/runs/run-readiness") return { run: { runId: "run-readiness", status: "completed" }, approvals: [], liveCapability: null, externalEffects: [], eventChainValid: true, childRunReceiptChainValid: true };
      throw new Error(`unexpected fixture route ${route}`);
    } });
    expect(runInput.input.observedAt).toBe("2026-08-04T03:30:00.000Z");
    expect(result).toMatchObject({ outcome: "completed", providerWrites: 0, eventChainValid: true });
    const reopened = new GraphSchedulerStore(value.path);
    expect(reopened.triggers(item.declaration.migrationId)).toMatchObject([{ status: "completed", graphRunId: "run-readiness" }]);
    reopened.close();
  });

  it("rejects missing, inactive, and definition-mismatched scheduler migrations before graph admission", async () => {
    const request = async (route: string) => {
      if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
      throw new Error(`unexpected graph admission ${route}`);
    };

    const missing = await fixture();
    missing.store.close();
    await expect(executeGovernedSchedule({ migrationId: "threads-readiness-v1", now: new Date("2026-08-04T03:30:00.000Z"), schedulerPath: missing.path, request })).rejects.toThrow("graph_scheduler_migration_not_active_or_exact");

    const inactive = await fixture();
    const inactiveJobs = governedJobs();
    inactive.store.prepareBoundedMigration({ legacyJob: inactiveJobs.legacyJob, graphJob: inactiveJobs.graphJob, declaration: inactiveJobs.item.declaration, actor: "test" });
    inactive.store.close();
    await expect(executeGovernedSchedule({ migrationId: "threads-readiness-v1", now: new Date("2026-08-04T03:30:00.000Z"), schedulerPath: inactive.path, request })).rejects.toThrow("graph_scheduler_migration_not_active_or_exact");

    const mismatched = await fixture();
    const mismatchedJobs = governedJobs();
    const mismatchedHash = "a".repeat(64);
    const mismatchedGraphJob = structuredClone(mismatchedJobs.graphJob) as any;
    mismatchedGraphJob.graphTrigger.definitionHash = mismatchedHash;
    mismatched.store.prepareBoundedMigration({
      legacyJob: mismatchedJobs.legacyJob,
      graphJob: mismatchedGraphJob,
      declaration: { ...mismatchedJobs.item.declaration, graphDefinitionHash: mismatchedHash },
      actor: "test",
    });
    mismatched.store.activateMigration("threads-readiness-v1", "test");
    mismatched.store.close();
    await expect(executeGovernedSchedule({ migrationId: "threads-readiness-v1", now: new Date("2026-08-04T03:30:00.000Z"), schedulerPath: mismatched.path, request })).rejects.toThrow("graph_scheduler_migration_not_active_or_exact");
  });

  it("activates exact graph ownership before repointing and admits concurrent replay only once", async () => {
    const value = await fixture();
    const binding = governedJobs();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    let owner: "legacy" | "graph" = "legacy";
    const first = transferSchedulerOwnership({
      store: value.store,
      migrationId: binding.item.declaration.migrationId,
      actor: "test",
      readOwner: () => owner,
      applyGraphOwner: () => {
        expect(value.store.migration(binding.item.declaration.migrationId)?.status).toBe("graph_owned");
        owner = "graph";
      },
      applyLegacyOwner: () => { owner = "legacy"; },
    });
    expect(first).toMatchObject({ activated: true, recovered: false, alreadyGraphOwned: false, migration: { status: "graph_owned" } });
    const concurrent = transferSchedulerOwnership({
      store: value.store,
      migrationId: binding.item.declaration.migrationId,
      actor: "test-concurrent",
      readOwner: () => owner,
      applyGraphOwner: () => { throw new Error("concurrent admission must not repoint"); },
      applyLegacyOwner: () => { throw new Error("concurrent admission must not roll back"); },
    });
    expect(concurrent).toMatchObject({ activated: false, recovered: false, alreadyGraphOwned: true, migration: { status: "graph_owned" } });
    value.store.close();
  });

  it("recovers a committed activation after restart and completes the retained legacy-owner repoint", async () => {
    const value = await fixture();
    const binding = governedJobs();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    value.store.close();

    const restarted = new GraphSchedulerStore(value.path);
    let owner: "legacy" | "graph" = "legacy";
    const recovered = transferSchedulerOwnership({
      store: restarted,
      migrationId: binding.item.declaration.migrationId,
      actor: "test-restart",
      readOwner: () => owner,
      applyGraphOwner: () => { owner = "graph"; },
      applyLegacyOwner: () => { owner = "legacy"; },
    });
    expect(recovered).toMatchObject({ activated: false, recovered: true, alreadyGraphOwned: false, migration: { status: "graph_owned" } });
    expect(owner).toBe("graph");
    expect(restarted.eventChainValid(binding.item.declaration.migrationId)).toBe(true);
    restarted.close();
  });

  it("restores the retained legacy owner and rolls back activation when graph repoint fails", async () => {
    const value = await fixture();
    const binding = governedJobs();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    let owner: "legacy" | "graph" = "legacy";
    expect(() => transferSchedulerOwnership({
      store: value.store,
      migrationId: binding.item.declaration.migrationId,
      actor: "test",
      readOwner: () => owner,
      applyGraphOwner: () => { owner = "graph"; throw new Error("simulated cron repoint failure"); },
      applyLegacyOwner: () => { owner = "legacy"; },
    })).toThrow("simulated cron repoint failure");
    expect(owner).toBe("legacy");
    expect(value.store.migration(binding.item.declaration.migrationId)).toMatchObject({ status: "rolled_back", failureReason: "automatic rollback after graph-owner admission failure" });
    expect(value.store.eventChainValid(binding.item.declaration.migrationId)).toBe(true);
    value.store.close();
  });

  it("preserves the existing Instagram graph owner while transferring a governed schedule", async () => {
    const value = await fixture();
    const instagram = value.store.prepareMigration({ ...jobs(), actor: "test-instagram" });
    value.store.activateMigration(PHASE_G_MIGRATION_ID, "test-instagram");
    const before = value.store.migration(PHASE_G_MIGRATION_ID);
    const binding = governedJobs();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    let owner: "legacy" | "graph" = "legacy";
    transferSchedulerOwnership({
      store: value.store,
      migrationId: binding.item.declaration.migrationId,
      actor: "test",
      readOwner: () => owner,
      applyGraphOwner: () => { owner = "graph"; },
      applyLegacyOwner: () => { owner = "legacy"; },
    });
    expect(instagram.status).toBe("prepared");
    expect(value.store.migration(PHASE_G_MIGRATION_ID)).toEqual(before);
    expect(value.store.eventChainValid(PHASE_G_MIGRATION_ID)).toBe(true);
    value.store.close();
  });

  it("executes every governed portfolio binding with injected natural clocks and zero effects", async () => {
    const clocks: Record<string, string> = {
      "threads-readiness-v1": "2026-08-04T03:30:00.000Z",
      "threads-early-text-v1": "2026-08-04T04:00:00.000Z",
      "threads-daily-image-v1": "2026-08-04T10:30:00.000Z",
      "meta-reply-monitor-v1": "2026-08-04T04:15:00.000Z",
      "campaign-content-factory-shadow-v1": "2026-08-04T04:00:00.000Z",
      "continuous-marketing-digest-v1": "2026-08-04T07:30:00.000Z",
    };
    for (const item of GOVERNED_SCHEDULER_PORTFOLIO.values()) {
      const value = await fixture();
      const legacyJob = { id: item.declaration.scheduleId, declarationKey: item.declaration.declarationKey, enabled: true, schedule: { kind: "cron", expr: item.declaration.cronExpression, tz: item.declaration.timezone }, payload: { kind: "command", argv: ["node", "/workspace/legacy.mjs"] } };
      const graphJob = buildGovernedGraphJob(legacyJob, item.declaration.migrationId, "/workspace/orchestrator/scripts/trigger-governed-graph-schedule.ts", "node");
      value.store.prepareBoundedMigration({ legacyJob, graphJob, declaration: item.declaration, actor: "test" });
      value.store.activateMigration(item.declaration.migrationId, "test");
      value.store.close();
      const runId = `run-${item.declaration.migrationId}`;
      let runInput: any;
      const result = await executeGovernedSchedule({ migrationId: item.declaration.migrationId, now: new Date(clocks[item.declaration.migrationId]!), schedulerPath: value.path, request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") { runInput = JSON.parse(String(init.body)); return { run: { runId, status: "completed" } }; }
        if (route === `/api/graphs/runs/${runId}`) return { run: { runId, status: "completed" }, approvals: [], liveCapability: null, externalEffects: [], eventChainValid: true, childRunReceiptChainValid: true };
        throw new Error(`unexpected fixture route ${route}`);
      } });
      expect(runInput).toMatchObject({ graphId: item.declaration.graphId, version: item.declaration.graphVersion });
      expect(result).toMatchObject({ outcome: "completed", migrationId: item.declaration.migrationId, providerWrites: 0, eventChainValid: true, childReceiptChainValid: true });
      const reopened = new GraphSchedulerStore(value.path);
      expect(reopened.triggers(item.declaration.migrationId)).toMatchObject([{ status: "completed", graphRunId: runId }]);
      reopened.close();
    }
  });

  it("migrates empty with owner-only persistence and creates no authority", async () => {
    const value = await fixture();
    expect(value.store.migrations()).toEqual([]);
    expect(value.store.triggers()).toEqual([]);
    value.store.verify();
    value.store.close();
    expect((await stat(value.path)).mode & 0o777).toBe(0o600);
  });

  it("binds one exact schedule and rejects wildcard or alternate scheduler jobs", async () => {
    const value = await fixture();
    const exact = jobs();
    expect(value.store.prepareMigration({ ...exact, actor: "test" })).toMatchObject({ migrationId: PHASE_G_MIGRATION_ID, status: "prepared" });
    expect(() => value.store.prepareMigration({ legacyJob: { ...exact.legacyJob, id: "*" }, graphJob: exact.graphJob, actor: "test" })).toThrow();
    value.store.close();
  });

  it("requires explicit activation and deduplicates one natural slot durably", async () => {
    const value = await fixture();
    value.store.prepareMigration({ ...jobs(), actor: "test" });
    expect(() => value.store.reserveTrigger(PHASE_G_MIGRATION_ID, "instagram:2026-08-02:13:00:job", "2026-08-02T12:00:00.000Z", "test")).toThrow("graph_scheduler_migration_not_graph_owned");
    value.store.activateMigration(PHASE_G_MIGRATION_ID, "test", new Date("2026-08-02T11:30:00.000Z"));
    const first = value.store.reserveTrigger(PHASE_G_MIGRATION_ID, "instagram:2026-08-02:13:00:job", "2026-08-02T12:00:00.000Z", "test");
    const replay = value.store.reserveTrigger(PHASE_G_MIGRATION_ID, "instagram:2026-08-02:13:00:job", "2026-08-02T12:00:00.000Z", "test");
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.trigger.triggerId).toBe(first.trigger.triggerId);
    value.store.close();
    const reopened = new GraphSchedulerStore(value.path);
    expect(reopened.triggers()).toHaveLength(1);
    expect(reopened.migration(PHASE_G_MIGRATION_ID)?.status).toBe("graph_owned");
    expect(reopened.eventChainValid(PHASE_G_MIGRATION_ID)).toBe(true);
    reopened.close();
  });

  it("keeps rollback unavailable while a trigger is active and preserves terminal evidence", async () => {
    const value = await fixture();
    value.store.prepareMigration({ ...jobs(), actor: "test" });
    value.store.activateMigration(PHASE_G_MIGRATION_ID, "test");
    const trigger = value.store.reserveTrigger(PHASE_G_MIGRATION_ID, "instagram:2026-08-02:13:00:job", "2026-08-02T12:00:00.000Z", "test").trigger;
    value.store.updateTrigger(trigger.triggerId, "preparing", "test", { graphRunId: "grun_1" });
    expect(() => value.store.rollbackMigration(PHASE_G_MIGRATION_ID, "test", "unsafe")).toThrow("graph_scheduler_rollback_active_trigger");
    value.store.updateTrigger(trigger.triggerId, "executing", "test", { approvalId: "gap_1", capabilityId: "glc_1" });
    value.store.updateTrigger(trigger.triggerId, "completed", "test", { providerObjectId: "provider-1", permalink: "https://example.test/p/1" });
    expect(value.store.rollbackMigration(PHASE_G_MIGRATION_ID, "test", "controlled rollback").status).toBe("rolled_back");
    expect(value.store.trigger(trigger.triggerId)).toMatchObject({ status: "completed", providerObjectId: "provider-1" });
    expect(value.store.eventChainValid(PHASE_G_MIGRATION_ID)).toBe(true);
    value.store.close();
  });

  it("exposes no arbitrary graph or provider arguments on the cron trigger", async () => {
    const source = await readFile(new URL("../scripts/trigger-graph-schedule.ts", import.meta.url), "utf8");
    expect(source).toContain('process.argv.length !== 4');
    expect(source).toContain('migrationId !== PHASE_G_MIGRATION_ID');
    expect(source).not.toContain('args.get("--graph');
    expect(source).not.toContain('args.get("--provider');
    expect(source).not.toContain('args.get("--account');
    expect(source).not.toContain('args.get("--payload');
  });
});
