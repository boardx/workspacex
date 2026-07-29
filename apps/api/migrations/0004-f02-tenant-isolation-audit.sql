-- 0004 F02: the tenant-isolation audit, DERIVED FROM THE CATALOG (UC-0.3 R12 V9 / I-4 I-5 I-6)
--
-- ## Why this is a database function and not a list in a shell script
--
-- verify-rls.sh already asserted "every RLS-enabled table is FORCEd". Read that sentence
-- again: it is conditional on RLS already being enabled. A brand new table with an
-- `org_id` column and NO row-level security at all satisfies it -- it is not RLS-enabled,
-- so it never enters the count. The gate was green and the table was wide open.
--
-- The fix cannot be "add the table to a list", because the failure mode is precisely that
-- somebody adds a table and does not think about the list. So the set of tenant-carrying
-- tables is COMPUTED from pg_catalog, and every new table is in scope the moment it is
-- created, whether or not anyone remembered this file exists.
--
-- ## How a table is classified, without naming any table
--
--   * carries a column named `org_id`                        -> tenant key is `org_id`
--   * is the table those `org_id` columns REFERENCE          -> tenant key is its own PK
--     (that is how `organizations` is found: it is derived from the foreign keys pointing
--      at it, never hardcoded. Rename it tomorrow and this still works.)
--   * neither                                                -> not tenant-carrying
--
-- The third case is not automatically fine. A table with no tenant key that the RUNTIME
-- role can read is a cross-tenant hole BY CONSTRUCTION -- there is nothing to filter on --
-- so it is reported as `UNTENANTED_BUT_GRANTED`.
--
-- ## The one exemption, and why it is a table COMMENT
--
-- The first run of this audit flagged `_kernel_migrations`: app_rw genuinely holds SELECT
-- on it (0001 grants it so the health probe can report the schema version), and it
-- genuinely holds no tenant data. That is a legitimate exemption -- but "legitimate" is a
-- judgement, and judgements do not belong in an inferred rule.
--
-- So the exemption is DECLARED, on the table, in the database:
--
--   COMMENT ON TABLE x IS 'kernel-no-tenant-data: <why>'
--
-- Not an allowlist in this file, and not one in the gate script. An allowlist is edited by
-- the person adding the table, at the moment they are trying to make the gate go green --
-- which is the worst possible moment to be making a security judgement quietly. A comment
-- on the table is a written claim that travels with the table, shows up in `\d+`, and
-- survives this file being rewritten.
--
-- ## Why this is not a DDL event trigger
--
-- The tempting version is an event trigger that refuses to create an ungoverned table.
-- It does not work: a migration legitimately runs CREATE TABLE, then ALTER TABLE ... ENABLE
-- ROW LEVEL SECURITY a few statements later, so the trigger would reject correct
-- migrations. Enforcement therefore happens at gate time (verify-rls.sh +
-- rls-force-nonowner.test.ts), where the whole schema is settled.
--
-- Replayable: DROP + CREATE, so `migrate:check`'s forced replay is a no-op difference.
-- (Plain CREATE OR REPLACE would fail on any future change to the return type.)

DROP FUNCTION IF EXISTS kernel_tenant_table_audit(text);

CREATE FUNCTION kernel_tenant_table_audit(runtime_role text DEFAULT 'app_rw')
RETURNS TABLE (
  table_name      text,
  tenant_column   text,
  rls_enabled     boolean,
  rls_forced      boolean,
  tenant_policies integer,
  runtime_grants  integer,
  verdict         text
)
LANGUAGE sql
STABLE
AS $$
  WITH t AS (
    SELECT c.oid, c.relname::text AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
  ),
  -- The tenant ROOT: whatever table single-column `org_id` foreign keys point at.
  -- Derived, so the root table's name never appears in this file.
  roots AS (
    SELECT DISTINCT con.confrelid AS oid
      FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.contype = 'f'
       AND a.attname = 'org_id'
       AND array_length(con.conkey, 1) = 1
  ),
  keyed AS (
    SELECT t.*,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM pg_attribute a
           WHERE a.attrelid = t.oid AND a.attname = 'org_id' AND a.attnum > 0 AND NOT a.attisdropped
        ) THEN 'org_id'
        WHEN t.oid IN (SELECT oid FROM roots) THEN (
          SELECT a.attname::text
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
           WHERE i.indrelid = t.oid AND i.indisprimary
        )
        ELSE NULL
      END AS tcol
      FROM t
  ),
  measured AS (
    SELECT k.name, k.tcol, k.enabled, k.forced,
      (
        -- A policy only counts if it keys off BOTH the tenant column and the session
        -- setting. A policy named `..._tenant` that filters on something else is the exact
        -- shape of a gate that reads as present and enforces nothing.
        SELECT count(*)::int FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = k.name
           AND p.qual IS NOT NULL
           AND p.qual LIKE '%app.current_org%'
           AND k.tcol IS NOT NULL
           AND p.qual LIKE '%' || k.tcol || '%'
      ) AS policies,
      (
        SELECT count(*)::int FROM information_schema.role_table_grants g
         WHERE g.table_schema = 'public' AND g.table_name = k.name AND g.grantee = runtime_role
      ) AS grants,
      -- The declared exemption. `col_description` is deliberately not consulted: this is a
      -- claim about the WHOLE table.
      coalesce(obj_description(k.oid, 'pg_class'), '') LIKE 'kernel-no-tenant-data:%' AS declared_clean
      FROM keyed k
  )
  SELECT m.name, m.tcol, m.enabled, m.forced, m.policies, m.grants,
    CASE
      WHEN m.tcol IS NULL AND m.grants > 0 AND m.declared_clean THEN 'exempt-declared-no-tenant-data'
      WHEN m.tcol IS NULL AND m.grants > 0 THEN 'UNTENANTED_BUT_GRANTED'
      WHEN m.tcol IS NULL                  THEN 'exempt-no-tenant-data'
      WHEN NOT m.enabled                   THEN 'RLS_DISABLED'
      WHEN NOT m.forced                    THEN 'RLS_NOT_FORCED'
      WHEN m.policies = 0                  THEN 'NO_TENANT_POLICY'
      ELSE 'ok'
    END AS verdict
    FROM measured m
   ORDER BY 1;
$$;

COMMENT ON FUNCTION kernel_tenant_table_audit(text) IS
  'F02: catalog-derived tenant isolation audit. Callers assert that no row has a verdict '
  'other than ok / exempt-*, AND that at least one row is ok (an audit that classifies '
  'nothing passes vacuously).';

-- The one declared exemption in the kernel. app_rw holds SELECT here (granted by 0001) so
-- the health probe can report which migration is applied; the table holds file names and
-- checksums and has no tenant dimension to leak across.
COMMENT ON TABLE _kernel_migrations IS
  'kernel-no-tenant-data: migration file names and checksums only. app_rw has SELECT so the '
  'health probe can report the applied schema version. No row here belongs to a tenant.';

-- The runtime role may run it too, so the assertion can be made from the perspective of
-- the connection that is actually constrained -- not only from the owner's.
GRANT EXECUTE ON FUNCTION kernel_tenant_table_audit(text) TO app_rw;
