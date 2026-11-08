-- Nullable additive guidance; old writers may leave stale JSON during retry.
-- Public projection gates by terminal status and typed code; no status-coupled constraint.
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS credit_failure jsonb;
