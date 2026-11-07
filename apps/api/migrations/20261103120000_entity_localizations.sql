-- Display translations only. No source text, executable version or seed content is rewritten.
ALTER TABLE skills ADD COLUMN IF NOT EXISTS source_locale text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS source_locale text;
ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_source_locale_valid;
ALTER TABLE skills ADD CONSTRAINT skills_source_locale_valid CHECK(source_locale IS NULL OR source_locale IN ('zh-CN','en'));
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_source_locale_valid;
ALTER TABLE agents ADD CONSTRAINT agents_source_locale_valid CHECK(source_locale IS NULL OR source_locale IN ('zh-CN','en'));

CREATE TABLE IF NOT EXISTS skill_localizations (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  skill_id text NOT NULL,
  locale text NOT NULL CHECK(locale IN ('zh-CN','en')),
  source_revision text NOT NULL CHECK(length(source_revision) BETWEEN 1 AND 255),
  translation_revision integer NOT NULL CHECK(translation_revision > 0),
  status text NOT NULL CHECK(status IN ('draft','reviewed')),
  name text, summary text, duty text, role_label text, avatar_alt text,
  provenance text NOT NULL DEFAULT 'manual' CHECK(provenance IN ('manual','import')),
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,skill_id,locale,source_revision),
  FOREIGN KEY(skill_id,org_id) REFERENCES skills(id,org_id) ON DELETE CASCADE,
  CHECK ((name IS NULL OR length(btrim(name)) BETWEEN 1 AND 4000)
    AND (summary IS NULL OR length(btrim(summary)) BETWEEN 1 AND 4000)
    AND (duty IS NULL OR length(btrim(duty)) BETWEEN 1 AND 4000)
    AND (role_label IS NULL OR length(btrim(role_label)) BETWEEN 1 AND 4000)
    AND (avatar_alt IS NULL OR length(btrim(avatar_alt)) BETWEEN 1 AND 4000))
);
ALTER TABLE skill_localizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_localizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS skill_localizations_tenant ON skill_localizations;
CREATE POLICY skill_localizations_tenant ON skill_localizations
  USING(org_id=current_setting('app.current_org',true))
  WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON skill_localizations FROM app_rw;
-- Clear is a revisioned tombstone, not DELETE: avoids the CAS ABA problem.
GRANT SELECT,INSERT,UPDATE ON skill_localizations TO app_rw;

CREATE TABLE IF NOT EXISTS agent_localizations (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  locale text NOT NULL CHECK(locale IN ('zh-CN','en')),
  source_revision text NOT NULL CHECK(length(source_revision) BETWEEN 1 AND 255),
  translation_revision integer NOT NULL CHECK(translation_revision > 0),
  status text NOT NULL CHECK(status IN ('draft','reviewed')),
  name text, summary text, duty text, role_label text, avatar_alt text,
  provenance text NOT NULL DEFAULT 'manual' CHECK(provenance IN ('manual','import')),
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,agent_id,locale,source_revision),
  FOREIGN KEY(agent_id,org_id) REFERENCES agents(id,org_id) ON DELETE CASCADE,
  CHECK ((name IS NULL OR length(btrim(name)) BETWEEN 1 AND 4000)
    AND (summary IS NULL OR length(btrim(summary)) BETWEEN 1 AND 4000)
    AND (duty IS NULL OR length(btrim(duty)) BETWEEN 1 AND 4000)
    AND (role_label IS NULL OR length(btrim(role_label)) BETWEEN 1 AND 4000)
    AND (avatar_alt IS NULL OR length(btrim(avatar_alt)) BETWEEN 1 AND 4000))
);
ALTER TABLE agent_localizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_localizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_localizations_tenant ON agent_localizations;
CREATE POLICY agent_localizations_tenant ON agent_localizations
  USING(org_id=current_setting('app.current_org',true))
  WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON agent_localizations FROM app_rw;
-- Clear is a revisioned tombstone, not DELETE: avoids the CAS ABA problem.
GRANT SELECT,INSERT,UPDATE ON agent_localizations TO app_rw;

-- Match the existing platform Skill read policy. Draft translations remain private.
DROP POLICY IF EXISTS skill_localizations_platform_read ON skill_localizations;
CREATE POLICY skill_localizations_platform_read ON skill_localizations FOR SELECT
  USING(org_id='org-platform' AND status='reviewed');
-- Canonical source snapshot for both display and translated search. SECURITY INVOKER
-- preserves the underlying tables' RLS, including platform Skill read-only sharing.
CREATE OR REPLACE VIEW entity_localization_sources WITH (security_invoker = true) AS
SELECT s.*, encode(sha256(convert_to(jsonb_build_array(
  'entity-display-v1',org_id,kind,id,
  to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  version_id,source_locale,name,summary,duty,role_label,avatar_alt
)::text,'UTF8')),'hex') AS source_revision
FROM (
  SELECT 'skill'::text AS kind,sk.id,sk.org_id,sk.name,sk.source_locale,sk.updated_at,
         v.id AS version_id,
         CASE WHEN jsonb_typeof(v.manifest->'description')='string' THEN v.manifest->>'description' ELSE NULL END AS summary,
         cl.duty,NULL::text AS role_label,NULL::text AS avatar_alt,COALESCE(cl.scope,'org-wide') AS visibility_scope,cl.owner_team_id
    FROM skills sk
    LEFT JOIN LATERAL (SELECT id,manifest FROM skill_versions WHERE org_id=sk.org_id AND skill_id=sk.id AND published ORDER BY created_at DESC,id DESC LIMIT 1) v ON true
    LEFT JOIN capability_listings cl ON cl.id=sk.id AND cl.org_id=sk.org_id AND cl.kind='skill'
  UNION ALL
  SELECT 'agent'::text,a.id,a.org_id,a.name,a.source_locale,a.updated_at,v.id,
         NULL::text,cl.duty,a.role_label,
         CASE WHEN jsonb_typeof(visible_avatar.value->'alt')='string' THEN visible_avatar.value->>'alt' ELSE NULL END,
         COALESCE(cl.scope,a.visibility,'org-wide'),cl.owner_team_id
    FROM agents a
    LEFT JOIN agent_versions v ON v.id=a.published_version_id AND v.org_id=a.org_id AND v.agent_id=a.id
    -- A published NULL avatar is intentional; never disclose a newer draft fallback.
    LEFT JOIN LATERAL (SELECT CASE WHEN a.published_version_id IS NULL THEN a.avatar ELSE v.avatar END AS value) visible_avatar ON true
    LEFT JOIN capability_listings cl ON cl.id=a.id AND cl.org_id=a.org_id AND cl.kind='agent'
) s;
GRANT SELECT ON entity_localization_sources TO app_rw;
SELECT kernel_apply_org_freeze_policies();
