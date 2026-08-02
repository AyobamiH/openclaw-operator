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

function jobs() {
  const schedule = { kind: "cron", expr: "0 5,7,9,11,13 * * *", tz: "Europe/London", staggerMs: 0 };
  const base = { id: PHASE_G_SCHEDULE_ID, declarationKey: PHASE_G_DECLARATION_KEY, enabled: true, schedule, sessionTarget: "isolated", delivery: { mode: "announce" } };
  return {
    legacyJob: { ...base, payload: { kind: "command", argv: ["node", "/workspace/scripts/instagram-publisher-outbox-runner.mjs", "--job-id", PHASE_G_SCHEDULE_ID, "--kind", "image"] } },
    graphJob: { ...base, payload: { kind: "command", argv: ["node", "--import", "tsx", "/workspace/orchestrator/scripts/trigger-graph-schedule.ts", "--migration-id", PHASE_G_MIGRATION_ID] } },
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "graph-scheduler-"));
  const path = join(root, "graph-scheduler.sqlite");
  return { path, store: new GraphSchedulerStore(path) };
}

describe("graph scheduler migration registry", () => {
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
