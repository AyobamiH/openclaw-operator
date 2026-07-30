import type { Express } from "express";
import {
  auditProtectedAction,
  requireBearerToken,
  requireRole,
} from "../middleware/auth.js";
import {
  authLimiter,
  operatorWriteLimiter,
  viewerReadLimiter,
} from "../middleware/rate-limit.js";
import type { DeterministicPublishingEngine } from "./engine.js";

function boundedLimit(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

export function registerPublishingRoutes(
  app: Express,
  engine: DeterministicPublishingEngine | null,
): void {
  app.get(
    "/api/publishing/overview",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("publishing.overview.read"),
    (_req, res) => {
      if (!engine) {
        return res.status(503).json({
          error: "Deterministic publishing harness is not configured",
        });
      }
      return res.json({
        generatedAt: new Date().toISOString(),
        ...engine.overview(),
      });
    },
  );

  app.get(
    "/api/publishing/slots",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("publishing.slots.read"),
    (req, res) => {
      if (!engine) {
        return res.status(503).json({
          error: "Deterministic publishing harness is not configured",
        });
      }
      const limit = boundedLimit(req.query.limit, 50, 250);
      return res.json({
        generatedAt: new Date().toISOString(),
        items: engine.store.slotRuns(limit),
      });
    },
  );

  app.get(
    "/api/publishing/publications",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("publishing.publications.read"),
    (req, res) => {
      if (!engine) {
        return res.status(503).json({
          error: "Deterministic publishing harness is not configured",
        });
      }
      const limit = boundedLimit(req.query.limit, 50, 250);
      return res.json({
        generatedAt: new Date().toISOString(),
        items: engine.store.publications(limit),
      });
    },
  );

  app.get(
    "/api/publishing/audit",
    authLimiter,
    requireBearerToken,
    viewerReadLimiter,
    requireRole("viewer"),
    auditProtectedAction("publishing.audit.read"),
    (req, res) => {
      if (!engine) {
        return res.status(503).json({
          error: "Deterministic publishing harness is not configured",
        });
      }
      const limit = boundedLimit(req.query.limit, 100, 500);
      return res.json({
        generatedAt: new Date().toISOString(),
        chainValid: engine.store.auditChainValid(),
        items: engine.store.auditEvents(limit),
      });
    },
  );

  app.post(
    "/api/publishing/slots/plan",
    authLimiter,
    requireBearerToken,
    operatorWriteLimiter,
    requireRole("operator"),
    auditProtectedAction("publishing.slots.plan"),
    (req, res) => {
      if (!engine) {
        return res.status(503).json({
          error: "Deterministic publishing harness is not configured",
        });
      }
      const scheduledFor = new Date(req.body?.scheduledFor);
      if (Number.isNaN(scheduledFor.getTime())) {
        return res.status(400).json({ error: "scheduledFor must be an ISO timestamp" });
      }
      const platformId =
        typeof req.body?.platformId === "string" ? req.body.platformId : undefined;
      const accountId =
        typeof req.body?.accountId === "string" ? req.body.accountId : undefined;
      try {
        const plan = engine.planSlot({
          scheduledFor,
          platformId,
          accountId,
          now: new Date(),
        });
        return res.status(plan.result === "reserved" ? 201 : 200).json(plan);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = /UNIQUE constraint|already/i.test(message) ? 409 : 400;
        return res.status(status).json({ error: message });
      }
    },
  );
}
