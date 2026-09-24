CREATE TABLE IF NOT EXISTS whiteboard_miro_oauth_states (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  state_hash text NOT NULL CHECK (length(state_hash)=64),
  return_to text NOT NULL CHECK (return_to LIKE '/studio/board%'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,actor_id,state_hash)
);
CREATE TABLE IF NOT EXISTS whiteboard_miro_credentials (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  sealed_credentials text NOT NULL,
  scopes text[] NOT NULL,
  connected_at timestamptz NOT NULL,
  expires_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  revoked_at timestamptz,
  PRIMARY KEY (org_id,actor_id)
);
CREATE TABLE IF NOT EXISTS whiteboard_miro_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('connected','refreshed','revoked','import_fetched')),
  source_board_id text,
  object_count integer CHECK (object_count BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE whiteboard_miro_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_miro_oauth_states FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_miro_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_miro_credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_miro_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_miro_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_miro_oauth_states_tenant ON whiteboard_miro_oauth_states;
CREATE POLICY whiteboard_miro_oauth_states_tenant ON whiteboard_miro_oauth_states USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_miro_credentials_tenant ON whiteboard_miro_credentials;
CREATE POLICY whiteboard_miro_credentials_tenant ON whiteboard_miro_credentials USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_miro_audit_tenant ON whiteboard_miro_audit;
CREATE POLICY whiteboard_miro_audit_tenant ON whiteboard_miro_audit USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_miro_oauth_states,whiteboard_miro_credentials,whiteboard_miro_audit FROM app_rw;
GRANT SELECT,INSERT,UPDATE,DELETE ON whiteboard_miro_oauth_states,whiteboard_miro_credentials TO app_rw;
GRANT SELECT,INSERT ON whiteboard_miro_audit TO app_rw;
GRANT USAGE,SELECT ON SEQUENCE whiteboard_miro_audit_id_seq TO app_rw;
SELECT kernel_apply_org_freeze_policies();
