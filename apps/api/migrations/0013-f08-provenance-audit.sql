-- 0010 F08: the audit trail is append-only for real, and withdrawal notifications exist
-- (uc-0-1 R7 / R12 V7 / E5, contracts/artifact/domain.md I-9, provenance.ts)
--
-- ## What 0005 already did, and the hole it left
--
-- 0005 wrote `REVOKE ALL ON provenance_events FROM app_rw; GRANT SELECT, INSERT` and, in the
-- comment above it, the claim that this makes it impossible for anything serving traffic to
-- rewrite history. Measured against a real database, before this file:
--
--   app_rw: UPDATE provenance_events            -> permission denied           (as designed)
--   app_rw: DELETE FROM provenance_events       -> permission denied           (as designed)
--   app_rw: DELETE FROM organizations WHERE ... -> DELETE 1, and every event row is GONE
--
-- `provenance_events.org_id REFERENCES organizations ON DELETE CASCADE` plus
-- `GRANT ... DELETE ON organizations TO app_rw` (0003 grants all four verbs on every
-- identity table) is a delete on the append-only table, spelled differently. A referential
-- action is carried out by the system WITHOUT a privilege check on the child table, so the
-- REVOKE has no bearing on it at all.
--
-- This is exactly the shape 0007 found on `artifact_versions`, one table over, three
-- migrations earlier, with the lesson written down. It was still live here. That is the
-- argument for closing it in the database rather than for remembering harder.
--
-- ## The two barriers this file installs
--
--   (a) `provenance_events` gets BEFORE UPDATE / BEFORE DELETE triggers. Triggers fire for
--       the OWNER too, and a referential action fires them as well -- which is the half a
--       GRANT cannot express. Teardown stays possible and is narrowed to exactly one shape:
--       the organization row is already gone (we are inside its cascade) AND the caller is
--       the table owner. The owner condition is what makes the cascade path useless to
--       anything serving traffic even if the DELETE grant on `organizations` comes back.
--
--   (b) `REVOKE DELETE ON organizations FROM app_rw`. Nothing in the application deletes an
--       organization -- `no-forbidden-routes.test.ts` even forbids the route (N-5) -- so the
--       grant only ever purchased the bypass above. Removing a tenant is an owner-side act.
--
-- Both, not either: (a) alone leaves the runtime able to start a cascade that then aborts
-- the whole transaction (a denial-of-service on tenant teardown rather than a data loss),
-- and (b) alone is a grant, which is the thing that already failed to hold.
--
-- ## Residual hole, stated rather than described as closed
--
-- The OWNER can still destroy the trail by destroying the whole organization. That is the
-- same residual 0007 documented for snapshots, and it is deliberate: `resetOrgs` in the test
-- support and any future retention job need it. What is guaranteed is narrower and is the
-- threat that matters -- nothing serving traffic can erase or alter a single event, and no
-- single event can be removed by anybody without removing its entire tenant.
--
-- Replayable in isolation: CREATE OR REPLACE / DROP-then-CREATE / IF NOT EXISTS throughout,
-- because migrate:check force-replays every file ignoring the version table.

-- ---------------------------------------------------------------------------------------
-- (a) append-only, enforced where a referential action can also be seen
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION provenance_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'AUDIT_APPEND_ONLY: provenance_events row % cannot be modified (invariant I-9)',
    OLD.id
    USING ERRCODE = 'raise_exception',
          DETAIL  = 'An audit trail that can be edited answers nothing after the fact: "was that refusal recorded" stops being a question with an answer.',
          HINT    = 'Corrections are appended. Write a new event that supersedes this one.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS provenance_event_immutable_trg ON provenance_events;
CREATE TRIGGER provenance_event_immutable_trg
  BEFORE UPDATE ON provenance_events
  FOR EACH ROW EXECUTE FUNCTION provenance_event_immutable();

/*
 * Deletion: refused, except inside the removal of the whole organization BY THE OWNER.
 *
 * The first condition is 0007's discriminator and it is not a heuristic about intent:
 * PostgreSQL deletes the parent row first and cascades from an AFTER-row referential
 * trigger, so inside the child's BEFORE DELETE the parent is already invisible to this
 * transaction. Deleting one event leaves its organization plainly there.
 *
 * The second condition is what 0007 did not need and this table does. `app_rw` reaching the
 * cascade is not hypothetical -- it was reachable when this file was written. Checking the
 * table's owner rather than hardcoding 'app_rw' keeps the rule true for a future role that
 * gets the same grant by a different name.
 *
 * ⚠ `session_user`, NOT `current_user`, and the difference is the whole trigger. A cascade
 * is carried out by a referential-integrity trigger that runs WITH THE PRIVILEGES AND
 * IDENTITY OF THE TABLE OWNER, so inside this function `current_user` is `postgres` even
 * when `app_rw` issued the DELETE. The first version of this file used `current_user`, and
 * measured against a real database it let app_rw wipe the trail while reading as a
 * correctly-written owner check -- the same class of green-but-empty gate as the GRANT it
 * replaces. `session_user` is the authenticated role and is not rewritten by the cascade.
 */
CREATE OR REPLACE FUNCTION provenance_event_undeletable() RETURNS trigger AS $$
DECLARE
  owner_name text;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO owner_name
    FROM pg_catalog.pg_class c
   WHERE c.oid = 'provenance_events'::regclass;

  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = OLD.org_id)
     AND session_user = owner_name THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'AUDIT_APPEND_ONLY: provenance_events row % cannot be deleted (invariant I-9)',
    OLD.id
    USING ERRCODE = 'raise_exception',
          DETAIL  = 'Deleting the parent organization reaches this row by cascade; a referential action skips the privilege check on this table, so the GRANT alone did not hold.',
          HINT    = 'Only the table owner may remove a trail, and only by removing the whole tenant.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS provenance_event_undeletable_trg ON provenance_events;
CREATE TRIGGER provenance_event_undeletable_trg
  BEFORE DELETE ON provenance_events
  FOR EACH ROW EXECUTE FUNCTION provenance_event_undeletable();

-- ---------------------------------------------------------------------------------------
-- `at` is stored at the precision the API can express
-- ---------------------------------------------------------------------------------------
-- Found by a test, not by reading: `timestamptz` keeps MICROseconds, and the contract types
-- `ProvenanceEvent.at` as ISO 8601, which `Date#toISOString()` renders with MILLIseconds.
-- The rendered value is therefore strictly less than the stored one, and the audit surface
-- takes that same value back as `since` / `until` / `cursor`. Two consequences, both silent:
--
--   * `until: <the at of an event you were just shown>` EXCLUDES that event. Measured.
--   * the keyset cursor is `(at, id) < (cursor.at, cursor.id)` with a truncated `cursor.at`,
--     so page 2 can skip every event sharing page 1's last millisecond. A paged audit read
--     that quietly drops rows is the worst possible failure for this table -- nothing errors
--     and the missing events look like events that never happened.
--
-- Fixed at the source rather than by formatting harder in TypeScript: with the column stored
-- at millisecond precision, what the API prints IS what is stored, and every round trip
-- closes. Truncation, not rounding, so an event's recorded time is never in its own future.
--
-- ⚠ Rows written before this migration keep their microseconds. There is no backfill,
-- because an UPDATE on this table is exactly what 0010 has just made impossible -- and that
-- is the right trade: the residue is bounded, historical, and harmless next to a mutable
-- audit trail.
ALTER TABLE provenance_events ALTER COLUMN at SET DEFAULT date_trunc('milliseconds', now());

-- ---------------------------------------------------------------------------------------
-- (b) the door next to the one the REVOKE was guarding
-- ---------------------------------------------------------------------------------------
-- Narrowed, not revoked wholesale: SELECT / INSERT / UPDATE stay, because organizations are
-- created and renamed by the application. Only DELETE goes.
REVOKE DELETE ON organizations FROM app_rw;

-- ---------------------------------------------------------------------------------------
-- provenance_notifications -- E5's "通知拍板人复核"
-- ---------------------------------------------------------------------------------------
-- `markEvidenceWithdrawn` returns `notifiedApprovers`. Returning a list of names while
-- notifying nobody is the failure this project keeps recording: the assertion passes, the
-- feature is green, and the person whose decision rests on withdrawn evidence is never told. So
-- the notification is a row, and the test asserts the row.
--
-- ⚠ Deliberately carries NO copy of the event. Not the reason, not the target, not a kind:
-- all of that is one join away through `provenance_event_id`, and a second copy of "which
-- evidence was withdrawn and why" is precisely the drift this project has now recorded
-- five times. The table answers ONE question -- who was told, about which event.
CREATE TABLE IF NOT EXISTS provenance_notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  recipient_id        text NOT NULL,
  provenance_event_id uuid NOT NULL REFERENCES provenance_events (id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Notifying the same person twice about the same event is a retry, not a second fact.
  -- Without this, a re-run of the withdrawal use case doubles every inbox.
  CONSTRAINT provenance_notifications_uniq UNIQUE (provenance_event_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS provenance_notifications_recipient_idx
  ON provenance_notifications (org_id, recipient_id, created_at DESC);

ALTER TABLE provenance_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE provenance_notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provenance_notifications_tenant ON provenance_notifications;
CREATE POLICY provenance_notifications_tenant ON provenance_notifications
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- SELECT + INSERT only, for the same reason the trail itself has them: a notice that the
-- system can delete is a notice the person it was for can be denied having received.
REVOKE ALL ON provenance_notifications FROM app_rw;
GRANT SELECT, INSERT ON provenance_notifications TO app_rw;

COMMENT ON TABLE provenance_notifications IS
  'Who was told about which provenance event (E5: 证据撤回后通知拍板人复核). Carries no copy '
  'of the event -- reason and target are one join away through provenance_event_id.';

COMMENT ON FUNCTION provenance_event_undeletable() IS
  'I-9: the audit trail is append-only. The GRANT in 0005 did not achieve it -- a cascade '
  'from organizations skips the child table privilege check, and app_rw held DELETE on '
  'organizations. Teardown is narrowed to owner-only, inside the organization cascade.';
