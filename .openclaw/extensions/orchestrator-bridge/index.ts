import {
  formatCompanionApprovals,
  formatCompanionIncidents,
  formatCompanionOverview,
  formatCompanionRuns,
  formatCompanionTaskList,
  formatHelp,
  normalizeBridgeConfig,
  orchestratorRequest,
  parseBridgeCommand,
  registerOperatorBridgeTools,
  resolveBridgeApiKey,
} from "./src/bridge.ts";

export default function registerOrchestratorBridge(api: any) {
  registerOperatorBridgeTools(api);

  api.registerCommand({
    name: "orch",
    description: "Read bounded companion views and trigger allowed orchestrator tasks",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx: any) => {
      try {
        const workspaceDir =
          typeof api.config?.agents?.defaults?.workspace === "string"
            ? api.config.agents.defaults.workspace
            : undefined;
        const config = normalizeBridgeConfig(api.pluginConfig, workspaceDir);
        const command = parseBridgeCommand(ctx.args, config);
        const apiKey = await resolveBridgeApiKey(config);

        if (!apiKey) {
          return {
            text: [
              "Orchestrator bridge is enabled but no operator API key was resolved.",
              "Set plugins.entries.orchestrator-bridge.config.apiKey,",
              "or plugins.entries.orchestrator-bridge.config.apiKeyEnv,",
              "or keep a valid operator key in orchestrator/.env.",
            ].join(" "),
          };
        }

        if (command.kind === "help") {
          return { text: formatHelp(config.allowedViews, config.allowedTasks) };
        }

        if (command.kind === "view" && command.view === "tasks") {
          const catalog = await orchestratorRequest({
            config,
            apiKey,
            pathname: "/api/companion/catalog",
          });
          return { text: formatCompanionTaskList(config.allowedTasks, catalog) };
        }

        if (command.kind === "view" && command.view === "status") {
          const overview = await orchestratorRequest({
            config,
            apiKey,
            pathname: "/api/companion/overview",
          });
          return { text: formatCompanionOverview(overview) };
        }

        if (command.kind === "view" && command.view === "incidents") {
          const incidents = await orchestratorRequest({
            config,
            apiKey,
            pathname: `/api/companion/incidents?limit=${command.limit ?? 8}`,
          });
          return { text: formatCompanionIncidents(incidents) };
        }

        if (command.kind === "view" && command.view === "runs") {
          const recentRuns = await orchestratorRequest({
            config,
            apiKey,
            pathname: `/api/companion/runs?limit=${command.limit ?? 5}`,
          });
          return { text: formatCompanionRuns(recentRuns) };
        }

        if (command.kind === "view" && command.view === "approvals") {
          const approvals = await orchestratorRequest({
            config,
            apiKey,
            pathname: `/api/companion/approvals?limit=${command.limit ?? 8}`,
          });
          return { text: formatCompanionApprovals(approvals) };
        }

        const queued = (await orchestratorRequest({
          config,
          apiKey,
          pathname: "/api/tasks/trigger",
          method: "POST",
          body: {
            type: command.taskType,
            payload: command.payload,
          },
        })) as Record<string, unknown>;

        const taskId = typeof queued.taskId === "string" ? queued.taskId : "unknown";
        const createdAt =
          typeof queued.createdAt === "string" ? queued.createdAt : "unknown";
        const payloadSummary =
          Object.keys(command.payload).length > 0
            ? ` payload keys: ${Object.keys(command.payload).join(", ")}`
            : "";

        return {
          text: `Queued ${command.taskType} as ${taskId} at ${createdAt}.${payloadSummary} Use /orch runs to watch the bounded run brief.`,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown bridge error";
        api.logger.warn(`[orchestrator-bridge] ${message}`);
        return { text: `Orchestrator bridge error: ${message}` };
      }
    },
  });
}
