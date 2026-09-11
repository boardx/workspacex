-- issue #3420 —— 「本 run 内都允许」之后同一工具仍被二次拦截的两条真因之一：**网关判定
-- 已授权时没有一条合法的状态边可以让 run 自己继续跑**。
--
-- 内核对每个 L2 工具都会 interrupt（`nativeInterruptOn()`），网关在
-- `tool-permission-gate.ts` 里判定「这次调用已被用户授权」后要让 run 继续——此刻 run
-- 正处于 `running`（它就是在执行中被中断的）。此前那条分支调 `approveAndRequeue`，
-- 而那条 UPDATE 的 WHERE 是 `status='awaiting_tool_permission'`：命中 0 行，返回值被
-- 丢弃，run 停在 `running` 一动不动，直到租约到期被恢复流程捞起、再问用户一次。
--
-- 这里补的是那条本来就缺的边：`running → queued`，且**只有**带着已授权裁决
-- （`pending_decision='approve'`）才允许。没有这个 guard 就等于给状态机开了一个任何
-- 写入方都能用的后门；有它，这条边的语义只能是「网关代替用户按下了那个它已经批准过的
-- 确认」。人裁决那条边（`awaiting_tool_permission → queued`）一个字都不动。
CREATE OR REPLACE FUNCTION wave2_agent_run_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  IF OLD.status = 'failed' AND NEW.status = 'writeback_pending' THEN
    IF OLD.error_code = 'CHAT_WRITEBACK_FAILED'
       AND NEW.error_code IS NULL
       AND NEW.model_output IS NOT NULL
       AND NEW.model_output = OLD.model_output
       AND NEW.writeback_attempts = 0
       AND NEW.retry_count = OLD.retry_count + 1 THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'AgentRun % may only reopen from an exhausted Chat writeback, with the stored output '
      'unchanged, the budget reset and the retry generation advanced', OLD.id;
  END IF;

  IF OLD.status IN ('succeeded', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'AgentRun % is terminal in %, cannot become %', OLD.id, OLD.status, NEW.status;
  END IF;
  IF (NEW.status = 'cancelled' AND OLD.status IN ('queued','running','paused','awaiting_tool_permission') AND NEW.cancel_requested_at IS NOT NULL)
     OR NEW.status = 'failed'
     OR (OLD.status = 'queued' AND NEW.status = 'running')
     OR (OLD.status = 'running' AND NEW.status = 'writeback_pending')
     OR (OLD.status = 'running' AND NEW.status = 'paused' AND NEW.paused_at IS NOT NULL)
     OR (OLD.status = 'paused' AND NEW.status = 'queued' AND NEW.checkpoint_resume AND NEW.paused_at IS NULL)
     OR (OLD.status = 'running' AND NEW.status = 'awaiting_tool_permission')   -- 引擎中断，等人表态
     OR (OLD.status = 'running' AND NEW.status = 'queued' AND NEW.pending_decision = 'approve')  -- issue #3420：已授权，网关代批后自动续跑
     OR (OLD.status = 'awaiting_tool_permission' AND NEW.status = 'queued')    -- 人裁决后重新入队
     OR (OLD.status = 'writeback_pending' AND NEW.status = 'succeeded') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AgentRun % may not move from % to %', OLD.id, OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;
