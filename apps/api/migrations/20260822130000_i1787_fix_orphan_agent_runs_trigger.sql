-- issue #1787：修复 20260822120000_da07b_hitl_awaiting_approval.sql 的孤儿函数 bug。
--
-- 该迁移的注释说它"整体重建"了与 20260805190000_i519 同名的触发器函数，实际却把函数名
-- 从 wave2_agent_run_transition 写成了 agent_runs_enforce_status_transition。
-- `CREATE OR REPLACE FUNCTION` 按名字匹配替换：改名不是"重建同一个函数"，而是新建了一个
-- 从未被任何触发器绑定的孤儿函数。真正生效的 `agent_runs_transition_trg` 仍然绑定在旧的
-- `wave2_agent_run_transition` 上，那个函数体不认识 awaiting_approval，于是 DA-07b 承诺的
-- 两条新边（running→awaiting_approval、awaiting_approval→queued）在真实数据库上从未生效。
--
-- 不改历史迁移文件本身（它可能已在某些环境上被记为 applied，原地改内容对那些环境无效，
-- 且违反"不改已应用迁移"的一般纪律）。这里用同一个函数名重新 CREATE OR REPLACE，把
-- DA-07b 的两条新边接到真正被触发器调用的函数上，再删掉孤儿。
--
-- ⚠ 第二个问题：孤儿函数的函数体本身也是错的，不能照抄。它把 writeback 重开分支里的列名
-- 写成了不存在的 `output_text`（本表真实列名是 `model_output`，i519 用的就是这个），
-- 还悄悄丢了 i519 原有的两条前置校验（`NEW.error_code IS NULL`、
-- `NEW.model_output IS NOT NULL`）。因为孤儿函数从未被调用，这个 bug 从未在真实数据库上
-- 触发过；但如果照抄孤儿体重新绑定，会当场炸穿 #519 的 writeback 重试路径
-- （`tests/agent-runtime/no-tool-run-writeback.test.ts`：`record "new" has no field
-- "output_text"`，本次修复过程中实测复现）。
--
-- 这里的合并策略：以 i519 现在真正生效、已被测试覆盖的函数体为基底（一字不改），只把
-- DA-07b 那两条新边接进最后的 OR 链——不照抄孤儿体的其余部分。
CREATE OR REPLACE FUNCTION wave2_agent_run_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  -- #519 的原有分支：字段名与前置校验保持 i519 原文，未被本次改动触碰。
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

-- 孤儿函数没有任何触发器引用它，直接删除。
DROP FUNCTION IF EXISTS agent_runs_enforce_status_transition();
