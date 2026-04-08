import { describe, expect, it } from "vitest";

import {
  assertSpawnedAgentReportedSuccess,
  isTaskFailureRetryable,
} from "../src/taskHandlers.ts";

describe("spawned agent failure classification", () => {
  it("surfaces build-refactor refusal detail and marks it non-retryable", () => {
    let captured: unknown;

    try {
      assertSpawnedAgentReportedSuccess(
        {
          success: false,
          summary: {
            improvementDescription:
              "No supported autonomous patch synthesis candidates were found inside orchestrator/src. Resubmit with explicit changes[] or narrow the scope to a supported repository pattern.",
          },
          refusalProfile: {
            refused: true,
            reasons: [
              "No supported autonomous patch synthesis candidates were found inside orchestrator/src. Resubmit with explicit changes[] or narrow the scope to a supported repository pattern.",
            ],
          },
          specialistContract: {
            status: "refused",
            refusalReason:
              "No supported autonomous patch synthesis candidates were found inside orchestrator/src. Resubmit with explicit changes[] or narrow the scope to a supported repository pattern.",
          },
        },
        "build-refactor",
      );
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toContain(
      "No supported autonomous patch synthesis candidates were found inside orchestrator/src.",
    );
    expect(isTaskFailureRetryable(captured)).toBe(false);
  });

  it("keeps warning-only failures retryable", () => {
    let captured: unknown;

    try {
      assertSpawnedAgentReportedSuccess(
        {
          success: false,
          warnings: ["permission denied"],
        },
        "summarization",
      );
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toContain("permission denied");
    expect(isTaskFailureRetryable(captured)).toBe(true);
  });
});
