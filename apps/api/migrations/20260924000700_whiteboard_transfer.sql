CREATE TABLE IF NOT EXISTS whiteboard_import_receipts (
  org_id text NOT NULL,
  actor_id text NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (length(request_hash)=64),
  board_id uuid NOT NULL,
  source_board_id uuid NOT NULL,
  imported_objects integer NOT NULL CHECK (imported_objects BETWEEN 0 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,actor_id,request_id),
  FOREIGN KEY (org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whiteboard_transfer_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('export','import')),
  object_count integer NOT NULL CHECK (object_count BETWEEN 0 AND 5000),
  source_board_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
ALTER TABLE whiteboard_import_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_import_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_transfer_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_transfer_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_import_receipts_tenant ON whiteboard_import_receipts;
CREATE POLICY whiteboard_import_receipts_tenant ON whiteboard_import_receipts USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_transfer_audit_tenant ON whiteboard_transfer_audit;
CREATE POLICY whiteboard_transfer_audit_tenant ON whiteboard_transfer_audit USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_import_receipts, whiteboard_transfer_audit FROM app_rw;
GRANT SELECT,INSERT ON whiteboard_import_receipts, whiteboard_transfer_audit TO app_rw;
GRANT USAGE,SELECT ON SEQUENCE whiteboard_transfer_audit_id_seq TO app_rw;
SELECT kernel_apply_org_freeze_policies();
