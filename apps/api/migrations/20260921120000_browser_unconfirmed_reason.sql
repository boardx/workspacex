-- An unknown browser outcome now records WHY it is unknown.
--
-- Before this, every failure inside the adapter collapsed into one receipt row and one
-- contract string (`browser_execution_unconfirmed_no_replay`), so "Chromium is not installed"
-- (BLOCKED) and "the upstream tool refused this call" (FAIL) were the same durable fact.
--
-- The column is deliberately plain `text` with a shape check only: the set of reasons lives
-- in BROWSER_FAILURE_CLASSES (apps/api/src/application/agent-run/standard-browser-tools.ts),
-- and restating that list as a SQL CHECK would create a second source of truth to drift.
ALTER TABLE public.mcp_tool_executions ADD COLUMN IF NOT EXISTS unconfirmed_reason text NULL;

DROP FUNCTION IF EXISTS public.kernel_mark_browser_execution_unconfirmed(text,text,text,text,text);
CREATE OR REPLACE FUNCTION public.kernel_mark_browser_execution_unconfirmed(
  p_org text,p_run text,p_call text,p_tool text,p_digest text,p_reason text
) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF current_setting('app.current_org',true) IS DISTINCT FROM p_org THEN RAISE EXCEPTION 'browser receipt refused'; END IF;
  IF p_reason IS NULL OR p_reason !~ '^[a-z][a-z_]{2,63}$' THEN RAISE EXCEPTION 'browser receipt refused'; END IF;
  UPDATE public.mcp_tool_executions SET status='unconfirmed',unconfirmed_reason=p_reason,finished_at=now()
    WHERE org_id=p_org AND run_id=p_run AND tool_call_id=p_call
      AND tool_name=p_tool AND args_digest=p_digest AND status='pending';
END $$;

REVOKE ALL ON FUNCTION public.kernel_mark_browser_execution_unconfirmed(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kernel_mark_browser_execution_unconfirmed(text,text,text,text,text,text) TO app_rw;
