CREATE TABLE IF NOT EXISTS whiteboard_workshop_controls (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  frozen boolean NOT NULL DEFAULT false,
  hidden_phase_ids text[] NOT NULL DEFAULT '{}',
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  updated_by text,
  updated_at timestamptz,
  PRIMARY KEY (org_id,board_id),
  FOREIGN KEY (org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE,
  CHECK (cardinality(hidden_phase_ids) <= 100)
);
CREATE TABLE IF NOT EXISTS whiteboard_workshop_control_requests (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  actor_id text NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (length(request_hash)=64),
  response_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,board_id,actor_id,request_id),
  FOREIGN KEY (org_id,board_id) REFERENCES whiteboard_workshop_controls(org_id,board_id) ON DELETE CASCADE
);
ALTER TABLE whiteboard_workshop_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_workshop_controls FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_workshop_control_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_workshop_control_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_workshop_controls_tenant ON whiteboard_workshop_controls;
CREATE POLICY whiteboard_workshop_controls_tenant ON whiteboard_workshop_controls USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_workshop_control_requests_tenant ON whiteboard_workshop_control_requests;
CREATE POLICY whiteboard_workshop_control_requests_tenant ON whiteboard_workshop_control_requests USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_workshop_controls,whiteboard_workshop_control_requests FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON whiteboard_workshop_controls TO app_rw;
GRANT SELECT,INSERT ON whiteboard_workshop_control_requests TO app_rw;
SELECT kernel_apply_org_freeze_policies();
