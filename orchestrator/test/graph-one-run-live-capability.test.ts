import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApprovalPayloadHash } from "../src/graph/authority.js";
import { GraphExecutor, NodeExecutorRegistry } from "../src/graph/engine.js";
import {
  expectedCapabilityBindings,
  issueOneRunLiveCapability,
  LIVE_CAPABILITY_AWARE_HANDLER,
} from "../src/graph/live-capability.js";
import {
  buildFrozenPublicationEnvelope,
  frozenEnvelopeHash,
  PublicationProjectionSchema,
  type FrozenPublicationEnvelope,
} from "../src/graph/live-publication.js";
import { sha256 } from "../src/graph/reducer.js";
import { createGraphRuntime, type GraphRuntime } from "../src/graph/runtime.js";
import type { GraphRunState, JsonValue, NodeExecutionContext, OneRunLiveCapability } from "../src/graph/types.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function runtime(): Promise<GraphRuntime> {
  const root = await mkdtemp(join(tmpdir(), "graph-live-capability-"));
  const value = createGraphRuntime(join(root, "graph.sqlite"), { zeroWriteOnly: true });
  cleanups.push(async () => { value.store.close(); await rm(root, { recursive: true, force: true }); });
  return value;
}

function projection(now: Date) {
  const date = now.toISOString().slice(0, 10);
  return PublicationProjectionSchema.parse({
    outboxId: `instagram:reel:${date}:11:30:2c7071ff-35dd-40d0-bf77-b1ed53de256e`,
    provider: "instagram",
    accountKey: "instagram:owner",
    representedAccountId: "17841453638630920",
    jobId: "2c7071ff-35dd-40d0-bf77-b1ed53de256e",
    kind: "reel",
    publicationType: "REELS",
    localDate: date,
    slot: "11:30",
    candidateId: `candidate-${date}`,
    campaignId: "campaign-one-run",
    sequenceId: "sequence-one-run",
    policyVersion: "1.0.0",
    caption: "Exact payload-bound publication.",
    payloadSha256: sha256("Exact payload-bound publication."),
    mediaPath: "/safe/frozen.mp4",
    mediaSha256: "a".repeat(64),
    mediaSizeBytes: 1234,
    mimeType: "video/mp4",
    contentSpecSha256: "b".repeat(64),
    materialContentSha256: "c".repeat(64),
    storyboardSha256: "d".repeat(64),
    creativeFingerprint: "e".repeat(64),
    rendererVersion: "0.10.2",
    claim: null,
    providerResultId: null,
    permalink: null,
    status: "render_validated",
    verification: null,
    generatedMediaUploadCalls: 0,
    instagramPublishCalls: 0,
    browserRelayCalls: 0,
  });
}

type Fixture = {
  run: GraphRunState;
  envelope: FrozenPublicationEnvelope;
  approvalId: string;
  capability?: OneRunLiveCapability;
};

function prepareFixture(value: GraphRuntime, options: { issue?: boolean; now?: Date } = {}): Fixture {
  const now = options.now ?? new Date();
  const definition = value.registry.get("deterministic-social-publication", "2.0.0");
  const input = {
    provider: "instagram" as const,
    accountKey: "instagram:owner" as const,
    expectedAccountId: "17841453638630920",
    jobId: "2c7071ff-35dd-40d0-bf77-b1ed53de256e" as const,
    kind: "reel" as const,
    observedAt: now.toISOString(),
    shadowMode: false,
    maximumProviderMutations: 1 as const,
  };
  const created = value.engine.start({
    graphId: definition.graphId,
    version: definition.version,
    objective: "Publish one exact payload",
    input,
    authority: { maximum: "external_public", grantedBy: "fixture" },
  });
  const context = {
    definition,
    node: definition.nodes.find((node) => node.id === "acquire_durable_candidate_claim")!,
    run: created,
    attemptId: "fixture",
    attemptNumber: 1,
    idempotencyKey: "fixture",
    effectPayloadHash: sha256({ fixture: true }),
    signal: new AbortController().signal,
  } satisfies NodeExecutionContext;
  const initialProjection = projection(now);
  const envelope = buildFrozenPublicationEnvelope(context, input, initialProjection);
  const claim = {
    status: "approved",
    claimId: envelope.claimId,
    runId: created.runId,
    definition: "deterministic-social-publication@2.0.0",
    definitionHash: envelope.definitionHash,
    leaseExpiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    approvalId: envelope.approvalId,
  };
  const data = {
    target: envelope.providerTarget,
    publicationLive: {
      projection: { ...initialProjection, claim },
      envelope,
      envelopeHash: frozenEnvelopeHash(envelope),
    },
  };
  let run = value.store.saveRun({
    ...created,
    status: "waiting_for_approval",
    currentNodeId: "publish_provider_object",
    data: data as unknown as Record<string, JsonValue>,
    updatedAt: now.toISOString(),
  }, created.revision, [{ type: "fixture_envelope_frozen", nodeId: "publish_provider_object", payload: {} }]);
  const payloadHash = buildApprovalPayloadHash({ objective: run.objective, input: run.input, data: run.data });
  value.store.requestApproval({
    approvalId: envelope.approvalId,
    runId: run.runId,
    graphVersion: run.graphVersion,
    nodeId: "publish_provider_object",
    action: LIVE_CAPABILITY_AWARE_HANDLER,
    target: envelope.providerTarget,
    payloadHash,
    status: "pending",
    requestedAt: now.toISOString(),
    decidedAt: null,
    expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
    approver: null,
    note: null,
  });
  value.engine.decideApproval(
    run.runId,
    envelope.approvalId,
    "granted",
    "fixture-admin",
    new Date(now.getTime() + 25 * 60_000).toISOString(),
  );
  run = value.engine.resume(run.runId, "fixture-admin");
  const capability = options.issue === false ? undefined : issueOneRunLiveCapability({
    store: value.store,
    runId: run.runId,
    approvalId: envelope.approvalId,
    issuedBy: "fixture-admin",
    notBefore: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    globalZeroWrite: true,
    now,
  });
  return { run: value.store.getRun(run.runId)!, envelope, approvalId: envelope.approvalId, capability };
}

function testExecutor(value: GraphRuntime, mutateExpected?: (expected: ReturnType<typeof expectedCapabilityBindings>) => ReturnType<typeof expectedCapabilityBindings>) {
  const executors = new NodeExecutorRegistry();
  let providerMutations = 0;
  executors.register(LIVE_CAPABILITY_AWARE_HANDLER, async (context) => {
    const capability = value.store.oneRunLiveCapabilityForRun(context.run.runId)!;
    const publicationLive = context.run.data.publicationLive as unknown as { envelope: FrozenPublicationEnvelope; envelopeHash: string };
    let expected = expectedCapabilityBindings({
      runId: context.run.runId,
      approvalId: context.approval!.approvalId,
      approvalPayloadHash: context.approval!.payloadHash,
      envelope: publicationLive.envelope,
      envelopeHash: publicationLive.envelopeHash,
    });
    if (mutateExpected) expected = mutateExpected(expected);
    const effect = value.store.externalEffects(context.run.runId)[0]!;
    value.store.reserveLiveCapabilityDispatch({ capabilityId: capability.capabilityId, stepId: "delivery_upload", expectedOperation: "generated_media_delivery_upload", effectId: effect.effectId, expected, globalZeroWrite: true, actor: "fixture-adapter" });
    providerMutations += 1;
    value.store.completeLiveCapabilityDispatch({ capabilityId: capability.capabilityId, stepId: "delivery_upload", state: "succeeded", providerOperationId: "upload-1", actor: "fixture-adapter" });
    value.store.reserveLiveCapabilityDispatch({ capabilityId: capability.capabilityId, stepId: "instagram_publish", expectedOperation: "relay_live_business_engagement_execute:publish", effectId: effect.effectId, expected, globalZeroWrite: true, actor: "fixture-adapter" });
    providerMutations += 1;
    value.store.completeLiveCapabilityDispatch({ capabilityId: capability.capabilityId, stepId: "instagram_publish", state: "succeeded", providerOperationId: "provider-1", actor: "fixture-adapter" });
    return {
      outcome: "succeeded" as const,
      output: { providerResultId: "provider-1" },
      externalEffect: {
        idempotencyKey: context.idempotencyKey,
        operationType: LIVE_CAPABILITY_AWARE_HANDLER,
        target: publicationLive.envelope.providerTarget,
        payloadHash: context.effectPayloadHash,
        state: "effect_verified" as const,
        providerOperationId: "provider-1",
      },
    };
  });
  const engine = new GraphExecutor(value.registry, value.store, executors, undefined, undefined, { zeroWriteOnly: true });
  return { engine, providerMutations: () => providerMutations };
}

describe("payload-bound one-run live capability", () => {
  it("keeps the global runtime zero-write and blocks a run without a capability", async () => {
    const value = await runtime();
    const fixture = prepareFixture(value, { issue: false });
    const executor = testExecutor(value);
    const blocked = await executor.engine.step(fixture.run.runId);
    expect(value.zeroWriteOnly).toBe(true);
    expect(blocked.status).toBe("blocked");
    expect(blocked.lastError?.message).toBe("one_run_live_capability_missing");
    expect(executor.providerMutations()).toBe(0);
    expect(value.store.externalEffects(fixture.run.runId)).toHaveLength(0);
  });

  it("reserves both ordered dispatches and consumes authority before the public mutation", async () => {
    const value = await runtime();
    const fixture = prepareFixture(value);
    const executor = testExecutor(value);
    const stepped = await executor.engine.step(fixture.run.runId);
    expect(stepped.status).toBe("running");
    expect(executor.providerMutations()).toBe(2);
    const capability = value.store.oneRunLiveCapability(fixture.capability!.capabilityId)!;
    expect(capability.status).toBe("consumed");
    expect(capability.consumedAt).toBeTruthy();
    expect(value.store.liveCapabilityDispatches(capability.capabilityId)).toEqual([
      expect.objectContaining({ stepId: "delivery_upload", state: "succeeded", dispatchCount: 1 }),
      expect.objectContaining({ stepId: "instagram_publish", state: "succeeded", dispatchCount: 1 }),
    ]);
    const events = value.store.events(fixture.run.runId).map((event) => event.type);
    expect(events.indexOf("external_effect_prepared")).toBeLessThan(events.indexOf("live_capability_dispatch_reserved"));
    expect(events.filter((event) => event === "external_effect_dispatched")).toHaveLength(2);
    expect(value.store.verifyEventChain(fixture.run.runId)).toBe(true);
  });

  it.each([
    ["run", (expected: ReturnType<typeof expectedCapabilityBindings>) => ({ ...expected, graphRunId: "gr_wrong" })],
    ["graph-version", (expected: ReturnType<typeof expectedCapabilityBindings>) => ({ ...expected, graphVersion: "1.1.0" })],
    ["definition-hash", (expected: ReturnType<typeof expectedCapabilityBindings>) => ({ ...expected, graphDefinitionHash: "f".repeat(64) })],
    ["payload", (expected: ReturnType<typeof expectedCapabilityBindings>) => ({ ...expected, payloadHash: "f".repeat(64) })],
    ["media", (expected: ReturnType<typeof expectedCapabilityBindings>) => ({ ...expected, mediaHash: "f".repeat(64) })],
    ["account", (expected: ReturnType<typeof expectedCapabilityBindings>) => ({ ...expected, accountId: "wrong-account" })],
    ["provider", (expected: ReturnType<typeof expectedCapabilityBindings>) => ({ ...expected, provider: "wrong-provider" })],
    ["candidate", (expected: ReturnType<typeof expectedCapabilityBindings>) => ({ ...expected, candidateId: "wrong-candidate" })],
    ["slot", (expected: ReturnType<typeof expectedCapabilityBindings>) => ({ ...expected, slotId: "wrong-slot" })],
    ["approval", (expected: ReturnType<typeof expectedCapabilityBindings>) => ({ ...expected, approvalId: `gap_${"f".repeat(32)}` })],
    ["idempotency", (expected: ReturnType<typeof expectedCapabilityBindings>) => ({ ...expected, idempotencyKeyFingerprint: "f".repeat(64) })],
  ])("rejects a mismatched %s binding before a provider mutation", async (_label, mutate) => {
    const value = await runtime();
    const fixture = prepareFixture(value);
    const executor = testExecutor(value, mutate);
    const stepped = await executor.engine.step(fixture.run.runId);
    expect(stepped.status).toBe("failed");
    expect(executor.providerMutations()).toBe(0);
    expect(value.store.oneRunLiveCapability(fixture.capability!.capabilityId)?.status).toBe("prepared");
  });

  it("rejects expired, revoked, and consumed capabilities without restoring authority", async () => {
    const expiredRuntime = await runtime();
    const expiredAt = new Date(Date.now() - 15 * 60_000);
    const expiredFixture = prepareFixture(expiredRuntime, { now: expiredAt });
    expiredRuntime.store.expireOneRunLiveCapabilities(new Date(), "fixture-expiry");
    const expiredExecutor = testExecutor(expiredRuntime);
    expect((await expiredExecutor.engine.step(expiredFixture.run.runId)).status).toBe("blocked");
    expect(expiredExecutor.providerMutations()).toBe(0);
    expect(expiredRuntime.store.oneRunLiveCapability(expiredFixture.capability!.capabilityId)?.status).toBe("expired");

    const revokedRuntime = await runtime();
    const revokedFixture = prepareFixture(revokedRuntime);
    revokedRuntime.store.revokeOneRunLiveCapability(revokedFixture.capability!.capabilityId, "fixture-admin", "fixture revocation");
    const revokedExecutor = testExecutor(revokedRuntime);
    expect((await revokedExecutor.engine.step(revokedFixture.run.runId)).status).toBe("blocked");
    expect(revokedExecutor.providerMutations()).toBe(0);

    const consumedRuntime = await runtime();
    const consumedFixture = prepareFixture(consumedRuntime);
    const consumedExecutor = testExecutor(consumedRuntime);
    await consumedExecutor.engine.step(consumedFixture.run.runId);
    const dispatches = consumedRuntime.store.liveCapabilityDispatches(consumedFixture.capability!.capabilityId);
    expect(() => consumedRuntime.store.reserveLiveCapabilityDispatch({
      capabilityId: consumedFixture.capability!.capabilityId,
      stepId: "instagram_publish",
      expectedOperation: "relay_live_business_engagement_execute:publish",
      effectId: consumedRuntime.store.externalEffects(consumedFixture.run.runId)[0]!.effectId,
      expected: expectedCapabilityBindings({
        runId: consumedFixture.run.runId,
        approvalId: consumedFixture.approvalId,
        approvalPayloadHash: consumedRuntime.store.approvals(consumedFixture.run.runId)[0]!.payloadHash,
        envelope: consumedFixture.envelope,
        envelopeHash: frozenEnvelopeHash(consumedFixture.envelope),
      }),
      globalZeroWrite: true,
      actor: "reuse-attempt",
    })).toThrow(/not_usable:consumed|dispatch_exhausted/);
    expect(consumedRuntime.store.liveCapabilityDispatches(consumedFixture.capability!.capabilityId)).toEqual(dispatches);
  });

  it("will not issue authority for an unapproved envelope and issuance does not execute", async () => {
    const value = await runtime();
    const fixture = prepareFixture(value, { issue: false });
    const approval = value.store.approvals(fixture.run.runId)[0]!;
    expect(() => issueOneRunLiveCapability({
      store: value.store,
      runId: fixture.run.runId,
      approvalId: `gap_${"f".repeat(32)}`,
      issuedBy: "fixture-admin",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      globalZeroWrite: true,
    })).toThrow("one_run_live_capability_approval_not_granted");
    const issued = issueOneRunLiveCapability({
      store: value.store,
      runId: fixture.run.runId,
      approvalId: approval.approvalId,
      issuedBy: "fixture-admin",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      globalZeroWrite: true,
    });
    expect(issued.status).toBe("prepared");
    expect(value.store.externalEffects(fixture.run.runId)).toHaveLength(0);
    expect(value.store.getRun(fixture.run.runId)?.status).toBe("running");
  });

  it("keeps a crash-after-dispatch capability consumed across restart and replay", async () => {
    const root = await mkdtemp(join(tmpdir(), "graph-live-capability-restart-"));
    const databasePath = join(root, "graph.sqlite");
    let first: GraphRuntime | undefined;
    let restarted: GraphRuntime | undefined;
    try {
      first = createGraphRuntime(databasePath, { zeroWriteOnly: true });
      const fixture = prepareFixture(first);
      const run = first.store.getRun(fixture.run.runId)!;
      const approval = first.store.approvals(run.runId)[0]!;
      const expected = expectedCapabilityBindings({
        runId: run.runId,
        approvalId: approval.approvalId,
        approvalPayloadHash: approval.payloadHash,
        envelope: fixture.envelope,
        envelopeHash: frozenEnvelopeHash(fixture.envelope),
      });
      const effect = {
        effectId: "gex_restart_fixture",
        runId: run.runId,
        nodeId: "publish_provider_object",
        idempotencyKey: sha256("restart-fixture"),
        operationType: LIVE_CAPABILITY_AWARE_HANDLER,
        target: fixture.envelope.providerTarget,
        payloadHash: approval.payloadHash,
        state: "request_prepared" as const,
        evidenceRefs: [approval.approvalId],
      };
      first.store.saveRun({ ...run, externalEffects: [effect], updatedAt: new Date().toISOString() }, run.revision, [{ type: "external_effect_prepared", nodeId: "publish_provider_object", payload: { effectId: effect.effectId } }]);
      first.store.reserveLiveCapabilityDispatch({ capabilityId: fixture.capability!.capabilityId, stepId: "delivery_upload", expectedOperation: "generated_media_delivery_upload", effectId: effect.effectId, expected, globalZeroWrite: true, actor: "fixture-adapter" });
      first.store.completeLiveCapabilityDispatch({ capabilityId: fixture.capability!.capabilityId, stepId: "delivery_upload", state: "succeeded", providerOperationId: "upload-restart", actor: "fixture-adapter" });
      first.store.reserveLiveCapabilityDispatch({ capabilityId: fixture.capability!.capabilityId, stepId: "instagram_publish", expectedOperation: "relay_live_business_engagement_execute:publish", effectId: effect.effectId, expected, globalZeroWrite: true, actor: "fixture-adapter" });
      expect(first.store.oneRunLiveCapability(fixture.capability!.capabilityId)?.status).toBe("consumed");
      first.store.close();
      first = undefined;

      restarted = createGraphRuntime(databasePath, { zeroWriteOnly: true });
      expect(restarted.store.oneRunLiveCapability(fixture.capability!.capabilityId)?.status).toBe("consumed");
      expect(restarted.store.liveCapabilityDispatches(fixture.capability!.capabilityId).find((item) => item.stepId === "instagram_publish")?.state).toBe("reserved");
      expect(restarted.recovery.blocked).toContain(run.runId);
      expect(restarted.store.replayRun(run.runId)).not.toHaveProperty("liveCapability");
      expect(() => restarted!.store.reserveLiveCapabilityDispatch({ capabilityId: fixture.capability!.capabilityId, stepId: "instagram_publish", expectedOperation: "relay_live_business_engagement_execute:publish", effectId: effect.effectId, expected, globalZeroWrite: true, actor: "restart-reuse" })).toThrow("one_run_live_capability_not_usable:consumed");
    } finally {
      first?.store.close();
      restarted?.store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
