#!/usr/bin/env node
import { getExecuteSkill } from "../../shared/governed-readers.js";

/**
 * Data Extraction Agent - Entry Point
 * 
 * Extracts structured data from documents (PDF, HTML, CSV).
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

let agentConfig: AgentConfig;

function inferFormatFromPath(filePath: string): string {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith('.ipynb')) return 'ipynb';
  if (normalized.endsWith('.html') || normalized.endsWith('.htm')) return 'html';
  if (normalized.endsWith('.csv')) return 'csv';
  if (normalized.endsWith('.json')) return 'json';
  if (normalized.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/.test(normalized)) return 'image';
  if (/\.(mp3|wav|ogg|m4a|flac)$/.test(normalized)) return 'audio';
  if (/\.(mp4|mov|webm|avi|mkv)$/.test(normalized)) return 'video';
  return 'json';
}

function toStructuredExtraction(parseResult: any) {
  if (parseResult?.data && typeof parseResult.data === 'object') {
    return parseResult.data;
  }

  return {
    kind: 'document',
    format: parseResult?.format ?? 'unknown',
    blocks: Array.isArray(parseResult?.blocks) ? parseResult.blocks : [],
    tables: Array.isArray(parseResult?.tables) ? parseResult.tables : [],
    entities: Array.isArray(parseResult?.entities) ? parseResult.entities : [],
    metadata: parseResult?.metadata ?? {},
  };
}

function scoreExtractionConfidence(extracted: any) {
  const blockCount = Array.isArray(extracted?.blocks) ? extracted.blocks.length : 0;
  const tableCount = Array.isArray(extracted?.tables) ? extracted.tables.length : 0;
  const entityCount = Array.isArray(extracted?.entities) ? extracted.entities.length : 0;
  const rawScore = Math.min(0.98, 0.45 + blockCount * 0.03 + tableCount * 0.07 + entityCount * 0.05);
  return Number(rawScore.toFixed(2));
}

function buildProvenance(filePath: string, format: string) {
  return {
    sourcePath: filePath,
    format,
    extractedAt: new Date().toISOString(),
  };
}

function buildNormalizationHandoff(extracted: any, schema: any) {
  return {
    suggested: Boolean(schema && Object.keys(schema).length > 0),
    schemaFields: schema && typeof schema === 'object' ? Object.keys(schema) : [],
    entityCount: Array.isArray(extracted?.entities) ? extracted.entities.length : 0,
    tableCount: Array.isArray(extracted?.tables) ? extracted.tables.length : 0,
  };
}

function buildAdapterMode(format: string) {
  if (format === 'pdf' || format === 'html' || format === 'ipynb') return 'document-rich';
  if (format === 'csv' || format === 'json') return 'structured';
  if (format === 'image' || format === 'audio' || format === 'video') return 'binary-artifact';
  return 'inline';
}

function buildArtifactClass(format: string) {
  if (format === 'pdf' || format === 'html' || format === 'ipynb') return 'document';
  if (format === 'csv' || format === 'json') return 'structured';
  if (format === 'image' || format === 'audio' || format === 'video') return 'binary';
  return 'inline';
}

function parseInlineArtifactContent(format: string, content: string) {
  if (format === 'json') {
    try {
      return JSON.parse(content);
    } catch {
      return { raw: content };
    }
  }

  if (format === 'csv') {
    const [headerLine, ...rows] = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (!headerLine) return [];
    const headers = headerLine.split(',').map((header) => header.trim());
    return rows.map((row) => {
      const values = row.split(',').map((value) => value.trim());
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    });
  }

  const pairs = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(':'))
    .map((line) => {
      const [key, ...rest] = line.split(':');
      return [key.trim(), rest.join(':').trim()];
    });

  return Object.fromEntries(pairs);
}

function buildArtifactRecord(args: {
  sourceLabel: string;
  format: string;
  provenance: any;
  confidence: number;
  normalizationHandoff: any;
}) {
  return {
    source: args.sourceLabel,
    format: args.format,
    artifactClass: buildArtifactClass(args.format),
    adapterMode: buildAdapterMode(args.format),
    provenance: args.provenance,
    confidence: args.confidence,
    normalizationReady: args.normalizationHandoff?.suggested === true,
  };
}

function buildDataExtractionSpecialistFields(args: {
  sourceCount: number;
  successfulSources: number;
  failedSources: number;
  artifactCoverage?: {
    formats?: string[];
    normalizationReadyCount?: number;
    provenanceDepth?: string;
  };
  handoffTargets?: string[];
  statusOverride?: 'completed' | 'watching' | 'blocked' | 'escalate' | 'refused';
  refusalReason?: string | null;
}) {
  const status =
    args.statusOverride ??
    (args.failedSources > 0 || (args.artifactCoverage?.provenanceDepth ?? 'basic') !== 'strong'
      ? 'watching'
      : 'completed');
  const workflowStage =
    status === 'refused'
      ? 'artifact-refusal'
      : status === 'blocked'
        ? 'artifact-blocked'
        : status === 'watching'
          ? 'artifact-review'
          : 'artifact-closure';
  const formats = (args.artifactCoverage?.formats ?? []).join(', ') || 'mixed';
  return buildSpecialistOperatorFields({
    role: 'Data Extraction Specialist',
    workflowStage,
    deliverable: 'structured extraction package with provenance, confidence, and normalization handoff guidance',
    status,
    operatorSummary:
      status === 'refused'
        ? 'Refused extraction because the request or required governed parser input was incomplete.'
        : status === 'blocked'
          ? 'Extraction failed before a governed artifact package could be completed.'
          : `Processed ${args.sourceCount} source(s) across ${formats}; ${args.successfulSources} succeeded, ${args.failedSources} failed, and ${args.artifactCoverage?.normalizationReadyCount ?? 0} source(s) are normalization-ready.`,
    recommendedNextActions: [
      status === 'refused'
        ? 'Supply inline artifacts, a structured source payload, or parser-backed files before retrying the extraction lane.'
        : null,
      args.failedSources > 0
        ? 'Review the failed artifacts and rerun with a supported format or narrower parser request.'
        : null,
      (args.artifactCoverage?.normalizationReadyCount ?? 0) > 0
        ? 'Pass normalization-ready artifacts into normalize-data when canonical comparison matters.'
        : null,
      ...(args.handoffTargets ?? []).slice(0, 2).map((target) => `Hand the extraction package to ${target} when downstream synthesis is needed.`),
    ],
    refusalReason: args.refusalReason ?? (status === 'refused' ? 'No governed extraction input was supplied.' : null),
    escalationReason: null,
  });
}

async function loadConfig(): Promise<void> {
  try {
    const configContent = await fs.readFile(configPath, 'utf-8');
    agentConfig = JSON.parse(configContent);
    console.log(`[data-extraction] Configuration loaded`);
  } catch (error: any) {
    console.error('Failed to load agent config:', error.message);
    process.exit(1);
  }
}

function canUseSkill(skillId: string): boolean {
  const skillPerms = agentConfig.permissions.skills[skillId];
  return skillPerms && skillPerms.allowed === true;
}

async function handleTask(task: any): Promise<any> {
  if (!agentConfig) {
    await loadConfig();
  }

  const agentId = agentConfig.id;
  const taskId = task.id || 'unknown';
  const executeSkill = await getExecuteSkill();

  console.log(`[${agentId}] Starting task: ${taskId}`);

  try {
    const input = (task.input && typeof task.input === 'object')
      ? task.input
      : ((task.source && typeof task.source === 'object') ? task : null);

    if (!input || typeof input !== 'object') {
      return {
        taskId,
        success: false,
        error: 'Invalid input format',
        ...buildDataExtractionSpecialistFields({
          sourceCount: 0,
          successfulSources: 0,
          failedSources: 0,
          statusOverride: 'refused',
          refusalReason: 'Data extraction requests must include artifacts, files, or a structured source payload.',
        }),
      };
    }

    const results: any[] = [];
    const toolInvocations: Array<{
      toolId: string;
      detail: string;
      evidence: string[];
      classification: string;
    }> = [];

    if (input.artifacts && Array.isArray(input.artifacts)) {
      for (const artifact of input.artifacts) {
        const artifactFormat = String(artifact.format ?? artifact.type ?? 'inline');
        const extracted = parseInlineArtifactContent(artifactFormat, String(artifact.content ?? ''));
        const provenance = {
          sourceType: artifact.type ?? 'inline-artifact',
          format: artifactFormat,
          extractedAt: new Date().toISOString(),
        };
        const normalizationHandoff = buildNormalizationHandoff(extracted, input.schema || {});
        const confidence = Array.isArray(extracted)
          ? (extracted.length > 0 ? 0.74 : 0.42)
          : (Object.keys(extracted || {}).length > 0 ? 0.72 : 0.4);
        results.push({
          sourceType: provenance.sourceType,
          format: artifactFormat,
          extracted,
          provenance,
          confidence,
          normalizationHandoff,
          success: true,
        });
      }

      const artifactRecords = results.map((result, index) =>
        buildArtifactRecord({
          sourceLabel: `artifact-${index + 1}`,
          format: String(result.format ?? 'unknown'),
          provenance: result.provenance,
          confidence: result.confidence ?? 0,
          normalizationHandoff: result.normalizationHandoff,
        }),
      );

      return {
        taskId,
        success: true,
        agentId,
        results,
        artifactRecords,
        recordsExtracted: results.length,
        entitiesFound: results.reduce((count, result) => count + (Array.isArray(result.extracted) ? result.extracted.length : Object.keys(result.extracted || {}).length), 0),
        provenanceSummary: results.map((result) => result.provenance),
        handoffPackages: results.map((result, index) => ({
          targetAgentId: 'normalization-agent',
          payloadType: 'raw-extraction',
          source: `artifact-${index + 1}`,
          confidence: result.confidence ?? null,
        })),
        artifactCoverage: {
          formats: Array.from(new Set(results.map((result) => String(result.format ?? 'unknown')))),
          adapterModes: Array.from(new Set(results.map((result) => buildAdapterMode(String(result.format ?? 'unknown'))))),
          normalizationReadyCount: results.filter((result) => result.normalizationHandoff?.suggested === true).length,
          provenanceDepth: results.every((result) => result.provenance) ? 'strong' : 'basic',
        },
        completedAt: new Date().toISOString(),
        ...buildDataExtractionSpecialistFields({
          sourceCount: results.length,
          successfulSources: results.filter((result) => result.success !== false).length,
          failedSources: results.filter((result) => result.success === false).length,
          artifactCoverage: {
            formats: Array.from(new Set(results.map((result) => String(result.format ?? 'unknown')))),
            normalizationReadyCount: results.filter((result) => result.normalizationHandoff?.suggested === true).length,
            provenanceDepth: results.every((result) => result.provenance) ? 'strong' : 'basic',
          },
          handoffTargets: ['normalization-agent'],
        }),
      };
    }

    // Task: Parse documents
    if (input.files && Array.isArray(input.files)) {
      console.log(`[${agentId}] Parsing ${input.files.length} files`);

      for (const file of input.files) {
        if (!canUseSkill('documentParser')) {
          return {
            taskId,
            success: false,
            error: 'documentParser skill not allowed',
            ...buildDataExtractionSpecialistFields({
              sourceCount: input.files.length,
              successfulSources: 0,
              failedSources: input.files.length,
              statusOverride: 'refused',
              refusalReason: 'documentParser permission is required before parser-backed extraction can run.',
            }),
          };
        }

        const inferredFormat = file.format || inferFormatFromPath(String(file.path || ''));
        const parseResult = await executeSkill('documentParser', {
          filePath: file.path,
          format: inferredFormat,
          extractTables: true,
          extractEntities: true,
        }, agentId);

        if (parseResult.success) {
          toolInvocations.push({
            toolId: 'documentParser',
            detail: `Parsed ${String(file.path)} for structured extraction.`,
            evidence: [
              `file:${String(file.path)}`,
              `format:${String(inferredFormat)}`,
              `entities:${Array.isArray(parseResult.entities) ? parseResult.entities.length : 0}`,
            ],
            classification: 'artifact-extraction',
          });
          const extracted = toStructuredExtraction(parseResult);
          const confidence = scoreExtractionConfidence(extracted);
          const provenance = buildProvenance(file.path, inferredFormat);
          const normalizationHandoff = buildNormalizationHandoff(extracted, input.schema || {});
          // Optionally normalize extracted data
          if (canUseSkill('normalizer') && input.normalize) {
            const normalizeResult = await executeSkill('normalizer', {
              data: extracted,
              schema: input.schema || {},
              strict: false,
            }, agentId);
            if (normalizeResult?.success !== false) {
              toolInvocations.push({
                toolId: 'normalizer',
                detail: `Normalized extracted records from ${String(file.path)} against the requested schema.`,
                evidence: [
                  `file:${String(file.path)}`,
                  `schema-fields:${Object.keys(input.schema || {}).length}`,
                  `warnings:${Array.isArray(normalizeResult.warnings) ? normalizeResult.warnings.length : 0}`,
                ],
                classification: 'normalization-handoff',
              });
            }

            results.push({
              file: file.path,
              format: inferredFormat,
              parsed: extracted,
              provenance,
              confidence,
              normalizationHandoff,
              normalized: normalizeResult.normalized ?? normalizeResult.data ?? null,
              normalizationWarnings: normalizeResult.warnings ?? [],
              normalizationErrors: normalizeResult.errors ?? [],
              success: normalizeResult.success,
            });
          } else {
            results.push({
              file: file.path,
              format: inferredFormat,
              parsed: extracted,
              provenance,
              confidence,
              normalizationHandoff,
              success: true,
            });
          }
        } else {
          results.push({
            file: file.path,
            error: parseResult.error,
            success: false,
          });
        }
      }

      console.log(`[${agentId}] Task completed: ${taskId}`);
      const artifactCoverage = {
        formats: Array.from(new Set(results.map((result) => String(result.format ?? 'unknown')))),
        adapterModes: Array.from(new Set(results.map((result) => buildAdapterMode(String(result.format ?? 'unknown'))))),
        normalizationReadyCount: results.filter((result) => result.normalizationHandoff?.suggested === true).length,
        provenanceDepth: results.every((result) => result.provenance) ? 'strong' : 'basic',
      };
      return {
        taskId,
        success: true,
        agentId,
        results,
        artifactRecords: results.map((result) =>
          buildArtifactRecord({
            sourceLabel: result.file,
            format: String(result.format ?? 'unknown'),
            provenance: result.provenance,
            confidence: result.confidence ?? 0,
            normalizationHandoff: result.normalizationHandoff,
          }),
        ),
        recordsExtracted: results.length,
        entitiesFound: 0,
        provenanceSummary: results
          .filter((result) => result.provenance)
          .map((result) => result.provenance),
        handoffPackages: results.map((result) => ({
          targetAgentId: result.normalized ? 'doc-specialist' : 'normalization-agent',
          payloadType: result.normalized ? 'normalized-artifact' : 'raw-extraction',
          source: result.file,
          confidence: result.confidence ?? null,
        })),
        artifactCoverage,
        toolInvocations,
        completedAt: new Date().toISOString(),
        ...buildDataExtractionSpecialistFields({
          sourceCount: results.length,
          successfulSources: results.filter((result) => result.success !== false).length,
          failedSources: results.filter((result) => result.success === false).length,
          artifactCoverage,
          handoffTargets: Array.from(
            new Set(
              results.map((result) => (result.normalized ? 'doc-specialist' : 'normalization-agent')),
            ),
          ),
        }),
      };
    }

    if (input.source && typeof input.source === 'object') {
      const source = input.source as { type?: string; content?: string };
      const content = String(source.content ?? '');
      const pairs = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes(':'))
        .map((line) => {
          const [key, ...rest] = line.split(':');
          return [key.trim(), rest.join(':').trim()];
        });

      const extracted = Object.fromEntries(pairs);
      const provenance = {
        sourceType: source.type ?? 'inline',
        format: String(source.type ?? 'inline'),
        extractedAt: new Date().toISOString(),
      };
      const confidence = Object.keys(extracted).length > 0 ? 0.68 : 0.4;
      const normalizationHandoff = buildNormalizationHandoff(extracted, input.schema || {});
      return {
        taskId,
        success: true,
        agentId,
        results: [{
          sourceType: source.type ?? 'inline',
          extracted,
          provenance,
          confidence,
          normalizationHandoff,
        }],
        artifactRecords: [
          buildArtifactRecord({
            sourceLabel: provenance.sourceType,
            format: provenance.format,
            provenance,
            confidence,
            normalizationHandoff,
          }),
        ],
        recordsExtracted: Object.keys(extracted).length > 0 ? 1 : 0,
        entitiesFound: Object.keys(extracted).length,
        provenanceSummary: [provenance],
        handoffPackages: [
          {
            targetAgentId: 'normalization-agent',
            payloadType: 'raw-extraction',
            source: provenance.sourceType,
            confidence,
          },
        ],
        artifactCoverage: {
          formats: [String(source.type ?? 'inline')],
          adapterModes: ['inline'],
          normalizationReadyCount: 1,
          provenanceDepth: 'strong',
        },
        toolInvocations: [],
        completedAt: new Date().toISOString(),
        ...buildDataExtractionSpecialistFields({
          sourceCount: 1,
          successfulSources: 1,
          failedSources: 0,
          artifactCoverage: {
            formats: [String(source.type ?? 'inline')],
            normalizationReadyCount: 1,
            provenanceDepth: 'strong',
          },
          handoffTargets: ['normalization-agent'],
        }),
      };
    }

    return {
      taskId,
      success: false,
      error: 'No valid task input provided',
      ...buildDataExtractionSpecialistFields({
        sourceCount: 0,
        successfulSources: 0,
        failedSources: 0,
        statusOverride: 'refused',
        refusalReason: 'No valid extraction source was supplied to the governed data-extraction lane.',
      }),
    };
  } catch (error: any) {
    console.error(`[${agentId}] Error in task ${taskId}:`, error.message);
    return {
      taskId,
      success: false,
      error: error.message,
      agentId,
      ...buildDataExtractionSpecialistFields({
        sourceCount: 0,
        successfulSources: 0,
        failedSources: 0,
        statusOverride: 'blocked',
      }),
    };
  }
}

async function main(): Promise<void> {
  console.log('[data-extraction] Agent starting...');

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
      if (process.env.DATA_EXTRACTION_AGENT_RESULT_FILE) {
        const resultDir = path.dirname(process.env.DATA_EXTRACTION_AGENT_RESULT_FILE);
        await fs.mkdir(resultDir, { recursive: true });
        await fs.writeFile(process.env.DATA_EXTRACTION_AGENT_RESULT_FILE, JSON.stringify(result, null, 2), 'utf-8');
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
