-- 0016 F13: context_packs -- the table F09, F11 and F12 each deliberately did not build
-- (uc-0-2 R7 / R12 V8+V9, contracts/context-pack/domain.md I-5 / I-7 / I-10, usecases.md
--  ReplayContextPack / PinContextPack / ResolvePackModelConstraint)
--
-- ## Why the three earlier features left it alone, and what changed
--
-- F09's `build-items.ts`, F11's `ports.ts` and F12's `ports.ts` all say the same sentence:
-- persistence belongs to F13, and a table written now would be guessing at the shape F13 has
-- to live with. Each defined only the READ question it needed:
--
--   ContextRunStore.gateState / .pack   (F12)  what the AI gate and the citation check ask
--   ContextPackAuditStore.findAudit     (F11)  items + omissions + the run's OWN threshold
--
-- Two read ports, one table. This is that table, and the guess they refused to make turned
-- out to matter: the obvious schema is `pack jsonb`, and it is the wrong one.
--
-- ## ⚠ THERE IS NO COLUMN HERE THAT CAN HOLD AN ITEM. That is the feature.
--
-- I-5 is 「同一 runId 重放得到逐字节相同的 items[]」, and the assertion everyone writes for it
-- is `replay(runId).items` deep-equals the original. A `pack jsonb` column satisfies that
-- assertion permanently and proves nothing: it would stay green if the assembler started
-- ordering items by `Map` iteration, if the budget cut grew a `Date.now()` tie-break, if the
-- relevance threshold started being looked up at read time instead of read back. Every one of
-- those makes replay false and none of them is visible to a SELECT.
--
-- So what is stored is the run's INPUTS (`recorded`), and `replayContextPack` RE-RUNS the
-- deterministic half of assembly over them, comparing the result against `content_hash`. The
-- absence of an items column is asserted mechanically against information_schema in
-- `tests/kernel/context-pack-pinned-replay.test.ts`, because "we chose not to read it from
-- storage" is a promise while "it is not storable" is a property.
--
-- ⚠ `recorded` DOES contain the candidates, with their text. It is not a hidden copy of the
-- answer: it holds strictly MORE than the pack (every candidate, including the discarded
-- ones) and nothing that says which of them survived. Which survive is computed.
--
-- ## What `threshold_used` is doing in a column of its own
--
-- It is inside `recorded` as well, and it is lifted out here because F11's read port makes a
-- specific promise about it -- "read back, never recomputed". A column is what lets the audit
-- read answer without deserialising and re-screening, and lets an operator see at a glance
-- that an old run's number is not today's number after the first per-task override (O-36)
-- lands.
--
-- ## ⚠ CREATE TABLE IF NOT EXISTS is a SILENT no-op on an existing table
--
-- Same trap 0010 / 0011 / 0012 / 0015 each hit: on a database where `context_packs` already
-- exists in an earlier shape, the CREATE below does nothing at all and every constraint in it
-- is simply absent -- with no error. So the constraints, columns and triggers are ALSO applied
-- unconditionally in the reconciliation block at the end of this file, which converges on
-- every database rather than only on empty ones.
--
-- Replayable in isolation: IF NOT EXISTS / OR REPLACE / DROP-then-CREATE throughout, because
-- migrate:check force-replays each file ignoring the version table.

CREATE TABLE IF NOT EXISTS context_packs (
  run_id            text PRIMARY KEY,
  org_id            text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- A failed assembly is a STATE, not the absence of one (F12's `RunState` note): without a
  -- row, `gateAiCall` would answer RUN_NOT_FOUND ("check your id") to an index outage, and
  -- `RETRIEVAL_UNAVAILABLE` -- which the contract lists as one of its block reasons -- would
  -- be unreachable from an operation whose only input is a runId.
  status            text NOT NULL CHECK (status IN ('assembled', 'retrieval-unavailable')),
  -- The run's inputs. See the header: inputs, not output.
  recorded          jsonb,
  -- SHA-256 of the canonical form of the pack this run produced, at the time it produced it.
  -- Every replay is checked against it, which is the only thing that distinguishes "this is
  -- what the conclusion looked at" from "this is what today's code builds from those inputs".
  content_hash      text CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  threshold_used    double precision CHECK (threshold_used >= 0 AND threshold_used <= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- ── I-7: 随定版固化 ─────────────────────────────────────────────────────────────────
  -- The snapshot id IS the artifact version id (see `pin-pack.ts`): a fresh identifier would
  -- be a second name for one snapshot, and V8 starts from the version a reader is looking at.
  pinned_snapshot_id  text REFERENCES artifact_versions (id) ON DELETE CASCADE,
  pinned_at           timestamptz,
  frozen_item_count   integer CHECK (frozen_item_count >= 0),

  -- An assembled run has inputs, a digest and a threshold; a failed one has none of the three.
  -- Written as an equivalence rather than an implication: the implication would let a failed
  -- run carry a `recorded` blob that nothing reads, and a column that is written but never
  -- read is a column that eventually gets read.
  CONSTRAINT context_packs_assembled_iff_recorded CHECK (
    (status = 'assembled')
    = (recorded IS NOT NULL AND content_hash IS NOT NULL AND threshold_used IS NOT NULL)
  ),
  -- The three pin columns arrive together or not at all. A row with a snapshot id and no
  -- `pinned_at` is a pin nobody can date; one with a count and no snapshot is a count of
  -- nothing.
  CONSTRAINT context_packs_pin_all_or_none CHECK (
    (pinned_snapshot_id IS NULL AND pinned_at IS NULL AND frozen_item_count IS NULL)
    OR (pinned_snapshot_id IS NOT NULL AND pinned_at IS NOT NULL AND frozen_item_count IS NOT NULL)
  ),
  -- A run whose retrieval failed produced no pack, so there is nothing to freeze onto a
  -- decision. Without this, a `PIN_REQUIRES_SNAPSHOT`-shaped hole opens from the other side:
  -- a decision could cite an outage as its evidence list.
  CONSTRAINT context_packs_only_assembled_pins CHECK (
    pinned_snapshot_id IS NULL OR status = 'assembled'
  )
);

CREATE INDEX IF NOT EXISTS context_packs_org_idx ON context_packs (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS context_packs_snapshot_idx
  ON context_packs (org_id, pinned_snapshot_id) WHERE pinned_snapshot_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------
-- I-7 in the database: once pinned, the recording is frozen
-- ---------------------------------------------------------------------------------------
-- The replay model already makes a pinned pack immune to upstream edits -- a replay reads
-- `recorded`, never `segment_text`, so changing an original cannot move it. What it does NOT
-- give you is protection against editing the RECORDING, and that is the interesting attack:
-- one UPDATE and a decision's evidence list becomes whatever somebody wants it to have been,
-- with the content hash updated to match so nothing reports anything.
--
-- ⚠ An application-level rule cannot hold this. `pinContextPack` refusing a second pin is one
-- repository method away from being false. So the rule lives where no caller can route around
-- it, the same argument 0007 makes for snapshot deletion.
--
-- What may still change on a pinned row: NOTHING. Not the recording, not the hash, not the
-- threshold, not the pin itself (write-once: re-pinning to a different snapshot would let one
-- run be presented as the evidence for two decisions with two different item counts).
CREATE OR REPLACE FUNCTION context_pack_pin_is_final() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- The tenant-teardown discriminator, identical in mechanism to 0007's: PostgreSQL removes
    -- the parent row first and cascades from an AFTER-row referential trigger, so inside this
    -- BEFORE DELETE the organization is already invisible to this transaction when (and only
    -- when) the whole tenant is going away.
    IF OLD.pinned_snapshot_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = OLD.org_id) THEN
      RAISE EXCEPTION 'CONTEXT_PACK_PINNED: run % is frozen to snapshot % and cannot be deleted',
        OLD.run_id, OLD.pinned_snapshot_id
        USING ERRCODE = 'raise_exception';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.pinned_snapshot_id IS NOT NULL THEN
    RAISE EXCEPTION 'CONTEXT_PACK_PINNED: run % is frozen to snapshot % (I-7); its recording, hash and pin are write-once',
      OLD.run_id, OLD.pinned_snapshot_id
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Not yet pinned. The recording of a live run may be replaced (A3 reassembly writes a new
  -- packId under the same runId), but the ROW IDENTITY may not move: changing `org_id` would
  -- carry an existing recording into another tenant, which RLS cannot see as a leak because
  -- by then it is that tenant's row.
  IF NEW.org_id <> OLD.org_id OR NEW.run_id <> OLD.run_id THEN
    RAISE EXCEPTION 'CONTEXT_PACK_IDENTITY: run % cannot be moved between tenants or renamed', OLD.run_id
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS context_packs_pin_final_trg ON context_packs;
CREATE TRIGGER context_packs_pin_final_trg
  BEFORE UPDATE OR DELETE ON context_packs
  FOR EACH ROW EXECUTE FUNCTION context_pack_pin_is_final();

-- ---------------------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------------------
-- kernel_tenant_table_audit() (0004) finds this table from the catalog the moment it exists,
-- so verify-rls.sh goes red if this block is forgotten. `current_setting(..., true)` is NULL
-- when unset, so an un-scoped query sees nothing -- fail-closed. For an audit table that is
-- the difference between "no such run" and one tenant reading another's evidence list.
ALTER TABLE context_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_packs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS context_packs_tenant ON context_packs;
CREATE POLICY context_packs_tenant ON context_packs
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- F22's org-disabled freeze, applied here because 0014's catalog loop only reaches tables
-- that existed WHEN IT RAN -- and its own header says so: 「以后新建的表带着老式策略进来，
-- 就不在冻结范围内了」. On a fresh database 0014 runs before this file, so without these three
-- policies a disabled organization could still write context packs, and the only thing that
-- would notice is `org-disabled-readonly.test.ts`'s catalog assertion (which is exactly how
-- this omission was found here -- by migrate:check's replay digest, before any test ran).
--
-- Three separate RESTRICTIVE policies, not one merged expression, and not folded into
-- `context_packs_tenant`: 0014 explains both mistakes at length and both were made green.
DROP POLICY IF EXISTS context_packs_org_frozen_ins ON context_packs;
CREATE POLICY context_packs_org_frozen_ins ON context_packs AS RESTRICTIVE FOR INSERT
  WITH CHECK (kernel_org_is_writable(org_id));
DROP POLICY IF EXISTS context_packs_org_frozen_upd ON context_packs;
CREATE POLICY context_packs_org_frozen_upd ON context_packs AS RESTRICTIVE FOR UPDATE
  WITH CHECK (kernel_org_is_writable(org_id));
DROP POLICY IF EXISTS context_packs_org_frozen_del ON context_packs;
CREATE POLICY context_packs_org_frozen_del ON context_packs AS RESTRICTIVE FOR DELETE
  USING (kernel_org_is_writable(org_id));

REVOKE ALL ON context_packs FROM app_rw;
-- DELETE is granted and the trigger above is what makes it safe: an unpinned run is a working
-- record and may be discarded, a pinned one is evidence and may not. Withholding DELETE
-- entirely would leave failed runs accumulating with no way to clear them, and the retention
-- policy this bundle needs (coverage gap 5) does not exist yet to say when.
GRANT SELECT, INSERT, UPDATE, DELETE ON context_packs TO app_rw;

COMMENT ON TABLE context_packs IS
  'One row per Context Pack assembly run. Stores the run INPUTS, not the pack: replay '
  're-runs the deterministic half of assembly and checks the result against content_hash. '
  'There is deliberately no column able to hold an item -- see the 0016 header.';
COMMENT ON COLUMN context_packs.threshold_used IS
  'The relevance threshold THIS run applied. Read back, never recomputed: after a per-task '
  'override lands (O-36) a recomputed value would re-screen an old candidate set at a '
  'threshold it never saw.';

-- ---------------------------------------------------------------------------------------
-- ⚠ Reconciliation -- because CREATE TABLE IF NOT EXISTS above may have been a no-op
-- ---------------------------------------------------------------------------------------
-- On a database where `context_packs` already existed in any earlier shape, everything above
-- inside the CREATE was skipped silently: the columns would be missing and every CHECK simply
-- would not exist, while this migration reports success. The failure then shows up as tests
-- that are green on a fresh database and red (or, worse, absent) on a long-lived one -- the
-- exact accident 0010's footer documents.
--
-- Applied unconditionally. If a constraint cannot be added because the table already holds
-- violating rows, this migration FAILS on purpose: letting through a table that claims to
-- satisfy I-7 while not satisfying it is more dangerous than a failed migration.
ALTER TABLE context_packs ADD COLUMN IF NOT EXISTS recorded jsonb;
ALTER TABLE context_packs ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE context_packs ADD COLUMN IF NOT EXISTS threshold_used double precision;
ALTER TABLE context_packs ADD COLUMN IF NOT EXISTS pinned_snapshot_id text;
ALTER TABLE context_packs ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
ALTER TABLE context_packs ADD COLUMN IF NOT EXISTS frozen_item_count integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'context_packs'::regclass AND conname = 'context_packs_assembled_iff_recorded'
  ) THEN
    ALTER TABLE context_packs ADD CONSTRAINT context_packs_assembled_iff_recorded CHECK (
      (status = 'assembled')
      = (recorded IS NOT NULL AND content_hash IS NOT NULL AND threshold_used IS NOT NULL)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'context_packs'::regclass AND conname = 'context_packs_pin_all_or_none'
  ) THEN
    ALTER TABLE context_packs ADD CONSTRAINT context_packs_pin_all_or_none CHECK (
      (pinned_snapshot_id IS NULL AND pinned_at IS NULL AND frozen_item_count IS NULL)
      OR (pinned_snapshot_id IS NOT NULL AND pinned_at IS NOT NULL AND frozen_item_count IS NOT NULL)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'context_packs'::regclass AND conname = 'context_packs_only_assembled_pins'
  ) THEN
    ALTER TABLE context_packs ADD CONSTRAINT context_packs_only_assembled_pins CHECK (
      pinned_snapshot_id IS NULL OR status = 'assembled'
    );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------
-- What is deliberately NOT added: a foreign key on `artifact_versions.context_pack_id`
-- ---------------------------------------------------------------------------------------
-- 0006 left that column without an FK because `context_packs` did not exist. It exists now,
-- and the FK is still not added, for a reason that was checked rather than assumed:
--
--   * ON DELETE SET NULL performs an UPDATE on `artifact_versions`, and 0006's BEFORE UPDATE
--     trigger refuses every update to that table -- including the system's own. The referential
--     action would therefore fail, i.e. deleting any context pack would become impossible for
--     as long as one version cites it.
--   * ON DELETE RESTRICT / NO ACTION would deadlock tenant teardown: `organizations` cascades
--     into BOTH tables and there is no ordering guarantee between the two cascades.
--
-- So the reference stays a plain column, and "this version cites a run that exists" is checked
-- in application code and in `context-pack-pinned-replay.test.ts` rather than by the database.
-- Stated because an absent FK next to a present table reads as an oversight, and this one is a
-- consequence of immutability (I-1/I-11 of the artifact bundle) rather than of forgetfulness.
