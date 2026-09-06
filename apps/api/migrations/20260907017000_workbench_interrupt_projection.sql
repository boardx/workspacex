-- Existing workbench databases may have applied the identity migration before form projection landed.
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS pending_interrupt jsonb;
