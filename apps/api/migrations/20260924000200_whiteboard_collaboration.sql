-- Snapshot and append-only accepted update log are committed together under a whiteboards row lock.
CREATE TABLE IF NOT EXISTS whiteboard_documents (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  epoch integer NOT NULL DEFAULT 1 CHECK (epoch > 0),
  seq bigint NOT NULL DEFAULT 0 CHECK (seq BETWEEN 0 AND 9007199254740991),
  -- 0000 is Yjs's empty v1 state update; initialized lazily for existing boards.
  snapshot bytea NOT NULL DEFAULT decode('0000','hex') CHECK (octet_length(snapshot) <= 33554432),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, board_id),
  FOREIGN KEY (org_id, board_id) REFERENCES whiteboards(org_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whiteboard_updates (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  epoch integer NOT NULL CHECK (epoch > 0),
  seq bigint NOT NULL CHECK (seq BETWEEN 1 AND 9007199254740991),
  actor_id text NOT NULL,
  update_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (length(request_hash)=64),
  update bytea NOT NULL CHECK (octet_length(update) <= 1048576),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, board_id, epoch, seq),
  UNIQUE (org_id, board_id, epoch, actor_id, update_id),
  FOREIGN KEY (org_id, board_id) REFERENCES whiteboard_documents(org_id, board_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS whiteboard_updates_rate ON whiteboard_updates(org_id,board_id,actor_id,created_at DESC);
ALTER TABLE whiteboard_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_updates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_documents_tenant ON whiteboard_documents;
CREATE POLICY whiteboard_documents_tenant ON whiteboard_documents USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_updates_tenant ON whiteboard_updates;
CREATE POLICY whiteboard_updates_tenant ON whiteboard_updates USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_documents, whiteboard_updates FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON whiteboard_documents TO app_rw;
GRANT SELECT, INSERT ON whiteboard_updates TO app_rw;
SELECT kernel_apply_org_freeze_policies();
