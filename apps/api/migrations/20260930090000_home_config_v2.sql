-- 组织首页配置 v2（ad-hoc，Refs #4698 / #4634）：
--   ① 横幅：更多预设 + 自定义 #RRGGBB + 上传图片（新表 org_home_banner_artifacts，
--      形状照 org_avatar_artifacts：对象存储放字节，这里只放指针与校验元数据）。
--   ② 推荐数字人（recommended_agents，最多 6，展示信息快照）。
--   ③ 首页整块内容开关（sections）。
--   ④ 快捷入口上限由 4 放宽到 10（键集合由契约 zod 约束，库里仍是 jsonb）。
--
-- Replayable：全部 IF NOT EXISTS / 先 DROP 后 ADD，migrate:check 会忽略版本表重放每个文件。

ALTER TABLE org_home_configs ADD COLUMN IF NOT EXISTS banner_color text;
ALTER TABLE org_home_configs ADD COLUMN IF NOT EXISTS banner_image_id text;
ALTER TABLE org_home_configs ADD COLUMN IF NOT EXISTS recommended_agents jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE org_home_configs ADD COLUMN IF NOT EXISTS sections jsonb NOT NULL
  DEFAULT '{"recentWork": true, "currentTasks": true}'::jsonb;

-- 预设枚举放宽：旧约束是 20260929120000 里列内联 CHECK 生成的固定名。
ALTER TABLE org_home_configs DROP CONSTRAINT IF EXISTS org_home_configs_banner_preset_check;
ALTER TABLE org_home_configs ADD CONSTRAINT org_home_configs_banner_preset_check CHECK (
  banner_preset IN ('ocean', 'forest', 'sunset', 'midnight', 'rose', 'slate', 'amber', 'violet', 'custom')
);

ALTER TABLE org_home_configs DROP CONSTRAINT IF EXISTS org_home_configs_banner_color_check;
ALTER TABLE org_home_configs ADD CONSTRAINT org_home_configs_banner_color_check CHECK (
  banner_color IS NULL OR banner_color ~ '^#[0-9a-fA-F]{6}$'
);

CREATE TABLE IF NOT EXISTS org_home_banner_artifacts (
  id           text PRIMARY KEY,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  object_key   text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes   integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5 * 1024 * 1024),
  sha256       text NOT NULL,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_home_banner_artifacts_org_idx ON org_home_banner_artifacts (org_id);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_home_banner_artifacts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      t || '_tenant', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
  END LOOP;
END
$$;

SELECT kernel_apply_org_freeze_policies();
