-- Original object content stays in immutable ObjectStore canonical snapshots.
CREATE TABLE whiteboard_operation_undo(
 org_id text NOT NULL,board_id uuid NOT NULL,operation_id uuid NOT NULL,
 owner_user_id text NOT NULL,undo_id uuid NOT NULL,
 before_epoch integer NOT NULL CHECK(before_epoch>0),before_seq bigint NOT NULL CHECK(before_seq>=0),
 object_key text NOT NULL,content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 byte_size bigint NOT NULL CHECK(byte_size>0),comments jsonb NOT NULL,
 PRIMARY KEY(org_id,board_id,operation_id),UNIQUE(org_id,board_id,undo_id),
 FOREIGN KEY(org_id,board_id,operation_id) REFERENCES whiteboard_operations(org_id,board_id,operation_id) ON DELETE CASCADE
);
ALTER TABLE whiteboard_operation_undo ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_operation_undo FORCE ROW LEVEL SECURITY;
CREATE POLICY whiteboard_operation_undo_tenant ON whiteboard_operation_undo
 USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_operation_undo FROM app_rw;
GRANT SELECT,INSERT ON whiteboard_operation_undo TO app_rw;
CREATE TRIGGER whiteboard_operation_undo_root_guard BEFORE INSERT ON whiteboard_operation_undo
FOR EACH ROW EXECUTE FUNCTION whiteboard_guard_object_root('object_key');
SELECT kernel_apply_org_freeze_policies();
