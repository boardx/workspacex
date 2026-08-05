-- #372: the invite-free first-admin path is a permanently consumed installation gate.
--
-- This marker deliberately has no foreign key to credentials or organizations. Deleting,
-- anonymising or otherwise cleaning up the first account must never recreate a public path
-- that can mint another seed administrator.
CREATE TABLE IF NOT EXISTS auth_bootstrap_state (
  singleton   boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  consumed_at timestamptz NOT NULL DEFAULT now()
);

-- Existing installations were initialized before this marker existed and must remain
-- closed. Empty installations retain zero rows and may perform the one bootstrap.
INSERT INTO auth_bootstrap_state (singleton, consumed_at)
SELECT true, now()
WHERE EXISTS (SELECT 1 FROM credentials)
ON CONFLICT (singleton) DO NOTHING;

COMMENT ON TABLE auth_bootstrap_state IS
  'kernel-no-tenant-data: global one-shot marker with only a boolean singleton and '
  'consumption timestamp. It contains no organization data; presence permanently disables '
  'invite-free seed-admin bootstrap across credential and organization cleanup.';

GRANT SELECT, INSERT ON auth_bootstrap_state TO app_rw;
REVOKE UPDATE, DELETE ON auth_bootstrap_state FROM app_rw;
