# Copilot Instructions

This repo uses a shared assistant workflow so Copilot and Codex do not drift
apart.

## First Read

Before suggesting or making material changes, read:

1. `WORKBOARD.md`
2. `ASSISTANT_WORKFLOW.md`
3. `README.md`

If the task touches runtime behavior, operator surfaces, agent capability,
task exposure, governance, proof delivery, or API contracts, also read:

1. `docs/INDEX.md`
2. `docs/reference/api.md`
3. `docs/reference/task-types.md`
4. `docs/architecture/AGENT_CAPABILITY_MODEL.md`
5. `docs/architecture/AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md`
6. `docs/architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md`

## Current Repo Shape

- this repository itself is the public product repo
- `orchestrator/` is the control plane backend
- `operator-s-console/` is the canonical operator UI
- `agents/` contains bounded task specialists
- `WORKBOARD.md` is the first-read tracker for done / next / parked work

Do not assume the older workspace-root private repo layout still applies here.

## Build And Verify

Run from the repo root unless a narrower path is enough:

```bash
npm run build
npm run test:integration
npm run docs:drift
npm run docs:site:build
npm run verify
npm run verify:main
```

Useful focused commands:

```bash
npm --prefix orchestrator run test:unit:fixtures
npx vitest run orchestrator/test/integration.test.ts
npx vitest run orchestrator/test/agent-directory.contract.test.ts
npm --prefix operator-s-console run test
npm --prefix orchestrator run typecheck
```

## Commit And Push Sync Rule

When a material change is being prepared for commit or push, make sure:

1. `WORKBOARD.md` still matches current shipped truth and the next recommended
   slice.
2. `AGENTS.md`, `.github/copilot-instructions.md`, and
   `.github/code-instructions.md` still point at the same first-read workflow.
3. Assistant-facing docs do not preserve stale private-lab assumptions after
   the code has moved on.
4. Anything headed to `main` has passed `npm run verify:main`.

## Protected Branch Gate

This repo uses a repo-managed pre-push hook for `main` and `master`.

- `npm install` configures `core.hooksPath` to `.githooks`
- the hook runs `npm run verify:main` before allowing a protected-branch push
- GitHub Actions uses the same protected-branch verification contract before
  deploy-style workflows run

## Real Integration Tests

Integration tests must prove real runtime behavior with real completion
conditions.

- do not hardcode fake success paths
- do not rely on fixed sleeps when the runtime is asynchronous
- when polling cached endpoints for fresh state, vary the request key or read a
  non-cached surface
- do not stop at the first visible flaky assertion; close the whole timing or
  cache failure mode before push
- a one-off local pass is not enough evidence for a flaky integration test

## Guardrails

1. Do not bulk-import external agent catalogs.
2. Do not widen tool or network boundaries just to make a feature possible.
3. Do not treat prose or docs as implementation truth when code disagrees.
4. Do not leave assistant entry points inconsistent after a repo-direction
   change.
