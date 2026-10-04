-- Durable authenticated operation identity; no prompts, content or invented Agent run.
CREATE TABLE IF NOT EXISTS artifact_embedding_operations (
 id uuid PRIMARY KEY,org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id text NOT NULL,artifact_id text NOT NULL,artifact_version_id text NOT NULL,
 project_id text NULL,content_hash text NOT NULL,
 ingestion_job_id text NULL,ingestion_attempt integer NULL CHECK(ingestion_attempt>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((ingestion_job_id IS NULL)=(ingestion_attempt IS NULL)),UNIQUE(id,org_id)
);
ALTER TABLE artifact_embedding_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_embedding_operations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON artifact_embedding_operations;
CREATE POLICY tenant_scope ON artifact_embedding_operations
 USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT ON artifact_embedding_operations TO app_rw;
DROP TRIGGER IF EXISTS artifact_embedding_operations_append_only ON artifact_embedding_operations;
CREATE TRIGGER artifact_embedding_operations_append_only BEFORE UPDATE OR DELETE ON artifact_embedding_operations
 FOR EACH ROW EXECUTE FUNCTION f159_token_usage_append_only();
ALTER TABLE model_request_starts ADD COLUMN IF NOT EXISTS artifact_operation_id uuid NULL;
ALTER TABLE model_request_starts DROP CONSTRAINT IF EXISTS model_request_artifact_operation_tenant_fk;
ALTER TABLE model_request_starts ADD CONSTRAINT model_request_artifact_operation_tenant_fk
 FOREIGN KEY(artifact_operation_id,org_id) REFERENCES artifact_embedding_operations(id,org_id);
ALTER TABLE model_request_starts DROP CONSTRAINT IF EXISTS model_request_starts_non_run_identity;
ALTER TABLE model_request_starts ADD CONSTRAINT model_request_starts_non_run_identity CHECK(
 (run_id IS NOT NULL AND artifact_operation_id IS NULL) OR
 (run_id IS NULL AND execution_attempt_id IS NULL AND execution_lease_epoch IS NULL AND subtask_id IS NULL
  AND call_purpose IS NOT NULL AND (
   (call_purpose IN ('local-trial','native-asr') AND artifact_operation_id IS NULL) OR
   (call_purpose='retrieval-embedding' AND artifact_operation_id IS NOT NULL))));
SELECT kernel_apply_org_freeze_policies();
