-- AG05（03-agent-role.md R3 / E3；契约束 agent-role UC-5）—— Agent 经 `start_workflow` 工具请求发起
-- Workflow 时，网关（`tool-permission-gate.ts`）在服务端完成判定与 WF03 start，再把结果作为 **edit
-- resume** 交回同一个被中断的工具调用。此刻 run 正处于 `running`（它就是在执行中被中断的）。
--
-- 既有边只有两条能把 run 从中断处续上：`running → queued` 仅限 `pending_decision='approve'`（#3420：
-- 已授权代批，原样执行），`awaiting_tool_permission → queued`（人裁决）。这里补一条同样收窄的边：
-- `running → queued` 且 `pending_decision='edit'` **并且** 带着服务端算出的 `pending_edited_args`。
-- 没有参数的 edit 仍被拒绝；其余边一个字不动。
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
     OR (OLD.status = 'running' AND NEW.status = 'queued' AND NEW.pending_decision = 'edit' AND NEW.pending_edited_args IS NOT NULL)  -- AG05：网关服务端完成工具调用，以 edit 交回结果
     OR (OLD.status = 'awaiting_tool_permission' AND NEW.status = 'queued')    -- 人裁决后重新入队
     OR (OLD.status = 'writeback_pending' AND NEW.status = 'succeeded') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AgentRun % may not move from % to %', OLD.id, OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;

SELECT kernel_apply_org_freeze_policies();
