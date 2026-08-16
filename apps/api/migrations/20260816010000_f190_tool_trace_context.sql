-- F190（design-delta `tool-trace-cross-run-context`，人类 2026-08-16 对收窄后的选项作答，
-- PR #1409 签核）：给 F157 的 `agent_run_context_snapshots` 补三列，记录「这次工具调用轨迹
-- 这一层（L1/L2/L3 之外的第四类来源）参与状态 + 实际回喂了几轮、几条 step」。
--
-- 同 F156 的 `l3_retrieval_scope` 一样是最小映射列，不新建表——这一层本身不新建任何采集
-- 机制（`agent_run_steps.kind='tool_call'` 早就在记），只是把「这次组装有没有用上它、用上
-- 了多少」这件可审计的事实接进已有的快照表，遵循该表自己头注写的既有先例
-- （"一份可独立检索的结构化事实 = 一张表，追加列而不是发明第二套记录方式"）。

ALTER TABLE agent_run_context_snapshots
  ADD COLUMN IF NOT EXISTS tool_trace_status text
    CHECK (tool_trace_status IS NULL OR tool_trace_status IN ('ok', 'degraded', 'not_configured')),
  ADD COLUMN IF NOT EXISTS tool_trace_run_count  integer
    CHECK (tool_trace_run_count IS NULL OR tool_trace_run_count >= 0),
  ADD COLUMN IF NOT EXISTS tool_trace_step_count integer
    CHECK (tool_trace_step_count IS NULL OR tool_trace_step_count >= 0);

-- 历史行（本迁移之前写入的快照）这三列是 NULL——它们的 run 确实没有工具轨迹这层参与
-- （F190 落地前 `deps.toolTrace` 从未被注入过），读侧按 `null` 视为 `"not_configured"`
-- 处理（`pg-agent-run-context-snapshot.ts` 的 `toToolTraceStatus`），不回填一个编造的值。

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'agent_run_context_snapshots' AND column_name = 'tool_trace_status'
  ) THEN
    RAISE EXCEPTION 'agent_run_context_snapshots.tool_trace_status did not get created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'agent_run_context_snapshots' AND column_name = 'tool_trace_run_count'
  ) THEN
    RAISE EXCEPTION 'agent_run_context_snapshots.tool_trace_run_count did not get created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'agent_run_context_snapshots' AND column_name = 'tool_trace_step_count'
  ) THEN
    RAISE EXCEPTION 'agent_run_context_snapshots.tool_trace_step_count did not get created';
  END IF;
END
$$;
