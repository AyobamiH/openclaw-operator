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

Last updated: `2026-04-12`

## Current Headline

The public repo is in a shippable state.

- current public `main` includes the capability-closure and legacy-failure fix
  through commit `c857273`
- protected-branch shipping now has a repo-managed verification contract:
  local pre-push gate plus CI-aligned publish gating
- the Wave 4 readiness integration test is now hardened against cached stale
  snapshots, not just early reads
- current portfolio productization is mostly done for the shipped operator
  product
- the first broader external-catalog growth slice is now built in repo code as
  the bounded `deployment-ops` lane
- the next two bounded external-catalog growth slices are now built in repo
  code as the read-only `code-index` and `test-intelligence` lanes
- an uncommitted governance spike was reviewed against current code truth and
  intentionally dropped instead of being carried forward as local drift

## Recently Finished

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

## Current Recommended Next Move

Open the next bounded external-catalog adoption slice as a contract pass:

- `Support Responder -> support-operations-agent`

`deployment-ops-agent`, `code-index-agent`, `test-intelligence-agent`, and
`compliance-agent` are now all implemented and live-confirmed. The next useful
move is to define the bounded `support-operations-agent` contract from current
runtime code, knowledge-pack posture, and FAQ/support surfaces before opening
another implementation slice.

Current implementation target:

1. define the worker-first `support-operations-agent` lane from current
   knowledge-pack, FAQ, and policy surfaces
2. keep it bounded to read-only support drafting and routing guidance on the
   first slice
3. make its outputs operator-visible and evidence-backed before widening any
   external or execution authority
4. only after the contract pass decide whether it should be the next build
   slice or whether another queued candidate should move ahead

Do not start by bulk-researching many candidates or importing external repo
structure wholesale.

## Intentionally Parked

These are real work items, but they are not the immediate next build slice.

1. Broader external-catalog agent growth beyond the first candidate.
   - one candidate at a time only

2. Further usage-refinement polish.
   - better queue-style triage surfaces
   - more ledger-level next-action and freshness guidance

3. Coordination scale-out beyond the current bounded Redis / Valkey slice.

4. Ongoing docs-truth maintenance and navigation hygiene.

5. Host-specific lifecycle expansion for additional resident services.
   - only if a host genuinely needs them

6. Optional maintenance-visibility follow-up from retired branch archaeology.
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
