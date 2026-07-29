-- 0008 F06: the three binding modes -- draft / live / pinned
-- (uc-0-1 R3 步骤2-4 / R4 A2-A4 / R12 V3, contracts/artifact/domain.md I-8 / I-11 / I-12)
--
-- ## What a binding is, and why it stores a VERSION
--
-- A binding is the row that makes a Studio product appear on the project side. domain.md is
-- emphatic that it must carry `pinned_version_id` and not merely `artifact_id`: an anchor
-- that names the mutable artifact follows the artifact forward, and then "the decision cited
-- the snapshot as it stood" (D-30) is false while every row still looks correct.
--
-- The three modes differ in exactly one structural way, and it is expressed as a constraint
-- rather than as a rule somebody remembers:
--
--   draft   private to its author, never on the project side   pinned_version_id IS NULL
--   live    on the project side, resolves to the head          pinned_version_id IS NULL
--   pinned  frozen to one immutable version                    pinned_version_id NOT NULL
--
-- `artifact_bindings_pinned_iff_version` is an IFF, not an implication. The implication
-- ("pinned => a version is named") leaves `live` free to carry a stale version id that
-- nothing reads, and a column that is written but never read is a column that eventually
-- gets read.
--
-- ## What is NOT here: project steps
--
-- `step_id` has NO foreign key, because there is no `steps` table anywhere in phase-00 --
-- project templates and their stages arrive in phase-01. Two of the contract's declared
-- failures for `bindToProjectStep` (`STEP_CLOSED`, `STEP_REJECTS_ARTIFACT_TYPE`) are
-- therefore not evaluable by anything in this repository today. That is stated here and in
-- the F06 report rather than being faked with a nullable lookup that always says "open" --
-- a check that cannot fail is worse than an absent one, because it reads as coverage.
--
-- Replayable in isolation: IF NOT EXISTS / CREATE OR REPLACE / DROP-then-CREATE throughout,
-- because migrate:check force-replays every file ignoring the version table.

CREATE TABLE IF NOT EXISTS artifact_bindings (
  id                text PRIMARY KEY,
  org_id            text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- ON DELETE CASCADE is the declared action, and for a binding that names a version it is
  -- unreachable: 0007 already refuses to delete an artifact that has versions. For a
  -- version-less artifact carrying only a draft binding the cascade is correct -- nothing
  -- has been cited. The BEFORE DELETE trigger below is what makes the difference hold
  -- rather than depending on 0007 continuing to exist.
  artifact_id       text NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
  project_id        text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  -- No FK: see the header. Non-empty because a binding to "" is a binding to nothing while
  -- occupying the uniqueness slot of a real step.
  step_id           text NOT NULL CHECK (length(step_id) > 0),
  -- Closed enum, a copy of BindingMode in packages/contracts/src/artifact.ts, and NOT left
  -- as a copy: binding-three-modes.test.ts reads this constraint out of pg_catalog and
  -- asserts it equals the contract enum member for member (the technique 0005/0006 use).
  mode              text NOT NULL CHECK (mode IN ('draft', 'live', 'pinned')),
  -- I-8's binding half, the part F05 explicitly left open. ON DELETE CASCADE is again
  -- unreachable in practice (0007 makes versions undeletable outside tenant teardown) and
  -- is declared so that tearing a tenant down does not deadlock on a RESTRICT.
  pinned_version_id text REFERENCES artifact_versions (id) ON DELETE CASCADE,
  -- I-12 needs an author to compare against. `Binding` in the contract has no such field,
  -- so this is stored and deliberately NOT returned -- noted as a contract finding.
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifact_bindings_pinned_iff_version
    CHECK ((mode = 'pinned') = (pinned_version_id IS NOT NULL)),
  -- One binding per (artifact, project, step). A4 allows the same artifact to be pinned to
  -- SEVERAL steps at different versions, and this permits exactly that while refusing two
  -- rows for one step -- which is how a project side ends up showing an artifact twice, at
  -- two different versions, with no way to say which one the step actually cites.
  CONSTRAINT artifact_bindings_uniq_step UNIQUE (artifact_id, project_id, step_id)
);

CREATE INDEX IF NOT EXISTS artifact_bindings_project_idx
  ON artifact_bindings (org_id, project_id, step_id);

-- ---------------------------------------------------------------------------------------
-- The pinned version must belong to the artifact being bound
-- ---------------------------------------------------------------------------------------
-- A foreign key says `pinned_version_id` is SOME version. It cannot say it is a version OF
-- `artifact_id`, and the difference is the whole invariant: a binding that says
-- "artifact A, frozen at <a version of artifact B>" satisfies every constraint above,
-- renders on the project side as `已定版 v3`, and cites somebody else's document.
CREATE OR REPLACE FUNCTION binding_version_belongs_to_artifact() RETURNS trigger AS $$
BEGIN
  IF NEW.pinned_version_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM artifact_versions v
     WHERE v.id = NEW.pinned_version_id
       AND v.artifact_id = NEW.artifact_id
       AND v.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION
      'binding % pins version % which is not a version of artifact % (invariant I-8)',
      NEW.id, NEW.pinned_version_id, NEW.artifact_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS binding_version_belongs_to_artifact_trg ON artifact_bindings;
CREATE TRIGGER binding_version_belongs_to_artifact_trg
  BEFORE INSERT OR UPDATE ON artifact_bindings
  FOR EACH ROW EXECUTE FUNCTION binding_version_belongs_to_artifact();

-- ---------------------------------------------------------------------------------------
-- I-11 / A3: modes only go up, and a pinned binding never moves
-- ---------------------------------------------------------------------------------------
-- Rank: draft(0) < live(1) < pinned(2). An UPDATE may raise the rank and may do nothing
-- else. Three things are refused, and each of them is a different way of un-pinning:
--
--   1. pinned -> live / draft            the literal downgrade (A3)
--   2. pinned -> pinned, other version   re-aiming a citation at bytes the reader of the
--                                        original decision never saw. Not called a
--                                        "downgrade" anywhere in the spec, and it destroys
--                                        the same guarantee: I-8 says the source moving does
--                                        not move the binding, and this is the source moving
--                                        by hand.
--   3. re-targeting artifact / project / step
--                                        "upgrade this binding" turning into "point this
--                                        binding at a different artifact" -- the unique
--                                        constraint would still hold and the row id, which
--                                        is what any audit trail recorded, would still exist.
--
-- Enforced in the DATABASE and not only in the use case, because there are two writers
-- already (bindToProjectStep upgrades an existing row, upgradeBinding pins one) and a rule
-- held in one use case holds until the second use case.
CREATE OR REPLACE FUNCTION binding_mode_monotonic() RETURNS trigger AS $$
DECLARE
  rank_old integer;
  rank_new integer;
BEGIN
  IF NEW.artifact_id <> OLD.artifact_id
     OR NEW.project_id <> OLD.project_id
     OR NEW.step_id <> OLD.step_id
     OR NEW.org_id <> OLD.org_id THEN
    RAISE EXCEPTION
      'binding % cannot be re-targeted (artifact/project/step are its identity); create a new binding instead',
      OLD.id;
  END IF;

  rank_old := CASE OLD.mode WHEN 'draft' THEN 0 WHEN 'live' THEN 1 ELSE 2 END;
  rank_new := CASE NEW.mode WHEN 'draft' THEN 0 WHEN 'live' THEN 1 ELSE 2 END;

  IF rank_new < rank_old THEN
    RAISE EXCEPTION
      'CANNOT_DOWNGRADE: binding % is %, which cannot become % (invariant I-11 / A3)',
      OLD.id, OLD.mode, NEW.mode
      USING ERRCODE = 'raise_exception',
            HINT = 'A pinned snapshot may already be cited; correct it by pinning a new binding elsewhere.';
  END IF;

  IF OLD.mode = 'pinned' AND NEW.pinned_version_id IS DISTINCT FROM OLD.pinned_version_id THEN
    RAISE EXCEPTION
      'CANNOT_DOWNGRADE: binding % is pinned to % and cannot be re-pointed at % (invariant I-8)',
      OLD.id, OLD.pinned_version_id, NEW.pinned_version_id
      USING ERRCODE = 'raise_exception',
            HINT = 'Pinning is what makes the source moving harmless; moving the pin re-introduces the drift.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS binding_mode_monotonic_trg ON artifact_bindings;
CREATE TRIGGER binding_mode_monotonic_trg
  BEFORE UPDATE ON artifact_bindings
  FOR EACH ROW EXECUTE FUNCTION binding_mode_monotonic();

-- ---------------------------------------------------------------------------------------
-- ...and DELETE is the same downgrade spelled differently
-- ---------------------------------------------------------------------------------------
-- This is 0007's lesson applied before it has a chance to be learned again. A rule enforced
-- only on UPDATE is bypassed by `DELETE` followed by `INSERT ... mode='live'`: the project
-- side goes from `已定版 v3` to `实时 · 随源变动`, which is precisely what A3 forbids, and
-- every UPDATE-side assertion stays green throughout.
--
-- Scoped to PINNED bindings on purpose. A draft or live binding is not a citation and
-- nothing in the spec makes it permanent; refusing to delete those would be a rule invented
-- here. The residual opening is the same one 0007 documented and no wider: removing the
-- whole organization, detected by the parent row already being gone inside the cascade.
CREATE OR REPLACE FUNCTION pinned_binding_undeletable() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = OLD.org_id) THEN
    RETURN OLD;
  END IF;

  IF OLD.mode = 'pinned' THEN
    RAISE EXCEPTION
      'CANNOT_DOWNGRADE: binding % is pinned to % and cannot be deleted (invariant I-11)',
      OLD.id, OLD.pinned_version_id
      USING ERRCODE = 'raise_exception',
            DETAIL  = 'Deleting a pinned binding and re-creating it as live is a downgrade; it is refused as one.',
            HINT    = 'Deleting the parent artifact or project reaches this row by cascade and is refused for the same reason.';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pinned_binding_undeletable_trg ON artifact_bindings;
CREATE TRIGGER pinned_binding_undeletable_trg
  BEFORE DELETE ON artifact_bindings
  FOR EACH ROW EXECUTE FUNCTION pinned_binding_undeletable();

-- ---------------------------------------------------------------------------------------
-- RLS, same rule as every other tenant table
-- ---------------------------------------------------------------------------------------
-- kernel_tenant_table_audit() (0004) discovers this table from the catalog the moment it
-- exists, so verify-rls.sh fails if this block is ever dropped. The gate is not told about
-- new tables; it finds them.
ALTER TABLE artifact_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_bindings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS artifact_bindings_tenant ON artifact_bindings;
CREATE POLICY artifact_bindings_tenant ON artifact_bindings
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON artifact_bindings FROM app_rw;

-- SELECT / INSERT / UPDATE, and deliberately NO DELETE.
--
-- UPDATE is needed: `bindToProjectStep` publishes a draft by raising its mode, and
-- `upgradeBinding` freezes a live one. Both are constrained to raising the rank by the
-- trigger above, so holding UPDATE grants the ability to upgrade and nothing else.
--
-- DELETE is withheld because the contract has NO unbind operation -- `usecases.md` lists
-- nine operations and none of them removes a binding. Granting a privilege for an operation
-- that does not exist is how the first implementation of it ends up being an ad-hoc DELETE.
-- (`unbound` is in ARTIFACT_PROVENANCE_EVENTS, so unbinding is clearly foreseen; it has no
-- interface yet. Reported rather than invented here.)
GRANT SELECT, INSERT, UPDATE ON artifact_bindings TO app_rw;

COMMENT ON TABLE artifact_bindings IS
  'Three-mode backflow bindings (uc-0-1 R3). A binding names a VERSION, not just an '
  'artifact: pinned freezes to one immutable artifact_version, live resolves to the head, '
  'draft is private to created_by and never appears on the project side (I-12). Modes only '
  'ever go up, and a pinned binding can be neither re-pointed nor deleted (I-8 / I-11).';
