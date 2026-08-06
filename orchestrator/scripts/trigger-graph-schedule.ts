import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  executeGovernedSchedule,
  formatGovernedScheduleOutput,
  type GovernedScheduleExecutionArgs,
} from "./trigger-governed-graph-schedule.js";
import { PHASE_G_MIGRATION_ID } from "../src/graph/scheduler-store.js";

const EVIDENCE_ROOT = "/home/oneclickwebsitedesignfactory/.openclaw/state/activation/graph-phase-g-instagram-image-20260802/triggers";

export type PhaseGScheduleExecutionArgs = Omit<GovernedScheduleExecutionArgs, "migrationId"> & {
  migrationId?: typeof PHASE_G_MIGRATION_ID;
  instagramOutboxPath?: string;
};

export async function executePhaseGSchedule(args: PhaseGScheduleExecutionArgs = {}): Promise<Record<string, unknown>> {
  if (args.migrationId && args.migrationId !== PHASE_G_MIGRATION_ID) {
    throw new Error("graph_scheduler_phase_g_wrapper_requires_phase_g_migration");
  }
  const { migrationId: _migrationId, instagramOutboxPath: _instagramOutboxPath, ...governedArgs } = args;
  return executeGovernedSchedule({ ...governedArgs, migrationId: PHASE_G_MIGRATION_ID });
}

async function main(): Promise<void> {
  if ((process.argv.length !== 4 && process.argv.length !== 6) || process.argv[2] !== "--migration-id" || process.argv[3] !== PHASE_G_MIGRATION_ID) {
    throw new Error("graph_scheduler_phase_g_wrapper_requires_exact_phase_g_migration_reference");
  }
  if (process.argv.length === 6 && process.argv[4] !== "--recover-trigger-id") {
    throw new Error("graph_scheduler_recovery_requires_exact_trigger_reference");
  }
  const result = await executePhaseGSchedule({ recoveryTriggerId: process.argv[5] });
  const trigger = result.trigger as Record<string, unknown>;
  mkdirSync(EVIDENCE_ROOT, { recursive: true, mode: 0o700 });
  const evidencePath = join(EVIDENCE_ROOT, `${String(trigger.triggerId)}.json`);
  const payload = `${JSON.stringify({ recordedAt: new Date().toISOString(), compatibilityEntrypoint: "trigger-graph-schedule.ts", governedEntrypoint: "trigger-governed-graph-schedule.ts", ...result }, null, 2)}\n`;
  if (!existsSync(evidencePath)) {
    writeFileSync(evidencePath, payload, { mode: 0o600, flag: "wx" });
    chmodSync(evidencePath, 0o600);
  } else if (result.publicationReport) {
    const correctivePath = join(EVIDENCE_ROOT, `${String(trigger.triggerId)}.compat-${new Date().toISOString().replace(/[:.]/g, "")}.json`);
    writeFileSync(correctivePath, payload, { mode: 0o600, flag: "wx" });
    chmodSync(correctivePath, 0o600);
  }
  process.stdout.write(formatGovernedScheduleOutput(result, PHASE_G_MIGRATION_ID));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
