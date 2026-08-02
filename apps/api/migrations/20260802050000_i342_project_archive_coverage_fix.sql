-- issue #342: F124 的目录扫描早于 F46 创建 retention_policies/deletion_receipts，
-- 新库首次部署后这两张表从未被装上项目归档冻结策略。
--
-- ## 根因回顾（完整分析见 issue #342）
--
-- `kernel_apply_project_archive_policies()`（F124）自己的 COMMENT 已经点名过这个坑：
-- "⚠ 建了新的「project_id 挂 projects」的表之后必须再调用一次——否则那张表在新库上
-- 没有归档冻结，而本 feature 的全部断言依旧全绿"。F46（次日）建表时没有照做。
-- `migrate:check` 的重放检查能"碰巧"补上这个缺口，纯粹是因为重放是对一个已经跑完
-- 全部文件的数据库再跑一遍——不是重放发现了良性差异，是重放的执行方式意外掩盖了
-- 一次真实的、新库首次部署就存在的保护缺口。
--
-- ## 这份迁移做两件事（B + C，issue #342 的人类裁决）
--
-- **B —— 消除时序依赖，不是再打一次补丁**：
-- 把"哪些表需要冻结"这条判据从 `kernel_apply_project_archive_policies()` 内联的
-- 两段 FOR 循环里抽出来，独立成 `kernel_project_archive_candidate_tables()`。
-- 用 `CREATE OR REPLACE FUNCTION` 重新定义 F124 建立的函数——不是编辑 F124 的文件
-- 文本（那是已合入 main 的 passing 迁移，按约定不改），是新迁移让同名函数从此刻
-- 起指向新定义，这与 F121 用 `CREATE OR REPLACE FUNCTION` 重新声明 0008 两个触发器
-- 函数、只改列名不改 0008 文件本身，是完全同一个已验证过的模式。
-- 重新定义之后立刻调用一次，把 retention_policies / deletion_receipts 的缺口补上——
-- 这一步是幂等的（DROP POLICY IF EXISTS + CREATE），对已经覆盖的表是 no-op。
--
-- **C —— 机械门控，不靠"下次记得调用"**：
-- 新增 `kernel_project_archive_coverage_gaps()`，对 candidate 表逐张核对
-- `pg_policies` 里三条策略是否真的存在，返回缺口清单（空 = 合规）。
-- `apps/api/scripts/verify-rls.sh` 里新增一段调用它并断言为空——下一次任何人建了
-- 挂在 projects 下的新表却忘了调用 `kernel_apply_project_archive_policies()`，
-- **首次全量迁移后立刻能被这条门控抓到**，不必等到触发 migrate:check 的重放路径
-- （生产环境永远不会走到那条路径）。
--
-- 可重放：全部 CREATE OR REPLACE / DROP-then-CREATE，migrate:check 会强制重放。

/* ─────────── 单一事实源：哪些表需要项目归档冻结 ─────────── */

-- 返回值形状 (table_name, project_col)——与原 F124 两段 FOR 循环各自的判据完全一致，
-- 只是从"内联在安装函数里"搬到"独立可查询"。任何以后新增的显式例外（超类型表模式）
-- 加在这个函数的第二段 VALUES 列表里，不要另开一份清单。
CREATE OR REPLACE FUNCTION kernel_project_archive_candidate_tables()
RETURNS TABLE(name text, project_col text)
LANGUAGE sql
STABLE
AS $$
  -- ① 带 project_id 列、且该列有指向 projects 的单列外键的普通表。
  SELECT c.relname::text, 'project_id'::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND EXISTS (
       SELECT 1 FROM pg_constraint con
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        WHERE con.conrelid = c.oid
          AND con.contype = 'f'
          AND con.confrelid = 'projects'::regclass
          AND a.attname = 'project_id'
          AND array_length(con.conkey, 1) = 1
     )
  UNION ALL
  -- ② 列名不叫 project_id 但值域就是项目容器 id 的表（超类型模型 / workshop 别名），
  --   catalog 推导不出来，显式列出——同 F124 原文的「不同的地方②」。
  SELECT * FROM (VALUES
    ('workshops', 'id'),
    ('research_projects', 'id'),
    ('user_insights', 'id'),
    ('agenda_segments', 'workshop_id')
  ) AS t(name, col);
$$;

COMMENT ON FUNCTION kernel_project_archive_candidate_tables() IS
  'issue #342: 「哪些表需要项目归档冻结」的单一事实源，被安装函数与审计函数共用。'
  '新增一类「列名不是 project_id 但值域是项目容器 id」的表，加进第二段 VALUES，不要'
  '另开清单——那正是 F46 漏掉 F124 覆盖范围的同一种漂移。';

/* ─────────── 重新定义安装函数：读上面那个单一事实源，不再自己内联判据 ─────────── */

CREATE OR REPLACE FUNCTION kernel_apply_project_archive_policies() RETURNS void AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM kernel_project_archive_candidate_tables()
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.name || '_project_archived_ins', r.name);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (%I IS NULL OR kernel_project_is_writable(%I))',
      r.name || '_project_archived_ins', r.name, r.project_col, r.project_col);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.name || '_project_archived_upd', r.name);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE WITH CHECK (%I IS NULL OR kernel_project_is_writable(%I))',
      r.name || '_project_archived_upd', r.name, r.project_col, r.project_col);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.name || '_project_archived_del', r.name);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE USING (%I IS NULL OR kernel_project_is_writable(%I))',
      r.name || '_project_archived_del', r.name, r.project_col, r.project_col);
  END LOOP;
END
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION kernel_apply_project_archive_policies() IS
  'F124 的三条 RESTRICTIVE 冻结策略，按 kernel_project_archive_candidate_tables() 逐张安装'
  '（issue #342 起判据搬到独立函数，不再内联；本函数改为纯粹的「按判据执行」）。'
  '⚠ 建了新的挂在 projects 下的表之后仍然必须再调用一次本函数——candidate 判据是'
  '按 pg_catalog 自动发现，但「什么时候重新安装」不是自动的，见 verify-rls.sh 里的'
  '门控（issue #342 C 部分）用来在忘记调用时立刻报错，而不是等到下一次 migrate:check 重放。'
  '⚠ projects 表自己不在冻结范围内：它承载归档标记本身，冻结自己会让 unarchiveProject 回不去。';

-- 立刻重新安装一次——把 F46 遗漏的 retention_policies / deletion_receipts 补上。
SELECT kernel_apply_project_archive_policies();

/* ─────────── 审计函数：C 部分门控用这个，不重新声明判据 ─────────── */

CREATE OR REPLACE FUNCTION kernel_project_archive_coverage_gaps()
RETURNS TABLE(table_name text, missing_policy text)
LANGUAGE sql
STABLE
AS $$
  SELECT c.name, p.suffix
    FROM kernel_project_archive_candidate_tables() c
    CROSS JOIN (VALUES ('_project_archived_ins'), ('_project_archived_upd'), ('_project_archived_del')) AS p(suffix)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policies pp
      WHERE pp.schemaname = 'public'
        AND pp.tablename = c.name
        AND pp.policyname = c.name || p.suffix
   );
$$;

COMMENT ON FUNCTION kernel_project_archive_coverage_gaps() IS
  'issue #342 C 部分：机械门控读的就是这个。对 kernel_project_archive_candidate_tables() '
  '返回的每张表核对 pg_policies 里三条策略是否真的存在，返回缺口清单——空结果集 = 合规。'
  '被 verify-rls.sh 调用并断言为空，catch 的正是「新表忘了调用安装函数」这个具体错误。';
