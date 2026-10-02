-- Historical runs retain their immutable snapshots (NULL). New acceptance records server-selected scope.
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS skill_scope text;
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_skill_scope_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_skill_scope_check
  CHECK (skill_scope IS NULL OR skill_scope IN ('agent_pins', 'general'));

-- Selection provenance must survive deferred acceptance. Unknown historical queue entries stay strict.
ALTER TABLE thread_message_queue ADD COLUMN IF NOT EXISTS explicit_agent boolean;
