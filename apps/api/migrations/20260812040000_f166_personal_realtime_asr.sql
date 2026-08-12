-- F166 / #1050 -- short-lived one-use ASR tickets and idempotent provider usage.
CREATE TABLE IF NOT EXISTS realtime_asr_tickets (
  ticket_hash text PRIMARY KEY CHECK (char_length(ticket_hash)=64),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL,
  transcription_id text NOT NULL,
  capture_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (transcription_id,org_id) REFERENCES personal_transcriptions(id,org_id) ON DELETE CASCADE,
  FOREIGN KEY (capture_id,org_id) REFERENCES recording_sessions(id,org_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS realtime_asr_tickets_expiry_idx ON realtime_asr_tickets(expires_at);
ALTER TABLE realtime_asr_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime_asr_tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS realtime_asr_tickets_tenant ON realtime_asr_tickets;
CREATE POLICY realtime_asr_tickets_tenant ON realtime_asr_tickets
  USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON realtime_asr_tickets FROM app_rw;
GRANT SELECT,INSERT,UPDATE(used_at) ON realtime_asr_tickets TO app_rw;

CREATE TABLE IF NOT EXISTS realtime_asr_usage_events (
  provider_task_id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL,
  capture_id text NOT NULL,
  model text NOT NULL,
  duration_seconds integer NOT NULL CHECK(duration_seconds>=0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (capture_id,org_id) REFERENCES recording_sessions(id,org_id) ON DELETE CASCADE
);
ALTER TABLE realtime_asr_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime_asr_usage_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS realtime_asr_usage_events_tenant ON realtime_asr_usage_events;
CREATE POLICY realtime_asr_usage_events_tenant ON realtime_asr_usage_events
  USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON realtime_asr_usage_events FROM app_rw;
GRANT SELECT,INSERT ON realtime_asr_usage_events TO app_rw;
SELECT kernel_apply_org_freeze_policies();
