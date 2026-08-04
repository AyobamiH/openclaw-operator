import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { GraphSchedulerStore } from "../src/graph/scheduler-store.js";
import { governedSchedulerPortfolioEntry } from "../src/graph/scheduler-portfolio.js";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value) throw new Error("graph_scheduler_admin_invalid_arguments");
  args.set(key, value);
}
const action = args.get("--action");
const migrationId = args.get("--migration-id");
if (!action || !migrationId) throw new Error("graph_scheduler_admin_requires_exact_migration_reference");
const portfolio = governedSchedulerPortfolioEntry(migrationId);
if (["prepare", "activate", "rollback"].includes(action) && process.env.OPENCLAW_GRAPH_ZERO_WRITE_ONLY !== "true") throw new Error("graph_scheduler_admin_requires_global_zero_write");
const databasePath = process.env.OPENCLAW_GRAPH_SCHEDULER_DATABASE_PATH?.trim();
if (!databasePath || !isAbsolute(databasePath)) throw new Error("graph_scheduler_admin_requires_absolute_database_path");
const store = new GraphSchedulerStore(databasePath);
try {
  let result: unknown;
  if (action === "status") {
    const migration = store.migration(migrationId);
    result = { migration: migration ? { ...migration, legacyJob: undefined, graphJob: undefined } : null, triggers: store.triggers(migrationId), eventChainValid: migration ? store.eventChainValid(migrationId) : true };
  } else if (action === "prepare") {
    const legacyPath = args.get("--legacy-job-file"), graphPath = args.get("--graph-job-file");
    if (!legacyPath || !graphPath) throw new Error("graph_scheduler_prepare_requires_job_references");
    const migration = store.prepareBoundedMigration({ legacyJob: JSON.parse(readFileSync(legacyPath, "utf8")), graphJob: JSON.parse(readFileSync(graphPath, "utf8")), declaration: portfolio.declaration, actor: "governed-scheduler-owner-cli" });
    result = { migration: { ...migration, legacyJob: undefined, graphJob: undefined }, eventChainValid: store.eventChainValid(migrationId) };
  } else if (action === "activate") {
    const migration = store.activateMigration(migrationId, "governed-scheduler-owner-cli");
    result = { migration: { ...migration, legacyJob: undefined, graphJob: undefined }, eventChainValid: store.eventChainValid(migrationId) };
  } else if (action === "rollback") {
    const reason = args.get("--reason");
    if (!reason) throw new Error("graph_scheduler_rollback_requires_reason");
    const migration = store.rollbackMigration(migrationId, "governed-scheduler-owner-cli", reason);
    result = { migration: { ...migration, legacyJob: undefined, graphJob: undefined }, rollbackJobDigest: migration.legacyJobDigest, eventChainValid: store.eventChainValid(migrationId) };
  } else throw new Error("graph_scheduler_admin_unknown_action");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally { store.close(); }
