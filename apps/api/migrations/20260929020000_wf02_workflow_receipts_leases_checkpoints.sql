/*
 * WF02（Phase 20 work-stack-foundation）—— 统一 receipt / lease 两张表 + checkpoint schema `langgraph_workflow`。
 *
 * ① workflow_receipts：command / effect 两种 scope 共用 begin/finalize 形状（沿用 guided research 的
 *    fingerprint 语义，domain.md「WorkflowReceipt」）。(org_id, scope, request_key) 唯一（I-6）。
 *    触发器 wf_receipt_immutable：fingerprint 永不改变；finalized 后 stable_response / checkpoint_id 永不改变，
 *    且不能回到 begun（I-7）。effect scope 的 request_key 由 WF04 以 `instanceId/stageId/effectKey` 组成（I-13）。
 * ② workflow_leases：每实例一行（I-16）。获取是 epoch CAS：只在「观察到的 epoch 未变且旧 lease 已过期」时
 *    epoch+1，由 PgWorkflowLeaseStore 的单条 INSERT … ON CONFLICT DO UPDATE … WHERE 完成；
 *    触发器 wf_lease_epoch_monotonic 拒绝任何让 epoch 不前进一步的改写。
 * ③ langgraph_workflow：@langchain/langgraph-checkpoint-postgres 0.1.2 要求的精确 DDL（与
 *    20260815120000 的 langgraph_interview 同形）。运行期只经 checkpointer 工厂访问（I-9）。
 * 两张业务表 RLS：本组织可见（app.current_org），FORCE，app_rw 无 DELETE。
 * ④ 租户一致外键：PG 的 FK 检查绕过 RLS，单列 FK instance_id → workflow_instances(id) 会让他组织用
 *    别人的 instanceId 抢先插 lease（跨租户 DoS）。因此 workflow_instances 加 UNIQUE (id, org_id)，
 *    lease 与 receipt 都以 (instance_id, org_id) 复合 FK 指向它：lease/receipt 的 org 必须等于实例的 org。
 *    receipt.instance_id 可空（command 在实例创建前 begin），MATCH SIMPLE 下 NULL 不检查。
 */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_instances_id_org_key') THEN
    ALTER TABLE workflow_instances ADD CONSTRAINT workflow_instances_id_org_key UNIQUE (id, org_id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS workflow_receipts (
  org_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  scope           text NOT NULL CHECK (scope IN ('command', 'effect')),
  request_key     text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 400),
  fingerprint     text NOT NULL CHECK (length(fingerprint) > 0),
  status          text NOT NULL CHECK (status IN ('begun', 'finalized')),
  instance_id     text NULL,
  checkpoint_id   text NULL,
  stable_response jsonb NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finalized_at    timestamptz NULL,
  PRIMARY KEY (org_id, scope, request_key),
  FOREIGN KEY (instance_id, org_id) REFERENCES workflow_instances (id, org_id) ON DELETE CASCADE,
  CHECK ((status = 'finalized') = (stable_response IS NOT NULL AND finalized_at IS NOT NULL))
);

CREATE OR REPLACE FUNCTION wf_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.scope IS DISTINCT FROM OLD.scope
    OR NEW.request_key IS DISTINCT FROM OLD.request_key OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint THEN
    RAISE EXCEPTION 'workflow receipt % identity/fingerprint is immutable (I-7)', OLD.request_key USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'finalized' AND (NEW.status <> 'finalized'
    OR NEW.stable_response IS DISTINCT FROM OLD.stable_response OR NEW.checkpoint_id IS DISTINCT FROM OLD.checkpoint_id
    OR NEW.instance_id IS DISTINCT FROM OLD.instance_id OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at) THEN
    RAISE EXCEPTION 'workflow receipt % is finalized and immutable (I-7)', OLD.request_key USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS wf_receipt_immutable ON workflow_receipts;
CREATE TRIGGER wf_receipt_immutable BEFORE UPDATE ON workflow_receipts
  FOR EACH ROW EXECUTE FUNCTION wf_receipt_immutable();

CREATE TABLE IF NOT EXISTS workflow_leases (
  instance_id text PRIMARY KEY,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  holder      text NOT NULL CHECK (length(holder) > 0),
  epoch       bigint NOT NULL CHECK (epoch >= 1),
  expires_at  timestamptz NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (instance_id, org_id) REFERENCES workflow_instances (id, org_id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION wf_lease_epoch_monotonic() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.instance_id IS DISTINCT FROM OLD.instance_id OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'workflow lease % identity is immutable (I-16)', OLD.instance_id USING ERRCODE = 'check_violation';
  END IF;
  -- 同一 epoch 内只允许持有者续期/释放（改 expires_at）；换持有者必须 epoch+1。
  IF NOT (NEW.epoch = OLD.epoch + 1 OR (NEW.epoch = OLD.epoch AND NEW.holder = OLD.holder)) THEN
    RAISE EXCEPTION 'workflow lease % epoch must advance by exactly one on takeover (I-16)', OLD.instance_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS wf_lease_epoch_monotonic ON workflow_leases;
CREATE TRIGGER wf_lease_epoch_monotonic BEFORE UPDATE ON workflow_leases
  FOR EACH ROW EXECUTE FUNCTION wf_lease_epoch_monotonic();

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workflow_receipts', 'workflow_leases']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      t || '_tenant', t);
  END LOOP;
END
$$;
REVOKE ALL ON workflow_receipts, workflow_leases FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON workflow_receipts TO app_rw;
GRANT SELECT, INSERT, UPDATE ON workflow_leases TO app_rw;

-- Exact schema required by @langchain/langgraph-checkpoint-postgres 0.1.2 (same DDL as langgraph_interview).
CREATE SCHEMA IF NOT EXISTS langgraph_workflow;
CREATE TABLE IF NOT EXISTS langgraph_workflow.checkpoint_migrations (
  v integer PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS langgraph_workflow.checkpoints (
  thread_id text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  checkpoint_id text NOT NULL,
  parent_checkpoint_id text,
  type text,
  checkpoint jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);
CREATE TABLE IF NOT EXISTS langgraph_workflow.checkpoint_blobs (
  thread_id text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  channel text NOT NULL,
  version text NOT NULL,
  type text NOT NULL,
  blob bytea,
  PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);
CREATE TABLE IF NOT EXISTS langgraph_workflow.checkpoint_writes (
  thread_id text NOT NULL,
  checkpoint_ns text NOT NULL DEFAULT '',
  checkpoint_id text NOT NULL,
  task_id text NOT NULL,
  idx integer NOT NULL,
  channel text NOT NULL,
  type text,
  blob bytea NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);
INSERT INTO langgraph_workflow.checkpoint_migrations(v)
VALUES (0), (1), (2), (3), (4)
ON CONFLICT (v) DO NOTHING;

REVOKE ALL ON SCHEMA langgraph_workflow FROM PUBLIC;
GRANT USAGE ON SCHEMA langgraph_workflow TO app_rw;
REVOKE ALL ON ALL TABLES IN SCHEMA langgraph_workflow FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA langgraph_workflow TO app_rw;

SELECT kernel_apply_org_freeze_policies();
