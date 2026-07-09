type ExecuteSkillFn = (
  skillId: string,
  input: any,
  requestingAgent?: string,
) => Promise<{
  success: boolean;
  data?: any;
  error?: string;
}>;

type ExecuteSkillResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

type SkillsModuleShape = {
  executeSkill?: ExecuteSkillFn;
  default?: {
    executeSkill?: ExecuteSkillFn;
  };
};

export interface GovernedReadMetadata {
  bytes?: number | null;
  modifiedAt?: string | null;
  updatedAt?: string | null;
  lastStatus?: string | null;
  entryCount?: number;
  truncated?: boolean;
}

export interface GovernedDirectoryEntry {
  path: string;
  relativePath: string;
  kind: "file" | "directory";
  bytes: number | null;
  modifiedAt: string | null;
}

let executeSkillFn: ExecuteSkillFn | null = null;

async function getExecuteSkill(): Promise<ExecuteSkillFn> {
  if (executeSkillFn) {
    return executeSkillFn;
  }

  // Keep the specifier aligned with the repo-wide `.js` import convention so
  // this helper survives both source-mode execution and transpiled builds.
  const skillsModule = (await import("../../skills/index.js")) as SkillsModuleShape;
  const candidate = skillsModule.executeSkill ?? skillsModule.default?.executeSkill;

  if (typeof candidate !== "function") {
    throw new Error("skills registry executeSkill export unavailable");
  }

  executeSkillFn = candidate as ExecuteSkillFn;
  return executeSkillFn;
}

async function executeRequiredSkill<T>(
  skillId: string,
  input: Record<string, unknown>,
  agentId: string,
): Promise<T> {
  const executeSkill = await getExecuteSkill();
  const result = (await executeSkill(
    skillId,
    input,
    agentId,
  )) as ExecuteSkillResult<T>;

  if (!result.success) {
    throw new Error(result.error || `${skillId} execution failed`);
  }

  return (result.data ?? {}) as T;
}

export function hasAllowedSkill(
  config: {
    permissions?: {
      skills?: Record<string, { allowed?: boolean }>;
    };
  },
  skillId: string,
) {
  return config.permissions?.skills?.[skillId]?.allowed === true;
}

export function hasAllowedSkills(
  config: {
    permissions?: {
      skills?: Record<string, { allowed?: boolean }>;
    };
  },
  skillIds: string[],
) {
  return skillIds.every((skillId) => hasAllowedSkill(config, skillId));
}

export async function readRuntimeStateWithSkill<T extends Record<string, unknown>>(
  agentId: string,
  filePath: string,
): Promise<{
  exists: boolean;
  state: T;
  metadata: GovernedReadMetadata;
}> {
  // Posture agents should reach runtime truth through governed skill execution
  // instead of silently falling back to direct file reads.
  const result = await executeRequiredSkill<{
    exists?: boolean;
    state?: T;
    metadata?: GovernedReadMetadata;
  }>("runtimeStateReader", { filePath }, agentId);

  return {
    exists: result.exists === true,
    state: (result.state ?? {}) as T,
    metadata: result.metadata ?? {},
  };
}

export async function readServiceStateWithSkill<T extends Record<string, unknown>>(
  agentId: string,
  filePath: string,
): Promise<{
  exists: boolean;
  state: T | null;
  metadata: GovernedReadMetadata;
}> {
  const result = await executeRequiredSkill<{
    exists?: boolean;
    state?: T | null;
    metadata?: GovernedReadMetadata;
  }>("serviceStateReader", { filePath }, agentId);

  return {
    exists: result.exists === true,
    state: (result.state ?? null) as T | null,
    metadata: result.metadata ?? {},
  };
}

export async function repoPathExistsWithSkill(
  agentId: string,
  filePath: string,
  logicalPath?: string,
): Promise<boolean> {
  const result = await executeRequiredSkill<{ exists?: boolean }>(
    "repoFileReader",
    { filePath, logicalPath, mode: "exists" },
    agentId,
  );
  return result.exists === true;
}

export async function readRepoJsonWithSkill<T>(
  agentId: string,
  filePath: string,
  logicalPath?: string,
): Promise<T | null> {
  const result = await executeRequiredSkill<{
    exists?: boolean;
    json?: T;
  }>("repoFileReader", { filePath, logicalPath, mode: "json" }, agentId);
  return result.exists === true ? ((result.json ?? null) as T | null) : null;
}

export async function readRepoTextWithSkill(
  agentId: string,
  filePath: string,
  logicalPath?: string,
): Promise<string | null> {
  const result = await executeRequiredSkill<{
    exists?: boolean;
    content?: string;
  }>("repoFileReader", { filePath, logicalPath, mode: "text" }, agentId);
  return result.exists === true ? (result.content ?? null) : null;
}

export async function readRepoDirectoryWithSkill(
  agentId: string,
  filePath: string,
  logicalPath: string,
  options?: {
    recursive?: boolean;
    maxEntries?: number;
    extensions?: string[];
  },
): Promise<{
  exists: boolean;
  entries: GovernedDirectoryEntry[];
  metadata: GovernedReadMetadata;
}> {
  const result = await executeRequiredSkill<{
    exists?: boolean;
    entries?: GovernedDirectoryEntry[];
    metadata?: GovernedReadMetadata;
  }>(
    "repoFileReader",
    {
      filePath,
      logicalPath,
      mode: "directory",
      recursive: options?.recursive === true,
      maxEntries: options?.maxEntries,
      extensions: options?.extensions,
    },
    agentId,
  );

  return {
    exists: result.exists === true,
    entries: result.entries ?? [],
    metadata: result.metadata ?? {},
  };
}

export async function readLatestKnowledgePackWithSkill<T extends Record<string, unknown>>(
  agentId: string,
  filePath: string,
  logicalPath: string,
): Promise<{
  exists: boolean;
  latest: {
    path: string;
    modifiedAt: string | null;
    generatedAt: string | null;
    data: T;
  } | null;
}> {
  const result = await executeRequiredSkill<{
    exists?: boolean;
    latest?: {
      path: string;
      modifiedAt: string | null;
      generatedAt: string | null;
      data: T;
    } | null;
  }>(
    "knowledgePackReader",
    { filePath, logicalPath, mode: "latest" },
    agentId,
  );

  return {
    exists: result.exists === true,
    latest: result.latest ?? null,
  };
}
