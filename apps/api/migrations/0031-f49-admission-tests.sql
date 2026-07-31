-- 0031 F49: the five admission verdicts are a LOG, not a state, and the log is
-- append-only in the database (uc-20-1 R3 步骤 5, contracts/agent-runtime/domain.md
-- `AdmissionTest`, invariants I-1 / I-7).
--
-- ## Why a log table and not five columns on `models`
--
-- I-7 says a re-judgement PRODUCES A SECOND RECORD and the history is not overwritten. Five
-- columns express exactly one verdict per item, so "改判" is necessarily an UPDATE and the
-- previous judgement is necessarily gone. There is no way to write the invariant into that
-- shape; the shape has to be the log. `status` on `models` stays where it is -- it is the
-- CONCLUSION the gate reaches, and 0019 already CHECKs its four values.
--
-- ## Why the append-only rule is BOTH a GRANT and two triggers
--
-- 0013's header records what a GRANT alone was measured to be worth on `provenance_events`:
--
--     app_rw: UPDATE provenance_events            -> permission denied
--     app_rw: DELETE FROM provenance_events       -> permission denied
--     app_rw: DELETE FROM organizations WHERE ... -> DELETE 1, and every row was GONE
--
-- A referential action is carried out WITHOUT a privilege check on the child table, so
-- `ON DELETE CASCADE` walks straight past a REVOKE. This table hangs off `organizations`
-- AND off `models`, so it has two cascade doors rather than one, and the GRANT guards
-- neither. The triggers below are the guarantee; the GRANT is the convenient path.
--
-- ⚠ `session_user`, not `current_user`, in the delete trigger. A cascade runs the
-- referential trigger with the TABLE OWNER's identity, so `current_user` reads `postgres`
-- even when `app_rw` issued the DELETE. 0013 measured this: the `current_user` version let
-- app_rw wipe the trail while reading as a correct owner check.
--
-- ## The residual hole, stated rather than described as closed
--
-- The OWNER can still destroy an organization's verdicts by destroying the organization.
-- Same residual 0007 and 0013 document, same reason: `resetOrgs` and any future retention
-- job need it. What is guaranteed is the narrower thing that matters -- nothing serving
-- traffic can alter or remove a single verdict, and no single verdict can be removed by
-- anybody without removing its entire tenant. Deleting one MODEL is not enough: the
-- model->verdict cascade is refused too, so `models` cannot become a side door.
--
-- ## ⚠ NO INSERTS, same reason as 0019
--
-- A seeded "已通过的五项" would be indistinguishable from a judgement a human made, which is
-- precisely the thing D-07 says a human must make. The five ITEMS are also not stored as
-- rows anywhere: they are a closed enum in `@repo/contracts` (`AdmissionTestItem`), and the
-- CHECK below is the second copy that `admission-test-gate.test.ts` asserts equal to the
-- first, in both directions.
--
-- Replayable: every statement is IF NOT EXISTS / CREATE OR REPLACE / DROP-then-CREATE,
-- because migrate:check replays each file ignoring the version table.

CREATE TABLE IF NOT EXISTS model_admission_tests (
  record_id  text PRIMARY KEY,
  model_id   text NOT NULL REFERENCES models (id) ON DELETE CASCADE,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Same five members as `agentRuntime.AdmissionTestItem`. Reconciliation is ASSERTED
  -- (admission-test-gate.test.ts, set equality both ways) rather than trusted -- the same
  -- arrangement 0019 uses for `kind` and `status`.
  item       text NOT NULL CHECK (
    item IN ('连通性', '结构化输出', '工具调用', '长上下文', '中文表达')
  ),
  -- Three, and `不适用` is NOT `通过`. I-1's precondition is five `通过`; a schema that
  -- collapsed the third value into either of the other two would make the gate's answer
  -- depend on which collapse the writer picked.
  verdict    text NOT NULL CHECK (verdict IN ('通过', '不通过', '不适用')),
  -- O-35: 不打分、不设分数线 -- so there is no score column to be tempted by, and the
  -- evidence is what carries the judgement. NOT NULL is not enough: '' and '   ' are both
  -- "I filled the required field", and both leave the next reader with nothing.
  evidence   text NOT NULL CHECK (length(btrim(evidence)) > 0),
  -- D-07: the judgement is a person's. Never 'system', never inferred from a probe result;
  -- `probeConnectivity` produces EVIDENCE, not a verdict.
  judged_by  text NOT NULL,
  -- Milliseconds, not microseconds: the contract types `judgedAt` as ISO 8601 and
  -- `Date#toISOString()` renders milliseconds, so an untruncated column stores a value
  -- strictly greater than the one the API prints. 0013's header records what that cost on
  -- `provenance_events` (a range read that excludes the row you were just shown).
  judged_at  timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now()),
  -- ⚠ The tie-break that makes "哪条是新的" answerable.
  --
  -- Two judgements of the same item can share a `judged_at` -- the same admin correcting a
  -- mis-click inside one millisecond is not exotic, and a clock that moves backwards makes
  -- it worse. With only a timestamp, "the latest verdict" is then a coin toss, and the coin
  -- decides whether the model may be enabled. `seq` is the append order, and it is the
  -- database's, not a caller's.
  seq        bigint GENERATED ALWAYS AS IDENTITY
);

-- The gate reads one model's whole log; the ORDER BY is `seq`, so the index carries it.
CREATE INDEX IF NOT EXISTS model_admission_tests_model_idx
  ON model_admission_tests (org_id, model_id, item, seq);

-- ---------------------------------------------------------------------------------------
-- Append-only (I-7)
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION model_admission_test_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'ADMISSION_LOG_APPEND_ONLY: verdict % cannot be modified (invariant I-7)',
    OLD.record_id
    USING ERRCODE = 'raise_exception',
          DETAIL  = 'A re-judgement is a NEW row. Overwriting one destroys the evidence that the model was ever judged otherwise, which is the only reason the log exists.',
          HINT    = 'INSERT a second record for the same (model_id, item).';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS model_admission_test_immutable_trg ON model_admission_tests;
CREATE TRIGGER model_admission_test_immutable_trg
  BEFORE UPDATE ON model_admission_tests
  FOR EACH ROW EXECUTE FUNCTION model_admission_test_immutable();

/*
 * Deletion: refused, except inside the removal of the whole organization BY THE OWNER.
 *
 * The discriminator is 0007's and 0013's, and it is not a heuristic about intent:
 * PostgreSQL deletes the parent row first and cascades from an AFTER-row referential
 * trigger, so inside this BEFORE DELETE the organization is already invisible to the
 * transaction. Deleting one verdict -- or one MODEL, which cascades here -- leaves the
 * organization plainly there, and is refused.
 */
CREATE OR REPLACE FUNCTION model_admission_test_undeletable() RETURNS trigger AS $$
DECLARE
  owner_name text;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO owner_name
    FROM pg_catalog.pg_class c
   WHERE c.oid = 'model_admission_tests'::regclass;

  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = OLD.org_id)
     AND session_user = owner_name THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'ADMISSION_LOG_APPEND_ONLY: verdict % cannot be deleted (invariant I-7)',
    OLD.record_id
    USING ERRCODE = 'raise_exception',
          DETAIL  = 'This row is reachable by cascade from both organizations and models; a referential action skips the privilege check on this table, so the GRANT alone did not hold.',
          HINT    = 'Only the table owner may remove verdicts, and only by removing the whole tenant.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS model_admission_test_undeletable_trg ON model_admission_tests;
CREATE TRIGGER model_admission_test_undeletable_trg
  BEFORE DELETE ON model_admission_tests
  FOR EACH ROW EXECUTE FUNCTION model_admission_test_undeletable();

-- ---------------------------------------------------------------------------------------
-- RLS, same rule as every other tenant table
-- ---------------------------------------------------------------------------------------
ALTER TABLE model_admission_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_admission_tests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS model_admission_tests_tenant ON model_admission_tests;
-- current_setting(..., true) is NULL when unset, so an un-scoped query sees nothing
-- (fail-closed) rather than everything.
CREATE POLICY model_admission_tests_tenant ON model_admission_tests
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON model_admission_tests FROM app_rw;
-- No UPDATE and no DELETE. The two triggers above are what actually holds, but the GRANT
-- states the intent where a reviewer looks first, and it turns the ordinary mistake into a
-- permission error rather than a trigger exception.
GRANT SELECT, INSERT ON model_admission_tests TO app_rw;

-- F22's three RESTRICTIVE freeze policies, applied by calling the function 0014 declares
-- rather than by copying its three CREATE POLICY statements. 0014's number is lower than
-- this one, so on a FRESH database it runs before this table exists -- and every F22
-- assertion would have stayed green, because those assertions cover the tables that existed
-- when they were written. Same trap 0019's header records for `local_export_previews`.
SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE model_admission_tests IS
  'I-7: the five admission verdicts are append-only. A re-judgement is a second row; both '
  'remain readable and `seq` says which is later. Enforced by trigger, not only by GRANT: '
  'this table is reachable by cascade from organizations AND from models, and a referential '
  'action skips the privilege check on the child table.';
