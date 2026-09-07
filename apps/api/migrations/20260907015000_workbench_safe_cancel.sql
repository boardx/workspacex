-- Cancellation is requested durably and confirmed only at an idle/checkpoint boundary.
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz;
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_status_check CHECK (
 status IN ('queued','running','writeback_pending','succeeded','failed','awaiting_tool_permission','paused','cancelled')
);
CREATE OR REPLACE FUNCTION wave2_agent_run_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  IF OLD.status = 'failed' AND NEW.status = 'writeback_pending' THEN
    IF OLD.error_code = 'CHAT_WRITEBACK_FAILED'
       AND NEW.error_code IS NULL
       AND NEW.model_output IS NOT NULL
       AND NEW.model_output = OLD.model_output
       AND NEW.writeback_attempts = 0
       AND NEW.retry_count = OLD.retry_count + 1 THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'AgentRun % may only reopen from an exhausted Chat writeback, with the stored output '
      'unchanged, the budget reset and the retry generation advanced', OLD.id;
  END IF;

  IF OLD.status IN ('succeeded', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'AgentRun % is terminal in %, cannot become %', OLD.id, OLD.status, NEW.status;
  END IF;
  IF (NEW.status = 'cancelled' AND OLD.status IN ('queued','running','paused','awaiting_tool_permission') AND NEW.cancel_requested_at IS NOT NULL)
     OR NEW.status = 'failed'
     OR (OLD.status = 'queued' AND NEW.status = 'running')
     OR (OLD.status = 'running' AND NEW.status = 'writeback_pending')
     OR (OLD.status = 'running' AND NEW.status = 'paused' AND NEW.paused_at IS NOT NULL)
     OR (OLD.status = 'paused' AND NEW.status = 'queued' AND NEW.checkpoint_resume AND NEW.paused_at IS NULL)
     OR (OLD.status = 'running' AND NEW.status = 'awaiting_tool_permission')   -- 引擎中断，等人表态
     OR (OLD.status = 'awaiting_tool_permission' AND NEW.status = 'queued')    -- 人裁决后重新入队
     OR (OLD.status = 'writeback_pending' AND NEW.status = 'succeeded') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AgentRun % may not move from % to %', OLD.id, OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION workbench_journal_run_status() RETURNS trigger AS $$
DECLARE
  event_seq integer;
  attempt_id text;
BEGIN
  IF NEW.status NOT IN ('running','paused','awaiting_tool_permission','succeeded','failed','cancelled') THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(MAX(seq)+1,0) INTO event_seq
    FROM agent_execution_events WHERE org_id=NEW.org_id AND run_id=NEW.id;
  IF NEW.status = 'running' THEN
    SELECT NEW.id || ':' || GREATEST(1,COALESCE(MAX(seq),1))::text INTO attempt_id
      FROM agent_run_steps WHERE org_id=NEW.org_id AND run_id=NEW.id;
  ELSE
    SELECT payload->>'attemptId' INTO attempt_id FROM agent_execution_events
      WHERE org_id=NEW.org_id AND run_id=NEW.id
        AND payload->>'kind'='status' AND payload->>'status'='running'
      ORDER BY seq DESC LIMIT 1;
  END IF;
  INSERT INTO agent_execution_events(org_id,run_id,seq,payload)
    VALUES (NEW.org_id,NEW.id,event_seq,jsonb_build_object(
      'kind','status','status',NEW.status,'attemptId',COALESCE(attempt_id,NEW.id || ':1')));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS workbench_run_status_journal_trg ON agent_runs;
CREATE TRIGGER workbench_run_status_journal_trg AFTER UPDATE OF status ON agent_runs
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION workbench_journal_run_status();
