import { createGraphRuntime } from "../src/graph/runtime.js";
import { compareShadowDecisions, prepareProductionPublishingShadowDecision, type PublishingShadowInput, type ShadowDecisionEnvelope } from "../src/publishing/shadow-equivalence.js";

const repository = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const integrationPath = `${repository}/config/publishing/production-integration.v1.json`;
const registryPath = `${repository}/config/publishing/registry.v1.json`;

const samples: Array<{ sampleId: string; opportunityId: string; observedAt: string; overrides?: Partial<PublishingShadowInput> }> = [
  { sampleId: "social-threads-eligible-0500", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00" },
  { sampleId: "social-instagram-eligible-0700", opportunityId: "self-id-0700", observedAt: "2026-08-01T07:00:00+01:00" },
  { sampleId: "social-out-of-slot", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:30:00+01:00" },
  { sampleId: "social-duplicate", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00", overrides: { effectState: "duplicate" } },
  { sampleId: "social-already-verified", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00", overrides: { effectState: "verified" } },
  { sampleId: "social-ambiguous", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00", overrides: { effectState: "ambiguous" } },
  { sampleId: "social-missing-campaign", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00", overrides: { forceMissingCampaign: true } },
  { sampleId: "social-policy-rejection", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00", overrides: { forcePolicyRejection: true } },
  { sampleId: "social-authority-rejection", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00", overrides: { authorityAllowed: false } },
  { sampleId: "social-malformed-payload", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00", overrides: { forceMalformedPayload: true } },
];

const runtime = createGraphRuntime(":memory:");
const records = [];
try {
  for (const sample of samples) {
    const adapterInput: PublishingShadowInput = { integrationPath, registryPath, opportunityId: sample.opportunityId, observedAt: sample.observedAt, ...sample.overrides };
    const legacy = await prepareProductionPublishingShadowDecision(adapterInput);
    const created = runtime.engine.start({
      graphId: "deterministic-social-publication",
      version: "1.1.0",
      objective: `Zero-write equivalence sample ${sample.sampleId}`,
      input: {
        dryRun: true,
        shadowMode: true,
        adapterInputs: { "production.publishing-shadow-decision.v1": { ...adapterInput, shadowMode: true } },
      },
      authority: { maximum: "read_only", grantedBy: "shadow-equivalence-harness" },
    });
    const settled = await runtime.engine.runUntilSettled(created.runId);
    const graph = settled.data.publicationShadow as unknown as ShadowDecisionEnvelope;
    const comparison = compareShadowDecisions({ workflow: "deterministic-social-publication", sampleId: sample.sampleId, legacy, graph });
    records.push({
      sampleId: sample.sampleId,
      runId: settled.runId,
      graphVersion: settled.graphVersion,
      graphStatus: settled.status,
      legacyState: legacy.graphSafeState,
      graphState: graph.graphSafeState,
      expectedNextAction: graph.expectedNextAction,
      payloadHash: graph.payloadHash,
      idempotencyKey: graph.idempotencyKey,
      comparisonHash: comparison.comparisonHash,
      equivalent: comparison.equivalent,
      mismatch: comparison.mismatch,
      externalWrites: graph.externalWrites,
      externalEffects: settled.externalEffects.length,
      eventChainValid: runtime.store.verifyEventChain(settled.runId),
    });
    if (settled.status === "blocked") runtime.engine.cancel(settled.runId, "shadow-equivalence-harness");
  }
  const unexplainedMismatches = records.filter((record) => !record.equivalent);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    graph: "deterministic-social-publication@1.1.0",
    samples: records.length,
    equivalent: records.filter((record) => record.equivalent).length,
    unexplainedMismatches: unexplainedMismatches.length,
    providerWrites: records.reduce((total, record) => total + record.externalWrites, 0),
    externalEffects: records.reduce((total, record) => total + record.externalEffects, 0),
    records,
  }, null, 2)}\n`);
  if (unexplainedMismatches.length > 0) process.exitCode = 1;
} finally {
  runtime.store.close();
}
