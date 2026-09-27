# PR 10 reconciliation acceptance evidence

Local evidence / PR-body supplement for
<https://github.com/AyobamiH/openclaw-operator/pull/10>. This file does not claim
that the PR body was published or that merge approval was granted.

## Binding and environment

- Pinned base: `bde909ea422f22713e3cd4ca0b45ca018f2c1150`.
- Tested HEAD: `e93b72f1864307d788308cdbf0c265077e85557f`, whose direct parent
  is the pinned base. No rebase, commit, or source/test change in this pass;
  the only non-ignored source-tree addition is this evidence file.
- Linux x86_64, Node `v24.18.1`, npm `11.16.0`, Vitest `1.6.1`.
- Temporary repair checkout on self-hosted runner
  `csw-72b73dc32d9b59b2-execute`; no Node/OpenClaw process was working in the
  target checkout before testing. No Blacksmith job was requested.
- Runner configuration and invocation force `chatgpt` login; the auth file
  reports `chatgpt` and no API credential. `OPENAI_API_KEY` and
  `ANTHROPIC_API_KEY` are absent. Quota and state coordination are enabled
  (`CLAWSWEEPER_QUOTA_ENABLED=1`, `CLAWSWEEPER_STATE_COORDINATOR_ENABLED=1`),
  and the configured compute endpoint is `crabfleet.openclaw.ai`.
  These observations establish local configuration, not an independent audit
  of owner approval, upstream fallback prevention, or shared cooldown
  enforcement. Those remain external acceptance limits.
- Dependencies restored with
  `npm ci --prefix orchestrator --ignore-scripts --no-audit --no-fund`
  (exit 0); the checked-in lockfile was unchanged. No model invocation is
  needed by the controlled tests.

SHA-256 of the tested inputs:

| Input | SHA-256 |
| --- | --- |
| `orchestrator/src/graph/production-adapters.ts` | `e70795f8f40ac1887abc00cfd5025fdcccd34ea6760942962c7a0db9f01b290d` |
| `orchestrator/test/graph-production-adapters.test.ts` | `03920cd6deb23ba0bbd27e03805cb53f4f856222edd802e89aa703fd6e143c63` |
| `orchestrator/package-lock.json` | `28b498fef31243066af5cb34c386b4c48a25828bf33fa9ec151de9fa010ddf55` |

## Changed-surface acceptance

Run from the repository root:

```sh
npm --prefix orchestrator run test:run -- test/graph-production-adapters.test.ts -t 'Instagram' --reporter=verbose --reporter=json --outputFile.json=/tmp/pr10-acceptance-e93b72f/instagram.json
git diff --check bde909ea422f22713e3cd4ca0b45ca018f2c1150
```

Result: **PASS**, 11 tests passed, 33 unrelated tests skipped; exit 0.
Whitespace validation: **PASS**, exit 0. `pnpm check:changed` is unavailable:
neither root nor orchestrator package defines `check:changed`, and `pnpm` is
not installed.

The four-case matrix calls the real `reconcilePriorInstagramGraphEffects`
adapter against a temporary SQLite `GraphStore`. Controlled responses report
`confirmed_absent` / `confirmed_failure`, one prior publish call, and zero
Browser Relay calls. Media projection throws. Assertions reopen the store
and inspect both the external-effect table and the persisted run snapshot.

| Provider result ID | Permalink | Persisted state in both views | Later-slot unresolved-effect query | Reconciled event |
| --- | --- | --- | --- | --- |
| absent | absent | `confirmed_absent` | empty; block cleared | present |
| present | absent | `ambiguous` | prior effect retained; blocked | absent |
| absent | present | `ambiguous` | prior effect retained; blocked | absent |
| present | present | `ambiguous` | prior effect retained; blocked | absent |

The same passing subset also exercises the later-slot preparation block
before renderer loading, terminal-first reconciliation with a parseable
projection, already-synchronized terminal diagnostics, and unresolved effects.
The matrix proves blocking through the durable query used by preparation;
the separate preparation test proves the adapter consumes that block. It does
not perform four live later-slot dispatches. Temporary databases are removed
by test cleanup. The publish-call count is controlled prior evidence, not a
new provider write.

## Broader validation and limits

The full file was also attempted:

```sh
npm --prefix orchestrator run test:run -- test/graph-production-adapters.test.ts --reporter=verbose --reporter=json --outputFile.json=/tmp/pr10-acceptance-e93b72f/graph-production-adapters.json
```

Result: **FAIL**, 31 passed / 13 failed, exit 1. The suite has existing
production-host dependencies: its `REPOSITORY` constant points outside this
checkout, and the Threads Image adapter hashes a canonical renderer in a
separate host repository. The expected registry, systemd fixture, Git
repository, and renderer paths are unavailable here. No substitute renderer,
host-path alias, or weakened assertion was introduced to make these checks
green. Full-file acceptance remains blocked on a suitable fixture environment;
the focused result does not imply a passing full suite.

Raw local artifacts are in `/tmp/pr10-acceptance-e93b72f/`: `instagram.json`,
`instagram.log`, `graph-production-adapters.json`, and
`graph-production-adapters.log`. This repository-local evidence supplement preserves
the commands, input binding, observed assertions, and limitations after those
temporary logs expire.

No live publication, deployment, service restart, GitHub write, or fresh
external Codex review was performed. Exact-source local inspection retained
the two identifier guards and confirmed terminal-first behavior is unchanged.
Publishing this supplement to the PR and obtaining the required final review
remain external steps; this pass does not declare the PR merge-ready.
