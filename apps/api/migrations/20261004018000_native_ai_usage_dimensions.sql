-- Additive original-unit metadata; never converts images/time/characters into Token usage.
ALTER TABLE token_usage_events ADD COLUMN IF NOT EXISTS native_unit text;
ALTER TABLE token_usage_events ADD COLUMN IF NOT EXISTS native_quantity bigint;
ALTER TABLE token_usage_events ADD COLUMN IF NOT EXISTS native_source text;
ALTER TABLE token_usage_events DROP CONSTRAINT IF EXISTS token_usage_total_source_check;
ALTER TABLE token_usage_events ADD CONSTRAINT token_usage_total_source_check CHECK(total_source IN ('legacy','reported','unknown','not-applicable'));
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='token_usage_events'::regclass AND conname='token_usage_native_dimension_check') THEN
  ALTER TABLE token_usage_events ADD CONSTRAINT token_usage_native_dimension_check CHECK(
   (native_unit IS NULL AND native_quantity IS NULL AND native_source IS NULL AND total_source<>'not-applicable') OR
   (native_unit IS NOT NULL AND native_unit IN ('image','pixel','millisecond','microsecond','character','request')
    AND native_source IS NOT NULL AND native_source IN ('reported','estimated','unknown')
    AND ((native_source='unknown' AND native_quantity IS NULL) OR (native_source IN ('reported','estimated') AND native_quantity IS NOT NULL AND native_quantity>=0))
    AND total_source IN ('reported','unknown','not-applicable')
    AND (total_source<>'not-applicable' OR (tokens_total=0 AND tokens_prompt IS NULL AND tokens_completion IS NULL AND tokens_cache_input IS NULL AND tokens_reasoning_output IS NULL))
    AND (native_source='reported' OR total_source='reported' OR cost_micros IS NULL)));
 END IF;
END $$;
-- Existing append-only trigger, tenant RLS and grants are retained. No existing usage rows change.
