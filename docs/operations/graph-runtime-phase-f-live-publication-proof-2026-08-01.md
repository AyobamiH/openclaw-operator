---
title: "Graph Runtime Phase F Live Publication Proof"
status: "blocked-before-provider-mutation"
date: "2026-08-01"
---

# Graph Runtime Phase F Live Publication Proof

## Verdict

`PHASE F BLOCKED`

No graph run, payload-bound approval, candidate claim, provider container, or
public publication was created. The stop occurred before provider mutation
because the only loaded and approved definition,
`deterministic-social-publication@1.1.0`, is an immutable zero-write definition
and cannot satisfy the approved live-effect contract without a new graph
version and a fresh payload-bound approval.

## Candidate and provider preflight

At `2026-08-01T22:24+01:00` and `22:25+01:00`, the canonical Instagram runner
validated the natural `23:00 Europe/London` Reel opportunity using job
`2c7071ff-35dd-40d0-bf77-b1ed53de256e`:

- canonical command: `node scripts/instagram-publisher-outbox-runner.mjs
  --job-id 2c7071ff-35dd-40d0-bf77-b1ed53de256e --kind reel
  --validate-only`;
- exit code: `0` on both read-only validations;
- selected concept:
  `accessible-actions:myth-versus-reality:web-design-development:operations-lead`;
- approved allocation: `true`;
- existing slot state: none;
- committed Reel count: `0/5`;
- renderer and receipt: valid/complete;
- creative fingerprint:
  `2843dda30aee23c9e4b14bde9fd0b36d540f126e2679ce39302e638c2810ce1f`;
- media SHA-256:
  `5334520e21edef82eb1848813d44aad93710c9e2bc3db157994b8955cd33b6a0`;
- provider writes, external writes, Browser Relay calls, LLM calls and browser
  calls: `0`.

The two validations created graph-excluded local diagnostic directories under
`artifacts/business-value/marketing/2026-08-01/diagnostics/`. They did not
create or mutate an outbox row. Their MP4 hashes were
`30453b2bb4fae6a219504c9ef7ee01db96c4f2826f985334e379f43ecaf2ba02`
and `5334520e21edef82eb1848813d44aad93710c9e2bc3db157994b8955cd33b6a0`.
The content fields matched, but the diagnostic minute was embedded into the
slug and scene IDs, changing the creative fingerprint, storyboard hash and
encoded bytes. This is acceptable for an ephemeral diagnostic, but it means a
live payload envelope cannot be approved from `--validate-only` output; the
canonical prepare/claim step must first freeze one exact durable creative.

Official read-only Meta discovery authenticated `instagram:owner` as account
`17841453638630920`, username `tailwaggingwebdesigns`, on Graph API `v25.0`.
The owned-media page contained no `2026-08-01` Reel and therefore no provider
object representing this candidate. API-only mode was explicit and Browser
Relay was unavailable.

Threads was not eligible. Its `21:30` window closed at `22:15`, and durable
outbox `threads:2026-08-01:21:30:083e3560-40fd-4487-9d78-674f64866ef7`
is `confirmed_absent`, `committedSlotOutcome=missed`,
`recoveryRequired=true`. Reusing it would violate the Phase F selection
contract.

The disabled Reel schedule meant there was no scheduler claimant for the
Instagram candidate. Scheduler digest during preflight was
`e555670c8d4e5189e0cfdfe459d12bf89d9a8cbffdc7ce329cb88f49adc31c4c`;
the exact Reel job remained disabled and no schedule was changed.

## Authoritative graph blocker

The registered database and source definition match exactly:

- graph: `deterministic-social-publication@1.1.0`;
- definition hash:
  `f4f41c406ff8399c8e10b2012bf06a5dc0357a28f983e73f328cac3a2d3d592c`;
- registered at: `2026-08-01T20:15:13.531Z`;
- source: `orchestrator/src/graph/workflows.ts`;
- description: `Production-adapter-bound zero-write publishing graph using the
  canonical deterministic publishing decision path.`

The live contract has four independent fail-closed blockers:

1. `create_external_container`, `reconcile_container`, and `publish` use
   `graph.external-disabled` (`workflows.ts`, symbols around lines 125-146).
2. `graph.external-disabled` returns a controlled `tool_unavailable` block and
   states that no official connector is registered for this graph version
   (`handlers.ts`, lines 160-164).
3. The loaded systemd policy has
   `OPENCLAW_GRAPH_ZERO_WRITE_ONLY=true`; `GraphExecutor.step()` blocks before
   the first external mutation (`engine.ts`, lines 224-226).
4. The engine calls the executor before persisting a returned external-effect
   record (`engine.ts`, call around lines 297-307; persistence around lines
   395-401). It therefore cannot meet Phase F's requirement to persist the
   effect intent before provider mutation.

A fifth precondition is also absent: validation does not freeze a byte-stable
payload. Consecutive diagnostic renders used time-bound scene identifiers and
produced different creative/media hashes. The approved live design therefore
needs a durable prepare/claim node before approval, with all later nodes bound
to that frozen media identity.

The definition's completion assertion also requires zero-write shadow evidence
(`publication-shadow-decision`, `payload-hash`, `zero-provider-writes`) rather
than provider readback evidence. Rebinding those nodes or assertions under the
same immutable `1.1.0` identity would be definition-version drift. The database
would correctly reject a different definition hash for the same version.

## Production-state proof

Post-preflight evidence at `2026-08-01T22:33:13+01:00`:

- service: PID `1029249`, `NRestarts=0`, `active/running`;
- `GET http://127.0.0.1:3312/health`: HTTP `200`;
- graph database integrity: `ok`;
- foreign-key violations: `0`;
- definitions: `1`;
- runs/events/attempts/checkpoints/evidence: unchanged at
  `11/312/41/22/114`;
- approvals: `0`;
- external effects: `0`;
- resource leases: `0`;
- exact Instagram 23:00 outbox rows: `0`;
- local diagnostic directories created: `2` (retained as evidence; no runtime
  or provider authority attached);
- provider publications created by Phase F: `0`;
- Browser Relay mutations: `0`;
- service restarts: `0`;
- scheduler mutations: `0`.

Graph source digests at the stop boundary:

- `workflows.ts`:
  `ac191eb9b16bcf381336eaa4851e32b630cc40e0ac5c6bf495d51af8a644059d`;
- `handlers.ts`:
  `dede2639d92cdea3b7ee1c7bfe40449f14e777e525fea5585f61a5abb3c4d3d8`;
- `engine.ts`:
  `9bd612a50744e49670076ac871b55121f9617ea976554bb8d2e3f203aded2c7d`;
- `production-adapters.ts`:
  `4d22cf86467394f91a5bddbb0d1dca8d34f57358d3978855d1c750254cab9166`.

## Required repair and next approval boundary

The next safe engineering package must introduce a new immutable graph version,
not mutate `1.1.0`. It must add allowlisted official live publication adapters,
persist effect intent before mutation, bind exact payload/account/provider
authority, expose canonical candidate claim and reconciliation primitives, and
require provider readback evidence for completion. It must be locally and
loaded zero-write verified before a fresh live approval names the new graph
version and definition hash.

No source repair was improvised during the natural slot because completing it
would necessarily change the approved graph identity. The existing payload was
not frozen or claimed, so legacy state remains untouched.

Phase G remains prohibited. Scheduler ownership is unchanged.

## Follow-up outcome

The required new immutable version was implemented as
`deterministic-social-publication@2.0.0` and passed loaded zero-write preparation
with an exact frozen Reel envelope. The subsequent live activation attempt
still stopped before provider mutation because the canonical startup guard
requires an explicit zero-write runtime policy. The prepared claim was released
and the run cancelled. See
`graph-runtime-live-capable-publication-version-and-phase-f-proof-2026-08-01.md`.
