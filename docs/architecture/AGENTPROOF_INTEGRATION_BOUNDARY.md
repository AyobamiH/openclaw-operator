---
title: "AgentProof Integration Boundary"
summary: "Source, runtime, approval and evidence ownership between OpenClaw Operator and AgentProof."
---

# AgentProof Integration Boundary

AgentProof is an independently maintained Apache-2.0 package at
[`AyobamiH/agentproof`](https://github.com/AyobamiH/agentproof). OpenClaw
Operator consumes `@oneclicksystems/agentproof`; it does not vendor AgentProof
source or inherit ownership of its release lifecycle.

## Ownership

- OpenClaw Operator owns canonical task admission, human approval, approval
  replay, operator audit history and the adapter in
  `orchestrator/src/agentproofAdapter.ts`.
- AgentProof owns preparation of the exact repository action, idempotent
  execution, independent result verification, compensation and signed
  evidence receipts.
- The protected target repository remains the authority for the resulting
  source state.
- AgentProof mutable transaction state and signing material must remain outside
  both source repositories.

The adapter fails closed when the approved task, replay link, approval-decision
digest or prepared approval-request digest does not match. Its package-consumer
contract is covered by
`orchestrator/test/agentproof-package-consumer.test.ts`.

## Recovery Disposition

The pre-recovery Operator tree contained an embedded `agentproof/` copy and two
tests that imported that local source directly. Those files are superseded by
the standalone AgentProof repository’s lifecycle, adversarial and repository
patch tests plus the Operator package-consumer contract. They must not be
restored as a second source boundary.

## Current Runtime Limit

The package includes a development authority for local validation. It is not a
production approval authority or signing service. Installing or activating a
production authority remains a separate, explicitly approved runtime change.
