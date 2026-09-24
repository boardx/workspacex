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

