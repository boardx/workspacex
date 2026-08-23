-- UX-9 Line D4（rubric D6 / CK-6）：人在环三态——approve/reject 之外新增 edit
-- （人在线修改工具参数后放行）。
--
-- 存储面只加两件事，状态图一条边都不加：
--   · pending_decision 放宽到 ('approve','edit')——edit 与 approve 走**同一条**
--     awaiting_approval → queued 边（20260822120000 的触发器原样适用），executor
--     重新领 run 时据 pending_decision 决定 resume 的决策类型。
--   · pending_edited_args：人改后的**完整**参数对象（JSON 文本）。只在
--     pending_decision='edit' 时有意义；终态后留痕不清（审计：人当时改成了什么）。
--     工具名不另存——edit 不允许换工具（见 contracts 的 decideAgentRun 注释），
--     resume 时沿用 pending_tool_name。

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS pending_edited_args text NULL;

-- 20260822120000 里 pending_decision 的 CHECK 是列内联写法，Postgres 自动命名为
-- <table>_<column>_check。
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_pending_decision_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_pending_decision_check CHECK (
  pending_decision IN ('approve', 'edit') OR pending_decision IS NULL
);

SELECT kernel_apply_org_freeze_policies();
