-- Named Board versions keep metadata in PostgreSQL and immutable encrypted bytes in
-- the configured BoardBlobStore. No snapshot/update bytes belong in these tables.
CREATE TABLE IF NOT EXISTS whiteboard_checkpoints (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  checkpoint_id uuid NOT NULL,
  actor_id text NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 100),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  epoch integer NOT NULL CHECK (epoch > 0),
  seq bigint NOT NULL CHECK (seq BETWEEN 0 AND 9007199254740991),
  head_manifest_digest text NOT NULL CHECK (head_manifest_digest ~ '^[a-f0-9]{64}$'),
  blob_key text NOT NULL CHECK (length(blob_key) BETWEEN 1 AND 512),
  blob_version integer NOT NULL CHECK (blob_version > 0),
  cipher_sha256 text NOT NULL CHECK (cipher_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  -- Ciphertext includes a bounded envelope above the 32 MiB plaintext document limit.
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 0 AND 33555456),
  object_count integer NOT NULL CHECK (object_count BETWEEN 0 AND 5000),
  retention_until timestamptz NOT NULL,
  retention_state text NOT NULL DEFAULT 'active' CHECK (retention_state IN ('active','pinned')),
  source_board_id uuid,
  source_checkpoint_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, board_id, checkpoint_id),
  UNIQUE (org_id, board_id, actor_id, request_id),
  FOREIGN KEY (org_id, board_id) REFERENCES whiteboard_documents(org_id, board_id) ON DELETE CASCADE,
  CHECK ((source_board_id IS NULL) = (source_checkpoint_id IS NULL))
);
CREATE INDEX IF NOT EXISTS whiteboard_checkpoints_recent ON whiteboard_checkpoints(org_id,board_id,created_at DESC,checkpoint_id DESC);

CREATE TABLE IF NOT EXISTS whiteboard_checkpoint_restores (
  org_id text NOT NULL,
  source_board_id uuid NOT NULL,
  restore_id uuid NOT NULL,
  source_checkpoint_id uuid NOT NULL,
  restored_board_id uuid NOT NULL,
  restored_checkpoint_id uuid NOT NULL,
  actor_id text NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, source_board_id, restore_id),
  UNIQUE (org_id, source_board_id, actor_id, request_id),
  UNIQUE (org_id, restored_board_id),
  FOREIGN KEY (org_id, source_board_id, source_checkpoint_id) REFERENCES whiteboard_checkpoints(org_id, board_id, checkpoint_id),
  FOREIGN KEY (org_id, restored_board_id, restored_checkpoint_id) REFERENCES whiteboard_checkpoints(org_id, board_id, checkpoint_id)
);

ALTER TABLE whiteboard_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_checkpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_checkpoint_restores ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_checkpoint_restores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_checkpoints_tenant ON whiteboard_checkpoints;
CREATE POLICY whiteboard_checkpoints_tenant ON whiteboard_checkpoints USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_checkpoint_restores_tenant ON whiteboard_checkpoint_restores;
CREATE POLICY whiteboard_checkpoint_restores_tenant ON whiteboard_checkpoint_restores USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_checkpoints, whiteboard_checkpoint_restores FROM app_rw;
GRANT SELECT, INSERT ON whiteboard_checkpoints, whiteboard_checkpoint_restores TO app_rw;
SELECT kernel_apply_org_freeze_policies();
