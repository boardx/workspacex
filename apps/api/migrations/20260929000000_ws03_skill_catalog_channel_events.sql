/*
 * Phase 20 WS03 —— Work Skill 目录通道/后继变更的审计与幂等记录（契约束 `work-skill-meta` R3.9 / R9「审计通道变更者与时间」）。
 *
 * 每次成功的 PATCH /admin/skills/catalog/:skillId 在同一事务内写一行：变更前后通道/后继、门证据、操作者、时间。
 * `(org_id, idempotency_key)` 唯一：同键同请求摘要 → 重放当前行；同键不同摘要 → 409（契约 WORK_SKILL_IDEMPOTENCY_CONFLICT）。
 * 审计只追加：app_rw 仅 SELECT / INSERT。
 */
CREATE TABLE IF NOT EXISTS skill_catalog_channel_events (
  id                  text PRIMARY KEY,
  org_id              text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  skill_id            text NOT NULL,
  idempotency_key     text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 255),
  request_digest      text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  from_channel        text NOT NULL CHECK (from_channel IN ('candidate', 'verified', 'deprecated')),
  to_channel          text NOT NULL CHECK (to_channel IN ('candidate', 'verified', 'deprecated')),
  from_successor_id   text,
  to_successor_id     text,
  gate_evidence_ref   text,
  actor_id            text NOT NULL,
  created_at          timestamptz NOT NULL,
  CONSTRAINT skill_catalog_channel_events_entry_fk
    FOREIGN KEY (org_id, skill_id) REFERENCES skill_catalog_entries (org_id, skill_id) ON DELETE CASCADE,
  CONSTRAINT skill_catalog_channel_events_idem_uniq UNIQUE (org_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS skill_catalog_channel_events_skill_idx
  ON skill_catalog_channel_events (org_id, skill_id, created_at);

ALTER TABLE skill_catalog_channel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_catalog_channel_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS skill_catalog_channel_events_tenant ON skill_catalog_channel_events;
CREATE POLICY skill_catalog_channel_events_tenant ON skill_catalog_channel_events
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON skill_catalog_channel_events FROM app_rw;
GRANT SELECT, INSERT ON skill_catalog_channel_events TO app_rw;

SELECT kernel_apply_org_freeze_policies();
