# HEARTBEAT - Operations Analyst Agent

## Health Checks
✓ `documentParser` access remains available  
✓ Runtime state target resolves correctly  
✓ Service-state reads are fresh enough to trust  
✓ `controlPlaneBrief` keeps surfacing in task-run highlights

## Escalation
- 1st failure: mark the brief degraded
- 2nd failure: surface a bounded refusal with next actions
- 3rd failure: escalate through operator-visible runtime evidence
