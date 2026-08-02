import type { GraphRunState } from "./types.js";

export function formatTelegramGraphSummary(run: GraphRunState): string {
  const evidenceSummary = run.assertions.length > 0
    ? run.assertions.map((assertion) => `${assertion.assertionId}: ${assertion.status}`).join(", ")
    : `${run.evidence.length} evidence item(s)`;
  const authority = run.status === "waiting_for_approval" ? `\nRequested authority: ${run.authority.maximum}` : "";
  return [
    `Graph: ${run.graphId}/v${run.graphVersion}`,
    `Run: ${run.runId}`,
    `Status: ${run.status}`,
    `Current node: ${run.currentNodeId ?? "none"}`,
    `Evidence: ${evidenceSummary}${authority}`,
  ].join("\n");
}

