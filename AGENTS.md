# AGENTS.md — OpenClaw Operator Project

This repository owns OpenClaw's portable specialist-orchestrator source,
contracts, tests, and project documentation. OpenClaw Control UI/chat is the
primary user front door. `/operator` and `operator-s-console` are specialist
orchestrator surfaces, not a competing generic shell.

## Session workflow

Before substantial work:

1. Read `WORKBOARD.md` for current direction, finished work, parked work, and
   the recommended next slice.
2. Read `ASSISTANT_WORKFLOW.md` for the permanent assistant sync workflow.
3. Read today's and yesterday's `memory/YYYY-MM-DD.md`. If either is missing,
   create a short placeholder so continuity cannot fail silently.
4. In a direct main session, read `MEMORY.md`.
5. Start the manual crash-safe memory guard:
   `bash scripts/memory_guard.sh start "<current focus>"`.

Checkpoint after material milestones and before risky operations:

```bash
bash scripts/memory_guard.sh checkpoint milestone "<what changed>"
bash scripts/memory_guard.sh checkpoint risky-op "<what is about to run>"
```

Before the final response in a direct main session:

```bash
bash scripts/memory_guard.sh closeout "<summary>" "<next step>"
```

The guard is a model-invoked project runbook, not a background service. Its
purpose is to retain enough current state to resume after a WSL disconnect,
process death, or session loss before a normal compaction or `/new` handoff.

## Required product context

If work touches runtime behavior, agent capability, operator surfaces, task
exposure, governance, proof delivery, or API contracts, read this minimum set:

1. `docs/INDEX.md`
2. `docs/reference/api.md`
3. `docs/reference/task-types.md`
4. `docs/architecture/AGENT_CAPABILITY_MODEL.md`
5. `docs/architecture/AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md`
6. `docs/architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md`

Use those owners before changing capability claims, promoting tasks into
operator-facing profiles, or changing `/operator` or `operator-s-console`.
Do not reopen shell-first product plans unless the work belongs to a unique
orchestrator lane that OpenClaw does not already cover.

## Authority and ownership

- Treat runtime code and live configuration as execution truth, then canonical
  architecture/reference documents, then supporting runbooks, then dated
  history and snapshots.
- For non-trivial information needs, consult the knowledge-routing entry point
  before broad document loading. Resolve the smallest route, retrieve only the
  authoritative source needed for the task, follow verification edges before
  making current-state claims, and stop retrieval once sufficient evidence
  exists. The routing graph is navigation metadata; if it disagrees with the
  source it points to, the source wins.
- Treat this repository as portable source truth. Do not mistake an installed
  runtime mirror, generated artifact, service working tree, or archive for the
  canonical source. For deployment claims, prove both the source revision and
  the bytes/process actually loaded by the runtime.
- Preserve unrelated dirty-worktree changes. Do not overwrite, revert, or
  silently absorb another task's edits.
- Read-only investigation does not authorize deployment, service restarts,
  provider writes, messages, publication, approval, or other external effects.
- Surface capability gaps explicitly. Do not flatten scoped permissions into a
  claim of universal authority or enforcement.
- `coding-agent-skills` is an optional read-only evidence adapter. It may help
  map or inspect code, but it is not a scheduler, execution owner, deployment
  authority, or substitute for runtime proof.

## Execution and verification

- Use real runtime paths and completion conditions rather than hardcoded
  success fixtures or fixed sleeps.
- When a fresh value may be cached, vary the request key or use a non-cached
  truth surface.
- Treat timing-sensitive integration failures as real until the relevant race,
  cache, or lifecycle behavior is explained. For a flaky class, one local green
  run is insufficient evidence.
- Do not keep an LLM session alive to await a future natural schedule. Persist a
  compact evidence watermark, let the runtime scheduler wait, and inspect only
  newer evidence when resumed.
- Keep deterministic software responsible for authority, admission,
  idempotency, effect reconciliation, terminal state, and audit truth. Agentic
  reasoning may prepare or assess work only inside the authority granted by the
  owning contract.

## Canonical doctrine owners

Keep project doctrine with the subsystem that can keep it true. This file is a
map, not a duplicate specification.

- **Business value:** `orchestrator/src/business/mission.ts`,
  `orchestrator/src/business/valueLoop.ts`, and
  `orchestrator/src/business/scoring.ts` own the active mission, outcome/KPI
  traceability, and prioritization semantics. Activity, engagement, and
  verified business conversion remain distinct evidence states.
- **Social publication:** the publishing registry/connectors, Graph production
  adapters, official workers, and
  `docs/architecture/DETERMINISTIC_SELF_IDENTIFICATION_PUBLISHING_ENGINE.md`
  own scheduling, one-run authority, provider-write limits, official-API
  transport, readback, ambiguity reconciliation, duplicate protection, and
  terminal truth. Browser automation is not an implicit publication fallback.
- **Local media rendering:**
  `docs/operations/social-rendering-pregraph-migration-investigation-2026-08-08.md`
  and the bound media-artifact/production-adapter code own the zero-hosted,
  deterministic local-rendering policy for the current social paths.
- **Memory continuity:** this file and `scripts/memory_guard.sh` own the manual
  crash-safe workflow. Dated memory files are evidence, not policy owners.
- **Audit evidence:** Graph, ToolGate, publishing, and subsystem stores own
  deterministic receipts where those lanes are governed. Manual ledgers are
  supplementary evidence and must not be described as universal enforcement.
- **Migration strategy:** the applicable ADR or migration runbook owns each
  cutover, compatibility, rollback, and deletion decision. There is no blanket
  project rule requiring hard cutover or forbidding backward compatibility.
  For Graph execution use `docs/architecture/ADR-001-GRAPH-NATIVE-EXECUTION.md`;
  narrower contracts may deliberately specify hard cutover for their own
  scope.

## Documentation discipline

- Prefer a small update to the existing canonical owner over a new parallel
  doctrine document.
- Keep dated investigations as evidence and history unless `docs/INDEX.md`
  explicitly promotes them.
- When code or configuration changes materially, update the relevant existing
  documentation in the same change set.
- When shipped direction or the next intended slice changes, update
  `WORKBOARD.md` and keep assistant entry points aligned.
- When OpenClaw absorbs a generic platform concern, retire the parallel project
  roadmap and preserve only this repository's specialist-orchestrator value.
