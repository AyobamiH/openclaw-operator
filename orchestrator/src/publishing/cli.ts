import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { DeterministicPublishingEngine } from "./engine.js";
import { deterministicRenderedCandidate } from "./engine.js";
import { registryBundleHash, loadRegistryBundle } from "./registry.js";
import { PublishingStore } from "./store.js";
import { runProductionOpportunity } from "./production-runner.js";
import { isolatedConnectorShadowInvoker } from "./official-worker.js";
import { parseCampaignMediaDelivery } from "./media-artifact.js";
import { PROHIBITED_PLATFORM_IDS } from "./types.js";
import type {
  ContentSpec,
  PublishingConnector,
  PublishingRegistryBundle,
} from "./types.js";

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): { command: string; options: Args } {
  const [command = "help", ...rest] = argv;
  const options: Args = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return { command, options };
}

function option(options: Args, name: string, fallback?: string): string {
  const value = options[name] ?? fallback;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

function projectDefaultRegistry(): string {
  return resolve(process.cwd(), "../config/publishing/registry.v1.json");
}

function date(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ISO timestamp: ${value}`);
  return parsed;
}

async function engineFor(options: Args): Promise<{
  engine: DeterministicPublishingEngine;
  store: PublishingStore;
}> {
  const registry = await loadRegistryBundle(
    resolve(option(options, "registry", projectDefaultRegistry())),
  );
  const store = new PublishingStore(resolve(option(options, "db")));
  const engine = new DeterministicPublishingEngine(registry, store);
  engine.initialize();
  return { engine, store };
}

async function diagnostic(options: Args): Promise<Record<string, unknown>> {
  const registryPath = resolve(option(options, "registry", projectDefaultRegistry()));
  const registry = await loadRegistryBundle(registryPath);
  const activeSchedule = registry.schedules.filter(
    (schedule) => schedule.status === "active" && schedule.enabled,
  );
  const slotTimes = activeSchedule.flatMap((schedule) => schedule.slotTimes);
  const primaryCampaignType = activeSchedule[0]?.primaryCampaignType;
  const prohibitedReferences = [
    ...registry.platformPolicies.map((policy) => policy.platformId),
    ...registry.campaigns.flatMap((campaign) => campaign.platformIds),
    ...registry.templates.flatMap((template) => template.platformIds),
  ].filter((platformId) => PROHIBITED_PLATFORM_IDS.has(platformId));
  const baseDay = option(options, "date", "2026-07-30");
  const passes = [];
  for (const slotTime of slotTimes) {
    const scheduledFor = date(`${baseDay}T${slotTime}:00+01:00`);
    const run = () => {
      const store = new PublishingStore(":memory:");
      const engine = new DeterministicPublishingEngine(registry, store);
      engine.initialize();
      const plan = engine.planSlot({ scheduledFor, now: scheduledFor });
      const result = {
        slotTime,
        result: plan.result,
        candidateId: plan.candidate?.id ?? null,
        campaignType: plan.candidate?.campaignType ?? null,
        strategyId: plan.contentSpec?.strategyId ?? null,
        contentHash: plan.contentSpec?.contentHash ?? null,
        reservation: Boolean(plan.reservation),
        auditChainValid: store.auditChainValid(),
      };
      store.close();
      return result;
    };
    const first = run();
    const replay = run();
    passes.push({
      ...first,
      replayStable:
        first.candidateId === replay.candidateId &&
        first.contentHash === replay.contentHash &&
        first.result === replay.result,
    });
  }
  const passed =
    slotTimes.length === 5 &&
    new Set(slotTimes).size === 5 &&
    prohibitedReferences.length === 0 &&
    passes.every((pass) =>
      pass.result === "reserved" &&
      pass.reservation &&
      pass.auditChainValid &&
      pass.replayStable &&
      pass.campaignType === primaryCampaignType);
  return {
    passed,
    mode: "non-writing-product-harness",
    registryPath,
    registryVersion: registry.registryVersion,
    registryHash: registryBundleHash(registry),
    slotTimes,
    primaryCampaignType,
    prohibitedPlatforms: Array.from(PROHIBITED_PLATFORM_IDS),
    prohibitedReferences,
    passes,
    externalWrites: 0,
    llmCalls: 0,
  };
}

function addDays(day: string, offset: number): string {
  const value = new Date(`${day}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function simulatedConnector(
  registry: PublishingRegistryBundle,
  spec: ContentSpec,
  providerId: string,
  publishedAt: string,
): PublishingConnector {
  const policy = registry.platformPolicies.find(
    (item) =>
      item.status === "active" &&
      item.platformId === spec.platformId &&
      item.accountId === spec.accountId,
  );
  if (!policy) throw new Error(`Missing active policy for ${spec.platformId}/${spec.accountId}`);
  return {
    platformId: spec.platformId,
    connectorId: policy.connectorId,
    readiness: async () => ({ ready: true, reasons: [] }),
    publish: async () => ({
      providerId,
      ambiguous: false,
      rawReceipt: { mode: "simulated-provider", providerId },
    }),
    readBack: async () => ({
      found: true,
      providerId,
      ownedByExpectedAccount: true,
      contentHashMatches: true,
      permalink: `https://simulated.invalid/${providerId}`,
      publishedAt,
      mediaType: spec.format,
      evidence: { mode: "simulated-provider-readback", providerId },
    }),
    findPossibleDuplicate: async () => [],
    fetchMetrics: async () => [],
  };
}

async function portfolioReplayPass(
  registry: PublishingRegistryBundle,
  baseDay: string,
  days: number,
): Promise<{
  sequence: Array<Record<string, unknown>>;
  productsSeen: string[];
  campaignTypesSeen: string[];
  primaryDays: number;
  taxLienSelfIdentificationVerified: boolean;
  strategyIntegrity: boolean;
  auditChainValid: boolean;
  simulatedProviderWrites: number;
}> {
  const store = new PublishingStore(":memory:");
  const engine = new DeterministicPublishingEngine(registry, store);
  engine.initialize();
  const schedule = registry.schedules.find(
    (item) => item.status === "active" && item.enabled,
  );
  if (!schedule) throw new Error("No active schedule for portfolio replay");
  const sequence: Array<Record<string, unknown>> = [];
  let simulatedProviderWrites = 0;
  try {
    for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
      const day = addDays(baseDay, dayOffset);
      for (const slotTime of schedule.slotTimes) {
        const scheduledFor = date(`${day}T${slotTime}:00+01:00`);
        const plan = engine.planSlot({ scheduledFor, now: scheduledFor });
        let finalState = plan.result;
        if (plan.result === "reserved" && plan.reservation && plan.contentSpec) {
          const providerId = `simulated-${day}-${slotTime.replace(":", "")}`;
          const result = await engine.executeReserved({
            publicationId: plan.reservation.publicationId,
            connector: simulatedConnector(
              registry,
              plan.contentSpec,
              providerId,
              scheduledFor.toISOString(),
            ),
            renderedCandidate: deterministicRenderedCandidate(plan.contentSpec),
            now: scheduledFor,
          });
          simulatedProviderWrites += 1;
          finalState = result.state as typeof plan.result;
        }
        sequence.push({
          day,
          slotTime,
          finalState,
          productId: plan.candidate?.productId ?? null,
          campaignId: plan.candidate?.campaignId ?? null,
          campaignType: plan.candidate?.campaignType ?? null,
          strategyId: plan.contentSpec?.strategyId ?? null,
          primaryModelEnforced: plan.reasons.includes("primary-campaign-model-enforced"),
        });
      }
    }
    const productsSeen = Array.from(new Set(
      sequence.map((item) => item.productId).filter((value): value is string => typeof value === "string"),
    )).sort();
    const campaignTypesSeen = Array.from(new Set(
      sequence.map((item) => item.campaignType).filter((value): value is string => typeof value === "string"),
    )).sort();
    const primaryDays = Array.from({ length: days }, (_, offset) => addDays(baseDay, offset))
      .filter((day) => {
        return sequence.some(
          (item) =>
            item.day === day &&
            item.campaignType === schedule.primaryCampaignType &&
            item.primaryModelEnforced === true,
        );
      }).length;
    const strategyIntegrity = sequence.every((item) => {
      if (item.campaignId === null && item.strategyId === null) return true;
      if (typeof item.campaignId !== "string" || typeof item.strategyId !== "string") return false;
      const campaign = registry.campaigns.find((candidate) => candidate.id === item.campaignId);
      const strategy = registry.contentStrategies.find((candidate) => candidate.id === item.strategyId);
      return campaign?.strategyId === item.strategyId &&
        strategy?.allowedCampaignTypes.includes(campaign.type) === true;
    });
    return {
      sequence,
      productsSeen,
      campaignTypesSeen,
      primaryDays,
      taxLienSelfIdentificationVerified: sequence.some(
        (item) =>
          item.productId === "tax-lien-platform" &&
          item.campaignType === "self-identification" &&
          item.finalState === "verified",
      ),
      strategyIntegrity,
      auditChainValid: store.auditChainValid(),
      simulatedProviderWrites,
    };
  } finally {
    store.close();
  }
}

async function portfolioReplay(options: Args): Promise<Record<string, unknown>> {
  const registryPath = resolve(option(options, "registry", projectDefaultRegistry()));
  const registry = await loadRegistryBundle(registryPath);
  const baseDay = option(options, "date", "2026-07-30");
  const daysValue = Number(options.days ?? 7);
  if (!Number.isInteger(daysValue) || daysValue < 1 || daysValue > 31) {
    throw new Error("--days must be an integer from 1 to 31");
  }
  const first = await portfolioReplayPass(registry, baseDay, daysValue);
  const replay = await portfolioReplayPass(registry, baseDay, daysValue);
  const expectedProducts = registry.products
    .filter((product) =>
      product.status === "active" &&
      product.state === "active" &&
      registry.campaigns.some(
        (campaign) => campaign.status === "active" && campaign.productId === product.id,
      ))
    .map((product) => product.id)
    .sort();
  const stableReplay = JSON.stringify(first.sequence) === JSON.stringify(replay.sequence);
  const allProductsRotated = expectedProducts.every((id) => first.productsSeen.includes(id));
  const terminalResults = new Set([
    "verified",
    "confirmed_absent",
    "skipped_no_eligible_candidate",
    "skipped_policy",
    "failed_closed",
    "reconciliation_required",
  ]);
  const allOpportunitiesFinal = first.sequence.every(
    (item) => typeof item.finalState === "string" && terminalResults.has(item.finalState),
  );
  const verifiedOpportunities = first.sequence.filter(
    (item) => item.finalState === "verified",
  ).length;
  const skippedOpportunities = first.sequence.filter(
    (item) =>
      item.finalState === "skipped_no_eligible_candidate" ||
      item.finalState === "skipped_policy",
  ).length;
  const passed =
    stableReplay &&
    allProductsRotated &&
    allOpportunitiesFinal &&
    first.primaryDays === daysValue &&
    first.taxLienSelfIdentificationVerified &&
    first.strategyIntegrity &&
    first.auditChainValid;
  return {
    passed,
    mode: "sequential-in-memory-portfolio-replay",
    registryPath,
    registryVersion: registry.registryVersion,
    registryHash: registryBundleHash(registry),
    baseDay,
    days: daysValue,
    opportunities: first.sequence.length,
    primaryCampaignType: registry.schedules.find(
      (item) => item.status === "active" && item.enabled,
    )?.primaryCampaignType,
    primaryDays: first.primaryDays,
    productsExpected: expectedProducts,
    productsSeen: first.productsSeen,
    campaignTypesSeen: first.campaignTypesSeen,
    taxLienSelfIdentificationVerified: first.taxLienSelfIdentificationVerified,
    strategyIntegrity: first.strategyIntegrity,
    allOpportunitiesFinal,
    verifiedOpportunities,
    skippedOpportunities,
    stableReplay,
    auditChainValid: first.auditChainValid,
    sequence: first.sequence,
    simulatedProviderWrites: first.simulatedProviderWrites,
    externalWrites: 0,
    llmCalls: 0,
  };
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "help") {
    print({
      commands: {
        "validate-registry": "--registry <path>",
        initialize: "--registry <path> --db <path>",
        plan: "--registry <path> --db <path> --at <ISO> [--platform <id>] [--account <id>]",
        overview: "--registry <path> --db <path>",
        diagnose: "--registry <path> [--date YYYY-MM-DD]",
        "portfolio-replay": "--registry <path> [--date YYYY-MM-DD] [--days 1-31]",
        "production-shadow":
          "--registry <path> --integration <path> --db <path> [--opportunity <id|auto>] [--at <ISO>]",
        "production-canary":
          "--registry <path> --integration <path> --db <path> --opportunity <id> --at <ISO> [--media-delivery <path>]",
      },
      guardrail:
        "Provider-writing commands require an exact matching approved integration mode and remain official-worker-owned.",
    });
    return;
  }
  if (command === "validate-registry") {
    const path = resolve(option(options, "registry", projectDefaultRegistry()));
    const registry = await loadRegistryBundle(path);
    print({
      valid: true,
      path,
      registryVersion: registry.registryVersion,
      registryHash: registryBundleHash(registry),
      slotTimes: registry.schedules.flatMap((schedule) => schedule.slotTimes),
      prohibitedPlatforms: Array.from(PROHIBITED_PLATFORM_IDS),
    });
    return;
  }
  if (command === "diagnose") {
    const result = await diagnostic(options);
    print(result);
    if (!result.passed) process.exitCode = 1;
    return;
  }
  if (command === "portfolio-replay") {
    const result = await portfolioReplay(options);
    print(result);
    if (!result.passed) process.exitCode = 1;
    return;
  }
  if (["production-shadow", "production-canary"].includes(command)) {
    const productionMode = command === "production-shadow"
      ? "shadow"
      : "canary";
    if (
      productionMode === "canary" &&
      (typeof options.opportunity !== "string" || typeof options.at !== "string")
    ) {
      throw new Error("production-canary requires an explicit --opportunity and --at");
    }
    const isolatedInvoker =
      typeof options["connector-entry"] === "string"
        ? await isolatedConnectorShadowInvoker({
          connectorEntry: options["connector-entry"],
          activityLedgerPath: option(options, "activity-ledger"),
          admissionDatabasePath: option(options, "admission-db"),
        })
        : undefined;
    const mediaDelivery = typeof options["media-delivery"] === "string"
      ? parseCampaignMediaDelivery(JSON.parse(
        await readFile(resolve(options["media-delivery"]), "utf8"),
      ))
      : undefined;
    const result = await runProductionOpportunity({
      registryPath: option(options, "registry", projectDefaultRegistry()),
      integrationPath: option(options, "integration"),
      databasePath: option(options, "db"),
      opportunityId:
        typeof options.opportunity === "string" ? options.opportunity : "auto",
      scheduledFor:
        typeof options.at === "string" ? date(options.at) : new Date(),
      mode: productionMode,
      allowProviderWrite: productionMode !== "shadow",
      toolInvoker: isolatedInvoker,
      openclawBin:
        typeof options["openclaw-bin"] === "string"
          ? options["openclaw-bin"]
          : undefined,
      workspace:
        typeof options.workspace === "string"
          ? options.workspace
          : process.cwd(),
      mediaDelivery,
    });
    print(result);
    const accepted = productionMode === "shadow"
      ? new Set(["shadow_verified", "skipped_policy", "skipped_no_eligible_candidate"])
      : new Set(["verified"]);
    if (!accepted.has(String(result.result))) process.exitCode = 1;
    return;
  }
  const { engine, store } = await engineFor(options);
  try {
    if (command === "initialize") {
      print(engine.overview());
      return;
    }
    if (command === "overview") {
      print({
        ...engine.overview(),
        slots: store.slotRuns(),
        publications: store.publications(),
      });
      return;
    }
    if (command === "plan") {
      const platformId =
        typeof options.platform === "string" ? options.platform : undefined;
      const accountId =
        typeof options.account === "string" ? options.account : undefined;
      print(engine.planSlot({
        scheduledFor: date(option(options, "at")),
        now: date(option(options, "at")),
        platformId,
        accountId,
      }));
      return;
    }
    throw new Error(`Unknown command: ${command}`);
  } finally {
    store.close();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
