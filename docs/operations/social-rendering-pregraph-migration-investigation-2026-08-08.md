---
title: "Social Rendering Pre-Graph Migration Investigation"
summary: "Evidence-backed reconstruction of pre-Graph social rendering and publication guarantees, with current migration verdicts and bounded repair recommendations."
---

# Social Rendering Pre-Graph Migration Investigation

Status: terminal natural-cycle verification complete with classification
`PRE_GRAPH_CONTRACT_GOVERNED_WITH_EXTERNAL_BLOCKERS`. Source commit
`8eefb17777eca9bb98a409668cf1e3c37a7da3dd` is pushed and loaded through
immutable runtime `20260808-full-pregraph-v3`; the first natural Campaign
Factory v4 successor cycle completed with zero provider writes. The Meta
state-patch defect is gone, but canonical provider readback exposed a separate
reply-state classification defect that remains a blocker.

The initial investigation was read-only. The subsequent approved social repair
was loaded and exercised in the running orchestrator and is recorded below.
The later business-loop repair passed through separate source, commit, push and
runtime-load stages; runtime exercise is reported separately. All cutover checks
recorded zero provider writes and zero Browser Relay calls.

## Current state separation

The business-loop lifecycle repair has the following independently evidenced
state:

- source implemented: yes, including the final dependency, metric, experiment,
  provenance and Meta reconciliation packet;
- committed and pushed: yes, source commit
  `8eefb17777eca9bb98a409668cf1e3c37a7da3dd` is reachable from remote `main`;
- loaded by the running orchestrator: yes, PID `239207`, active since
  `2026-08-08 20:31:36 BST`, with `NRestarts=0` for this activation;
- runtime verified: yes for the zero-write contract. Immutable runtime
  `20260808-full-pregraph-v3` and Graph-owned Campaign Factory successor
  `campaign-content-factory-full-pregraph-v4` completed their first natural
  `05:00 Europe/London` opportunity;
- terminal limitation: official Instagram readback proves the represented
  account's exact reply already existed before this runtime activation, while
  each post-restart Meta reconciliation receipt classified it absent.

The machine-readable dependency and activation record is
`config/publishing/dependency-readiness.v1.json`. It keeps technical readiness,
campaign decisions, evidence connectors, credentials and provider approval as
separate states.

## Executive verdict

The week before Graph contained four canonical provider-publication lanes,
plus replies, preparation/readiness, reporting and a separate product campaign:

1. Threads text;
2. Threads image;
3. Instagram feed image;
4. Instagram Reel;
5. Meta reply monitoring;
6. deterministic readiness, rendering, delivery, readback and recovery; and
7. the five-opportunity Self-Identification Campaign Factory.

The Graph migration did not replace these deterministic workers. It moved
scheduler and lifecycle ownership into Graph while retaining the workers as
narrow effect adapters. The two initially confirmed media-boundary regressions
and the missing Threads image replenisher were subsequently repaired. The
renderer and stale-fixture defects were also closed, as documented under
"Implemented repair outcome".

The expanded reconstruction found one additional Graph ownership regression:
`business-value-cycle` itself entered `governed-task-execution@1.0.0`, but its
selected `content-generate`, `qa-verification` and `system-monitor` children
could still enter the task queue as lifecycle owners. Source now binds all
three to immutable governed lanes with Graph-owned retry and child/verifier
receipts. The focused receipt suite passes `10/10` and TypeScript passes.

The hard-cutover follow-up activated the five missing campaign-family records
using only existing products, audiences, problems, claims and evidence. It also
added a Graph-owned campaign operations cycle that writes distinct daily and
weekly commercial reports. The generic zero-adjustment experiment is now paused
in source: Phase 7 remains technically ready but intentionally inactive until
an exact hypothesis, metric, control/variant set and stopping rule are approved.
Unavailable provider/CRM/website evidence remains unavailable rather than zero,
and attribution still requires the configured evidence threshold. The one
remaining authority boundary is an exact dated live Self-Identification canary:
no provider write is implied by this source/runtime cutover.

## Pre-Graph estate timeline

| Date | Estate state | Canonical outcome retained |
|---|---|---|
| 2026-07-27 | Publication-path audit | Every reachable Threads write converged on `threads-outbox-runner.mjs`; Instagram Image/Reel on `instagram-publisher-outbox-runner.mjs`; replies on `meta-reply-monitor-outbox-runner.mjs`. Raw Meta tools, Browser Relay and retired publishers were unreachable from the conversational agent. |
| 2026-07-28 | Reel pipeline reconstruction | Deterministic storyboard preparation, local renderer, upload barrier, one publish attempt, readback reconciliation and replenished creative inventory were proven. |
| 2026-07-29 | Threads/Instagram image convergence and Reel layout hardening | Threads Image and Instagram Image joined the same prepared-media contract: complete copy, creative fingerprint, measured DOM fit, contrast, safe margins, exact delivery checksum and provider readback. Reels gained a versioned five-scene layout/readability receipt. |
| 2026-07-30 | Self-Identification Engine and shadow lane | The 18-family registry, deterministic selector, immutable content specification, five global opportunities, exactly-once state, proof lineage, metrics and attribution contracts were committed. The production integration remained a distinct zero-write shadow campaign. |
| 2026-07-31 | Image readiness and reuse hardening | Transient readiness gained one bounded retry; permanent identity/configuration failures still failed immediately. Reuse became rolling and material-identity based, with exact caption/media rechecks before upload. |
| 2026-08-01 to 2026-08-03 | Graph adapter and Campaign Factory preparation | Graph definitions, shadow equivalence, live-capability controls, campaign media delivery receipts and durable runtime persistence were added before scheduler ownership transferred on 2026-08-04. |

The original pre-Graph publication topology was:

| Lane | Scheduler identity | Canonical worker before Graph | Current Graph owner |
|---|---|---|---|
| Threads text | `68b10c5c-f604-4567-9213-d0d1eab08106` | `threads-outbox-runner.mjs --kind text` | `threads-publication@1.0.0` |
| Threads image | `083e3560-40fd-4487-9d78-674f64866ef7` | `threads-outbox-runner.mjs --kind image` | `threads-publication@1.0.0` plus `threads-readiness@1.0.0` |
| Instagram feed image | `24afbb84-457c-41bb-92c9-24a19725e984` | `instagram-publisher-outbox-runner.mjs --kind image` | `deterministic-social-publication@1.1.0` |
| Instagram Reel | `2c7071ff-35dd-40d0-bf77-b1ed53de256e` | `instagram-publisher-outbox-runner.mjs --kind reel` | `deterministic-social-publication@2.0.0` |
| Meta replies | `4de811aa-f213-4cc3-b1aa-6c2cffb6a847` | `meta-reply-monitor-outbox-runner.mjs` | `meta-reply-monitor@1.0.0` |
| Self-Identification shadow | `6fd37958-b450-400e-8c06-a781670f3a03` | deterministic Campaign Factory and publishing engine | `governed-task-execution@1.0.0`, lane `campaign-factory` |

The disabled hourly "continuous social" loop is historical waste, not a
missing campaign phase. It intentionally remains `obsolete`; restoring it
would recreate overlapping authority and unnecessary activity.

## Complete campaign taxonomy recovered

The original knowledge base is retained at
`media/inbound/openclaw-staged-db0b8f58-ac4a-4769-9713-aeac21d86790/Deterministic_Self_Identification_Publishing_Engine_Full_KB_---c1f6fc89-4ea7-421c-ae35-37aee3dd2b3e.docx`
with SHA-256
`9b01a2a9f32a2e9b89525c2fe4808b4711c97424265421337ca93199600cb862`.
It declares eight campaign families:

- self-identification;
- problem-education;
- practical-diagnostic;
- founder-observation;
- proof-and-evidence;
- product-update;
- community-discussion; and
- research-insight.

All eight remain accepted by the content templates and campaign schema. Registry
version `2026-08-08.1` now contains active, approved records for every family.
The five new records reuse existing truth anchors: Founder Rescue owns problem
education and founder observation, Social Agent owns product update, OpenClaw
Operator owns community discussion, and Coding Agent Skills owns research
insight. No new performance or customer-outcome claim was introduced.

The original five opportunity roles are also recovered and retained:

| Europe/London slot | Intended role |
|---|---|
| 05:00 | early discovery |
| 07:00 | morning recognition |
| 11:00 | problem insight |
| 15:00 | practical outcome |
| 17:00 | conversation starter |

They are global deterministic selection opportunities, not promises to publish
on every platform.

## Original phase backlog and present Graph truth

| Phase | Original objective | What exists now | Graph/runtime verdict | Required next boundary |
|---|---|---|---|---|
| 0 — Reconnaissance | Inventory products, evidence, accounts, policies and old publishers | Complete registry and pre-Graph path audit | Complete; evidence retained | Keep registry/evidence current |
| 1 — Deterministic core | Registry, validation, selection, immutable content, state and audit chain | Implemented and covered by replay/harness tests | Complete; executed behind Campaign Factory Graph lane | None for shadow operation |
| 2 — Threads production path | Governed text/image preparation and official publication | Text and image are Graph-native; exact media/proof and replenishment repairs are deployed | Complete for the existing Threads lanes | New campaign payloads still require exact approval |
| 3 — Portfolio activation | Rotate products over five opportunities without conflicting with existing publishers | Seven products, thirteen active campaigns covering all eight families, and the five-slot schedule | Graph-native shadow; product/campaign activation complete, live provider authority still separate | Exact dated payload-bound Self-Identification canary and one-run Graph capability |
| 4 — Asset intelligence | Track source proof and exact/recompressed/derivative relationships | Proof-lineage classifier, registered 42-second master and campaign media receipts exist | Deterministic contract is present and Graph-receipted in shadow | Live campaign use awaits Phase 3 authority; new assets need evidence registration |
| 5 — Cross-platform renderers | Render the selected content contract per approved platform | Threads text/image and Instagram image/Reel are implemented with local canonical rendering | Complete for connected Meta surfaces | LinkedIn/X or any new platform needs an official connector, readback contract and explicit activation; Reddit remains prohibited |
| 6 — Metrics and attribution | Capture honest provider metrics, conversations and evidence-backed outcome links | Official Threads `post_insights` is the only supported provider-metric source in this runtime; views and fully supported engagement-rate inputs are mapped, while unsupported provider fields and CRM/website/conversation/conversion evidence remain unavailable | Natural cycle complete with zero eligible verified provider objects, zero metric reads and zero inferred values; daily and weekly reports keep missing evidence visible as `null`/unavailable | Add new CRM/website evidence only through provenance-bearing adapters when those systems supply records |
| 7 — Experimentation | Apply bounded, approved measurement adjustments | Both experiments are paused and unapproved; reports contain no active experiments and no automatic performance adjustment | `READY_BUT_INTENTIONALLY_INACTIVE` | Separate approval remains mandatory before activation or any non-zero adjustment |
| 8 — Operational hardening | Replay, kill switches, reports, alerts and recovery | Exactly-once/reconciliation, hash-chain audit, capability gates, plus distinct daily and weekly campaign commercial reports | Natural reports complete; repeated runs over the same frozen state and observed time produced byte-identical hashes, with absent metrics and attribution visible rather than coerced to zero | Keep provider writes and future experiment changes separately capability-gated |

## Business-value loop ownership repair

The business-value planner can select four task families from durable business
evidence: `content-generate`, `market-research`, `qa-verification` and
`system-monitor`. Before this expanded investigation only market research was
in the Graph binding map. The planner parent therefore had a Graph receipt but
three selected child lifecycles could be owned directly by the queue.

Source adds immutable governed lanes in the new
`governed-task-execution@1.1.0` definition for:

- `content-generation` → `content-generate` / `content-agent`;
- `qa-verification` → `qa-verification` / `qa-verification-agent`; and
- `system-monitor` → `system-monitor` / `system-monitor-agent`.

Every scheduler, API, approval replay and child-handler ingress already uses
the shared Graph-owned binding map, so these additions close the lifecycle
escape without changing task authority. The queue remains only the bounded
child-effect transport with Graph owning retry and terminal verification.

## Evidence reconstructed

The reference contract was reconstructed from committed source and tests,
historical operation reports, state and artifact hashes, provider receipts, and
the 2026-07-28 through 2026-08-05 daily records. The strongest sources were:

- `docs/operations/instagram-reel-creative-library-2026-07-28.md`;
- `docs/operations/threads-instagram-image-publisher-convergence-2026-07-29.md`;
- `docs/operations/dynamic-reel-and-adaptive-image-contrast-2026-07-31.md`;
- `docs/operations/instagram-deterministic-dynamic-content-engine-2026-07-31.md`;
- `docs/operations/instagram-canonical-renderer-version-drift-repair-2026-08-01.md`;
- `docs/operations/graph-production-adapter-binding-and-shadow-equivalence-2026-08-01.md`;
- `docs/architecture/DETERMINISTIC_SELF_IDENTIFICATION_PUBLISHING_ENGINE.md`;
- the current production adapters, live publication envelope, capability
  builder, workflow definitions, and their focused tests.

## Initial migration ledger (pre-repair snapshot)

This table preserves the findings that caused the approved repair. Rows marked
regressed, missing or risky below are historical at the investigation point;
their final disposition is in "Implemented repair outcome".

| Canonical capability | Original implementation | Evidence/tests | Current graph equivalent | Migrated / missing / changed / regressed | Consequence | Recommended repair |
|---|---|---|---|---|---|---|
| Local deterministic rendering | Local HTML/CSS/SVG plus pinned browser/HyperFrames/FFmpeg; no hosted generation | 2026-07-28 and 2026-07-29 reports; current source renderer tests | Production adapters delegate to the same local workers | Migrated | Media generation remains local and deterministic | Preserve delegation and zero-hosted-generation rule |
| Canonical renderer identity | One source-controlled renderer version plus byte-hash comparison during drift repair | 2026-08-01 drift report; current source and installed file hashes | Instagram uses project source; Threads uses installed extension snapshot | Changed and risky | Both report package `0.10.3`, but renderer bytes differ; version text does not identify behaviour | Converge on one source/install path and add a build digest to renderer identity |
| Reel concept library | 20 treatments and 20 distinct audio identities | Reel creative-library report and library tests | Dynamic Reel engine consumes the canonical library | Migrated | Concept-led treatment and local audio variation remain available | Keep library SHA and audio identity in frozen lineage |
| Dynamic Reel allocation | 60 structures, 8 renderer families, 20 variants, 12 motion grammars, 20 audio identities | 1,825-allocation proof and 20 representative renders | Instagram v2 preparation invokes the dynamic Reel allocator and renderer | Migrated | Daily deterministic uniqueness survives Graph ownership | Retain allocation ID and fingerprint in the Graph envelope |
| Dynamic Image allocation | Deterministic topic/copy selection and eight renderer variants | Dynamic content-engine report and current validate-only proof | Instagram v2 preparation invokes the dynamic Image engine | Migrated | Image selection and bounded visual adaptation remain healthy | Preserve content/material hashes and variant identity |
| Complete image copy | Explicit headline, eyebrow, body and CTA; truncation and ellipsis rejected | 19/19 Threads checks and image convergence report | Worker contracts remain strict | Migrated at worker; host fixtures regressed | Production worker fails closed, but three host tests no longer represent the current contract | Update fixtures to include the required eyebrow and current layout contract |
| Complete Reel copy | Five scenes: hook, problem, method, evidence, close | 54 Reel tests, three diagnostics, current 15:00 validate-only render | Instagram v2 worker builds and renders the full storyboard | Migrated | Complete in-video statements remain enforced | Require the storyboard hash in the Graph envelope |
| Measured image typography and layout | DOM fit, safe margins, semantic placement, overlap checks and adaptive contrast | Image convergence and adaptive-contrast reports | Instagram v2 stores a formal `layoutVerification`; Threads worker stores render evidence | Migrated for Instagram; incomplete Graph binding for Threads | Threads approval does not bind the image layout receipt or media bytes | Add a Threads v2 frozen media/layout envelope |
| Reel visual/readability validation | Per-scene fit, safe margins, contrast, reading-time and full MP4 decode | Reel hardening report; current zero-write Reel validation | Enforced inside the Instagram worker before preparation completes | Changed and risky | The worker is safe, but Graph live binding does not require or compare all proof fields | Freeze and compare layout-audit and reading-time hashes in Instagram v2/v3 |
| Prepared-image guards | Prepared media, payload hash, media hash and approval linkage checked before write | Threads image reports and runner tests | Instagram v2 binds media hash; Threads Graph binds text only | Regressed for Threads Graph boundary | Approved text can remain unchanged while the on-disk image changes | Bind capability `mediaHash`, recompute bytes immediately before upload, and fail closed on drift |
| Deterministic template/variant reuse policy | Date/slot/business-data keyed allocation with bounded reuse exclusions | Dynamic engine proofs | Existing workers remain Graph adapter owners | Migrated | Graph orchestration did not replace the deterministic selector | Add representative Graph equivalence tests for selection identity |
| Frozen artifacts and lineage | Content spec, material content, storyboard/fingerprint, renderer receipt and final media hash | State/outbox receipts and publication reports | Instagram v2 envelope carries these fields; Threads v1 carries only simplified social effect | Migrated for Instagram Image; changed/risky for Reel; regressed for Threads Image | Proof strength differs by platform and format | Use one explicit frozen-publication-envelope contract per media format |
| Provider payload and readback | Exact caption/text/topic/media construction with official readback | Publication receipts and current worker source | Live adapters delegate upload/publish/readback to deterministic workers | Migrated | Exactly owned provider objects can still be verified | Preserve exact payload and provider-object receipt binding |
| Exactly-once and ambiguity handling | Locked durable outbox; write-started state; official reconciliation; no blind retries | Deterministic publishing architecture and incident ledgers | Graph effect/capability layers wrap the same durable worker state | Migrated | Consequential writes remain bounded and ambiguous outcomes fail closed | Keep worker reconciliation authoritative and add envelope-equality checks |
| Autonomous Threads image replenishment | Finite prepared image cycle; no independent proven replenisher | Historical queue reconstruction and current validate-only inventory failure | Readiness preparer can generate future text, but not new image creatives | Missing before and after Graph; not a migration regression | The daily-image schedule eventually skips when inventory is exhausted | Design a separate deterministic image replenisher under product approval |
| Portable source ownership | Canonical connector source plus root operational workers | Repository history and current git inventory | Product adapters use intentional absolute root worker paths | Changed and risky | Dynamic engine files are presently untracked host assets and the product is not self-contained | Canonicalize ownership without moving installed/runtime paths during this report |

## Initial classification (pre-repair snapshot)

### Proven migrated

- local deterministic Image and Reel rendering;
- dynamic selection and creative variation;
- complete Image and five-scene Reel copy at worker level;
- measured layout, safe margins, contrast and reading-time validation;
- Instagram Image content, material, layout and media-hash lineage;
- deterministic provider payloads, official readback, exactly-once state and
  ambiguity-safe reconciliation.

### Behaviour missing at the initial snapshot

- autonomous replenishment of prepared Threads image inventory was not proven
  in the pre-Graph system and was absent at the initial Graph snapshot. It was
  subsequently implemented and zero-write proven.

### Changed but acceptable

- orchestration moved from direct scheduler-to-worker execution to Graph
  adapters while deliberately retaining the deterministic workers as the
  execution owners.

### Initially changed and risky

- Threads and Instagram invoke different renderer byte builds while reporting
  the same package version;
- Reel proof fields exist in the worker projection but are nullable or
  incomplete in the Graph live envelope;
- the portable product depends on host-root dynamic engines whose current files
  are not all tracked in the host operations repository.

### Confirmed regressions at the initial snapshot

- Threads Image Graph approval/capability does not bind media bytes or full
  image proof lineage;
- three host-level Instagram integration tests have stale fixtures and contract
  hashes, even though the canonical connector tests pass.

Both were subsequently repaired and validated.

### Initial design questions and disposition

- Threads replenishment now uses the canonical source renderer while retaining
  a separately governed slot-bound Threads creative contract;
- the existing Graph identities were strengthened in place with the proof
  fields required by their media format;
- the required host dynamic-engine sources are now tracked in the host
  operations repository; installed/runtime copies remain non-canonical.

## Zero-write validation evidence

Focused validation produced the following results:

- current Graph publication/adapter/capability tests: `47/47` passed;
- canonical connector renderer/canary tests: `19` passed, `6` explicitly
  unsupported in the local environment, `0` failed;
- combined host social tests: `98/101` passed. The three failures are stale
  Instagram fixtures: missing required `eyebrow` data and obsolete image layout
  contract/hash expectations;
- Instagram Image 2026-08-08 11:00 validate-only: passed measured layout,
  semantic placement, overlap, contrast and final media binding with
  `providerWrites=0` and `externalWrites=0`;
- Instagram Reel 2026-08-08 15:00 validate-only: passed the complete five-scene
  storyboard, layout, contrast, reading-time, creative fingerprint
  `584b4e3465b6569ecec82dd9ce6b1023b70987e19395a79cc1d6e503021a6663`
  and media SHA-256
  `beeb78117056603acd0dfc1e8aee3dea49ea049ebc773d807881761cd975a1f4`,
  with no protected-state drift and zero external/provider writes;
- Threads daily-image 2026-08-08 11:30 validate-only: failed safely before a
  render or provider action because no approved prepared payload exists for the
  selected campaign item.

## Implemented repair outcome

The approved hard-cutover repair retained the existing production Graph
identities and strengthened their v1/v2 adapter contracts in place:

1. Threads publication Graph v1 now freezes exact
   text, topic tag, media SHA-256, creative fingerprint, renderer identity and
   layout verification. Bind the capability media hash and recompute the file
   SHA-256 immediately before upload.
2. The Instagram Reel envelope now requires non-null storyboard,
   creative fingerprint and renderer identity; freeze layout-audit and
   reading-time hashes; compare durable projection and live envelope before any
   write.
3. Instagram and Threads now invoke the same canonical source renderer. The
   Threads Graph proof also freezes the renderer source digest separately from
   its reported version.
4. Threads readiness now creates deterministic slot-bound Image preparations
   from the approved campaign and explicit 2026-08-08 owner authority. The
   canonical renderer receipt, complete CTA-bearing creative, asset bytes and
   approval binding are validated before queue insertion. Skipped slots remain
   immutable and generated assets are never reassigned between slots.
5. Meta reply ambiguity reconciliation now preserves the original terminal
   receipt and appends a hash-bound corrective receipt after complete official
   readback. No ambiguous write is replayed.
6. The natural 2026-08-08 17:00 Campaign Factory cycle exposed a missing
   package-root metadata file in the previously pinned renderer runtime. The
   immutable runtime builder now includes the canonical renderer package and
   lock metadata, and the scheduler points to a new non-overwriting v2 bundle.
   The unused v1 bundle is retained as evidence rather than rewritten.
6. Already committed Threads readiness is an idempotent success, and
   outside-natural-slot Reel triggers are zero-write deferrals rather than cron
   failures.

Validation after implementation:

- focused Graph contract, capability, adapter, scheduler and dependency tests:
  `113/113`;
- focused Threads tests: `26/26`;
- combined focused host social receipt/state tests: `46/46`;
- TypeScript build: passed;
- autonomous Threads Image replenishment produced two frozen canonical images
  with `providerWrites=0`, complete HyperFrames/layout receipts and exact media
  hashes; their already-skipped slots were not reopened;
- Instagram Reel 15:00 validate-only passed five-scene storyboard, 27 measured
  text boxes, safe margins, overlap, contrast, reading-time, full decode and
  media hashing with `providerWrites=0`.

The three stale host Instagram fixtures were upgraded to layout contract
`1.1.0`; the full host operations gate now passes `199/199`. The host dynamic
engine sources required by the canonical publisher are tracked in the host
operations repository.

The first post-cutover Meta cycle reconciled the stale historical effects, but
the 18:15 local cycle exposed a second contract defect after a newly ambiguous
provider attempt: canonical readback reached the reconciliation node, then
Graph rejected its state patch as
`state_patch_not_permitted:socialEffect.status`. The committed repair no longer
patches unrelated state; it returns the reconciled external-effect state and
preserves the original effect node and idempotency identity.

Natural runtime evidence now proves that exact state-patch defect is gone.
Nine post-restart Meta cycles from `21:15` through `05:15 Europe/London` each
completed on attempt one. Every `reconcile_provider_state` and
`package_terminal_receipt` node succeeded, and no matching state-patch error
recurred. Each cycle retained one external-effect row, one consumed live
capability and exactly one dispatch. The effect moved through the ambiguous
branch to `confirmed_absent`; no effect had a second attempt, provider operation
ID, retry or Browser Relay call.

The same verification exposed a distinct blocker. Official Instagram
`post_replies` readback for parent media `18137975704598362` proves comment
`17885963115612455` already has exactly one represented-account reply,
provider object `18402105745083248`, posted at
`2026-08-08T11:17:54Z`. Its exact text matches the reply draft selected by all
nine post-restart cycles. It predates PID `239207`; therefore no post-restart
duplicate was created. However, the Graph reconciliation receipts report that
exact reply absent and mark the candidate unanswered. Duplicate-ledger
containment prevented a write, but canonical readback classification is not
truthful and must be repaired under a separate source/deployment authority.

## Terminal natural-cycle verification

- Service identity: PID `239207`, active/running since
  `2026-08-08 20:31:36 BST`, `NRestarts=0`; public health returned `healthy`.
  No additional restart was performed.
- Runtime provenance: immutable bundle `20260808-full-pregraph-v3` declares
  source commit `8eefb17777eca9bb98a409668cf1e3c37a7da3dd` and independently
  verified SHA-256 values for registry
  `68673f5f9741b32a37291889925faeaed5b327b379f68257408216c44970563c`,
  integration
  `1a65d0cf2fe48405fb2f814d26acd0b519a8bc3e8d6ba93a3a15e02ec531e9a5`,
  dependency readiness
  `a697141e941b631cd581acdc83dcf22729472aff9041aa5a618d6207c318999d`
  and renderer entrypoint
  `7dea1ff4b77f757c82cd2f6474306d73dbf5ee3b07c60b9dc396a8294046f997`.
  The scheduler portfolio source hash is
  `92bcb78e0d88bad2ac97a8ff0565ecbbf361731829b08953eb278a83b492f424`.
  The loaded ten-definition Graph portfolio, canonicalized as ordered
  `graph_id|version|definition_hash` rows, hashes to
  `dbc1e1e0b7d328027f209c19482a8cb1fc8bdf7feb703323c54b33cd7847f394`.
- First natural successor: schedule
  `2df05813-93e1-4d3f-8731-a5c2de3625d5` completed at `05:03:51 BST` after
  its natural `05:00` opportunity. Trigger
  `gst_e66233cd22be8537f288265b6f7dd52f` bound run
  `grzwcanary_c6df53e1-57fb-4013-8b9c-51d7855289f6`, Graph definition
  `governed-task-execution@1.0.0` hash
  `ad9c80668bc0b348bf48abe5fe2cf4854b95d38682b64f67e6bcf53ee45f240b`.
  The result was `completed_unique_opportunity` / `shadow_verified`, with
  `legitimate_skip`, `zero_write_policy`, no recovery and zero provider writes.
- Receipt closure: all six parent nodes succeeded on attempt one; the 52-event
  chain validates. Child receipt
  `gcr_82f16c34-8af6-40c3-85aa-4f35f3d9fffa` and verifier receipt
  `gvr_b709f1ee-ebfb-441a-b178-ae7d618ff68f:passed:receipt_chain_verified`
  are hash-bound to the run. The child queue task succeeded in one attempt and
  did not retry.
- Whole activation: 33 relevant natural Graph-owned scheduler cycles ran after
  PID start: 29 completed and four failed safe, all with scheduler attempt
  count one and no provider object ID. All 33 Graph event chains and all seven
  scheduler migration chains validate. Across the complete Graph run estate
  created after activation, 147 event chains validate. Thirteen external-effect
  rows exist, none with a provider operation ID; every natural-cycle state
  reports `providerWrites=0`.
- Phase 6: the natural Campaign Factory cycle had zero eligible verified
  provider objects, so it made zero official metric reads and produced no
  metrics. Official Threads metrics are the only supported provider metrics;
  unsupported provider fields and CRM, website, conversation, conversion and
  attribution evidence remain unavailable. Reports expose missing evidence as
  null/unavailable, never as a fabricated zero.
- Phase 7: both registry experiments are paused/unapproved and operational
  reports include no active experiment or automatic adjustment. Status remains
  `READY_BUT_INTENTIONALLY_INACTIVE`.
- Phase 8: daily and weekly JSON/Markdown reports were emitted with missing
  evidence visible. Two independent executions over identical frozen database
  state and observed time produced byte-identical hashes. The canonical natural
  snapshot precedes the same-cycle shadow publication by design, so a replay
  against the post-cycle database has one additional shadow publication while
  remaining internally deterministic.
- Remote containment: official Threads owned-feed readback shows no immutable
  canary copy and no owned post after `2026-08-08T03:43:19Z`. Official Instagram
  readback shows one exact historical reply and no post-restart duplicate.
  Actual provider writes by the verified natural estate are `0`.
- Canary authority: no matching Graph approval, publishing approval, rendered
  candidate or one-run live capability exists for the proposed `15:00`
  Threads packet. It remains immutable proposal evidence only.
- Rollback remains preserved at
  `/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/backups/20260808-full-pregraph-v3-cutover.UsbSaX/`.

## Boundary

The authorized deployment and natural zero-write verification are complete.
The allowed terminal classification is
`PRE_GRAPH_CONTRACT_GOVERNED_WITH_EXTERNAL_BLOCKERS`: source is committed,
pushed and runtime-verified, but Meta reply readback classification remains
incorrect, CRM/website/conversation/conversion evidence is unavailable, and
the immutable `15:00` Threads canary has neither approval nor capability. No
provider retry, Phase 7 activation, canary execution, new provider write or
additional restart is authorized.
