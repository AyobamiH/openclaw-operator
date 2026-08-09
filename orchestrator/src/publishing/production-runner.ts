import { resolve } from "node:path";

import { PublishingConnectorRegistry, WorkerBackedPublishingConnector } from "./connectors.js";
import {
  DeterministicPublishingEngine,
  deterministicRenderedCandidate,
  slotKey,
} from "./engine.js";
import {
  renderedCandidateWithDelivery,
  type CampaignMediaDelivery,
} from "./media-artifact.js";
import {
  gatewayToolInvoker,
  OpenClawOfficialApiWorkerClient,
  type ProductionToolInvoker,
} from "./official-worker.js";
import {
  decideProductionOpportunity,
  loadProductionIntegration,
  opportunityFor,
} from "./production-integration.js";
import { sha256 } from "./canonical.js";
import { loadRegistryBundle } from "./registry.js";
import { PublishingStore } from "./store.js";

export async function runProductionOpportunity(input: {
  integrationPath: string;
  registryPath: string;
  databasePath: string;
  opportunityId: string;
  scheduledFor: Date;
  mode?: "shadow" | "canary" | "live";
  allowProviderWrite?: boolean;
  toolInvoker?: ProductionToolInvoker;
  openclawBin?: string;
  workspace?: string;
  mediaDelivery?: CampaignMediaDelivery | null;
}): Promise<Record<string, unknown>> {
  const registry = await loadRegistryBundle(resolve(input.registryPath));
  const integration = await loadProductionIntegration(
    resolve(input.integrationPath),
    registry,
  );
  const mode = input.mode ?? integration.mode;
  if (mode !== integration.mode) {
    throw new Error(`Runner mode ${mode} does not match approved integration mode ${integration.mode}`);
  }
  const resolution = decideProductionOpportunity(
    integration,
    input.opportunityId,
    input.scheduledFor,
  );
  const store = new PublishingStore(resolve(input.databasePath));
  if (resolution.outcome === "completed_no_eligible_opportunity") {
    try {
      const engine = new DeterministicPublishingEngine(registry, store);
      engine.initialize();
      const key = slotKey(input.scheduledFor);
      const existing = store.slotRuns(500).find((candidate) => candidate.slot_key === key);
      if (existing) {
        if (existing.result !== "completed_no_eligible_opportunity") {
          throw new Error("no_eligible_opportunity_slot_conflicts_with_existing_terminal_state");
        }
        return {
          mode,
          laneId: integration.laneId,
          result: "completed_no_eligible_opportunity",
          terminalOutcome: "completed_no_eligible_opportunity",
          candidateCount: 0,
          recovered: true,
          providerDispatchSuppressed: true,
          observedAt: input.scheduledFor.toISOString(),
          schedulerLatenessToleranceMinutes: integration.schedulerLatenessToleranceMinutes,
          auditChainValid: store.auditChainValid(),
          externalWrites: 0,
          llmCalls: 0,
        };
      }
      const slotRunId = `slot_${sha256(key).slice(0, 24)}`;
      store.startSlot(slotRunId, key, "none", "none", input.scheduledFor.toISOString(), input.scheduledFor);
      store.completeSlot(
        slotRunId,
        "completed_no_eligible_opportunity",
        ["no-enabled-opportunity-inside-exact-scheduler-window"],
        null,
        null,
        input.scheduledFor,
      );
      return {
        mode,
        laneId: integration.laneId,
        result: "completed_no_eligible_opportunity",
        terminalOutcome: "completed_no_eligible_opportunity",
        candidateCount: 0,
        recovered: false,
        providerDispatchSuppressed: true,
        observedAt: input.scheduledFor.toISOString(),
        schedulerLatenessToleranceMinutes: integration.schedulerLatenessToleranceMinutes,
        auditChainValid: store.auditChainValid(),
        externalWrites: 0,
        llmCalls: 0,
      };
    } finally {
      store.close();
    }
  }
  const scheduledFor = resolution.scheduledFor;
  const opportunity = opportunityFor(integration, resolution.opportunity.id, scheduledFor);
  const policy = registry.platformPolicies.find(
    (candidate) =>
      candidate.status === "active" &&
      candidate.platformId === opportunity.platformId &&
      candidate.accountId === opportunity.accountId,
  );
  if (!policy) throw new Error("Allocated opportunity has no active connector policy");
  try {
    const engine = new DeterministicPublishingEngine(registry, store);
    engine.initialize();
    const existingSlot = store.slotRuns(500).find(
      (candidate) => candidate.slot_key === slotKey(scheduledFor),
    );
    let existingPublication: ReturnType<PublishingStore["publication"]> = null;
    if (existingSlot) {
      existingPublication = store.publicationForSlotKey(String(existingSlot.slot_key));
      if (existingSlot.result || (existingPublication && ![
        "reserved",
        "publishing",
        "published_unverified",
        "reconciliation_required",
      ].includes(existingPublication.state))) {
        return {
          mode,
          laneId: integration.laneId,
          opportunityId: opportunity.id,
          platformId: opportunity.platformId,
          result: existingSlot.result || existingPublication?.state || "recovery_required",
          publicationId: existingPublication?.id || null,
          recovered: true,
          providerDispatchSuppressed: true,
          scheduledFor: scheduledFor.toISOString(),
          observedAt: input.scheduledFor.toISOString(),
          schedulerLatenessMs: resolution.latenessMs,
          auditChainValid: store.auditChainValid(),
          externalWrites: 0,
          llmCalls: 0,
        };
      }
    }
    const plan = existingPublication
      ? null
      : engine.planSlot({
        platformId: opportunity.platformId,
        accountId: opportunity.accountId,
        scheduledFor,
        now: scheduledFor,
        selectionSemantics: mode === "shadow" ? "shadow_portfolio" : "provider_verified",
      });
    if (plan && (plan.result !== "reserved" || !plan.reservation || !plan.contentSpec)) {
      return {
        mode,
        laneId: integration.laneId,
        opportunityId: opportunity.id,
        result: plan.result,
        reasons: plan.reasons,
        scheduledFor: scheduledFor.toISOString(),
        observedAt: input.scheduledFor.toISOString(),
        schedulerLatenessMs: resolution.latenessMs,
        externalWrites: 0,
        llmCalls: 0,
      };
    }
    const invoker = input.toolInvoker ?? gatewayToolInvoker({
      openclawBin: input.openclawBin ||
        "/home/oneclickwebsitedesignfactory/.nvm/versions/node/v24.18.0/bin/openclaw",
      workspace: input.workspace || process.cwd(),
      agentId: integration.workerAgentId,
    });
    const worker = new OpenClawOfficialApiWorkerClient({
      connectorId: policy.connectorId,
      integration,
      opportunity,
      scheduledFor,
      mode,
      allowProviderWrite: input.allowProviderWrite === true,
      invoker,
      openclawBin: input.openclawBin,
    });
    const connectors = new PublishingConnectorRegistry();
    const connector = new WorkerBackedPublishingConnector(worker);
    connectors.register(connector);
    connectors.assertActivePolicyCoverage({
      ...registry,
      platformPolicies: registry.platformPolicies.filter(
        (candidate) =>
          candidate.platformId === opportunity.platformId &&
          candidate.accountId === opportunity.accountId,
      ),
    });
    if (existingPublication?.state === "publishing") {
      store.transitionPublication(existingPublication.id, "reconciliation_required", {
        failureCode: "restart-during-provider-dispatch-unknown",
      }, scheduledFor);
      existingPublication = store.publication(existingPublication.id);
    }
    if (
      existingPublication &&
      ["published_unverified", "reconciliation_required"].includes(existingPublication.state)
    ) {
      const reconciled = await engine.reconcile({
        publicationId: existingPublication.id,
        connector,
        now: scheduledFor,
      });
      return {
        mode,
        laneId: integration.laneId,
        opportunityId: opportunity.id,
        platformId: opportunity.platformId,
        publicationId: existingPublication.id,
        result: reconciled.state,
        recovered: true,
        providerDispatchSuppressed: true,
        reconciliationMatches: reconciled.matches,
        scheduledFor: scheduledFor.toISOString(),
        observedAt: input.scheduledFor.toISOString(),
        schedulerLatenessMs: resolution.latenessMs,
        auditChainValid: store.auditChainValid(),
        externalWrites: 0,
        llmCalls: 0,
      };
    }
    const contentSpec = existingPublication
      ? store.contentSpec(existingPublication.contentSpecId)
      : plan?.contentSpec ?? null;
    const publicationId = existingPublication?.id ?? plan?.reservation?.publicationId;
    if (!contentSpec || !publicationId) {
      throw new Error("Reserved production opportunity is missing immutable state");
    }
    if (
      mode !== "shadow" &&
      contentSpec.format !== "text" &&
      !input.mediaDelivery
    ) {
      throw new Error("Canary/live media publication requires an immutable hash-bound durable delivery receipt");
    }
    const rendered = input.mediaDelivery
      ? renderedCandidateWithDelivery(contentSpec, input.mediaDelivery)
      : deterministicRenderedCandidate(contentSpec);
    if (mode === "shadow") {
      const readiness = await worker.readiness();
      if (!readiness.ready) {
        throw new Error(`Official worker is not ready: ${readiness.reasons.join(",")}`);
      }
      const receipt = await worker.publishOnce({
        idempotencyKey: existingPublication?.idempotencyKey ?? plan!.reservation!.idempotencyKey,
        contentSpec,
        renderedCandidate: rendered,
      });
      const result = engine.completeShadow({
        publicationId,
        connectorId: connector.connectorId,
        renderedCandidate: rendered,
        receipt,
        now: scheduledFor,
      });
      return {
        mode,
        laneId: integration.laneId,
        opportunityId: opportunity.id,
        platformId: opportunity.platformId,
        publicationId,
        contentHash: contentSpec.contentHash,
        result: result.state,
        connectorReceipt: receipt,
        recovered: Boolean(existingPublication),
        scheduledFor: scheduledFor.toISOString(),
        observedAt: input.scheduledFor.toISOString(),
        schedulerLatenessMs: resolution.latenessMs,
        auditChainValid: store.auditChainValid(),
        externalWrites: 0,
        llmCalls: 0,
      };
    }
    const result = await engine.executeReserved({
      publicationId,
      connector,
      renderedCandidate: rendered,
      now: scheduledFor,
    });
    return {
      mode,
      laneId: integration.laneId,
      opportunityId: opportunity.id,
      platformId: opportunity.platformId,
      publicationId,
      contentHash: contentSpec.contentHash,
      result: result.state,
      providerId: result.providerId ?? null,
      permalink: result.permalink ?? null,
      recovered: Boolean(existingPublication),
      scheduledFor: scheduledFor.toISOString(),
      observedAt: input.scheduledFor.toISOString(),
      schedulerLatenessMs: resolution.latenessMs,
      auditChainValid: store.auditChainValid(),
      externalWrites: result.state === "verified" ? 1 : "unknown",
      llmCalls: 0,
    };
  } finally {
    store.close();
  }
}
