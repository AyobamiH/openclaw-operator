# Threads duplicate-reporting repair deployment evidence

Date: 2026-08-09
Target: `a410276d429d35da6e7f5181ca0db768fc678bf3`
Operation: exact source push plus one `orchestrator.service` reload/restart
Final status: `SOURCE_VERIFIED -> TESTED -> PUSHED -> RUNTIME_LOADED -> RUNTIME_VERIFIED`

## Scope and authority

John explicitly approved pushing `a410276`, loading/restarting the running
orchestrator, and proving the duplicate-suppressed Threads path locally without
creating a live Threads post. The operation did not authorize a provider write,
Instagram reconciliation, scheduler mutation, configuration change, permission
change, install, migration, or broader deployment.

The API-only Meta policy remained in force. Browser Relay and attached-browser
calls were not used.

## SOURCE_VERIFIED

- Commit: `a410276d429d35da6e7f5181ca0db768fc678bf3`
- Subject: `fix(graph): separate current and historical effects`
- Changed files: governed Graph scheduler, production effect classifier, and
  their two focused test files only.
- The scheduler now clears current provider identity/permalink for a
  `duplicate_suppressed` invocation, reports current `providerWrites=0`, and
  exposes any earlier effect through explicit `historicalProvider*` fields.
- The exact regression builds the historical 07:00 Threads trigger and asserts:
  current provider writes `0`; current provider post `null`; historical writes
  `1`; historical post retained separately; publication outcome
  `not_published_zero_write`; final classification `legitimate_skip`.
- Loaded worktree blob proof:
  - scheduler target/worktree blob:
    `1aa247b26fb7bca92f5170d8ec2c49d001e9974e`
  - adapter target/worktree blob:
    `09590fed049a9982d68afd1bc7e16e773080e7b0`

## TESTED

- Focused Graph scheduler and production-adapter suites: `77/77` passed.
- TypeScript: passed.
- Exact duplicate regression after restart: `1/1` passed, `45` unrelated tests
  skipped.
- Protected `verify:main` gate passed before the successful push:
  - operator UI and orchestrator builds passed;
  - documentation drift and `111` Markdown-file link checks passed;
  - fixture tests `97/97` passed;
  - runtime integration tests `35/35` passed, including Graph scheduler health
    and read routes under the zero-write guard;
  - operator UI tests `34/34` passed;
  - orchestrator and operator UI typechecks passed;
  - VitePress documentation build passed.
- An earlier gate attempt remained blocked in the resource-constrained console
  build and did not update the remote. It was not bypassed. The clean gate and
  the successful push hook both completed normally.

## PUSHED

- Remote before: `78733d7dc3a4684f41455dc55c5cfc969b48bf27`.
- Exact non-force push:
  `a410276:refs/heads/main`.
- Remote after:
  `a410276d429d35da6e7f5181ca0db768fc678bf3`.
- The later audit-only commit `80ec317` was not pushed. Local `main` remains one
  commit ahead of `origin/main`.

## RUNTIME_LOADED

- Lifecycle actions: one `systemctl --user daemon-reload` and one
  `systemctl --user restart orchestrator.service`.
- Old PID/start: `239207`, `2026-08-08 20:31:36 BST`.
- New PID/start: `391978`, `2026-08-09 16:06:40 BST`.
- Service post-state: `active/running`, `Result=success`.
- Process cwd:
  `/home/oneclickwebsitedesignfactory/.openclaw/workspace/projects/openclaw-operator/orchestrator`.
- Local repository HEAD is the audit-only successor `80ec317`; its runtime code
  files are byte-identical Git blobs to `a410276`. The new process started after
  the target push from that canonical source path.

## RUNTIME_VERIFIED

- `/health`: HTTP `200`, healthy.
- `/api/persistence/health`: HTTP `200`; file state healthy and Redis
  coordination reachable.
- Loopback listener: `127.0.0.1:3312`.
- Startup journal: Graph runtime initialized in zero-write mode with `10`
  definitions; recovery resumed `0`, blocked `0`; HTTP listener started.
- Live schedule read: `8` enabled OpenClaw jobs remain loaded with populated
  next-run state. The set includes Meta reply monitor, Threads image and early
  text, Threads readiness preparation, Instagram image and Reel, Campaign
  Factory v4, and the daily social digest. Historical Instagram/Meta job error
  statuses remain visible and were not mutated by this repair.
- Resolved pre/post fixed adjacent-configuration snapshot SHA-256:
  `47a3c17fb18efc8561d8c8bfd6fc20353996c4a98f44c862a5f18765de77f835`
  before and after. No command, Telegram, elevated-tool, config-write, or
  approval surface changed.

## Exact zero-write report proof

The post-restart synthetic render used the production formatter with no state
database and no provider connector:

```text
Graph-owned threads-early-text-v1 legitimate_skip
Graph execution outcome: duplicate_suppressed
Scheduler completion contract: passed
Publication outcome: not_published_zero_write
Policy/skip reason: zero_write:duplicate_suppressed
Provider writes: 0; Browser Relay calls: 0
Provider post: none
Historical provider writes referenced: 1
Historical provider post: https://www.threads.com/@example/post/historical
Recovery required: no
Recovery result: duplicate_suppressed
Final classification: legitimate_skip
```

This is the required distinction: nothing was published by the current
invocation; the prior publication is reported only as historical evidence.

## Explicit non-actions and remaining observation

- Provider writes: `0`.
- Browser Relay/attached-browser calls: `0`.
- No live Threads post, live Graph replay, scheduler/cron mutation, Graph state
  mutation, Instagram reconciliation, configuration or permission change,
  install, migration, rollback, second restart, or new approval occurred.
- The next natural Threads duplicate-suppressed slot can provide live scheduler
  notification proof without forcing a provider effect. The historical
  Instagram ambiguity remains a separate, unchanged workstream.
