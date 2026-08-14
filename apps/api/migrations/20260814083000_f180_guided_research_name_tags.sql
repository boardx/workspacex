-- F180 -- persist the user-confirmed research name and optional tags before the brief step.
ALTER TABLE guided_research_sessions
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

ALTER TABLE guided_research_sessions
  DROP CONSTRAINT IF EXISTS guided_research_sessions_tags_limit;
ALTER TABLE guided_research_sessions
  ADD CONSTRAINT guided_research_sessions_tags_limit CHECK (cardinality(tags) <= 5);

REVOKE ALL ON guided_research_sessions FROM app_rw;
GRANT SELECT, INSERT ON guided_research_sessions TO app_rw;
GRANT UPDATE (title, tags, brief, brief_version, brief_confirmed_at, directions, outline, stage, resume_stage, progress, source_count, report_id, updated_at)
  ON guided_research_sessions TO app_rw;
