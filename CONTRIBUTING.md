# Contributing

This repository is the canonical home for public OpenClaw Operator product
work.

## Branch-First Workflow

Use a local branch for every non-trivial change.

Expected flow:

1. create a local branch from `main`
2. make and validate the change on that branch
3. merge the branch into `main` locally when it is ready
4. push the merged `main`

Do not treat `main` as the place where active work accumulates directly.

## Protected-Branch Verification

This repo now enforces a protected-branch shipping contract for `main` and
`master`.

- `npm run verify` is the standard repo validation pass
- `npm run verify:main` is the protected-branch shipping pass
- the repo-managed pre-push hook runs `npm run verify:main` before allowing a
  push to `main` or `master`

Install the repo-managed hooks with:

```bash
npm install
```

If needed, you can reapply the hook setup manually with:

```bash
npm run setup:hooks
```

GitHub Actions also uses the same protected-branch verification contract before
deploying docs or production artifacts.

## Assistant Sync Rule

This repo now uses a shared assistant entry workflow for Codex and Copilot.

Before committing or pushing a material change, make sure:

1. [WORKBOARD.md](./WORKBOARD.md) still reflects what was just finished, what is
   next, and what is intentionally parked.
2. [ASSISTANT_WORKFLOW.md](./ASSISTANT_WORKFLOW.md) still matches how assistants
   are expected to operate in this repo.
3. [AGENTS.md](./AGENTS.md), [.github/copilot-instructions.md](./.github/copilot-instructions.md),
   and [.github/code-instructions.md](./.github/code-instructions.md) are not
   drifting into different starting assumptions.

The goal is simple:

- one repo state tracker
- one assistant workflow
- no Codex/Copilot divergence after ship

## What Belongs Here

Open issues and pull requests here for:

- product behavior meant for users or contributors
- operator UI, docs, onboarding, and examples
- agent, task, approval, API, and runtime changes that should ship publicly
- tests, fixes, and cleanup that improve public self-hosting or adoption

## What Does Not Belong Here By Default

Keep these out unless they have been deliberately generalized for public use:

- personal notes or memory files
- machine-specific paths, secrets, and local operating habits
- rough experiments that are not yet ready for contributors
- private helper workflows that only make sense in one personal environment

## Promotion Rule

If a change starts life in a private lab or side-step workflow, only bring it
here after it has a clean public shape:

1. restate the change in product terms
2. remove machine-specific and personal residue
3. document the public-facing behavior
4. add or update tests when the change affects runtime behavior

The goal is simple:

- public repo for product work
- private repo for incubation and personal operating layers
