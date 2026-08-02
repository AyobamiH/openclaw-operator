---
title: "Graph Production Adapter Binding and Shadow Equivalence Evidence"
status: "production-ready-for-separately-approved-zero-write-activation"
date: "2026-08-01"
baseline: "df765e90aa5d11b9deaf7795112e85e0f628ddd3"
---

# Graph Production Adapter Binding and Shadow Equivalence Evidence

## Verdict

**PRODUCTION-READY FOR SEPARATELY APPROVED ZERO-WRITE ACTIVATION**

This verdict applies only to the reviewed zero-write graph runtime and the
`deterministic-social-publication@1.1.0` canary. It does not approve deployment,
database initialisation, service restart, a provider write, scheduler cutover,
commit or push. Write-capable provider nodes remain disabled and the runtime
has a second executor-level zero-write barrier.

## Canonical runtime and adapter inventory

The canonical service remains `orchestrator.service`, running
`node --import tsx src/index.ts` from `projects/openclaw-operator/orchestrator`.
The inspected live process remained on its pre-change loaded bytes.

| Capability | Canonical owner | Graph binding / posture | Side effect and shadow safety |
|---|---|---|---|
| Repository truth, Git status and diff | `orchestrator/src/githubWorkflowMonitor.ts`; bounded Git CLI | `production.repo-inspect.v1` | read-only; shadow safe |
| Typecheck, test, lint and build | `orchestrator/package.json` scripts | `production.repo-command.v1` | local reversible; shadow safe; fixed command map |
| Approval lookup and authority | `orchestrator/src/approvalGate.ts`; graph `authority.ts` and `store.ts` | graph-kernel authority adapter | read-only decision; payload bound |
| Europe/London slot resolution | `publishing/production-integration.ts` | `production.publishing-shadow-decision.v1` | read-only; exact five-minute tolerance |
| Campaign/sequence selection | `publishing/engine.ts`, `registry.ts` | same publishing adapter | read-only deterministic plan |
| Duplicate and policy guards | `publishing/engine.ts`, `content.ts`, `store.ts` | same publishing adapter | read-only reconstruction; fail closed |
| Payload rendering and hash | `publishing/engine.ts` (`deterministicRenderedCandidate`) | same publishing adapter | read-only; canonical SHA-256 |
| Threads and Instagram publication | `publishing/official-worker.ts`, `connectors.ts`; relay connector | deliberately not reachable in zero-write graph | external public; not shadow invoked |
| Provider readback/reconciliation | `official-worker.ts`, `connectors.ts`, `engine.ts` | inventoried; retained behind disabled write path | read-only provider operation; not required by pre-write canary |
| Research dispatch/retrieval | `taskHandlers.ts` market-research handler to `market-research-agent` / `sourceFetch` | retained as governed legacy task boundary | read-only network; not duplicated in kernel |
| Claim extraction/quality | market-research result contract plus graph claim/source ledger | `production.research-evidence.v1` | read-only; shadow safe |
| Evidence persistence | `graph/store.ts` | kernel store | local persistent, redacted and hash chained |
| Telegram summary | `graph/summary.ts` | kernel projection | read-only projection; SQLite remains truth |

Official Threads/Instagram creation, publishing and readback code was not
copied into the graph kernel. The graph orchestrates the deterministic decision
surface and stops before the first mutation. Existing provider state machines
remain authoritative for any later write-path migration.

## Production adapter registry

`orchestrator/src/graph/adapter-registry.ts` implements a code-only allowlist.
Definitions cannot load modules or paths. Registration validates declared
capability, authority, side-effect class, timeout and idempotency against the
adapter contract. Inputs and outputs are Zod validated; malformed output fails
as `tool_contract_error`. Adapter authority cannot be downgraded by a node.

Registered production contracts:

| Adapter ID | Version | Input/output contract | Idempotency | Evidence |
|---|---|---|---|---|
| `production.repo-inspect.v1` | 1.0.0 | bounded project path -> Git identity/hashes | run/node/payload | repository truth, Git diff |
| `production.repo-command.v1` | 1.0.0 | bounded project path -> fixed command receipt | run/node/payload | test/build output hash |
| `production.publishing-shadow-decision.v1` | 1.0.0 | exact integration, registry, slot and effect state -> normalised decision envelope | run/node/payload plus canonical publication key | decision, payload hash, zero-write proof |
| `production.research-evidence.v1` | 1.0.0 | sources/claims/result-set hash -> quality ledger | run/node/payload | claim/source ledger |

`GET /api/graphs/adapters` exposes redacted contract metadata through the
existing bearer/RBAC control plane.

## Bound graph versions

- `coding-change@1.1.0`: repository truth/diff and package validation nodes use
  production adapters. Implementation/repair remains the explicitly labelled,
  allowlisted legacy adapter until the canonical build-refactor transaction is
  extracted. Commit and push are not bound.
- `deterministic-social-publication@1.1.0`: every pre-write decision node uses
  the canonical publishing adapter. Controlled rejection routes to durable
  `shadow_blocked`. Creation/publication handlers remain disabled.
- `research-to-action@1.1.0`: claim extraction, quality and gap evidence use the
  production evidence adapter. Governed network retrieval remains owned by the
  existing market-research/sourceFetch lane rather than a duplicate fetcher.

Completion assertions now link to evidence emitted by earlier nodes. The final
gate no longer creates substitute test/build/publication/research evidence.

## Shadow-equivalence harness and corpus

Reusable harness:

```text
node --import tsx scripts/run-graph-shadow-equivalence.ts
```

It applies the same timestamp, opportunity, configuration and registry to the
legacy deterministic decision function and graph adapter, normalises both via
`ShadowDecisionEnvelopeSchema`, compares semantic fields, and ignores nothing
by default. Result: **10/10 equivalent, 0 unexplained mismatches, 0 provider
writes, 0 external effects, 10/10 valid event chains**.

| Sample | Result / evidence |
|---|---|
| `social-threads-eligible-0500` | completed; payload `90e8ff6b…441f09`; run `gr_5ff3f1c2-5ce1-4d99-84d5-e004401aca98` |
| `social-instagram-eligible-0700` | completed; payload `eefd9832…009a3`; run `gr_9fa1ddd9-c342-406b-8838-63e812618193` |
| `social-out-of-slot` | blocked/no action |
| `social-duplicate` | blocked/no action |
| `social-already-verified` | blocked/no action |
| `social-ambiguous` | blocked/reconcile only; no create/publish node |
| `social-missing-campaign` | blocked/no action |
| `social-policy-rejection` | blocked/no action |
| `social-authority-rejection` | blocked/wait for payload-bound approval |
| `social-malformed-payload` | blocked/repair payload |

Coding coverage includes real bounded Git inspection, unrelated dirty-work
preservation, a passing change fixture, bounded repair, missing dependency,
approval binding and repeated no-progress termination. Research coverage
includes supported claims, unsupported claims, rejected source quality,
identical result-set detection, bounded refinement and no-progress termination.
The focused proof is `test/graph-production-adapters.test.ts` plus
`test/graph-kernel.test.ts`.

## Mismatch ledger

No observed production-decision mismatch remains. One negative-control fixture
changes both an ignored timestamp and payload text. The harness still reports
`payload.text`; it is classified `test_fixture_defect`, low risk, disposition
`expected_negative_control_detected`. Unknown mismatches default to high risk
and block activation.

## Publishing diff review

The adapter-binding stage added only
`orchestrator/src/publishing/shadow-equivalence.ts` to publishing code. The
existing dirty changes in publishing integration, runner, engine, store, CLI,
config and integration tests pre-date this stage and were preserved. They own
bounded scheduler lateness, restart recovery and shadow account-admission
hardening; they were not reformatted, reverted or absorbed.

| Surface checked | Ownership / result |
|---|---|
| Slot definitions and Europe/London handling | existing integration config and resolver; graph consumes them unchanged |
| Sequence/campaign ordering and duplicate policy | existing deterministic engine; identical candidate and hash in both paths |
| Committed-slot repair and one-write rules | root outbox runners remain authoritative and unchanged |
| Provider ID and nested ID parsing | `publishing/connectors.ts` and root deterministic-state helpers unchanged |
| Provider readback and ambiguity | existing engine/root runners unchanged; graph ambiguity routes reconcile-only |
| Instagram upload / Threads container flow | not invoked or modified by graph adapter stage |
| Parent command marker stripping | root runner tests retained; no graph change |
| Reply monitor | root reply runner and scheduler untouched |
| API-only / Browser Relay prohibition | root and relay guards untouched; Browser Relay calls 0 |

No scheduler declaration, cron state, live publishing database or provider
object was changed.

## Loaded-runtime zero-write canary specification

Candidate drop-in: `systemd/orchestrator-graph-zero-write-canary.conf`.

```text
OPENCLAW_GRAPH_RUNTIME_ENABLED=true
OPENCLAW_GRAPH_ZERO_WRITE_ONLY=true
OPENCLAW_GRAPH_ALLOWED_DEFINITIONS=deterministic-social-publication@1.1.0
OPENCLAW_GRAPH_RUN_NAMESPACE=grzwcanary
```

The exact canary is a reconstructed natural `self-id-0500` input at
`2026-08-01T05:00:00+01:00`, `dryRun=true`, `shadowMode=true`, authority
`read_only`. Expected status is `completed` with payload hash
`90e8ff6b19c730cecd1af96066b32a7fdcd3fc3f5037e1b1efe2a1f564441f09`,
events from creation through completion, three zero-write evidence kinds,
graph metrics, a `grzwcanary_*` run ID, valid event chain and no external
effect. Any attempt to enter `create_external_container` is blocked by the
executor-level runtime policy before authority evaluation or node execution.

Legacy scheduling remains authoritative. Rollback is setting
`OPENCLAW_GRAPH_RUNTIME_ENABLED=false` and performing one separately approved
restart; retain the graph database read-only for evidence.

## Separately approved activation gates

### Gate A — reviewed source deployment

- Authority: deployment approval for the exact reviewed diff; no restart.
- Preconditions: final validation and secret scan pass; baseline ownership
  table accepted.
- Mutation: designate/install reviewed source only; graph remains disabled by
  default.
- Verification: `npm run typecheck`, `npm run build`, `git diff --check`.
- Stop: any new unreviewed diff or secret finding.

### Gate B — production graph database initialisation

- Authority: production schema initialisation approval.
- Exact command:

```text
node --import tsx scripts/initialize-graph-database.ts --expect-absent --path /home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/database/graph-runs.sqlite
```

- Postcondition: schema version 1, zero definitions, zero runs; existing task
  and publishing databases unchanged.
- Rollback: do not drop tables; retain the database read-only and keep runtime
  disabled.
- Stop: target already exists, unexpected schema version, or any other state
  file changes.

### Gate C — one service restart with zero-write flags

- Authority: service configuration install plus exactly one restart.
- Commands:

```text
install -m 0600 systemd/orchestrator-graph-zero-write-canary.conf /home/oneclickwebsitedesignfactory/.config/systemd/user/orchestrator.service.d/graph-zero-write-canary.conf
systemctl --user daemon-reload
systemctl --user restart orchestrator.service
```

- Postcondition: active/running; one registered definition; loaded namespace
  `grzwcanary`; zero-write mode explicit; no run yet.
- Stop: restart count exceeds one, health fails, loaded definition differs, or
  graph DB schema differs.

### Gate D — one loaded zero-write canary

- Authority: authenticated local graph run only; no provider write.
- Exact API payload:

```json
{
  "graphId": "deterministic-social-publication",
  "version": "1.1.0",
  "objective": "Loaded zero-write shadow canary for captured self-id-0500 input",
  "input": {
    "dryRun": true,
    "shadowMode": true,
    "adapterInputs": {
      "production.publishing-shadow-decision.v1": {
        "integrationPath": "/home/oneclickwebsitedesignfactory/.openclaw/workspace/projects/openclaw-operator/config/publishing/production-integration.v1.json",
        "registryPath": "/home/oneclickwebsitedesignfactory/.openclaw/workspace/projects/openclaw-operator/config/publishing/registry.v1.json",
        "opportunityId": "self-id-0500",
        "observedAt": "2026-08-01T05:00:00+01:00",
        "shadowMode": true
      }
    }
  },
  "authority": { "maximum": "read_only", "grantedBy": "approved-zero-write-canary" }
}
```

- Verify run, events, evidence, metrics and Telegram summary through protected
  graph APIs. Stop on any effect record, write count, invalid chain or mismatch.

### Gate E — loaded natural shadow period

- Authority: zero-write graph runs only.
- Acceptance: at least 20 loaded samples spanning both platforms and all
  controlled outcomes; 100% semantic equivalence; zero unexplained mismatch;
  zero provider writes/effects; valid event chains; legacy remains owner.
- Rollback: disable one runtime flag and restart under separate approval.

### Gate F — single-workflow cutover

- Authority: separate external-public workflow cutover approval.
- Preconditions: Gate E passes and official write/reconciliation adapters have
  independent live-path proof.
- Scope: one selected workflow only; instant legacy rollback retained.

### Gate G — scheduler ownership transfer

- Authority: independent scheduler mutation approval.
- Preconditions: live write proof, provider readback, ambiguity recovery and
  rollback validation. Never combine with Gate F.

## Remaining limits

- The loaded service has not executed these bytes.
- The production graph database does not exist yet.
- Coding implementation/repair and governed research fetching remain explicit
  legacy compatibility boundaries; neither blocks the social zero-write canary.
- Provider mutation adapters are intentionally not activated. A write-path
  cutover is not production-ready and requires later Gates F and G.

The exact next approved action is **Gate A only: approve the reviewed source
candidate for deployment with graph runtime disabled by default**.
