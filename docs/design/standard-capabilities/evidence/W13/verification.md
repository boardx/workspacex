# W13 verification and remaining integration dependency

Executed with the standard isolated DB wrapper:

- `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/standard-scheduler-provider.test.ts`: 3/3 passed. Actual pg-boss persisted one-shot across stop/restart; two workers produced one claim; cron and one-shot inserts rolled back on the bound transaction. DST fixture uses the exact upstream parser version. Output `provider-real-db.txt`.
- `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/standard-scheduler-service.test.ts`: final 4/4 passed, 22.63 seconds. Output `service-final-real-db.txt`. This final run includes Python ToolNode sync create / async list / async cancel over real HTTP; real PG run authority; another valid requester's private list; actual acceptHumanMessage and persisted message/run; same backend PID and outer rollback; cancellation/dispatch row-lock race; duplicate acknowledgment replay; revoked membership; peer acknowledgment lost once and retried with the same fact ID. The peer reminder implementation is an explicit double, not a product inbox.

Both wrappers exited 0 and cleaned their owned stacks. No W13 containers remain owned/running.

Static/local verification:

- `pnpm --filter @repo/api typecheck`: exit 0; output `typecheck.txt`.

- `pnpm --filter @repo/contracts exec vitest run tests/standard-schedule.test.ts`: 4/4 passed, generated Python contract equality and model root-object schema included.
- `apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_standard_schedule.py -q`: 1/1 passed; no model-visible identity/connection fields.
- `node --test apps/api/scripts/tests/standard-schedule-boundary.test.mjs`: 13/13 passed, including real authority/owner binding removal, row-lock and transaction-dispatch counterexamples. No allowlist increase.
- `node apps/api/scripts/lint-permission-paths.mjs`: passed; output `permission-lint.txt` (scan counts reflect the working tree when captured).

Remaining production dependency: the parent agent owns composition root/native factory registration and enablement. The peer-owned persistent in-app notifier has no callable implementation in the inspected worktree. No email or second notification table was added. Creating a schedule without that adapter fails explicitly; this evidence does not claim an end user received an in-app reminder or that all-terminal production scheduling is complete.

Production wiring verification: API typecheck exit 0 including
scheduler/image DI. The first three-file wrapper passed 12/13 assertions:
existing four real scheduler behaviors, five native invocation policy assertions,
and three Nest lifecycle/configuration assertions. The new production-factory
case timed out at 60 seconds during a heavily loaded run (transform 41 seconds,
collect 38 seconds); failure output is retained in
`composition-initial-load-timeout.txt`. Its dynamic KernelModule import was moved
to collection without increasing the execution timeout. The final real-DB rerun below resolves this outstanding verification.

Final targeted real-DB rerun: **2/2 passed**, wrapper exit 0 and automatic cleanup.
`composition-final-real-db.txt` records production Kernel factory/Nest/actual
pg-boss startup and shutdown, missing notifier creation refusal, and the explicit
parent-cancel lock race. The race observed `pg_blocking_pids`, committed parent
cancellation before the waiting authority check, and found neither metadata nor
an SDK job created. A subsequent allowed operation recorded identical PostgreSQL
backend PIDs at authority and SDK creation. The original 60-second execution
limit was retained; no production locking code was changed.
