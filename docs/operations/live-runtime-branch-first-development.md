# Live Runtime Branch-First Development

The live Operator checkout is production source. `orchestrator.service` runs
`node --import tsx src/index.ts` with its working directory inside
`workspace/projects/openclaw-operator/orchestrator`, so an unfinished edit can
become loaded behavior at the next import, child invocation, or restart.

## Required flow

`LIVE CHECKOUT → SNAPSHOT → RESCUE BRANCH + SEPARATE WORKTREE → LOCAL/CRABBOX VALIDATION → BOUNDED PATCH REVIEW → EXACT ACTIVATION DELTA → RELOAD → LIVE HASH/HEALTH PROOF`

1. Record the live commit/branch, complete tracked and relevant untracked
   state, loaded module hashes, service PIDs/start times, databases, config
   hashes, and a rollback artifact.
2. Create a named rescue or feature branch and a separate worktree under the
   workspace's worktree owner. Do not switch the production checkout.
3. Rehydrate any preserved live diff into the isolated worktree. Exclude live
   SQLite WAL/SHM files and other runtime locks/state from source rehydration.
4. Implement and run focused regression tests in the worktree. Use Crabbox's
   documented self-owned SSH path for isolated or heavy verification when that
   contract applies. Do not install or test experimental dependencies in the
   production checkout.
5. Use Claw Patch only as installed: bounded mapping/review/patch work with
   manual inspection. It neither commits nor pushes nor authorizes deployment.
6. Checkpoint and commit the tested branch. Capture the exact activation patch
   and its digest; verify it applies cleanly to the frozen live state.
7. Apply only that patch. Never reproduce edits manually. Reload only the
   processes whose module-loading behavior requires it.
8. Compare tested and live hashes, verify service and persistence health, check
   scheduler/Graph/ToolGate truth, and retain rollback evidence.

## Deterministic source-provenance gate

The `npm --prefix orchestrator run source:provenance` command is the executable
owner for source-to-runtime proof. ToolGate exposes the same pre-edit,
activation, and runtime verifiers to governed execution paths.

Every runtime-owned change must bind Git toplevel and git-dir ownership, the
registered worktree, branch or detached state, base commit, live path, and
pre-edit live hash before editing or testing. Activation then requires exact
tested/source/live hash equality. A later live superset is acceptable only
after the exact resulting live hash is tested. Resident services require a
post-activation start or reload, effective unit plus drop-in evidence, matching
running path/hash, and healthy state. Ephemeral runners remain
`ACTIVATED_WAITING_FOR_RUNTIME_WITNESS` until a natural invocation records its
PID, command line, source hash, and terminal receipt.

`TESTED_NOT_ACTIVATED`, `ACTIVATED_NOT_RELOADED`, and
`ACTIVATED_WAITING_FOR_RUNTIME_WITNESS` are not synonyms for live or fixed.

## Emergency exception

An emergency live edit is allowed only when waiting for the isolated flow would
materially worsen an active incident. It must be minimal, preceded by a
lossless snapshot, reversible, immediately copied into an isolated branch, and
validated there. The exception does not permit branch switching, broad
refactoring, destructive cleanup, or leaving the live checkout as the only
copy of the change.
