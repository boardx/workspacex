-- Studio history metadata may clear every tag. Keep the workflow state/topic/version
-- invariants unchanged; labels do not determine whether a digital interview is valid.
ALTER TABLE interview_sessions
  DROP CONSTRAINT IF EXISTS interview_sessions_digital_draft_fields_check;
ALTER TABLE interview_sessions
  ADD CONSTRAINT interview_sessions_digital_draft_fields_check
  CHECK (
    digital_status IS NULL OR (
      source_kind = 'virtual'
      AND version > 0
      AND (
        (digital_status = 'topic_pending' AND (
          topic IS NULL OR length(btrim(topic)) > 0
        ))
        OR (digital_status <> 'topic_pending' AND topic IS NOT NULL AND length(btrim(topic)) > 0)
      )
    )
  );
