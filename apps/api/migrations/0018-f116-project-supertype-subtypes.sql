-- 0018 F116: 三类容器落库 —— `projects` 超类型 + 三张 1:1 子类型表
-- (uc-00-1 R7 / contracts/project/domain.md I-P33 / I-P34 / I-P36)
--
-- ## 这个文件在防什么
--
-- 人类裁决 Q-12 裁 C：工作坊 / 研究项目 / 用户洞察是**三类过程与目的完全不同**的容器；
-- 连带 4 裁 D：落地形状是「超类型 + 1:1 子类型表」，因为 `projects(id)` 上已经挂了
-- **7 条外键**（groups / project_memberships / admin_project_access / artifacts /
-- artifact_bindings / segment_text / claims），拆成三张平行表要改这 7 条，D 一条不改。
--
-- 这条裁决最容易被**顺手抹平**的地方不在这里，在下一个人身上：
-- 「往 `projects` 上加一列」在任何一次实现里都只是一行 SQL，而它一旦发生，
-- 「三类共用的只有容器身份 + 组织归属 + 状态」就不再成立，三类又变回一张表两条代码路径。
-- ⇒ `projects` 的列集合是**封闭清单**（I-P33），由
--    `apps/api/tests/project/projects-column-set.test.ts` 做**白名单等值**门控。
--    ⚠ 是集合相等，不是黑名单：黑名单挡不住下一个没被想到的名字
--    （`agenda_segment_id` 被挡住了，`current_segment_id` 没有）。
--
-- ## 1:1 怎么保证（I-P34）——裁决原文没说，这里是判据
--
-- 「子表 PK = FK 到 projects.id」只保证*每张子表*对同一个 id 至多一行。
-- 三张子表互相不知道对方，所以
--     INSERT INTO workshops(id) VALUES ('p1');
--     INSERT INTO research_projects(id) VALUES ('p1');   -- 纯 PK+FK 下两条都合法
-- ⇒「至多属于一个子类型」在纯 PK+FK 下**不可断言**。
--
-- 判据 = 判别列 + 复合外键（U-9 裁 A，纯声明式，**不用触发器**）：
--   1. `projects` 一行只有一个 `kind` 值；
--   2. 子表的 `kind` 被 CHECK 钉死为常量，复合外键要求 `(id, kind)` 在 `projects` 里存在
--      ⇒ 只有 `kind='workshop'` 的容器能有 `workshops` 子行；
--   3. 三张子表的 CHECK 常量两两不同 ⇒ 同一个 id 不可能同时满足两张表的复合外键。
-- 「至多一个子类型」于是从三张表之间的协定，降成了一行的 `kind` 值 —— 可机械断言。
--
-- ⚠ 复合外键**故意不带 ON UPDATE CASCADE**：带上以后「把容器的 kind 从 workshop 改成
--   research_project」会把子行一起改过去，而那正是 I-P34 反证 ③ 要拒绝的动作。
--   NO ACTION（默认）让这次 UPDATE 撞在外键上 —— 判别列因此不是一个写进去没人用的列。
--
-- ## 可重放
-- 全部 IF NOT EXISTS / DROP-then-ADD。migrate:check 忽略版本表强制重放每个文件。
-- ⚠ `CREATE TABLE IF NOT EXISTS` 在表已存在时是**静默空操作**，所以对已存在的
--   `projects` 一律走 ALTER ... ADD COLUMN IF NOT EXISTS（同 0015 / 0017 头部那条）。

/* ═══════════════ 一、超类型 `projects` 补两列 ═══════════════ */

-- 状态（Q-5 裁 B：两态，`archived` = 只读，归档不删除任何内容）。
-- 只读语义（RESTRICTIVE 策略）不在本迁移里 —— 那是 F124 的交付物；本条只把
-- 「状态住在超类型上」这件事落库，因为「状态」是三类共用的那三样之一。
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- 判别列（U-9 裁 A）。
--
-- ⚠ **没有 DEFAULT，是故意的。** 有了默认值，「忘了说这是哪一类」就会静默变成工作坊，
--   而 F117 的 INVALID_KIND 永远等不到一个空值。三类的过程完全不同，
--   「没说」必须是一个写不进去的状态。
--
-- 分两步到达（ADD 可空 → 回填 → SET NOT NULL）而不是一步 `ADD COLUMN ... NOT NULL`：
-- 后者在**已有行**的库上直接失败。回填只会命中判别列诞生之前就存在的行，
-- 那些行全部是本仓尚未发布的开发数据。
ALTER TABLE projects ADD COLUMN IF NOT EXISTS kind text;
UPDATE projects SET kind = 'workshop' WHERE kind IS NULL;
ALTER TABLE projects ALTER COLUMN kind SET NOT NULL;

-- 两个闭集。DROP-then-ADD 而不是 IF NOT EXISTS：重放时要收敛到**当前**定义，
-- 而不是保留一个旧的同名约束。
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD  CONSTRAINT projects_status_check
  CHECK (status IN ('active', 'archived'));

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_kind_check;
ALTER TABLE projects ADD  CONSTRAINT projects_kind_check
  CHECK (kind IN ('workshop', 'research_project', 'user_insight'));

-- 复合外键的靶子。UNIQUE(id, kind) 在 id 已是主键时逻辑上是冗余的，
-- 但 PostgreSQL 要求外键指向一个**被唯一约束覆盖的列组**，所以它是 I-P34 的必要零件。
-- 同理 UNIQUE(id, org_id)：子表的 org_id 要能被外键钉在**同一个容器的** org 上。
--
-- ⚠ 这两条**不能**照上面的 DROP-then-ADD 写。三张子表的复合外键依赖它们，
--   重放时 DROP 直接报 `cannot drop constraint ... because other objects depend on it`
--   （实测：migrate:check 的强制重放当场失败）。加 CASCADE 更糟——那会把三条复合外键
--   一起删掉，然后 ADD 只把唯一约束加回来，I-P34 的互斥**静默消失**而所有断言仍然全绿，
--   因为断言跑在首次迁移的库上。⇒ 只在缺失时创建。
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'projects_id_kind_uniq' AND conrelid = 'projects'::regclass
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_id_kind_uniq UNIQUE (id, kind);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'projects_id_org_uniq' AND conrelid = 'projects'::regclass
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_id_org_uniq UNIQUE (id, org_id);
  END IF;
END $$;

COMMENT ON COLUMN projects.kind IS
  'F116 / U-9 A: 判别列。与被否决的 Q-12 候选 A 形似而不同——候选 A 的 kind 是行为分支'
  '（一张表两条代码路径），这里的 kind 只回答「这个容器是什么」，行为住在三张子类型表里。';

/* ═══════════════ 二、三张 1:1 子类型表 ═══════════════ */

-- 三张表同形，差别只有 `kind` 的常量。**行为字段不在本 feature 的范围里**：
-- 议程环节（F118）、蓝本引用（F23）、成员模型（F128）各自往对应子表加列，
-- 而它们加在**子表**上这件事本身就是 Q-12 裁决 C 的落地形状。
--
-- 每张表都带 `org_id`（I-P36）：`kernel_tenant_table_audit()` 从 pg_catalog 推导租户表，
-- 没有 org_id 的新表会被判成 `UNTENANTED_BUT_GRANTED`，`verify-rls.sh` 当场变红。
--
-- ⚠ `FOREIGN KEY (id, org_id) REFERENCES projects (id, org_id)`：
--   光有 `org_id REFERENCES organizations(id)` 只能保证「指向某个存在的组织」，
--   保证不了「指向**这个容器所属的**组织」。两者不一致时子行会出现在**另一个租户**的
--   RLS 视野里 —— 那是一个真实的跨租户洞，而 I-P36 那条断言（表在审计里判 ok）
--   完全看不见它。复合外键是零成本的声明式补法。
CREATE TABLE IF NOT EXISTS workshops (
  id     text PRIMARY KEY,
  kind   text NOT NULL DEFAULT 'workshop' CHECK (kind = 'workshop'),
  org_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  FOREIGN KEY (id, kind)   REFERENCES projects (id, kind)   ON DELETE CASCADE,
  FOREIGN KEY (id, org_id) REFERENCES projects (id, org_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_projects (
  id     text PRIMARY KEY,
  kind   text NOT NULL DEFAULT 'research_project' CHECK (kind = 'research_project'),
  org_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  FOREIGN KEY (id, kind)   REFERENCES projects (id, kind)   ON DELETE CASCADE,
  FOREIGN KEY (id, org_id) REFERENCES projects (id, org_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_insights (
  id     text PRIMARY KEY,
  kind   text NOT NULL DEFAULT 'user_insight' CHECK (kind = 'user_insight'),
  org_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  FOREIGN KEY (id, kind)   REFERENCES projects (id, kind)   ON DELETE CASCADE,
  FOREIGN KEY (id, org_id) REFERENCES projects (id, org_id) ON DELETE CASCADE
);

/* ═══════════════ 三、RLS：三张新表入网（I-P36） ═══════════════ */

ALTER TABLE workshops         ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshops         FORCE  ROW LEVEL SECURITY;
ALTER TABLE research_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_projects FORCE  ROW LEVEL SECURITY;
ALTER TABLE user_insights     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_insights     FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workshops_tenant ON workshops;
CREATE POLICY workshops_tenant ON workshops
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS research_projects_tenant ON research_projects;
CREATE POLICY research_projects_tenant ON research_projects
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS user_insights_tenant ON user_insights;
CREATE POLICY user_insights_tenant ON user_insights
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON workshops         FROM app_rw;
REVOKE ALL ON research_projects FROM app_rw;
REVOKE ALL ON user_insights     FROM app_rw;
-- DELETE 授权是必要的：容器被删除时子行由 ON DELETE CASCADE 带走，但「不提供删除项目」
-- （Q-9）是**接口层**的裁决，不是这里的授权面；归档（F124）走 UPDATE。
GRANT SELECT, INSERT, UPDATE, DELETE ON workshops         TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON research_projects TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_insights     TO app_rw;

-- F22 的停用冻结（三条 RESTRICTIVE 策略）。
--
-- ⚠ 必须显式调用一次，而**不能**指望 0014 自己扫到这三张表：0014 的编号在前，
--   首次跑迁移时它们还不存在。少了这一行的表现是：新库上三张表**没有**冻结，
--   而 F22 的全部断言依旧全绿（它们测的是当时已存在的那些表），
--   只有 `migrate:check` 的强制重放会报「重放后 schema 摘要不一致」。
--   规则本身仍只声明在 0014 —— 在这里抄一遍三条 CREATE POLICY 才是第二份事实源。
SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE workshops IS
  'F116 / Q-12 C: 工作坊。1:1 于 projects，持议程环节与分组，四种项目角色只在这里适用。'
  '(id, kind) 复合外键 + kind CHECK 常量 = 一个容器至多属于一个子类型（I-P34）。';
COMMENT ON TABLE research_projects IS
  'F116 / Q-12 C: 研究项目（研究计划 -> 深度研究）。成员模型见 F128，不复用工作坊四角色。';
COMMENT ON TABLE user_insights IS
  'F116 / Q-12 C: 用户洞察（访谈、问卷）。⚠ 访谈属这一类，不是工作坊——'
  'ui-preview/itv v1 正是因为把工作坊四角色套到访谈上而被推翻。';
