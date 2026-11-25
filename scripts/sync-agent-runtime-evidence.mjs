import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../orchestrator/package.json", import.meta.url));
const ts = require("typescript");
const source = new URL("../agents/shared/runtime-evidence.ts", import.meta.url);
const output = new URL("../agents/shared/runtime-evidence.js", import.meta.url);
const result = ts.transpileModule(readFileSync(source, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  reportDiagnostics: true,
});
if (result.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) {
  throw new Error("Runtime evidence source could not be transpiled");
}
const generated = "// Generated from runtime-evidence.ts; run npm run agents:runtime-evidence:sync.\n" + result.outputText;
if (process.argv.length === 2) {
  if (readFileSync(output, "utf8").replace(/\r\n/g, "\n") !== generated) {
    console.error("Shared agent runtime evidence artifact is out of date. Run npm run agents:runtime-evidence:sync.");
    process.exitCode = 1;
  } else console.log("Shared agent runtime evidence artifact matches its TypeScript source.");
} else if (process.argv.length === 3 && process.argv[2] === "--write") {
  writeFileSync(output, generated);
} else throw new Error("Unexpected arguments");
