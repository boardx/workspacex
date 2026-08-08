-- #731 follow-up: chat-ux-acceptance-criteria.md item 2 ("可见的规划步骤"). A `tool_call`
-- step (#725, `20260808130000_i725_tool_calling_loop.sql`) may now also carry the
-- orchestrator model's own plain-language explanation from the SAME response that
-- requested the tool call, when the provider returned one. NULL when the model called
-- the tool without saying anything first -- this column is never backfilled with a
-- synthesized value.
ALTER TABLE agent_run_steps
  ADD COLUMN IF NOT EXISTS planning_note text NULL;
