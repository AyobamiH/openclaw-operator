import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../orchestrator/package.json", import.meta.url));
const ts = require("typescript");
const artifacts = [
  { source: "agents/shared/runtime-evidence.ts", output: "agents/shared/runtime-evidence.js" },
  { source: "orchestrator/src/incident-priority.ts", output: "agents/shared/incident-priority.js", declaration: "agents/shared/incident-priority.d.ts" },
  { source: "orchestrator/src/review-session-defaults.ts", output: "scripts/review-session/workload-defaults.mjs" },
  { source: "orchestrator/src/companion-mode.ts", output: "agents/shared/companion-mode.js", declaration: "agents/shared/companion-mode.d.ts" },
];
const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext };
const write = process.argv.length === 3 && process.argv[2] === "--write";
if (!write && process.argv.length !== 2) throw new Error("Unexpected arguments");
const file = name => new URL("../" + name, import.meta.url);
function verifyDiagnostics(result, source) {
  if (result.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error("Cannot generate " + source);
}
function compareOrWrite(name, source, body) {
  const generated = "// Generated from " + source + "; run npm run agents:runtime-evidence:sync.\n" + body;
  if (write) writeFileSync(file(name), generated);
  else if (readFileSync(file(name), "utf8").replace(/\r\n/g, "\n") !== generated) {
    console.error(name + " is out of date. Run npm run agents:runtime-evidence:sync.");
    process.exitCode = 1;
  }
}
for (const artifact of artifacts) {
  const source = readFileSync(file(artifact.source), "utf8");
  const result = ts.transpileModule(source, { compilerOptions, fileName: artifact.source, reportDiagnostics: true });
  verifyDiagnostics(result, artifact.source);
  compareOrWrite(artifact.output, artifact.source, result.outputText);
  if (artifact.declaration) {
    const declaration = ts.transpileDeclaration(source, { compilerOptions: { ...compilerOptions, declaration: true, isolatedDeclarations: true }, fileName: artifact.source, reportDiagnostics: true });
    verifyDiagnostics(declaration, artifact.source);
    compareOrWrite(artifact.declaration, artifact.source, declaration.outputText);
  }
}
if (!process.exitCode) console.log("Shared runtime contract artifacts match their TypeScript sources.");
