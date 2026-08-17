-- F195 / #1432 -- tenant-owned Guided Research workflow projection and replay receipts.

CREATE TABLE IF NOT EXISTS guided_research_revisions (
  id          text PRIMARY KEY,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  session_id  text NOT NULL,
  revision    integer NOT NULL CHECK (revision > 0),
  based_on_revision integer NULL CHECK (based_on_revision IS NULL OR based_on_revision > 0),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, session_id, revision),
  FOREIGN KEY (session_id, org_id)
    REFERENCES guided_research_sessions (id, org_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS guided_research_workflow_projections (
  session_id         text PRIMARY KEY,
  org_id             text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  graph_version      integer NOT NULL CHECK (graph_version >= 0),
  revision           integer NOT NULL CHECK (revision > 0),
  current_node       text NOT NULL CHECK (current_node IN ('brief', 'directions', 'outline', 'research', 'report')),
  available_nodes    text[] NOT NULL,
  node_summaries     jsonb NOT NULL CHECK (jsonb_typeof(node_summaries) = 'object'),
  active_node_state  jsonb NOT NULL CHECK (jsonb_typeof(active_node_state) = 'object'),
  node_state_versions jsonb NOT NULL CHECK (jsonb_typeof(node_state_versions) = 'object'),
  skill              jsonb NOT NULL CHECK (jsonb_typeof(skill) = 'object'),
  interrupt_state    jsonb NULL CHECK (interrupt_state IS NULL OR jsonb_typeof(interrupt_state) = 'object'),
  checkpoint_id      text NOT NULL,
  projection_version integer NOT NULL DEFAULT 1 CHECK (projection_version > 0),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, org_id),
  FOREIGN KEY (session_id, org_id)
    REFERENCES guided_research_sessions (id, org_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, session_id, revision)
    REFERENCES guided_research_revisions (org_id, session_id, revision)
);

CREATE TABLE IF NOT EXISTS guided_research_node_receipts (
  id                 text PRIMARY KEY,
  org_id             text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  session_id         text NOT NULL,
  request_id         text NOT NULL,
  node               text NOT NULL CHECK (node IN ('brief', 'directions', 'outline', 'research', 'report')),
  action             text NOT NULL CHECK (action IN ('save', 'generate', 'confirm', 'start', 'retry', 'reconfirm', 'complete')),
  payload_fingerprint text NOT NULL,
  status             text NOT NULL CHECK (status IN ('pending', 'finalized')),
  checkpoint_id      text NULL,
  graph_version      integer NULL CHECK (graph_version IS NULL OR graph_version >= 0),
  projection_version integer NULL CHECK (projection_version IS NULL OR projection_version > 0),
  stable_response    jsonb NULL CHECK (stable_response IS NULL OR jsonb_typeof(stable_response) = 'object'),
  created_at         timestamptz NOT NULL DEFAULT now(),
  finalized_at       timestamptz NULL,
  UNIQUE (org_id, session_id, request_id),
  FOREIGN KEY (session_id, org_id)
    REFERENCES guided_research_sessions (id, org_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS guided_research_effect_receipts (
  operation_id text PRIMARY KEY,
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  session_id   text NOT NULL,
  node         text NOT NULL CHECK (node IN ('brief', 'directions', 'outline', 'research', 'report')),
  effect_kind  text NOT NULL,
  stable_result jsonb NOT NULL CHECK (jsonb_typeof(stable_result) = 'object'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, org_id),
  FOREIGN KEY (session_id, org_id)
    REFERENCES guided_research_sessions (id, org_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS guided_research_timeline_events (
  id          text PRIMARY KEY,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  session_id  text NOT NULL,
  cursor      bigint GENERATED ALWAYS AS IDENTITY,
  node        text NOT NULL CHECK (node IN ('brief', 'directions', 'outline', 'research', 'report')),
  event_type  text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, session_id, cursor),
  FOREIGN KEY (session_id, org_id)
    REFERENCES guided_research_sessions (id, org_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS guided_research_revisions_session_idx
  ON guided_research_revisions (org_id, session_id, revision DESC);
CREATE INDEX IF NOT EXISTS guided_research_timeline_events_cursor_idx
  ON guided_research_timeline_events (org_id, session_id, cursor);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'guided_research_revisions',
    'guided_research_workflow_projections',
    'guided_research_node_receipts',
    'guided_research_effect_receipts',
    'guided_research_timeline_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      table_name || '_tenant', table_name
    );
    EXECUTE format('REVOKE ALL ON %I FROM app_rw', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_rw', table_name);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON SEQUENCE guided_research_timeline_events_cursor_seq TO app_rw;

SELECT kernel_apply_org_freeze_policies();
