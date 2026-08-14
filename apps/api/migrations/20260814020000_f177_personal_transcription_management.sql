-- F177 keeps content-free ASR usage audit after a user deletes the transcription and capture.
ALTER TABLE realtime_asr_usage_events
  DROP CONSTRAINT IF EXISTS realtime_asr_usage_events_capture_id_org_id_fkey;

GRANT DELETE ON personal_transcriptions, recording_sessions TO app_rw;

SELECT kernel_apply_org_freeze_policies();
