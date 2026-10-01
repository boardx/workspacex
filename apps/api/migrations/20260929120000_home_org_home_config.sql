/*
 * 组织首页配置 `org_home_configs`（docs/design/org-home-page/README.md 的
 * `OrgHomeConfig` 建议模型；ad-hoc feature，Refs #4634）。
 *
 * 单表、单行主键 `org_id`：一个组织只有一份首页配置。未建行 = 走默认值
 * （由 application 层的 `getHomeConfig` 兜底，不在这里塞一行「默认样例数据」——
 * 2026-09-24 人类指令「取消所有 mockup 数据」同一条纪律）。
 *
 * `quick_actions` / `recommended_capabilities` 存 jsonb：
 *   - quick_actions：最多 4 个真实路由的显示开关/顺序，键是闭合枚举（契约里校验）。
 *   - recommended_capabilities：组织后台从真实 `listAgents`/`listSkills` 里选的
 *     Agent/Skill，每条快照 `name`（保存时那一刻的展示名，不是每次首页渲染都
 *     反查一次 agent/skill 表——避免首页这个任意成员可读的接口间接需要
 *     `listAgents` 的 admin-only 授权面，见 agent-runtime.ts AR13）。
 *
 * RLS 与既有组织级表同一套（org_tool_capability_grants 先例）。
 */
CREATE TABLE IF NOT EXISTS org_home_configs (
  org_id                   text PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  title                    text NOT NULL CHECK (length(title) BETWEEN 1 AND 24),
  tagline                  text CHECK (tagline IS NULL OR length(tagline) <= 80),
  banner_headline          text NOT NULL CHECK (length(banner_headline) BETWEEN 1 AND 60),
  banner_tagline           text NOT NULL CHECK (length(banner_tagline) <= 120),
  banner_preset            text NOT NULL CHECK (banner_preset IN ('ocean', 'forest', 'sunset', 'midnight')),
  quick_actions            jsonb NOT NULL,
  recommended_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by               text NOT NULL,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE org_home_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_home_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_home_configs_tenant ON org_home_configs;
CREATE POLICY org_home_configs_tenant ON org_home_configs
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON org_home_configs FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_home_configs TO app_rw;

SELECT kernel_apply_org_freeze_policies();
