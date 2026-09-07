-- Add observational cancellation facts to the existing RLS-protected child queue.
ALTER TABLE subtask_runs ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz;
ALTER TABLE subtask_runs ADD COLUMN IF NOT EXISTS cancellation_state text;
ALTER TABLE subtask_runs ADD COLUMN IF NOT EXISTS remote_run_id text;
ALTER TABLE subtask_runs ADD COLUMN IF NOT EXISTS remote_thread_id text;
ALTER TABLE subtask_runs DROP CONSTRAINT IF EXISTS subtask_cancellation_consistent;
ALTER TABLE subtask_runs ADD CONSTRAINT subtask_cancellation_consistent CHECK (
  (cancel_requested_at IS NULL AND cancellation_state IS NULL) OR
  (cancel_requested_at IS NOT NULL AND cancellation_state IS NOT NULL AND cancellation_state IN ('pending','confirmed','unknown'))
);
ALTER TABLE subtask_runs DROP CONSTRAINT IF EXISTS subtask_remote_identity_consistent;
ALTER TABLE subtask_runs ADD CONSTRAINT subtask_remote_identity_consistent CHECK (
  (remote_run_id IS NULL AND remote_thread_id IS NULL) OR
  (remote_run_id IS NOT NULL AND remote_thread_id IS NOT NULL AND length(remote_run_id) BETWEEN 1 AND 256 AND length(remote_thread_id) BETWEEN 1 AND 256)
);
