/*
 * 深度 S3（#3988）—— 批注下的**回复**：让一条批注变成一段讨论（「同意，用主色」「这里先不改」）。
 *
 * ## 为什么单独一张表
 *
 * 与批注本身同一个理由（见 20260924100000_design_project_comments.sql）：多人并发写。回复挂在批注上、
 * 批注删了回复一起走（ON DELETE CASCADE），但回复自己不改、不单独删——讨论记录只追加。
 *
 * 读按 org 收窄（RLS 与 design_projects 同源），写向全组织开放（同批注）；只授 SELECT / INSERT。
 */
CREATE TABLE IF NOT EXISTS design_project_comment_replies (
  id          text PRIMARY KEY,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id  text NOT NULL REFERENCES design_projects (id) ON DELETE CASCADE,
  comment_id  text NOT NULL REFERENCES design_project_comments (id) ON DELETE CASCADE,
  author_id   text NOT NULL,
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 300),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS design_project_comment_replies_comment_idx
  ON design_project_comment_replies (project_id, comment_id, created_at, id);

ALTER TABLE design_project_comment_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_project_comment_replies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS design_project_comment_replies_org_isolation ON design_project_comment_replies;
CREATE POLICY design_project_comment_replies_org_isolation ON design_project_comment_replies
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- 回复只追加：没有 UPDATE / DELETE（批注删了靠外键级联带走）。
REVOKE ALL ON design_project_comment_replies FROM app_rw;
GRANT SELECT, INSERT ON design_project_comment_replies TO app_rw;

-- F22：组织冻结策略只看得见它运行时已经存在的表。加完租户表要重新应用一次，
-- 否则被停用的组织仍然能写批注（migrate:check 的重放摘要比对抓到的，#4043）。
SELECT kernel_apply_org_freeze_policies();
