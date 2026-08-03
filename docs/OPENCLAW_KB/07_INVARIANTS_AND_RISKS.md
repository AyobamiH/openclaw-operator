# Runtime Invariants and Risk Register

Last reviewed: 2026-02-28

## Invariants (Must Hold)

1. Privileged task entrypoints require auth/signature and validation.
2. Unknown task types are rejected.
3. Queue-dispatched agent executions are traceable to task IDs.
4. Governed task and skill execution requires a durable single-use ToolGate
   capability, even though host isolation is a separate control.
5. State mutations remain durable and bounded.
6. Operational launch paths should not undermine orchestrator-first governance.

## Current Compliance Snapshot

- Invariant 1: **Met for HTTP/API ingress**.
- Invariant 2: **Met** (`TaskQueue.enqueue()` and `unknownTaskHandler` reject
  invalid types).
- Invariant 3: **Mostly met** for orchestrator-dispatched work, but standalone
  services can still bypass queue provenance.
- Invariant 4: **Met for governed queue and skill paths**. ToolGate is not, and
  does not claim to be, a host-level policy firewall.
- Invariant 5: **Partially met**. Local state is bounded, but multiple storage
  surfaces can still drift.
- Invariant 6: **Partially met**. The orchestrator is the intended primary
  boundary, but systemd units still provide alternate execution paths.

## Top Risks

- **High**: Standalone service execution can bypass orchestrator-first policy
  intent.
- **High**: Child-process environment inheritance can overexpose credentials to
  agents.
- **Medium**: ToolGate is a meaningful authorization layer, but not a complete
  runtime sandbox.
- **Medium**: Multi-surface state and artifact storage can drift without strong
  reconciliation.
- **Medium**: Multiple deployment surfaces can produce inconsistent operational
  posture if left unmanaged.

## Priority Remediation

1. Filter and minimize agent child-process environment exposure.
2. Prefer orchestrator-dispatched execution over direct service starts in normal
   operations.
3. Keep task allowlist, API schema, and agent task wiring under continuous
   drift checks.
4. Add stronger audit reconciliation across state, logs, and external
   persistence surfaces.
