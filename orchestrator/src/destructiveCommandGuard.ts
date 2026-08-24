import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { isPathWithin } from "./worktreeIntegrity.js";

export type DestructiveOperation =
  | "rm-rf"
  | "find-delete"
  | "git-clean"
  | "git-worktree-remove"
  | "git-worktree-prune"
  | "rsync-delete"
  | "recursive-replacement";

export interface ProtectedPath {
  repoRoot: string;
  worktreePath: string;
  registered: boolean;
  production?: boolean;
}

export interface BoundedDestructiveAuthority {
  nonce: string;
  operation: DestructiveOperation;
  canonicalTargetPath: string;
  commandHash?: string;
  expiresAt: string;
}

export interface DestructiveGuardOptions {
  protectedPaths: ProtectedPath[];
  authority?: BoundedDestructiveAuthority;
  now?: Date;
}

export interface DestructiveCommandResolution {
  operation: DestructiveOperation;
  canonicalTargetPath: string;
  protectedPath: ProtectedPath | null;
  allowed: boolean;
  reason: string;
}

function canonical(path: string): string {
  try { return realpathSync.native(path); } catch { return resolve(path); }
}

function isOption(value: string): boolean { return value.startsWith("-") && value !== "-"; }

function targetAfterOptions(args: string[]): string | null {
  let options = true;
  for (const value of args) {
    if (options && value === "--") { options = false; continue; }
    if (options && isOption(value)) continue;
    return value;
  }
  return null;
}

export function resolveCanonicalTargetPath(path: string, cwd: string): string {
  const candidate = canonical(path === "." ? cwd : resolve(cwd, path));
  if (existsSync(candidate)) return candidate;
  let parent = candidate;
  const suffix: string[] = [];
  while (!existsSync(parent) && parent !== dirname(parent)) { suffix.unshift(parent.slice(parent.lastIndexOf(sep) + 1)); parent = dirname(parent); }
  return canonical(join(parent, ...suffix));
}

export function classifyDestructiveCommand(executable: string, argv: string[], cwd: string): { operation: DestructiveOperation; target: string } | null {
  const name = executable.split(/[\\/]/).pop() ?? executable;
  if (name === "rm" && argv.some((item) => /^-.*r/.test(item)) && argv.some((item) => /^-.*f/.test(item))) {
    const target = targetAfterOptions(argv);
    if (target) return { operation: "rm-rf", target: resolveCanonicalTargetPath(target, cwd) };
  }
  if (name === "find" && argv.includes("-delete")) {
    const target = argv.find((item) => !isOption(item) && item !== "-delete") ?? ".";
    return { operation: "find-delete", target: resolveCanonicalTargetPath(target, cwd) };
  }
  if (name === "git") {
    const cleanIndex = argv.indexOf("clean");
    if (cleanIndex >= 0) return { operation: "git-clean", target: resolveCanonicalTargetPath(cwd, cwd) };
    const worktreeIndex = argv.indexOf("worktree");
    if (worktreeIndex >= 0 && argv[worktreeIndex + 1] === "prune") return { operation: "git-worktree-prune", target: resolveCanonicalTargetPath(cwd, cwd) };
    if (worktreeIndex >= 0 && argv[worktreeIndex + 1] === "remove") {
      const target = argv[worktreeIndex + 2];
      if (target) return { operation: "git-worktree-remove", target: resolveCanonicalTargetPath(target, cwd) };
    }
  }
  if (name === "rsync" && argv.some((item) => item === "--delete" || item.startsWith("--delete-"))) {
    const positional = argv.filter((item) => !isOption(item));
    const target = positional.at(-1);
    if (target) return { operation: "rsync-delete", target: resolveCanonicalTargetPath(target, cwd) };
  }
  if (["cp", "mv", "rsync"].includes(name) && argv.some((item) => /^-.*R/.test(item) || item === "--recursive")) {
    const positional = argv.filter((item) => !isOption(item));
    const target = positional.at(-1);
    if (target) return { operation: "recursive-replacement", target: resolveCanonicalTargetPath(target, cwd) };
  }
  return null;
}

function intersects(target: string, protectedPath: ProtectedPath): boolean {
  const t = canonical(target);
  const repo = canonical(protectedPath.repoRoot);
  const worktree = canonical(protectedPath.worktreePath);
  return isPathWithin(t, repo) || isPathWithin(repo, t) || isPathWithin(t, worktree) || isPathWithin(worktree, t);
}

function authorityMatches(authority: BoundedDestructiveAuthority | undefined, operation: DestructiveOperation, target: string, hashValue: string): boolean {
  if (!authority || authority.operation !== operation) return false;
  if (new Date(authority.expiresAt).getTime() <= Date.now()) return false;
  if (canonical(authority.canonicalTargetPath) !== canonical(target)) return false;
  return !authority.commandHash || authority.commandHash === hashValue;
}

export function destructiveCommandHash(executable: string, argv: string[], cwd: string): string {
  return createHash("sha256").update(JSON.stringify({ executable: canonical(executable), argv, cwd: canonical(cwd) })).digest("hex");
}

export function evaluateDestructiveCommand(executable: string, argv: string[], cwd: string, options: DestructiveGuardOptions): DestructiveCommandResolution {
  const classified = classifyDestructiveCommand(executable, argv, cwd);
  if (!classified) return { operation: "recursive-replacement", canonicalTargetPath: canonical(cwd), protectedPath: null, allowed: true, reason: "not-recursive-destructive" };
  const target = classified.target;
  const protectedPath = options.protectedPaths.find((item) => intersects(target, item)) ?? null;
  if (!protectedPath) return { operation: classified.operation, canonicalTargetPath: target, protectedPath: null, allowed: true, reason: "target-unprotected" };
  const allowed = authorityMatches(options.authority, classified.operation, target, destructiveCommandHash(executable, argv, cwd));
  return {
    operation: classified.operation,
    canonicalTargetPath: target,
    protectedPath,
    allowed,
    reason: allowed ? "exact-bounded-authority" : "protected-target-requires-exact-bounded-authority",
  };
}

export function guardDestructiveCommand(executable: string, argv: string[], cwd: string, options: DestructiveGuardOptions): DestructiveCommandResolution {
  const resolution = evaluateDestructiveCommand(executable, argv, cwd, options);
  if (!resolution.allowed) throw new Error(`destructive_command_blocked:${resolution.reason}:${resolution.canonicalTargetPath}`);
  return resolution;
}
