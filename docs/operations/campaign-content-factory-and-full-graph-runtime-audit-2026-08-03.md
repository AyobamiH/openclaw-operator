---
title: "Campaign Content Factory And Full-Graph Runtime Audit"
summary: "Deterministic factory readiness, active shadow proof, complete governed graph-runtime engineering, and remaining live-activation authority boundaries."
---

# Campaign Content Factory And Full-Graph Runtime Audit

Date: `2026-08-03`

## Decision

The requested audit is complete. The requested factory now produces complete
text, image and Reel packages in a verified zero-write shadow path. The
provider-writing live path remains deliberately unactivated.

- Campaign factory zero-write verdict: `ready`.
- Campaign factory live verdict: `blocked at approval and durable delivery`.
- Full-graph multi-agent source/runtime contract verdict: `complete`.
- Provider writes performed by this mission: `0`.
- Approved scheduler changes: `1` payload/description update on the existing
  zero-write shadow job; its schedule, enabled state and delivery mode are
  unchanged.
- Service, Gateway, connector installation and provider-writing runtime mode
  changes: `0`.

These verdicts deliberately reject two previous overclaims: a caption without
an immutable image/reel artifact is not an Instagram content package, and a
handoff plan without a durable child run receipt is not multi-agent execution.

## What Was Added

The source now contains four repeatable evidence and shadow-activation commands:

```bash
npm --prefix orchestrator run campaign-factory:audit -- --local-date 2026-08-03
npm --prefix orchestrator run campaign-factory:render-local -- \
  --local-date 2026-08-03 \
  --artifact-root <workspace>/artifacts/business-value/marketing \
  --renderer-entrypoint <prepared-renderer>/bin/local-media-renderer.mjs
npm --prefix orchestrator run campaign-factory:shadow-cycle -- \
  --registry <runtime>/config/publishing/registry.v1.json \
  --integration <runtime>/config/publishing/production-integration.v1.json \
  --db <state>/deterministic-publishing.sqlite \
  --artifact-root <workspace>/artifacts/business-value/marketing \
  --renderer-entrypoint <pinned-renderer>/bin/local-media-renderer.mjs \
  --opportunity auto
npm --prefix orchestrator run graph:audit:full
```

The campaign commands evaluate every configured London opportunity through the
canonical registry, selection, immutable content-spec, validation and shadow
decision path. Image and Reel opportunities compile bounded local creative
specs and run through the prepared offline HyperFrames renderer. The factory
re-hashes the final bytes, verifies the success receipt, geometry/decode checks,
renderer version and zero-write counters, then freezes a content-spec-bound
artifact manifest. It never uploads or calls a provider.

The scheduler-safe shadow-cycle command is idempotent across the five daily
opportunities. It renders missing dated media once, independently re-verifies
and reuses existing immutable bytes, requires all five packages to pass the
factory audit, and only then executes the existing production-shadow
opportunity path. Its top-level receipt must report `externalWrites: 0`.

The graph command creates an isolated zero-write runtime and audits immutable
definition registration, handler/capability binding, zero-write authority,
agent manifests, task/agent/skill bindings, loaded production scope, ToolGate
enforcement depth, and durable multi-agent execution receipts.

The task/agent/skill map is now single-source in `taskHandlers.ts`. The duplicate
copy in `index.ts` was removed. All 19 manifests use the same millisecond
`constraints.timeout` contract. `drift-repair` and `reddit-response` now have
explicit ToolGate bindings, and `system-monitor-agent` explicitly declares both
`system-monitor` and `incident-triage` rather than silently failing the latter.

## Campaign Factory Evidence

The deterministic audit produced five immutable zero-write content packages:

| Opportunity | Platform | Format | Content | Media artifact | Shadow readiness |
|---|---|---:|---:|---:|---:|
| `self-id-0500` | Threads | text | ready | not required | ready |
| `self-id-0700` | Instagram | reel | ready | verified | ready |
| `self-id-1100` | Instagram | reel | ready | verified | ready |
| `self-id-1500` | Threads | text | ready | not required | ready |
| `self-id-1700` | Instagram | image | ready | verified | ready |

Totals: five opportunities, five shadow-ready, zero media-blocked and three
durable-delivery-blocked. The two Reels are 12-second vertical H.264/AAC
artifacts with full-decode, encoded-frame, layout, reading-time and audio
evidence. The image is a 1080x1350 PNG with exact source/rendered text,
contrast, font, safe-area and overlap evidence. The final artifact hashes are:

- `self-id-0700`: `c98f8d035787bb2407ca8fc1283a44c44f5d2247bdce9f11b331370fb03eb7c8`
- `self-id-1100`: `d245ec227c5addd1c44ca51e0cb12a45e50c6e3ab36bf2e7483bcd3a13250497`
- `self-id-1700`: `e5e7128e8095d5d6e51b338efa29e7210957ef5c0842f43de4cd0047c58bd329`

The canonical evidence is under
`artifacts/business-value/marketing/2026-08-03/campaign-content-factory/`.
The first Reel attempt failed closed because the old legacy adapter no longer
matched the current storyboard audit. A second first-pass render then exposed
an internal content identifier during human visual inspection. That complete
attempt is preserved under
`campaign-content-factory-superseded-internal-id/`; the compiler now uses the
current versioned storyboard contract and a public campaign label.

The production-shadow scheduler remains enabled at
`0 5,7,11,15,17 * * *` in `Europe/London`. Its natural `05:00` run on
`2026-08-03` completed `shadow_verified`, passed shared Threads account
admission, validated the audit chain, and recorded zero external writes and
zero LLM calls. The later approved activation changed only the command payload,
description and command timeouts; it did not alter or force the schedule.

## Approved Zero-Write Shadow Activation

John approved the prepared next steps on `2026-08-03`: freeze the verified
diff, create a local release commit and pinned runtime, and update shadow cron
`6fd37958-b450-400e-8c06-a781670f3a03` to execute the factory render/audit
path. The approved activation completed as follows:

- local release commit:
  `b50ee5542c92b59657e7e8b435f2111c776a2e5b`;
- immutable runtime:
  `~/.openclaw/runtime/deterministic-self-identification-publishing-engine/b50ee5542c92b59657e7e8b435f2111c776a2e5b`;
- pinned command:
  `dist/publishing/campaign-factory-shadow-cycle-cli.js`;
- pinned HyperFrames renderer:
  `renderer/bin/local-media-renderer.mjs`, SHA-256
  `4622fabd95f7edfb1224258172d48f6ada7240d92f191bfb5c8b9679c4485cef`;
- job schedule/enabled/delivery:
  unchanged at `0 5,7,11,15,17 * * *`, `Europe/London`, enabled and
  delivery-none;
- next natural pinned-runtime opportunity after activation: `2026-08-03
  11:00 BST`;
- force runs, uploads, provider writes, service/Gateway reloads, migrations,
  pushes and public releases: `0`.

Before the scheduler update, the exact pinned command replayed the already
terminal `self-id-0700` slot. It re-hashed and reused all three immutable media
artifacts, audited all five packages `ready`, suppressed provider dispatch and
reported `externalWrites: 0`. The first scheduler API update attempt was
rejected before dispatch because that validator could not represent an
existing command payload. The installed `openclaw cron edit --command-argv`
path then applied the one approved mutation, and independent cron readback
confirmed the exact payload and stable adjacent schedule/delivery fields.

## Full-Graph Multi-Agent Audit Evidence

The repeatable `graph:audit:full` verdict is now `passed`:

- 8 immutable graph definitions across 3 graph families register successfully;
- the exact production policy supports four non-experimental definitions:
  `coding-change@1.2.0`, `deterministic-social-publication@1.1.0`,
  `deterministic-social-publication@2.0.0`, and
  `research-to-action@1.1.0`;
- 8 production adapters respect their declared authority and zero-write
  boundaries;
- all 19 discovered agent manifests and all 20 governed task/agent/skill
  bindings validate;
- legacy `coding-change@1.0.0` and `@1.1.0` remain immutable compatibility
  definitions but are excluded from production loading; production
  implementation and repair nodes now use `production.agent-child-run.v1`;
- ToolGate decisions, denials, policies, usage ceilings and single-use
  execution capabilities persist in an owner-only SQLite database with an
  immutable hash chain;
- the queue and skill execution paths authorize immediately before execution
  and close each capability as consumed or failed;
- graph child tasks can reuse a graph approval only when internal metadata
  resolves to the exact active receipt, supported production graph and
  unexpired granted approval;
- child and verifier receipts bind parent run/node/attempt, task and agent,
  authority, input/policy/output/evidence hashes and terminal outcome;
- restart/replay returns the recorded outcome without redispatch, and SQLite
  triggers reject terminal receipt or ToolGate-chain mutation.

ToolGate remains an authorization and durable decision layer, not a host
filesystem/network/process sandbox. That is an explicit design boundary, not
an unimplemented policy claim: host containment remains `false`, while every
declared ToolGate policy in the governed queue/skill path is enforced.

## Validation

The focused verification passed:

- orchestrator TypeScript typecheck;
- deterministic campaign-factory replay test;
- immutable media compiler, artifact, tamper-boundary and delivery-binding tests;
- actual zero-write HyperFrames renders for two Reels and one image;
- original-resolution image and extracted Reel-frame visual inspection;
- full graph runtime audit contract test;
- graph schema-v3 migration, child/verifier restart/replay, approval-reuse and
  tamper-rejection tests;
- production graph adapter tests;
- ToolGate runtime plus durable restart/denial/capability/tamper tests;
- scheduler-safe factory shadow-cycle idempotency test and exact pinned-runtime
  replay;
- repository `npm run verify`: 95 unit simulations, 35 live middleware
  integrations, 34 Operator UI tests, builds, docs checks and both typechecks;
- the complete orchestrator suite: 538 non-load tests plus all 10 load tests
  against an isolated temporary server and state directory;
- `git diff --check`.

Independent read-only workers also passed 189 focused publishing/content tests
and 205 focused graph/agent/ToolGate tests before the new harnesses were added.

## Remaining Authority Boundaries

The local content factory is complete. John has conditionally approved the
existing generated-media delivery worker to upload the exact selected artifact
and make one exact provider canary only after the first natural pinned-runtime
shadow proof succeeds. The delivery worker must return a durable public URL
plus matching SHA-256 receipt; canary execution fails closed without it. Until
that natural proof exists, neither the upload nor provider mutation is
authorised to start. Changing the active scheduler/runtime mode away from
shadow remains a separate boundary. The zero-write render/audit scheduler
activation is complete.

The graph-runtime engineering findings are closed. Loading the new graph
portfolio, applying schema v3 to the production graph database, selecting the
durable ToolGate production path, and exercising the queue dispatcher in the
running service require a production deployment/configuration change and a
service or Gateway reload. Those actions were explicitly excluded from this
mission and remain human-authority boundaries; source completion must not be
misreported as live activation.

Any connector install, Gateway/service reload, further scheduler mutation,
production migration, provider write beyond the approved exact canary, release
or deployment still requires separate explicit approval.

## Approved production activation follow-up

John separately approved the lifecycle boundary on 2026-08-03. The existing
Factory cron was repointed to the immutable `11a8067` runtime without changing
its schedule, timezone, enabled state, delivery-none setting or shadow mode.
No diagnostic execution or provider write was authorised.

The non-empty production graph database exposed a reporting defect in the
initializer: `GraphStore` completed its transactionally safe v2-to-v3 upgrade,
then the CLI incorrectly applied the new-database-only empty-state assertion.
The initializer now requires empty execution state only when it creates a new
database. A regression fixture upgrades a non-empty v2 database, preserves its
definition row and verifies both receipt tables. Re-entry reports the migrated
schema, integrity, foreign-key status and preserved execution-row count.

The production portfolio remains zero-write and contains exactly
`coding-change@1.2.0`, `deterministic-social-publication@1.1.0`,
`deterministic-social-publication@2.0.0` and
`research-to-action@1.1.0`. ToolGate is explicitly bound to the owner-only
production SQLite path and is initialized during service startup; startup
fails if its durable decision hash chain is invalid. Database and configuration
rollback copies were retained before activation.

## 2026-08-03 Operational Follow-Up

The repeatable full-graph audit was rerun after source completion and returned
`passed` for all ten findings: 8 definitions, 3 families, 8 production
adapters, 19 manifests and 20 governed task bindings. Focused publishing
integration and media-artifact tests passed 12/12, including a strict CLI
parser for importing a hash-bound `CampaignMediaDelivery` receipt. The CLI now
accepts `--media-delivery <path>` for `production-canary`; the runner still
refuses every non-text canary or live dispatch without an immutable receipt
whose artifact, content, media and upload hashes bind to the exact content
specification.

The orchestrator typecheck and isolated 77-test ToolGate/runtime suite passed.
The full suite also passed the graph kernel, durable ToolGate, child/verifier
receipts, production adapters, Campaign Factory and publishing groups. Its
legacy HTTP load file was not counted as a local unit regression because it
requires an explicitly started `OPENCLAW_LOAD_TEST_BASE_URL`; without that
server it failed at `fetch`. One verifier case exceeded the global 60-second
timeout only under full-suite contention and passed in isolation in 23.79
seconds. No running service, database, Gateway, scheduler or provider state
was changed by this follow-up.

The first natural pinned factory cycle started at `11:06:31 BST`, 391 seconds
after its immutable 11:00 opportunity. Media reverification and the five-item
factory audit completed, but the five-minute integration tolerance then
rejected opportunity admission. The cycle therefore failed closed with zero
uploads and zero provider writes; it is not accepted as the conditional canary
proof. Source configuration now permits at most ten minutes of scheduler
lateness—the validator's existing hard maximum—and tests prove that the
observed 391-second delay canonicalises to the immutable slot while 601 seconds
still fails closed. Installing that source/config revision and repointing the
cron payload remain runtime/scheduler lifecycle changes, so the running pinned
job was not mutated by this source repair.
