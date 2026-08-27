import type { Express, Request, Response, RequestHandler } from "express";
import type { KnowledgeRoutingRuntime } from "./index.js";

export interface KnowledgeRoutingRouteGuards {
  publicRead?: RequestHandler[];
  protectedRead?: RequestHandler[];
  protectedWrite?: RequestHandler[];
}

export function registerKnowledgeRoutingRoutes(
  app: Express,
  runtime: KnowledgeRoutingRuntime,
  guards: KnowledgeRoutingRouteGuards = {},
): void {
  const publicRead = guards.publicRead ?? [];
  const protectedRead = guards.protectedRead ?? [];
  const protectedWrite = guards.protectedWrite ?? protectedRead;

  app.get("/api/knowledge-routing/summary", ...publicRead, (_req: Request, res: Response) => {
    const graph = runtime.getGraph();
    res.json({
      schemaVersion: graph.schemaVersion,
      generatedAt: graph.generatedAt,
      stats: graph.stats,
      status: graph.stats.staleRoutes > 0 ? "stale-routes-present" : "ok",
    });
  });

  app.get("/api/knowledge-routing/graph", ...protectedRead, (_req: Request, res: Response) => {
    res.json(runtime.getGraph());
  });

  app.get("/api/knowledge-routing/maps", ...protectedRead, (_req: Request, res: Response) => {
    res.json(runtime.getMaps());
  });

  app.get("/api/knowledge-routing/evaluation", ...protectedRead, (_req: Request, res: Response) => {
    res.json(runtime.evaluate());
  });

  app.get("/api/knowledge-routing/route", ...protectedRead, (req: Request, res: Response) => {
    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (!query) {
      res.status(400).json({ error: "query is required" });
      return;
    }
    const limit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : undefined;
    res.json(runtime.resolve(query, Number.isFinite(limit) ? limit : undefined));
  });

  app.post("/api/knowledge-routing/refresh", ...protectedWrite, async (_req: Request, res: Response) => {
    try {
      const graph = await runtime.refresh();
      res.json({ ok: true, generatedAt: graph.generatedAt, stats: graph.stats });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/knowledge-routing/shadow", ...protectedWrite, async (req: Request, res: Response) => {
    const informationNeed = typeof req.body?.informationNeed === "string" ? req.body.informationNeed.trim() : "";
    if (!informationNeed) {
      res.status(400).json({ error: "informationNeed is required" });
      return;
    }
    const existingSourceUsed =
      typeof req.body?.existingSourceUsed === "string" ? req.body.existingSourceUsed.trim() : undefined;
    try {
      res.json(await runtime.shadowCompare(informationNeed, existingSourceUsed));
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
