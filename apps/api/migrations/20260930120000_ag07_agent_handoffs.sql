/*
 * AG07（Phase 20 work-stack-foundation，契约束 agent-role UC-7 / I-13；CONTRACT §11 `request-handoff`）——
 * Agent 委派 / 转交的聚合 `agent_handoffs`：`requested → confirmed | cancelled | rejected`。
 *
 * 形状单一事实源 = `packages/contracts/src/agent-role.ts` 的 `HandoffPacket` / `HandoffStatus` /
 * `HandoffNotAllowedReason`；写入口一律先过 Zod（`RequestHandoffArgs`），这里的 CHECK 是兜底副本：
 *   - 交接包只允许四个键（问题原文 / 已确认范围 / 证据引用 ID / 未决项）——多一个摘录字段即拒（I-13）；
 *   - 深度 1..2（`CALL_CHAIN_MAX_DEPTH` 的硬上限；是否 ≤ 该 Agent 钉住快照的 maxDepth 由网关判）；
 *   - 请求时冻结的事实（目标角色、交接包、深度、来源 run / 版本 / 发起人）登记后不可改（触发器）。
 * 同一 run 的同一次工具调用只落一行（崩溃恢复重放网关判定时命中唯一键，返回已有行）。
 */
/*
 * 状态机：`request_handoff` 与 AG05 `start_workflow` 同形——网关在服务端完成这次工具调用（判定 + 登记），
 * 以 edit 把结果交回同一个被中断的工具调用（running → queued，pending_decision='edit'）。
 * 本函数其余分支与 20260929140000_ag05_tool_result_requeue.sql 逐字相同，只放宽那一条的工具名。
 */
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
     OR (OLD.status = 'running' AND NEW.status = 'queued' AND NEW.pending_decision = 'edit' AND NEW.pending_edited_args IS NOT NULL AND NEW.pending_tool_name IN ('start_workflow', 'request_handoff'))  -- AG05 / AG07：网关服务端完成工具调用，以 edit 交回结果
     OR (OLD.status = 'awaiting_tool_permission' AND NEW.status = 'queued')    -- 人裁决后重新入队
     OR (OLD.status = 'writeback_pending' AND NEW.status = 'succeeded') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AgentRun % may not move from % to %', OLD.id, OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS agent_handoffs (
  id                      text PRIMARY KEY,
  org_id                  text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  source_run_id           text NOT NULL,
  tool_call_id            text NOT NULL CHECK (length(tool_call_id) BETWEEN 1 AND 255),
  source_thread_id        text NOT NULL,
  source_agent_id         text NOT NULL,
  source_agent_version_id text NOT NULL,
  requester_user_id       text NOT NULL,
  target_role             text NOT NULL CHECK (target_role ~ '^D[0-9]{3}$'),
  target_agent_id         text,
  target_name             text,
  packet                  jsonb NOT NULL CHECK (
    jsonb_typeof(packet) = 'object'
    AND packet ?& ARRAY['originalQuestion', 'confirmedScope', 'evidenceRefs', 'openItems']
    AND (packet - ARRAY['originalQuestion', 'confirmedScope', 'evidenceRefs', 'openItems']) = '{}'::jsonb
    AND jsonb_typeof(packet->'evidenceRefs') = 'array'
    AND jsonb_typeof(packet->'openItems') = 'array'
  ),
  depth                   integer NOT NULL CHECK (depth BETWEEN 1 AND 2),
  status                  text NOT NULL DEFAULT 'requested'
                          CHECK (status IN ('requested', 'confirmed', 'cancelled', 'rejected')),
  not_allowed_reason      text CHECK (not_allowed_reason IS NULL OR not_allowed_reason IN
                          ('target_not_in_allowed_targets', 'target_not_published', 'target_disabled', 'depth_exceeded')),
  new_thread_id           text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  decided_at              timestamptz,
  CONSTRAINT agent_handoffs_one_per_tool_call UNIQUE (org_id, source_run_id, tool_call_id),
  CONSTRAINT agent_handoffs_confirmed_has_thread CHECK ((status = 'confirmed') = (new_thread_id IS NOT NULL)),
  CONSTRAINT agent_handoffs_rejected_has_reason CHECK ((status = 'rejected') = (not_allowed_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS agent_handoffs_source_thread_idx
  ON agent_handoffs (org_id, source_thread_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS agent_handoffs_new_thread_uidx
  ON agent_handoffs (org_id, new_thread_id) WHERE new_thread_id IS NOT NULL;

/* 冻结：请求时判定所依据的事实登记后不可改；状态只能从 requested 出发转移一次。 */
CREATE OR REPLACE FUNCTION agent_handoffs_frozen_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.source_run_id IS DISTINCT FROM OLD.source_run_id
     OR NEW.tool_call_id IS DISTINCT FROM OLD.tool_call_id
     OR NEW.source_thread_id IS DISTINCT FROM OLD.source_thread_id
     OR NEW.source_agent_id IS DISTINCT FROM OLD.source_agent_id
     OR NEW.source_agent_version_id IS DISTINCT FROM OLD.source_agent_version_id
     OR NEW.requester_user_id IS DISTINCT FROM OLD.requester_user_id
     OR NEW.target_role IS DISTINCT FROM OLD.target_role
     OR NEW.packet IS DISTINCT FROM OLD.packet
     OR NEW.depth IS DISTINCT FROM OLD.depth
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'agent_handoffs frozen fields are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'requested' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'agent_handoffs status already decided' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS agent_handoffs_frozen_trg ON agent_handoffs;
CREATE TRIGGER agent_handoffs_frozen_trg BEFORE UPDATE ON agent_handoffs
  FOR EACH ROW EXECUTE FUNCTION agent_handoffs_frozen_guard();

ALTER TABLE agent_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_handoffs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_handoffs_tenant ON agent_handoffs;
CREATE POLICY agent_handoffs_tenant ON agent_handoffs
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON agent_handoffs FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON agent_handoffs TO app_rw;

SELECT kernel_apply_org_freeze_policies();
