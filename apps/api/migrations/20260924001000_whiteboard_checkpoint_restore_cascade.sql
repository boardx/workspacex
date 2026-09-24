-- Restore receipts reference both the source and restored checkpoint. Without
-- cascading these provenance edges, deleting an organization reaches the
-- checkpoint rows first and is blocked by the receipt instead of completing
-- the existing organization -> board -> document -> checkpoint cascade.
DO $$
DECLARE dependency record;
BEGIN
  FOR dependency IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'whiteboard_checkpoint_restores'::regclass
      AND confrelid = 'whiteboard_checkpoints'::regclass
      AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE whiteboard_checkpoint_restores DROP CONSTRAINT %I', dependency.conname);
  END LOOP;
END $$;

ALTER TABLE whiteboard_checkpoint_restores
  ADD CONSTRAINT whiteboard_checkpoint_restores_source_checkpoint_fkey
    FOREIGN KEY (org_id, source_board_id, source_checkpoint_id)
    REFERENCES whiteboard_checkpoints(org_id, board_id, checkpoint_id)
    ON DELETE CASCADE,
  ADD CONSTRAINT whiteboard_checkpoint_restores_restored_checkpoint_fkey
    FOREIGN KEY (org_id, restored_board_id, restored_checkpoint_id)
    REFERENCES whiteboard_checkpoints(org_id, board_id, checkpoint_id)
    ON DELETE CASCADE;
