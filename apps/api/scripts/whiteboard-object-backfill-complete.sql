-- Run with the migration/admin role only after read-through traffic or an explicit
-- board-load backfill has visited every tenant. A non-zero exit prevents dropping
-- the legacy bytea columns while any body still lacks an immutable manifest.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM whiteboard_documents WHERE snapshot IS NOT NULL OR object_key IS NULL)
    OR EXISTS (SELECT 1 FROM whiteboard_updates WHERE update IS NOT NULL OR update_object_key IS NULL)
  THEN
    RAISE EXCEPTION 'WHITEBOARD_OBJECT_BACKFILL_INCOMPLETE';
  END IF;
END
$$;
