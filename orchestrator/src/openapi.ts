type HttpMethod = "get" | "post";
type OpenApiNode = Record<string, unknown>;
type OpenApiResponse = OpenApiNode;
type OpenApiPath = Partial<Record<HttpMethod, OpenApiNode>>;

const TASK_TYPE_ENUM = [
  "drift-repair",
  "reddit-response",
  "security-audit",
  "summarize-content",
  "system-monitor",
  "build-refactor",
  "content-generate",
  "integration-workflow",
  "normalize-data",
  "market-research",
  "data-extraction",
  "qa-verification",
  "skill-audit",
  "rss-sweep",
  "nightly-batch",
  "send-digest",
  "heartbeat",
  "agent-deploy",
  "doc-sync",
  "control-plane-brief",
  "incident-triage",
  "release-readiness",
] as const;

const INCIDENT_CLASSIFICATION_ENUM = [
  "runtime-mode",
  "persistence",
  "proof-delivery",
  "repair",
  "retry-recovery",
  "knowledge",
  "service-runtime",
  "approval-backlog",
] as const;

const INCIDENT_STATUS_ENUM = ["active", "watching", "resolved"] as const;
const INCIDENT_TASK_TYPE_ENUM = [
  "drift-repair",
  "build-refactor",
  "qa-verification",
  "system-monitor",
] as const;

const protectedAuthHeaders = [
  "X-Request-Id",
  "X-API-Key-Expires",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
];

const protectedReadHeaders = [
  ...protectedAuthHeaders,
  "X-OpenClaw-Cache",
  "X-OpenClaw-Cache-Store",
  "Cache-Control",
  "Vary",
];

const publicReadHeaders = [
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
  "X-OpenClaw-Cache",
  "X-OpenClaw-Cache-Store",
  "Cache-Control",
];

const writeHeaders = [...protectedAuthHeaders];
const rateLimitHeaders = [
  "Retry-After",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
];

function schemaRef(name: string): OpenApiNode {
  return { $ref: `#/components/schemas/${name}` };
}

function responseRef(name: string): OpenApiNode {
  return { $ref: `#/components/responses/${name}` };
}

function parameterRef(name: string): OpenApiNode {
  return { $ref: `#/components/parameters/${name}` };
}

function headerRef(name: string): OpenApiNode {
  return { $ref: `#/components/headers/${name}` };
}

function buildResponseHeaders(names: string[]): Record<string, OpenApiNode> {
  return Object.fromEntries(names.map((name) => [name, headerRef(name)]));
}

function jsonResponse(
  description: string,
  schemaName: string,
  headerNames: string[] = [],
): OpenApiResponse {
  return {
    description,
    headers: buildResponseHeaders(headerNames),
    content: {
      "application/json": {
        schema: schemaRef(schemaName),
      },
    },
  };
}

function protectedAccess(
  role: "viewer" | "operator" | "admin",
  rateLimitBucket: "viewer-read" | "operator-write" | "admin-export",
  action: string,
): OpenApiNode {
  return {
    auth: "bearer",
    requiredRole: role,
    preAuthRateLimit: "300 requests / 60s / IP",
    rateLimitBucket,
    action,
  };
}

const components = {
  securitySchemes: {
    bearerAuth: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "API key",
      description:
        "Protected routes require `Authorization: Bearer <token>`. Auth context is established before role enforcement.",
    },
    webhookSignature: {
      type: "apiKey",
      in: "header",
      name: "X-Webhook-Signature",
      description:
        "HMAC-SHA256 signature over the canonicalized JSON request body. Prefix `sha256=` is accepted but optional.",
    },
  },
  headers: {
    "X-Request-Id": {
      description: "Generated request correlation id for protected routes.",
      schema: { type: "string", format: "uuid" },
    },
    "X-API-Key-Expires": {
      description:
        "Expiry timestamp for the authenticated API key on protected routes.",
      schema: { type: "string", format: "date-time" },
    },
    "Retry-After": {
      description: "Minimum number of seconds a client should wait before retrying.",
      schema: { type: "integer", minimum: 1 },
    },
    "ratelimit-limit": {
      description: "Current route bucket request limit for the active window.",
      schema: { type: "integer", minimum: 1 },
    },
    "ratelimit-remaining": {
      description: "Remaining requests in the active limiter window.",
      schema: { type: "integer", minimum: 0 },
    },
    "ratelimit-reset": {
      description: "Seconds until the current limiter window resets.",
      schema: { type: "integer", minimum: 0 },
    },
    "X-OpenClaw-Cache": {
      description: "Response cache result for cached read surfaces.",
      schema: { type: "string", enum: ["hit", "miss"] },
    },
    "X-OpenClaw-Cache-Store": {
      description: "Backing store used for the cached response.",
      schema: { type: "string", enum: ["redis", "memory"] },
    },
    "Cache-Control": {
      description: "Server-selected cache-control policy for the response.",
      schema: { type: "string" },
    },
    Vary: {
      description:
        "Protected cached reads vary on Authorization and, where relevant, Origin or preflight headers.",
      schema: { type: "string" },
    },
  },
  parameters: {
    RunId: {
      name: "runId",
      in: "path",
      required: true,
      description:
        "Task run identity. Runtime uses an explicit idempotency key when provided; otherwise the task id becomes the run id.",
      schema: { type: "string", minLength: 1, maxLength: 255 },
    },
    IncidentId: {
      name: "id",
      in: "path",
      required: true,
      description: "Stable runtime incident id.",
      schema: { type: "string", minLength: 1, maxLength: 255 },
    },
    ApprovalId: {
      name: "id",
      in: "path",
      required: true,
      description: "Approval task id from the approval ledger.",
      schema: { type: "string", minLength: 1 },
    },
    Limit: {
      name: "limit",
      in: "query",
      required: false,
      description: "Page size.",
      schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    },
    Offset: {
      name: "offset",
      in: "query",
      required: false,
      description: "Zero-based page offset.",
      schema: { type: "integer", minimum: 0, maximum: 100000, default: 0 },
    },
    TaskRunType: {
      name: "type",
      in: "query",
      required: false,
      description: "Optional task type filter for task runs.",
      schema: { type: "string", maxLength: 120 },
    },
    TaskRunStatus: {
      name: "status",
      in: "query",
      required: false,
      description: "Optional execution status filter for task runs.",
      schema: {
        type: "string",
        enum: ["pending", "running", "success", "failed", "retrying"],
      },
    },
    IncidentStatus: {
      name: "status",
      in: "query",
      required: false,
      description: "Optional incident status filter.",
      schema: { type: "string", enum: INCIDENT_STATUS_ENUM },
    },
    IncidentClassification: {
      name: "classification",
      in: "query",
      required: false,
      description: "Optional incident classification filter.",
      schema: { type: "string", enum: INCIDENT_CLASSIFICATION_ENUM },
    },
    IncludeResolved: {
      name: "includeResolved",
      in: "query",
      required: false,
      description: "When true, resolved incidents remain in the list response.",
      schema: { type: "boolean", default: false },
    },
    SkillAuditLimit: {
      name: "limit",
      in: "query",
      required: false,
      description: "Audit page size.",
      schema: { type: "integer", minimum: 1, maximum: 1000, default: 100 },
    },
    DeniedOnly: {
      name: "deniedOnly",
      in: "query",
      required: false,
      description: "When true, only denied skill/tool invocations are returned.",
      schema: { type: "boolean", default: false },
    },
    MemoryAgentId: {
      name: "agentId",
      in: "query",
      required: false,
      description: "Optional single-agent filter for memory recall.",
      schema: { type: "string" },
    },
    MemoryIncludeErrors: {
      name: "includeErrors",
      in: "query",
      required: false,
      description: "When false, error timeline entries are omitted.",
      schema: { type: "boolean", default: true },
    },
    MemoryIncludeSensitive: {
      name: "includeSensitive",
      in: "query",
      required: false,
      description: "When true, default memory redaction is relaxed for the response.",
      schema: { type: "boolean", default: false },
    },
    PersistenceDays: {
      name: "days",
      in: "query",
      required: false,
      description: "Historical persistence lookback window in days.",
      schema: { type: "integer", minimum: 1, maximum: 365, default: 30 },
    },
    KnowledgeExportFormat: {
      name: "format",
      in: "query",
      required: false,
      description: "Knowledge export format.",
      schema: { type: "string", enum: ["markdown", "json"], default: "markdown" },
    },
    MilestoneLimit: {
      name: "limit",
      in: "query",
      required: false,
      description: "Latest milestone page size.",
      schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    },
  },
  schemas: {
    GenericObject: {
      type: "object",
      additionalProperties: true,
    },
    StringArray: {
      type: "array",
      items: { type: "string" },
    },
    ErrorResponse: {
      type: "object",
      required: ["error"],
      properties: {
        error: { type: "string" },
      },
      additionalProperties: true,
    },
    ValidationIssue: {
      type: "object",
      required: ["path", "message"],
      properties: {
        path: { type: "string" },
        message: { type: "string" },
      },
    },
    ValidationErrorResponse: {
      type: "object",
      required: ["error", "details"],
      properties: {
        error: { type: "string", enum: ["Validation failed"] },
        details: {
          type: "array",
          items: schemaRef("ValidationIssue"),
        },
      },
    },
    RateLimitExceededResponse: {
      type: "object",
      required: ["error", "retryAfterSeconds"],
      properties: {
        error: { type: "string" },
        retryAfterSeconds: { type: "integer", minimum: 1 },
      },
    },
    PageMetadata: {
      type: "object",
      required: ["returned", "offset", "limit", "hasMore"],
      properties: {
        returned: { type: "integer", minimum: 0 },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
        hasMore: { type: "boolean" },
      },
    },
    HealthResponse: {
      type: "object",
      required: ["status", "timestamp", "metrics", "knowledge", "persistence"],
      properties: {
        status: { type: "string" },
        timestamp: { type: "string", format: "date-time" },
        metrics: { type: "string", format: "uri" },
        knowledge: { type: "string", format: "uri" },
        persistence: { type: "string", format: "uri" },
      },
    },
    OpenApiDocumentSummary: {
      type: "object",
      required: ["openapi", "info", "paths", "components"],
      properties: {
        openapi: { type: "string" },
        info: schemaRef("GenericObject"),
        paths: schemaRef("GenericObject"),
        components: schemaRef("GenericObject"),
      },
      additionalProperties: true,
    },
    KnowledgeSummaryResponse: {
      type: "object",
      properties: {
        stats: schemaRef("GenericObject"),
        networkStats: schemaRef("GenericObject"),
        runtime: schemaRef("GenericObject"),
      },
      additionalProperties: true,
    },
    PersistenceHealthResponse: {
      type: "object",
      required: ["status"],
      properties: {
        status: { type: "string" },
        database: {
          oneOf: [{ type: "boolean" }, { type: "string" }, { type: "null" }],
        },
        collections: {
          oneOf: [{ type: "integer" }, schemaRef("GenericObject"), { type: "null" }],
        },
        coordination: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["healthy", "degraded", "disabled", "unknown"] },
            store: { type: "string", enum: ["redis", "memory"] },
            redisConfigured: { type: "boolean" },
            redisReachable: { type: "boolean" },
            detail: { type: "string" },
            checkedAt: { type: "string", format: "date-time" },
            disabledUntil: { type: "string", format: "date-time", nullable: true },
          },
          additionalProperties: true,
        },
      },
      additionalProperties: true,
    },
    AuthContextResponse: {
      type: "object",
      required: [
        "requestId",
        "actor",
        "role",
        "roles",
        "apiKeyVersion",
        "apiKeyLabel",
        "apiKeyExpiresAt",
      ],
      properties: {
        requestId: { type: "string", format: "uuid", nullable: true },
        actor: { type: "string", nullable: true },
        role: {
          type: "string",
          enum: ["viewer", "operator", "admin"],
          nullable: true,
        },
        roles: {
          type: "array",
          items: { type: "string", enum: ["viewer", "operator", "admin"] },
        },
        apiKeyVersion: { type: "integer", nullable: true },
        apiKeyLabel: { type: "string", nullable: true },
        apiKeyExpiresAt: { type: "string", format: "date-time", nullable: true },
      },
    },
    TaskTriggerRequest: {
      type: "object",
      required: ["type"],
      properties: {
        type: { type: "string", enum: TASK_TYPE_ENUM },
        payload: {
          type: "object",
          additionalProperties: true,
          default: {},
        },
      },
    },
    TaskTriggerResponse: {
      type: "object",
      required: ["status", "taskId", "type", "createdAt"],
      properties: {
        status: { type: "string", enum: ["queued"] },
        taskId: { type: "string" },
        type: { type: "string" },
        createdAt: {
          description:
            "Queue task creation timestamp. Runtime currently returns the enqueue timestamp as a number-like value.",
          oneOf: [{ type: "number" }, { type: "string" }],
        },
      },
    },
    CatalogTask: {
      type: "object",
      required: ["type", "label"],
      properties: {
        type: { type: "string", enum: TASK_TYPE_ENUM },
        label: { type: "string" },
        purpose: { type: "string" },
        internalOnly: { type: "boolean" },
        publicTriggerable: { type: "boolean" },
        approvalGated: { type: "boolean" },
        operationalStatus: { type: "string" },
        dependencyClass: { type: "string" },
        baselineConfidence: { type: "number" },
        dependencyRequirements: schemaRef("StringArray"),
        exposeInV1: { type: "boolean" },
        caveats: schemaRef("StringArray"),
        telemetryOverlay: schemaRef("GenericObject"),
      },
      additionalProperties: true,
    },
    TaskCatalogResponse: {
      type: "object",
      required: ["generatedAt", "tasks"],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        tasks: {
          type: "array",
          items: schemaRef("CatalogTask"),
        },
      },
    },
    PendingApprovalItem: {
      type: "object",
      required: ["taskId", "type", "requestedAt", "status"],
      properties: {
        taskId: { type: "string" },
        type: { type: "string" },
        payload: schemaRef("GenericObject"),
        requestedAt: { type: "string", format: "date-time" },
        status: { type: "string" },
        impact: schemaRef("GenericObject"),
        payloadPreview: schemaRef("GenericObject"),
      },
      additionalProperties: true,
    },
    PendingApprovalsResponse: {
      type: "object",
      required: ["count", "pending"],
      properties: {
        count: { type: "integer", minimum: 0 },
        pending: {
          type: "array",
          items: schemaRef("PendingApprovalItem"),
        },
      },
    },
    ApprovalDecisionRequest: {
      type: "object",
      required: ["decision"],
      properties: {
        decision: { type: "string", enum: ["approved", "rejected"] },
        actor: { type: "string", minLength: 1, maxLength: 120 },
        note: { type: "string", maxLength: 1000 },
      },
    },
    ApprovalDecisionResponse: {
      type: "object",
      required: ["status", "approval"],
      properties: {
        status: { type: "string", enum: ["ok"] },
        approval: schemaRef("GenericObject"),
        replayTaskId: { type: "string", nullable: true },
      },
      additionalProperties: true,
    },
    TaskRun: {
      type: "object",
      required: ["type", "status"],
      properties: {
        id: { type: "string" },
        runId: { type: "string" },
        taskId: { type: "string" },
        type: { type: "string" },
        status: { type: "string" },
        createdAt: { type: "string", format: "date-time", nullable: true },
        startedAt: { type: "string", format: "date-time", nullable: true },
        completedAt: { type: "string", format: "date-time", nullable: true },
        lastHandledAt: { type: "string", format: "date-time", nullable: true },
        model: { type: "string", nullable: true },
        cost: { type: "number" },
        latency: { type: "number", nullable: true },
        usage: schemaRef("GenericObject"),
        budget: schemaRef("GenericObject"),
        accounting: schemaRef("GenericObject"),
        error: { type: "string", nullable: true },
        lastError: { type: "string", nullable: true },
        attempt: { type: "integer" },
        maxRetries: { type: "integer" },
        workflow: schemaRef("GenericObject"),
        approval: schemaRef("GenericObject"),
        events: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
        workflowGraph: schemaRef("GenericObject"),
        proofLinks: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
        history: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
        repair: {
          oneOf: [schemaRef("GenericObject"), { type: "null" }],
        },
        result: {},
      },
      additionalProperties: true,
    },
    TaskRunsResponse: {
      type: "object",
      required: ["generatedAt", "query", "total", "page", "runs"],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        query: schemaRef("GenericObject"),
        total: { type: "integer", minimum: 0 },
        page: schemaRef("PageMetadata"),
        runs: {
          type: "array",
          items: schemaRef("TaskRun"),
        },
      },
    },
    TaskRunDetailResponse: {
      type: "object",
      required: ["generatedAt", "run"],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        run: schemaRef("TaskRun"),
      },
    },
    IncidentActionRequest: {
      type: "object",
      properties: {
        actor: { type: "string", minLength: 1, maxLength: 120 },
        note: { type: "string", maxLength: 1000 },
      },
      additionalProperties: false,
    },
    IncidentOwnerRequest: {
      type: "object",
      required: ["owner"],
      properties: {
        owner: { type: "string", minLength: 1, maxLength: 120 },
        actor: { type: "string", minLength: 1, maxLength: 120 },
        note: { type: "string", maxLength: 1000 },
      },
      additionalProperties: false,
    },
    IncidentRemediationRequest: {
      type: "object",
      properties: {
        actor: { type: "string", minLength: 1, maxLength: 120 },
        note: { type: "string", maxLength: 1000 },
        taskType: { type: "string", enum: INCIDENT_TASK_TYPE_ENUM },
      },
      additionalProperties: false,
    },
    RuntimeIncident: {
      type: "object",
      required: [
        "id",
        "title",
        "classification",
        "severity",
        "status",
        "truthLayer",
        "summary",
        "detectedAt",
      ],
      properties: {
        id: { type: "string" },
        fingerprint: { type: "string" },
        title: { type: "string" },
        classification: { type: "string", enum: INCIDENT_CLASSIFICATION_ENUM },
        severity: { type: "string", enum: ["info", "warning", "critical"] },
        status: { type: "string", enum: INCIDENT_STATUS_ENUM },
        truthLayer: {
          type: "string",
          enum: ["configured", "observed", "public"],
        },
        summary: { type: "string" },
        detectedAt: { type: "string", format: "date-time", nullable: true },
        firstSeenAt: { type: "string", format: "date-time", nullable: true },
        lastSeenAt: { type: "string", format: "date-time", nullable: true },
        resolvedAt: { type: "string", format: "date-time", nullable: true },
        acknowledgedAt: {
          type: "string",
          format: "date-time",
          nullable: true,
        },
        acknowledgedBy: { type: "string", nullable: true },
        owner: { type: "string", nullable: true },
        affectedSurfaces: schemaRef("StringArray"),
        linkedServiceIds: schemaRef("StringArray"),
        linkedTaskIds: schemaRef("StringArray"),
        linkedRunIds: schemaRef("StringArray"),
        linkedRepairIds: schemaRef("StringArray"),
        linkedProofDeliveries: schemaRef("StringArray"),
        recommendedSteps: schemaRef("StringArray"),
        policy: schemaRef("GenericObject"),
        escalation: schemaRef("GenericObject"),
        verification: schemaRef("GenericObject"),
        remediation: schemaRef("GenericObject"),
        remediationPlan: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
        policyExecutions: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
        history: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
        acknowledgements: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
        ownershipHistory: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
        remediationTasks: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
      },
      additionalProperties: true,
    },
    IncidentActionResponse: {
      type: "object",
      required: ["status", "incident"],
      properties: {
        status: { type: "string", enum: ["ok"] },
        incident: schemaRef("RuntimeIncident"),
      },
    },
    IncidentRemediationResponse: {
      type: "object",
      required: ["status", "incident"],
      properties: {
        status: { type: "string", enum: ["ok"] },
        incident: schemaRef("RuntimeIncident"),
        remediationTask: schemaRef("GenericObject"),
      },
      additionalProperties: true,
    },
    IncidentsResponse: {
      type: "object",
      required: ["generatedAt", "query", "total", "page", "incidents"],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        query: schemaRef("GenericObject"),
        total: { type: "integer", minimum: 0 },
        page: schemaRef("PageMetadata"),
        incidents: {
          type: "array",
          items: schemaRef("RuntimeIncident"),
        },
      },
    },
    IncidentDetailResponse: {
      type: "object",
      required: ["generatedAt", "incident"],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        incident: schemaRef("RuntimeIncident"),
      },
    },
    IncidentHistoryResponse: {
      type: "object",
      required: [
        "generatedAt",
        "incidentId",
        "history",
        "acknowledgements",
        "ownershipHistory",
        "remediationTasks",
      ],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        incidentId: { type: "string" },
        history: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
        acknowledgements: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
        ownershipHistory: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
        remediationTasks: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
      },
    },
    DashboardOverviewResponse: {
      type: "object",
      required: [
        "generatedAt",
        "health",
        "persistence",
        "accounting",
        "queue",
        "approvals",
        "selfHealing",
        "governance",
        "incidents",
        "recentTasks",
      ],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        health: schemaRef("GenericObject"),
        persistence: schemaRef("GenericObject"),
        accounting: schemaRef("GenericObject"),
        queue: schemaRef("GenericObject"),
        approvals: schemaRef("GenericObject"),
        selfHealing: schemaRef("GenericObject"),
        governance: schemaRef("GenericObject"),
        incidents: schemaRef("GenericObject"),
        recentTasks: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
      },
      additionalProperties: true,
    },
    ExtendedHealthResponse: {
      type: "object",
      required: [
        "generatedAt",
        "status",
        "controlPlane",
        "workers",
        "repairs",
        "dependencies",
        "truthLayers",
        "incidents",
      ],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        status: { type: "string", enum: ["healthy", "warning", "degraded"] },
        controlPlane: schemaRef("GenericObject"),
        workers: schemaRef("GenericObject"),
        repairs: schemaRef("GenericObject"),
        dependencies: schemaRef("GenericObject"),
        truthLayers: schemaRef("GenericObject"),
        incidents: schemaRef("GenericObject"),
      },
      additionalProperties: true,
    },
    AgentOverviewItem: {
      type: "object",
      required: ["id", "name"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        orchestratorTask: { type: "string" },
        modelTier: { type: "string", nullable: true },
        allowedSkills: schemaRef("StringArray"),
        declared: { type: "boolean" },
        spawnedWorkerCapable: { type: "boolean" },
        workerValidationStatus: { type: "string" },
        serviceAvailable: { type: "boolean" },
        serviceExpected: { type: "boolean" },
        lifecycleMode: {
          type: "string",
          enum: ["service-expected", "worker-first"],
        },
        hostServiceStatus: {
          type: "string",
          enum: [
            "running",
            "installed-stopped",
            "not-installed",
            "probe-unavailable",
            "missing-entrypoint",
            "not-applicable",
          ],
        },
        serviceUnitName: { type: "string", nullable: true },
        serviceInstalled: { type: "boolean", nullable: true },
        serviceRunning: { type: "boolean", nullable: true },
        serviceUnitState: { type: "string", nullable: true },
        serviceUnitSubState: { type: "string", nullable: true },
        serviceUnitFileState: { type: "string", nullable: true },
        serviceImplementation: { type: "string" },
        serviceOperational: { type: "boolean" },
        dependencySensitivity: { type: "string" },
        frontendExposure: { type: "string" },
        runtimeProof: schemaRef("GenericObject"),
        memory: schemaRef("GenericObject"),
        notes: schemaRef("StringArray"),
        lastEvidenceAt: { type: "string", format: "date-time" },
        evidenceSources: schemaRef("StringArray"),
        lastSuccessfulRunId: { type: "string" },
        lastSuccessfulTaskId: { type: "string" },
        capability: schemaRef("GenericObject"),
      },
      additionalProperties: true,
    },
    AgentsOverviewResponse: {
      type: "object",
      required: ["generatedAt", "count", "agents"],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        count: { type: "integer", minimum: 0 },
        agents: {
          type: "array",
          items: schemaRef("AgentOverviewItem"),
        },
        topology: schemaRef("GenericObject"),
        relationshipHistory: schemaRef("GenericObject"),
      },
      additionalProperties: true,
    },
    GovernedSkillRegistryResponse: {
      type: "object",
      required: ["generatedAt", "total", "skills"],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        total: { type: "integer", minimum: 0 },
        skills: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
      },
    },
    GovernedSkillPolicyResponse: {
      type: "object",
      required: ["generatedAt", "policy"],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        policy: schemaRef("GenericObject"),
      },
    },
    GovernedSkillTelemetryResponse: {
      type: "object",
      required: ["generatedAt", "telemetry"],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        telemetry: schemaRef("GenericObject"),
      },
    },
    GovernedSkillAuditResponse: {
      type: "object",
      required: ["generatedAt", "query", "total", "page", "records"],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        query: schemaRef("GenericObject"),
        total: { type: "integer", minimum: 0 },
        page: schemaRef("PageMetadata"),
        records: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
      },
    },
    MemoryRecallResponse: {
      type: "object",
      required: [
        "generatedAt",
        "query",
        "totalAgents",
        "totalRuns",
        "page",
        "items",
      ],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        query: schemaRef("GenericObject"),
        totalAgents: { type: "integer", minimum: 0 },
        totalRuns: { type: "integer", minimum: 0 },
        page: schemaRef("PageMetadata"),
        items: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
      },
    },
    KnowledgeQueryRequest: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 5000,
          pattern: "^[a-zA-Z0-9\\s\\-\\.\\,\\?\\!\\(\\)\\:\\;'\\\"\\&]+$",
        },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
        filter: schemaRef("GenericObject"),
      },
    },
    KnowledgeQueryResponse: {
      type: "object",
      properties: {
        query: { type: "string" },
        results: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
        runtime: schemaRef("GenericObject"),
      },
      additionalProperties: true,
    },
    PersistenceHistoricalResponse: {
      type: "object",
      additionalProperties: true,
      description:
        "Historical persistence payload from the persistence subsystem. Shape depends on the requested aggregation.",
    },
    PersistenceSummaryResponse: {
      type: "object",
      required: ["generatedAt", "status"],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        status: { type: "string" },
        persistenceAvailable: { type: "boolean" },
        storage: schemaRef("GenericObject"),
        collections: schemaRef("GenericObject"),
        indicators: schemaRef("GenericObject"),
        retention: schemaRef("GenericObject"),
      },
      additionalProperties: true,
    },
    CommandCenterOverviewResponse: {
      type: "object",
      additionalProperties: true,
    },
    CommandCenterControlResponse: {
      type: "object",
      additionalProperties: true,
    },
    CommandCenterDemandResponse: {
      type: "object",
      additionalProperties: true,
    },
    MilestoneFeedResponse: {
      type: "object",
      additionalProperties: true,
    },
    MilestoneDeadLetterResponse: {
      type: "object",
      additionalProperties: true,
    },
    CompanionOverviewResponse: {
      type: "object",
      required: [
        "generatedAt",
        "controlPlaneMode",
        "primaryOperatorMove",
        "pressureStory",
        "queue",
        "approvals",
        "incidents",
        "publicProof",
        "services",
        "freshnessTimestamp",
      ],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        controlPlaneMode: schemaRef("GenericObject"),
        primaryOperatorMove: schemaRef("GenericObject"),
        pressureStory: schemaRef("GenericObject"),
        queue: schemaRef("GenericObject"),
        approvals: schemaRef("GenericObject"),
        incidents: schemaRef("GenericObject"),
        publicProof: schemaRef("GenericObject"),
        services: schemaRef("GenericObject"),
        freshnessTimestamp: { type: "string", format: "date-time" },
      },
    },
    CompanionCatalogResponse: {
      type: "object",
      required: ["generatedAt", "total", "tasks"],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        total: { type: "integer", minimum: 0 },
        tasks: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
      },
    },
    CompanionIncidentsResponse: {
      type: "object",
      required: ["generatedAt", "summary", "topClassifications", "topQueue"],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        summary: schemaRef("GenericObject"),
        topClassifications: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
        topQueue: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
      },
    },
    CompanionRunsResponse: {
      type: "object",
      required: ["generatedAt", "total", "runs"],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        total: { type: "integer", minimum: 0 },
        runs: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
      },
    },
    CompanionApprovalsResponse: {
      type: "object",
      required: ["generatedAt", "count", "dominantLanes", "oldestWaiting", "items"],
      properties: {
        generatedAt: { type: "string", format: "date-time" },
        count: { type: "integer", minimum: 0 },
        dominantLanes: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
        oldestWaiting: {
          oneOf: [schemaRef("GenericObject"), { type: "null" }],
        },
        items: {
          type: "array",
          items: schemaRef("GenericObject"),
        },
      },
    },
    WebhookAlertsRequest: {
      type: "object",
      required: ["alerts"],
      properties: {
        alerts: {
          type: "array",
          maxItems: 1000,
          items: {
            type: "object",
            required: ["status", "labels"],
            properties: {
              status: { type: "string", enum: ["firing", "resolved"] },
              labels: {
                type: "object",
                additionalProperties: { type: "string" },
                maxProperties: 50,
              },
              annotations: {
                type: "object",
                additionalProperties: { type: "string" },
              },
            },
          },
        },
        groupLabels: {
          type: "object",
          additionalProperties: { type: "string" },
        },
        commonLabels: {
          type: "object",
          additionalProperties: { type: "string" },
        },
        commonAnnotations: {
          type: "object",
          additionalProperties: { type: "string" },
        },
      },
    },
    WebhookAcceptedResponse: {
      type: "object",
      required: ["status"],
      properties: {
        status: { type: "string", enum: ["ok"] },
      },
    },
  },
  responses: {
    BadRequest: {
      description: "Request validation or route-level input parsing failed.",
      content: {
        "application/json": {
          schema: {
            oneOf: [schemaRef("ErrorResponse"), schemaRef("ValidationErrorResponse")],
          },
        },
      },
    },
    Unauthorized: {
      description:
        "Bearer token missing, invalid, or expired, or webhook signature missing/invalid.",
      content: {
        "application/json": {
          schema: schemaRef("ErrorResponse"),
        },
      },
    },
    Forbidden: {
      description: "Authenticated actor does not satisfy the route role requirement.",
      content: {
        "application/json": {
          schema: schemaRef("ErrorResponse"),
        },
      },
    },
    NotFound: {
      description: "Requested resource was not found.",
      content: {
        "application/json": {
          schema: schemaRef("ErrorResponse"),
        },
      },
    },
    TooManyRequests: {
      description: "Rate limit exceeded.",
      headers: buildResponseHeaders(rateLimitHeaders),
      content: {
        "application/json": {
          schema: schemaRef("RateLimitExceededResponse"),
        },
      },
    },
    ServerError: {
      description: "Unexpected server error.",
      content: {
        "application/json": {
          schema: schemaRef("ErrorResponse"),
        },
      },
    },
  },
};

export function buildOpenApiSpec(port: string | number = 3000) {
  const baseUrl = `http://localhost:${port}`;

  const paths: Record<string, OpenApiPath> = {
    "/health": {
      get: {
        tags: ["Public"],
        summary: "Public liveness endpoint",
        description:
          "Shallow public liveness check. This is not the authoritative operator-health contract; use `/api/health/extended` for protected operator health.",
        operationId: "getHealth",
        "x-openclaw-access": {
          visibility: "public",
          rateLimit: "1000 requests / 60s / IP",
          shellContract:
            "Orchestrator serves `/operator` and `/operator/*` via the built operator-s-console bundle; this route remains public JSON only.",
        },
        responses: {
          "200": jsonResponse(
            "Public health payload with helper URLs.",
            "HealthResponse",
            publicReadHeaders,
          ),
          "429": responseRef("TooManyRequests"),
        },
      },
    },
    "/api/openapi.json": {
      get: {
        tags: ["Public", "Contract"],
        summary: "Machine-readable API contract",
        description:
          "Returns the orchestrator-owned OpenAPI document for the current runtime route surface.",
        operationId: "getOpenApiDocument",
        "x-openclaw-access": {
          visibility: "public",
          rateLimit: "30 requests / 60s / IP",
          responseCache: "public",
        },
        responses: {
          "200": jsonResponse(
            "OpenAPI document.",
            "OpenApiDocumentSummary",
            publicReadHeaders,
          ),
          "429": responseRef("TooManyRequests"),
        },
      },
    },
    "/api/knowledge/summary": {
      get: {
        tags: ["Public", "Knowledge"],
        summary: "Public knowledge summary",
        description:
          "Read-only knowledge summary with runtime freshness, provenance, and contradiction signals.",
        operationId: "getKnowledgeSummary",
        "x-openclaw-access": {
          visibility: "public",
          rateLimit: "30 requests / 60s / IP",
          responseCache: "public",
        },
        responses: {
          "200": jsonResponse(
            "Knowledge summary payload.",
            "KnowledgeSummaryResponse",
            publicReadHeaders,
          ),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/persistence/health": {
      get: {
        tags: ["Public", "Persistence"],
        summary: "Public persistence dependency health",
        description:
          "Lightweight public health probe for the persistence dependency layer.",
        operationId: "getPersistenceHealth",
        "x-openclaw-access": {
          visibility: "public",
          rateLimit: "1000 requests / 60s / IP",
          responseCache: "public",
        },
        responses: {
          "200": jsonResponse(
            "Persistence health payload.",
            "PersistenceHealthResponse",
            publicReadHeaders,
          ),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/command-center/overview": {
      get: {
        tags: ["Public", "Proof"],
        summary: "Public proof overview",
        description:
          "Curated orchestrator-owned public proof overview. This is public proof, not protected control-plane state.",
        operationId: "getCommandCenterOverview",
        "x-openclaw-access": {
          visibility: "public",
          rateLimit: "30 requests / 60s / IP",
          responseCache: "public",
        },
        responses: {
          "200": jsonResponse(
            "Public proof overview payload.",
            "CommandCenterOverviewResponse",
            publicReadHeaders,
          ),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/command-center/control": {
      get: {
        tags: ["Public", "Proof"],
        summary: "Public control-lane proof cluster",
        description:
          "Curated public control-lane proof payload sourced from orchestrator runtime state.",
        operationId: "getCommandCenterControl",
        "x-openclaw-access": {
          visibility: "public",
          rateLimit: "30 requests / 60s / IP",
          responseCache: "public",
        },
        responses: {
          "200": jsonResponse(
            "Public proof control payload.",
            "CommandCenterControlResponse",
            publicReadHeaders,
          ),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/command-center/demand": {
      get: {
        tags: ["Public", "Proof"],
        summary: "Public demand summary snapshot",
        description:
          "Curated public demand summary sourced from live orchestrator demand state.",
        operationId: "getCommandCenterDemand",
        "x-openclaw-access": {
          visibility: "public",
          rateLimit: "30 requests / 60s / IP",
          responseCache: "public",
        },
        responses: {
          "200": jsonResponse(
            "Public demand summary payload.",
            "CommandCenterDemandResponse",
            publicReadHeaders,
          ),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/command-center/demand-live": {
      get: {
        tags: ["Public", "Proof"],
        summary: "Public live demand snapshot",
        description:
          "Live public demand snapshot sourced from current orchestrator runtime state.",
        operationId: "getCommandCenterDemandLive",
        "x-openclaw-access": {
          visibility: "public",
          rateLimit: "30 requests / 60s / IP",
          responseCache: "public",
        },
        responses: {
          "200": jsonResponse(
            "Public live demand payload.",
            "CommandCenterDemandResponse",
            publicReadHeaders,
          ),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/milestones/latest": {
      get: {
        tags: ["Public", "Proof"],
        summary: "Latest public milestone feed items",
        description: "Curated latest milestone proof feed.",
        operationId: "getMilestonesLatest",
        parameters: [parameterRef("MilestoneLimit")],
        "x-openclaw-access": {
          visibility: "public",
          rateLimit: "30 requests / 60s / IP",
          responseCache: "public",
        },
        responses: {
          "200": jsonResponse(
            "Latest milestone feed payload.",
            "MilestoneFeedResponse",
            publicReadHeaders,
          ),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/milestones/dead-letter": {
      get: {
        tags: ["Public", "Proof"],
        summary: "Public proof-risk feed",
        description:
          "Dead-letter or blocked proof-delivery items kept on the public proof side as a curated risk surface.",
        operationId: "getMilestonesDeadLetter",
        "x-openclaw-access": {
          visibility: "public",
          rateLimit: "30 requests / 60s / IP",
          responseCache: "public",
        },
        responses: {
          "200": jsonResponse(
            "Public milestone dead-letter payload.",
            "MilestoneDeadLetterResponse",
            publicReadHeaders,
          ),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/auth/me": {
      get: {
        tags: ["Operator", "Auth"],
        summary: "Resolved auth actor and role context",
        description:
          "Protected identity surface. Auth executes before role enforcement and returns the resolved actor, highest role, role set, request id, and API key metadata.",
        operationId: "getAuthContext",
        security: [{ bearerAuth: [] }],
        "x-openclaw-access": protectedAccess("viewer", "viewer-read", "auth.me.read"),
        responses: {
          "200": jsonResponse(
            "Authenticated actor and role context.",
            "AuthContextResponse",
            writeHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
        },
      },
    },
    "/api/tasks/catalog": {
      get: {
        tags: ["Operator", "Tasks"],
        summary: "Operator task catalog",
        description:
          "Protected task catalog that combines operator-facing task profiles with current operational metadata.",
        operationId: "getTaskCatalog",
        security: [{ bearerAuth: [] }],
        "x-openclaw-access": protectedAccess(
          "viewer",
          "viewer-read",
          "tasks.catalog.read",
        ),
        responses: {
          "200": jsonResponse(
            "Operator task catalog payload.",
            "TaskCatalogResponse",
            protectedReadHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/companion/overview": {
      get: {
        tags: ["Operator", "Companion"],
        summary: "Companion control-plane overview",
        description:
          "Bounded read-only companion view over current control-plane mode, primary operator move, pressure story, and proof posture.",
        operationId: "getCompanionOverview",
        security: [{ bearerAuth: [] }],
        "x-openclaw-access": {
          ...protectedAccess("viewer", "viewer-read", "companion.overview.read"),
          companionView: "status",
          responseCache: "protected",
        },
        responses: {
          "200": jsonResponse(
            "Companion overview payload.",
            "CompanionOverviewResponse",
            protectedReadHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/companion/catalog": {
      get: {
        tags: ["Operator", "Companion"],
        summary: "Companion task catalog",
        description:
          "Bounded read-only companion view over the operator task catalog with readiness, approval posture, and dependency caveats.",
        operationId: "getCompanionCatalog",
        security: [{ bearerAuth: [] }],
        "x-openclaw-access": {
          ...protectedAccess("viewer", "viewer-read", "companion.catalog.read"),
          companionView: "tasks",
          responseCache: "protected",
        },
        responses: {
          "200": jsonResponse(
            "Companion catalog payload.",
            "CompanionCatalogResponse",
            protectedReadHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/companion/incidents": {
      get: {
        tags: ["Operator", "Companion"],
        summary: "Companion incident summary",
        description:
          "Bounded read-only companion view over incident classification pressure, acknowledgement posture, remediation posture, and the ranked queue.",
        operationId: "getCompanionIncidents",
        security: [{ bearerAuth: [] }],
        parameters: [parameterRef("Limit")],
        "x-openclaw-access": {
          ...protectedAccess("viewer", "viewer-read", "companion.incidents.read"),
          companionView: "incidents",
          responseCache: "protected",
        },
        responses: {
          "200": jsonResponse(
            "Companion incident summary payload.",
            "CompanionIncidentsResponse",
            protectedReadHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/companion/runs": {
      get: {
        tags: ["Operator", "Companion"],
        summary: "Companion recent run briefs",
        description:
          "Bounded read-only companion view over recent run posture, operator summaries, next actions, and freshness/watch cues.",
        operationId: "getCompanionRuns",
        security: [{ bearerAuth: [] }],
        parameters: [parameterRef("Limit")],
        "x-openclaw-access": {
          ...protectedAccess("viewer", "viewer-read", "companion.runs.read"),
          companionView: "runs",
          responseCache: "protected",
        },
        responses: {
          "200": jsonResponse(
            "Companion recent runs payload.",
            "CompanionRunsResponse",
            protectedReadHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/companion/approvals": {
      get: {
        tags: ["Operator", "Companion"],
        summary: "Companion approval summary",
        description:
          "Bounded read-only companion view over dominant pending approval lanes, oldest waiting posture, and top approval items.",
        operationId: "getCompanionApprovals",
        security: [{ bearerAuth: [] }],
        parameters: [parameterRef("Limit")],
        "x-openclaw-access": {
          ...protectedAccess("operator", "viewer-read", "companion.approvals.read"),
          companionView: "approvals",
          responseCache: "protected",
        },
        responses: {
          "200": jsonResponse(
            "Companion approvals payload.",
            "CompanionApprovalsResponse",
            protectedReadHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/tasks/trigger": {
      post: {
        tags: ["Operator", "Tasks"],
        summary: "Queue a task for processing",
        description:
          "Protected task enqueue endpoint. Runtime injects `__actor`, `__role`, and `__requestId` into the queued payload before execution.",
        operationId: "triggerTask",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: schemaRef("TaskTriggerRequest"),
            },
          },
        },
        "x-openclaw-access": protectedAccess(
          "operator",
          "operator-write",
          "tasks.trigger.create",
        ),
        responses: {
          "202": jsonResponse(
            "Task accepted into the queue.",
            "TaskTriggerResponse",
            writeHeaders,
          ),
          "400": responseRef("BadRequest"),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/tasks/runs": {
      get: {
        tags: ["Operator", "Tasks"],
        summary: "Paginated task run records",
        description:
          "Protected run ledger with workflow, approval, proof-link, and repair metadata.",
        operationId: "listTaskRuns",
        security: [{ bearerAuth: [] }],
        parameters: [
          parameterRef("TaskRunType"),
          parameterRef("TaskRunStatus"),
          parameterRef("Limit"),
          parameterRef("Offset"),
        ],
        "x-openclaw-access": protectedAccess(
          "viewer",
          "viewer-read",
          "tasks.runs.read",
        ),
        responses: {
          "200": jsonResponse(
            "Paginated task run payload.",
            "TaskRunsResponse",
            protectedReadHeaders,
          ),
          "400": responseRef("BadRequest"),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/tasks/runs/{runId}": {
      get: {
        tags: ["Operator", "Tasks"],
        summary: "Task run detail",
        description:
          "Protected task run detail by stable run id (explicit idempotency key or task id fallback).",
        operationId: "getTaskRun",
        security: [{ bearerAuth: [] }],
        parameters: [parameterRef("RunId")],
        "x-openclaw-access": protectedAccess(
          "viewer",
          "viewer-read",
          "tasks.run.read",
        ),
        responses: {
          "200": jsonResponse(
            "Task run detail payload.",
            "TaskRunDetailResponse",
            protectedReadHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "404": responseRef("NotFound"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/approvals/pending": {
      get: {
        tags: ["Operator", "Approvals"],
        summary: "Pending approvals ledger",
        description:
          "Protected approval inbox for approval-gated tasks and review-gated replay paths.",
        operationId: "getPendingApprovals",
        security: [{ bearerAuth: [] }],
        "x-openclaw-access": protectedAccess(
          "operator",
          "viewer-read",
          "approvals.pending.read",
        ),
        responses: {
          "200": jsonResponse(
            "Pending approvals payload.",
            "PendingApprovalsResponse",
            protectedReadHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/approvals/{id}/decision": {
      post: {
        tags: ["Operator", "Approvals"],
        summary: "Submit an approval decision",
        description:
          "Protected approval decision route. An approved decision queues a replay task with `approvedFromTaskId` set.",
        operationId: "submitApprovalDecision",
        security: [{ bearerAuth: [] }],
        parameters: [parameterRef("ApprovalId")],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: schemaRef("ApprovalDecisionRequest"),
            },
          },
        },
        "x-openclaw-access": protectedAccess(
          "operator",
          "operator-write",
          "approvals.decision.write",
        ),
        responses: {
          "200": jsonResponse(
            "Approval decision accepted.",
            "ApprovalDecisionResponse",
            writeHeaders,
          ),
          "400": responseRef("BadRequest"),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
        },
      },
    },
    "/api/incidents": {
      get: {
        tags: ["Operator", "Incidents"],
        summary: "Paginated incident ledger",
        description:
          "Protected incident list over the runtime-generated incident ledger with status/classification filtering.",
        operationId: "listIncidents",
        security: [{ bearerAuth: [] }],
        parameters: [
          parameterRef("IncidentStatus"),
          parameterRef("IncidentClassification"),
          parameterRef("IncludeResolved"),
          parameterRef("Limit"),
          parameterRef("Offset"),
        ],
        "x-openclaw-access": protectedAccess(
          "viewer",
          "viewer-read",
          "incidents.read",
        ),
        responses: {
          "200": jsonResponse(
            "Incident list payload.",
            "IncidentsResponse",
            protectedReadHeaders,
          ),
          "400": responseRef("BadRequest"),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
        },
      },
    },
    "/api/incidents/{id}": {
      get: {
        tags: ["Operator", "Incidents"],
        summary: "Incident detail",
        description: "Protected incident detail by stable incident id.",
        operationId: "getIncident",
        security: [{ bearerAuth: [] }],
        parameters: [parameterRef("IncidentId")],
        "x-openclaw-access": protectedAccess(
          "viewer",
          "viewer-read",
          "incident.read",
        ),
        responses: {
          "200": jsonResponse(
            "Incident detail payload.",
            "IncidentDetailResponse",
            protectedReadHeaders,
          ),
          "400": responseRef("BadRequest"),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "404": responseRef("NotFound"),
          "429": responseRef("TooManyRequests"),
        },
      },
    },
    "/api/incidents/{id}/history": {
      get: {
        tags: ["Operator", "Incidents"],
        summary: "Incident lifecycle history",
        description:
          "Protected incident history stream with acknowledgements, ownership history, and remediation task records.",
        operationId: "getIncidentHistory",
        security: [{ bearerAuth: [] }],
        parameters: [parameterRef("IncidentId")],
        "x-openclaw-access": protectedAccess(
          "viewer",
          "viewer-read",
          "incident.history.read",
        ),
        responses: {
          "200": jsonResponse(
            "Incident history payload.",
            "IncidentHistoryResponse",
            protectedReadHeaders,
          ),
          "400": responseRef("BadRequest"),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "404": responseRef("NotFound"),
          "429": responseRef("TooManyRequests"),
        },
      },
    },
    "/api/incidents/{id}/acknowledge": {
      post: {
        tags: ["Operator", "Incidents"],
        summary: "Acknowledge an incident",
        description:
          "Protected incident acknowledgement route for operator action tracking.",
        operationId: "acknowledgeIncident",
        security: [{ bearerAuth: [] }],
        parameters: [parameterRef("IncidentId")],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: schemaRef("IncidentActionRequest"),
            },
          },
        },
        "x-openclaw-access": protectedAccess(
          "operator",
          "operator-write",
          "incidents.acknowledge.write",
        ),
        responses: {
          "200": jsonResponse(
            "Incident acknowledgement persisted.",
            "IncidentActionResponse",
            writeHeaders,
          ),
          "400": responseRef("BadRequest"),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
        },
      },
    },
    "/api/incidents/{id}/owner": {
      post: {
        tags: ["Operator", "Incidents"],
        summary: "Assign or update incident owner",
        description:
          "Protected incident ownership route for manual operator assignment.",
        operationId: "assignIncidentOwner",
        security: [{ bearerAuth: [] }],
        parameters: [parameterRef("IncidentId")],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: schemaRef("IncidentOwnerRequest"),
            },
          },
        },
        "x-openclaw-access": protectedAccess(
          "operator",
          "operator-write",
          "incidents.owner.write",
        ),
        responses: {
          "200": jsonResponse(
            "Incident owner persisted.",
            "IncidentActionResponse",
            writeHeaders,
          ),
          "400": responseRef("BadRequest"),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
        },
      },
    },
    "/api/incidents/{id}/remediate": {
      post: {
        tags: ["Operator", "Incidents"],
        summary: "Queue manual incident remediation",
        description:
          "Protected remediation entrypoint. Creates a bounded remediation task record linked to the incident and queues the actual task when allowed by policy.",
        operationId: "remediateIncident",
        security: [{ bearerAuth: [] }],
        parameters: [parameterRef("IncidentId")],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: schemaRef("IncidentRemediationRequest"),
            },
          },
        },
        "x-openclaw-access": protectedAccess(
          "operator",
          "operator-write",
          "incidents.remediate.write",
        ),
        responses: {
          "200": jsonResponse(
            "Manual remediation queued or persisted.",
            "IncidentRemediationResponse",
            writeHeaders,
          ),
          "400": responseRef("BadRequest"),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "404": responseRef("NotFound"),
          "429": responseRef("TooManyRequests"),
        },
      },
    },
    "/api/dashboard/overview": {
      get: {
        tags: ["Operator", "Health"],
        summary: "Protected dashboard overview",
        description:
          "Protected operator aggregation for queue, approvals, governance, self-healing, truth layers, topology, incidents, and recent tasks. This is not the authoritative system-health route.",
        operationId: "getDashboardOverview",
        security: [{ bearerAuth: [] }],
        "x-openclaw-access": protectedAccess(
          "viewer",
          "viewer-read",
          "dashboard.overview.read",
        ),
        responses: {
          "200": jsonResponse(
            "Dashboard overview payload.",
            "DashboardOverviewResponse",
            protectedReadHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/health/extended": {
      get: {
        tags: ["Operator", "Health"],
        summary: "Authoritative protected operator health",
        description:
          "Protected control-plane health contract with control-plane, worker, repair, dependency, truth-layer, topology, and incident splits.",
        operationId: "getExtendedHealth",
        security: [{ bearerAuth: [] }],
        "x-openclaw-access": protectedAccess(
          "viewer",
          "viewer-read",
          "health.extended.read",
        ),
        responses: {
          "200": jsonResponse(
            "Extended health payload.",
            "ExtendedHealthResponse",
            protectedReadHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/agents/overview": {
      get: {
        tags: ["Operator", "Agents"],
        summary: "Agent operational overview",
        description:
          "Protected agent readiness surface with declaration, worker/service truth, capability, topology, and relationship-history views.",
        operationId: "getAgentsOverview",
        security: [{ bearerAuth: [] }],
        "x-openclaw-access": protectedAccess(
          "viewer",
          "viewer-read",
          "agents.overview.read",
        ),
        responses: {
          "200": jsonResponse(
            "Agent overview payload.",
            "AgentsOverviewResponse",
            protectedReadHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/skills/registry": {
      get: {
        tags: ["Operator", "Governance"],
        summary: "Governed skill registry",
        description:
          "Protected governed-skill registry with trust posture, executability, persistence mode, executor binding, and provenance snapshot.",
        operationId: "getSkillsRegistry",
        security: [{ bearerAuth: [] }],
        "x-openclaw-access": protectedAccess(
          "viewer",
          "viewer-read",
          "skills.registry.read",
        ),
        responses: {
          "200": jsonResponse(
            "Governed skill registry payload.",
            "GovernedSkillRegistryResponse",
            protectedReadHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
        },
      },
    },
    "/api/skills/policy": {
      get: {
        tags: ["Operator", "Governance"],
        summary: "Governed skill policy posture",
        description:
          "Protected governed-skill policy summary derived from current orchestrator governance state.",
        operationId: "getSkillsPolicy",
        security: [{ bearerAuth: [] }],
        "x-openclaw-access": protectedAccess(
          "viewer",
          "viewer-read",
          "skills.policy.read",
        ),
        responses: {
          "200": jsonResponse(
            "Governed skill policy payload.",
            "GovernedSkillPolicyResponse",
            protectedReadHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
        },
      },
    },
    "/api/skills/telemetry": {
      get: {
        tags: ["Operator", "Governance"],
        summary: "Governed skill telemetry summary",
        description:
          "Protected ToolGate invocation summary over governed skill traffic.",
        operationId: "getSkillsTelemetry",
        security: [{ bearerAuth: [] }],
        "x-openclaw-access": protectedAccess(
          "viewer",
          "viewer-read",
          "skills.telemetry.read",
        ),
        responses: {
          "200": jsonResponse(
            "Governed skill telemetry payload.",
            "GovernedSkillTelemetryResponse",
            protectedReadHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/skills/audit": {
      get: {
        tags: ["Operator", "Governance"],
        summary: "Governed skill audit stream",
        description:
          "Protected paginated ToolGate/governed-skill audit stream. `deniedOnly=true` filters to denied invocations.",
        operationId: "getSkillsAudit",
        security: [{ bearerAuth: [] }],
        parameters: [
          parameterRef("SkillAuditLimit"),
          parameterRef("Offset"),
          parameterRef("DeniedOnly"),
        ],
        "x-openclaw-access": protectedAccess(
          "viewer",
          "viewer-read",
          "skills.audit.read",
        ),
        responses: {
          "200": jsonResponse(
            "Governed skill audit payload.",
            "GovernedSkillAuditResponse",
            protectedReadHeaders,
          ),
          "400": responseRef("BadRequest"),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/memory/recall": {
      get: {
        tags: ["Operator", "Memory"],
        summary: "Redacted per-agent memory recall",
        description:
          "Protected memory recall across persisted per-agent memory state. Responses are redacted by default unless `includeSensitive=true` is set.",
        operationId: "getMemoryRecall",
        security: [{ bearerAuth: [] }],
        parameters: [
          parameterRef("MemoryAgentId"),
          parameterRef("Limit"),
          parameterRef("Offset"),
          parameterRef("MemoryIncludeErrors"),
          parameterRef("MemoryIncludeSensitive"),
        ],
        "x-openclaw-access": protectedAccess(
          "viewer",
          "viewer-read",
          "memory.recall.read",
        ),
        responses: {
          "200": jsonResponse(
            "Memory recall payload.",
            "MemoryRecallResponse",
            protectedReadHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/knowledge/query": {
      post: {
        tags: ["Operator", "Knowledge"],
        summary: "Protected knowledge query",
        description:
          "Protected knowledge query with request-body validation, knowledge index results, and runtime freshness/provenance signals.",
        operationId: "queryKnowledge",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: schemaRef("KnowledgeQueryRequest"),
            },
          },
        },
        "x-openclaw-access": protectedAccess(
          "operator",
          "operator-write",
          "knowledge.query.read",
        ),
        responses: {
          "200": jsonResponse(
            "Knowledge query payload.",
            "KnowledgeQueryResponse",
            protectedReadHeaders,
          ),
          "400": responseRef("BadRequest"),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/knowledge/export": {
      get: {
        tags: ["Operator", "Knowledge"],
        summary: "Admin knowledge export",
        description:
          "Admin-only knowledge export. Runtime returns markdown by default and JSON when `format=json` is requested.",
        operationId: "exportKnowledge",
        security: [{ bearerAuth: [] }],
        parameters: [parameterRef("KnowledgeExportFormat")],
        "x-openclaw-access": protectedAccess(
          "admin",
          "admin-export",
          "knowledge.export.read",
        ),
        responses: {
          "200": {
            description: "Knowledge export payload.",
            headers: buildResponseHeaders(writeHeaders),
            content: {
              "application/json": {
                schema: schemaRef("GenericObject"),
              },
              "text/markdown": {
                schema: { type: "string" },
              },
            },
          },
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/persistence/historical": {
      get: {
        tags: ["Operator", "Persistence"],
        summary: "Historical persistence metrics",
        description:
          "Protected historical persistence data. Shape varies by persistence implementation and requested aggregation.",
        operationId: "getPersistenceHistorical",
        security: [{ bearerAuth: [] }],
        parameters: [parameterRef("PersistenceDays")],
        "x-openclaw-access": protectedAccess(
          "viewer",
          "viewer-read",
          "persistence.historical.read",
        ),
        responses: {
          "200": jsonResponse(
            "Historical persistence payload.",
            "PersistenceHistoricalResponse",
            protectedReadHeaders,
          ),
          "400": responseRef("BadRequest"),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/persistence/summary": {
      get: {
        tags: ["Operator", "Persistence"],
        summary: "Protected persistence operator summary",
        description:
          "Protected persistence summary with storage, collection, retention, and indicator slices.",
        operationId: "getPersistenceSummary",
        security: [{ bearerAuth: [] }],
        "x-openclaw-access": protectedAccess(
          "viewer",
          "viewer-read",
          "persistence.summary.read",
        ),
        responses: {
          "200": jsonResponse(
            "Persistence summary payload.",
            "PersistenceSummaryResponse",
            protectedReadHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/api/persistence/export": {
      get: {
        tags: ["Operator", "Persistence"],
        summary: "Admin persistence export",
        description:
          "Admin-only export of persistence data from the current runtime backend.",
        operationId: "exportPersistenceData",
        security: [{ bearerAuth: [] }],
        "x-openclaw-access": protectedAccess(
          "admin",
          "admin-export",
          "persistence.export.read",
        ),
        responses: {
          "200": jsonResponse(
            "Persistence export payload.",
            "GenericObject",
            writeHeaders,
          ),
          "401": responseRef("Unauthorized"),
          "403": responseRef("Forbidden"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
    "/webhook/alerts": {
      post: {
        tags: ["Webhook"],
        summary: "Alert ingestion webhook",
        description:
          "Signed AlertManager-style webhook. Uses HMAC verification rather than bearer authentication.",
        operationId: "postAlertWebhook",
        security: [{ webhookSignature: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: schemaRef("WebhookAlertsRequest"),
            },
          },
        },
        "x-openclaw-access": {
          visibility: "signed-ingest",
          rateLimit: "100 requests / 60s / IP",
          verification: "X-Webhook-Signature",
        },
        responses: {
          "200": jsonResponse(
            "Webhook accepted.",
            "WebhookAcceptedResponse",
            writeHeaders,
          ),
          "400": responseRef("BadRequest"),
          "401": responseRef("Unauthorized"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("ServerError"),
        },
      },
    },
  };

  return {
    openapi: "3.0.3",
    info: {
      title: "OpenClaw Orchestrator API",
      version: "1.0.0",
      description: [
        "Release-quality route contract for the current orchestrator-owned control plane.",
        "",
        "Runtime cutover truth:",
        "- `/operator` and `/operator/*` are served by orchestrator from the built `operator-s-console` bundle.",
        "- Public proof remains on orchestrator-owned public routes, not on the retired `openclawdbot` lane.",
        "",
        "Security and browser contract:",
        "- Protected routes require `Authorization: Bearer <token>`.",
        "- Browser CORS is backend-owned and deny-by-default via explicit origin allowlists.",
        "- Protected routes apply a pre-auth abuse guard (`300 / 60s / IP`) before role-aware limiter buckets.",
        "",
        "Rate-limit buckets:",
        "- viewer-read: `120 / 60s` per actor/key label",
        "- operator-write: `30 / 60s` per actor/key label",
        "- admin-export: `10 / 60s` per actor/key label",
        "",
        "This document describes the orchestrator JSON route contract; it does not model the `/operator` SPA shell itself as an API surface.",
      ].join("\n"),
    },
    servers: [{ url: baseUrl, description: "Current orchestrator process" }],
    tags: [
      { name: "Public", description: "Unauthenticated public read surfaces." },
      { name: "Operator", description: "Bearer-protected operator/control-plane surfaces." },
      { name: "Tasks", description: "Task catalog, queueing, and run-ledger surfaces." },
      { name: "Incidents", description: "Runtime incident ledger and remediation surfaces." },
      { name: "Health", description: "Health and dashboard aggregation surfaces." },
      { name: "Agents", description: "Per-agent readiness, capability, and topology surfaces." },
      { name: "Governance", description: "Governed skill registry, policy, telemetry, and audit surfaces." },
      { name: "Knowledge", description: "Knowledge summary, query, and export surfaces." },
      { name: "Persistence", description: "Persistence health, summary, historical, and export surfaces." },
      { name: "Proof", description: "Curated public proof surfaces served by orchestrator." },
      { name: "Auth", description: "Protected auth and RBAC context surfaces." },
      { name: "Approvals", description: "Approval inbox and decision surfaces." },
      { name: "Memory", description: "Protected memory recall surfaces." },
      { name: "Contract", description: "Machine-readable contract endpoints." },
      { name: "Webhook", description: "Signed ingest routes." },
    ],
    components,
    paths,
  };
}
