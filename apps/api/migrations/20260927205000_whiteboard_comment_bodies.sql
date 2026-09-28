-- Forward-compatible lazy migration: legacy JSON remains readable until verified blob publication.
-- New rows retain only comment metadata in payload. Never dual-write plaintext bodies.
ALTER TABLE whiteboard_comment_threads ADD COLUMN IF NOT EXISTS body_object_key text;
ALTER TABLE whiteboard_comment_threads ADD COLUMN IF NOT EXISTS body_hash text;
ALTER TABLE whiteboard_comment_threads ADD COLUMN IF NOT EXISTS body_bytes bigint;
ALTER TABLE whiteboard_comment_threads DROP CONSTRAINT IF EXISTS whiteboard_comment_body_pointer;
ALTER TABLE whiteboard_comment_threads ADD CONSTRAINT whiteboard_comment_body_pointer CHECK (
 (body_object_key IS NULL AND body_hash IS NULL AND body_bytes IS NULL)
 OR (body_object_key IS NOT NULL AND body_hash IS NOT NULL AND body_bytes IS NOT NULL AND body_hash ~ '^[a-f0-9]{64}$' AND body_bytes>0
     AND NOT jsonb_path_exists(payload,'$.comments[*].body'))
);
ALTER TABLE whiteboard_comment_requests ADD COLUMN IF NOT EXISTS response_object_key text;
ALTER TABLE whiteboard_comment_requests ADD COLUMN IF NOT EXISTS response_hash text;
ALTER TABLE whiteboard_comment_requests ADD COLUMN IF NOT EXISTS response_bytes bigint;
ALTER TABLE whiteboard_comment_requests ALTER COLUMN response DROP NOT NULL;
ALTER TABLE whiteboard_comment_requests DROP CONSTRAINT IF EXISTS whiteboard_comment_response_pointer;
ALTER TABLE whiteboard_comment_requests ADD CONSTRAINT whiteboard_comment_response_pointer CHECK (
 (response_object_key IS NULL AND response_hash IS NULL AND response_bytes IS NULL AND response IS NOT NULL)
 OR (response_object_key IS NOT NULL AND response_hash IS NOT NULL AND response_bytes IS NOT NULL AND response_hash ~ '^[a-f0-9]{64}$' AND response_bytes>0 AND response IS NULL)
);
-- Needed only for atomic legacy receipt conversion, not general request mutation.
GRANT UPDATE(response,response_object_key,response_hash,response_bytes) ON whiteboard_comment_requests TO app_rw;
DROP TRIGGER IF EXISTS whiteboard_comment_body_root_guard ON whiteboard_comment_threads;
CREATE TRIGGER whiteboard_comment_body_root_guard BEFORE INSERT OR UPDATE OF body_object_key ON whiteboard_comment_threads FOR EACH ROW EXECUTE FUNCTION whiteboard_guard_object_root('body_object_key');
DROP TRIGGER IF EXISTS whiteboard_comment_response_root_guard ON whiteboard_comment_requests;
CREATE TRIGGER whiteboard_comment_response_root_guard BEFORE INSERT OR UPDATE OF response_object_key ON whiteboard_comment_requests FOR EACH ROW EXECUTE FUNCTION whiteboard_guard_object_root('response_object_key');
CREATE OR REPLACE FUNCTION whiteboard_object_is_rooted(p_org text,p_key text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM whiteboard_documents WHERE org_id=p_org AND object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_updates WHERE org_id=p_org AND update_object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_checkpoints WHERE org_id=p_org AND object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_imports WHERE org_id=p_org AND source_object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_comment_threads WHERE org_id=p_org AND body_object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_comment_requests WHERE org_id=p_org AND response_object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_exports WHERE org_id=p_org AND object_key=p_key)
 OR EXISTS(SELECT 1 FROM whiteboard_asset_refs WHERE org_id=p_org AND object_key=p_key AND released_at IS NULL AND (state='active' OR lease_expires_at>now()))
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
$$;
