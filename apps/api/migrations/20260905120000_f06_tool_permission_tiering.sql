-- Phase 14 F06（`plan-permissions` 契约束 R5/R7/R8；design-signoff 2026-09-04T19:21:52Z，
-- usamshen 已确认覆盖 F06/F07/F08）—— 工具风险分级 + 三档授权存储 + 状态改名落点。
--
-- ## 一、DA-07b 旧状态名 `awaiting_approval` → `awaiting_tool_permission`
--
-- `requirements/03-plan-mode-permissions.md` R8："`awaiting_tool_permission` 是本 phase
-- 唯一的'工具调用需人工表态'状态，取代现状代码中的 `awaiting_approval`（旧名废弃，
-- 语义统一，避免状态机出现两个含义重叠的分支）"。`agent_run_attempts`
-- （`20260905110000_f05_agent_run_attempts.sql`）与 `packages/contracts` 的
-- `AgentKernelRunStatus` 已经在用新名字——本迁移把 `agent_runs` 这张仍在用旧名字的
-- 表同步过去，两边不再有一处新一处旧的分裂状态。
--
-- 不改历史迁移文件本身（`20260822120000`/`20260822130000`/`20260822200000`/
-- `20260823100000` 已应用，原地改内容对已应用环境无效，见 `20260822130000` 头注同一条
-- 纪律）——这里是新的 ALTER/CREATE OR REPLACE，覆盖到当前生效状态。
--
-- 顺序很重要：先迁移存量数据，再收紧 CHECK 约束，否则任何一行仍是旧值就会被新
-- CHECK 直接拒绝。
UPDATE agent_runs SET status = 'awaiting_tool_permission' WHERE status = 'awaiting_approval';

ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_status_check CHECK (
  status IN ('queued','running','writeback_pending','succeeded','failed','awaiting_tool_permission')
);

-- 触发器函数：与 `wave2_agent_run_transition()` 现行版本（`20260822130000` 之后真正
-- 生效的那份）逐字一致，只把两条边里的旧状态名换成新状态名——函数体其余部分不改。
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

  IF OLD.status IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'AgentRun % is terminal in %, cannot become %', OLD.id, OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'failed'
     OR (OLD.status = 'queued' AND NEW.status = 'running')
     OR (OLD.status = 'running' AND NEW.status = 'writeback_pending')
     OR (OLD.status = 'running' AND NEW.status = 'awaiting_tool_permission')   -- 引擎中断，等人表态
     OR (OLD.status = 'awaiting_tool_permission' AND NEW.status = 'queued')    -- 人裁决后重新入队
     OR (OLD.status = 'writeback_pending' AND NEW.status = 'succeeded') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AgentRun % may not move from % to %', OLD.id, OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;

-- ## 二、`pending_decision` 三态 → 四态：新增 `deny`
--
-- UC-6 `decideToolPermission` 的"拒绝"（`deny`）与 approve/edit 走同一条
-- `awaiting_tool_permission → queued` 边（该边已存在，不新增边），只是携带的
-- `pending_decision` 值不同——executor 重新领 run 时据此让 provider 发
-- `resume:{decision:"reject"}`（`decide-tool-permission.ts` 落点），内核收到拒绝结果
-- 后自己调整后续计划，不是判定整个 run 失败（R3 步骤 6）。
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_pending_decision_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_pending_decision_check CHECK (
  pending_decision IN ('approve', 'edit', 'deny') OR pending_decision IS NULL
);

-- ## 三、三档授权存储（R5，domain.md `StandingToolGrant`）
--
-- 一张表两种 scope：
--   · `run`     —— "本次 run 内都允许"，`run_id` 非空，只在该 run 生命周期内被查询
--                  （run 结束后不再被读，不需要显式过期/清理）。
--   · `forever` —— "以后都允许"，`run_id` 为空，组织级、跨 run 生效、无过期。
-- "单次"授权不落这张表——批准发生的那一刻直接放行，见 `tool-permission-grants.ts`
-- 端口自己的文档（I-4：三档互不越界，"单次"因此永远不在这张表里留痕）。
--
-- 两条**部分**唯一索引而不是一条覆盖全列的唯一约束：`run_id` 为 NULL 时（`forever`
-- 行）NULL 在标准唯一约束语义下互不相等，同一个 (org_id, tool_name) 会被允许插入
-- 任意多行——那不是"幂等 upsert"，是重复记录。分场景各自唯一，`forever` 不看
-- `run_id`（本就没有），`run` 看 `run_id`。
CREATE TABLE IF NOT EXISTS tool_permission_grants (
  id                   text PRIMARY KEY,
  org_id               text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  scope                text NOT NULL CHECK (scope IN ('run', 'forever')),
  -- scope='run' 时必须非空；scope='forever' 时必须为空——见下面的 CHECK。
  run_id               text NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
  tool_name            text NOT NULL,
  -- scope='forever' 时是批准人；scope='run' 时批准人已经在这次 run 的裁决记录里
  -- 有留痕（`agent_runs.pending_decision` 的裁决路径），这里不重复存一份。
  granted_by_user_id   text NULL,
  granted_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_permission_grants_scope_run_id_check CHECK (
    (scope = 'run' AND run_id IS NOT NULL) OR (scope = 'forever' AND run_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS tool_permission_grants_run_uniq
  ON tool_permission_grants (org_id, run_id, tool_name) WHERE scope = 'run';
CREATE UNIQUE INDEX IF NOT EXISTS tool_permission_grants_forever_uniq
  ON tool_permission_grants (org_id, tool_name) WHERE scope = 'forever';

ALTER TABLE tool_permission_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_permission_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tool_permission_grants_tenant ON tool_permission_grants;
CREATE POLICY tool_permission_grants_tenant ON tool_permission_grants
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- 只增不改不删：授权记录本身是审计留痕（R9："谁在何时批准了什么需要可审计"），
-- 撤销/管理不在本 phase 范围（R6 不包含）——没有 UPDATE/DELETE 授权即是这个纪律
-- 在权限层面的落地，而不是仅仅"应用代码不调用"。
REVOKE ALL ON tool_permission_grants FROM app_rw;
GRANT SELECT, INSERT ON tool_permission_grants TO app_rw;

SELECT kernel_apply_org_freeze_policies();
