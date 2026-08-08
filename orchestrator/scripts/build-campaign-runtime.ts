import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const ALLOWED_RUNTIME_ROOT = "/home/oneclickwebsitedesignfactory/.openclaw/runtime/deterministic-self-identification-publishing-engine";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value?.trim()) throw new Error(`Missing ${name}`);
  return resolve(value);
}

function inside(root: string, path: string): string {
  const normalizedRoot = `${resolve(root)}/`;
  const normalizedPath = resolve(path);
  if (!`${normalizedPath}/`.startsWith(normalizedRoot)) throw new Error("campaign_runtime_target_outside_allowed_root");
  return normalizedPath;
}

function run(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolvePromise(stdout.trim())
      : reject(new Error(`${command} failed ${code}: ${stderr.trim()}`)));
  });
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function makeReadOnly(path: string): Promise<void> {
  const metadata = await stat(path);
  if (!metadata.isDirectory()) {
    await chmod(path, 0o444);
    return;
  }
  for (const entry of await readdir(path)) await makeReadOnly(join(path, entry));
  await chmod(path, 0o555);
}

async function main(): Promise<void> {
  const projectRoot = argument("--project-root");
  const rendererRoot = argument("--renderer-root");
  const target = inside(ALLOWED_RUNTIME_ROOT, argument("--target"));
  try {
    await stat(target);
    throw new Error("campaign_runtime_target_already_exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(target), { recursive: true });
  await mkdir(join(target, "config", "publishing"), { recursive: true });
  await mkdir(join(target, "dist", "src"), { recursive: true });
  await cp(join(projectRoot, "config", "publishing", "registry.v1.json"), join(target, "config", "publishing", "registry.v1.json"));
  await cp(join(projectRoot, "config", "publishing", "production-integration.v1.json"), join(target, "config", "publishing", "production-integration.v1.json"));
  await cp(rendererRoot, join(target, "renderer"), { recursive: true, force: false, errorOnExist: true });
  const reelMediaSource = resolve(rendererRoot, "..", "dist", "src", "reel-media.js");
  await cp(reelMediaSource, join(target, "dist", "src", "reel-media.js"));
  const sourceCommit = await run("git", ["rev-parse", "HEAD"], projectRoot);
  const provenance = {
    schema: "openclaw-campaign-runtime-provenance.v1",
    createdAt: new Date().toISOString(),
    sourceCommit,
    sourceProject: projectRoot,
    rendererSource: rendererRoot,
    files: {
      registry: await sha256(join(target, "config", "publishing", "registry.v1.json")),
      integration: await sha256(join(target, "config", "publishing", "production-integration.v1.json")),
      rendererEntrypoint: await sha256(join(target, "renderer", "bin", "local-media-renderer.mjs")),
      reelMedia: await sha256(join(target, "dist", "src", "reel-media.js")),
    },
  };
  await writeFile(join(target, "PROVENANCE.json"), `${JSON.stringify(provenance, null, 2)}\n`, { encoding: "utf8", mode: 0o444, flag: "wx" });
  await makeReadOnly(target);
  process.stdout.write(`${JSON.stringify({ target, sourceCommit, files: provenance.files })}\n`);
}

await main();
