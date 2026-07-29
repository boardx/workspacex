-- 0005 f03: the admin boundary -- a real read path, and the trail it leaves
--
-- Two tables, both of which exist because an assertion needed something real to assert
-- against:
--
--   content_items      There has to be a READ PATH for "an admin is denied project
--                      content" to mean anything. Proving it inside the decision function
--                      only proves the function; D-18 is about what the endpoints do.
--
--   provenance_events  R4 A1 lets an admin read project content FOR AUDIT, on condition
--                      that every such access is logged and the log is visible to the
--                      project lead. A promise nobody can query is not a promise.
--
-- ⚠ provenance_events is ONE table with ONE query surface (coherence review X-2). The
-- identity and artifact bundles both write to it; neither owns it and neither may grow a
-- second one. The shared contract lives in packages/contracts/src/provenance.ts.
--
-- Replayable: every statement is IF NOT EXISTS / OR REPLACE / DROP-then-CREATE, because
-- migrate:check replays each file ignoring the version table.

-- ---------------------------------------------------------------------------------------
-- content_items -- the kernel's minimal content substrate
-- ---------------------------------------------------------------------------------------
-- Scope note, stated rather than left to be discovered: this is NOT the Artifact model.
-- F04 brings artifacts, versions and their lineage. What is here is the smallest thing
-- that makes the two-layer boundary observable end to end -- an item that belongs to a
-- layer, an owner, and (in the project layer) a project.
--
-- `layer` is a first-class column rather than "project_id IS NULL". The nullable-FK
-- encoding says the same thing today and stops saying it the moment anything else grows a
-- reason to have a null project -- and the rule it encodes is that the personal layer is
-- closed to everyone including admins, which is not something to leave implied.
CREATE TABLE IF NOT EXISTS content_items (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  layer         text NOT NULL CHECK (layer IN ('personal', 'project')),
  -- Set exactly when layer = 'project'. See the CHECK below.
  project_id    text REFERENCES projects (id) ON DELETE CASCADE,
  -- NULL = shared with the whole room; a group id = this group's content only.
  group_id      text REFERENCES groups (id) ON DELETE SET NULL,
  owner_user_id text NOT NULL,
  -- A draft is visible to its creator ALONE (uc-0-1 R5). Its status is therefore a
  -- permission fact, not a display state, which is why it lives next to the ownership
  -- columns rather than in some presentation table.
  status        text NOT NULL CHECK (status IN ('draft', 'published')),
  body          text NOT NULL,
  -- The personal layer has no project by definition, and a project-layer item without a
  -- project is unjudgeable -- the two-layer intersection has nothing to intersect. Leaving
  -- it to application code means the first caller that forgets produces a row that reads
  -- as "personal" to one query and "project" to another.
  CONSTRAINT content_items_layer_project CHECK (
    (layer = 'project' AND project_id IS NOT NULL)
    OR (layer = 'personal' AND project_id IS NULL AND group_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS content_items_project_idx ON content_items (org_id, project_id);
-- The personal-layer summary counts by owner. Without this it is a sequential scan, and a
-- slow count is how "just return the items and count them client-side" gets proposed.
CREATE INDEX IF NOT EXISTS content_items_owner_idx ON content_items (org_id, owner_user_id)
  WHERE layer = 'personal';

-- ---------------------------------------------------------------------------------------
-- provenance_events -- append-only, shared by both contract bundles
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provenance_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Closed enum. It is a COPY of ProvenanceEventType in the shared contract, and a copy is
  -- exactly what this project has been burned by six times -- so it is not left as a copy:
  -- `admin-audit-access-visible-to-lead.test.ts` reads this constraint out of the catalog
  -- and asserts it equals the contract's enum, member for member. Add a type to the
  -- contract without touching this line and that test goes red naming the missing value.
  --
  -- Why keep the constraint at all rather than validating only in the application: the
  -- application is one writer among the several this table will have, and "which actions
  -- left a trail" stops being answerable the moment one of them invents its own vocabulary.
  type        text NOT NULL CHECK (type IN (
    'ingested', 'transformed', 'generated', 'human-edited', 'pinned', 'bound', 'unbound',
    'superseded', 'evidence-withdrawn',
    'capability-added', 'capability-updated', 'capability-disabled', 'role-changed',
    'team-changed', 'admin-project-access', 'local-export',
    'unauthorized-attempt'
  )),
  actor_id    text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  target_kind text NOT NULL CHECK (target_kind IN (
    'artifact', 'artifact-version', 'capability', 'membership', 'project', 'organization'
  )),
  target_id   text NOT NULL,
  -- Interpreted according to `type`. A generic bag rather than typed columns because the
  -- event types genuinely describe different things; the closed `type` enum is what keeps
  -- that from becoming a free-for-all.
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- The query surface filters on all four of these; a project lead asking "who read my
-- project" hits (org_id, target_kind, target_id, at).
CREATE INDEX IF NOT EXISTS provenance_events_target_idx
  ON provenance_events (org_id, target_kind, target_id, at DESC);
CREATE INDEX IF NOT EXISTS provenance_events_actor_idx
  ON provenance_events (org_id, actor_id, at DESC);

-- ---------------------------------------------------------------------------------------
-- RLS: same rule as every other tenant table (F18 kernel rule -- a table without a policy
-- is a hole, and holes do not get filled in later "once the model settles").
-- ---------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['content_items', 'provenance_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    -- current_setting(..., true) is NULL when unset, so an un-scoped query sees nothing
    -- (fail-closed) rather than everything.
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      t || '_tenant', t);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON content_items TO app_rw;

-- ---------------------------------------------------------------------------------------
-- Append-only, enforced by the GRANT rather than by application discipline
-- ---------------------------------------------------------------------------------------
-- "No UPDATE, no DELETE" is the whole value of an audit trail. Enforcing it in the writing
-- code means it holds for as long as everyone remembers; enforcing it here means the
-- runtime role is physically unable to do it, and the counter-proof is one SQL statement.
--
-- REVOKE first, so a database that got the earlier grants keeps converging on this state
-- when the file is replayed.
--
-- The OWNER can still delete -- deliberately, and this is the limit of the guarantee:
-- retention and migration are owner-side operations, and ON DELETE CASCADE from
-- organizations relies on it. What is guaranteed is that NOTHING SERVING TRAFFIC can
-- rewrite history, which is the threat this is about.
REVOKE ALL ON provenance_events FROM app_rw;
GRANT SELECT, INSERT ON provenance_events TO app_rw;
