-- Authenticated or server-worker scoped auxiliary calls have no fabricated Agent run.
-- Their payer remains derived from persisted org membership by the credit ledger.
ALTER TABLE model_request_starts DROP CONSTRAINT model_request_starts_non_run_identity;
ALTER TABLE model_request_starts ADD CONSTRAINT model_request_starts_non_run_identity CHECK(
 (run_id IS NOT NULL AND artifact_operation_id IS NULL AND platform_test_id IS NULL AND knowledge_operation_id IS NULL) OR
 (run_id IS NULL AND execution_attempt_id IS NULL AND execution_lease_epoch IS NULL AND subtask_id IS NULL AND call_purpose IS NOT NULL AND (
  (call_purpose IN ('local-trial','native-asr','auxiliary') AND artifact_operation_id IS NULL AND platform_test_id IS NULL AND knowledge_operation_id IS NULL) OR
  (call_purpose='retrieval-embedding' AND platform_test_id IS NULL AND ((artifact_operation_id IS NOT NULL AND knowledge_operation_id IS NULL) OR (artifact_operation_id IS NULL AND knowledge_operation_id IS NOT NULL))) OR
  (platform_test_id IS NOT NULL AND artifact_operation_id IS NULL AND knowledge_operation_id IS NULL AND thread_id IS NULL AND agent_id IS NULL AND call_purpose IN ('primary','native-image','native-asr','retrieval-embedding','retrieval-rerank')))));
