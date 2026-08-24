import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { sha256 } from "./canonical.js";
import type {
  ConnectorPublishRequest,
  ConnectorReadback,
  ContentSpec,
  PlatformId,
} from "./types.js";
import type { OfficialApiWorkerClient } from "./connectors.js";
import type {
  ProductionIntegration,
  ProductionOpportunity,
} from "./production-integration.js";

export type ToolInvocation = {
  tool: string;
  args: Record<string, unknown>;
  idempotencyKey: string;
};

export type ProductionToolInvoker = (
  invocation: ToolInvocation,
) => Promise<Record<string, unknown>>;

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const childEnvironment = { ...process.env };
    delete childEnvironment.OPENCLAW_CLI;
    const child = spawn(command, args, {
      cwd,
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 12 * 1024 * 1024) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 12 * 1024 * 1024) child.kill("SIGTERM");
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        rejectPromise(
          new Error(`${command} exited ${code}: ${stderr.trim() || stdout.trim() || "no output"}`),
        );
        return;
      }
      resolvePromise(stdout);
    });
  });
}

export function gatewayToolInvoker(input: {
  openclawBin: string;
  workspace: string;
  agentId: string;
  timeoutMs?: number;
}): ProductionToolInvoker {
  return async (invocation) => {
    const params = {
      name: invocation.tool,
      args: invocation.args,
      agentId: input.agentId,
      sessionKey: `agent:${input.agentId}:main`,
      idempotencyKey: invocation.idempotencyKey,
    };
    const stdout = await runProcess(
      input.openclawBin,
      [
        "gateway",
        "call",
        "tools.invoke",
        "--json",
        "--timeout",
        String(input.timeoutMs ?? 120_000),
        "--params",
        JSON.stringify(params),
      ],
      input.workspace,
      (input.timeoutMs ?? 120_000) + 10_000,
    );
    const response = JSON.parse(stdout) as Record<string, unknown>;
    if (response.ok !== true) {
      throw new Error(`Official worker invocation failed: ${JSON.stringify(response.error || {})}`);
    }
    const output = response.output as Record<string, unknown> | undefined;
    if (output?.details && typeof output.details === "object") {
      return output.details as Record<string, unknown>;
    }
    const content = Array.isArray(output?.content) ? output.content : [];
    const text = content.find(
      (item) =>
        item &&
        typeof item === "object" &&
        (item as Record<string, unknown>).type === "text",
    ) as Record<string, unknown> | undefined;
    if (typeof text?.text === "string") {
      return JSON.parse(text.text) as Record<string, unknown>;
    }
    throw new Error("Official worker returned no structured details");
  };
}

export async function isolatedConnectorShadowInvoker(input: {
  connectorEntry: string;
  activityLedgerPath: string;
  admissionDatabasePath: string;
}): Promise<ProductionToolInvoker> {
  const module = await import(pathToFileURL(input.connectorEntry).href) as {
    createRelayLiveBusinessEngagementRuntime(args: Record<string, unknown>): {
      execute(params: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
  };
  const account = (key: string, platform: "threads" | "instagram") => ({
    key,
    platform,
    credentialRef: {
      source: "env",
      provider: "default",
      id: `SHADOW_${platform.toUpperCase()}_CREDENTIAL_NEVER_RESOLVED`,
    },
  });
  const allocations = (times: string[]) => times.map((time) => ({
    laneId: "self-identification-engine",
    opportunityId: `self-id-${time}`,
  }));
  const runtime = module.createRelayLiveBusinessEngagementRuntime({
    pluginConfig: {
      activityLedgerPath: input.activityLedgerPath,
      accounts: [
        account("threads:owner", "threads"),
        account("instagram:owner", "instagram"),
      ],
      accountAdmission: {
        enabled: true,
        databasePath: input.admissionDatabasePath,
        policies: [
          {
            id: "threads-owner-shared",
            enabled: true,
            platform: "threads",
            accountKey: "threads:owner",
            maxDailyPublications: 6,
            minimumSpacingMinutes: 60,
            collisionWindowMinutes: 5,
            allowedLaneIds: ["legacy-existing", "self-identification-engine"],
            opportunityAllocations: allocations(["0500", "1500"]),
          },
          {
            id: "instagram-owner-shared",
            enabled: true,
            platform: "instagram",
            accountKey: "instagram:owner",
            maxDailyPublications: 10,
            minimumSpacingMinutes: 60,
            collisionWindowMinutes: 5,
            allowedLaneIds: ["legacy-existing", "self-identification-engine"],
            opportunityAllocations: allocations(["0700", "1100", "1700"]),
          },
        ],
        historicalReconciliations: [
          {
            idempotencyKey:
              "2e0fa2a12c5477e2a7c6de2e2bcba1afac822dfe054b9802c71ce3f5358a1677",
            classification: "confirmed_absent",
            evidenceRef: "memory/2026-07-20.md:MCP-owned-feed-reconciliation",
          },
          {
            idempotencyKey:
              "e7ed8a595fa6d406fa5b708d6848a1f879b890cbdee8b5ac4b95ff7fe9ddaea1",
            classification: "confirmed_absent",
            evidenceRef:
              "artifacts/business-value/marketing/2026-07-23/threads-proof-video-live-retry-ambiguous-0508.json",
          },
        ],
      },
    },
    resolveSecret: async () => {
      throw new Error("Shadow execution attempted to resolve a provider credential");
    },
  });
  return async (invocation) => {
    if (invocation.tool !== "relay_live_business_engagement_execute") {
      throw new Error(`Isolated shadow permits only connector execute, received ${invocation.tool}`);
    }
    if (invocation.args.dryRun !== true || invocation.args.explicitWriteApproval !== false) {
      throw new Error("Isolated shadow forbids provider mutation");
    }
    return runtime.execute(invocation.args);
  };
}

function renderedText(spec: ContentSpec): string {
  return [
    spec.renderedIntent.hook,
    spec.renderedIntent.body,
    spec.renderedIntent.cta,
  ].join("\n\n");
}

function collectRecords(value: unknown, output: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, output);
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    output.push(record);
    for (const item of Object.values(record)) collectRecords(item, output);
  }
  return output;
}

function providerMetricValue(
  result: Record<string, unknown>,
  metricName: string,
): number | null {
  for (const record of collectRecords(result)) {
    const name = String(record.name || record.metric || "").trim().toLowerCase();
    if (name !== metricName) continue;
    if (typeof record.value === "number" && Number.isFinite(record.value)) {
      return record.value;
    }
    if (Array.isArray(record.values)) {
      const value = record.values
        .map((item) =>
          item && typeof item === "object"
            ? (item as Record<string, unknown>).value
            : undefined,
        )
        .find((item) => typeof item === "number" && Number.isFinite(item));
      if (typeof value === "number") return value;
    }
  }
  return null;
}

export class OpenClawOfficialApiWorkerClient implements OfficialApiWorkerClient {
  readonly connectorId: string;
  readonly platformId: PlatformId;
  readonly transport = "official-api-worker" as const;

  constructor(
    private readonly input: {
      connectorId: string;
      integration: ProductionIntegration;
      opportunity: ProductionOpportunity;
      scheduledFor: Date;
      mode: "shadow" | "canary" | "live";
      allowProviderWrite: boolean;
      invoker: ProductionToolInvoker;
      openclawBin?: string;
    },
  ) {
    this.connectorId = input.connectorId;
    this.platformId = input.opportunity.platformId;
  }

  async readiness(): Promise<{ ready: boolean; reasons: string[] }> {
    if (this.input.mode !== "shadow" && !this.input.allowProviderWrite) {
      return { ready: false, reasons: ["provider-write-not-explicitly-authorized"] };
    }
    if (this.input.mode === "canary" && !this.input.opportunity.canaryEligible) {
      return { ready: false, reasons: ["opportunity-not-canary-eligible"] };
    }
    if (this.input.openclawBin) {
      try {
        await access(this.input.openclawBin);
      } catch {
        return { ready: false, reasons: ["openclaw-gateway-command-missing"] };
      }
    }
    return { ready: true, reasons: [] };
  }

  async publishOnce(request: ConnectorPublishRequest): Promise<Record<string, unknown>> {
    const shadow = this.input.mode === "shadow";
    if (!shadow && !this.input.allowProviderWrite) {
      throw new Error("Provider mutation is not explicitly authorized");
    }
    const sessionId = `rlbe_self_id_${request.idempotencyKey.slice(0, 32)}`;
    const mediaUrl = request.renderedCandidate.mediaUrl || undefined;
    const args: Record<string, unknown> = {
      sessionId,
      platform: this.platformId,
      accountKey: this.input.opportunity.connectorAccountKey,
      action: "publish",
      targetId: "account-feed",
      text: request.renderedCandidate.text,
      dryRun: shadow,
      explicitWriteApproval: !shadow,
      runtimeOwner: this.input.integration.runtimeOwner,
      campaignLaneId: this.input.integration.laneId,
      opportunityId: this.input.opportunity.id,
      scheduledFor: this.input.scheduledFor.toISOString(),
    };
    if (mediaUrl) {
      args[request.contentSpec.format === "reel" ? "videoUrl" : "imageUrl"] = mediaUrl;
    }
    return this.input.invoker({
      tool: "relay_live_business_engagement_execute",
      args,
      idempotencyKey: `${request.idempotencyKey}:official-worker:${shadow ? "shadow" : "single-write"}`,
    });
  }

  async readBack(providerId: string): Promise<ConnectorReadback> {
    const result = await this.input.invoker({
      tool: "relay_live_business_engagement_verify",
      args: {
        platform: this.platformId,
        accountKey: this.input.opportunity.connectorAccountKey,
        action: "publish",
        targetId: "account-feed",
        providerResultId: providerId,
        relayAvailable: false,
      },
      idempotencyKey: `${providerId}:official-readback`,
    });
    const evidence = (result.evidence || {}) as Record<string, unknown>;
    return {
      found: result.outcome === "success" && evidence.verified === true,
      providerId,
      ownedByExpectedAccount: result.outcome === "success" && evidence.verified === true,
      contentHashMatches: result.outcome === "success" && evidence.verified === true,
      ...(typeof evidence.permalink === "string" ? { permalink: evidence.permalink } : {}),
      evidence: result,
    };
  }

  async findPossibleDuplicate(contentSpec: ContentSpec): Promise<ConnectorReadback[]> {
    const result = await this.input.invoker({
      tool: "relay_live_business_engagement_discover",
      args: {
        platform: this.platformId,
        accountKey: this.input.opportunity.connectorAccountKey,
        surface: "owned",
        query: "",
        limit: 100,
        relayAvailable: false,
      },
      idempotencyKey: `${contentSpec.contentHash}:official-owned-history:caption-readback-v1`,
    });
    const expected = sha256(renderedText(contentSpec));
    return collectRecords(result)
      .map((record) => ({
        record,
        text: typeof record.text === "string"
          ? record.text
          : typeof record.caption === "string"
            ? record.caption
            : null,
      }))
      .filter((item) => typeof item.record.id === "string" && item.text !== null)
      .filter((item) => sha256(String(item.text)) === expected)
      .map(({ record }) => record)
      .map((record) => ({
        found: true,
        providerId: String(record.id),
        ownedByExpectedAccount: true,
        contentHashMatches: true,
        ...(typeof record.permalink === "string" ? { permalink: record.permalink } : {}),
        evidence: record,
      }));
  }

  async fetchMetrics(providerId: string): Promise<Array<{
    metricDefinitionId: string;
    value: number | null;
    availability: "available" | "unavailable";
    capturedAt: string;
    evidence: Record<string, unknown>;
  }>> {
    const capturedAt = new Date().toISOString();
    if (this.platformId !== "threads") {
      const evidence = {
        source: "official-provider-metrics",
        platform: this.platformId,
        providerId,
        reason: "provider-post-insights-surface-unavailable",
      };
      return [
        {
          metricDefinitionId: "metric-impressions",
          value: null,
          availability: "unavailable",
          capturedAt,
          evidence,
        },
        {
          metricDefinitionId: "metric-engagement-rate",
          value: null,
          availability: "unavailable",
          capturedAt,
          evidence,
        },
      ];
    }

    const result = await this.input.invoker({
      tool: "relay_live_business_engagement_discover",
      args: {
        platform: this.platformId,
        accountKey: this.input.opportunity.connectorAccountKey,
        surface: "post_insights",
        targetId: providerId,
        query: "",
        limit: 25,
        relayAvailable: false,
      },
      idempotencyKey: `${providerId}:official-provider-metrics`,
    });
    const views = providerMetricValue(result, "views");
    const engagementValues = ["likes", "replies", "reposts", "quotes", "shares"]
      .map((name) => providerMetricValue(result, name));
    const engagementRate =
      views !== null &&
      views > 0 &&
      engagementValues.every((value) => value !== null)
        ? engagementValues.reduce<number>((total, value) => total + Number(value), 0) / views
        : null;
    const evidence = {
      source: "official-provider-metrics",
      platform: this.platformId,
      providerId,
      providerResult: result,
    };
    return [
      {
        metricDefinitionId: "metric-impressions",
        value: views,
        availability: views === null ? "unavailable" : "available",
        capturedAt,
        evidence: {
          ...evidence,
          providerMetric: "views",
        },
      },
      {
        metricDefinitionId: "metric-engagement-rate",
        value: engagementRate,
        availability: engagementRate === null ? "unavailable" : "available",
        capturedAt,
        evidence: {
          ...evidence,
          providerMetrics: ["views", "likes", "replies", "reposts", "quotes", "shares"],
          formula: "(likes+replies+reposts+quotes+shares)/views",
        },
      },
    ];
  }

  async fetchConversations(providerId: string): Promise<Array<{
    providerConversationId: string;
    text: string;
    observedAt: string;
    evidence: Record<string, unknown>;
  }>> {
    const result = await this.input.invoker({
      tool: "relay_live_business_engagement_discover",
      args: {
        platform: this.platformId,
        accountKey: this.input.opportunity.connectorAccountKey,
        surface: "post_replies",
        targetId: providerId,
        query: "",
        limit: 100,
        relayAvailable: false,
      },
      idempotencyKey: `${providerId}:official-post-replies`,
    });
    const observedAt = new Date().toISOString();
    const seen = new Set<string>();
    const conversations: Array<{
      providerConversationId: string;
      text: string;
      observedAt: string;
      evidence: Record<string, unknown>;
    }> = [];
    for (const record of collectRecords(result)) {
      const id = typeof record.id === "string"
        ? record.id
        : typeof record.providerId === "string"
          ? record.providerId
          : "";
      const text = typeof record.text === "string"
        ? record.text
        : typeof record.message === "string"
          ? record.message
          : "";
      if (!id || id === providerId || !text || seen.has(id)) continue;
      seen.add(id);
      conversations.push({
        providerConversationId: id,
        text,
        observedAt: typeof record.timestamp === "string" ? record.timestamp : observedAt,
        evidence: {
          source: "official-provider-post-replies",
          platform: this.platformId,
          providerPublicationId: providerId,
          providerRecord: record,
          exactTargetedRead: true,
        },
      });
    }
    return conversations;
  }
}
