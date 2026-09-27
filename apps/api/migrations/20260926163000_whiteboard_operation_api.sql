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
CREATE TABLE IF NOT EXISTS whiteboard_actor_identities (
  org_id text NOT NULL, actor_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('service','ai')),
  delegated_by text NOT NULL, scopes text[] NOT NULL, model_snapshot text, skill_snapshot text,
  enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,actor_id)
);
CREATE TABLE IF NOT EXISTS whiteboard_ai_proposals (
  org_id text NOT NULL, board_id uuid NOT NULL, proposal_id uuid NOT NULL, owner_user_id text NOT NULL,
  actor_id text NOT NULL, request_hash text NOT NULL, status text NOT NULL CHECK(status IN ('preview','cancelled','confirmed','stale')),
  payload jsonb NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,board_id,proposal_id), FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whiteboard_room_identities (
  org_id text NOT NULL, board_id uuid NOT NULL, room_id text NOT NULL, actor_id text NOT NULL,
  owner_user_id text NOT NULL, device_id text NOT NULL, device_kind text NOT NULL CHECK(device_kind IN ('personal','meeting-display')),
  reconnect_hash text NOT NULL, connection_revision bigint NOT NULL CHECK(connection_revision>0), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,board_id,room_id,actor_id), UNIQUE(org_id,board_id,room_id,device_id),
  FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whiteboard_presentation_sessions (
  org_id text NOT NULL, board_id uuid NOT NULL, room_id text NOT NULL, revision bigint NOT NULL,
  state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(org_id,board_id,room_id),
  FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whiteboard_artifact_layout_bindings (
  org_id text NOT NULL, artifact_id text NOT NULL, artifact_version_id text NOT NULL,
  layout_digest text NOT NULL CHECK(layout_digest ~ '^layout-v1:[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,artifact_id,artifact_version_id), FOREIGN KEY(artifact_version_id) REFERENCES artifact_versions(id) ON DELETE CASCADE
);
ALTER TABLE whiteboard_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_operation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_operation_events FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_actor_identities ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_actor_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_ai_proposals ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_ai_proposals FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_room_identities ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_room_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_presentation_sessions ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_presentation_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_artifact_layout_bindings ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_artifact_layout_bindings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_operations_tenant ON whiteboard_operations;
CREATE POLICY whiteboard_operations_tenant ON whiteboard_operations USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_operation_events_tenant ON whiteboard_operation_events;
CREATE POLICY whiteboard_operation_events_tenant ON whiteboard_operation_events USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['whiteboard_actor_identities','whiteboard_ai_proposals','whiteboard_room_identities','whiteboard_presentation_sessions','whiteboard_artifact_layout_bindings'] LOOP EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I',t,t); EXECUTE format('CREATE POLICY %I_tenant ON %I USING (org_id=current_setting(''app.current_org'',true)) WITH CHECK (org_id=current_setting(''app.current_org'',true))',t,t); END LOOP; END $$;
REVOKE ALL ON whiteboard_operations,whiteboard_operation_events,whiteboard_actor_identities,whiteboard_ai_proposals,whiteboard_room_identities,whiteboard_presentation_sessions,whiteboard_artifact_layout_bindings FROM app_rw;
GRANT SELECT,INSERT ON whiteboard_operations,whiteboard_operation_events TO app_rw;
GRANT SELECT,INSERT,UPDATE ON whiteboard_ai_proposals,whiteboard_room_identities,whiteboard_presentation_sessions TO app_rw;
GRANT SELECT,INSERT ON whiteboard_artifact_layout_bindings TO app_rw;
GRANT SELECT ON whiteboard_actor_identities TO app_rw;
SELECT kernel_apply_org_freeze_policies();
