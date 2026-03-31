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
