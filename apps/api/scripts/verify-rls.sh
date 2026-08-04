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
#
# ⚠ 38 -> 40 是 F15（迁移 0025）**在全新迁移库上实测**的：
#   `WORKSPACEX_DB=wsx_f15rls bash scripts/verify-rls.sh` 报 `ok = 40`。
#   F15 加了三张表，只有两张进这个数：`invite_links` 与 `project_participants` 带 org_id ⇒ ok；
#   第三张 `invite_link_tokens` 与 F10 的 `org_invite_tokens` 同型同理由——扫码进场的人
#   还没有会话、也还不属于任何组织，令牌行必须在没有 `app.current_org` 的情况下可查 ⇒
#   由 `kernel-no-tenant-data:` 的 COMMENT 声明，审计判 `exempt-*`。
#   ⇒ 「38 + 我加的 3」会算出 41，而实测是 40。**这就是为什么这个数只能量不能算**。
#
# ⚠ 40 -> 41 是 F49（迁移 0031）**在全新迁移库上实测**的：
#   `WORKSPACEX_DB=wsx_f49rls bash scripts/verify-rls.sh` 报 `ok = 41`。
#   F49 只加一张表 `model_admission_tests`（五项判读的 append-only 日志），带 org_id ⇒ ok。
#   这次「40 + 1 = 41」算术恰好对上了，而这不构成可以推算的理由 —— 上面 F15 那段记的是
#   同样的算术差了 1、F10/F108 那段差了 2，两次都是往少了算。这个数**仍然是量出来的**，
#   算术只是事后核对；下一个人请照样跑一遍，不要因为这次对上了就开始加法。
#
# ⚠ 41 -> 42 是 F117（迁移 0026）**在全新迁移库上实测**的：
#   `WORKSPACEX_DB=wsx_f117merged bash scripts/verify-rls.sh` 报 `ok = 42`。
#   F117 只加一张表 `project_creation_requests`（createProject 的重放表），带 org_id ⇒ ok。
#
#   ⚠ 这个数是 **rebase 到 F49 之后重新量的**，不是把自己那一格挪一位。
#   F117 与 F49 并行开发，两边各自在 40 的基础上抬到 41、各自都实测过——两个 41 都对，
#   而它们**不能叠**。合流之后 41 已经是 F49 一个人的了，F117 若照抄自己那次的 41，
#   这个 ratchet 会当场多出一张表的松量，而它仍然全绿。
#   ⇒ 并行分支合流时，这一行**必须在合流后的库上重跑**，不是在 diff 里对齐。
#
# ⚠ 42 -> 43 是 F81（迁移 0030）**在 rebase 到同时含 F49 与 F117 的 main 之后、于全新迁移库上
#   重新实测**的：`WORKSPACEX_DB=wsx_f81rls bash scripts/verify-rls.sh` 报 `ok = 43`。
#   F81 只加一张表 `interview_step_attachments`（访谈 → 项目环节的挂载，带 org_id ⇒ ok）；
#   它另外给 `interview_sessions` 加了一列，加列对这个数的贡献是 0。
#
#   ⚠ **F81 在这一行上量了三次，前两次的数字都作废了**，把过程记下来：
#     · 第一次（分支上，main 还没有 F49 / F117）：`40 -> 41`
#     · 第二次（rebase 到含 F49 的 main 之后）：`41 -> 42`
#     · 第三次（F117 又先合入，再 rebase）：`42 -> 43`  ← 本行
#   三次各自都是实测，三次都对 —— 对的是**当时那棵树**。三个 feature 并行开发，
#   每次合流都会让前一次的测量作废，而作废的方式在 diff 里长得像一次普通的文本冲突：
#   两段注释、两个不同的数字，看起来只要挑一个留下。**挑一个就漏一张表，且仍然全绿**
#   （比较是 `-ge`，floor 少 1 永远不会红）。
#   ⇒ 这一行的唯一正确处理是：冲突整个丢掉，在**合流后的库**上从空库重跑一次。
#     它不只是「不许推算」，还是「不许沿用自己上一次的实测」。

# ⚠ 43 -> 44 是 F32（迁移 0027）在 rebase 到同时含 F49 / F117 / F81 的 main 之后、
#   于**全新迁移库上第三次重新实测**的：`WORKSPACEX_DB=wsx_f32rls bash scripts/verify-rls.sh`。
#   F32 只加一张表 `download_grants`（下载授予：短时效 · 一次性 · 绑定 principal），带 org_id ⇒ ok。
#   ⚠ 它**没有**走 `invite_link_tokens` / `org_invite_tokens` 那条「无租户键的令牌表」的路，
#     所以不是 `exempt-*`。理由见 0027 文件头：那两张表脱离租户是因为点链接的人还不是
#     任何组织的成员；而下载链接**绑定 principal**，兑付方必然是已登录的那个人，
#     会话里带着 org。⇒ 令牌行留在租户内，这一行 +1 而不是 +0。
#
#   ⚠ **F32 也在这一行上量了三次，前两次全部作废** —— 与 F81 上面那段是同一件事的第二例：
#     · 第一次（分支上，main 还没有 F49）：`40 -> 41`
#     · 第二次（rebase 到含 F49 的 main 之后）：`41 -> 42`
#     · 第三次（F117 与 F81 又先合入，再 rebase）：本行
#   ⇒ 到此为止，**四个并行 feature 在这一行上一共产生过九次实测，其中五次已作废**。
#     作废的从来不是「量错了」，而是「量的那棵树没了」。冲突里两个数字都对、都不能用。

ok_tables=$(psql_owner -c "SELECT count(*) FROM kernel_tenant_table_audit() WHERE verdict = 'ok';")
# ⚠ 44 -> 46 是 F109（迁移 0029）在 rebase 到同时含 F49 / F117 / F81 / F18 / F32 的 main 之后、
#   于**全新迁移库上重新实测**的：`WORKSPACEX_DB=wsx_f109rls3 bash scripts/verify-rls.sh`
#   报 `ok = 46`。F109 加了两张表，两张都进这个数：`chat_transcript_sessions` 与
#   `chat_thread_files` 都带 `org_id` ⇒ 判 `ok`（另外给 `chat_threads` / `chat_messages`
#   各加了一列，加列对这个数的贡献是 0）。
#
#   ⚠ **F109 也在这一行上量了两次，第一次已作废** —— 这是第三例：
#     · 第一次（分支上，main 还停在 0025）：`40 -> 42`
#     · 第二次（F49/F117/F81/F18/F32 全部先合入，再 rebase）：本行
#   rebase 时这一行是一个**普通文本冲突**：两段注释、两个数字（44 与 42），
#   看起来只要挑一个留下。**挑 42 就漏四张表，且仍然全绿**（比较是 `-ge`）。
#   正确处理是上面 F81 那段写的：冲突整个丢掉，在合流后的库上从空库重跑一次。这次照做了。
#
#   ⚠ 「44 + 我加的 2 = 46」这次算术又恰好对上，**连续第二次**（F49 那段记的是第一次）。
#     这**仍然不构成**可以推算的理由：算术对上只说明这一轮没有 exempt 表。
#     F10/F108 那次差 2、F15 那次差 1，两次都是往少了算，而少算的结果恰好是静默失效。
# ⚠ 46 -> 96 是 #463（迁移 20260805030000）在**全新迁移库上实测**的：
#   `WORKSPACEX_DB=wsx_463rls bash scripts/verify-rls.sh` 报 `ok = 96`。
#   #463 只加了两张表（`canvas_templates` / `canvas_template_bindings`，两张都带 org_id ⇒ ok）。
#
#   ⚠ **「46 + 我加的 2 = 48」，而实测是 96。差的 48 张全部是别人的。**
#     这一行上一次被抬是 F109，之后 wave-0 / wave-1 / wave-2 一路合入了几十张租户表，
#     **没有任何一个 feature 抬过它**。也就是说，本文件上面那几段反复警告的
#     「留了 N 张表的松量正是这个检查失效的方式」，在这半个月里的实际值是 **N = 48**：
#     这半个月里任何一张新表被误判成 `exempt` 而不是 `ok`，这个 ratchet 都不会红
#     （比较是 `-ge`，96 - 48 = 48 的余量吃得下任何一次误判）。
#     ⇒ 本次不是「把 46 加 2」，是把这一行**重新对齐到实测值**。它顺带记下一件事：
#       这个 ratchet 事实上空转了整整一个波次，而空转的样子与正常绿是完全一样的。
#
#   ⚠ #457 / #459 与本 PR 并行，两者都可能再加租户表。若合流时这一行出现文本冲突：
#     照上面 F81 / F109 两段写过的做法——**冲突整个丢掉，在合流后的库上从空库重跑一次**，
#     不要在 diff 里挑一个数字留下，也不要把两边的增量相加。
# ⚠ 96 -> 101 是 #465（迁移 20260805100000）在**全新空库上实测**的：
#   `WORKSPACEX_DB=wsx_rec465rls bash scripts/verify-rls.sh` 报
#   `audit is not idle: 101 tenant tables classified ok`。
#   本 PR 加五张表，五张都带 `org_id` ⇒ 五张都判 `ok`：
#   `recording_sessions` / `recording_tracks` / `recording_segments` /
#   `recording_consent_cells` / `recording_operation_idempotency`。
#
#   ⚠ **量了两次，第二次才是这一行的值**：第一次在分支基点 035b8407 上量得 101；
#     随后 rebase 到含 #486 / #476 / #471 的 main 上，用**另一个全新库名**
#     （`wsx_rec465rls2`）从空库重跑，仍是 101。第二次不是「确认一下」，是因为
#     上面 F81 / F109 两段写死了「合流会让前一次测量作废」——碰巧数字没变，
#     不等于前一次测量还有效。
#   ⚠ 「96 + 我加的 5 = 101」这次算术又恰好对上，而这**仍然不构成**可以推算的理由——
#     上面 F49 / F109 两段各记过一次算术对上，紧接着 F10/F108 差 2、F15 差 1，
#     两次都是往少了算，而少算的结果恰好是静默失效（比较是 `-ge`，floor 少 1 永远不会红）。
#     算术对上只说明这一轮没有 exempt 表，不说明下一轮也没有。
#   ⚠ #459（skill controller）与 #414（agent-runtime）与本 PR 并行，两者都可能再加租户表。
#     合流时这一行若出现文本冲突：照上面 F81 / F109 两段的做法——**冲突整个丢掉，
#     在合流后的库上从空库重跑一次**，不要在 diff 里挑一个数字留下，也不要把两边的增量相加。
OK_TABLES_FLOOR=101
if [ "$ok_tables" -ge "$OK_TABLES_FLOOR" ]; then ok "audit is not idle: $ok_tables tenant tables classified ok (floor $OK_TABLES_FLOOR)"; else bad "audit found only $ok_tables tenant tables (floor $OK_TABLES_FLOOR) -- either it is not seeing the schema, or a new table was classified exempt instead of ok"; fi

# Exemptions must be DECLARED on the table, and there must be few of them. An exemption
# nobody had to write down is one nobody reviewed.
undeclared=$(psql_owner -c "SELECT count(*) FROM kernel_tenant_table_audit() WHERE verdict = 'UNTENANTED_BUT_GRANTED';")
want "no table is readable by the runtime role without either a tenant key or a written exemption" "0" "$undeclared"

probe_exists=$(psql_owner -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='rls_probe';")
want "rls_probe exists (assertion 8: the evidence table is a kernel asset)" "1" "$probe_exists"

# issue #342: F124's catalog-scanning archive-freeze installer ran before F46 created
# retention_policies/deletion_receipts, so a fresh database never got those two tables'
# freeze policies -- migrate:check's replay accidentally papered over the gap (replay runs
# every file again against an already-fully-migrated database, so by the time F124 replays
# the later tables already exist). This assertion is what catches the NEXT instance of the
# same slip on a genuinely fresh apply, not just on the replay path production never takes.
# It reads kernel_project_archive_coverage_gaps() -- issue #342's own single source of truth
# for "which tables need the freeze", not a second list maintained here.
archive_gaps=$(psql_owner -c "SELECT count(*) FROM kernel_project_archive_coverage_gaps();")
want "no table missing its project-archive freeze policy (issue #342)" "0" "$archive_gaps"

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
