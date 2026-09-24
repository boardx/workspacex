-- ADR-114 runtime cut-over: blob-primary Boards keep content outside PostgreSQL.
-- Legacy rows remain readable until their first successful collaboration write.
ALTER TABLE whiteboard_documents ALTER COLUMN snapshot DROP NOT NULL;
ALTER TABLE whiteboard_updates ALTER COLUMN update DROP NOT NULL;

ALTER TABLE whiteboard_documents DROP CONSTRAINT IF EXISTS whiteboard_documents_snapshot_check;
ALTER TABLE whiteboard_documents ADD CONSTRAINT whiteboard_documents_snapshot_check
  CHECK (snapshot IS NULL OR octet_length(snapshot) <= 33554432);
ALTER TABLE whiteboard_updates DROP CONSTRAINT IF EXISTS whiteboard_updates_update_check;
ALTER TABLE whiteboard_updates ADD CONSTRAINT whiteboard_updates_update_check
  CHECK (update IS NULL OR octet_length(update) <= 1048576);

-- A manifest is encrypted with the same tenant envelope as checkpoints.  The
-- head therefore pins both the immutable ciphertext object and the canonical
-- plaintext that is permitted to drive recovery.
ALTER TABLE whiteboard_content_heads ADD COLUMN IF NOT EXISTS manifest_plain_digest text;
ALTER TABLE whiteboard_content_heads DROP CONSTRAINT IF EXISTS whiteboard_content_heads_manifest_envelope_check;
ALTER TABLE whiteboard_content_heads ADD CONSTRAINT whiteboard_content_heads_manifest_envelope_check CHECK (
  (storage_kind = 'legacy_pg' AND manifest_plain_digest IS NULL)
  OR
  (storage_kind IN ('dual_write','blob_primary') AND manifest_plain_digest IS NOT NULL AND manifest_plain_digest ~ '^[a-f0-9]{64}$')
);
