-- Wave 2 / #519: retrying a run whose Chat writeback budget was exhausted (delta §6).
--
-- Section number VERIFIED against
-- `phases/phase-01-run-a-project/design-deltas/wave2-runtime/contract.md`: §4 is #417's Agent
-- persistence, §5 is #414's minimal no-tool AgentRun, §6 is #413's idempotent writeback.
--
-- ## What this migration REFUSED to do, and why that is the point of the issue
--
-- §6's prose offers the human "a new run associated with the same input message". That is
-- structurally impossible here: `agent_runs` carries `UNIQUE (org_id, input_message_id)` from
-- #415 (20260804060000_wave2_chat_message_acceptance.sql:36), which IS the "one human message
-- is executed at most once" guarantee. Relaxing it to make one sentence of prose literally
-- true would trade the invariant for the wording. coord-main ruled on #519 that the constraint
-- wins; this migration adds NOTHING to `agent_runs`' uniqueness and drops nothing from it.
--
-- 🟡 CONSEQUENCE, LOGGED FOR HUMAN SIGN-OFF: §6's wording ("a new run") no longer describes
-- the implementation and must be amended when the contract face below is signed. Left
-- undescribed, the next implementer reads the prose and re-litigates the same conflict.
--
-- ## The reopening is a NARROW carve-out in the state machine, not a relaxation of it
--
-- #414's `wave2_agent_run_transition` says terminal is terminal. That stays true for
-- `succeeded` -- unconditionally, forever, because a succeeded run has an assistant message
-- in the thread and reopening it is how a second reply gets written. The single new edge is
--
--     failed / CHAT_WRITEBACK_FAILED  ->  writeback_pending
--
-- and every precondition that makes it safe is checked HERE rather than trusted to the one
-- caller: the failure must be the writeback one (a model failure has no stored answer to
-- write back), the stored output must be unchanged (a retry may not become a different
-- answer), the budget must be reset, and the retry generation must advance by exactly one.
-- A caller that "reopens" by writing a fresh output is refused by the database.

ALTER TABLE agent_runs
  -- Which writeback generation the run is on. Zero for every run that never needed a retry.
  --
  -- It is NOT a second copy of `writeback_attempts`: that one counts attempts INSIDE the
  -- current bounded budget and resets, this one counts how many times the budget was refilled
  -- and only ever grows. It exists because the append-only step log needs a deterministic
  -- `seq` per generation -- see the repository's `4 + retry_count`. Deriving the seq from
  -- MAX(seq)+1 instead would let ten concurrent attempts in one generation write ten steps,
  -- which is precisely the shape #19 shipped.
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION wave2_agent_run_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  -- #519's single new edge, gated on every precondition rather than on the caller's care.
  IF OLD.status = 'failed' AND NEW.status = 'writeback_pending' THEN
    IF OLD.error_code = 'CHAT_WRITEBACK_FAILED'
       AND NEW.error_code IS NULL
       AND NEW.model_output IS NOT NULL
       AND NEW.model_output = OLD.model_output
       AND NEW.writeback_attempts = 0
       AND NEW.retry_count = OLD.retry_count + 1 THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'AgentRun % may only reopen from an exhausted Chat writeback, with the stored output '
      'unchanged, the budget reset and the retry generation advanced', OLD.id;
  END IF;

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

SELECT kernel_apply_org_freeze_policies();
