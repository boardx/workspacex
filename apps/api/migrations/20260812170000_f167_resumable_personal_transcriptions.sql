-- A personal transcription is a reusable document. Stopping one capture never completes it.
UPDATE personal_transcriptions SET status = 'idle' WHERE status = 'completed';

ALTER TABLE personal_transcriptions
  DROP CONSTRAINT IF EXISTS personal_transcriptions_status_check;
ALTER TABLE personal_transcriptions
  ADD CONSTRAINT personal_transcriptions_status_check
  CHECK (status IN ('idle', 'recording', 'failed'));
