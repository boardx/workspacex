-- Wave 2 / #414: execution state for the minimal no-tool AgentRun (delta §5).
--
-- #415 already created `agent_runs` and writes the ACCEPTANCE snapshot into it. This
-- migration adds only what EXECUTING that snapshot needs, and one append-only step log.
--
-- Deliberately absent:
--   * a `result_message_id` column. The durable link from a run to its assistant message
--     already exists as `chat_messages.agent_run_id` with a unique index (#415). A second
--     column holding the same fact is exactly the drift this repository has been bitten by
--     five times; `GET /agent-runs/:runId` projects `resultMessageId` from that join.
--   * anything for tools, approvals, or a recovery graph. Out of scope per §5.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS started_at   timestamptz NULL,
  ADD COLUMN IF NOT EXISTS ended_at     timestamptz NULL,
  -- The model output the executor stores before entering `writeback_pending` (§6's first
  -- sentence). #414 produces it; #413 is the only thing that will read it.
  ADD COLUMN IF NOT EXISTS model_output text NULL,
  -- Stable and redacted by construction: a CHECKed enumeration cannot carry a provider
  -- message, a URL or a stack, which is what PR #310 shipped by putting String(err) here.
  ADD COLUMN IF NOT EXISTS error_code   text NULL;

ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_error_code_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_error_code_check CHECK (
  error_code IS NULL OR error_code IN (
    'MODEL_PROVIDER_NOT_CONFIGURED', 'SKILL_VERSION_UNAVAILABLE',
    'AGENT_VERSION_UNAVAILABLE', 'MODEL_CALL_FAILED'
  )
);

-- `failed` is the only status that may carry a code, and it must carry one. A terminal
-- failure with a NULL reason is indistinguishable from a run nobody looked at.
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_failure_shape_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_failure_shape_check CHECK (
  (status = 'failed' AND error_code IS NOT NULL) OR (status <> 'failed' AND error_code IS NULL)
);

/*
 * The status machine from §5, enforced rather than described.
 *
 * `queued -> running -> writeback_pending -> succeeded`, with `failed` reachable from any
 * non-terminal state. Written as a trigger because the illegal move this exists to stop is
 * a WRITE ("mark it succeeded, the model call worked"), and a CHECK constraint cannot see
 * the previous row. Terminal states are terminal: nothing leaves `succeeded` or `failed`.
 */
CREATE OR REPLACE FUNCTION wave2_agent_run_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF OLD.status IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'AgentRun % is terminal in %, cannot become %', OLD.id, OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'failed'
     OR (OLD.status = 'queued' AND NEW.status = 'running')
     OR (OLD.status = 'running' AND NEW.status = 'writeback_pending')
     OR (OLD.status = 'writeback_pending' AND NEW.status = 'succeeded') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AgentRun % may not move from % to %', OLD.id, OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_runs_transition_trg ON agent_runs;
CREATE TRIGGER agent_runs_transition_trg BEFORE UPDATE ON agent_runs
  FOR EACH ROW EXECUTE FUNCTION wave2_agent_run_transition();

/*
 * The append-only step log (§5: "Run steps are append-only").
 *
 * Two halves, each sufficient on its own TODAY, which is exactly why both are here and
 * why a test asserts both exist rather than only asserting the refusal:
 *   * the runtime role is granted SELECT and INSERT and nothing else, and
 *   * a trigger refuses UPDATE/DELETE outright.
 * Removing either one leaves the behavioural test green -- measured, not assumed: the
 * suite was re-run with `GRANT UPDATE, DELETE` added and all assertions still passed,
 * because the trigger caught it. So the behavioural assertion cannot be the whole gate.
 * The grant matters because a referential action skips the privilege check on the child
 * table and a trigger can be dropped; the trigger matters because a future GRANT nobody
 * re-reviewed would silently open the table. `no-tool-run-writeback.test.ts` asserts the
 * refusal AND reads both mechanisms back out of the catalog.
 */
CREATE TABLE IF NOT EXISTS agent_run_steps (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  run_id        text NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
  seq           integer NOT NULL,
  kind          text NOT NULL,
  status        text NOT NULL,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz NOT NULL,
  input_digest  text NULL CHECK (input_digest IS NULL OR input_digest ~ '^[a-f0-9]{64}$'),
  output_digest text NULL CHECK (output_digest IS NULL OR output_digest ~ '^[a-f0-9]{64}$'),
  failure_code  text NULL,
  CONSTRAINT agent_run_steps_seq_uniq UNIQUE (org_id, run_id, seq),
  -- One fact, two languages: `wave2Runtime.AgentRunStepKind` is the other half, and a test
  -- reads this constraint back out of pg_constraint and asserts the two sets are equal.
  CONSTRAINT agent_run_steps_kind_check
    CHECK (kind IN ('accepted', 'context_built', 'model_called', 'chat_writeback')),
  CONSTRAINT agent_run_steps_status_check CHECK (status IN ('succeeded', 'failed')),
  CONSTRAINT agent_run_steps_failure_code_check CHECK (
    failure_code IS NULL OR failure_code IN (
      'MODEL_PROVIDER_NOT_CONFIGURED', 'SKILL_VERSION_UNAVAILABLE',
      'AGENT_VERSION_UNAVAILABLE', 'MODEL_CALL_FAILED'
    )
  ),
  CONSTRAINT agent_run_steps_failure_shape_check CHECK (
    (status = 'failed' AND failure_code IS NOT NULL)
    OR (status = 'succeeded' AND failure_code IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS agent_run_steps_run_idx ON agent_run_steps (org_id, run_id, seq);

CREATE OR REPLACE FUNCTION wave2_agent_run_step_append_only() RETURNS trigger AS $$
BEGIN
  -- A parent organization deletion is lifecycle cleanup cascading through foreign keys,
  -- not a caller rewriting the log. Same carve-out, same reason, as wave2_skill_immutable.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AgentRun steps are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_run_steps_append_only_trg ON agent_run_steps;
CREATE TRIGGER agent_run_steps_append_only_trg BEFORE UPDATE OR DELETE ON agent_run_steps
  FOR EACH ROW EXECUTE FUNCTION wave2_agent_run_step_append_only();

ALTER TABLE agent_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_steps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_run_steps_tenant ON agent_run_steps;
CREATE POLICY agent_run_steps_tenant ON agent_run_steps
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON agent_run_steps FROM app_rw;
GRANT SELECT, INSERT ON agent_run_steps TO app_rw;

SELECT kernel_apply_org_freeze_policies();
