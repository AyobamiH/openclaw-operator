# Doc Specialist ("Doc Doctor")

Status: Active task runbook
Primary orchestrator task: `drift-repair`
Canonical contract: `agent.config.json` and `src/index.ts`

## Mission
Keep OpenClaw documentation synchronized with reality, generate fresh knowledge packs when drift appears, and make the next repair or verification step obvious to the operator.

## Contract

### Inputs
- `doc-diff` payloads from the Orchestrator (`drift-repair` tasks)
- Local mirrors referenced by `docsPath` and optional `cookbookPath` in `agent.config.json`
- Optional escalation context from `orchestratorStatePath`

The knowledge input policy is intentionally broader than markdown-only. The
agent ingests curated text, code, config, notebook, and asset-manifest clues
from the mirrored docs trees. Binary-heavy asset directories are not read as
raw files, but they now contribute manifest summaries so example media and
support artifacts remain visible to downstream agents.

### File Path Scope
- `docsPath`
- `cookbookPath` (optional supplemental source)
- `orchestratorStatePath`
- `knowledgePackDir`
- `serviceStatePath`

These paths are part of the protected repository hygiene surface and must be evaluated under `docs/GOVERNANCE_REPO_HYGIENE.md` before any cleanup recommendation.

### Outputs
- Structured completion logs pushed back to the Orchestrator (`doc-sync` and `drift-repair` records)
- Updated knowledge packs written to `knowledgePackDir`
- A bounded retained set of the 30 newest knowledge packs. Older matching pack
  files are pruned after a successful write and their names, sizes, and
  timestamps are appended to
  `logs/archive/knowledge-pack-retention.jsonl`. Non-pack files are never
  selected by this retention path.
- Telemetry events (success/failure, per-file stats)
- Operator-facing summary fields:
  - `operatorSummary`
  - `recommendedNextActions`
  - `specialistContract`
- Runtime intelligence overlays including:
  - incident priority queue
  - workflow blocker summary
  - target-agent relationship windows
  - repair drafts for the strongest agent surfaces

## Runtime

This agent does not currently expose a local `package.json` script surface.
Runtime invocation is handled by orchestrator dispatch and optional managed
service wiring.

## Operation Flow
1. Receive a `drift-repair` task containing doc paths and target agents to refresh.
2. Load the affected docs and create a knowledge pack artifact.
3. Reconcile runtime incidents, workflow stop signals, and recent relationship history for the requested target agents.
4. Generate repair drafts that explain which agent or operator action should happen next and why.
5. Emit a pack-level operator summary that explains the repair loop status, strongest contradictions, and the safest next move.
6. Emit telemetry via `shared/telemetry.ts` for each stage (load, pack generation, upload).
7. Return a JSON summary so the Orchestrator can update `driftRepairs` history.

## Escalation Rules
- If a doc fails validation, emit `drift-alert` with the file path and reason.
- If knowledge pack upload fails twice, mark the task `error` and raise to a human operator.

See `src/index.ts` for the executable entry point and `agent.config.json` for environment expectations.

## Governance
- `ROLE.md`
- `SCOPE.md`
- `POLICY.md`
- `TOOLS.md`
- Canonical policy: `../../docs/GOVERNANCE_REPO_HYGIENE.md`
