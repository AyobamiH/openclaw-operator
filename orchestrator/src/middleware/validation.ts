import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

/**
 * Validation Schemas for API Endpoints
 * Protect against oversized payloads, invalid characters, and injection attacks
 */

// AlertManager Webhook Schema
export const AlertManagerWebhookSchema = z.object({
  alerts: z.array(
    z.object({
      status: z.enum(['firing', 'resolved']),
      labels: z.record(z.string(), z.string()).refine(
        (obj) => Object.keys(obj).length <= 50,
        'Too many labels (max 50)'
      ),
      annotations: z.record(z.string(), z.string()).optional(),
    })
  ).max(1000, 'Too many alerts in single webhook (max 1000)'),
  groupLabels: z.record(z.string(), z.string()).optional(),
  commonLabels: z.record(z.string(), z.string()).optional(),
  commonAnnotations: z.record(z.string(), z.string()).optional(),
});

// Knowledge Base Query Schema
export const KBQuerySchema = z.object({
  query: z.string()
    .min(1, 'Query is required')
    .max(5000, 'Query too long (max 5000 chars)')
    .regex(/^[a-zA-Z0-9\s\-\.\,\?\!\(\)\:\;\'\"\&]+$/, 'Query contains invalid characters'),
  limit: z.number().int().min(1).max(100).optional().default(10),
  filter: z.record(z.string(), z.any()).optional(),
});

// Knowledge Base Save Schema
export const KBSaveSchema = z.object({
  id: z.string().min(1).max(255),
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(50000),
  tags: z.array(z.string().max(50)).max(20).optional(),
  metadata: z.record(z.any()).optional(),
});

// Persistence Export Schema
export const PersistenceExportSchema = z.object({
  format: z.enum(['json', 'csv', 'markdown']).optional().default('json'),
  includeMetadata: z.boolean().optional().default(false),
});

// Persistence Historical Query Schema
export const PersistenceHistoricalSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(30),
  metric: z.string().max(255).optional(),
  aggregation: z.enum(['raw', 'hourly', 'daily']).optional().default('raw'),
});

export const TaskRunsQuerySchema = z.object({
  type: z.string().max(120).optional(),
  status: z.enum(['pending', 'running', 'success', 'failed', 'retrying']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).max(100000).optional().default(0),
});

export const TaskRunDetailParamsSchema = z.object({
  runId: z.string().min(1).max(255),
});

export const SkillsAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
  offset: z.coerce.number().int().min(0).max(100000).optional().default(0),
  deniedOnly: z.coerce.boolean().optional().default(false),
});

// Task trigger schema (orchestrator queue enqueue API)
export const TaskTriggerSchema = z.object({
  type: z.enum([
    'drift-repair',
    'control-plane-brief',
    'incident-triage',
    'release-readiness',
    'reddit-response',
    'security-audit',
    'summarize-content',
    'system-monitor',
    'build-refactor',
    'content-generate',
    'integration-workflow',
    'normalize-data',
    'market-research',
    'data-extraction',
    'qa-verification',
    'skill-audit',
    'rss-sweep',
    'nightly-batch',
    'send-digest',
    'heartbeat',
    'agent-deploy',
    'doc-sync',
  ]),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

export const ApprovalDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  actor: z.string().min(1).max(120).optional(),
  note: z.string().max(1000).optional(),
});

export const IncidentAcknowledgeSchema = z.object({
  actor: z.string().min(1).max(120).optional(),
  note: z.string().max(1000).optional(),
});

export const IncidentOwnerSchema = z.object({
  owner: z.string().min(1).max(120),
  actor: z.string().min(1).max(120).optional(),
  note: z.string().max(1000).optional(),
});

export const IncidentListQuerySchema = z.object({
  status: z.enum(['active', 'watching', 'resolved']).optional(),
  classification: z.enum([
    'runtime-mode',
    'persistence',
    'proof-delivery',
    'repair',
    'retry-recovery',
    'knowledge',
    'service-runtime',
    'approval-backlog',
  ]).optional(),
  includeResolved: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).max(100000).optional().default(0),
});

export const IncidentDetailParamsSchema = z.object({
  id: z.string().min(1).max(255),
});

export const IncidentRemediationSchema = z.object({
  actor: z.string().min(1).max(120).optional(),
  note: z.string().max(1000).optional(),
  taskType: z.enum([
    'drift-repair',
    'build-refactor',
    'qa-verification',
    'system-monitor',
  ]).optional(),
});

/**
 * Middleware Factory: Validate Request Body or Query
 * @param schema - Zod schema to validate against
 * @param source - 'body' or 'query'
 */
export function createValidationMiddleware(
  schema: z.ZodSchema,
  source: 'body' | 'query' = 'body'
) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const dataToValidate = source === 'body' ? req.body : req.query;
      const validated = schema.parse(dataToValidate);

      if (source === 'body') {
        req.body = validated;
      } else {
        req.query = validated as any;
      }

      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
        }));
        console.warn('[VALIDATION] Schema validation failed', { issues });
        return res.status(400).json({
          error: 'Validation failed',
          details: issues,
        });
      }
      next(error);
    }
  };
}

/**
 * Content-Length Validation Middleware
 * Prevent oversized payloads that could cause DoS
 */
export function validateContentLength(maxSizeBytes = 1024 * 1024) {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.get('content-length') || '0', 10);

    if (contentLength > maxSizeBytes) {
      console.warn('[VALIDATION] Content too large', {
        received: contentLength,
        max: maxSizeBytes,
      });
      return res.status(413).json({
        error: `Payload too large (max ${maxSizeBytes} bytes)`,
      });
    }

    next();
  };
}
