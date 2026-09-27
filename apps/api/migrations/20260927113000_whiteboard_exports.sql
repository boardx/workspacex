CREATE TABLE IF NOT EXISTS whiteboard_exports (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  id uuid NOT NULL,
  actor_id text NOT NULL,
  request_hash text NOT NULL CHECK(length(request_hash)=64),
  epoch integer NOT NULL CHECK(epoch>0),
  seq bigint NOT NULL CHECK(seq>=0),
  object_key text NOT NULL,
  sha256 text NOT NULL CHECK(length(sha256)=64),
  size_bytes bigint NOT NULL CHECK(size_bytes>0),
  file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 255),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,board_id,id),
  UNIQUE(org_id,object_key),
  FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS whiteboard_exports_board ON whiteboard_exports(org_id,board_id,created_at DESC);
DROP TRIGGER IF EXISTS whiteboard_export_root_guard ON whiteboard_exports;
CREATE TRIGGER whiteboard_export_root_guard BEFORE INSERT OR UPDATE OF object_key ON whiteboard_exports FOR EACH ROW EXECUTE FUNCTION whiteboard_guard_object_root('object_key');
CREATE OR REPLACE FUNCTION whiteboard_object_is_rooted(p_org text,p_key text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM whiteboard_documents WHERE org_id=p_org AND object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_updates WHERE org_id=p_org AND update_object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_checkpoints WHERE org_id=p_org AND object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_imports WHERE org_id=p_org AND source_object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_exports WHERE org_id=p_org AND object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_asset_refs WHERE org_id=p_org AND object_key=p_key AND released_at IS NULL AND (state='active' OR lease_expires_at>now()))
$$;
CREATE OR REPLACE FUNCTION whiteboard_object_roots(p_org text) RETURNS TABLE(object_key text,kind text) LANGUAGE sql STABLE AS $$
 SELECT object_key,'document' FROM whiteboard_documents WHERE org_id=p_org AND object_key IS NOT NULL
 UNION SELECT update_object_key,'update' FROM whiteboard_updates WHERE org_id=p_org AND update_object_key IS NOT NULL
 UNION SELECT object_key,'checkpoint' FROM whiteboard_checkpoints WHERE org_id=p_org
 UNION SELECT source_object_key,'import' FROM whiteboard_imports WHERE org_id=p_org
 UNION SELECT object_key,'export' FROM whiteboard_exports WHERE org_id=p_org
 UNION SELECT object_key,'asset' FROM whiteboard_asset_refs WHERE org_id=p_org AND released_at IS NULL AND (state='active' OR lease_expires_at>now())
$$;
ALTER TABLE whiteboard_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_exports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_exports_org ON whiteboard_exports;
CREATE POLICY whiteboard_exports_org ON whiteboard_exports USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_exports FROM app_rw;
GRANT SELECT,INSERT ON whiteboard_exports TO app_rw;
SELECT kernel_apply_org_freeze_policies();
