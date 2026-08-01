-- F44: version list (creator/changeSource per row) + derived_representations gains the
-- columns uc-22-4 needs (generatorVersion vs pipelineVersion are two different facts, and
-- embedding is "registered but not materialized" -- neither fits the F04 shape as it stood).
--
-- ## What F04 (0006) already gave this feature for free
--
--   * artifact_versions is immutable (BEFORE UPDATE trigger) -- "old version never
--     overwritten" (R7/V1) is already true at the schema level, this feature does not
--     re-derive it.
--   * derived_representations.derived_from -> artifact_versions.id, ON DELETE CASCADE --
--     "points at a VERSION, not an artifact" (N-15) is already the FK's shape.
--   * derived_key_not_an_original trigger -- a derivative can never claim an original's key.
--
-- ## What was missing for uc-22-4 specifically
--
--   1. `artifact_versions` has no per-version creator or change-source. F31's
--      creator_kind/agent_run_id live on `artifacts` (one value for the whole logical
--      object); the version LIST (R3.a step 2) needs "who made THIS version" and "upload /
--      materialize / rerun" per row, because two versions of the same artifact can come from
--      different actors and different triggers.
--   2. `derived_representations.object_storage_key` was NOT NULL -- correct for OCR/ASR/
--      summary (must be a real downloadable file, R3.b step 4) but wrong for `embedding`,
--      which R3.b step 4 explicitly excludes from materialization ("除 embedding 外"). The
--      column is relaxed to nullable, with a CHECK that still requires it for every kind
--      that DOES materialize -- embedding is the one representable exception, not a
--      loophole for the other four.
--   3. `generator_version` (the model's version) and `pipeline_version` (the extraction
--      pipeline's version) are two different facts the contract asks for separately
--      (`listDerived.out`) -- 0006 only had one `model_version` column.
--
-- Replayable: ADD COLUMN IF NOT EXISTS / idempotent constraint guards, same convention as
-- 0023.

ALTER TABLE artifact_versions
  ADD COLUMN IF NOT EXISTS creator_kind  text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS agent_run_id  text,
  -- 'upload' | 'materialize' | 'rerun' (VersionChangeSource, packages/contracts/src/files.ts).
  -- Default 'materialize': every version F04/F05/F06 wrote before this migration came from
  -- Studio materialization, never from the upload or rerun paths this feature adds.
  ADD COLUMN IF NOT EXISTS change_source text NOT NULL DEFAULT 'materialize';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artifact_versions_creator_kind_known') THEN
    ALTER TABLE artifact_versions ADD CONSTRAINT artifact_versions_creator_kind_known
      CHECK (creator_kind IN ('user', 'agent'));
  END IF;

  -- Same both-directions shape as artifacts_agent_run_id_iff_agent (0023) -- see that file's
  -- comment for why only checking one direction is how the pair drifts apart unnoticed.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artifact_versions_agent_run_id_iff_agent') THEN
    ALTER TABLE artifact_versions ADD CONSTRAINT artifact_versions_agent_run_id_iff_agent
      CHECK ((creator_kind = 'agent') = (agent_run_id IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artifact_versions_change_source_known') THEN
    ALTER TABLE artifact_versions ADD CONSTRAINT artifact_versions_change_source_known
      CHECK (change_source IN ('upload', 'materialize', 'rerun'));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------
-- derived_representations: pipeline_version, and object_storage_key nullable for embedding
-- ---------------------------------------------------------------------------------------
ALTER TABLE derived_representations
  ADD COLUMN IF NOT EXISTS pipeline_version text;

ALTER TABLE derived_representations
  ALTER COLUMN object_storage_key DROP NOT NULL;

DO $$
BEGIN
  -- R3.b step 4, restated as data: every kind except embedding MUST have a real object key.
  -- embedding is registered (the row exists, `derived_from` still points at the exact
  -- version) but is not itself a downloadable file -- it lives in pgvector, not here.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'derived_representations_materialized_unless_embedding') THEN
    ALTER TABLE derived_representations ADD CONSTRAINT derived_representations_materialized_unless_embedding
      CHECK (kind = 'embedding' OR object_storage_key IS NOT NULL);
  END IF;
END
$$;

-- Read path for the version list / derived list, newest first.
CREATE INDEX IF NOT EXISTS artifact_versions_list_idx
  ON artifact_versions (org_id, artifact_id, version_number DESC);

COMMENT ON COLUMN artifact_versions.change_source IS
  'upload | materialize | rerun -- what R3.a step 2''s version list shows per row (uc-22-4).';
COMMENT ON COLUMN derived_representations.object_storage_key IS
  'NULL only for kind = embedding (registered, not materialized -- R3.b step 4). Every other '
  'kind must have a real, independently downloadable object.';
