-- Rollout: stop old writers, deploy migration and file-aware repository together.
-- Existing rows migrate under the service's fresh ACL + Board/proposal locks on
-- first access. No SQL conversion can safely publish unverified external bytes.
ALTER TABLE whiteboard_ai_proposals ADD COLUMN object_key text;
ALTER TABLE whiteboard_ai_proposals ADD COLUMN content_hash text;
ALTER TABLE whiteboard_ai_proposals ADD COLUMN byte_size bigint;
-- NOT VALID permits only unchanged legacy rows. Every new INSERT/UPDATE must
-- clear body JSON and publish a verified immutable reference; old writers fail.
ALTER TABLE whiteboard_ai_proposals ADD CONSTRAINT whiteboard_proposal_body_ref CHECK(
 object_key IS NOT NULL AND length(object_key) BETWEEN 1 AND 1024
 AND content_hash IS NOT NULL AND content_hash ~ '^[a-f0-9]{64}$'
 AND byte_size IS NOT NULL AND byte_size BETWEEN 1 AND 33554432
 AND payload='{}'::jsonb
) NOT VALID;
CREATE TRIGGER whiteboard_proposal_root_guard BEFORE INSERT OR UPDATE OF object_key ON whiteboard_ai_proposals FOR EACH ROW EXECUTE FUNCTION whiteboard_guard_object_root('object_key');
-- Reachability uses whiteboard_asset_refs (active, released_at IS NULL), shared
-- by GC mark/sweep and its transaction fence; no override of global root logic.
