#!/usr/bin/env bash
# Shared helpers for the api-kernel gate scripts.
set -euo pipefail

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="docker compose -f ${API_DIR}/docker-compose.dev.yml -p ${COMPOSE_PROJECT_NAME:-workspacex-kernel}"

export PGHOST=127.0.0.1
export PGPORT="${PGPORT:-55432}"
export MIGRATION_DB_USER=postgres
export MIGRATION_DB_PASSWORD=postgres_dev
export APP_DB_USER=app_rw
export APP_DB_PASSWORD=app_rw_dev

# The database NAME is parameterised, and that is not cosmetic.
#
# `pg_reset` runs DROP DATABASE. With a hardcoded name, two workers running gates in
# parallel drop each other's database mid-test -- and the symptom is not a clean failure,
# it is assertions passing or failing depending on who ran what a second earlier. Set
# WORKSPACEX_DB to give a worker its own database; the app and migration configs both read
# PGDATABASE, so nothing else needs to know.
#
# The postgres ROLE (app_rw) is cluster-wide, so parallel workers DO contend on it --
# migration 0001 takes an advisory lock for exactly that reason (see the note there).
export PGDATABASE="${WORKSPACEX_DB:-workspacex}"

# #548/#581: the API process refuses to boot without this (deliberately -- see
# `infrastructure/model/aes-credential-cipher.ts`, a dev fallback for an encryption key is a
# production deployment that seals every customer's credentials under a constant living in
# git history). `apps/api/vitest.config.ts` already injects a placeholder for every test file
# that calls `createApp()`, but that injection is vitest-only -- it never reaches a gate
# script invoked directly via `tsx` (verify-runtime-gates.sh -> runtime-gate-assert.ts does
# exactly that). 2026-08-06 实测：三道运行时门控在 CI 上因此红成
# `missing env var MODEL_CREDENTIAL_KEY`，while every vitest-run test stayed green -- the gap
# was the injection boundary, not the requirement. `:-` so a real deploy-time value (if this
# script is ever sourced outside a gate) is not silently overridden.
export MODEL_CREDENTIAL_KEY="${MODEL_CREDENTIAL_KEY:-gate-key-not-a-production-secret}"

pg_up() {
  # Only postgres: the gates do not need MinIO or Redis, and starting them would make
  # a slow gate that people are tempted to skip (UC-0.6 R9).
  $COMPOSE up -d postgres >/dev/null
  local tries=0
  # Readiness is checked against the SERVER, not a specific database -- a per-worker
  # database does not exist until pg_reset creates it.
  #
  # `-h 127.0.0.1` is load-bearing (#1704): the compose service keeps its data dir on
  # tmpfs, so every start runs initdb, and the entrypoint's temporary init server listens
  # on the Unix socket ONLY. A bare `pg_isready` answers UP against that half-built
  # instance and everything after it races the entrypoint's shutdown
  # ("FATAL: terminating connection due to administrator command"). See the long note on
  # `postgresReady()` in apps/api/tests/support/db.ts -- same fact, same fix.
  until $COMPOSE exec -T postgres pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do
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
    -c "DROP DATABASE IF EXISTS ${PGDATABASE} WITH (FORCE);" \
    -c "CREATE DATABASE ${PGDATABASE};" >/dev/null
}

psql_owner() {
  $COMPOSE exec -T postgres psql -U postgres -d "${PGDATABASE}" -v ON_ERROR_STOP=1 -tAq "$@"
}
