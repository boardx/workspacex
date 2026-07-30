-- 0019 F48: the model pool is ORGANIZATION CONFIGURATION, and its credentials are
-- WRITE-ONLY (uc-20-1 R7 AC3, contracts/agent-runtime/domain.md A 组, invariants I-3…I-8)
--
-- ## Three tables, and why the credential is not a column on the first one
--
-- `models` holds what the admin console lists: kind, vendor, capability tags, context
-- window, unit price, compliance attributes, status. `model_composite_members` holds the
-- ordered pipeline of a composite record. `model_secrets` holds ciphertext and NOTHING
-- else that a listing query would ever want.
--
-- The split is the enforcement. A `credential_ciphertext` column on `models` is one
-- `SELECT *` away from a response body, and `SELECT *` is what a repository writes on its
-- first day. In a separate table whose ciphertext column is granted to nobody, the same
-- mistake is a permissions error at the database, not a leak with a green test suite.
--
-- ⚠ app_rw gets a COLUMN-LEVEL SELECT on `model_secrets` that omits `ciphertext` (see the
-- GRANT at the bottom of this file for the full argument). Metadata is readable; the secret
-- is not readable by anybody. Phase-1 has no outbound provider gateway (domain.md 四 -- the
-- model gateway is not this bundle's, and `routeModelCall` will be its single entry point),
-- so nothing legitimately reads a credential yet. When the gateway is built it needs its
-- own role and its own column grant, reviewed on its own merits.
--
-- ## ⚠ THERE ARE NO INSERTS IN THIS MIGRATION, AND THAT IS THE FEATURE
--
-- The prototype's eighteen models are one organization's example configuration
-- (uc-20-1 R6, uc-0-5 R12 V1). A seeded "recommended set" here would be indistinguishable
-- from configuration a human made, and it would enter through the one door a TypeScript
-- scanner cannot see. `no-hardcoded-model-list.test.ts` asserts no migration inserts into
-- these tables, the same way `no-builtin-capability-lists.test.ts` does for
-- capability_listings.
--
-- ## Why `status` is CHECKed against four values when F48's prose says three
--
-- F48's `user_visible_behavior` names three (已启用 / 未启用 / 待测试); the contract's
-- `ModelStatus` has four (待测试 / 已启用 / 已停用 / 依赖失败) and the prototype's mock has
-- three ENGLISH ones (enabled / disabled / untested). That is a live, registered divergence
-- -- `apps/web/lib/contract-divergences.ts` D01 (closed-api vs hosted-api) and D02 (the
-- missing 依赖失败) -- awaiting the human sign-off on this bundle. The schema follows the
-- CONTRACT because the contract is the declared single source (ADR-020); it does not settle
-- the divergence, and `registry-fields.test.ts` pins D01/D02 so that whichever way the
-- ruling goes, something fails until all three sides are moved together.
--
-- Replayable: every statement is IF NOT EXISTS / DROP-then-CREATE, because migrate:check
-- replays each file ignoring the version table.

CREATE TABLE IF NOT EXISTS models (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- The binary division (I-4). Same members as `agentRuntime.ModelKind`; the reconciliation
  -- is asserted (registry-fields.test.ts) rather than trusted, the same arrangement
  -- capability_listings uses for its kind CHECK.
  kind            text NOT NULL CHECK (kind IN ('closed-api', 'self-hosted')),
  -- Single model or composite record (O-22③). A composite is ONE row here with members in
  -- model_composite_members -- not two model_ids stitched together on the agent.
  shape           text NOT NULL CHECK (shape IN ('single', 'composite')),
  vendor          text NOT NULL,
  display_name    text NOT NULL,
  -- Capability tags and compliance attributes are both SETS of short strings. text[] rather
  -- than a join table: neither is referenced by anything, and a join table would invite a
  -- lookup table of allowed values -- which for compliance attributes is exactly the
  -- hardcoded vocabulary O-38 forbids.
  capability_tags text[] NOT NULL DEFAULT '{}',
  context_window  integer NOT NULL CHECK (context_window > 0),
  -- CNY, maintained by hand, never synced from a vendor (O-37). numeric, not float: a price
  -- that cannot represent 0.06 exactly is a price that disagrees with the invoice.
  unit_price      numeric(12, 6) NOT NULL CHECK (unit_price >= 0),
  -- ⚠ NO CHECK constraint, and that is the ruling, not an omission. O-38: the vocabulary is
  -- 部署区域清单 ∩ 目标客户法域清单, both external inputs that do not exist yet, so the enum
  -- is controlled but currently EMPTY. A CHECK here would be a second copy of a value domain
  -- that has no first copy. The organization's configured vocabulary is enforced in
  -- `checkComplianceAttrs`, which takes it as a parameter and knows no values of its own.
  compliance_attrs text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL CHECK (status IN ('待测试', '已启用', '已停用', '依赖失败')),
  -- One display name per organization, so "disable qwen3-32b" is never ambiguous. Same
  -- reasoning as capability_listings_uniq.
  CONSTRAINT models_uniq UNIQUE (org_id, display_name),
  -- A single model has no members and a composite must have them. Enforced by trigger
  -- below, since the member rows live in another table.
  CONSTRAINT models_shape_known CHECK (shape IN ('single', 'composite'))
);

CREATE INDEX IF NOT EXISTS models_org_status_idx ON models (org_id, status);

-- The ordered pipeline of a composite record (`whisper ＋ sonnet`).
CREATE TABLE IF NOT EXISTS model_composite_members (
  composite_id text NOT NULL REFERENCES models (id) ON DELETE CASCADE,
  member_id    text NOT NULL REFERENCES models (id) ON DELETE RESTRICT,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 转录 → 生成, 本地预处理 → 闭源生成 … free text: the roles are the pipeline's own
  -- vocabulary and no rule reads them.
  role         text NOT NULL,
  position     integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (composite_id, member_id),
  -- Order within the pipeline is part of the record: `whisper → sonnet` and `sonnet →
  -- whisper` are different chains.
  CONSTRAINT model_composite_members_ordered UNIQUE (composite_id, position),
  -- ON DELETE RESTRICT above plus this: a member may not be its own composite. Without it,
  -- effectiveKind's walk over members would not terminate on a hand-inserted row.
  CONSTRAINT model_composite_members_no_self CHECK (composite_id <> member_id)
);

-- I-4 / I-5 applied to the one foreign key that can cross a tenant boundary, and to the one
-- that can cross a shape boundary.
--
-- `member_id REFERENCES models(id)` alone says the model exists, not that it is ours and not
-- that the thing pointing at it is a composite. A member owned by another tenant is not a
-- visible bug: it simply never resolves for anyone in this organization, so the composite
-- quietly behaves as if it had one fewer member -- which is precisely the silent degradation
-- to a single model that I-5 forbids.
CREATE OR REPLACE FUNCTION model_member_same_org_and_shape() RETURNS trigger AS $$
DECLARE
  member_org   text;
  member_shape text;
  parent_org   text;
  parent_shape text;
BEGIN
  SELECT org_id, shape INTO member_org, member_shape FROM models WHERE id = NEW.member_id;
  SELECT org_id, shape INTO parent_org, parent_shape FROM models WHERE id = NEW.composite_id;
  IF member_org IS NULL OR member_org <> NEW.org_id OR parent_org <> NEW.org_id THEN
    RAISE EXCEPTION 'composite % and member % must belong to org % (invariant I-1)',
      NEW.composite_id, NEW.member_id, NEW.org_id;
  END IF;
  IF parent_shape <> 'composite' THEN
    RAISE EXCEPTION 'model % is shape % and cannot own pipeline members (O-22③)',
      NEW.composite_id, parent_shape;
  END IF;
  -- Nesting is refused rather than supported. A composite of composites has no ruling
  -- behind it, and `effectiveKind`/`effectiveComplianceAttrs` are stated over a flat member
  -- list; accepting one would make the domain's answer and the schema's contents disagree.
  IF member_shape = 'composite' THEN
    RAISE EXCEPTION 'composite % may not nest composite member % (no ruling exists for nesting)',
      NEW.composite_id, NEW.member_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS model_member_same_org_and_shape_trg ON model_composite_members;
CREATE TRIGGER model_member_same_org_and_shape_trg
  BEFORE INSERT OR UPDATE ON model_composite_members
  FOR EACH ROW EXECUTE FUNCTION model_member_same_org_and_shape();

-- ---------------------------------------------------------------------------------------
-- The secrets. Separate table, no SELECT grant.
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_secrets (
  model_id   text NOT NULL REFERENCES models (id) ON DELETE CASCADE,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 'credential' | 'endpoint'. Both are sealed by the same vault and both are withheld from
  -- non-admins for the same reason (an internal address is as much a fact about the network
  -- as a key is about access, uc-21-1 R: 内网地址属敏感信息).
  secret_kind text NOT NULL CHECK (secret_kind IN ('credential', 'endpoint')),
  -- ⚠ Ciphertext. There is no plaintext column, so there is no state in which the plaintext
  -- was written "temporarily".
  ciphertext text NOT NULL,
  algorithm  text NOT NULL,
  key_id     text NOT NULL,
  sealed_at  timestamptz NOT NULL,
  PRIMARY KEY (model_id, secret_kind)
);

-- ---------------------------------------------------------------------------------------
-- RLS, same rule as every other tenant table
-- ---------------------------------------------------------------------------------------
-- kernel_tenant_table_audit() (0004) finds these from the catalog the moment they exist, so
-- verify-rls.sh fails if any of these blocks is ever forgotten.
ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE models FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS models_tenant ON models;
-- current_setting(..., true) is NULL when unset, so an un-scoped query sees nothing
-- (fail-closed) rather than everything.
CREATE POLICY models_tenant ON models
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

ALTER TABLE model_composite_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_composite_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS model_composite_members_tenant ON model_composite_members;
CREATE POLICY model_composite_members_tenant ON model_composite_members
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

ALTER TABLE model_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_secrets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS model_secrets_tenant ON model_secrets;
CREATE POLICY model_secrets_tenant ON model_secrets
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- REVOKE first so a database that received an earlier version of this file converges rather
-- than accumulating privileges.
REVOKE ALL ON models FROM app_rw;
REVOKE ALL ON model_composite_members FROM app_rw;
REVOKE ALL ON model_secrets FROM app_rw;

-- No DELETE on models, deliberately: uc-20-2 R3 makes "stop using this" a DISABLE with a
-- chosen interruption mode and a cascade the admin was shown first (listModelReferences).
-- A DELETE would be the same intent with neither, and it would orphan every provenance
-- event and every locked agent version that names the model.
GRANT SELECT, INSERT, UPDATE ON models TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON model_composite_members TO app_rw;

-- ⚠ THE ONE THAT MATTERS: a COLUMN-LEVEL SELECT that omits `ciphertext`.
--
-- The application role may read the metadata of a secret -- that one exists, which model it
-- belongs to, which key sealed it, when -- and CANNOT read the secret itself. `SELECT *`
-- and `SELECT ciphertext` both fail with `permission denied for column ciphertext`, so
-- "永不回显" (I-6) does not depend on every future repository method remembering to exclude
-- a column: the database refuses.
--
-- ## Why not simply withhold SELECT on the whole table
--
-- That was the first version of this file, and CI proved it wrong. A table-wide denial also
-- blocks `count(*)`, and this kernel has several CATALOG-DERIVED sweeps that count rows in
-- every tenant table -- `PgOrgLifecycleRepository.tableCounts` (the organization export
-- manifest, F22), plus the cross-tenant leak assertions. Those sweeps are right to exist:
-- an export that silently omits a table is worse than one that fails, because the customer
-- believes they took everything. They are also right to be derived rather than listed.
--
-- So the requirement is not "unreadable" but "the SECRET is unreadable", and PostgreSQL
-- expresses exactly that. `count(*)` needs privilege on any one column, and `org_id` is
-- granted; `ciphertext` is not granted to anybody.
--
-- ⚠ Columns are enumerated, not defaulted. A future column holding anything derived from
-- the plaintext must be added here DELIBERATELY, and a new column that is simply forgotten
-- is unreadable rather than exposed -- the fail-closed direction.
GRANT SELECT (model_id, org_id, secret_kind, algorithm, key_id, sealed_at)
  ON model_secrets TO app_rw;

GRANT INSERT, UPDATE, DELETE ON model_secrets TO app_rw;

-- ---------------------------------------------------------------------------------------
-- F22's three RESTRICTIVE freeze policies, installed on the three tables just created
-- ---------------------------------------------------------------------------------------
-- 0014 declares the rule as a function precisely so later migrations can call it: its own
-- number is lower than this one, so on a FRESH database it runs before these tables exist
-- and they would get no freeze policies at all -- while every F22 assertion stayed green,
-- because those assertions cover the tables that existed when they were written. That is
-- not hypothetical; 0014's header records it happening to F17's `local_export_previews`,
-- caught only by migrate:check's forced replay.
--
-- Calling it here rather than copying the three CREATE POLICY statements: the rule stays
-- declared in exactly one place.
SELECT kernel_apply_org_freeze_policies();
