-- F93: `segment_text.speaker_subject_id` -- the column the O-05 per-speaker Context Pack
-- front-filter is judged against (uc-6-5 R4/A2, uc-6-3 同意位).
--
-- ## Why this column, and why it is nullable and un-FK'd
--
-- A2 says the filter point is "Context Pack 构建阶段的 per-speaker 前置过滤，不是出口遮盖":
-- a segment whose speaker declined `ai_analysis` must never become an AI-facing candidate.
-- `retrieve-candidates.ts` already judges candidates on row-level facts it reads straight off
-- `segment_text` (`lifecycle`, `in_scope`, `confidential`) -- this is the same shape of fact,
-- added the same way.
--
-- Nullable because most segments have no interview speaker at all (files, surveys, workshop
-- notes) -- `NULL` means "not attributable to a consent-gated subject", not "unknown", and the
-- prefilter (`domain/context-pack/consent-prefilter.ts`) treats it as always eligible.
--
-- No foreign key to `interview_subjects` (F97, a different migration bundle, `20260801000000_
-- f97_interview_subjects.sql`): the two live in separate contract bundles (recording/retrieval
-- vs. interview), and `subject.ts`'s file header already registers the sibling case (recording's
-- three-item consent vs. interview's four `ConsentBits`, `KNOWN_CONTRACT_GAPS.C_ITV_2`) as
-- "deliberately not merged". Who actually WRITES this column -- transcription ingestion
-- resolving a `speakerChannelId` to a `personId` to a `subjectId` -- is the "跨分片依赖待确认"
-- gap the F93 issue itself names (phase-00 Context Pack construction has no defined hookup for
-- it yet). This migration only opens the column the filter reads; wiring the ingestion side to
-- populate it is out of this feature's scope and is not silently assumed done.
--
-- Replayable: `ADD COLUMN IF NOT EXISTS`, so `migrate:check` force-replaying this file is a
-- no-op the second time.

ALTER TABLE segment_text
  ADD COLUMN IF NOT EXISTS speaker_subject_id text;

COMMENT ON COLUMN segment_text.speaker_subject_id IS
  'F93/O-05: interview_subjects.id this segment is attributed to, when the source is an '
  'interview transcript with a resolved speaker. NULL = not attributable to a consent-gated '
  'subject (most segments). No FK across the interview/retrieval bundle boundary -- see this '
  'file''s header. Read by application/retrieval/retrieve-candidates.ts to keep segments whose '
  'speaker declined ai_analysis out of the Context Pack candidate set (front-filter, not an '
  'exit mask).';
