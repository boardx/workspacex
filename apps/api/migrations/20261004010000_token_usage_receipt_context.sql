-- Additive metadata only: no quota defaults, backfill, RLS/grant changes or production execution.
-- Legacy totals remain legacy: historical zero cannot establish whether usage was reported.
ALTER TABLE token_usage_events ADD COLUMN IF NOT EXISTS total_source text NOT NULL DEFAULT 'legacy';
ALTER TABLE token_usage_events ADD COLUMN IF NOT EXISTS project_id text NULL;
ALTER TABLE token_usage_events ADD COLUMN IF NOT EXISTS thread_id text NULL;
ALTER TABLE token_usage_events ADD COLUMN IF NOT EXISTS agent_id text NULL;
ALTER TABLE token_usage_events ADD COLUMN IF NOT EXISTS call_purpose text NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'token_usage_total_source_check'
    AND conrelid = 'token_usage_events'::regclass) THEN
    ALTER TABLE token_usage_events ADD CONSTRAINT token_usage_total_source_check
      CHECK (total_source IN ('legacy', 'reported', 'unknown'));
  END IF;
END $$;
-- The existing primary key is the receipt id. Retries use INSERT ON CONFLICT DO NOTHING,
-- preserving append-only accounting and the existing tenant policy.
