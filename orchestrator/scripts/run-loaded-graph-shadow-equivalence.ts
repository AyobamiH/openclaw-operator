import fs from "node:fs";
import path from "node:path";
import { readApiCredentialReference } from "../src/auth/credential-reference.js";
import {
  compareShadowDecisions,
  prepareProductionPublishingShadowDecision,
  type PublishingShadowInput,
  type ShadowDecisionEnvelope,
} from "../src/publishing/shadow-equivalence.js";

type Sample = {
  sampleId: string;
  opportunityId: string;
  observedAt: string;
  overrides?: Partial<PublishingShadowInput>;
};

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  if (!name?.startsWith("--") || !value) throw new Error("loaded_shadow_invalid_arguments");
  args.set(name, value);
}

const baseUrl = args.get("--base-url");
const credentialFile = args.get("--credential-file");
const outputPath = args.get("--output");
if (!baseUrl || !credentialFile || !outputPath) {
  throw new Error("loaded_shadow_requires_base_url_credential_file_and_output");
}
if (!path.isAbsolute(outputPath)) throw new Error("loaded_shadow_output_must_be_absolute");

const repository = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const integrationPath = `${repository}/config/publishing/production-integration.v1.json`;
const registryPath = `${repository}/config/publishing/registry.v1.json`;
const token = readApiCredentialReference(credentialFile, { requiredRole: "admin" });

const samples: Sample[] = [
  { sampleId: "loaded-threads-eligible-0500", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00" },
  { sampleId: "loaded-instagram-eligible-0700", opportunityId: "self-id-0700", observedAt: "2026-08-01T07:00:00+01:00" },
  { sampleId: "loaded-out-of-slot", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:30:00+01:00" },
  { sampleId: "loaded-duplicate", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00", overrides: { effectState: "duplicate" } },
  { sampleId: "loaded-already-verified", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00", overrides: { effectState: "verified" } },
  { sampleId: "loaded-ambiguous", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00", overrides: { effectState: "ambiguous" } },
  { sampleId: "loaded-missing-campaign", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00", overrides: { forceMissingCampaign: true } },
  { sampleId: "loaded-policy-rejection", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00", overrides: { forcePolicyRejection: true } },
  { sampleId: "loaded-authority-rejection", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00", overrides: { authorityAllowed: false } },
  { sampleId: "loaded-malformed-payload", opportunityId: "self-id-0500", observedAt: "2026-08-01T05:00:00+01:00", overrides: { forceMalformedPayload: true } },
];

async function authenticatedJson(route: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* fail below without reflecting response text */ }
  if (!response.ok) throw new Error(`loaded_shadow_http_${response.status}`);
  return { status: response.status, body };
}

const records: Array<Record<string, unknown>> = [];
const existingRunsResponse = await authenticatedJson(
  "/api/graphs/runs?graphId=deterministic-social-publication&limit=250",
);
const existingRuns = Array.isArray(existingRunsResponse.body?.items)
  ? existingRunsResponse.body.items
  : [];
for (const sample of samples) {
  const adapterInput: PublishingShadowInput = {
    integrationPath,
    registryPath,
    opportunityId: sample.opportunityId,
    observedAt: sample.observedAt,
    ...sample.overrides,
  };
  const legacy = await prepareProductionPublishingShadowDecision(adapterInput);
  const objective = `Loaded zero-write equivalence sample ${sample.sampleId}`;
  let run = existingRuns.find((candidate: any) => candidate.objective === objective);
  const reused = Boolean(run);
  if (!run) {
    const response = await authenticatedJson("/api/graphs/runs", {
      method: "POST",
      body: JSON.stringify({
        graphId: "deterministic-social-publication",
        version: "1.1.0",
        objective,
        input: {
          dryRun: true,
          shadowMode: true,
          adapterInputs: {
            "production.publishing-shadow-decision.v1": { ...adapterInput, shadowMode: true },
          },
        },
        authority: { maximum: "read_only", grantedBy: "loaded-shadow-equivalence" },
      }),
    });
    run = response.body?.run;
  }
  if (!run?.runId?.startsWith("grzwcanary_") || !run?.data?.publicationShadow) {
    throw new Error(`loaded_shadow_invalid_run_contract:${sample.sampleId}`);
  }
  const graph = run.data.publicationShadow as ShadowDecisionEnvelope;
  const comparison = compareShadowDecisions({
    workflow: "deterministic-social-publication",
    sampleId: sample.sampleId,
    legacy,
    graph,
  });
  const observedGraphStatus = run.status;
  if (run.status === "blocked") {
    const cancelled = await authenticatedJson(`/api/graphs/runs/${run.runId}/cancel`, {
      method: "POST",
    });
    run = cancelled.body?.run ?? run;
  }
  const [detail, events, evidence] = await Promise.all([
    authenticatedJson(`/api/graphs/runs/${run.runId}`),
    authenticatedJson(`/api/graphs/runs/${run.runId}/events`),
    authenticatedJson(`/api/graphs/runs/${run.runId}/evidence`),
  ]);
  records.push({
    sampleId: sample.sampleId,
    runId: run.runId,
    reused,
    graphStatus: observedGraphStatus,
    finalGraphStatus: detail.body.run?.status ?? run.status,
    legacyState: legacy.graphSafeState,
    graphState: graph.graphSafeState,
    expectedNextAction: graph.expectedNextAction,
    blockReason: graph.blockReason,
    payloadHash: graph.payloadHash,
    idempotencyKey: graph.idempotencyKey,
    comparisonHash: comparison.comparisonHash,
    equivalent: comparison.equivalent,
    mismatch: comparison.mismatch,
    externalWrites: graph.externalWrites,
    externalEffects: detail.body.externalEffects?.length ?? -1,
    eventCount: events.body.items?.length ?? -1,
    eventChainValid: events.body.chainValid === true && detail.body.eventChainValid === true,
    evidenceCount: evidence.body.items?.length ?? -1,
  });
}

const eligible = records.find((record) => record.sampleId === "loaded-threads-eligible-0500");
if (!eligible) throw new Error("loaded_shadow_negative_control_source_missing");
const controlInput: PublishingShadowInput = {
  integrationPath,
  registryPath,
  opportunityId: "self-id-0500",
  observedAt: "2026-08-01T05:00:00+01:00",
};
const controlLegacy = await prepareProductionPublishingShadowDecision(controlInput);
const controlGraph = structuredClone(controlLegacy);
controlGraph.trigger.observedAt = "ignored-nondeterministic-value";
controlGraph.payload = { ...controlGraph.payload, text: "deliberate semantic negative control" };
const negativeControl = compareShadowDecisions({
  workflow: "deterministic-social-publication",
  sampleId: "loaded-negative-control",
  legacy: controlLegacy,
  graph: controlGraph,
  ignoredFields: ["trigger.observedAt"],
  mismatchClassification: {
    category: "test_fixture_defect",
    risk: "low",
    disposition: "expected_negative_control_detected",
  },
});

const report = {
  schemaVersion: 1,
  graph: "deterministic-social-publication@1.1.0",
  mode: "loaded-production-zero-write",
  generatedAt: new Date().toISOString(),
  samples: records.length,
  equivalent: records.filter((record) => record.equivalent).length,
  unexplainedMismatches: records.filter((record) => !record.equivalent).length,
  providerWrites: records.reduce((total, record) => total + Number(record.externalWrites), 0),
  externalEffects: records.reduce((total, record) => total + Number(record.externalEffects), 0),
  invalidEventChains: records.filter((record) => record.eventChainValid !== true).length,
  negativeControl: {
    detected: !negativeControl.equivalent,
    differingFields: negativeControl.mismatch?.differingFields ?? [],
    category: negativeControl.mismatch?.category ?? null,
  },
  records,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
fs.chmodSync(outputPath, 0o600);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (
  report.samples < 10 || report.equivalent !== report.samples || report.unexplainedMismatches !== 0 ||
  report.providerWrites !== 0 || report.externalEffects !== 0 || report.invalidEventChains !== 0 ||
  !report.negativeControl.detected || !report.negativeControl.differingFields.includes("payload.text")
) process.exitCode = 1;
