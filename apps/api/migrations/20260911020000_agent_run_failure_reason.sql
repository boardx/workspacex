-- issue #3211 ① —— 「run 为什么失败」的持久化载体。
--
-- `agent_runs.error_code` 只说「哪一类终态」；`MODEL_CALL_FAILED` 一个码同时承载
-- 「模型返回空」「远端 run 报错」「远端超时」「我们自己的执行器抛异常」——四件
-- 可行动性完全不同的事，在产品里不可分辨。真实成因此前只存在于 API 进程日志里
-- （`execute-run.ts` 的 catch 注释：`detail` never reaches a response）。
--
-- ⚠ 只存有界枚举，不存 provider 原话（原话可能含 prompt 片段/上游正文）。
-- 取值集合与 `packages/contracts/src/wave2-runtime.ts` 的 `AgentRunFailureReason`
-- 是同一件事，由 `tests/agent-run/run-failure-reason.test.ts` 读 pg_constraint 钉住。
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS failure_reason text;

ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_failure_reason_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_failure_reason_check CHECK (
  failure_reason IS NULL OR failure_reason IN (
    'provider_returned_empty',
    'provider_rejected',
    'provider_timeout',
    'provider_transport_failed',
    'run_reaped',
    'runtime_unavailable',
    'executor_defect',
    'unknown'
  )
);
