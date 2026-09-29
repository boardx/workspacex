-- Whiteboard bodies belong in the configured object store. PostgreSQL keeps only the
-- current immutable manifest, sequence metadata and audit/idempotency rows.
ALTER TABLE whiteboard_documents
  ADD COLUMN IF NOT EXISTS manifest_version integer CHECK (manifest_version = 1),
  ADD COLUMN IF NOT EXISTS object_key text,
  ADD COLUMN IF NOT EXISTS content_hash text CHECK (content_hash IS NULL OR length(content_hash)=64),
  ADD COLUMN IF NOT EXISTS byte_size bigint CHECK (byte_size IS NULL OR byte_size BETWEEN 0 AND 33554432);

ALTER TABLE whiteboard_updates
  ADD COLUMN IF NOT EXISTS update_object_key text,
  ADD COLUMN IF NOT EXISTS update_hash text CHECK (update_hash IS NULL OR length(update_hash)=64),
  ADD COLUMN IF NOT EXISTS update_size bigint CHECK (update_size IS NULL OR update_size BETWEEN 0 AND 1048576);

-- New object-backed writes clear these legacy bodies. They stay nullable for rolling
-- upgrades and one-time read-through migration of rows written by an older release.
ALTER TABLE whiteboard_documents ALTER COLUMN snapshot DROP NOT NULL;
ALTER TABLE whiteboard_updates ALTER COLUMN update DROP NOT NULL;

ALTER TABLE whiteboard_documents DROP CONSTRAINT IF EXISTS whiteboard_documents_manifest_complete;
ALTER TABLE whiteboard_documents ADD CONSTRAINT whiteboard_documents_manifest_complete CHECK (
  (object_key IS NULL AND content_hash IS NULL AND byte_size IS NULL AND manifest_version IS NULL AND snapshot IS NOT NULL)
  OR
  (object_key IS NOT NULL AND content_hash IS NOT NULL AND byte_size IS NOT NULL AND manifest_version=1 AND snapshot IS NULL)
);
ALTER TABLE whiteboard_updates DROP CONSTRAINT IF EXISTS whiteboard_updates_manifest_complete;
ALTER TABLE whiteboard_updates ADD CONSTRAINT whiteboard_updates_manifest_complete CHECK (
  (update_object_key IS NULL AND update_hash IS NULL AND update_size IS NULL AND update IS NOT NULL)
  OR
  (update_object_key IS NOT NULL AND update_hash IS NOT NULL AND update_size IS NOT NULL AND update IS NULL)
);

CREATE INDEX IF NOT EXISTS whiteboard_documents_object_ref ON whiteboard_documents(org_id, object_key) WHERE object_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS whiteboard_updates_object_ref ON whiteboard_updates(org_id, update_object_key) WHERE update_object_key IS NOT NULL;
