import { describe, expect, it } from "vitest";

import { buildOpenApiSpec } from "../src/openapi.js";

describe("OpenAPI contract", () => {
  it("covers the current public proof and protected operator route families", () => {
    const spec = buildOpenApiSpec(3312) as any;

    expect(spec.paths["/api/command-center/overview"]?.get).toBeTruthy();
    expect(spec.paths["/api/command-center/control"]?.get).toBeTruthy();
    expect(spec.paths["/api/command-center/demand"]?.get).toBeTruthy();
    expect(spec.paths["/api/command-center/demand-live"]?.get).toBeTruthy();
    expect(spec.paths["/api/milestones/latest"]?.get).toBeTruthy();
    expect(spec.paths["/api/milestones/dead-letter"]?.get).toBeTruthy();

    expect(spec.paths["/api/incidents"]?.get).toBeTruthy();
    expect(spec.paths["/api/incidents/{id}"]?.get).toBeTruthy();
    expect(spec.paths["/api/incidents/{id}/history"]?.get).toBeTruthy();
    expect(spec.paths["/api/incidents/{id}/acknowledge"]?.post).toBeTruthy();
    expect(spec.paths["/api/incidents/{id}/owner"]?.post).toBeTruthy();
    expect(spec.paths["/api/incidents/{id}/remediate"]?.post).toBeTruthy();
    expect(spec.paths["/api/companion/overview"]?.get).toBeTruthy();
    expect(spec.paths["/api/companion/catalog"]?.get).toBeTruthy();
    expect(spec.paths["/api/companion/incidents"]?.get).toBeTruthy();
    expect(spec.paths["/api/companion/runs"]?.get).toBeTruthy();
    expect(spec.paths["/api/companion/approvals"]?.get).toBeTruthy();
  });

  it("captures role and limiter metadata for protected routes", () => {
    const spec = buildOpenApiSpec() as any;

    expect(spec.paths["/api/auth/me"].get.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.paths["/api/auth/me"].get["x-openclaw-access"]).toMatchObject({
      requiredRole: "viewer",
      rateLimitBucket: "viewer-read",
      action: "auth.me.read",
    });

    expect(
      spec.paths["/api/approvals/{id}/decision"].post["x-openclaw-access"],
    ).toMatchObject({
      requiredRole: "operator",
      rateLimitBucket: "operator-write",
      action: "approvals.decision.write",
    });

    expect(
      spec.paths["/api/persistence/export"].get["x-openclaw-access"],
    ).toMatchObject({
      requiredRole: "admin",
      rateLimitBucket: "admin-export",
      action: "persistence.export.read",
    });

    expect(
      spec.paths["/api/companion/overview"].get["x-openclaw-access"],
    ).toMatchObject({
      requiredRole: "viewer",
      rateLimitBucket: "viewer-read",
      action: "companion.overview.read",
      companionView: "status",
    });
  });

  it("documents request bodies and path/query parameters for live operator actions", () => {
    const spec = buildOpenApiSpec() as any;

    const triggerRequest =
      spec.paths["/api/tasks/trigger"].post.requestBody.content["application/json"]
        .schema;
    expect(triggerRequest.$ref).toBe("#/components/schemas/TaskTriggerRequest");
    expect(spec.components.schemas.TaskTriggerRequest.properties.type.enum).toContain(
      "build-refactor",
    );
    expect(spec.components.schemas.TaskTriggerRequest.properties.type.enum).not.toContain(
      "heartbeat",
    );
    expect(spec.components.schemas.TaskTriggerRequest.properties.type.enum).toEqual(
      expect.arrayContaining([
        "control-plane-brief",
        "incident-triage",
        "release-readiness",
      ]),
    );

    const remediationRequest =
      spec.paths["/api/incidents/{id}/remediate"].post.requestBody.content[
        "application/json"
      ].schema;
    expect(remediationRequest.$ref).toBe(
      "#/components/schemas/IncidentRemediationRequest",
    );
    expect(
      spec.components.schemas.IncidentRemediationRequest.properties.taskType.enum,
    ).toContain("build-refactor");

    const taskRunsParameters = spec.paths["/api/tasks/runs"].get.parameters.map(
      (parameter: any) => parameter.$ref,
    );
    expect(taskRunsParameters).toEqual(
      expect.arrayContaining([
        "#/components/parameters/TaskRunType",
        "#/components/parameters/TaskRunStatus",
        "#/components/parameters/IncludeInternal",
        "#/components/parameters/Limit",
        "#/components/parameters/Offset",
      ]),
    );

    const taskRunSchema = spec.components.schemas.TaskRun;
    expect(taskRunSchema.properties.model.type).toBe("string");
    expect(taskRunSchema.properties.cost.type).toBe("number");
    expect(taskRunSchema.properties.latency.type).toBe("number");
    expect(taskRunSchema.properties.accounting.$ref).toBe(
      "#/components/schemas/GenericObject",
    );

    const companionRunParameters = spec.paths["/api/companion/runs"].get.parameters.map(
      (parameter: any) => parameter.$ref,
    );
    expect(companionRunParameters).toEqual(
      expect.arrayContaining(["#/components/parameters/Limit"]),
    );
    expect(
      spec.paths["/api/runtime/facts"].get.responses["200"].content[
        "application/json"
      ].schema.$ref,
    ).toBe("#/components/schemas/RuntimeFactsResponse");
  });

  it("surfaces cutover, cors, and cache/rate-limit contract details in the spec", () => {
    const spec = buildOpenApiSpec(3312) as any;

    expect(spec.info.description).toContain("/operator` and `/operator/*`");
    expect(spec.info.description).toContain("deny-by-default");
    expect(spec.info.description).toContain("viewer-read");
    expect(spec.servers).toEqual([
      { url: "http://localhost:3312", description: "Current orchestrator process" },
    ]);

    const healthHeaders = spec.paths["/health"].get.responses["200"].headers;
    expect(healthHeaders["X-OpenClaw-Cache"].$ref).toBe(
      "#/components/headers/X-OpenClaw-Cache",
    );

    const taskRunsHeaders = spec.paths["/api/tasks/runs"].get.responses["200"].headers;
    expect(taskRunsHeaders["X-Request-Id"].$ref).toBe(
      "#/components/headers/X-Request-Id",
    );
    expect(taskRunsHeaders["ratelimit-limit"].$ref).toBe(
      "#/components/headers/ratelimit-limit",
    );
    expect(spec.components.responses.TooManyRequests.headers["Retry-After"].$ref).toBe(
      "#/components/headers/Retry-After",
    );
  });

  it("documents coordination health on the persistence surface", () => {
    const spec = buildOpenApiSpec() as any;

    const persistenceSchema = spec.components.schemas.PersistenceHealthResponse;
    expect(
      spec.paths["/api/persistence/health"].get.responses["200"].content[
        "application/json"
      ].schema.$ref,
    ).toBe("#/components/schemas/PersistenceHealthResponse");
    expect(persistenceSchema.properties.coordination.properties.store.enum).toEqual([
      "redis",
      "memory",
    ]);
    expect(persistenceSchema.properties.coordination.properties.status.enum).toEqual([
      "healthy",
      "degraded",
      "disabled",
      "unknown",
    ]);
  });
});
