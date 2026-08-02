---
title: "Graph Runtime Gate A Deployment Evidence"
status: "gate-a-complete-deployed-but-not-loaded"
date: "2026-08-01"
approvedBaseline: "df765e90aa5d11b9deaf7795112e85e0f628ddd3"
---

# Graph Runtime Gate A Deployment Evidence

## Verdict

**GATE A COMPLETE — DEPLOYED BUT NOT LOADED**

Gate A placed no new process, database, schedule, feature flag or provider
state into service. The host deployment topology runs TypeScript source
directly from the canonical checkout. The reviewed graph-enabled source was
already present at that exact deployment path when this gate began. Gate A
therefore verified and designated that in-place source as the deployment
candidate instead of inventing a copy-based deployment lane. PID 461 continues
to hold the implementation loaded on 2026-07-29.

## Canonical target and pre-state

| Property | Evidence |
|---|---|
| Repository | `/home/oneclickwebsitedesignfactory/.openclaw/workspace/projects/openclaw-operator` |
| Branch / HEAD | `main`; `df765e90aa5d11b9deaf7795112e85e0f628ddd3`; `0 ahead / 0 behind origin/main` |
| Service | `orchestrator.service`, active/running, `MainPID=461`, `NRestarts=0` |
| Working directory | `/home/oneclickwebsitedesignfactory/.openclaw/workspace/projects/openclaw-operator/orchestrator` |
| Start command | `/usr/bin/env bash -lc exec node --import tsx src/index.ts` |
| Loaded timestamp | `2026-07-29 08:23:04 BST`; no loaded Git/build identity is exposed by the process |
| Production graph DB | `/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/database/graph-runs.sqlite` absent |
| Health | `GET http://127.0.0.1:3312/health` -> HTTP 200; persistence health -> HTTP 200 |
| Configuration digest | `37726dc3baf092824f633efe168bc98ac5c8865f066344d140f5fcaeb5bd3c62` over the installed unit, runtime drop-in, non-secret Operator config and canonical publishing registry/integration files |

The systemd unit has one credential-bearing `EnvironmentFile`; only graph key
names were queried. No `OPENCLAW_GRAPH_*` key was present. Secret values were
not read or persisted.

## Diff ownership review

The working tree contains 45 changed or untracked paths. They are not one
homogeneous deployment patch.

| Ownership | Paths | Disposition |
|---|---|---|
| Graph kernel and bindings | `orchestrator/src/graph/`, graph scripts/tests, `orchestrator/src/index.ts`, `orchestrator/src/openapi.ts`, `orchestrator/src/publishing/shadow-equivalence.ts` | reviewed and included in the in-place candidate |
| Graph docs/canary proposal | ADR, graph reports/registry/runbook, capability/API/config docs, `systemd/orchestrator-graph-zero-write-canary.conf` | reviewed; canary drop-in remains repo-only and is not installed |
| Pre-existing publishing hardening | publishing integration config, CLI, engine, production integration/runner/store and integration test | preserved byte-for-byte; not reverted, reformatted or copied over |
| Gate A evidence | this report plus the tool ledger and daily memory entry | evidence-only; no runtime path change |

The complete tracked diff digest before Gate A evidence was
`5c6a05f3e4009d1d5fb76892d4be23ffc2f979113d70eea0f895c423560de20e`.
The graph source-tree digest is exactly the approved
`1edff568572cf06a98cb3eb9cec328cb5503952fb7c6d4474bb425dc9036fa1e`.

Review found no graph-stage modification to root outbox runners, Gateway cron
definitions, provider credentials/account IDs, Browser Relay policy, the
installed service unit, restart policy, bind address, authentication settings,
current task SQLite state or Redis settings. The graph bootstrap is gated by
an exact `OPENCLAW_GRAPH_RUNTIME_ENABLED === "true"` comparison; a missing or
invalid value is disabled. Database construction and route registration occur
only inside that enabled branch, which additionally requires explicit
zero-write mode.

## Isolated build and checks

To avoid rewriting live-served UI or executable files, the release checks ran
against an isolated snapshot containing only Git-tracked and explicit
non-ignored source. `.git`, `.env*`, credentials, runtime state, databases,
logs, caches, coverage, existing build outputs and `node_modules` were not
copied. Existing dependency directories were linked read-only for command
resolution; no package install occurred.

Snapshot:
`/home/oneclickwebsitedesignfactory/.openclaw/state/activation/graph-gate-a-20260801-yXHryv/source`

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Production build | `npm run build` | exit 0 |
| Focused graph/publishing/OpenAPI | `npx vitest run test/graph-kernel.test.ts test/graph-production-adapters.test.ts test/publishing-engine.test.ts test/integration/publishing-production-integration.test.ts test/openapi.contract.test.ts` | 5/5 files, 92/92 tests, exit 0 |
| Documentation sync | `npm --prefix orchestrator run docs:check-sync` in canonical Git checkout | 8 files checked, exit 0 |
| Whitespace | `git diff --check` | exit 0 |
| Secret patterns | value-suppressing high-confidence scan over task paths | no matches, exit 0 |

The documentation checker could not run in the isolated snapshot because that
snapshot deliberately excludes `.git`; it was rerun successfully in the
canonical checkout. The live HTTP load test was not rerun because this gate
forbids starting an alternate service or restarting the current service.

## Artefacts and reproducible mapping

| Artefact | SHA-256 |
|---|---|
| `openclaw-operator-gate-a-build.tgz` | `0c1c476bc9cd1f749b429de1cb4d39e12a442db3cce52c4e432d5e7ba9635696` |
| Orchestrator `dist` file-set digest | `33b205c5a01236ca074381a15a69ee2630444511e6281d71be99febc32e6e281` |
| Operator UI `dist` file-set digest | `4061bca7fdf5179cd8ab3f9f34cb41edc20945661a6f1d9972a88c3abce8a813` |
| `rollback-tracked-head.tar.gz` | `2ef5e7310b714df1cb057ab10fe2e76ee5954fd1efdb188aaca1eddcd2f03205` |

Artefacts are under
`/home/oneclickwebsitedesignfactory/.openclaw/state/activation/graph-gate-a-20260801-yXHryv/`.
The build tar contains only isolated `orchestrator/dist` and
`operator-s-console/dist`. It is build evidence, not the host service input;
the installed unit continues to execute canonical `src/index.ts`.

## Deployment action

Exact files transferred into the live application tree: **zero**. The
canonical repository is itself the installed application tree and already
contained the approved bytes. A self-copy or second installed tree would have
created competing authority and risked overwriting unrelated dirty work.

Gate A's state change is the immutable isolated build/rollback evidence and
the designation of the already-present reviewed source as the next-load
candidate. It is reversible before any restart and does not affect PID 461.

## Disabled-runtime and state proof

- installed unit and drop-in: no `OPENCLAW_GRAPH_*` keys;
- credential environment file: no graph key names;
- source default: missing/invalid enable flag resolves false;
- routes: registered only when a graph runtime object exists;
- database: constructed only when the exact enable flag is true;
- canary drop-in: remains uninstalled in the repository;
- graph scheduler/worker: none registered;
- production graph database: absent;
- graph API in the loaded service: absent/fail-closed;
- graph runs/events/effects/leases: none, because no graph persistence exists;
- legacy cron jobs remain authoritative.

Final post-deployment readback at `2026-08-01T18:02+01:00`:

| Assertion | Result |
|---|---|
| Service lifecycle | `MainPID=461`, `NRestarts=0`, active/running, original `2026-07-29 08:23:04 BST` activation timestamp |
| Shallow health | HTTP 200, `status=healthy` |
| Persistence health | HTTP 200, SQLite healthy with 9 legacy collections, Redis coordination healthy |
| Loaded graph route | `GET /api/graphs/health` -> HTTP 404 (`Cannot GET`), proving the old process did not acquire graph routes |
| Loaded graph metrics | no `openclaw_graph_*` metrics |
| Production graph DB | absent |
| Bounded graph state scan | no graph DB, event or lease files under the production database boundary |
| Scheduler ownership | the same 10 job IDs, schedule kinds and enabled states before and after; no cron mutation |
| Provider/browser effects | Gate A invoked no connector, provider, publication, message or Browser Relay mutation |
| Configuration | digest remained `37726dc3baf092824f633efe168bc98ac5c8865f066344d140f5fcaeb5bd3c62` |
| Reviewed graph source | approved digest remained `1edff568572cf06a98cb3eb9cec328cb5503952fb7c6d4474bb425dc9036fa1e` |

## Rollback readiness

Filesystem rollback before Gate C is separate from loaded-runtime rollback.
PID 461 already runs the old loaded implementation, so no process rollback is
needed at Gate A.

The previous tracked versions of shared graph-touching files are preserved in
`rollback-tracked-head.tar.gz`. A filesystem rollback would:

1. verify the archive SHA-256 above;
2. restore only its exact tracked paths into the canonical checkout;
3. move the exact new graph-only files listed by Gate A evidence to a
   recoverable quarantine rather than use broad `git clean`;
4. preserve every pre-existing publishing-hardening path;
5. rerun typecheck, focused tests, graph-DB absence and service PID checks.

No rollback was performed. Restoring filesystem bytes before Gate C would not
change PID 461. If Gate C had already loaded new bytes, loaded-runtime rollback
would require a separately approved restart and is outside this gate.

## Stop boundary

No database initialisation, graph execution, flag activation, service action,
scheduler mutation, provider/Browser Relay call, commit or push occurred.
The next independently reviewable action is **Gate B — initialise only the
reviewed production graph persistence schema while the graph runtime remains
disabled**. Gate B was not executed.
