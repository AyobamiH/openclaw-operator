import { readFile, writeFile, appendFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Telemetry } from "../../shared/telemetry.js";
import {
  loadRuntimeStateTarget,
  resolveOperatorStatePath,
  resolveRuntimeStateTarget,
  saveRuntimeStateTarget,
} from "../../shared/runtime-evidence.js";
import {
  loadProcessedDraftIds,
  rememberProcessedDraftId,
} from "./coordination.ts";
import { buildDeterministicDraft } from "./index.ts";

interface AgentConfig {
  knowledgePackDir: string;
  draftLogPath: string;
  devvitQueuePath?: string;
  orchestratorStatePath: string;
  serviceStatePath: string;
}

interface RssDraftRecord {
  draftId: string;
  pillar: string;
  feedId: string;
  subreddit: string;
  title: string;
  content: string;
  link: string;
  author?: string;
  matchedKeywords: string[];
  scoreBreakdown: Record<string, number>;
  totalScore: number;
  suggestedReply: string;
  ctaVariant: string;
  tag: "draft" | "priority" | "manual-review";
  queuedAt: string;
}

interface RedditReplyRecord {
  queueId: string;
  subreddit: string;
  question: string;
  draftedResponse: string;
  responder: string;
  confidence: number;
  status: "drafted" | "posted" | "error";
  respondedAt: string;
  postedAt?: string;
  link?: string;
  notes?: string;
  rssDraftId?: string;
  devvitPayloadPath?: string;
  packId?: string;
  packPath?: string;
}

interface OrchestratorState {
  rssDrafts?: RssDraftRecord[];
  redditResponses?: RedditReplyRecord[];
  lastRedditResponseAt?: string | null;
}

interface KnowledgePackDoc {
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

interface ServiceState {
  lastProcessedAt?: string;
  lastSeenCursor?: string;
  consecutiveFailures?: number;
  backoffUntil?: string | null;
}

interface ServiceLoopConfig {
  maxJobsPerCycle: number;
  minSleepMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  jitter: boolean;
}

const telemetry = new Telemetry({ component: "reddit-helper-service" });
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_MAX_JOBS_PER_CYCLE = 3;
const DEFAULT_MIN_SLEEP_MS = 1_500;
const DEFAULT_BACKOFF_BASE_MS = 5_000;
const DEFAULT_BACKOFF_MAX_MS = 600_000;
const DEFAULT_POLL_INTERVAL_MS = 60_000;

function assertServiceBoundary() {
  if (process.env.ALLOW_DIRECT_SERVICE !== "true") {
    throw new Error("Direct service execution blocked. Set ALLOW_DIRECT_SERVICE=true for system-managed runs.");
  }
}

async function loadConfig(): Promise<AgentConfig> {
  const configPath = resolve(__dirname, "../agent.config.json");
  const raw = await readFile(configPath, "utf-8");
  const parsed = JSON.parse(raw) as AgentConfig;
  return {
    knowledgePackDir: resolveOperatorStatePath(
      configPath,
      parsed.knowledgePackDir,
      "logs/knowledge-packs",
    ),
    draftLogPath: resolveOperatorStatePath(
      configPath,
      parsed.draftLogPath,
      "logs/reddit-drafts.jsonl",
    ),
    devvitQueuePath: parsed.devvitQueuePath
      ? resolveOperatorStatePath(
          configPath,
          parsed.devvitQueuePath,
          "logs/devvit-submissions.jsonl",
        )
      : undefined,
    orchestratorStatePath: resolveRuntimeStateTarget(configPath, parsed.orchestratorStatePath)!,
    serviceStatePath: resolveOperatorStatePath(
      configPath,
      parsed.serviceStatePath,
      "logs/reddit-helper-service.json",
    ),
  };
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
  } catch {
    return null;
  }
}

function pickDocSnippet(pack?: KnowledgePack, draft?: RssDraftRecord) {
  if (!pack?.docs?.length) return null;
  const keyword = draft?.matchedKeywords?.[0]?.toLowerCase();
  if (!keyword) return pack.docs[0];
  return pack.docs.find((doc) => doc.summary.toLowerCase().includes(keyword)) ?? pack.docs[0];
}

function buildReply(draft: RssDraftRecord, doc?: KnowledgePackDoc | null) {
  return buildDeterministicDraft(
    {
      id: draft.draftId,
      subreddit: draft.subreddit,
      question: draft.title,
      link: draft.link,
      tag: draft.tag,
      pillar: draft.pillar,
      entryContent: draft.content,
      author: draft.author,
      ctaVariant: draft.ctaVariant,
      matchedKeywords: draft.matchedKeywords,
      score: draft.totalScore,
      selectedForDraft: true,
    },
    doc ? [doc] : [],
  );
}

function deriveConfidence(tag?: string) {
  if (tag === "priority") return 0.92;
  if (tag === "manual-review") return 0.6;
  return 0.78;
}

async function loadState(path: string): Promise<OrchestratorState> {
  return loadRuntimeStateTarget<OrchestratorState>(path, {});
}

async function saveState(path: string, state: OrchestratorState) {
  await saveRuntimeStateTarget(path, state);
}

async function loadServiceState(path: string): Promise<ServiceState> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as ServiceState;
  } catch {
    return {};
  }
}

async function saveServiceState(path: string, state: ServiceState) {
  await ensureDir(path);
  await writeFile(path, JSON.stringify(state, null, 2), "utf-8");
}

function parsePositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function loadServiceLoopConfig(): ServiceLoopConfig {
  return {
    maxJobsPerCycle: parsePositiveIntEnv(
      "REDDIT_HELPER_MAX_JOBS_PER_CYCLE",
      DEFAULT_MAX_JOBS_PER_CYCLE,
    ),
    minSleepMs: parsePositiveIntEnv(
      "REDDIT_HELPER_MIN_SLEEP_MS",
      DEFAULT_MIN_SLEEP_MS,
    ),
    backoffBaseMs: parsePositiveIntEnv(
      "REDDIT_HELPER_BACKOFF_BASE_MS",
      DEFAULT_BACKOFF_BASE_MS,
    ),
    backoffMaxMs: parsePositiveIntEnv(
      "REDDIT_HELPER_BACKOFF_MAX_MS",
      DEFAULT_BACKOFF_MAX_MS,
    ),
    jitter:
      (process.env.REDDIT_HELPER_JITTER ?? "true").toLowerCase() !== "false",
  };
}

function normalizeServiceState(state: ServiceState): ServiceState {
  return {
    ...state,
    consecutiveFailures: state.consecutiveFailures ?? 0,
    backoffUntil: state.backoffUntil ?? null,
  };
}

export function selectEligibleDrafts(
  drafts: RssDraftRecord[],
  coordinationState: { processedIds?: string[] },
  maxJobsPerCycle: number,
) {
  const processedIds = new Set(coordinationState.processedIds ?? []);
  return drafts
    .filter((draft) => !processedIds.has(draft.draftId))
    .sort((left, right) => {
      return new Date(left.queuedAt).getTime() - new Date(right.queuedAt).getTime();
    })
    .slice(0, maxJobsPerCycle);
}

function computeBackoffDelay(
  consecutiveFailures: number,
  config: ServiceLoopConfig,
) {
  const exponent = Math.max(0, consecutiveFailures - 1);
  const delay = Math.min(
    config.backoffMaxMs,
    config.backoffBaseMs * 2 ** exponent,
  );
  if (!config.jitter) return delay;
  return Math.round(delay * (0.85 + Math.random() * 0.3));
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOnce(config: AgentConfig) {
  const state = await loadState(config.orchestratorStatePath);
  const loopConfig = loadServiceLoopConfig();
  const serviceState = normalizeServiceState(
    await loadServiceState(config.serviceStatePath),
  );
  const processedIds = await loadProcessedDraftIds();
  const backoffUntilMs = serviceState.backoffUntil
    ? Date.parse(serviceState.backoffUntil)
    : NaN;
  if (Number.isFinite(backoffUntilMs) && backoffUntilMs > Date.now()) {
    return;
  }

  const drafts = selectEligibleDrafts(
    state.rssDrafts ?? [],
    { processedIds },
    loopConfig.maxJobsPerCycle,
  );
  if (!drafts.length) {
    serviceState.consecutiveFailures = 0;
    serviceState.backoffUntil = null;
    await saveServiceState(config.serviceStatePath, serviceState);
    return;
  }

  const latestPack = await loadKnowledgePackFromDir(config.knowledgePackDir);

  for (const [index, draft] of drafts.entries()) {
    const docSnippet = pickDocSnippet(latestPack?.pack, draft);
    const replyText = buildReply(draft, docSnippet);
    const confidence = deriveConfidence(draft.tag);
    const processedAt = new Date().toISOString();

    const record: RedditReplyRecord = {
      queueId: draft.draftId,
      subreddit: draft.subreddit,
      question: draft.title,
      draftedResponse: replyText,
      responder: "reddit-helper-service",
      confidence,
      status: "drafted",
      respondedAt: processedAt,
      link: draft.link,
      notes: `rssDraft:${draft.draftId}`,
      rssDraftId: draft.draftId,
      devvitPayloadPath: config.devvitQueuePath,
      packId: latestPack?.pack.id,
      packPath: latestPack?.path,
    };

    state.redditResponses = [...(state.redditResponses ?? []), record];
    state.lastRedditResponseAt = new Date().toISOString();
    await appendJsonl(config.draftLogPath, {
      stage: "service",
      queueId: draft.draftId,
      subreddit: draft.subreddit,
        replyText,
        cta: null,
        pillar: draft.pillar,
        link: draft.link,
        createdAt: processedAt,
      });

    if (config.devvitQueuePath) {
      await appendJsonl(config.devvitQueuePath, {
        type: "comment",
        queueId: draft.draftId,
        subreddit: draft.subreddit,
        link: draft.link,
        body: replyText,
        createdAt: processedAt,
        tag: draft.tag,
      });
    }

    await rememberProcessedDraftId(draft.draftId);
    serviceState.lastProcessedAt = processedAt;
    serviceState.lastSeenCursor = draft.draftId;

    await telemetry.info("draft.generated", { queueId: draft.draftId, subreddit: draft.subreddit });

    if (index < drafts.length - 1) {
      await sleep(loopConfig.minSleepMs);
    }
  }

  await saveState(config.orchestratorStatePath, state);
  serviceState.consecutiveFailures = 0;
  serviceState.backoffUntil = null;
  await saveServiceState(config.serviceStatePath, serviceState);
}

async function loop() {
  assertServiceBoundary();
  const config = await loadConfig();
  const loopConfig = loadServiceLoopConfig();
  while (true) {
    try {
      await runOnce(config);
      await sleep(DEFAULT_POLL_INTERVAL_MS);
    } catch (error) {
      await telemetry.error("service.error", { message: (error as Error).message });
      const serviceState = normalizeServiceState(
        await loadServiceState(config.serviceStatePath),
      );
      serviceState.consecutiveFailures = (serviceState.consecutiveFailures ?? 0) + 1;
      const delayMs = computeBackoffDelay(
        serviceState.consecutiveFailures,
        loopConfig,
      );
      serviceState.backoffUntil = new Date(Date.now() + delayMs).toISOString();
      await saveServiceState(config.serviceStatePath, serviceState);
      await sleep(delayMs);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  loop().catch(async (error) => {
    await telemetry.error("service.fatal", { message: (error as Error).message });
    process.exit(1);
  });
}
