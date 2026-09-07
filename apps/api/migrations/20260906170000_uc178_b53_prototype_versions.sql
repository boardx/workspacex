/*
 * UC-17.8 B5.3 迭代 3 —— `design_project_prototype_versions`：原型画布的版本快照。
 *
 * 契约：`design-workbench.ts` `PrototypeVersion` / `listPrototypeVersions` / `getPrototypeVersion` /
 * `restorePrototypeVersion`。每次 `design_projects.prototype` 被写回（模型整页 / patch / 人恢复）
 * 追加一行：那一刻的 frames + prototype + 来源 + 一句话摘要。
 *
 * append-only（同 chat_messages 的触发器写法）：历史只追加、不改不删；「恢复」是把旧版内容写回项目
 * 再追加一条 source='restore' 的新版本，不是把指针拨回去。项目删除级联删掉它的版本。
 * seq 由应用层在同一事务里 `max(seq)+1` 算出，(org_id, project_id, seq) 唯一。
 */
CREATE TABLE IF NOT EXISTS design_project_prototype_versions (
  id         text PRIMARY KEY,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES design_projects (id) ON DELETE CASCADE,
  seq        integer NOT NULL CHECK (seq > 0),
  source     text NOT NULL CHECK (source IN ('model', 'user', 'restore')),
  summary    text NOT NULL DEFAULT '',
  frames     jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(frames) = 'array'),
  prototype  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(prototype) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, seq)
);

CREATE INDEX IF NOT EXISTS design_project_prototype_versions_project_idx
  ON design_project_prototype_versions (org_id, project_id, seq DESC);

CREATE OR REPLACE FUNCTION dw_prototype_versions_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM design_projects WHERE id = OLD.project_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'design_project_prototype_versions are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS design_project_prototype_versions_append_only_trg ON design_project_prototype_versions;
CREATE TRIGGER design_project_prototype_versions_append_only_trg
  BEFORE UPDATE OR DELETE ON design_project_prototype_versions
  FOR EACH ROW EXECUTE FUNCTION dw_prototype_versions_append_only();

/* ── RLS：per-org（同 design_projects / design_project_chat_messages）；「仅 owner」在仓储 SQL 谓词里 ── */

DO $$
BEGIN
  EXECUTE 'ALTER TABLE design_project_prototype_versions ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE design_project_prototype_versions FORCE ROW LEVEL SECURITY';
END
$$;

DROP POLICY IF EXISTS design_project_prototype_versions_tenant ON design_project_prototype_versions;
CREATE POLICY design_project_prototype_versions_tenant ON design_project_prototype_versions
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON design_project_prototype_versions FROM app_rw;
-- 追加写、只读：没有 UPDATE/DELETE 授权，与触发器双重把关（同 design_project_chat_messages）。
GRANT SELECT, INSERT ON design_project_prototype_versions TO app_rw;

SELECT kernel_apply_org_freeze_policies();
