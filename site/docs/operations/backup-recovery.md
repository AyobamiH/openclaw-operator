---
title: "Backup & Recovery"
summary: "Backing up and recovering from system failures."
---

# Backup & Recovery

Use config-derived paths, not hardcoded file locations.

## Resolve Paths From Config

From workspace root:

```bash
STATE_FILE=$(jq -r '.stateFile' orchestrator_config.json)
STATE_TARGET="$STATE_FILE"
STATE_FILE="${STATE_TARGET#sqlite:}"
LOGS_DIR=$(jq -r '.logsDir' orchestrator_config.json)
KP_DIR=$(jq -r '.knowledgePackDir' orchestrator_config.json)
CONFIG_FILE=orchestrator_config.json
```

## What to Back Up

| Item | Path Source | Importance | Notes |
|---|---|---|---|
| State target | `$STATE_TARGET` | Critical | Local JSON, `mongo:<key>`, or `sqlite:<path>` |
| SQLite database | `${STATE_TARGET#sqlite:}` | Critical when selected | Back up with a SQLite-consistent snapshot, not a plain live copy |
| Config file | `$CONFIG_FILE` | Critical | Needed to restore correct paths/behavior |
| Knowledge packs | `$KP_DIR` | High | Preserves generated summaries |
| Logs directory | `$LOGS_DIR` | Medium | Useful for forensic diagnosis |

## Daily Backup Script (Example)

Create `/etc/cron.daily/backup-orchestrator`:

```bash
#!/bin/bash
set -euo pipefail

ROOT="/opt/orchestrator"
BACKUP_DIR="/backup/orchestrator"
STAMP="$(date +%Y%m%d_%H%M%S)"

cd "$ROOT"

STATE_FILE=$(jq -r '.stateFile' orchestrator_config.json)
STATE_TARGET="$STATE_FILE"
STATE_FILE="${STATE_TARGET#sqlite:}"
LOGS_DIR=$(jq -r '.logsDir' orchestrator_config.json)
KP_DIR=$(jq -r '.knowledgePackDir' orchestrator_config.json)

mkdir -p "$BACKUP_DIR/$STAMP"
case "$STATE_TARGET" in
  sqlite:*)
    sqlite3 "$STATE_FILE" "PRAGMA wal_checkpoint(PASSIVE); VACUUM INTO '$BACKUP_DIR/$STAMP/operator.sqlite';"
    ;;
  mongo:*)
    echo "Use an authenticated mongodump for the configured Mongo database; do not expose credentials in logs."
    ;;
  *)
    cp "$STATE_FILE" "$BACKUP_DIR/$STAMP/"
    ;;
esac
cp orchestrator_config.json "$BACKUP_DIR/$STAMP/"
cp -r "$KP_DIR" "$BACKUP_DIR/$STAMP/" 2>/dev/null || true
cp -r "$LOGS_DIR" "$BACKUP_DIR/$STAMP/" 2>/dev/null || true

tar -czf "$BACKUP_DIR/orchestrator-$STAMP.tar.gz" -C "$BACKUP_DIR" "$STAMP"
rm -rf "$BACKUP_DIR/$STAMP"
find "$BACKUP_DIR" -name 'orchestrator-*.tar.gz' -mtime +30 -delete
```

## Manual Backup (Workspace Mode)

```bash
STAMP="$(date +%Y%m%d_%H%M%S)"
DEST="$HOME/backups/orchestrator-$STAMP"
mkdir -p "$DEST"

case "$STATE_TARGET" in
  sqlite:*) sqlite3 "$STATE_FILE" "VACUUM INTO '$DEST/operator.sqlite';" ;;
  mongo:*) echo "Create an authenticated mongodump in $DEST" ;;
  *) cp "$STATE_FILE" "$DEST/" ;;
esac
cp orchestrator_config.json "$DEST/"
cp -r "$KP_DIR" "$DEST/" 2>/dev/null || true
tar -czf "$HOME/backups/orchestrator-$STAMP.tar.gz" -C "$HOME/backups" "orchestrator-$STAMP"
```

## Recovery Scenarios

### 1) State File Corruption

1. Stop runtime.
2. Back up corrupted state file.
3. Restore latest known-good state into `$STATE_FILE`.
4. Validate JSON:
   ```bash
   jq empty "$STATE_FILE"
   ```
5. Restart runtime and verify `/health`.

### 2) SQLite Corruption Or Rollback

1. Stop the named runtime service so no writer remains.
2. Preserve the failed database, `-wal`, and `-shm` files for diagnosis.
3. Validate the selected backup with `PRAGMA integrity_check` and
   `PRAGMA foreign_key_check`.
4. Restore the known-good database and keep `stateFile` on the same
   `sqlite:<path>` target, or restore the retained `mongo:<key>` target when a
   cutover rollback is explicitly approved.
5. Start the service once and require `/health` plus
   `/api/persistence/health` to report healthy, with `store: sqlite` after a
   SQLite recovery.

For the 2026-07-16 host cutover, retain Mongo unchanged for at least 24 hours
and until explicit retirement approval. Do not delete either backend during
the rollback window.

### 3) Disk Pressure

1. Inspect configured logs path:
   ```bash
   du -sh "$LOGS_DIR" "$KP_DIR"
   ```
2. Archive old logs to backup storage.
3. Keep recent knowledge packs and remove old ones by retention policy.
4. Re-check free space: `df -h`.

### 4) Full Host Restore

1. Restore backup archive.
2. Restore `orchestrator_config.json`.
3. Resolve paths from config again.
4. Restore state to `$STATE_FILE` and packs to `$KP_DIR`.
5. Rebuild/restart orchestrator, then verify health/state reads.

## Verification

Run monthly in non-production:

```bash
tar -tzf /backup/orchestrator/<latest>.tar.gz | head
```

Validate required artifacts exist in archive:

```bash
tar -tzf /backup/orchestrator/<latest>.tar.gz | grep -E 'orchestrator_config.json|knowledge-packs'
```

## Retention

- Daily archives: 30 days
- Weekly archives: 12 weeks
- Monthly archives: 12 months

## Notes

- Do not assume a fixed `logs/*` state filename; runtime state target comes from `stateFile` in config.
- A live SQLite database must be captured with a transactionally consistent
  SQLite backup (`VACUUM INTO`, `.backup`, or a verified filesystem snapshot).
  Copying only the main database while WAL is active is not sufficient.
- Recovery instructions must be updated if config keys change.
