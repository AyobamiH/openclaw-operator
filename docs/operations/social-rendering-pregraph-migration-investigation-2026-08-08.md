---
title: "Social Rendering Pre-Graph Migration Investigation"
summary: "Evidence-backed reconstruction of pre-Graph social rendering and publication guarantees, with current migration verdicts and bounded repair recommendations."
---

# Social Rendering Pre-Graph Migration Investigation

Status: complete — evidence reconstruction and migration verdict only.

No production behaviour, service, schedule, provider payload, upload, or
publication was changed by this investigation. The live-shaped checks were
validate-only and recorded zero provider writes, zero external writes, and zero
Browser Relay calls.

## Executive verdict

The Graph migration retained most of the canonical social pipeline by
delegating preparation and publication to the existing deterministic workers.
The current image and Reel renderers still prove local generation, deterministic
selection, complete copy, measured layout and contrast, reading-time checks,
creative fingerprints, and media hashes.

Full equivalence is not proven, however. Two Graph-boundary regressions remain:

1. `threads-publication@1.0.0` binds approval and capability to the text hash,
   but not the prepared image bytes, topic tag, creative fingerprint, or layout
   receipt. The worker stores a media hash, but the Graph capability exposes
   `mediaHash: undefined` and does not recompute the file hash immediately
   before upload. Splitting preparation from live execution therefore widened a
   time-of-check/time-of-use gap.
2. Instagram Reel preparation still enforces storyboard, layout, contrast, and
   reading-time requirements, but `deterministic-social-publication@2.0.0`
   permits nullable Reel proof lineage and does not freeze or compare the full
   Reel layout/readability evidence before live publication.

The other visible defects are not primarily Graph scheduler defects. They are
renderer installation/version drift, stale host-level integration fixtures,
and an unproven Threads image-inventory replenishment capability.

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

## Migration ledger

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

## Classification

### Proven migrated

- local deterministic Image and Reel rendering;
- dynamic selection and creative variation;
- complete Image and five-scene Reel copy at worker level;
- measured layout, safe margins, contrast and reading-time validation;
- Instagram Image content, material, layout and media-hash lineage;
- deterministic provider payloads, official readback, exactly-once state and
  ambiguity-safe reconciliation.

### Missing behaviour

- autonomous replenishment of prepared Threads image inventory was not proven
  in the pre-Graph system and is still absent.

### Changed but acceptable

- orchestration moved from direct scheduler-to-worker execution to Graph
  adapters while deliberately retaining the deterministic workers as the
  execution owners.

### Changed and risky

- Threads and Instagram invoke different renderer byte builds while reporting
  the same package version;
- Reel proof fields exist in the worker projection but are nullable or
  incomplete in the Graph live envelope;
- the portable product depends on host-root dynamic engines whose current files
  are not all tracked in the host operations repository.

### Confirmed regressions

- Threads Image Graph approval/capability does not bind media bytes or full
  image proof lineage;
- three host-level Instagram integration tests have stale fixtures and contract
  hashes, even though the canonical connector tests pass.

### Open questions

- whether Threads image replenishment should share Instagram's dynamic Image
  engine or retain a separately governed creative contract;
- whether the next publication-envelope version should be format-specific or
  use a common media-proof schema;
- which repository should canonically own the host operational dynamic engines
  before any portability cutover.

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
6. Already committed Threads readiness is an idempotent success, and
   outside-natural-slot Reel triggers are zero-write deferrals rather than cron
   failures.

Validation after implementation:

- focused Graph contract, capability, adapter and scheduler tests: `93/93`;
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

The first post-deployment Meta natural cycle also exposed stale Graph effect
states from earlier ambiguous receipts. Complete canonical provider readback
classified one historical effect as `effect_verified` and three as
`confirmed_absent`, leaving zero unresolved Meta `request_sent`,
`provider_accepted` or `ambiguous` effects. The live adapter now performs this
receipt-bound reconciliation before reserving a new same-target dispatch, and
the regression is covered by a focused Graph adapter test.

## Boundary

The investigation and the explicitly approved repair are complete. No second
manual provider write was inferred from the already-consumed one-time Threads
proof authority. Runtime activation, commit and push use the explicit approval
recorded in the 2026-08-08 operator conversation; provider publication remains
limited to natural scheduled authority.
