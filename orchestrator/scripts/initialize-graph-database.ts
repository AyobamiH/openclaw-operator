import { initializeGraphDatabase } from "../src/graph/initializer.js";
import { GraphPersistenceError } from "../src/graph/schema-verifier.js";

const args = process.argv.slice(2);
const pathIndex = args.indexOf("--path");
const databasePath = pathIndex >= 0 ? args[pathIndex + 1] : undefined;
const stateRootIndex = args.indexOf("--state-root");
const stateRoot = stateRootIndex >= 0 ? args[stateRootIndex + 1] : undefined;
const expectAbsent = args.includes("--expect-absent");
const testOnlyAllowUnsafePath = args.includes("--test-only-allow-unsafe-path");

if (!databasePath) {
  process.stderr.write(`${JSON.stringify({ status: "failed", errorCode: "unsafe_path", error: "graph_database_path_required" })}\n`);
  process.exitCode = 1;
} else {
  try {
    const result = initializeGraphDatabase({
      path: databasePath,
      expectAbsent,
      ...(stateRoot ? { stateRoot } : {}),
      testOnlyAllowUnsafePath,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const code = error instanceof GraphPersistenceError ? error.code : "migration_failed";
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({
      status: "failed",
      errorCode: code,
      error: message,
      details: error instanceof GraphPersistenceError ? error.details : {},
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
