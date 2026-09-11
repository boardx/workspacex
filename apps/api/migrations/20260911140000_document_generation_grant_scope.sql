-- issue #3440 —— (skill_name, tool_name) 授权寻址的纯内部字段。
--
-- 只在 `markAwaitingToolPermission` 时写入，`decidePermissionRequest` 写
-- `tool_permission_grants.tool_name` 时读一次（`COALESCE(pending_grant_scope,
-- pending_tool_name)`），绝不投影给 UI —— `pendingApproval.toolName` 仍然读
-- `pending_tool_name` 原样，展示层不受影响（见 `ports.ts` `markAwaitingToolPermission`
-- 的 `grantScope` 字段头注）。
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS pending_grant_scope text NULL;
