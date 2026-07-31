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

# ---------------------------------------------------------------------------
# F02: the assertion above is CONDITIONAL ON RLS ALREADY BEING ON.
#
# Read it again: it counts tables that have row security enabled but not forced. A new
# table with an `org_id` column and no row security at all is not in that count. It was
# green, and the table was open to every tenant.
#
# `kernel_tenant_table_audit()` (migration 0004) computes which tables carry tenant data
# from pg_catalog -- so a table added next month is in scope without anyone updating a
# list, which is the only version of this check that survives contact with a growing
# schema. It also reports tables the runtime role can read that have NO tenant key at all:
# those cannot be filtered on and are holes by construction unless the table declares
# `kernel-no-tenant-data:` in its COMMENT.
# ---------------------------------------------------------------------------
bad_tables=$(psql_owner -c "SELECT count(*) FROM kernel_tenant_table_audit() WHERE verdict NOT LIKE 'ok' AND verdict NOT LIKE 'exempt-%';")
want "every tenant-carrying table is ENABLE+FORCE RLS with a tenant policy (catalog-derived)" "0" "$bad_tables"
if [ "$bad_tables" != "0" ]; then
  echo "    offending tables:"
  psql_owner -c "SELECT table_name || ' -> ' || verdict FROM kernel_tenant_table_audit() WHERE verdict NOT LIKE 'ok' AND verdict NOT LIKE 'exempt-%';" | sed 's/^/      /'
fi

# Non-vacuity. An audit that classified nothing as tenant-carrying would satisfy the line
# above perfectly. That is this project's most repeated failure -- a gate that is green
# because it is idle -- so the count is asserted, not the absence of failures.
#
# The floor is a RATCHET, not a constant. F116 added three tenant tables (workshops /
# research_projects / user_insights) and the invariant it had to prove was "the audit's ok
# count went UP by three" -- a table classified `exempt-*`, or not classified at all,
# would have left the count where it was and nobody would have looked. With a floor of 8
# against a real count of 26, that check was structurally incapable of noticing.
#
# So the floor tracks the measured count: 26 before F116, 29 after, 34 now. `-ge` rather
# than `-eq` because features legitimately add tables and this gate must not be the thing
# that turns red for it; raising the floor is the deliberate act that records "N more tables
# are now in the tenant net".
#
# ⚠ The jump from 29 to 34 is FIVE tables from two features, and only one of them raised
# this line. F48 adds three (models / model_composite_members / model_secrets); F80 added
# two (interview scope) and left the floor at 29, so between those two merges the ratchet
# had five tables of slack -- which is precisely the state the paragraph above says makes
# this check "structurally incapable of noticing". Measured on a freshly migrated database
# after both, hence 34.
#
# ⚠ F48's `model_secrets` counts here even though `app_rw` cannot read its `ciphertext`
# column. That is right: this audit asks "is the table inside the tenant net" (ENABLE+FORCE
# with a tenant policy), not "can the runtime read every column". The two are independent,
# and the credential table needs the first precisely because someone may one day widen the
# second.
ok_tables=$(psql_owner -c "SELECT count(*) FROM kernel_tenant_table_audit() WHERE verdict = 'ok';")
OK_TABLES_FLOOR=34
if [ "$ok_tables" -ge "$OK_TABLES_FLOOR" ]; then ok "audit is not idle: $ok_tables tenant tables classified ok (floor $OK_TABLES_FLOOR)"; else bad "audit found only $ok_tables tenant tables (floor $OK_TABLES_FLOOR) -- either it is not seeing the schema, or a new table was classified exempt instead of ok"; fi

# Exemptions must be DECLARED on the table, and there must be few of them. An exemption
# nobody had to write down is one nobody reviewed.
undeclared=$(psql_owner -c "SELECT count(*) FROM kernel_tenant_table_audit() WHERE verdict = 'UNTENANTED_BUT_GRANTED';")
want "no table is readable by the runtime role without either a tenant key or a written exemption" "0" "$undeclared"

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
  echo "✅ verify-rls: RLS is enforced -- app_rw is not an owner, EVERY tenant-carrying table (derived from the catalog, not a list) is ENABLE+FORCE with a tenant policy, cross-tenant reads return 0 rows, own-tenant reads work, no tenant context is fail-closed"
  exit 0
fi
echo "❌ verify-rls: $fail assertion(s) failed."
echo "   Do NOT patch this by adding an application-level filter (UC-0.6 E2): application"
echo "   filtering is the second line. If the first line leaks, it leaks."
exit 1
