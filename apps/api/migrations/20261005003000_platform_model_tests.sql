-- Bounded isolated test operations. No model, organization plan, or budget is enabled.
CREATE TABLE IF NOT EXISTS platform_model_tests (
 id uuid NOT NULL,org_id text NOT NULL,operator_user_id text NOT NULL,request jsonb NOT NULL,input_hash text NOT NULL,
 state text NOT NULL DEFAULT 'queued',settlement_state text NOT NULL DEFAULT 'pending',result jsonb NULL,failure_reason text NULL,
 physical_receipt_id text NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE rule record; BEGIN
 FOR rule IN SELECT * FROM (VALUES
  ('platform_model_tests','platform_model_tests_pkey','PRIMARY KEY(id)'),
  ('platform_model_tests','platform_model_tests_org_fk','FOREIGN KEY(org_id) REFERENCES organizations(id) ON DELETE CASCADE'),
  ('platform_model_tests','platform_model_tests_request_check','CHECK(jsonb_typeof(request)=''object'')'),
  ('platform_model_tests','platform_model_tests_hash_check','CHECK(input_hash ~ ''^[a-f0-9]{64}$'')'),
  ('platform_model_tests','platform_model_tests_state_check','CHECK(state IN (''queued'',''dispatching'',''succeeded'',''failed'',''cancelled'',''unknown''))'),
  ('platform_model_tests','platform_model_tests_settlement_check','CHECK(settlement_state IN (''pending'',''settled'',''held''))'),
  ('platform_model_tests','platform_model_tests_result_check','CHECK(result IS NULL OR jsonb_typeof(result)=''object'')'),
  ('platform_model_tests','platform_model_tests_reason_check','CHECK(failure_reason IN (''adapter-unavailable'',''admission-refused'',''dispatch-cancelled'',''provider-unconfirmed'',''dispatch-in-progress'',''accounting-unavailable''))'),
  ('platform_model_tests','platform_model_tests_result_state_check','CHECK((state=''succeeded'' AND result IS NOT NULL AND failure_reason IS NULL) OR (state<>''succeeded'' AND result IS NULL))'),
  ('platform_model_tests','platform_model_tests_failure_check','CHECK(state NOT IN (''failed'',''unknown'',''cancelled'') OR failure_reason IS NOT NULL)'),
  ('platform_model_tests','platform_model_tests_receipt_uniq','UNIQUE(org_id,physical_receipt_id)'),
  ('platform_model_tests','platform_model_tests_id_org_uniq','UNIQUE(id,org_id)')
 ) AS definitions(table_name,constraint_name,definition) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass(rule.table_name) AND conname=rule.constraint_name) THEN
   EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',rule.table_name,rule.constraint_name,rule.definition);
  END IF;
 END LOOP;
END $$;
ALTER TABLE platform_model_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_model_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON platform_model_tests;
CREATE POLICY tenant_scope ON platform_model_tests USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON platform_model_tests FROM app_rw;
GRANT SELECT,INSERT ON platform_model_tests TO app_rw;
GRANT UPDATE(state,settlement_state,result,failure_reason,physical_receipt_id,updated_at) ON platform_model_tests TO app_rw;
ALTER TABLE model_request_starts ADD COLUMN IF NOT EXISTS platform_test_id uuid NULL;
CREATE OR REPLACE FUNCTION enforce_platform_model_test_identity() RETURNS trigger AS $$ BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM organizations WHERE id=OLD.org_id) THEN RETURN OLD;END IF;
  RAISE EXCEPTION 'platform model test is append-only';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM organizations WHERE id=NEW.org_id AND kind='organization') OR
    NEW.request->>'orgId' IS DISTINCT FROM NEW.org_id OR NEW.request->>'testId' IS DISTINCT FROM NEW.id::text THEN
  RAISE EXCEPTION 'platform model test identity mismatch';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.org_id,NEW.operator_user_id,NEW.request,NEW.input_hash,NEW.created_at)
     IS DISTINCT FROM (OLD.id,OLD.org_id,OLD.operator_user_id,OLD.request,OLD.input_hash,OLD.created_at) THEN
   RAISE EXCEPTION 'platform model test identity is immutable';
  END IF;
  IF OLD.physical_receipt_id IS NOT NULL AND NEW.physical_receipt_id IS DISTINCT FROM OLD.physical_receipt_id THEN
   RAISE EXCEPTION 'platform model test physical receipt is immutable';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
    (OLD.state='queued' AND NEW.state IN ('dispatching','failed','cancelled')) OR
    (OLD.state='dispatching' AND NEW.state IN ('succeeded','failed','unknown'))) THEN
   RAISE EXCEPTION 'platform model test transition denied';
  END IF;
  IF OLD.state IN ('succeeded','failed','cancelled','unknown') AND
   (NEW.result,NEW.failure_reason) IS DISTINCT FROM (OLD.result,OLD.failure_reason) THEN
   RAISE EXCEPTION 'platform model test terminal is immutable';
  END IF;
 END IF;
 IF NEW.physical_receipt_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM model_request_starts r WHERE r.id=NEW.physical_receipt_id AND r.org_id=NEW.org_id AND r.user_id=NEW.operator_user_id AND r.platform_test_id=NEW.id) THEN
  RAISE EXCEPTION 'platform model test receipt ownership mismatch';
 END IF;
 IF NEW.state='dispatching' AND NOT EXISTS(SELECT 1 FROM ai_request_reservations r
  WHERE r.id=NEW.physical_receipt_id AND r.org_id=NEW.org_id AND r.user_id=NEW.operator_user_id AND r.state='held') THEN
  RAISE EXCEPTION 'platform model test reservation missing';
 END IF;
 IF NEW.state='succeeded' AND (NEW.result IS NULL OR NEW.failure_reason IS NOT NULL) THEN
  RAISE EXCEPTION 'platform model test result missing';
 END IF;
 RETURN NEW;
END $$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION enforce_platform_model_test_identity() FROM PUBLIC;
DROP TRIGGER IF EXISTS platform_model_test_identity ON platform_model_tests;
CREATE TRIGGER platform_model_test_identity BEFORE INSERT OR UPDATE OR DELETE ON platform_model_tests FOR EACH ROW EXECUTE FUNCTION enforce_platform_model_test_identity();
-- Formal non-run provenance for test calls; never invent a run or artifact operation.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='model_request_starts'::regclass AND conname='model_request_starts_platform_test_fk') THEN
  ALTER TABLE model_request_starts ADD CONSTRAINT model_request_starts_platform_test_fk
   FOREIGN KEY(platform_test_id,org_id) REFERENCES platform_model_tests(id,org_id) ON DELETE CASCADE;
 END IF;
END $$;
ALTER TABLE model_request_starts DROP CONSTRAINT IF EXISTS model_request_starts_non_run_identity;
ALTER TABLE model_request_starts ADD CONSTRAINT model_request_starts_non_run_identity CHECK(
 (run_id IS NOT NULL AND artifact_operation_id IS NULL AND platform_test_id IS NULL) OR
 (run_id IS NULL AND execution_attempt_id IS NULL AND execution_lease_epoch IS NULL AND subtask_id IS NULL AND call_purpose IS NOT NULL AND (
  (call_purpose IN ('local-trial','native-asr') AND artifact_operation_id IS NULL AND platform_test_id IS NULL) OR
  (call_purpose='retrieval-embedding' AND artifact_operation_id IS NOT NULL AND platform_test_id IS NULL) OR
  (platform_test_id IS NOT NULL AND artifact_operation_id IS NULL AND thread_id IS NULL AND agent_id IS NULL
   AND call_purpose IN ('primary','native-image','native-asr','retrieval-embedding','retrieval-rerank')))));
CREATE OR REPLACE FUNCTION enforce_platform_test_request_start() RETURNS trigger AS $$ BEGIN
 IF NEW.platform_test_id IS NULL THEN RETURN NEW;END IF;
 IF NOT EXISTS(SELECT 1 FROM platform_model_tests test JOIN ai_request_reservations reservation
   ON reservation.org_id=test.org_id AND reservation.id=NEW.id AND reservation.user_id=test.operator_user_id
   AND reservation.formal_model_id=test.request->>'modelId' AND reservation.model_provider=NEW.model_provider
   AND reservation.model_id=NEW.model_id AND reservation.state='held'
  WHERE test.id=NEW.platform_test_id AND test.org_id=NEW.org_id AND test.operator_user_id=NEW.user_id AND test.state='queued'
   AND (test.physical_receipt_id IS NULL OR test.physical_receipt_id=NEW.id)
   AND NEW.call_purpose=CASE test.request->>'capability'
    WHEN 'text' THEN 'primary' WHEN 'text-to-speech' THEN 'primary' WHEN 'image-generation' THEN 'native-image'
    WHEN 'speech-to-text' THEN 'native-asr' WHEN 'embedding' THEN 'retrieval-embedding' WHEN 'rerank' THEN 'retrieval-rerank' ELSE NULL END) THEN
  RAISE EXCEPTION 'platform test request start authority mismatch';
 END IF;
 RETURN NEW;
END $$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION enforce_platform_test_request_start() FROM PUBLIC;
DROP TRIGGER IF EXISTS platform_test_request_start_authority ON model_request_starts;
CREATE TRIGGER platform_test_request_start_authority BEFORE INSERT ON model_request_starts FOR EACH ROW EXECUTE FUNCTION enforce_platform_test_request_start();
SELECT kernel_apply_org_freeze_policies();
