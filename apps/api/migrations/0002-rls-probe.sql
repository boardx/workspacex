-- 0002 RLS probe
--
-- `rls_probe` is a KERNEL ASSET, not scaffolding (UC-0.6 R7). Its only job is to prove
-- that RLS is actually enforcing. It must persist: the day someone changes a policy or the
-- connection role, verify-rls.sh goes red. Deleting this table deletes the only evidence
-- that isolation holds.
--
-- The unique constraint exists so the seed below is idempotent. Without it a forced replay
-- would keep appending rows, and the schema digest (which includes this table's row count)
-- would differ -- which is exactly the failure the idempotency check is meant to catch.

CREATE TABLE IF NOT EXISTS rls_probe (
  id      bigserial PRIMARY KEY,
  org_id  text NOT NULL,
  payload text NOT NULL,
  CONSTRAINT rls_probe_org_payload_uniq UNIQUE (org_id, payload)
);

ALTER TABLE rls_probe ENABLE ROW LEVEL SECURITY;
-- FORCE so that even the table owner is subject to the policy. Without FORCE, a migration
-- or maintenance connection reads everything and the isolation claim is only half true.
ALTER TABLE rls_probe FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_probe_tenant ON rls_probe;
-- current_setting(..., true) yields NULL when unset, so `org_id = NULL` is NULL, which is
-- not true, which yields zero rows. That is deliberate FAIL-CLOSED behaviour: a query with
-- no tenant context must see nothing rather than everything.
CREATE POLICY rls_probe_tenant ON rls_probe
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON rls_probe TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE rls_probe_id_seq TO app_rw;

INSERT INTO rls_probe (org_id, payload) VALUES
  ('org-a', 'a-row-1'),
  ('org-a', 'a-row-2'),
  ('org-b', 'b-row-1')
ON CONFLICT (org_id, payload) DO NOTHING;
