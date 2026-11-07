-- Genuine background knowledge operation identity, never an invented run or artifact.
CREATE TABLE IF NOT EXISTS knowledge_embedding_operations (
 id uuid PRIMARY KEY,org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id text NOT NULL,project_id text NULL,target_kind text NOT NULL CHECK(target_kind IN ('claim','object')),
 target_id text NOT NULL,content_md5 text NOT NULL,input_hash text NOT NULL,max_outbox_id bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,org_id)
);
ALTER TABLE knowledge_embedding_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_embedding_operations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON knowledge_embedding_operations;
CREATE POLICY tenant_scope ON knowledge_embedding_operations USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT ON knowledge_embedding_operations TO app_rw;
DROP TRIGGER IF EXISTS knowledge_embedding_operations_append_only ON knowledge_embedding_operations;
CREATE TRIGGER knowledge_embedding_operations_append_only BEFORE UPDATE OR DELETE ON knowledge_embedding_operations FOR EACH ROW EXECUTE FUNCTION f159_token_usage_append_only();
ALTER TABLE model_request_starts ADD COLUMN IF NOT EXISTS knowledge_operation_id uuid NULL;
ALTER TABLE model_request_starts DROP CONSTRAINT IF EXISTS model_request_knowledge_operation_tenant_fk;
ALTER TABLE model_request_starts ADD CONSTRAINT model_request_knowledge_operation_tenant_fk FOREIGN KEY(knowledge_operation_id,org_id) REFERENCES knowledge_embedding_operations(id,org_id);
ALTER TABLE model_request_starts DROP CONSTRAINT IF EXISTS model_request_starts_non_run_identity;
ALTER TABLE model_request_starts ADD CONSTRAINT model_request_starts_non_run_identity CHECK(
 (run_id IS NOT NULL AND artifact_operation_id IS NULL AND platform_test_id IS NULL AND knowledge_operation_id IS NULL) OR
 (run_id IS NULL AND execution_attempt_id IS NULL AND execution_lease_epoch IS NULL AND subtask_id IS NULL AND call_purpose IS NOT NULL AND (
  (call_purpose IN ('local-trial','native-asr') AND artifact_operation_id IS NULL AND platform_test_id IS NULL AND knowledge_operation_id IS NULL) OR
  (call_purpose='retrieval-embedding' AND platform_test_id IS NULL AND ((artifact_operation_id IS NOT NULL AND knowledge_operation_id IS NULL) OR (artifact_operation_id IS NULL AND knowledge_operation_id IS NOT NULL))) OR
  (platform_test_id IS NOT NULL AND artifact_operation_id IS NULL AND knowledge_operation_id IS NULL AND thread_id IS NULL AND agent_id IS NULL AND call_purpose IN ('primary','native-image','native-asr','retrieval-embedding','retrieval-rerank')))));
-- Narrow server-worker lookup. No caller-supplied actor, scope or payer is accepted.
CREATE OR REPLACE FUNCTION knowledge_embedding_subject(p_kind text,p_id text,p_md5 text,p_max bigint)
RETURNS TABLE(user_id text,project_id text,input_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_org text:=current_setting('app.current_org',true);v_scope text;v_scope_id text;v_event text;v_user text;v_project text;v_text text;v_action record;v_message record;
BEGIN
 IF v_org IS NULL OR v_org='' THEN RAISE EXCEPTION 'KG_NO_TENANT' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM kg_embedding_outbox q WHERE q.org_id=v_org AND q.target_kind=p_kind AND q.target_id=p_id AND q.id=p_max AND q.attempts<kg_embedding_max_attempts()) THEN RETURN;END IF;
 v_text:=kg_embedding_text(v_org,p_kind,p_id);IF v_text IS NULL OR md5(v_text)<>p_md5 THEN RETURN;END IF;
 IF p_kind='claim' THEN SELECT c.scope_kind,c.scope_id,c.provenance_event_id INTO v_scope,v_scope_id,v_event FROM claims c WHERE c.org_id=v_org AND c.id=p_id;
 ELSIF p_kind='object' THEN SELECT o.scope_kind,o.scope_id,o.provenance_event_id INTO v_scope,v_scope_id,v_event FROM ontology_objects o WHERE o.org_id=v_org AND o.id=p_id;
 ELSE RETURN;END IF;
 SELECT a.actor_kind,a.actor_id,a.source_ref INTO v_action FROM ontology_actions a WHERE a.org_id=v_org AND a.id=v_event AND a.outcome='accepted';
 IF FOUND THEN
  IF v_action.actor_kind='human' THEN v_user:=v_action.actor_id;
  ELSE SELECT CASE WHEN m.author_kind='human' THEN m.author_id ELSE request.author_id END AS actor INTO v_message FROM chat_messages m LEFT JOIN agent_runs r ON r.org_id=m.org_id AND r.id=m.agent_run_id LEFT JOIN chat_messages request ON request.org_id=r.org_id AND request.id=r.input_message_id WHERE m.org_id=v_org AND m.id=v_action.source_ref;v_user:=v_message.actor;END IF;
 END IF;
 IF v_scope='personal' THEN v_user:=v_scope_id;
 ELSIF v_scope='chat_session' THEN SELECT t.project_id,coalesce(v_user,t.created_by) INTO v_project,v_user FROM chat_threads t WHERE t.org_id=v_org AND t.id=v_scope_id;
 ELSIF v_scope='project' THEN
  v_project:=v_scope_id;
  IF v_user IS NULL THEN SELECT r.actor_id INTO v_user FROM project_creation_requests r JOIN org_memberships m ON m.org_id=r.org_id AND m.user_id=r.actor_id WHERE r.org_id=v_org AND r.project_id=v_project ORDER BY r.created_at LIMIT 1;END IF;
  IF v_user IS NULL THEN SELECT m.user_id INTO v_user FROM project_memberships m WHERE m.org_id=v_org AND m.project_id=v_project AND m.is_host ORDER BY m.user_id LIMIT 1;END IF;
 ELSIF v_scope='org' THEN IF v_user IS NULL THEN SELECT m.user_id INTO v_user FROM org_memberships m WHERE m.org_id=v_org AND m.org_role='admin' ORDER BY m.user_id LIMIT 1;END IF;
 ELSE RETURN;END IF;
 IF v_user IS NULL OR NOT EXISTS(SELECT 1 FROM org_memberships m WHERE m.org_id=v_org AND m.user_id=v_user) THEN RETURN;END IF;
 IF v_project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_memberships m WHERE m.org_id=v_org AND m.project_id=v_project AND m.user_id=v_user) THEN RETURN;END IF;
 RETURN QUERY SELECT v_user,v_project,encode(sha256(convert_to(v_text,'UTF8')),'hex');
END $$;
REVOKE ALL ON FUNCTION knowledge_embedding_subject(text,text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION knowledge_embedding_subject(text,text,text,bigint) TO app_rw;
SELECT kernel_apply_org_freeze_policies();
