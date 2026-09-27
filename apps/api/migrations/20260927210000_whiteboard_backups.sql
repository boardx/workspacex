-- Backup payloads live in ObjectStore; capture is schema-bounded metadata only.
CREATE TABLE whiteboard_backups (
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, backup_id uuid NOT NULL,
 actor_id text NOT NULL, source_board_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN('preparing','verified','failed_pending_cleanup')),
 capture jsonb NOT NULL CHECK(jsonb_typeof(capture)='object' AND octet_length(capture::text)<=2097152),
 manifest_hash text CHECK(manifest_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,backup_id), CHECK(status<>'verified' OR manifest_hash IS NOT NULL)
);
CREATE TABLE whiteboard_backup_pins (
 org_id text NOT NULL,backup_id uuid NOT NULL,object_key text NOT NULL CHECK(length(object_key) BETWEEN 1 AND 1024),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,backup_id,object_key),FOREIGN KEY(org_id,backup_id) REFERENCES whiteboard_backups(org_id,backup_id) ON DELETE CASCADE
);
CREATE INDEX whiteboard_backup_pin_root ON whiteboard_backup_pins(org_id,object_key);
CREATE TRIGGER whiteboard_backup_pin_root_guard BEFORE INSERT OR UPDATE ON whiteboard_backup_pins FOR EACH ROW EXECUTE FUNCTION whiteboard_guard_object_root('object_key');
CREATE TABLE whiteboard_backup_restores (
 org_id text NOT NULL,restore_id uuid NOT NULL,backup_id uuid NOT NULL,actor_id text NOT NULL,request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL CHECK(status IN('preparing','completed')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,restore_id),FOREIGN KEY(org_id,backup_id) REFERENCES whiteboard_backups(org_id,backup_id) ON DELETE CASCADE
);
CREATE OR REPLACE FUNCTION whiteboard_object_is_rooted(p_org text,p_key text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM whiteboard_documents WHERE org_id=p_org AND object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_updates WHERE org_id=p_org AND update_object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_checkpoints WHERE org_id=p_org AND object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_imports WHERE org_id=p_org AND source_object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_comment_threads WHERE org_id=p_org AND body_object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_comment_requests WHERE org_id=p_org AND response_object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_exports WHERE org_id=p_org AND object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_asset_refs WHERE org_id=p_org AND object_key=p_key AND released_at IS NULL AND (state='active' OR lease_expires_at>now()))
 OR EXISTS(SELECT 1 FROM whiteboard_backup_pins WHERE org_id=p_org AND object_key=p_key)
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
 UNION SELECT object_key,'backup' FROM whiteboard_backup_pins WHERE org_id=p_org
$$;
ALTER TABLE whiteboard_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_backups FORCE ROW LEVEL SECURITY;
CREATE POLICY whiteboard_backups_org ON whiteboard_backups USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_backups FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON whiteboard_backups TO app_rw;
ALTER TABLE whiteboard_backup_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_backup_pins FORCE ROW LEVEL SECURITY;
CREATE POLICY whiteboard_backup_pins_org ON whiteboard_backup_pins USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_backup_pins FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON whiteboard_backup_pins TO app_rw;
ALTER TABLE whiteboard_backup_restores ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_backup_restores FORCE ROW LEVEL SECURITY;
CREATE POLICY whiteboard_backup_restores_org ON whiteboard_backup_restores USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_backup_restores FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON whiteboard_backup_restores TO app_rw;
SELECT kernel_apply_org_freeze_policies();
