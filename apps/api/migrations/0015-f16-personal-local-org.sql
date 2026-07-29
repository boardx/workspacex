-- 0012 F16: the personal-local organization -- "the most private data does not leave this
-- machine" (uc-0-5 R7, identity domain.md I-2 / I-3 / I-9 / I-10)
--
-- ## What this file is trying to be
--
-- "Does not leave this machine" is a PRODUCT PROMISE. A promise that lives only in
-- application code is one refactor away from being false, and the failure is silent: the
-- data goes out, everything returns 200, and nobody learns anything. So every part of the
-- promise that can be made a database property is made one here -- the database is the layer
-- no caller can route around.
--
--   I-2  exactly one personal-local org per user      -> partial UNIQUE index
--   I-3  a personal-local org has exactly one member   -> trigger, both directions
--   I-10 the promise has no switch                     -> 0008's CHECK + this file's triggers
--   guarantee 1 (local models only)                    -> endpoint trigger on capability_listings
--   guarantee 3 (no shared object storage)             -> storage-key prefix trigger
--
-- ## ⚠ CREATE TABLE IF NOT EXISTS is a SILENT no-op on an existing table
--
-- Nothing here creates a table for that reason: `organizations` and `capability_listings`
-- already exist, so their new columns and constraints arrive as ALTER ... DROP/ADD, which
-- converge on every database rather than only on empty ones. Same arrangement as the
-- reconciliation block at the end of 0010.
--
-- Replayable: every statement is IF NOT EXISTS / OR REPLACE / DROP-then-CREATE, because
-- migrate:check replays each file ignoring the version table.

/* ───────────────────── I-2: exactly one local org per user ───────────────────── */

-- Who this organization belongs to. NULL for a real organization -- a real organization
-- has members, not an owner, and O-12 made `user <-> organization` many-to-many.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS owner_user_id text;

-- The two halves of "owner_user_id means personal-local":
--   * a personal-local org without an owner cannot answer "whose machine is this"
--   * a real org WITH an owner would be a personal-local org wearing the other kind's label,
--     and every rule keyed on `kind` would quietly not apply to it
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_owner_iff_personal_local;
ALTER TABLE organizations ADD CONSTRAINT organizations_owner_iff_personal_local
  CHECK ((kind = 'personal-local') = (owner_user_id IS NOT NULL));

-- I-2 itself. A partial unique index rather than application logic, because the only
-- version of "exactly one" that survives concurrency is the one the database enforces:
-- two simultaneous registrations for the same user would both SELECT "none exists" and both
-- INSERT, and the result is two local organizations with no error anywhere.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_one_personal_local_per_user
  ON organizations (owner_user_id) WHERE kind = 'personal-local';

/* ───────────────────── I-3: a local org is a single-member org ───────────────────── */

-- The 2026-07-28 ruling: a personal-local organization is PERMANENTLY single-member; there
-- is no invitation flow. The contract expresses that as `canInvite: z.literal(false)` and
-- the frontend renders no invite control -- but "the UI has no button" is not an isolation
-- guarantee, it is an absence of one particular caller.
--
-- ⚠ Both directions are checked, and the second one matters more than it looks:
--   (a) a member who is not the owner  -> the promise would be made to one person about a
--       machine another person can now read from
--   (b) a SECOND row for the owner     -> impossible via the PK, so not checked here
--   (c) any row when one already exists -> the count check below
CREATE OR REPLACE FUNCTION personal_local_org_is_single_member() RETURNS trigger AS $$
DECLARE
  org_kind  text;
  org_owner text;
  existing  int;
BEGIN
  SELECT kind, owner_user_id INTO org_kind, org_owner
    FROM organizations WHERE id = NEW.org_id;

  IF org_kind IS DISTINCT FROM 'personal-local' THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM org_owner THEN
    RAISE EXCEPTION
      'personal-local org % admits only its owner (invariant I-3): % is not %',
      NEW.org_id, NEW.user_id, org_owner;
  END IF;

  SELECT count(*) INTO existing
    FROM org_memberships WHERE org_id = NEW.org_id AND user_id <> NEW.user_id;
  IF existing > 0 THEN
    RAISE EXCEPTION
      'personal-local org % already has % other member(s) (invariant I-3)', NEW.org_id, existing;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS personal_local_org_is_single_member_trg ON org_memberships;
CREATE TRIGGER personal_local_org_is_single_member_trg
  BEFORE INSERT OR UPDATE ON org_memberships
  FOR EACH ROW EXECUTE FUNCTION personal_local_org_is_single_member();

/* ──────────── guarantee 1: model / MCP endpoints must be on this machine ──────────── */

-- The endpoint, as a column (contract revision of 2026-07-29, `CapabilityListing.endpoint`).
--
-- ⚠ It is an ENDPOINT, not a `kind: 'cloud' | 'self-hosted'` label. A label can disagree
-- with reality -- a row marked `self-hosted` pointing at api.vendor.com would switch the
-- promise off and nothing could notice, because nothing verifies a label. The endpoint IS
-- the fact; "is this cloud" is derived from it by one function on both sides of the wire
-- (`isLocalModelEndpoint`, packages/contracts/src/identity.ts).
ALTER TABLE capability_listings ADD COLUMN IF NOT EXISTS endpoint text;

-- The database's half of guarantee 1.
--
-- The application refuses a cloud endpoint too (`invokeLocalModel` -> CLOUD_MODEL_FORBIDDEN),
-- and that refusal is what the user sees. This trigger is about a different failure: a row
-- that should never have existed. Without it, a local organization could HOLD a cloud model
-- row -- and then the promise depends on every future reader remembering to filter, which is
-- the shape of rule that eventually stops being applied.
--
-- ⚠ The host test is deliberately narrow: loopback only. A LAN address is not "this
-- machine". Customers who need multi-host self-hosting use a real organization with
-- `modelPolicy = 'self-hosted-only'` (F15) -- a POLICY, which a deployment may loosen. A
-- promise may not be loosened, which is the whole reason the two are separate fields.
CREATE OR REPLACE FUNCTION local_org_endpoint_stays_local() RETURNS trigger AS $$
DECLARE
  org_kind text;
  host     text;
BEGIN
  IF NEW.endpoint IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT kind INTO org_kind FROM organizations WHERE id = NEW.org_id;
  IF org_kind IS DISTINCT FROM 'personal-local' THEN
    RETURN NEW;
  END IF;

  IF NEW.endpoint LIKE 'unix:%' THEN
    RETURN NEW;
  END IF;

  -- scheme://host[:port]/... -> host
  host := lower(split_part(split_part(regexp_replace(NEW.endpoint, '^[a-zA-Z0-9+.-]+://', ''), '/', 1), ':', 1));
  host := trim(both '[]' from host);

  IF host = 'localhost' OR host = '::1' OR host ~ '^127\.' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'capability % in personal-local org % points at % -- guarantee "local-model-only" allows only loopback endpoints',
    NEW.name, NEW.org_id, NEW.endpoint;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS local_org_endpoint_stays_local_trg ON capability_listings;
CREATE TRIGGER local_org_endpoint_stays_local_trg
  BEFORE INSERT OR UPDATE ON capability_listings
  FOR EACH ROW EXECUTE FUNCTION local_org_endpoint_stays_local();

/* ────────── guarantee 3: local bytes live under a local-only storage prefix ────────── */

-- `artifact_versions.object_storage_key` is where a version's bytes are. For a local
-- organization every key must sit under `local/<orgId>/` (contract:
-- `localObjectKeyPrefix`), and this trigger is what makes "must" mean something.
--
-- ## What this does and does not prove
--
-- It proves the KEY SPACE is separated: no local organization's object can be addressed
-- outside that prefix, and (below) nothing else may be addressed inside it. That is what
-- makes "which bytes must not leave this machine" a set you can point at, instead of an
-- adjective.
--
-- It does NOT prove the prefix is mounted on local storage -- that is deployment
-- configuration, exactly like FsObjectStore's note about S3 object-lock. Stated here rather
-- than left implied by a passing test, because a reader who assumes the trigger delivers the
-- whole guarantee would stop looking for the other half.
CREATE OR REPLACE FUNCTION local_org_objects_stay_local() RETURNS trigger AS $$
DECLARE
  org_kind text;
  want     text;
BEGIN
  SELECT kind INTO org_kind FROM organizations WHERE id = NEW.org_id;
  want := 'local/' || NEW.org_id || '/';

  IF org_kind = 'personal-local' THEN
    IF position(want in NEW.object_storage_key) <> 1 THEN
      RAISE EXCEPTION
        'version % of personal-local org % must be stored under % (guarantee "no-shared-storage"), got %',
        NEW.id, NEW.org_id, want, NEW.object_storage_key;
    END IF;
  ELSE
    -- The other direction, and it is not symmetry for its own sake: without it, a REAL
    -- organization could write into `local/...` and the prefix would stop being a reliable
    -- answer to "is this object one of the ones that may not leave". A boundary only one
    -- side respects is not a boundary.
    IF NEW.object_storage_key LIKE 'local/%' THEN
      RAISE EXCEPTION
        'org % is not personal-local and may not write into the local-only prefix (key %)',
        NEW.org_id, NEW.object_storage_key;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS local_org_objects_stay_local_trg ON artifact_versions;
CREATE TRIGGER local_org_objects_stay_local_trg
  BEFORE INSERT OR UPDATE ON artifact_versions
  FOR EACH ROW EXECUTE FUNCTION local_org_objects_stay_local();

/* ─────────────────────────────── documentation ─────────────────────────────── */

COMMENT ON COLUMN organizations.owner_user_id IS
  'F16: the single owner of a personal-local organization; NULL for real organizations. '
  'Paired with the partial unique index organizations_one_personal_local_per_user, this is '
  'invariant I-2 ("exactly one personal-local org per user") as a database property rather '
  'than an application convention.';

COMMENT ON COLUMN capability_listings.endpoint IS
  'F16 contract revision: where this capability actually runs. Deliberately an endpoint and '
  'not a cloud/self-hosted label -- a label can be wrong and nothing verifies it, while '
  '"is this cloud" derived from the endpoint has exactly one definition '
  '(isLocalModelEndpoint, packages/contracts/src/identity.ts).';
