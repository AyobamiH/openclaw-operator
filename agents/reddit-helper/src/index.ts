import { readFile, writeFile, appendFile, mkdir, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Telemetry } from "../../shared/telemetry.js";
import { buildSpecialistOperatorFields } from "../../shared/runtime-evidence.js";
import {
  loadSharedBudgetState,
  saveSharedBudgetState,
  closeRedditCoordinationStore,
  type RedditHelperBudgetState,
} from "./coordination.ts";

interface AgentConfig {
  knowledgePackDir: string;
  draftLogPath: string;
  devvitQueuePath?: string;
  serviceStatePath: string;
  docsPath?: string;
  model?: {
    primary?: string;
    fallback?: string;
    tier?: string;
    temperature?: number;
    maxTokens?: number;
  } | string;
  permissions?: {
    skills?: Record<string, { allowed?: boolean }>;
  };
  openaiModel?: string;
  openaiMaxTokens?: number;
  openaiTemperature?: number;
  runtimeEngagementOsPath?: string;
}

interface OrchestratorRuntimeDefaults {
  openaiModel?: string;
  openaiMaxTokens?: number;
  openaiTemperature?: number;
  runtimeEngagementOsPath?: string;
  docsPath?: string;
}

interface RedditQueuePayload {
  id: string;
  subreddit: string;
  question: string;
  link?: string;
  tag?: string;
  pillar?: string;
  entryContent?: string;
  author?: string;
  ctaVariant?: string;
  matchedKeywords?: string[];
  score?: number;
  selectedForDraft?: boolean;
}

interface RssDraftPayload {
  draftId: string;
  suggestedReply: string;
  matchedKeywords: string[];
  scoreBreakdown: Record<string, number>;
  tag: string;
  ctaVariant: string;
}

interface TaskPayload {
  queue: RedditQueuePayload;
  rssDraft?: RssDraftPayload;
  knowledgePackPath?: string;
  knowledgePack?: KnowledgePack;
}

interface KnowledgePackDoc {
  source: "openclaw" | "openai";
  path: string;
  summary: string;
  wordCount: number;
  bytes: number;
  firstHeading?: string;
}

interface KnowledgePack {
  id: string;
  generatedAt: string;
  docs: KnowledgePackDoc[];
}

interface ConfidenceBreakdown {
  rssScore: number;
  llmScore: number;
  weights: { rss: number; llm: number };
  final: number;
}

interface AgentResult {
  replyText: string;
  confidence: number;
  rssScore?: number;
  qualityScore?: number;
  confidenceBreakdown?: ConfidenceBreakdown;
  ctaVariant?: string;
  devvitPayloadPath?: string;
  packId?: string;
  packPath?: string;
  reasoning?: string;
  draftMode?: "local-only" | "hybrid-polished";
  confusionCluster?: {
    clusterId: string;
    theme: string;
    matchedTerms: string[];
    docAnchors: string[];
  };
  faqCandidate?: {
    title: string;
    rationale: string;
    targetAgentId: "doc-specialist" | "content-agent";
  };
  replyVerification?: {
    doctrineApplied: string[];
    anchorCount: number;
    requiresReview: boolean;
    reasoning: string;
  };
  explanationBoundary?: {
    status: "public-safe" | "internal-only-review";
    reasons: string[];
  };
  providerPosture?: {
    mode:
      | "hybrid-polished"
      | "local-only"
      | "budget-exhausted-fallback"
      | "provider-backoff-fallback"
      | "provider-error-fallback";
    reason: string;
    llmEligible: boolean;
    reviewRecommended: boolean;
    fallbackIntegrity: "retained-local-doctrine" | "degraded";
    queuePressureStatus: "nominal" | "budget-exhausted" | "provider-backoff";
    backoffUntil: string | null;
    consecutiveFailures: number;
  };
  communitySignalRouting?: {
    handoffs: Array<{
      targetAgentId: string;
      surface: 'docs' | 'proof' | 'faq';
      reason: string;
    }>;
    systematic: boolean;
  };
  accounting?: {
    provider: string;
    model: string | null;
    metered: boolean;
    pricingSource: "catalog" | "override" | "unpriced" | "not-applicable";
    usage?: {
      promptTokens?: number | null;
      completionTokens?: number | null;
      totalTokens?: number | null;
    } | null;
    budget?: {
      status: "ok" | "exhausted" | "unknown";
      reason?: string | null;
      llmCallsToday?: number | null;
      tokensToday?: number | null;
      maxLlmCallsPerDay?: number | null;
      maxTokensPerDay?: number | null;
      remainingLlmCalls?: number | null;
      remainingTokens?: number | null;
      resetTimeZone?: string | null;
      budgetDate?: string | null;
    } | null;
    note?: string | null;
  };
  toolInvocations?: Array<{
    toolId: string;
    detail: string;
    evidence: string[];
    classification?: string;
  }>;
  relationships?: Array<{
    from: string;
    to: string;
    relationship: "feeds-agent";
    detail: string;
    evidence: string[];
    classification?: string;
  }>;
  proofTransitions?: Array<{
    transport: "milestone" | "demandSummary";
    detail: string;
    evidence: string[];
    classification?: string;
  }>;
  knowledgeFreshness?: {
    status:
      | "fresh"
      | "aging-pack"
      | "stale-pack"
      | "docs-ahead-of-pack"
      | "missing-pack";
    reviewRecommended: boolean;
    packGeneratedAt: string | null;
    packPath: string | null;
    packAgeHours: number | null;
    docsLatestModifiedAt: string | null;
    warnings: string[];
  };
  operatorSummary?: string;
  recommendedNextActions?: string[];
  specialistContract?: {
    role: string;
    workflowStage: string;
    deliverable: string;
    status: "completed" | "watching" | "blocked" | "escalate" | "refused";
    operatorSummary: string;
    recommendedNextActions: string[];
    refusalReason: string | null;
    escalationReason: string | null;
  };
}

interface RedditHelperServiceState {
  lastProcessedAt?: string;
  lastSeenCursor?: string;
  consecutiveFailures?: number;
  backoffUntil?: string | null;
  budgetDate?: string;
  llmCallsToday?: number;
  tokensToday?: number;
  budgetStatus?: "ok" | "exhausted";
  lastBudgetExceededAt?: string;
}

interface BudgetConfig {
  maxTokensPerDay: number;
  maxLlmCallsPerDay: number;
  resetTimeZone: string;
}

interface BudgetGuardResult {
  allowed: boolean;
  state: RedditHelperBudgetState;
  reason?: string;
}

interface OpenAICompletionClient {
  chat: {
    completions: {
      create: (payload: Record<string, unknown>) => Promise<{
        choices?: Array<{
          message?: {
            content?: string | null;
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      }>;
    };
  };
}

type OpenAIConstructor = new (options: { apiKey: string }) => OpenAICompletionClient;
type ExecuteSkillFn = (
  skillId: string,
  input: Record<string, unknown>,
  requestingAgent?: string,
) => Promise<Record<string, unknown>>;
type ReplySurface =
  | "runtime"
  | "integration"
  | "pricing"
  | "governance"
  | "content"
  | "general";

const telemetry = new Telemetry({ component: "reddit-helper" });
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_MAX_TOKENS_PER_DAY = 12_000;
const DEFAULT_MAX_LLM_CALLS_PER_DAY = 20;
const DEFAULT_BUDGET_RESET_TZ = "UTC";
const SENTENCE_SPLIT_REGEX = /[.!?]+/;
const CTA_REGEX = /\b(share|tell me|let me know|what do you control|is this live|pre-launch)\b/i;
const GENERIC_REPLY_REGEXES = [
  /^good question[.!]?/i,
  /\bthe main risk usually sits in\b/i,
  /\bshare that plus the exact blocker\b/i,
  /\bis this live or pre-launch\b/i,
] as const;
const BANNED_SOLUTIONING_REGEXES = [
  /\byou should implement\b/i,
  /\bset up\b/i,
  /\bdeploy this\b/i,
  /\bstep\s*1\b/i,
  /\bhere'?s how to\b/i,
  /\bfirst,\s+.*second,\s+/i,
] as const;
let openAIConstructorPromise: Promise<OpenAIConstructor> | null = null;
let executeSkillFnPromise: Promise<ExecuteSkillFn> | null = null;

function resolveOrchestratorPackageJsonPath() {
  const override = process.env.OPENCLAW_ORCHESTRATOR_PACKAGE_JSON?.trim();
  return override && override.length > 0
    ? resolve(override)
    : resolve(__dirname, "../../../orchestrator/package.json");
}

async function getOpenAIConstructor(): Promise<OpenAIConstructor> {
  if (!openAIConstructorPromise) {
    openAIConstructorPromise = (async () => {
      const orchestratorRequire = createRequire(resolveOrchestratorPackageJsonPath());
      const openAIEntryPath = orchestratorRequire.resolve("openai");
      const imported = await import(pathToFileURL(openAIEntryPath).href);
      const OpenAI = (imported.default ?? imported) as OpenAIConstructor;

      if (typeof OpenAI !== "function") {
        throw new Error("openai package resolved, but no constructor export was found");
      }

      return OpenAI;
    })();
  }

  return openAIConstructorPromise;
}

async function loadOrchestratorRuntimeDefaults(configDir: string): Promise<OrchestratorRuntimeDefaults> {
  const candidatePaths = [
    resolve(configDir, "../../orchestrator_config.json"),
    resolve(configDir, "../../orchestrator/orchestrator_config.json"),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      const raw = await readFile(candidatePath, "utf-8");
      const parsed = JSON.parse(raw) as OrchestratorRuntimeDefaults;
      return {
        openaiModel: parsed.openaiModel,
        openaiMaxTokens: parsed.openaiMaxTokens,
        openaiTemperature: parsed.openaiTemperature,
        runtimeEngagementOsPath:
          typeof parsed.runtimeEngagementOsPath === "string"
            ? resolve(dirname(candidatePath), parsed.runtimeEngagementOsPath)
            : undefined,
        docsPath:
          typeof parsed.docsPath === "string"
            ? resolve(dirname(candidatePath), parsed.docsPath)
            : undefined,
      };
    } catch {
      continue;
    }
  }

  return {};
}

async function loadConfig(): Promise<AgentConfig> {
  const configPath = resolve(__dirname, "../agent.config.json");
  const raw = await readFile(configPath, "utf-8");
  const parsed = JSON.parse(raw) as AgentConfig;
  if (!parsed.knowledgePackDir || !parsed.draftLogPath) {
    throw new Error("agent.config.json must include knowledgePackDir and draftLogPath");
  }
  const configDir = dirname(configPath);
  const orchestratorDefaults = await loadOrchestratorRuntimeDefaults(configDir);
  const configuredModel =
    typeof parsed.model === "string"
      ? parsed.model
      : typeof parsed.model?.primary === "string"
        ? parsed.model.primary
        : undefined;
  const configuredMaxTokens =
    typeof parsed.model === "object" && typeof parsed.model?.maxTokens === "number"
      ? parsed.model.maxTokens
      : parsed.openaiMaxTokens;
  const configuredTemperature =
    typeof parsed.model === "object" && typeof parsed.model?.temperature === "number"
      ? parsed.model.temperature
      : parsed.openaiTemperature;
  return {
    ...parsed,
    knowledgePackDir: resolve(configDir, parsed.knowledgePackDir),
    draftLogPath: resolve(configDir, parsed.draftLogPath),
    devvitQueuePath: parsed.devvitQueuePath
      ? resolve(configDir, parsed.devvitQueuePath)
      : undefined,
    serviceStatePath: resolve(configDir, parsed.serviceStatePath),
    docsPath:
      orchestratorDefaults.docsPath ??
      (typeof parsed.docsPath === "string" ? resolve(configDir, parsed.docsPath) : undefined),
    openaiModel:
      orchestratorDefaults.openaiModel ?? configuredModel ?? parsed.openaiModel ?? "gpt-4",
    openaiMaxTokens:
      orchestratorDefaults.openaiMaxTokens ?? configuredMaxTokens ?? 300,
    openaiTemperature:
      orchestratorDefaults.openaiTemperature ?? configuredTemperature ?? 0.7,
    runtimeEngagementOsPath:
      orchestratorDefaults.runtimeEngagementOsPath ??
      (typeof parsed.runtimeEngagementOsPath === "string"
        ? resolve(configDir, parsed.runtimeEngagementOsPath)
        : undefined),
  };
}

function canUseSkill(config: AgentConfig, skillId: string) {
  return config.permissions?.skills?.[skillId]?.allowed === true;
}

async function getExecuteSkill(): Promise<ExecuteSkillFn> {
  if (!executeSkillFnPromise) {
    executeSkillFnPromise = (async () => {
      const skillsModule = await import("../../../skills/index.ts");
      const candidate =
        (skillsModule as { executeSkill?: ExecuteSkillFn }).executeSkill ??
        (skillsModule as { default?: { executeSkill?: ExecuteSkillFn } }).default?.executeSkill;

      if (typeof candidate !== "function") {
        throw new Error("skills registry executeSkill export unavailable");
      }

      return candidate;
    })();
  }

  return executeSkillFnPromise;
}

async function ensureDir(path: string) {
  await mkdir(dirname(path), { recursive: true });
}

async function appendJsonl(path: string, data: Record<string, unknown>) {
  await ensureDir(path);
  await appendFile(path, `${JSON.stringify(data)}\n`, "utf-8");
}

async function loadKnowledgePackFromDir(dir: string): Promise<{ pack: KnowledgePack; path: string } | null> {
  try {
    const files = await readdir(dir);
    const candidates = files.filter((file) => file.endsWith(".json"));
    if (!candidates.length) return null;
    const sorted = await Promise.all(
      candidates.map(async (file) => {
        const fullPath = resolve(dir, file);
        const stats = await stat(fullPath);
        return { fullPath, mtime: stats.mtimeMs };
      }),
    );
    sorted.sort((a, b) => b.mtime - a.mtime);
    const latest = sorted[0];
    const raw = await readFile(latest.fullPath, "utf-8");
    return { pack: JSON.parse(raw) as KnowledgePack, path: latest.fullPath };
  } catch (error) {
    await telemetry.warn("knowledge-pack.load_failed", { message: (error as Error).message });
    return null;
  }
}

async function loadRuntimeEngagementOS(path?: string): Promise<string> {
  if (!path) return "";
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    await telemetry.warn("engagement-os.load_failed", { path, message: (error as Error).message });
    return "";
  }
}

async function findLatestModifiedAt(rootPath: string): Promise<number | null> {
  const queue = [rootPath];
  let latest: number | null = null;

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = resolve(current, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        queue.push(fullPath);
        continue;
      }

      try {
        const stats = await stat(fullPath);
        latest = latest == null ? stats.mtimeMs : Math.max(latest, stats.mtimeMs);
      } catch {
        continue;
      }
    }
  }

  return latest;
}

export async function inspectKnowledgeFreshness(args: {
  pack?: KnowledgePack;
  packPath?: string;
  docsPath?: string;
  now?: Date;
}): Promise<NonNullable<AgentResult["knowledgeFreshness"]>> {
  const now = args.now ?? new Date();
  let packFileMtime: number | null = null;

  if (args.packPath) {
    try {
      const stats = await stat(args.packPath);
      packFileMtime = stats.mtimeMs;
    } catch {
      packFileMtime = null;
    }
  }

  const packGeneratedAt =
    typeof args.pack?.generatedAt === "string" && !Number.isNaN(Date.parse(args.pack.generatedAt))
      ? args.pack.generatedAt
      : null;
  const packGeneratedTs =
    packGeneratedAt != null ? Date.parse(packGeneratedAt) : packFileMtime;
  const packAgeHours =
    packGeneratedTs != null && Number.isFinite(packGeneratedTs)
      ? Math.max(0, (now.getTime() - packGeneratedTs) / (1000 * 60 * 60))
      : null;
  const docsLatestModifiedTs =
    typeof args.docsPath === "string" && args.docsPath.length > 0
      ? await findLatestModifiedAt(args.docsPath)
      : null;
  const docsAheadOfPack =
    docsLatestModifiedTs != null &&
    packGeneratedTs != null &&
    docsLatestModifiedTs > packGeneratedTs + 60_000;

  const warnings: string[] = [];
  let status: NonNullable<AgentResult["knowledgeFreshness"]>["status"] = "fresh";

  if (packGeneratedTs == null) {
    status = "missing-pack";
    warnings.push(
      "No knowledge pack was available for this draft. Treat the reply as bounded local guidance and refresh drift-repair before broad reuse.",
    );
  } else if ((packAgeHours ?? 0) >= 72) {
    status = "stale-pack";
    warnings.push(
      `The latest knowledge pack is ${Math.round(packAgeHours ?? 0)}h old and should be refreshed before broad public reuse.`,
    );
  } else if ((packAgeHours ?? 0) >= 24) {
    status = "aging-pack";
    warnings.push(
      `The latest knowledge pack is aging at ${Math.round(packAgeHours ?? 0)}h old; review freshness before relying on it as current truth.`,
    );
  }

  if (docsAheadOfPack) {
    status = "docs-ahead-of-pack";
    warnings.push(
      "The docs mirror changed after the latest knowledge pack was generated. Run drift-repair so reddit-helper drafts against the refreshed pack.",
    );
  }

  return {
    status,
    reviewRecommended: status !== "fresh",
    packGeneratedAt,
    packPath: args.packPath ?? null,
    packAgeHours: packAgeHours != null ? Number(packAgeHours.toFixed(2)) : null,
    docsLatestModifiedAt:
      docsLatestModifiedTs != null ? new Date(docsLatestModifiedTs).toISOString() : null,
    warnings,
  };
}

function buildQueueTerms(queue?: RedditQueuePayload): string[] {
  if (!queue) return [];

  const rawTerms = [
    queue.subreddit,
    queue.tag,
    queue.pillar,
    ...(queue.matchedKeywords ?? []),
    ...`${queue.question ?? ""} ${queue.entryContent ?? ""}`
      .split(/[^a-zA-Z0-9_-]+/)
      .map((term) => term.trim()),
  ];

  return Array.from(
    new Set(
      rawTerms
        .filter((term): term is string => typeof term === "string" && term.length > 0)
        .map((term) => term.toLowerCase())
        .filter((term) => term.length >= 3),
    ),
  );
}

export function buildConfusionCluster(
  queue: RedditQueuePayload,
  docs: KnowledgePackDoc[],
) {
  const matchedTerms = buildQueueTerms(queue).slice(0, 6);
  const theme = matchedTerms.slice(0, 3).join("/") || queue.pillar || queue.tag || "general-confusion";
  const docAnchors = docs.slice(0, 3).map((doc) => doc.firstHeading ?? doc.path);
  const clusterId = `${queue.subreddit}:${theme}`.toLowerCase().replace(/[^a-z0-9:/_-]+/g, "-");
  return {
    clusterId,
    theme,
    matchedTerms,
    docAnchors,
  };
}

export function buildFaqCandidate(args: {
  cluster: ReturnType<typeof buildConfusionCluster>;
  queue: RedditQueuePayload;
  docs: KnowledgePackDoc[];
}) {
  const primaryAnchor = args.cluster.docAnchors[0] ?? args.queue.question;
  return {
    title: `Clarify ${args.cluster.theme} for r/${args.queue.subreddit}`,
    rationale: `Recurring confusion is anchored in ${primaryAnchor}. Convert the cluster into a durable FAQ or operator-facing content update.`,
    targetAgentId: args.docs.some((doc) => doc.source === "openclaw")
      ? ("doc-specialist" as const)
      : ("content-agent" as const),
  };
}

export function buildExplanationBoundary(replyText: string) {
  const reasons: string[] = [];
  if (/API_KEY|WEBHOOK_SECRET|orchestrator_config\.json|agent\.config\.json/i.test(replyText)) {
    reasons.push("mentions internal config or secret-boundary detail");
  }
  if (/\/home\/|systemd|mongo|redis password|serviceStatePath/i.test(replyText)) {
    reasons.push("mentions internal runtime or host detail");
  }
  return {
    status: reasons.length > 0 ? ("internal-only-review" as const) : ("public-safe" as const),
    reasons,
  };
}

export function buildReplyVerification(args: {
  replyText: string;
  queue: RedditQueuePayload;
  docs: KnowledgePackDoc[];
  engagementOS: string;
  explanationBoundary: ReturnType<typeof buildExplanationBoundary>;
}) {
  const quality = scoreReplyQualityDeterministically(
    args.replyText,
    args.queue,
    args.docs,
    args.engagementOS,
  );
  const doctrineApplied: string[] = [];
  if (/\?/g.test(args.replyText)) doctrineApplied.push("qualifying-question");
  if (CTA_REGEX.test(args.replyText)) doctrineApplied.push("cta-present");
  if (deriveDocTerms(args.docs).some((term) => args.replyText.toLowerCase().includes(term))) {
    doctrineApplied.push("local-context-grounded");
  }
  return {
    doctrineApplied,
    anchorCount: args.docs.length,
    requiresReview: quality.score < 0.72 || args.explanationBoundary.status !== "public-safe",
    reasoning: quality.reasoning,
  };
}

export function buildCommunitySignalRouting(args: {
  cluster: ReturnType<typeof buildConfusionCluster>;
  faqCandidate: ReturnType<typeof buildFaqCandidate>;
  replyVerification: ReturnType<typeof buildReplyVerification>;
  providerPosture: NonNullable<AgentResult['providerPosture']>;
}) {
  const handoffs = [
    {
      targetAgentId: args.faqCandidate.targetAgentId,
      surface: 'faq' as const,
      reason: `Recurring confusion cluster ${args.cluster.clusterId} should become a durable FAQ or operator-facing content update.`,
    },
    {
      targetAgentId: 'doc-specialist',
      surface: 'docs' as const,
      reason: `Community confusion around ${args.cluster.theme} should feed documentation and contradiction review.`,
    },
  ];

  if (args.replyVerification.requiresReview || args.providerPosture.reviewRecommended) {
    handoffs.push({
      targetAgentId: 'content-agent',
      surface: 'proof' as const,
      reason: 'Reply verification or provider posture indicates the public proof surface needs a bounded follow-up artifact.',
    });
  }

  return {
    handoffs,
    systematic: handoffs.length >= 2,
  };
}

export function buildRedditSpecialistFields(args: {
  queue: RedditQueuePayload;
  draftMode?: AgentResult["draftMode"];
  confidence: number;
  replyVerification: NonNullable<AgentResult["replyVerification"]>;
  providerPosture: NonNullable<AgentResult["providerPosture"]>;
  explanationBoundary: NonNullable<AgentResult["explanationBoundary"]>;
  communitySignalRouting: NonNullable<AgentResult["communitySignalRouting"]>;
  knowledgeFreshness?: NonNullable<AgentResult["knowledgeFreshness"]>;
  statusOverride?: "completed" | "watching" | "blocked" | "escalate" | "refused";
  operatorSummary?: string;
  recommendedNextActions?: Array<string | null | undefined>;
}) {
  const status =
    args.statusOverride ??
    (args.explanationBoundary.status !== "public-safe"
      ? "escalate"
      : args.replyVerification.requiresReview ||
          args.providerPosture.reviewRecommended ||
          args.providerPosture.mode !== "hybrid-polished" ||
          args.knowledgeFreshness?.reviewRecommended
        ? "watching"
        : "completed");

  return buildSpecialistOperatorFields({
    role: "Reddit Community Builder",
    workflowStage:
      status === "completed"
        ? "community-ready"
        : status === "watching"
          ? "community-review"
          : status === "escalate"
            ? "community-escalation"
            : "community-triage",
    deliverable:
      "community-safe reply draft with doctrine check, provider posture, and downstream handoff guidance",
    status,
    operatorSummary:
      args.operatorSummary ??
      `Prepared a ${args.draftMode ?? "local-only"} reddit draft for r/${args.queue.subreddit} at confidence ${args.confidence.toFixed(2)} with provider posture ${args.providerPosture.mode} and knowledge freshness ${args.knowledgeFreshness?.status ?? "unknown"}.`,
    recommendedNextActions:
      args.recommendedNextActions ??
      [
        args.replyVerification.requiresReview
          ? "Review the reply before public use because the doctrine or boundary check still wants supervision."
          : "Reply can move through the standard public-proof path.",
        args.communitySignalRouting.handoffs[0]?.reason ?? null,
        args.providerPosture.mode !== "hybrid-polished"
          ? "Keep the deterministic fallback draft bounded and monitor provider posture before broad reuse."
          : null,
        args.knowledgeFreshness?.reviewRecommended
          ? "Refresh the managed knowledge mirror through drift-repair before treating this draft as current or reusable."
          : null,
      ],
    escalationReason:
      status === "escalate"
        ? "Escalate because the reply crosses the public-safe boundary and should be rewritten before any public posting."
        : null,
  });
}

function scoreDocSnippet(doc: KnowledgePackDoc, terms: string[]): number {
  const heading = (doc.firstHeading ?? "").toLowerCase();
  const path = doc.path.toLowerCase();
  const summary = doc.summary.toLowerCase();

  let score = doc.source === "openclaw" ? 2 : 1;

  for (const term of terms) {
    if (heading.includes(term)) score += 6;
    if (path.includes(term)) score += 4;
    if (summary.includes(term)) score += 3;
  }

  if (terms.length === 0 && doc.source === "openclaw") {
    score += 2;
  }

  return score;
}

export function pickDocSnippets(pack?: KnowledgePack, queue?: RedditQueuePayload, limit = 12): KnowledgePackDoc[] {
  if (!pack?.docs?.length) return [];
  const terms = buildQueueTerms(queue);
  const scoredDocs = pack.docs
    .map((doc, index) => ({
      doc,
      index,
      score: scoreDocSnippet(doc, terms),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    });

  const openclawDocs = scoredDocs
    .filter((entry) => entry.doc.source === "openclaw")
    .map((entry) => entry.doc);
  const openaiDocs = scoredDocs
    .filter((entry) => entry.doc.source === "openai")
    .map((entry) => entry.doc);

  const selected: KnowledgePackDoc[] = [];
  const preferredSourceQuota = Math.ceil(Math.min(limit, pack.docs.length) / 2);

  selected.push(...openclawDocs.slice(0, preferredSourceQuota));
  selected.push(...openaiDocs.slice(0, preferredSourceQuota));

  for (const entry of scoredDocs) {
    if (selected.length >= Math.min(limit, pack.docs.length)) break;
    if (selected.includes(entry.doc)) continue;
    selected.push(entry.doc);
  }

  return selected;
}

function parsePositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getBudgetConfig(): BudgetConfig {
  return {
    maxTokensPerDay: parsePositiveIntEnv(
      "REDDIT_HELPER_MAX_TOKENS_PER_DAY",
      DEFAULT_MAX_TOKENS_PER_DAY,
    ),
    maxLlmCallsPerDay: parsePositiveIntEnv(
      "REDDIT_HELPER_MAX_LLM_CALLS_PER_DAY",
      DEFAULT_MAX_LLM_CALLS_PER_DAY,
    ),
    resetTimeZone:
      process.env.REDDIT_HELPER_BUDGET_RESET_TZ?.trim() ||
      DEFAULT_BUDGET_RESET_TZ,
  };
}

function resolveBudgetDate(
  at: Date,
  timeZone: string,
) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

async function loadServiceState(path: string): Promise<RedditHelperServiceState> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as RedditHelperServiceState;
  } catch {
    return {};
  }
}

async function saveServiceState(path: string, state: RedditHelperServiceState) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), "utf-8");
}

async function checkBudget(
  config: BudgetConfig,
): Promise<BudgetGuardResult> {
  const budgetDate = resolveBudgetDate(new Date(), config.resetTimeZone);
  const state = await loadSharedBudgetState(budgetDate);

  if ((state.llmCallsToday ?? 0) >= config.maxLlmCallsPerDay) {
    const exhaustedState = {
      ...state,
      budgetStatus: "exhausted" as const,
      lastBudgetExceededAt: new Date().toISOString(),
    };
    await saveSharedBudgetState(exhaustedState);
    return {
      allowed: false,
      state: exhaustedState,
      reason: "daily llm call budget exhausted",
    };
  }

  if ((state.tokensToday ?? 0) >= config.maxTokensPerDay) {
    const exhaustedState = {
      ...state,
      budgetStatus: "exhausted" as const,
      lastBudgetExceededAt: new Date().toISOString(),
    };
    await saveSharedBudgetState(exhaustedState);
    return {
      allowed: false,
      state: exhaustedState,
      reason: "daily token budget exhausted",
    };
  }

  return { allowed: true, state };
}

async function recordBudgetUsage(
  config: BudgetConfig,
  tokenUsage: number,
) {
  const budgetDate = resolveBudgetDate(new Date(), config.resetTimeZone);
  const state = await loadSharedBudgetState(budgetDate);
  state.llmCallsToday = (state.llmCallsToday ?? 0) + 1;
  state.tokensToday = (state.tokensToday ?? 0) + Math.max(0, tokenUsage);
  state.budgetStatus =
    state.llmCallsToday >= config.maxLlmCallsPerDay ||
    state.tokensToday >= config.maxTokensPerDay
      ? "exhausted"
      : "ok";
  if (state.budgetStatus === "exhausted") {
    state.lastBudgetExceededAt = new Date().toISOString();
  }
  await saveSharedBudgetState(state);
  return state;
}

async function primeBudgetStateFromServiceState(
  serviceState: RedditHelperServiceState,
  config: BudgetConfig,
) {
  const budgetDate = resolveBudgetDate(new Date(), config.resetTimeZone);
  if (serviceState.budgetDate !== budgetDate) {
    return;
  }

  if (
    typeof serviceState.llmCallsToday !== "number" &&
    typeof serviceState.tokensToday !== "number"
  ) {
    return;
  }

  const sharedState = await loadSharedBudgetState(budgetDate);
  const seededState: RedditHelperBudgetState = {
    budgetDate,
    llmCallsToday: Math.max(sharedState.llmCallsToday ?? 0, serviceState.llmCallsToday ?? 0),
    tokensToday: Math.max(sharedState.tokensToday ?? 0, serviceState.tokensToday ?? 0),
    budgetStatus:
      serviceState.budgetStatus === "exhausted" || sharedState.budgetStatus === "exhausted"
        ? "exhausted"
        : "ok",
    lastBudgetExceededAt:
      serviceState.lastBudgetExceededAt ?? sharedState.lastBudgetExceededAt,
  };

  await saveSharedBudgetState(seededState);
}

function buildBudgetSnapshot(
  config: BudgetConfig,
  state: RedditHelperBudgetState,
  reason?: string,
) {
  return {
    status:
      state.budgetStatus === "ok" || state.budgetStatus === "exhausted"
        ? state.budgetStatus
        : "unknown",
    reason: reason ?? null,
    llmCallsToday: state.llmCallsToday ?? 0,
    tokensToday: state.tokensToday ?? 0,
    maxLlmCallsPerDay: config.maxLlmCallsPerDay,
    maxTokensPerDay: config.maxTokensPerDay,
    remainingLlmCalls: Math.max(0, config.maxLlmCallsPerDay - (state.llmCallsToday ?? 0)),
    remainingTokens: Math.max(0, config.maxTokensPerDay - (state.tokensToday ?? 0)),
    resetTimeZone: config.resetTimeZone,
    budgetDate: state.budgetDate,
  };
}

function deriveDocTerms(docs: KnowledgePackDoc[]) {
  return Array.from(
    new Set(
      docs
        .flatMap((doc) =>
          `${doc.firstHeading ?? ""} ${doc.summary}`
            .split(/[^a-zA-Z0-9_-]+/)
            .map((term) => term.trim().toLowerCase()),
        )
        .filter((term) => term.length >= 4),
    ),
  );
}

function deriveDoctrineSignals(engagementOS: string) {
  const lower = engagementOS.toLowerCase();
  return {
    expectsQuestions:
      lower.includes("qualifying question") || lower.includes("ask"),
    expectsBrevity:
      lower.includes("5 sentence") ||
      lower.includes("4-5 sentence") ||
      lower.includes("no more than"),
    expectsAuthority:
      lower.includes("authoritative") || lower.includes("calm"),
    forbidsSolutioning:
      lower.includes("do not solve") ||
      lower.includes("don't solve") ||
      lower.includes("do not architect"),
  };
}

function clampScore(value: number) {
  return Math.max(0, Math.min(1, value));
}

function hashSeed(seed: string) {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function pickVariant<T>(values: T[], seed: string): T {
  if (values.length === 0) {
    throw new Error("pickVariant requires at least one value");
  }
  return values[hashSeed(seed) % values.length]!;
}

function buildReplySubject(queue: RedditQueuePayload) {
  const rawQuestion = typeof queue.question === "string" ? queue.question.trim() : "";
  const normalizedQuestion = rawQuestion
    .replace(/^[Ww]hat('?s| is)\s+/u, "")
    .replace(/^[Hh]ow\s+(do|should|can)\s+(I|we)\s+/u, "")
    .replace(/^[Aa]nyone know\s+/u, "")
    .replace(/\?+$/u, "")
    .trim();

  if (normalizedQuestion.length >= 14) {
    return normalizedQuestion;
  }

  const keywordSubject = [
    queue.pillar,
    queue.tag,
    ...(queue.matchedKeywords ?? []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .slice(0, 3)
    .join(" / ");

  return keywordSubject || "the exact blocker";
}

function isLaunchContextRelevant(queue: RedditQueuePayload) {
  const subject = `${queue.question ?? ""} ${queue.entryContent ?? ""}`.toLowerCase();
  return /\b(live|launch|pre-launch|prod|production|traffic|customers|public)\b/.test(subject);
}

function deriveReplySurface(queue: RedditQueuePayload): ReplySurface {
  const subject = `${queue.question ?? ""} ${queue.entryContent ?? ""} ${queue.pillar ?? ""} ${
    queue.tag ?? ""
  } ${(queue.matchedKeywords ?? []).join(" ")}`.toLowerCase();

  if (/\b(cost|pricing|price|budget|billing|token)\b/.test(subject)) {
    return "pricing";
  }
  if (/\b(webhook|api|oauth|auth|token|gateway|telegram|bridge|integration|workflow)\b/.test(subject)) {
    return "integration";
  }
  if (/\b(policy|governance|approval|proof|audit|risk|security)\b/.test(subject)) {
    return "governance";
  }
  if (/\b(reply|reddit|draft|docs|copy|content|audience)\b/.test(subject)) {
    return "content";
  }
  if (/\b(deploy|port|service|systemd|wsl|cloudflared|dns|hosting|runtime|health|disconnect)\b/.test(subject)) {
    return "runtime";
  }
  return "general";
}

function buildReplyContextAnchor(
  queue: RedditQueuePayload,
  docs: KnowledgePackDoc[],
) {
  const anchor = docs[0]?.firstHeading
    ?? docs[0]?.path
    ?? queue.pillar
    ?? queue.matchedKeywords?.[0]
    ?? queue.tag
    ?? "the exact boundary where it breaks";

  return anchor.replace(/\.[a-z0-9]+$/iu, "").trim();
}

function buildReplyObservation(
  surface: ReplySurface,
  subject: string,
  anchor: string,
  queue: RedditQueuePayload,
) {
  const launchAware = isLaunchContextRelevant(queue);
  const templates: Record<ReplySurface, string[]> = {
    runtime: [
      `The part I would pin down first is ${anchor}, because runtime issues like ${subject} usually collapse to one boundary instead of the whole stack.`,
      `This reads more like a runtime boundary problem around ${anchor} than a broad rebuild, so I would scope that first.`,
    ],
    integration: [
      `The first thing I would isolate is ${anchor}, because integration problems around ${subject} usually hide in one handoff.`,
      `This sounds like a handoff issue around ${anchor}, so I would narrow that boundary before guessing at the full workflow.`,
    ],
    pricing: [
      `Pricing questions like ${subject} usually turn on one hard constraint, so I would pin down ${anchor} first.`,
      `The useful first cut here is ${anchor}, because cost decisions drift fast when the real constraint stays fuzzy.`,
    ],
    governance: [
      `I would scope ${anchor} first, because governance pressure around ${subject} usually comes from one unclear decision boundary.`,
      `This feels like a proof or policy boundary around ${anchor}, so that is the piece I would tighten first.`,
    ],
    content: [
      `The useful first cut here is ${anchor}, because replies about ${subject} get weak when the audience and evidence boundary stays blurry.`,
      `I would pin down ${anchor} first, because communication problems around ${subject} usually come from one mixed signal, not the whole message.`,
    ],
    general: [
      `The cleanest first move is to pin down ${anchor}, because issues like ${subject} usually become tractable once the boundary is explicit.`,
      `I would narrow ${anchor} first, because the fastest way to make ${subject} clearer is to stop treating it as one giant problem.`,
    ],
  };

  const selected = pickVariant(templates[surface], `${queue.id}:${surface}:observation`);
  if (launchAware && surface === "runtime") {
    return `${selected} The launch state matters here, but only after the failing boundary is clear.`;
  }
  return selected;
}

function buildReplyGroundingLine(
  queue: RedditQueuePayload,
  docs: KnowledgePackDoc[],
  anchor: string,
) {
  const secondaryAnchor =
    docs[1]?.firstHeading
    ?? docs[1]?.path
    ?? queue.matchedKeywords?.[0]
    ?? queue.pillar;

  if (secondaryAnchor && secondaryAnchor !== anchor) {
    return `The local context points back to ${anchor} and ${secondaryAnchor}, so I would keep the next answer grounded there instead of jumping straight to fixes.`;
  }

  return `The next useful reply should stay anchored in ${anchor} so it qualifies the problem before it starts prescribing anything.`;
}

function buildReplyQuestions(
  surface: ReplySurface,
  queue: RedditQueuePayload,
): string[] {
  const launchAware = isLaunchContextRelevant(queue);
  const questionSets: Record<ReplySurface, string[]> = {
    runtime: [
      "Where do you see it first: local dev, build/deploy, or the live route?",
      launchAware
        ? "What changed right before it broke: config, dependency, DNS, or the traffic path?"
        : "What changed right before it broke: config, dependency, DNS, or process supervision?",
    ],
    integration: [
      "Which boundary is actually failing: auth, webhook, queue, or payload shape?",
      "What do you control directly right now: the caller, the receiver, or the bridge in between?",
    ],
    pricing: [
      "Is the real constraint spend, latency, or output quality?",
      "What rough usage volume are you planning around right now?",
    ],
    governance: [
      "Is the blocker policy, proof, or approval ownership?",
      "What decision needs to move next: allow, refuse, or route for review?",
    ],
    content: [
      "Who is the reply for: operator, public user, or prospective client?",
      "What do you need the reply to do next: clarify, reassure, or route the conversation?",
    ],
    general: [
      "Where does the friction actually show up first in your setup?",
      "What changed right before this started hurting?",
    ],
  };

  const selected = questionSets[surface] ?? questionSets.general;
  return selected.slice(0, 2);
}

export function scoreReplyQualityDeterministically(
  replyText: string,
  queue: RedditQueuePayload,
  docs: KnowledgePackDoc[],
  engagementOS: string,
): { score: number; reasoning: string } {
  const trimmed = replyText.trim();
  if (!trimmed) {
    return { score: 0.1, reasoning: "empty reply" };
  }

  const sentences = trimmed
    .split(SENTENCE_SPLIT_REGEX)
    .map((part) => part.trim())
    .filter(Boolean);
  const sentenceCount = sentences.length;
  const questionCount = (trimmed.match(/\?/g) ?? []).length;
  const doctrine = deriveDoctrineSignals(engagementOS);
  const queueTerms = buildQueueTerms(queue);
  const docTerms = deriveDocTerms(docs);
  const allContextTerms = new Set([...queueTerms, ...docTerms]);
  const matchedContextTerms = [...allContextTerms].filter((term) =>
    trimmed.toLowerCase().includes(term),
  );

  let score = 0.5;
  const reasons: string[] = [];

  if (sentenceCount >= 3 && sentenceCount <= 5) {
    score += 0.2;
    reasons.push("good structure");
  } else {
    score -= 0.12;
    reasons.push("structure drift");
  }

  if (questionCount >= 1) {
    score += 0.18;
    reasons.push("asks qualifying question");
  } else if (doctrine.expectsQuestions) {
    score -= 0.2;
    reasons.push("missing qualifying question");
  }

  if (CTA_REGEX.test(trimmed)) {
    score += 0.12;
    reasons.push("clear CTA");
  } else {
    score -= 0.08;
    reasons.push("weak CTA");
  }

  if (matchedContextTerms.length > 0) {
    score += Math.min(0.15, matchedContextTerms.length * 0.03);
    reasons.push("uses local context");
  } else {
    score -= 0.08;
    reasons.push("thin local context");
  }

  const genericReplyHits = GENERIC_REPLY_REGEXES.filter((pattern) =>
    pattern.test(trimmed),
  ).length;
  if (genericReplyHits > 0) {
    score -= 0.08 + genericReplyHits * 0.02;
    reasons.push("generic draft language");
  }

  const launchContextRelevant = isLaunchContextRelevant(queue);
  if (!launchContextRelevant && /\blive or pre-launch\b/i.test(trimmed)) {
    score -= 0.1;
    reasons.push("generic launch question");
  }

  if (
    /\b(where do you see it first|what changed right before|which boundary is actually failing|who is the reply for|what do you control directly)\b/i.test(
      trimmed,
    )
  ) {
    score += 0.08;
    reasons.push("questions are scoped");
  }

  const solutioningHits = BANNED_SOLUTIONING_REGEXES.filter((pattern) =>
    pattern.test(trimmed),
  ).length;
  if (solutioningHits > 0 || (doctrine.forbidsSolutioning && sentenceCount > 5)) {
    score -= 0.18 + solutioningHits * 0.04;
    reasons.push("premature solutioning");
  }

  if (
    doctrine.expectsAuthority &&
    /\b(glad to help|super excited|absolutely!|definitely!)\b/i.test(trimmed)
  ) {
    score -= 0.08;
    reasons.push("tone too eager");
  }

  if (doctrine.expectsBrevity && sentenceCount > 5) {
    score -= 0.1;
    reasons.push("too long");
  }

  return {
    score: clampScore(score),
    reasoning: reasons.join("; "),
  };
}

export function buildDeterministicDraft(
  queue: RedditQueuePayload,
  docs: KnowledgePackDoc[],
): string {
  const surface = deriveReplySurface(queue);
  const subject = buildReplySubject(queue);
  const anchor = buildReplyContextAnchor(queue, docs);
  const questions = buildReplyQuestions(surface, queue);

  const lines = [
    buildReplyObservation(surface, subject, anchor, queue),
    buildReplyGroundingLine(queue, docs, anchor),
    `${questions[0]} ${questions[1]}`,
    "If you share those two details, I can narrow the cleanest next step without guessing.",
  ];

  return lines.join(" ");
}

function buildLLMPrompt(
  queue: RedditQueuePayload,
  docs: KnowledgePackDoc[],
  engagementOS: string,
  deterministicDraft: string,
): { system: string; user: string } {
  const sourceCounts = docs.reduce(
    (counts, doc) => {
      counts[doc.source] += 1;
      return counts;
    },
    { openclaw: 0, openai: 0 },
  );
  const contextBlock = docs.length > 0
    ? `\n\nContext from your work (${sourceCounts.openclaw} OpenClaw docs, ${sourceCounts.openai} OpenAI Cookbook docs):\n${docs
        .map((d) => {
          const source = d.source === "openclaw" ? "[OpenClaw Automation]" : "[OpenAI Cookbook]";
          return `${source} ${d.firstHeading || d.path}: ${d.summary}`;
        })
        .join("\n")}`
    : "";

  const userMessage = `Reddit Post:
Subreddit: r/${queue.subreddit}
Title: ${queue.question || "(no title)"}
Link: ${queue.link || "(no direct link)"}
Keywords matched: ${queue.matchedKeywords?.join(", ") || "none"}
Author level: ${queue.tag || "unknown"}
${queue.entryContent ? `\nPost content:\n${queue.entryContent.substring(0, 500)}...` : ""}
${contextBlock}

Candidate draft built from local doctrine and docs:
${deterministicDraft}

Polish that draft following the doctrine. Remember:
- No more than 5 sentences
- Ask 1-2 qualifying questions
- Do not solve or architect yet
- Show your authority, not your solutions
- Preserve any specific local-context references that are already useful
- Do not default to a generic opener like "Good question"
- Only ask about launch state if the post actually sounds launch-sensitive`;

  return {
    system: `You are a senior engineer drafting Reddit replies to potential clients. Follow this doctrine:\n\n${engagementOS}\n\nGenerate YOUR response to the post above.`,
    user: userMessage,
  };
}

function isProviderBackoffError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: number }).status;
  return status === 429 || (status !== undefined && status >= 500);
}

function buildProviderPosture(args: {
  usedLlm: boolean;
  reasoning: string;
  explanationBoundary: AgentResult["explanationBoundary"];
  serviceState?: RedditHelperServiceState;
}) {
  let mode: NonNullable<AgentResult["providerPosture"]>["mode"] = args.usedLlm
    ? "hybrid-polished"
    : "local-only";
  let llmEligible = true;
  let queuePressureStatus: NonNullable<AgentResult["providerPosture"]>["queuePressureStatus"] = "nominal";

  if (!args.usedLlm && /budget exhausted/i.test(args.reasoning)) {
    mode = "budget-exhausted-fallback";
    llmEligible = false;
    queuePressureStatus = "budget-exhausted";
  } else if (!args.usedLlm && /provider unavailable|rate limited/i.test(args.reasoning)) {
    mode = "provider-backoff-fallback";
    queuePressureStatus = "provider-backoff";
  } else if (!args.usedLlm && /LLM failed/i.test(args.reasoning)) {
    mode = "provider-error-fallback";
    queuePressureStatus = args.serviceState?.backoffUntil ? "provider-backoff" : "nominal";
  }

  return {
    mode,
    reason: args.reasoning,
    llmEligible,
    reviewRecommended:
      args.explanationBoundary?.status === "internal-only-review" ||
      mode === "provider-backoff-fallback" ||
      mode === "provider-error-fallback",
    fallbackIntegrity: args.usedLlm ? "retained-local-doctrine" : "retained-local-doctrine",
    queuePressureStatus,
    backoffUntil: args.serviceState?.backoffUntil ?? null,
    consecutiveFailures: args.serviceState?.consecutiveFailures ?? 0,
  };
}

async function draftReplyWithLLM(
  queue: RedditQueuePayload,
  docs: KnowledgePackDoc[],
  engagementOS: string,
  config: AgentConfig,
  deterministicDraft: string,
): Promise<{
  replyText: string;
  usedLlm: boolean;
  reasoning: string;
  accounting: NonNullable<AgentResult["accounting"]>;
}> {
  const budgetConfig = getBudgetConfig();
  let budgetState = await loadSharedBudgetState(
    resolveBudgetDate(new Date(), budgetConfig.resetTimeZone),
  );
  try {
    const budgetGuard = await checkBudget(budgetConfig);
    budgetState = budgetGuard.state;
    if (!budgetGuard.allowed) {
      await telemetry.warn("llm.budget_exhausted", {
        reason: budgetGuard.reason,
        llmCallsToday: budgetGuard.state.llmCallsToday ?? 0,
        tokensToday: budgetGuard.state.tokensToday ?? 0,
      });
      return {
        replyText: deterministicDraft,
        usedLlm: false,
        reasoning: budgetGuard.reason ?? "budget exhausted",
        accounting: {
          provider: "openai",
          model: config.openaiModel ?? null,
          metered: false,
          pricingSource: "not-applicable",
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
          },
          budget: buildBudgetSnapshot(
            budgetConfig,
            budgetGuard.state,
            budgetGuard.reason ?? "budget exhausted",
          ),
          note: "LLM polish skipped because the daily helper budget is exhausted.",
        },
      };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not set in environment");
    }

    const OpenAI = await getOpenAIConstructor();
    const client = new OpenAI({ apiKey });
    const { system, user } = buildLLMPrompt(
      queue,
      docs,
      engagementOS,
      deterministicDraft,
    );

    const response = await client.chat.completions.create({
      model: config.openaiModel || "gpt-4",
      max_tokens: config.openaiMaxTokens || 300,
      temperature: config.openaiTemperature ?? 0.7,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const replyText =
      response.choices[0]?.message?.content?.trim() || deterministicDraft;
    budgetState = await recordBudgetUsage(
      budgetConfig,
      response.usage?.total_tokens || 0,
    );

    await telemetry.info("llm.draft_success", {
      queueId: queue.id,
      subreddit: queue.subreddit,
      tokenUsage: response.usage?.total_tokens || 0,
    });

    return {
      replyText,
      usedLlm: true,
      reasoning: "draft polished with local-context-guided LLM pass",
      accounting: {
        provider: "openai",
        model: config.openaiModel ?? null,
        metered: true,
        pricingSource: "catalog",
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? null,
          completionTokens: response.usage?.completion_tokens ?? null,
          totalTokens: response.usage?.total_tokens ?? null,
        },
        budget: buildBudgetSnapshot(budgetConfig, budgetState),
        note: "Optional final polish used the configured OpenAI model.",
      },
    };
  } catch (error) {
    await telemetry.error("llm.draft_failed", {
      queueId: queue.id,
      message: (error as Error).message,
      retryable: isProviderBackoffError(error),
    });
    return {
      replyText: deterministicDraft,
      usedLlm: false,
      reasoning: isProviderBackoffError(error)
        ? "provider unavailable or rate limited; using deterministic draft"
        : "LLM failed, using deterministic draft",
      accounting: {
        provider: "openai",
        model: config.openaiModel ?? null,
        metered: false,
        pricingSource: "not-applicable",
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        budget: buildBudgetSnapshot(
          budgetConfig,
          budgetState,
          isProviderBackoffError(error)
            ? "provider unavailable or rate limited"
            : "provider call failed",
        ),
        note: "LLM polish was skipped after a provider-side failure.",
      },
    };
  }
}

async function runTask(task: TaskPayload, config: AgentConfig): Promise<AgentResult> {
  const queue = task.queue;
  const draft = task.rssDraft;
  const providerState = await loadServiceState(config.serviceStatePath);
  const budgetConfig = getBudgetConfig();
  await primeBudgetStateFromServiceState(providerState, budgetConfig);

  // Skip if not manually selected
  if (!queue.selectedForDraft) {
    await telemetry.info("task.skipped", { queueId: queue.id, reason: "not_selected_for_draft" });
    const skippedReplyVerification = {
      doctrineApplied: [] as string[],
      anchorCount: 0,
      requiresReview: false,
      reasoning: "queue item not selected for drafting",
    };
    const skippedProviderPosture = {
      mode: "local-only" as const,
      reason: "queue item not selected for drafting",
      llmEligible: false,
      reviewRecommended: false,
      fallbackIntegrity: "retained-local-doctrine" as const,
      queuePressureStatus: "nominal" as const,
      backoffUntil: null,
      consecutiveFailures: providerState.consecutiveFailures ?? 0,
    };
    const skippedBoundary = {
      status: "public-safe" as const,
      reasons: [] as string[],
    };
    const skippedRouting = {
      handoffs: [] as Array<{
        targetAgentId: string;
        surface: 'docs' | 'proof' | 'faq';
        reason: string;
      }>,
      systematic: false,
    };
    return {
      replyText: "",
      confidence: 0,
      devvitPayloadPath: undefined,
      replyVerification: skippedReplyVerification,
      explanationBoundary: skippedBoundary,
      providerPosture: skippedProviderPosture,
      communitySignalRouting: skippedRouting,
      ...buildRedditSpecialistFields({
        queue,
        confidence: 0,
        draftMode: "local-only",
        replyVerification: skippedReplyVerification,
        providerPosture: skippedProviderPosture,
        explanationBoundary: skippedBoundary,
        communitySignalRouting: skippedRouting,
        statusOverride: "watching",
        operatorSummary:
          `Queue item ${queue.id} was left untouched because it was not selected for drafting.`,
        recommendedNextActions: [
          "Select the queue item explicitly before asking reddit-helper to draft it.",
          "Keep queue triage bounded so only intended community threads enter the draft lane.",
        ],
      }),
    };
  }

  let pack = task.knowledgePack;
  let packPath = task.knowledgePackPath;
  if (!pack) {
    const latest = await loadKnowledgePackFromDir(config.knowledgePackDir);
    pack = latest?.pack;
    packPath = latest?.path;
  }
  const knowledgeFreshness = await inspectKnowledgeFreshness({
    pack,
    packPath,
    docsPath: config.docsPath,
  });

  // Load ENGAGEMENT_OS and knowledge context
  const engagementOS = await loadRuntimeEngagementOS(config.runtimeEngagementOsPath);
  const docSnippets = pack ? pickDocSnippets(pack, queue) : [];
  const deterministicDraft = buildDeterministicDraft(queue, docSnippets);
  const confusionCluster = buildConfusionCluster(queue, docSnippets);
  const faqCandidate = buildFaqCandidate({ cluster: confusionCluster, queue, docs: docSnippets });
  const toolInvocations: NonNullable<AgentResult["toolInvocations"]> = [];

  if (packPath && canUseSkill(config, "documentParser")) {
    try {
      const executeSkill = await getExecuteSkill();
      const packInspection = await executeSkill(
        "documentParser",
        {
          filePath: packPath,
          format: "json",
        },
        "reddit-helper",
      );

      if (packInspection.success === true) {
        const packDocCount =
          Array.isArray((packInspection.data as { value?: { docs?: unknown[] } } | undefined)?.value?.docs)
            ? ((packInspection.data as { value?: { docs?: unknown[] } }).value?.docs?.length ?? 0)
            : docSnippets.length;
        toolInvocations.push({
          toolId: "documentParser",
          detail: "Parsed the latest knowledge pack before drafting the reply.",
          evidence: [
            `pack:${packPath}`,
            `docs:${packDocCount}`,
            `selected-snippets:${docSnippets.length}`,
          ],
          classification: "knowledge-grounding",
        });
      }
    } catch (error) {
      await telemetry.warn("knowledge-pack.inspect_failed", {
        queueId: queue.id,
        message: (error as Error).message,
      });
    }
  }

  // Draft reply with local-context-first hybrid policy.
  const {
    replyText,
    usedLlm,
    reasoning: draftReasoning,
    accounting,
  } = await draftReplyWithLLM(
    queue,
    docSnippets,
    engagementOS,
    config,
    deterministicDraft,
  );
  const { score: qualityScore, reasoning: qualityReasoning } =
    scoreReplyQualityDeterministically(replyText, queue, docSnippets, engagementOS);

  // Get RSS score from queue (initial relevance score from RSS_SWEEP)
  const rssScore = queue.score ?? 0.65;

  const weights = { rss: 0.4, llm: 0.6 };
  const finalConfidence = rssScore * weights.rss + qualityScore * weights.llm;

  const confidenceBreakdown: ConfidenceBreakdown = {
    rssScore,
    llmScore: qualityScore,
    weights,
    final: finalConfidence,
  };
  const explanationBoundary = buildExplanationBoundary(replyText);
  const replyVerification = buildReplyVerification({
    replyText,
    queue,
    docs: docSnippets,
    engagementOS,
    explanationBoundary,
  });
  const providerPosture = buildProviderPosture({
    usedLlm,
    reasoning: draftReasoning,
    explanationBoundary,
    serviceState: providerState,
  });
  const communitySignalRouting = buildCommunitySignalRouting({
    cluster: confusionCluster,
    faqCandidate,
    replyVerification,
    providerPosture,
  });
  const relationships: NonNullable<AgentResult["relationships"]> =
    communitySignalRouting.handoffs.map((handoff) => ({
      from: "agent:reddit-helper",
      to: `agent:${handoff.targetAgentId}`,
      relationship: "feeds-agent",
      detail: handoff.reason,
      evidence: [
        `surface:${handoff.surface}`,
        `systematic:${communitySignalRouting.systematic}`,
        `cluster:${confusionCluster.clusterId}`,
      ],
      classification: "community-signal-routing",
    }));
  const proofTransitions: NonNullable<AgentResult["proofTransitions"]> = [
    {
      transport:
        replyVerification.requiresReview || providerPosture.reviewRecommended
          ? "demandSummary"
          : "milestone",
      detail:
        replyVerification.requiresReview || providerPosture.reviewRecommended
          ? "Reply draft requires bounded review before broader public use."
          : "Reply draft stayed within the public-safe boundary and can move through the standard milestone proof path.",
      evidence: [
        `requires-review:${replyVerification.requiresReview}`,
        `review-recommended:${providerPosture.reviewRecommended}`,
        `boundary:${explanationBoundary.status}`,
      ],
      classification: "reply-proof-transport",
    },
  ];
  const budgetState = await loadSharedBudgetState(
    resolveBudgetDate(new Date(), budgetConfig.resetTimeZone),
  );
  const now = new Date().toISOString();

  await saveServiceState(config.serviceStatePath, {
    ...providerState,
    lastProcessedAt: now,
    consecutiveFailures:
      usedLlm || /budget exhausted/i.test(draftReasoning)
        ? 0
        : (providerState.consecutiveFailures ?? 0) + 1,
    backoffUntil:
      !usedLlm && /provider unavailable|rate limited/i.test(draftReasoning)
        ? providerState.backoffUntil ?? new Date(Date.now() + 5 * 60 * 1000).toISOString()
        : null,
    budgetDate: budgetState.budgetDate,
    llmCallsToday: budgetState.llmCallsToday,
    tokensToday: budgetState.tokensToday,
    budgetStatus: budgetState.budgetStatus,
    lastBudgetExceededAt: budgetState.lastBudgetExceededAt,
  });

  const draftRecord = {
    stage: usedLlm ? "agent-hybrid-polished" : "agent-local-fallback",
    queueId: queue.id,
    subreddit: queue.subreddit,
    replyText,
    confidence: finalConfidence,
    rssScore,
    qualityScore,
    llmUsed: usedLlm,
    confidenceBreakdown,
    reasoning: `${draftReasoning}; ${qualityReasoning}`,
    confusionCluster,
    faqCandidate,
    replyVerification,
    explanationBoundary,
    providerPosture,
    communitySignalRouting,
    knowledgeFreshness,
    accounting,
    pillar: queue.pillar,
    link: queue.link,
    createdAt: now,
  };
  await appendJsonl(config.draftLogPath, draftRecord);

  let devvitPayloadPath: string | undefined;
  if (config.devvitQueuePath) {
    const payload = {
      type: "comment",
      queueId: queue.id,
      subreddit: queue.subreddit,
      link: queue.link,
      body: replyText,
      confidence: finalConfidence,
      createdAt: new Date().toISOString(),
      tag: queue.tag,
    };
    await appendJsonl(config.devvitQueuePath, payload);
    devvitPayloadPath = config.devvitQueuePath;
  }
  const specialistFields = buildRedditSpecialistFields({
    queue,
    draftMode: usedLlm ? "hybrid-polished" : "local-only",
    confidence: finalConfidence,
    replyVerification,
    providerPosture,
    explanationBoundary,
    communitySignalRouting,
    knowledgeFreshness,
    recommendedNextActions: [
      ...knowledgeFreshness.warnings,
      replyVerification.requiresReview || providerPosture.reviewRecommended
        ? "Review the reply before public use and keep the proof path bounded."
        : "Reply is ready for the standard milestone proof path.",
      communitySignalRouting.handoffs[0]?.reason ?? null,
      faqCandidate
        ? `Consider routing the FAQ candidate to ${faqCandidate.targetAgentId} for a durable follow-up asset.`
        : null,
    ],
  });

  return {
    replyText,
    confidence: finalConfidence,
    rssScore,
    qualityScore,
    confidenceBreakdown,
    ctaVariant: queue.ctaVariant ?? draft?.ctaVariant,
    devvitPayloadPath,
    packId: pack?.id,
    packPath,
    reasoning: `${draftReasoning}; ${qualityReasoning}`,
    draftMode: usedLlm ? "hybrid-polished" : "local-only",
    confusionCluster,
    faqCandidate,
    replyVerification,
    explanationBoundary,
    providerPosture,
    communitySignalRouting,
    knowledgeFreshness,
    accounting,
    toolInvocations,
    relationships,
    proofTransitions,
    ...specialistFields,
  };
}

async function main() {
  if (
    process.env.ALLOW_ORCHESTRATOR_TASK_RUN !== "true" &&
    process.env.ALLOW_DIRECT_TASK_RUN !== "true"
  ) {
    throw new Error(
      "Direct task execution is disabled. Use the orchestrator spawn path or set ALLOW_DIRECT_TASK_RUN=true for a reviewed manual run."
    );
  }

  const payloadPath = process.argv[2];
  if (!payloadPath) {
    throw new Error("Usage: tsx src/index.ts <payload.json>");
  }

  const config = await loadConfig();
  const raw = await readFile(payloadPath, "utf-8");
  const payload = JSON.parse(raw) as TaskPayload;
  try {
    await telemetry.info("task.received", {
      queueId: payload.queue?.id,
      subreddit: payload.queue?.subreddit,
    });
    const result = await runTask(payload, config);
    await telemetry.info("task.success", {
      queueId: payload.queue?.id,
      subreddit: payload.queue?.subreddit,
    });

    if (process.env.REDDIT_HELPER_RESULT_FILE) {
      await ensureDir(process.env.REDDIT_HELPER_RESULT_FILE);
      await writeFile(
        process.env.REDDIT_HELPER_RESULT_FILE,
        JSON.stringify(result, null, 2),
        "utf-8",
      );
    }
  } finally {
    await closeRedditCoordinationStore();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch(async (error) => {
    await telemetry.error("task.failed", { message: (error as Error).message });
    process.exit(1);
  });
}

export {
  buildProviderPosture,
};
