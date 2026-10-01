-- Recovery resets sequence numbers but increments epoch. Subscription pagination
-- must follow both values, otherwise newly recovered-board events disappear.
CREATE INDEX IF NOT EXISTS whiteboard_operation_events_epoch_cursor
ON whiteboard_operation_events(org_id,board_id,revision_epoch,revision_seq,event_id);
