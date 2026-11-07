-- Display release receipts are independent of immutable execution-package upgrades.
-- An org-wide receipt cannot hide another team's still-untranslated entities.
CREATE TABLE IF NOT EXISTS entity_display_metadata_receipts (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('skill','agent')),
  entity_id text NOT NULL,
  source_revision text NOT NULL,
  metadata_version text NOT NULL,
  metadata_digest text NOT NULL CHECK(metadata_digest ~ '^[a-f0-9]{64}$'),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,kind,entity_id,source_revision,metadata_version)
);
CREATE TABLE IF NOT EXISTS entity_display_update_requests (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL,
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,idempotency_key)
);
ALTER TABLE entity_display_metadata_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_display_metadata_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE entity_display_update_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_display_update_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entity_display_metadata_receipts_tenant ON entity_display_metadata_receipts;
CREATE POLICY entity_display_metadata_receipts_tenant ON entity_display_metadata_receipts
  USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS entity_display_update_requests_tenant ON entity_display_update_requests;
CREATE POLICY entity_display_update_requests_tenant ON entity_display_update_requests
  USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON entity_display_metadata_receipts,entity_display_update_requests FROM app_rw;
GRANT SELECT,INSERT ON entity_display_metadata_receipts,entity_display_update_requests TO app_rw;
SELECT kernel_apply_org_freeze_policies();
