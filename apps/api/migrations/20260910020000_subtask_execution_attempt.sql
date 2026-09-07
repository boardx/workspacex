-- WX-T042 follow-up (#2931): a durable subtask that produces files must be
-- addressable by the SAME (attempt, lease) identity the tool-execution authority
-- already checks for main runs. Without these columns the child's
-- `wx_artifact_publish` call resolves to no row in `agent_runs` and is denied,
-- so no real sub-model could ever write into its own staging.
--
-- Append-only: new file, no edit to an already-applied migration (see #2954).
ALTER TABLE subtask_runs ADD COLUMN IF NOT EXISTS execution_attempt_id text;
ALTER TABLE subtask_runs ADD COLUMN IF NOT EXISTS lease_epoch integer NOT NULL DEFAULT 0;
