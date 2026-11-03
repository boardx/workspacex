-- A source-definition fingerprint distinguishes metadata-only package revisions.
-- Existing v1 ledgers retain their original package digest and NULL fingerprint.
ALTER TABLE starter_pack_imports ADD COLUMN IF NOT EXISTS source_definition_digest text
  CHECK(source_definition_digest IS NULL OR source_definition_digest ~ '^[a-f0-9]{64}$');
ALTER TABLE agent_starter_pack_imports ADD COLUMN IF NOT EXISTS source_definition_digest text
  CHECK(source_definition_digest IS NULL OR source_definition_digest ~ '^[a-f0-9]{64}$');

ALTER TABLE starter_pack_imports ADD COLUMN IF NOT EXISTS metadata_only boolean NOT NULL DEFAULT false;
ALTER TABLE agent_starter_pack_imports ADD COLUMN IF NOT EXISTS metadata_only boolean NOT NULL DEFAULT false;
