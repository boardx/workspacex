-- A later cancellation migration supersedes these definitions. Replaying this
-- file over a live upgraded database must not narrow its CHECK or transition rules.
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='agent_runs'::regclass
    AND attname='cancel_requested_at' AND NOT attisdropped) THEN RETURN; END IF;
-- Status is a database fact. Emit in the same transaction as the transition, including
-- watchdog/context failures which never reach the model progress callback.
-- Both this trigger and appendExecutionEvent hold the parent run row lock FIRST.
CREATE OR REPLACE FUNCTION workbench_journal_run_status() RETURNS trigger AS $$
DECLARE
  event_seq integer;
  attempt_id text;
BEGIN
  IF NEW.status NOT IN ('running','paused','awaiting_tool_permission','succeeded','failed') THEN
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

END
$migration$;
