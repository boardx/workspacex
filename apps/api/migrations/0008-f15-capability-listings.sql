-- 0008 F15: the capability listing is ORGANIZATION CONFIGURATION, not a product built-in
-- (uc-0-5 R3/R7/R12 V1 V2 V8 V10 V12, contracts/identity/domain.md CapabilityListing / I-10)
--
-- ## What this table is for
--
-- Six kinds -- agent / skill / model / mcp / canvas-template / blueprint -- each row hanging
-- off exactly one organization. The prototype's six agents and eighteen models are one
-- organization's EXAMPLE configuration; nothing about them belongs in product code, and
-- nothing about them belongs in this file either.
--
-- ⚠ THERE ARE NO INSERTS IN THIS MIGRATION, AND THAT IS THE FEATURE.
-- A seeded "recommended default" here would be indistinguishable, from every layer above,
-- from configuration a human made -- and it would ship a built-in list through the one door
-- the static lint cannot see (the lint reads TypeScript, not SQL). Acceptance V1 says an
-- organization with no configuration shows an empty state, so an organization with no
-- configuration must HAVE no configuration. `no-builtin-capability-lists.test.ts` asserts
-- that no migration file inserts into this table.
--
-- ## Why the visibility scope is a column here rather than a row in acl_bindings
--
-- `acl_bindings.object_kind` is CHECKed to project / artifact / segment: it binds
-- CONTENT, and its I-1 trigger resolves each object against its organization through the
-- content tables. A capability is not content -- it is the configuration that decides what
-- may act ON content. Widening that CHECK would put two unrelated lifecycles in one table
-- and make the I-1 trigger answer a question it has no table to answer it from.
--
-- The rule that reads the column is NOT duplicated: `decideCapabilityVisibility` feeds this
-- scope into the same `decide()` every other read uses (domain/identity/capability-listing.ts).
-- One decision function, two sources of scope, which is the arrangement `permission-filter`
-- already documents for F03's content read.
--
-- Replayable: every statement is IF NOT EXISTS / DROP-then-CREATE, because migrate:check
-- replays each file ignoring the version table.

CREATE TABLE IF NOT EXISTS capability_listings (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- The six kinds, closed. Same list as `identity.CapabilityKind` in the contract; the
  -- reconciliation is asserted (org-scoped-capabilities.test.ts) rather than trusted, the
  -- same arrangement provenance_events already uses for its event-type CHECK.
  kind          text NOT NULL CHECK (kind IN ('agent', 'skill', 'model', 'mcp', 'canvas-template', 'blueprint')),
  name          text NOT NULL,
  scope         text NOT NULL CHECK (scope IN ('org-wide', 'team-only')),
  -- Which team a team-only capability belongs to. NULL for org-wide.
  owner_team_id text REFERENCES teams (id) ON DELETE SET NULL,
  -- Disabled, NOT deleted, and NOT hidden: R8 says a capability the organization may not use
  -- must be shown greyed out with a reason, because hiding it reads as "the product cannot do
  -- this" when the truth is "this organization does not allow it".
  enabled       boolean NOT NULL DEFAULT true,
  -- Same shape as acl_bindings_team_only_needs_team, for the same reason: a team-only row
  -- with no owning team is not a stricter rule, it is an unanswerable one -- and unanswerable
  -- rules get resolved as "allow" by whoever implements the caller.
  CONSTRAINT capability_listings_team_only_needs_team
    CHECK (scope <> 'team-only' OR owner_team_id IS NOT NULL),
  -- One name per kind per organization. Without it, "add" twice produces two rows the admin
  -- UI cannot tell apart, and "disable the Ledger agent" becomes ambiguous.
  CONSTRAINT capability_listings_uniq UNIQUE (org_id, kind, name)
);

CREATE INDEX IF NOT EXISTS capability_listings_org_kind_idx
  ON capability_listings (org_id, kind);

-- A capability's owning team must live in the SAME organization (the I-1 rule, applied to
-- the one foreign key that can cross a tenant boundary).
--
-- `owner_team_id REFERENCES teams(id)` alone does not say this: it says the team exists,
-- not that it is ours. A team-only capability owned by another tenant's team is not a
-- visible bug -- it simply never matches anybody, so the capability quietly disappears for
-- every member, which reads as "the admin has not configured it yet".
CREATE OR REPLACE FUNCTION capability_owner_team_same_org() RETURNS trigger AS $$
DECLARE
  team_org text;
BEGIN
  IF NEW.owner_team_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT org_id INTO team_org FROM teams WHERE id = NEW.owner_team_id;
  IF team_org IS NULL OR team_org <> NEW.org_id THEN
    RAISE EXCEPTION 'capability_listing owner_team % does not belong to org % (invariant I-1)',
      NEW.owner_team_id, NEW.org_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS capability_owner_team_same_org_trg ON capability_listings;
CREATE TRIGGER capability_owner_team_same_org_trg
  BEFORE INSERT OR UPDATE ON capability_listings
  FOR EACH ROW EXECUTE FUNCTION capability_owner_team_same_org();

-- ---------------------------------------------------------------------------------------
-- I-10: a personal-local organization's "local only" is a PROMISE, and a promise has no
-- switch -- not even one left at its default
-- ---------------------------------------------------------------------------------------
-- `organizations.model_policy` is the ADMIN-CHANGEABLE policy of a real organization
-- (uc-0-5 R10, ruling of 2026-07-28). A personal-local organization gets the same outcome
-- from a completely different source: it is derived from `kind`, and no interface can alter
-- it.
--
-- The domain note says local organizations "do not read this field". That is a statement
-- about code, and code is exactly what changes. This CHECK makes the database agree: a
-- personal-local row cannot even HOLD a configured policy, so a future reader that wrongly
-- consults `model_policy` for a local organization cannot find a value there that would let
-- the promise look switched off -- and an UPDATE trying to set one fails loudly instead of
-- creating a row whose existence implies the promise is configurable.
--
-- Restated: this constraint does not implement the promise. `resolveModelConstraint` derives
-- it from `kind` and is asserted to ignore this column entirely (org-model-policy.test.ts
-- sets a local org's policy through the owner path and asserts nothing changes). The CHECK
-- removes the state in which the two could be confused.
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_local_policy_is_not_configurable;
ALTER TABLE organizations ADD CONSTRAINT organizations_local_policy_is_not_configurable
  CHECK (kind <> 'personal-local' OR model_policy = 'any');

-- ---------------------------------------------------------------------------------------
-- RLS, same rule as every other tenant table
-- ---------------------------------------------------------------------------------------
-- kernel_tenant_table_audit() (0004) finds this table from the catalog the moment it
-- exists, so verify-rls.sh fails if this block is ever forgotten.
ALTER TABLE capability_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_listings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capability_listings_tenant ON capability_listings;
-- current_setting(..., true) is NULL when unset, so an un-scoped query sees nothing
-- (fail-closed) rather than everything.
CREATE POLICY capability_listings_tenant ON capability_listings
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- REVOKE first so a database that received an earlier version of this file converges rather
-- than accumulating privileges.
REVOKE ALL ON capability_listings FROM app_rw;
-- No DELETE, deliberately. R4 A3 / D-U5 make "stop using this" a DISABLE with a chosen
-- interruption mode and a provenance row; a DELETE would be the same intent with neither.
-- Removing a listing outright would also orphan every provenance event that names it, which
-- is the one thing an audit trail may not have done to it.
GRANT SELECT, INSERT, UPDATE ON capability_listings TO app_rw;
