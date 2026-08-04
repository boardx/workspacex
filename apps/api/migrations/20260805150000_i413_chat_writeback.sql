-- Wave 2 / #413: the idempotent Chat writeback (delta §6).
--
-- Section number VERIFIED against
-- `phases/phase-01-run-a-project/design-deltas/wave2-runtime/contract.md`: §4 is #417's
-- Agent persistence, §5 is #414's minimal no-tool AgentRun, §6 is this. (Issue #413's body
-- says "§5"; that is off by one and points at #414's section.)
--
-- Deliberately absent, because each already exists and a second copy is the drift this
-- repository has been bitten by five times:
--   * a uniqueness mechanism for the writeback. `chat_messages_agent_run_idx` --
--     `UNIQUE (org_id, agent_run_id) WHERE author_kind='agent' AND agent_run_id IS NOT NULL`
--     -- already exists from #415 (20260804060000_wave2_chat_message_acceptance.sql:16-18)
--     and is exactly the constraint §6 names. This migration adds none.
--   * a `result_message_id` column on `agent_runs`. #414 left that out on purpose and
--     projects `resultMessageId` through a LEFT JOIN on the index above.
--
-- NOTE on the human idempotency key: `chat_messages_human_idempotency_idx` (line 12 of the
-- same #415 migration) is PARTIAL on `author_kind = 'human'`, so it structurally cannot
-- dedupe an assistant row. The agentRunId index is the single source of truth here.

/*
 * 1. The error vocabulary gains the one code §6 defines.
 *
 * Both CHECKs are widened together. `AgentRunError` in packages/contracts is the same fact
 * in another language, and a test reads these constraints back out of `pg_constraint` and
 * asserts set equality with the enum's `.options`, so adding to one place and not the
 * other goes red rather than drifting.
 */
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_error_code_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_error_code_check CHECK (
  error_code IS NULL OR error_code IN (
    'MODEL_PROVIDER_NOT_CONFIGURED', 'SKILL_VERSION_UNAVAILABLE',
    'AGENT_VERSION_UNAVAILABLE', 'MODEL_CALL_FAILED', 'CHAT_WRITEBACK_FAILED'
  )
);

ALTER TABLE agent_run_steps DROP CONSTRAINT IF EXISTS agent_run_steps_failure_code_check;
ALTER TABLE agent_run_steps ADD CONSTRAINT agent_run_steps_failure_code_check CHECK (
  failure_code IS NULL OR failure_code IN (
    'MODEL_PROVIDER_NOT_CONFIGURED', 'SKILL_VERSION_UNAVAILABLE',
    'AGENT_VERSION_UNAVAILABLE', 'MODEL_CALL_FAILED', 'CHAT_WRITEBACK_FAILED'
  )
);

/*
 * 2. The bounded retry budget (§6: "the run stays non-terminal for bounded retry").
 *
 * A counter rather than a timestamp, because the bound §6 describes is on ATTEMPTS: the
 * failure being retried is "the insert did not commit", which a clock cannot count. It is
 * incremented in its own transaction precisely because the failing attempt's transaction
 * rolls back -- an increment inside it would vanish along with the failure it recorded,
 * and the run would retry forever.
 */
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS writeback_attempts integer NOT NULL DEFAULT 0;

/*
 * 3. "Only after that transaction commits may the run become `succeeded`" -- enforced.
 *
 * A trigger for the same reason #414 made the status machine one: the illegal move is a
 * WRITE ("the model answered, mark it done"), a CHECK constraint cannot see another table,
 * and the damage is the worst kind this feature can do -- a run reporting a successful
 * answer that no human can read, with the UI told to stop polling.
 *
 * This does NOT duplicate `agent_runs_transition_trg`. That one decides whether the
 * transition is legal in the state machine; this one decides whether the fact the
 * transition asserts is actually durable. Both are BEFORE UPDATE and neither mutates NEW,
 * so their firing order (alphabetical by trigger name) does not matter.
 *
 * SECURITY INVOKER on purpose: the lookup runs under the caller's tenant context, and
 * `chat_messages` has RLS FORCEd, so a writeback that somehow ran without tenant scope sees
 * zero rows and is REFUSED. Fail closed is the correct direction for this check.
 */
CREATE OR REPLACE FUNCTION wave2_agent_run_succeeds_only_after_writeback() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'succeeded' AND OLD.status <> 'succeeded' THEN
    IF NOT EXISTS (
      SELECT 1 FROM chat_messages
       WHERE org_id = NEW.org_id AND agent_run_id = NEW.id AND author_kind = 'agent'
    ) THEN
      RAISE EXCEPTION
        'AgentRun % cannot become succeeded before its assistant message is durable', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_runs_writeback_before_success_trg ON agent_runs;
CREATE TRIGGER agent_runs_writeback_before_success_trg BEFORE UPDATE ON agent_runs
  FOR EACH ROW EXECUTE FUNCTION wave2_agent_run_succeeds_only_after_writeback();

SELECT kernel_apply_org_freeze_policies();
