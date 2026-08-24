---
title: "Worktree integrity and execution attribution"
summary: "Deterministic damage detection, controlled-command receipts, canonical destructive guards, and bounded correlation."
---

# Worktree integrity and execution attribution

The integrity witness is deliberately independent from attribution. A damaged
worktree is detected from a persisted Git/worktree baseline even when WSL does
not expose complete kernel argv, executable, or cwd attribution. Controlled
OpenClaw subprocesses add a second, append-only evidence stream that can be
correlated after an incident.

## Owners

- `orchestrator/src/worktreeIntegrity.ts` discovers `git worktree list --porcelain`
  registrations, keeps immutable baselines, and writes observations/incidents
  under `/home/oneclickwebsitedesignfactory/.openclaw/state/worktree-integrity`.
- `orchestrator/src/executionReceipts.ts` is the common controlled-subprocess
  receipt owner. Graph legacy commands and production repository commands use
  it; other owners can adopt the same wrapper without duplicating redaction.
- `orchestrator/src/destructiveCommandGuard.ts` canonicalizes targets and fails
  closed for protected repository/worktree intersections unless one exact,
  unexpired, nonce-bearing bounded authority matches the operation and target.
- `orchestrator/src/executionCorrelation.ts` returns an evidence-qualified
  outcome and never assigns an owner from a timestamp-only match.

## Schedule and state

The intended deterministic schedule is a systemd user timer with a five-minute
interval and `Persistent=true`. The one-shot command is:

```text
node --import tsx orchestrator/scripts/worktree-integrity-witness.ts check --root /home/oneclickwebsitedesignfactory/.openclaw
```

State is outside every protected checkout. Baselines are written once and are
never replaced after degradation. `active.json`, per-worktree observations,
append-only `runs.jsonl`, and durable incident records are retained with mode
`0600`. The witness never repairs, resets, checks out, prunes, or deletes a
worktree.

## Taxonomy

- `HEALTHY`: registration, Git metadata, and every baseline-tracked file are
  present.
- `WORKTREE_METADATA_LOST`: the path remains but its Git metadata or worktree
  registration cannot be observed.
- `WORKING_TREE_CONTENT_LOST`: one or more baseline-tracked files are absent.
- `FILESYSTEM_DAMAGE_DETECTED`: the registered worktree path itself is absent
  or is no longer a directory.

## Receipt and correlation contract

Receipts contain event id, phase, timestamps, child PID when known, parent PID,
UID, executable, redacted argv, cwd, cgroup/service, agent, session, task/run,
repo/worktree, and a SHA-256 command identity. End records add exit status and
end time. Environment variables are never persisted. Sensitive flag values,
bearer/API-key-like arguments, and secret assignments are replaced with
`[REDACTED]`. Retention is bounded by both record count and bytes.

Correlation uses a bounded damage window and scores exact worktree/repository,
cwd, command-path, PID/PPID, cgroup, UID, and available kernel path evidence.
It returns `OWNER_IDENTIFIED`, `STRONG_PROCESS_CORRELATION`,
`MULTIPLE_CANDIDATES`, `NO_CONTROLLED_PROCESS_MATCH`, or
`ATTRIBUTION_INCOMPLETE`.

## Activation boundary

The implementation is developed in an isolated worktree and must be activated
only after the source-provenance gate proves tested hash = activated hash =
running hash. Installing/reloading the user timer is a separate host operation;
no production worktree is modified by the fixture validation.
