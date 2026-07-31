-- F124: `archived` 项目容器 = 只读降级，在**数据库层**冻结写
-- (uc-00-2 R4 / contracts/project/domain.md I-P38 / usecases.md UC-P4)
--
-- ## 照抄的是哪个形状，改的是哪一维
--
-- 这份迁移是 0014-f22-org-lifecycle.sql 的**同构复制**，键从「组织」换成「项目容器」：
--   F22:  组织停用 → `kernel_org_is_writable(org_id)`     → 冻结带 org_id 外键的租户表
--   F124: 容器归档 → `kernel_project_is_writable(project_id)` → 冻结带 project_id 外键的表
-- 三条 RESTRICTIVE、只动 WITH CHECK 不动 USING、DELETE 单列——四条硬约束原样成立，
-- 理由与 0014 文件头逐字相同,这里不复述,只记录**不同的那一部分**。
--
-- ## 不同的地方 ①：`projects` 自己不进冻结范围
--
-- 与 organizations 不冻结自己同一个理由：`projects.status` 是冻结标记本身。
-- 冻结它，`archiveProject`/`unarchiveProject` 对这一行的 UPDATE 就会被自己的策略
-- 挡住，`archived` 就再也回不去 `active`——那是把「归档」偷偷变成了「删除」，
-- 直接违反 I-P39⑴（归档可逆，`unarchiveProject` 权限同归档者）。
-- ⇒ `projects` 表本身的写保护仍然只是应用层的 `ORG_ROLE_INSUFFICIENT` 判定
-- （`application/project/archive-project.ts`），不是本迁移的冻结范围。
--
-- ## 不同的地方 ②：判据列不是所有表都叫 `project_id`
--
-- 三张 1:1 子类型表（`workshops` / `research_projects` / `user_insights`，F116）
-- 的主键**就是**项目容器的 id（超类型模型），列名是 `id` 不是 `project_id`。
-- `agenda_segments`（F118）挂的是 `workshops`，列名是 `workshop_id`——但
-- `workshops.id ≡ projects.id`（同一值域），所以对它一样可以调用
-- `kernel_project_is_writable(workshop_id)`。这两类不满足「列名 project_id」的
-- catalog 推导条件，因此在函数里显式列出（同 0014 对 organizations 的显式排除，
-- 这里是显式**加入**）。
--
-- ## 不同的地方 ③：nullable 的 `project_id` 必须放行
--
-- `artifacts.project_id` / `content_items.project_id` / `claims.project_id` /
-- `admin_project_access.project_id` 等允许为 NULL（Studio 未挂项目、个人层内容等，
-- 各自迁移头部已有出处）。`project_id IS NULL` 时这一行**不属于任何容器**，
-- 谈不上「这个容器归档了没有」，必须放行——否则一个从未挂过项目的 Studio 草稿
-- 会被一个不存在的项目状态挡住写入。
--
-- ## 序号
-- 时间戳前缀（同 F118/F11/F12/F16 的理由）：phase-01 多个 feature 并行认领，
-- 顺序数字会互相撞号（本仓已因此出过共享库被污染的事故）。
--
-- ## 可重放
-- 全部 IF NOT EXISTS / OR REPLACE / DROP-then-CREATE，migrate:check 会强制重放。

/* ─────────────── 「这个项目容器现在可写吗」的唯一判定 ─────────────── */

-- SECURITY DEFINER，理由与 kernel_org_is_writable 完全相同：`projects` 是 FORCE RLS 的，
-- 策略里裸子查询会在当前租户上下文与被查项目不一致时读到零行，判定退化成默认放行。
-- DEFINER 让它总是看得见那一行，判定因此只有一个来源：`projects.status`。
--
-- COALESCE(..., true)：`projects` 里没有这一行时判为可写——不是兜底放行，是范围声明。
-- 一个 `project_id` 指向不存在容器的行不该被本函数拦住,那是外键约束该管的事。
CREATE OR REPLACE FUNCTION kernel_project_is_writable(p_project text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT p.status <> 'archived' FROM projects p WHERE p.id = p_project), true);
$$;

COMMENT ON FUNCTION kernel_project_is_writable(text) IS
  'F124 / I-P38: 项目容器归档后的只读降级判定，被每张挂载于该容器的表的 RLS WITH CHECK 调用。'
  'SECURITY DEFINER 是为了让它总是看得见 projects 那一行——策略里裸子查询会在租户上下文'
  '不匹配时读到零行，把判定退化成默认放行。projects 里没有该行时返回 true。';

GRANT EXECUTE ON FUNCTION kernel_project_is_writable(text) TO app_rw;

/* ─────────────── 把冻结装进每一张挂载于项目容器的表 ─────────────── */

-- ⚠ **RESTRICTIVE，三条分开，DELETE 单列**——理由与 0014 文件头 ①②③④ 逐条相同，
-- 这里不重复整段论证，只重申其中容易在复制时踩空的一条：
-- ③ 不用 `FOR ALL`：`USING` 也作用于 SELECT，归档就会从「只读降级」变成「提前销毁」，
--   直接违反 I-P38「归档后读仍可用」。
CREATE OR REPLACE FUNCTION kernel_apply_project_archive_policies() RETURNS void AS $$
DECLARE
  r record;
BEGIN
  -- ① 带 `project_id` 列、且该列有指向 `projects` 的单列外键的普通表。
  --   `project_id IS NULL` 时放行（见文件头「不同的地方 ③」）。
  FOR r IN
    SELECT c.relname::text AS name
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
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.name || '_project_archived_ins', r.name);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT '
      'WITH CHECK (project_id IS NULL OR kernel_project_is_writable(project_id))',
      r.name || '_project_archived_ins', r.name);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.name || '_project_archived_upd', r.name);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE '
      'WITH CHECK (project_id IS NULL OR kernel_project_is_writable(project_id))',
      r.name || '_project_archived_upd', r.name);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.name || '_project_archived_del', r.name);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE '
      'USING (project_id IS NULL OR kernel_project_is_writable(project_id))',
      r.name || '_project_archived_del', r.name);
  END LOOP;

  -- ② 列名不叫 `project_id` 但值域就是项目容器 id 的表：三张 1:1 子类型表用 `id`
  --   （超类型模型，F116），`agenda_segments` 用 `workshop_id`（workshops.id ≡ projects.id，
  --   F118）。这两类 catalog 推导不出来，显式列出。
  FOR r IN
    SELECT * FROM (VALUES
      ('workshops', 'id'),
      ('research_projects', 'id'),
      ('user_insights', 'id'),
      ('agenda_segments', 'workshop_id')
    ) AS t(name, col)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.name || '_project_archived_ins', r.name);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (kernel_project_is_writable(%I))',
      r.name || '_project_archived_ins', r.name, r.col);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.name || '_project_archived_upd', r.name);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE WITH CHECK (kernel_project_is_writable(%I))',
      r.name || '_project_archived_upd', r.name, r.col);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.name || '_project_archived_del', r.name);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE USING (kernel_project_is_writable(%I))',
      r.name || '_project_archived_del', r.name, r.col);
  END LOOP;
END
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION kernel_apply_project_archive_policies() IS
  'F124 的三条 RESTRICTIVE 冻结策略，按 pg_catalog 找出全部挂载于 projects 的表后逐张安装。'
  '⚠ 建了新的「project_id 挂 projects」的表之后必须再调用一次——否则那张表在新库上没有'
  '归档冻结，而本 feature 的全部断言依旧全绿（同 0014 头部同一坑的复述）。'
  '⚠ projects 表自己不在冻结范围内：它承载归档标记本身，冻结自己会让 unarchiveProject 回不去。';

SELECT kernel_apply_project_archive_policies();
