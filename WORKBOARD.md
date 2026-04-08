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

Last updated: `2026-04-06`

## Current Headline

The public repo is in a shippable state.

- current public `main` includes the capability-closure and legacy-failure fix
  through commit `c857273`
- current portfolio productization is mostly done for the shipped operator
  product
- broader external-catalog agent growth has not started yet

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

## Current Recommended Next Move

Do one bounded adoption-contract pass for the first queued external-catalog
candidate:

- `DevOps Automator -> deployment-ops-agent`

That pass should answer only:

1. what exact task lane it owns
2. whether it is `worker-first` or `service-expected`
3. what governed skills it can honestly use right now
4. what operator-visible evidence it must emit
5. what it must explicitly refuse

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
