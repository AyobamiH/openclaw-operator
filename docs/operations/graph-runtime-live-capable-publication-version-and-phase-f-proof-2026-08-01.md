---
title: "Live-Capable Publication Graph v2 and Phase F Attempt"
status: "blocked-before-provider-mutation"
updated: "2026-08-01"
---

# Live-Capable Publication Graph v2 and Phase F Attempt

## Verdict

`AUTONOMOUS LIVE-GRAPH BUILD OR PHASE F BLOCKED`

The immutable live-capable graph and its loaded zero-write proof were completed,
but the live publication was not attempted. The canonical orchestrator startup
guard rejects every graph runtime configuration that is not explicitly
zero-write. Temporarily resolving `OPENCLAW_GRAPH_ZERO_WRITE_ONLY=false`
therefore caused fail-closed service exits before graph recovery or provider
dispatch. The service was restored to structural zero-write mode, the exact
candidate claim was released, and the run was cancelled. Provider writes,
provider containers, public objects, external-effect rows and Browser Relay
mutations remained zero.

## Immutable version and bindings

- Preserved graph: `deterministic-social-publication@1.1.0`, definition hash
  `f4f41c406ff8399c8e10b2012bf06a5dc0357a28f983e73f328cac3a2d3d592c`.
- New graph: `deterministic-social-publication@2.0.0`, definition hash
  `995ff8355a57113884129b7cda9f7966d4719163f9b9b81ed77e87d12c6a3473`.
- Both immutable definition rows exist independently in
  `/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/database/graph-runs.sqlite`.
- New allowlisted adapters:
  `production.instagram-publication-prepare.v2`,
  `production.instagram-publication-live.v2`, and
  `production.instagram-publication-readback.v2`.
- Unknown adapters still fail closed. Browser Relay is not used.

The v2 topology separates durable preparation, payload-bound approval,
pre-dispatch effect intent, provider mutation, reconciliation, official
readback and completion evidence. The engine now persists `request_prepared`
and `request_sent` external-effect states before a mutating adapter can execute,
and verifies the adapter idempotency key and effect payload hash before commit.

## Durable claim and frozen envelope

Run `grzwcanary_bc5ecbd1-aae1-4714-83c0-f87d1a65e72a` began at
`2026-08-01T22:43:46.811Z`, inside the natural `23:00 Europe/London` Reel
window. While the runtime remained zero-write it created exactly one durable
claim and one frozen asset:

- claim: `gclaim_86f7e0c6e4740465ac6ddaf3e69b8532`;
- approval identity reserved in the envelope:
  `gap_1a66c3e32d2470bc7f65cca182947e6a`;
- candidate: `instagram-dynamic-reel:148624b9373fbb5a52aed391`;
- slot: `instagram:2026-08-01:23:00:2c7071ff-35dd-40d0-bf77-b1ed53de256e`;
- provider/account: `instagram` / `17841453638630920`;
- payload SHA-256:
  `8b32f47c369af3ffd477a44e18805f457021230364203a7f5f2669d8fa348f9e`;
- media SHA-256:
  `b4095c87ba91dc8237c0c2e693e10f577794e8596bd783f3a29781217d7787d2`;
- media bytes: `1426894`;
- envelope SHA-256:
  `1f66b96842339c1d0accea96ed18b288548fadb8e3f2c6b6ba7ef7fcfb0e8be6`.

The outbox was `render_validated`, with upload/publish counters `0/0`, before
the live activation attempt. After the startup guard blocked continuation, the
claim was released with reason
`phase_f_live_activation_startup_guard_blocked`; the run was cancelled and no
approval row was created.

## Loaded zero-write proof

The first loaded v2 canary found two fail-closed host compatibility defects:

1. the canonical Instagram runner defaulted to a nonexistent nested extension
   renderer path; and
2. the installed service PATH exposed Node `24.12.0` while the current OpenClaw
   CLI requires at least `24.15.0` in the Node 24 line.

Both failures occurred during validation with zero approvals, zero effects and
zero provider writes. The runner default was corrected to the canonical
workspace project renderer and the installed unit PATH was aligned to the
already installed Node `24.18.0`. The affected runner suite passed `53/53`, and
the full self-contained Operator suite passed after the source repair.

Loaded canary `grzwcanary_7912c8b6-d575-4a8b-b94c-28ac9a7c4df0` then reached
`publish_provider_object` and was structurally blocked by the zero-write policy.
Its effect and approval counts were both zero. The canary was cancelled only
after its evidence was captured so its single-run resource lock could be
released for the live-preparation run.

The exact preparation run produced 104 hash-chained events before cancellation,
and 106 after the two cancellation events, with 20 evidence rows and kinds
`candidate-claim`, `payload-hash`, `media-hash`, `frozen-envelope`, and
`zero-provider-writes`. Its event chain validated before cancellation.

## Live activation blocker and restart evidence

The installed drop-in was temporarily changed from
`OPENCLAW_GRAPH_ZERO_WRITE_ONLY=true` to `false` only after the exact claim and
envelope existed. On startup, `src/index.ts` rejected the configuration with
`graph_runtime_requires_explicit_zero_write_policy`. No graph recovery or
provider adapter ran.

Because the installed unit retains `Restart=on-failure`, the guard produced an
automatic restart sequence before the health loop returned. The policy was
immediately restored to `true`; the final service state is:

- PID `1076883`;
- `NRestarts=11`;
- `active/running` since `2026-08-01 23:49:49 BST`;
- `/health`: HTTP `200`;
- `/api/persistence/health`: HTTP `200`;
- allowed definitions: `1.1.0,2.0.0`;
- runtime policy: `OPENCLAW_GRAPH_ZERO_WRITE_ONLY=true`.

This is a material deviation from the intended bounded restart count. It did
not create graph or provider state, but it exhausts the approved restart budget
and is therefore the stop condition. A future live control must preserve the
startup guard while providing a separately reviewed, payload-bound, one-run
activation mechanism; simply setting zero-write false remains prohibited.

## Database, scheduler and external-effect proof

Post-rollback read-only verification:

- SQLite `PRAGMA integrity_check`: `ok`;
- `PRAGMA foreign_key_check`: zero rows;
- database mode/owner: `0600`,
  `oneclickwebsitedesignfactory:oneclickwebsitedesignfactory`;
- database SHA-256:
  `89e2474e484ed15cc200bc21bd63ce3e4fd2c99135a4b821369abdd6a7b088b8`;
- definitions/runs/events/approvals/effects: `2/15/620/0/0`;
- Phase F run approvals/effects: `0/0`;
- active scheduler digest:
  `3d392d239220d17ea881839d199ae7bbf6624419523def37f8c97ed7554f2a96`;
- all-scheduler digest:
  `55bd4f487ee2031041e36885193871496396947fc439081121c8b4bf92994897`;
- selected Reel job: disabled, schedule unchanged;
- upload calls/publish calls/Browser Relay calls: `0/0/0`;
- provider object ID/public URL: none, because no mutation was dispatched.

## Verification and source digests

- runner tests: `53/53`, exit `0`;
- focused graph/initializer/adapter tests: `64/64`, exit `0`;
- full self-contained Operator suite: passed, exit `0`;
- loaded HTTP suite against port `3312`: `10/10`, exit `0`;
- typecheck and build: exit `0`;
- 1.1.0 hash-preservation test: passed;
- effect-intent ordering and changed-media rejection tests: passed.

Task-owned source SHA-256 values:

- `orchestrator/src/graph/types.ts`:
  `c9326dd3cab996e2674c29a14d829ba46128987d294cbdc4e97604f976029ebf`;
- `orchestrator/src/graph/engine.ts`:
  `c76b29cdc0091fd4a6c9dfe302d22961bebe1594b0535fcbcda32fe212d5bf7c`;
- `orchestrator/src/graph/live-publication.ts`:
  `e72ad2634d1f6a32e4fcfe8804dfa0db9eda9e14e35de8af09180dbe26d179fb`;
- `orchestrator/src/graph/production-adapters.ts`:
  `75593db0436b2079b1177f69e8b50c1ad217a3e63c8b5841a8df27f9fef5c150`;
- `orchestrator/src/graph/workflows.ts`:
  `1a8140a6c65e176456d61f80a042a31749fea82a78b89fdf1345f33404083997`;
- canonical Instagram runner:
  `9ce82dd6b70b7e366ffdb4e3e9c7e67a59d851292d122039cf05863729721b99`.

## Rollback and remaining boundary

The safe rollback is complete: structural zero-write is restored, health is
green, the candidate claim is released, and the run is cancelled. No provider
compensation is required because no provider mutation occurred. The frozen
asset and graph evidence are retained for audit but carry no active approval.

Phase F is not complete. Before another live attempt, implement and locally plus
loaded-zero-write verify a bounded live activation control that satisfies the
startup guard, enables only one named run/envelope, and cannot start arbitrary
live graph execution. Then obtain fresh Phase F authority because the prior run
was cancelled and its claim released. Phase G scheduler transfer remains
prohibited.
