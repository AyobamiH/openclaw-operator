import { getExecuteSkill, resolveTaskExecuteSkill } from "../../shared/governed-readers.js";
import * as fs from 'fs';
import * as path from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { buildSpecialistOperatorFields } from '../../shared/runtime-evidence.js';


interface Task { id: string; type: string; input: any; schema: any; }
interface Result {
  success: boolean;
  normalized: any[];
  errors: any[];
  metrics: any;
  executionTime: number;
  canonicalRecords?: any[];
  uncertaintyFlags?: Array<{ recordIndex: number; field: string; reason: string }>;
  dedupeSummary?: {
    totalKeys: number;
    duplicateKeys: string[];
  };
  handoffPackage?: {
    targetAgentId: string;
    payloadType: 'canonical-dataset';
    canonicalIds: string[];
    comparisonReady: boolean;
  };
  comparisonReadiness?: {
    status: 'ready' | 'watching';
    duplicateKeyCount: number;
    uncertaintyCount: number;
    canonicalIdCount: number;
  };
  schemaMismatches?: Array<{
    recordIndex: number;
    unexpectedFields: string[];
    missingFields: string[];
  }>;
  dedupeDecisions?: Array<{
    dedupeKey: string;
    canonicalIds: string[];
    action: 'keep-distinct' | 'review-duplicate';
    rationale: string;
  }>;
  toolInvocations?: Array<{
    toolId: string;
    detail: string;
    evidence: string[];
    classification?: string;
  }>;
  operatorSummary?: string;
  recommendedNextActions?: string[];
  specialistContract?: {
    role: string;
    workflowStage: string;
    deliverable: string;
    status: 'completed' | 'watching' | 'blocked' | 'escalate' | 'refused';
    operatorSummary: string;
    recommendedNextActions: string[];
    refusalReason: string | null;
    escalationReason: string | null;
  };
}


function loadConfig(): any {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../agent.config.json'), 'utf-8'));
}

function canUseSkill(skillId: string): boolean {
  const config = loadConfig();
  return config.permissions.skills[skillId]?.allowed === true;
}

function normalizeSkillSchema(schema: any): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [
      key,
      typeof value === 'string' ? { type: value } : value,
    ]),
  );
}

function buildCanonicalRecord(record: any, schema: any, recordIndex: number) {
  const keys = Object.keys(record || {}).sort();
  const preferredId = typeof record?.id === 'string'
    ? record.id
    : typeof record?.name === 'string'
      ? record.name.toLowerCase().replace(/\s+/g, '-')
      : `record-${recordIndex + 1}`;
  return {
    canonicalId: preferredId,
    record,
    schemaFields: schema ? Object.keys(schema) : [],
    dedupeKey: `${preferredId}:${keys.join('|')}`,
  };
}

function collectUncertaintyFlags(record: any, schema: any, recordIndex: number) {
  if (!schema || Object.keys(schema).length === 0) {
    return [];
  }

  return Object.keys(schema)
    .filter((key) => record[key] === null || record[key] === undefined || record[key] === '')
    .map((key) => ({
      recordIndex,
      field: key,
      reason: 'schema field missing after normalization',
    }));
}

function buildSchemaMismatch(record: any, schema: any, recordIndex: number) {
  if (!schema || Object.keys(schema).length === 0) {
    return {
      recordIndex,
      unexpectedFields: [],
      missingFields: [],
    };
  }

  const schemaFields = Object.keys(schema);
  const recordFields = Object.keys(record || {});
  return {
    recordIndex,
    unexpectedFields: recordFields.filter((field) => !schemaFields.includes(field)),
    missingFields: schemaFields.filter((field) => !recordFields.includes(field)),
  };
}

function buildNormalizationSpecialistFields(args: {
  normalizedCount: number;
  errorCount: number;
  duplicateCount: number;
  uncertaintyCount: number;
  handoffPackage?: Result['handoffPackage'];
  statusOverride?: 'completed' | 'watching' | 'blocked' | 'escalate' | 'refused';
  refusalReason?: string | null;
}) {
  const status =
    args.statusOverride ??
    (args.errorCount > 0
      ? 'blocked'
      : args.duplicateCount > 0 || args.uncertaintyCount > 0
        ? 'watching'
        : 'completed');
  const workflowStage =
    status === 'refused'
      ? 'canonicalization-refusal'
      : status === 'blocked'
        ? 'canonicalization-blocked'
        : status === 'watching'
          ? 'canonicalization-review'
          : 'canonicalization-closure';
  return buildSpecialistOperatorFields({
    role: 'Data Consolidation Agent',
    workflowStage,
    deliverable: 'canonical dataset with uncertainty ledger, dedupe decisions, and downstream handoff guidance',
    status,
    operatorSummary:
      status === 'refused'
        ? 'Refused normalization because the governed normalizer or schema contract was unavailable.'
        : status === 'blocked'
          ? `Normalization did not reach safe closure; ${args.errorCount} error(s) interrupted canonicalization.`
          : `Canonicalized ${args.normalizedCount} record(s) with ${args.duplicateCount} duplicate key group(s) and ${args.uncertaintyCount} uncertainty flag(s).`,
    recommendedNextActions: [
      status === 'refused'
        ? 'Provide a governed schema contract and normalizer access before retrying normalization.'
        : null,
      args.duplicateCount > 0
        ? 'Review duplicate key groups before treating the canonical dataset as comparison-ready.'
        : null,
      args.uncertaintyCount > 0
        ? 'Resolve the remaining uncertainty flags or keep the dataset in operator-review posture.'
        : null,
      args.handoffPackage?.targetAgentId
        ? `Hand the canonical dataset to ${args.handoffPackage.targetAgentId} when downstream synthesis is needed.`
        : null,
    ],
    refusalReason:
      args.refusalReason ??
      (status === 'refused' ? 'Normalization could not proceed inside the governed schema boundary.' : null),
    escalationReason: null,
  });
}

async function handleTask(task: Task): Promise<Result> {
  const startTime = Date.now();

  if (!canUseSkill('normalizer')) {
    return {
      success: false,
      normalized: [],
      errors: ['Permission denied: normalizer skill'],
      metrics: {},
      ...buildNormalizationSpecialistFields({
        normalizedCount: 0,
        errorCount: 1,
        duplicateCount: 0,
        uncertaintyCount: 0,
        statusOverride: 'refused',
        refusalReason: 'normalizer permission is required before canonical normalization can begin.',
      }),
      executionTime: Date.now() - startTime,
    };
  }

  try {
    const executeSkill = resolveTaskExecuteSkill(task) ?? await getExecuteSkill();
    const input = Array.isArray(task.input) ? task.input : [task.input];
    const skillSchema = normalizeSkillSchema(task.schema);
    const normalized = await Promise.all(input.map(async (record: any) => {
      const normalizeResult = await executeSkill('normalizer', {
        data: record,
        schema: skillSchema,
        strict: false,
      }, 'normalization-agent');
      if (normalizeResult?.normalized && typeof normalizeResult.normalized === 'object') {
        return normalizeResult.normalized;
      }
      return normalizeRecord(record, task.schema);
    }));
    const errors = normalized.filter((r: any) => r.hasOwnProperty('_error')).map((r: any) => r._error);
    const clean = normalized.filter((r: any) => !r.hasOwnProperty('_error'));
    const canonicalRecords = clean.map((record: any, index: number) =>
      buildCanonicalRecord(record, task.schema, index),
    );
    const schemaMismatches = clean.map((record: any, index: number) =>
      buildSchemaMismatch(record, task.schema, index),
    );
    const uncertaintyFlags = clean.flatMap((record: any, index: number) =>
      collectUncertaintyFlags(record, task.schema, index),
    );
    const dedupeCounts = canonicalRecords.reduce<Record<string, number>>((counts, record) => {
      counts[record.dedupeKey] = (counts[record.dedupeKey] ?? 0) + 1;
      return counts;
    }, {});
    const duplicateKeys = Object.entries(dedupeCounts)
      .filter(([, count]) => count > 1)
      .map(([key]) => key);
    const dedupeGroups = canonicalRecords.reduce<Record<string, string[]>>((groups, record) => {
      groups[record.dedupeKey] = groups[record.dedupeKey] ?? [];
      groups[record.dedupeKey].push(record.canonicalId);
      return groups;
    }, {});
    const dedupeDecisions = Object.entries(dedupeGroups).map(([dedupeKey, canonicalIds]) => ({
      dedupeKey,
      canonicalIds,
      action: canonicalIds.length > 1 ? 'review-duplicate' as const : 'keep-distinct' as const,
      rationale:
        canonicalIds.length > 1
          ? 'Multiple normalized records resolved to the same dedupe key and require operator review.'
          : 'Canonical identifier and schema key stayed unique after normalization.',
    }));

    const result = {
      success: errors.length < input.length * 0.01, // <1% error rate
      normalized: clean,
      errors,
      metrics: {
        inputRecords: input.length,
        outputRecords: clean.length,
        errorRate: ((errors.length / input.length) * 100).toFixed(2) + '%',
        fieldsConsolidated: task.schema ? Math.max(0, Object.keys(input[0] || {}).length - Object.keys(task.schema).length) : 0,
        uncertaintyFlags: uncertaintyFlags.length,
        schemaMismatches: schemaMismatches.filter((entry) => entry.unexpectedFields.length > 0 || entry.missingFields.length > 0).length,
      },
      canonicalRecords,
      uncertaintyFlags,
      schemaMismatches,
      dedupeSummary: {
        totalKeys: canonicalRecords.length,
        duplicateKeys,
      },
      dedupeDecisions,
      handoffPackage: {
        targetAgentId: duplicateKeys.length > 0 ? 'doc-specialist' : 'summarization-agent',
        payloadType: 'canonical-dataset',
        canonicalIds: canonicalRecords.map((record) => record.canonicalId),
        comparisonReady: uncertaintyFlags.length === 0,
      },
      toolInvocations: [
        {
          toolId: 'normalizer',
          detail: `Normalized ${input.length} record(s) through the governed normalizer skill.`,
          evidence: [
            `records:${input.length}`,
            `schema-fields:${Object.keys(task.schema ?? {}).length}`,
            `duplicates:${duplicateKeys.length}`,
          ],
          classification: 'canonicalization',
        },
      ],
      comparisonReadiness: {
        status: duplicateKeys.length === 0 && uncertaintyFlags.length === 0 ? 'ready' : 'watching',
        duplicateKeyCount: duplicateKeys.length,
        uncertaintyCount: uncertaintyFlags.length,
        canonicalIdCount: canonicalRecords.length,
      },
      executionTime: Date.now() - startTime,
    };
    return {
      ...result,
      ...buildNormalizationSpecialistFields({
        normalizedCount: clean.length,
        errorCount: errors.length,
        duplicateCount: duplicateKeys.length,
        uncertaintyCount: uncertaintyFlags.length,
        handoffPackage: result.handoffPackage,
      }),
    };
  } catch (error) {
    return {
      success: false,
      normalized: [],
      errors: [(error as Error).message],
      metrics: {},
      ...buildNormalizationSpecialistFields({
        normalizedCount: 0,
        errorCount: 1,
        duplicateCount: 0,
        uncertaintyCount: 0,
        statusOverride: 'blocked',
      }),
      executionTime: Date.now() - startTime,
    };
  }
}

function normalizeRecord(record: any, schema: any): any {
  try {
    if (!schema || Object.keys(schema).length === 0) {
      return canonicalizeValue(record);
    }

    const normalized: any = {};
    for (const [key, type] of Object.entries(schema || {})) {
      const value = record[key];
      normalized[key] = convertType(value, type as string | Record<string, unknown>);
    }
    return normalized;
  } catch (error) {
    return { _error: `Failed to normalize: ${(error as Error).message}` };
  }
}

function canonicalizeValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeValue(entry));
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, canonicalizeValue(entry)]),
    );
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return value;
}

function convertType(value: any, type: string | Record<string, unknown>): any {
  if (value === null || value === undefined) return null;
  if (typeof type === 'object' && type !== null) {
    if ((type as any).type === 'array') {
      return Array.isArray(value) ? value.map((entry) => canonicalizeValue(entry)) : [canonicalizeValue(value)];
    }

    if ((type as any).type === 'object') {
      const shape = ((type as any).shape ?? {}) as Record<string, string | Record<string, unknown>>;
      return normalizeRecord(value, shape);
    }

    if (typeof (type as any).type === 'string') {
      return convertType(value, String((type as any).type));
    }
  }

  switch (type) {
    case 'string': return String(value);
    case 'number': return parseInt(value) || 0;
    case 'boolean': return value === true || value === 'true' || value === 1;
    case 'date': return new Date(value).toISOString();
    default: return value;
  }
}

async function main(): Promise<void> {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    return;
  }

  try {
    const payloadRaw = await readFile(payloadPath, 'utf-8');
    const taskInput = JSON.parse(payloadRaw) as Task;
    const result = await handleTask(taskInput);

    const resultFile = process.env.NORMALIZATION_AGENT_RESULT_FILE;
    if (resultFile) {
      await mkdir(path.dirname(resultFile), { recursive: true });
      await writeFile(resultFile, JSON.stringify(result, null, 2), 'utf-8');
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});

export { handleTask, loadConfig, canUseSkill };
