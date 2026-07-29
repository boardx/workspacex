-- 0007 F05: a pinned snapshot cannot be deleted -- by anyone, through any path
-- (uc-0-1 R7 / R12 V8, contracts/artifact/domain.md I-1 / I-11, coherence X-4)
--
-- ## What 0006 already did, and the hole it left
--
-- 0006 made a version row unmodifiable two ways: `REVOKE UPDATE, DELETE ... FROM app_rw`
-- (nothing serving traffic can touch it) and a BEFORE UPDATE trigger (not even the owner).
-- It then wrote that DELETE stays possible owner-side on purpose, so that tenant teardown
-- via ON DELETE CASCADE keeps working.
--
-- Both statements are true and the conclusion drawn from them was not. Measured against a
-- real database, before this file:
--
--   app_rw: DELETE FROM artifact_versions      -> permission denied     (as designed)
--   app_rw: DELETE FROM artifacts              -> DELETE 1, and the version row is GONE
--
-- `artifact_versions.artifact_id REFERENCES artifacts ON DELETE CASCADE` plus
-- `GRANT ... DELETE ON artifacts TO app_rw` is a delete on the immutable table, spelled
-- differently. Referential actions are carried out by the system without a privilege check
-- on the child table, so the REVOKE has no bearing on them at all.
--
-- This is the failure shape the project keeps meeting: a gate that looks like it holds, is
-- never tested from the other side, and holds nothing. The REVOKE is real -- it just guards
-- a door next to an open one. I-11 says a pinned snapshot is not deletable through ANY
-- interface, and `DELETE FROM artifacts` is an interface.
--
-- ## The rule this file installs
--
-- A version row may be deleted only when its organization is itself being removed. Every
-- other deletion -- direct, cascaded from `artifacts`, from psql, from a migration, by the
-- owner, by a superuser -- raises SNAPSHOT_IMMUTABLE.
--
-- The discriminator is that the `organizations` row is already gone by the time the child's
-- trigger runs. That is not a heuristic about intent: PostgreSQL deletes the parent row
-- first and cascades from an AFTER-row referential trigger, so inside the child's BEFORE
-- DELETE the parent is no longer visible to this transaction. Deleting an artifact leaves
-- its organization plainly there; tearing down a tenant does not. Verified in both
-- directions before this was written, and both directions are asserted in
-- snapshot-no-edit-no-delete.test.ts -- a discriminator that answered "teardown" to
-- everything would produce exactly the same green as the REVOKE did.
--
-- ## Why tenant teardown stays open, and what that costs
--
-- Deleting an organization is how a tenant leaves, and it is a deliberate, whole-tenant,
-- owner-only act. Sealing it would mean an organization could never be removed and the
-- cascade in 0003 would start failing -- so the residual hole is: to destroy one snapshot
-- you must destroy the entire organization it belongs to. That is stated rather than
-- described as closed.
--
-- ## What is NOT here: compliance withdrawal
--
-- Coherence X-4 rules that compliance withdrawal is the single legitimate hole in
-- immutability, and that its criterion is O-39, the legal-hold list. O-39 does not exist.
-- It is registered in `packages/contracts/src/thresholds.ts` as
-- `legalHoldCategories: {known: false}` and THROWS when read, precisely so nobody supplies
-- a default -- a default here reads "everything may be deleted", which is the more dangerous
-- of the two guesses.
--
-- So there is no compliance-deletion path in this file, no `force` flag and no exempt role.
-- Until O-39 arrives, "which snapshots are under legal hold" has no answer, and a deletion
-- path with no criterion is not a narrower hole than the one just closed -- it is the same
-- hole with a comment on it. F05 delivers the prohibition; the exemption is blocked
-- upstream and is not F05's to invent.
--
-- Replayable in isolation: CREATE OR REPLACE / DROP-then-CREATE throughout, as
-- migrate:check force-replays each file ignoring the version table.

CREATE OR REPLACE FUNCTION artifact_version_undeletable() RETURNS trigger AS $$
BEGIN
  -- Already invisible => the organization row was deleted earlier in this same statement
  -- and we are inside its cascade. Anything else is a deletion aimed at the snapshot,
  -- whether or not it names it.
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = OLD.org_id) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'SNAPSHOT_IMMUTABLE: artifact_version % cannot be deleted (invariant I-11); a pinned snapshot may have been cited, so correct it by adding a new version',
    OLD.id
    USING ERRCODE = 'raise_exception',
          DETAIL  = 'Deleting the parent artifact reaches this row by cascade and is refused for the same reason.',
          HINT    = 'Compliance withdrawal is the only exemption (coherence X-4) and its criterion O-39 does not exist yet, so no exemption is implemented.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS artifact_version_undeletable_trg ON artifact_versions;
CREATE TRIGGER artifact_version_undeletable_trg
  BEFORE DELETE ON artifact_versions
  FOR EACH ROW EXECUTE FUNCTION artifact_version_undeletable();

-- ---------------------------------------------------------------------------------------
-- The same reasoning one level up: an artifact with versions is not deletable either
-- ---------------------------------------------------------------------------------------
-- The trigger above is sufficient to PROTECT the snapshot -- the cascade aborts and the
-- whole transaction rolls back. But the error a caller then sees names artifact_versions,
-- for a statement that said `DELETE FROM artifacts`, which reads as an internal fault
-- rather than as a refusal. Refusing at the table the caller actually addressed is the
-- difference between a rule and a crash.
--
-- Deliberately conditional on `EXISTS (versions)`: an artifact with no version yet is a
-- draft buffer with nothing pinned, and nothing about I-11 makes that undeletable.
CREATE OR REPLACE FUNCTION artifact_with_versions_undeletable() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = OLD.org_id) THEN
    RETURN OLD;
  END IF;

  IF EXISTS (SELECT 1 FROM artifact_versions v WHERE v.artifact_id = OLD.id) THEN
    RAISE EXCEPTION
      'SNAPSHOT_IMMUTABLE: artifact % has pinned versions and cannot be deleted (invariant I-11)',
      OLD.id
      USING ERRCODE = 'raise_exception',
            DETAIL  = 'ON DELETE CASCADE would destroy immutable artifact_versions rows.',
            HINT    = 'Add a new version instead; a pinned snapshot may already be cited.';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS artifact_with_versions_undeletable_trg ON artifacts;
CREATE TRIGGER artifact_with_versions_undeletable_trg
  BEFORE DELETE ON artifacts
  FOR EACH ROW EXECUTE FUNCTION artifact_with_versions_undeletable();

COMMENT ON FUNCTION artifact_version_undeletable() IS
  'I-11: a pinned snapshot is not deletable through any interface. The only opening is the '
  'removal of the whole organization, detected by its row being already gone inside the '
  'cascade. Compliance withdrawal (coherence X-4) is deliberately NOT implemented: its '
  'criterion is O-39, which does not exist.';
