-- F169 / #1110 -- immutable candidate and confirmed snapshots for guided research checkpoints.
ALTER TABLE guided_research_sessions
  ADD COLUMN IF NOT EXISTS brief_version integer NOT NULL DEFAULT 1 CHECK (brief_version > 0),
  ADD COLUMN IF NOT EXISTS brief_confirmed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS directions jsonb NOT NULL DEFAULT '{"candidateVersion":null,"confirmedVersion":null,"versions":[]}'::jsonb
    CHECK (jsonb_typeof(directions) = 'object'),
  ADD COLUMN IF NOT EXISTS outline jsonb NOT NULL DEFAULT '{"candidateVersion":null,"confirmedVersion":null,"versions":[]}'::jsonb
    CHECK (jsonb_typeof(outline) = 'object');

UPDATE guided_research_sessions
   SET brief_confirmed_at = COALESCE(brief_confirmed_at, created_at)
 WHERE brief_confirmed_at IS NULL;

REVOKE ALL ON guided_research_sessions FROM app_rw;
GRANT SELECT, INSERT ON guided_research_sessions TO app_rw;
GRANT UPDATE (title, brief, brief_version, brief_confirmed_at, directions, outline, stage, resume_stage, progress, source_count, report_id, updated_at)
  ON guided_research_sessions TO app_rw;
