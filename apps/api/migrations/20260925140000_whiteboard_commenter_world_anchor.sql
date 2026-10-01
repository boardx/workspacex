-- Forward-only upgrade: the trusted-collaboration migration may already be applied.
-- World-position threads have no object anchor, and commenting is distinct from editing.
ALTER TABLE whiteboard_comment_threads ALTER COLUMN object_id DROP NOT NULL;

ALTER TABLE whiteboard_members DROP CONSTRAINT IF EXISTS whiteboard_members_role_check;
ALTER TABLE whiteboard_members ADD CONSTRAINT whiteboard_members_role_check
  CHECK(role IN ('editor','commenter','viewer'));
