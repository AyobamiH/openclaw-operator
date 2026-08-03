import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { auditProtectedAction, requireBearerToken, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { authLimiter, operatorWriteLimiter, viewerReadLimiter } from "../middleware/rate-limit.js";
import { GraphApprovalDecisionSchema, GraphDefinitionSchema, GraphReconcileEffectSchema, GraphRunIdParamsSchema, GraphRunListQuerySchema, IssueOneRunLiveCapabilitySchema, RevokeOneRunLiveCapabilitySchema, StartGraphRunSchema, validateGraphDefinition } from "./schema.js";
import type { GraphRuntime } from "./runtime.js";
import { sha256 } from "./reducer.js";
import type { JsonValue } from "./types.js";
import { formatTelegramGraphSummary } from "./summary.js";
import { issueOneRunLiveCapability } from "./live-capability.js";
import { graphRunsActive, graphSchedulerLastSuccess, graphSchedulerOwnership, graphSchedulerTriggers } from "./metrics.js";

function schedulerHealth(runtime: GraphRuntime): Record<string, unknown> {
  const migrations = runtime.scheduler.migrations();
  const triggers = runtime.scheduler.triggers();
  for (const migration of migrations) {
    graphSchedulerOwnership.set({ migration: migration.migrationId, owner: "graph_runtime" }, migration.status === "graph_owned" ? 1 : 0);
    graphSchedulerOwnership.set({ migration: migration.migrationId, owner: "legacy" }, migration.status === "graph_owned" ? 0 : 1);
    for (const [status, count] of Object.entries(runtime.scheduler.counts())) graphSchedulerTriggers.set({ migration: migration.migrationId, status }, count);
    const last = triggers.filter((item) => item.migrationId === migration.migrationId && item.status === "completed").at(-1);
    if (last?.completedAt) graphSchedulerLastSuccess.set({ migration: migration.migrationId }, Date.parse(last.completedAt) / 1000);
  }
  return {
    schemaVersion: 1,
    migrations: migrations.length,
    graphOwned: migrations.filter((item) => item.status === "graph_owned").length,
    activeTriggers: triggers.filter((item) => ["reserved", "preparing", "executing", "ambiguous"].includes(item.status)).length,
    completedTriggers: triggers.filter((item) => item.status === "completed").length,
    failedSafeTriggers: triggers.filter((item) => item.status === "failed_safe").length,
  };
}

function actor(req: Request): string {
  return (req as AuthenticatedRequest).auth?.actor ?? "authenticated-operator";
}

function errorResponse(res: Response, error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status = /not_found/.test(message) ? 404 : /conflict|immutable|terminal|mismatch/.test(message) ? 409 : /approval|authority/.test(message) ? 403 : 400;
  return res.status(status).json({ error: message });
}

export function registerGraphRoutes(app: Express, runtime: GraphRuntime): void {
  app.get("/api/graphs/health", authLimiter, requireBearerToken, viewerReadLimiter, requireRole("viewer"), auditProtectedAction("graphs.health.read"), (_req, res) => {
    const runs = runtime.store.listRuns({ limit: 250 });
    for (const definition of runtime.registry.list()) graphRunsActive.set({ graph: definition.graphId, version: definition.version }, runtime.store.activeRunCount(definition.graphId, definition.version));
    runtime.store.expireOneRunLiveCapabilities();
    const capabilities = runtime.store.oneRunLiveCapabilities();
    res.json({ status: "healthy", schemaVersion: runtime.store.schemaVersion(), zeroWriteOnly: runtime.zeroWriteOnly, definitions: runtime.registry.list().length, active: runs.filter((run) => run.status === "running").length, waiting: runs.filter((run) => run.status === "waiting" || run.status === "waiting_for_approval").length, blocked: runs.filter((run) => run.status === "blocked").length, activeLiveCapabilities: capabilities.filter((capability) => capability.status === "prepared" || capability.status === "active").length, consumedLiveCapabilities: capabilities.filter((capability) => capability.status === "consumed").length, ambiguousEffects: runs.flatMap((run) => runtime.store.externalEffects(run.runId)).filter((effect) => effect.state === "ambiguous").length, scheduler: schedulerHealth(runtime), recovery: runtime.recovery });
  });

  app.get("/api/graphs/scheduler-migrations", authLimiter, requireBearerToken, viewerReadLimiter, requireRole("viewer"), auditProtectedAction("graphs.scheduler-migrations.read"), (_req, res) => res.json({ items: runtime.scheduler.migrations().map((migration) => ({ ...migration, legacyJob: undefined, graphJob: undefined, triggerCount: runtime.scheduler.triggers(migration.migrationId).length, eventChainValid: runtime.scheduler.eventChainValid(migration.migrationId) })) }));
  app.get("/api/graphs/scheduler-migrations/:migrationId", authLimiter, requireBearerToken, viewerReadLimiter, requireRole("viewer"), auditProtectedAction("graphs.scheduler-migration.read"), (req, res) => {
    const migration = runtime.scheduler.migration(String(req.params.migrationId));
    return migration ? res.json({ migration: { ...migration, legacyJob: undefined, graphJob: undefined }, triggers: runtime.scheduler.triggers(migration.migrationId), eventChainValid: runtime.scheduler.eventChainValid(migration.migrationId) }) : res.status(404).json({ error: "graph_scheduler_migration_not_found" });
  });

  app.get("/api/graphs/definitions", authLimiter, requireBearerToken, viewerReadLimiter, requireRole("viewer"), auditProtectedAction("graphs.definitions.read"), (_req, res) => res.json({ items: runtime.registry.list() }));
  app.get("/api/graphs/adapters", authLimiter, requireBearerToken, viewerReadLimiter, requireRole("viewer"), auditProtectedAction("graphs.adapters.read"), (_req, res) => res.json({ items: runtime.adapters.list() }));
  app.post("/api/graphs/definitions/validate", authLimiter, requireBearerToken, operatorWriteLimiter, requireRole("operator"), auditProtectedAction("graphs.definitions.validate"), (req, res) => {
    const parsed = GraphDefinitionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ valid: false, issues: parsed.error.issues });
    try {
      const definition = validateGraphDefinition(parsed.data);
      return res.json({ valid: true, definitionHash: sha256(definition) });
    } catch (error) {
      return errorResponse(res, error);
    }
  });
  app.post("/api/graphs/definitions/register", authLimiter, requireBearerToken, operatorWriteLimiter, requireRole("admin"), auditProtectedAction("graphs.definitions.register"), (req, res) => {
    try { return res.status(201).json({ definition: runtime.engine.register(req.body) }); } catch (error) { return errorResponse(res, error); }
  });

  app.post("/api/graphs/runs", authLimiter, requireBearerToken, operatorWriteLimiter, requireRole("operator"), auditProtectedAction("graphs.runs.start"), async (req, res) => {
    const parsed = StartGraphRunSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    try {
      const run = runtime.engine.start({ ...parsed.data, input: parsed.data.input as Record<string, JsonValue> });
      const settled = await runtime.engine.runUntilSettled(run.runId);
      return res.status(201).json({ run: settled });
    } catch (error) { return errorResponse(res, error); }
  });

  app.get("/api/graphs/runs", authLimiter, requireBearerToken, viewerReadLimiter, requireRole("viewer"), auditProtectedAction("graphs.runs.read"), (req, res) => {
    const parsed = GraphRunListQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return res.json({ items: runtime.store.listRuns(parsed.data) });
  });

  app.get("/api/graphs/runs/:runId", authLimiter, requireBearerToken, viewerReadLimiter, requireRole("viewer"), auditProtectedAction("graphs.run.read"), (req, res) => {
    const parsed = GraphRunIdParamsSchema.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ error: "validation_error" });
    const run = runtime.store.getRun(parsed.data.runId);
    const capability = run ? runtime.store.oneRunLiveCapabilityForRun(run.runId) : null;
    return run ? res.json({
      run,
      approvals: runtime.store.approvals(run.runId),
      liveCapability: capability,
      liveCapabilityDispatches: capability ? runtime.store.liveCapabilityDispatches(capability.capabilityId) : [],
      externalEffects: runtime.store.externalEffects(run.runId),
      childRunReceipts: runtime.store.childRunReceipts(run.runId),
      verifierReceipts: runtime.store.verifierReceipts(run.runId),
      eventChainValid: runtime.store.verifyEventChain(run.runId),
      childRunReceiptChainValid: runtime.store.verifyChildRunReceiptChain(run.runId),
      telegramSummary: formatTelegramGraphSummary(run),
    }) : res.status(404).json({ error: "graph_run_not_found" });
  });
  app.get("/api/graphs/runs/:runId/events", authLimiter, requireBearerToken, viewerReadLimiter, requireRole("viewer"), auditProtectedAction("graphs.events.read"), (req, res) => res.json({ items: runtime.store.events(String(req.params.runId)), chainValid: runtime.store.verifyEventChain(String(req.params.runId)) }));
  app.get("/api/graphs/runs/:runId/evidence", authLimiter, requireBearerToken, viewerReadLimiter, requireRole("viewer"), auditProtectedAction("graphs.evidence.read"), (req, res) => res.json({ items: runtime.store.evidence(String(req.params.runId)) }));

  for (const action of ["pause", "resume", "cancel"] as const) {
    app.post(`/api/graphs/runs/:runId/${action}`, authLimiter, requireBearerToken, operatorWriteLimiter, requireRole("operator"), auditProtectedAction(`graphs.runs.${action}`), (req, res) => {
      try { return res.json({ run: runtime.engine[action](String(req.params.runId), actor(req)) }); } catch (error) { return errorResponse(res, error); }
    });
  }

  app.post("/api/graphs/runs/:runId/step", authLimiter, requireBearerToken, operatorWriteLimiter, requireRole("operator"), auditProtectedAction("graphs.runs.step"), async (req, res) => {
    try { return res.json({ run: await runtime.engine.step(String(req.params.runId), `api:${actor(req)}`) }); } catch (error) { return errorResponse(res, error); }
  });
  app.post("/api/graphs/runs/:runId/execute", authLimiter, requireBearerToken, operatorWriteLimiter, requireRole("operator"), auditProtectedAction("graphs.runs.execute"), async (req, res) => {
    try { return res.json({ run: await runtime.engine.runUntilSettled(String(req.params.runId), 250, `api:${actor(req)}`) }); } catch (error) { return errorResponse(res, error); }
  });
  app.post("/api/graphs/runs/:runId/checkpoints/:checkpointId/retry", authLimiter, requireBearerToken, operatorWriteLimiter, requireRole("operator"), auditProtectedAction("graphs.runs.checkpoint-retry"), (req, res) => {
    try { return res.json({ run: runtime.engine.retryFromCheckpoint(String(req.params.runId), String(req.params.checkpointId), actor(req)) }); } catch (error) { return errorResponse(res, error); }
  });

  app.post("/api/graphs/runs/:runId/approvals/:approvalId", authLimiter, requireBearerToken, operatorWriteLimiter, requireRole("operator"), auditProtectedAction("graphs.approvals.decide"), (req, res) => {
    const parsed = GraphApprovalDecisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    const approval = runtime.store.approvals(String(req.params.runId)).find((item) => item.approvalId === req.params.approvalId);
    if (!approval) return res.status(404).json({ error: "graph_approval_not_found" });
    if (approval.action !== parsed.data.action || approval.target !== parsed.data.target || approval.payloadHash !== parsed.data.payloadHash) return res.status(409).json({ error: "graph_approval_binding_mismatch" });
    try { return res.json({ approval: runtime.engine.decideApproval(String(req.params.runId), String(req.params.approvalId), parsed.data.decision, actor(req), parsed.data.expiresAt, parsed.data.note) }); } catch (error) { return errorResponse(res, error); }
  });

  app.post("/api/graphs/runs/:runId/live-capabilities", authLimiter, requireBearerToken, operatorWriteLimiter, requireRole("admin"), auditProtectedAction("graphs.live-capabilities.issue"), (req, res) => {
    const parsed = IssueOneRunLiveCapabilitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    try {
      const capability = issueOneRunLiveCapability({
        store: runtime.store,
        runId: String(req.params.runId),
        approvalId: parsed.data.approvalId,
        issuedBy: actor(req),
        expiresAt: parsed.data.expiresAt,
        notBefore: parsed.data.notBefore,
        globalZeroWrite: runtime.zeroWriteOnly,
      });
      return res.status(201).json({ capability, dispatches: runtime.store.liveCapabilityDispatches(capability.capabilityId) });
    } catch (error) { return errorResponse(res, error); }
  });

  app.post("/api/graphs/runs/:runId/live-capabilities/:capabilityId/revoke", authLimiter, requireBearerToken, operatorWriteLimiter, requireRole("admin"), auditProtectedAction("graphs.live-capabilities.revoke"), (req, res) => {
    const parsed = RevokeOneRunLiveCapabilitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    const capability = runtime.store.oneRunLiveCapability(String(req.params.capabilityId));
    if (!capability || capability.graphRunId !== String(req.params.runId)) return res.status(404).json({ error: "one_run_live_capability_not_found" });
    try { return res.json({ capability: runtime.store.revokeOneRunLiveCapability(capability.capabilityId, actor(req), parsed.data.reason) }); } catch (error) { return errorResponse(res, error); }
  });

  app.post("/api/graphs/runs/:runId/effects/reconcile", authLimiter, requireBearerToken, operatorWriteLimiter, requireRole("operator"), auditProtectedAction("graphs.effects.reconcile"), (req, res) => {
    const parsed = GraphReconcileEffectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    try { return res.json({ effect: runtime.engine.reconcileEffect(String(req.params.runId), parsed.data.effectId, parsed.data.observedState, parsed.data.providerOperationId, parsed.data.evidenceRefs, actor(req)) }); } catch (error) { return errorResponse(res, error); }
  });

  app.get("/api/graphs/blocked", authLimiter, requireBearerToken, viewerReadLimiter, requireRole("viewer"), auditProtectedAction("graphs.blocked.read"), (_req, res) => res.json({ items: runtime.store.listRuns({ status: "blocked", limit: 250 }) }));
  app.get("/api/graphs/orphaned", authLimiter, requireBearerToken, viewerReadLimiter, requireRole("viewer"), auditProtectedAction("graphs.orphaned.read"), (_req, res) => res.json({ items: runtime.store.activeAttempts().filter((attempt) => Date.parse(attempt.leaseExpiresAt) <= Date.now()) }));
  app.post("/api/graphs/recover", authLimiter, requireBearerToken, operatorWriteLimiter, requireRole("operator"), auditProtectedAction("graphs.recover"), (_req, res) => res.json({ recoveryId: `grec_${randomUUID()}`, result: runtime.engine.recover(new Date(), actor(_req)) }));
}
