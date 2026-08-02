import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { readApiCredentialReference } from "../src/auth/credential-reference.js";
import { frozenEnvelopeHash } from "../src/graph/live-publication.js";
import { LIVE_CAPABILITY_DEFINITION_HASH, LIVE_CAPABILITY_GRAPH_VERSION } from "../src/graph/live-capability.js";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value) throw new Error("phase_f_invalid_arguments");
  args.set(key, value);
}

const action = args.get("--action");
const baseUrl = args.get("--base-url");
const credentialFile = args.get("--credential-file");
const outputPath = args.get("--output");
if (!action || !baseUrl || !credentialFile || !outputPath || !isAbsolute(outputPath)) {
  throw new Error("phase_f_requires_action_base_url_credential_file_and_absolute_output");
}
const token = readApiCredentialReference(credentialFile, { requiredRole: "admin" });

async function request(route: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  let body: any = null;
  try { body = await response.json(); } catch { /* status is sufficient */ }
  if (!response.ok) throw new Error(`phase_f_http_${response.status}:${body?.error ?? "unknown"}`);
  return body;
}

function exactInspection(detail: any): Record<string, unknown> {
  const run = detail?.run;
  const publicationLive = run?.data?.publicationLive;
  const envelope = publicationLive?.envelope;
  if (!run || !envelope) throw new Error("phase_f_frozen_envelope_missing");
  if (run.graphId !== "deterministic-social-publication" || run.graphVersion !== LIVE_CAPABILITY_GRAPH_VERSION || envelope.definitionHash !== LIVE_CAPABILITY_DEFINITION_HASH) throw new Error("phase_f_graph_binding_mismatch");
  const observedEnvelopeHash = frozenEnvelopeHash(envelope);
  if (publicationLive.envelopeHash !== observedEnvelopeHash) throw new Error("phase_f_envelope_hash_mismatch");
  const observedPayloadHash = createHash("sha256").update(envelope.canonicalPayload.caption).digest("hex");
  if (observedPayloadHash !== envelope.payloadSha256) throw new Error("phase_f_payload_hash_mismatch");
  const mediaBytes = readFileSync(envelope.mediaPath);
  const observedMediaHash = createHash("sha256").update(mediaBytes).digest("hex");
  if (observedMediaHash !== envelope.mediaSha256 || mediaBytes.byteLength !== envelope.mediaSizeBytes) throw new Error("phase_f_media_hash_mismatch");
  if (envelope.provider !== "instagram" || envelope.accountId !== "17841453638630920" || envelope.maximumProviderMutations !== 1) throw new Error("phase_f_provider_binding_mismatch");
  return {
    runId: run.runId,
    status: run.status,
    currentNodeId: run.currentNodeId,
    graph: `${run.graphId}@${run.graphVersion}`,
    definitionHash: envelope.definitionHash,
    claimId: envelope.claimId,
    claimStatus: publicationLive.projection?.claim?.status ?? null,
    claimExpiresAt: publicationLive.projection?.claim?.leaseExpiresAt ?? null,
    approvalId: envelope.approvalId,
    approvalExpiry: envelope.approvalExpiry,
    provider: envelope.provider,
    accountId: envelope.accountId,
    candidateId: envelope.candidateId,
    campaignId: envelope.campaignId,
    sequenceId: envelope.sequenceId,
    slotId: envelope.slotId,
    payloadHash: observedPayloadHash,
    mediaHash: observedMediaHash,
    mediaSizeBytes: mediaBytes.byteLength,
    envelopeHash: observedEnvelopeHash,
    envelopeIdempotencyFingerprint: createHash("sha256").update(envelope.idempotencyKey).digest("hex"),
    approvals: detail.approvals?.map((approval: any) => ({ approvalId: approval.approvalId, status: approval.status, action: approval.action, target: approval.target, payloadHash: approval.payloadHash, expiresAt: approval.expiresAt })) ?? [],
    liveCapability: detail.liveCapability ?? null,
    liveCapabilityDispatches: detail.liveCapabilityDispatches ?? [],
    externalEffects: detail.externalEffects ?? [],
    eventChainValid: detail.eventChainValid === true,
  };
}

let result: Record<string, unknown>;
if (action === "prepare") {
  const observedAt = args.get("--observed-at");
  if (!observedAt) throw new Error("phase_f_prepare_requires_observed_at");
  const body = await request("/api/graphs/runs", {
    method: "POST",
    body: JSON.stringify({
      graphId: "deterministic-social-publication",
      version: LIVE_CAPABILITY_GRAPH_VERSION,
      objective: `Phase F one payload-bound Instagram publication ${observedAt}`,
      input: {
        provider: "instagram",
        accountKey: "instagram:owner",
        expectedAccountId: "17841453638630920",
        jobId: "24afbb84-457c-41bb-92c9-24a19725e984",
        kind: "image",
        observedAt,
        shadowMode: false,
        maximumProviderMutations: 1,
      },
      authority: { maximum: "external_public", grantedBy: "phase-f-prompt-2026-08-02" },
    }),
  });
  const detail = await request(`/api/graphs/runs/${body.run.runId}`);
  result = { action, inspection: exactInspection(detail) };
} else {
  const runId = args.get("--run-id");
  if (!runId) throw new Error("phase_f_action_requires_run_id");
  const detail = await request(`/api/graphs/runs/${runId}`);
  const inspection = exactInspection(detail);
  if (action === "inspect") {
    result = { action, inspection };
  } else if (action === "approve") {
    const expiresAt = args.get("--expires-at");
    const approval = detail.approvals?.find((item: any) => item.approvalId === inspection.approvalId);
    if (!expiresAt || !approval || approval.status !== "pending") throw new Error("phase_f_exact_pending_approval_missing");
    const decided = await request(`/api/graphs/runs/${runId}/approvals/${approval.approvalId}`, {
      method: "POST",
      body: JSON.stringify({ decision: "granted", action: approval.action, target: approval.target, payloadHash: approval.payloadHash, expiresAt, note: "Phase F exact payload-bound one-run approval authorised by operator prompt 2026-08-02" }),
    });
    result = { action, inspection, approval: decided.approval };
  } else if (action === "issue") {
    const expiresAt = args.get("--expires-at");
    if (!expiresAt) throw new Error("phase_f_issue_requires_expiry");
    const issued = await request(`/api/graphs/runs/${runId}/live-capabilities`, { method: "POST", body: JSON.stringify({ approvalId: inspection.approvalId, expiresAt }) });
    result = { action, inspection, capability: issued.capability, dispatches: issued.dispatches };
  } else if (action === "execute") {
    if (!detail.liveCapability || detail.liveCapability.status !== "prepared") throw new Error("phase_f_prepared_capability_missing");
    await request(`/api/graphs/runs/${runId}/resume`, { method: "POST" });
    const executed = await request(`/api/graphs/runs/${runId}/execute`, { method: "POST" });
    const finalDetail = await request(`/api/graphs/runs/${runId}`);
    const events = await request(`/api/graphs/runs/${runId}/events`);
    const evidence = await request(`/api/graphs/runs/${runId}/evidence`);
    result = { action, before: inspection, run: executed.run, after: exactInspection(finalDetail), events: { count: events.items?.length ?? 0, chainValid: events.chainValid === true }, evidence: { count: evidence.items?.length ?? 0, items: evidence.items ?? [] } };
  } else if (action === "retry-postwrite-readback") {
    const capability = detail.liveCapability;
    const effect = detail.externalEffects?.find((item: any) => item.state === "effect_verified");
    const checkpoint = detail.run?.checkpoints?.find((item: any) => item.reason === "after_reconcile_publication");
    if (detail.run?.status !== "failed" || capability?.status !== "consumed" || !effect?.providerOperationId || !checkpoint?.checkpointId) {
      throw new Error("phase_f_postwrite_retry_preconditions_failed");
    }
    await request(`/api/graphs/runs/${runId}/checkpoints/${checkpoint.checkpointId}/retry`, { method: "POST" });
    const executed = await request(`/api/graphs/runs/${runId}/execute`, { method: "POST" });
    const finalDetail = await request(`/api/graphs/runs/${runId}`);
    const events = await request(`/api/graphs/runs/${runId}/events`);
    const evidence = await request(`/api/graphs/runs/${runId}/evidence`);
    result = { action, checkpointId: checkpoint.checkpointId, providerOperationId: effect.providerOperationId, run: executed.run, after: exactInspection(finalDetail), events: { count: events.items?.length ?? 0, chainValid: events.chainValid === true }, evidence: { count: evidence.items?.length ?? 0, items: evidence.items ?? [] } };
  } else {
    throw new Error("phase_f_unknown_action");
  }
}

mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
chmodSync(outputPath, 0o600);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
