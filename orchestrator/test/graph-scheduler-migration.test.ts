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
import { liveCapableSocialPublicationGraph, metaReplyMonitorGraph } from "../src/graph/workflows.js";
import { effectiveNodeTimeoutMs } from "../src/graph/engine.js";
import {
  executeGovernedSchedule,
  formatGovernedScheduleOutput,
  PRODUCTION_GRAPH_SCHEDULER_DATABASE_PATH,
  resolveGovernedSchedulerDatabasePath,
  resolveInputTemplate,
  resolveNaturalSlot,
} from "../scripts/trigger-governed-graph-schedule.js";
import { executePhaseGSchedule } from "../scripts/trigger-graph-schedule.js";

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
    expect(resolveNaturalSlot({ now: new Date("2026-08-04T03:10:15.000Z"), cronExpression: "15 * * * *", timezone: "Europe/London", scheduleId: "job", provider: "meta", latenessToleranceMinutes: 20 })).toMatchObject({ slotId: "meta:2026-08-04:04:15:job", scheduledFor: "2026-08-04T03:15:00.000Z", waitUntil: "2026-08-04T03:15:00.000Z" });
    expect(() => resolveNaturalSlot({ now: new Date("2026-08-04T03:09:59.000Z"), cronExpression: "15 * * * *", timezone: "Europe/London", scheduleId: "job", provider: "meta", latenessToleranceMinutes: 20 })).toThrow("graph_scheduler_trigger_outside_natural_slot_window");
    expect(() => resolveNaturalSlot({ now: new Date("2026-08-04T04:11:00.000Z"), cronExpression: "0 5,7 * * *", timezone: "Europe/London", scheduleId: "job", provider: "threads", latenessToleranceMinutes: 10 })).toThrow("graph_scheduler_trigger_outside_natural_slot_window");
    expect(resolveInputTemplate({ observedAt: "$scheduledAt", ingressId: "$slotId" }, { slotId: "slot-one", scheduledFor: "2026-08-04T04:00:00.000Z" })).toEqual({ observedAt: "2026-08-04T04:00:00.000Z", ingressId: "slot-one" });
  });

  it("pins cron execution to the production scheduler database outside the service environment", () => {
    expect(resolveGovernedSchedulerDatabasePath({})).toBe(PRODUCTION_GRAPH_SCHEDULER_DATABASE_PATH);
    expect(resolveGovernedSchedulerDatabasePath({ OPENCLAW_OPERATOR_STATE_DIR: "/state" })).toBe("/state/database/graph-scheduler.sqlite");
    expect(resolveGovernedSchedulerDatabasePath({ OPENCLAW_GRAPH_SCHEDULER_DATABASE_PATH: "/exact/scheduler.sqlite" })).toBe("/exact/scheduler.sqlite");
  });

  it("extends Meta reply monitor runtime timeouts without changing immutable graph definitions", () => {
    const definition = metaReplyMonitorGraph();
    const prepare = definition.nodes.find((node) => node.id === "prepare_exact_effect")!;
    const live = definition.nodes.find((node) => node.id === "perform_exact_effect")!;
    const readback = definition.nodes.find((node) => node.id === "reconcile_provider_state")!;
    expect(prepare).toMatchObject({ timeoutMs: 60_000 });
    expect(live).toMatchObject({ timeoutMs: 60_000 });
    expect(readback).toMatchObject({ timeoutMs: 60_000 });
    expect(effectiveNodeTimeoutMs(prepare)).toBe(10 * 60_000);
    expect(effectiveNodeTimeoutMs(live)).toBe(5 * 60_000);
    expect(effectiveNodeTimeoutMs(readback)).toBe(5 * 60_000);
  });

  it("hard-cuts the retained Instagram Reel job into the governed graph portfolio", () => {
    const binding = governedJobs("instagram-reel-v1");
    expect(binding.item.declaration).toMatchObject({
      migrationId: "instagram-reel-v1",
      scheduleId: "2c7071ff-35dd-40d0-bf77-b1ed53de256e",
      declarationKey: "instagram-reel-video-daily-v1",
      graphId: "deterministic-social-publication",
      graphVersion: "2.0.0",
      graphNamespace: "production.instagram.reel",
      provider: "instagram",
      accountId: "17841453638630920",
      cronExpression: "0 15,17,19,21,23 * * *",
      timezone: "Europe/London",
    });
    expect(binding.item.input).toMatchObject({
      provider: "instagram",
      accountKey: "instagram:owner",
      expectedAccountId: "17841453638630920",
      jobId: "2c7071ff-35dd-40d0-bf77-b1ed53de256e",
      kind: "reel",
      observedAt: "$scheduledAt",
      shadowMode: false,
      maximumProviderMutations: 1,
    });
    expect(binding.graphJob.enabled).toBe(true);
    expect(binding.graphJob.payload).toMatchObject({
      kind: "command",
      noOutputTimeoutSeconds: 1800,
      timeoutSeconds: 2400,
    });
    expect(binding.graphJob.graphTrigger).toMatchObject({
      graphId: "deterministic-social-publication",
      graphVersion: "2.0.0",
      approvalPolicy: "prepared_payload_only",
      maximumExternalWrites: 1,
      latenessToleranceMinutes: 10,
    });
  });

  it("hard-cuts the retained Instagram Image job into the governed graph portfolio", () => {
    const binding = governedJobs(PHASE_G_MIGRATION_ID);
    expect(binding.item.declaration).toMatchObject({
      migrationId: PHASE_G_MIGRATION_ID,
      scheduleId: PHASE_G_SCHEDULE_ID,
      declarationKey: PHASE_G_DECLARATION_KEY,
      graphId: "deterministic-social-publication",
      graphVersion: "2.0.0",
      graphNamespace: "production.instagram.single-image-feed",
      provider: "instagram",
      accountId: "17841453638630920",
      cronExpression: "0 5,7,9,11,13 * * *",
      timezone: "Europe/London",
    });
    expect(binding.item.input).toMatchObject({
      provider: "instagram",
      accountKey: "instagram:owner",
      expectedAccountId: "17841453638630920",
      jobId: PHASE_G_SCHEDULE_ID,
      kind: "image",
      observedAt: "$scheduledAt",
      shadowMode: false,
      maximumProviderMutations: 1,
    });
    expect(binding.graphJob.payload).toMatchObject({
      kind: "command",
      argv: ["node", "--import", "tsx", "/workspace/orchestrator/scripts/trigger-governed-graph-schedule.ts", "--migration-id", PHASE_G_MIGRATION_ID],
      noOutputTimeoutSeconds: 900,
      timeoutSeconds: 1200,
    });
    expect(binding.graphJob.graphTrigger).toMatchObject({
      graphId: "deterministic-social-publication",
      graphVersion: "2.0.0",
      approvalPolicy: "prepared_payload_only",
      maximumExternalWrites: 1,
      latenessToleranceMinutes: 10,
    });
  });

  it("extends Instagram Reel runtime budgets without changing the immutable v2 graph definition", () => {
    const definition = GOVERNED_SCHEDULER_PORTFOLIO.get("instagram-reel-v1")!;
    const prepare = definition.declaration.graphDefinitionHash;
    const reelDefinition = liveCapableSocialPublicationGraph();
    const prepareNode = reelDefinition.nodes.find((node) => node.id === "acquire_durable_candidate_claim")!;
    const liveNode = reelDefinition.nodes.find((node) => node.id === "publish_provider_object")!;
    expect(prepareNode).toMatchObject({ timeoutMs: 15 * 60_000 });
    expect(liveNode).toMatchObject({ timeoutMs: 15 * 60_000 });
    expect(effectiveNodeTimeoutMs(prepareNode)).toBe(25 * 60_000);
    expect(effectiveNodeTimeoutMs(liveNode)).toBe(20 * 60_000);
    expect(GOVERNED_SCHEDULER_PORTFOLIO.get("instagram-reel-v1")!.declaration.graphDefinitionHash).toBe(prepare);
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

  it("binds Instagram Reel prepared-payload approval to the frozen publication envelope", async () => {
    const binding = governedJobs("instagram-reel-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    value.store.close();
    let runInput: any;
    let approvalRequest: any;
    let capabilityRequest: any;
    let executeCalls = 0;
    let approved = false;
    let capabilityIssued = false;
    const approval = {
      approvalId: "gap_reel_exact",
      action: "production.instagram-publication-live.v2",
      target: "instagram:17841453638630920",
      payloadHash: "b".repeat(64),
      status: "pending",
      expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    };
    const publicationLive = {
      envelope: { approvalId: approval.approvalId, approvalExpiry: new Date(Date.now() + 20 * 60_000).toISOString() },
      envelopeHash: "c".repeat(64),
      projection: {
        outboxId: "instagram:reel:2026-08-05:23:00:2c7071ff-35dd-40d0-bf77-b1ed53de256e",
        claim: { leaseExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString() },
      },
    };
    const completedDetail = () => ({
      run: {
        runId: "run-reel",
        status: "completed",
        data: {
          target: "instagram:17841453638630920",
          publicationLive: {
            ...publicationLive,
            result: {
              outboxId: "instagram:reel:2026-08-05:23:00:2c7071ff-35dd-40d0-bf77-b1ed53de256e",
              providerResultId: "ig-reel-one",
              permalink: "https://www.instagram.com/reel/reel-one/",
            },
            readback: {
              providerResultId: "ig-reel-one",
              permalink: "https://www.instagram.com/reel/reel-one/",
            },
          },
        },
      },
      approvals: [{ ...approval, status: "granted" }],
      liveCapability: { capabilityId: "glc_reel", status: "consumed" },
      externalEffects: [{ state: "effect_verified", providerOperationId: "ig-reel-one" }],
      childRunReceipts: [{ receiptId: "receipt-reel", status: "succeeded", outcome: "completed", receiptHash: "d".repeat(64) }],
      eventChainValid: true,
      childRunReceiptChainValid: true,
    });
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-05T22:00:00.000Z"),
      schedulerPath: value.path,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") { runInput = JSON.parse(String(init.body)); return { run: { runId: "run-reel", status: "waiting_for_approval" } }; }
        if (route === "/api/graphs/runs/run-reel") {
          if (executeCalls > 0) return completedDetail();
          return {
            run: { runId: "run-reel", status: capabilityIssued ? "running" : "waiting_for_approval", data: { target: "instagram:17841453638630920", publicationLive } },
            approvals: [{ ...approval, status: approved ? "granted" : "pending" }],
            liveCapability: capabilityIssued ? { capabilityId: "glc_reel", status: "prepared" } : null,
            externalEffects: [],
            eventChainValid: true,
            childRunReceiptChainValid: true,
          };
        }
        if (route === "/api/graphs/runs/run-reel/approvals/gap_reel_exact" && init?.method === "POST") { approvalRequest = JSON.parse(String(init.body)); approved = true; return { approval: { ...approval, status: "granted" } }; }
        if (route === "/api/graphs/runs/run-reel/live-capabilities" && init?.method === "POST") { capabilityRequest = JSON.parse(String(init.body)); capabilityIssued = true; return { capability: { capabilityId: "glc_reel", status: "prepared" }, dispatches: [] }; }
        if (route === "/api/graphs/runs/run-reel/execute" && init?.method === "POST") { executeCalls += 1; return { run: { runId: "run-reel", status: "completed" } }; }
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(runInput).toMatchObject({
      graphId: "deterministic-social-publication",
      version: "2.0.0",
      input: {
        expectedAccountId: "17841453638630920",
        jobId: "2c7071ff-35dd-40d0-bf77-b1ed53de256e",
        kind: "reel",
        observedAt: "2026-08-05T22:00:00.000Z",
      },
    });
    expect(approvalRequest).toMatchObject({ decision: "granted", payloadHash: approval.payloadHash, note: expect.stringContaining(approval.approvalId) });
    expect(capabilityRequest).toMatchObject({ approvalId: approval.approvalId });
    expect(result).toMatchObject({
      outcome: "completed",
      providerWrites: 1,
      publicationReport: {
        providerPostUrl: "https://www.instagram.com/reel/reel-one/",
        candidateId: "instagram:reel:2026-08-05:23:00:2c7071ff-35dd-40d0-bf77-b1ed53de256e",
        finalClassification: "published",
      },
    });
    const reopened = new GraphSchedulerStore(value.path);
    expect(reopened.triggers(binding.item.declaration.migrationId)).toMatchObject([{ status: "completed", graphRunId: "run-reel", permalink: "https://www.instagram.com/reel/reel-one/" }]);
    reopened.close();
  });

  it("classifies a Phase G pre-envelope terminal graph failure as failed-safe instead of throwing", async () => {
    const value = await fixture();
    value.store.prepareMigration({ ...jobs(), actor: "test-instagram" });
    value.store.activateMigration(PHASE_G_MIGRATION_ID, "test-instagram");
    value.store.close();
    let runInput: any;
    const result = await executePhaseGSchedule({
      now: new Date("2026-08-05T12:00:00.000Z"),
      schedulerPath: value.path,
      instagramOutboxPath: `${value.path}.missing-instagram-outbox.json`,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") {
          runInput = JSON.parse(String(init.body));
          return { run: { runId: "run-phase-g-pre-envelope", status: "failed" } };
        }
        if (route === "/api/graphs/runs/run-phase-g-pre-envelope") return {
          run: { runId: "run-phase-g-pre-envelope", status: "failed", data: {}, lastError: { message: "Instagram image projection lacks a valid layout-verification binding" } },
          approvals: [],
          liveCapability: null,
          externalEffects: [],
          eventChainValid: true,
          childRunReceiptChainValid: true,
        };
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(runInput).toMatchObject({
      correlationId: expect.stringMatching(/^gst_/),
      input: { observedAt: "2026-08-05T12:00:00.000Z", jobId: PHASE_G_SCHEDULE_ID, maximumProviderMutations: 1 },
    });
    expect(result).toMatchObject({
      outcome: "completion_contract_failed",
      providerWrites: 0,
      publicationReport: {
        policyOrSkipReason: "pre_envelope_terminal:Instagram image projection lacks a valid layout-verification binding",
        recoveryResult: "failed_safe_recovery_available",
        finalClassification: "failed",
      },
    });
    const reopened = new GraphSchedulerStore(value.path);
    expect(reopened.triggers(PHASE_G_MIGRATION_ID)).toMatchObject([{ status: "failed_safe", graphRunId: "run-phase-g-pre-envelope" }]);
    expect(JSON.parse(reopened.triggers(PHASE_G_MIGRATION_ID)[0]!.failureReason!)).toMatchObject({ type: "graph_scheduler_pre_envelope_terminal", recoverySafe: true });
    reopened.close();
  });

  it("classifies a Phase G empty-envelope terminal graph failure as failed-safe", async () => {
    const value = await fixture();
    value.store.prepareMigration({ ...jobs(), actor: "test-instagram" });
    value.store.activateMigration(PHASE_G_MIGRATION_ID, "test-instagram");
    value.store.close();
    const result = await executePhaseGSchedule({
      now: new Date("2026-08-05T12:00:00.000Z"),
      schedulerPath: value.path,
      instagramOutboxPath: `${value.path}.missing-instagram-outbox.json`,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") return { run: { runId: "run-phase-g-empty-envelope", status: "failed" } };
        if (route === "/api/graphs/runs/run-phase-g-empty-envelope") return {
          run: {
            runId: "run-phase-g-empty-envelope",
            status: "failed",
            data: { publicationLive: { envelope: {}, envelopeHash: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a", providerWrites: 0, status: "blocked" } },
            lastError: { message: "initial_meta_readiness_failed" },
          },
          approvals: [],
          liveCapability: null,
          externalEffects: [],
          eventChainValid: true,
          childRunReceiptChainValid: true,
        };
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(result).toMatchObject({
      outcome: "completion_contract_failed",
      providerWrites: 0,
      publicationReport: {
        policyOrSkipReason: "pre_envelope_terminal:initial_meta_readiness_failed",
        recoveryResult: "failed_safe_recovery_available",
      },
    });
    const reopened = new GraphSchedulerStore(value.path);
    expect(reopened.triggers(PHASE_G_MIGRATION_ID)).toMatchObject([{ status: "failed_safe", graphRunId: "run-phase-g-empty-envelope" }]);
    expect(JSON.parse(reopened.triggers(PHASE_G_MIGRATION_ID)[0]!.failureReason!)).toMatchObject({ reason: "initial_meta_readiness_failed", recoverySafe: true, effectCount: 0 });
    reopened.close();
  });

  it("replays a failed-safe Phase G trigger against the immutable original slot", async () => {
    const value = await fixture();
    value.store.prepareMigration({ ...jobs(), actor: "test-instagram" });
    value.store.activateMigration(PHASE_G_MIGRATION_ID, "test-instagram");
    const reserved = value.store.reserveTrigger(PHASE_G_MIGRATION_ID, `instagram:2026-08-05:13:00:${PHASE_G_SCHEDULE_ID}`, "2026-08-05T12:00:00.000Z", "test").trigger;
    value.store.updateTrigger(reserved.triggerId, "preparing", "test", { graphRunId: "run-phase-g-old" });
    value.store.updateTrigger(reserved.triggerId, "failed_safe", "test", { graphRunId: "run-phase-g-old", failureReason: "graph_scheduler_frozen_envelope_missing" });
    value.store.close();
    let recoveryInput: any;
    const result = await executePhaseGSchedule({
      now: new Date("2026-08-05T22:47:00.000Z"),
      recoveryTriggerId: reserved.triggerId,
      schedulerPath: value.path,
      instagramOutboxPath: `${value.path}.missing-instagram-outbox.json`,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs/run-phase-g-old") return { run: { runId: "run-phase-g-old", status: "failed", data: {} }, liveCapability: null, externalEffects: [], eventChainValid: true, childRunReceiptChainValid: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") {
          recoveryInput = JSON.parse(String(init.body));
          return { run: { runId: "run-phase-g-replayed", status: "failed" } };
        }
        if (route === "/api/graphs/runs/run-phase-g-replayed") return {
          run: { runId: "run-phase-g-replayed", status: "failed", data: {}, lastError: { message: "Instagram image projection lacks a valid layout-verification binding" } },
          liveCapability: null,
          externalEffects: [],
          eventChainValid: true,
          childRunReceiptChainValid: true,
        };
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(recoveryInput).toMatchObject({
      correlationId: `${reserved.triggerId}:attempt:2`,
      input: { observedAt: "2026-08-05T12:00:00.000Z", jobId: PHASE_G_SCHEDULE_ID },
    });
    expect(result).toMatchObject({ outcome: "completion_contract_failed", providerWrites: 0 });
    const reopened = new GraphSchedulerStore(value.path);
    expect(reopened.triggers(PHASE_G_MIGRATION_ID)).toMatchObject([{ status: "failed_safe", graphRunId: "run-phase-g-replayed", attemptCount: 2 }]);
    reopened.close();
  });

  it("surfaces a healthy Factory no-op terminal receipt without external effects", async () => {
    const binding = governedJobs("campaign-content-factory-shadow-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    value.store.close();
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-04T06:00:00.000Z"),
      schedulerPath: value.path,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") return { run: { runId: "run-factory-no-op", status: "completed" } };
        if (route === "/api/graphs/runs/run-factory-no-op") return { run: { runId: "run-factory-no-op", status: "completed" }, approvals: [], liveCapability: null, externalEffects: [], childRunReceipts: [{ receiptId: "receipt-factory-no-op", status: "succeeded", outcome: "completed_no_eligible_opportunity", receiptHash: "f".repeat(64) }], eventChainValid: true, childRunReceiptChainValid: true };
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(result).toMatchObject({ outcome: "completed_no_eligible_opportunity", providerWrites: 0, terminalReceipt: { receiptId: "receipt-factory-no-op", outcome: "completed_no_eligible_opportunity", receiptHash: "f".repeat(64) } });
    const reopened = new GraphSchedulerStore(value.path);
    expect(reopened.triggers(binding.item.declaration.migrationId)).toMatchObject([{ status: "completed", graphRunId: "run-factory-no-op" }]);
    reopened.close();
  });

  it("classifies zero-write Threads publication completions with explicit skip reason", async () => {
    const binding = governedJobs("threads-daily-image-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    value.store.close();
    const detail = {
      run: {
        runId: "run-threads-skip",
        status: "completed",
        data: {
          socialEffect: {
            status: "not_ready_before_commit",
            action: "skip",
            outboxId: "threads:2026-08-04:16:30:083e3560-40fd-4487-9d78-674f64866ef7",
            payloadHash: null,
            targetId: null,
            approvalId: null,
            providerWrites: 0,
            browserRelayCalls: 0,
          },
          target: "threads:2026-08-04:16:30:083e3560-40fd-4487-9d78-674f64866ef7",
        },
        assertions: [{ assertionId: "threads-publication-receipted", status: "passed" }],
        checkpoints: [{ checkpointId: "gcp_terminal", nodeId: "complete", reason: "completion_verified", stateHash: "a".repeat(64) }],
      },
      approvals: [],
      liveCapability: null,
      externalEffects: [],
      childRunReceipts: [],
      eventChainValid: true,
      childRunReceiptChainValid: true,
    };
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-04T15:30:00.000Z"),
      schedulerPath: value.path,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") return { run: { runId: "run-threads-skip", status: "completed" } };
        if (route === "/api/graphs/runs/run-threads-skip") return detail;
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(result).toMatchObject({
      outcome: "completed",
      providerWrites: 0,
      terminalReceipt: { checkpointId: "gcp_terminal", reason: "completion_verified", stateHash: "a".repeat(64) },
      publicationReport: {
        publicationOutcome: "not_published_zero_write",
        policyOrSkipReason: "skip:not_ready_before_commit",
        candidateId: null,
        providerWrites: 0,
        providerPostId: null,
        providerPostUrl: null,
        verifierResult: "threads-publication-receipted:passed",
        recoveryRequired: false,
        finalClassification: "legitimate_skip",
      },
    });
    const message = formatGovernedScheduleOutput(result, binding.item.declaration.migrationId);
    expect(message).toContain("Graph execution outcome: completed");
    expect(message).toContain("Publication outcome: not_published_zero_write");
    expect(message).toContain("Policy/skip reason: skip:not_ready_before_commit");
    expect(message).toContain("Candidate ID: none");
    expect(message).toContain("Final classification: legitimate_skip");
  });

  it("classifies zero-write Meta reply preparation terminal failures with an explicit reason", async () => {
    const binding = governedJobs("meta-reply-monitor-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    value.store.close();
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-05T16:18:00.000Z"),
      schedulerPath: value.path,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") return { run: { runId: "run-meta-reply-prepare-timeout", status: "failed" } };
        if (route === "/api/graphs/runs/run-meta-reply-prepare-timeout") return {
          run: {
            runId: "run-meta-reply-prepare-timeout",
            status: "failed",
            data: {},
            terminalOutcome: "transition_resolution_failed",
            lastError: { category: "invariant_violation", message: "graph_transition_missing:prepare_exact_effect:timed_out" },
          },
          approvals: [],
          liveCapability: null,
          externalEffects: [],
          childRunReceipts: [],
          verifierReceipts: [],
          eventChainValid: true,
          childRunReceiptChainValid: true,
        };
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(result).toMatchObject({
      outcome: "completion_contract_failed",
      providerWrites: 0,
      publicationReport: {
        publicationOutcome: "failed",
        policyOrSkipReason: "zero_write_terminal:invariant_violation:graph_transition_missing:prepare_exact_effect:timed_out",
        recoveryResult: "failed_safe_recovery_available",
        recoveryRequired: true,
        finalClassification: "failed",
      },
    });
    const message = formatGovernedScheduleOutput(result, binding.item.declaration.migrationId);
    expect(message).toContain("Policy/skip reason: zero_write_terminal:invariant_violation:graph_transition_missing:prepare_exact_effect:timed_out");
    expect(message).not.toContain("zero_provider_writes_without_publication_reason");
  });

  it("polls a completed run until terminal receipt-chain persistence is visible", async () => {
    const binding = governedJobs("continuous-marketing-digest-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    value.store.close();
    let reads = 0;
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-04T07:30:00.000Z"),
      schedulerPath: value.path,
      completionPollAttempts: 3,
      completionPollIntervalMs: 0,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") return { run: { runId: "run-async-receipt", status: "completed" } };
        if (route === "/api/graphs/runs/run-async-receipt") {
          reads += 1;
          if (reads < 3) return { run: { runId: "run-async-receipt", status: "completed" }, approvals: [], liveCapability: null, externalEffects: [], childRunReceipts: [], eventChainValid: true };
          return { run: { runId: "run-async-receipt", status: "completed" }, approvals: [], liveCapability: null, externalEffects: [], childRunReceipts: [{ receiptId: "receipt-async", status: "succeeded", outcome: "completed", receiptHash: "a".repeat(64) }], verifierReceipts: [{ verifierReceiptId: "gvr_async", status: "succeeded", outcome: "passed", receiptHash: "b".repeat(64) }], eventChainValid: true, childRunReceiptChainValid: true };
        }
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(reads).toBe(3);
    expect(result).toMatchObject({ outcome: "completed", completionContract: { status: "passed", childReceiptIds: ["receipt-async"], verifierReceiptIds: ["gvr_async"] } });
  });

  it("terminalises a permanently missing child receipt as classified failed-safe evidence", async () => {
    const binding = governedJobs("continuous-marketing-digest-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    value.store.close();
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-04T07:30:00.000Z"),
      schedulerPath: value.path,
      completionPollAttempts: 2,
      completionPollIntervalMs: 0,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") return { run: { runId: "run-missing-receipt", status: "completed" } };
        if (route === "/api/graphs/runs/run-missing-receipt") return { run: { runId: "run-missing-receipt", status: "completed" }, approvals: [], liveCapability: null, externalEffects: [], childRunReceipts: [], eventChainValid: true };
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(result).toMatchObject({ outcome: "completion_contract_failed", providerWrites: 0, completionContract: { status: "terminal", recoverySafe: true, childReceiptIds: [] } });
    expect((result.completionContract as any).chainValidationReasons).toContain("sealed terminal state not observed before bounded polling limit");
    const reopened = new GraphSchedulerStore(value.path);
    expect(reopened.triggers(binding.item.declaration.migrationId)).toMatchObject([{ status: "failed_safe", graphRunId: "run-missing-receipt" }]);
    expect(JSON.parse(reopened.triggers(binding.item.declaration.migrationId)[0]!.failureReason!)).toMatchObject({ type: "graph_scheduler_completion_contract_classified", recoverySafe: true });
    reopened.close();
  });

  it.each([
    ["invalid child receipt chain", { eventChainValid: true, childRunReceiptChainValid: false }, "detail.childRunReceiptChainValid === true"],
    ["invalid event chain", { eventChainValid: false, childRunReceiptChainValid: true }, "detail.eventChainValid === true"],
  ])("classifies %s without accepting completed status alone", async (_name, chainFlags, failedPredicate) => {
    const binding = governedJobs("continuous-marketing-digest-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    value.store.close();
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-04T07:30:00.000Z"),
      schedulerPath: value.path,
      completionPollAttempts: 1,
      completionPollIntervalMs: 0,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") return { run: { runId: `run-${String(failedPredicate).slice(7, 12)}`, status: "completed" } };
        if (route.startsWith("/api/graphs/runs/run-")) return { run: { runId: "run-chain-invalid", status: "completed" }, approvals: [], liveCapability: null, externalEffects: [], childRunReceipts: [{ receiptId: "receipt-chain", status: "succeeded", outcome: "completed", receiptHash: "c".repeat(64) }], ...chainFlags };
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(result).toMatchObject({ outcome: "completion_contract_failed", completionContract: { status: "terminal" } });
    expect((result.completionContract as any).predicates.find((item: any) => item.name === failedPredicate)).toMatchObject({ passed: false });
  });

  it("classifies verifier failure as terminal completion-contract evidence", async () => {
    const binding = governedJobs("continuous-marketing-digest-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    value.store.close();
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-04T07:30:00.000Z"),
      schedulerPath: value.path,
      completionPollAttempts: 1,
      completionPollIntervalMs: 0,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") return { run: { runId: "run-verifier-failed", status: "completed" } };
        if (route === "/api/graphs/runs/run-verifier-failed") return { run: { runId: "run-verifier-failed", status: "completed" }, approvals: [], liveCapability: null, externalEffects: [], childRunReceipts: [{ receiptId: "receipt-verifier", status: "succeeded", outcome: "completed", receiptHash: "d".repeat(64) }], verifierReceipts: [{ verifierReceiptId: "gvr_failed", status: "failed", outcome: "failed", receiptHash: "e".repeat(64) }], eventChainValid: true, childRunReceiptChainValid: true };
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(result).toMatchObject({ outcome: "completion_contract_failed", publicationReport: { verifierResult: "gvr_failed:failed:failed", recoveryResult: "failed_safe_recovery_available" } });
    expect((result.completionContract as any).predicates.find((item: any) => item.name === "verifier receipts accepted")).toMatchObject({ passed: false });
  });

  it("refuses completion when verified effects exceed the portfolio maximum", async () => {
    const binding = governedJobs("continuous-marketing-digest-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    value.store.close();
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-04T07:30:00.000Z"),
      schedulerPath: value.path,
      completionPollAttempts: 1,
      completionPollIntervalMs: 0,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") return { run: { runId: "run-too-many-effects", status: "completed" } };
        if (route === "/api/graphs/runs/run-too-many-effects") return { run: { runId: "run-too-many-effects", status: "completed" }, approvals: [], liveCapability: { capabilityId: "glc_many", status: "consumed" }, externalEffects: [{ state: "effect_verified", providerOperationId: "one" }, { state: "effect_verified", providerOperationId: "two" }], childRunReceipts: [{ receiptId: "receipt-many", status: "succeeded", outcome: "completed", receiptHash: "f".repeat(64) }], eventChainValid: true, childRunReceiptChainValid: true };
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(result).toMatchObject({ outcome: "completion_contract_failed", providerWrites: 2, trigger: { status: "ambiguous" }, publicationReport: { recoveryResult: "recovery_refused_unsafe_or_ambiguous" } });
    expect((result.completionContract as any).predicates.find((item: any) => item.name === "effects.length <= portfolio.maximumExternalWrites")).toMatchObject({ actual: 2, passed: false });
  });

  it("uses the immutable original slot for recovery after the natural window has closed", async () => {
    const binding = governedJobs("campaign-content-factory-shadow-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    const reserved = value.store.reserveTrigger(binding.item.declaration.migrationId, `local:2026-08-04:07:00:${binding.item.declaration.scheduleId}`, "2026-08-04T06:00:00.000Z", "test").trigger;
    value.store.updateTrigger(reserved.triggerId, "preparing", "test", { graphRunId: "run-old-slot" });
    value.store.updateTrigger(reserved.triggerId, "failed_safe", "test", { graphRunId: "run-old-slot", failureReason: "completion_contract_failed" });
    value.store.close();
    let recoveryInput: any;
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      recoveryTriggerId: reserved.triggerId,
      now: new Date("2026-08-04T22:47:00.000Z"),
      schedulerPath: value.path,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs/run-old-slot") return { run: { runId: "run-old-slot", status: "failed" }, liveCapability: null, externalEffects: [], eventChainValid: true, childRunReceiptChainValid: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") { recoveryInput = JSON.parse(String(init.body)); return { run: { runId: "run-old-slot-recovered", status: "completed" } }; }
        if (route === "/api/graphs/runs/run-old-slot-recovered") return { run: { runId: "run-old-slot-recovered", status: "completed" }, approvals: [], liveCapability: null, externalEffects: [], childRunReceipts: [{ receiptId: "receipt-old-slot", status: "succeeded", outcome: "completed_unique_opportunity", receiptHash: "1".repeat(64) }], eventChainValid: true, childRunReceiptChainValid: true };
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(recoveryInput).toMatchObject({ correlationId: `${reserved.triggerId}:attempt:2`, input: { payload: { observedAt: "2026-08-04T06:00:00.000Z" } } });
    expect(result).toMatchObject({ outcome: "completed_unique_opportunity", publicationReport: { recoveryResult: "original_slot_recovered" } });
  });

  it("refuses failed-safe recovery after capability consumption even without a verified effect", async () => {
    const binding = governedJobs("threads-daily-image-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    const reserved = value.store.reserveTrigger(binding.item.declaration.migrationId, `threads:2026-08-04:16:30:${binding.item.declaration.scheduleId}`, "2026-08-04T15:30:00.000Z", "test").trigger;
    value.store.updateTrigger(reserved.triggerId, "preparing", "test", { graphRunId: "run-consumed-no-effect" });
    value.store.updateTrigger(reserved.triggerId, "failed_safe", "test", { graphRunId: "run-consumed-no-effect", failureReason: "ambiguous_capability" });
    value.store.close();
    await expect(executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      recoveryTriggerId: reserved.triggerId,
      schedulerPath: value.path,
      request: async (route) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs/run-consumed-no-effect") return { run: { runId: "run-consumed-no-effect", status: "failed" }, liveCapability: { capabilityId: "glc_consumed", status: "consumed" }, externalEffects: [], eventChainValid: true, childRunReceiptChainValid: true };
        throw new Error(`unexpected fixture route ${route}`);
      },
    })).rejects.toThrow("graph_scheduler_failed_safe_recovery_requires_zero_effects");
  });

  it("honestly marks a zero-write publication with no skip reason as missed", async () => {
    const binding = governedJobs("threads-daily-image-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    value.store.close();
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-04T15:30:00.000Z"),
      schedulerPath: value.path,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") return { run: { runId: "run-missed-zero", status: "completed" } };
        if (route === "/api/graphs/runs/run-missed-zero") return { run: { runId: "run-missed-zero", status: "completed", data: { socialEffect: { action: "publish", outboxId: "candidate-one" } } }, approvals: [], liveCapability: null, externalEffects: [], childRunReceipts: [], assertions: [{ assertionId: "threads-publication-receipted", status: "passed" }], eventChainValid: true, childRunReceiptChainValid: true };
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(result).toMatchObject({ outcome: "completed", providerWrites: 0, publicationReport: { finalClassification: "missed", recoveryRequired: true, candidateId: "candidate-one" } });
    expect(formatGovernedScheduleOutput(result, binding.item.declaration.migrationId)).toContain("Final classification: missed");
  });

  it("reconciles an already-completed original trigger with a corrected terminal notification and no replay", async () => {
    const binding = governedJobs("threads-daily-image-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    const reserved = value.store.reserveTrigger(binding.item.declaration.migrationId, `threads:2026-08-04:16:30:${binding.item.declaration.scheduleId}`, "2026-08-04T15:30:00.000Z", "test").trigger;
    value.store.updateTrigger(reserved.triggerId, "preparing", "test", { graphRunId: "run-completed-original" });
    value.store.updateTrigger(reserved.triggerId, "executing", "test", { graphRunId: "run-completed-original" });
    value.store.updateTrigger(reserved.triggerId, "completed", "test", { graphRunId: "run-completed-original" });
    value.store.close();
    let created = false;
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      recoveryTriggerId: reserved.triggerId,
      now: new Date("2026-08-04T22:47:00.000Z"),
      schedulerPath: value.path,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") { created = true; throw new Error("must not replay completed trigger"); }
        if (route === "/api/graphs/runs/run-completed-original") return { run: { runId: "run-completed-original", status: "completed", data: { socialEffect: { status: "not_ready_before_commit", action: "skip", outboxId: `threads:2026-08-04:16:30:${binding.item.declaration.scheduleId}`, providerWrites: 0 } }, checkpoints: [{ checkpointId: "gcp_done", nodeId: "complete", reason: "completion_verified", stateHash: "2".repeat(64) }] }, approvals: [], liveCapability: null, externalEffects: [], childRunReceipts: [], assertions: [{ assertionId: "threads-publication-receipted", status: "passed" }], eventChainValid: true, childRunReceiptChainValid: true };
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(created).toBe(false);
    expect(result).toMatchObject({ outcome: "completed", trigger: { status: "completed" }, publicationReport: { finalClassification: "legitimate_skip", recoveryResult: "terminal_reconciled_no_replay" } });
    const message = formatGovernedScheduleOutput(result, binding.item.declaration.migrationId);
    expect(message).toContain("Scheduler completion contract: passed");
    expect(message).toContain("Recovery result: terminal_reconciled_no_replay");
    expect(message).not.toBe("completed");
  });

  it("records definition concurrency contention as a deferred zero-write trigger", async () => {
    const binding = governedJobs("continuous-marketing-digest-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    value.store.close();
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-04T07:30:00.000Z"),
      schedulerPath: value.path,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs" && init?.method === "POST") throw new Error("graph_scheduler_http_400:graph_definition_concurrency_exhausted:digest-delivery@1.0.0");
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(result).toMatchObject({ outcome: "deferred", reason: "definition_concurrency_exhausted", providerWrites: 0, eventChainValid: true });
    const reopened = new GraphSchedulerStore(value.path);
    expect(reopened.triggers(binding.item.declaration.migrationId)).toMatchObject([{
      status: "failed_safe",
      graphRunId: undefined,
      failureReason: "deferred:definition_concurrency_exhausted:digest-delivery@1.0.0",
    }]);
    reopened.close();
  });

  it("recovers one failed-safe zero-write Factory slot as a new immutable graph attempt", async () => {
    const binding = governedJobs("campaign-content-factory-shadow-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    const reserved = value.store.reserveTrigger(binding.item.declaration.migrationId, `local:2026-08-04:07:00:${binding.item.declaration.scheduleId}`, "2026-08-04T06:00:00.000Z", "test").trigger;
    value.store.updateTrigger(reserved.triggerId, "preparing", "test", { graphRunId: "run-factory-recovery" });
    value.store.updateTrigger(reserved.triggerId, "failed_safe", "test", { graphRunId: "run-factory-recovery", failureReason: "renderer_contract_failed" });
    value.store.close();

    let recoveryInput: any;
    const completedDetail = () => ({
      run: { runId: "run-factory-recovered", status: "completed" },
      approvals: [],
      liveCapability: null,
      externalEffects: [],
      childRunReceipts: [{ receiptId: "receipt-factory-recovery", status: "succeeded", outcome: "completed_unique_opportunity", receiptHash: "e".repeat(64) }],
      eventChainValid: true,
      childRunReceiptChainValid: true,
    });
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-04T06:00:00.000Z"),
      schedulerPath: value.path,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs/run-factory-recovery") return { run: { runId: "run-factory-recovery", status: "failed" }, liveCapability: null, externalEffects: [] };
        if (route === "/api/graphs/runs" && init?.method === "POST") { recoveryInput = JSON.parse(String(init.body)); return { run: { runId: "run-factory-recovered", status: "completed" } }; }
        if (route === "/api/graphs/runs/run-factory-recovered") return completedDetail();
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(recoveryInput).toMatchObject({
      graphId: "governed-task-execution",
      version: "1.0.0",
      correlationId: `${reserved.triggerId}:attempt:2`,
      input: { payload: { observedAt: "2026-08-04T06:00:00.000Z" } },
    });
    expect(result).toMatchObject({ outcome: "completed_unique_opportunity", providerWrites: 0 });
    const reopened = new GraphSchedulerStore(value.path);
    expect(reopened.trigger(reserved.triggerId)).toMatchObject({ status: "completed", graphRunId: "run-factory-recovered", attemptCount: 2, failureReason: undefined });
    expect(reopened.triggers(binding.item.declaration.migrationId)).toHaveLength(1);
    expect(reopened.eventChainValid(binding.item.declaration.migrationId)).toBe(true);
    reopened.close();
  });

  it("recovers one failed-safe zero-write digest slot even though the portfolio allows one write", async () => {
    const binding = governedJobs("continuous-marketing-digest-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    const reserved = value.store.reserveTrigger(binding.item.declaration.migrationId, `telegram:2026-08-04:08:30:${binding.item.declaration.scheduleId}`, "2026-08-04T07:30:00.000Z", "test").trigger;
    value.store.updateTrigger(reserved.triggerId, "preparing", "test", { graphRunId: "run-digest-stale" });
    value.store.updateTrigger(reserved.triggerId, "failed_safe", "test", { graphRunId: "run-digest-stale", failureReason: "graph_definition_concurrency_exhausted" });
    value.store.close();

    let recoveryInput: any;
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-04T07:30:00.000Z"),
      schedulerPath: value.path,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs/run-digest-stale") return { run: { runId: "run-digest-stale", status: "failed" }, liveCapability: null, externalEffects: [] };
        if (route === "/api/graphs/runs" && init?.method === "POST") { recoveryInput = JSON.parse(String(init.body)); return { run: { runId: "run-digest-recovered", status: "completed" } }; }
        if (route === "/api/graphs/runs/run-digest-recovered") return { run: { runId: "run-digest-recovered", status: "completed" }, approvals: [], liveCapability: { status: "consumed" }, externalEffects: [{ state: "effect_verified", providerOperationId: "telegram-message-one" }], childRunReceipts: [{ receiptId: "receipt-digest", status: "succeeded", outcome: "completed", receiptHash: "d".repeat(64) }], eventChainValid: true, childRunReceiptChainValid: true };
        throw new Error(`unexpected fixture route ${route}`);
      },
    });

    expect(recoveryInput).toMatchObject({
      graphId: "digest-delivery",
      version: "1.0.0",
      correlationId: `${reserved.triggerId}:attempt:2`,
    });
    expect(result).toMatchObject({ outcome: "completed", providerWrites: 1 });
    const reopened = new GraphSchedulerStore(value.path);
    expect(reopened.trigger(reserved.triggerId)).toMatchObject({ status: "completed", graphRunId: "run-digest-recovered", providerObjectId: "telegram-message-one" });
    reopened.close();
  });

  it("resumes a failed-safe digest slot after approval was granted but capability issuance failed", async () => {
    const binding = governedJobs("continuous-marketing-digest-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    const reserved = value.store.reserveTrigger(binding.item.declaration.migrationId, `telegram:2026-08-04:08:30:${binding.item.declaration.scheduleId}`, "2026-08-04T07:30:00.000Z", "test").trigger;
    value.store.updateTrigger(reserved.triggerId, "preparing", "test", { graphRunId: "run-digest-partial", approvalId: "gap_09ce3e7d-2841-444b-aeed-b0dc93c07641" });
    value.store.updateTrigger(reserved.triggerId, "failed_safe", "test", { graphRunId: "run-digest-partial", approvalId: "gap_09ce3e7d-2841-444b-aeed-b0dc93c07641", failureReason: "graph_scheduler_http_400:validation_error" });
    value.store.close();

    let capabilityRequest: any;
    let executeCalls = 0;
    let liveCapabilityIssued = false;
    const approval = {
      approvalId: "gap_09ce3e7d-2841-444b-aeed-b0dc93c07641",
      action: "production.digest-delivery.v1",
      target: "digest-delivery:deliver_notification",
      payloadHash: "a".repeat(64),
      status: "granted",
      expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    };
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-04T07:30:00.000Z"),
      schedulerPath: value.path,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs/run-digest-partial") {
          if (executeCalls > 0) return { run: { runId: "run-digest-partial", status: "completed" }, approvals: [approval], liveCapability: { capabilityId: "glc_digest", status: "consumed" }, externalEffects: [{ state: "effect_verified", providerOperationId: "telegram-message-one" }], childRunReceipts: [{ receiptId: "receipt-digest", status: "succeeded", outcome: "completed", receiptHash: "d".repeat(64) }], eventChainValid: true, childRunReceiptChainValid: true };
          return { run: { runId: "run-digest-partial", status: "waiting_for_approval" }, approvals: [approval], liveCapability: liveCapabilityIssued ? { capabilityId: "glc_digest", status: "prepared" } : null, externalEffects: [], eventChainValid: true, childRunReceiptChainValid: true };
        }
        if (route === "/api/graphs/runs/run-digest-partial/live-capabilities" && init?.method === "POST") { capabilityRequest = JSON.parse(String(init.body)); liveCapabilityIssued = true; return { capability: { capabilityId: "glc_digest", status: "prepared" }, dispatches: [] }; }
        if (route === "/api/graphs/runs/run-digest-partial/resume" && init?.method === "POST") return { run: { runId: "run-digest-partial", status: "running" } };
        if (route === "/api/graphs/runs/run-digest-partial/execute" && init?.method === "POST") { executeCalls += 1; return { run: { runId: "run-digest-partial", status: "completed" } }; }
        throw new Error(`unexpected fixture route ${route}`);
      },
    });

    expect(capabilityRequest).toMatchObject({ approvalId: approval.approvalId });
    expect(executeCalls).toBe(1);
    expect(result).toMatchObject({ outcome: "completed", providerWrites: 1 });
  });

  it("issues a missing capability for a granted digest run recovered as running after restart", async () => {
    const binding = governedJobs("continuous-marketing-digest-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    const reserved = value.store.reserveTrigger(binding.item.declaration.migrationId, `telegram:2026-08-04:08:30:${binding.item.declaration.scheduleId}`, "2026-08-04T07:30:00.000Z", "test").trigger;
    value.store.updateTrigger(reserved.triggerId, "failed_safe", "test", { graphRunId: "run-digest-restart", approvalId: "gap_09ce3e7d-2841-444b-aeed-b0dc93c07641", failureReason: "restart_before_capability_issue" });
    value.store.close();

    let capabilityIssued = false;
    let executeCalls = 0;
    const approval = { approvalId: "gap_09ce3e7d-2841-444b-aeed-b0dc93c07641", status: "granted", expiresAt: new Date(Date.now() + 20 * 60_000).toISOString() };
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-04T07:30:00.000Z"),
      schedulerPath: value.path,
      request: async (route, init) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs/run-digest-restart") {
          if (executeCalls > 0) return { run: { runId: "run-digest-restart", status: "completed" }, approvals: [approval], liveCapability: { capabilityId: "glc_digest", status: "consumed" }, externalEffects: [{ state: "effect_verified", providerOperationId: "telegram-message-one" }], childRunReceipts: [{ receiptId: "receipt-digest", status: "succeeded", outcome: "completed", receiptHash: "d".repeat(64) }], eventChainValid: true, childRunReceiptChainValid: true };
          return { run: { runId: "run-digest-restart", status: "running" }, approvals: [approval], liveCapability: capabilityIssued ? { capabilityId: "glc_digest", status: "prepared" } : null, externalEffects: [], eventChainValid: true, childRunReceiptChainValid: true };
        }
        if (route === "/api/graphs/runs/run-digest-restart/live-capabilities" && init?.method === "POST") { capabilityIssued = true; return { capability: { capabilityId: "glc_digest", status: "prepared" }, dispatches: [] }; }
        if (route === "/api/graphs/runs/run-digest-restart/execute" && init?.method === "POST") { executeCalls += 1; return { run: { runId: "run-digest-restart", status: "completed" } }; }
        throw new Error(`unexpected fixture route ${route}`);
      },
    });

    expect(capabilityIssued).toBe(true);
    expect(result).toMatchObject({ outcome: "completed", providerWrites: 1 });
  });

  it("keeps failed-safe recovery closed when any external effect exists", async () => {
    const binding = governedJobs("campaign-content-factory-shadow-v1");
    const value = await fixture();
    value.store.prepareBoundedMigration({ legacyJob: binding.legacyJob, graphJob: binding.graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    const reserved = value.store.reserveTrigger(binding.item.declaration.migrationId, `local:2026-08-04:07:00:${binding.item.declaration.scheduleId}`, "2026-08-04T06:00:00.000Z", "test").trigger;
    value.store.updateTrigger(reserved.triggerId, "preparing", "test", { graphRunId: "run-factory-unsafe" });
    value.store.updateTrigger(reserved.triggerId, "failed_safe", "test", { graphRunId: "run-factory-unsafe", failureReason: "ambiguous_provider_state" });
    value.store.close();
    await expect(executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-04T06:00:00.000Z"),
      schedulerPath: value.path,
      request: async (route) => {
        if (route === "/api/graphs/health") return { status: "healthy", zeroWriteOnly: true };
        if (route === "/api/graphs/runs/run-factory-unsafe") return { run: { runId: "run-factory-unsafe", status: "failed", checkpoints: [{ checkpointId: "checkpoint-before-dispatch", reason: "after_reconcile_prior_attempt" }] }, liveCapability: null, externalEffects: [{ state: "effect_verified" }] };
        throw new Error(`unexpected fixture route ${route}`);
      },
    })).rejects.toThrow("graph_scheduler_failed_safe_recovery_requires_zero_effects");
    const reopened = new GraphSchedulerStore(value.path);
    expect(reopened.trigger(reserved.triggerId)).toMatchObject({ status: "failed_safe", attemptCount: 2 });
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
      "phase-g-instagram-image-v1": "2026-08-04T04:00:00.000Z",
      "threads-readiness-v1": "2026-08-04T03:30:00.000Z",
      "threads-early-text-v1": "2026-08-04T04:00:00.000Z",
      "threads-daily-image-v1": "2026-08-04T10:30:00.000Z",
      "meta-reply-monitor-v1": "2026-08-04T04:15:00.000Z",
      "campaign-content-factory-shadow-v1": "2026-08-04T04:00:00.000Z",
      "continuous-marketing-digest-v1": "2026-08-04T07:30:00.000Z",
      "instagram-reel-v1": "2026-08-04T22:00:00.000Z",
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
      const result = await executeGovernedSchedule({ migrationId: item.declaration.migrationId, now: new Date(clocks[item.declaration.migrationId]!), schedulerPath: value.path, completionPollAttempts: 1, completionPollIntervalMs: 0, request: async (route, init) => {
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
  }, 20_000);

  it("waits before reserving when the cron engine wakes a governed job slightly early", async () => {
    const binding = governedJobs("meta-reply-monitor-v1");
    const value = await fixture();
    const legacyJob = { id: binding.item.declaration.scheduleId, declarationKey: binding.item.declaration.declarationKey, enabled: true, schedule: { kind: "cron", expr: binding.item.declaration.cronExpression, tz: binding.item.declaration.timezone }, payload: { kind: "command", argv: ["node", "/workspace/legacy.mjs"] } };
    const graphJob = buildGovernedGraphJob(legacyJob, binding.item.declaration.migrationId, "/workspace/orchestrator/scripts/trigger-governed-graph-schedule.ts", "node");
    value.store.prepareBoundedMigration({ legacyJob, graphJob, declaration: binding.item.declaration, actor: "test" });
    value.store.activateMigration(binding.item.declaration.migrationId, "test");
    value.store.close();
    const slept: number[] = [];
    const runId = "run-meta-early-wake";
    let healthCalls = 0;
    let runInput: any;
    const result = await executeGovernedSchedule({
      migrationId: binding.item.declaration.migrationId,
      now: new Date("2026-08-04T03:10:15.000Z"),
      schedulerPath: value.path,
      completionPollAttempts: 1,
      completionPollIntervalMs: 0,
      preSlotSleep: async (ms) => { slept.push(ms); },
      request: async (route, init) => {
        if (route === "/api/graphs/health") { healthCalls += 1; return { status: "healthy", zeroWriteOnly: true }; }
        if (route === "/api/graphs/runs" && init?.method === "POST") { runInput = JSON.parse(String(init.body)); return { run: { runId, status: "completed" } }; }
        if (route === `/api/graphs/runs/${runId}`) return { run: { runId, status: "completed" }, approvals: [], liveCapability: null, externalEffects: [], eventChainValid: true, childRunReceiptChainValid: true };
        throw new Error(`unexpected fixture route ${route}`);
      },
    });
    expect(slept).toEqual([285_000]);
    expect(healthCalls).toBe(2);
    expect(runInput.input.observedAt).toBe("2026-08-04T03:15:00.000Z");
    expect(result).toMatchObject({ outcome: "completed", migrationId: "meta-reply-monitor-v1", providerWrites: 0 });
    const reopened = new GraphSchedulerStore(value.path);
    expect(reopened.triggers(binding.item.declaration.migrationId)).toMatchObject([{ slotId: "meta:2026-08-04:04:15:4de811aa-f213-4cc3-b1aa-6c2cffb6a847", scheduledFor: "2026-08-04T03:15:00.000Z", status: "completed" }]);
    reopened.close();
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
