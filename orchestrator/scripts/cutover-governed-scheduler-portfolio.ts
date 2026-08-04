import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { GraphSchedulerStore } from "../src/graph/scheduler-store.js";
import { buildGovernedGraphJob, GOVERNED_SCHEDULER_PORTFOLIO } from "../src/graph/scheduler-portfolio.js";

type CronJob = Record<string, unknown> & {
  id: string;
  declarationKey: string;
  displayName?: string;
  name?: string;
  description?: string;
  enabled: boolean;
  schedule: Record<string, unknown>;
  payload: Record<string, unknown> & { kind: string };
  delivery?: Record<string, unknown>;
};

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value) throw new Error("graph_scheduler_cutover_invalid_arguments");
  args.set(key, value);
}

const action = args.get("--action");
const backupDirectory = args.get("--backup-directory");
const schedulerDatabasePath = process.env.OPENCLAW_GRAPH_SCHEDULER_DATABASE_PATH?.trim();
const openclawBin = process.env.OPENCLAW_BIN?.trim() || "/home/oneclickwebsitedesignfactory/.nvm/versions/node/v24.18.0/bin/openclaw";
const triggerScript = new URL("./trigger-governed-graph-schedule.ts", import.meta.url).pathname;

if (!action || !["prepare", "cutover", "verify", "rollback"].includes(action)) throw new Error("graph_scheduler_cutover_action_invalid");
if (!backupDirectory || !isAbsolute(backupDirectory)) throw new Error("graph_scheduler_cutover_requires_absolute_backup_directory");
if (!schedulerDatabasePath || !isAbsolute(schedulerDatabasePath)) throw new Error("graph_scheduler_cutover_requires_absolute_scheduler_database");
if (process.env.OPENCLAW_GRAPH_ZERO_WRITE_ONLY !== "true") throw new Error("graph_scheduler_cutover_requires_global_zero_write");
if (existsSync(backupDirectory) && (lstatSync(backupDirectory).isSymbolicLink() || !lstatSync(backupDirectory).isDirectory())) throw new Error("graph_scheduler_cutover_backup_directory_invalid");
mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
chmodSync(backupDirectory, 0o700);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(",")}}`;
  return JSON.stringify(value);
}

function getJob(id: string): CronJob {
  const output = execFileSync(openclawBin, ["cron", "get", id], { encoding: "utf8", timeout: 60_000, maxBuffer: 2_000_000 });
  const job = JSON.parse(output) as CronJob;
  if (job.id !== id || typeof job.declarationKey !== "string" || typeof job.payload?.kind !== "string") throw new Error(`graph_scheduler_cutover_job_readback_invalid:${id}`);
  return job;
}

function commandEditArguments(job: CronJob): string[] {
  const payload = job.payload;
  const edit = ["cron", "edit", job.id, "--name", String(job.displayName ?? job.name ?? job.id), "--description", String(job.description ?? "")];
  if (payload.kind === "command") {
    const argv = payload.argv;
    if (!Array.isArray(argv) || !argv.every((value) => typeof value === "string") || !argv.length) throw new Error(`graph_scheduler_cutover_command_invalid:${job.id}`);
    edit.push("--command-argv", JSON.stringify(argv));
    if (typeof payload.cwd === "string") edit.push("--command-cwd", payload.cwd);
    if (Number.isInteger(payload.noOutputTimeoutSeconds)) edit.push("--no-output-timeout-seconds", String(payload.noOutputTimeoutSeconds));
    if (Number.isInteger(payload.outputMaxBytes)) edit.push("--output-max-bytes", String(payload.outputMaxBytes));
    if (Number.isInteger(payload.timeoutSeconds)) edit.push("--timeout-seconds", String(payload.timeoutSeconds));
    return edit;
  }
  if (payload.kind === "agentTurn") {
    if (typeof payload.message !== "string" || !payload.message) throw new Error(`graph_scheduler_cutover_agent_message_invalid:${job.id}`);
    edit.push("--message", payload.message);
    if (typeof payload.model === "string") edit.push("--model", payload.model);
    if (typeof payload.thinking === "string") edit.push("--thinking", payload.thinking);
    if (Number.isInteger(payload.timeoutSeconds)) edit.push("--timeout-seconds", String(payload.timeoutSeconds));
    edit.push(payload.lightContext === true ? "--light-context" : "--no-light-context");
    if (Array.isArray(payload.toolsAllow) && payload.toolsAllow.every((value) => typeof value === "string")) edit.push("--tools", payload.toolsAllow.join(","));
    return edit;
  }
  throw new Error(`graph_scheduler_cutover_payload_kind_unsupported:${job.id}:${payload.kind}`);
}

function applyJob(job: CronJob): void {
  execFileSync(openclawBin, commandEditArguments(job), { encoding: "utf8", timeout: 60_000, maxBuffer: 2_000_000, stdio: ["ignore", "pipe", "pipe"] });
}

function payloadContract(payload: CronJob["payload"]): Record<string, unknown> {
  if (payload.kind === "command") return {
    kind: payload.kind, argv: payload.argv, cwd: payload.cwd,
    noOutputTimeoutSeconds: payload.noOutputTimeoutSeconds,
    outputMaxBytes: payload.outputMaxBytes, timeoutSeconds: payload.timeoutSeconds,
  };
  return {
    kind: payload.kind, message: payload.message, model: payload.model,
    thinking: payload.thinking, timeoutSeconds: payload.timeoutSeconds,
    lightContext: payload.lightContext, toolsAllow: payload.toolsAllow,
  };
}

function verifyReadback(actual: CronJob, intended: CronJob, legacy: CronJob): void {
  for (const field of ["id", "declarationKey", "enabled", "schedule", "delivery"] as const) {
    if (canonical(actual[field]) !== canonical(legacy[field])) throw new Error(`graph_scheduler_cutover_preservation_failed:${legacy.id}:${field}`);
  }
  if (actual.displayName !== intended.displayName || actual.description !== intended.description) throw new Error(`graph_scheduler_cutover_metadata_failed:${legacy.id}`);
  if (canonical(payloadContract(actual.payload)) !== canonical(payloadContract(intended.payload))) throw new Error(`graph_scheduler_cutover_payload_failed:${legacy.id}`);
}

function writeSnapshot(name: string, value: unknown): void {
  const path = join(backupDirectory!, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
}

const store = new GraphSchedulerStore(schedulerDatabasePath);
const results: Array<Record<string, unknown>> = [];
try {
  if (action === "prepare") {
    for (const [migrationId, portfolio] of GOVERNED_SCHEDULER_PORTFOLIO) {
      if (store.migration(migrationId)) throw new Error(`graph_scheduler_cutover_migration_already_exists:${migrationId}`);
      const legacy = getJob(portfolio.declaration.scheduleId);
      const graph = buildGovernedGraphJob(legacy, migrationId, triggerScript) as CronJob;
      writeSnapshot(`${migrationId}.legacy.json`, legacy);
      writeSnapshot(`${migrationId}.graph.json`, graph);
      const migration = store.prepareBoundedMigration({ legacyJob: legacy, graphJob: graph, declaration: portfolio.declaration, actor: "governed-scheduler-portfolio-cutover" });
      results.push({ migrationId, status: migration.status, eventChainValid: store.eventChainValid(migrationId) });
    }
  } else if (action === "cutover") {
    const changed: Array<{ migrationId: string; legacy: CronJob }> = [];
    try {
      for (const migrationId of GOVERNED_SCHEDULER_PORTFOLIO.keys()) {
        const migration = store.migration(migrationId);
        if (!migration || migration.status !== "prepared") throw new Error(`graph_scheduler_cutover_not_prepared:${migrationId}`);
        const legacy = migration.legacyJob as CronJob, graph = migration.graphJob as CronJob;
        applyJob(graph);
        changed.push({ migrationId, legacy });
        verifyReadback(getJob(graph.id), graph, legacy);
        const activated = store.activateMigration(migrationId, "governed-scheduler-portfolio-cutover");
        results.push({ migrationId, status: activated.status, eventChainValid: store.eventChainValid(migrationId) });
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const item of changed.reverse()) {
        try {
          applyJob(item.legacy);
          const migration = store.migration(item.migrationId);
          if (migration?.status === "graph_owned") store.rollbackMigration(item.migrationId, "governed-scheduler-portfolio-cutover", "automatic rollback after cutover failure");
        } catch (rollbackError) { rollbackErrors.push(`${item.migrationId}:${String(rollbackError)}`); }
      }
      if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors.map((value) => new Error(value))], "graph_scheduler_cutover_and_rollback_failed");
      throw error;
    }
  } else if (action === "verify") {
    for (const migrationId of GOVERNED_SCHEDULER_PORTFOLIO.keys()) {
      const migration = store.migration(migrationId);
      if (!migration || migration.status !== "graph_owned") throw new Error(`graph_scheduler_cutover_not_graph_owned:${migrationId}`);
      verifyReadback(getJob(migration.scheduleId), migration.graphJob as CronJob, migration.legacyJob as CronJob);
      results.push({ migrationId, status: migration.status, eventChainValid: store.eventChainValid(migrationId) });
    }
  } else {
    for (const migrationId of [...GOVERNED_SCHEDULER_PORTFOLIO.keys()].reverse()) {
      const migration = store.migration(migrationId);
      if (!migration || migration.status !== "graph_owned") continue;
      applyJob(migration.legacyJob as CronJob);
      verifyReadback(getJob(migration.scheduleId), migration.legacyJob as CronJob, migration.legacyJob as CronJob);
      const rolledBack = store.rollbackMigration(migrationId, "governed-scheduler-portfolio-cutover", "operator-requested portfolio rollback");
      results.push({ migrationId, status: rolledBack.status, eventChainValid: store.eventChainValid(migrationId) });
    }
  }
  process.stdout.write(`${JSON.stringify({ action, results }, null, 2)}\n`);
} finally {
  store.close();
}
