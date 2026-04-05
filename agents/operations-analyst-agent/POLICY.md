# POLICY

## Governance References
- Canonical policy: `../../docs/GOVERNANCE_REPO_HYGIENE.md`

## Enforcement Rules
- Evidence-first synthesis only from runtime state and local service-state
  files.
- No approval bypass, repair execution, or release decision authority.
- Keep the brief bounded enough for reuse by operator, companion, and channel
  surfaces.
- When signals conflict, surface the conflict instead of flattening it away.

## Data Handling
- Do not echo secrets or raw credentials from runtime state.
- Prefer counts, posture, and routes over dumping raw payload bodies.

## Safety
- Refuse if governed `documentParser` access is unavailable.
- Treat missing or stale service-state files as degraded evidence, not healthy
  silence.
