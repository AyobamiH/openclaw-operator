import type { GraphStore } from "./store.js";
import type { GraphRunState } from "./types.js";

export type GraphSingleFlightKey = {
  graphId: string;
  graphVersion: string;
  lane: string;
  taskType: string;
  agentId: string;
};

export function findEquivalentLiveGraphRun(
  store: GraphStore,
  key: GraphSingleFlightKey,
  now = new Date(),
): GraphRunState | null {
  return store.listRuns({ graphId: key.graphId, limit: 250 }).find((run) =>
    run.graphVersion === key.graphVersion
    && run.input.lane === key.lane
    && run.input.taskType === key.taskType
    && run.input.agentId === key.agentId
    && store.hasLiveCurrentAttempt(run.runId, now)
  ) ?? null;
}
