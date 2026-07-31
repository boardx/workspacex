-- F73: recording artefacts registered through F04's real tables, not a parallel index
-- (contracts/phase-01/recording/domain.md X-1, design-signoff.md §覆盖 feature 一览).
--
-- ## What F73 is, precisely
--
-- A finished recording session produces real files -- the audio, `transcript.jsonl`, and for
-- interviews a `notes.md` -- and F73's whole job is to make those files show up as ordinary
-- `artifacts` rows, visible and downloadable through the SAME file browser F31/F32 already
-- built (`wsx_visible_artifacts()`, migration 0023). Nothing here creates a second table for
-- "recording materials": the recording bundle explicitly may not (X-1 says so in as many
-- words), because a second index is exactly the class of bug this repository keeps re-making
-- (「同一事实两处声明」).
--
-- ## The one thing that IS new: `derived_from`
--
-- uc-5-1 R10 requires the transcript to carry a pointer back to the exact audio
-- `artifact_version` it was produced from, and for that pointer to survive while the audio's
-- SHA-256 never changes. `derived_representations.derived_from` (0006) cannot serve this: rows
-- in that table are NOT part of `wsx_visible_artifacts()` / the file browser's FROM clause
-- (`pg-artifact-browser-repository.ts`), so a transcript stored there would satisfy "has
-- derived_from" while failing the actually-visible acceptance criterion. The transcript has to
-- be its own `artifacts` + `artifact_versions` row to be visible at all, which means the
-- pointer has to live on `artifact_versions` itself.
--
-- `derived_from` is nullable and self-referential:
--   * NULL for the audio version (nothing produced it -- it IS the original, I-28).
--   * the audio version's id for the transcript / notes versions of the SAME session.
--   * NULL for any session with no audio at all (the transcript is then its own original).
--
-- ⚠ This is deliberately NOT a rename or a replacement of `derived_representations`. That
-- table keeps serving OCR/ASR/summary/embedding derivatives that are not meant to be browsed
-- as first-class files (`domain.md` recording X-1 is only about recording materials becoming
-- files; it says nothing about superseding F04's existing derived-representation model for
-- everything else). Two mechanisms for two different questions: "is this thing a downloadable
-- file in the browser" (artifact_versions.derived_from) vs "is this thing a non-browsable
-- derivative of a version" (derived_representations).
--
-- Replayable: ADD COLUMN IF NOT EXISTS / index IF NOT EXISTS, per migrate:check's force-replay.

ALTER TABLE artifact_versions
  ADD COLUMN IF NOT EXISTS derived_from text REFERENCES artifact_versions (id) ON DELETE SET NULL;

-- A version cannot be derived from itself -- the degenerate case a self-referential FK cannot
-- rule out on its own.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'artifact_versions_derived_from_not_self'
  ) THEN
    ALTER TABLE artifact_versions ADD CONSTRAINT artifact_versions_derived_from_not_self
      CHECK (derived_from IS NULL OR derived_from <> id);
  END IF;
END
$$;

-- The read F73's own use case does ("did materializing the transcript touch the audio row"),
-- and the shape any future 「这份材料是从哪个原件来的」 read will want.
CREATE INDEX IF NOT EXISTS artifact_versions_derived_from_idx
  ON artifact_versions (org_id, derived_from) WHERE derived_from IS NOT NULL;
