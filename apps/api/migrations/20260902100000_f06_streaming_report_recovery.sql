-- A report row now exists before the model finishes. Every complete NDJSON event is
-- committed into this row, so disconnecting the HTTP stream never discards progress.
ALTER TABLE digital_interview_reports
  ALTER COLUMN title DROP NOT NULL,
  ALTER COLUMN executive_summary DROP NOT NULL,
  ALTER COLUMN markdown DROP NOT NULL,
  ALTER COLUMN findings SET DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS generation_status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE digital_interview_reports
  DROP CONSTRAINT IF EXISTS digital_interview_reports_title_check,
  DROP CONSTRAINT IF EXISTS digital_interview_reports_executive_summary_check,
  DROP CONSTRAINT IF EXISTS digital_interview_reports_markdown_check,
  DROP CONSTRAINT IF EXISTS digital_interview_reports_generation_status_check,
  DROP CONSTRAINT IF EXISTS digital_interview_reports_completed_shape_check,
  DROP CONSTRAINT IF EXISTS digital_interview_reports_running_request_check;

ALTER TABLE digital_interview_reports
  ADD CONSTRAINT digital_interview_reports_generation_status_check
    CHECK (generation_status IN ('running', 'completed', 'failed')),
  ADD CONSTRAINT digital_interview_reports_completed_shape_check
    CHECK (
      generation_status <> 'completed'
      OR (
        length(btrim(coalesce(title, ''))) > 0
        AND length(btrim(coalesce(executive_summary, ''))) > 0
        AND length(btrim(coalesce(markdown, ''))) > 0
        AND jsonb_array_length(findings) > 0
      )
    ),
  ADD CONSTRAINT digital_interview_reports_running_request_check
    CHECK (generation_status = 'completed' OR length(btrim(coalesce(request_id, ''))) > 0);

CREATE UNIQUE INDEX IF NOT EXISTS digital_interview_reports_request_uq
  ON digital_interview_reports (org_id, interview_id, request_id)
  WHERE request_id IS NOT NULL;
