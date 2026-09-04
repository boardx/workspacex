-- F05 (`streaming-transport` 契约束 R4 E4；design-signoff 2026-09-04T19:21:52Z，
-- usamshen 已确认覆盖 F03/F04/F05) —— 放开「一条用户消息只能对应一个 run」约束的落点。
--
-- ⚠ 不碰 `agent_runs` 的 `UNIQUE (org_id, input_message_id)`（#415）——那条约束是
-- 「一条人类消息至多执行一次」的保证，coord-main 已经在 #519 上明确裁定它优先于
-- 任何想往 `agent_runs` 里塞第二行的措辞（见 `20260805190000_i519_agent_run_retry.sql`
-- 头注；`no-tool-run-writeback.test.ts` 的
-- "keeps the input-message uniqueness the reset exists to protect" 机械钉死了它还在）。
--
-- F05 走的是不同的口子：`agent_runs` 一行仍然是唯一的「逻辑 run」，`input_message_id`
-- 依旧只映射到那一个 `agent_runs.id`——旧约束原样成立，旧约束保护的场景（`accept()`
-- 的幂等重放、`page()` 的 run 状态投影、#519 的重开边）一个都没被动。「一个逻辑 run
-- 多次续跑」体现为**这张新表**按 `run_id` 递增的 `attempt_seq`：断线后从 checkpoint
-- 恢复执行时 append 一行，而不是覆盖/新建 `agent_runs` 行。
--
-- `messageId` 不在本表冗余存储——它是 `agent_runs.input_message_id` 的投影，
-- 查询走 JOIN（同 `pg-agent-run-repository.ts` 头注点名的「`resultMessageId` 只
-- PROJECT，不第二次存储」纪律，这类重复已经在本仓库漂移过五次）。
--
-- 只 append，不更新：续跑记录是历史事实，第二次尝试永远是新的一行，不是覆盖第一次
-- （同 `agent_run_steps` 的既有先例）。
CREATE TABLE IF NOT EXISTS agent_run_attempts (
  id                          text PRIMARY KEY,
  org_id                      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  run_id                      text NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
  -- 同一逻辑 run 的续跑序号，从 1 开始。
  attempt_seq                 integer NOT NULL CHECK (attempt_seq >= 1),
  -- 首次执行为 NULL；断线后从 checkpoint 恢复的续跑携带上一次留下的 checkpoint id
  -- （R4 E4，与 `packages/contracts/src/kernel-gateway.ts` 的
  -- `ForwardRunInput.resumeFromCheckpointId` 是同一个事实的两处消费者，不是两份定义）。
  resumed_from_checkpoint_id  text NULL,
  -- 与 `packages/contracts/src/streaming-transport.ts` 的 `AgentKernelRunStatus` 是
  -- 同一份事实的机械投影——那个 zod 枚举是单一事实源，这里只镜像取值集合；
  -- `tests/agent-run/message-multi-run.test.ts` 读 `pg_constraint` 断言两边集合相等。
  status                      text NOT NULL CHECK (status IN (
    'queued', 'running', 'awaiting_plan_confirmation', 'awaiting_tool_permission',
    'paused', 'succeeded', 'failed', 'cancelled'
  )),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_run_attempts_seq_uniq UNIQUE (org_id, run_id, attempt_seq)
);

CREATE INDEX IF NOT EXISTS agent_run_attempts_run_idx
  ON agent_run_attempts (org_id, run_id, attempt_seq);

CREATE OR REPLACE FUNCTION f05_agent_run_attempts_append_only() RETURNS trigger AS $$
BEGIN
  -- 同 `wave2_agent_run_step_append_only`：组织级联删除是生命周期清理，不是调用方
  -- 改写记录。
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AgentRun attempts are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_run_attempts_append_only_trg ON agent_run_attempts;
CREATE TRIGGER agent_run_attempts_append_only_trg BEFORE UPDATE OR DELETE ON agent_run_attempts
  FOR EACH ROW EXECUTE FUNCTION f05_agent_run_attempts_append_only();

ALTER TABLE agent_run_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_run_attempts_tenant ON agent_run_attempts;
CREATE POLICY agent_run_attempts_tenant ON agent_run_attempts
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON agent_run_attempts FROM app_rw;
GRANT SELECT, INSERT ON agent_run_attempts TO app_rw;

SELECT kernel_apply_org_freeze_policies();
