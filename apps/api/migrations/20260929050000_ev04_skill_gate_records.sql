/*
 * Phase 20 EV04 —— 门状态回写 `skill_gate_records`（契约束 `work-eval` domain.md I-2 / I-9 / I-10；
 * ADR-117 门状态回写到可变目录行、ADR-118 #9 评测对象是固定版本）。
 *
 * 只接受门脚本产出的 `WorkGateStatus` 结构整体回写（`POST /admin/skills/catalog/:skillId/gate-status`）；
 * 任何角色不能手改门字段（R5）。按版本一行，新版本初始无记录（「未评测」），旧版本记录保留（A4）：
 * 主键 `(org_id, skill_version_id)`，不是 `(org_id, skill_id)`。
 *
 * 幂等：`(org_id, idempotency_key)` 唯一，同键同摘要重放、同键不同摘要 409——与
 * `skill_catalog_channel_events`（WS03）同一模式。
 *
 * RLS 按 org_id；app_rw 只有 SELECT / INSERT / UPDATE（记录随版本追加，不删除）。
 */
CREATE TABLE IF NOT EXISTS skill_gate_records (
  org_id                  text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  skill_id                text NOT NULL,
  skill_version_id        text NOT NULL,
  subject_version_digest  text NOT NULL CHECK (subject_version_digest ~ '^sha256:[a-f0-9]{64}$'),
  status                  jsonb NOT NULL,
  decided_at              timestamptz NOT NULL,
  written_by              text NOT NULL,
  created_at              timestamptz NOT NULL,
  updated_at              timestamptz NOT NULL,
  PRIMARY KEY (org_id, skill_version_id),
  CONSTRAINT skill_gate_records_entry_fk
    FOREIGN KEY (org_id, skill_id) REFERENCES skill_catalog_entries (org_id, skill_id) ON DELETE CASCADE,
  CONSTRAINT skill_gate_records_version_fk
    FOREIGN KEY (skill_version_id, org_id, skill_id) REFERENCES skill_versions (id, org_id, skill_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS skill_gate_records_skill_idx
  ON skill_gate_records (org_id, skill_id, created_at);

ALTER TABLE skill_gate_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_gate_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS skill_gate_records_tenant ON skill_gate_records;
CREATE POLICY skill_gate_records_tenant ON skill_gate_records
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON skill_gate_records FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON skill_gate_records TO app_rw;

/*
 * 幂等审计（追加式，与 `skill_catalog_channel_events` 同一模式）：`skill_gate_records` 按版本
 * upsert（同一版本可被重新评测后「替换」，见 usecases.md UC-5），因而不能把幂等键放在那张可变表上
 * ——否则第二次回写会覆盖第一次的 idempotency_key 列，导致对第一次请求的重放再也匹配不到。
 * 幂等判定单独落在这张只追加表：`(org_id, idempotency_key)` 唯一，同键同摘要重放、同键不同摘要 409。
 */
CREATE TABLE IF NOT EXISTS skill_gate_writeback_events (
  id                text PRIMARY KEY,
  org_id            text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  skill_id          text NOT NULL,
  skill_version_id  text NOT NULL,
  idempotency_key   text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 255),
  request_digest    text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  actor_id          text NOT NULL,
  created_at        timestamptz NOT NULL,
  CONSTRAINT skill_gate_writeback_events_entry_fk
    FOREIGN KEY (org_id, skill_id) REFERENCES skill_catalog_entries (org_id, skill_id) ON DELETE CASCADE,
  CONSTRAINT skill_gate_writeback_events_idem_uniq UNIQUE (org_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS skill_gate_writeback_events_skill_idx
  ON skill_gate_writeback_events (org_id, skill_id, created_at);

ALTER TABLE skill_gate_writeback_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_gate_writeback_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS skill_gate_writeback_events_tenant ON skill_gate_writeback_events;
CREATE POLICY skill_gate_writeback_events_tenant ON skill_gate_writeback_events
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON skill_gate_writeback_events FROM app_rw;
GRANT SELECT, INSERT ON skill_gate_writeback_events TO app_rw;

SELECT kernel_apply_org_freeze_policies();
