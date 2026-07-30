import type { PublicationState } from "./types.js";

const transitions: Record<PublicationState, ReadonlySet<PublicationState>> = {
  planned: new Set(["generated", "failed_closed", "superseded"]),
  generated: new Set(["validated", "failed_closed", "superseded"]),
  validated: new Set(["reserved", "failed_closed", "superseded"]),
  reserved: new Set(["shadow_verified", "publishing", "failed_closed", "superseded"]),
  shadow_verified: new Set(),
  publishing: new Set(["published_unverified", "reconciliation_required", "failed_closed"]),
  published_unverified: new Set(["verified", "confirmed_absent", "reconciliation_required"]),
  reconciliation_required: new Set(["verified", "confirmed_absent", "failed_closed"]),
  verified: new Set(),
  confirmed_absent: new Set(),
  failed_closed: new Set(),
  superseded: new Set(),
};

export function assertPublicationTransition(
  from: PublicationState,
  to: PublicationState,
): void {
  if (!transitions[from]?.has(to)) {
    throw new Error(`Invalid publication state transition: ${from} -> ${to}`);
  }
}

export function isTerminalPublicationState(state: PublicationState): boolean {
  return transitions[state].size === 0;
}
