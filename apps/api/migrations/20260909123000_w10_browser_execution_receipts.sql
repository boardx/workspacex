-- W10 reuses mcp_tool_executions as the one durable tool-call receipt journal.
-- The narrow functions keep claim/check/update atomic and admit browser tool names only.
CREATE OR REPLACE FUNCTION public.kernel_claim_browser_execution(
  p_org text,p_run text,p_call text,p_tool text,p_digest text,p_attempt text,p_epoch integer,p_deadline timestamptz
) RETURNS TABLE(disposition text,result jsonb)
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE prior public.mcp_tool_executions%ROWTYPE;
BEGIN
  IF current_setting('app.current_org',true) IS DISTINCT FROM p_org
     OR p_tool NOT IN ('browser_navigate','browser_snapshot','browser_click','browser_fill_form','browser_take_screenshot')
     OR p_digest !~ '^[a-f0-9]{64}$' OR length(p_call) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'browser receipt refused';
  END IF;
  PERFORM 1 FROM public.agent_runs r WHERE r.org_id=p_org AND r.id=p_run
    AND r.status='running' AND r.cancel_requested_at IS NULL
    AND r.lease_epoch=p_epoch AND r.lease_expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'browser run unavailable'; END IF;
  SELECT e.* INTO prior FROM public.mcp_tool_executions e
    WHERE e.org_id=p_org AND e.run_id=p_run AND e.tool_call_id=p_call FOR UPDATE;
  IF FOUND THEN
    IF prior.tool_name<>p_tool OR prior.args_digest<>p_digest THEN RAISE EXCEPTION 'browser receipt conflict'; END IF;
    disposition:=CASE WHEN prior.status='succeeded' THEN 'succeeded' ELSE 'unconfirmed' END;
    result:=CASE WHEN prior.status='succeeded' THEN prior.result ELSE NULL END;
    RETURN NEXT; RETURN;
  END IF;
  INSERT INTO public.mcp_tool_executions
    (org_id,run_id,tool_call_id,tool_name,args_digest,status,attempt_id,lease_epoch,deadline_at)
    VALUES(p_org,p_run,p_call,p_tool,p_digest,'pending',p_attempt,p_epoch,p_deadline);
  disposition:='claimed';result:=NULL;RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.kernel_finish_browser_execution(
  p_org text,p_run text,p_call text,p_tool text,p_digest text,p_result jsonb
) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF current_setting('app.current_org',true) IS DISTINCT FROM p_org OR p_result IS NULL THEN
    RAISE EXCEPTION 'browser receipt refused';
  END IF;
  UPDATE public.mcp_tool_executions SET status='succeeded',result=p_result,finished_at=now()
    WHERE org_id=p_org AND run_id=p_run AND tool_call_id=p_call
      AND tool_name=p_tool AND args_digest=p_digest AND status='pending';
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.kernel_mark_browser_execution_unconfirmed(
  p_org text,p_run text,p_call text,p_tool text,p_digest text
) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF current_setting('app.current_org',true) IS DISTINCT FROM p_org THEN RAISE EXCEPTION 'browser receipt refused'; END IF;
  UPDATE public.mcp_tool_executions SET status='unconfirmed',finished_at=now()
    WHERE org_id=p_org AND run_id=p_run AND tool_call_id=p_call
      AND tool_name=p_tool AND args_digest=p_digest AND status='pending';
END $$;

REVOKE ALL ON FUNCTION public.kernel_claim_browser_execution(text,text,text,text,text,text,integer,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kernel_finish_browser_execution(text,text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kernel_mark_browser_execution_unconfirmed(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kernel_claim_browser_execution(text,text,text,text,text,text,integer,timestamptz) TO app_rw;
GRANT EXECUTE ON FUNCTION public.kernel_finish_browser_execution(text,text,text,text,text,jsonb) TO app_rw;
GRANT EXECUTE ON FUNCTION public.kernel_mark_browser_execution_unconfirmed(text,text,text,text,text) TO app_rw;
