#!/usr/bin/env bash
# Shared helpers for the api-kernel gate scripts.
set -euo pipefail

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="docker compose -f ${API_DIR}/docker-compose.dev.yml -p workspacex-kernel"

export PGHOST=127.0.0.1
export PGPORT=55432
export PGDATABASE=workspacex
export MIGRATION_DB_USER=postgres
export MIGRATION_DB_PASSWORD=postgres_dev
export APP_DB_USER=app_rw
export APP_DB_PASSWORD=app_rw_dev

pg_up() {
  # Only postgres: the gates do not need MinIO or Redis, and starting them would make
  # a slow gate that people are tempted to skip (UC-0.6 R9).
  $COMPOSE up -d postgres >/dev/null
  local tries=0
  until $COMPOSE exec -T postgres pg_isready -U postgres -d workspacex >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -gt 60 ]; then
      echo "postgres did not become ready in time" >&2
      $COMPOSE logs postgres >&2 || true
      exit 1
    fi
    sleep 1
  done
}

pg_reset() {
  # Empty database on every run. "Rebuildable from migrations alone" is only a real claim
  # if it is exercised from empty; a long-lived local database hides drift.
  $COMPOSE exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS workspacex WITH (FORCE);" \
    -c "CREATE DATABASE workspacex;" >/dev/null
}

psql_owner() {
  $COMPOSE exec -T postgres psql -U postgres -d workspacex -v ON_ERROR_STOP=1 -tAq "$@"
}
