-- Immutable source snapshot for the existing native session lifecycle. No file-byte copy in DB.
ALTER TABLE native_session_bindings ADD COLUMN IF NOT EXISTS input_manifest jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE native_session_bindings ADD COLUMN IF NOT EXISTS input_digest text;
