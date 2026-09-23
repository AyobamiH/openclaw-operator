---
schema: clawsweeper.project-vision.v1
project_id: openclaw-operator
repository: AyobamiH/openclaw-operator
---

# Project Vision

## Identity

OpenClaw Operator is the portable specialist-orchestration layer behind OpenClaw. OpenClaw Control UI, chat surfaces, and the gateway remain the general front door; this repository supplies bounded specialist workflows, governed execution, evidence, and operator drill-down.

## Purpose

Provide a self-hosted way to run AI-assisted operational and engineering work through explicit task lanes, approvals, durable run state, and auditable evidence without turning the specialist layer into a second generic OpenClaw shell.

## Owns

- The portable orchestrator and its task/runtime contracts.
- Specialist operator surfaces that expose orchestrator-only workflows and evidence.
- Product agents, skills, governed task lanes, tests, portable documentation, and release assets.
- Deterministic admission, approval, execution-state, and evidence boundaries for this product.

## Does Not Own

- OpenClaw's generic gateway, Control UI, or general chat experience.
- Host-local estate truth, machine-specific directives, or local runtime inventory; those belong to openclaw-ops.
- AgentProof's independent execution/receipt protocol.
- Relay's social-provider transport contracts.

## Non-Negotiable Invariants

- OpenClaw stays the normal user front door.
- Authority is explicit, bounded, observable, and auditable.
- Deterministic software owns admission, state transitions, idempotency, terminal truth, and effect reconciliation.
- Historical notes and generated artifacts do not override current source/runtime truth.
- Runtime/deployment claims require evidence for both source revision and loaded runtime state.
- Do not grow a parallel generic shell where OpenClaw already owns the capability.

## Evidence of Done

A material change is done only when the repository's relevant verification passes and the claimed behaviour is evidenced at the correct layer. A green source check does not by itself prove deployment or live behaviour.

## Relationships

- openclaw-ops: host-local operating and estate truth.
- AgentProof: independently versioned action execution and signed receipts.
- relay-live-business-engagement-connector: provider transport and shared account admission.

## Canonical Sources

Read README.md and AGENTS.md first, then docs/INDEX.md and the relevant architecture/reference document. Runtime code and live configuration remain execution truth.

## Agent Rule

Use this file for product intent and ownership boundaries. Use code, configuration, tests, and live evidence for implementation truth. If they disagree, surface the drift instead of silently choosing a new product direction.
