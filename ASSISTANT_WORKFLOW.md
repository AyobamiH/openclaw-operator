# Assistant Workflow

This file defines the permanent collaboration workflow for AI coding assistants
working in the public `openclaw-operator` repo.

Use it to keep Codex, Copilot, and any future assistant aligned on:

- what to read first
- where current state lives
- what must be updated before commit/push

It is a workflow contract, not a runtime spec.

Last updated: `2026-04-09`

## First-Read Order

When starting work in this repo:

1. Read [WORKBOARD.md](./WORKBOARD.md).
2. Read [README.md](./README.md) for product/repo orientation.
3. If the task touches runtime behavior, operator surfaces, agent capability,
   task exposure, governance, proof delivery, or API contracts, then also read:
   - [docs/INDEX.md](./docs/INDEX.md)
   - [docs/reference/api.md](./docs/reference/api.md)
   - [docs/reference/task-types.md](./docs/reference/task-types.md)
   - [docs/architecture/AGENT_CAPABILITY_MODEL.md](./docs/architecture/AGENT_CAPABILITY_MODEL.md)
   - [docs/architecture/AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md](./docs/architecture/AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md)
   - [docs/architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md](./docs/architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md)

## Source-Of-Truth Split

Keep these roles separate:

- `WORKBOARD.md`
  - current direction
  - recently finished work
  - next recommended slice
  - intentionally parked work

- `ASSISTANT_WORKFLOW.md`
  - how assistants should operate in this repo
  - what must be updated when shipping material changes

- code, tests, and machine-readable config
  - final implementation truth

- canonical anchor outside the repo:
  - `/home/oneclickwebsitedesignfactory/.openclaw/OPENCLAW_CONTEXT_ANCHOR.md`

Do not turn `WORKBOARD.md` into a second architecture spec.

## Commit And Push Update Rule

Before committing or pushing a material change, update the assistant-facing
files if the change alters current direction, shipped truth, or the next slice.

Minimum check:

1. Does `WORKBOARD.md` still describe:
   - what was just finished
   - what is next
   - what is intentionally parked
2. Do assistant entry points still point to the right first-read files?
   - `AGENTS.md`
   - `.github/copilot-instructions.md`
   - `.github/code-instructions.md`
3. If workflow expectations changed, update this file too.

If the answer to any of those is "no", fix the docs in the same change set.

## Shipping Verification Contract

Treat protected-branch shipping as a repo-managed contract, not a memory task.

- `npm run verify`
  - standard repo validation pass while iterating on a branch
- `npm run verify:main`
  - protected-branch shipping pass
  - currently `verify` plus `docs:site:build`
- `.githooks/pre-push`
  - runs `npm run verify:main` before a push to `main` or `master`
- `scripts/install-git-hooks.mjs`
  - sets `core.hooksPath` to `.githooks`
  - runs during `npm install`

GitHub Actions should use the same protected-branch verification contract
before publish-style workflows run.

## Real Test Rule

Integration tests must prove real runtime behavior, not fake or hardcoded
success paths.

When a test exercises asynchronous or cached runtime surfaces:

1. wait on real completion signals, not fixed sleeps
2. poll for the exact truth you need before asserting
3. account for cache boundaries explicitly
4. if polling a cached endpoint for fresh state, vary the request key or read a
   non-cached surface
5. do not treat "passed once locally" as evidence that a timing-sensitive
   failure is closed

If a flaky failure appears, close the whole timing/caching failure mode before
push, not just the first visible assertion.

## Hard Rules

1. Do not leave Codex and Copilot on different starting assumptions.
2. Do not keep stale assistant instructions after a repo-direction change.
3. Do not document private-lab assumptions as public repo truth.
4. Do not claim progress in `WORKBOARD.md` that the code/tests do not support.

## Preferred Pattern

For material work:

1. implement the code
2. verify it
3. if the change is headed to `main`, run `npm run verify:main`
4. update `WORKBOARD.md`
5. update assistant entry points if needed
6. commit and push

That keeps assistant guidance synchronized with shipped repo state.
