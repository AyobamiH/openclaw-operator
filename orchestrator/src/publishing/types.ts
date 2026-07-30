export const PRODUCT_STATES = [
  "draft",
  "review_required",
  "approved",
  "active",
  "paused",
  "retired",
  "blocked",
] as const;
export type ProductState = (typeof PRODUCT_STATES)[number];

export const CAMPAIGN_TYPES = [
  "self-identification",
  "problem-education",
  "practical-diagnostic",
  "founder-observation",
  "proof-and-evidence",
  "product-update",
  "community-discussion",
  "research-insight",
] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export const PUBLICATION_STATES = [
  "planned",
  "generated",
  "validated",
  "reserved",
  "shadow_verified",
  "publishing",
  "published_unverified",
  "verified",
  "confirmed_absent",
  "reconciliation_required",
  "failed_closed",
  "superseded",
] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

export const SLOT_RESULTS = [
  "shadow_verified",
  "verified",
  "confirmed_absent",
  "skipped_no_eligible_candidate",
  "skipped_policy",
  "failed_closed",
  "reconciliation_required",
] as const;
export type SlotResult = (typeof SLOT_RESULTS)[number];

export type RegistryStatus = "draft" | "approved" | "active" | "paused" | "retired" | "blocked";
export type PlatformId = string;
export const PROHIBITED_PLATFORM_IDS = new Set(["reddit"]);

export interface VersionedRegistryRecord {
  id: string;
  version: string;
  status: RegistryStatus;
  approvalId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductRecord extends VersionedRegistryRecord {
  name: string;
  state: ProductState;
  targetAudienceIds: string[];
  allowedCampaignTypes: CampaignType[];
  claimIds: string[];
  evidenceIds: string[];
  assetIds: string[];
  defaultCtaId: string;
  minimumCooldownHours: number;
  dailyPublicationCap: number;
}

export interface CampaignRecord extends VersionedRegistryRecord {
  productId: string;
  name: string;
  type: CampaignType;
  audienceId: string;
  identitySignalIds: string[];
  problemOutcomeIds: string[];
  strategyId: string;
  templateIds: string[];
  platformIds: PlatformId[];
  ctaId: string;
  claimIds: string[];
  evidenceIds: string[];
  priority: number;
  minimumCooldownHours: number;
  dailyCap: number;
  startAt?: string | null;
  endAt?: string | null;
}

export interface AudienceRecord extends VersionedRegistryRecord {
  name: string;
  description: string;
  exclusions: string[];
}

export interface IdentitySignalRecord extends VersionedRegistryRecord {
  audienceId: string;
  signal: string;
  evidenceRequirement: string;
}

export interface ProblemOutcomeRecord extends VersionedRegistryRecord {
  problem: string;
  outcome: string;
  productIds: string[];
}

export interface ContentStrategyRecord extends VersionedRegistryRecord {
  name: string;
  objective: string;
  allowedCampaignTypes: CampaignType[];
  prohibitedPatterns: string[];
}

export interface ClaimRecord extends VersionedRegistryRecord {
  text: string;
  productId: string;
  evidenceIds: string[];
  expiresAt?: string | null;
  risk: "low" | "medium" | "high";
}

export interface EvidenceRecord extends VersionedRegistryRecord {
  kind: "repository" | "runtime" | "provider" | "document" | "metric" | "asset";
  source: string;
  capturedAt: string;
  summary: string;
  contentHash?: string | null;
  expiresAt?: string | null;
}

export interface AssetRecord extends VersionedRegistryRecord {
  productId: string;
  kind: "image" | "video" | "audio" | "document" | "repository";
  source: string;
  sha256?: string | null;
  perceptualHash?: string | null;
  canonical: boolean;
  providerPublicationIds: string[];
}

export interface CtaRecord extends VersionedRegistryRecord {
  label: string;
  intent: "conversation" | "diagnostic" | "repository" | "website" | "none";
  text: string;
  url?: string | null;
}

export interface PlatformPolicyRecord extends VersionedRegistryRecord {
  platformId: PlatformId;
  accountId: string;
  connectorId: string;
  allowedFormats: Array<"text" | "image" | "reel">;
  maxCaptionLength: number;
  maxDailyPublications: number;
  minimumSpacingMinutes: number;
  requiresProviderReadback: true;
  requiresOfficialApi: true;
}

export interface ScheduleRecord extends VersionedRegistryRecord {
  timezone: "Europe/London";
  slotTimes: string[];
  primaryCampaignType: "self-identification";
  opportunityOnly: true;
  enabled: boolean;
}

export interface TemplateRecord extends VersionedRegistryRecord {
  name: string;
  campaignTypes: CampaignType[];
  platformIds: PlatformId[];
  format: "text" | "image" | "reel";
  fields: {
    hook: string;
    body: string;
    cta: string;
    altText?: string;
  };
  requiredVariables: string[];
}

export interface PromptRecord extends VersionedRegistryRecord {
  purpose: "constrained-language-render";
  schemaVersion: string;
  instructions: string;
  allowedFields: string[];
  fallbackTemplateId: string;
}

export interface ExperimentRecord extends VersionedRegistryRecord {
  name: string;
  approved: boolean;
  hypothesis: string;
  metricDefinitionId: string;
  campaignIds: string[];
  adjustment: number;
  startsAt: string;
  endsAt: string;
}

export interface ApprovalRegistryRecord extends VersionedRegistryRecord {
  scope: string;
  decision: "approved" | "rejected" | "pending" | "expired";
  approver: string;
  decidedAt?: string | null;
  expiresAt?: string | null;
  evidence: string[];
}

export interface MetricDefinitionRecord extends VersionedRegistryRecord {
  name: string;
  unit: string;
  source: "provider" | "website" | "crm" | "manual";
  unavailableIsZero: false;
}

export interface AttributionDefinitionRecord extends VersionedRegistryRecord {
  name: string;
  fromType: string;
  toType: string;
  minimumEvidenceCount: number;
  allowedConfidence: Array<"low" | "medium" | "high">;
}

export interface PublishingRegistryBundle {
  schemaVersion: "1.0.0";
  registryVersion: string;
  updatedAt: string;
  products: ProductRecord[];
  campaigns: CampaignRecord[];
  audiences: AudienceRecord[];
  identitySignals: IdentitySignalRecord[];
  problemsOutcomes: ProblemOutcomeRecord[];
  contentStrategies: ContentStrategyRecord[];
  claims: ClaimRecord[];
  evidence: EvidenceRecord[];
  assets: AssetRecord[];
  ctas: CtaRecord[];
  platformPolicies: PlatformPolicyRecord[];
  schedules: ScheduleRecord[];
  templates: TemplateRecord[];
  prompts: PromptRecord[];
  experiments: ExperimentRecord[];
  approvals: ApprovalRegistryRecord[];
  metricDefinitions: MetricDefinitionRecord[];
  attributionDefinitions: AttributionDefinitionRecord[];
}

export interface ScoreComponents {
  productPriority: number;
  campaignPriority: number;
  identitySignalStrength: number;
  evidenceQuality: number;
  recency: number;
  platformFit: number;
  distributionNeed: number;
  performanceAdjustment: number;
  cooldownPenalty: number;
  saturationPenalty: number;
}

export interface PublishingCandidate {
  id: string;
  productId: string;
  campaignId: string;
  campaignType: CampaignType;
  audienceId: string;
  platformId: PlatformId;
  accountId: string;
  templateId: string;
  ctaId: string;
  claimIds: string[];
  evidenceIds: string[];
  identitySignalIds: string[];
  problemOutcomeIds: string[];
  score: number;
  scoreComponents: ScoreComponents;
  tieBreak: string;
  eligibilityReasons: string[];
}

export interface ContentSpec {
  id: string;
  schemaVersion: "1.0.0";
  contentHash: string;
  createdAt: string;
  immutable: true;
  productId: string;
  campaignId: string;
  audienceId: string;
  platformId: PlatformId;
  accountId: string;
  slotKey: string;
  format: "text" | "image" | "reel";
  campaignType: CampaignType;
  strategyId: string;
  identitySignalIds: string[];
  problemOutcomeIds: string[];
  claimIds: string[];
  evidenceIds: string[];
  assetIds: string[];
  ctaId: string;
  templateId: string;
  languageRenderer: {
    mode: "template" | "constrained-llm";
    promptId?: string | null;
    model?: string | null;
    promptVersion?: string | null;
    requestHash?: string | null;
  };
  renderedIntent: {
    hook: string;
    body: string;
    cta: string;
    altText?: string | null;
  };
  selection: {
    seed: string;
    score: number;
    components: ScoreComponents;
    tieBreak: string;
    registryVersion: string;
  };
}

export interface ValidationFinding {
  layer:
    | "schema"
    | "references"
    | "approval"
    | "lifecycle"
    | "platform"
    | "claims"
    | "sales-language"
    | "links-assets"
    | "duplicate"
    | "cooldown"
    | "quota-distribution"
    | "readiness";
  status: "passed" | "failed";
  code: string;
  message: string;
  evidence: string[];
}

export interface ValidationResult {
  passed: boolean;
  contentHash: string;
  findings: ValidationFinding[];
}

export interface SlotPlan {
  slotRunId: string;
  slotKey: string;
  result: SlotResult | "reserved";
  candidate: PublishingCandidate | null;
  contentSpec: ContentSpec | null;
  validation: ValidationResult | null;
  reasons: string[];
  reservation: {
    reservationId: string;
    publicationId: string;
    idempotencyKey: string;
  } | null;
}

export interface ConnectorPublishRequest {
  idempotencyKey: string;
  contentSpec: ContentSpec;
  renderedCandidate: {
    text: string;
    mediaUrl?: string | null;
    mediaHash?: string | null;
  };
}

export interface ConnectorPublishResult {
  providerId?: string | null;
  providerResponseHash?: string | null;
  ambiguous: boolean;
  rawReceipt: Record<string, unknown>;
}

export interface ConnectorReadback {
  found: boolean;
  providerId?: string | null;
  ownedByExpectedAccount: boolean;
  contentHashMatches: boolean;
  permalink?: string | null;
  publishedAt?: string | null;
  mediaType?: string | null;
  evidence: Record<string, unknown>;
}

export interface PublishingConnector {
  platformId: PlatformId;
  connectorId: string;
  readiness(): Promise<{ ready: boolean; reasons: string[] }>;
  publish(request: ConnectorPublishRequest): Promise<ConnectorPublishResult>;
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

export interface AssetRelationship {
  classification: "exact" | "recompression" | "derivative" | "unrelated" | "unknown";
  confidence: "high" | "medium" | "low";
  reasons: string[];
}
