import {
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "./canonical.js";

import type { PlatformId, PublishingRegistryBundle } from "./types.js";

export type ProductionOpportunity = {
  id: string;
  localTime: string;
  platformId: PlatformId;
  accountId: string;
  connectorAccountKey: string;
  enabled: boolean;
  canaryEligible: boolean;
};

export type ProductionIntegration = {
  schemaVersion: 1;
  laneId: string;
  timezone: "Europe/London";
  mode: "shadow" | "canary" | "live";
  schedulerLatenessToleranceMinutes: number;
  runtimeOwner: string;
  workerAgentId: string;
  opportunities: ProductionOpportunity[];
  protectedLegacyJobs: Array<{
    id: string;
    owner: string;
    mutationPolicy: "untouched";
  }>;
  historicalReconciliations: Array<{
    idempotencyKey: string;
    classification: "confirmed_absent";
    evidenceRef: string;
  }>;
  rollback: {
    previousRuntimeOwner: "legacy-existing";
    productJobRemovalSafe: boolean;
    productStatePreserved: boolean;
    admissionStatePreserved: boolean;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function loadProductionIntegration(
  filePath: string,
  registry: PublishingRegistryBundle,
): Promise<ProductionIntegration> {
  const parsed = JSON.parse(await readFile(resolve(filePath), "utf8")) as unknown;
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
    throw new Error("Production integration schemaVersion must be 1");
  }
  if (parsed.timezone !== "Europe/London") {
    throw new Error("Production integration timezone must be Europe/London");
  }
  if (!["shadow", "canary", "live"].includes(String(parsed.mode))) {
    throw new Error("Production integration mode is invalid");
  }
  const schedulerLatenessToleranceMinutes = Number(
    parsed.schedulerLatenessToleranceMinutes,
  );
  if (
    !Number.isInteger(schedulerLatenessToleranceMinutes) ||
    schedulerLatenessToleranceMinutes < 0 ||
    schedulerLatenessToleranceMinutes > 10
  ) {
    throw new Error(
      "Production integration schedulerLatenessToleranceMinutes must be an integer from 0 to 10",
    );
  }
  const laneId = String(parsed.laneId || "");
  const runtimeOwner = String(parsed.runtimeOwner || "");
  const workerAgentId = String(parsed.workerAgentId || "");
  for (const [label, value] of Object.entries({ laneId, runtimeOwner, workerAgentId })) {
    if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{2,127}$/.test(value)) {
      throw new Error(`Production integration ${label} is invalid`);
    }
  }
  if (!Array.isArray(parsed.opportunities) || parsed.opportunities.length !== 5) {
    throw new Error("Exactly five product opportunities must be allocated");
  }
  const opportunities = parsed.opportunities.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new Error(`opportunities[${index}] is invalid`);
    }
    const opportunity = {
      id: String(candidate.id || ""),
      localTime: String(candidate.localTime || ""),
      platformId: String(candidate.platformId || ""),
      accountId: String(candidate.accountId || ""),
      connectorAccountKey: String(candidate.connectorAccountKey || ""),
      enabled: candidate.enabled === true,
      canaryEligible: candidate.canaryEligible === true,
    };
    if (
      !/^[a-z0-9][a-z0-9:_-]{2,127}$/.test(opportunity.id) ||
      !/^\d{2}:\d{2}$/.test(opportunity.localTime) ||
      !/^[a-z0-9][a-z0-9:_-]{2,127}$/.test(opportunity.connectorAccountKey)
    ) {
      throw new Error(`opportunities[${index}] has invalid identifiers`);
    }
    const policy = registry.platformPolicies.find(
      (item) =>
        item.status === "active" &&
        item.platformId === opportunity.platformId &&
        item.accountId === opportunity.accountId,
    );
    if (!policy) {
      throw new Error(`opportunities[${index}] has no active product platform policy`);
    }
    return opportunity;
  });
  const schedule = registry.schedules.find(
    (item) => item.status === "active" && item.enabled,
  );
  if (!schedule) throw new Error("Product registry has no active schedule");
  const allocatedTimes = opportunities.map((item) => item.localTime).sort();
  if (
    JSON.stringify(allocatedTimes) !== JSON.stringify([...schedule.slotTimes].sort()) ||
    new Set(opportunities.map((item) => item.id)).size !== 5
  ) {
    throw new Error("Production opportunity allocation must exactly cover the product schedule");
  }
  if (!Array.isArray(parsed.protectedLegacyJobs) || parsed.protectedLegacyJobs.length !== 4) {
    throw new Error("All four legacy publication jobs must be explicitly protected");
  }
  if (!Array.isArray(parsed.historicalReconciliations)) {
    throw new Error("Historical ambiguous writes must be explicitly classified");
  }
  const historicalReconciliations = parsed.historicalReconciliations.map(
    (candidate, index) => {
      if (!isRecord(candidate)) {
        throw new Error(`historicalReconciliations[${index}] is invalid`);
      }
      const idempotencyKey = String(candidate.idempotencyKey || "");
      const classification = String(candidate.classification || "");
      const evidenceRef = String(candidate.evidenceRef || "");
      if (
        !/^[a-f0-9]{64}$/.test(idempotencyKey) ||
        classification !== "confirmed_absent" ||
        !evidenceRef
      ) {
        throw new Error(`historicalReconciliations[${index}] is invalid`);
      }
      return {
        idempotencyKey,
        classification: "confirmed_absent" as const,
        evidenceRef,
      };
    },
  );
  for (const [index, job] of parsed.protectedLegacyJobs.entries()) {
    if (!isRecord(job) || job.mutationPolicy !== "untouched") {
      throw new Error(`protectedLegacyJobs[${index}] must remain untouched`);
    }
  }
  if (
    !isRecord(parsed.rollback) ||
    parsed.rollback.previousRuntimeOwner !== "legacy-existing" ||
    parsed.rollback.productJobRemovalSafe !== true ||
    parsed.rollback.productStatePreserved !== true ||
    parsed.rollback.admissionStatePreserved !== true
  ) {
    throw new Error("Rollback contract is incomplete");
  }
  return {
    schemaVersion: 1,
    laneId,
    timezone: "Europe/London",
    mode: parsed.mode as ProductionIntegration["mode"],
    schedulerLatenessToleranceMinutes,
    runtimeOwner,
    workerAgentId,
    opportunities,
    protectedLegacyJobs: parsed.protectedLegacyJobs as ProductionIntegration["protectedLegacyJobs"],
    historicalReconciliations,
    rollback: parsed.rollback as ProductionIntegration["rollback"],
  };
}

function localClock(date: Date, timezone: "Europe/London"): {
  hour: number;
  minute: number;
  second: number;
} {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function resolveProductionOpportunity(
  integration: ProductionIntegration,
  opportunityId: string,
  observedAt: Date,
): {
  opportunity: ProductionOpportunity;
  scheduledFor: Date;
  latenessMs: number;
} {
  const observed = localClock(observedAt, integration.timezone);
  const observedMinute = observed.hour * 60 + observed.minute;
  const candidates = integration.opportunities
    .filter((candidate) => candidate.enabled)
    .filter((candidate) => opportunityId === "auto" || candidate.id === opportunityId)
    .map((candidate) => {
      const [hour, minute] = candidate.localTime.split(":").map(Number);
      const latenessMinutes = observedMinute - (hour * 60 + minute);
      const latenessMs =
        latenessMinutes * 60_000 +
        observed.second * 1_000 +
        observedAt.getMilliseconds();
      return { candidate, latenessMinutes, latenessMs };
    })
    .filter(
      ({ latenessMinutes, latenessMs }) =>
        latenessMinutes >= 0 &&
        latenessMs <= integration.schedulerLatenessToleranceMinutes * 60_000,
    );
  if (candidates.length !== 1) {
    throw new Error(
      `No unique product opportunity is allocated within the ${integration.schedulerLatenessToleranceMinutes}-minute scheduler tolerance`,
    );
  }
  const selected = candidates[0];
  const latenessMs = selected.latenessMs;
  return {
    opportunity: selected.candidate,
    scheduledFor: new Date(observedAt.getTime() - latenessMs),
    latenessMs,
  };
}

export function opportunityFor(
  integration: ProductionIntegration,
  opportunityId: string,
  scheduledFor: Date,
): ProductionOpportunity {
  const opportunity = integration.opportunities.find(
    (candidate) => candidate.id === opportunityId && candidate.enabled,
  );
  if (!opportunity) throw new Error(`Opportunity is not allocated or enabled: ${opportunityId}`);
  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: integration.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(scheduledFor);
  if (localTime !== opportunity.localTime) {
    throw new Error(
      `Opportunity ${opportunity.id} is allocated at ${opportunity.localTime}, not ${localTime}`,
    );
  }
  return opportunity;
}

async function fileHash(filePath: string): Promise<string> {
  return sha256(await readFile(filePath));
}

export async function rehearseProductionRollback(input: {
  installedConnectorPath: string;
  candidateConnectorPath: string;
  connectorConfigPath: string;
  candidateConfigPath: string;
  productJobDeclarationPath: string;
  productStatePath: string;
  admissionStatePath: string;
  backupDirectory: string;
}): Promise<Record<string, unknown>> {
  await mkdir(input.backupDirectory, { recursive: true });
  const installedHash = await fileHash(input.installedConnectorPath);
  const configHash = await fileHash(input.connectorConfigPath);
  const productStateHash = await fileHash(input.productStatePath);
  const admissionStateHash = await fileHash(input.admissionStatePath);
  const connectorBackup = resolve(input.backupDirectory, "connector.backup");
  const configBackup = resolve(input.backupDirectory, "connector-config.backup");
  await copyFile(input.installedConnectorPath, connectorBackup);
  await copyFile(input.connectorConfigPath, configBackup);

  await copyFile(input.candidateConnectorPath, input.installedConnectorPath);
  await copyFile(input.candidateConfigPath, input.connectorConfigPath);
  await writeFile(
    input.productJobDeclarationPath,
    `${JSON.stringify({ laneId: "self-identification-engine", mode: "shadow" })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  await copyFile(connectorBackup, input.installedConnectorPath);
  await copyFile(configBackup, input.connectorConfigPath);
  await rm(input.productJobDeclarationPath, { force: true });
  const result = {
    previousConnectorRestored:
      (await fileHash(input.installedConnectorPath)) === installedHash,
    previousConfigRestored:
      (await fileHash(input.connectorConfigPath)) === configHash,
    productStatePreserved:
      (await fileHash(input.productStatePath)) === productStateHash,
    admissionStatePreserved:
      (await fileHash(input.admissionStatePath)) === admissionStateHash,
  };
  return {
    ...result,
    productJobRemoved: await readFile(input.productJobDeclarationPath)
      .then(() => false)
      .catch(() => true),
    passed: Object.values(result).every(Boolean),
    gatewayReloadPerformed: false,
    providerWrites: 0,
  };
}
