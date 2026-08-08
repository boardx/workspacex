-- #725: the tool-calling loop -- a run whose pinned Skills produced at least one tool
-- definition may now record `tool_call` steps between `context_built` and the terminal
-- `model_called` step, and may fail terminally with `TOOL_LOOP_LIMIT_EXCEEDED` when the
-- bounded loop (`execute-run.ts`'s `MAX_TOOL_LOOP_ROUNDS`) never reaches a final answer.

-- Widen the step-kind vocabulary. Same fact as the contract's `AgentRunStepKind` zod enum
-- (kept in sync by `no-tool-run-writeback.test.ts`'s `pg_constraint` read-back assertion --
-- see that migration's own header for why this coupling exists at all).
ALTER TABLE agent_run_steps DROP CONSTRAINT IF EXISTS agent_run_steps_kind_check;
ALTER TABLE agent_run_steps ADD CONSTRAINT agent_run_steps_kind_check
  CHECK (kind IN ('accepted', 'context_built', 'model_called', 'tool_call', 'chat_writeback'));

-- Widen both redacted-error-code vocabularies with the new terminal code. Same fact as the
-- contract's `AgentRunError` zod enum, same test-enforced coupling.
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_error_code_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_error_code_check CHECK (
  error_code IS NULL OR error_code IN (
    'MODEL_PROVIDER_NOT_CONFIGURED', 'SKILL_VERSION_UNAVAILABLE',
    'AGENT_VERSION_UNAVAILABLE', 'MODEL_CALL_FAILED', 'CHAT_WRITEBACK_FAILED',
    'TOOL_LOOP_LIMIT_EXCEEDED'
  )
);

ALTER TABLE agent_run_steps DROP CONSTRAINT IF EXISTS agent_run_steps_failure_code_check;
ALTER TABLE agent_run_steps ADD CONSTRAINT agent_run_steps_failure_code_check CHECK (
  failure_code IS NULL OR failure_code IN (
    'MODEL_PROVIDER_NOT_CONFIGURED', 'SKILL_VERSION_UNAVAILABLE',
    'AGENT_VERSION_UNAVAILABLE', 'MODEL_CALL_FAILED', 'CHAT_WRITEBACK_FAILED',
    'TOOL_LOOP_LIMIT_EXCEEDED'
  )
);

-- Visibility for `tool_call` steps (chat-ux-acceptance-criteria.md item 3: a human watching
-- a run must be able to see WHICH tool was called, WITH WHAT, and WHAT CAME BACK). NOT
-- digests -- `input_digest`/`output_digest` already cover "prove what happened without
-- retaining it" for every step kind; these three are the deliberately-NOT-hashed, truncated
-- summary this feature needs, and stay NULL for every step kind other than `tool_call`.
ALTER TABLE agent_run_steps
  ADD COLUMN IF NOT EXISTS tool_name           text NULL,
  ADD COLUMN IF NOT EXISTS tool_args_summary   text NULL,
  ADD COLUMN IF NOT EXISTS tool_result_summary text NULL;

-- The `seq` the run's terminal `model_called` step was actually recorded under. Before
-- #725 this was always `3` (hence the pre-#725 literal `4 + retry_count` chat-writeback
-- formula this column replaces); a tool-calling run's `model_called` step lands AFTER
-- however many `tool_call` steps its loop recorded, so the writeback step needs to read
-- the real number back rather than assume it. `DEFAULT 3` makes every pre-#725 row (and
-- every future no-tool run) compute the exact same writeback `seq` as before.
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS model_called_seq integer NOT NULL DEFAULT 3;
