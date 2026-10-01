/*
 * WF04（Phase 20 work-stack-foundation）—— effect-gateway：执行前权限重查 + 崩溃恢复对账（不重放）。
 *
 * ① workflow_receipts.status 从 ('begun','finalized') 扩到再加 'reconciled'/'unresolved'
 *    （domain.md I-14：begun 的 effect receipt 只能迁到这两个终态之一，永不产生第二次外部调用）。
 *    trigger wf_receipt_immutable 同步收紧：三个终态（finalized/reconciled/unresolved）都锁死，
 *    不只锁 finalized——否则 reconciled 之后还能悄悄改回 begun，等于给重放开了后门。
 * ② workflow_capability_grants：执行前权限重查的「ToolExecutionAuthority ∩ MCP sideEffect 封顶」
 *    半条腿（发起人成员资格 / Agent 可运行版本那半条腿复用既有 WorkflowAccessPort，见
 *    effect-permission-recheck.ts 头注）。按 (org, capabilityCategory) 存：是否仍授权、允许的
 *    副作用等级上限。没有配置行 = 组织管理员没配置过 → 保守判，默认只读（`read` 封顶），不继承写
 *    权限（ADR-120 决策 #2）——新能力分类既不因漏配置被误判 blocked，也不会绕过管理员直接拿到写/
 *    外部发送能力。列默认值与 `pg-effect-capability-authority.ts` 的代码默认必须保持一致。
 */
ALTER TABLE workflow_receipts DROP CONSTRAINT IF EXISTS workflow_receipts_status_check;
ALTER TABLE workflow_receipts ADD CONSTRAINT workflow_receipts_status_check
  CHECK (status IN ('begun', 'finalized', 'reconciled', 'unresolved'));

CREATE OR REPLACE FUNCTION wf_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.scope IS DISTINCT FROM OLD.scope
    OR NEW.request_key IS DISTINCT FROM OLD.request_key OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint THEN
    RAISE EXCEPTION 'workflow receipt % identity/fingerprint is immutable (I-7)', OLD.request_key USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('finalized', 'reconciled', 'unresolved') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'workflow receipt % is % and immutable (I-7/I-14)', OLD.request_key, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'finalized' AND (NEW.stable_response IS DISTINCT FROM OLD.stable_response
    OR NEW.checkpoint_id IS DISTINCT FROM OLD.checkpoint_id OR NEW.instance_id IS DISTINCT FROM OLD.instance_id
    OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at) THEN
    RAISE EXCEPTION 'workflow receipt % is finalized and immutable (I-7)', OLD.request_key USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
-- 触发器本身（名字、挂载方式）不变，只重建了函数体；DROP/CREATE TRIGGER 保持 replayable 纪律一致。
DROP TRIGGER IF EXISTS wf_receipt_immutable ON workflow_receipts;
CREATE TRIGGER wf_receipt_immutable BEFORE UPDATE ON workflow_receipts
  FOR EACH ROW EXECUTE FUNCTION wf_receipt_immutable();

CREATE TABLE IF NOT EXISTS workflow_capability_grants (
  org_id               text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  capability_category  text NOT NULL CHECK (length(capability_category) > 0),
  authorized           boolean NOT NULL DEFAULT true,
  side_effect_cap      text NOT NULL DEFAULT 'read'
                         CHECK (side_effect_cap IN ('none', 'read', 'write', 'external_send')),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, capability_category)
);

ALTER TABLE workflow_capability_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_capability_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_capability_grants_tenant ON workflow_capability_grants;
CREATE POLICY workflow_capability_grants_tenant ON workflow_capability_grants
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON workflow_capability_grants FROM app_rw;
GRANT SELECT ON workflow_capability_grants TO app_rw;

SELECT kernel_apply_org_freeze_policies();
