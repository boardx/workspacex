-- Wave 2 #412: durable Skills plus explicit, administrator-selected starter-pack import.
--
-- Deliberately contains no INSERTs. A fresh production-shaped organization therefore owns
-- zero Skills after migration, startup, enrollment, and first login. Content only enters via
-- POST /admin/skills/starter-pack-imports after digest verification.

CREATE TABLE IF NOT EXISTS skills (
  id          text NOT NULL,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  stable_name text NOT NULL,
  name        text NOT NULL,
  status      text NOT NULL CHECK (status IN ('enabled', 'disabled')),
  creator_id  text NOT NULL,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT skills_id_org_uniq UNIQUE (id, org_id),
  CONSTRAINT skills_stable_name_uniq UNIQUE (org_id, stable_name)
);
CREATE UNIQUE INDEX IF NOT EXISTS skills_name_casefold_uniq ON skills (org_id, lower(name));

CREATE TABLE IF NOT EXISTS skill_versions (
  id             text NOT NULL,
  org_id         text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  skill_id       text NOT NULL,
  semantic_label text NOT NULL,
  content_digest text NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  manifest       jsonb NOT NULL,
  creator_id     text NOT NULL,
  created_at     timestamptz NOT NULL,
  published      boolean NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT skill_versions_id_org_uniq UNIQUE (id, org_id),
  CONSTRAINT skill_versions_id_org_skill_uniq UNIQUE (id, org_id, skill_id),
  CONSTRAINT skill_versions_skill_fk FOREIGN KEY (skill_id, org_id)
    REFERENCES skills (id, org_id) ON DELETE CASCADE,
  CONSTRAINT skill_versions_semantic_uniq UNIQUE (org_id, skill_id, semantic_label)
);

CREATE TABLE IF NOT EXISTS skill_version_files (
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  version_id text NOT NULL,
  path       text NOT NULL,
  content    bytea NOT NULL,
  media_type text NOT NULL,
  digest     text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (version_id, path),
  CONSTRAINT skill_version_files_version_fk FOREIGN KEY (version_id, org_id)
    REFERENCES skill_versions (id, org_id) ON DELETE CASCADE,
  CONSTRAINT skill_version_files_normal_path CHECK (
    path ~ '^[^/\\]+(/[^/\\]+)*$'
    AND path !~ '(^|/)\.{1,2}(/|$)'
  )
);

CREATE TABLE IF NOT EXISTS skill_mounts (
  id               text PRIMARY KEY,
  org_id           text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  target_kind      text NOT NULL CHECK (target_kind IN ('repository', 'project')),
  target_id        text NOT NULL,
  skill_id         text NOT NULL,
  skill_version_id text NOT NULL,
  mount_path       text NOT NULL CHECK (
    mount_path ~ '^/skills/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
    AND mount_path !~ '(^|/)\.{1,2}(/|$)'
  ),
  enabled          boolean NOT NULL,
  mounted_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_mounts_skill_fk FOREIGN KEY (skill_id, org_id)
    REFERENCES skills (id, org_id),
  CONSTRAINT skill_mounts_version_fk FOREIGN KEY (skill_version_id, org_id, skill_id)
    REFERENCES skill_versions (id, org_id, skill_id),
  CONSTRAINT skill_mounts_target_path_uniq UNIQUE (org_id, target_kind, target_id, mount_path)
);

CREATE TABLE IF NOT EXISTS starter_pack_imports (
  id               text PRIMARY KEY,
  org_id           text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pack_id          text NOT NULL,
  pack_version     text NOT NULL,
  pack_digest      text,
  payload_digest   text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  idempotency_key  text NOT NULL,
  administrator_id text NOT NULL,
  imported_at      timestamptz NOT NULL,
  status           text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  result_json      jsonb,
  failure_code     text,
  CONSTRAINT starter_pack_imports_idempotency_uniq UNIQUE (org_id, idempotency_key),
  CONSTRAINT starter_pack_imports_status_shape CHECK (
    (status = 'pending' AND result_json IS NULL AND failure_code IS NULL) OR
    (status = 'succeeded' AND result_json IS NOT NULL AND failure_code IS NULL) OR
    (status = 'failed' AND result_json IS NULL AND failure_code IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION wave2_skill_immutable() RETURNS trigger AS $$
BEGIN
  -- A parent organization deletion is lifecycle cleanup cascading through foreign keys,
  -- not a caller rewriting an immutable snapshot. During that cascade the parent row is
  -- no longer visible; direct DELETE while the tenant still exists remains rejected.
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM organizations WHERE id = OLD.org_id
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'published Skill versions and files are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS skill_versions_immutable_trg ON skill_versions;
CREATE TRIGGER skill_versions_immutable_trg
  BEFORE UPDATE OR DELETE ON skill_versions
  FOR EACH ROW WHEN (OLD.published)
  EXECUTE FUNCTION wave2_skill_immutable();

CREATE OR REPLACE FUNCTION wave2_skill_version_starts_draft() RETURNS trigger AS $$
BEGIN
  IF NEW.published THEN
    RAISE EXCEPTION 'Skill versions must be assembled as drafts before publish';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS skill_versions_starts_draft_trg ON skill_versions;
CREATE TRIGGER skill_versions_starts_draft_trg
  BEFORE INSERT ON skill_versions
  FOR EACH ROW EXECUTE FUNCTION wave2_skill_version_starts_draft();

DROP TRIGGER IF EXISTS skill_version_files_immutable_trg ON skill_version_files;
CREATE TRIGGER skill_version_files_immutable_trg
  BEFORE UPDATE OR DELETE ON skill_version_files
  FOR EACH ROW EXECUTE FUNCTION wave2_skill_immutable();

CREATE OR REPLACE FUNCTION wave2_skill_file_insert_before_publish() RETURNS trigger AS $$
DECLARE parent_published boolean;
BEGIN
  -- This trigger is SECURITY DEFINER solely so it can take the same row lock as
  -- the one-purpose publish function. Reject a forged tenant before the definer
  -- query can observe any version outside the caller's RLS scope.
  IF NEW.org_id IS DISTINCT FROM current_setting('app.current_org', true) THEN
    RAISE EXCEPTION 'Skill file tenant does not match current tenant';
  END IF;
  SELECT published INTO parent_published
    FROM skill_versions
   WHERE id = NEW.version_id AND org_id = NEW.org_id
   FOR UPDATE;
  IF parent_published IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'published Skill versions and files are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS skill_version_files_insert_before_publish_trg ON skill_version_files;
CREATE TRIGGER skill_version_files_insert_before_publish_trg
  BEFORE INSERT ON skill_version_files
  FOR EACH ROW EXECUTE FUNCTION wave2_skill_file_insert_before_publish();

-- The app role cannot UPDATE versions directly. This one-purpose transition lets the
-- import transaction publish only its current tenant's draft after every file is stored.
CREATE OR REPLACE FUNCTION wave2_publish_skill_version(p_org text, p_version text) RETURNS void AS $$
DECLARE
  current_published boolean;
  file_count bigint;
  root_count bigint;
BEGIN
  IF p_org IS DISTINCT FROM current_setting('app.current_org', true)
     OR NOT kernel_org_is_writable(p_org) THEN
    RAISE EXCEPTION 'Skill version publish is outside the writable tenant';
  END IF;
  SELECT published INTO current_published
    FROM skill_versions
   WHERE id = p_version AND org_id = p_org
   FOR UPDATE;
  IF current_published IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Skill version is not a publishable draft';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE path = 'SKILL.md')
    INTO file_count, root_count
    FROM skill_version_files
   WHERE version_id = p_version AND org_id = p_org;
  IF file_count = 0 OR root_count <> 1 THEN
    RAISE EXCEPTION 'Skill version requires exactly one root SKILL.md before publish';
  END IF;
  UPDATE skill_versions SET published = true WHERE id = p_version AND org_id = p_org;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION wave2_publish_skill_version(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wave2_publish_skill_version(text, text) TO app_rw;

CREATE OR REPLACE FUNCTION wave2_skill_mount_target_same_org() RETURNS trigger AS $$
DECLARE target_org text;
BEGIN
  IF NEW.target_kind = 'repository' THEN
    target_org := NEW.target_id;
  ELSE
    SELECT org_id INTO target_org FROM projects WHERE id = NEW.target_id;
  END IF;
  IF target_org IS NULL OR target_org <> NEW.org_id THEN
    RAISE EXCEPTION 'Skill mount target does not belong to organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS skill_mount_target_same_org_trg ON skill_mounts;
CREATE TRIGGER skill_mount_target_same_org_trg
  BEFORE INSERT OR UPDATE ON skill_mounts
  FOR EACH ROW EXECUTE FUNCTION wave2_skill_mount_target_same_org();

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills FORCE ROW LEVEL SECURITY;
ALTER TABLE skill_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE skill_version_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_version_files FORCE ROW LEVEL SECURITY;
ALTER TABLE skill_mounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_mounts FORCE ROW LEVEL SECURITY;
ALTER TABLE starter_pack_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE starter_pack_imports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skills_tenant ON skills;
CREATE POLICY skills_tenant ON skills USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
DROP POLICY IF EXISTS skill_versions_tenant ON skill_versions;
CREATE POLICY skill_versions_tenant ON skill_versions USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
DROP POLICY IF EXISTS skill_version_files_tenant ON skill_version_files;
CREATE POLICY skill_version_files_tenant ON skill_version_files USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
DROP POLICY IF EXISTS skill_mounts_tenant ON skill_mounts;
CREATE POLICY skill_mounts_tenant ON skill_mounts USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
DROP POLICY IF EXISTS starter_pack_imports_tenant ON starter_pack_imports;
CREATE POLICY starter_pack_imports_tenant ON starter_pack_imports USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON skills, skill_versions, skill_version_files, skill_mounts, starter_pack_imports FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON skills TO app_rw;
GRANT SELECT, INSERT ON skill_versions, skill_version_files TO app_rw;
GRANT SELECT, INSERT, UPDATE ON skill_mounts TO app_rw;
GRANT SELECT, INSERT, UPDATE ON starter_pack_imports TO app_rw;

-- F22's catalog-driven organization freeze only sees tables that exist when it runs.
-- Reapply the single-source helper after adding these tenant tables so a disabled
-- organization remains readable but cannot import, mount, or mutate Skill persistence.
SELECT kernel_apply_org_freeze_policies();
