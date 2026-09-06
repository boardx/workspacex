-- issue #2860 —— API/deep-agent 容器重启时在跑的 run 变幽灵。
--
-- 此前 `agent_runs` 没有任何"这个 run 还活着"的信号：`reclaimStaleRunning` 只能按
-- `started_at` 超 20 分钟判死，且只在同租户下一条消息 kick / 有人读这条 run 时被动触发
-- （RLS FORCE 下没有跨租户扫描）。devapp 2026-09-06 实测：部署重启后 run 停在 `running`，
-- 前端「正在恢复上次未完成的任务…」永远不动。
--
-- 两件事：
-- 1. `heartbeat_at`：执行器在 run 进行中每 15s 写一次（`execute-run.ts` executeQueuedRuns），
--    回收判据改成 `coalesce(heartbeat_at, started_at)` 超阈值——阈值从 20 分钟压到 2 分钟
--    也不会误杀慢 run（慢 run 一直在心跳），进程死了心跳才停。
-- 2. 新终态码 `RUN_INTERRUPTED`：区别于 MODEL_CALL_FAILED（调用本身出错），这是"执行它的
--    进程没了"。同一事实两处机械同步：`packages/contracts/src/wave2-runtime.ts` 的
--    `AgentRunError`，沿用既有迁移 DROP + ADD 累加模式。
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz NULL;

ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_error_code_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_error_code_check CHECK (
  error_code IS NULL OR error_code IN (
    'HITL_REJECTED',
    'MODEL_PROVIDER_NOT_CONFIGURED', 'SKILL_VERSION_UNAVAILABLE',
    'AGENT_VERSION_UNAVAILABLE', 'MODEL_CALL_FAILED', 'CHAT_WRITEBACK_FAILED',
    'TOOL_LOOP_LIMIT_EXCEEDED', 'KERNEL_UNAVAILABLE', 'RUN_INTERRUPTED'
  )
);

ALTER TABLE agent_run_steps DROP CONSTRAINT IF EXISTS agent_run_steps_failure_code_check;
ALTER TABLE agent_run_steps ADD CONSTRAINT agent_run_steps_failure_code_check CHECK (
  failure_code IS NULL OR failure_code IN (
    'MODEL_PROVIDER_NOT_CONFIGURED', 'SKILL_VERSION_UNAVAILABLE',
    'AGENT_VERSION_UNAVAILABLE', 'MODEL_CALL_FAILED', 'CHAT_WRITEBACK_FAILED',
    'TOOL_LOOP_LIMIT_EXCEEDED', 'KERNEL_UNAVAILABLE', 'RUN_INTERRUPTED'
  )
);

-- ## 跨租户回收函数（同 `kernel_read_open_feedback_with_github_issue` 的形状）
--
-- 回收器要在 API 启动/周期性地把**所有组织**里心跳停了的 running 收敛掉，而 `withoutTenant`
-- 在 FORCE ROW LEVEL SECURITY 下对 agent_runs 看到的是空表（20260903130000 那次 worker
-- "看起来在轮询、从没同步过任何东西"的同一个坑）。一个窄得不能再窄的 SECURITY DEFINER
-- 函数：UPDATE 的 WHERE 焊死（status='running' 且心跳/started_at 超阈值），唯一参数是
-- 阈值毫秒数且在函数体内被 GREATEST 到 60 秒——调用方没有把"活 run"判死的空子；只投影
-- 四个标识字段，从不返回 run 的输入正文。EXECUTE 授给 app_rw：这四列在正常租户上下文里
-- app_rw 本来就读得到，去掉的只是"必须先知道 orgId"这个前提。
CREATE OR REPLACE FUNCTION kernel_reclaim_orphaned_agent_runs(threshold_ms integer)
RETURNS TABLE (
  id             text,
  org_id         text,
  thread_id      text,
  remote_run_id  text
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE agent_runs r
     SET status='failed', error_code='RUN_INTERRUPTED', ended_at=now()
   WHERE r.status='running'
     AND coalesce(r.heartbeat_at, r.started_at)
         < now() - (GREATEST(threshold_ms, 60000) || ' milliseconds')::interval
  RETURNING r.id, r.org_id, r.thread_id, r.remote_run_id;
$$;

COMMENT ON FUNCTION kernel_reclaim_orphaned_agent_runs(integer) IS
  'issue #2860 幽灵 run 回收器专用的跨组织 UPDATE。SECURITY DEFINER 绕开 agent_runs 的 '
  'FORCE ROW LEVEL SECURITY；WHERE 焊死（running 且 coalesce(heartbeat_at, started_at) 超阈值），'
  '阈值参数下限 60 秒；只投影 id/org_id/thread_id/remote_run_id。见 sweep-orphaned-runs.ts 头注。';

REVOKE ALL ON FUNCTION kernel_reclaim_orphaned_agent_runs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_reclaim_orphaned_agent_runs(integer) TO app_rw;
