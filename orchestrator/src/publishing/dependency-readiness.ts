import { readFile } from "node:fs/promises";
import { z } from "zod";

const CATEGORY = [
  "LOCALLY_IMPLEMENTABLE",
  "APPROVAL_REQUIRED",
  "PRODUCT_DECISION_REQUIRED",
  "CAMPAIGN_DECISION_REQUIRED",
  "EVIDENCE_CONNECTOR_REQUIRED",
  "EXTERNAL_CREDENTIAL_REQUIRED",
  "READY_BUT_INTENTIONALLY_INACTIVE",
] as const;

const FAMILY_STATE = [
  "MISSING_PRODUCT_DEFINITION",
  "MISSING_AUDIENCE",
  "MISSING_EVIDENCE",
  "MISSING_STRATEGY",
  "MISSING_APPROVAL",
  "READY_FOR_ACTIVATION",
  "ACTIVE",
] as const;

const sourceStateSchema = z.object({
  scope: z.literal("business-loop-lifecycle-repair"),
  sourceImplemented: z.boolean(),
  committed: z.boolean(),
  pushed: z.boolean(),
  runtimeLoaded: z.boolean(),
  runtimeVerified: z.boolean(),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  remoteHead: z.string().regex(/^[a-f0-9]{40}$/),
  loadedAt: z.string().datetime({ offset: true }),
  runtimeVerificationReason: z.string().min(1),
});

const dependencySchema = z.object({
  id: z.string().min(1),
  capability: z.string().min(1),
  phase: z.union([z.literal(3), z.literal(6), z.literal(7), z.literal(8)]),
  categories: z.array(z.enum(CATEGORY)).min(1),
  readiness: z.string().min(1),
  exactMissingDecisionOrInput: z.string().min(1),
  whyRequired: z.string().min(1),
  runtimeBehaviourUnlocked: z.string().min(1),
  acceptedSchemaOrChoices: z.record(z.string(), z.unknown()),
  evidenceAlreadyAvailable: z.array(z.string().min(1)),
  evidenceStillMissing: z.array(z.string().min(1)),
  approvalScope: z.string().min(1),
  technicalReadinessState: z.string().min(1),
  nextExecutableActionOnceSupplied: z.string().min(1),
});

const campaignFamilySchema = z.object({
  family: z.enum([
    "problem-education",
    "founder-observation",
    "product-update",
    "community-discussion",
    "research-insight",
  ]),
  campaignId: z.string().min(1),
  readinessStates: z.array(z.enum(FAMILY_STATE)).min(1),
  evidenceAlreadyAvailable: z.array(z.string().min(1)),
  evidenceStillMissing: z.array(z.string().min(1)),
  nextExecutableAction: z.string().min(1),
});

const readinessSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  generatedAt: z.string().datetime({ offset: true }),
  overallVerdict: z.literal("PRE_GRAPH_CONTRACT_GOVERNED_WITH_EXTERNAL_BLOCKERS"),
  sourceState: sourceStateSchema,
  dependencies: z.array(dependencySchema).min(1),
  campaignFamilies: z.array(campaignFamilySchema).length(5),
});

export type CampaignDependencyReadiness = z.infer<typeof readinessSchema>;

export function validateCampaignDependencyReadiness(raw: unknown): CampaignDependencyReadiness {
  const readiness = readinessSchema.parse(raw);
  const phases = new Set(readiness.dependencies.map((item) => item.phase));
  for (const phase of [3, 6, 7, 8] as const) {
    if (!phases.has(phase)) throw new Error(`Campaign dependency readiness is missing Phase ${phase}`);
  }
  if (new Set(readiness.dependencies.map((item) => item.id)).size !== readiness.dependencies.length) {
    throw new Error("Campaign dependency readiness contains duplicate dependency ids");
  }
  if (new Set(readiness.campaignFamilies.map((item) => item.family)).size !== 5) {
    throw new Error("Campaign dependency readiness must contain five distinct campaign families");
  }
  return readiness;
}

export async function loadCampaignDependencyReadiness(path: string): Promise<CampaignDependencyReadiness> {
  return validateCampaignDependencyReadiness(JSON.parse(await readFile(path, "utf8")));
}
