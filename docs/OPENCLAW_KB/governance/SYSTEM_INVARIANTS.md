# System Invariants (Safe Autonomy Guardrails)

Last updated: 2026-08-03

These are non-negotiable controls required for safe scale.

1. Orchestrator-mediated task intake is allowlist-only.
2. Unknown task types are rejected and auditable.
3. Protected APIs require bearer authentication.
4. Webhook ingress requires valid HMAC signature over canonical payload.
5. Every task result mutation is persisted with task ID and timestamp.
6. No skill/tool invocation may execute without policy evaluation.
7. Agent role permissions must be runtime-enforced, not declarative only.
8. Destructive operations require explicit approval gate before execution.
9. Mission chains require bounded depth/TTL to prevent runaway autonomy.
10. Cross-workspace writes are denied unless explicitly delegated and logged.

## Current Status
- Invariants 1-5: mostly enforced.
- Invariant 6 is durably enforced on the governed queue and skill-dispatch
  paths, including graph child runs, with restart-safe single-use capabilities
  and denial records.
- Invariants 7-10 remain scope-dependent: role and graph authority is enforced
  on governed paths, destructive approval is explicit, but host containment,
  universal standalone-process mediation, mission-wide TTL policy and every
  cross-workspace execution surface remain separate controls or incomplete
  coverage.
