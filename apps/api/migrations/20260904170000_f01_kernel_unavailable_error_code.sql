-- Phase 14 F01 (`kernel-gateway` 契约束，R4 A1 / I-3) -- 网关下发前健康检查未过时的
-- 快速失败终态码。同一事实两处机械同步：`packages/contracts/src/wave2-runtime.ts`
-- 的 `AgentRunError` 加了 `KERNEL_UNAVAILABLE`，这里把两条 CHECK 约束（run 级终态
-- 错误码 + step 级失败码）跟着补上同一个符号，沿用既有迁移（i725/da07b）的
-- DROP + ADD 累加模式，不新开第二种写法。

ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_error_code_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_error_code_check CHECK (
  error_code IS NULL OR error_code IN (
    'HITL_REJECTED',
    'MODEL_PROVIDER_NOT_CONFIGURED', 'SKILL_VERSION_UNAVAILABLE',
    'AGENT_VERSION_UNAVAILABLE', 'MODEL_CALL_FAILED', 'CHAT_WRITEBACK_FAILED',
    'TOOL_LOOP_LIMIT_EXCEEDED', 'KERNEL_UNAVAILABLE'
  )
);

ALTER TABLE agent_run_steps DROP CONSTRAINT IF EXISTS agent_run_steps_failure_code_check;
ALTER TABLE agent_run_steps ADD CONSTRAINT agent_run_steps_failure_code_check CHECK (
  failure_code IS NULL OR failure_code IN (
    'MODEL_PROVIDER_NOT_CONFIGURED', 'SKILL_VERSION_UNAVAILABLE',
    'AGENT_VERSION_UNAVAILABLE', 'MODEL_CALL_FAILED', 'CHAT_WRITEBACK_FAILED',
    'TOOL_LOOP_LIMIT_EXCEEDED', 'KERNEL_UNAVAILABLE'
  )
);
