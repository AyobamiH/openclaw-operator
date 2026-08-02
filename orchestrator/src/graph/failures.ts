import type { FailureCategory, GraphFailure } from "./types.js";

const POLICIES: Record<FailureCategory, Omit<GraphFailure, "category" | "message" | "details">> = {
  validation_error: { retryable: false, repairable: true, replanWorthy: true, approvalDependent: false, terminal: false, compensatable: false },
  missing_dependency: { retryable: false, repairable: true, replanWorthy: true, approvalDependent: false, terminal: false, compensatable: false },
  authority_denied: { retryable: false, repairable: false, replanWorthy: false, approvalDependent: false, terminal: true, compensatable: false },
  approval_required: { retryable: false, repairable: false, replanWorthy: false, approvalDependent: true, terminal: false, compensatable: false },
  tool_unavailable: { retryable: true, repairable: true, replanWorthy: true, approvalDependent: false, terminal: false, compensatable: false },
  tool_contract_error: { retryable: false, repairable: true, replanWorthy: true, approvalDependent: false, terminal: false, compensatable: false },
  provider_rate_limited: { retryable: true, repairable: false, replanWorthy: false, approvalDependent: false, terminal: false, compensatable: false },
  provider_auth_error: { retryable: false, repairable: false, replanWorthy: false, approvalDependent: true, terminal: false, compensatable: false },
  provider_not_found: { retryable: false, repairable: true, replanWorthy: true, approvalDependent: false, terminal: false, compensatable: false },
  provider_rejected: { retryable: false, repairable: true, replanWorthy: true, approvalDependent: false, terminal: false, compensatable: false },
  network_transient: { retryable: true, repairable: false, replanWorthy: false, approvalDependent: false, terminal: false, compensatable: false },
  timeout: { retryable: true, repairable: false, replanWorthy: false, approvalDependent: false, terminal: false, compensatable: false },
  verification_failed: { retryable: false, repairable: true, replanWorthy: false, approvalDependent: false, terminal: false, compensatable: true },
  no_progress: { retryable: false, repairable: false, replanWorthy: false, approvalDependent: false, terminal: true, compensatable: false },
  budget_exhausted: { retryable: false, repairable: false, replanWorthy: false, approvalDependent: false, terminal: true, compensatable: false },
  state_conflict: { retryable: true, repairable: false, replanWorthy: false, approvalDependent: false, terminal: false, compensatable: false },
  idempotency_conflict: { retryable: false, repairable: true, replanWorthy: false, approvalDependent: false, terminal: false, compensatable: false },
  invariant_violation: { retryable: false, repairable: false, replanWorthy: false, approvalDependent: false, terminal: true, compensatable: false },
  unsafe_operation: { retryable: false, repairable: false, replanWorthy: false, approvalDependent: false, terminal: true, compensatable: false },
  human_input_required: { retryable: false, repairable: false, replanWorthy: false, approvalDependent: true, terminal: false, compensatable: false },
  unknown: { retryable: false, repairable: true, replanWorthy: true, approvalDependent: false, terminal: false, compensatable: false },
};

export function failure(category: FailureCategory, message: string, details?: GraphFailure["details"]): GraphFailure {
  return { category, message, ...POLICIES[category], details };
}

