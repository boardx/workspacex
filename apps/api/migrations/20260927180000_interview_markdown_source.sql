-- Additive rollout: old artifact writers remain compatible until the workflow switches.
-- A marked source version is immutable; rollback reads retained legacy tables.
ALTER TABLE digital_interview_artifact_versions
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS controlled_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS content_source text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='digital_interview_artifact_versions'::regclass AND conname='interview_markdown_source_shape') THEN
    ALTER TABLE digital_interview_artifact_versions ADD CONSTRAINT interview_markdown_source_shape
      CHECK (content_source IS NULL OR (
        content_source IN ('legacy-migration-v1','markdown-v1') AND
        content_hash IS NOT NULL AND content_hash ~ '^[a-f0-9]{64}$' AND
        jsonb_typeof(controlled_references) = 'array'
      ));
  END IF;
END $$;
