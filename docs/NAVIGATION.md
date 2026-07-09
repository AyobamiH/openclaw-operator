---
title: "Documentation Navigation"
summary: "Role-based paths through the current first-party docs."
---

# Documentation Navigation

Use this file when you know your goal but not the right document.

For the canonical file map, start with [INDEX.md](./INDEX.md).

Direction note:

- OpenClaw is the preferred daily front door
- this repo documents the specialist orchestrator sidecar and its bridge-backed
  runtime surfaces
- treat `/operator` docs as specialist-surface guidance, not a competing shell
  roadmap

When implementation changes materially, update the appropriate existing `.md`
file in the same change set and cross-reference the relevant code/config paths
where it helps prevent drift.

## I Need Current Runtime Truth

1. [../OPENCLAW_CONTEXT_ANCHOR.md](../OPENCLAW_CONTEXT_ANCHOR.md)
2. [OPERATOR_GUIDE.md](./OPERATOR_GUIDE.md)
3. [reference/state-schema.md](./reference/state-schema.md)
4. [reference/task-types.md](./reference/task-types.md)

## I Need To Operate Or Deploy The System

1. [../QUICKSTART.md](../QUICKSTART.md)
2. [OPENCLAW_KB/02_GATEWAY_AND_POLICY.md](./OPENCLAW_KB/02_GATEWAY_AND_POLICY.md)
3. [../DEPLOYMENT.md](../DEPLOYMENT.md)
4. [operations/deployment.md](./operations/deployment.md)
5. [guides/monitoring.md](./guides/monitoring.md)
6. [operations/backup-recovery.md](./operations/backup-recovery.md)
7. [operations/KNOWLEDGE_MIRROR_POLICY.md](./operations/KNOWLEDGE_MIRROR_POLICY.md)

## I Need To Understand The Architecture

1. [start/architecture-overview.md](./start/architecture-overview.md)
2. [concepts/architecture.md](./concepts/architecture.md)
3. [reference/api.md](./reference/api.md)

## I Need Historical Cutover Context

Use Git history for the retired proof lane. The only in-repo historical doc that
still matters for the current operator surface is:

1. [operations/OPERATOR_S_CONSOLE_CUTOVER_BLUEPRINT.md](./operations/OPERATOR_S_CONSOLE_CUTOVER_BLUEPRINT.md)

## I Need To Close Remaining Gaps

Sprint To Completion is the primary specialist-orchestrator execution tracker
for unfinished repository work. Use it to finish the bounded runtime before
taking on broader exposure work.

1. [operations/SPRINT_TO_COMPLETION.md](./operations/SPRINT_TO_COMPLETION.md)
2. [operations/DOCUMENT_AUDIT.md](./operations/DOCUMENT_AUDIT.md)
3. [GOVERNANCE_REPO_HYGIENE.md](./GOVERNANCE_REPO_HYGIENE.md)

## I Need To Extend The Runtime

1. [guides/adding-tasks.md](./guides/adding-tasks.md)
2. [guides/configuration.md](./guides/configuration.md)
3. [guides/running-agents.md](./guides/running-agents.md)
4. [reference/api.md](./reference/api.md)
5. [operations/KNOWLEDGE_MIRROR_POLICY.md](./operations/KNOWLEDGE_MIRROR_POLICY.md)

## I Need Help Troubleshooting

1. [troubleshooting/common-issues.md](./troubleshooting/common-issues.md)
2. [troubleshooting/debugging.md](./troubleshooting/debugging.md)
3. [operations/backup-recovery.md](./operations/backup-recovery.md)

## I Found An Older "Complete" Or "Phase" Doc

Do not treat it as active truth first.

1. Check [operations/DOCUMENT_AUDIT.md](./operations/DOCUMENT_AUDIT.md)
2. Confirm whether the file is classified as canonical or historical
3. Prefer code/config and the canonical docs listed in [INDEX.md](./INDEX.md)
