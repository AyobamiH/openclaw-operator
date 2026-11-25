// Safe rendering utilities — prevent React error #31 (object as child)
// Every backend value must pass through these before JSX rendering.

/** Safely extract a number. If value is an object, tries common count keys. */
export function num(v: unknown): number {
  if (typeof v === "number" && !isNaN(v)) return v;
  if (typeof v === "string") { const n = Number(v); if (!isNaN(n)) return n; }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    for (const k of ["count", "value", "total", "pending", "pendingCount", "activeCount"]) {
      if (typeof obj[k] === "number") return obj[k] as number;
    }
  }
  return 0;
}

/** Safely extract a string. Never returns an object. */
export function str(v: unknown, fallback = "unknown"): string {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  return fallback;
}

/** Safely extract a boolean. */
export function bool(v: unknown): boolean {
  return v === true || v === "true";
}

/** Safely extract a nullable string (for timestamps etc). */
export function toNullableString(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

/** Safely extract an array. If not an array, returns []. */
export function toArray<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Format a display string from a number with suffix */
export function display(v: unknown, suffix: string): string {
  return `${num(v)} ${suffix}`;
}

/** Extract an object record without treating arrays or primitives as records. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
