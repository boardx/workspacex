-- Authenticated local trials and audio captures are actual calls without an Agent run.
-- Keep existing run identities; never fabricate a run to satisfy accounting.
ALTER TABLE model_request_starts ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE model_request_starts DROP CONSTRAINT IF EXISTS model_request_starts_non_run_identity;
ALTER TABLE model_request_starts ADD CONSTRAINT model_request_starts_non_run_identity
 CHECK (run_id IS NOT NULL OR (call_purpose IS NOT NULL AND call_purpose IN ('local-trial','native-asr')
   AND execution_attempt_id IS NULL AND execution_lease_epoch IS NULL AND subtask_id IS NULL));
-- Existing append-only, RLS, freeze policies and privileges stay in force.
