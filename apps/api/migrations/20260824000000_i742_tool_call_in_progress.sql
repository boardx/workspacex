-- #742 Gap 1（CopilotKit 对标：工具调用「进行中」态）。
--
-- `agent_run_steps` 是账本表，append-only（见 20260805110000_wave2_agent_run_execution.sql
-- 的 `agent_run_steps_append_only_trg` + `GRANT SELECT, INSERT`——没有 UPDATE 路径）。这条
-- 硬约束不动：调用开始时插入一条 `in_progress` 行，调用结束时**再插入一条**同 `tool_call_id`
-- 的终态行，读端（`pg-agent-run-repository.ts` 的 `readRun`）把同一个 `tool_call_id` 的两行
-- 折叠成用户看到的一张卡片——「同一条记录」是逻辑上的（同一次调用），不是物理上的
-- （同一行被原地改写）。见 `AppendedRunStep.toolCallId` 的头注。

ALTER TABLE agent_run_steps ADD COLUMN IF NOT EXISTS tool_call_id text NULL;

-- 与 `wave2Runtime.AgentRunStepStatus` 是同一个事实（zod 枚举 ↔ SQL CHECK，见
-- `AgentRunStepKind`/`AgentRunError` 同款纪律）。
ALTER TABLE agent_run_steps DROP CONSTRAINT IF EXISTS agent_run_steps_status_check;
ALTER TABLE agent_run_steps ADD CONSTRAINT agent_run_steps_status_check
  CHECK (status IN ('succeeded', 'failed', 'in_progress'));

-- `in_progress` 只对工具调用步骤有意义——其余三种 kind 都是同步落地的单次动作，从不经过
-- 一个「已宣布、还没结果」的中间态。
ALTER TABLE agent_run_steps DROP CONSTRAINT IF EXISTS agent_run_steps_in_progress_tool_only_check;
ALTER TABLE agent_run_steps ADD CONSTRAINT agent_run_steps_in_progress_tool_only_check
  CHECK (status <> 'in_progress' OR kind = 'tool_call');

-- `agent_run_steps_failure_shape_check`（同一份迁移原文）此前是逐 status 穷举的 XOR：
-- `succeeded` 必须无码、`failed` 必须有码，两态之外的第三态（`in_progress`）落不进
-- 任何一支，插入直接违反约束——`in_progress` 行还没有结果，同样必须无 `failure_code`，
-- 与 `succeeded` 一样的形状，但原式没把它算进"排他"里。补第三支，其余两支逐字不动。
ALTER TABLE agent_run_steps DROP CONSTRAINT IF EXISTS agent_run_steps_failure_shape_check;
ALTER TABLE agent_run_steps ADD CONSTRAINT agent_run_steps_failure_shape_check CHECK (
  (status = 'failed' AND failure_code IS NOT NULL)
  OR (status = 'succeeded' AND failure_code IS NULL)
  OR (status = 'in_progress' AND failure_code IS NULL)
);
