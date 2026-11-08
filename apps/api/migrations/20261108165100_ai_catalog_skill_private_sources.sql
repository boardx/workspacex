-- Newly authored platform catalog Skills are discoverable via guarded offers, not runtime.
-- Legacy built-in platform Skills preserve their previous read compatibility.
DROP POLICY IF EXISTS skills_platform_read ON skills;
CREATE POLICY skills_platform_read ON skills FOR SELECT USING (
 org_id='org-platform' AND NOT EXISTS (SELECT 1 FROM ai_catalog_managed m WHERE m.kind='skill' AND m.entity_id=skills.id)
);
DROP POLICY IF EXISTS skill_versions_platform_read ON skill_versions;
CREATE POLICY skill_versions_platform_read ON skill_versions FOR SELECT USING (
 org_id='org-platform' AND NOT EXISTS (SELECT 1 FROM ai_catalog_managed m WHERE m.kind='skill' AND m.entity_id=skill_versions.skill_id)
);
DROP POLICY IF EXISTS skill_version_files_platform_read ON skill_version_files;
CREATE POLICY skill_version_files_platform_read ON skill_version_files FOR SELECT USING (
 org_id='org-platform' AND EXISTS (
 SELECT 1 FROM skill_versions v WHERE v.id=skill_version_files.version_id AND v.org_id=skill_version_files.org_id
 AND NOT EXISTS (SELECT 1 FROM ai_catalog_managed m WHERE m.kind='skill' AND m.entity_id=v.skill_id))
);
