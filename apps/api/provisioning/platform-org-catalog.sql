-- NOT an automatic migration. Production execution requires specific security approval.
-- No LOGIN, passwords, superuser, BYPASSRLS or app_rw membership is created here.
-- Provision a separate LOGIN through the existing credential-management process and grant
-- it membership in this group. Never grant this group to app_rw/diagnostics/owner runtime.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_platform_org_catalog_ro') THEN
   CREATE ROLE app_platform_org_catalog_ro NOLOGIN NOSUPERUSER NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_platform_org_catalog_ro;
GRANT SELECT(id,name,kind) ON organizations TO app_platform_org_catalog_ro;
DROP POLICY IF EXISTS platform_org_catalog_metadata ON organizations;
CREATE POLICY platform_org_catalog_metadata ON organizations TO app_platform_org_catalog_ro
 USING(kind='organization');
-- No member/account/plan/usage table grants and no SECURITY DEFINER functions.
