-- F185（2026-08-16，Q-6① delta）：项目标签。
--
-- ⚠ **不往 `projects` 加列**。`projects` 的列集合是 I-P33 的封闭清单（恰好
-- `{id, org_id, name, status, kind}`，见 `0018-f116-project-supertype-subtypes.sql`
-- 与 `apps/api/tests/project/projects-column-set.test.ts` 三道门）——那道门存在的
-- 全部理由就是挡「下一个人顺手往超类型加一列」，标签同样属于「不是三类容器共用的
-- 身份/组织归属/状态」，不是理由的例外。挂一张独立表，与三张 1:1 子类型表同一形状
-- （复合外键钉死 `(id, org_id)` 一致，不是「指向某个存在的组织」那种弱约束）。
--
-- 与三类子类型表的差别：这里是 1:N（一个项目多个标签），主键是 `(project_id, tag)`
-- 而不是 `project_id` 单列。

CREATE TABLE IF NOT EXISTS project_tags (
  project_id text NOT NULL,
  org_id     text NOT NULL,
  tag        text NOT NULL CHECK (length(tag) BETWEEN 1 AND 40 AND tag = btrim(tag)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, tag),
  FOREIGN KEY (project_id, org_id) REFERENCES projects (id, org_id) ON DELETE CASCADE
);

-- 单项目标签数上限（契约 `PROJECT_TAGS_MAX = 20`，两处必须同值——这里用触发器钉住，
-- 不是只在应用层判一次：应用层的判断可以被绕过（脚本/未来的第二个调用方），
-- 数据库这一侧是最终防线，同 F118「唯一驱动源」用部分唯一索引而不只信应用层的先例）。
CREATE OR REPLACE FUNCTION kernel_project_tags_limit() RETURNS trigger AS $$
BEGIN
  IF (SELECT count(*) FROM project_tags WHERE project_id = NEW.project_id) >= 20 THEN
    RAISE EXCEPTION 'project % already has 20 tags (PROJECT_TAGS_MAX)', NEW.project_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS project_tags_limit ON project_tags;
CREATE TRIGGER project_tags_limit
  BEFORE INSERT ON project_tags
  FOR EACH ROW EXECUTE FUNCTION kernel_project_tags_limit();

CREATE INDEX IF NOT EXISTS project_tags_org_idx ON project_tags (org_id);

ALTER TABLE project_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_tags FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_tags_tenant ON project_tags;
CREATE POLICY project_tags_tenant ON project_tags
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON project_tags FROM app_rw;
-- 整体替换语义（`updateProjectTags`）＝ 一个事务内 DELETE 旧集合 + INSERT 新集合，
-- 不提供 UPDATE：标签没有「改这一条」的操作，只有「换成这一组」。
GRANT SELECT, INSERT, DELETE ON project_tags TO app_rw;
