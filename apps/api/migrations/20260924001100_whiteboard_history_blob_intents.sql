-- Durable lifecycle journal for history blobs. It intentionally has no FK to
-- organizations/boards: their cascade is exactly when an orphan record must
-- survive so a later collector can remove the unreachable object.
CREATE TABLE IF NOT EXISTS whiteboard_history_blob_intents (
  org_id text NOT NULL,
  intent_id uuid NOT NULL,
  actor_id text NOT NULL,
  operation_kind text NOT NULL CHECK (operation_kind IN ('checkpoint','restore')),
  request_id uuid NOT NULL,
  blob_role text NOT NULL CHECK (blob_role IN ('history_checkpoint','restore_checkpoint','restore_manifest')),
  board_id uuid NOT NULL,
  reference_board_id uuid,
  reference_checkpoint_id uuid,
  blob_key text,
  blob_version integer,
  cipher_sha256 text CHECK (cipher_sha256 IS NULL OR cipher_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 text CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes BETWEEN 1 AND 33555456),
  state text NOT NULL DEFAULT 'staging' CHECK (state IN ('staging','referenced','deleted')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id,intent_id),
  UNIQUE (org_id,actor_id,operation_kind,request_id,blob_role),
  CHECK ((blob_key IS NULL) = (cipher_sha256 IS NULL)),
  CHECK ((blob_key IS NULL) = (content_sha256 IS NULL)),
  CHECK ((blob_key IS NULL) = (size_bytes IS NULL)),
  CHECK ((blob_key IS NULL) = (blob_version IS NULL))
);
CREATE INDEX IF NOT EXISTS whiteboard_history_blob_intents_gc
  ON whiteboard_history_blob_intents(org_id,state,updated_at,intent_id);
ALTER TABLE whiteboard_history_blob_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_history_blob_intents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_history_blob_intents_tenant ON whiteboard_history_blob_intents;
CREATE POLICY whiteboard_history_blob_intents_tenant ON whiteboard_history_blob_intents
  USING (org_id=current_setting('app.current_org',true))
  WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_history_blob_intents FROM app_rw;
GRANT SELECT,INSERT,UPDATE,DELETE ON whiteboard_history_blob_intents TO app_rw;
SELECT kernel_apply_org_freeze_policies();
