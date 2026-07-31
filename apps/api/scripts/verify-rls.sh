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
# So the floor tracks the measured count: 26 before F116, 29 after, 34 after F48, 38
# now. `-ge` rather than `-eq` because features legitimately add tables and this gate must
# not be the thing that turns red for it; raising the floor is the deliberate act that
# records "N more tables are now in the tenant net".
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
#
# ⚠ 34 -> 38 又是**两个 feature**，而且这次是实测抓出来的，不是算出来的：
#     +2 F10（迁移 0022）：`org_invites`、`org_invite_tamper_attempts`
#     +2 F108（迁移 0021，随 wave-0 合入）：`chat_threads`、`chat_messages`
#                —— 同样没有单独抬过这一行
#   ⇒ 「34 + 我自己的 2」会算出 36，而全新迁移库上实测是 38。差的那 2 就是 F108，
#     没有人会在算术里想起它。上面那段刚说「留了 N 张表的松量正是这个检查失效的方式」，
#     所以这一行的数字**只许实测，不许推算**——推算的方向永远是少算，
#     而少算的结果恰好是这个 ratchet 静默失效。
#
# ⚠ F10 的第三张新表 `org_invite_tokens` **不计入，且这是对的**：激活请求是匿名的
#   （点链接的人还没有会话、也还不属于任何组织），令牌行必须在没有 `app.current_org`
#   的情况下可查，所以它不带租户键，走与 `invite_codes` 同一条路——由
#   `kernel-no-tenant-data:` 的 COMMENT 声明，审计判 `exempt-*` 而不是 `ok`。
#   把它算进来，会让「新表被误判成 exempt」这件事恰好测不出来，
#   而那正是这个 ratchet 存在的理由。
#
# ⚠ F31（迁移 0023）在这一行**没有改数字，但确实实测过**：全新迁移库上 ok 计数 = 38，
#   与 floor 相等、零松量。F31 一张表都没加（只给 `artifacts` 加列 + 一个 SQL 函数），
#   所以它对这个数的贡献本来就是 0 —— 记在这里是为了让下一个人能分辨
#   「有人量过、结论是不用动」和「没人量过、于是没动」。这两件事在 diff 里长得一模一样。
ok_tables=$(psql_owner -c "SELECT count(*) FROM kernel_tenant_table_audit() WHERE verdict = 'ok';")
OK_TABLES_FLOOR=38
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
