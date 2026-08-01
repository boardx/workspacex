-- F37: idempotent ingest (content_hash + pipeline_version + parser_version) + the four
-- extraction adapters' two new derived kinds (uc-22-2 R7, architecture 第七节门槛3).
--
-- ## The idempotency key, structurally
--
-- "同一文件连续上传两次不产生重复 Segment" (F37's user_visible_behavior) is decided at the
-- application layer, in `upload-artifact.ts`, BEFORE `materializeArtifact` is ever called --
-- a genuine duplicate never reaches `createVersion` at all, so no new `artifact_versions`
-- row, and therefore no new EXTRACTED/SEGMENTED jobs, and therefore no new Segments. That is
-- why this migration adds no dedup TRIGGER: there is nothing here to catch, the write simply
-- does not happen a second time.
--
-- What DOES need a place to live is the key's other two components. `content_hash` already
-- exists (0006); `pipeline_version` / `parser_version` do not, and the upload path needs to
-- read the ones an EXISTING version was written with in order to decide whether the file
-- just uploaded is the same content at the same pipeline/parser (idempotent hit) or the same
-- content re-run through a newer parser (a genuine new derived version, uc-22-2 R7's second
-- clause: "parser_version 升版后再上传新增派生版本而旧 Segment 未被修改").
--
-- Defaulted to '1' rather than left nullable: every pre-F37 row (surveys, conversations,
-- pins, bindings -- everything `materializeArtifact` has ever written) is retroactively "at
-- pipeline/parser version 1", which is the only value that was ever true for them (nothing
-- upstream of F37 varied a parser version).
ALTER TABLE artifact_versions
  ADD COLUMN IF NOT EXISTS pipeline_version text NOT NULL DEFAULT '1',
  ADD COLUMN IF NOT EXISTS parser_version   text NOT NULL DEFAULT '1';

-- The lookup index `upload-artifact.ts`'s dedup check runs before every materialize call.
-- Not UNIQUE: two DIFFERENT artifacts (e.g. two distinct surveys) can legitimately share a
-- content hash by coincidence, and that is not the duplicate this feature is about -- only
-- the upload path ever performs the lookup this index serves, and it additionally filters by
-- the artifact's `project_id` (joined from `artifacts`), which this index does not need to
-- repeat.
CREATE INDEX IF NOT EXISTS artifact_versions_idempotency_idx
  ON artifact_versions (org_id, content_hash, pipeline_version, parser_version);

-- The four extraction adapters' two new derived kinds -- `packages/contracts/src/artifact.ts`
-- is the single source (ADR-020); this constraint is its DB-side shadow, same technique
-- `artifact-schema-six-tables.test.ts` already audits for every other enum in this bundle.
-- `ocr` (image adapter) / `asr` (audio-video adapter) already existed; `parsed-text`
-- (PDF/Office/plain-text adapter) and `structured` (CSV/JSONL adapter) are F37's two.
ALTER TABLE derived_representations DROP CONSTRAINT IF EXISTS derived_representations_kind_check;
ALTER TABLE derived_representations ADD CONSTRAINT derived_representations_kind_check CHECK (kind IN (
  'ocr', 'asr', 'summary', 'embedding', 'visual-description', 'parsed-text', 'structured'
));
