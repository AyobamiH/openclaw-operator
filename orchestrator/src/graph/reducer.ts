import { createHash } from "node:crypto";
import type { GraphRunState, JsonValue, StatePatchOperation } from "./types.js";

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function segments(path: string): string[] {
  const value = path.trim();
  if (!value || value.startsWith(".") || value.endsWith(".")) {
    throw new Error(`invalid_state_patch_path:${path}`);
  }
  const parts = value.split(".");
  if (parts.some((part) => !part || FORBIDDEN_SEGMENTS.has(part))) {
    throw new Error(`unsafe_state_patch_path:${path}`);
  }
  return parts;
}

function permitted(path: string, allowlist: string[]): boolean {
  return allowlist.some((allowed) => path === allowed || path.startsWith(`${allowed}.`));
}

export function readPath(root: unknown, path: string): unknown {
  let cursor: unknown = root;
  for (const part of segments(path)) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function writePath(root: Record<string, JsonValue>, path: string, value: JsonValue): void {
  const parts = segments(path);
  let cursor: Record<string, JsonValue> = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]!;
    const current = cursor[part];
    if (!current || typeof current !== "object" || Array.isArray(current)) cursor[part] = {};
    cursor = cursor[part] as Record<string, JsonValue>;
  }
  cursor[parts.at(-1)!] = value;
}

export function applyStatePatches(
  state: GraphRunState,
  patches: StatePatchOperation[],
  allowlist: string[],
): GraphRunState {
  const data = structuredClone(state.data);
  for (const patch of patches) {
    if (!permitted(patch.path, allowlist)) {
      throw new Error(`state_patch_not_permitted:${patch.path}`);
    }
    const current = readPath(data, patch.path);
    if (patch.op === "set") writePath(data, patch.path, structuredClone(patch.value));
    if (patch.op === "append") {
      const entries = Array.isArray(current) ? [...current] : [];
      entries.push(structuredClone(patch.value));
      writePath(data, patch.path, entries as JsonValue);
    }
    if (patch.op === "increment") {
      if (typeof patch.value !== "number" || !Number.isFinite(patch.value)) {
        throw new Error(`state_patch_increment_requires_number:${patch.path}`);
      }
      if (current !== undefined && typeof current !== "number") {
        throw new Error(`state_patch_increment_target_not_number:${patch.path}`);
      }
      writePath(data, patch.path, (Number(current ?? 0) + patch.value) as JsonValue);
    }
  }
  return { ...state, data };
}

export function canonicalJson(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, normalize(nested)]),
      );
    }
    return entry;
  };
  return JSON.stringify(normalize(value));
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

