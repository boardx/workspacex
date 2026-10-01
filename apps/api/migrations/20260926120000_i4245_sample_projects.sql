-- #4245 —— 示例项目（backlog E2）的持久标记，供 E1 漏斗区分「引用示例材料」与「引用自己的材料」。
--
-- 为什么不用 `project_tags` 里的「内置示例」标签：标签是用户可编辑的自由文本——用户删掉它，
-- 示例材料就被当成「自己的材料」（虚高 `cited_answer_own_material`）；用户给自己的项目打上它，
-- 自己的材料就被当成示例。价值时刻不能建在用户随手能改的字段上。
-- 为什么不往 `projects` 加列：I-P33 封闭列集（见 `20260816000000_f185_project_tags.sql` 头注）。
--
-- 只由 `ensureSampleProject` 在建出容器后写一次（INSERT … ON CONFLICT DO NOTHING），
-- 没有任何用户可达的写/删路径；项目删除时随复合外键级联。
CREATE TABLE IF NOT EXISTS sample_projects (
  project_id text NOT NULL PRIMARY KEY,
  org_id     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, org_id) REFERENCES projects (id, org_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sample_projects_org_idx ON sample_projects (org_id);

ALTER TABLE sample_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE sample_projects FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sample_projects_tenant ON sample_projects;
CREATE POLICY sample_projects_tenant ON sample_projects
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON sample_projects FROM app_rw;
GRANT SELECT, INSERT ON sample_projects TO app_rw;

-- 存量回填不在这里做：`project_tags` 是 FORCE RLS 的租户表，云上迁移属主没有 BYPASSRLS，
-- 迁移会话里没有 `app.current_org`，一条跨租户的 INSERT … SELECT 会静默读到零行（假绿）。
-- 回填走每次部署都跑的 `scripts/backfill-sample-projects.ts` → `ensureSampleProject`：
-- 已有标签的组织在早返回分支上补写本表（逐组织 `withTenant`）。

SELECT kernel_apply_org_freeze_policies();
