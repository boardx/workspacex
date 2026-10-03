-- Additive, unused until trusted admission composition is enabled. No existing receipt changes.
ALTER TABLE ai_request_reservations ADD COLUMN IF NOT EXISTS logical_call_id text;
ALTER TABLE ai_request_reservations ADD COLUMN IF NOT EXISTS logical_attempt integer;
ALTER TABLE ai_request_reservations ADD COLUMN IF NOT EXISTS maximum_attempts integer;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='ai_request_reservations'::regclass AND conname='ai_request_logical_attempt_shape') THEN
  ALTER TABLE ai_request_reservations ADD CONSTRAINT ai_request_logical_attempt_shape CHECK(
   (logical_call_id IS NULL AND logical_attempt IS NULL AND maximum_attempts IS NULL) OR
   (logical_call_id IS NOT NULL AND length(logical_call_id) BETWEEN 1 AND 500
    AND logical_attempt IS NOT NULL AND maximum_attempts IS NOT NULL
    AND maximum_attempts BETWEEN 1 AND 5 AND logical_attempt>=0 AND logical_attempt<maximum_attempts));
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ai_request_logical_attempt_slot ON ai_request_reservations(org_id,user_id,logical_call_id,logical_attempt) WHERE logical_call_id IS NOT NULL;
