import { resolve } from "node:path";

import { PublishingConnectorRegistry, WorkerBackedPublishingConnector } from "./connectors.js";
import {
  DeterministicPublishingEngine,
  deterministicRenderedCandidate,
  slotKey,
} from "./engine.js";
import {
  gatewayToolInvoker,
  OpenClawOfficialApiWorkerClient,
  type ProductionToolInvoker,
} from "./official-worker.js";
import {
  loadProductionIntegration,
  opportunityFor,
} from "./production-integration.js";
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
  const requestedOpportunityId = input.opportunityId === "auto"
    ? integration.opportunities.find((candidate) => {
      const localTime = new Intl.DateTimeFormat("en-GB", {
        timeZone: integration.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(input.scheduledFor);
      return candidate.enabled && candidate.localTime === localTime;
    })?.id
    : input.opportunityId;
  if (!requestedOpportunityId) {
    throw new Error("No product opportunity is allocated at the current Europe/London time");
  }
  const opportunity = opportunityFor(
    integration,
    requestedOpportunityId,
    input.scheduledFor,
  );
  const policy = registry.platformPolicies.find(
    (candidate) =>
      candidate.status === "active" &&
      candidate.platformId === opportunity.platformId &&
      candidate.accountId === opportunity.accountId,
  );
  if (!policy) throw new Error("Allocated opportunity has no active connector policy");
  const store = new PublishingStore(resolve(input.databasePath));
  try {
    const engine = new DeterministicPublishingEngine(registry, store);
    engine.initialize();
    const existingSlot = store.slotRuns(500).find(
      (candidate) => candidate.slot_key === slotKey(input.scheduledFor),
    );
    if (existingSlot) {
      const existingPublication = store.publications(500).find(
        (candidate) => candidate.content_spec_id === existingSlot.content_spec_id,
      );
      return {
        mode,
        laneId: integration.laneId,
        opportunityId: opportunity.id,
        platformId: opportunity.platformId,
        result: existingSlot.result || existingPublication?.state || "recovery_required",
        publicationId: existingPublication?.id || null,
        recovered: true,
        providerDispatchSuppressed: true,
        auditChainValid: store.auditChainValid(),
        externalWrites: 0,
        llmCalls: 0,
      };
    }
    const plan = engine.planSlot({
      platformId: opportunity.platformId,
      accountId: opportunity.accountId,
      scheduledFor: input.scheduledFor,
      now: input.scheduledFor,
    });
    if (plan.result !== "reserved" || !plan.reservation || !plan.contentSpec) {
      return {
        mode,
        laneId: integration.laneId,
        opportunityId: opportunity.id,
        result: plan.result,
        reasons: plan.reasons,
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
      scheduledFor: input.scheduledFor,
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
    const rendered = deterministicRenderedCandidate(plan.contentSpec);
    if (mode === "shadow") {
      const readiness = await worker.readiness();
      if (!readiness.ready) {
        throw new Error(`Official worker is not ready: ${readiness.reasons.join(",")}`);
      }
      const receipt = await worker.publishOnce({
        idempotencyKey: plan.reservation.idempotencyKey,
        contentSpec: plan.contentSpec,
        renderedCandidate: rendered,
      });
      const result = engine.completeShadow({
        publicationId: plan.reservation.publicationId,
        connectorId: connector.connectorId,
        renderedCandidate: rendered,
        receipt,
        now: input.scheduledFor,
      });
      return {
        mode,
        laneId: integration.laneId,
        opportunityId: opportunity.id,
        platformId: opportunity.platformId,
        publicationId: plan.reservation.publicationId,
        contentHash: plan.contentSpec.contentHash,
        result: result.state,
        connectorReceipt: receipt,
        auditChainValid: store.auditChainValid(),
        externalWrites: 0,
        llmCalls: 0,
      };
    }
    const result = await engine.executeReserved({
      publicationId: plan.reservation.publicationId,
      connector,
      renderedCandidate: rendered,
      now: input.scheduledFor,
    });
    return {
      mode,
      laneId: integration.laneId,
      opportunityId: opportunity.id,
      platformId: opportunity.platformId,
      publicationId: plan.reservation.publicationId,
      contentHash: plan.contentSpec.contentHash,
      result: result.state,
      providerId: result.providerId ?? null,
      permalink: result.permalink ?? null,
      auditChainValid: store.auditChainValid(),
      externalWrites: result.state === "verified" ? 1 : "unknown",
      llmCalls: 0,
    };
  } finally {
    store.close();
  }
}
