# Code Instructions

Use the same assistant workflow as Copilot chat suggestions.

## First Read

Before proposing or applying material changes, read:

1. `WORKBOARD.md`
2. `ASSISTANT_WORKFLOW.md`
3. `README.md`

For runtime, operator, agent-capability, governance, proof, or API work, also
read:

1. `docs/INDEX.md`
2. `docs/reference/api.md`
3. `docs/reference/task-types.md`
4. `docs/architecture/AGENT_CAPABILITY_MODEL.md`
5. `docs/architecture/AGENT_CAPABILITY_IMPLEMENTATION_MATRIX.md`
6. `docs/architecture/OPERATOR_SURFACE_CAPABILITY_MATRIX.md`

## Repo Shape

- this repository is the public product repo
- `orchestrator/` is the backend control plane
- `operator-s-console/` is the canonical UI
- `agents/` are bounded specialists
- `WORKBOARD.md` is the first-read tracker for done / next / parked work

## Verification Commands

Run from repo root:

```bash
npm run build
npm run test:integration
npm run docs:drift
npm run docs:site:build
npm run verify
npm run verify:main
```

Focused commands:

```bash
npm --prefix orchestrator run test:unit:fixtures
npx vitest run orchestrator/test/integration.test.ts
npx vitest run orchestrator/test/agent-directory.contract.test.ts
npm --prefix operator-s-console run test
npm --prefix orchestrator run typecheck
```

## Shipping Rule

Before commit or push of a material change:

1. update `WORKBOARD.md` if current direction, recently finished work, next
   move, or parked work changed
2. keep `AGENTS.md`, `.github/copilot-instructions.md`, and
   `.github/code-instructions.md` aligned with the same first-read workflow
3. do not preserve stale private-workspace assumptions in public repo docs
4. do not push `main` or `master` without `npm run verify:main`

## Protected Branch Gate

The repo-managed pre-push hook protects `main` and `master`.

- `npm install` or `npm run setup:hooks` configures `.githooks`
- pushes to protected branches run `npm run verify:main`
- deploy-style GitHub workflows are expected to follow the same contract

## Guardrails

1. one bounded new public agent at a time
2. no bulk external-catalog imports
3. no widened permissions just to support a speculative feature
4. code and tests beat prose when they disagree
