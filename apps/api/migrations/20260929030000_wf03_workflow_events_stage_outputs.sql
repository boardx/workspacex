/*
 * WF03（Phase 20 work-stack-foundation）—— 事件日志 workflow_events + 阶段业务产出 workflow_stage_outputs
 * + 实例状态机的库内门（I-10 / I-11 / I-12）。
 *
 * ① workflow_events：每实例 seq 从 1 起严格 +1、无空洞、无重复（I-10）。(instance_id, seq) 主键兜底「无重复」，
 *    触发器 wf_event_seq_contiguous 兜底「无空洞」（seq 必须 = 当前最大 seq + 1）。写入方先对实例行
 *    SELECT … FOR UPDATE，所以同实例的追加是串行的。事件是只追加日志：app_rw 无 UPDATE / DELETE。
 *    SSE 只推已在本表中的行（I-11）。
 * ② workflow_stage_outputs：阶段业务产出（instance_id + stage_id + attempt 唯一，ADR-118 第 4 条）。
 *    checkpoint 只存指向本表的 output_id；projection 只读本表与事件，不读 channel_values（I-8）。
 *    只追加：app_rw 无 UPDATE / DELETE——崩溃恢复重跑同一 attempt 时命中既有行、复用而不改写。
 * ③ workflow_instances：加 updated_at；触发器 wf_instance_state_machine 拒绝终态后的任何状态改写，
 *    且要求 state_version 每次改写严格 +1（I-12）。
 * 两张新表 RLS：本组织可见（app.current_org），FORCE；租户一致复合 FK (instance_id, org_id)。
 */
ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS workflow_events (
  instance_id   text NOT NULL,
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  seq           bigint NOT NULL CHECK (seq >= 1),
  type          text NOT NULL,
  state_version integer NOT NULL CHECK (state_version >= 1),
  stage_id      text NULL,
  reason_code   text NULL,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, seq),
  FOREIGN KEY (instance_id, org_id) REFERENCES workflow_instances (id, org_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS workflow_events_org_instance_idx ON workflow_events (org_id, instance_id, seq);

CREATE OR REPLACE FUNCTION wf_event_seq_contiguous() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  last_seq bigint;
BEGIN
  SELECT coalesce(max(seq), 0) INTO last_seq FROM workflow_events WHERE instance_id = NEW.instance_id;
  IF NEW.seq <> last_seq + 1 THEN
    RAISE EXCEPTION 'workflow event seq % for instance % is not contiguous (last %, I-10)', NEW.seq, NEW.instance_id, last_seq
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS wf_event_seq_contiguous ON workflow_events;
CREATE TRIGGER wf_event_seq_contiguous BEFORE INSERT ON workflow_events
  FOR EACH ROW EXECUTE FUNCTION wf_event_seq_contiguous();

CREATE TABLE IF NOT EXISTS workflow_stage_outputs (
  instance_id text NOT NULL,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  stage_id    text NOT NULL,
  attempt     integer NOT NULL CHECK (attempt >= 1),
  output_id   text NOT NULL UNIQUE,
  label       text NOT NULL,
  content     jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, stage_id, attempt),
  FOREIGN KEY (instance_id, org_id) REFERENCES workflow_instances (id, org_id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION wf_instance_state_machine() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.state_version IS DISTINCT FROM OLD.state_version
    OR NEW.reason_code IS DISTINCT FROM OLD.reason_code THEN
    IF OLD.status IN ('succeeded', 'failed', 'cancelled', 'rejected', 'needs_attention') THEN
      RAISE EXCEPTION 'workflow instance % is terminal (%), status is final (I-12)', OLD.id, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.state_version <> OLD.state_version + 1 THEN
      RAISE EXCEPTION 'workflow instance % state_version must advance by exactly 1 (I-12)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS wf_instance_state_machine ON workflow_instances;
CREATE TRIGGER wf_instance_state_machine BEFORE UPDATE ON workflow_instances
  FOR EACH ROW EXECUTE FUNCTION wf_instance_state_machine();

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workflow_events', 'workflow_stage_outputs']
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
REVOKE ALL ON workflow_events, workflow_stage_outputs FROM app_rw;
GRANT SELECT, INSERT ON workflow_events, workflow_stage_outputs TO app_rw;

SELECT kernel_apply_org_freeze_policies();
