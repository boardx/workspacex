-- F167 / #1069 -- personal realtime transcription has one editable body.
ALTER TABLE personal_transcriptions
  ADD COLUMN IF NOT EXISTS content text NOT NULL DEFAULT '';

WITH folded AS (
  SELECT p.id,
         string_agg(seg.text, ' ' ORDER BY rs.started_at, rs.id, seg.ordinal) AS content
    FROM personal_transcriptions p
    JOIN recording_sessions rs
      ON rs.org_id=p.org_id AND rs.source_type='personal' AND rs.source_ref_id=p.id
    JOIN recording_segments seg
      ON seg.org_id=rs.org_id AND seg.session_id=rs.id AND seg.status='final'
   GROUP BY p.id
)
UPDATE personal_transcriptions p
   SET content=folded.content
  FROM folded
 WHERE p.id=folded.id AND p.content='';

DELETE FROM recording_segments seg
 USING recording_sessions rs
 WHERE seg.org_id=rs.org_id AND seg.session_id=rs.id AND rs.source_type='personal';

GRANT UPDATE (content) ON personal_transcriptions TO app_rw;
