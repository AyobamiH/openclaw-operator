import { createHash } from "node:crypto";
import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveKnowledgeRoute } from "./resolver.js";
import type { KnowledgeRoutingGraph, KnowledgeRoutingShadowComparison } from "./types.js";

const DEFAULT_MAX_SHADOW_LOG_BYTES = 1_000_000;
const DEFAULT_MAX_SHADOW_RECORD_BYTES = 16_384;

export interface KnowledgeRoutingShadowOptions {
  requestId?: string;
  sessionId?: string;
}

export function createKnowledgeRoutingShadowComparison(
  graph: KnowledgeRoutingGraph,
  informationNeed: string,
  existingSourceUsed?: string,
  options: KnowledgeRoutingShadowOptions = {},
): KnowledgeRoutingShadowComparison {
  const route = resolveKnowledgeRoute(graph, informationNeed, 5);
  const selectedNode = route.recommendedNodes[0]?.id ?? null;
  const proposedLocators = new Set(route.authoritativeSources.map((source) => source.locator));
  const agreement = existingSourceUsed
    ? Array.from(proposedLocators).some((locator) => locator.includes(existingSourceUsed) || existingSourceUsed.includes(locator))
      ? "agree"
      : "disagree"
    : "unknown";
  return {
    generatedAt: new Date().toISOString(),
    informationNeedHash: createHash("sha256").update(informationNeed).digest("hex"),
    informationNeedPreview: preview(informationNeed),
    requestId: options.requestId ? preview(options.requestId, 96) : undefined,
    sessionHash: options.sessionId ? createHash("sha256").update(options.sessionId).digest("hex") : undefined,
    graphRoute: {
      selectedNode,
      relationshipPath: route.relationshipPath.map((edge) => `${edge.from} ${edge.relationship} ${edge.to}`),
      proposedSources: route.authoritativeSources,
      verificationSources: route.verificationSources,
      warnings: route.warnings,
    },
    existingSourceUsed: existingSourceUsed ? preview(existingSourceUsed, 240) : undefined,
    agreement,
  };
}

export class KnowledgeRoutingShadowRecorder {
  constructor(
    private readonly path: string,
    private readonly options: { maxLogBytes?: number; maxRecordBytes?: number } = {},
  ) {}

  async record(comparison: KnowledgeRoutingShadowComparison): Promise<KnowledgeRoutingShadowComparison> {
    const record = JSON.stringify(comparison);
    const maxRecordBytes = this.options.maxRecordBytes ?? DEFAULT_MAX_SHADOW_RECORD_BYTES;
    if (Buffer.byteLength(record, "utf-8") > maxRecordBytes) {
      throw new Error(`shadow_record_too_large:${Buffer.byteLength(record, "utf-8")}`);
    }
    await mkdir(dirname(this.path), { recursive: true });
    await rotateIfNeeded(this.path, Buffer.byteLength(record, "utf-8") + 1, this.options.maxLogBytes);
    await appendFile(this.path, record + "\n", "utf-8");
    return comparison;
  }
}

async function rotateIfNeeded(path: string, nextBytes: number, maxLogBytes = DEFAULT_MAX_SHADOW_LOG_BYTES) {
  try {
    const current = await stat(path);
    if (current.size + nextBytes <= maxLogBytes) return;
    await rename(path, `${path}.1`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function preview(value: string, maxLength = 160): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "[secret]=[redacted]")
    .replace(/\b(?:sk|ghp|gho|github_pat)_[A-Za-z0-9_]{12,}\b/g, "[token]")
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g, "[token]")
    .replace(/\b\d{8,}\b/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
