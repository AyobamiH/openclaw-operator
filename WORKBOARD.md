# WORKBOARD

This is the first-read operational tracker for the public `openclaw-operator`
repo.

It is not the canonical runtime spec and it must not compete with code truth,
the canonical anchor, or the architecture/reference docs.

Use it for one thing:

- land quickly on what is done
- what is in flight
- what is next
- what is intentionally parked

Last updated: `2026-07-12`

## Current Headline

The public repo direction is now explicit.

- OpenClaw itself is now the primary front door for daily use through its
  Control UI, chat surfaces, and gateway control plane
- this public repo remains valuable as the specialist orchestrator sidecar:
  bounded lanes, governed evidence, bridgeable operational intelligence, and
  repo-specific runtime truth
- `operator-s-console` remains supported for current orchestrator-specific
  surfaces, but it is no longer the growth center or a competing shell roadmap
- generic shell, dashboard, or parallel-control-UI expansion is now
  intentionally stopped across planning docs and assistant entry points
- current public `main` already includes the capability-closure, bridgeable
  specialist lanes, and legacy-failure fixes needed for that narrower
  direction

## Recently Finished

0. Autonomous Work Controller v1.1 runtime hardening is implemented.
   - approved queue, paused-task, standing-order, workboard, schedule, operator, and capability-gap intake is prioritized and deduplicated
   - the existing provider guard bridges sanitized pause/resume state into durable controller checkpoints
   - incompatible restored model context is blocked before continuation and reserve-threshold compaction checkpoints first
   - small/local models lose unsafe web and runtime tools while ToolGate-governed structured read-only tools remain eligible
   - Telegram targeting uses only an opaque current inbound-session alias

0. Autonomous Work Controller v1 is implemented as a bounded orchestrator lane.
   - approved operator work is normalized into structural lane/risk decisions
   - coding audits route through ToolGate to coding-agent-skills first
   - safe read-only continuation is checkpointed and loop-bounded
   - invocation evidence and deduplicated capability gaps are durable
   - existing queue, approvals, registry, persistence, and scheduling remain authoritative

0. Authenticated specialist-console rendering was repaired.
   - `/operator/business-value` and `/operator/knowledge` no longer render the
     normalization layer's raw diagnostic objects as React children
   - raw payload evidence remains available as non-enumerable `__raw` metadata
   - shared API error rendering and an operator-route error boundary now keep
     unexpected response drift from blanking the entire console
   - installed OpenClaw UI extension surfaces were audited; `/orch` remains the
     supported integration path because no plugin-owned route/navigation mount
     is currently exposed by the installed Control UI

1. Public onboarding path was hardened.
   - local-first dev now boots without requiring Mongo/Redis first
   - docs and docs site were aligned to that path

2. Docs-site publication was curated.
   - only allowlisted public docs now publish to GitHub Pages
   - stale/internal docs stopped leaking into the public docs site

3. Current agent portfolio capability closure landed.
   - all declared non-template public agents now have bounded runtime evidence,
     truthful operator exposure, and closed capability gaps for the current
     runtime slice

4. Legacy spawned-agent failure handling was fixed.
   - structured worker results are now preserved even when the child exits
     non-zero after writing a result file
   - this closed the last Wave 4 integration regression and kept run-detail
     summaries truthful

5. Protected-branch verification was tightened.
   - pushes to `main` / `master` now run a repo-managed pre-push `verify:main`
     gate locally
   - GitHub validation now runs the same protected-branch contract
   - deploy and docs workflows now wait for validation success instead of
     racing it

6. An uncommitted governance spike was intentionally dropped.
   - retained ideas only: dynamic task validation, auth-grace config, route
     inventory, and manifest-boundary concepts
   - dropped implementation because it duplicated the shipped
     `/api/companion/*` surface, targeted stale runtime types/helpers, and
     shipped a self-invalidating route-governance registry
   - future governance work should restart from current `main`, not from the
     discarded local spike

7. The Wave 4 runtime-readiness test was hardened again.
   - the first fix closed early-read races but still left the suite vulnerable
     to cached reads, stale local agent service-state memory, and critical
     incident bleed from earlier failure tests
   - the current test now isolates Wave 4 behind a seeded runtime reset,
     disables retry noise for intentional failure cases, and requires current
     run/task ids when checking promoted runtime evidence
   - assistant workflow guidance now explicitly requires cache-aware real
     completion conditions and isolation from ambient host artifacts for
     integration tests

8. The first new-agent adoption contract is now implemented in repo code.
   - `deployment-ops-agent` now exists as a worker-first, read-only
     deployment posture lane rather than a deploy executor
   - the public runtime, operator UI, task catalog, run-detail deck, and
     integration proof now all include `deployment-ops`
   - the lane sits between `release-readiness` and the approval-gated
     `agent-deploy` mutator without absorbing deploy authority

9. `deployment-ops` is now live-confirmed on the running operator surface.
   - a focused live canary succeeded on `3312` on `2026-04-10`
   - `/api/agents/overview` promoted current-run `deploymentOps` runtime
     evidence for `deployment-ops-agent`
   - `/api/tasks/catalog` and `/api/companion/catalog` now vary their
     protected cache key on the live operator task profile set, which closes
     the stale-post-restart catalog gap that initially hid the new lane

10. The `code-index-agent` contract pass is now complete.
   - the bounded lane is now defined from current repo indexing, knowledge, and
     operator-surface code truth
   - the first slice is explicitly worker-first, read-only, and local-first
   - the contract keeps Codex-like repo intelligence inside the current
     manifest and ToolGate model instead of flattening governance into broad
     unrestricted authority

11. `code-index` is now implemented and live-confirmed on the running operator
    surface.
   - a focused live canary succeeded on `3312` on `2026-04-10`
   - `/api/agents/overview` promoted current-run `codeIndex` runtime evidence
     for `code-index-agent`
   - `/operator/agents` served the same live runtime slice cleanly during the
     canary

12. `test-intelligence` is now implemented and live-confirmed on the running
    operator surface.
   - a focused live canary succeeded on `3312` on `2026-04-12`
   - the live task catalog exposed `test-intelligence` as a confirmed-working
     bounded lane
   - `/api/agents/overview` promoted current-run `testIntelligence` runtime
     evidence for `test-intelligence-agent`
   - the live run detail carried bounded `testIntelligence`, `suiteCoverage`,
     `recentFailures`, `flakySignals`, `releaseRisk`, and `evidenceWindow`
     output for the canary run

13. Repo direction is now aligned around the OpenClaw front door.
   - upstream OpenClaw now clearly owns the generic gateway/control-UI,
     approvals, and task-board direction
   - this repo is no longer treating a parallel shell as the default product
     roadmap
   - first-read docs and assistant entry points should now treat
     `operator-s-console` as a maintained specialist surface only

14. Active onboarding and navigation docs now match that repo direction.
   - quickstarts, getting-started guidance, running-agents guidance, and
     navigation/reference docs now point users toward OpenClaw plus `/orch`
     for daily use
   - `/operator` remains documented honestly as the repo-native specialist
     console for deeper orchestrator work
   - active docs now stop implying that a generic shell is still the default
     growth path

15. The first shell keep-and-deepen slice now targets closure, not shell breadth.
   - run detail now carries an operator follow-through rail for the next
     specialist surface to open after a run finishes or blocks
   - the shell is being deepened where OpenClaw is thinnest for this repo:
     approval gates, incident closure, knowledge freshness, governance review,
     live health comparison, and owning-agent readiness
   - this keeps `operator-s-console` focused on specialist closure work rather
     than reopening a generic dashboard roadmap

16. The next shell keep-and-deepen slice now resolves exact run handoff targets.
   - run detail now resolves linked approval and incident handoff context from
     live approval and incident data instead of only pointing operators toward a
     generic queue
   - follow-through routes now preserve run/task context into approvals and
     incidents so operators land on the exact closure object already linked to
     the run when that linkage exists
   - approvals and incidents now honor run-handoff focus in-page, keeping the
     shell deep on specialist closure detail instead of broadening the shell
     surface

## Current Recommended Next Move

Stabilize the OpenClaw-front-door cutover in normal use:

- use OpenClaw plus the orchestrator bridge as the normal daily path and prove
  it in routine usage
- keep watching for shell-first planning drift before opening another growth
  slice
- keep `operator-s-console` maintenance-only unless a change directly supports
  a unique orchestrator lane not already covered by OpenClaw

Current implementation target:

1. use OpenClaw Control UI/chat plus `/orch` bridge flows as the default human
   workflow
2. keep `/operator` and `operator-s-console` focused on unique
   orchestrator-specific evidence and workflows, not generic shell growth
3. prove the bridge-led path is enough for normal operation before widening the
   local specialist surface again
4. only after the cutover is stable reopen another bounded specialist-lane
   build slice

## Intentionally Parked

These are real work items, but they are not the immediate next build slice.

1. Generic shell growth or `operator-s-console` expansion beyond current
   specialist surfaces.
   - no new generic dashboards, shell redesigns, or front-door polish meant to
     compete with OpenClaw Control UI
   - keep shell work limited to maintenance or unique orchestrator-specific
     specialist workflows

2. Broader external-catalog agent growth beyond the current proven specialist
   lanes.
   - one candidate at a time only
   - do not reopen this until the OpenClaw-front-door cutover is fully
     reflected in repo guidance and normal use

3. Further usage-refinement polish.
   - better queue-style triage surfaces
   - more ledger-level next-action and freshness guidance

4. Coordination scale-out beyond the current bounded Redis / Valkey slice.

5. Ongoing docs-truth maintenance and navigation hygiene.

6. Host-specific lifecycle expansion for additional resident services.
   - only if a host genuinely needs them

7. Optional maintenance-visibility follow-up from retired branch archaeology.
   - the old `feat/heartbeat-maintenance-cutover` branch was not kept as a
     merge target
   - if revisited, re-implement only from current `main`
   - preserve these ideas, not the branch shape:
     - maintenance cadence records behind the internal heartbeat scheduler
     - operator overview maintenance card
     - optional diagnostic toggle for internal maintenance runs
   - do not merge the old branch wholesale because later runtime, onboarding,
     capability, and docs-site work already superseded most of it

## Hard Rules

1. Do not treat prose from external role catalogs as shipped capability.
2. Do not bulk-import external agents.
3. Do not widen tool or network boundaries just to make a new agent possible.
4. Productize one bounded agent at a time with:
   - lane
   - governed access
   - operator evidence
   - tests
   - docs

## Source Files To Trust Next

If deeper context is needed, read in this order:

1. Canonical anchor: [`../../../OPENCLAW_CONTEXT_ANCHOR.md`](../../../OPENCLAW_CONTEXT_ANCHOR.md)
2. [docs/architecture/AGENT_ADAPTATION_PLAN.md](./docs/architecture/AGENT_ADAPTATION_PLAN.md)
3. [docs/operations/SPRINT_TO_COMPLETION.md](./docs/operations/SPRINT_TO_COMPLETION.md)
4. [docs/architecture/AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md](./docs/architecture/AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md)
