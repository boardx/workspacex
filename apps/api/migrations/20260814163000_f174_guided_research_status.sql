-- F174 -- a report-stage session remains active until its explicit completion checkpoint.
ALTER TABLE guided_research_sessions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE guided_research_sessions
  DROP CONSTRAINT IF EXISTS guided_research_sessions_status_check;
ALTER TABLE guided_research_sessions
  ADD CONSTRAINT guided_research_sessions_status_check
  CHECK (status IN ('active', 'completed', 'failed'));

UPDATE guided_research_sessions
   SET status = 'completed'
 WHERE stage = 'report' AND status = 'active';

REVOKE ALL ON guided_research_sessions FROM app_rw;
GRANT SELECT, INSERT ON guided_research_sessions TO app_rw;
GRANT UPDATE (title, tags, brief, brief_version, brief_confirmed_at, directions, outline, stage, resume_stage, status, progress, source_count, report_id, updated_at)
  ON guided_research_sessions TO app_rw;
