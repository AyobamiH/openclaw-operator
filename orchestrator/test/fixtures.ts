/**
 * Test Fixtures - Shared test data and mock configurations
 * Used by all integration tests
 */

export interface MockAgentConfig {
  id: string;
  name: string;
  model: string;
  tier: 'cheap' | 'balanced';
  permissions?: {
    skills: Record<string, { allowed: boolean; maxCalls?: number }>;
    network?: { allowed: boolean };
  };
}

export interface MockTask {
  id: string;
  agentId: string;
  skillId: string;
  input?: Record<string, any>;
  traceId?: string;
  requiresApproval?: boolean;
  shouldFail?: boolean;
}

// Agent configuration fixtures matching deployed agents
export const agentFixtures = {
  marketResearch: {
    id: 'market-research-agent',
    name: 'Market Research Agent',
    model: 'gpt-4o-mini',
    tier: 'cheap',
    permissions: {
      skills: {
        sourceFetch: { allowed: true, maxCalls: 20 },
      },
      network: { allowed: true },
    },
  } as MockAgentConfig,

  dataExtraction: {
    id: 'data-extraction-agent',
    name: 'Data Extraction Agent',
    model: 'gpt-4o-mini',
    tier: 'cheap',
    permissions: {
      skills: {
        documentParser: { allowed: true, maxCalls: 50 },
        normalizer: { allowed: true, maxCalls: 30 },
      },
      network: { allowed: false },
    },
  } as MockAgentConfig,

  qaVerification: {
    id: 'qa-verification-agent',
    name: 'QA Verification Agent',
    model: 'claude-3-5-sonnet',
    tier: 'balanced',
    permissions: {
      skills: {
        testRunner: { allowed: true, maxCalls: 20 },
      },
      network: { allowed: false },
    },
  } as MockAgentConfig,

  summarization: {
    id: 'text-summarization-agent',
    name: 'Summarization Agent',
    model: 'gpt-4o-mini',
    tier: 'cheap',
    permissions: {
      skills: {
        documentParser: { allowed: true, maxCalls: 30 },
        normalizer: { allowed: true, maxCalls: 20 },
      },
      network: { allowed: false },
    },
  } as MockAgentConfig,

  buildRefactor: {
    id: 'build-refactor-agent',
    name: 'Build & Refactor Agent',
    model: 'claude-3-5-sonnet',
    tier: 'balanced',
    permissions: {
      skills: {
        workspacePatch: { allowed: true, maxCalls: 50 },
        testRunner: { allowed: true, maxCalls: 20 },
      },
      network: { allowed: false },
    },
  } as MockAgentConfig,

  security: {
    id: 'code-security-agent',
    name: 'Security Audit Agent',
    model: 'claude-3-5-sonnet',
    tier: 'balanced',
    permissions: {
      skills: {
        documentParser: { allowed: true, maxCalls: 20 },
        normalizer: { allowed: true, maxCalls: 10 },
      },
      network: { allowed: false },
    },
  } as MockAgentConfig,

  normalization: {
    id: 'normalization-agent',
    name: 'Data Normalization Agent',
    model: 'gpt-4o-mini',
    tier: 'cheap',
    permissions: {
      skills: {
        normalizer: { allowed: true, maxCalls: 100 },
        documentParser: { allowed: true, maxCalls: 50 },
      },
      network: { allowed: false },
    },
  } as MockAgentConfig,

  content: {
    id: 'content-agent',
    name: 'Content Generation Agent',
    model: 'gpt-4o-mini',
    tier: 'cheap',
    permissions: {
      skills: {
        documentParser: { allowed: true, maxCalls: 50 },
      },
      network: { allowed: false },
    },
  } as MockAgentConfig,

  integration: {
    id: 'integration-agent',
    name: 'Integration & Workflow Agent',
    model: 'claude-3-5-sonnet',
    tier: 'balanced',
    permissions: {
      skills: {
        documentParser: { allowed: true, maxCalls: 30 },
        normalizer: { allowed: true, maxCalls: 20 },
      },
      network: { allowed: false },
    },
  } as MockAgentConfig,

  skillAudit: {
    id: 'skill-audit-agent',
    name: 'Skill Audit & Verification Agent',
    model: 'claude-3-5-sonnet',
    tier: 'balanced',
    permissions: {
      skills: {
        testRunner: { allowed: true, maxCalls: 50 },
        documentParser: { allowed: true, maxCalls: 20 },
      },
      network: { allowed: false },
    },
  } as MockAgentConfig,

  systemMonitor: {
    id: 'system-monitor-agent',
    name: 'System Monitor & Observability Agent',
    model: 'gpt-4o-mini',
    tier: 'cheap',
    permissions: {
      skills: {
        runtimeStateReader: { allowed: true, maxCalls: 40 },
        serviceStateReader: { allowed: true, maxCalls: 120 },
        repoFileReader: { allowed: true, maxCalls: 60 },
      },
      network: { allowed: false },
    },
  } as MockAgentConfig,

  codeIndex: {
    id: 'code-index-agent',
    name: 'Code Index Agent',
    model: 'claude-3-5-sonnet',
    tier: 'balanced',
    permissions: {
      skills: {
        runtimeStateReader: { allowed: true, maxCalls: 20 },
        repoFileReader: { allowed: true, maxCalls: 80 },
        knowledgePackReader: { allowed: true, maxCalls: 20 },
      },
      network: { allowed: false },
    },
  } as MockAgentConfig,
};

// Common simulated agents as a list
export const allAgents = [
  agentFixtures.marketResearch,
  agentFixtures.dataExtraction,
  agentFixtures.qaVerification,
  agentFixtures.summarization,
  agentFixtures.buildRefactor,
  agentFixtures.security,
  agentFixtures.normalization,
  agentFixtures.content,
  agentFixtures.integration,
  agentFixtures.skillAudit,
  agentFixtures.systemMonitor,
  agentFixtures.codeIndex,
];

// Skill fixtures
export const skillFixtures = {
  sourceFetch: {
    id: 'sourceFetch',
    name: 'Source Fetch',
    description: 'Fetch content from URLs with timeout handling',
    allowedAgents: ['market-research-agent'],
  },
  documentParser: {
    id: 'documentParser',
    name: 'Document Parser',
    description: 'Parse PDFs, HTML, CSV files',
    allowedAgents: ['data-extraction-agent', 'text-summarization-agent', 'content-agent', 'code-security-agent', 'system-monitor-agent'],
  },
  normalizer: {
    id: 'normalizer',
    name: 'Data Normalizer',
    description: 'Normalize and validate data against schema',
    allowedAgents: ['data-extraction-agent', 'text-summarization-agent', 'normalization-agent', 'code-security-agent', 'integration-agent'],
  },
  workspacePatch: {
    id: 'workspacePatch',
    name: 'Workspace Patch',
    description: 'Apply safe code modifications with dry-run',
    allowedAgents: ['build-refactor-agent'],
  },
  testRunner: {
    id: 'testRunner',
    name: 'Test Runner',
    description: 'Execute whitelisted test commands',
    allowedAgents: ['qa-verification-agent', 'build-refactor-agent', 'skill-audit-agent'],
  },
  runtimeStateReader: {
    id: 'runtimeStateReader',
    name: 'Runtime State Reader',
    description: 'Read bounded orchestrator runtime-state JSON',
    allowedAgents: ['system-monitor-agent', 'code-index-agent'],
  },
  serviceStateReader: {
    id: 'serviceStateReader',
    name: 'Service State Reader',
    description: 'Read bounded agent service-state JSON',
    allowedAgents: ['system-monitor-agent'],
  },
  repoFileReader: {
    id: 'repoFileReader',
    name: 'Repo File Reader',
    description: 'Read bounded repo files and directory listings',
    allowedAgents: ['system-monitor-agent', 'code-index-agent'],
  },
  knowledgePackReader: {
    id: 'knowledgePackReader',
    name: 'Knowledge Pack Reader',
    description: 'Read bounded knowledge-pack artifacts',
    allowedAgents: ['code-index-agent'],
  },
};

// Task fixtures for testing workflows
export const taskFixtures = {
  simpleFetch: {
    id: 'task-001',
    agentId: 'market-research-agent',
    skillId: 'sourceFetch',
    input: { urls: ['https://example.com'] },
  } as MockTask,

  parseDocument: {
    id: 'task-002',
    agentId: 'data-extraction-agent',
    skillId: 'documentParser',
    input: { file: 'report.pdf', format: 'pdf' },
  } as MockTask,

  normalizeData: {
    id: 'task-003',
    agentId: 'normalization-agent',
    skillId: 'normalizer',
    input: { data: { name: 'John', age: '30' }, schema: { name: 'string', age: 'number' } },
  } as MockTask,

  runTests: {
    id: 'task-004',
    agentId: 'qa-verification-agent',
    skillId: 'testRunner',
    input: { command: 'jest' },
  } as MockTask,

  workflow_fetchParseNormalize: [
    {
      id: 'wf-step-1',
      agentId: 'market-research-agent',
      skillId: 'sourceFetch',
      input: { urls: ['https://example.com/data.csv'] },
    },
    {
      id: 'wf-step-2',
      agentId: 'data-extraction-agent',
      skillId: 'documentParser',
      input: { file: 'data.csv', format: 'csv' },
    },
    {
      id: 'wf-step-3',
      agentId: 'normalization-agent',
      skillId: 'normalizer',
      input: { data: {}, schema: {} },
    },
  ] as MockTask[],

  withApprovalGate: {
    id: 'task-approval-001',
    agentId: 'build-refactor-agent',
    skillId: 'workspacePatch',
    input: { patch: 'refactoring changes' },
    requiresApproval: true,
  } as MockTask,

  shouldFail: {
    id: 'task-fail-001',
    agentId: 'market-research-agent',
    skillId: 'sourceFetch',
    input: { urls: ['https://invalid-unreachable-domain-12345.com'] },
    shouldFail: true,
  } as MockTask,
};

// Permission violation fixtures (for testing deny-by-default)
export const permissionViolations = {
  marketResearchCallsDocumentParser: {
    agentId: 'market-research-agent',
    skillId: 'documentParser', // Not in permissions
    expectedDenied: true,
  },
  dataExtractionCallsSourceFetch: {
    agentId: 'data-extraction-agent',
    skillId: 'sourceFetch', // Not in permissions
    expectedDenied: true,
  },
  qaCallsWorkspacePatch: {
    agentId: 'qa-verification-agent',
    skillId: 'workspacePatch', // Not in permissions
    expectedDenied: true,
  },
};

// Audit trail fixtures
export const auditTrailFixtures = {
  exampleTrace: {
    traceId: 'trace-abc123',
    timestamp: new Date('2026-02-22T10:00:00Z'),
    agentId: 'market-research-agent',
    skillId: 'sourceFetch',
    action: 'skill_invocation',
    status: 'success',
    result: { success: true, data: 'example' },
    metrics: { duration: 250, tokens: 150 },
  },

  deniedAccess: {
    traceId: 'trace-denied-001',
    timestamp: new Date('2026-02-22T10:00:05Z'),
    agentId: 'market-research-agent',
    skillId: 'documentParser',
    action: 'permission_denied',
    status: 'denied',
    reason: 'Agent does not have permission to access this skill',
  },

  stateTransition: {
    traceId: 'trace-state-001',
    timestamp: new Date('2026-02-22T10:00:10Z'),
    agentId: 'qa-verification-agent',
    action: 'state_change',
    from: 'idle',
    to: 'running',
    taskId: 'task-004',
  },
};

export default {
  agentFixtures,
  allAgents,
  skillFixtures,
  taskFixtures,
  permissionViolations,
  auditTrailFixtures,
};
