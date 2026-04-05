# SCOPE

## Inputs
- `release-readiness` task payload.
- Orchestrator runtime state via `orchestratorStatePath`.
- Latest bounded task execution evidence.

## Outputs
- `releaseReadiness`
- `operatorSummary`
- `recommendedNextActions`
- `specialistContract`

## File I/O Expectations
- Reads runtime evidence only.
- No direct release-state mutation.

## Allowed Actions
- Parse bounded runtime evidence with `documentParser`.
- Synthesize release posture from live verification, security, system,
  incident, approval, and proof signals.

## Out of Scope
- Deployment execution
- Approval decisions
- Code changes
- Network access
