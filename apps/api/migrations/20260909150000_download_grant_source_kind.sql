-- Existing grants are file-domain grants. New native Agent grants must never fall back
-- to the old domain after their source version is removed. No second token store.
ALTER TABLE download_grants
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'file';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='download_grants_source_kind_check' AND conrelid='download_grants'::regclass) THEN
    ALTER TABLE download_grants ADD CONSTRAINT download_grants_source_kind_check CHECK (source_kind IN ('file','agent'));
  END IF;
END $$;
-- Existing forced tenant RLS, privileges, token indexes and consumption constraints remain unchanged.
