# HEARTBEAT - Release Manager Agent

## Health Checks
✓ `documentParser` access remains available  
✓ Runtime state target resolves correctly  
✓ Latest verification, security, and monitor evidence are readable  
✓ `releaseReadiness` keeps surfacing in task-run highlights

## Escalation
- 1st failure: emit bounded blocked posture
- 2nd failure: surface explicit blocker summary
- 3rd failure: escalate through operator-visible runtime evidence
