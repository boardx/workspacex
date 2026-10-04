-- Immutable metadata from the actual trusted extraction producer, never request content.
-- Historical operations remain unproven; [] does not activate quota admission.
ALTER TABLE artifact_embedding_operations ADD COLUMN IF NOT EXISTS input_hashes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE artifact_embedding_operations DROP CONSTRAINT IF EXISTS artifact_embedding_input_hashes_array;
ALTER TABLE artifact_embedding_operations ADD CONSTRAINT artifact_embedding_input_hashes_array
 CHECK(jsonb_typeof(input_hashes)='array');
