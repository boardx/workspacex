/*
 * 深度 S2（#3988）—— 设计项目的**批注**：钉在原型某个节点上的一句意见。
 *
 * ## 为什么进库（R8 时是存在浏览器里的）
 *
 * R8 把批注当成「给 AI 的待办」，交出去就变成对话里的一条消息，所以只存在本机。实际用起来它是
 * 给**人**看的：同事打开同一个项目要看得到、换台电脑要看得到、清一次缓存不能丢。本机存储
 * 做不到任何一条，深度评测 V1 三条全红。
 *
 * ## 为什么是一张表而不是 design_projects 的一列 jsonb
 *
 * 批注是多人并发写的东西：两个人同时各钉一条，jsonb 整列读改写会丢一条（后写的覆盖先写的）。
 * 一行一条就没有这个问题；解决 / 重新打开也只改自己那一行。
 *
 * ## 可见性跟随项目，写权限不跟 owner
 *
 * 读按 org 收窄（与项目同源的 RLS）。写**不**要求是项目 owner——批注的意义就是让不是 owner 的人
 * 也能说话；删除只允许作者或 owner，由用例层判（与参考图同一个纪律：谓词不在两处各判一次）。
 *
 * 字数上限写 CHECK：与契约 `DESIGN_COMMENT_MAX_CHARS`（300）同值，是绕过应用层直接写库时的最后一道；
 * 契约那份是权威，改上限两处一起改。
 */
CREATE TABLE IF NOT EXISTS design_project_comments (
  id          text PRIMARY KEY,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id  text NOT NULL REFERENCES design_projects (id) ON DELETE CASCADE,
  author_id   text NOT NULL,
  node_id     text NOT NULL CHECK (length(node_id) BETWEEN 1 AND 64),
  frame_index integer NOT NULL CHECK (frame_index >= 0),
  label       text NOT NULL DEFAULT '' CHECK (length(label) <= 200),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 300),
  resolved    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 读侧恒按项目取，按写下的先后排（列表编号与画布上的钉号一致，刷新不能换序）。
CREATE INDEX IF NOT EXISTS design_project_comments_project_idx
  ON design_project_comments (project_id, created_at, id);

ALTER TABLE design_project_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_project_comments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS design_project_comments_org_isolation ON design_project_comments;
CREATE POLICY design_project_comments_org_isolation ON design_project_comments
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

/*
 * ⚠ RLS 策略不等于授权（见 20260908150000_uc178_iter13_ref_images.sql 的同一段）：少了 GRANT，
 * 这张表上每一次查询都直接 42501。UPDATE 只用来改 `resolved` / `updated_at`。
 */
REVOKE ALL ON design_project_comments FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON design_project_comments TO app_rw;

-- F22：组织冻结策略只看得见它运行时已经存在的表。加完租户表要重新应用一次，
-- 否则被停用的组织仍然能写批注（migrate:check 的重放摘要比对抓到的，#4043）。
SELECT kernel_apply_org_freeze_policies();
