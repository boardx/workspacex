-- The application keeps its write-only secret boundary. Only a separate executor login
-- can claim a single already-authorized pending receipt through the narrow function.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mcp_executor') THEN
  CREATE ROLE mcp_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mcp_executor' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolinherit)) OR EXISTS(SELECT 1 FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.member WHERE r.rolname='mcp_executor') THEN
  RAISE EXCEPTION 'mcp_executor role is not isolated';
 END IF;
END $$;
ALTER TABLE mcp_server_secrets ADD COLUMN IF NOT EXISTS revision uuid NOT NULL DEFAULT gen_random_uuid();
GRANT SELECT(revision) ON mcp_server_secrets TO app_rw;
ALTER TABLE mcp_review_snapshots ADD COLUMN IF NOT EXISTS credential_revision uuid;
ALTER TABLE mcp_tool_executions ADD COLUMN IF NOT EXISTS broker_started_at timestamptz;
CREATE OR REPLACE FUNCTION public.kernel_mcp_rotate_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP <> 'DELETE' THEN NEW.revision:=gen_random_uuid(); END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS mcp_secret_revision ON mcp_server_secrets;
CREATE TRIGGER mcp_secret_revision BEFORE INSERT OR UPDATE ON mcp_server_secrets
 FOR EACH ROW EXECUTE FUNCTION public.kernel_mcp_rotate_revision();
CREATE OR REPLACE FUNCTION public.kernel_mcp_revoke_rotation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.mcp_servers SET current_review_id=NULL,review_status='待安全评审',connection_status='已隔离',isolation_mode=NULL
 WHERE org_id=COALESCE(NEW.org_id,OLD.org_id) AND server_id=COALESCE(NEW.server_id,OLD.server_id);
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS mcp_secret_revocation ON mcp_server_secrets;
CREATE TRIGGER mcp_secret_revocation AFTER INSERT OR UPDATE OR DELETE ON mcp_server_secrets
 FOR EACH ROW EXECUTE FUNCTION public.kernel_mcp_revoke_rotation();
-- No default PUBLIC execution, no table grants, and no caller-supplied server selector.
CREATE OR REPLACE FUNCTION public.kernel_claim_mcp_credential(p_org text,p_run text,p_call text,p_attempt text,p_epoch bigint,p_revision uuid,p_tool text,p_args_digest text)
RETURNS TABLE(ciphertext text,algorithm text,key_id text,revision uuid,endpoint text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE expected_server text;
BEGIN
 PERFORM set_config('app.current_org',p_org,true);
 SELECT e.server_id INTO expected_server
 FROM public.mcp_tool_executions e
 JOIN public.agent_runs r ON r.org_id=e.org_id AND r.id=e.run_id
 JOIN public.mcp_servers m ON m.org_id=e.org_id AND m.server_id=e.server_id
 JOIN public.mcp_review_snapshots v ON v.org_id=m.org_id AND v.review_id=m.current_review_id
 JOIN public.mcp_server_secrets secret ON secret.org_id=m.org_id AND secret.server_id=m.server_id
 JOIN public.mcp_run_snapshots snap ON snap.org_id=e.org_id AND snap.run_id=e.run_id
 WHERE e.org_id=p_org AND e.run_id=p_run AND e.tool_call_id=p_call
 AND e.tool_name=p_tool AND e.args_digest=p_args_digest
 AND e.status='pending' AND e.isolation_request_id IS NULL AND e.broker_started_at IS NULL AND e.deadline_at>now()
 AND e.attempt_id=p_attempt AND e.lease_epoch=p_epoch
 AND r.status='running' AND r.cancel_requested_at IS NULL AND r.lease_epoch=p_epoch AND r.lease_expires_at>now()
 AND p_attempt=(SELECT r.id||':'||(s.seq-1)::text FROM public.agent_run_steps s WHERE s.org_id=r.org_id AND s.run_id=r.id AND s.kind='context_built' AND s.started_at>=r.started_at ORDER BY s.seq DESC LIMIT 1)
 AND m.current_review_id=e.review_id AND m.endpoint=v.endpoint
 AND m.review_status IN ('已放行','有条件放行') AND m.connection_status IN ('已连接','限流中') AND m.isolation_mode IS NULL
 AND secret.revision=p_revision AND v.credential_revision=p_revision
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(snap.tools) t WHERE t->'runtime'->>'name'=e.tool_name AND t->>'reviewId'=e.review_id::text AND t->>'credentialRevision'=p_revision::text AND t->>'endpoint'=m.endpoint)
 FOR UPDATE OF e;
 IF expected_server IS NULL THEN RETURN; END IF;
 UPDATE public.mcp_tool_executions SET broker_started_at=now() WHERE org_id=p_org AND run_id=p_run AND tool_call_id=p_call AND broker_started_at IS NULL;
 RETURN QUERY SELECT s.ciphertext,s.algorithm,s.key_id,s.revision,m.endpoint FROM public.mcp_server_secrets s JOIN public.mcp_servers m ON m.org_id=s.org_id AND m.server_id=s.server_id WHERE s.org_id=p_org AND s.server_id=expected_server AND s.revision=p_revision;
END $$;
REVOKE ALL ON FUNCTION public.kernel_claim_mcp_credential(text,text,text,text,bigint,uuid,text,text) FROM PUBLIC,app_rw;
GRANT USAGE ON SCHEMA public TO mcp_executor;
GRANT EXECUTE ON FUNCTION public.kernel_claim_mcp_credential(text,text,text,text,bigint,uuid,text,text) TO mcp_executor;
REVOKE ALL ON FUNCTION public.kernel_mcp_rotate_revision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kernel_mcp_revoke_rotation() FROM PUBLIC;
