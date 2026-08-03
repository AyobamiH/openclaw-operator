---
summary: "Repair and production proof for the graph-owned Instagram image semantic truncation incident."
status: "complete — production quality gate proved"
date: "2026-08-02"
---

# Instagram creative layout repair and quality gate

## Current verdict

**INSTAGRAM CREATIVE LAYOUT DEFECT REPAIRED — GRAPH QUALITY GATE PROVED IN
PRODUCTION.** The natural `2026-08-03 05:00 BST` graph-owned cycle published
exactly one API-verified Image/Feed object from the exact frozen media that
passed the canonical layout contract. Full source copy is visibly present and
the persisted semantic, geometry, font and final-media bindings all pass. The
existing defective post remains published exactly once as incident evidence;
no deletion or replacement was attempted.

## Exact defective publication

- schedule: `instagram-single-image-feed-daily-v1` /
  `24afbb84-457c-41bb-92c9-24a19725e984`;
- migration: `phase-g-instagram-image-v1`;
- scheduler trigger: `gst_8c68fd2b9b23d0d008fd113a2fee551d`;
- graph run: `grzwcanary_e0eb6eeb-10e6-4dea-bab6-d080032f498d`;
- claim: `gclaim_d5045b66bef3579a0f86e65fbdaab010`;
- approval: `gap_f7154c6351d85b7995c0084987936e3e`;
- one-run capability: `glc_297a230ea655fcc4147788a29cbdcb98`;
- provider effect: `gex_d8d8805d-92bb-4b6c-adec-281fb5bb580e`;
- provider object: `18031591145828795`;
- provider container: `18056370089787955`;
- public URL: `https://www.instagram.com/p/DbiXsKmFjDK/`;
- payload SHA-256:
  `386f572ca9a156643331df2148977942788ed99112cdfff1abfeeb56e659fedc`;
- media SHA-256:
  `a976e13bf9bec1a943b6cfac61ad84472b4475eb3843be3a49d281598e450f57`;
- envelope SHA-256:
  `b95eceb901a453cf7cfb5e1459a4ddeb860efd1da3fcc069069b66fa4a32afa`;
- template: `tailwagging-dynamic-card-checklist-v1`, renderer variant
  `checklist-split-gold`, registry `1.0.1`;
- renderer: HyperFrames `0.7.64`, Chrome for Testing `149.0.7827.55`,
  viewport `1080x1350`.

The frozen source caption contained the full message. The frozen image spec did
not: it persisted `Weak product boun… · Practical` and
`Treat a product boundary nobody can explain as a state pr…`. The visible
defect therefore existed before provider upload and was not introduced by
Instagram.

## Root cause

`instagram-dynamic-content-engine.mjs` used a generic `short()` helper that
silently sliced image fields and appended Unicode ellipsis before rendering.
The image renderer then compared only the already-shortened DOM against its
boxes. Its audit checked dimensions, local overflow under only selected CSS
overflow modes, safe margins and contrast. It did not bind rendered text to
canonical source text and did not reject ellipsis, line clamping, parent
clipping, missing fonts, minimum-font violations, line-count violations,
opacity or text overlap. The Instagram worker required the stronger layout
audit only for Reels, so an incomplete Image asset could be frozen and approved.

## Canonical layout contract

`tailwagging-image-layout-contract.v1` is the shared producer/renderer/worker
contract. It fixes the canvas and safe inset, bounds each semantic field,
forbids renderer-added ellipsis and unbreakable overlong tokens, defines six
ordered repair profiles, records minimum readable font sizes and requires an
approved local font.

The browser-level audit now proves:

- source/rendered character equality after NFKC and whitespace normalisation;
- no Unicode or CSS ellipsis and no active line clamp;
- bounded scroll geometry and no hidden overflow or clipping parent;
- every text rectangle inside the 48-pixel safe area;
- no disallowed text intersections;
- configured minimum font and maximum line count;
- deterministic `TailWagging Sans` resolution from local `DejaVu Sans`;
- visible, opaque text and WCAG contrast;
- equal source/rendered text SHA-256 values.

## Deterministic repair

The renderer records at most six layouts: `initial`, `balanced-reflow`,
`compact-heading`, `compact-copy`, `expanded-copy-region`, and `compact-all`.
It reflows and adjusts approved typography/regions without changing source
copy. Two identical no-progress geometries stop repair. Exhaustion fails closed;
no ellipsis, hidden overflow, below-minimum font, arbitrary template or copy
rewrite is available as a fallback.

The exact incident fixture required six attempts and passed with
`compact-all`. The strict final regression PNG is `1080x1350`, SHA-256
`824fc7e9c1df94b3600078940a9cab883191f3af48a2dfb409d09af29c71d163`.
Its source and rendered text hashes are both
`b1555d72a896807f236a49e161f8873a1d3cfb8bff684d92a52e345bf4a1ae0f`;
all 12 semantic text measurements pass, every measured scroll dimension is at
or below its client dimension, and the overlap list is empty.

Evidence:
`artifacts/business-value/marketing/2026-08-02/instagram-layout-repair/fixture-proof-strict/`.

## Approval and graph ordering

The production order is copy generation, complete-copy validation, render,
layout audit, bounded repair, exact-media freeze, immutable envelope, approval,
one-run capability and publication. The worker rejects any Image receipt whose
layout contract/hash, semantic hashes, font proof, geometry proof or final
media hash differs. It re-hashes the file before upload and compares the upload
dry-run hash. The graph projection and frozen envelope include the layout
verification and its canonical hash; the scheduler trigger independently
checks that hash and final media binding. Media regeneration after approval
therefore invalidates the envelope instead of silently changing the asset.

## Verification completed

- deterministic image engine and Instagram worker: `67/67` passed;
- exact 365-day, five-slot allocation replay retained complete copy;
- focused graph publication/capability/production-adapter tests: `39/39`;
- exact pinned-browser incident render: passed;
- original Unicode and ASCII ellipsis fixtures: failed closed;
- semantic mismatch, clamp, hidden overflow, parent clipping, out-of-bounds,
  overlap, minimum-font, maximum-line, transparent-text, fallback-font and
  contrast cases: failed closed;
- exact source/rendered equality, geometry, font and contrast: passed;
- provider writes during all repair proofs: zero;
- Browser Relay calls: zero.

Complete verification also passed:

- connector: `137/137` supported tests passed, six external-runtime cases were
  correctly classified as unsupported in the ordinary unit lane, and the exact
  pinned-browser incident test passed separately; packaging/preflight proved
  source, tarball and clean-install convergence for `0.10.3` with no drift;
- host operations: `175/175` passed;
- Operator: focused graph/approval/capability tests `39/39`; canonical verify
  passed `95` unit, `35` integration and `34` UI tests, both typechecks, both
  builds, documentation drift, site curation and `107` markdown links;
- the additional broad graph suite passed `528` tests. Its ten legacy external
  load cases were not counted as self-contained because they assume a server
  on port `3000`; against production, protected knowledge/persistence routes
  rejected the unauthenticated probe as designed while public health remained
  responsive. No credential was read to force that unrelated probe through
  authentication;
- `git diff --check` passed in all three repositories. Bounded secret audits
  found no task-owned secret; known documentation/test fixture strings were
  redacted by the scanner.

## Production load and Phase G isolation

The canonical renderer is invoked from the connector repository on every
natural run, so its renderer/contract/fixture bytes are the production source
path. The graph adapter additions were loaded by one controlled orchestrator
restart at `2026-08-02 15:48:13 BST`: PID `1267217` became `1299269`, the unit
returned `active/running`, `NRestarts=0`, `/health=200`, and startup recorded
zero-write mode with two immutable definitions and recovery `resumed=0,
blocked=0`. Service and zero-write drop-in hashes remained
`a9b12abb4ec1d348b66192cc85ce89d1f4ea465764cb8cece4ed21f1fb7bd36f`
and `a4be738e6c8ae4038021d24ae173bc3da29ff169c02bd1c3941edaf2b67098a9`.

Both graph and scheduler stores retained integrity `ok`, no foreign-key
failures, one `graph_owned` migration, no active run or capability and no
unresolved effect. Existing approvals, capabilities and effects stayed at two
terminal records each; the loaded proof created no authority.

The old frozen spec was submitted to the loaded renderer and failed before
Chrome with `headline contains forbidden renderer-added ellipsis`; upload and
publish calls were zero. The exact next natural candidate was then evaluated
with `--validate-only` for `2026-08-03 05:00 BST`:

- candidate `instagram-dynamic:9a216303f8ac4e56ffbb706a`;
- source/rendered text SHA-256
  `5e52dc93fadc7254dfd1ba20a71686b422cf488addea391f69c58ff10947f3b4`;
- diagnostic media SHA-256
  `2a3b6465e9a5741147c92a347092c20fc2b757a7c52d99f0a5a6928acc9fefcb`;
- canonical contract SHA-256
  `87eb13371b5d8fbadb4a79ed7d13efd1e91d72143e1c32cba42e8dcf0969bb96`;
- six bounded attempts, final profile `compact-all`, approved local font,
  semantic equality, strict geometry, safe margins, no overlap and complete
  manual visual inspection;
- generated upload calls `0`, Instagram publish calls `0`, active graph
  authority/effects `0`.

Evidence:
`artifacts/business-value/marketing/2026-08-03/diagnostics/instagram-image-diagnostic-20260803-0500-1299878-1785682238946/`.

## Natural production quality-gate proof — passed

The unchanged cron fired naturally at `2026-08-03 05:00:00.031 BST` and
completed successfully after `249382 ms`. It invoked only
`trigger-graph-schedule.ts --migration-id phase-g-instagram-image-v1`; the last
direct legacy execution remains the `2026-08-02 11:00` cycle. The exact lineage
is:

- scheduler trigger `gst_c9be89200a77815fae6bab8f2f4300a1`, attempt `1`,
  terminal `completed`;
- graph run `grzwcanary_594c74e4-49cb-4830-849e-89fc06c1f69f`, revision
  `28`, terminal `completed/success`;
- claim `gclaim_8b1ed00a08c42444d3dde6dd2c79172d`, final publication
  status `verified`;
- approval `gap_03023f56e20b90ada085da72a2cdd1cd`, exact payload-bound
  status `granted`;
- one-run capability `glc_c3b031dd0975ba7f7cdbee76309f1a6f`, permanently
  `consumed` before publication;
- ordered dispatches `delivery_upload` then `instagram_publish`, each
  `dispatchCount=1`, `maximumDispatchCount=1`, terminal `succeeded`;
- effect `gex_9441458c-a0ca-402c-9bf5-93eee55d5cfe`, terminal
  `effect_verified` for provider object `18004466273976486`;
- provider container `18056487374787955`, public object
  `18004466273976486`,
  `https://www.instagram.com/p/DbkFhmdF5I7/`;
- payload SHA-256
  `ff084a77a2f250000ac71e03e283bc4ed9e4bad74d0300740d09b4257f82ca2e`,
  media SHA-256
  `2a3b6465e9a5741147c92a347092c20fc2b757a7c52d99f0a5a6928acc9fefcb`
  and envelope SHA-256
  `a53e2b4917f9749a701f2ac9c2f35551724cf415b5e5fee7a2e533efd0870642`.

The canonical Instagram outbox has one exact slot row and one exact provider
object row, terminal `published_verified`, with one upload call, one publish
call, no retry and zero Browser Relay calls. The graph has `174` valid chained
events, `32` evidence records and replay equality. The scheduler has `12`
valid chained events across the transfer and two natural triggers. Active graph
runs, active capabilities, unresolved effects and active/ambiguous scheduler
triggers are all zero. A quarantined historical legacy outbox row from
`2026-07-31 11:00` remains `still_ambiguous`; it is not the repaired slot or
its graph/effect/capability lineage and created no duplicate or ambiguity for
this publication.

Fresh official Meta API-only `verify`, direct object inspection and owned-feed
readback all returned the same `IMAGE` / `FEED` object, exact caption,
represented account and permalink. The ten most recent owned objects contained
exactly one new object and exactly one preserved incident object
`18031591145828795`; the latter still exists at
`https://www.instagram.com/p/DbiXsKmFjDK/` and was not deleted.

The exact frozen published image was inspected at original resolution. Every
required source element is visibly complete:

- `Evidence-led result`;
- `Mobile friction · Practical`;
- `Proof for a clearer phone journey`;
- `Use verified approved knowledge evidence and state its limit.`;
- `Evidence` / `Use a real phone`;
- `Result` / `a clearer phone journey`;
- `Limit` / `Do not promise what was not measured.`;
- `Tail Wagging Website Design Factory Northampton`;
- `Change one thing, then verify it.`

There is no ellipsis, clamp, clipping, overflow, overlap, missing character or
unapproved font. Persisted layout verification is `passed`, contract version
`1.0.0` and SHA-256
`87eb13371b5d8fbadb4a79ed7d13efd1e91d72143e1c32cba42e8dcf0969bb96`.
Source and rendered text SHA-256 values are both
`5e52dc93fadc7254dfd1ba20a71686b422cf488addea391f69c58ff10947f3b4`;
`boundingBoxesValid`, `semanticCompleteness` and approved-font proof are true;
the selected sixth profile is `compact-all`; and `finalMediaSha256` equals the
frozen file, upload/outbox, capability, envelope and trigger-receipt media hash.

The original controlled load persists on PID `1299269`, start time
`2026-08-02 15:48:13 BST`, `NRestarts=0`, active/running and HTTP health `200`.
The service and zero-write drop-in hashes remain unchanged, the journal still
records two definitions with recovery `resumed=0, blocked=0`, and
`OPENCLAW_GRAPH_ZERO_WRITE_ONLY=true` remains in the loaded unit. Graph,
scheduler and Instagram outbox integrity checks return `ok`. Exactly one
scheduler migration remains `graph_owned`; every other current workflow stays
legacy-owned. The observer `ee64444d-9f66-4aee-a6a2-384b47bf9165`
self-deleted after firing.

Evidence:

- `artifacts/business-value/marketing/2026-08-03/phase-g-instagram-image-production-proof.json`;
- `artifacts/business-value/marketing/2026-08-03/instagram-image-outbox-0500-07e434c552c02506.json`;
- `artifacts/business-value/marketing/2026-08-03/instagram-outbox/dynamic-image-20260803-0500-de0399d98349/`;
- `/home/oneclickwebsitedesignfactory/.openclaw/state/activation/graph-phase-g-instagram-image-20260802/triggers/gst_c9be89200a77815fae6bab8f2f4300a1.json`.

## Rollback and residual risk

Rollback was not required. It remains ready through the exact legacy job digest
`94f7110c22083bf76eef3793d26ab38500d6879d4f03e41ff5c5694c7dc43b84`;
the current graph job independently recomputes to
`84f93b95fd7686d70eb72b03dc16d38d645bb7ff80444dae0eeae4872c6db57f`.
Future natural cycles remain subject to the same fail-closed layout, authority,
exactly-once and provider-readback controls. The preserved historical legacy
ambiguity remains outside this exact terminal proof and must not be retried
without separate reconciliation authority.
