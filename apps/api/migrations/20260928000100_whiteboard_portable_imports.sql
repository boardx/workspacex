CREATE TABLE IF NOT EXISTS whiteboard_portable_imports (
 org_id text NOT NULL,board_id uuid NOT NULL,actor_id text NOT NULL,request_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),epoch integer NOT NULL CHECK(epoch>0),seq bigint NOT NULL CHECK(seq>=0),
 object_count integer NOT NULL CHECK(object_count>0),asset_count integer NOT NULL CHECK(asset_count>=0),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,board_id,actor_id,request_id),FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
ALTER TABLE whiteboard_portable_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_portable_imports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_portable_imports_org ON whiteboard_portable_imports;
CREATE POLICY whiteboard_portable_imports_org ON whiteboard_portable_imports USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_portable_imports FROM app_rw;
GRANT SELECT,INSERT ON whiteboard_portable_imports TO app_rw;
SELECT kernel_apply_org_freeze_policies();
