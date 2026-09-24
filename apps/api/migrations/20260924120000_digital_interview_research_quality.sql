-- Versioned, human-confirmed research quality facts for digital interviews.
-- Derived findings and coverage cells are intentionally not persisted.

ALTER TABLE digital_interview_questions
  ADD COLUMN IF NOT EXISTS section text NOT NULL DEFAULT 'core',
  ADD COLUMN IF NOT EXISTS goal_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE digital_interview_question_candidates
  ADD COLUMN IF NOT EXISTS section text NOT NULL DEFAULT 'core',
  ADD COLUMN IF NOT EXISTS goal_ids text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS digital_interview_research_briefs (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id text NOT NULL,
  interview_id text NOT NULL,
  revision_id text NOT NULL,
  brief jsonb NOT NULL CHECK (jsonb_typeof(brief) = 'object'),
  rule_version text NOT NULL CHECK (length(btrim(rule_version)) > 0),
  request_id text NOT NULL CHECK (length(btrim(request_id)) > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, interview_id, revision_id),
  UNIQUE (org_id, interview_id, request_id),
  FOREIGN KEY (org_id, interview_id) REFERENCES interview_sessions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, revision_id) REFERENCES digital_interview_revisions(org_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS digital_interview_moderator_policies (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id text NOT NULL,
  interview_id text NOT NULL,
  revision_id text NOT NULL,
  question_version_id text NOT NULL,
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
  rule_version text NOT NULL CHECK (length(btrim(rule_version)) > 0),
  request_id text NOT NULL CHECK (length(btrim(request_id)) > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, interview_id, revision_id),
  UNIQUE (org_id, interview_id, request_id),
  FOREIGN KEY (org_id, interview_id) REFERENCES interview_sessions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, revision_id) REFERENCES digital_interview_revisions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, question_version_id) REFERENCES digital_interview_question_versions(org_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS digital_interview_readiness_decisions (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id text NOT NULL,
  interview_id text NOT NULL,
  revision_id text NOT NULL,
  assessment_rule_version text NOT NULL CHECK (length(btrim(assessment_rule_version)) > 0),
  status text NOT NULL CHECK (status IN ('ready', 'warning_accepted')),
  rationale text,
  request_id text NOT NULL CHECK (length(btrim(request_id)) > 0),
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, interview_id, revision_id),
  UNIQUE (org_id, interview_id, request_id),
  FOREIGN KEY (org_id, interview_id) REFERENCES interview_sessions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, revision_id) REFERENCES digital_interview_revisions(org_id, id) ON DELETE CASCADE,
  CHECK (
    (status = 'ready' AND rationale IS NULL)
    OR (status = 'warning_accepted' AND length(btrim(rationale)) BETWEEN 10 AND 300)
  )
);

CREATE TABLE IF NOT EXISTS digital_interview_report_reviews (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id text NOT NULL,
  interview_id text NOT NULL,
  revision_id text NOT NULL,
  report_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'changes_requested')),
  note text CHECK (note IS NULL OR length(btrim(note)) <= 1000),
  request_id text NOT NULL CHECK (length(btrim(request_id)) > 0),
  reviewed_by text,
  reviewed_at timestamptz,
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, interview_id, revision_id, report_id),
  UNIQUE (org_id, interview_id, request_id),
  FOREIGN KEY (org_id, interview_id) REFERENCES interview_sessions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, revision_id) REFERENCES digital_interview_revisions(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, report_id) REFERENCES digital_interview_reports(org_id, report_id) ON DELETE CASCADE,
  CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'changes_requested') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS digital_interview_research_briefs_revision_idx
  ON digital_interview_research_briefs(org_id, revision_id);
CREATE INDEX IF NOT EXISTS digital_interview_moderator_policies_revision_idx
  ON digital_interview_moderator_policies(org_id, revision_id);
CREATE INDEX IF NOT EXISTS digital_interview_readiness_decisions_revision_idx
  ON digital_interview_readiness_decisions(org_id, revision_id);
CREATE INDEX IF NOT EXISTS digital_interview_report_reviews_report_idx
  ON digital_interview_report_reviews(org_id, report_id);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'digital_interview_research_briefs',
    'digital_interview_moderator_policies',
    'digital_interview_readiness_decisions',
    'digital_interview_report_reviews'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      table_name || '_tenant', table_name
    );
  END LOOP;
END $$;

REVOKE ALL ON
  digital_interview_research_briefs,
  digital_interview_moderator_policies,
  digital_interview_readiness_decisions,
  digital_interview_report_reviews
FROM app_rw;

GRANT SELECT, INSERT, UPDATE ON
  digital_interview_research_briefs,
  digital_interview_moderator_policies,
  digital_interview_readiness_decisions,
  digital_interview_report_reviews
TO app_rw;

SELECT kernel_apply_org_freeze_policies();
