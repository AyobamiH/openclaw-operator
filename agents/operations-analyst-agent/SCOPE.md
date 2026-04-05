# SCOPE

## Inputs
- `control-plane-brief` task payload.
- Orchestrator runtime state via `orchestratorStatePath`.
- Local service-state files declared by agent manifests.

## Outputs
- `controlPlaneBrief`
- `operatorSummary`
- `recommendedNextActions`
- `specialistContract`

## File I/O Expectations
- Reads runtime and service-state evidence only.
- No direct write-side authority beyond the orchestrator-maintained
  `serviceStatePath` memory file.

## Allowed Actions
- Parse bounded runtime evidence with `documentParser`.
- Rank the strongest current operator move.
- Package the result for operator and companion reuse.

## Out of Scope
- Repair execution
- Approval decisions
- Release cutover authority
- Network access
