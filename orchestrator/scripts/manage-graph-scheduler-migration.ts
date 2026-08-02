import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { GraphSchedulerStore, PHASE_G_MIGRATION_ID } from "../src/graph/scheduler-store.js";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value) throw new Error("graph_scheduler_admin_invalid_arguments");
  args.set(key, value);
}
const action = args.get("--action");
const migrationId = args.get("--migration-id");
if (!action || migrationId !== PHASE_G_MIGRATION_ID) throw new Error("graph_scheduler_admin_requires_exact_migration_reference");
if (["prepare", "activate", "rollback"].includes(action) && process.env.OPENCLAW_GRAPH_ZERO_WRITE_ONLY !== "true") throw new Error("graph_scheduler_admin_requires_global_zero_write");

const schedulerDatabasePath = process.env.OPENCLAW_GRAPH_SCHEDULER_DATABASE_PATH?.trim();
if (!schedulerDatabasePath || !isAbsolute(schedulerDatabasePath)) throw new Error("graph_scheduler_admin_requires_absolute_database_path");
const store = new GraphSchedulerStore(schedulerDatabasePath);
try {
  let result: unknown;
  if (action === "status") {
    const migration = store.migration(migrationId);
    result = { migration: migration ? { ...migration, legacyJob: undefined, graphJob: undefined } : null, triggers: store.triggers(migrationId), eventChainValid: migration ? store.eventChainValid(migrationId) : true };
  } else if (action === "prepare") {
    const legacyJobFile = args.get("--legacy-job-file");
    const graphJobFile = args.get("--graph-job-file");
    if (!legacyJobFile || !graphJobFile) throw new Error("graph_scheduler_prepare_requires_job_references");
    const legacyJob = JSON.parse(readFileSync(legacyJobFile, "utf8"));
    const graphJob = JSON.parse(readFileSync(graphJobFile, "utf8"));
    const migration = store.prepareMigration({ legacyJob, graphJob, actor: "phase-g-owner-cli" });
    result = { migration: { ...migration, legacyJob: undefined, graphJob: undefined }, triggers: [], eventChainValid: store.eventChainValid(migrationId) };
  } else if (action === "activate") {
    const migration = store.activateMigration(migrationId, "phase-g-owner-cli");
    result = { migration: { ...migration, legacyJob: undefined, graphJob: undefined }, eventChainValid: store.eventChainValid(migrationId) };
  } else if (action === "rollback") {
    const reason = args.get("--reason");
    if (!reason) throw new Error("graph_scheduler_rollback_requires_reason");
    const migration = store.rollbackMigration(migrationId, "phase-g-owner-cli", reason);
    result = { migration: { ...migration, legacyJob: undefined, graphJob: undefined }, rollbackJobDigest: migration.legacyJobDigest, eventChainValid: store.eventChainValid(migrationId) };
  } else {
    throw new Error("graph_scheduler_admin_unknown_action");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  store.close();
}
