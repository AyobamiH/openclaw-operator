#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANONICAL_ANCHOR="$REPO_ROOT/../OPENCLAW_CONTEXT_ANCHOR.md"
WORKSPACE_ANCHOR="$REPO_ROOT/OPENCLAW_CONTEXT_ANCHOR.md"
README="$REPO_ROOT/README.md"
DOCS_INDEX="$REPO_ROOT/docs/INDEX.md"
DOCS_NAV="$REPO_ROOT/docs/NAVIGATION.md"
API_DOC="$REPO_ROOT/docs/reference/api.md"
SPRINT_DOC="$REPO_ROOT/docs/operations/SPRINT_TO_COMPLETION.md"
DEPLOYMENT_DOC="$REPO_ROOT/docs/operations/deployment.md"
BACKUP_DOC="$REPO_ROOT/docs/operations/backup-recovery.md"
RECON_SCRIPT="$REPO_ROOT/scripts/audit_context_anchor_recon.sh"

fail() {
  echo "DRIFT-CHECK FAILED: $1" >&2
  exit 1
}

require_file() {
  local path="$1"
  [[ -f "$path" ]] || fail "missing file: $path"
}

require_contains() {
  local path="$1"
  local pattern="$2"
  grep -Fq "$pattern" "$path" || fail "missing pattern '$pattern' in $path"
}

require_not_contains() {
  local path="$1"
  local pattern="$2"
  if grep -Fq "$pattern" "$path"; then
    fail "forbidden pattern '$pattern' found in $path"
  fi
}

echo "[drift-check] validating required files"
# CANONICAL_ANCHOR lives outside the repo root (.openclaw/); skip in CI if absent
if [[ -f "$CANONICAL_ANCHOR" ]]; then
  HAVE_CANONICAL=true
else
  echo "[drift-check] WARN: canonical anchor not found at $CANONICAL_ANCHOR (expected in CI — skipping canonical checks)"
  HAVE_CANONICAL=false
fi
require_file "$WORKSPACE_ANCHOR"
require_file "$README"
require_file "$DOCS_INDEX"
require_file "$DOCS_NAV"
require_file "$API_DOC"
require_file "$SPRINT_DOC"
require_file "$DEPLOYMENT_DOC"
require_file "$BACKUP_DOC"
require_file "$RECON_SCRIPT"

echo "[drift-check] validating workspace anchor remains a stub"
require_contains "$WORKSPACE_ANCHOR" "non-canonical"
require_contains "$WORKSPACE_ANCHOR" "Do not update this file."
require_contains "$WORKSPACE_ANCHOR" "../OPENCLAW_CONTEXT_ANCHOR.md"

echo "[drift-check] validating canonical anchor references completion workflow"
if [[ "$HAVE_CANONICAL" == true ]]; then
  require_contains "$CANONICAL_ANCHOR" "Sprint to completion"
  require_contains "$CANONICAL_ANCHOR" "workspace/docs/operations/SPRINT_TO_COMPLETION.md"
  require_contains "$CANONICAL_ANCHOR" "workspace/scripts/audit_context_anchor_recon.sh"
else
  echo "[drift-check] skipping canonical anchor content checks (file absent)"
fi

echo "[drift-check] validating public navigation contracts"
require_contains "$README" "GitHub Navigation Tabs"
require_contains "$README" "docs/operations/SPRINT_TO_COMPLETION.md"
require_contains "$DOCS_INDEX" "Sprint To Completion"
require_contains "$DOCS_NAV" "Sprint To Completion"
require_contains "$API_DOC" "GET /api/incidents/:id/history"
require_contains "$API_DOC" "workflowGraph.{nodes,edges,events,proofLinks,stopClassification,timingBreakdown}"
require_contains "$API_DOC" "relationshipHistory.totalObservations"

echo "[drift-check] validating operations docs stay config-driven and safe"
require_contains "$DEPLOYMENT_DOC" "Node.js 20+"
require_contains "$DEPLOYMENT_DOC" "Mode A: Official Public Docker Demo"
require_contains "$DEPLOYMENT_DOC" "Mode B: Advanced Observability Compose"
require_contains "$DEPLOYMENT_DOC" "STATE_FILE=\$(jq -r '.stateFile' orchestrator_config.json)"
require_contains "$BACKUP_DOC" "STATE_FILE=\$(jq -r '.stateFile' orchestrator_config.json)"

require_not_contains "$DEPLOYMENT_DOC" "Node 18+"
require_not_contains "$DEPLOYMENT_DOC" "git reset --hard"
require_not_contains "$DEPLOYMENT_DOC" "/var/log/orchestrator/orchestrator.state.json"
require_not_contains "$BACKUP_DOC" "logs/orchestrator.state.json"

echo "[drift-check] running recon report generation"
bash "$RECON_SCRIPT" >/dev/null

echo "[drift-check] PASS"
