import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { createGraphRuntime, type GraphRuntime } from "../src/graph/runtime.js";
import { classifyInstagramPublicationEffect, reconcilePriorMetaReplyGraphEffects } from "../src/graph/production-adapters.js";
import { issueOneRunLiveCapability } from "../src/graph/live-capability.js";
import { codingChangeGraph, PRODUCTION_GRAPH_DEFINITION_IDENTITIES } from "../src/graph/workflows.js";
import { compareShadowDecisions, prepareProductionPublishingShadowDecision, type ShadowDecisionEnvelope } from "../src/publishing/shadow-equivalence.js";
import type { AuthorityClass, GraphDefinition } from "../src/graph/types.js";

const REPOSITORY = "/home/oneclickwebsitedesignfactory/.openclaw/workspace/projects/openclaw-operator";
const INTEGRATION = `${REPOSITORY}/config/publishing/production-integration.v1.json`;
const REGISTRY = `${REPOSITORY}/config/publishing/registry.v1.json`;
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function testRuntime(): Promise<GraphRuntime> {
  const root = await mkdtemp(join(tmpdir(), "graph-production-adapters-"));
  const runtime = createGraphRuntime(join(root, "graph.sqlite"));
  cleanups.push(async () => {
    runtime.store.close();
    await rm(root, { recursive: true, force: true });
  });
  return runtime;
}

function request(graphId: string, version: string, input: Record<string, any>, maximum: AuthorityClass = "read_only") {
  return { graphId, version, objective: `Shadow verify ${graphId}`, input, authority: { maximum, grantedBy: "shadow-test" } };
}

function singleAdapterGraph(adapterId: string, authority: AuthorityClass = "read_only", sideEffectClass: AuthorityClass = authority): GraphDefinition {
  const source = codingChangeGraph();
  const execute = structuredClone(source.nodes.find((node) => node.id === "intake")!);
  execute.id = "execute";
  execute.handler = adapterId;
  execute.requiredCapabilities = [adapterId];
  execute.authority = authority;
  execute.sideEffectClass = sideEffectClass;
  execute.idempotencyStrategy = sideEffectClass === "read_only" ? "run_node_payload" : "external_operation";
  execute.possibleOutcomes = ["succeeded", "failed_terminal", "blocked"];
  const complete = structuredClone(source.nodes.find((node) => node.id === "complete")!);
  return {
    ...source,
    graphId: `adapter-fixture-${adapterId.replaceAll(".", "-")}`,
    version: "1.0.0",
    description: `Single registered adapter fixture for ${adapterId}`,
    nodes: [execute, complete],
    edges: [
      { from: "execute", to: "complete", on: "succeeded" },
      { from: "execute", to: "complete", on: "failed_terminal" },
      { from: "execute", to: "complete", on: "blocked" },
    ],
    entryNodeId: "execute",
    terminalNodeIds: ["complete"],
    authorityRequirements: { maximum: authority, approvalsRequiredAtOrAbove: "external_reversible" },
    evidenceRequirements: [],
  };
}

function publishingInput(overrides: Record<string, unknown> = {}) {
  return {
    dryRun: true,
    shadowMode: true,
    adapterInputs: {
      "production.publishing-shadow-decision.v1": {
        integrationPath: INTEGRATION,
        registryPath: REGISTRY,
        opportunityId: "self-id-0500",
        observedAt: "2026-08-01T05:00:00+01:00",
        shadowMode: true,
        ...overrides,
      },
    },
  };
}

describe("production adapter registry", () => {
  it("distinguishes a preparatory Instagram media upload from the publication effect", () => {
    expect(classifyInstagramPublicationEffect({
      status: "blocked",
      providerResultId: null,
      permalink: null,
      generatedMediaUploadCalls: 1,
      instagramPublishCalls: 0,
      browserRelayCalls: 0,
    })).toBe("confirmed_absent");
    expect(classifyInstagramPublicationEffect({
      status: "blocked",
      providerResultId: "unexpected-provider-id",
      permalink: null,
      generatedMediaUploadCalls: 1,
      instagramPublishCalls: 0,
      browserRelayCalls: 0,
    })).toBe("ambiguous");
    expect(classifyInstagramPublicationEffect({
      status: "verified",
      providerResultId: "provider-id",
      permalink: "https://www.instagram.com/p/provider-id/",
      generatedMediaUploadCalls: 1,
      instagramPublishCalls: 1,
      browserRelayCalls: 0,
    })).toBe("effect_verified");
  });

  it("reconciles prior Meta ambiguity from canonical receipt evidence before a new dispatch", async () => {
    const runtime = await testRuntime();
    const prior = runtime.engine.start({
      graphId: "meta-reply-monitor",
      version: "1.0.0",
      objective: "Prior Meta reply ambiguity",
      input: {
        provider: "meta",
        accountKey: "meta:owner",
        jobId: "4de811aa-f213-4cc3-b1aa-6c2cffb6a847",
        observedAt: "2026-08-08T11:15:00+01:00",
        shadowMode: false,
        maximumProviderMutations: 1,
      },
      authority: { maximum: "external_public", grantedBy: "fixture" },
    });
    const outboxId = "meta-reply-monitor-20260808T1015Z";
    const effectId = "gex_prior_meta_ambiguity";
    runtime.store.saveRun({
      ...prior,
      data: { ...prior.data, socialEffect: { outboxId, status: "prepared_reply" } },
      externalEffects: [{
        effectId,
        runId: prior.runId,
        nodeId: "perform_exact_effect",
        idempotencyKey: "prior-meta-idempotency",
        operationType: "production.meta-reply-live.v1",
        target: "meta-comment-one",
        payloadHash: "a".repeat(64),
        state: "ambiguous",
        lastObservedAt: "2026-08-08T10:17:00.000Z",
        evidenceRefs: [],
      }],
    }, prior.revision, []);
    const receiptHash = "b".repeat(64);
    const reconciled = await reconcilePriorMetaReplyGraphEffects(runtime.store, {
      runMonitor: async () => ({ entry: {} }),
      executePreparedReply: async () => ({ entry: {} }),
      reconcileReceiptOnly: async () => ({ entry: {
        status: "confirmed_failure",
        providerReconciled: true,
        externalWriteCount: 0,
        reconciliationReceiptPath: "/canonical/meta-reconciliation.json",
        reconciliationReceiptSha256: receiptHash,
      } }),
    }, { target: "meta-comment-one" });
    expect(reconciled).toEqual([{
      runId: prior.runId,
      effectId,
      outboxId,
      state: "confirmed_absent",
    }]);
    expect(runtime.store.externalEffects(prior.runId)).toEqual([
      expect.objectContaining({ effectId, state: "confirmed_absent", evidenceRefs: ["/canonical/meta-reconciliation.json", receiptHash] }),
    ]);
    expect(runtime.store.getRun(prior.runId)?.externalEffects).toEqual([
      expect.objectContaining({ effectId, state: "confirmed_absent" }),
    ]);
  });

  it("loads exactly the policy-supported production graph portfolio", async () => {
    const root = await mkdtemp(join(tmpdir(), "graph-production-policy-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const supported = [...PRODUCTION_GRAPH_DEFINITION_IDENTITIES];
    const runtime = createGraphRuntime(join(root, "accepted.sqlite"), {
      allowedDefinitions: supported,
      productionLoadPolicy: true,
    });
    expect(runtime.registry.list().map((item) => `${item.graphId}@${item.version}`).sort()).toEqual(supported.sort());
    runtime.scheduler.close();
    runtime.store.close();

    expect(() => createGraphRuntime(join(root, "missing.sqlite"), {
      allowedDefinitions: supported.slice(1),
      productionLoadPolicy: true,
    })).toThrow("graph_production_load_policy_mismatch");
    expect(() => createGraphRuntime(join(root, "unsupported.sqlite"), {
      allowedDefinitions: [...supported, "experimental-graph@0.1.0"],
      productionLoadPolicy: true,
    })).toThrow("graph_production_load_policy_mismatch");
  });

  it("keeps the checked-in systemd production allowlist equal to the code portfolio", async () => {
    const dropIn = await readFile(join(REPOSITORY, "systemd", "orchestrator-graph-zero-write-canary.conf"), "utf8");
    const match = dropIn.match(/^Environment=OPENCLAW_GRAPH_ALLOWED_DEFINITIONS=(.+)$/m);
    expect(match?.[1]?.split(",").sort()).toEqual([...PRODUCTION_GRAPH_DEFINITION_IDENTITIES].sort());
  });

  it("exposes only explicit allowlisted production adapters", async () => {
    const runtime = await testRuntime();
    expect(runtime.adapters.list().map((item) => item.adapterId).sort()).toEqual([
      "production.agent-child-run.v1",
      "production.digest-delivery.v1",
      "production.governed-task-dispatch.v1",
      "production.instagram-publication-live.v2",
      "production.instagram-publication-prepare.v2",
      "production.instagram-publication-readback.v2",
      "production.meta-reply-live.v1",
      "production.meta-reply-prepare.v1",
      "production.meta-reply-readback.v1",
      "production.publishing-shadow-decision.v1",
      "production.repo-command.v1",
      "production.repo-inspect.v1",
      "production.research-evidence.v1",
      "production.threads-publication-live.v1",
      "production.threads-publication-prepare.v1",
      "production.threads-publication-readback.v1",
      "production.threads-readiness-prepare.v1",
    ]);
    expect(() => runtime.adapters.resolve("production.unregistered.v1")).toThrow("production_adapter_not_registered");
    const unknown = singleAdapterGraph("production.unregistered.v1");
    expect(() => runtime.engine.register(unknown)).toThrow("production_adapter_not_registered");
  });

  it("completes injected Threads and Meta shadows without reaching their live effect adapters", async () => {
    const root = await mkdtemp(join(tmpdir(), "graph-social-stage-fixtures-"));
    const threadsPath = join(root, "threads-fixture.mjs");
    const metaPath = join(root, "meta-fixture.mjs");
    await writeFile(threadsPath, `export async function runOpportunity(){ return { entry: { id: "threads:2026-08-04:05:00:fixture", status: "prepared", selection: { text: "Exact prepared Threads fixture", approval: { approvalId: "fixture-approval" } }, externalWriteCount: 0 } }; }\nexport async function reconcileOutboxEntry(){ throw new Error("live readback must be unreachable in shadow"); }\n`);
    await writeFile(metaPath, `export async function runMonitor(){ return { entry: { id: "meta-reply-monitor-20260804T0115Z", runId: "meta-reply-monitor-20260804T0115Z", status: "prepared_reply", draft: "Exact prepared reply fixture", selectedCandidate: { id: "candidate-one", platform: "threads" }, externalWriteCount: 0 } }; }\nexport async function executePreparedReply(){ throw new Error("live reply must be unreachable in shadow"); }\nexport async function reconcileReceiptOnly(){ throw new Error("live readback must be unreachable in shadow"); }\n`);
    const priorThreads = process.env.OPENCLAW_THREADS_RUNNER_PATH;
    const priorMeta = process.env.OPENCLAW_META_REPLY_RUNNER_PATH;
    process.env.OPENCLAW_THREADS_RUNNER_PATH = threadsPath;
    process.env.OPENCLAW_META_REPLY_RUNNER_PATH = metaPath;
    cleanups.push(async () => {
      if (priorThreads === undefined) delete process.env.OPENCLAW_THREADS_RUNNER_PATH; else process.env.OPENCLAW_THREADS_RUNNER_PATH = priorThreads;
      if (priorMeta === undefined) delete process.env.OPENCLAW_META_REPLY_RUNNER_PATH; else process.env.OPENCLAW_META_REPLY_RUNNER_PATH = priorMeta;
      await rm(root, { recursive: true, force: true });
    });
    const runtime = await testRuntime();
    const inputs = [
      { graphId: "threads-publication", provider: "threads", accountKey: "threads:owner", jobId: "68b10c5c-f604-4567-9213-d0d1eab08106" },
      { graphId: "meta-reply-monitor", provider: "meta", accountKey: "meta:owner", jobId: "4de811aa-f213-4cc3-b1aa-6c2cffb6a847" },
    ];
    for (const input of inputs) {
      const run = runtime.engine.start({ graphId: input.graphId, version: "1.0.0", objective: `Shadow ${input.graphId}`, input: { provider: input.provider, accountKey: input.accountKey, jobId: input.jobId, observedAt: "2026-08-04T01:15:00+01:00", shadowMode: true, maximumProviderMutations: 1 }, authority: { maximum: "external_public", grantedBy: "fixture" } });
      const completed = await runtime.engine.runUntilSettled(run.runId);
      expect(completed.status).toBe("completed");
      expect(completed.externalEffects).toEqual([]);
      expect(completed.evidence.map((item) => item.kind)).toEqual(expect.arrayContaining(["social-preparation-receipt", "zero-provider-writes"]));
      expect((completed.data.socialEffect as any).action).toBe("shadow");
    }
  });

  it("turns Meta read-side provider discovery failures into zero-write terminal skips", async () => {
    const root = await mkdtemp(join(tmpdir(), "graph-meta-provider-skip-"));
    const metaPath = join(root, "meta-provider-failure.mjs");
    await writeFile(metaPath, `export async function runMonitor(){ throw new Error("Provider request failed with HTTP 400"); }\nexport async function executePreparedReply(){ throw new Error("live reply must be unreachable after discovery skip"); }\nexport async function reconcileReceiptOnly(){ throw new Error("live readback must be unreachable after discovery skip"); }\n`);
    const priorMeta = process.env.OPENCLAW_META_REPLY_RUNNER_PATH;
    process.env.OPENCLAW_META_REPLY_RUNNER_PATH = metaPath;
    cleanups.push(async () => {
      if (priorMeta === undefined) delete process.env.OPENCLAW_META_REPLY_RUNNER_PATH; else process.env.OPENCLAW_META_REPLY_RUNNER_PATH = priorMeta;
      await rm(root, { recursive: true, force: true });
    });
    const runtime = await testRuntime();
    const run = runtime.engine.start({
      graphId: "meta-reply-monitor",
      version: "1.0.0",
      objective: "Meta discovery provider skip",
      input: {
        provider: "meta",
        accountKey: "meta:owner",
        jobId: "4de811aa-f213-4cc3-b1aa-6c2cffb6a847",
        observedAt: "2026-08-04T01:15:00+01:00",
        shadowMode: false,
        maximumProviderMutations: 1,
      },
      authority: { maximum: "external_public", grantedBy: "fixture" },
    });
    const completed = await runtime.engine.runUntilSettled(run.runId);
    expect(completed.status).toBe("completed");
    expect(completed.externalEffects).toEqual([]);
    expect(completed.data.socialEffect).toMatchObject({
      status: "provider_discovery_unavailable",
      action: "skip",
      providerWrites: 0,
      browserRelayCalls: 0,
    });
    expect(completed.evidence.map((item) => item.kind)).toEqual(expect.arrayContaining(["social-preparation-receipt", "zero-provider-writes"]));
  });

  it("keeps blocked Instagram preparation terminal and zero-write with the canonical readiness reason", async () => {
    const root = await mkdtemp(join(tmpdir(), "graph-instagram-prep-block-"));
    const runnerPath = join(root, "instagram-prep-block.mjs");
    await writeFile(runnerPath, `export async function runOpportunity(){ return { entry: { id: "instagram:2026-08-05:13:00:24afbb84-457c-41bb-92c9-24a19725e984", status: "blocked", reason: "initial_meta_readiness_failed", recoveryRequired: true, executionFailure: { stage: "reservation", category: "external_or_runtime_readiness_failure", rootCause: "initial_meta_readiness_failed", metaWrites: 0, uploadCalls: 0 }, generatedMediaUploadCalls: 0, instagramPublishCalls: 0, browserRelayCalls: 0 } }; }\nexport async function instagramGraphPublicationProjection(){ throw new Error("projection must not run for blocked preparation"); }\nexport async function bindInstagramGraphPublicationEnvelope(){ throw new Error("live bind must be unreachable"); }\nexport async function releaseInstagramGraphPublicationClaim(){ throw new Error("claim release must be unreachable"); }\nexport async function recordUnhandledInstagramCommittedMiss(){ throw new Error("miss recorder must be unreachable"); }\nexport async function reconcileInstagramOutboxEntry(){ throw new Error("readback must be unreachable"); }\nexport async function readBackVerifiedInstagramGraphPublication(){ throw new Error("readback must be unreachable"); }\n`);
    const prior = process.env.OPENCLAW_INSTAGRAM_PUBLISHER_RUNNER_PATH;
    process.env.OPENCLAW_INSTAGRAM_PUBLISHER_RUNNER_PATH = runnerPath;
    cleanups.push(async () => {
      if (prior === undefined) delete process.env.OPENCLAW_INSTAGRAM_PUBLISHER_RUNNER_PATH; else process.env.OPENCLAW_INSTAGRAM_PUBLISHER_RUNNER_PATH = prior;
      await rm(root, { recursive: true, force: true });
    });
    const runtime = await testRuntime();
    const run = runtime.engine.start({
      graphId: "deterministic-social-publication",
      version: "2.0.0",
      objective: "Instagram blocked preparation fixture",
      input: {
        provider: "instagram",
        accountKey: "instagram:owner",
        expectedAccountId: "17841400000000000",
        jobId: "24afbb84-457c-41bb-92c9-24a19725e984",
        kind: "image",
        observedAt: "2026-08-05T13:00:00+01:00",
        shadowMode: false,
        maximumProviderMutations: 1,
      },
      authority: { maximum: "external_public", grantedBy: "fixture" },
    });
    const completed = await runtime.engine.runUntilSettled(run.runId);
    expect(completed.status).toBe("failed");
    expect(completed.currentNodeId).toBe("complete");
    expect(completed.lastError?.message).toBe("initial_meta_readiness_failed");
    expect(completed.externalEffects).toEqual([]);
    expect(completed.budgets.externalRequestsConsumed).toBe(0);
    expect(completed.data.target).toBe("instagram:2026-08-05:13:00:24afbb84-457c-41bb-92c9-24a19725e984");
    expect(completed.data.publicationLive).toMatchObject({ status: "blocked", providerWrites: 0 });
    expect(completed.evidence.map((item) => item.kind)).toEqual(expect.arrayContaining(["candidate-claim", "zero-provider-writes"]));
  });

  it("requires and consumes one exact capability before an injected Threads provider effect", async () => {
    const root = await mkdtemp(join(tmpdir(), "graph-threads-live-capability-"));
    const runnerPath = join(root, "threads-live-fixture.mjs");
    await writeFile(runnerPath, `const verified = { id: "threads:2026-08-04:05:00:fixture", status: "published_verified", selection: { text: "Exact prepared Threads fixture", approval: { approvalId: "fixture-approval" } }, externalWriteCount: 1, providerResultId: "provider-one", permalink: "https://example.invalid/provider-one" };\nexport async function runOpportunity(_jobId, options){ if(options.prepareOnly) return { entry: { ...verified, status: "prepared", externalWriteCount: 0 } }; await options.graphDispatchGate.reserve("provider_effect", "production.threads-publication-live.v1"); await options.graphDispatchGate.complete("provider_effect", "succeeded", { providerOperationId: "provider-one" }); return { entry: verified }; }\nexport async function reconcileOutboxEntry(){ return { entry: verified }; }\n`);
    const prior = process.env.OPENCLAW_THREADS_RUNNER_PATH;
    process.env.OPENCLAW_THREADS_RUNNER_PATH = runnerPath;
    cleanups.push(async () => { if (prior === undefined) delete process.env.OPENCLAW_THREADS_RUNNER_PATH; else process.env.OPENCLAW_THREADS_RUNNER_PATH = prior; await rm(root, { recursive: true, force: true }); });
    const runtime = await testRuntime();
    const run = runtime.engine.start({ graphId: "threads-publication", version: "1.0.0", objective: "Exact Threads capability fixture", input: { provider: "threads", accountKey: "threads:owner", jobId: "68b10c5c-f604-4567-9213-d0d1eab08106", observedAt: "2026-08-04T05:00:00+01:00", shadowMode: false, maximumProviderMutations: 1 }, authority: { maximum: "external_public", grantedBy: "fixture" } });
    const waiting = await runtime.engine.runUntilSettled(run.runId);
    expect(waiting.status).toBe("waiting_for_approval");
    expect(waiting.currentNodeId).toBe("perform_exact_effect");
    expect(waiting.externalEffects).toEqual([]);
    const approval = runtime.store.approvals(run.runId)[0]!;
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    runtime.engine.decideApproval(run.runId, approval.approvalId, "granted", "fixture", expiresAt);
    const capability = issueOneRunLiveCapability({ store: runtime.store, runId: run.runId, approvalId: approval.approvalId, issuedBy: "fixture", expiresAt, globalZeroWrite: true });
    runtime.engine.resume(run.runId, "fixture");
    const completed = await runtime.engine.runUntilSettled(run.runId);
    expect(completed.status).toBe("completed");
    expect(runtime.store.oneRunLiveCapability(capability.capabilityId)?.status).toBe("consumed");
    expect(runtime.store.liveCapabilityDispatches(capability.capabilityId)).toMatchObject([{ stepId: "provider_effect", dispatchCount: 1, state: "succeeded", providerOperationId: "provider-one" }]);
    expect(runtime.store.externalEffects(run.runId)).toMatchObject([{ state: "effect_verified", providerOperationId: "provider-one" }]);
  });

  it("reconciles an ambiguous Meta reply to confirmed absent without losing the original effect identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "graph-meta-reply-reconciliation-"));
    const runnerPath = join(root, "meta-reply-reconciliation-fixture.mjs");
    await writeFile(runnerPath, `const prepared={id:"meta-reply-monitor-20260804T0115Z",runId:"meta-reply-monitor-20260804T0115Z",status:"prepared_reply",draft:"Exact prepared reply fixture",selectedCandidate:{id:"candidate-one",platform:"threads"},externalWriteCount:0};\nexport async function runMonitor(){return{entry:prepared};}\nexport async function executePreparedReply(_runId,options){await options.graphDispatchGate.reserve("provider_effect","production.meta-reply-live.v1");await options.graphDispatchGate.complete("provider_effect","ambiguous",{outcome:"blocked"});return{entry:{...prepared,status:"blocked",externalWriteCount:1}};}\nexport async function reconcileReceiptOnly(){return{entry:{...prepared,status:"confirmed_failure",providerReconciled:true,externalWriteCount:0,reconciliationReceiptPath:"/canonical/meta-reconciliation.json",reconciliationReceiptSha256:"${"b".repeat(64)}"}};}\n`);
    const prior = process.env.OPENCLAW_META_REPLY_RUNNER_PATH;
    process.env.OPENCLAW_META_REPLY_RUNNER_PATH = runnerPath;
    cleanups.push(async () => { if (prior === undefined) delete process.env.OPENCLAW_META_REPLY_RUNNER_PATH; else process.env.OPENCLAW_META_REPLY_RUNNER_PATH = prior; await rm(root, { recursive: true, force: true }); });
    const runtime = await testRuntime();
    const run = runtime.engine.start({ graphId: "meta-reply-monitor", version: "1.0.0", objective: "Exact Meta reply reconciliation fixture", input: { provider: "meta", accountKey: "meta:owner", jobId: "4de811aa-f213-4cc3-b1aa-6c2cffb6a847", observedAt: "2026-08-04T01:15:00+01:00", shadowMode: false, maximumProviderMutations: 1 }, authority: { maximum: "external_public", grantedBy: "fixture" } });
    const waiting = await runtime.engine.runUntilSettled(run.runId);
    expect(waiting.status).toBe("waiting_for_approval");
    const approval = runtime.store.approvals(run.runId)[0]!;
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    runtime.engine.decideApproval(run.runId, approval.approvalId, "granted", "fixture", expiresAt);
    issueOneRunLiveCapability({ store: runtime.store, runId: run.runId, approvalId: approval.approvalId, issuedBy: "fixture", expiresAt, globalZeroWrite: true });
    runtime.engine.resume(run.runId, "fixture");
    const completed = await runtime.engine.runUntilSettled(run.runId);
    expect(completed.status).toBe("completed");
    expect(runtime.store.externalEffects(run.runId)).toMatchObject([{
      nodeId: "perform_exact_effect",
      operationType: "production.meta-reply-live.v1",
      state: "confirmed_absent",
      evidenceRefs: ["/canonical/meta-reconciliation.json", "b".repeat(64)],
    }]);
  });

  it("binds exact Threads Image media and canonical creative proof into Graph v1 authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "graph-threads-image-capability-"));
    const mediaPath = join(root, "threads-image.png");
    const media = Buffer.from("exact-frozen-threads-image-bytes");
    await writeFile(mediaPath, media);
    const mediaHash = createHash("sha256").update(media).digest("hex");
    const runnerPath = join(root, "threads-image-live-fixture.mjs");
    const entry = {
      id: "threads:2026-08-04:11:30:083e3560-40fd-4487-9d78-674f64866ef7",
      status: "prepared",
      selection: {
        text: "Exact prepared Threads Image fixture",
        mediaType: "IMAGE",
        topicTag: "AI Threads",
        creativeFingerprint: "c".repeat(64),
        approval: { approvalId: "fixture-image-approval" },
      },
      mediaPath,
      mediaSha256: mediaHash,
      rendererReceipt: {
        renderer: { version: "fixture" },
        checks: { fullDecode: true, textFitAndSafeMargins: true, contrast: true },
      },
      externalWriteCount: 0,
    };
    await writeFile(runnerPath, `const prepared=${JSON.stringify(entry)};\nconst verified={...prepared,status:"published_verified",externalWriteCount:1,providerResultId:"provider-image-one",permalink:"https://example.invalid/provider-image-one"};\nexport async function runOpportunity(_jobId,options){if(options.prepareOnly)return{entry:prepared};await options.graphDispatchGate.reserve("delivery_upload","generated_media_delivery_upload");await options.graphDispatchGate.complete("delivery_upload","succeeded",{providerOperationId:"upload-image-one"});await options.graphDispatchGate.reserve("provider_effect","production.threads-publication-live.v1");await options.graphDispatchGate.complete("provider_effect","succeeded",{providerOperationId:"provider-image-one"});return{entry:verified};}\nexport async function reconcileOutboxEntry(){return{entry:verified};}\n`);
    const prior = process.env.OPENCLAW_THREADS_RUNNER_PATH;
    process.env.OPENCLAW_THREADS_RUNNER_PATH = runnerPath;
    cleanups.push(async () => { if (prior === undefined) delete process.env.OPENCLAW_THREADS_RUNNER_PATH; else process.env.OPENCLAW_THREADS_RUNNER_PATH = prior; await rm(root, { recursive: true, force: true }); });
    const runtime = await testRuntime();
    const run = runtime.engine.start({ graphId: "threads-publication", version: "1.0.0", objective: "Exact Threads Image capability fixture", input: { provider: "threads", accountKey: "threads:owner", jobId: "083e3560-40fd-4487-9d78-674f64866ef7", observedAt: "2026-08-04T11:30:00+01:00", shadowMode: false, maximumProviderMutations: 1 }, authority: { maximum: "external_public", grantedBy: "fixture" } });
    const waiting = await runtime.engine.runUntilSettled(run.runId);
    expect(waiting.status).toBe("waiting_for_approval");
    expect(waiting.data.socialEffect).toMatchObject({ topicTag: "AI Threads", mediaHash, mediaBytesHash: mediaHash, creativeFingerprint: "c".repeat(64) });
    const approval = runtime.store.approvals(run.runId)[0]!;
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    runtime.engine.decideApproval(run.runId, approval.approvalId, "granted", "fixture", expiresAt);
    const capability = issueOneRunLiveCapability({ store: runtime.store, runId: run.runId, approvalId: approval.approvalId, issuedBy: "fixture", expiresAt, globalZeroWrite: true });
    expect(capability.mediaHash).toBe(mediaHash);
    runtime.engine.resume(run.runId, "fixture");
    const completed = await runtime.engine.runUntilSettled(run.runId);
    expect(completed.status).toBe("completed");
    expect(runtime.store.liveCapabilityDispatches(capability.capabilityId)).toMatchObject([
      { stepId: "delivery_upload", state: "succeeded", dispatchCount: 1 },
      { stepId: "provider_effect", state: "succeeded", dispatchCount: 1 },
    ]);
  });

  it("requires and consumes one exact capability around a graph-owned digest notification", async () => {
    const runtime = await testRuntime();
    runtime.attachChildDispatcher((request) => ({ taskId: `task-${request.runId}`, completion: Promise.resolve({ status: "succeeded", outcome: "fixture_complete", output: { phase: request.phase }, evidence: { phase: request.phase } }) }));
    const run = runtime.engine.start({ graphId: "digest-delivery", version: "1.0.0", objective: "Exact digest capability fixture", input: { lane: "digest", taskType: "send-digest", agentId: "operations-analyst-agent", ingressId: "digest-slot-one", shadowMode: false, payload: { mode: "fixture" } }, authority: { maximum: "external_reversible", grantedBy: "fixture" } });
    const waiting = await runtime.engine.runUntilSettled(run.runId);
    expect(waiting.status).toBe("waiting_for_approval");
    expect(waiting.currentNodeId).toBe("deliver_notification");
    const approval = runtime.store.approvals(run.runId)[0]!;
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    runtime.engine.decideApproval(run.runId, approval.approvalId, "granted", "fixture", expiresAt);
    const capability = issueOneRunLiveCapability({ store: runtime.store, runId: run.runId, approvalId: approval.approvalId, issuedBy: "fixture", expiresAt, globalZeroWrite: true });
    runtime.engine.resume(run.runId, "fixture");
    const completed = await runtime.engine.runUntilSettled(run.runId);
    expect(completed.status).toBe("completed");
    expect(runtime.store.oneRunLiveCapability(capability.capabilityId)?.status).toBe("consumed");
    expect(runtime.store.liveCapabilityDispatches(capability.capabilityId)).toMatchObject([{ stepId: "notification_effect", dispatchCount: 1, state: "succeeded" }]);
    expect(runtime.store.verifyChildRunReceiptChain(run.runId)).toBe(true);
  });

  it("fails closed when a registered production adapter violates its output schema", async () => {
    const runtime = await testRuntime();
    runtime.adapters.register({
      adapterId: "production.invalid-output.v1", version: "1.0.0", sourceOwner: "test fixture", bindingStatus: "test_only",
      inputSchema: z.object({}).passthrough(), outputSchema: z.object({ accepted: z.literal(true) }).strict(),
      sideEffectClass: "read_only", shadowSafe: true, idempotencyStrategy: "run_node_payload", authority: "read_only", timeoutMs: 60_000,
      retryableFailures: [], evidenceProduced: [], redactedKeys: [],
      execute: async () => ({ outcome: "succeeded", output: { accepted: false } as never }),
    });
    runtime.adapters.bindExecutors(runtime.executors);
    const definition = singleAdapterGraph("production.invalid-output.v1");
    runtime.engine.register(definition);
    const created = runtime.engine.start(request(definition.graphId, definition.version, { shadowMode: true }));
    const result = await runtime.engine.runUntilSettled(created.runId);
    expect(result.status).toBe("failed");
    expect(result.lastError?.category).toBe("tool_contract_error");
  });

  it("rejects a graph node that weakens registered adapter authority or side effects", async () => {
    const runtime = await testRuntime();
    const definition = singleAdapterGraph("production.repo-command.v1", "local_reversible", "local_reversible");
    definition.nodes[0]!.authority = "read_only";
    definition.nodes[0]!.sideEffectClass = "read_only";
    definition.nodes[0]!.idempotencyStrategy = "run_node_payload";
    expect(() => runtime.engine.register(definition)).toThrow(/production_adapter_(side_effect|authority)_downgrade/);
  });

  it("blocks the first mutation when shadow mode reaches a non-shadow-safe adapter", async () => {
    const runtime = await testRuntime();
    let calls = 0;
    runtime.adapters.register({
      adapterId: "production.write-fixture.v1", version: "1.0.0", sourceOwner: "test fixture", bindingStatus: "test_only",
      inputSchema: z.object({}).passthrough(), outputSchema: z.object({ written: z.boolean() }).strict(),
      sideEffectClass: "external_public", shadowSafe: false, idempotencyStrategy: "external_operation", authority: "external_public", timeoutMs: 60_000,
      retryableFailures: [], evidenceProduced: [], redactedKeys: [],
      execute: async () => { calls += 1; return { outcome: "succeeded", output: { written: true } }; },
    });
    runtime.adapters.bindExecutors(runtime.executors);
    const definition = singleAdapterGraph("production.write-fixture.v1", "external_public", "external_public");
    definition.authorityRequirements.approvalsRequiredAtOrAbove = "irreversible";
    runtime.engine.register(definition);
    const created = runtime.engine.start(request(definition.graphId, definition.version, { shadowMode: true }, "external_public"));
    const result = await runtime.engine.runUntilSettled(created.runId);
    expect(calls).toBe(0);
    expect(result.status).toBe("failed");
    expect(result.lastError?.category).toBe("unsafe_operation");
    expect(result.externalEffects).toHaveLength(0);
  });
});

describe("production-bound graph decisions", () => {
  it("restricts a loaded zero-write canary to one graph version and namespace", async () => {
    const root = await mkdtemp(join(tmpdir(), "graph-zero-write-canary-"));
    const runtime = createGraphRuntime(join(root, "graph.sqlite"), { zeroWriteOnly: true, runIdPrefix: "grzwcanary", allowedDefinitions: ["deterministic-social-publication@1.1.0"] });
    cleanups.push(async () => { runtime.store.close(); await rm(root, { recursive: true, force: true }); });
    expect(runtime.registry.list().map((item) => `${item.graphId}@${item.version}`)).toEqual(["deterministic-social-publication@1.1.0"]);
    const created = runtime.engine.start(request("deterministic-social-publication", "1.1.0", { ...publishingInput(), dryRun: false }, "external_public"));
    const blocked = await runtime.engine.runUntilSettled(created.runId);
    expect(blocked.runId).toMatch(/^grzwcanary_/);
    expect(blocked.status).toBe("blocked");
    expect(blocked.currentNodeId).toBe("create_external_container");
    expect(blocked.lastError?.category).toBe("unsafe_operation");
    expect(blocked.externalEffects).toHaveLength(0);
    expect(runtime.store.events(blocked.runId).some((event) => event.type === "graph_blocked" && event.payload.reason === "runtime_zero_write_policy")).toBe(true);
  });

  it("runs bounded canonical Git inspection without changing the repository", async () => {
    const runtime = await testRuntime();
    const definition = singleAdapterGraph("production.repo-inspect.v1");
    runtime.engine.register(definition);
    const created = runtime.engine.start(request(definition.graphId, definition.version, { repositoryPath: REPOSITORY, shadowMode: true }));
    const completed = await runtime.engine.runUntilSettled(created.runId);
    expect(completed.status).toBe("completed");
    expect(completed.externalEffects).toHaveLength(0);
    expect(completed.evidence[0]?.kind).toBe("repository-truth");
  });

  it("matches legacy and graph payload hashes for the same natural publication input", async () => {
    const runtime = await testRuntime();
    const legacy = await prepareProductionPublishingShadowDecision({ integrationPath: INTEGRATION, registryPath: REGISTRY, opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00" });
    const created = runtime.engine.start(request("deterministic-social-publication", "1.1.0", publishingInput()));
    const completed = await runtime.engine.runUntilSettled(created.runId);
    const graph = completed.data.publicationShadow as unknown as ShadowDecisionEnvelope;
    const comparison = compareShadowDecisions({ workflow: "threads-publication", sampleId: "social-eligible-threads-0500", legacy, graph });
    expect(completed.status).toBe("completed");
    expect(completed.externalEffects).toHaveLength(0);
    expect(comparison.equivalent).toBe(true);
    expect(graph.payloadHash).toBe("7df6c0494ceb5b4be46c92db88490a1c884ebd4a2afe7dd54b67eb2f81a08774");
    expect(graph.payloadHash).toBe(legacy.payloadHash);
    expect(graph.idempotencyKey).toBe(legacy.idempotencyKey);
    expect(graph.externalWrites).toBe(0);
  });

  it("never routes an ambiguous provider state to create or publish", async () => {
    const runtime = await testRuntime();
    const created = runtime.engine.start(request("deterministic-social-publication", "1.1.0", publishingInput({ effectState: "ambiguous" })));
    const failed = await runtime.engine.runUntilSettled(created.runId);
    const nodeIds = runtime.store.events(created.runId).map((event) => event.nodeId);
    expect(failed.status).toBe("blocked");
    expect(failed.lastError?.category).toBe("idempotency_conflict");
    expect(nodeIds).not.toContain("create_external_container");
    expect(nodeIds).not.toContain("publish");
    expect(failed.externalEffects).toHaveLength(0);
  });

  it("selects the same production target and idempotency inputs deterministically", async () => {
    const input = { integrationPath: INTEGRATION, registryPath: REGISTRY, opportunityId: "self-id-0700", observedAt: "2026-08-01T07:00:00+01:00" };
    const first = await prepareProductionPublishingShadowDecision(input);
    const second = await prepareProductionPublishingShadowDecision(input);
    expect(second.providerTarget).toEqual(first.providerTarget);
    expect(second.payloadHash).toBe(first.payloadHash);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.externalWrites).toBe(0);
  });
});

describe("shadow equivalence corpus and evidence safety", () => {
  it.each([
    ["social-out-of-slot", { observedAt: "2026-08-01T05:30:00+01:00" }, "blocked"],
    ["social-duplicate", { effectState: "duplicate" }, "blocked"],
    ["social-already-verified", { effectState: "verified" }, "blocked"],
    ["social-ambiguous", { effectState: "ambiguous" }, "blocked"],
    ["social-missing-campaign", { forceMissingCampaign: true }, "blocked"],
    ["social-policy-rejection", { forcePolicyRejection: true }, "blocked"],
    ["social-authority-rejection", { authorityAllowed: false }, "blocked"],
    ["social-malformed-payload", { forceMalformedPayload: true }, "blocked"],
  ])("classifies %s as a zero-write controlled outcome", async (_sampleId, overrides, expected) => {
    const input = { integrationPath: INTEGRATION, registryPath: REGISTRY, opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00", ...overrides };
    const result = await prepareProductionPublishingShadowDecision(input);
    expect(result.graphSafeState).toBe(expected);
    expect(result.externalWrites).toBe(0);
  });

  it("surfaces a semantic mismatch and does not let ignored timestamps conceal payload drift", async () => {
    const legacy = await prepareProductionPublishingShadowDecision({ integrationPath: INTEGRATION, registryPath: REGISTRY, opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00" });
    const graph = structuredClone(legacy);
    graph.trigger.observedAt = "ignored-time";
    graph.payload = { ...graph.payload, text: "materially changed" };
    const comparison = compareShadowDecisions({ workflow: "threads-publication", sampleId: "semantic-mismatch-fixture", legacy, graph, ignoredFields: ["trigger.observedAt"], mismatchClassification: { category: "test_fixture_defect", risk: "low", disposition: "expected_negative_control_detected" } });
    expect(comparison.equivalent).toBe(false);
    expect(comparison.mismatch?.differingFields).toContain("payload.text");
    expect(comparison.mismatch?.category).toBe("test_fixture_defect");
  });

  it("redacts secret-bearing keys from persisted graph state and events", async () => {
    const runtime = await testRuntime();
    const created = runtime.engine.start(request("research-to-action", "1.0.0", { sources: [], claims: [], apiToken: "sentinel-secret-value" }));
    await runtime.engine.runUntilSettled(created.runId);
    const persisted = JSON.stringify(runtime.store.getRun(created.runId));
    const events = JSON.stringify(runtime.store.events(created.runId));
    expect(persisted).not.toContain("sentinel-secret-value");
    expect(events).not.toContain("sentinel-secret-value");
    expect(persisted).toContain("[REDACTED]");
  });

  it("rejects unsupported claims, low-quality sources, and detects identical result sets", async () => {
    const runtime = await testRuntime();
    const executor = runtime.executors.get("production.research-evidence.v1");
    const definition = runtime.registry.get("research-to-action", "1.1.0");
    const node = definition.nodes.find((candidate) => candidate.id === "extract")!;
    const run = runtime.engine.start(request("research-to-action", "1.1.0", { sources: [], claims: [] }));
    const context = { definition, node, run, attemptId: "fixture-attempt", attemptNumber: 1, idempotencyKey: "fixture-key", signal: new AbortController().signal };
    const rejected = await executor({ ...context, run: { ...run, input: { sources: [{ id: "source-1", uri: "fixture://source", quality: "rejected" }], claims: [{ id: "claim-1", sourceRefs: ["source-1"] }] } } });
    expect(rejected.outcome).toBe("failed_terminal");
    expect(rejected.failure?.category).toBe("verification_failed");
    const sources = [{ id: "source-1", uri: "fixture://source", quality: "accepted" }];
    const claims = [{ id: "claim-1", sourceRefs: ["source-1"] }];
    const accepted = await executor({ ...context, run: { ...run, input: { sources, claims } } });
    const repeated = await executor({ ...context, run: { ...run, input: { sources, claims, resultSetHash: accepted.output.resultSetHash } } });
    expect(repeated.output.marginalInformationGain).toBe(0);
  });
});
