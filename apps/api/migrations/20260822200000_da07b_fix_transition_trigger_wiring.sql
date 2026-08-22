-- DA-07b 修复（backend-gates 2026-08-22 红灯的根因，两个问题一次修）：
--
-- ① 真 bug：20260822120000 用新名字 CREATE 了 agent_runs_enforce_status_transition()，
--    但 agent_runs 的触发器 agent_runs_transition_trg 一直指向旧函数
--    wave2_agent_run_transition()（20260805110000 建立）——新函数是孤儿，
--    awaiting_approval 的两条新边在 DB 层从未生效。running → awaiting_approval
--    会被旧函数体 RAISE 拒绝。
-- ② 守卫误伤即救命：tests/kernel/snapshot-no-edit-no-delete.test.ts 的删除逃生口
--    扫描（ILIKE '%force%'）命中了孤儿函数名里的 en"force"，把 backend-gates 拦红
--    ——误伤了名字，却恰好暴露了 ①。守卫语义不放宽，改我们的命名。
--
-- 修法：函数体以**旧名**重建（触发器已指它，无需动触发器），孤儿函数删除。
--
-- ⚠ 函数体 = 20260805190000_i519 现行版**逐字原文 + 恰好两行新边**，绝不重写。
-- 第一版修复曾照抄 20260822120000 的函数体，结果 #519 retry 测试 6 连红——那份
-- 函数体是凭记忆重写的（列名写成不存在的 output_text，真实列是 model_output；
-- 丢了 NEW.error_code IS NULL 等 reopen 前置条件），因为触发器从未指向它，错误
-- 从未被执行过，测试一直绿。「同一事实第二份声明」的运行时版本：第二份不仅漂移，
-- 还因为没接线而躲过了所有验证。

DROP FUNCTION IF EXISTS agent_runs_enforce_status_transition();

CREATE OR REPLACE FUNCTION wave2_agent_run_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  -- #519's single new edge, gated on every precondition rather than on the caller's care.
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
