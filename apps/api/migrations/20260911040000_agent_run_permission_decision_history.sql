-- issue #3302 —— 「这条 run 上已经问过几次授权、上次选了哪档」此前只存在前端组件的
-- `useState` 里，而那个组件的挂载门是 `status === 'awaiting_tool_permission'`：两次中断
-- 之间整段是 `running`，组件被卸载、计数清零，于是 #3212 ② 的提示在同一条 run 的第二次
-- 授权上**永远**不出现。裁决历史是服务端拥有的事实，把它落在拥有它的地方。
--
-- 只加两列、只被 `decidePermissionRequest` 写，不参与任何授权判定（放宽授权必须仍然
-- 只能由 tool_permission_grants 决定）。
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS permission_decision_count integer NOT NULL DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS last_permission_decision text;
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_last_permission_decision_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_last_permission_decision_check
  CHECK (last_permission_decision IS NULL
    OR last_permission_decision IN ('once','run','forever','deny','reject','edit'));
