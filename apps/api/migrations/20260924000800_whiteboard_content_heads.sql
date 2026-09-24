-- ADR-114 foundation: PostgreSQL publishes metadata pointers; legacy content bytes remain readable during migration.
CREATE TABLE IF NOT EXISTS whiteboard_content_heads (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  epoch integer NOT NULL DEFAULT 1 CHECK (epoch > 0),
  head_seq bigint NOT NULL DEFAULT 0 CHECK (head_seq BETWEEN 0 AND 9007199254740991),
  checkpoint_seq bigint NOT NULL DEFAULT 0 CHECK (checkpoint_seq BETWEEN 0 AND head_seq),
  storage_kind text NOT NULL DEFAULT 'legacy_pg' CHECK (storage_kind IN ('legacy_pg','dual_write','blob_primary')),
  manifest_key text,
  manifest_digest text,
  manifest_size_bytes bigint,
  tenant_key_version integer,
  schema_version integer,
  protocol_version integer,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  content_state text NOT NULL DEFAULT 'legacy' CHECK (content_state IN ('legacy','building','verifying','active','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, board_id),
  FOREIGN KEY (org_id, board_id) REFERENCES whiteboard_documents(org_id, board_id) ON DELETE CASCADE,
  CHECK (
    (storage_kind = 'legacy_pg' AND manifest_key IS NULL AND manifest_digest IS NULL AND manifest_size_bytes IS NULL AND tenant_key_version IS NULL AND schema_version IS NULL AND protocol_version IS NULL)
    OR
    (storage_kind IN ('dual_write','blob_primary') AND manifest_key IS NOT NULL AND length(manifest_key) BETWEEN 1 AND 512 AND manifest_digest ~ '^[a-f0-9]{64}$' AND manifest_size_bytes > 0 AND tenant_key_version > 0 AND schema_version > 0 AND protocol_version > 0)
  )
);

INSERT INTO whiteboard_content_heads(org_id,board_id,epoch,head_seq,checkpoint_seq)
SELECT org_id,board_id,epoch,seq,seq FROM whiteboard_documents
ON CONFLICT(org_id,board_id) DO NOTHING;

ALTER TABLE whiteboard_content_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_content_heads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_content_heads_tenant ON whiteboard_content_heads;
CREATE POLICY whiteboard_content_heads_tenant ON whiteboard_content_heads
  USING (org_id=current_setting('app.current_org',true))
  WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_content_heads FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON whiteboard_content_heads TO app_rw;
