-- Homepage archive preserves N7 citation/report evidence and in-flight executions.
ALTER TABLE guided_research_sessions ADD COLUMN archived_at timestamptz;
CREATE INDEX guided_research_sessions_visible_home
  ON guided_research_sessions (org_id, updated_at DESC, id DESC)
  WHERE archived_at IS NULL;

-- Sessions use column-scoped write grants; grant only the new archive marker.
GRANT UPDATE (archived_at) ON guided_research_sessions TO app_rw;
