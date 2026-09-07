-- Keep notification delivery/read receipts on the original immutable failure fact.
-- No copied notification payload or parallel notification repository.
ALTER TABLE standard_schedules ADD COLUMN IF NOT EXISTS notification_accepted_at timestamptz NULL;
ALTER TABLE standard_schedules ADD COLUMN IF NOT EXISTS notification_read_at timestamptz NULL;
ALTER TABLE standard_schedules DROP CONSTRAINT IF EXISTS standard_schedule_notification_receipt;
ALTER TABLE standard_schedules ADD CONSTRAINT standard_schedule_notification_receipt CHECK (
 (notification_accepted_at IS NULL AND notification_read_at IS NULL)
 OR (notification_accepted_at IS NOT NULL AND status='failed' AND failure_code IS NOT NULL AND last_occurrence_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS standard_schedules_unread_notification
 ON standard_schedules(org_id,user_id,id)
 WHERE notification_accepted_at IS NOT NULL AND notification_read_at IS NULL;
-- Existing FORCE RLS / org-freeze policy / grants remain unchanged.
