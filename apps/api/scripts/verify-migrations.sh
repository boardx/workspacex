#!/usr/bin/env bash
#
# verify-migrations.sh -- migration idempotency (UC-0.6 V6).
#
# Resets to an EMPTY database first. Running this against an already-migrated database
# would report "applied 0 migrations" and then compare a schema to itself -- green, and
# testing nothing. "Rebuildable from migrations alone" is only a claim if it is exercised
# from empty every time.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

pg_up
pg_reset
cd "$API_DIR"
pnpm exec tsx scripts/migrate-check.ts
