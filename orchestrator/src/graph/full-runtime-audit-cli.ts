import { auditFullGraphMultiAgentRuntime } from "./full-runtime-audit.js";

const report = await auditFullGraphMultiAgentRuntime();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.verdict === "failed") process.exitCode = 1;
