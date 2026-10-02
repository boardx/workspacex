-- A published role version freezes both executable verified pins and honest readiness gaps.
-- Historical versions keep their existing pins and gain only the compatible empty default.
ALTER TABLE agent_versions
  ADD COLUMN IF NOT EXISTS pending_skill_bindings jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='agent_versions'::regclass AND conname='agent_versions_pending_skill_bindings_array') THEN
    ALTER TABLE agent_versions ADD CONSTRAINT agent_versions_pending_skill_bindings_array
      CHECK (jsonb_typeof(pending_skill_bindings) = 'array');
  END IF;
END $$;
