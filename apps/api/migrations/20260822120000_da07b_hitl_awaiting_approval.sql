-- DA-07b（issue #1749 / rubric D6）：人在环——run 可停在敏感工具调用前等人裁决。
--
-- 「等待人」是一等状态，不是失败：把它记成 failed 是账本撒谎。
-- 状态图新增两条边（其余一条不加）：
--   running            → awaiting_approval   （引擎触发 interrupt）
--   awaiting_approval  → queued              （人批准，重新入队由 executor 领走续跑）
--   awaiting_approval  → failed              （人拒绝；NEW.status='failed' 触发器本就全局放行）
-- queued → awaiting_approval 刻意不放行：中断只可能发生在执行中。

ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_status_check CHECK (
  status IN ('queued','running','writeback_pending','succeeded','failed','awaiting_approval')
);

-- 错误码词表与 contracts 的 AgentRunError 是同一事实（no-tool-run-writeback 的
-- pg_constraint 集合相等测试机械看守）：HITL_REJECTED = 人在环裁决为拒绝的终态码。
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_error_code_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_error_code_check CHECK (
  error_code IS NULL OR error_code IN (
    'HITL_REJECTED',
    'MODEL_PROVIDER_NOT_CONFIGURED', 'SKILL_VERSION_UNAVAILABLE',
    'AGENT_VERSION_UNAVAILABLE', 'MODEL_CALL_FAILED', 'CHAT_WRITEBACK_FAILED',
    'TOOL_LOOP_LIMIT_EXCEEDED'
  )
);

-- 等待裁决的工具调用摘要（AgentRunView.pendingApproval 的存储面）。
-- 只在 awaiting_approval 期间有意义；终态后留痕不清（审计：曾经等过什么批准）。
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS pending_tool_name    text NULL;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS pending_args_summary text NULL;
-- 人批准后置 'approve'，executor 重新领 run 时据此让 provider 走 resume 而非新建 run。
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS pending_decision     text NULL
  CHECK (pending_decision IN ('approve') OR pending_decision IS NULL);

-- 触发器函数整体重建（与 20260805190000_i519 同名函数的后继版本；函数体是单一事实，
-- 这里是它的最新全文，不是补丁）。新增的两条边有注释标出。
CREATE OR REPLACE FUNCTION agent_runs_enforce_status_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'failed'
     AND NEW.status = 'writeback_pending'
     AND OLD.error_code = 'CHAT_WRITEBACK_FAILED' THEN
    IF NEW.output_text IS NOT DISTINCT FROM OLD.output_text
       AND NEW.writeback_attempts = 0
       AND NEW.retry_count = OLD.retry_count + 1 THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'AgentRun % may only reopen from an exhausted Chat writeback, with the stored output '
      'unchanged, the budget reset and the retry generation advanced', OLD.id;
  END IF;

  IF OLD.status IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'AgentRun % is terminal in %, cannot become %', OLD.id, OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'failed'
     OR (OLD.status = 'queued' AND NEW.status = 'running')
     OR (OLD.status = 'running' AND NEW.status = 'writeback_pending')
     OR (OLD.status = 'running' AND NEW.status = 'awaiting_approval')   -- DA-07b：引擎中断
     OR (OLD.status = 'awaiting_approval' AND NEW.status = 'queued')    -- DA-07b：人批准重新入队
     OR (OLD.status = 'writeback_pending' AND NEW.status = 'succeeded') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AgentRun % may not move from % to %', OLD.id, OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;

SELECT kernel_apply_org_freeze_policies();
