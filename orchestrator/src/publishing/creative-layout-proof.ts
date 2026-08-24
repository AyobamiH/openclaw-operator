const SHA256 = /^[a-f0-9]{64}$/;

export type ImageLayoutReceipt = {
  checks?: Record<string, unknown>;
  layoutVerification?: unknown;
  layoutAudit?: unknown;
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}_missing`);
  }
  return value as Record<string, unknown>;
}

export function normalizeVisibleCopy(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function assertNoDuplicateVisibleCopy(
  fields: Record<string, unknown>,
  label = "creative_layout",
): void {
  const seen = new Map<string, string>();
  for (const [field, value] of Object.entries(fields)) {
    const normalized = normalizeVisibleCopy(value);
    if (!normalized) continue;
    const previous = seen.get(normalized);
    if (previous) throw new Error(`${label}_duplicate_visible_copy:${previous}:${field}`);
    seen.set(normalized, field);
  }
}

export function assertSharedImageLayoutProof(input: {
  receipt: ImageLayoutReceipt;
  expectedMediaSha256?: string | null;
  label?: string;
}): void {
  const label = input.label ?? "image";
  const checks = asRecord(input.receipt.checks, `${label}_layout_receipt_checks`);
  for (const check of ["fullDecode", "textFitAndSafeMargins", "contrast"]) {
    if (checks[check] !== true) throw new Error(`${label}_layout_check_failed:${check}`);
  }

  const verification = asRecord(input.receipt.layoutVerification, `${label}_layout_verification`);
  if (verification.status !== "passed") {
    throw new Error(`${label}_layout_verification_not_passed`);
  }
  if (verification.semanticCompleteness === false) {
    throw new Error(`${label}_layout_semantic_completeness_failed`);
  }
  if (verification.boundingBoxesValid === false) {
    throw new Error(`${label}_layout_geometry_failed`);
  }
  if (input.expectedMediaSha256) {
    if (!SHA256.test(input.expectedMediaSha256)) {
      throw new Error(`${label}_expected_media_sha256_invalid`);
    }
    if (verification.finalMediaSha256 !== input.expectedMediaSha256) {
      throw new Error(`${label}_layout_media_hash_mismatch`);
    }
  }

  const audit = asRecord(input.receipt.layoutAudit, `${label}_layout_audit`);
  if (audit.valid !== true) throw new Error(`${label}_layout_audit_invalid`);
  for (const check of ["textFitAndSafeMargins", "contrast"]) {
    if (audit[check] !== true) throw new Error(`${label}_layout_audit_check_failed:${check}`);
  }
  if (audit.semanticCompleteness === false) {
    throw new Error(`${label}_layout_audit_semantic_completeness_failed`);
  }
  if (audit.noUnexpectedOverlap === false) {
    throw new Error(`${label}_layout_audit_overlap_failed`);
  }
  if (audit.compositionBalance === false) {
    throw new Error(`${label}_layout_audit_composition_balance_failed`);
  }
}
