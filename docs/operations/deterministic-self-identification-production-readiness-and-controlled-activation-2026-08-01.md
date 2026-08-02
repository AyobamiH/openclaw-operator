---
title: "Deterministic Self-Identification Campaign Production Readiness And Controlled Activation"
summary: "Final production-gate investigation, hardening, shadow evidence, activation decision, topology, ownership and release receipts."
---

# Deterministic Self-Identification Campaign Production Readiness And Controlled Activation

Date: 2026-08-01  
Scope: Deterministic Self-Identification Campaign only  
Provider writes during investigation and hardening: 0  
Browser Relay calls: 0  
LLM allocation or publication decisions: 0

## 1. Production readiness report

| Gate | Evidence | Status |
|---|---|---|
| Planning, rotation, audiences, identity signals and deterministic scoring | Registry `2026-07-30.1`; 31-day/155-opportunity replay; all 7 products seen; stable replay; primary model on all 31 days | PASS |
| Immutable specifications and strategy binding | Content hashes, immutable specs and campaign-to-strategy validation in 44/44 publishing tests | PASS |
| Evidence, claims, templates and reuse registries | Live overview: 7 evidence, 7 claims, 4 templates; registry validation hash `7ae0ff2850e7e2005e1b5aaf339505e8156fc507193be02e2a8b793cc6a1c609` | PASS |
| Admission, quota, spacing and duplicate prevention | Connector suite: atomic collision, daily quota, spacing, exact/normalized duplicates, restart-persistent ambiguity | PASS |
| Provider readback and ambiguous-write reconciliation | Official connector only; no blind retry; uncertain dispatch restarts enter read-only reconciliation | PASS |
| Audit, metrics and attribution definitions | Hash chain valid; 4 metric definitions and 1 attribution definition loaded | PASS, live metric proof awaits canary |
| Rollback and restart recovery | Rollback test passes; pre-dispatch reservation recovery verified; live stranded reservation recovered from backup with zero writes | PASS |
| Shadow execution | 10 terminal product slots: 6 `shadow_verified`, 4 policy-correct `skipped_policy`; 83 valid audit events; zero in-flight rows | PASS |
| Connector installation | Active connector is healthy but loaded telemetry still reports `0.10.0`; the `0.10.2` identity/convergence repair is verified locally and awaits an explicitly approved installation/reload | APPROVAL BOUNDARY |
| Production runner and scheduler ownership | Shadow job `6fd37958-b450-400e-8c06-a781670f3a03` exclusively owns five product opportunities; four legacy jobs unchanged | PASS in shadow |
| Provider readiness | Instagram and Threads owner identities both authenticated and API-ready on 2026-08-02 | PASS |
| Documentation and release artefacts | Canonical reports, rollback evidence and exact release inputs exist; connector `0.10.2` is clean-release verified and pushed at `fb3c4cac29d8fc09e09b5d7e6b2347ed05fd9041` | PASS |

## 2. Production hardening report

The release candidate was repaired without changing product scope:

- scheduler starts up to five minutes late are deterministically canonicalised to the immutable slot time;
- shared-admission denials now close as auditable `skipped_policy` outcomes rather than failed or stranded slots;
- a persisted `reserved` pre-dispatch state can resume after interruption;
- `publishing`, `published_unverified` and `reconciliation_required` states never redispatch and use read-only provider reconciliation;
- slot reservations now persist `content_spec_id`, and recovery resolves publications through the durable slot key;
- the CLI exposes one explicit canary command only; no general live publishing command was added;
- the exact connector package candidate was converged across isolated source,
  packed tarball and clean-install bytes; loaded-runtime installation remains a
  separate operator-authority boundary; and
- image/Reel creative now carries `Tail Wagging Website Design Factory Northampton` once and removes the redundant `Built locally` badge.

Verification: focused production-integration isolation 9/9; connector 139 total
tests with 134 required passes, five declared unsupported external integrations
and zero required skips; manifest, typecheck, package convergence and clean
installation validation passed. The operator protected-branch `verify:main`
contract passed: build, documentation drift/link checks, 95 unit simulations,
35 live middleware integrations, 34 Operator UI tests, both TypeScript
typechecks, curated documentation sync/check and the VitePress production
build.

## 3. Packaging contract

One contract owns source-to-runtime identity:

`source isolation -> npm ci -> typecheck -> build -> prepared-asset generation/check -> npm pack -> SHA-256/npm integrity -> clean install -> exact file-list comparison -> manifest/module/secret-state validation -> installed-path comparison -> loaded-runtime status`

Local, CI, release and installation use the same package harness; CI, release
and installation additionally require a clean source revision. The verified
release artefact is `0.10.2`, 92 files, SHA-256
`bd2051222b27919c126d72b1876a5e1e3bd2e208cca4d7f95358f1bb929e4a5d`, npm
integrity
`sha512-EQlHjA4A1hCohu8+nNeUdJReGaLMk+rTNR05HMZcov/JMB1qgWPVunEcYSXydvPw4NQ5FlTMzL4jky+0UCI6gw==`,
from clean commit `fb3c4cac29d8fc09e09b5d7e6b2347ed05fd9041`.

## 4. Packaging harness

Harness: connector `scripts/package-harness.mjs`. Installed validator:
`scripts/validate-installed.mjs`. Receipt: connector
`artifacts/package-harness/receipt.json`. Isolated post-prepack source, retained
tarball and clean install share content identity
`278644329b547424fb9527d9120cca44f70e57b77530ed21b700c2081b782a9c`.
The clean install contains 92 files, no compiler, a valid
manifest/configuration schema, a 24-file runtime module graph and 27 verified
prepared assets. Loaded production telemetry remains `0.10.0`; the verified
`0.10.2` tarball has not been installed or loaded without explicit lifecycle
approval.

## 5. Reuse-policy report

The 24-hour rule is rejected. Deterministic policy v2 applies:

- exact rendered asset: 90 days; earlier use requires an approved resurfacing event;
- exact caption plus material identity: 30 days;
- concept: 7 days, fair rotation before reuse and a six-item recent-grid guard;
- template: maximum three consecutive uses when alternatives exist; a single-template exemption is explicit;
- campaign/product/audience/topic/renderer identities participate in novelty scoring;
- account/feed: shared admission enforces account quota, spacing, collision, unresolved-write and cross-lane duplicate rules;
- exhaustion fails closed as `duplicate_content_allocation`.

Evidence: image and Reel simulations each produced 1,825 unique allocations/material hashes over 365 days at five slots/day; 250 production-shaped allocations passed; Reel proof rendered 20/20 distinct representatives with full decode, valid layout and visible frames. Replay returns the persisted slot allocation.

## 6. Shadow-operation evidence

| Opportunity | Runtime | Outcome | External writes | Audit |
|---|---|---|---:|---|
| 2026-07-29 15:00 | prior pinned runtime | `shadow_verified` | 0 | valid |
| 2026-07-31 15:00 | prior pinned runtime | `shadow_verified` | 0 | valid |
| 2026-07-31 17:00 recovery | hardened runtime `20260801-972c41b65241a407` | `shadow_verified`, recovered persisted reservation | 0 | valid |
| 2026-08-01 07:00 | hardened runtime `20260801-972c41b65241a407` | `shadow_verified` | 0 | valid |
| 2026-08-01 11:00 | hardened runtime `20260801-972c41b65241a407` | `skipped_policy`, shared-account collision | 0 | valid |
| 2026-08-01 15:00 | hardened runtime `20260801-972c41b65241a407` | `shadow_verified` | 0 | valid |
| 2026-08-01 17:00 | hardened runtime `20260801-972c41b65241a407` | `shadow_verified` | 0 | valid |
| 2026-08-02 05:00 | hardened runtime `20260801-972c41b65241a407` | `skipped_policy`, shared-account collision | 0 | valid |
| 2026-08-02 07:00 | hardened runtime `20260801-972c41b65241a407` | `skipped_policy`, shared-account collision | 0 | valid |
| 2026-08-02 11:00 | hardened runtime `20260801-972c41b65241a407` | `skipped_policy`, shared-account collision | 0 | valid |

Seven consecutive natural hardened-runtime cycles completed after the initial
lateness/admission repairs. Every run canonicalised to its immutable slot,
reported a valid audit chain, made zero provider writes and made zero LLM calls.
Policy-correct `skipped_policy` outcomes prove cross-lane admission rather than
provider failure. The product database passes `PRAGMA integrity_check`, has 10
terminal slots, 83 audit events and no incomplete slot or publication state.

## 7. Production activation evidence

Not activated. The product scheduler remains enabled in `shadow`; provider
writes remain disabled. This campaign changed no legacy schedule, publisher,
outbox or external campaign. A separately authorised Phase G migration moved
only Instagram schedule `24afbb84-457c-41bb-92c9-24a19725e984` to graph
ownership; the production-integration registry protects that ownership from
this campaign.

## 8. Canary evidence

No campaign canary executed. `self-id-1500` remains the only canary-eligible
opportunity and Threads is now API-ready, but no exact dated slot, frozen
payload or provider-writing approval exists. The canary command requires both
the explicit opportunity and timestamp and cannot run while the integration
manifest is `shadow`.

## 9. Final runtime topology

`product scheduler (shadow) -> immutable runtime 20260801-972c41b65241a407 -> deterministic planner/spec/store -> official social-publication-worker -> loaded Relay connector shared admission -> official Meta API/readback`

Legacy Threads and Instagram schedulers continue independently and converge only at shared account admission. Browser Relay has no role.

## 10. Final ownership matrix

| Responsibility | Owner |
|---|---|
| Product planning, rotation, specifications and product audit | deterministic self-identification runtime |
| Five product opportunities | product shadow scheduler `6fd37958-b450-400e-8c06-a781670f3a03` |
| External campaigns and slots | three legacy-owned jobs plus graph-owned Instagram Image; all remain untouched by this campaign |
| Cross-lane quota, spacing, collision, duplicates and unresolved-write gate | Relay connector shared admission |
| Provider transport/readback | official Meta adapters through `social-publication-worker` |
| Publication truth | provider readback and owned-history discovery |
| Mutable product state | product SQLite store outside source |

## 11. Release evidence

- Operator implementation source: commit
  `dcbcc01d13e40ec32a221cf97dd5d67c97073d5a`, containing the reviewed Phase F,
  Phase G, Threads-recovery and self-identification production-completion set.
- Operator release-evidence commit:
  `fd04cf5e45c0092dfcdba69dc693f00bcb288f47`, pushed with the implementation
  to `origin/main` after the protected-branch pre-push contract passed.
- Immutable shadow runtime input hash: `972c41b65241a407fdc8ee593541c5c4f782f52345081b6868551f9cd0889e16`.
- Connector source: clean commit `fb3c4cac29d8fc09e09b5d7e6b2347ed05fd9041`, pushed to `origin/main`.
- Connector artefact: version `0.10.2`, SHA-256 `bd2051222b27919c126d72b1876a5e1e3bd2e208cca4d7f95358f1bb929e4a5d`, 92 files, exact source/tar/install byte convergence.
- Operator protected-branch verification: `verify:main` passed build,
  documentation, 95 unit, 35 integration and 34 UI tests plus typecheck and
  the production documentation build before handoff.
- Product database backup before recovery: SHA-256 `a3686635e8abbe5e6e290c682dbca1f0f011e9204f4c46e0a3225287fed18c10`.
- Post-recovery SQLite integrity: `ok`; audit chain valid; 3/3 product publications `shadow_verified` at the time of this receipt.
- Connector source was committed and pushed. No public package release,
  connector installation, Gateway restart or campaign provider publication was
  performed by this completion pass.

## 12. Remaining risks

1. The loaded connector still reports stale `0.10.0` telemetry. The verified
   `0.10.2` package closes this defect but installation and Gateway reload are
   explicit operator-authority boundaries.
2. No exact dated canary approval target or provider-writing authority is
   recorded.
3. Campaign live metrics/readback/attribution cannot be proved until one exact
   approved canary exists.
4. The general orchestrator persistence endpoint currently reports its
   separately configured Mongo store unavailable. The campaign runner uses its
   own healthy SQLite store, so shadow safety is unaffected; changing the host
   persistence service/configuration remains a separate maintenance boundary.

## 13. Verdict

**ENGINEERING COMPLETE; PRODUCTION SHADOW ACTIVE. Provider-writing activation
remains NO GO pending the exact canary approval and the separately approved
connector installation/Gateway reload.**
