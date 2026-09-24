-- Ephemeral, read-only meeting-room access. Pairing codes and bearer grants are stored only as hashes.
CREATE TABLE IF NOT EXISTS whiteboard_room_pairings (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  board_id uuid NOT NULL,
  created_by text NOT NULL,
  request_id uuid NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, created_by, request_id),
  FOREIGN KEY (org_id, board_id) REFERENCES whiteboards(org_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whiteboard_room_pairing_attempts (
  org_id text NOT NULL,
  pairing_id uuid NOT NULL,
  source_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1000),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, pairing_id, source_hash),
  FOREIGN KEY (pairing_id) REFERENCES whiteboard_room_pairings(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whiteboard_room_sessions (
  id uuid PRIMARY KEY,
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  pairing_id uuid NOT NULL,
  presenter_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, board_id) REFERENCES whiteboards(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (pairing_id) REFERENCES whiteboard_room_pairings(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whiteboard_room_viewports (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  session_id uuid NOT NULL,
  x double precision NOT NULL,
  y double precision NOT NULL,
  zoom double precision NOT NULL CHECK (zoom BETWEEN 0.05 AND 8),
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, session_id),
  FOREIGN KEY (session_id) REFERENCES whiteboard_room_sessions(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whiteboard_room_audit (
  id bigserial PRIMARY KEY,
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  session_id uuid,
  actor_id text,
  event text NOT NULL CHECK (event IN ('pairing_created','pairing_joined','viewport_published','session_revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whiteboard_room_pairings_expiry ON whiteboard_room_pairings(org_id, expires_at);
CREATE INDEX IF NOT EXISTS whiteboard_room_sessions_expiry ON whiteboard_room_sessions(org_id, expires_at);
CREATE INDEX IF NOT EXISTS whiteboard_room_audit_board ON whiteboard_room_audit(org_id, board_id, created_at DESC);

ALTER TABLE whiteboard_room_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_room_pairing_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_room_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_room_viewports ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_room_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_room_pairings FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_room_pairing_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_room_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_room_viewports FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_room_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_room_pairings_tenant ON whiteboard_room_pairings;
DROP POLICY IF EXISTS whiteboard_room_pairing_attempts_tenant ON whiteboard_room_pairing_attempts;
DROP POLICY IF EXISTS whiteboard_room_sessions_tenant ON whiteboard_room_sessions;
DROP POLICY IF EXISTS whiteboard_room_viewports_tenant ON whiteboard_room_viewports;
DROP POLICY IF EXISTS whiteboard_room_audit_tenant ON whiteboard_room_audit;
CREATE POLICY whiteboard_room_pairings_tenant ON whiteboard_room_pairings USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
CREATE POLICY whiteboard_room_pairing_attempts_tenant ON whiteboard_room_pairing_attempts USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
CREATE POLICY whiteboard_room_sessions_tenant ON whiteboard_room_sessions USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
CREATE POLICY whiteboard_room_viewports_tenant ON whiteboard_room_viewports USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
CREATE POLICY whiteboard_room_audit_tenant ON whiteboard_room_audit USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_room_pairings, whiteboard_room_pairing_attempts, whiteboard_room_sessions, whiteboard_room_viewports, whiteboard_room_audit FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON whiteboard_room_pairings, whiteboard_room_pairing_attempts, whiteboard_room_sessions, whiteboard_room_viewports, whiteboard_room_audit TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE whiteboard_room_audit_id_seq TO app_rw;
SELECT kernel_apply_org_freeze_policies();
