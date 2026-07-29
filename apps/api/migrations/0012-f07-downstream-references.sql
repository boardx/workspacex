-- 0010 F07: the downstream reference eligibility gate
-- (uc-0-1 R6 / AC1 / R12 V1, contracts/artifact/domain.md I-14, coverage gap ③)
--
-- ## What this table is, and why it is a TABLE and not a check
--
-- R6 says a Studio product may be cited as a decision basis, submitted for acceptance, put
-- into the final report, written back to the knowledge graph or promoted into the org brain
-- ONLY as a fixed snapshot. I-14 states the same thing as an invariant and adds the half
-- that matters: "扫描下游引用表无非 pinned 指针" -- the assertion is over a TABLE of
-- references, not over the return value of one function call.
--
-- Coverage gap ③ is explicit that the five downstreams live in other bundles
-- (context-pack / 13-deliv / 10-report / 09-kg / 14-brain) and that每个下游都必须过同一个
-- `referenceForDownstream` 门, 不各判各的. A gate implemented only inside a use case is a
-- gate the sixth downstream walks past -- and nothing would report it, because that
-- downstream would have its own tests, all green. So the door is a table with a trigger on
-- it: to cite a snapshot you insert here, and the database decides whether you may.
--
-- ## The eligibility rule
--
--   citable(version) ⟺ ∃ binding b : b.mode = 'pinned' ∧ b.pinned_version_id = version.id
--
-- ⚠ This is NOT the literal reading of the contract, and the divergence is reported rather
-- than hidden. `referenceForDownstream.in` carries only a `versionId`, and every
-- `artifact_versions` row is by construction an immutable snapshot -- so under the literal
-- reading every call is eligible, `REQUIRES_PINNED` is unreachable, and the feature whose
-- whole value is a refusal can never refuse. That is the shape this project has recorded
-- nine times as "green and idle".
--
-- Eligibility is a property of the BINDING, not of the version: `live` resolves to whatever
-- the head is at read time (so what a reader would see is not what the citer saw), and
-- `draft` is not on the project side at all. `pinned` is the only mode that promises the
-- bytes stay put. See `src/domain/artifact/downstream-eligibility.ts`.
--
-- ## What is NOT here
--
-- No UPDATE and no DELETE for the runtime role, and no unreference operation anywhere in
-- `usecases.md`. E5 (`markEvidenceWithdrawn`) is explicit that a withdrawn upstream evidence
-- is ANNOTATED at the reference, not removed -- 不修改快照内容, 不自动改已签字结论. A
-- privilege for an operation the contract does not have is how the first implementation of
-- it ends up being an ad-hoc DELETE.
--
-- Replayable in isolation: IF NOT EXISTS / CREATE OR REPLACE / DROP-then-CREATE throughout,
-- because migrate:check force-replays every file ignoring the version table.

CREATE TABLE IF NOT EXISTS downstream_references (
  id                 text PRIMARY KEY,
  org_id             text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- The snapshot being cited. ON DELETE CASCADE is declared and unreachable in practice:
  -- 0007 refuses to delete an artifact_version at all outside tenant teardown. It is
  -- declared so that tearing a tenant down does not deadlock on a RESTRICT.
  version_id         text NOT NULL REFERENCES artifact_versions (id) ON DELETE CASCADE,
  -- Closed enum, a copy of DownstreamPurpose in packages/contracts/src/artifact.ts, and NOT
  -- left as a copy: reference-eligibility-gate.test.ts reads this constraint out of
  -- pg_catalog and asserts it equals the contract enum member for member (the technique
  -- 0005 / 0006 / 0008 use).
  purpose            text NOT NULL CHECK (purpose IN (
                       'report-final', 'acceptance', 'decision-reference',
                       'graph-writeback', 'brain-promotion')),
  -- Who is doing the citing: a claim, a report section, a graph node, an acceptance record.
  -- ⚠ `referencedBy.kind` is `z.string()` in the contract -- an OPEN vocabulary. It is
  -- stored as given and only constrained to be non-empty; closing it would require knowing
  -- the five downstream bundles' object kinds, which do not exist yet. Reported.
  referenced_by_kind text NOT NULL CHECK (length(referenced_by_kind) > 0),
  referenced_by_id   text NOT NULL CHECK (length(referenced_by_id) > 0),
  created_by         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- One citation per (downstream object, purpose, snapshot). NOT per (downstream object,
  -- purpose): a claim cites several pieces of evidence and a report section cites several
  -- products, so keying uniqueness without the version would forbid the ordinary case. What
  -- it does buy is idempotency -- a retried POST finds its own row instead of creating a
  -- second citation of the same snapshot by the same citer.
  CONSTRAINT downstream_references_uniq
    UNIQUE (org_id, purpose, referenced_by_kind, referenced_by_id, version_id)
);

-- Constraint back-fill.
--
-- `CREATE TABLE IF NOT EXISTS` against an existing table is a SILENT no-op: none of the
-- CHECKs or the UNIQUE above would be added to a database that already has an older shape,
-- and the file would still report success. This block re-asserts them unconditionally, so
-- replay onto a partially-built database converges instead of merely not erroring.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'downstream_references_uniq') THEN
    ALTER TABLE downstream_references
      ADD CONSTRAINT downstream_references_uniq
      UNIQUE (org_id, purpose, referenced_by_kind, referenced_by_id, version_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'downstream_references_purpose_check') THEN
    ALTER TABLE downstream_references
      ADD CONSTRAINT downstream_references_purpose_check
      CHECK (purpose IN ('report-final', 'acceptance', 'decision-reference',
                         'graph-writeback', 'brain-promotion'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS downstream_references_version_idx
  ON downstream_references (org_id, version_id);

-- ---------------------------------------------------------------------------------------
-- The gate itself: only a pinned snapshot may be cited (AC1 / I-14)
-- ---------------------------------------------------------------------------------------
-- In the DATABASE and not only in the use case. There are five downstream consumers coming,
-- in five different bundles, and a rule held in one use case holds until the second caller.
-- This is the same reasoning 0008 gives for `binding_mode_monotonic`, applied to the door
-- rather than to the room.
--
-- The refusal message carries the ARTIFACT id, not just the version id: E1 requires the
-- interface to offer 一键定版, and it cannot address an artifact it was never told about.
CREATE OR REPLACE FUNCTION downstream_reference_requires_pinned() RETURNS trigger AS $$
DECLARE
  owning_artifact text;
BEGIN
  SELECT v.artifact_id INTO owning_artifact
    FROM artifact_versions v
   WHERE v.id = NEW.version_id AND v.org_id = NEW.org_id;

  IF owning_artifact IS NULL THEN
    -- The FK already refuses a version that does not exist; this fires for a version in
    -- ANOTHER tenant, which the FK happily accepts (it is not tenant-aware). Same answer as
    -- everywhere else: not-found, never "exists but not yours".
    RAISE EXCEPTION
      'ARTIFACT_NOT_FOUND: version % is not a version in organization %',
      NEW.version_id, NEW.org_id
      USING ERRCODE = 'raise_exception';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM artifact_bindings b
     WHERE b.org_id = NEW.org_id
       AND b.mode = 'pinned'
       AND b.pinned_version_id = NEW.version_id
  ) THEN
    RAISE EXCEPTION
      'REQUIRES_PINNED: version % of artifact % is not pinned to any project step, so it cannot be cited for %',
      NEW.version_id, owning_artifact, NEW.purpose
      USING ERRCODE = 'raise_exception',
            DETAIL  = 'A live binding resolves to the head at read time and a draft is not on the project side at all; neither promises the reader the bytes the citer saw.',
            HINT    = 'Pin the artifact to the step first (bindToProjectStep / upgradeBinding), then cite the pinned version.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS downstream_reference_requires_pinned_trg ON downstream_references;
CREATE TRIGGER downstream_reference_requires_pinned_trg
  BEFORE INSERT OR UPDATE ON downstream_references
  FOR EACH ROW EXECUTE FUNCTION downstream_reference_requires_pinned();

-- ---------------------------------------------------------------------------------------
-- A citation, once made, is a record of what a decision looked at
-- ---------------------------------------------------------------------------------------
-- Deleting it is how "this decision cited that snapshot" quietly stops being true, and E5
-- says the answer to a withdrawn evidence is an ANNOTATION plus a notification to the
-- approver -- explicitly not a silent removal and explicitly not an edit of the snapshot.
--
-- Same residual opening as 0007 and 0008, and no wider: removing the whole organization,
-- detected by the parent row already being gone inside the cascade.
CREATE OR REPLACE FUNCTION downstream_reference_undeletable() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = OLD.org_id) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'SNAPSHOT_IMMUTABLE: downstream reference % cannot be deleted; it records what a decision looked at',
    OLD.id
    USING ERRCODE = 'raise_exception',
          DETAIL  = 'Deleting the cited version or its artifact reaches this row by cascade and is refused for the same reason.',
          HINT    = 'Withdrawn evidence is annotated at the reference (markEvidenceWithdrawn), not removed.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS downstream_reference_undeletable_trg ON downstream_references;
CREATE TRIGGER downstream_reference_undeletable_trg
  BEFORE DELETE ON downstream_references
  FOR EACH ROW EXECUTE FUNCTION downstream_reference_undeletable();

-- ---------------------------------------------------------------------------------------
-- RLS, same rule as every other tenant table
-- ---------------------------------------------------------------------------------------
-- kernel_tenant_table_audit() (0004) discovers this table from the catalog the moment it
-- exists, so verify-rls.sh fails if this block is ever dropped. The gate is not told about
-- new tables; it finds them.
ALTER TABLE downstream_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE downstream_references FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS downstream_references_tenant ON downstream_references;
CREATE POLICY downstream_references_tenant ON downstream_references
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON downstream_references FROM app_rw;

-- SELECT and INSERT only.
--
-- No UPDATE: re-pointing a citation at a different snapshot is 0008's `repoint` one level
-- down -- the row id an audit trail recorded survives while what it refers to changes, and
-- a rank comparison would see nothing move. No DELETE: see the trigger above.
GRANT SELECT, INSERT ON downstream_references TO app_rw;

COMMENT ON TABLE downstream_references IS
  'F07: the single door every downstream citation passes through (uc-0-1 R6 / AC1 / I-14). '
  'A row here means "this claim / report / graph node / acceptance record cites that '
  'snapshot". The BEFORE INSERT trigger refuses any version that is not pinned to a project '
  'step, so a downstream bundle that skips the use case still cannot cite a live or draft '
  'product. Append-only: no UPDATE, no DELETE.';

COMMENT ON FUNCTION downstream_reference_requires_pinned() IS
  'AC1 / I-14: citable(version) iff some binding pins exactly that version. NOT "the version '
  'exists" -- every artifact_versions row is immutable by construction, so that reading makes '
  'REQUIRES_PINNED unreachable and the gate vacuous.';
