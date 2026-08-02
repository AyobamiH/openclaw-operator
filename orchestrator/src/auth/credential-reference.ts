import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type CredentialRole = "viewer" | "operator" | "admin";

export type CredentialReferenceOptions = {
  requiredRole?: CredentialRole;
  label?: string;
  now?: Date;
};

type RotationEntry = {
  key?: unknown;
  label?: unknown;
  roles?: unknown;
  active?: unknown;
  expiresAt?: unknown;
};

function parseEnvironmentValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function readEnvironmentAssignments(filePath: string): Map<string, string> {
  if (!path.isAbsolute(filePath)) {
    throw new Error("credential_reference_path_must_be_absolute");
  }

  const parent = fs.lstatSync(path.dirname(filePath));
  const target = fs.lstatSync(filePath);
  if (parent.isSymbolicLink() || target.isSymbolicLink() || !target.isFile()) {
    throw new Error("credential_reference_symlink_or_non_file");
  }
  if (target.uid !== process.getuid?.()) {
    throw new Error("credential_reference_owner_mismatch");
  }
  if ((target.mode & 0o077) !== 0) {
    throw new Error("credential_reference_permissions_unsafe");
  }

  const assignments = new Map<string, string>();
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    assignments.set(match[1], parseEnvironmentValue(match[2]));
  }
  return assignments;
}

function includesRequiredRole(entry: RotationEntry, requiredRole: CredentialRole): boolean {
  const roles = Array.isArray(entry.roles)
    ? entry.roles.filter((role): role is CredentialRole =>
        role === "viewer" || role === "operator" || role === "admin")
    : ["admin" as CredentialRole];

  const rank: Record<CredentialRole, number> = { viewer: 1, operator: 2, admin: 3 };
  return roles.some((role) => rank[role] >= rank[requiredRole]);
}

export function readApiCredentialReference(
  filePath: string,
  options: CredentialReferenceOptions = {},
): string {
  const requiredRole = options.requiredRole ?? "admin";
  const now = options.now ?? new Date();
  const assignments = readEnvironmentAssignments(filePath);
  const rotation = assignments.get("API_KEY_ROTATION");

  if (rotation) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rotation);
    } catch {
      throw new Error("credential_reference_rotation_invalid");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("credential_reference_rotation_invalid");
    }

    const matching = (parsed as RotationEntry[]).find((entry) => {
      if (entry.active === false || typeof entry.key !== "string" || entry.key.length === 0) {
        return false;
      }
      if (options.label && entry.label !== options.label) return false;
      if (!includesRequiredRole(entry, requiredRole)) return false;
      if (typeof entry.expiresAt === "string") {
        const expiry = new Date(entry.expiresAt);
        if (Number.isNaN(expiry.getTime()) || expiry <= now) return false;
      }
      return true;
    });

    if (!matching || typeof matching.key !== "string") {
      throw new Error("credential_reference_no_matching_active_key");
    }
    return matching.key;
  }

  const fallback = assignments.get("API_KEY");
  if (!fallback) throw new Error("credential_reference_missing");
  return fallback;
}

export function credentialFingerprint(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}
