-- 项目中枢 B2-S1（#4425）：项目资源关联层。
--
-- 问卷 / 深度研究 / 个人转写三类各自的表**没有** `project_id`，也不给它们加：三张表都是「个人聚合」
-- （owner 谓词在各自仓储里），加一列等于把项目归属塞进一个不认识项目的聚合。用一张链接表把
-- 「这个资源挂在这个项目上」记成一条独立事实；访谈（`interview_sessions.project_id`）已有归属，
-- 不走这里。`projects` 列集不动（I-P33）。
--
-- 主键 `(org_id, kind, resource_id)`：一个资源同一时刻只挂一个项目——「挂到 B」= 先从 A 解挂，
-- 不做多对多，读侧才有一条不含歧义的「它属于哪个项目」。
--
-- 只有链接表带外键指向 `projects`：资源那一侧按 `kind` 分三张表，PG 表不了「多态外键」，
-- 资源被删后的悬空行由读侧 JOIN 自然过滤（不出现在列表里），不留脏读。
--
-- 可重放：IF NOT EXISTS / DROP-then-CREATE。

CREATE TABLE IF NOT EXISTS project_resource_links (
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id  text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('survey', 'guided_research', 'personal_transcription')),
  resource_id text NOT NULL,
  linked_by   text NOT NULL,
  linked_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind, resource_id),
  -- 复合外键：项目没了，链接跟着没（资源本身还在，只是回到「不属于任何项目」）。
  FOREIGN KEY (project_id, org_id) REFERENCES projects (id, org_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS project_resource_links_project_idx
  ON project_resource_links (org_id, project_id, linked_at DESC);

ALTER TABLE project_resource_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_resource_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_resource_links_tenant ON project_resource_links;
CREATE POLICY project_resource_links_tenant ON project_resource_links
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON project_resource_links TO app_rw;

-- 组织冻结的写限制在首次 apply 时也装上（同 `survey_workspaces` 迁移）。
SELECT kernel_apply_org_freeze_policies();
