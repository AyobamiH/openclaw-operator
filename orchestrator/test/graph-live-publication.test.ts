import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGraphRuntime, type GraphRuntime } from "../src/graph/runtime.js";
import { boundSocialPublicationGraph, liveCapableSocialPublicationGraph } from "../src/graph/workflows.js";
import { canonicalJson, sha256 } from "../src/graph/reducer.js";
import {
  assertEnvelopeUnchanged,
  buildFrozenPublicationEnvelope,
  frozenEnvelopeHash,
  PublicationProjectionSchema,
} from "../src/graph/live-publication.js";
import type { GraphDefinition, NodeExecutionContext, NodeExecutionResult } from "../src/graph/types.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function runtime(): Promise<GraphRuntime> {
  const root = await mkdtemp(join(tmpdir(), "graph-live-publication-"));
  const value = createGraphRuntime(join(root, "graph.sqlite"));
  cleanups.push(async () => { value.store.close(); await rm(root, { recursive: true, force: true }); });
  return value;
}

function liveInput() {
  return {
    provider: "instagram" as const,
    accountKey: "instagram:owner" as const,
    expectedAccountId: "17841453638630920",
    jobId: "2c7071ff-35dd-40d0-bf77-b1ed53de256e" as const,
    kind: "reel" as const,
    observedAt: "2026-08-01T23:00:00+01:00",
    shadowMode: false,
    maximumProviderMutations: 1 as const,
  };
}

function projection() {
  return PublicationProjectionSchema.parse({
    outboxId: "instagram:reel:2026-08-01:23:00:2c7071ff-35dd-40d0-bf77-b1ed53de256e",
    provider: "instagram", accountKey: "instagram:owner", representedAccountId: "17841453638630920",
    jobId: "2c7071ff-35dd-40d0-bf77-b1ed53de256e", kind: "reel", publicationType: "REELS",
    localDate: "2026-08-01", slot: "23:00", candidateId: "candidate-1", campaignId: "campaign-1", sequenceId: "sequence-1", policyVersion: "1.0.0",
    caption: "Evidence first.", payloadSha256: sha256("Evidence first."), mediaPath: "/safe/frozen.mp4", mediaSha256: "a".repeat(64), mediaSizeBytes: 1234,
    mimeType: "video/mp4", contentSpecSha256: "b".repeat(64), materialContentSha256: "c".repeat(64), storyboardSha256: "d".repeat(64), creativeFingerprint: "e".repeat(64), rendererVersion: "0.10.2",
    layoutVerification: null, layoutVerificationSha256: null,
    claim: { status: "prepared" }, providerResultId: null, permalink: null, status: "render_validated", verification: null,
    generatedMediaUploadCalls: 0, instagramPublishCalls: 0, browserRelayCalls: 0,
  });
}

describe("immutable live-capable publication graph", () => {
  it("preserves the registered 1.1.0 definition while registering 2.0.0 separately", async () => {
    const oldDefinition = boundSocialPublicationGraph();
    const newDefinition = liveCapableSocialPublicationGraph();
    expect(sha256(oldDefinition)).toBe("f4f41c406ff8399c8e10b2012bf06a5dc0357a28f983e73f328cac3a2d3d592c");
    expect(newDefinition.version).toBe("2.0.0");
    expect(sha256(newDefinition)).not.toBe(sha256(oldDefinition));
    expect(newDefinition.migrationCompatibility.compatibleFromVersions).toEqual([]);
    expect(newDefinition.nodes.find((node) => node.id === "publish_provider_object")).toMatchObject({ handler: "production.instagram-publication-live.v2", authority: "external_public", sideEffectClass: "external_public" });
    const value = await runtime();
    expect(value.registry.list().filter((definition) => definition.graphId === "deterministic-social-publication").map((definition) => definition.version)).toEqual(["1.0.0", "1.1.0", "2.0.0"]);
  });

  it("produces one deterministic frozen envelope and rejects changed media bytes", async () => {
    const value = await runtime();
    const definition = value.registry.get("deterministic-social-publication", "2.0.0");
    const run = value.engine.start({ graphId: definition.graphId, version: definition.version, objective: "Freeze one exact publication", input: liveInput(), authority: { maximum: "external_public", grantedBy: "john" } });
    const context = { definition, node: definition.nodes.find((node) => node.id === "acquire_durable_candidate_claim")!, run, attemptId: "fixture", attemptNumber: 1, idempotencyKey: "fixture", effectPayloadHash: sha256({ fixture: true }), signal: new AbortController().signal } satisfies NodeExecutionContext;
    const first = buildFrozenPublicationEnvelope(context, liveInput(), projection());
    const second = buildFrozenPublicationEnvelope(context, liveInput(), projection());
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(frozenEnvelopeHash(first)).toBe(frozenEnvelopeHash(second));
    const changed = buildFrozenPublicationEnvelope(context, liveInput(), { ...projection(), mediaSha256: "f".repeat(64) });
    expect(() => assertEnvelopeUnchanged(first, changed)).toThrow("publication_envelope_immutable_violation");
  });

  it("cannot freeze or approve an image envelope before exact layout verification", async () => {
    const value = await runtime();
    const definition = value.registry.get("deterministic-social-publication", "2.0.0");
    const imageInput = {
      ...liveInput(),
      jobId: "24afbb84-457c-41bb-92c9-24a19725e984" as const,
      kind: "image" as const,
    };
    const run = value.engine.start({ graphId: definition.graphId, version: definition.version, objective: "Freeze one layout-verified image", input: imageInput, authority: { maximum: "external_public", grantedBy: "john" } });
    const context = { definition, node: definition.nodes.find((node) => node.id === "acquire_durable_candidate_claim")!, run, attemptId: "image-fixture", attemptNumber: 1, idempotencyKey: "image-fixture", effectPayloadHash: sha256({ fixture: "image" }), signal: new AbortController().signal } satisfies NodeExecutionContext;
    const missing = PublicationProjectionSchema.parse({
      ...projection(),
      kind: "image",
      jobId: imageInput.jobId,
      publicationType: "FEED",
      mimeType: "image/png",
    });
    expect(() => buildFrozenPublicationEnvelope(context, imageInput, missing)).toThrow(
      "publication_envelope_image_layout_verification_missing",
    );
    const layoutVerification = {
      schema: "tailwagging-image-layout-verification.v1",
      status: "passed",
      finalMediaSha256: missing.mediaSha256,
      sourceTextSha256: "f".repeat(64),
      renderedTextSha256: "f".repeat(64),
    };
    const verified = PublicationProjectionSchema.parse({
      ...missing,
      layoutVerification,
      layoutVerificationSha256: sha256(layoutVerification),
    });
    const envelope = buildFrozenPublicationEnvelope(context, imageInput, verified);
    expect(envelope.layoutVerificationSha256).toBe(sha256(layoutVerification));
    expect(envelope.verificationAssertions).toContain("layout-semantic-completeness");
    expect(envelope.verificationAssertions).toContain("layout-geometric-validity");
  });
});

describe("external-effect intent ordering", () => {
  it("persists request_prepared before invoking a mutating adapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "graph-effect-ordering-"));
    const value = createGraphRuntime(join(root, "graph.sqlite"), { zeroWriteOnly: false });
    cleanups.push(async () => { value.store.close(); await rm(root, { recursive: true, force: true }); });
    const adapterId = "test.effect-ordering";
    let observedState = "missing";
    value.executors.register(adapterId, async (context): Promise<NodeExecutionResult> => {
      observedState = value.store.externalEffects(context.run.runId)[0]?.state ?? "missing";
      return {
        outcome: "succeeded",
        output: { observedState },
        externalEffect: { idempotencyKey: context.idempotencyKey, operationType: "fixture-publication", target: "fixture", payloadHash: context.effectPayloadHash, state: "effect_verified", providerOperationId: "provider-fixture" },
      };
    });
    const source = liveCapableSocialPublicationGraph();
    const definition: GraphDefinition = {
      ...source,
      graphId: "effect-ordering-test",
      version: "1.0.0",
      evidenceRequirements: [],
      authorityRequirements: { maximum: "external_public", approvalsRequiredAtOrAbove: "irreversible" },
      nodes: [
        { ...source.nodes.find((node) => node.id === "publish_provider_object")!, id: "publish", handler: adapterId, requiredCapabilities: [], inputProjection: ["input"], possibleOutcomes: ["succeeded"] },
        { ...source.nodes.find((node) => node.id === "complete")!, id: "complete" },
      ],
      edges: [{ from: "publish", to: "complete", on: "succeeded" }],
      entryNodeId: "publish",
      terminalNodeIds: ["complete"],
      concurrency: { ...source.concurrency, resourceKeys: [] },
    };
    value.engine.register(definition);
    const run = value.engine.start({ graphId: definition.graphId, version: definition.version, objective: "Prove effect ordering", input: { shadowMode: false }, authority: { maximum: "external_public", grantedBy: "test" } });
    const completed = await value.engine.runUntilSettled(run.runId);
    expect(completed.status).toBe("completed");
    expect(observedState).toBe("request_prepared");
    expect(value.store.externalEffects(run.runId)).toEqual([expect.objectContaining({ state: "effect_verified", providerOperationId: "provider-fixture" })]);
    const events = value.store.events(run.runId).map((event) => event.type);
    expect(events.indexOf("external_effect_prepared")).toBeLessThan(events.indexOf("node_output_recorded"));
    expect(events).not.toContain("external_effect_dispatched");
  });
});
