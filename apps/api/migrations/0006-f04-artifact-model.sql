-- 0006 F04: the Artifact model -- six tables, file-first, S3/PG dual canonical
-- (uc-0-1 R1/R7, contracts/artifact/domain.md)
--
-- ## The six tables, and why only five are created here
--
--   artifacts                  logical object
--   artifact_versions          IMMUTABLE version -- the "pinned snapshot" itself
--   segments                   smallest citable unit
--   anchors                    the way back to a page / timecode / message / question
--   derived_representations    OCR / ASR / summary / embedding -- separate files
--   provenance_events          ALREADY EXISTS (0005)
--
-- The sixth is not re-created. 0005 built `provenance_events` for the admin-audit trail and
-- said in writing that it is ONE table with ONE query surface shared by the identity and
-- artifact bundles (coherence X-2). Creating an `artifact_provenance_events` here would be
-- the seventh instance of one fact in two places, and it is the instance the coherence
-- review specifically pre-empted. What F04 adds to it is nothing: the event TYPES this
-- bundle writes are already in its CHECK constraint.
--
-- ## S3/PG dual canonical -- what is authoritative where
--
--   the BYTES              canonical in object storage. Not in this database, not
--                          recoverable from it. There is deliberately no blob column
--                          anywhere below (I-4), and a test reads the catalog to prove it.
--   metadata / state /     canonical in PostgreSQL. Object storage does not carry version
--   lineage / permission   lineage, and cannot answer "which version was pinned".
--
-- Neither side can rebuild the other, so restoring one alone is data corruption, not a
-- partial recovery. That is a BACKUP-DRILL obligation, not something this file can enforce;
-- it is stated here because the place people look for it is the schema.
--
-- ## What this migration does NOT decide
--
-- Bindings (three modes), the pin API's optimistic-concurrency response, downstream
-- reference gating and the reflow audit belong to F05-F08. This file lays the model those
-- need and enforces the invariants that are properties of the DATA rather than of an
-- endpoint -- an endpoint-level rule enforced only in an endpoint holds until the second
-- endpoint.
--
-- Replayable: every statement is IF NOT EXISTS / OR REPLACE / DROP-then-CREATE, because
-- migrate:check force-replays each file ignoring the version table.

-- ---------------------------------------------------------------------------------------
-- artifacts
-- ---------------------------------------------------------------------------------------
-- ⚠ There is deliberately NO `scope` column here, although `Artifact.scope` appears in the
-- API contract.
--
-- `acl_bindings` already carries (scope, owner_team_id) per object, and `authorize()` reads
-- its verdict from there and nowhere else. A second `artifacts.scope` would be a second
-- answer to "who may see this artifact" -- and the one the authorizer does not consult is
-- the one that is wrong while looking right. So the contract's `Artifact.scope` is a READ
-- MODEL projected from the binding (unbound => org-wide, the documented default), never a
-- stored fact. Reported as a contract finding rather than silently resolved.
CREATE TABLE IF NOT EXISTS artifacts (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Nullable on purpose (A1): a Studio can be started without a project, and the save path
  -- must work then. ON DELETE SET NULL rather than CASCADE -- the bytes live in object
  -- storage and outlive the project; deleting a project must not silently destroy them.
  project_id    text REFERENCES projects (id) ON DELETE SET NULL,
  -- Closed enum, a copy of ArtifactSource in packages/contracts/src/artifact.ts. It is not
  -- LEFT as a copy: artifact-schema-six-tables.test.ts reads this constraint out of
  -- pg_catalog and asserts it equals the contract enum member for member (same technique
  -- 0005 uses for provenance_events.type, for the same reason).
  source        text NOT NULL CHECK (source IN (
    'survey', 'conversation', 'interview', 'prototype-run', 'research-run', 'upload',
    'ai-generated'
  )),
  title         text NOT NULL,
  created_by    text NOT NULL,
  -- The synthesized flag exists so AI output cannot pass as first-hand evidence in
  -- retrieval. A row that says source='ai-generated' AND synthesized=false is that exact
  -- disguise, so it is not representable. No DEFAULT: the writer has to state it.
  synthesized   boolean NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifacts_ai_is_synthesized CHECK (source <> 'ai-generated' OR synthesized)
);

CREATE INDEX IF NOT EXISTS artifacts_project_idx ON artifacts (org_id, project_id);

-- ---------------------------------------------------------------------------------------
-- artifact_versions -- the immutable half
-- ---------------------------------------------------------------------------------------
-- A "pinned snapshot" IS one row here (domain.md): object key + SHA-256 + MIME + version
-- number, written once. It is not an application-level boolean, because a boolean can be
-- flipped and a written row can be made physically unwritable.
CREATE TABLE IF NOT EXISTS artifact_versions (
  id                 text PRIMARY KEY,
  org_id             text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  artifact_id        text NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
  version_number     integer NOT NULL CHECK (version_number > 0),
  -- The pointer, and the whole of what PG knows about the bytes. I-4: no blob column here
  -- or anywhere below.
  object_storage_key text NOT NULL CHECK (length(object_storage_key) > 0),
  -- Lowercase hex SHA-256. Constrained to shape because "the hash column contained
  -- something that was not a hash" is only discoverable at verification time otherwise,
  -- i.e. during an audit, i.e. at the worst moment.
  content_hash       text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  mime               text NOT NULL CHECK (length(mime) > 0),
  -- file-first (I-5): a version with no bytes is not a version. A zero-byte "file" is the
  -- shape a failed materialization takes when nobody checks, so 0 is excluded here rather
  -- than hoped about in the writer.
  size_bytes         bigint NOT NULL CHECK (size_bytes > 0),
  pinned_by          text NOT NULL,
  pinned_at          timestamptz NOT NULL DEFAULT now(),
  -- "What was this conclusion looking at" (UC-0.2). Nullable: ingested originals have no
  -- Context Pack. No FK -- context_packs arrives with F09/F10 and a dangling FK target
  -- would make this file un-replayable on its own.
  context_pack_id    text,
  -- I-10: version numbers are monotonic and unique within an artifact. This unique index is
  -- what makes concurrent pinning produce ONE new version rather than two v2s; F05 turns
  -- the resulting violation into VERSION_CHANGED.
  CONSTRAINT artifact_versions_uniq_number UNIQUE (artifact_id, version_number),
  -- The PG-side shadow of I-2. I-2 proper ("PUT to an existing key is refused") is an
  -- object-store guarantee and cannot be made here -- but two version rows sharing one key
  -- means one version's bytes were overwritten by another's, and that IS expressible.
  CONSTRAINT artifact_versions_uniq_key UNIQUE (object_storage_key)
);

CREATE INDEX IF NOT EXISTS artifact_versions_artifact_idx
  ON artifact_versions (org_id, artifact_id, version_number DESC);

-- ---------------------------------------------------------------------------------------
-- segments / anchors -- granularity reaches Segment, and every Segment can get home
-- ---------------------------------------------------------------------------------------
-- Segments hang off a VERSION, never off the mutable artifact. A citation pinned to
-- "artifact X, segment 4" that follows the artifact forward is the drift D-30 exists to
-- prevent, and the schema is where that is settled.
--
-- Segment granularity is also what `acl_bindings.object_kind = 'segment'` has been
-- promising since 0003. Until this table existed that promise had no referent.
CREATE TABLE IF NOT EXISTS segments (
  id                  text PRIMARY KEY,
  org_id              text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  artifact_version_id text NOT NULL REFERENCES artifact_versions (id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('text', 'message', 'answer', 'audio-span')),
  ordinal             integer NOT NULL CHECK (ordinal >= 0),
  CONSTRAINT segments_uniq_ordinal UNIQUE (artifact_version_id, ordinal)
);

CREATE INDEX IF NOT EXISTS segments_version_idx ON segments (org_id, artifact_version_id, ordinal);

CREATE TABLE IF NOT EXISTS anchors (
  id         text PRIMARY KEY,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  segment_id text NOT NULL REFERENCES segments (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN (
    'page', 'bbox', 'timecode', 'message-id', 'question-no', 'image-region'
  )),
  -- Interpreted according to `kind`. Non-empty because an anchor that locates nothing is
  -- indistinguishable from no anchor, and I-7 counts anchors.
  locator    text NOT NULL CHECK (length(locator) > 0)
);

CREATE INDEX IF NOT EXISTS anchors_segment_idx ON anchors (org_id, segment_id);

-- ---------------------------------------------------------------------------------------
-- derived_representations -- OCR / ASR / summary / embedding, as separate files
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS derived_representations (
  id                 text PRIMARY KEY,
  org_id             text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- I-6: points at a VERSION, so a derivative is always attributable to exact bytes.
  derived_from       text NOT NULL REFERENCES artifact_versions (id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN (
    'ocr', 'asr', 'summary', 'embedding', 'visual-description'
  )),
  -- Derived output is a real, downloadable file too -- not a text column. Same file-first
  -- rule as the original; the file browser shows both.
  object_storage_key text NOT NULL CHECK (length(object_storage_key) > 0),
  model              text,
  model_version      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT derived_representations_uniq_key UNIQUE (object_storage_key)
);

CREATE INDEX IF NOT EXISTS derived_representations_source_idx
  ON derived_representations (org_id, derived_from);

-- I-6, the half a foreign key cannot state: a derivative must not be WRITTEN OVER its
-- original.
--
-- The failure is concrete and boring -- an OCR step that emits to the key it read from.
-- Afterwards the version row still says `content_hash = X` and the object at that key
-- hashes to something else, so the corruption is only discovered by a verification pass,
-- long after the original is gone. The FK cannot see it (it constrains `derived_from`, not
-- the key), and the per-table UNIQUE cannot see it (the collision is across two tables).
CREATE OR REPLACE FUNCTION derived_key_not_an_original() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM artifact_versions v WHERE v.object_storage_key = NEW.object_storage_key) THEN
    RAISE EXCEPTION
      'derived representation % would write over an original at key % (invariant I-6)',
      NEW.id, NEW.object_storage_key;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS derived_key_not_an_original_trg ON derived_representations;
CREATE TRIGGER derived_key_not_an_original_trg
  BEFORE INSERT OR UPDATE ON derived_representations
  FOR EACH ROW EXECUTE FUNCTION derived_key_not_an_original();

-- ---------------------------------------------------------------------------------------
-- I-1 / I-11: a written version is never rewritten
-- ---------------------------------------------------------------------------------------
-- Two mechanisms, because they stop different people:
--
--   REVOKE UPDATE, DELETE from app_rw   nothing serving traffic can touch a version at all.
--                                       This is the guarantee that survives a bug in every
--                                       line of application code.
--   BEFORE UPDATE trigger               refuses an UPDATE even from the OWNER, i.e. from a
--                                       migration or a psql session. The revoke alone would
--                                       leave "fix it by hand in prod" available, and that
--                                       is the way an immutable record actually gets
--                                       rewritten in practice.
--
-- DELETE is NOT trigger-blocked, and that asymmetry is deliberate. ON DELETE CASCADE from
-- `organizations` is how tenant removal works, and coherence X-4 rules that compliance
-- withdrawal is the ONE hole in immutability -- it must delete from S3 and PG together, or
-- the pointer dangles. So deletion stays possible OWNER-SIDE, where it is an operation
-- somebody performs on purpose, and impossible for the runtime role. What is guaranteed is
-- that no request can destroy or alter a snapshot.
--
-- ⚠ X-4's other half is still open upstream: which snapshots are under a legal hold and
-- therefore not deletable at all depends on O-39, which is an unfilled external compliance
-- input. Nothing here pretends to answer it.
CREATE OR REPLACE FUNCTION artifact_version_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'SNAPSHOT_IMMUTABLE: artifact_version % is immutable (invariant I-1/I-11); correct it by adding a new version',
    OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS artifact_version_immutable_trg ON artifact_versions;
CREATE TRIGGER artifact_version_immutable_trg
  BEFORE UPDATE ON artifact_versions
  FOR EACH ROW EXECUTE FUNCTION artifact_version_immutable();

-- ---------------------------------------------------------------------------------------
-- I-7: every Segment has at least one Anchor
-- ---------------------------------------------------------------------------------------
-- A plain CHECK cannot express it (it spans tables) and a BEFORE INSERT trigger cannot
-- either -- the anchor does not exist yet when the segment is inserted, so any immediate
-- check makes the correct insert order impossible.
--
-- A DEFERRABLE constraint trigger asks the question at COMMIT, which is the only moment the
-- answer is meaningful: within the transaction the pair is being built, at the end it is
-- either complete or it is a segment nobody can trace back to the original. The second one
-- is the state I-7 exists to forbid, and forbidding it in the ingestion pipeline instead
-- would mean it holds for the first pipeline and not the second.
--
-- Both directions are covered: inserting a segment with no anchor, AND deleting the last
-- anchor of a segment that still exists. Only the first is obvious, and only having the
-- first is how the invariant becomes false a year later without anything failing.
CREATE OR REPLACE FUNCTION segment_has_anchor() RETURNS trigger AS $$
DECLARE
  sid text;
BEGIN
  -- Branched, not a CASE expression in the DECLARE. One function serves triggers on two
  -- tables, and a DECLARE default is evaluated on entry for BOTH -- so `OLD.segment_id`
  -- there fails with "record OLD has no field segment_id" when the segments INSERT trigger
  -- fires. Inside an IF, each field reference is only resolved on the branch that runs.
  IF TG_OP = 'DELETE' THEN
    sid := OLD.segment_id;
    -- The segment itself may be gone (cascade); then there is nothing to strand.
    IF NOT EXISTS (SELECT 1 FROM segments s WHERE s.id = sid) THEN
      RETURN NULL;
    END IF;
  ELSE
    sid := NEW.id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM anchors a WHERE a.segment_id = sid) THEN
    RAISE EXCEPTION
      'segment % has no anchor (invariant I-7): a segment that cannot be traced back to a page / timecode / message / question is not citable',
      sid;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS segment_has_anchor_trg ON segments;
CREATE CONSTRAINT TRIGGER segment_has_anchor_trg
  AFTER INSERT OR UPDATE ON segments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION segment_has_anchor();

DROP TRIGGER IF EXISTS anchor_last_one_trg ON anchors;
CREATE CONSTRAINT TRIGGER anchor_last_one_trg
  AFTER DELETE ON anchors
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION segment_has_anchor();

-- ---------------------------------------------------------------------------------------
-- Closing 0003's stated gap: acl_bindings may now name artifacts and segments
-- ---------------------------------------------------------------------------------------
-- 0003 wrote: "artifact/segment objects are not validated yet: those tables arrive with
-- F04. The trigger validates what exists and is written so adding them is one line each.
-- This is a KNOWN GAP, stated rather than left for someone to discover." The tables now
-- exist, so the gap closes here.
--
-- Why an unvalidated binding is not merely untidy: `acl_bindings_uniq` keys on
-- (org, subject, object_kind, object_id), and object ids are supplied by callers. A binding
-- naming an artifact id that does not exist sits there silently, and the day an artifact IS
-- created with that id -- a re-used external id, a restored backup, a Studio that mints ids
-- from a title -- it arrives pre-granted to whoever the stale row names. That is not a read
-- error anyone would see; it authorises.
--
-- Whole function restated rather than patched, because CREATE OR REPLACE FUNCTION has no
-- partial form. The subject half is unchanged from 0003.
CREATE OR REPLACE FUNCTION acl_binding_same_org() RETURNS trigger AS $$
DECLARE
  subject_org text;
  object_org  text;
BEGIN
  IF NEW.subject_kind = 'user' THEN
    SELECT org_id INTO subject_org FROM org_memberships WHERE user_id = NEW.subject_id AND org_id = NEW.org_id;
  ELSIF NEW.subject_kind = 'team' THEN
    SELECT org_id INTO subject_org FROM teams WHERE id = NEW.subject_id;
  ELSIF NEW.subject_kind = 'group' THEN
    SELECT org_id INTO subject_org FROM groups WHERE id = NEW.subject_id;
  END IF;

  IF subject_org IS NULL OR subject_org <> NEW.org_id THEN
    RAISE EXCEPTION 'acl_binding subject % / % does not belong to org % (invariant I-1)',
      NEW.subject_kind, NEW.subject_id, NEW.org_id;
  END IF;

  IF NEW.object_kind = 'project' THEN
    SELECT org_id INTO object_org FROM projects WHERE id = NEW.object_id;
  ELSIF NEW.object_kind = 'artifact' THEN
    SELECT org_id INTO object_org FROM artifacts WHERE id = NEW.object_id;
  ELSIF NEW.object_kind = 'segment' THEN
    SELECT org_id INTO object_org FROM segments WHERE id = NEW.object_id;
  END IF;

  -- One check for all three kinds now that all three resolve. NOT FOUND and WRONG ORG are
  -- deliberately the same verdict: under RLS another tenant's row IS not-found, so treating
  -- them differently would make the trigger's behaviour depend on who is connected.
  IF object_org IS NULL OR object_org <> NEW.org_id THEN
    RAISE EXCEPTION 'acl_binding object % % does not exist in org % (invariant I-1)',
      NEW.object_kind, NEW.object_id, NEW.org_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS acl_binding_same_org_trg ON acl_bindings;
CREATE TRIGGER acl_binding_same_org_trg
  BEFORE INSERT OR UPDATE ON acl_bindings
  FOR EACH ROW EXECUTE FUNCTION acl_binding_same_org();

-- ---------------------------------------------------------------------------------------
-- RLS on all five, same rule as every other tenant table
-- ---------------------------------------------------------------------------------------
-- kernel_tenant_table_audit() (0004) picks these up from the catalog the moment they exist,
-- so verify-rls.sh fails if this block is ever forgotten. That is the intended relationship:
-- the gate is not told about new tables, it finds them.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['artifacts', 'artifact_versions', 'segments', 'anchors', 'derived_representations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    -- current_setting(..., true) is NULL when unset, so an un-scoped query sees nothing
    -- (fail-closed) rather than everything.
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      t || '_tenant', t);
  END LOOP;
END
$$;

-- Grants, narrowed per table. REVOKE first so a database that received an earlier version
-- of this file converges rather than accumulating privileges.
REVOKE ALL ON artifacts, artifact_versions, segments, anchors, derived_representations FROM app_rw;

-- The mutable head: title, project attachment and the draft buffer all change here.
GRANT SELECT, INSERT, UPDATE, DELETE ON artifacts TO app_rw;

-- I-1: insert and read only. See the trigger note above.
GRANT SELECT, INSERT ON artifact_versions TO app_rw;

-- Re-ingestion produces NEW segments for a new version; it never edits the old ones in
-- place, because a citation anchored to segment 4 must not silently start pointing at
-- different text. INSERT and DELETE, deliberately no UPDATE.
GRANT SELECT, INSERT, DELETE ON segments TO app_rw;
GRANT SELECT, INSERT, DELETE ON anchors TO app_rw;

-- "Re-running ingestion only produces a new derived version, it does not modify old
-- results" (domain.md). Same shape as artifact_versions, for the same reason.
GRANT SELECT, INSERT ON derived_representations TO app_rw;

COMMENT ON TABLE artifact_versions IS
  'Immutable versions. The BYTES are canonical in object storage; this table holds the '
  'pointer, the SHA-256 and the lineage, which object storage cannot hold. Neither side '
  'can rebuild the other -- a restore that recovers only one of them is data corruption.';
