-- Preserve the last completed report across process termination during replacement.
ALTER TABLE digital_interview_reports
  ADD COLUMN IF NOT EXISTS previous_report jsonb;
