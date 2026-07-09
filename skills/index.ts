/**
 * Skills Registry & Loader
 * 
 * Loads all skills and validates them against the audit gate.
 * Tracks skill metadata and enforces permission checking at runtime.
 */

import {
  SkillDefinition as RuntimeSkillDefinition,
  SkillResult,
} from '../orchestrator/src/skills/types.js';
import { sourceFetchDefinition, executeSourceFetch } from './sourceFetch.js';
import { documentParserDefinition, executeDocumentParser } from './documentParser.js';
import { normalizerDefinition, executeNormalizer } from './normalizer.js';
import { workspacePatchDefinition, executeWorkspacePatch } from './workspacePatch.js';
import { testRunnerDefinition, executeTestRunner } from './testRunner.js';
import { runtimeStateReaderDefinition, executeRuntimeStateReader } from './runtimeStateReader.js';
import { serviceStateReaderDefinition, executeServiceStateReader } from './serviceStateReader.js';
import { repoFileReaderDefinition, executeRepoFileReader } from './repoFileReader.js';
import { knowledgePackReaderDefinition, executeKnowledgePackReader } from './knowledgePackReader.js';
import { getToolGate } from '../orchestrator/src/toolGate.js';
import { auditSkill } from '../orchestrator/src/skillAudit.js';
import { loadConfig } from '../orchestrator/src/config.js';
import { loadState, saveStateWithOptions } from '../orchestrator/src/state.js';
import type {
  GovernedSkillPersistenceMode,
  SkillDefinition as AuditedSkillDefinition,
  PersistedGovernedSkillExecutorBinding,
  PersistedGovernedSkillRecord,
} from '../orchestrator/src/types.js';

type SkillExecutor = (input: any) => Promise<any>;
type SkillRegistrationMode = 'builtin-bootstrap' | 'governed-intake';
type GovernedSkillSource = 'generated' | 'imported' | 'manual';
type SkillTrustStatus = 'builtin-trusted' | 'pending-review' | 'review-approved';
type BuiltinDurabilityMode = 'builtin-runtime';

interface GovernedSkillStateStore {
  load(): Promise<PersistedGovernedSkillRecord[]>;
  save(records: PersistedGovernedSkillRecord[]): Promise<void>;
}

interface SkillProvenanceSnapshot {
  author: string;
  source: string;
  version: string;
}

// Skill registry: maps skill ID to definition + executor
export interface RegisteredSkill {
  definition: RuntimeSkillDefinition;
  executor: SkillExecutor;
  auditedAt: string;
  auditPassed: boolean;
  registrationMode: SkillRegistrationMode;
  intakeSource: 'builtin' | GovernedSkillSource;
  trustStatus: SkillTrustStatus;
  registeredBy?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  provenanceSnapshot: SkillProvenanceSnapshot;
  durabilityMode: BuiltinDurabilityMode | GovernedSkillPersistenceMode;
}

interface GovernedSkillRegistration {
  definition: RuntimeSkillDefinition;
  executor?: SkillExecutor;
  auditedAt: string;
  intakeSource: GovernedSkillSource;
  registeredBy?: string;
  trustStatus: 'pending-review' | 'review-approved';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  provenanceSnapshot: SkillProvenanceSnapshot;
  persistenceMode: GovernedSkillPersistenceMode;
  executorBinding?: PersistedGovernedSkillExecutorBinding;
}

const skillExecutors: Record<string, SkillExecutor> = {
  sourceFetch: executeSourceFetch,
  documentParser: executeDocumentParser,
  normalizer: executeNormalizer,
  workspacePatch: executeWorkspacePatch,
  testRunner: executeTestRunner,
  runtimeStateReader: executeRuntimeStateReader,
  serviceStateReader: executeServiceStateReader,
  repoFileReader: executeRepoFileReader,
  knowledgePackReader: executeKnowledgePackReader,
};

const skillDefinitions: Record<string, RuntimeSkillDefinition> = {
  sourceFetch: sourceFetchDefinition,
  documentParser: documentParserDefinition,
  normalizer: normalizerDefinition,
  workspacePatch: workspacePatchDefinition,
  testRunner: testRunnerDefinition,
  runtimeStateReader: runtimeStateReaderDefinition,
  serviceStateReader: serviceStateReaderDefinition,
  repoFileReader: repoFileReaderDefinition,
  knowledgePackReader: knowledgePackReaderDefinition,
};

/**
 * Global skill registry - internal only.
 *
 * Built-in skills become executable through:
 * - the explicit/manual initializeSkills() bootstrap path, or
 * - lazy bootstrap on the first executeSkill() call.
 *
 * Generated/imported skills do not become executable on the normal executeSkill
 * path unless they are explicitly registered through registerGovernedSkill().
 */
const skillRegistry: Map<string, RegisteredSkill> = new Map();
const governedSkillEntries: Map<string, GovernedSkillRegistration> = new Map();

let bootstrapPromise: Promise<void> | null = null;
let governedSkillStateLoaded = false;
let orchestratorConfigPromise: Promise<Awaited<ReturnType<typeof loadConfig>>> | null = null;
let governedSkillStateStoreOverride: GovernedSkillStateStore | null = null;

function countExecutableApprovedGovernedSkills(): number {
  return Array.from(governedSkillEntries.values())
    .filter((registration) => registration.trustStatus === 'review-approved' && typeof registration.executor === 'function')
    .length;
}

function resolveBuiltinExecutorBinding(
  executor: SkillExecutor,
): PersistedGovernedSkillExecutorBinding | undefined {
  for (const [skillId, builtinExecutor] of Object.entries(skillExecutors)) {
    if (builtinExecutor === executor) {
      return {
        type: 'builtin-skill',
        skillId,
      };
    }
  }

  return undefined;
}

function resolveExecutorFromBinding(
  binding?: PersistedGovernedSkillExecutorBinding,
): SkillExecutor | undefined {
  if (!binding) {
    return undefined;
  }

  if (binding.type !== 'builtin-skill') {
    return undefined;
  }

  return skillExecutors[binding.skillId];
}

async function getOrchestratorConfig() {
  if (!orchestratorConfigPromise) {
    orchestratorConfigPromise = loadConfig();
  }

  return orchestratorConfigPromise;
}

const defaultGovernedSkillStateStore: GovernedSkillStateStore = {
  async load(): Promise<PersistedGovernedSkillRecord[]> {
    const config = await getOrchestratorConfig();
    const state = await loadState(config.stateFile, {
      taskHistoryLimit: config.taskHistoryLimit,
    });
    return state.governedSkillState ?? [];
  },
  async save(records: PersistedGovernedSkillRecord[]): Promise<void> {
    const config = await getOrchestratorConfig();
    const state = await loadState(config.stateFile, {
      taskHistoryLimit: config.taskHistoryLimit,
    });
    state.governedSkillState = records;
    await saveStateWithOptions(config.stateFile, state, {
      taskHistoryLimit: config.taskHistoryLimit,
    });
  },
};

function getGovernedSkillStateStore(): GovernedSkillStateStore {
  return governedSkillStateStoreOverride ?? defaultGovernedSkillStateStore;
}

function expectedRegisteredSkillCount(): number {
  return Object.keys(skillDefinitions).length + countExecutableApprovedGovernedSkills();
}

function isSkillBootstrapComplete(): boolean {
  if (skillRegistry.size < expectedRegisteredSkillCount()) {
    return false;
  }

  const builtinsLoaded = Object.keys(skillDefinitions).every((skillId) => skillRegistry.has(skillId));
  if (!builtinsLoaded) {
    return false;
  }

  return Array.from(governedSkillEntries.entries())
    .filter(([, registration]) => registration.trustStatus === 'review-approved')
    .every(([skillId]) => skillRegistry.has(skillId));
}

function createProvenanceSnapshot(definition: RuntimeSkillDefinition): SkillProvenanceSnapshot {
  return {
    author: definition.provenance.author,
    source: definition.provenance.source,
    version: definition.provenance.version,
  };
}

function toAuditedSkillDefinition(
  definition: RuntimeSkillDefinition,
): AuditedSkillDefinition {
  return {
    id: definition.id,
    name: definition.id,
    description: definition.description,
    provenance: {
      source: definition.provenance.source,
      version: definition.provenance.version,
      license: definition.provenance.license,
      maintainedAt: definition.provenance.maintainedAt,
    },
    permissions: {
      fileRead: definition.permissions.fileRead,
      fileWrite: definition.permissions.fileWrite,
      networkAllowed: definition.permissions.networkAllowed,
      execAllowed: definition.permissions.execAllowed,
      eval: definition.permissions.eval,
      spawn: definition.permissions.spawn,
      secrets: definition.permissions.secrets,
    },
    inputs: definition.inputs,
    outputs: definition.outputs,
  };
}

function hasReviewableProvenance(provenance: SkillProvenanceSnapshot): boolean {
  return [provenance.author, provenance.source, provenance.version]
    .every((value) => typeof value === 'string' && value.trim().length > 0);
}

function serializeGovernedSkillState(): PersistedGovernedSkillRecord[] {
  return Array.from(governedSkillEntries.entries()).map(([skillId, registration]) => ({
    skillId,
    definition: registration.definition,
    auditedAt: registration.auditedAt,
    intakeSource: registration.intakeSource,
    registeredBy: registration.registeredBy,
    trustStatus: registration.trustStatus,
    reviewedBy: registration.reviewedBy,
    reviewedAt: registration.reviewedAt,
    reviewNote: registration.reviewNote,
    provenanceSnapshot: registration.provenanceSnapshot,
    persistenceMode: registration.persistenceMode,
    executorBinding: registration.executorBinding,
  }));
}

async function persistGovernedSkillState(): Promise<void> {
  try {
    await getGovernedSkillStateStore().save(serializeGovernedSkillState());
  } catch (error: any) {
    console.warn(`[Skills] Failed to persist governed skill state: ${error?.message ?? error}`);
  }
}

async function loadGovernedSkillState(): Promise<void> {
  if (governedSkillStateLoaded) {
    return;
  }

  governedSkillStateLoaded = true;

  try {
    const records = await getGovernedSkillStateStore().load();

    for (const record of records) {
      if (!record?.skillId || !record.definition) {
        continue;
      }

      governedSkillEntries.set(record.skillId, {
        definition: record.definition,
        executor: resolveExecutorFromBinding(record.executorBinding),
        auditedAt: record.auditedAt,
        intakeSource: record.intakeSource,
        registeredBy: record.registeredBy,
        trustStatus: record.trustStatus,
        reviewedBy: record.reviewedBy,
        reviewedAt: record.reviewedAt,
        reviewNote: record.reviewNote,
        provenanceSnapshot: record.provenanceSnapshot,
        persistenceMode: record.persistenceMode,
        executorBinding: record.executorBinding,
      });
    }
  } catch (error: any) {
    console.warn(`[Skills] Failed to load governed skill state: ${error?.message ?? error}`);
  }
}

function registerSkillRecord(
  skillId: string,
  definition: RuntimeSkillDefinition,
  executor: SkillExecutor,
  registrationMode: SkillRegistrationMode,
  auditedAt: string,
  intakeSource: 'builtin' | GovernedSkillSource,
  trustStatus: SkillTrustStatus,
  provenanceSnapshot: SkillProvenanceSnapshot,
  registeredBy?: string,
  reviewedBy?: string,
  reviewedAt?: string,
  reviewNote?: string,
  durabilityMode: BuiltinDurabilityMode | GovernedSkillPersistenceMode = 'builtin-runtime',
): void {
  skillRegistry.set(skillId, {
    definition,
    executor,
    auditedAt,
    auditPassed: true,
    registrationMode,
    intakeSource,
    trustStatus,
    registeredBy,
    reviewedBy,
    reviewedAt,
    reviewNote,
    provenanceSnapshot,
    durabilityMode,
  });
}

/**
 * Initialize and load all skills
 * Validates each skill against audit gate before registration
 */
export async function initializeSkills(): Promise<void> {
  await loadGovernedSkillState();

  if (isSkillBootstrapComplete()) {
    return;
  }

  for (const [skillId, definition] of Object.entries(skillDefinitions)) {
    const executor = skillExecutors[skillId];

    if (!executor) {
      console.error(`[Skills] No executor found for skill ${skillId}`);
      continue;
    }

      try {
        // Run audit gate on skill
        const auditResult = auditSkill(toAuditedSkillDefinition(definition));
        const auditedDefinition: RuntimeSkillDefinition = {
          ...definition,
          audit: auditResult,
        };

        if (!auditResult.passed) {
          console.error(`[Skills] Audit failed for ${skillId}:`, {
            riskFlags: auditResult.riskFlags,
            failedChecks: auditResult.checks
            .filter((check) => check.status === 'fail')
            .map((check) => check.name),
        });
          continue;
        }

        registerSkillRecord(
          skillId,
          auditedDefinition,
          executor,
          'builtin-bootstrap',
          auditResult.runAt,
          'builtin',
          'builtin-trusted',
          createProvenanceSnapshot(auditedDefinition),
        );

        console.log(`[Skills] ✓ Registered ${skillId} v${definition.version}`);
      } catch (error: any) {
        console.error(`[Skills] Error auditing ${skillId}:`, error.message);
      }
    }

    for (const [skillId, registration] of governedSkillEntries.entries()) {
      if (registration.trustStatus !== 'review-approved' || typeof registration.executor !== 'function') {
        continue;
      }

      registerSkillRecord(
        skillId,
        registration.definition,
        registration.executor,
        'governed-intake',
        registration.auditedAt,
        registration.intakeSource,
        registration.trustStatus,
        registration.provenanceSnapshot,
        registration.registeredBy,
        registration.reviewedBy,
        registration.reviewedAt,
        registration.reviewNote,
        registration.persistenceMode,
      );
    }

  console.log(`[Skills] Initialization complete: ${skillRegistry.size}/${expectedRegisteredSkillCount()} skills loaded`);
}

async function ensureSkillsInitialized(): Promise<void> {
  if (isSkillBootstrapComplete()) {
    return;
  }

  if (!bootstrapPromise) {
    bootstrapPromise = initializeSkills().finally(() => {
      bootstrapPromise = null;
    });
  }

  await bootstrapPromise;
}

/**
 * Register a generated or imported skill through the governed intake path.
 *
 * This is the only supported path for non-built-in skills to enter the normal
 * skill path. Registration stages the skill in pending review; a separate
 * explicit approval step is required before it becomes executable on the
 * normal executeSkill() surface.
 */
export async function registerGovernedSkill(
  definition: RuntimeSkillDefinition,
  executor: SkillExecutor,
  options?: {
    intakeSource?: GovernedSkillSource;
    registeredBy?: string;
    reviewNote?: string;
  },
): Promise<{
  success: boolean;
  data?: {
    skillId: string;
    registrationMode: 'governed-intake';
    intakeSource: GovernedSkillSource;
    trustStatus: 'pending-review';
    executable: false;
  };
  error?: string;
}> {
  await ensureSkillsInitialized();

  if (!definition?.id || typeof definition.id !== 'string' || definition.id.trim().length === 0) {
    return {
      success: false,
      error: 'Skill id is required for governed registration',
    };
  }

  if (typeof executor !== 'function') {
    return {
      success: false,
      error: 'Governed skill registration requires an executor function',
    };
  }

  const skillId = definition.id.trim();

  if (Object.prototype.hasOwnProperty.call(skillDefinitions, skillId)) {
    return {
      success: false,
      error: `Built-in skill ids cannot be overridden: ${skillId}`,
    };
  }

  if (governedSkillEntries.has(skillId)) {
    return {
      success: false,
      error: `Governed skill already registered: ${skillId}`,
    };
  }

  const auditResult = auditSkill(toAuditedSkillDefinition(definition));
  if (!auditResult.passed) {
    return {
      success: false,
      error: `Skill audit failed for governed registration: ${skillId}`,
    };
  }

  const auditedDefinition: RuntimeSkillDefinition = {
    ...definition,
    audit: auditResult,
  };

  const intakeSource = options?.intakeSource ?? 'manual';
  const provenanceSnapshot = createProvenanceSnapshot(auditedDefinition);
  const executorBinding = resolveBuiltinExecutorBinding(executor);
  const registration: GovernedSkillRegistration = {
    definition: auditedDefinition,
    executor,
    auditedAt: auditResult.runAt,
    intakeSource,
    registeredBy: options?.registeredBy,
    trustStatus: 'pending-review',
    reviewNote: options?.reviewNote,
    provenanceSnapshot,
    persistenceMode: executorBinding ? 'restart-safe' : 'metadata-only',
    executorBinding,
  };

  governedSkillEntries.set(skillId, registration);
  await persistGovernedSkillState();

  return {
    success: true,
    data: {
      skillId,
      registrationMode: 'governed-intake',
      intakeSource,
      trustStatus: 'pending-review',
      executable: false,
    },
  };
}

/**
 * Approve a governed skill after explicit review so it can become executable on
 * the normal executeSkill() surface.
 */
export async function approveGovernedSkill(
  skillId: string,
  reviewedBy: string,
  reviewNote?: string,
): Promise<{
  success: boolean;
  data?: {
    skillId: string;
    trustStatus: 'review-approved';
    executable: true;
  };
  error?: string;
}> {
  await ensureSkillsInitialized();

  const normalizedSkillId = typeof skillId === 'string' ? skillId.trim() : '';
  if (!normalizedSkillId) {
    return {
      success: false,
      error: 'Skill id is required for governed approval',
    };
  }

  const normalizedReviewer = typeof reviewedBy === 'string' ? reviewedBy.trim() : '';
  if (!normalizedReviewer) {
    return {
      success: false,
      error: 'Governed skill approval requires reviewedBy',
    };
  }

  const registration = governedSkillEntries.get(normalizedSkillId);
  if (!registration) {
    return {
      success: false,
      error: `Governed skill not found: ${normalizedSkillId}`,
    };
  }

  if (!hasReviewableProvenance(registration.provenanceSnapshot)) {
    return {
      success: false,
      error: `Governed skill approval requires reviewable provenance: ${normalizedSkillId}`,
    };
  }

  if (typeof registration.executor !== 'function') {
    return {
      success: false,
      error: `Governed skill approval requires a runtime executor binding: ${normalizedSkillId}`,
    };
  }

  if (registration.trustStatus === 'review-approved') {
    return {
      success: true,
      data: {
        skillId: normalizedSkillId,
        trustStatus: 'review-approved',
        executable: true,
      },
    };
  }

  registration.trustStatus = 'review-approved';
  registration.reviewedBy = normalizedReviewer;
  registration.reviewedAt = new Date().toISOString();
  registration.reviewNote = reviewNote;
  await persistGovernedSkillState();

  registerSkillRecord(
    normalizedSkillId,
    registration.definition,
    registration.executor,
    'governed-intake',
    registration.auditedAt,
    registration.intakeSource,
    registration.trustStatus,
    registration.provenanceSnapshot,
    registration.registeredBy,
    registration.reviewedBy,
    registration.reviewedAt,
    registration.reviewNote,
    registration.persistenceMode,
  );

  return {
    success: true,
    data: {
      skillId: normalizedSkillId,
      trustStatus: 'review-approved',
      executable: true,
    },
  };
}

/**
 * Execute a skill by ID with permission checking
 */
export async function executeSkill(
  skillId: string,
  input: any,
  requestingAgent?: string,
): Promise<SkillResult> {
  await ensureSkillsInitialized();

  const registered = skillRegistry.get(skillId);

  if (!registered) {
    return {
      success: false,
      error: `Skill not found: ${skillId}`,
    };
  }

  if (!registered.auditPassed) {
    return {
      success: false,
      error: `Skill audit not passed: ${skillId}`,
    };
  }

  if (requestingAgent) {
    const gate = await getToolGate();
    const permission = await gate.preflightSkillAccess(requestingAgent, skillId, {
      mode: 'execute',
      inputPreview: typeof input === 'object' && input !== null
        ? Object.keys(input as Record<string, unknown>).slice(0, 10)
        : typeof input,
    });

    if (!permission.success) {
      return {
        success: false,
        error: permission.error || 'Tool gate denied skill execution',
      };
    }

    if (
      registered.definition.permissions.fileRead
      && typeof input?.filePath === 'string'
      && input.filePath.trim().length > 0
    ) {
      const pathPermission = gate.canReadPath(requestingAgent, input.filePath);
      if (!pathPermission.allowed) {
        return {
          success: false,
          error: pathPermission.reason || 'Manifest file read boundary denied skill execution',
        };
      }
    }
  }

  try {
    const result = await registered.executor(input);
    return {
      success: result.success !== false,
      data: result,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
} 

/**
 * Test-only reset helper for runtime registry state.
 */
export function resetSkillRuntimeForTest(): void {
  skillRegistry.clear();
  governedSkillEntries.clear();
  bootstrapPromise = null;
  governedSkillStateLoaded = false;
}

/**
 * Test-only override for the governed skill state store.
 */
export function setGovernedSkillStateStoreForTest(
  store: GovernedSkillStateStore | null,
): void {
  governedSkillStateStoreOverride = store;
  governedSkillStateLoaded = false;
  bootstrapPromise = null;
}

/**
 * Get skill definition by ID
 */
export function getSkillDefinition(skillId: string): RuntimeSkillDefinition | undefined {
  return skillRegistry.get(skillId)?.definition;
}

/**
 * List all registered skills with metadata
 */
export function listSkills(): Array<{
  id: string;
  version: string;
  description: string;
  permissions: any;
  auditedAt: string;
  registrationMode: SkillRegistrationMode;
  intakeSource: 'builtin' | GovernedSkillSource;
  trustStatus: SkillTrustStatus;
  registeredBy?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  durabilityMode: BuiltinDurabilityMode | GovernedSkillPersistenceMode;
}> {
  return Array.from(skillRegistry.entries()).map(([id, skill]) => ({
    id,
    version: skill.definition.version,
    description: skill.definition.description,
    permissions: skill.definition.permissions,
    auditedAt: skill.auditedAt,
    registrationMode: skill.registrationMode,
    intakeSource: skill.intakeSource,
    trustStatus: skill.trustStatus,
    registeredBy: skill.registeredBy,
    reviewedBy: skill.reviewedBy,
    reviewedAt: skill.reviewedAt,
    reviewNote: skill.reviewNote,
    durabilityMode: skill.durabilityMode,
  }));
}

/**
 * List governed skill intake state, including staged-but-not-executable skills.
 */
export function listGovernedSkillIntake(): Array<{
  id: string;
  trustStatus: 'pending-review' | 'review-approved';
  intakeSource: GovernedSkillSource;
  registeredBy?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  provenanceSnapshot: SkillProvenanceSnapshot;
  executable: boolean;
  persistenceMode: GovernedSkillPersistenceMode;
  executorBinding?: PersistedGovernedSkillExecutorBinding;
}> {
  return Array.from(governedSkillEntries.entries()).map(([id, registration]) => ({
    id,
    trustStatus: registration.trustStatus,
    intakeSource: registration.intakeSource,
    registeredBy: registration.registeredBy,
    reviewedBy: registration.reviewedBy,
    reviewedAt: registration.reviewedAt,
    reviewNote: registration.reviewNote,
    provenanceSnapshot: registration.provenanceSnapshot,
    executable: skillRegistry.has(id),
    persistenceMode: registration.persistenceMode,
    executorBinding: registration.executorBinding,
  }));
}

/**
 * Check if a skill is registered and available
 */
export function hasSkill(skillId: string): boolean {
  return skillRegistry.has(skillId);
}
