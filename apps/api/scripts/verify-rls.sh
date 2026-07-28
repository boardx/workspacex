#!/usr/bin/env bash
#
# verify-rls.sh -- the counter-proof behind the word "enforced" (UC-0.6 V4 / V5).
#
# This is the most important assertion in the bundle, and its shape matters:
#
#   * assertions 5 and 7 prove "you cannot read other tenants' rows"
#   * assertion 6 proves "you CAN read your own"
#
# Both halves are required. A policy written as a blanket deny would satisfy the first
# half alone, and the gate would be green while isolation was simply broken. Isolation and
# paralysis have to be distinguishable.
#
# Every query below runs as app_rw with NO application-level filtering at all -- raw
# SELECT * against the table. architecture.md says isolation is enforced at the PG RLS
# layer and application filtering is only the second line; a check performed with the
# second line still in place cannot tell you whether the first line works.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

fail=0
ok()   { echo "  ✓ $1"; }
bad()  { echo "  ✗ $1"; fail=$((fail + 1)); }
want() { # want <label> <expected> <actual>
  if [ "$2" = "$3" ]; then ok "$1 (= $3)"; else bad "$1: expected $2, got $3"; fi
}

echo "== bringing up postgres, resetting to an empty database =="
pg_up
pg_reset

echo "== applying migrations as the owner =="
(cd "$API_DIR" && pnpm exec tsx src/infrastructure/db/migrate-cli.ts)

echo
echo "== 1-4: role and table properties =="

owns=$(psql_owner -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND pg_get_userbyid(c.relowner)='app_rw';")
want "app_rw owns no table" "0" "$owns"

bypass=$(psql_owner -c "SELECT rolbypassrls FROM pg_roles WHERE rolname='app_rw';")
want "app_rw does not have BYPASSRLS" "f" "$bypass"

ddl=$(psql_owner -c "SELECT has_schema_privilege('app_rw','public','CREATE');")
want "app_rw cannot run DDL in public" "f" "$ddl"

unforced=$(psql_owner -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity;")
want "every RLS-enabled table is FORCEd" "0" "$unforced"

probe_exists=$(psql_owner -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='rls_probe';")
want "rls_probe exists (assertion 8: the evidence table is a kernel asset)" "1" "$probe_exists"

echo
echo "== 5-7: cross-tenant reads as app_rw, no application-level filter =="
# `set -e` is disabled around this on purpose: if the assertions fail we still want to
# PRINT which one failed. A gate whose failure output is swallowed gets worked around.
set +e
RESULT=$(cd "$API_DIR" && pnpm exec tsx scripts/rls-assert.ts 2>&1)
RC=$?
set -e
echo "$RESULT"
[ "$RC" -eq 0 ] || bad "cross-tenant assertions failed (see above)"

echo
if [ "$fail" -eq 0 ]; then
  echo "✅ verify-rls: RLS is enforced -- app_rw is not an owner, cross-tenant reads return 0 rows, own-tenant reads work, no tenant context is fail-closed"
  exit 0
fi
echo "❌ verify-rls: $fail assertion(s) failed."
echo "   Do NOT patch this by adding an application-level filter (UC-0.6 E2): application"
echo "   filtering is the second line. If the first line leaks, it leaks."
exit 1
