-- F72: PII 自动遮盖五类接入 + 手机号加密存储/界面掩码（O-39）
-- contracts/recording/domain.md I-19..I-23; usecases.md revealPii; recording.ts PiiType
--
-- ## Two separate guarantees, one table for the second one
--
-- I-19 (mask five types in every default read) is enforced in application code
-- (`domain/recording/pii-mask.ts`) and needs no schema of its own -- the masked text is what
-- `segments.text` will hold once that table exists (F69 deliberately shipped none; F70-F73
-- shape it). I-20 ("手机号等联系方式在库中为密文") is a STORAGE requirement and it is what
-- this migration is for: a place to put a phone number's encrypted original, built the moment
-- `maskPii` finds one, so a plaintext phone number is never the thing sitting in a row waiting
-- for `revealPii` to read it back.
--
-- Same split F48 made for model credentials, and the same reason: a `phone_plaintext` column
-- next to the masked text is one `SELECT *` away from the interface guarantee I-19 exists to
-- give. In a separate table whose ciphertext column is granted to nobody, that mistake is a
-- permissions error at the database, not a leak with a green test suite.
--
-- ## Why this migration does not reference `segments`
--
-- There is no `segments` table for recording's transcript segments yet -- F69's ports.ts
-- says so explicitly ("F69 ships NO PostgreSQL implementation, deliberately... inventing
-- them now would be guessing at a schema"). `pii_originals.segment_id` is therefore a plain
-- `text` column with no foreign key, not an oversight: adding the FK is F73/whichever feature
-- actually creates `segments`, and it must not be guessed at here.
--
-- ## Why `pii_type` is CHECKed to 'phone' only, not the full five-type enum
--
-- I-20 names phone numbers ("手机号等联系方式") as the thing that must be ciphertext at rest;
-- the other four types (email/id-card/bank-card/address) have no such requirement in
-- domain.md -- I-19 only asks that they be MASKED in output, which `pii-mask.ts` does without
-- persisting an original anywhere. A CHECK admitting all five here would imply a storage
-- guarantee this feature was never asked to make for the other four, and `contracts/recording
-- /recording.ts`'s `PiiType` already carries the five-type vocabulary as the single source --
-- restating it here as an unused four extra CHECK values would be the sixth copy of that fact.
--
-- Replayable: every statement is IF NOT EXISTS / DROP-then-CREATE, because migrate:check
-- replays each file ignoring the version table.

CREATE TABLE IF NOT EXISTS pii_originals (
  finding_id  text PRIMARY KEY,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- No FK: the table this used to belong to does not exist in this schema yet (see header).
  segment_id  text NOT NULL,
  -- Only 'phone' today (I-20's scope); see header for why the other four types are absent.
  pii_type    text NOT NULL CHECK (pii_type IN ('phone')),
  -- ⚠ Ciphertext. There is no plaintext column, so there is no state in which the plaintext
  -- was written "temporarily" -- the same argument 0019's header makes for model_secrets.
  ciphertext  text NOT NULL,
  algorithm   text NOT NULL,
  key_id      text NOT NULL,
  sealed_at   timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS pii_originals_org_segment_idx ON pii_originals (org_id, segment_id);

-- ---------------------------------------------------------------------------------------
-- RLS, same rule as every other tenant table
-- ---------------------------------------------------------------------------------------
ALTER TABLE pii_originals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_originals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pii_originals_tenant ON pii_originals;
CREATE POLICY pii_originals_tenant ON pii_originals
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- REVOKE first so a database that received an earlier version of this file converges rather
-- than accumulating privileges.
REVOKE ALL ON pii_originals FROM app_rw;

-- ⚠ THE ONE THAT MATTERS: a COLUMN-LEVEL SELECT that omits `ciphertext` -- identical shape to
-- 0019's `model_secrets` grant, and for the same reason: `count(*)`-style sweeps (the org
-- export manifest, cross-tenant leak assertions) need privilege on SOME column of every
-- tenant table, so a table-wide REVOKE breaks those; the actual requirement is "the SECRET is
-- unreadable", not "the table is unreadable", and a column grant says exactly that.
--
-- ⚠ Columns are enumerated, not defaulted, for the same fail-closed reason 0019 gives: a
-- future column holding anything derived from the plaintext must be added here DELIBERATELY.
GRANT SELECT (finding_id, org_id, segment_id, pii_type, algorithm, key_id, sealed_at)
  ON pii_originals TO app_rw;

GRANT INSERT, UPDATE, DELETE ON pii_originals TO app_rw;

-- ---------------------------------------------------------------------------------------
-- F22's RESTRICTIVE freeze policy, same as every tenant table created after 0014
-- ---------------------------------------------------------------------------------------
SELECT kernel_apply_org_freeze_policies();
