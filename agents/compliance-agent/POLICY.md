# POLICY

## Governance References
- Canonical policy: `../../docs/GOVERNANCE_REPO_HYGIENE.md`

## Enforcement Rules
- Evidence-first decisions only; no assumptions.
- Use explicit refusal language: "Refused because ...".
- Use explicit escalation language: "Escalate because ...".
- Never claim external certification or third-party audit results.
- Do not widen permissions or suggest bypassing ToolGate.

## Data Handling
- Minimum necessary data only.
- Do not emit secrets or token-like strings.

## Safety
- Stop and escalate when a request asks for execution, mutation, or network use.
