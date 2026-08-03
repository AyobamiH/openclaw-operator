---
title: "Campaign Content Factory And Full-Graph Runtime Audit"
summary: "Deterministic factory readiness, active shadow proof, multi-agent graph audit, repaired manifest/task bindings, and remaining terminal blockers."
---

# Campaign Content Factory And Full-Graph Runtime Audit

Date: `2026-08-03`

## Decision

The requested audit is complete. The requested factory now produces complete
text, image and Reel packages in a verified zero-write shadow path. The
provider-writing live path remains deliberately unactivated.

- Campaign factory zero-write verdict: `ready`.
- Campaign factory live verdict: `blocked at approval and durable delivery`.
- Full-graph multi-agent runtime verdict: `partial`.
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

Passing structural findings:

- 7 immutable graph definitions across 3 graph families register successfully.
- all production-bound nodes declare an available handler and capability.
- 7 production adapters respect the zero-write/shadow boundary.
- all 19 discovered agent manifests validate.
- all 20 governed task/agent/skill bindings resolve and pass ToolGate task and
  skill policy.
- every agent manifest with an orchestrator task is represented in the central
  binding map.

Non-terminal runtime findings:

- production allows only `deterministic-social-publication@1.1.0` and `@2.0.0`,
  not the complete seven-definition source portfolio;
- coding graph implementation/repair stages still reference `legacy.command`
  while no legacy task body is registered;
- ToolGate is preflight-only, stores decisions in process memory, and does not
  provide host containment or enforce declared call ceilings, network domains,
  or write paths;
- the integration agent emits delegation plans and handoff packages, but no
  graph adapter dispatches downstream agents or records durable child run IDs
  and verifier closure.

## Validation

The focused verification passed:

- orchestrator TypeScript typecheck;
- deterministic campaign-factory replay test;
- immutable media compiler, artifact, tamper-boundary and delivery-binding tests;
- actual zero-write HyperFrames renders for two Reels and one image;
- original-resolution image and extracted Reel-frame visual inspection;
- full graph runtime audit contract test;
- production graph adapter tests;
- ToolGate runtime tests;
- scheduler-safe factory shadow-cycle idempotency test and exact pinned-runtime
  replay;
- repository `npm run verify`: 95 unit simulations, 35 live middleware
  integrations, 34 Operator UI tests, builds, docs checks and both typechecks;
- `git diff --check`.

Independent read-only workers also passed 189 focused publishing/content tests
and 205 focused graph/agent/ToolGate tests before the new harnesses were added.

## Required Next Work

The local content factory is complete. Live Instagram publication still needs
the existing generated-media delivery worker to upload each exact artifact and
return a durable public URL plus matching SHA-256 receipt. The source contract
for that binding is implemented and canary/live execution now refuses media
publication without it. Uploading, changing the active scheduler/runtime
mode away from shadow, issuing an exact one-run capability and making the
provider write are external state changes and remain separate approval
boundaries. The zero-write render/audit scheduler activation is complete.

The multi-agent runtime cannot receive a terminal verdict until an
orchestrator-owned dispatcher creates real child tasks/runs, persists the
source and target receipts, survives restart/replay, and closes through an
independent verifier. ToolGate persistence/enforcement and graph portfolio
ownership must also be resolved.

Any connector install, Gateway/service reload, further scheduler mutation,
migration, provider write, further commit, push, release or deployment still
requires separate explicit approval.
