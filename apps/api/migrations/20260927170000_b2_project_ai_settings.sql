-- 项目中枢 B2-S5（2026-09-27，用户直接交办，#4429）—— 设置页「AI 权限」落库。
--
-- 侧表 `project_ai_settings`：哪些来源允许进入项目大脑（chat / transcript / survey / interview / research）。
-- ⚠ 不动 `projects` 的列集（I-P33，`tests/project/projects-column-set.test.ts` 钉着）——
--   与 `retention_policies`（迁移 20260802000000）同型：每个项目至多一行，没有行 = 默认全部允许，
--   默认值由用例（`application/project/get-project-ai-settings.ts`）给，不写进表里当一行假数据。
-- 复合外键 `(project_id, org_id) → projects (id, org_id)`（同 `project_tags`）：行不可能跨租户挂错项目。
-- 枚举闭集与契约 `ProjectAiSourceKind` 逐字一致；CHECK 只挡「不认识的来源」，去重 / 排序由仓储做。

CREATE TABLE IF NOT EXISTS project_ai_settings (
  project_id      text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  allowed_sources text[] NOT NULL
    CHECK (allowed_sources <@ ARRAY['chat', 'transcript', 'survey', 'interview', 'research']::text[]),
  updated_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, org_id) REFERENCES projects (id, org_id) ON DELETE CASCADE
);

ALTER TABLE project_ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_ai_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_ai_settings_tenant ON project_ai_settings;
CREATE POLICY project_ai_settings_tenant ON project_ai_settings
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON project_ai_settings TO app_rw;

-- 组织停用时的写限制在首次应用时就装上（同 `survey_workspaces` 迁移的做法）。
SELECT kernel_apply_org_freeze_policies();
