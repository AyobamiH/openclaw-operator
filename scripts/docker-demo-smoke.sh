#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
BASE_URL="${BASE_URL:-http://127.0.0.1:4300}"
DEMO_OPERATOR_KEY="${DEMO_OPERATOR_KEY:-demo-operator-key-local-only}"
WAIT_SECONDS="${WAIT_SECONDS:-240}"
CLEANUP_ON_EXIT="${CLEANUP_ON_EXIT:-0}"

if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose -f "$COMPOSE_FILE")
else
  COMPOSE_CMD=(docker compose -f "$COMPOSE_FILE")
fi

cleanup() {
  if [[ "$CLEANUP_ON_EXIT" != "1" ]]; then
    return
  fi
  "${COMPOSE_CMD[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}

fail() {
  echo "❌ $*" >&2
  echo "" >&2
  echo "Current compose status:" >&2
  "${COMPOSE_CMD[@]}" ps >&2 || true
  echo "" >&2
  echo "Recent orchestrator logs:" >&2
  "${COMPOSE_CMD[@]}" logs --tail=120 orchestrator >&2 || true
  exit 1
}

trap cleanup EXIT

cd "$ROOT_DIR"

services="$("${COMPOSE_CMD[@]}" config --services)"
for required in mongo redis orchestrator; do
  if ! grep -qx "$required" <<<"$services"; then
    fail "required docker demo service '$required' is missing from compose config"
  fi
done

echo "▶ Starting official Docker demo stack"
"${COMPOSE_CMD[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
"${COMPOSE_CMD[@]}" up -d --build

deadline=$((SECONDS + WAIT_SECONDS))
until curl -fsS "$BASE_URL/health" >/dev/null; do
  if (( SECONDS >= deadline )); then
    fail "docker demo health endpoint did not become ready within ${WAIT_SECONDS}s"
  fi
  sleep 5
done

health_json="$(curl -fsS "$BASE_URL/health")"
operator_html="$(curl -fsS "$BASE_URL/operator/")"
auth_json="$(curl -fsS -H "Authorization: Bearer $DEMO_OPERATOR_KEY" "$BASE_URL/api/auth/me")"

grep -q '"status":"healthy"' <<<"$health_json" || fail "docker demo /health did not report healthy"
grep -q "OpenClaw Operator" <<<"$operator_html" || fail "docker demo /operator did not render the operator shell"
grep -q "/operator/assets/index-" <<<"$operator_html" || fail "docker demo /operator did not serve the built asset bundle"
grep -q '"role":"operator"' <<<"$auth_json" || fail "docker demo operator auth did not resolve the demo operator key"

echo "✅ Docker demo smoke passed"
