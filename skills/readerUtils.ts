import { isAbsolute, posix, resolve } from "node:path";

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;

export function normalizeRequestedFilePath(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateRelativeWorkspacePath(filePath: string): string | null {
  if (!filePath) {
    return "A relative filePath is required.";
  }

  if (isAbsolute(filePath) || WINDOWS_ABSOLUTE_PATH_PATTERN.test(filePath)) {
    return "filePath must be relative to the requesting agent workspace.";
  }

  return null;
}

/**
 * Reader skills resolve relative to the agent's current working directory
 * because ToolGate authorizes the same relative path string against the
 * manifest read allowlist before the skill body runs.
 */
export function resolveWorkspaceTarget(filePath: string): string {
  return resolve(process.cwd(), filePath);
}

export function toIsoTimestamp(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : null;
}

export function clampInteger(
  value: unknown,
  fallback: number,
  options: { min: number; max: number },
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(options.min, Math.min(options.max, Math.floor(value)));
}

export function normalizeLogicalPath(value: string): string {
  const sanitizedValue = value.replace(/\\/g, "/").trim();
  if (!sanitizedValue) {
    return "";
  }

  const normalizedValue = posix.normalize(sanitizedValue)
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/$/, "");

  return normalizedValue === "." ? "" : normalizedValue;
}

export function joinLogicalPath(
  basePath: string | undefined,
  childPath: string | undefined,
): string {
  const normalizedBase = normalizeLogicalPath(basePath ?? "");
  const normalizedChild = normalizeLogicalPath(childPath ?? "");

  if (!normalizedBase) {
    return normalizedChild;
  }
  if (!normalizedChild) {
    return normalizedBase;
  }

  return `${normalizedBase}/${normalizedChild}`;
}
