#!/usr/bin/env node
import { getExecuteSkill, resolveTaskExecuteSkill } from "../../shared/governed-readers.js";

/**
 * Market Research Agent - Entry Point
 * 
 * Fetches and analyzes market information from allowlisted web sources.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { buildSpecialistOperatorFields } from '../../shared/runtime-evidence.js';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '../agent.config.json');

interface AgentConfig {
  id: string;
  name: string;
  permissions: any;
}

interface PlannedResearchSource {
  url: string;
  rationale: string;
  surface: string;
}

const AUTO_SOURCE_LIBRARY: Array<PlannedResearchSource & { keywords: string[] }> = [
  {
    url: 'https://openai.com/api/pricing/',
    rationale: 'OpenAI pricing reference',
    surface: 'pricing',
    keywords: ['pricing', 'price', 'cost', 'billing', 'openai', 'gpt'],
  },
  {
    url: 'https://www.anthropic.com/pricing',
    rationale: 'Anthropic pricing reference',
    surface: 'pricing',
    keywords: ['pricing', 'price', 'cost', 'billing', 'anthropic', 'claude'],
  },
  {
    url: 'https://openai.com/api/',
    rationale: 'OpenAI API overview',
    surface: 'api',
    keywords: ['api', 'sdk', 'endpoint', 'model', 'openai', 'gpt'],
  },
  {
    url: 'https://docs.anthropic.com/',
    rationale: 'Anthropic API and platform docs',
    surface: 'api',
    keywords: ['api', 'sdk', 'endpoint', 'model', 'anthropic', 'claude'],
  },
  {
    url: 'https://openai.com/policies/usage-policies/',
    rationale: 'OpenAI usage policy reference',
    surface: 'policy',
    keywords: ['policy', 'terms', 'trust', 'compliance', 'safety', 'openai'],
  },
  {
    url: 'https://www.anthropic.com/legal/aup',
    rationale: 'Anthropic acceptable use and trust reference',
    surface: 'policy',
    keywords: ['policy', 'terms', 'trust', 'compliance', 'safety', 'anthropic'],
  },
  {
    url: 'https://api.github.com',
    rationale: 'GitHub API surface reference',
    surface: 'api',
    keywords: ['github', 'api', 'integration', 'developer'],
  },
  {
    url: 'https://huggingface.co',
    rationale: 'Hugging Face model ecosystem reference',
    surface: 'vendor',
    keywords: ['vendor', 'market', 'model', 'provider', 'huggingface'],
  },
];

let agentConfig: AgentConfig;

async function loadConfig(): Promise<void> {
  try {
    const configContent = await fs.readFile(configPath, 'utf-8');
    agentConfig = JSON.parse(configContent);
    console.log(`[market-research] Configuration loaded`);
  } catch (error: any) {
    console.error('Failed to load agent config:', error.message);
    process.exit(1);
  }
}

function canUseSkill(skillId: string): boolean {
  const skillPerms = agentConfig.permissions.skills[skillId];
  return skillPerms && skillPerms.allowed === true;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

function getAllowedDomains(): string[] {
  const domains = agentConfig?.permissions?.network?.allowedDomains;
  return Array.isArray(domains)
    ? domains.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
}

function isAllowlistedUrl(url: string, allowedDomains: string[]) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return allowedDomains.some((domain) => {
      const normalized = domain.toLowerCase();
      return hostname === normalized || hostname === `www.${normalized}` || hostname.endsWith(`.${normalized}`);
    });
  } catch {
    return false;
  }
}

function buildResearchSourcePlan(input: {
  query?: string;
  scope?: string;
  urls: string[];
  sourceHints: string[];
  autoFetch: boolean;
}) {
  const allowedDomains = getAllowedDomains();
  const explicitUrls = input.urls
    .filter((url) => isAllowlistedUrl(url, allowedDomains))
    .map((url) => ({
      url,
      rationale: 'Operator-supplied research source',
      surface: classifyResearchSurface({ url, query: input.query }),
    }));

  if (explicitUrls.length > 0) {
    return explicitUrls;
  }

  if (!input.autoFetch) {
    return [];
  }

  const subject = `${input.query ?? ''} ${input.scope ?? ''} ${input.sourceHints.join(' ')}`.toLowerCase();
  const scopeSurface = classifyResearchSurface({ query: input.scope ?? input.query });
  const ranked = AUTO_SOURCE_LIBRARY
    .map((entry) => {
      const score = entry.keywords.reduce((sum, keyword) => (
        subject.includes(keyword) ? sum + 2 : sum
      ), entry.surface === scopeSurface ? 1 : 0);
      return { entry, score };
    })
    .filter(({ entry, score }) => score > 0 && isAllowlistedUrl(entry.url, allowedDomains))
    .sort((left, right) => right.score - left.score || left.entry.url.localeCompare(right.entry.url))
    .slice(0, 3)
    .map(({ entry }) => ({
      url: entry.url,
      rationale: entry.rationale,
      surface: entry.surface,
    }));

  if (ranked.length > 0) {
    return ranked;
  }

  return AUTO_SOURCE_LIBRARY
    .filter((entry) => entry.surface === scopeSurface && isAllowlistedUrl(entry.url, allowedDomains))
    .slice(0, 2)
    .map(({ url, rationale, surface }) => ({ url, rationale, surface }));
}

function buildChangeSignal(entry: { url?: string; query?: string; statusCode?: number; contentSize?: number; error?: string }) {
  if (entry.error) {
    return {
      classification: 'unreachable',
      summary: `${entry.url ?? entry.query ?? 'source'} could not be fetched`,
    };
  }

  if (typeof entry.statusCode === 'number' && entry.statusCode >= 400) {
    return {
      classification: 'degraded',
      summary: `${entry.url ?? 'source'} returned status ${entry.statusCode}`,
    };
  }

  return {
    classification: typeof entry.contentSize === 'number' && entry.contentSize > 5000 ? 'substantive-update' : 'watch',
    summary: `${entry.url ?? entry.query ?? 'source'} produced a research signal`,
  };
}

function classifyResearchSurface(entry: { url?: string; query?: string }) {
  const subject = `${entry.url ?? ''} ${entry.query ?? ''}`.toLowerCase();
  if (/pricing|price|cost/.test(subject)) return 'pricing';
  if (/policy|terms|compliance|trust/.test(subject)) return 'policy';
  if (/api|sdk|endpoint|model/.test(subject)) return 'api';
  if (/vendor|provider|competitor|market/.test(subject)) return 'vendor';
  return 'general';
}

function buildInternalSignals(changeIntelligence: Array<{ source: string; classification: string; summary: string; surface: string }>) {
  return changeIntelligence.map((signal, index) => ({
    signalId: `market-signal-${index + 1}`,
    source: signal.source,
    surface: signal.surface,
    classification: signal.classification,
    downstreamUse:
      signal.classification === 'substantive-update'
        ? 'doc-drift-and-proof-review'
        : signal.classification === 'degraded' || signal.classification === 'unreachable'
          ? 'workflow-watch'
          : 'operator-watch',
    summary: signal.summary,
  }));
}

function buildDeltaCapture(changeIntelligence: Array<{ classification: string }>, fetchedSources: number) {
  const substantiveCount = changeIntelligence.filter((signal) => signal.classification === 'substantive-update').length;
  const degradedCount = changeIntelligence.filter((signal) => signal.classification === 'degraded').length;
  const unreachableCount = changeIntelligence.filter((signal) => signal.classification === 'unreachable').length;
  return {
    status:
      changeIntelligence.length === 0
        ? 'query-only'
        : fetchedSources === 0
          ? 'degraded'
          : fetchedSources === changeIntelligence.length
            ? 'fetched'
            : 'mixed',
    substantiveCount,
    degradedCount,
    unreachableCount,
  };
}

function buildMarketResearchSpecialistFields(args: {
  query?: string;
  scope?: string;
  sourcePlanCount: number;
  fetchedSourceCount: number;
  deltaCapture?: {
    status?: string;
    substantiveCount?: number;
    degradedCount?: number;
    unreachableCount?: number;
  };
  handoffPackage?: {
    targetAgentId?: string;
    recommendedTaskType?: string;
  };
  statusOverride?: 'completed' | 'watching' | 'blocked' | 'escalate' | 'refused';
  refusalReason?: string | null;
  escalationReason?: string | null;
}) {
  const status =
    args.statusOverride ??
    ((args.deltaCapture?.status ?? 'query-only') === 'degraded' ||
    (args.deltaCapture?.degradedCount ?? 0) > 0 ||
    (args.deltaCapture?.unreachableCount ?? 0) > 0
      ? 'watching'
      : 'completed');
  const workflowStage =
    status === 'refused'
      ? 'source-plan-refusal'
      : status === 'blocked'
        ? 'signal-capture-blocked'
        : status === 'escalate'
          ? 'signal-escalation'
          : status === 'watching'
            ? 'signal-review'
            : 'signal-closure';
  const subject = args.query ?? args.scope ?? 'market request';
  return buildSpecialistOperatorFields({
    role: 'Trend Researcher',
    workflowStage,
    deliverable: 'allowlisted research brief with source plan, signal classification, and delta-capture guidance',
    status,
    operatorSummary:
      status === 'refused'
        ? `Refused research for ${subject} because no governed allowlisted source plan could be derived.`
        : status === 'blocked'
          ? `Research for ${subject} failed before the signal brief could be completed.`
          : `Researched ${args.sourcePlanCount} allowlisted source(s) for ${subject}; ${args.fetchedSourceCount} fetched successfully, with ${args.deltaCapture?.substantiveCount ?? 0} substantive update signal(s) and ${args.deltaCapture?.unreachableCount ?? 0} unreachable source(s).`
    ,
    recommendedNextActions: [
      status === 'refused'
        ? 'Provide explicit allowlisted URLs or clearer source hints so the governed source plan can be derived.'
        : null,
      status === 'watching' && (args.deltaCapture?.unreachableCount ?? 0) > 0
        ? 'Review the unreachable sources and rerun with explicit URLs if deterministic fetch coverage matters.'
        : null,
      args.handoffPackage?.recommendedTaskType
        ? `Route the resulting change pack into ${args.handoffPackage.recommendedTaskType} when follow-on action is needed.`
        : null,
      args.handoffPackage?.targetAgentId
        ? `Hand the brief to ${args.handoffPackage.targetAgentId} if the operator wants downstream synthesis.`
        : null,
    ],
    refusalReason: args.refusalReason ?? (status === 'refused' ? 'No governed source plan could be derived.' : null),
    escalationReason: args.escalationReason ?? null,
  });
}

async function handleTask(task: any): Promise<any> {
  if (!agentConfig) {
    await loadConfig();
  }

  const agentId = agentConfig.id;
  const taskId = task.id || 'unknown';
  const executeSkill = resolveTaskExecuteSkill(task) ?? await getExecuteSkill();

  console.log(`[${agentId}] Starting task: ${taskId}`);

  try {
    const input = (task.input && typeof task.input === 'object')
      ? task.input
      : ((task.query || task.scope || Array.isArray(task.urls) || Array.isArray(task.sourceHints)) ? task : null);

    if (!input || typeof input !== 'object') {
      return {
        taskId,
        success: false,
        error: 'Invalid input format',
        ...buildMarketResearchSpecialistFields({
          sourcePlanCount: 0,
          fetchedSourceCount: 0,
          statusOverride: 'refused',
          refusalReason: 'Market research requests must include a query, scope, URLs, or source hints.',
        }),
      };
    }

    if (!canUseSkill('sourceFetch')) {
      return {
        taskId,
        success: false,
        error: 'sourceFetch skill not allowed',
        ...buildMarketResearchSpecialistFields({
          query: typeof input.query === 'string' ? input.query.trim() : undefined,
          scope: typeof input.scope === 'string' ? input.scope.trim() : undefined,
          sourcePlanCount: 0,
          fetchedSourceCount: 0,
          statusOverride: 'refused',
          refusalReason: 'sourceFetch permission is required before this research lane can gather governed sources.',
        }),
      };
    }

    const sourcePlan = buildResearchSourcePlan({
      query: typeof input.query === 'string' ? input.query.trim() : undefined,
      scope: typeof input.scope === 'string' ? input.scope.trim() : undefined,
      urls: normalizeStringList(input.urls),
      sourceHints: normalizeStringList(input.sourceHints),
      autoFetch: input.autoFetch !== false,
    });

    if (sourcePlan.length === 0) {
      return {
        taskId,
        success: false,
        error: 'No allowlisted research sources could be derived from the request. Provide allowlisted urls or a query that maps to configured sources.',
        agentId,
        ...buildMarketResearchSpecialistFields({
          query: typeof input.query === 'string' ? input.query.trim() : undefined,
          scope: typeof input.scope === 'string' ? input.scope.trim() : undefined,
          sourcePlanCount: 0,
          fetchedSourceCount: 0,
          statusOverride: 'refused',
          refusalReason:
            'No allowlisted research sources could be derived from the supplied query or URLs.',
        }),
      };
    }

    console.log(`[${agentId}] Researching ${sourcePlan.length} sources`);
    const results: any[] = [];
    const toolInvocations = sourcePlan.map((plannedSource) => ({
      toolId: 'sourceFetch',
      detail: `Fetched ${plannedSource.url} for ${plannedSource.surface} market research.`,
      evidence: [
        `url:${plannedSource.url}`,
        `surface:${plannedSource.surface}`,
        `rationale:${plannedSource.rationale}`,
      ],
      classification: 'signal-intake',
    }));

    for (const plannedSource of sourcePlan) {
      const fetchResult = await executeSkill('sourceFetch', {
        url: plannedSource.url,
        timeout: 10000,
        stripScripts: true,
        normalizeText: true,
      }, agentId);

      if (fetchResult.success) {
        results.push({
          url: plannedSource.url,
          rationale: plannedSource.rationale,
          surface: plannedSource.surface,
          statusCode: fetchResult.data?.statusCode,
          contentSize: fetchResult.data?.content?.length,
          source: fetchResult.data?.source,
          fetchedAt: fetchResult.data?.fetchedAt,
        });
      } else {
        results.push({
          url: plannedSource.url,
          rationale: plannedSource.rationale,
          surface: plannedSource.surface,
          error: fetchResult.error,
        });
      }
    }

    const fetchedSourceCount = results.filter((entry) =>
      !entry.error && typeof entry.contentSize === 'number' && entry.contentSize > 0,
    ).length;
    const changeIntelligence = results.map((entry) => ({
      source: entry.url,
      surface: entry.surface ?? classifyResearchSurface(entry),
      ...buildChangeSignal(entry),
    }));
    const deltaCapture = buildDeltaCapture(changeIntelligence, fetchedSourceCount);
    const internalSignals = buildInternalSignals(changeIntelligence);
    const allFetchesFailed = fetchedSourceCount === 0;
    const degradedResearchWarning =
      'All allowlisted research fetches failed. Returning a degraded source plan and routing signals so operators can still act on the request.';
    const specialistFields = buildMarketResearchSpecialistFields({
      query: typeof input.query === 'string' ? input.query.trim() : undefined,
      scope: typeof input.scope === 'string' ? input.scope.trim() : undefined,
      sourcePlanCount: sourcePlan.length,
      fetchedSourceCount,
      deltaCapture,
      handoffPackage: {
        targetAgentId: changeIntelligence.some((signal) => signal.classification === 'substantive-update')
          ? 'summarization-agent'
          : 'integration-agent',
        recommendedTaskType: changeIntelligence.some((signal) => signal.classification === 'substantive-update')
          ? 'doc-sync'
          : 'integration-workflow',
      },
    });

    console.log(`[${agentId}] Task completed: ${taskId}`);
    return {
      taskId,
      success: true,
      agentId,
      results,
      findings: results,
      sourcePlan,
      toolInvocations,
      changeIntelligence,
      internalSignals,
      warnings: allFetchesFailed ? [degradedResearchWarning] : [],
      handoffSignals: changeIntelligence.map((signal) => ({
        target:
          signal.classification === 'substantive-update'
            ? 'doc-specialist'
            : 'integration-agent',
        reason: signal.summary,
      })),
      handoffPackage: {
        targetAgentId: changeIntelligence.some((signal) => signal.classification === 'substantive-update')
          ? 'summarization-agent'
          : 'integration-agent',
        payloadType: 'market-change-pack',
        signals: changeIntelligence.length,
        recommendedTaskType: changeIntelligence.some((signal) => signal.classification === 'substantive-update')
          ? 'doc-sync'
          : 'integration-workflow',
      },
      changePack: {
        surfaces: Array.from(new Set(changeIntelligence.map((signal) => signal.surface))),
        durableSignalCount: internalSignals.length,
        degradationResilient: deltaCapture.status !== 'fetched' || internalSignals.length > 0,
      },
      deltaCapture,
      confidence: allFetchesFailed
        ? 0.35
        : Math.min(0.95, 0.55 + (fetchedSourceCount / sourcePlan.length) * 0.35),
      degraded: allFetchesFailed,
      networkPosture: allFetchesFailed ? 'degraded' : 'healthy',
      completedAt: new Date().toISOString(),
      ...specialistFields,
    };
  } catch (error: any) {
    console.error(`[${agentId}] Error in task ${taskId}:`, error.message);
    return {
      taskId,
      success: false,
      error: error.message,
      agentId,
      ...buildMarketResearchSpecialistFields({
        sourcePlanCount: 0,
        fetchedSourceCount: 0,
        statusOverride: 'blocked',
      }),
    };
  }
}

async function main(): Promise<void> {
  console.log('[market-research] Agent starting...');

  await loadConfig();
  console.log(`[${agentConfig.id}] Ready to accept tasks`);

  const taskArg = process.argv[2];
  if (taskArg) {
    try {
      let taskInput: any;
      try {
        const payloadRaw = await fs.readFile(taskArg, 'utf-8');
        taskInput = JSON.parse(payloadRaw);
      } catch {
        taskInput = JSON.parse(taskArg);
      }

      const result = await handleTask(taskInput);
      if (process.env.MARKET_RESEARCH_AGENT_RESULT_FILE) {
        const resultDir = path.dirname(process.env.MARKET_RESEARCH_AGENT_RESULT_FILE);
        await fs.mkdir(resultDir, { recursive: true });
        await fs.writeFile(process.env.MARKET_RESEARCH_AGENT_RESULT_FILE, JSON.stringify(result, null, 2), 'utf-8');
      } else {
        console.log('Result:', JSON.stringify(result, null, 2));
      }
      process.exit(result.success ? 0 : 1);
    } catch (error: any) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  }
}

main().catch(console.error);

export { handleTask, loadConfig, canUseSkill };
