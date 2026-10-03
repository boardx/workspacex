ALTER TABLE model_request_starts ADD COLUMN IF NOT EXISTS execution_lease_epoch bigint NULL CHECK(execution_lease_epoch>0);
-- Existing starts remain unknown for lease epoch. No attribution backfill.
CREATE UNIQUE INDEX IF NOT EXISTS subtask_runs_id_org_usage_uniq ON subtask_runs(id,org_id);
ALTER TABLE model_request_starts ADD COLUMN IF NOT EXISTS subtask_id text NULL;
ALTER TABLE model_request_starts DROP CONSTRAINT IF EXISTS model_request_subtask_tenant_fk;
ALTER TABLE model_request_starts ADD CONSTRAINT model_request_subtask_tenant_fk FOREIGN KEY(subtask_id,org_id) REFERENCES subtask_runs(id,org_id);
ALTER TABLE token_usage_events ADD COLUMN IF NOT EXISTS subtask_id text NULL;
ALTER TABLE token_usage_events DROP CONSTRAINT IF EXISTS token_usage_subtask_tenant_fk;
ALTER TABLE token_usage_events ADD CONSTRAINT token_usage_subtask_tenant_fk FOREIGN KEY(subtask_id,org_id) REFERENCES subtask_runs(id,org_id);
