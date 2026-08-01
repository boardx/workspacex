-- F128: 非工作坊两类的成员表（拥有者 / 协作者）+ 分组与项目成员在非工作坊容器下的
-- 禁止判据下沉到数据库 (uc-00-3 R7 / domain.md I-P6 / I-P37 / packages/contracts/src/project.ts
-- `NonWorkshopMemberRole`)
--
-- ## 两件事，同一份迁移
--
--   一、`research_project_members` / `user_insight_members` —— U-1 裁 B：研究项目与用户洞察
--      各自一张成员表，`role ∈ {owner, collaborator}`，**不复用**工作坊四角色
--      （facilitator/groupLead/member/observer）。两档常量已由契约签核落在
--      `packages/contracts/src/project.ts` 的 `NonWorkshopMemberRole`，这里的 CHECK
--      与它逐字同值——不是本迁移发明的新事实源。
--
--   二、`groups` / `project_memberships` 两张既有的工作坊机件表加判别列 `kind`
--      （U-7 裁 A）：往非工作坊容器插分组、或插一行工作坊项目成员，必须被数据库
--      外键直接拒绝，而不是应用层某个 `if` 拦下——那样不管写入路径从哪条进来都拦得住。
--      手法与 F116 的三张 1:1 子类型表同构：判别列 CHECK 常量 + 复合外键
--      `(project_id, kind) REFERENCES projects(id, kind)`。
--
-- ⚠ 契约面现在只有枚举没有操作（`usecases.md` UC-P9 尚未回补两类成员的操作），
--   见 `KNOWN_CONTRACT_GAPS.P2`。本迁移只落数据形状，不开任何新的应用层用例/路由。
--
-- ## 可重放
-- 全部 IF NOT EXISTS / DROP-then-ADD / DO 块守卫，migrate:check 会强制重放。

/* ═══════════════ 一、两张新成员表 ═══════════════ */

-- 复合外键的靶子：子表本身没有 UNIQUE(id, org_id)（F116 只给 `projects` 加了这一条），
-- 成员表要把 `project_id, org_id` 钉在**同一个容器的** org 上，同 0018 对三张子表自己
-- 的论证——单列外键只能保证「指向某个存在的容器」，保证不了「指向这个容器所属的组织」。
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'research_projects_id_org_uniq' AND conrelid = 'research_projects'::regclass
  ) THEN
    ALTER TABLE research_projects ADD CONSTRAINT research_projects_id_org_uniq UNIQUE (id, org_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_insights_id_org_uniq' AND conrelid = 'user_insights'::regclass
  ) THEN
    ALTER TABLE user_insights ADD CONSTRAINT user_insights_id_org_uniq UNIQUE (id, org_id);
  END IF;
END $$;

-- `role` 的两个取值与 `packages/contracts/src/project.ts` 的 `NonWorkshopMemberRole`
-- 逐字同值。一人一档、一档一行：PRIMARY KEY (user_id, project_id) 同工作坊
-- `project_memberships` 的「一人一个角色」形状（0003），只是键从三元组降成二元组，
-- 因为非工作坊两类没有分组、没有 host。
CREATE TABLE IF NOT EXISTS research_project_members (
  user_id    text NOT NULL,
  project_id text NOT NULL,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'collaborator')),
  PRIMARY KEY (user_id, project_id),
  FOREIGN KEY (project_id, org_id) REFERENCES research_projects (id, org_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_insight_members (
  user_id    text NOT NULL,
  project_id text NOT NULL,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'collaborator')),
  PRIMARY KEY (user_id, project_id),
  FOREIGN KEY (project_id, org_id) REFERENCES user_insights (id, org_id) ON DELETE CASCADE
);

ALTER TABLE research_project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_project_members FORCE  ROW LEVEL SECURITY;
ALTER TABLE user_insight_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_insight_members     FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS research_project_members_tenant ON research_project_members;
CREATE POLICY research_project_members_tenant ON research_project_members
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS user_insight_members_tenant ON user_insight_members;
CREATE POLICY user_insight_members_tenant ON user_insight_members
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON research_project_members FROM app_rw;
REVOKE ALL ON user_insight_members     FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON research_project_members TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_insight_members     TO app_rw;

COMMENT ON TABLE research_project_members IS
  'F128 / U-1 B: 研究项目的成员名单。role 只有 owner/collaborator 两档，不复用工作坊四角色。'
  '(project_id, org_id) 复合外键钉死「这一行属于这个容器所在的组织」，同 F116 三张子表的手法。';
COMMENT ON TABLE user_insight_members IS
  'F128 / U-1 B: 用户洞察的成员名单。role 只有 owner/collaborator 两档，不复用工作坊四角色。'
  '(project_id, org_id) 复合外键钉死「这一行属于这个容器所在的组织」，同 F116 三张子表的手法。';

/* ═══════════════ 二、工作坊机件表加判别列，非工作坊容器下机械禁止 ═══════════════ */

-- `groups` 与 `project_memberships` 是**工作坊专属机件**（分组只在工作坊里有意义，
-- 四种工作坊角色只属工作坊，I-P6）。加一个被 CHECK 钉死为常量 'workshop' 的判别列，
-- 复合外键要求 `(project_id, kind)` 在 `projects` 里存在——于是只有 `kind='workshop'`
-- 的容器能挂这两张表的行,同 F116 三张子类型表的判据（U-9 裁 A）。
--
-- ⚠ 带 DEFAULT 'workshop'：这两张表现有的写入路径（`PgProjectMembershipRepository` 等）
-- 从不知道也不需要知道 `kind` 这一列,它们只对工作坊容器写。没有默认值会让所有既有
-- 写入路径一律报「列缺失」,而那不是本 feature 要新增的失败面——本 feature 的失败面是
-- 「往非工作坊容器写」,不是「往工作坊容器写但忘了传一个新参数」。
ALTER TABLE groups ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'workshop';
ALTER TABLE project_memberships ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'workshop';

-- DROP-then-ADD：重放时收敛到当前定义，同 0018 对 `projects_kind_check` 的理由。
ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_kind_check;
ALTER TABLE groups ADD  CONSTRAINT groups_kind_check CHECK (kind = 'workshop');

ALTER TABLE project_memberships DROP CONSTRAINT IF EXISTS project_memberships_kind_check;
ALTER TABLE project_memberships ADD  CONSTRAINT project_memberships_kind_check CHECK (kind = 'workshop');

-- 复合外键守卫式创建（不能 DROP-then-ADD：`groups`/`project_memberships` 还有别的既有
-- 外键，重放时 DROP 一条不影响别的，但没有必要冒风险；只在缺失时创建，同 0018 对
-- `projects_id_kind_uniq` / `projects_id_org_uniq` 的写法）。
-- ⚠ **必须带 ON DELETE CASCADE**——`groups.project_id` / `project_memberships.project_id`
-- 原有的单列外键（0003）就是 `ON DELETE CASCADE`：删除一个项目容器时，分组与工作坊项目
-- 成员本来就该被一并带走（同 F116 三张子类型表、agenda_segments 等所有挂在 `projects` 上
-- 的表的既有约定）。这里新增的复合外键如果不带 CASCADE，会在 DELETE FROM projects 时
-- 抢在既有单列外键的级联之前先报外键冲突——`tests/kernel/mode-upgrade-no-downgrade.test.ts`
-- 的「删除项目级联到 artifact_bindings 触发 CANNOT_DOWNGRADE」与
-- `tests/support/db.ts` 的 `resetOrgs` 都依赖「删除项目容器能一路级联下去」这件事，
-- 实测验证过：漏了 CASCADE，两处都会先被这条新外键拦下来,报一个跟本 feature无关的
-- `groups_project_kind_fkey`/`project_memberships_project_kind_fkey` 冲突。
-- UPDATE 端仍是默认 NO ACTION（不写 ON UPDATE CASCADE）——把容器 kind 从
-- workshop 改掉时，已有的 groups/project_memberships 行必须继续挡住这次 UPDATE
-- （同 F116 对「判别列不是摆设」的论证，`workshop-only-machinery-fk-denied.test.ts`
-- 最后一条断言钉住这一半）。
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'groups_project_kind_fkey' AND conrelid = 'groups'::regclass
  ) THEN
    ALTER TABLE groups ADD CONSTRAINT groups_project_kind_fkey
      FOREIGN KEY (project_id, kind) REFERENCES projects (id, kind) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'project_memberships_project_kind_fkey' AND conrelid = 'project_memberships'::regclass
  ) THEN
    ALTER TABLE project_memberships ADD CONSTRAINT project_memberships_project_kind_fkey
      FOREIGN KEY (project_id, kind) REFERENCES projects (id, kind) ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON COLUMN groups.kind IS
  'F128 / U-7 A: 判别列，恒为 workshop。复合外键 (project_id, kind) -> projects(id, kind) 把'
  '「往研究项目/用户洞察容器插分组」下沉成数据库拒绝（23503），不是应用层 if。';
COMMENT ON COLUMN project_memberships.kind IS
  'F128 / U-7 A: 判别列，恒为 workshop。复合外键 (project_id, kind) -> projects(id, kind) 把'
  '「往研究项目/用户洞察容器写工作坊项目成员」下沉成数据库拒绝（23503），不是应用层 if。';

/* ═══════════════ 三、新表入网：F22 组织冻结 + F124 容器归档冻结 ═══════════════ */

-- F22（`kernel_apply_org_freeze_policies`，0014）完全按 catalog 推导（org_id 列 + 指向
-- organizations 的单列外键），两张新表都满足，重新调用一次即可入网，不用改函数本身。
SELECT kernel_apply_org_freeze_policies();

-- F124（`kernel_apply_project_archive_policies`，20260801120000）分两段：catalog 能推导
-- 的一段（列名恰好叫 `project_id` 且直接外键到 `projects`）自动覆盖 `groups` /
-- `project_memberships`（它们两张表本来就有 `project_id -> projects(id)` 的单列外键，
-- 不受本迁移新增的复合外键影响）。但 `research_project_members` / `user_insight_members`
-- 的 `project_id` 外键指向的是 `research_projects` / `user_insights`，不是 `projects`
-- 本身，落不进 catalog 推导的那一段——同三张 1:1 子类型表当初落不进去的理由一样。
-- ⇒ 必须显式加进那份「写死表清单」（同 0018 对三张子表 / `agenda_segments` 的显式加入），
-- 重新定义函数（CREATE OR REPLACE 幂等）后调用。
CREATE OR REPLACE FUNCTION kernel_apply_project_archive_policies() RETURNS void AS $$
DECLARE
  r record;
BEGIN
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

  -- 列名不叫 `project_id`，或 `project_id` 的外键目标不是 `projects` 本身，但值域就是
  -- 项目容器 id 的表：三张 1:1 子类型表用 `id`（F116），`agenda_segments` 用
  -- `workshop_id`（F118），本 feature 的两张成员表用 `project_id`——列名撞了但外键
  -- 目标是 `research_projects`/`user_insights` 不是 `projects`，catalog 推导不出来，
  -- 显式列出（F128 新增最后两行,其余四行原样保留自 F124）。
  FOR r IN
    SELECT * FROM (VALUES
      ('workshops', 'id'),
      ('research_projects', 'id'),
      ('user_insights', 'id'),
      ('agenda_segments', 'workshop_id'),
      ('research_project_members', 'project_id'),
      ('user_insight_members', 'project_id')
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
  '⚠ projects 表自己不在冻结范围内：它承载归档标记本身，冻结自己会让 unarchiveProject 回不去。'
  '⚠ F128 把 research_project_members / user_insight_members 加进了显式清单——它们的'
  'project_id 外键指向子类型表而不是 projects 本身，catalog 推导不出来。';

SELECT kernel_apply_project_archive_policies();
