ALTER TABLE interview_sessions
  ADD COLUMN IF NOT EXISTS study_evidence_mode text NOT NULL DEFAULT 'simulated';

ALTER TABLE interview_sessions
  DROP CONSTRAINT IF EXISTS interview_sessions_study_evidence_mode_check;

ALTER TABLE interview_sessions
  ADD CONSTRAINT interview_sessions_study_evidence_mode_check
    CHECK (study_evidence_mode IN ('simulated', 'mixed', 'participant'));

ALTER TABLE digital_interview_reports
  ADD COLUMN IF NOT EXISTS report_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_report_id text NULL,
  ADD COLUMN IF NOT EXISTS review_state jsonb NOT NULL DEFAULT '{"eligibility":"blocked_missing_participant_evidence","message":"需要真实受访者证据后才能批准。","action":"添加并复核真实受访者回答"}'::jsonb;
