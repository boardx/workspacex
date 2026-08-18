-- F950（2026-08-16，templates 束 delta）：定题/分组的读侧 + 组员字段。
--
-- ⚠ 契约 `saveAndSyncTopic`/`updateGrouping` 早就签了（F24/F25），但从未落过任何 Postgres
-- 实现——`ProjectTopicRepository`/`GroupingRepository` 此前只有内存假仓储撑着单元测试，
-- controller 也从未挂过路由。本迁移是这条路径第一次真正落库。

-- 一、定题：1:1 upsert，用 project_id 当主键，不另造 topicId。
CREATE TABLE IF NOT EXISTS project_topics (
  project_id text PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  title      text NOT NULL DEFAULT '',
  background text NOT NULL DEFAULT '',
  -- 文本自增版本号（同 revision 惯例：更新一次 +1），并发冲突由
  -- `WHERE revision = $expectedRevision` 更新 0 行触发，不是仓储先读后比较。
  revision   text NOT NULL DEFAULT '0',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE project_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_topics FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_topics_tenant ON project_topics;
CREATE POLICY project_topics_tenant ON project_topics
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON project_topics FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON project_topics TO app_rw;

-- 二、分组：`groups` 表已有 RLS/GRANT（0003-identity.sql 的通用租户表循环），
-- 这里只加两列，不重复声明策略。
ALTER TABLE groups ADD COLUMN IF NOT EXISTS scenario text NOT NULL DEFAULT '';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS status   text NOT NULL DEFAULT 'needs-intervention';

ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_status_check;
ALTER TABLE groups ADD  CONSTRAINT groups_status_check
  CHECK (status IN ('recording-ready', 'short-n', 'needs-intervention'));

-- 三、分组的并发版本号：单独一张一行表，不往 groups/projects 加列——`updateGrouping` 的
-- `expectedRevision` 是**整批分组**的版本，不是单个组的版本，混进 `groups` 表会让
-- 「改一个组」与「整批分组的版本」变成同一件事的两种记法（同一事实两处声明的老问题）。
CREATE TABLE IF NOT EXISTS project_grouping_revision (
  project_id  text PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  group_count integer,
  revision    text NOT NULL DEFAULT '0',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE project_grouping_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_grouping_revision FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_grouping_revision_tenant ON project_grouping_revision;
CREATE POLICY project_grouping_revision_tenant ON project_grouping_revision
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON project_grouping_revision FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON project_grouping_revision TO app_rw;

-- 四、项目归档冻结（issue #342 C 部分门控要求的那一步）。`project_topics` 与
-- `project_grouping_revision` 都有单列外键 `project_id → projects(id)`，是
-- `kernel_project_archive_candidate_tables()` 目录推导会自动认领的表——不需要在那个
-- 函数里显式登记，只需要在建表后重新调用一次安装函数（F124 COMMENT 早就点名过这一步，
-- issue #342 就是因为 F46 忘了调用它）。这也是我们实际想要的行为：项目一旦归档，
-- 定题/分组同样应该转只读，不是只有 `groups` 表被保护而这两张新表是漏网之鱼。
SELECT kernel_apply_project_archive_policies();

-- 五、组织停用冻结（F22）。同上一步同一个理由：两张新表都有单列外键
-- `org_id → organizations(id)`，是 `kernel_apply_org_freeze_policies()` 目录推导会
-- 自动认领的表，建表后必须重新调用一次（F22 的 COMMENT 同样点名过这一步）。
-- `migrate:check` 的 replay 断言正是靠这一步来抓「新表忘了调用安装函数」。
SELECT kernel_apply_org_freeze_policies();
