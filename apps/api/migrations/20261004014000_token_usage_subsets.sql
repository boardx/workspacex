-- Provider-reported subsets; these are never additional total tokens.
ALTER TABLE token_usage_events
  ADD COLUMN IF NOT EXISTS tokens_cache_input bigint CHECK (tokens_cache_input >= 0),
  ADD COLUMN IF NOT EXISTS tokens_reasoning_output bigint CHECK (tokens_reasoning_output >= 0);
ALTER TABLE token_usage_events DROP CONSTRAINT IF EXISTS token_usage_cache_subset;
ALTER TABLE token_usage_events DROP CONSTRAINT IF EXISTS token_usage_reasoning_subset;
ALTER TABLE token_usage_events
  ADD CONSTRAINT token_usage_cache_subset CHECK (tokens_prompt IS NULL OR tokens_cache_input IS NULL OR tokens_cache_input <= tokens_prompt),
  ADD CONSTRAINT token_usage_reasoning_subset CHECK (tokens_completion IS NULL OR tokens_reasoning_output IS NULL OR tokens_reasoning_output <= tokens_completion);
-- Existing receipts remain unknown for these dimensions; no inferred backfill.
