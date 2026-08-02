import { issueOneRunLiveCapability, grantOneRunLiveApproval } from "../src/graph/live-capability.js";
import { GraphStore } from "../src/graph/store.js";

const args = process.argv.slice(2);
const value = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const action = value("--action");
const databasePath = value("--path");
const runId = value("--run-id");
const approvalId = value("--approval-id");
const capabilityId = value("--capability-id");
const expiresAt = value("--expires-at");
const actor = value("--actor") ?? "local-owner-cli";

if (!action || !databasePath) {
  process.stderr.write(`${JSON.stringify({ status: "failed", error: "action_and_path_required" })}\n`);
  process.exitCode = 1;
} else {
  let store: GraphStore | undefined;
  try {
    store = new GraphStore(databasePath);
    let result: unknown;
    if (action === "status") {
      store.expireOneRunLiveCapabilities();
      result = {
        schemaVersion: store.schemaVersion(),
        capabilities: store.oneRunLiveCapabilities(),
      };
    } else {
      if (process.env.OPENCLAW_GRAPH_ZERO_WRITE_ONLY !== "true") throw new Error("owner_cli_requires_explicit_global_zero_write");
      if (action === "approve") {
        if (!runId || !approvalId || !expiresAt) throw new Error("approve_requires_run_approval_and_expiry_refs");
        result = { approval: grantOneRunLiveApproval({ store, runId, approvalId, approver: actor, expiresAt, note: value("--note"), globalZeroWrite: true }) };
      } else if (action === "issue") {
        if (!runId || !approvalId || !expiresAt) throw new Error("issue_requires_run_approval_and_expiry_refs");
        const capability = issueOneRunLiveCapability({ store, runId, approvalId, issuedBy: actor, expiresAt, notBefore: value("--not-before"), globalZeroWrite: true });
        result = { capability, dispatches: store.liveCapabilityDispatches(capability.capabilityId) };
      } else if (action === "revoke") {
        if (!capabilityId) throw new Error("revoke_requires_capability_ref");
        result = { capability: store.revokeOneRunLiveCapability(capabilityId, actor, value("--reason") ?? "owner_cli_revocation") };
      } else {
        throw new Error("unknown_action");
      }
    }
    process.stdout.write(`${JSON.stringify({ status: "ok", result }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
    process.exitCode = 1;
  } finally {
    store?.close();
  }
}
