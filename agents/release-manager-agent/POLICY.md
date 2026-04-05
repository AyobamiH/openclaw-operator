# POLICY

## Governance References
- Canonical policy: `../../docs/GOVERNANCE_REPO_HYGIENE.md`

## Enforcement Rules
- Release posture must be derived from current runtime evidence only.
- This lane does not deploy, approve, or mutate release state directly.
- Critical incident, failed monitor, failed security, or stale proof conditions
  must block the lane.
- Missing successful verification should hold the lane unless a stronger block
  already exists.

## Data Handling
- No secret material in blocker or follow-up text.
- Summaries should point to evidence classes, not dump raw protected payloads.

## Safety
- Refuse if governed `documentParser` access is unavailable.
- Prefer `hold` over invented confidence when evidence is partial.
