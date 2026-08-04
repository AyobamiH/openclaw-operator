import type { GraphSchedulerMigration, GraphSchedulerStore } from "./scheduler-store.js";

export type SchedulerOwner = "legacy" | "graph" | "unknown";

export type SchedulerOwnershipTransferResult = {
  migration: GraphSchedulerMigration;
  activated: boolean;
  recovered: boolean;
  alreadyGraphOwned: boolean;
};

export function transferSchedulerOwnership(args: {
  store: GraphSchedulerStore;
  migrationId: string;
  actor: string;
  readOwner: () => SchedulerOwner;
  applyGraphOwner: () => void;
  applyLegacyOwner: () => void;
}): SchedulerOwnershipTransferResult {
  let migration = args.store.migration(args.migrationId);
  if (!migration) throw new Error(`graph_scheduler_cutover_migration_missing:${args.migrationId}`);

  const initialOwner = args.readOwner();
  if (initialOwner === "unknown") throw new Error(`graph_scheduler_cutover_owner_indeterminate:${args.migrationId}`);

  if (migration.status === "graph_owned" && initialOwner === "graph") {
    return { migration, activated: false, recovered: false, alreadyGraphOwned: true };
  }
  if (migration.status !== "prepared" && migration.status !== "graph_owned") {
    throw new Error(`graph_scheduler_cutover_not_admissible:${args.migrationId}:${migration.status}`);
  }
  if (initialOwner !== "legacy") {
    throw new Error(`graph_scheduler_cutover_owner_status_mismatch:${args.migrationId}:${migration.status}:${initialOwner}`);
  }

  let activated = false;
  const recovered = migration.status === "graph_owned";
  if (migration.status === "prepared") {
    try {
      migration = args.store.activateMigration(args.migrationId, args.actor);
      activated = true;
    } catch (error) {
      const concurrent = args.store.migration(args.migrationId);
      if (concurrent?.status !== "graph_owned") throw error;
      migration = concurrent;
    }
  }

  try {
    args.applyGraphOwner();
    if (args.readOwner() !== "graph") throw new Error(`graph_scheduler_cutover_graph_readback_failed:${args.migrationId}`);
  } catch (error) {
    try {
      if (args.readOwner() !== "legacy") args.applyLegacyOwner();
      if (args.readOwner() !== "legacy") throw new Error(`graph_scheduler_cutover_legacy_restore_failed:${args.migrationId}`);
      const current = args.store.migration(args.migrationId);
      if (current?.status === "graph_owned") {
        args.store.rollbackMigration(args.migrationId, args.actor, "automatic rollback after graph-owner admission failure");
      }
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `graph_scheduler_cutover_and_rollback_failed:${args.migrationId}`);
    }
    throw error;
  }

  const completed = args.store.migration(args.migrationId);
  if (!completed || completed.status !== "graph_owned") throw new Error(`graph_scheduler_cutover_activation_lost:${args.migrationId}`);
  return { migration: completed, activated, recovered, alreadyGraphOwned: false };
}
