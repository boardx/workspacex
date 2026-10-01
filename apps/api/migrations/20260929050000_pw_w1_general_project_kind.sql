-- #4615 W1（PROP-PROJECT-WORKSPACE-001）：非工作坊两类容器并为一类 `general`
--
-- ## 裁决
--
-- 2026-09-29 人类裁决推翻 Q-12：「项目」是通用工作空间，工作坊只是一种可选形态。
-- 契约 `packages/contracts/src/project.ts` 的 `ProjectKind` 已改为 `["workshop", "general"]`，
-- 原 `research_project` / `user_insight` 两类**并入** `general`。产品未上线，不做数据迁移承诺；
-- 但本文件仍把残留行就地转换（而不是删除），因为那样的代价只是多几行 SQL。
--
-- ## 落地形状（F116 的超类型 + 1:1 子类型表、F128 的判别列 + 复合外键原样保留）
--
--   · `research_projects`        → 改名 `general_projects`，`kind` 常量 CHECK 改为 'general'
--   · `research_project_members` → 改名 `general_project_members`（owner | collaborator 不变）
--   · `user_insights` / `user_insight_members` → 行并入上面两张后 DROP
--   · `projects.kind` CHECK → ('workshop', 'general')
--   · 工作坊机件表（`groups` / `project_memberships` 的 `(project_id, kind)` 复合外键，F128）
--     不动：它们只接受 kind='workshop'，对 general 容器仍由数据库拒绝。
--
-- ## 可重放（migrate:check：全新库首跑 + 忽略版本表强制重放，schema 摘要必须一致）
--
-- 强制重放时，本文件**之前**的 0018 / F128 会把 `research_projects` / `user_insights` /
-- 两张 `*_members` 表**重新建出来**（`CREATE TABLE IF NOT EXISTS` 对已改名的表看不见），
-- 所以本文件每一步都按「旧表可能又存在、新表可能已存在」两种状态同时守卫：
--   · 改名只在新名不存在时做；新名已存在时，重建出来的旧表（空表）按「并入 → DROP」处理；
--   · 约束随改名一起改名 —— ⚠ 不是洁癖：PK / UNIQUE 约束背后的索引名是 schema 级全局名，
--     不改名的话重放 0018 重建 `research_projects` 时会撞上 `research_projects_pkey already exists`；
--   · 两张表上的策略整体 DROP 后重装（租户策略在这里写，冻结策略由两个安装函数装），
--     保证首跑与重放得到同名、同表达式的策略集合。
--
-- ⚠ 已知限制（不在本文件修）：若库里**已有** kind='general' 的行，再强制重放 0018 会在
--   `projects_kind_check`（旧三值）上失败。migrate:check 的种子只有 workshop 行，不受影响；
--   生产永远不走强制重放。改 0018 的文本属于改已合入的迁移，按约定不做。

/* ═══════════════ 一、改名（首跑路径） ═══════════════ */

DO $$ BEGIN
  IF to_regclass('public.general_projects') IS NULL
     AND to_regclass('public.research_projects') IS NOT NULL THEN
    ALTER TABLE research_projects RENAME TO general_projects;
  END IF;
  IF to_regclass('public.general_project_members') IS NULL
     AND to_regclass('public.research_project_members') IS NOT NULL THEN
    ALTER TABLE research_project_members RENAME TO general_project_members;
  END IF;
END $$;

/* ═══════════════ 二、约束改名 + 解开阻挡 kind 转换的两条 ═══════════════ */

-- 旧名前缀 → 新名前缀。PK / UNIQUE 改名会连带改掉背后的索引名（见文件头 ⚠）。
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'general_projects'::regclass AND conname LIKE 'research\_projects\_%'
  LOOP
    EXECUTE format('ALTER TABLE general_projects RENAME CONSTRAINT %I TO %I',
                   r.conname, 'general_projects_' || substr(r.conname, length('research_projects_') + 1));
  END LOOP;
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'general_project_members'::regclass AND conname LIKE 'research\_project\_members\_%'
  LOOP
    EXECUTE format('ALTER TABLE general_project_members RENAME CONSTRAINT %I TO %I',
                   r.conname, 'general_project_members_' || substr(r.conname, length('research_project_members_') + 1));
  END LOOP;
END $$;

-- kind 的三处钉子：超类型 CHECK、子表常量 CHECK、子表 (id, kind) 复合外键（NO ACTION，
-- 故意不 CASCADE —— F116 头注）。三者都得先放开才能把 kind 从旧值改成 'general'，
-- 下面第四节再按新值加回来。
ALTER TABLE projects         DROP CONSTRAINT IF EXISTS projects_kind_check;
ALTER TABLE general_projects DROP CONSTRAINT IF EXISTS general_projects_kind_check;
ALTER TABLE general_projects DROP CONSTRAINT IF EXISTS general_projects_id_kind_fkey;

/* ═══════════════ 三、残留行并入 general，旧表 DROP ═══════════════ */

-- 旧子表（首跑：user_insights；重放：0018 重建出来的空 research_projects / user_insights）
-- 的行并入 general_projects；成员行并入 general_project_members。
-- ON CONFLICT DO NOTHING：`projects.id` 是全局主键，同一个 id 至多在一张子表里有行（I-P34），
-- 冲突只可能来自重放，此时新表那一行就是它本身。
DO $$ BEGIN
  IF to_regclass('public.user_insights') IS NOT NULL THEN
    INSERT INTO general_projects (id, kind, org_id)
      SELECT id, 'general', org_id FROM user_insights
      ON CONFLICT (id) DO NOTHING;
  END IF;
  IF to_regclass('public.research_projects') IS NOT NULL THEN
    INSERT INTO general_projects (id, kind, org_id)
      SELECT id, 'general', org_id FROM research_projects
      ON CONFLICT (id) DO NOTHING;
  END IF;
  IF to_regclass('public.user_insight_members') IS NOT NULL THEN
    INSERT INTO general_project_members (user_id, project_id, org_id, role)
      SELECT user_id, project_id, org_id, role FROM user_insight_members
      ON CONFLICT (user_id, project_id) DO NOTHING;
  END IF;
  IF to_regclass('public.research_project_members') IS NOT NULL THEN
    INSERT INTO general_project_members (user_id, project_id, org_id, role)
      SELECT user_id, project_id, org_id, role FROM research_project_members
      ON CONFLICT (user_id, project_id) DO NOTHING;
  END IF;
END $$;

-- 成员表先于子表 DROP（成员表的复合外键指向子表）。不用 CASCADE：除了这两对之间，
-- 不该有任何东西指向它们；真有的话宁可在这里失败，也不要静默带走别人的外键。
DROP TABLE IF EXISTS user_insight_members;
DROP TABLE IF EXISTS research_project_members;
DROP TABLE IF EXISTS user_insights;
DROP TABLE IF EXISTS research_projects;

UPDATE projects         SET kind = 'general' WHERE kind IN ('research_project', 'user_insight');
UPDATE general_projects SET kind = 'general' WHERE kind <> 'general';

/* ═══════════════ 四、按新闭集把三处钉子加回来 ═══════════════ */

ALTER TABLE projects ADD CONSTRAINT projects_kind_check
  CHECK (kind IN ('workshop', 'general'));

ALTER TABLE general_projects ALTER COLUMN kind SET DEFAULT 'general';
ALTER TABLE general_projects ADD CONSTRAINT general_projects_kind_check CHECK (kind = 'general');
-- 与 0018 原样同构：带 ON DELETE CASCADE（删容器带走子行），UPDATE 端 NO ACTION
-- （改 kind 撞外键，判别列因此不是摆设 —— I-P34 反证 ③）。
ALTER TABLE general_projects ADD CONSTRAINT general_projects_id_kind_fkey
  FOREIGN KEY (id, kind) REFERENCES projects (id, kind) ON DELETE CASCADE;

-- 首跑时 F128 已经给子表加过 (id, org_id) 唯一约束（改名后是 general_projects_id_org_uniq），
-- 成员表的复合外键依赖它。这里只做缺失时补齐的守卫，不 DROP-then-ADD（有依赖）。
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'general_projects_id_org_uniq' AND conrelid = 'general_projects'::regclass
  ) THEN
    ALTER TABLE general_projects ADD CONSTRAINT general_projects_id_org_uniq UNIQUE (id, org_id);
  END IF;
END $$;

/* ═══════════════ 五、策略：整体清掉后重装 ═══════════════ */

-- 改名不会改策略名（首跑后策略仍叫 research_projects_*），重放时又会是另一套名字。
-- 整体 DROP 再装一遍，首跑与重放收敛到同一集合。
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename IN ('general_projects', 'general_project_members')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE general_projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE general_projects        FORCE  ROW LEVEL SECURITY;
ALTER TABLE general_project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE general_project_members FORCE  ROW LEVEL SECURITY;

CREATE POLICY general_projects_tenant ON general_projects
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

CREATE POLICY general_project_members_tenant ON general_project_members
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON general_projects        FROM app_rw;
REVOKE ALL ON general_project_members FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON general_projects        TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON general_project_members TO app_rw;

-- 项目归档冻结的候选表单一事实源（issue #342）：显式段里的旧两张子表换成 general_projects，
-- 并把 general_project_members 加回来 —— 它的 `project_id` 外键指向子表而不是 `projects`，
-- 目录推导（段①）认领不到。F128 当初把两张成员表写进了 F124 的显式清单，
-- i342 抽出这个函数时漏掉了它们（首跑库上旧策略是 F128 装的，i342 之后不再被重装/审计）。
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
  -- ② 值域是项目容器 id、但目录推导认领不到的表，显式列出。
  SELECT * FROM (VALUES
    ('workshops', 'id'),
    ('general_projects', 'id'),
    ('agenda_segments', 'workshop_id'),
    ('general_project_members', 'project_id')
  ) AS t(name, col);
$$;

COMMENT ON FUNCTION kernel_project_archive_candidate_tables() IS
  'issue #342: 「哪些表需要项目归档冻结」的单一事实源，被安装函数与审计函数共用。'
  '新增一类「列名不是 project_id 或外键目标不是 projects、但值域是项目容器 id」的表，加进第二段 VALUES，'
  '不要另开清单。#4615 W1：research_projects / user_insights 并为 general_projects，'
  '并补回 general_project_members。';

-- 两个安装函数都按 catalog / 上面的单一事实源推导，重新调用即可让两张表入网
-- （0014 / F124 头注：新库上不调用 = 没有冻结，而其余断言照样全绿）。
SELECT kernel_apply_org_freeze_policies();
SELECT kernel_apply_project_archive_policies();

COMMENT ON TABLE general_projects IS
  '#4615 W1: 通用项目（原研究项目 / 用户洞察两类并入）。1:1 于 projects；'
  '(id, kind) 复合外键 + kind CHECK 常量 = 一个容器至多属于一个子类型（I-P34）。';
COMMENT ON TABLE general_project_members IS
  '#4615 W1: 通用项目的成员名单。role 只有 owner/collaborator 两档，不复用工作坊四角色。'
  '(project_id, org_id) 复合外键钉死「这一行属于这个容器所在的组织」。';
