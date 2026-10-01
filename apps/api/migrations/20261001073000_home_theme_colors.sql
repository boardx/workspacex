-- Optional brand palette; existing organizations retain the default theme.
ALTER TABLE org_home_configs ADD COLUMN IF NOT EXISTS theme_colors jsonb;
ALTER TABLE org_home_configs DROP CONSTRAINT IF EXISTS org_home_theme_colors_object;
ALTER TABLE org_home_configs ADD CONSTRAINT org_home_theme_colors_object
  CHECK (theme_colors IS NULL OR jsonb_typeof(theme_colors) = 'object');
