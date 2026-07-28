#!/usr/bin/env bash
#
# verify-runtime-gates.sh -- two-way assertions for the three runtime gates (UC-0.6 V7/V8/V9).
#
# Every gate is checked in BOTH directions:
#   G1/G2  auth:       no credentials -> 401,  valid credentials -> 200 with a principal
#   G3/G4  validation: bad body -> 400 + field-level,  good body -> passes
#   G5/G6  errors:     response carries only a code + traceId,  log carries the detail
#   G7     the test-injection channel is unreachable in production
#
# Only testing that violations are blocked would let an implementation that rejects
# everything pass. Only testing that valid input passes would let a missing gate pass.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

pg_up
pg_reset
(cd "$API_DIR" && pnpm exec tsx src/infrastructure/db/migrate-cli.ts >/dev/null)

cd "$API_DIR"
pnpm exec tsx scripts/runtime-gate-assert.ts
