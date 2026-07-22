import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Telemetry } from "../../shared/telemetry.js";
import {
  buildAgentRelationshipWindow,
  buildIncidentPriorityQueue,
  buildSpecialistOperatorFields,
  buildWorkflowBlockerSummary,
  loadRuntimeState,
  summarizeProofSurface,
  summarizeTaskExecutions,
  type RuntimeStateSubset,
} from "../../shared/runtime-evidence.js";
import { enforceKnowledgePackRetention } from "./knowledge-pack-retention.js";

interface DriftRepairPayload {
  id: string;
  docPaths: string[];
  targetAgents: string[];
  requestedBy: string;
}

interface AgentConfig {
  id?: string;
  docsPath: string;
  cookbookPath?: string;
  knowledgePackDir: string;
  stateFile?: string;
  orchestratorStatePath?: string;
  agentsRootPath?: string;
  orchestratorConfigPath?: string;
}

interface RuntimeTruthSummary {
  generatedAt: string;
  taskExecutions: ReturnType<typeof summarizeTaskExecutions>;
  openIncidentCount: number;
  criticalIncidentCount: number;
  relationshipObservationCount: number;
  proofDelivery: {
    milestone: ReturnType<typeof summarizeProofSurface>;
    demandSummary: ReturnType<typeof summarizeProofSurface>;
  };
}

interface RuntimeState extends RuntimeStateSubset {}

function summarizeRuntimeProofSurface(
  runtimeState: RuntimeState,
  surface: "milestone" | "demandSummary",
) {
  return summarizeProofSurface(
    {
      workflowEvents: runtimeState.workflowEvents ?? [],
      relationshipObservations: runtimeState.relationshipObservations ?? [],
    },
    surface,
  );
}

interface ConfigAuditIssue {
  severity: "critical" | "warning";
  scope: string;
  message: string;
}

interface ConfigAudit {
  checkedAt: string;
  summary: {
    totalAgents: number;
    validAgents: number;
    missingIds: number;
    missingOrchestratorTask: number;
    totalIssues: number;
    criticalIssues: number;
  };
  issues: ConfigAuditIssue[];
  discoveredAgentIds: string[];
}

interface ProcessedDocSummary {
  source: "openclaw" | "openai";
  path: string;
  absolutePath: string;
  summary: string;
  wordCount: number;
  bytes: number;
  firstHeading?: string;
}

interface TargetBrief {
  agentId: string;
  objective: string;
  sourceFocus: Array<"openclaw" | "openai">;
  contradictionFocus: string[];
  suggestedActions: string[];
  knowledgeBundle?: {
    primaryDocs: string[];
    runtimeSignals: string[];
    contradictionIds: string[];
    topologySignals: string[];
    freshnessSignals: string[];
  };
}

interface IncidentPack {
  incidentId: string;
  severity: string;
  summary: string;
  affectedSurfaces: string[];
  recommendedSteps: string[];
}

interface KnowledgeEvidenceRails {
  code: string[];
  config: string[];
  runtime: string[];
  publicProof: string[];
  inference: string[];
}

interface ContradictionRecord {
  contradictionId: string;
  entityId: string;
  summary: string;
  severity: "critical" | "warning" | "info";
  rail: keyof KnowledgeEvidenceRails;
  status: "active" | "watching" | "resolved";
  recommendedTaskType: "drift-repair" | "qa-verification" | "system-monitor";
  rankScore: number;
  freshnessWeight: number;
  targetAgentIds: string[];
  evidence: string[];
}

interface RepairLoopSummary {
  status: "clear" | "watching" | "repair-needed";
  recommendedTaskType: "drift-repair" | "qa-verification" | "system-monitor";
  contradictions: string[];
  staleSignals: string[];
  nextActions: string[];
}

interface RepairDraft {
  targetAgentId: string;
  priority: "critical" | "high" | "medium";
  title: string;
  rationale: string;
  sourceIncidentIds: string[];
  recommendedTasks: Array<"drift-repair" | "qa-verification" | "system-monitor">;
  contradictionIds: string[];
  sourceRails: Array<keyof KnowledgeEvidenceRails>;
  verifierRequired: boolean;
  handoff: {
    recommendedTaskType: "drift-repair" | "qa-verification" | "system-monitor";
    payload: {
      targetAgentId: string;
      sourceIncidentIds: string[];
      contradictionIds: string[];
      workflowSignals: string[];
      affectedSurfaces: string[];
    };
  };
  workflowSignals: string[];
  relationshipWindow: {
    total: number;
    recentSixHours: number;
    recentTwentyFourHours: number;
    lastObservedAt: string | null;
  };
  evidence: string[];
}

interface TaskSpecificKnowledgeBundle {
  targetAgentId: string;
  primaryDocs: string[];
  secondaryDocs: string[];
  contradictionIds: string[];
  runtimeSignals: string[];
  publicProofSignals: string[];
  topologySignals: string[];
  freshnessSignals: string[];
}

interface TopologyPack {
  targetAgentId: string;
  routeTaskType: string | null;
  serviceStatePath: string | null;
  orchestratorStatePath: string | null;
  docsPath: string | null;
  cookbookPath: string | null;
  relationshipSignals: string[];
  workflowSignals: string[];
  environmentSignals: string[];
}

interface EntityFreshnessEntry {
  entityId: string;
  rail: keyof KnowledgeEvidenceRails;
  freshness: "fresh" | "aging" | "stale" | "unknown";
  updatedAt: string | null;
  contradictionCount: number;
  targetAgentIds: string[];
  evidence: string[];
}

interface ContradictionGraphSummary {
  entityCount: number;
  rankedContradictionCount: number;
  byRail: Array<{
    rail: keyof KnowledgeEvidenceRails;
    contradictionCount: number;
    topEntityId: string | null;
    maxRankScore: number;
  }>;
  byTargetAgent: Array<{
    targetAgentId: string;
    contradictionCount: number;
    staleEntityCount: number;
  }>;
}

interface TargetAgentConfigTopology {
  orchestratorTask?: string;
  serviceStatePath?: string;
  orchestratorStatePath?: string;
  docsPath?: string;
  cookbookPath?: string;
}

const telemetry = new Telemetry({ component: "doc-specialist" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = resolve(__dirname, "../../..");

const KNOWLEDGE_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".ipynb",
  ".json",
  ".yaml",
  ".yml",
  ".py",
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".tsx",
  ".html",
  ".css",
  ".scss",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".sh",
  ".sql",
]);

const KNOWLEDGE_BASENAMES = new Set([
  "license",
  "makefile",
  "dockerfile",
  "justfile",
  "procfile",
  ".funcignore",
  ".gitignore",
]);

const HARD_IGNORED_KNOWLEDGE_DIRECTORIES = new Set([
  "__pycache__",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

const ASSET_MANIFEST_DIRECTORIES = new Set([
  "data",
  "datasets",
  "images",
  "image",
  "input_images",
  "output_images",
  "outputs",
  "audio",
  "video",
]);

const BINARY_ASSET_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".bmp",
  ".ico",
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
  ".flac",
  ".mp4",
  ".mov",
  ".webm",
  ".avi",
  ".mkv",
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".zip",
  ".tar",
  ".gz",
  ".parquet",
  ".feather",
  ".avro",
  ".rdb",
]);

function isIgnoredKnowledgeDirectory(segment: string): boolean {
  const normalizedSegment = segment.toLowerCase();
  return (
    normalizedSegment.startsWith(".") ||
    HARD_IGNORED_KNOWLEDGE_DIRECTORIES.has(normalizedSegment)
  );
}

function isAssetManifestDirectory(segment: string): boolean {
  const normalizedSegment = segment.toLowerCase();
  return (
    normalizedSegment === "results" ||
    normalizedSegment.startsWith("results_") ||
    ASSET_MANIFEST_DIRECTORIES.has(normalizedSegment)
  );
}

async function loadAgentConfig(): Promise<AgentConfig> {
  const configPath = resolve(__dirname, "../agent.config.json");
  const raw = await readFile(configPath, "utf-8");
  const parsed = JSON.parse(raw) as AgentConfig;
  if (!parsed.docsPath || !parsed.knowledgePackDir) {
    throw new Error("agent.config.json must include docsPath and knowledgePackDir");
  }
  return {
    docsPath: resolve(dirname(configPath), parsed.docsPath),
    cookbookPath: parsed.cookbookPath ? resolve(dirname(configPath), parsed.cookbookPath) : undefined,
    knowledgePackDir: resolve(dirname(configPath), parsed.knowledgePackDir),
    stateFile: parsed.stateFile ? resolve(dirname(configPath), parsed.stateFile) : undefined,
    agentsRootPath: resolve(dirname(configPath), parsed.agentsRootPath || "../../agents"),
    orchestratorConfigPath: resolve(
      dirname(configPath),
      parsed.orchestratorConfigPath || "../../orchestrator_config.json"
    ),
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runConfigAudit(task: DriftRepairPayload, config: AgentConfig): Promise<ConfigAudit> {
  const issues: ConfigAuditIssue[] = [];
  const discoveredAgentIds: string[] = [];
  let totalAgents = 0;
  let validAgents = 0;
  let missingIds = 0;
  let missingOrchestratorTask = 0;

  const docsExists = await pathExists(config.docsPath);
  if (!docsExists) {
    issues.push({
      severity: "critical",
      scope: "doc-specialist",
      message: `Configured docsPath does not exist: ${config.docsPath}`,
    });
  }

  if (config.cookbookPath) {
    const cookbookExists = await pathExists(config.cookbookPath);
    if (!cookbookExists) {
      issues.push({
        severity: "warning",
        scope: "doc-specialist",
        message: `Configured cookbookPath does not exist: ${config.cookbookPath}`,
      });
    }
  }

  const orchestratorConfigExists = await pathExists(config.orchestratorConfigPath || "");
  if (!orchestratorConfigExists) {
    issues.push({
      severity: "warning",
      scope: "orchestrator",
      message: `orchestrator config not found at: ${config.orchestratorConfigPath}`,
    });
  }

  try {
    const agentDirs = await readdir(config.agentsRootPath || "");
    for (const agentDir of agentDirs) {
      if (
        agentDir.startsWith(".") ||
        agentDir === "shared" ||
        agentDir === "README.md" ||
        agentDir === "AGENT_TEMPLATE"
      ) {
        continue;
      }

      const agentConfigPath = resolve(config.agentsRootPath!, agentDir, "agent.config.json");
      const hasConfig = await pathExists(agentConfigPath);
      if (!hasConfig) continue;

      totalAgents++;

      try {
        const raw = await readFile(agentConfigPath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const id = typeof parsed.id === "string" ? parsed.id : "";
        const orchestratorTask = typeof parsed.orchestratorTask === "string" ? parsed.orchestratorTask : "";

        if (!id) {
          missingIds++;
          issues.push({
            severity: "critical",
            scope: `agent:${agentDir}`,
            message: `Missing required id in ${agentConfigPath}`,
          });
        } else {
          discoveredAgentIds.push(id);
        }

        if (!orchestratorTask) {
          missingOrchestratorTask++;
          issues.push({
            severity: "warning",
            scope: `agent:${agentDir}`,
            message: `No orchestratorTask declared in ${agentConfigPath}`,
          });
        }

        if (id) {
          validAgents++;
        }
      } catch (error) {
        issues.push({
          severity: "critical",
          scope: `agent:${agentDir}`,
          message: `Invalid JSON config at ${agentConfigPath}: ${(error as Error).message}`,
        });
      }
    }
  } catch (error) {
    issues.push({
      severity: "critical",
      scope: "doc-specialist",
      message: `Unable to scan agents root path ${config.agentsRootPath}: ${(error as Error).message}`,
    });
  }

  for (const target of task.targetAgents) {
    if (!discoveredAgentIds.includes(target)) {
      issues.push({
        severity: "warning",
        scope: "drift-repair",
        message: `Target agent '${target}' not found in discovered agent IDs`,
      });
    }
  }

  const criticalIssues = issues.filter((issue) => issue.severity === "critical").length;

  return {
    checkedAt: new Date().toISOString(),
    summary: {
      totalAgents,
      validAgents,
      missingIds,
      missingOrchestratorTask,
      totalIssues: issues.length,
      criticalIssues,
    },
    issues,
    discoveredAgentIds,
  };
}

async function normalizeDocPath(docPath: string, docsRoot: string) {
  if (!docPath) return null;
  const trimmed = docPath.replace(/^\.\//, "");

  const candidatePaths = [
    trimmed,
    resolve(workspaceRoot, trimmed),
    resolve(docsRoot, trimmed),
  ];

  for (const candidate of candidatePaths) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return resolve(docsRoot, trimmed);
}

function shouldIgnoreKnowledgePath(relativePath: string): boolean {
  const segments = relativePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());

  for (const segment of segments.slice(0, -1)) {
    if (isIgnoredKnowledgeDirectory(segment)) {
      return true;
    }
  }

  return false;
}

function shouldIncludeKnowledgeFile(filePath: string, relativePath: string): boolean {
  if (shouldIgnoreKnowledgePath(relativePath)) {
    return false;
  }

  const normalizedBasename = basename(filePath).toLowerCase();
  if (KNOWLEDGE_BASENAMES.has(normalizedBasename)) {
    return true;
  }

  const extension = extname(filePath).toLowerCase();
  return KNOWLEDGE_EXTENSIONS.has(extension);
}

async function findKnowledgeFiles(
  dir: string,
  prefix = "",
): Promise<Array<{ path: string; absolutePath: string }>> {
  const results: Array<{ path: string; absolutePath: string }> = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = resolve(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (isIgnoredKnowledgeDirectory(entry.name)) {
          continue;
        }

        if (isAssetManifestDirectory(entry.name)) {
          results.push({
            path: `${relativePath}/.asset-manifest.md`,
            absolutePath: `${absolutePath}#asset-manifest`,
          });
        }

        const subFiles = await findKnowledgeFiles(absolutePath, relativePath);
        results.push(...subFiles);
      } else if (shouldIncludeKnowledgeFile(entry.name, relativePath)) {
        results.push({ path: relativePath, absolutePath });
      }
    }
  } catch (error) {
    await telemetry.warn("dir.scan_failed", {
      dir,
      message: (error as Error).message,
    });
  }

  return results;
}

function summarize(content: string, maxChars = 600) {
  const collapsed = content.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars)}…`;
}

function createNotebookSummary(content: string) {
  try {
    const parsed = JSON.parse(content) as {
      cells?: Array<{ cell_type?: string; source?: string[] | string; outputs?: unknown[] }>;
      metadata?: Record<string, unknown>;
      nbformat?: number;
      nbformat_minor?: number;
    };
    const cells = Array.isArray(parsed.cells) ? parsed.cells : [];
    const markdownCount = cells.filter((cell) => cell.cell_type === "markdown").length;
    const codeCount = cells.filter((cell) => cell.cell_type === "code").length;
    const outputCount = cells.reduce(
      (count, cell) => count + (Array.isArray(cell.outputs) ? cell.outputs.length : 0),
      0,
    );
    const previews = cells
      .slice(0, 10)
      .map((cell, index) => {
        const raw = Array.isArray(cell.source) ? cell.source.join("") : String(cell.source ?? "");
        const preview = raw.replace(/\s+/g, " ").trim().slice(0, 220);
        return `[cell ${index} | ${cell.cell_type ?? "unknown"}] ${preview}`;
      })
      .filter(Boolean);
    const metadataKeys = Object.keys(parsed.metadata ?? {}).slice(0, 8);
    const summary = [
      `Notebook with ${cells.length} cells (${markdownCount} markdown, ${codeCount} code, ${outputCount} output blocks).`,
      metadataKeys.length > 0 ? `Metadata keys: ${metadataKeys.join(", ")}.` : "",
      previews.join(" "),
    ]
      .filter(Boolean)
      .join(" ");
    return {
      summary: summarize(summary, 900),
      wordCount: summary.split(/\s+/).filter(Boolean).length,
      firstHeading: `Notebook (${parsed.nbformat ?? "?"}.${parsed.nbformat_minor ?? "?"})`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = `Notebook JSON could not be parsed cleanly (${message}).`;
    return {
      summary: fallback,
      wordCount: fallback.split(/\s+/).filter(Boolean).length,
      firstHeading: "Notebook parse fallback",
    };
  }
}

async function createAssetManifestSummary(
  dirPath: string,
  relativePath: string,
): Promise<{ summary: string; wordCount: number; bytes: number; firstHeading?: string }> {
  const extensionCounts = new Map<string, number>();
  const sampleAssets: string[] = [];
  const textClues: string[] = [];
  let totalFiles = 0;
  let totalBytes = 0;

  async function walk(currentDir: string, currentPrefix: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (isIgnoredKnowledgeDirectory(entry.name)) {
        continue;
      }

      const absolute = resolve(currentDir, entry.name);
      const nestedRelative = currentPrefix ? `${currentPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(absolute, nestedRelative);
        continue;
      }

      const stats = await stat(absolute);
      totalFiles += 1;
      totalBytes += stats.size;

      const extension = extname(entry.name).toLowerCase() || "(no extension)";
      extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);

      if (shouldIncludeKnowledgeFile(entry.name, nestedRelative)) {
        if (textClues.length < 10) {
          textClues.push(nestedRelative);
        }
        continue;
      }

      if (BINARY_ASSET_EXTENSIONS.has(extension) && sampleAssets.length < 12) {
        sampleAssets.push(nestedRelative);
      }
    }
  }

  await walk(dirPath, "");

  const topExtensions = Array.from(extensionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([extension, count]) => `${extension}:${count}`);

  const summary = [
    `Asset manifest for ${relativePath}: ${totalFiles} files totaling ${totalBytes} bytes.`,
    topExtensions.length > 0 ? `Top extensions ${topExtensions.join(", ")}.` : "",
    sampleAssets.length > 0 ? `Sample assets: ${sampleAssets.join(", ")}.` : "",
    textClues.length > 0 ? `Embedded text/code clues: ${textClues.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    summary: summarize(summary, 900),
    wordCount: summary.split(/\s+/).filter(Boolean).length,
    bytes: totalBytes,
    firstHeading: `Asset manifest: ${basename(relativePath)}`,
  };
}

function extractHeading(content: string) {
  const match = content.match(/^#\s+(.+)$/m) ?? content.match(/^##\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}

async function collectDocSummaries(docPaths: string[], docsRoot: string): Promise<ProcessedDocSummary[]> {
  const summaries: ProcessedDocSummary[] = [];
  const seen = new Set<string>();

  for (const originalPath of docPaths) {
    if (!originalPath) continue;
    if (seen.has(originalPath)) continue;
    seen.add(originalPath);

    const absolute = await normalizeDocPath(originalPath, docsRoot);
    if (!absolute) continue;

    try {
      const content = await readFile(absolute, "utf-8");
      const summary = summarize(content);
      const wordCount = content.split(/\s+/).filter(Boolean).length;
      const bytes = Buffer.byteLength(content, "utf-8");
      const repoRelativePath = relative(workspaceRoot, absolute);
      summaries.push({
        source: "openclaw",
        path:
          !repoRelativePath.startsWith("..") && repoRelativePath.length > 0
            ? repoRelativePath
            : relative(docsRoot, absolute),
        absolutePath: absolute,
        summary,
        wordCount,
        bytes,
        firstHeading: extractHeading(content),
      });
    } catch (error) {
      await telemetry.warn("doc.read_failed", {
        path: originalPath,
        message: (error as Error).message,
      });
    }
  }

  return summaries;
}

async function collectDocsFromPath(
  docsPath: string,
  source: "openclaw" | "openai",
): Promise<ProcessedDocSummary[]> {
  const summaries: ProcessedDocSummary[] = [];
  const knowledgeFiles = await findKnowledgeFiles(docsPath);

  for (const file of knowledgeFiles) {
    try {
      let summary = "";
      let wordCount = 0;
      let bytes = 0;
      let firstHeading: string | undefined;

      if (file.absolutePath.endsWith("#asset-manifest")) {
        const manifest = await createAssetManifestSummary(
          file.absolutePath.slice(0, -"#asset-manifest".length),
          file.path.replace(/\/\.asset-manifest\.md$/, ""),
        );
        summary = manifest.summary;
        wordCount = manifest.wordCount;
        bytes = manifest.bytes;
        firstHeading = manifest.firstHeading;
      } else {
        const content = await readFile(file.absolutePath, "utf-8");
        bytes = Buffer.byteLength(content, "utf-8");
        if (extname(file.absolutePath).toLowerCase() === ".ipynb") {
          const notebook = createNotebookSummary(content);
          summary = notebook.summary;
          wordCount = notebook.wordCount;
          firstHeading = notebook.firstHeading;
        } else {
          summary = summarize(content);
          wordCount = content.split(/\s+/).filter(Boolean).length;
          firstHeading = extractHeading(content);
        }
      }

      summaries.push({
        source,
        path: file.path,
        absolutePath: file.absolutePath,
        summary,
        wordCount,
        bytes,
        firstHeading,
      });
    } catch (error) {
      await telemetry.warn("doc.read_failed", {
        path: file.path,
        source,
        message: (error as Error).message,
      });
    }
  }

  return summaries;
}

function dedupeSummaries(summaries: ProcessedDocSummary[]): ProcessedDocSummary[] {
  const seen = new Set<string>();
  const deduped: ProcessedDocSummary[] = [];

  for (const summary of summaries) {
    const key = summary.absolutePath || `${summary.source}:${summary.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(summary);
  }

  return deduped;
}

function buildContradictionEntityId(summary: string) {
  const normalized = summary
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 64) : "unspecified";
}

function computeContradictionRankScore(record: {
  severity: ContradictionRecord["severity"];
  rail: ContradictionRecord["rail"];
  status: ContradictionRecord["status"];
  evidenceCount: number;
  targetAgentCount: number;
  freshnessWeight: number;
}) {
  const severityWeight = { critical: 400, warning: 250, info: 100 }[record.severity];
  const railWeight = {
    runtime: 90,
    publicProof: 75,
    config: 65,
    code: 50,
    inference: 20,
  }[record.rail];
  const statusWeight = { active: 40, watching: 15, resolved: 0 }[record.status];
  return (
    severityWeight +
    railWeight +
    statusWeight +
    record.freshnessWeight +
    Math.min(record.evidenceCount, 6) * 5 +
    Math.min(record.targetAgentCount, 4) * 5
  );
}

function buildRepairDrafts(args: {
  targetAgents: string[];
  runtimeState: RuntimeState;
  configAudit: ConfigAudit;
  contradictionLedger: ContradictionRecord[];
}): RepairDraft[] {
  const priorityIncidents = buildIncidentPriorityQueue(args.runtimeState.incidentLedger ?? []);
  const workflowBlockers = buildWorkflowBlockerSummary(args.runtimeState.workflowEvents ?? []);

  return args.targetAgents.map((agentId) => {
    const relationshipWindow = buildAgentRelationshipWindow(
      args.runtimeState.relationshipObservations ?? [],
      agentId,
    );
    const relevantContradictions = args.contradictionLedger.filter(
      (record) => record.targetAgentIds.length === 0 || record.targetAgentIds.includes(agentId),
    );
    const relevantIncidents = priorityIncidents.filter((incident) => {
      if (incident.linkedServiceIds.includes(agentId)) return true;
      return incident.affectedSurfaces.some((surface) => surface.includes(agentId));
    });

    const priority: RepairDraft["priority"] =
      args.configAudit.summary.criticalIssues > 0 || relevantIncidents.some((incident) => incident.severity === "critical")
        ? "critical"
        : workflowBlockers.totalStopSignals > 0 || relevantIncidents.length > 0
          ? "high"
          : "medium";

    const recommendedTaskCandidates: RepairDraft["recommendedTasks"] = [];
    if (args.configAudit.summary.totalIssues > 0) {
      recommendedTaskCandidates.push("drift-repair");
    }
    if (relevantIncidents.some((incident) => incident.remediationTaskType === "system-monitor")) {
      recommendedTaskCandidates.push("system-monitor");
    }
    if (
      workflowBlockers.totalStopSignals > 0 ||
      relevantIncidents.some((incident) => incident.verificationStatus !== "passed")
    ) {
      recommendedTaskCandidates.push("qa-verification");
    }
    const recommendedTasks = Array.from(new Set(recommendedTaskCandidates));
    const contradictionIds = relevantContradictions
      .slice(0, 5)
      .map((record) => record.contradictionId);
    const sourceRails = Array.from(
      new Set(relevantContradictions.slice(0, 5).map((record) => record.rail)),
    );

    const workflowSignals = [
      ...(workflowBlockers.latestStopCode ? [`stop-code:${workflowBlockers.latestStopCode}`] : []),
      ...Object.entries(workflowBlockers.byStage)
        .slice(0, 3)
        .map(([stage, count]) => `blocked-${stage}:${count}`),
    ];

    const evidence = [
      `config-issues:${args.configAudit.summary.totalIssues}`,
      `critical-config-issues:${args.configAudit.summary.criticalIssues}`,
      `agent-relationships:${relationshipWindow.total}`,
      `agent-relationships-24h:${relationshipWindow.recentTwentyFourHours}`,
      ...(relevantIncidents.slice(0, 3).map((incident) => `incident:${incident.incidentId}:${incident.priorityScore}`)),
      ...workflowSignals,
    ];

    const rationale = relevantIncidents.length > 0
      ? `Target ${agentId} is touched by ${relevantIncidents.length} prioritized incident(s) and ${relationshipWindow.total} observed relationship event(s).`
      : workflowBlockers.totalStopSignals > 0
        ? `Target ${agentId} should refresh against current workflow stop signals and relationship evidence.`
        : `Target ${agentId} should refresh against the latest knowledge and runtime truth.`;

      const handoffTaskType =
        recommendedTasks[0] ??
        (relevantContradictions[0]?.recommendedTaskType ?? "qa-verification");

    return {
      targetAgentId: agentId,
      priority,
      title: `Repair and refresh ${agentId} against current runtime truth`,
      rationale,
      sourceIncidentIds: relevantIncidents.map((incident) => incident.incidentId),
      recommendedTasks: recommendedTasks.length > 0 ? recommendedTasks : ["qa-verification"],
      contradictionIds,
      sourceRails,
      verifierRequired:
        workflowBlockers.totalStopSignals > 0 ||
        relevantIncidents.some((incident) => incident.verificationStatus !== "passed"),
      handoff: {
        recommendedTaskType: handoffTaskType,
        payload: {
          targetAgentId: agentId,
          sourceIncidentIds: relevantIncidents.map((incident) => incident.incidentId),
          contradictionIds,
          workflowSignals,
          affectedSurfaces: Array.from(
            new Set(relevantIncidents.flatMap((incident) => incident.affectedSurfaces)),
          ).slice(0, 6),
        },
      },
      workflowSignals,
      relationshipWindow: {
        total: relationshipWindow.total,
        recentSixHours: relationshipWindow.recentSixHours,
        recentTwentyFourHours: relationshipWindow.recentTwentyFourHours,
        lastObservedAt: relationshipWindow.lastObservedAt,
      },
      evidence,
    };
  });
}

function buildEvidenceRails(args: {
  summaries: ProcessedDocSummary[];
  configAudit: ConfigAudit;
  runtimeState: RuntimeState;
  workflowBlockers: ReturnType<typeof buildWorkflowBlockerSummary>;
}) {
  const { summaries, configAudit, runtimeState, workflowBlockers } = args;
  const code = summaries
    .filter((doc) => /\.(ts|tsx|js|cjs|mjs|py|sh|css|html)$/i.test(doc.path))
    .slice(0, 12)
    .map((doc) => doc.path);
  const config = [
    ...configAudit.issues.slice(0, 8).map((issue) => issue.message),
    ...summaries
      .filter((doc) => /\.(json|ya?ml|toml|ini|cfg|conf|service)$/i.test(doc.path))
      .slice(0, 6)
      .map((doc) => doc.path),
  ];
  const runtime = [
    ...((runtimeState.incidentLedger ?? [])
      .filter((incident) => incident.status !== "resolved")
      .slice(0, 6)
      .map((incident) => incident.summary ?? incident.incidentId)),
    ...(workflowBlockers.latestStopCode ? [`workflow-stop:${workflowBlockers.latestStopCode}`] : []),
    `task-executions:${(runtimeState.taskExecutions ?? []).length}`,
  ];
  const milestoneProof = summarizeRuntimeProofSurface(runtimeState, "milestone");
  const demandProof = summarizeRuntimeProofSurface(runtimeState, "demandSummary");
  const publicProof = [
    `milestone-surface-observations:${milestoneProof.totalObservations}`,
    `milestone-surface-degraded:${milestoneProof.deadLetter}`,
    `demandSummary-surface-observations:${demandProof.totalObservations}`,
    `demandSummary-surface-degraded:${demandProof.deadLetter}`,
  ];
  const inference = [
    configAudit.summary.criticalIssues > 0
      ? `${configAudit.summary.criticalIssues} critical config contradiction(s) require repair.`
      : "No critical config contradictions detected.",
    (runtimeState.incidentLedger ?? []).some((incident) => incident.status !== "resolved")
      ? "Runtime incidents remain open, so repo truth and runtime truth cannot be treated as fully aligned."
      : "Runtime incidents are currently cleared.",
    workflowBlockers.totalStopSignals > 0
      ? "Workflow stop signals imply unresolved execution truth."
      : "Workflow stop signals are currently clear.",
  ];

  return {
    code,
    config,
    runtime,
    publicProof,
    inference,
  } satisfies KnowledgeEvidenceRails;
}

function buildContradictionLedger(args: {
  configAudit: ConfigAudit;
  runtimeState: RuntimeState;
  workflowBlockers: ReturnType<typeof buildWorkflowBlockerSummary>;
  evidenceRails: KnowledgeEvidenceRails;
  targetAgents: string[];
}) {
  const { configAudit, runtimeState, workflowBlockers, evidenceRails, targetAgents } = args;
  const contradictions: ContradictionRecord[] = [];

  for (const [index, issue] of configAudit.issues.slice(0, 8).entries()) {
    const freshnessWeight = issue.severity === "critical" ? 45 : 25;
    contradictions.push({
      contradictionId: `config-${index + 1}`,
      entityId: buildContradictionEntityId(issue.message),
      summary: issue.message,
      severity: issue.severity,
      rail: "config",
      status: "active",
      recommendedTaskType: "drift-repair",
      freshnessWeight,
      rankScore: computeContradictionRankScore({
        severity: issue.severity,
        rail: "config",
        status: "active",
        evidenceCount: evidenceRails.config.length,
        targetAgentCount: targetAgents.length,
        freshnessWeight,
      }),
      targetAgentIds: [...targetAgents],
      evidence: evidenceRails.config.slice(0, 4),
    });
  }

  for (const [index, incident] of (runtimeState.incidentLedger ?? [])
    .filter((entry) => entry.status !== "resolved")
    .slice(0, 6)
    .entries()) {
    const targetAgentIds = targetAgents.filter(
      (agentId) =>
        incident.linkedServiceIds.includes(agentId) ||
        incident.affectedSurfaces.some((surface) => surface.includes(agentId)),
    );
    const severity: ContradictionRecord["severity"] =
      incident.severity === "critical" ? "critical" : "warning";
    const rail = incident.truthLayer === "public" ? "publicProof" : "runtime";
    const status = incident.status === "active" ? "active" : "watching";
    const freshnessWeight = incident.status === "active" ? 50 : 30;
    contradictions.push({
      contradictionId: `runtime-${index + 1}`,
      entityId: buildContradictionEntityId(incident.summary ?? incident.incidentId),
      summary: incident.summary ?? incident.incidentId,
      severity,
      rail,
      status,
      recommendedTaskType:
        incident.remediationTaskType === "system-monitor" ? "system-monitor" : "qa-verification",
      freshnessWeight,
      rankScore: computeContradictionRankScore({
        severity,
        rail,
        status,
        evidenceCount:
          incident.truthLayer === "public"
            ? evidenceRails.publicProof.length
            : evidenceRails.runtime.length,
        targetAgentCount: targetAgentIds.length,
        freshnessWeight,
      }),
      targetAgentIds,
      evidence:
        incident.truthLayer === "public"
          ? evidenceRails.publicProof.slice(0, 4)
          : evidenceRails.runtime.slice(0, 4),
    });
  }

  if (workflowBlockers.totalStopSignals > 0) {
    const severity: ContradictionRecord["severity"] =
      workflowBlockers.proofStopSignals > 0 ? "critical" : "warning";
    const freshnessWeight = workflowBlockers.proofStopSignals > 0 ? 60 : 35;
    contradictions.push({
      contradictionId: "workflow-stop-signals",
      entityId: "workflow-stop-signals",
      summary: `${workflowBlockers.totalStopSignals} workflow stop signal(s) remain unresolved.`,
      severity,
      rail: "runtime",
      status: "active",
      recommendedTaskType: "qa-verification",
      freshnessWeight,
      rankScore: computeContradictionRankScore({
        severity,
        rail: "runtime",
        status: "active",
        evidenceCount: evidenceRails.runtime.length,
        targetAgentCount: targetAgents.length,
        freshnessWeight,
      }),
      targetAgentIds: [...targetAgents],
      evidence: evidenceRails.runtime.slice(0, 4),
    });
  }

  return contradictions
    .sort((left, right) => {
      if (right.rankScore !== left.rankScore) {
        return right.rankScore - left.rankScore;
      }
      return left.summary.localeCompare(right.summary);
    })
    .slice(0, 12);
}

function scoreDocForTarget(args: {
  doc: ProcessedDocSummary;
  agentId: string;
  contradictionLedger: ContradictionRecord[];
}) {
  const searchable = `${args.doc.path} ${args.doc.summary} ${args.doc.firstHeading ?? ""}`.toLowerCase();
  let score = args.doc.source === "openclaw" ? 4 : 2;
  if (searchable.includes(args.agentId.toLowerCase())) score += 8;
  for (const contradiction of args.contradictionLedger) {
    if (searchable.includes(contradiction.entityId.toLowerCase())) score += 5;
    if (searchable.includes(contradiction.rail.toLowerCase())) score += 2;
  }
  return score;
}

async function loadTargetAgentTopology(
  agentId: string,
  config: AgentConfig,
): Promise<TargetAgentConfigTopology | null> {
  const agentConfigPath = resolve(config.agentsRootPath || "", agentId, "agent.config.json");
  try {
    const raw = await readFile(agentConfigPath, "utf-8");
    const parsed = JSON.parse(raw) as TargetAgentConfigTopology;
    return parsed;
  } catch {
    return null;
  }
}

async function buildTopologySignals(args: {
  agentId: string;
  config: AgentConfig;
  runtimeState: RuntimeState;
}): Promise<string[]> {
  const topologySignals = [
    ...(args.runtimeState.relationshipObservations ?? [])
      .filter(
        (relationship) =>
          relationship.from === `agent:${args.agentId}` || relationship.to === `agent:${args.agentId}`,
      )
      .slice(0, 3)
      .map(
        (relationship) =>
          `${relationship.from}->${relationship.to}:${relationship.relationship}`,
      ),
    ...(args.runtimeState.workflowEvents ?? [])
      .filter((event) => {
        const searchable = `${event.runId ?? ""} ${event.stage ?? ""} ${event.status ?? ""}`.toLowerCase();
        return searchable.includes(args.agentId.toLowerCase());
      })
      .slice(0, 2)
      .map((event) => `workflow:${event.stage ?? "unknown"}:${event.status ?? "unknown"}`),
  ];

  const agentTopology = await loadTargetAgentTopology(args.agentId, args.config);
  if (agentTopology) {
    if (agentTopology.orchestratorTask) {
      topologySignals.push(`task-route:${agentTopology.orchestratorTask}`);
    }
    if (agentTopology.serviceStatePath) {
      topologySignals.push(`service-state:${agentTopology.serviceStatePath}`);
    }
    if (agentTopology.orchestratorStatePath) {
      topologySignals.push(`runtime-state:${agentTopology.orchestratorStatePath}`);
    }
    if (agentTopology.docsPath) {
      topologySignals.push(`docs-root:${agentTopology.docsPath}`);
    }
    if (agentTopology.cookbookPath) {
      topologySignals.push(`cookbook-root:${agentTopology.cookbookPath}`);
    }
  }

  if (args.config.orchestratorConfigPath) {
    topologySignals.push(`orchestrator-config:${relative(workspaceRoot, args.config.orchestratorConfigPath)}`);
  }
  if (args.config.stateFile) {
    topologySignals.push(`state-file:${relative(workspaceRoot, args.config.stateFile)}`);
  }

  return Array.from(new Set(topologySignals)).slice(0, 8);
}

async function buildFreshnessSignals(args: {
  sortedDocs: ProcessedDocSummary[];
  runtimeState: RuntimeState;
  configAudit: ConfigAudit;
}): Promise<string[]> {
  const milestoneProof = summarizeRuntimeProofSurface(args.runtimeState, "milestone");
  const demandProof = summarizeRuntimeProofSurface(args.runtimeState, "demandSummary");
  const freshnessSignals = [
    `runtime-updated:${args.runtimeState.updatedAt ?? "unknown"}`,
    `config-audited:${args.configAudit.checkedAt}`,
    `task-observed:${summarizeTaskExecutions(args.runtimeState.taskExecutions ?? []).lastHandledAt ?? "unknown"}`,
    `milestone-proof:${milestoneProof.latestDeliveredAt ?? "none"}`,
    `demand-proof:${demandProof.latestDeliveredAt ?? "none"}`,
  ];

  const docSignals = await Promise.all(
    args.sortedDocs.slice(0, 3).map(async (doc) => {
      try {
        const fileStat = await stat(doc.absolutePath);
        const ageMs = Date.now() - fileStat.mtimeMs;
        const freshness =
          ageMs > 7 * 24 * 60 * 60 * 1000
            ? "stale"
            : ageMs > 24 * 60 * 60 * 1000
              ? "aging"
              : "fresh";
        return `doc:${doc.path}:${freshness}:${new Date(fileStat.mtimeMs).toISOString()}`;
      } catch {
        return `doc:${doc.path}:unreadable`;
      }
    }),
  );

  return [...freshnessSignals, ...docSignals];
}

function buildEntityFreshnessLedger(args: {
  contradictionLedger: ContradictionRecord[];
  freshnessSignals: string[];
}): EntityFreshnessEntry[] {
  const freshnessByEntity = new Map<
    string,
    { freshness: EntityFreshnessEntry["freshness"]; updatedAt: string | null; evidence: string[] }
  >();

  for (const signal of args.freshnessSignals) {
    if (signal.startsWith("doc:")) {
      const [, docPath, freshness, updatedAt] = signal.split(":");
      freshnessByEntity.set(docPath, {
        freshness:
          freshness === "fresh" || freshness === "aging" || freshness === "stale"
            ? freshness
            : "unknown",
        updatedAt: updatedAt ?? null,
        evidence: [signal],
      });
      continue;
    }

    if (signal.startsWith("runtime-updated:")) {
      const updatedAt = signal.slice("runtime-updated:".length) || null;
      freshnessByEntity.set("runtime-state", {
        freshness: updatedAt ? "fresh" : "unknown",
        updatedAt,
        evidence: [signal],
      });
      continue;
    }

    if (signal.startsWith("milestone-proof:") || signal.startsWith("demand-proof:")) {
      const updatedAt = signal.split(":").slice(1).join(":") || null;
      const entityId = signal.startsWith("milestone-proof:")
        ? "proof:milestone"
        : "proof:demandSummary";
      freshnessByEntity.set(entityId, {
        freshness:
          updatedAt && updatedAt !== "none"
            ? "fresh"
            : "stale",
        updatedAt: updatedAt && updatedAt !== "none" ? updatedAt : null,
        evidence: [signal],
      });
    }
  }

  return Array.from(
    args.contradictionLedger.reduce<Map<string, EntityFreshnessEntry>>((entries, record) => {
      const existing = entries.get(record.entityId);
      const freshnessHint =
        freshnessByEntity.get(record.entityId) ??
        (record.rail === "runtime"
          ? freshnessByEntity.get("runtime-state")
          : record.rail === "publicProof"
            ? freshnessByEntity.get("proof:milestone") ?? freshnessByEntity.get("proof:demandSummary")
            : null);

      const nextEntry: EntityFreshnessEntry = {
        entityId: record.entityId,
        rail: record.rail,
        freshness: freshnessHint?.freshness ?? "unknown",
        updatedAt: freshnessHint?.updatedAt ?? null,
        contradictionCount: (existing?.contradictionCount ?? 0) + 1,
        targetAgentIds: Array.from(
          new Set([...(existing?.targetAgentIds ?? []), ...record.targetAgentIds]),
        ),
        evidence: Array.from(
          new Set([...(existing?.evidence ?? []), ...(freshnessHint?.evidence ?? []), ...record.evidence]),
        ).slice(0, 6),
      };

      entries.set(record.entityId, nextEntry);
      return entries;
    }, new Map()).values(),
  ).sort((left, right) => right.contradictionCount - left.contradictionCount);
}

function buildContradictionGraphSummary(args: {
  contradictionLedger: ContradictionRecord[];
  entityFreshnessLedger: EntityFreshnessEntry[];
  targetAgents: string[];
}): ContradictionGraphSummary {
  const freshnessByEntity = new Map(
    args.entityFreshnessLedger.map((entry) => [entry.entityId, entry]),
  );
  const byRail = (["code", "config", "runtime", "publicProof", "inference"] as const).map(
    (rail) => {
      const contradictions = args.contradictionLedger.filter((entry) => entry.rail === rail);
      const top = [...contradictions].sort((left, right) => right.rankScore - left.rankScore)[0];
      return {
        rail,
        contradictionCount: contradictions.length,
        topEntityId: top?.entityId ?? null,
        maxRankScore: top?.rankScore ?? 0,
      };
    },
  );
  const byTargetAgent = args.targetAgents.map((targetAgentId) => {
    const contradictions = args.contradictionLedger.filter(
      (entry) => entry.targetAgentIds.length === 0 || entry.targetAgentIds.includes(targetAgentId),
    );
    return {
      targetAgentId,
      contradictionCount: contradictions.length,
      staleEntityCount: contradictions.filter((entry) =>
        freshnessByEntity.get(entry.entityId)?.freshness === "stale",
      ).length,
    };
  });

  return {
    entityCount: new Set(args.contradictionLedger.map((entry) => entry.entityId)).size,
    rankedContradictionCount: args.contradictionLedger.filter((entry) => entry.rankScore > 0).length,
    byRail,
    byTargetAgent,
  };
}

async function buildTaskSpecificKnowledgeBundles(args: {
  targetAgents: string[];
  summaries: ProcessedDocSummary[];
  contradictionLedger: ContradictionRecord[];
  runtimeState: RuntimeState;
  evidenceRails: KnowledgeEvidenceRails;
  config: AgentConfig;
  configAudit: ConfigAudit;
}): Promise<TaskSpecificKnowledgeBundle[]> {
  return Promise.all(args.targetAgents.map(async (agentId) => {
    const sortedDocs = [...args.summaries]
      .sort((left, right) =>
        scoreDocForTarget({ doc: right, agentId, contradictionLedger: args.contradictionLedger }) -
        scoreDocForTarget({ doc: left, agentId, contradictionLedger: args.contradictionLedger }),
      );
    const relevantContradictions = args.contradictionLedger
      .filter((entry) => entry.targetAgentIds.length === 0 || entry.targetAgentIds.includes(agentId))
      .slice(0, 4);
    const runtimeSignals = (args.runtimeState.incidentLedger ?? [])
      .filter((incident) =>
        incident.linkedServiceIds.includes(agentId) ||
        incident.affectedSurfaces.some((surface) => surface.includes(agentId)),
      )
      .slice(0, 4)
      .map((incident) => incident.summary ?? incident.incidentId);
    const topologySignals = await buildTopologySignals({
      agentId,
      config: args.config,
      runtimeState: args.runtimeState,
    });
    const freshnessSignals = await buildFreshnessSignals({
      sortedDocs,
      runtimeState: args.runtimeState,
      configAudit: args.configAudit,
    });
    return {
      targetAgentId: agentId,
      primaryDocs: sortedDocs.slice(0, 4).map((doc) => doc.path),
      secondaryDocs: sortedDocs.slice(4, 8).map((doc) => doc.path),
      contradictionIds: relevantContradictions.map((entry) => entry.contradictionId),
      runtimeSignals,
      publicProofSignals: args.evidenceRails.publicProof.slice(0, 3),
      topologySignals,
      freshnessSignals,
    };
  }));
}

async function buildTopologyPacks(args: {
  targetAgents: string[];
  config: AgentConfig;
  runtimeState: RuntimeState;
}): Promise<TopologyPack[]> {
  return Promise.all(
    args.targetAgents.map(async (agentId) => {
      const topology = await loadTargetAgentTopology(agentId, args.config);
      const relationshipSignals = (args.runtimeState.relationshipObservations ?? [])
        .filter(
          (relationship) =>
            relationship.from === `agent:${agentId}` ||
            relationship.to === `agent:${agentId}`,
        )
        .slice(0, 4)
        .map(
          (relationship) =>
            `${relationship.from}->${relationship.to}:${relationship.relationship}`,
        );
      const workflowSignals = (args.runtimeState.workflowEvents ?? [])
        .filter((event) => {
          const searchable = `${event.runId ?? ""} ${event.stage ?? ""} ${event.status ?? ""}`.toLowerCase();
          return searchable.includes(agentId.toLowerCase());
        })
        .slice(0, 4)
        .map(
          (event) =>
            `${event.stage ?? "unknown"}:${event.status ?? "unknown"}:${event.stopCode ?? "none"}`,
        );
      const environmentSignals = [
        ...(topology?.serviceStatePath ? [`service-state:${topology.serviceStatePath}`] : []),
        ...(topology?.orchestratorStatePath
          ? [`runtime-state:${topology.orchestratorStatePath}`]
          : []),
        ...(topology?.docsPath ? [`docs-root:${topology.docsPath}`] : []),
        ...(topology?.cookbookPath ? [`cookbook-root:${topology.cookbookPath}`] : []),
        ...(args.config.orchestratorConfigPath
          ? [
              `orchestrator-config:${relative(workspaceRoot, args.config.orchestratorConfigPath)}`,
            ]
          : []),
        ...(args.config.stateFile
          ? [`state-file:${relative(workspaceRoot, args.config.stateFile)}`]
          : []),
      ];

      return {
        targetAgentId: agentId,
        routeTaskType: topology?.orchestratorTask ?? null,
        serviceStatePath: topology?.serviceStatePath ?? null,
        orchestratorStatePath: topology?.orchestratorStatePath ?? null,
        docsPath: topology?.docsPath ?? null,
        cookbookPath: topology?.cookbookPath ?? null,
        relationshipSignals,
        workflowSignals,
        environmentSignals: Array.from(new Set(environmentSignals)).slice(0, 8),
      };
    }),
  );
}

async function generateKnowledgePack(task: DriftRepairPayload, config: AgentConfig) {
  await telemetry.info("pack.start", { files: task.docPaths.length, useDualSources: !!config.cookbookPath });
  const configAudit = await runConfigAudit(task, config);
  const runtimeState = await loadRuntimeState<RuntimeState>(
    resolve(__dirname, "../agent.config.json"),
    config.stateFile ?? config.orchestratorStatePath,
  );
  const priorityIncidents = buildIncidentPriorityQueue(runtimeState.incidentLedger ?? []);
  const workflowBlockers = buildWorkflowBlockerSummary(runtimeState.workflowEvents ?? []);
  const targetedDocs =
    task.docPaths && task.docPaths.length > 0
      ? await collectDocSummaries(task.docPaths, config.docsPath)
      : [];
  const openclawDocs = await collectDocsFromPath(config.docsPath, "openclaw");
  const cookbookDocs = config.cookbookPath
    ? await collectDocsFromPath(config.cookbookPath, "openai")
    : [];
  const summaries = dedupeSummaries([
    ...targetedDocs,
    ...openclawDocs,
    ...cookbookDocs,
  ]);
  const evidenceRails = buildEvidenceRails({
    summaries,
    configAudit,
    runtimeState,
    workflowBlockers,
  });
  const contradictionLedger = buildContradictionLedger({
    configAudit,
    runtimeState,
    workflowBlockers,
    evidenceRails,
    targetAgents: task.targetAgents,
  });
  const taskSpecificKnowledge = await buildTaskSpecificKnowledgeBundles({
    targetAgents: task.targetAgents,
    summaries,
    contradictionLedger,
    runtimeState,
    evidenceRails,
    config,
    configAudit,
  });
  const topologyPacks = await buildTopologyPacks({
    targetAgents: task.targetAgents,
    config,
    runtimeState,
  });
  const freshnessSignals = Array.from(
    new Set(taskSpecificKnowledge.flatMap((entry) => entry.freshnessSignals ?? [])),
  );
  const entityFreshnessLedger = buildEntityFreshnessLedger({
    contradictionLedger,
    freshnessSignals,
  });
  const contradictionGraph = buildContradictionGraphSummary({
    contradictionLedger,
    entityFreshnessLedger,
    targetAgents: task.targetAgents,
  });

  await mkdir(config.knowledgePackDir, { recursive: true });
  const packId = `knowledge-pack-${Date.now()}`;
  const packPath = resolve(config.knowledgePackDir, `${packId}.json`);
  const payload = {
    id: packId,
    generatedAt: new Date().toISOString(),
    taskId: task.id,
    requestedBy: task.requestedBy,
    targetAgents: task.targetAgents,
    taskShape: {
      primaryTaskType: "drift-repair",
      requestedBy: task.requestedBy,
      targetAgents: task.targetAgents,
      targetedDocCount: task.docPaths.length,
      focusRails: Array.from(new Set(contradictionLedger.slice(0, 6).map((entry) => entry.rail))),
      priorityContradictionIds: contradictionLedger.slice(0, 6).map((entry) => entry.contradictionId),
    },
    configAudit,
    runtimeTruth: {
      generatedAt: new Date().toISOString(),
      taskExecutions: summarizeTaskExecutions(runtimeState.taskExecutions ?? []),
      openIncidentCount: (runtimeState.incidentLedger ?? []).filter(
        (incident) => incident.status !== "resolved",
      ).length,
      criticalIncidentCount: (runtimeState.incidentLedger ?? []).filter(
        (incident) => incident.status !== "resolved" && incident.severity === "critical",
      ).length,
      relationshipObservationCount: (runtimeState.relationshipObservations ?? []).length,
      proofDelivery: {
        milestone: summarizeRuntimeProofSurface(runtimeState, "milestone"),
        demandSummary: summarizeRuntimeProofSurface(runtimeState, "demandSummary"),
      },
    } satisfies RuntimeTruthSummary,
    incidentPacks: (runtimeState.incidentLedger ?? [])
      .filter((incident) => incident.status !== "resolved")
      .slice(0, 8)
      .map(
        (incident): IncidentPack => ({
          incidentId: incident.incidentId ?? "unknown-incident",
          severity: incident.severity ?? "warning",
          summary: incident.summary ?? "No runtime incident summary recorded.",
          affectedSurfaces: Array.isArray(incident.affectedSurfaces)
            ? incident.affectedSurfaces.slice(0, 6)
            : [],
          recommendedSteps: Array.isArray(incident.recommendedSteps)
            ? incident.recommendedSteps.slice(0, 4)
            : [],
        }),
      ),
    incidentPriorityQueue: priorityIncidents.slice(0, 8),
    evidenceRails,
    contradictionLedger,
    repairDrafts: buildRepairDrafts({
      targetAgents: task.targetAgents,
      runtimeState,
      configAudit,
      contradictionLedger,
    }),
    targetBriefs: task.targetAgents.map(
      (agentId): TargetBrief => ({
        agentId,
        objective: `Refresh ${agentId} with the latest repo, runtime, and proof-boundary knowledge pack.`,
        sourceFocus:
          config.cookbookPath && cookbookDocs.length > 0
            ? ["openclaw", "openai"]
            : ["openclaw"],
        contradictionFocus: [
          ...(configAudit.summary.criticalIssues > 0
            ? [`${configAudit.summary.criticalIssues} critical config audit issue(s)`]
            : []),
          ...((runtimeState.incidentLedger ?? [])
            .filter((incident) => incident.status !== "resolved")
            .slice(0, 2)
            .map((incident) => incident.summary ?? "runtime incident present")),
        ],
        suggestedActions: [
          "Review the latest knowledge pack before acting.",
          "Prefer runtime truth over stale docs when conflicts appear.",
          "Escalate unresolved contradictions back through drift-repair.",
        ],
        knowledgeBundle: taskSpecificKnowledge.find((entry) => entry.targetAgentId === agentId)
          ? {
              primaryDocs:
                taskSpecificKnowledge.find((entry) => entry.targetAgentId === agentId)?.primaryDocs ?? [],
              runtimeSignals:
                taskSpecificKnowledge.find((entry) => entry.targetAgentId === agentId)?.runtimeSignals ?? [],
              contradictionIds:
                taskSpecificKnowledge.find((entry) => entry.targetAgentId === agentId)?.contradictionIds ?? [],
              topologySignals:
                taskSpecificKnowledge.find((entry) => entry.targetAgentId === agentId)?.topologySignals ?? [],
              freshnessSignals:
                taskSpecificKnowledge.find((entry) => entry.targetAgentId === agentId)?.freshnessSignals ?? [],
            }
          : undefined,
      }),
    ),
    topologyPacks,
    taskSpecificKnowledge,
    freshnessSignals,
    entityFreshnessLedger,
    contradictionGraph,
    repairLoop: {
      status:
        configAudit.summary.criticalIssues > 0 ||
        (runtimeState.incidentLedger ?? []).some((incident) => incident.status !== "resolved")
          ? "repair-needed"
          : configAudit.summary.totalIssues > 0
            ? "watching"
            : "clear",
      recommendedTaskType:
        configAudit.summary.criticalIssues > 0 ? "drift-repair" : "qa-verification",
      contradictions: [
        ...contradictionLedger.slice(0, 6).map((issue) => issue.summary),
      ],
      staleSignals:
        [
          ...(runtimeState.incidentLedger ?? [])
            .filter((incident) => incident.status !== "resolved")
            .slice(0, 4)
            .map((incident) => incident.summary ?? "runtime signal present"),
          ...(workflowBlockers.latestStopCode
            ? [`workflow stop signal: ${workflowBlockers.latestStopCode}`]
            : []),
        ],
      nextActions:
        configAudit.summary.criticalIssues > 0
          ? [
              "Repair critical manifest/config drift first.",
              "Rebuild knowledge pack after drift repair completes.",
              "Run qa-verification against the affected agent surfaces.",
            ]
          : workflowBlockers.totalStopSignals > 0
            ? [
                "Inspect workflow stop signals and update the repair drafts.",
                "Route qa-verification over the affected workflow and relationship paths.",
                "Keep incident-linked knowledge packs fresh until stop signals clear.",
              ]
          : [
              "Keep knowledge pack current while runtime incidents remain open.",
              "Route high-signal contradictions into verifier review.",
            ],
    } satisfies RepairLoopSummary,
    relationships: task.targetAgents.map((agentId) => ({
      from: "agent:doc-specialist",
      to: `agent:${agentId}`,
      relationship: "feeds-agent",
      detail: `doc-specialist refreshed ${agentId} with pack ${packId}.`,
      evidence: [packId, `docs:${summaries.length}`],
      classification: "knowledge-distribution",
    })),
    toolInvocations: [
      {
        toolId: "documentParser",
        detail: "doc-specialist parsed docs, configs, and curated clue files into a knowledge pack.",
        evidence: [
          `docs:${summaries.length}`,
          `openclaw:${openclawDocs.length}`,
          `openai:${cookbookDocs.length}`,
        ],
        classification: "required",
      },
    ],
    docs: summaries,
  };
  const specialistFields = buildSpecialistOperatorFields({
    role: "Technical Writer",
    workflowStage:
      configAudit.summary.criticalIssues > 0
        ? "knowledge-pack-escalation"
        : payload.repairLoop.status === "clear"
          ? "knowledge-pack-closure"
          : "knowledge-pack-watch",
    deliverable:
      "knowledge pack with contradiction review, repair drafts, and downstream handoff guidance",
    status:
      configAudit.summary.criticalIssues > 0
        ? "escalate"
        : payload.repairLoop.status === "clear"
          ? "completed"
          : "watching",
    operatorSummary:
      `Knowledge pack ${packId} refreshed ${summaries.length} doc signal(s) for ${task.targetAgents.length} target agent(s) with ${payload.contradictionLedger.length} ranked contradiction(s) and repair loop status ${payload.repairLoop.status}.`,
    recommendedNextActions: [
      ...payload.repairLoop.nextActions.slice(0, 3),
      payload.repairDrafts[0]
        ? `Route ${payload.repairDrafts[0].handoff.recommendedTaskType} for ${payload.repairDrafts[0].targetAgentId} using the top repair draft.`
        : null,
    ],
    escalationReason:
      configAudit.summary.criticalIssues > 0
        ? "Escalate because critical config or manifest drift still weakens the trustworthiness of the refreshed knowledge pack."
        : null,
  });

  await writeFile(packPath, JSON.stringify(payload, null, 2), "utf-8");
  const retention = await enforceKnowledgePackRetention({
    directory: config.knowledgePackDir,
  });
  const sourceBreakdown = summaries.reduce((acc, doc) => {
    acc[doc.source] = (acc[doc.source] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  await telemetry.info("pack.complete", { 
    packPath, 
    docsProcessed: summaries.length,
    sourceBreakdown,
    configAuditIssues: configAudit.summary.totalIssues,
    configAuditCriticalIssues: configAudit.summary.criticalIssues,
    retention,
  });

  const resultFile = process.env.DOC_SPECIALIST_RESULT_FILE;
  if (resultFile) {
    await writeFile(
      resultFile,
      JSON.stringify(
        {
          packPath,
          packId,
          docsProcessed: summaries.length,
          sourceBreakdown,
          configAuditSummary: configAudit.summary,
          incidentPacks: payload.incidentPacks,
          incidentPriorityQueue: payload.incidentPriorityQueue,
          evidenceRails: payload.evidenceRails,
          contradictionLedger: payload.contradictionLedger,
          repairDrafts: payload.repairDrafts,
          targetBriefs: payload.targetBriefs,
          topologyPacks: payload.topologyPacks,
          taskSpecificKnowledge: payload.taskSpecificKnowledge,
          freshnessSignals: payload.freshnessSignals,
          entityFreshnessLedger: payload.entityFreshnessLedger,
          contradictionGraph: payload.contradictionGraph,
          repairLoop: payload.repairLoop,
          ...specialistFields,
          relationships: payload.relationships,
          toolInvocations: payload.toolInvocations,
          runtimeTruth: payload.runtimeTruth,
        },
        null,
        2
      ),
      "utf-8",
    );
  }

  return {
    packPath,
    packId,
    docsProcessed: summaries.length,
    sourceBreakdown,
    configAudit,
    incidentPacks: payload.incidentPacks,
    incidentPriorityQueue: payload.incidentPriorityQueue,
    evidenceRails: payload.evidenceRails,
    contradictionLedger: payload.contradictionLedger,
    repairDrafts: payload.repairDrafts,
    targetBriefs: payload.targetBriefs,
    topologyPacks: payload.topologyPacks,
    taskSpecificKnowledge: payload.taskSpecificKnowledge,
    freshnessSignals: payload.freshnessSignals,
    entityFreshnessLedger: payload.entityFreshnessLedger,
    contradictionGraph: payload.contradictionGraph,
    repairLoop: payload.repairLoop,
    ...specialistFields,
    relationships: payload.relationships,
    toolInvocations: payload.toolInvocations,
    runtimeTruth: payload.runtimeTruth,
  };
}

async function run() {
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

  const raw = await readFile(payloadPath, "utf-8");
  const task = JSON.parse(raw) as DriftRepairPayload;
  await telemetry.info("task.received", { id: task.id, files: task.docPaths.length });

  const config = await loadAgentConfig();
  const pack = await generateKnowledgePack(task, config);

  await telemetry.info("task.success", {
    id: task.id,
    packPath: pack.packPath,
    packId: pack.packId,
    docsProcessed: pack.docsProcessed,
    configAuditIssues: pack.configAudit.summary.totalIssues,
    configAuditCriticalIssues: pack.configAudit.summary.criticalIssues,
    openIncidents: pack.runtimeTruth.openIncidentCount,
    relationshipObservationCount: pack.runtimeTruth.relationshipObservationCount,
    targets: task.targetAgents,
    requestedBy: task.requestedBy,
  });
}

run().catch(async (error) => {
  await telemetry.error("task.failed", { message: (error as Error).message });
  process.exit(1);
});
