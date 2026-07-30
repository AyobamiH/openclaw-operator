import { createHash } from "node:crypto";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalize(entry)]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256(value: unknown): string {
  const bytes = typeof value === "string" || Buffer.isBuffer(value)
    ? value
    : canonicalJson(value);
  return createHash("sha256").update(bytes).digest("hex");
}

export function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${sha256(value).slice(0, 24)}`;
}

export function stableFraction(seed: string): number {
  const head = sha256(seed).slice(0, 13);
  return Number.parseInt(head, 16) / 0x1fffffffffffff;
}

export function interpolate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
    if (!(key in variables)) throw new Error(`Missing deterministic template variable: ${key}`);
    return variables[key];
  });
}
