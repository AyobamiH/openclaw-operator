# Compliance Agent

Status: Implemented (worker-first, read-only)
Primary orchestrator task: `compliance-review`

## Purpose

Provide bounded compliance posture synthesis across local policy documents,
dependency manifests, release-facing governance signals, and runtime evidence.
This lane is read-only and does not execute audits, CI, or shell workflows.

## What It Owns

- policy and governance doc coverage checks (LICENSE, SECURITY, conduct, etc.)
- dependency posture summaries from local package manifests
- release-facing compliance risk signals (security, verification, release)
- operator-facing next actions when evidence is missing or stale

## What It Refuses

- running tests, CI, or shell commands
- editing source files or policy documents
- claiming external compliance certification or third-party attestations

## Outputs

- `compliance` posture with decision, blockers, followups, and evidence window
- `operatorSummary` and `recommendedNextActions`
- `specialistContract` for operator-facing handoff

## Governance

This lane is read-only and bounded to explicit local paths defined in
`agent.config.json`. It does not widen tool or network scope.
