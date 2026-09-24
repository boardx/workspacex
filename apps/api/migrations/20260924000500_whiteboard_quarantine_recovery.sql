CREATE TABLE IF NOT EXISTS whiteboard_quarantine_recovery_requests (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  board_id uuid NOT NULL,
  request_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  requested_by text NOT NULL,
  session_fingerprint text NOT NULL CHECK (session_fingerprint ~ '^[a-f0-9]{64}$'),
  epoch integer NOT NULL CHECK (epoch > 0),
  pending_count integer NOT NULL CHECK (pending_count BETWEEN 1 AND 200),
  pending_bytes integer NOT NULL CHECK (pending_bytes BETWEEN 1 AND 8388608),
  reason text NOT NULL CHECK (reason IN ('ACCESS_DENIED','FORBIDDEN','PERMISSION_CHANGED','STALE_EPOCH','WRITE_DENIED','ARCHIVED','NOT_FOUND')),
  status text NOT NULL CHECK (status IN ('pending-review','denied')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by text,
  PRIMARY KEY (org_id, requested_by, request_id),
  UNIQUE (org_id, requested_by, receipt_id),
  FOREIGN KEY (org_id, board_id) REFERENCES whiteboards(org_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS whiteboard_quarantine_recovery_board ON whiteboard_quarantine_recovery_requests(org_id, board_id, created_at DESC);
ALTER TABLE whiteboard_quarantine_recovery_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_quarantine_recovery_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_quarantine_recovery_tenant ON whiteboard_quarantine_recovery_requests;
CREATE POLICY whiteboard_quarantine_recovery_tenant ON whiteboard_quarantine_recovery_requests
  USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_quarantine_recovery_requests FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON whiteboard_quarantine_recovery_requests TO app_rw;
SELECT kernel_apply_org_freeze_policies();
