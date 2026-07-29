-- 0003 identity: the two-layer role ontology (F01 / UC-0.3)
--
-- Everything -- org role, team, project role, resource visibility scope -- ends up as a
-- judgement over `acl_bindings`. There is deliberately no second or third permission
-- table (identity domain.md): three tables means three places to get it wrong, and the
-- one that is not consulted is the one that leaks.
--
-- Every table here carries org_id and is FORCE RLS'd on it. That is not F02's work
-- arriving early -- it is the kernel rule from F18: a table without a policy is a hole,
-- and holes are not something to add later "once the model settles".
--
-- Replayable: every statement is IF NOT EXISTS / OR REPLACE / DROP-then-CREATE, because
-- migrate:check replays each file ignoring the version table.

CREATE TABLE IF NOT EXISTS organizations (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  -- kind is a FIRST-CLASS field, not a special case branch. personal-local organizations
  -- share this table and the same ACL/RLS machinery as real ones -- a second code path
  -- for "local mode" is a path that rots (identity domain.md).
  kind         text NOT NULL CHECK (kind IN ('organization', 'personal-local')),
  -- Only meaningful for kind='organization'. A personal-local org's "local only" is a
  -- product PROMISE derived from kind, never read from here: expressing a promise with a
  -- writable field silently demotes it to a default (invariant I-10).
  model_policy text NOT NULL DEFAULT 'any' CHECK (model_policy IN ('any', 'self-hosted-only'))
);

CREATE TABLE IF NOT EXISTS teams (
  id     text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name   text NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id     text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name   text NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id         text PRIMARY KEY,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name       text NOT NULL
);

CREATE TABLE IF NOT EXISTS org_memberships (
  user_id  text NOT NULL,
  org_id   text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Four org roles. `compliance` was added by D-U3 so that a compliance officer is an
  -- ORG-level function rather than a third permission layer -- a third layer would turn
  -- authorization from a 2-way intersection into a 3-way one and the matrix from 4x3
  -- into 4x3xN.
  org_role text NOT NULL CHECK (org_role IN ('admin', 'lead', 'consultant', 'compliance')),
  -- Single team membership: one person, one team per org (O-12).
  team_id  text REFERENCES teams (id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, org_id)
);

CREATE TABLE IF NOT EXISTS project_memberships (
  user_id      text NOT NULL,
  project_id   text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Exactly four, forever (O-03). "Co-facilitator" is a second FACILITATOR INSTANCE, not a
  -- fifth role; "researcher"/"participant" are display aliases that never reach this column.
  project_role text NOT NULL CHECK (project_role IN ('facilitator', 'groupLead', 'member', 'observer')),
  group_id     text REFERENCES groups (id) ON DELETE SET NULL,
  -- One of possibly several facilitators holds final say (O-03).
  is_host      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS acl_bindings (
  id           bigserial PRIMARY KEY,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  subject_kind text NOT NULL CHECK (subject_kind IN ('user', 'group', 'team')),
  subject_id   text NOT NULL,
  -- Granularity MUST reach Segment (identity domain.md). Coarser than that and the
  -- "permission travels along the data path" rule cannot be expressed at all.
  object_kind  text NOT NULL CHECK (object_kind IN ('project', 'artifact', 'segment')),
  object_id    text NOT NULL,
  scope        text NOT NULL CHECK (scope IN ('org-wide', 'team-only')),
  -- Which team a team-only resource belongs to. NULL for org-wide.
  owner_team_id text REFERENCES teams (id) ON DELETE SET NULL,
  CONSTRAINT acl_bindings_uniq UNIQUE (org_id, subject_kind, subject_id, object_kind, object_id),
  -- A team-only binding without an owning team is not a stricter rule, it is an
  -- unanswerable one -- and unanswerable rules get resolved as "allow" by whoever
  -- implements the caller.
  CONSTRAINT acl_bindings_team_only_needs_team
    CHECK (scope <> 'team-only' OR owner_team_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS acl_bindings_object_idx ON acl_bindings (org_id, object_kind, object_id);

-- Invariant I-1: a binding's subject and object must live in the SAME organization.
--
-- A CHECK constraint cannot express this (it spans rows), so it is a trigger. Left to
-- application code it would hold until the first caller that forgets -- and a cross-org
-- binding does not error at read time, it silently authorises.
--
-- artifact/segment objects are not validated yet: those tables arrive with F04. The
-- trigger validates what exists and is written so adding them is one line each. This is a
-- KNOWN GAP, stated rather than left for someone to discover.
CREATE OR REPLACE FUNCTION acl_binding_same_org() RETURNS trigger AS $$
DECLARE
  subject_org text;
  object_org  text;
BEGIN
  IF NEW.subject_kind = 'user' THEN
    SELECT org_id INTO subject_org FROM org_memberships WHERE user_id = NEW.subject_id AND org_id = NEW.org_id;
  ELSIF NEW.subject_kind = 'team' THEN
    SELECT org_id INTO subject_org FROM teams WHERE id = NEW.subject_id;
  ELSIF NEW.subject_kind = 'group' THEN
    SELECT org_id INTO subject_org FROM groups WHERE id = NEW.subject_id;
  END IF;

  IF subject_org IS NULL OR subject_org <> NEW.org_id THEN
    RAISE EXCEPTION 'acl_binding subject % / % does not belong to org % (invariant I-1)',
      NEW.subject_kind, NEW.subject_id, NEW.org_id;
  END IF;

  IF NEW.object_kind = 'project' THEN
    SELECT org_id INTO object_org FROM projects WHERE id = NEW.object_id;
    IF object_org IS NULL OR object_org <> NEW.org_id THEN
      RAISE EXCEPTION 'acl_binding object project % does not belong to org % (invariant I-1)',
        NEW.object_id, NEW.org_id;
    END IF;
  END IF;
  -- artifact / segment: validated once F04 creates those tables.

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS acl_binding_same_org_trg ON acl_bindings;
CREATE TRIGGER acl_binding_same_org_trg
  BEFORE INSERT OR UPDATE ON acl_bindings
  FOR EACH ROW EXECUTE FUNCTION acl_binding_same_org();

-- RLS on every table. `organizations` keys off its own id; everything else off org_id.
-- current_setting(..., true) is NULL when unset, so an un-scoped query sees nothing
-- (fail-closed) rather than everything.
DO $$
DECLARE
  t text;
  col text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','teams','projects','groups','org_memberships','project_memberships','acl_bindings']
  LOOP
    col := CASE WHEN t = 'organizations' THEN 'id' ELSE 'org_id' END;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (%I = current_setting(''app.current_org'', true)) '
      'WITH CHECK (%I = current_setting(''app.current_org'', true))',
      t || '_tenant', t, col, col);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
  END LOOP;
END
$$;

GRANT USAGE, SELECT ON SEQUENCE acl_bindings_id_seq TO app_rw;
