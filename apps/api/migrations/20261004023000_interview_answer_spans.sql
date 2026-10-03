-- Server-written offsets only. Existing answer bodies remain verbatim and unattributed.
ALTER TABLE digital_interview_artifact_versions
  ADD COLUMN IF NOT EXISTS answer_spans jsonb NOT NULL DEFAULT '[]'::jsonb;
