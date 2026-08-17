-- F960（2026-08-17 delta）：观察/访谈对象表（六列）从「契约已签、零表、零仓储」接上真实
-- Postgres——`updateInterviewSubjects`（F25）编排逻辑早就写好，只是从数据库到浏览器这条
-- 真实路径完全不存在（同 F950/project_topics 那次「静态痕迹 ≠ 动态事实」发现的同一种坑）。
--
-- ⚠ **不叫 `interview_subjects`**：`20260801000000_f97_interview_subjects.sql` 已经用这个
-- 表名装了完全不同的东西——06-itv 束（`interview` bundle）真实的访谈预约/转写领域实体
-- （`Subject`：预约、转写、同意书回流的完整生命周期）。本表是 templates 束「项目筹备页
-- 组卡里的一张表格」，只落**结构与填写**（对象/部门角色/联系方式/背景与要问什么/方式/
-- 状态六列），两者是完全不同的概念，同名会造成「同一个名字两个意思」——本仓已因此栽过
-- 跟头（见 AGENTS.md「同一事实不得声明在两处」）。故显式加 `project_group_` 前缀区分。
--
-- 形状同 F950 的 project_grouping_revision：主表存行本身，独立一张 revision 表按
-- `group_id` 维度做整批乐观锁（同 `updateGrouping`「整批替换，不逐条 diff」的先例——
-- `updateInterviewSubjects` 契约同样是「传整个 subjects 数组」，不是逐条 PATCH）。

CREATE TABLE IF NOT EXISTS project_group_interview_subjects (
  subject_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  group_id   text NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  -- 契约里 subjects 是一个数组、可增删——`position` 只用来在整体替换写入后原样
  -- 回显调用方提交时的顺序，不是业务字段，`InterviewSubject` schema 里没有它。
  position   integer NOT NULL DEFAULT 0,
  name       text NOT NULL DEFAULT '',
  role       text NOT NULL DEFAULT '',
  contact    text NOT NULL DEFAULT '',
  focus      text NOT NULL DEFAULT '',
  method     text NOT NULL DEFAULT '',
  status     text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_group_interview_subjects_group_idx
  ON project_group_interview_subjects (group_id, position);

ALTER TABLE project_group_interview_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_group_interview_subjects FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_group_interview_subjects_tenant ON project_group_interview_subjects;
CREATE POLICY project_group_interview_subjects_tenant ON project_group_interview_subjects
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON project_group_interview_subjects FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_group_interview_subjects TO app_rw;

-- 整批替换的乐观锁版本号——独立一行表，不往主表任何一行加列（同 project_grouping_revision
-- 的理由：一批访谈对象没有天然的「这一行代表整批」，独立按 group_id 记一行最干净）。
CREATE TABLE IF NOT EXISTS project_group_interview_subjects_revision (
  group_id   text PRIMARY KEY REFERENCES groups (id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  revision   text NOT NULL DEFAULT '0',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE project_group_interview_subjects_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_group_interview_subjects_revision FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_group_interview_subjects_revision_tenant ON project_group_interview_subjects_revision;
CREATE POLICY project_group_interview_subjects_revision_tenant ON project_group_interview_subjects_revision
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON project_group_interview_subjects_revision FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON project_group_interview_subjects_revision TO app_rw;

-- 两张新表都带 `project_id`→`projects(id)` 单列外键 与 `org_id`→`organizations(id)`
-- 单列外键，catalog 扫描会自动发现——但「什么时候重新安装」不是自动的（issue #342），
-- 必须在这里显式再调用一次，否则新库首次部署这两张表没有归档/停用冻结。
SELECT kernel_apply_project_archive_policies();
SELECT kernel_apply_org_freeze_policies();
