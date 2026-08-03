# Failure Modes

Last updated: 2026-03-02

## Known Failure Classes
- Invalid/missing auth credentials at startup (hard fail)
- Invalid task type ingestion (rejected)
- External dependency failure (Mongo/metrics/alerts) with mixed fail-open behavior
- Spawned agent non-zero exit
- Signature/auth failures on ingress
- Missing app signing secret for `openclawdbot` bootstrap/recovery signing (fail closed)
- Realtime fan-out failure after durable ingest commit (logged, but no longer treated as total ingest failure)

## Governance-Relevant Failure Risks
- Policy drift from direct service execution.
- State file tampering outside orchestrator pathway.
- Partial subsystem startup causing implicit degraded mode.
- Restart-interrupted task retries now have a persisted recovery queue and can
  be requeued after restart, but the path is still partial and is not an
  exactly-once durable replay guarantee.
- ToolGate is not full execution containment.
- SkillAudit is still not a universal enforcement layer across every runtime execution path.
- Manifest network and filesystem boundaries are enforced on governed skill
  calls with concrete targets; direct standalone processes remain outside that
  host-containment claim.
- No full host/process sandbox guarantee exists yet.
- Self-generated skill governance is not complete end to end.
- Governed skill durability is partial: approved governed skills with
  restart-safe executor bindings are rehydrated after restart, but
  metadata-only governed skills still require re-registration before they can
  execute again.

## Contract Reference
- Spawned-agent failure/success interpretation is defined in `docs/OPENCLAW_KB/operations/AGENT_EXECUTION_CONTRACT.md` (hard cutover; no backward compatibility).

## Severity
- Critical: routing/policy bypass through alternate execution paths.
- High: role/permission declarations not enforced uniformly.
- Medium: degraded mode and stale replay state are more visible now through the
  protected dashboard governance summary, but operator visibility is still
  partial and not all degraded paths have a unified signal.
