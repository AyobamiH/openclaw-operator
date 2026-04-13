# SCOPE

## Inputs
- Task payload: `target`, optional `focusAreas`.
- Agent config: read-only boundaries from `agent.config.json`.

## Outputs
- `compliance` posture summary with blockers and followups.
- Operator-facing `operatorSummary` and `recommendedNextActions`.
- `specialistContract` with explicit refusal/escalation cues.

## Allowed Actions
- Read bounded local policy and manifest files.
- Synthesize compliance posture from runtime evidence.
- Refuse explicitly when requests exceed the lane.

## Out of Scope
- Executing tests, CI, or shell commands.
- Writing or modifying any files.
- External compliance frameworks or certification claims.
