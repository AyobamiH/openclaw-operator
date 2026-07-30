import type {
  ConnectorPublishRequest,
  ConnectorPublishResult,
  ConnectorReadback,
  ContentSpec,
  PlatformId,
  PublishingConnector,
  PublishingRegistryBundle,
} from "./types.js";

export interface OfficialApiWorkerClient {
  readonly connectorId: string;
  readonly platformId: PlatformId;
  readonly transport: "official-api-worker";
  readiness(): Promise<{ ready: boolean; reasons: string[] }>;
  publishOnce(request: ConnectorPublishRequest): Promise<Record<string, unknown>>;
  readBack(providerId: string): Promise<ConnectorReadback>;
  findPossibleDuplicate(contentSpec: ContentSpec): Promise<ConnectorReadback[]>;
  fetchMetrics(providerId: string): Promise<Array<{
    metricDefinitionId: string;
    value: number | null;
    availability: "available" | "unavailable";
    capturedAt: string;
    evidence: Record<string, unknown>;
  }>>;
}

const PROVIDER_ID_KEYS = new Set([
  "providerId",
  "provider_id",
  "mediaId",
  "media_id",
  "postId",
  "post_id",
  "id",
]);

export function extractProviderId(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractProviderId(item, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const [key, candidate] of Object.entries(record)) {
    if (
      PROVIDER_ID_KEYS.has(key) &&
      (typeof candidate === "string" || typeof candidate === "number") &&
      String(candidate).trim()
    ) {
      return String(candidate);
    }
  }
  for (const candidate of Object.values(record)) {
    const nested = extractProviderId(candidate, depth + 1);
    if (nested) return nested;
  }
  return null;
}

export class WorkerBackedPublishingConnector implements PublishingConnector {
  readonly connectorId: string;
  readonly platformId: PlatformId;

  constructor(private readonly worker: OfficialApiWorkerClient) {
    if (worker.transport !== "official-api-worker") {
      throw new Error("Publishing connectors must use an official API worker transport");
    }
    this.connectorId = worker.connectorId;
    this.platformId = worker.platformId;
  }

  readiness(): Promise<{ ready: boolean; reasons: string[] }> {
    return this.worker.readiness();
  }

  async publish(request: ConnectorPublishRequest): Promise<ConnectorPublishResult> {
    const rawReceipt = await this.worker.publishOnce(request);
    const providerId = extractProviderId(rawReceipt);
    return {
      providerId,
      ambiguous: !providerId,
      rawReceipt,
    };
  }

  readBack(providerId: string): Promise<ConnectorReadback> {
    return this.worker.readBack(providerId);
  }

  findPossibleDuplicate(contentSpec: ContentSpec): Promise<ConnectorReadback[]> {
    return this.worker.findPossibleDuplicate(contentSpec);
  }

  fetchMetrics(providerId: string): ReturnType<PublishingConnector["fetchMetrics"]> {
    return this.worker.fetchMetrics(providerId);
  }
}

export class PublishingConnectorRegistry {
  private readonly connectors = new Map<string, PublishingConnector>();

  register(connector: PublishingConnector): void {
    if (this.connectors.has(connector.connectorId)) {
      throw new Error(`Duplicate publishing connector: ${connector.connectorId}`);
    }
    this.connectors.set(connector.connectorId, connector);
  }

  resolve(
    registry: PublishingRegistryBundle,
    platformId: PlatformId,
    accountId: string,
  ): PublishingConnector {
    const policy = registry.platformPolicies.find(
      (candidate) =>
        candidate.status === "active" &&
        candidate.platformId === platformId &&
        candidate.accountId === accountId,
    );
    if (!policy) throw new Error(`No active platform policy for ${platformId}/${accountId}`);
    const connector = this.connectors.get(policy.connectorId);
    if (!connector) throw new Error(`Approved connector is not registered: ${policy.connectorId}`);
    if (connector.platformId !== platformId) {
      throw new Error(
        `Registered connector platform mismatch: ${connector.platformId} != ${platformId}`,
      );
    }
    return connector;
  }

  assertActivePolicyCoverage(registry: PublishingRegistryBundle): void {
    for (const policy of registry.platformPolicies.filter(
      (candidate) => candidate.status === "active",
    )) {
      this.resolve(registry, policy.platformId, policy.accountId);
    }
  }

  ids(): string[] {
    return Array.from(this.connectors.keys()).sort();
  }
}
