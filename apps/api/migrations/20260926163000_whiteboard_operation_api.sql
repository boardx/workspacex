CREATE TABLE IF NOT EXISTS whiteboard_operations (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  operation_id uuid NOT NULL,
  actor_id text NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('human','service','ai')),
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,board_id,request_id),
  UNIQUE (org_id,board_id,operation_id),
  FOREIGN KEY (org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whiteboard_operation_events (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  event_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  revision_epoch integer NOT NULL CHECK (revision_epoch>0),
  revision_seq bigint NOT NULL CHECK (revision_seq>=0),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,board_id,event_id),
  FOREIGN KEY (org_id,board_id,operation_id) REFERENCES whiteboard_operations(org_id,board_id,operation_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS whiteboard_operation_events_cursor ON whiteboard_operation_events(org_id,board_id,revision_seq,event_id);
ALTER TABLE whiteboard_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_operation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_operation_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_operations_tenant ON whiteboard_operations;
CREATE POLICY whiteboard_operations_tenant ON whiteboard_operations USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_operation_events_tenant ON whiteboard_operation_events;
CREATE POLICY whiteboard_operation_events_tenant ON whiteboard_operation_events USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_operations,whiteboard_operation_events FROM app_rw;
GRANT SELECT,INSERT ON whiteboard_operations,whiteboard_operation_events TO app_rw;
SELECT kernel_apply_org_freeze_policies();
