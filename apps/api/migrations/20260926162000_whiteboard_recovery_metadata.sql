CREATE TABLE IF NOT EXISTS whiteboard_checkpoints (
  org_id text NOT NULL, board_id uuid NOT NULL, checkpoint_id uuid NOT NULL,
  version integer NOT NULL CHECK(version=1), epoch integer NOT NULL CHECK(epoch>0),
  seq bigint NOT NULL CHECK(seq BETWEEN 0 AND 9007199254740991), object_key text NOT NULL,
  content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'), byte_size bigint NOT NULL CHECK(byte_size BETWEEN 1 AND 33554432),
  created_by text NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY(org_id,board_id,checkpoint_id),
  FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whiteboard_restore_receipts (
  org_id text NOT NULL, board_id uuid NOT NULL, request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK(length(request_hash)=64), checkpoint_id uuid NOT NULL,
  previous_epoch integer NOT NULL, new_epoch integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,board_id,request_id),
  FOREIGN KEY(org_id,board_id,checkpoint_id) REFERENCES whiteboard_checkpoints(org_id,board_id,checkpoint_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whiteboard_recovery_events (
  org_id text NOT NULL, board_id uuid NOT NULL, event_id uuid NOT NULL,
  event_type text NOT NULL CHECK(event_type IN('CheckpointCreated','BoardRestored')),
  actor_id text NOT NULL, epoch integer NOT NULL, checkpoint_id uuid NOT NULL, event jsonb NOT NULL, occurred_at timestamptz NOT NULL,
  PRIMARY KEY(org_id,board_id,event_id),
  FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
ALTER TABLE whiteboard_checkpoints ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_checkpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_restore_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_restore_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_recovery_events ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_recovery_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_checkpoints_tenant ON whiteboard_checkpoints; CREATE POLICY whiteboard_checkpoints_tenant ON whiteboard_checkpoints USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_restore_receipts_tenant ON whiteboard_restore_receipts; CREATE POLICY whiteboard_restore_receipts_tenant ON whiteboard_restore_receipts USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_recovery_events_tenant ON whiteboard_recovery_events; CREATE POLICY whiteboard_recovery_events_tenant ON whiteboard_recovery_events USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_checkpoints,whiteboard_restore_receipts,whiteboard_recovery_events FROM app_rw;
GRANT SELECT,INSERT ON whiteboard_checkpoints,whiteboard_recovery_events TO app_rw;
GRANT SELECT,INSERT ON whiteboard_restore_receipts TO app_rw;
SELECT kernel_apply_org_freeze_policies();
