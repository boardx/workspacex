-- Ownership is captured on new uploads; legacy unknown actors remain unknown.
ALTER TABLE chat_message_attachments
  ADD COLUMN IF NOT EXISTS uploaded_by text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE chat_message_attachments DROP CONSTRAINT IF EXISTS chat_attachment_cancel_pending;
ALTER TABLE chat_message_attachments ADD CONSTRAINT chat_attachment_cancel_pending
  CHECK(cancelled_at IS NULL OR message_id IS NULL);
GRANT DELETE ON chat_message_attachments TO app_rw;
-- Tenant RLS still applies; even the application role cannot delete sent attachments.
DROP POLICY IF EXISTS chat_attachment_delete_pending ON chat_message_attachments;
CREATE POLICY chat_attachment_delete_pending ON chat_message_attachments
  AS RESTRICTIVE FOR DELETE TO app_rw USING(message_id IS NULL);
