-- Stable approval identity changes on every real interrupt, not every read/reconnect.
ALTER TABLE agent_runs ADD COLUMN pending_permission_request_id uuid;
UPDATE agent_runs SET pending_permission_request_id=gen_random_uuid()
WHERE status='awaiting_tool_permission';
