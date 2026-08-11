import { createHash } from "node:crypto";
import {
  createSharedCoordinationStore,
  type CoordinationHealth,
  type LeaseClaimResult,
} from "../../../agents/shared/runtime-coordination.js";

const coordinationStore = createSharedCoordinationStore({
  prefix: "openclaw:orchestrator:coordination",
  loggerPrefix: "runtime-coordination",
});

const TASK_EXECUTION_LEASE_MS = 15 * 60 * 1000;
const DOC_REPAIR_LOCK_MS = 5 * 60 * 1000;
const DOC_REPAIR_SINGLE_FLIGHT_KEY = "knowledge-pack-mutation";

function normalizeDocRepairPaths(paths: string[]) {
  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))].sort();
}

export function buildDocRepairFingerprint(paths: string[]) {
  return normalizeDocRepairPaths(paths).join("|");
}

function buildDigest(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

function buildDocRepairKey(paths: string[]) {
  const fingerprint = buildDocRepairFingerprint(paths);
  return {
    fingerprint,
    digest: buildDigest(fingerprint),
  };
}

export function buildDocRepairRepairId(paths: string[], burstIdentity?: string) {
  const fingerprint = buildDocRepairFingerprint(paths);
  const burst = burstIdentity?.trim() ?? "";
  const digest = buildDigest(`${fingerprint}\n${burst}`);
  return `doc-drift:${digest.slice(0, 16)}`;
}

export async function getRuntimeCoordinationHealth(): Promise<CoordinationHealth> {
  return coordinationStore.getHealth();
}

export async function claimTaskExecutionLease(
  idempotencyKey: string,
  owner: string,
  ttlMs: number = TASK_EXECUTION_LEASE_MS,
): Promise<LeaseClaimResult> {
  return coordinationStore.claimLease("task-execution", idempotencyKey, owner, ttlMs);
}

export async function releaseTaskExecutionLease(
  idempotencyKey: string,
  owner: string,
) {
  return coordinationStore.releaseLease("task-execution", idempotencyKey, owner);
}

export async function claimDocRepairLock(
  paths: string[],
  owner: string,
  ttlMs: number = DOC_REPAIR_LOCK_MS,
) {
  const { fingerprint } = buildDocRepairKey(paths);
  if (!fingerprint) {
    return {
      acquired: false,
      store: "memory" as const,
      owner,
      existingOwner: null,
      expiresAt: null,
    };
  }
  return coordinationStore.claimLease(
    "doc-repair-lock",
    DOC_REPAIR_SINGLE_FLIGHT_KEY,
    owner,
    ttlMs,
  );
}

export async function releaseDocRepairLock(paths: string[], owner: string) {
  const { fingerprint } = buildDocRepairKey(paths);
  if (!fingerprint) return false;
  return coordinationStore.releaseLease(
    "doc-repair-lock",
    DOC_REPAIR_SINGLE_FLIGHT_KEY,
    owner,
  );
}

export async function isDocRepairCooldownActive(paths: string[]) {
  const { fingerprint, digest } = buildDocRepairKey(paths);
  if (!fingerprint) return false;
  const remainingTtlMs = await coordinationStore.getRemainingTtlMs(
    "doc-repair-cooldown",
    digest,
  );
  return typeof remainingTtlMs === "number" && remainingTtlMs > 0;
}

export async function markDocRepairCooldown(
  paths: string[],
  payload: Record<string, unknown>,
  ttlMs: number,
) {
  const { fingerprint, digest } = buildDocRepairKey(paths);
  if (!fingerprint) return;
  await coordinationStore.setJson(
    "doc-repair-cooldown",
    digest,
    {
      fingerprint,
      ...payload,
    },
    { ttlMs },
  );
}

export async function clearDocRepairCooldown(paths: string[]) {
  const { fingerprint, digest } = buildDocRepairKey(paths);
  if (!fingerprint) return;
  await coordinationStore.deleteKey("doc-repair-cooldown", digest);
}

export async function clearDocRepairLock(paths: string[]) {
  const { fingerprint } = buildDocRepairKey(paths);
  if (!fingerprint) return;
  await coordinationStore.deleteKey("doc-repair-lock", DOC_REPAIR_SINGLE_FLIGHT_KEY);
}

export async function resetRuntimeCoordinationStoreForTests() {
  await coordinationStore.resetMemory();
}

export async function closeRuntimeCoordinationStore() {
  await coordinationStore.close();
}
