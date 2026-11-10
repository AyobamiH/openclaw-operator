# Repository knowledge entry point

This is a small navigation map into existing authorities, not a replacement runtime knowledge system.

## Purpose and boundaries
[README](../../README.md) defines a specialist orchestrator behind OpenClaw's primary Control UI/chat front door. Do not restart a competing generic shell roadmap. [AGENTS](../../AGENTS.md) and [assistant workflow](../../ASSISTANT_WORKFLOW.md) retain ownership and approval rules. Historical workboard claims are not fresh deployment evidence.

## Architecture and source paths
- [Orchestrator bootstrap](../../orchestrator/src/index.ts) and [backend package](../../orchestrator/package.json): control-plane entry and supported backend commands.
- [Console package](../../operator-s-console/package.json): specialist UI, not the primary front door.
- [Documentation index](../../docs/INDEX.md): authoritative first-party map.
- [Knowledge routing](../../docs/operations/knowledge-routing-foundation.md): existing routing metadata, source precedence and verification edges. Consult this before broad retrieval; source owners outrank generated routing metadata.
- [API reference](../../docs/reference/api.md) and [task types](../../docs/reference/task-types.md): route and bounded-task contracts.

## Setup and verification
Read [root scripts](../../package.json) before installation: root postinstall installs hooks and child dependencies. Do not run installation against a loaded runtime checkout. In an authorised isolated development checkout, existing commands include npm run typecheck, npm run test:unit, npm run test:integration, npm run docs:links and npm run verify. Full verification can require dependencies and runtime fixtures; never present documentation checks as full acceptance. Live workload and review-session scripts require separate target/effect authorization.

## Decisions and lessons
[AGENTS](../../AGENTS.md) keeps deterministic software responsible for admission, idempotency, reconciliation and audit truth. [Graph execution ADR](../../docs/architecture/ADR-001-GRAPH-NATIVE-EXECUTION.md) owns that migration; it is not a universal hard-cutover rule. [Runtime development runbook](../../docs/operations/live-runtime-branch-first-development.md) separates isolated source validation from exact activation and rollback. Never infer deployed bytes from Git alone.

## Maintain this map
Update the relevant canonical owner and this navigation when architecture, commands or behavior change. Preserve rationale and verified lessons, not raw chats, secrets, private host inventories or stale live status. Use the repository-local security skill before changes. Validate the portable foundation with node .agents/validate-foundations.mjs.
