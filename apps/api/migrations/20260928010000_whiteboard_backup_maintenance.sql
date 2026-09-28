-- Retain the metadata audit trail; only released backup pins cease to be roots.
ALTER TABLE whiteboard_backup_pins ADD COLUMN released_at timestamptz;
CREATE TABLE whiteboard_backup_maintenance_receipts (
 org_id text NOT NULL,request_id uuid NOT NULL,backup_id uuid NOT NULL,actor_id text NOT NULL,
 action text NOT NULL CHECK(action IN('release-pins','recover-manifest')),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=8192),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(org_id,request_id),
 FOREIGN KEY(org_id,backup_id) REFERENCES whiteboard_backups(org_id,backup_id) ON DELETE CASCADE
);
ALTER TABLE whiteboard_backup_maintenance_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_backup_maintenance_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY whiteboard_backup_maintenance_receipts_org ON whiteboard_backup_maintenance_receipts USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_backup_maintenance_receipts FROM app_rw;
GRANT SELECT,INSERT ON whiteboard_backup_maintenance_receipts TO app_rw;
CREATE OR REPLACE FUNCTION whiteboard_object_is_rooted(p_org text,p_key text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM whiteboard_documents WHERE org_id=p_org AND object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_updates WHERE org_id=p_org AND update_object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_checkpoints WHERE org_id=p_org AND object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_imports WHERE org_id=p_org AND source_object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_comment_threads WHERE org_id=p_org AND body_object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_comment_requests WHERE org_id=p_org AND response_object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_exports WHERE org_id=p_org AND object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_asset_refs WHERE org_id=p_org AND object_key=p_key AND released_at IS NULL AND (state='active' OR lease_expires_at>now()))
 OR EXISTS(SELECT 1 FROM whiteboard_backup_pins WHERE org_id=p_org AND object_key=p_key AND released_at IS NULL)
$$;
CREATE OR REPLACE FUNCTION whiteboard_object_roots(p_org text) RETURNS TABLE(object_key text,kind text) LANGUAGE sql STABLE AS $$
 SELECT object_key,'document' FROM whiteboard_documents WHERE org_id=p_org AND object_key IS NOT NULL
 UNION SELECT update_object_key,'update' FROM whiteboard_updates WHERE org_id=p_org AND update_object_key IS NOT NULL
 UNION SELECT object_key,'checkpoint' FROM whiteboard_checkpoints WHERE org_id=p_org
 UNION SELECT source_object_key,'import' FROM whiteboard_imports WHERE org_id=p_org
 UNION SELECT body_object_key,'comment-body' FROM whiteboard_comment_threads WHERE org_id=p_org AND body_object_key IS NOT NULL
 UNION SELECT response_object_key,'comment-response' FROM whiteboard_comment_requests WHERE org_id=p_org AND response_object_key IS NOT NULL
 UNION SELECT object_key,'export' FROM whiteboard_exports WHERE org_id=p_org
 UNION SELECT object_key,'asset' FROM whiteboard_asset_refs WHERE org_id=p_org AND released_at IS NULL AND (state='active' OR lease_expires_at>now())
 UNION SELECT object_key,'backup' FROM whiteboard_backup_pins WHERE org_id=p_org AND released_at IS NULL
$$;
SELECT kernel_apply_org_freeze_policies();
