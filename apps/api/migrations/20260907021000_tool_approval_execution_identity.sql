-- Bind the existing pending approval to its actual tool call. Only a digest of
-- sensitive arguments is retained; no second grant or execution state machine.
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS pending_tool_call_id text,
  ADD COLUMN IF NOT EXISTS pending_tool_args_digest text,
  ADD COLUMN IF NOT EXISTS pending_tool_authorized_attempt text;
