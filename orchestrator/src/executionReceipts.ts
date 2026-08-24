import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFileSync, chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isPathWithin } from "./worktreeIntegrity.js";
import { guardDestructiveCommand, type DestructiveGuardOptions, type ProtectedPath } from "./destructiveCommandGuard.js";

export interface ExecutionContext {
  agent?: string;
  sessionId?: string;
  taskId?: string;
  runId?: string;
  repoRoot?: string;
  worktreePath?: string;
  cgroupOrService?: string;
}

export interface ExecutionReceipt {
  schemaVersion: 1;
  eventId: string;
  phase: "start" | "end";
  timestamp: string;
  endTimestamp?: string;
  pid: number | null;
  ppid: number;
  uid: number | null;
  executable: string;
  fullArgv: string[];
  cwd: string;
  cgroupOrService: string | null;
  agent: string | null;
  sessionId: string | null;
  taskId: string | null;
  runId: string | null;
  repoRoot: string | null;
  worktreePath: string | null;
  commandHash: string;
  exitStatus?: number | null;
  blocked?: boolean;
}

export interface ControlledCommandResult {
  eventId: string;
  pid: number | null;
  exitStatus: number;
  stdout: string;
  stderr: string;
  receipt: ExecutionReceipt;
}

const SENSITIVE_NAME = /(?:token|secret|password|passwd|credential|authorization|cookie|api[-_]?key|private[-_]?key|access[-_]?key|refresh[-_]?token)/i;
const SENSITIVE_VALUE = /^(?:bearer\s+|gh[pousr]_)[^\s]+$/i;

export function redactArgv(argv: string[]): string[] {
  const redacted: string[] = [];
  let redactNext = false;
  for (const arg of argv) {
    const value = String(arg);
    if (redactNext) {
      redacted.push("[REDACTED]");
      redactNext = false;
      continue;
    }
    const equal = /^(--?[A-Za-z0-9_-]+)=(.*)$/.exec(value);
    if (equal && SENSITIVE_NAME.test(equal[1])) {
      redacted.push(`${equal[1]}=[REDACTED]`);
      continue;
    }
    if (/^--?[A-Za-z0-9_-]+$/.test(value) && SENSITIVE_NAME.test(value)) {
      redacted.push(value);
      redactNext = true;
      continue;
    }
    if (SENSITIVE_VALUE.test(value) || /^(?:[A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY))=/.test(value)) {
      const key = value.includes("=") ? value.slice(0, value.indexOf("=")) : "value";
      redacted.push(`${key}=[REDACTED]`);
    } else redacted.push(value);
  }
  return redacted;
}

export function commandHash(executable: string, argv: string[], cwd: string): string {
  return createHash("sha256").update(JSON.stringify({ executable: resolve(executable), argv: redactArgv(argv), cwd: resolve(cwd) })).digest("hex");
}

function cgroup(): string | null {
  try { return readFileSync("/proc/self/cgroup", "utf8").trim().slice(0, 4096) || null; } catch { return null; }
}

function appendDurable(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, "a", 0o600);
  try { appendFileSync(fd, line, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
}

function readReceipts(path: string): ExecutionReceipt[] {
  try { return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as ExecutionReceipt); } catch { return []; }
}

export class ExecutionReceiptStore {
  readonly path: string;
  readonly maxRecords: number;
  readonly maxBytes: number;
  constructor(stateDir: string, options: { maxRecords?: number; maxBytes?: number } = {}) {
    this.path = resolve(stateDir, "receipts", "execution.jsonl");
    this.maxRecords = Math.max(10, options.maxRecords ?? 2000);
    this.maxBytes = Math.max(4096, options.maxBytes ?? 5 * 1024 * 1024);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
  }
  append(receipt: ExecutionReceipt): void {
    appendDurable(this.path, `${JSON.stringify(receipt)}\n`);
    this.compact();
  }
  read(): ExecutionReceipt[] { return readReceipts(this.path); }
  compact(): void {
    let records = readReceipts(this.path).slice(-this.maxRecords);
    let body = records.map((item) => JSON.stringify(item)).join("\n");
    while (Buffer.byteLength(`${body}\n`) > this.maxBytes && records.length > 1) {
      records = records.slice(1);
      body = records.map((item) => JSON.stringify(item)).join("\n");
    }
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temp, body ? `${body}\n` : "", { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temp, this.path);
  }
}

function baseReceipt(executable: string, argv: string[], cwd: string, context: ExecutionContext, eventId: string, timestamp: string): ExecutionReceipt {
  const resolvedCwd = resolve(cwd);
  const redacted = redactArgv(argv);
  return {
    schemaVersion: 1,
    eventId,
    phase: "start",
    timestamp,
    pid: null,
    ppid: process.pid,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    executable: resolve(executable),
    fullArgv: redacted,
    cwd: resolvedCwd,
    cgroupOrService: context.cgroupOrService ?? cgroup(),
    agent: context.agent ?? null,
    sessionId: context.sessionId ?? null,
    taskId: context.taskId ?? null,
    runId: context.runId ?? null,
    repoRoot: context.repoRoot ? resolve(context.repoRoot) : null,
    worktreePath: context.worktreePath ? resolve(context.worktreePath) : null,
    commandHash: commandHash(executable, argv, resolvedCwd),
  };
}

export async function executeControlledCommand(args: {
  executable: string;
  argv?: string[];
  cwd: string;
  context?: ExecutionContext;
  receiptStore: ExecutionReceiptStore;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  destructive?: boolean;
  guard?: DestructiveGuardOptions;
}): Promise<ControlledCommandResult> {
  const argv = args.argv ?? [];
  const eventId = randomUUID();
  const started = baseReceipt(args.executable, argv, args.cwd, args.context ?? {}, eventId, new Date().toISOString());
  args.receiptStore.append(started);
  if (args.destructive) {
    try { guardDestructiveCommand(args.executable, argv, args.cwd, args.guard ?? { protectedPaths: [] }); }
    catch (error) {
      const ended: ExecutionReceipt = { ...started, phase: "end", endTimestamp: new Date().toISOString(), exitStatus: 126, blocked: true };
      args.receiptStore.append(ended);
      throw error;
    }
  }
  const maxOutputBytes = args.maxOutputBytes ?? 100_000;
  const child = spawn(args.executable, argv, { cwd: resolve(args.cwd), shell: false, stdio: ["ignore", "pipe", "pipe"], env: args.env });
  const pid = child.pid ?? null;
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => { if (Buffer.byteLength(stdout) < maxOutputBytes) stdout += chunk.toString().slice(0, maxOutputBytes - Buffer.byteLength(stdout)); });
  child.stderr?.on("data", (chunk: Buffer) => { if (Buffer.byteLength(stderr) < maxOutputBytes) stderr += chunk.toString().slice(0, maxOutputBytes - Buffer.byteLength(stderr)); });
  const exitStatus = await new Promise<number>((resolveExit, reject) => {
    let timer: NodeJS.Timeout | undefined;
    if (args.timeoutMs) timer = setTimeout(() => child.kill("SIGTERM"), args.timeoutMs);
    child.once("error", reject);
    child.once("close", (code, signal) => { if (timer) clearTimeout(timer); resolveExit(code ?? (signal ? 128 : 1)); });
  });
  const ended: ExecutionReceipt = { ...started, phase: "end", timestamp: started.timestamp, endTimestamp: new Date().toISOString(), pid, exitStatus };
  args.receiptStore.append(ended);
  return { eventId, pid, exitStatus, stdout, stderr, receipt: ended };
}

export function receiptTargetsWorktree(receipt: ExecutionReceipt, protectedPath: ProtectedPath): boolean {
  return Boolean(receipt.worktreePath && isPathWithin(receipt.cwd, protectedPath.worktreePath));
}
