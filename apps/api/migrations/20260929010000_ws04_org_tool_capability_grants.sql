/*
 * Phase 20 WS04 —— 组织工具能力分类授权 `org_tool_capability_grants`（就绪性输入，契约束 `work-skill-meta` UC-6）。
 *
 * ADR-120 的 MCP 工具 `capabilityCategory` 打标尚未落地（第 5 轮）；按 requirements/01-skill-catalog.md R10，
 * 本域先以最小表承载「本组织哪个工具提供哪个分类、是否启用、授权是否被拒」。ADR-120 落地后由其工具注册表
 * 取代本表（收敛为单一事实源），就绪性只经 ToolGrantReader 端口读取，换源不动领域/应用层。
 *   · 就绪性不缓存为事实（R7）：本表是授权事实，不是就绪性结果。
 *   · RLS 按 org_id；app_rw 可读写（授权管理面后续接入）。
 */
CREATE TABLE IF NOT EXISTS org_tool_capability_grants (
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  tool_ref    text NOT NULL CHECK (length(tool_ref) BETWEEN 1 AND 255),
  category    text NOT NULL CHECK (category ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$' AND length(category) <= 64),
  enabled     boolean NOT NULL DEFAULT true,
  grant_state text NOT NULL CHECK (grant_state IN ('granted', 'denied')),
  updated_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, tool_ref, category)
);

CREATE INDEX IF NOT EXISTS org_tool_capability_grants_category_idx
  ON org_tool_capability_grants (org_id, category);

ALTER TABLE org_tool_capability_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_tool_capability_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_tool_capability_grants_tenant ON org_tool_capability_grants;
CREATE POLICY org_tool_capability_grants_tenant ON org_tool_capability_grants
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON org_tool_capability_grants FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_tool_capability_grants TO app_rw;

SELECT kernel_apply_org_freeze_policies();
