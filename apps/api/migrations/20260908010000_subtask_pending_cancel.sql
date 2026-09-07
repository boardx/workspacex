-- Add pending-only cancellation without changing existing tenant/freeze policies.
ALTER TABLE subtask_runs DROP CONSTRAINT IF EXISTS subtask_runs_status_check;
ALTER TABLE subtask_runs ADD CONSTRAINT subtask_runs_status_check
  CHECK (status IN ('pending','running','completed','failed','cancelled'));
ALTER TABLE subtask_runs DROP CONSTRAINT IF EXISTS subtask_runs_check;
ALTER TABLE subtask_runs ADD CONSTRAINT subtask_runs_check CHECK (
  (status IN ('pending','running','cancelled') AND result IS NULL AND error IS NULL)
  OR (status='completed' AND result IS NOT NULL AND error IS NULL)
  OR (status='failed' AND result IS NULL AND error IS NOT NULL));
