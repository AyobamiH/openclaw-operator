---
title: "Graph runtime autonomous zero-write activation"
status: "zero-write-proved-live-cutover-gated"
---

# Graph runtime autonomous zero-write activation

## 1. Final verdict

**ZERO-WRITE GRAPH RUNTIME ACTIVATED AND PROVED — LIVE CUTOVER STILL GATED**

Phases B, C, D and E are complete. The loaded runtime is restricted to
`deterministic-social-publication@1.1.0`, namespace `grzwcanary`, with the
executor-level zero-write barrier active. Legacy schedulers remain
authoritative. Phase F provider-write authority and Phase G scheduler ownership
transfer were not attempted.

## 2. Phase B — production persistence

The hardened initializer ran once against:

```text
/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/database/graph-runs.sqlite
```

Command:

```text
node --import tsx scripts/initialize-graph-database.ts --expect-absent --path /home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/database/graph-runs.sqlite
```

Result: exit 0, schema/user version 1, migration `graph-schema-v1`, checksum
`51bd7a5920e2584f83199119796a2509d37e4088d55aa013db613b707364844f`,
integrity `ok`, zero foreign-key failures, mode `0600`, ten tables, five
indexes, two triggers and zero execution rows. Initial database SHA-256 was
`8da01e2e2ad6e29c5af00ee8dd3ae9b981eb884a64e07ca8a4e9a30d2c274c92`.

Gate result: **GATE B COMPLETE — PERSISTENCE INITIALISED, RUNTIME STILL
DISABLED**.

## 3. Phase C — loaded runtime

The reviewed mode-`0600` drop-in at
`~/.config/systemd/user/orchestrator.service.d/graph-zero-write-canary.conf`
has SHA-256
`0b7423d1c9785bb89fac41df4d87f917f2ba0842333593f7142201d6a4cfd3ef`
and resolves exactly:

- `OPENCLAW_GRAPH_RUNTIME_ENABLED=true`;
- `OPENCLAW_GRAPH_ZERO_WRITE_ONLY=true`;
- `OPENCLAW_GRAPH_ALLOWED_DEFINITIONS=deterministic-social-publication@1.1.0`;
- `OPENCLAW_GRAPH_RUN_NAMESPACE=grzwcanary`.

The first load exposed a state-root/publishing compatibility defect. The
bounded repair in `orchestrator/src/config.ts` prevents
`OPENCLAW_OPERATOR_STATE_DIR` from activating embedded publishing when the
registry/database pair is intentionally absent. This preserves the legacy
publisher and scheduler owners. Test: `does not activate publishing solely
because an operator state root is declared`.

After credential rotation, one controlled restart loaded the replacement set:
PID `1023067` became PID `1029249`; `NRestarts` reset from the prior systemd
failure counter `33` to `0`; active/running since 21:39:33 BST. `/health` and
`/api/persistence/health` return HTTP 200. The graph health route is protected:
unauthenticated HTTP 401 and replacement-admin HTTP 200.

Loaded definition:

```text
deterministic-social-publication@1.1.0
definition hash f4f41c406ff8399c8e10b2012bf06a5dc0357a28f983e73f328cac3a2d3d592c
```

Gate result: **GATE C COMPLETE — GRAPH-ENABLED CODE LOADED, EXECUTION STILL
DISABLED** before the authorised canary began.

## 4. Credential incident and containment

An earlier shell-sourcing attempt changed the syntax of the structured rotation
record and caused credential material to appear in a platform-controlled
private tool transcript. No value was written to source, graph state, evidence,
documentation, the tool ledger or Telegram. Platform-controlled transcript
retention was not falsely claimed erased.

Canonical secret source:

```text
/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/credentials/orchestrator.env
```

The file was and remains a non-symlink owned by UID/GID 1000, mode `0600`,
under a mode-`0700` directory. The complete orchestrator API set was replaced
atomically with 384-bit random values while preserving labels, roles, active
state and expiry policy. Provider and unrelated credentials were not changed.

Fingerprints only:

| Role | Compromised | Replacement |
|---|---|---|
| viewer | `1dad8a916af9` | `fbe441ea83f0` |
| operator | `203d0bbde5f7` | `37a5d26fe6a9` |
| admin | `c25de06831d8` | `62c3840a9daa` |
| fallback | `42a535669254` | `8ee292e27f42` |

Before restart, old-admin/replacement-admin returned HTTP 200/401. After the
restart the statuses inverted to 401/200. Temporary secret-bearing references
were mode `0600` and were unlinked immediately after proof. Only redacted
metadata remains under:

```text
/home/oneclickwebsitedesignfactory/.openclaw/state/activation/orchestrator-api-rotation-20260801T203834663Z-22baa4fa/
```

The reusable client helper
`orchestrator/src/auth/credential-reference.ts` requires an absolute,
owner-only, non-symlink file and selects an active role-bound rotation entry
without placing it in an argument, environment dump or output.

## 5. Loaded HTTP compatibility

The earlier loaded `test/load.test.ts` result was 4/10 because the harness had
no safe way to supply a production credential and therefore exercised the
unauthenticated/public branch under shared rate limiting. The six failures are
classified as `authentication_contract_difference` and
`configuration_difference`; route behavior was not weakened.

`test/load.test.ts` now accepts only a credential file reference through
`OPENCLAW_API_CREDENTIAL_FILE`. Against PID 1029249:

```text
OPENCLAW_LOAD_TEST_BASE_URL=http://127.0.0.1:3312 \
OPENCLAW_API_CREDENTIAL_FILE=/home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/credentials/orchestrator.env \
npx vitest run test/load.test.ts --maxWorkers=1 --minWorkers=1
```

Result: 10/10, exit 0. Knowledge burst: 30 HTTP success plus 70 controlled
HTTP 429 responses; persistence burst: 100/100 success. The test still requires
every response to be either successful or an explicit rate-limit response.

## 6. Phase D — loaded zero-write canary

Run:

```text
grzwcanary_fbb4c557-c7c8-4672-8593-cfa1e7dbe1cb
```

The authenticated request used only the protected credential reference and the
captured natural input `self-id-0500` at `2026-08-01T05:00:00+01:00`.
Result:

- graph/version: `deterministic-social-publication@1.1.0`;
- terminal status: `completed` at `complete`;
- expected next action: `write_blocked_by_shadow_mode`;
- canonical payload SHA-256:
  `90e8ff6b19c730cecd1af96066b32a7fdcd3fc3f5037e1b1efe2a1f564441f09`;
- events: 72, hash chain valid;
- node attempts: 11;
- evidence: 30 across `publication-shadow-decision`, `payload-hash` and
  `zero-provider-writes`;
- external effect rows: 0;
- adapter-reported external writes: 0;
- completion assertion: `social-shadow-equivalent=passed`.

The Telegram-safe summary reports the graph/version, run ID, completed status,
current node `complete` and the passed assertion; it contains no credential.
Prometheus recorded one completed graph run and eleven successful node attempts.

Gate result: **GATE D COMPLETE — LOADED ZERO-WRITE CANARY VERIFIED**.

## 7. Phase E — loaded natural shadow corpus

Reusable harness:

```text
node --import tsx scripts/run-loaded-graph-shadow-equivalence.ts \
  --base-url http://127.0.0.1:3312 \
  --credential-file /home/oneclickwebsitedesignfactory/.openclaw/state/openclaw-operator/credentials/orchestrator.env \
  --output /home/oneclickwebsitedesignfactory/.openclaw/state/activation/graph-zero-write-runtime-20260801/loaded-shadow-corpus.json
```

Corpus SHA-256:
`86ff45189bf357775e7df507de262cdc7890b82b5165a238a2c880c74949882d`.

| Sample | Run | Result | Payload hash |
|---|---|---|---|
| loaded Threads 05:00 | `grzwcanary_f0a34f83-f9d7-4843-8844-9059d494923f` | equivalent/completed | `90e8ff6b…1f09` |
| loaded Instagram 07:00 | `grzwcanary_86b5d207-65de-4807-a139-483eac4bfe2b` | equivalent/completed | `eefd9832…09a3` |
| out of slot | `grzwcanary_7126f2d5-dbe0-40c8-a2c6-dbf8679f233c` | equivalent/controlled block | none |
| duplicate | `grzwcanary_26fce923-619f-49c7-bc65-92ed7bd48bc3` | equivalent/controlled block | none |
| already verified | `grzwcanary_e830f5d2-4371-4c76-9608-583ecdd12359` | equivalent/controlled block | none |
| ambiguous provider | `grzwcanary_c2f433a3-6ae9-4c7b-b345-293d8fa93327` | equivalent/reconcile only | none |
| missing campaign | `grzwcanary_acedd568-5bd1-4702-8494-bc57f3f377f1` | equivalent/controlled block | none |
| policy rejection | `grzwcanary_b5d4ff08-0258-4844-840a-3d496c77acdc` | equivalent/controlled block | none |
| authority rejection | `grzwcanary_d56d64e5-a402-44f9-bc40-ed267b074372` | equivalent/wait for approval | none |
| malformed payload | `grzwcanary_c3839fb8-a0c5-4091-a0ba-1f56c5071546` | equivalent/repair payload | none |

Acceptance result: samples 10, semantically equivalent 10, unexplained
mismatches 0, provider writes 0, effect rows 0, invalid event chains 0. The
negative control ignored only `trigger.observedAt`, changed `payload.text`, and
correctly detected the semantic mismatch as `test_fixture_defect`.

Four pre-existing controlled blocks initially consumed the graph's deliberate
four-run concurrency ceiling. The harness was strengthened to read back and
cancel each proved blocked sample after preserving its outcome and evidence;
this released capacity without retrying or weakening concurrency. No mutation
request was sent to a provider.

Gate result: **GATE E COMPLETE — LOADED NATURAL SHADOW EQUIVALENCE PROVED**.

## 8. Final graph database and runtime proof

Final database inventory:

```text
definitions=1
runs=11 (completed=3, cancelled=8)
events=312
node_attempts=41
checkpoints=22
approvals=0
evidence=114
external_effects=0
resource_leases=0
integrity_check=ok
foreign_key_check=0 rows
```

Final database SHA-256:
`11593acec35e8a21c9cf52f2088b2e4a19ca2f70d26bea5ea9d4e7b1993dc994`.

PID 1029249 remains active/running with `NRestarts=0`. Final scheduler snapshot
is byte-identical to the pre-rotation `--all` snapshot. Ten scheduler records
exist including disabled historical jobs; no graph trigger or scheduler owner
was added.

The public persistence endpoint remains HTTP 200 and Redis coordination reports
healthy. Its payload continues to report the separately configured legacy
Mongo store as unavailable (`status=unhealthy`, `database=false`). This was not
changed by graph activation, did not affect the graph SQLite integrity proof or
the loaded 10/10 contract suite, and remains a separate host persistence risk.

## 9. Verification

- credential/config/initializer/kernel/adapter/OpenAPI focused suite: 78/78
  across seven files;
- live loaded HTTP suite: 10/10;
- complete self-contained orchestrator suite: 501/501 across 41 files;
- operator console: 34/34 across five files;
- root typecheck: exit 0;
- root build: exit 0;
- documentation sync, Git whitespace validation and value-suppressing
  task-owned secret scan: exit 0.

Structured full-suite result:
`/home/oneclickwebsitedesignfactory/.openclaw/state/activation/graph-zero-write-runtime-20260801/full-suite.json`,
SHA-256 `d2114d2862ca0e9068ce28c6eb3b5257c299affc634123078317d89f6a2a7078`.

## 10. Provider, scheduler and rollback boundary

Graph adapter-reported external writes: 0. Graph external-effect rows: 0.
No task-owned container creation, publication, message send or Browser Relay
mutation occurred. Legacy publishing jobs were neither stopped nor modified and
remain independently authoritative.

Rollback remains available through the Gate A tracked-source archive and by
removing the zero-write drop-in before a controlled restart. The graph database
must be retained for audit. Credential rollback to the compromised set is
prohibited; the replacement set is now canonical.

## 11. Files changed by this continuation

- canonical protected orchestrator API credential set (values never recorded);
- `orchestrator/src/auth/credential-reference.ts`;
- `orchestrator/test/credential-reference.test.ts`;
- `orchestrator/test/load.test.ts`;
- `orchestrator/scripts/run-loaded-graph-shadow-equivalence.ts`;
- this cumulative report, migration registry, runbook, docs index and tool
  invocation ledger;
- graph execution rows and protected activation evidence under the production
  Operator state root.

No commit, push, provider write, scheduler edit or Browser Relay mutation
occurred.

## 12. Remaining authority boundary

Phase F remains separately gated: approve one explicitly named workflow for
bounded live graph-authoritative execution, including the exact provider-write
authority, payload/approval binding, canary limit and rollback. Phase G
scheduler ownership transfer remains a later independent decision.
