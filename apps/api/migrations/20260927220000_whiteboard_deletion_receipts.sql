-- Content stays in the canonical retained objects. This receipt stores integrity
-- metadata and pre-archive comment states, never duplicated object/comment bodies.
CREATE TABLE IF NOT EXISTS whiteboard_deletion_receipts (
 org_id text NOT NULL, board_id uuid NOT NULL, epoch bigint NOT NULL,
 actor_id text NOT NULL, delete_gesture_id text NOT NULL, delete_update_id uuid NOT NULL,
 deletion_seq bigint NOT NULL, proof jsonb NOT NULL, comments jsonb NOT NULL, changes jsonb NOT NULL DEFAULT '[]'::jsonb,
 restored_update_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,board_id,epoch,actor_id,delete_gesture_id),
 FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
ALTER TABLE whiteboard_deletion_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_deletion_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_deletion_receipts_tenant ON whiteboard_deletion_receipts;
CREATE POLICY whiteboard_deletion_receipts_tenant ON whiteboard_deletion_receipts
 USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_deletion_receipts FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON whiteboard_deletion_receipts TO app_rw;
SELECT kernel_apply_org_freeze_policies();
